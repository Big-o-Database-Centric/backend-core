export const AI_PROVIDER = Symbol('AI_PROVIDER');
export type AiRole = 'system' | 'user' | 'assistant';

export interface AiChatInput {
  messages: Array<{ role: AiRole; content: string }>;
  maxTokens: number;
}

export interface AiProviderResponse {
  model: 'llama-8b-nvidia';
  message: { role: 'assistant'; content: string };
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  providerStatus: number;
  latencyMs: number;
}

export type AiProviderErrorCode = 'quota' | 'credential' | 'timeout' | 'upstream' | 'invalid_response';

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    readonly providerStatus: number | null,
    readonly latencyMs: number,
  ) {
    super(`AI provider failed: ${code}`);
  }
}

export interface AiProvider {
  chat(input: AiChatInput): Promise<AiProviderResponse>;
}
