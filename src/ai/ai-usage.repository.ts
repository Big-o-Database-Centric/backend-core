export const AI_USAGE_REPOSITORY = Symbol('AI_USAGE_REPOSITORY');

export interface AiLimits {
  userPerMinute: number;
  userPerDay: number;
  globalPerMinute: number;
  globalPerDay: number;
}

export interface AiReservationResult {
  Success: boolean;
  Message: string;
  RequestId: string | null;
  RemainingToday: number | null;
}

export interface AiCompletion {
  state: 'completed' | 'failed';
  providerStatus: number | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiUsageRepository {
  reserve(sessionToken: string | null, limits: AiLimits): Promise<AiReservationResult>;
  complete(requestId: string, completion: AiCompletion): Promise<void>;
  getCapabilities(sessionToken: string | null, limits: AiLimits): Promise<AiReservationResult>;
}
