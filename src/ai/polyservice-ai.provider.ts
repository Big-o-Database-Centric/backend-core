import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiChatInput,
  AiProvider,
  AiProviderError,
  AiProviderResponse,
} from './ai-provider';

@Injectable()
export class PolyServiceAiProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: ConfigService) {
    let configuredApiKey: unknown;
    try {
      configuredApiKey = config.getOrThrow<unknown>('POLYSERVICE_AI_KEY');
    } catch {
      throw new Error('POLYSERVICE_AI_KEY is required');
    }
    if (typeof configuredApiKey !== 'string' || !configuredApiKey.trim()) {
      throw new Error('POLYSERVICE_AI_KEY is required');
    }
    this.apiKey = configuredApiKey.trim();
    const baseUrl = config.get<string>('POLYSERVICE_AI_BASE_URL', 'https://ia.polyrepo.andrescortes.dev');
    this.endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  }

  async chat(input: AiChatInput): Promise<AiProviderResponse> {
    const started = Date.now();
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-8b-nvidia',
          messages: input.messages,
          max_tokens: input.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch (error) {
      const code = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'timeout'
        : 'upstream';
      throw new AiProviderError(code, null, Date.now() - started);
    }

    const headersLatencyMs = Date.now() - started;
    if (!response.ok) {
      const code = response.status === 429
        ? 'quota'
        : response.status === 401 || response.status === 403
          ? 'credential'
          : response.status === 504
            ? 'timeout'
            : 'upstream';
      throw new AiProviderError(code, response.status, headersLatencyMs);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      const code = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'timeout'
        : 'invalid_response';
      throw new AiProviderError(code, response.status, Date.now() - started);
    }
    const latencyMs = Date.now() - started;
    const value = body as {
      choices?: Array<{ message?: { role?: string; content?: unknown } }>;
      usage?: Record<string, unknown>;
    } | null;
    const content = value?.choices?.[0]?.message?.content;
    const usage = value?.usage;

    if (
      typeof content !== 'string'
      || typeof usage?.prompt_tokens !== 'number'
      || typeof usage?.completion_tokens !== 'number'
      || typeof usage?.total_tokens !== 'number'
    ) {
      throw new AiProviderError('invalid_response', response.status, latencyMs);
    }

    return {
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content },
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      providerStatus: response.status,
      latencyMs,
    };
  }
}
