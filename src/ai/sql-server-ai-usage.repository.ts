import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';
import { AiCompletion, AiLimits, AiReservationResult, AiUsageRepository } from './ai-usage.repository';

@Injectable()
export class SqlServerAiUsageRepository implements AiUsageRepository {
  constructor(private readonly sql: SqlService) {}

  async reserve(sessionToken: string | null, limits: AiLimits): Promise<AiReservationResult> {
    const [row] = await this.sql.execute<AiReservationResult>('sp_ReserveAiRequest', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
      UserPerMinute: { type: sql.Int, value: limits.userPerMinute },
      UserPerDay: { type: sql.Int, value: limits.userPerDay },
      GlobalPerMinute: { type: sql.Int, value: limits.globalPerMinute },
      GlobalPerDay: { type: sql.Int, value: limits.globalPerDay },
    });
    return row;
  }

  async complete(requestId: string, completion: AiCompletion): Promise<void> {
    await this.sql.execute('sp_CompleteAiRequest', {
      RequestId: { type: sql.UniqueIdentifier, value: requestId },
      State: { type: sql.NVarChar(20), value: completion.state },
      ProviderStatus: { type: sql.Int, value: completion.providerStatus },
      LatencyMs: { type: sql.Int, value: completion.latencyMs },
      PromptTokens: { type: sql.Int, value: completion.promptTokens },
      CompletionTokens: { type: sql.Int, value: completion.completionTokens },
      TotalTokens: { type: sql.Int, value: completion.totalTokens },
    });
  }

  async getCapabilities(sessionToken: string | null, limits: AiLimits): Promise<AiReservationResult> {
    const [row] = await this.sql.execute<AiReservationResult>('sp_GetAiCapabilities', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
      UserPerDay: { type: sql.Int, value: limits.userPerDay },
    });
    return row;
  }
}
