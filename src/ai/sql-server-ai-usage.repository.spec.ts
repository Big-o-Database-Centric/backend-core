import { SqlService } from '../database/sql.service';
import { VALID_SESSION_TOKEN } from './ai.test-fixtures';
import { SqlServerAiUsageRepository } from './sql-server-ai-usage.repository';

describe('SqlServerAiUsageRepository', () => {
  const sqlService = { execute: jest.fn() } as unknown as SqlService;
  const repository = new SqlServerAiUsageRepository(sqlService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reserves quota through the SQL control plane', async () => {
    const execute = sqlService.execute as jest.Mock;
    execute.mockResolvedValue([{ Success: true, Message: 'Reserved', RequestId: 'request-1', RemainingToday: 9 }]);

    const result = await repository.reserve(VALID_SESSION_TOKEN, {
      userPerMinute: 3,
      userPerDay: 10,
      globalPerMinute: 9,
      globalPerDay: 90,
    });

    expect(result).toEqual({ Success: true, Message: 'Reserved', RequestId: 'request-1', RemainingToday: 9 });
    expect(execute).toHaveBeenCalledWith('sp_ReserveAiRequest', expect.objectContaining({
      SessionToken: expect.objectContaining({ value: VALID_SESSION_TOKEN }),
      UserPerMinute: expect.objectContaining({ value: 3 }),
      UserPerDay: expect.objectContaining({ value: 10 }),
      GlobalPerMinute: expect.objectContaining({ value: 9 }),
      GlobalPerDay: expect.objectContaining({ value: 90 }),
    }));
  });

  it('records only completion metadata through the SQL control plane', async () => {
    const execute = sqlService.execute as jest.Mock;
    execute.mockResolvedValue([]);

    await repository.complete('request-1', {
      state: 'completed',
      providerStatus: 200,
      latencyMs: 125,
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
    });

    expect(execute).toHaveBeenCalledWith('sp_CompleteAiRequest', expect.objectContaining({
      RequestId: expect.objectContaining({ value: 'request-1' }),
      State: expect.objectContaining({ value: 'completed' }),
      ProviderStatus: expect.objectContaining({ value: 200 }),
      LatencyMs: expect.objectContaining({ value: 125 }),
      PromptTokens: expect.objectContaining({ value: 11 }),
      CompletionTokens: expect.objectContaining({ value: 22 }),
      TotalTokens: expect.objectContaining({ value: 33 }),
    }));
  });

  it('gets capabilities through the SQL control plane', async () => {
    const execute = sqlService.execute as jest.Mock;
    execute.mockResolvedValue([{ Success: true, Message: 'Available', RequestId: null, RemainingToday: 7 }]);

    const result = await repository.getCapabilities(VALID_SESSION_TOKEN, {
      userPerMinute: 3,
      userPerDay: 10,
      globalPerMinute: 9,
      globalPerDay: 90,
    });

    expect(result).toEqual({ Success: true, Message: 'Available', RequestId: null, RemainingToday: 7 });
    expect(execute).toHaveBeenCalledWith('sp_GetAiCapabilities', expect.objectContaining({
      SessionToken: expect.objectContaining({ value: VALID_SESSION_TOKEN }),
      UserPerDay: expect.objectContaining({ value: 10 }),
    }));
  });
});
