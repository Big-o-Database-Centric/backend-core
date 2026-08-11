import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider, AiProviderError } from './ai-provider';
import { AiService } from './ai.service';
import { VALID_SESSION_TOKEN } from './ai.test-fixtures';
import { AiUsageRepository } from './ai-usage.repository';
import { CreateAiChatDto } from './dto/create-ai-chat.dto';

describe('AiService', () => {
  let repository: jest.Mocked<AiUsageRepository>;
  let provider: jest.Mocked<AiProvider>;

  const configWith = (values: Record<string, unknown> = {}) => ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

  const makeService = (values: Record<string, unknown> = {}) => new AiService(
    repository,
    provider,
    configWith(values),
  );

  const dto = (overrides: Partial<CreateAiChatDto> = {}): CreateAiChatDto => ({
    messages: [{ role: 'user', content: 'Hola' }],
    maxTokens: 256,
    ...overrides,
  });

  const expectHttpError = async (
    promise: Promise<unknown>,
    status: number,
    message: string,
  ) => {
    try {
      await promise;
      throw new Error('Expected an HTTP exception');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(status);
      const response = exception.getResponse();
      expect(typeof response === 'string' ? response : (response as { message: string }).message)
        .toBe(message);
    }
  };

  beforeEach(() => {
    repository = {
      reserve: jest.fn(),
      complete: jest.fn().mockResolvedValue(undefined),
      getCapabilities: jest.fn(),
    };
    provider = { chat: jest.fn() };
  });

  it('returns a safe chat response and records completed usage metadata', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: true,
      Message: 'Reserved',
      RequestId: 'request-1',
      RemainingToday: 9,
    });
    provider.chat.mockResolvedValue({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Hola' },
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      providerStatus: 200,
      latencyMs: 20,
    });

    await expect(service.chat(VALID_SESSION_TOKEN, dto({
      messages: [{ role: 'user', content: '  Hola  ' }],
      maxTokens: undefined as unknown as number,
    }))).resolves.toEqual({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Hola' },
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      remaining: { today: 9 },
    });
    expect(repository.reserve).toHaveBeenCalledWith(VALID_SESSION_TOKEN, {
      userPerMinute: 3,
      userPerDay: 10,
      globalPerMinute: 9,
      globalPerDay: 90,
    });
    expect(provider.chat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Hola' }],
      maxTokens: 256,
    });
    expect(repository.complete).toHaveBeenCalledWith('request-1', {
      state: 'completed',
      providerStatus: 200,
      latencyMs: 20,
      promptTokens: 2,
      completionTokens: 1,
      totalTokens: 3,
    });
  });

  it.each([
    ['empty trimmed content', [{ role: 'user' as const, content: '   ' }]],
    ['aggregate content over 12,000 characters', Array.from(
      { length: 4 },
      () => ({ role: 'user' as const, content: 'x'.repeat(3001) }),
    )],
  ])('rejects %s before reserving quota', async (_label, messages) => {
    const service = makeService();

    await expect(service.chat(VALID_SESSION_TOKEN, dto({ messages }))).rejects.toThrow(BadRequestException);
    expect(repository.reserve).not.toHaveBeenCalled();
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized reservation without calling the provider', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: false,
      Message: 'Unauthorized',
      RequestId: null,
      RemainingToday: null,
    });

    await expect(service.chat(VALID_SESSION_TOKEN, dto())).rejects.toThrow(UnauthorizedException);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it.each([null, 'not-a-uuid'])(
    'rejects an invalid chat session token before touching dependencies: %p',
    async (sessionToken) => {
      const service = makeService();

      await expect(service.chat(sessionToken, dto())).rejects.toThrow(UnauthorizedException);

      expect(repository.reserve).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
      expect(repository.getCapabilities).not.toHaveBeenCalled();
      expect(provider.chat).not.toHaveBeenCalled();
    },
  );

  it.each([
    'User AI quota reached',
    'Global AI quota reached',
  ])('preserves a local quota rejection as a safe 429: %s', async (message) => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: false,
      Message: message,
      RequestId: null,
      RemainingToday: 0,
    });

    await expectHttpError(
      service.chat(VALID_SESSION_TOKEN, dto()),
      HttpStatus.TOO_MANY_REQUESTS,
      message,
    );
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('uses the generic local quota message when the repository omits one', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: false,
      Message: undefined,
      RequestId: null,
      RemainingToday: 0,
    } as unknown as Awaited<ReturnType<AiUsageRepository['reserve']>>);

    await expectHttpError(
      service.chat(VALID_SESSION_TOKEN, dto()),
      HttpStatus.TOO_MANY_REQUESTS,
      'AI quota reached',
    );
  });

  it('rejects a malformed successful reservation without calling the provider', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: true,
      Message: 'Reserved',
      RequestId: null,
      RemainingToday: 9,
    });

    await expect(service.chat(VALID_SESSION_TOKEN, dto())).rejects.toThrow(
      new InternalServerErrorException('AI reservation failed'),
    );
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it.each([
    ['quota', 429, 12, HttpStatus.TOO_MANY_REQUESTS, 'AI service quota reached'],
    ['credential', 401, 13, HttpStatus.SERVICE_UNAVAILABLE, 'AI service unavailable'],
    ['timeout', null, 35_000, HttpStatus.GATEWAY_TIMEOUT, 'AI service timeout'],
    ['upstream', 502, 14, HttpStatus.BAD_GATEWAY, 'AI service unavailable'],
    ['invalid_response', 200, 15, HttpStatus.BAD_GATEWAY, 'AI service unavailable'],
  ] as const)(
    'maps provider %s failures without leaking internals',
    async (code, status, latencyMs, expectedStatus, message) => {
      const service = makeService();
      repository.reserve.mockResolvedValue({
        Success: true,
        Message: 'Reserved',
        RequestId: 'request-1',
        RemainingToday: 8,
      });
      provider.chat.mockRejectedValue(new AiProviderError(code, status, latencyMs));

      await expectHttpError(
        service.chat(VALID_SESSION_TOKEN, dto()),
        expectedStatus,
        message,
      );
      expect(repository.complete).toHaveBeenCalledWith('request-1', {
        state: 'failed',
        providerStatus: status,
        latencyMs,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });
    },
  );

  it('maps unknown provider failures to metadata-only bad gateway responses', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: true,
      Message: 'Reserved',
      RequestId: 'request-1',
      RemainingToday: 8,
    });
    provider.chat.mockRejectedValue(new Error('secret provider detail'));
    repository.complete.mockRejectedValue(new Error('completion unavailable'));

    await expect(service.chat(VALID_SESSION_TOKEN, dto())).rejects.toThrow(
      new BadGatewayException('AI service unavailable'),
    );
    expect(repository.complete).toHaveBeenCalledWith('request-1', {
      state: 'failed',
      providerStatus: null,
      latencyMs: 0,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it('returns a valid provider answer when completed metadata bookkeeping fails once', async () => {
    const service = makeService();
    repository.reserve.mockResolvedValue({
      Success: true,
      Message: 'Reserved',
      RequestId: 'request-1',
      RemainingToday: 8,
    });
    provider.chat.mockResolvedValue({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Answer' },
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      providerStatus: 200,
      latencyMs: 18,
    });
    repository.complete.mockRejectedValue(new Error('metadata unavailable'));

    await expect(service.chat(VALID_SESSION_TOKEN, dto())).resolves.toEqual({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Answer' },
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      remaining: { today: 8 },
    });
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledWith('request-1', {
      state: 'completed',
      providerStatus: 200,
      latencyMs: 18,
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
  });

  it('returns authenticated capabilities using configured positive integer limits', async () => {
    const service = makeService({
      AI_USER_PER_MINUTE: '4',
      AI_USER_PER_DAY: '11',
      AI_GLOBAL_PER_MINUTE: '8',
      AI_GLOBAL_PER_DAY: '80',
    });
    repository.getCapabilities.mockResolvedValue({
      Success: true,
      Message: 'Available',
      RequestId: null,
      RemainingToday: 7,
    });

    await expect(service.capabilities(VALID_SESSION_TOKEN)).resolves.toEqual({
      models: ['llama-8b-nvidia'],
      defaultModel: 'llama-8b-nvidia',
      maxTokens: 512,
      defaultMaxTokens: 256,
      perUser: { perMinute: 4, perDay: 11 },
      remaining: { today: 7 },
    });
    expect(repository.getCapabilities).toHaveBeenCalledWith(VALID_SESSION_TOKEN, {
      userPerMinute: 4,
      userPerDay: 11,
      globalPerMinute: 8,
      globalPerDay: 80,
    });
  });

  it('falls back from non-positive, fractional, and unsafe configured limits', async () => {
    const service = makeService({
      AI_USER_PER_MINUTE: '0',
      AI_USER_PER_DAY: '-2',
      AI_GLOBAL_PER_MINUTE: '1.5',
      AI_GLOBAL_PER_DAY: '9007199254740992',
    });
    repository.getCapabilities.mockResolvedValue({
      Success: true,
      Message: 'Available',
      RequestId: null,
      RemainingToday: null,
    });

    await expect(service.capabilities(VALID_SESSION_TOKEN)).resolves.toEqual(expect.objectContaining({
      perUser: { perMinute: 3, perDay: 10 },
      remaining: { today: 0 },
    }));
    expect(repository.getCapabilities).toHaveBeenCalledWith(VALID_SESSION_TOKEN, {
      userPerMinute: 3,
      userPerDay: 10,
      globalPerMinute: 9,
      globalPerDay: 90,
    });
  });

  it.each([null, 'not-a-uuid'])(
    'rejects an invalid capabilities session token before touching dependencies: %p',
    async (sessionToken) => {
      const service = makeService();

      await expect(service.capabilities(sessionToken)).rejects.toThrow(UnauthorizedException);

      expect(repository.getCapabilities).not.toHaveBeenCalled();
      expect(repository.reserve).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
      expect(provider.chat).not.toHaveBeenCalled();
    },
  );
});
