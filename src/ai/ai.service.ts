import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { AI_PROVIDER, AiProvider, AiProviderError, AiProviderResponse } from './ai-provider';
import {
  AI_USAGE_REPOSITORY,
  AiLimits,
  AiUsageRepository,
} from './ai-usage.repository';
import { CreateAiChatDto } from './dto/create-ai-chat.dto';

@Injectable()
export class AiService {
  private readonly limits: AiLimits;

  constructor(
    @Inject(AI_USAGE_REPOSITORY) private readonly repository: AiUsageRepository,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    config: ConfigService,
  ) {
    const readPositiveInt = (name: string, fallback: number) => {
      const value = Number(config.get<unknown>(name));
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };

    this.limits = {
      userPerMinute: readPositiveInt('AI_USER_PER_MINUTE', 3),
      userPerDay: readPositiveInt('AI_USER_PER_DAY', 10),
      globalPerMinute: readPositiveInt('AI_GLOBAL_PER_MINUTE', 9),
      globalPerDay: readPositiveInt('AI_GLOBAL_PER_DAY', 90),
    };
  }

  async chat(sessionToken: string | null, dto: CreateAiChatDto) {
    if (!isUUID(sessionToken)) throw new UnauthorizedException();

    const messages = dto.messages.map((message) => ({
      ...message,
      content: message.content.trim(),
    }));
    if (
      messages.some((message) => !message.content)
      || messages.reduce((sum, message) => sum + message.content.length, 0) > 12_000
    ) {
      throw new BadRequestException('AI request is too large');
    }

    const reservation = await this.repository.reserve(sessionToken, this.limits);
    if (!reservation?.Success) {
      if (reservation?.Message === 'Unauthorized') throw new UnauthorizedException();
      throw new HttpException(
        reservation?.Message ?? 'AI quota reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!reservation.RequestId) {
      throw new InternalServerErrorException('AI reservation failed');
    }

    let result: AiProviderResponse;
    try {
      result = await this.provider.chat({
        messages,
        maxTokens: dto.maxTokens ?? 256,
      });
    } catch (error) {
      const providerError = error instanceof AiProviderError
        ? error
        : new AiProviderError('upstream', null, 0);
      await this.repository.complete(reservation.RequestId, {
        state: 'failed',
        providerStatus: providerError.providerStatus,
        latencyMs: providerError.latencyMs,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }).catch(() => undefined);

      if (providerError.code === 'quota') {
        throw new HttpException('AI service quota reached', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (providerError.code === 'credential') {
        throw new ServiceUnavailableException('AI service unavailable');
      }
      if (providerError.code === 'timeout') {
        throw new GatewayTimeoutException('AI service timeout');
      }
      throw new BadGatewayException('AI service unavailable');
    }

    await this.repository.complete(reservation.RequestId, {
      state: 'completed',
      providerStatus: result.providerStatus,
      latencyMs: result.latencyMs,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    }).catch(() => undefined);
    return {
      model: result.model,
      message: result.message,
      usage: result.usage,
      remaining: { today: reservation.RemainingToday },
    };
  }

  async capabilities(sessionToken: string | null) {
    if (!isUUID(sessionToken)) throw new UnauthorizedException();

    const result = await this.repository.getCapabilities(sessionToken, this.limits);
    if (!result?.Success) throw new UnauthorizedException();

    return {
      models: ['llama-8b-nvidia'],
      defaultModel: 'llama-8b-nvidia',
      maxTokens: 512,
      defaultMaxTokens: 256,
      perUser: {
        perMinute: this.limits.userPerMinute,
        perDay: this.limits.userPerDay,
      },
      remaining: { today: result.RemainingToday ?? 0 },
    };
  }
}
