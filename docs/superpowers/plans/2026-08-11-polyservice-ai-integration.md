# PolyService AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated Big O users chat with `llama-8b-nvidia` through the backend while protecting one platform-managed PolyService API key and enforcing persistent fair-use limits.

**Architecture:** Add a focused NestJS AI module with provider and repository interfaces. SQL Server atomically authorizes and reserves shared quota; a PolyService adapter performs the upstream request; a dedicated static frontend page consumes only Big O endpoints and keeps conversation content in memory.

**Tech Stack:** NestJS 10, TypeScript 5, Node.js built-in `fetch`, SQL Server stored procedures via `mssql`, Jest, static HTML/JavaScript, Tailwind CSS, Playwright, GitHub Actions, Docker.

## Global Constraints

- The only enabled model is `llama-8b-nvidia`.
- The API key is read only from `POLYSERVICE_AI_KEY`; no secret value may appear in source, tests, logs, API responses, Dockerfiles, committed `.env` files, or browser storage.
- Chat requires a valid Big O `session_token` cookie.
- Conversation content is never persisted by the backend or browser storage.
- `stream` is always `false`; no automatic retries are allowed.
- Request limits: 1-10 messages, 1-4,000 trimmed characters per message, at most 12,000 total characters, and 1-512 output tokens with 256 as the default.
- Initial quota defaults: 3 requests/minute and 10/day per user; 9/minute and 90/day globally, all based on UTC.
- Provider timeout is 35 seconds.
- No production secret, SQL migration, VPS setting, or remote `main` branch changes until all local checks pass and the user explicitly approves publication.
- The API key used during design validation must be rotated before production deployment.

## Repository Paths

- Backend commands and unprefixed paths use `work/backend-core` as the working directory.
- Frontend paths use the sibling repository `work/frontend-landing`; frontend commands explicitly change to that repository before running.

---

### Task 1: Persistent AI quota migration and repository adapter

**Files:**
- Create: `scripts/sql/004-ai-usage.sql`
- Create: `src/ai/ai-usage.repository.ts`
- Create: `src/ai/sql-server-ai-usage.repository.ts`
- Create: `src/ai/sql-server-ai-usage.repository.spec.ts`
- Create: `src/ai/ai-sql-contract.spec.ts`
- Modify: `src/database/sql.service.ts`
- Modify: `src/database/sql.service.spec.ts`

**Interfaces:**
- Produces `AI_USAGE_REPOSITORY` and `AiUsageRepository`.
- `reserve(sessionToken, limits)` returns authorization, request ID, and remaining daily quota.
- `complete(requestId, result)` records safe request metadata without content.
- `getCapabilities(sessionToken, limits)` returns authorization and remaining daily quota.

- [ ] **Step 1: Write the failing SQL contract tests**

Create `src/ai/ai-sql-contract.spec.ts` with assertions for additive guards, atomic locking, session authorization, UTC windows, and absence of prompt/response columns:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI usage SQL migration', () => {
  const migration = readFileSync(resolve(__dirname, '../../scripts/sql/004-ai-usage.sql'), 'utf8');

  it('creates an additive metadata-only request table', () => {
    expect(migration).toContain("OBJECT_ID('dbo.AiRequests', 'U') IS NULL");
    expect(migration).toContain('CREATE TABLE dbo.AiRequests');
    expect(migration).not.toMatch(/Prompt|ResponseContent|MessageContent/);
  });

  it('reserves quota atomically for authenticated sessions', () => {
    expect(migration).toContain('sp_ReserveAiRequest');
    expect(migration).toContain("sp_getapplock");
    expect(migration).toContain("N'ai-shared-quota'");
    expect(migration).toContain('SYSUTCDATETIME()');
  });

  it('provides completion and capabilities procedures', () => {
    expect(migration).toContain('sp_CompleteAiRequest');
    expect(migration).toContain('sp_GetAiCapabilities');
  });
});
```

- [ ] **Step 2: Run the SQL contract test and verify RED**

Run from `backend-core`:

```powershell
npm.cmd test -- --runInBand src/ai/ai-sql-contract.spec.ts
```

Expected: FAIL because `scripts/sql/004-ai-usage.sql` does not exist.

- [ ] **Step 3: Write the additive SQL migration**

Create `scripts/sql/004-ai-usage.sql` with this table shape and procedures:

```sql
IF OBJECT_ID('dbo.AiRequests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AiRequests (
        RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AiRequests PRIMARY KEY,
        UserId INT NOT NULL,
        ReservedAt DATETIME2 NOT NULL,
        CompletedAt DATETIME2 NULL,
        State NVARCHAR(20) NOT NULL,
        ProviderStatus INT NULL,
        LatencyMs INT NULL,
        PromptTokens INT NULL,
        CompletionTokens INT NULL,
        TotalTokens INT NULL,
        CONSTRAINT FK_AiRequests_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId)
    );
    CREATE INDEX IX_AiRequests_User_ReservedAt ON dbo.AiRequests(UserId, ReservedAt);
    CREATE INDEX IX_AiRequests_ReservedAt ON dbo.AiRequests(ReservedAt);
END
GO
```

Implement `sp_ReserveAiRequest`, `sp_CompleteAiRequest`, and `sp_GetAiCapabilities` with the following locking and result contract:

```sql
CREATE OR ALTER PROCEDURE dbo.sp_ReserveAiRequest
    @SessionToken UNIQUEIDENTIFIER,
    @UserPerMinute INT,
    @UserPerDay INT,
    @GlobalPerMinute INT,
    @GlobalPerDay INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Now DATETIME2 = SYSUTCDATETIME(), @RequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @MinuteStart DATETIME2, @DayStart DATETIME2;
    DECLARE @UserMinuteCount INT, @UserDayCount INT, @GlobalMinuteCount INT, @GlobalDayCount INT;
    SET @MinuteStart = DATEADD(MINUTE, DATEDIFF(MINUTE, 0, @Now), 0);
    SET @DayStart = CONVERT(DATETIME2, CONVERT(DATE, @Now));

    SELECT @UserId = UserId FROM dbo.Sessions
    WHERE SessionToken = @SessionToken AND ExpiresAt > @Now;
    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId, CAST(NULL AS INT) AS RemainingToday;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @LockResult INT;
        EXEC @LockResult = sp_getapplock @Resource = N'ai-shared-quota',
            @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
        IF @LockResult < 0 THROW 51000, 'AI quota lock unavailable', 1;

        SELECT @UserMinuteCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND ReservedAt >= @MinuteStart;
        SELECT @UserDayCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND ReservedAt >= @DayStart;
        SELECT @GlobalMinuteCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE ReservedAt >= @MinuteStart;
        SELECT @GlobalDayCount = COUNT(*) FROM dbo.AiRequests WITH (UPDLOCK, HOLDLOCK)
        WHERE ReservedAt >= @DayStart;

        IF @UserMinuteCount >= @UserPerMinute OR @UserDayCount >= @UserPerDay
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT CAST(0 AS BIT) AS Success, 'User AI quota reached' AS Message,
                   CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
                   IIF(@UserPerDay > @UserDayCount, @UserPerDay - @UserDayCount, 0) AS RemainingToday;
            RETURN;
        END
        IF @GlobalMinuteCount >= @GlobalPerMinute OR @GlobalDayCount >= @GlobalPerDay
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT CAST(0 AS BIT) AS Success, 'Global AI quota reached' AS Message,
                   CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
                   IIF(@UserPerDay > @UserDayCount, @UserPerDay - @UserDayCount, 0) AS RemainingToday;
            RETURN;
        END

        INSERT dbo.AiRequests (RequestId, UserId, ReservedAt, State)
        VALUES (@RequestId, @UserId, @Now, 'reserved');
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) AS Success, 'Reserved' AS Message, @RequestId AS RequestId,
               @UserPerDay - @UserDayCount - 1 AS RemainingToday;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_CompleteAiRequest
    @RequestId UNIQUEIDENTIFIER, @State NVARCHAR(20), @ProviderStatus INT = NULL,
    @LatencyMs INT, @PromptTokens INT = NULL, @CompletionTokens INT = NULL, @TotalTokens INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @State NOT IN ('completed', 'failed') THROW 51001, 'Invalid AI request state', 1;
    UPDATE dbo.AiRequests SET State = @State, CompletedAt = SYSUTCDATETIME(),
        ProviderStatus = @ProviderStatus, LatencyMs = @LatencyMs,
        PromptTokens = @PromptTokens, CompletionTokens = @CompletionTokens, TotalTokens = @TotalTokens
    WHERE RequestId = @RequestId AND State = 'reserved';
    SELECT CAST(IIF(@@ROWCOUNT = 1, 1, 0) AS BIT) AS Success;
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_GetAiCapabilities
    @SessionToken UNIQUEIDENTIFIER, @UserPerDay INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @UserId INT, @Now DATETIME2 = SYSUTCDATETIME(), @UsedToday INT;
    SELECT @UserId = UserId FROM dbo.Sessions
    WHERE SessionToken = @SessionToken AND ExpiresAt > @Now;
    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Unauthorized' AS Message,
               CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId, CAST(NULL AS INT) AS RemainingToday;
        RETURN;
    END
    SELECT @UsedToday = COUNT(*) FROM dbo.AiRequests
    WHERE UserId = @UserId AND ReservedAt >= CONVERT(DATETIME2, CONVERT(DATE, @Now));
    SELECT CAST(1 AS BIT) AS Success, 'Available' AS Message,
           CAST(NULL AS UNIQUEIDENTIFIER) AS RequestId,
           IIF(@UserPerDay > @UsedToday, @UserPerDay - @UsedToday, 0) AS RemainingToday;
END
GO
```

- [ ] **Step 4: Extend migration startup tests before changing `SqlService`**

In `src/database/sql.service.spec.ts`, add a failing assertion that pool startup batches both migration files in order:

```ts
expect(readFileSync).toHaveBeenNthCalledWith(1, expect.stringContaining('003-managed-databases.sql'), 'utf8');
expect(readFileSync).toHaveBeenNthCalledWith(2, expect.stringContaining('004-ai-usage.sql'), 'utf8');
```

Run:

```powershell
npm.cmd test -- --runInBand src/database/sql.service.spec.ts
```

Expected: FAIL because startup applies only migration `003`.

- [ ] **Step 5: Apply both additive migrations at startup**

Replace the single-file implementation in `src/database/sql.service.ts` with an ordered helper:

```ts
private static readonly migrations = [
  'scripts/sql/003-managed-databases.sql',
  'scripts/sql/004-ai-usage.sql',
];

private static async applyMigrations(pool: sql.ConnectionPool): Promise<void> {
  for (const file of this.migrations) {
    const migration = readFileSync(resolve(process.cwd(), file), 'utf8');
    const batches = migration.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
    for (const batch of batches) await pool.request().batch(batch);
  }
}
```

Call `applyMigrations` from `createPool` after connecting.

- [ ] **Step 6: Write repository tests and verify RED**

Create `src/ai/sql-server-ai-usage.repository.spec.ts` with a fake `SqlService` and assert exact stored procedure names and parameter values:

```ts
it('reserves quota through the SQL control plane', async () => {
  sqlService.execute.mockResolvedValue([{ Success: true, RequestId: 'request-1', RemainingToday: 9 }]);
  await repository.reserve('session-1', { userPerMinute: 3, userPerDay: 10, globalPerMinute: 9, globalPerDay: 90 });
  expect(sqlService.execute).toHaveBeenCalledWith('sp_ReserveAiRequest', expect.objectContaining({
    SessionToken: expect.objectContaining({ value: 'session-1' }),
    UserPerDay: expect.objectContaining({ value: 10 }),
  }));
});
```

Run:

```powershell
npm.cmd test -- --runInBand src/ai/sql-server-ai-usage.repository.spec.ts
```

Expected: FAIL because the repository files do not exist.

- [ ] **Step 7: Implement repository types and SQL adapter**

Create `src/ai/ai-usage.repository.ts`:

```ts
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
```

Implement `SqlServerAiUsageRepository` with `SqlService.execute` and parameterized `mssql` types only:

```ts
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
```

- [ ] **Step 8: Run Task 1 tests and commit**

Run:

```powershell
npm.cmd test -- --runInBand src/ai/ai-sql-contract.spec.ts src/ai/sql-server-ai-usage.repository.spec.ts src/database/sql.service.spec.ts
npm.cmd run build
```

Expected: all selected tests PASS and build exits 0.

Commit locally:

```powershell
git add scripts/sql/004-ai-usage.sql src/ai/ai-usage.repository.ts src/ai/sql-server-ai-usage.repository.ts src/ai/sql-server-ai-usage.repository.spec.ts src/ai/ai-sql-contract.spec.ts src/database/sql.service.ts src/database/sql.service.spec.ts
git commit -m "feat: add persistent AI usage quotas"
```

---

### Task 2: Provider-neutral chat contract and PolyService adapter

**Files:**
- Create: `src/ai/ai-provider.ts`
- Create: `src/ai/polyservice-ai.provider.ts`
- Create: `src/ai/polyservice-ai.provider.spec.ts`

**Interfaces:**
- Produces `AI_PROVIDER`, `AiProvider.chat(input)`, `AiProviderResponse`, and `AiProviderError`.
- Consumed by `AiService` in Task 3.

- [ ] **Step 1: Write provider adapter tests and verify RED**

Create `src/ai/polyservice-ai.provider.spec.ts` using a mocked `global.fetch`:

```ts
it('sends the fixed model and secret authorization only upstream', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'Hola' } }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const result = await provider.chat({
    messages: [{ role: 'user', content: 'Hola' }],
    maxTokens: 64,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'https://ia.polyrepo.andrescortes.dev/v1/chat/completions',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
      body: JSON.stringify({ model: 'llama-8b-nvidia', messages: [{ role: 'user', content: 'Hola' }], max_tokens: 64, stream: false }),
    }),
  );
  expect(result.message.content).toBe('Hola');
});
```

Add table-driven status tests and explicit timeout/shape/secret tests:

```ts
it.each([
  [429, 'quota'], [401, 'credential'], [403, 'credential'], [502, 'upstream'], [500, 'upstream'],
])('maps upstream %i to %s', async (status, code) => {
  fetchMock.mockResolvedValue(new Response('{}', { status }));
  await expect(provider.chat(input)).rejects.toMatchObject({ code, providerStatus: status });
});

it('maps aborts to timeout', async () => {
  fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await expect(provider.chat(input)).rejects.toMatchObject({ code: 'timeout' });
});

it('rejects an invalid success payload without leaking the key', async () => {
  fetchMock.mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));
  const error = await provider.chat(input).catch((value) => value);
  expect(error).toMatchObject({ code: 'invalid_response' });
  expect(String(error)).not.toContain('test-secret');
});
```

Run:

```powershell
npm.cmd test -- --runInBand src/ai/polyservice-ai.provider.spec.ts
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 2: Define the provider contract**

Create `src/ai/ai-provider.ts`:

```ts
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
  ) { super(`AI provider failed: ${code}`); }
}

export interface AiProvider {
  chat(input: AiChatInput): Promise<AiProviderResponse>;
}
```

- [ ] **Step 3: Implement `PolyServiceAiProvider`**

Use `ConfigService.getOrThrow('POLYSERVICE_AI_KEY')` during construction, default the base URL to `https://ia.polyrepo.andrescortes.dev`, and issue one `fetch` with `AbortSignal.timeout(35_000)`. Parse and validate the exact `choices[0].message.content` and `usage` fields before returning the provider-neutral response. Translate only safe categories into `AiProviderError`.

```ts
@Injectable()
export class PolyServiceAiProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('POLYSERVICE_AI_KEY');
    const baseUrl = config.get<string>('POLYSERVICE_AI_BASE_URL', 'https://ia.polyrepo.andrescortes.dev');
    this.endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  }

  async chat(input: AiChatInput): Promise<AiProviderResponse> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-8b-nvidia', messages: input.messages,
          max_tokens: input.maxTokens, stream: false,
        }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch (error) {
      const code = error instanceof Error && error.name === 'TimeoutError' || error instanceof Error && error.name === 'AbortError'
        ? 'timeout' : 'upstream';
      throw new AiProviderError(code, null, Date.now() - started);
    }

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const code = response.status === 429 ? 'quota'
        : response.status === 401 || response.status === 403 ? 'credential' : 'upstream';
      throw new AiProviderError(code, response.status, latencyMs);
    }

    const body: unknown = await response.json().catch(() => null);
    const value = body as { choices?: Array<{ message?: { role?: string; content?: unknown } }>; usage?: Record<string, unknown> } | null;
    const content = value?.choices?.[0]?.message?.content;
    const usage = value?.usage;
    if (typeof content !== 'string' || typeof usage?.prompt_tokens !== 'number'
      || typeof usage?.completion_tokens !== 'number' || typeof usage?.total_tokens !== 'number') {
      throw new AiProviderError('invalid_response', response.status, latencyMs);
    }
    return {
      model: 'llama-8b-nvidia', message: { role: 'assistant', content }, providerStatus: response.status, latencyMs,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }
}
```

- [ ] **Step 4: Run provider tests and commit**

Run:

```powershell
npm.cmd test -- --runInBand src/ai/polyservice-ai.provider.spec.ts
npm.cmd run build
```

Expected: PASS with no secret value in output.

Commit locally:

```powershell
git add src/ai/ai-provider.ts src/ai/polyservice-ai.provider.ts src/ai/polyservice-ai.provider.spec.ts
git commit -m "feat: add PolyService AI provider"
```

---

### Task 3: Validated authenticated AI API

**Files:**
- Create: `src/ai/dto/chat-message.dto.ts`
- Create: `src/ai/dto/create-ai-chat.dto.ts`
- Create: `src/ai/dto/create-ai-chat.dto.spec.ts`
- Create: `src/ai/ai.service.ts`
- Create: `src/ai/ai.service.spec.ts`
- Create: `src/ai/ai.controller.ts`
- Create: `src/ai/ai.controller.spec.ts`
- Create: `src/ai/ai.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes `AiUsageRepository` from Task 1 and `AiProvider` from Task 2.
- Produces authenticated `GET /api/ai/capabilities` and `POST /api/ai/chat`.

- [ ] **Step 1: Write DTO validation tests and verify RED**

Test with `class-transformer` and `class-validator` using a reusable helper:

```ts
const errorsFor = (value: object) => validateSync(plainToInstance(CreateAiChatDto, value));

it('accepts the bounded default request', () => {
  expect(errorsFor({ messages: [{ role: 'user', content: 'Hola' }] })).toHaveLength(0);
});

it.each([
  [{ messages: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' })) }],
  [{ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }],
  [{ messages: [{ role: 'tool', content: 'x' }] }],
  [{ messages: [{ role: 'user', content: 'x' }], maxTokens: 0 }],
  [{ messages: [{ role: 'user', content: 'x' }], maxTokens: 513 }],
])('rejects an out-of-contract request', (value) => {
  expect(errorsFor(value)).not.toHaveLength(0);
});
```

Include this service-level aggregate test:

```ts
await expect(service.chat('session-1', {
  messages: Array.from({ length: 4 }, () => ({ role: 'user' as const, content: 'x'.repeat(3001) })),
  maxTokens: 256,
})).rejects.toThrow(BadRequestException);
expect(repository.reserve).not.toHaveBeenCalled();
```

Run:

```powershell
npm.cmd test -- --runInBand src/ai/dto/create-ai-chat.dto.spec.ts
```

Expected: FAIL because DTOs do not exist.

- [ ] **Step 2: Implement the DTOs**

Use nested validation:

```ts
export class ChatMessageDto {
  @IsIn(['system', 'user', 'assistant']) role!: AiRole;
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
}

export class CreateAiChatDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional() @IsInt() @Min(1) @Max(512)
  maxTokens = 256;
}
```

- [ ] **Step 3: Write service tests and verify RED**

Create cases that assert:

```ts
repository.reserve.mockResolvedValue({ Success: true, RequestId: 'request-1', RemainingToday: 9 });
provider.chat.mockResolvedValue({
  model: 'llama-8b-nvidia', message: { role: 'assistant', content: 'Hola' },
  usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
  providerStatus: 200, latencyMs: 20,
});

await expect(service.chat('session-1', dto)).resolves.toEqual(expect.objectContaining({
  message: { role: 'assistant', content: 'Hola' }, remaining: { today: 9 },
}));
expect(repository.complete).toHaveBeenCalledWith('request-1', expect.objectContaining({ state: 'completed', totalTokens: 3 }));
```

Add cases for unauthorized reservation, local/user/global quota rejection, aggregate content length, and each `AiProviderError` mapping. Verify provider failures call `complete` with `state: 'failed'` and never return provider internals.

Run:

```powershell
npm.cmd test -- --runInBand src/ai/ai.service.spec.ts
```

Expected: FAIL because `AiService` does not exist.

- [ ] **Step 4: Implement `AiService`**

Read configurable limits with safe integer fallbacks:

```ts
const limits = {
  userPerMinute: readPositiveInt('AI_USER_PER_MINUTE', 3),
  userPerDay: readPositiveInt('AI_USER_PER_DAY', 10),
  globalPerMinute: readPositiveInt('AI_GLOBAL_PER_MINUTE', 9),
  globalPerDay: readPositiveInt('AI_GLOBAL_PER_DAY', 90),
};
```

Implement `capabilities(sessionToken)` and `chat(sessionToken, dto)`. Trim all message content, enforce the aggregate limit before reserving, reserve quota, call the provider once, complete metadata, and map errors to Nest exceptions exactly as specified.

```ts
async chat(sessionToken: string | null, dto: CreateAiChatDto) {
  const messages = dto.messages.map((message) => ({ ...message, content: message.content.trim() }));
  if (messages.some((message) => !message.content)
    || messages.reduce((sum, message) => sum + message.content.length, 0) > 12_000) {
    throw new BadRequestException('AI request is too large');
  }

  const reservation = await this.repository.reserve(sessionToken, this.limits);
  if (!reservation?.Success) {
    if (reservation?.Message === 'Unauthorized') throw new UnauthorizedException();
    throw new TooManyRequestsException(reservation?.Message ?? 'AI quota reached');
  }
  if (!reservation.RequestId) throw new InternalServerErrorException('AI reservation failed');

  try {
    const result = await this.provider.chat({ messages, maxTokens: dto.maxTokens ?? 256 });
    await this.repository.complete(reservation.RequestId, {
      state: 'completed', providerStatus: result.providerStatus, latencyMs: result.latencyMs,
      promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    });
    return { model: result.model, message: result.message, usage: result.usage,
      remaining: { today: reservation.RemainingToday } };
  } catch (error) {
    const providerError = error instanceof AiProviderError ? error
      : new AiProviderError('upstream', null, 0);
    await this.repository.complete(reservation.RequestId, {
      state: 'failed', providerStatus: providerError.providerStatus, latencyMs: providerError.latencyMs,
      promptTokens: null, completionTokens: null, totalTokens: null,
    }).catch(() => undefined);
    if (providerError.code === 'quota') throw new TooManyRequestsException('AI service quota reached');
    if (providerError.code === 'credential') throw new ServiceUnavailableException('AI service unavailable');
    if (providerError.code === 'timeout') throw new GatewayTimeoutException('AI service timeout');
    throw new BadGatewayException('AI service unavailable');
  }
}

async capabilities(sessionToken: string | null) {
  const result = await this.repository.getCapabilities(sessionToken, this.limits);
  if (!result?.Success) throw new UnauthorizedException();
  return {
    models: ['llama-8b-nvidia'], defaultModel: 'llama-8b-nvidia',
    maxTokens: 512, defaultMaxTokens: 256,
    perUser: { perMinute: this.limits.userPerMinute, perDay: this.limits.userPerDay },
    remaining: { today: result.RemainingToday ?? 0 },
  };
}
```

- [ ] **Step 5: Write controller tests and verify RED**

Test cookie propagation and route result shape:

```ts
await controller.chat({ cookies: { session_token: 'session-1' } } as any, dto);
expect(service.chat).toHaveBeenCalledWith('session-1', dto);
```

Run:

```powershell
npm.cmd test -- --runInBand src/ai/ai.controller.spec.ts
```

Expected: FAIL because controller/module do not exist.

- [ ] **Step 6: Implement controller, module, and app registration**

Create:

```ts
@Controller('api/ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Get('capabilities')
  capabilities(@Req() req: Request) {
    return this.service.capabilities(req.cookies?.session_token ?? null);
  }

  @Post('chat')
  chat(@Req() req: Request, @Body() dto: CreateAiChatDto) {
    return this.service.chat(req.cookies?.session_token ?? null, dto);
  }
}
```

Register `SqlServerAiUsageRepository` behind `AI_USAGE_REPOSITORY`, `PolyServiceAiProvider` behind `AI_PROVIDER`, and add `AiModule` to `AppModule`.

```ts
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    { provide: AI_USAGE_REPOSITORY, useClass: SqlServerAiUsageRepository },
    { provide: AI_PROVIDER, useClass: PolyServiceAiProvider },
  ],
})
export class AiModule {}
```

- [ ] **Step 7: Run Task 3 tests and commit**

Run:

```powershell
npm.cmd test -- --runInBand src/ai
npm.cmd run build
```

Expected: all AI tests PASS and build exits 0.

Commit locally:

```powershell
git add src/ai src/app.module.ts
git commit -m "feat: expose authenticated AI chat API"
```

---

### Task 4: Candidate-safe deployment configuration

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `src/managed-databases/deployment-contract.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces container environment `POLYSERVICE_AI_KEY` and configurable `AI_*` limit variables.
- The provider construction from Task 2 consumes `POLYSERVICE_AI_KEY`.

- [ ] **Step 1: Write the failing deployment contract test**

Add assertions that `start_backend` passes the secret and safe defaults to both candidate and final containers:

```ts
expect(workflow).toContain('-e POLYSERVICE_AI_KEY="${{ secrets.POLYSERVICE_AI_KEY }}"');
expect(workflow).toContain("AI_USER_PER_MINUTE");
expect(workflow).toContain("AI_USER_PER_DAY");
expect(workflow).toContain("AI_GLOBAL_PER_MINUTE");
expect(workflow).toContain("AI_GLOBAL_PER_DAY");
```

Run:

```powershell
npm.cmd test -- --runInBand src/managed-databases/deployment-contract.spec.ts
```

Expected: FAIL because the workflow does not pass AI configuration.

- [ ] **Step 2: Add deployment and local configuration names**

Add to the shared `start_backend` function:

```yaml
-e POLYSERVICE_AI_KEY="${{ secrets.POLYSERVICE_AI_KEY }}" \
-e AI_USER_PER_MINUTE="${{ vars.AI_USER_PER_MINUTE || '3' }}" \
-e AI_USER_PER_DAY="${{ vars.AI_USER_PER_DAY || '10' }}" \
-e AI_GLOBAL_PER_MINUTE="${{ vars.AI_GLOBAL_PER_MINUTE || '9' }}" \
-e AI_GLOBAL_PER_DAY="${{ vars.AI_GLOBAL_PER_DAY || '90' }}" \
```

Document only names and non-secret defaults in `.env.example`; use `POLYSERVICE_AI_KEY=` with no value.

- [ ] **Step 3: Run deployment tests and commit**

Run:

```powershell
npm.cmd test -- --runInBand src/managed-databases/deployment-contract.spec.ts
npm.cmd run build
```

Expected: PASS.

Commit locally:

```powershell
git add .github/workflows/deploy.yml .env.example src/managed-databases/deployment-contract.spec.ts
git commit -m "chore: configure AI service deployment"
```

---

### Task 5: Dedicated in-memory AI chat page

**Files:**
- Create: `../frontend-landing/views/ai.html`
- Create: `../frontend-landing/js/ai.js`
- Create: `../frontend-landing/tests/ai.spec.ts`
- Modify: `../frontend-landing/views/dashboard.html`
- Modify: `../frontend-landing/css/tailwind-input.css`
- Regenerate: `../frontend-landing/css/tailwind.css`

**Interfaces:**
- Consumes `GET /api/me`, `GET /api/ai/capabilities`, `POST /api/ai/chat`, and `POST /api/auth/logout`.
- Produces no browser-stored credentials or conversation data.

- [ ] **Step 1: Write successful chat Playwright test and verify RED**

Create `tests/ai.spec.ts` with mocked same-origin APIs:

```ts
test('authenticated user chats without receiving the provider key', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { Name: 'Ada', Email: 'ada@example.com' } }));
  await page.route('**/api/ai/capabilities', (route) => route.fulfill({ json: {
    models: ['llama-8b-nvidia'], defaultModel: 'llama-8b-nvidia', maxTokens: 512,
    defaultMaxTokens: 256, perUser: { perMinute: 3, perDay: 10 }, remaining: { today: 9 },
  } }));
  await page.route('**/api/ai/chat', (route) => route.fulfill({ json: {
    model: 'llama-8b-nvidia', message: { role: 'assistant', content: 'Hola desde IA' },
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }, remaining: { today: 8 },
  } }));

  await page.goto('/views/ai.html');
  await page.locator('#ai-message').fill('Hola');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-transcript')).toContainText('Hola desde IA');
  await expect(page.locator('body')).not.toContainText('pr_ai_');
});
```

Run:

```powershell
npx.cmd playwright test tests/ai.spec.ts
```

Expected: FAIL because `views/ai.html` does not exist.

- [ ] **Step 2: Write loading, quota, session, and memory-only tests**

Add a delayed-request test and table-driven error tests:

```ts
test('shows progress, blocks duplicates, and keeps no browser-stored transcript', async ({ page }) => {
  await mockProfileAndCapabilities(page);
  await page.route('**/api/ai/chat', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ json: successfulChat });
  });
  await page.goto('/views/ai.html');
  await page.locator('#ai-message').fill('Hola');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-progress')).toHaveText('Generando respuesta…');
  await expect(page.locator('#ai-submit')).toBeDisabled();
  await expect(page.locator('#ai-transcript')).toContainText('Hola desde IA');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(page.locator('#ai-transcript')).not.toContainText('Hola desde IA');
});

for (const [status, expected] of [
  [400, 'Revisa el contenido del mensaje.'],
  [429, 'Alcanzaste el límite de uso de IA.'],
  [502, 'El servicio de IA no está disponible.'],
  [504, 'El servicio de IA tardó demasiado.'],
] as const) {
  test(`shows a safe message for ${status}`, async ({ page }) => {
    await mockProfileAndCapabilities(page);
    await page.route('**/api/ai/chat', (route) => route.fulfill({ status, json: { message: 'internal' } }));
    await page.goto('/views/ai.html');
    await page.locator('#ai-message').fill('Hola');
    await page.locator('#ai-submit').click();
    await expect(page.locator('#ai-error')).toHaveText(expected);
  });
}
```

Add a `401` case that expects navigation to `/views/login.html`, and a new-conversation case that expects the transcript and in-memory request context to be empty after clicking `#ai-new-conversation`.

- [ ] **Step 3: Build the semantic AI page**

Create `views/ai.html` with these stable test hooks:

```html
<span id="ai-model"></span>
<span id="ai-remaining"></span>
<section id="ai-transcript" aria-live="polite"></section>
<form id="ai-form">
  <textarea id="ai-message" maxlength="4000" required></textarea>
  <button id="ai-submit" type="submit">Enviar</button>
</form>
<p id="ai-progress" class="hidden" role="status"></p>
<p id="ai-error" class="hidden" role="alert"></p>
<button id="ai-new-conversation" type="button">Nueva conversación</button>
```

Use the existing dashboard visual system and add an `IA` navigation link from `views/dashboard.html` to `/views/ai.html`.

- [ ] **Step 4: Implement memory-only chat behavior**

In `js/ai.js`, keep messages only in a module-local array:

```js
const messages = [];

const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.href = '/views/login.html'; throw new Error('Unauthorized'); }
  if (!response.ok) throw Object.assign(new Error(body.message || 'No fue posible consultar la IA.'), { status: response.status });
  return body;
};
```

Render content with `textContent`, never `innerHTML`; send the in-memory messages and `maxTokens: 256`; disable only composer controls during the request; update remaining quota on success; and clear the array/transcript on `Nueva conversación`.

- [ ] **Step 5: Build CSS and run frontend tests**

Run from `frontend-landing`:

```powershell
npm.cmd run build:css
npx.cmd playwright test tests/ai.spec.ts tests/dashboard.spec.ts tests/navigation.spec.ts tests/style-bundle.spec.ts
```

Expected: selected tests PASS with no console errors.

- [ ] **Step 6: Commit frontend changes locally**

```powershell
git add views/ai.html js/ai.js tests/ai.spec.ts views/dashboard.html css/tailwind-input.css css/tailwind.css
git commit -m "feat: add authenticated AI chat page"
```

---

### Task 6: Final documentation, security scan, and local verification

**Files:**
- Modify: `README.md`
- Create: `docs/POLYSERVICE_AI.md`
- Modify: `../frontend-landing/README.md`
- Modify: `../frontend-landing/docs/ENDPOINTS.md`

**Interfaces:**
- Documents the API and operational contract produced by Tasks 1-5.
- Does not introduce runtime code.

- [ ] **Step 1: Document backend configuration and API**

Add exact environment names, endpoint request/response examples with placeholder `POLYSERVICE_AI_KEY=<secret>`, quota/error tables, local test commands, and the rule that prompts/responses are not persisted. Do not include any real key prefix beyond the generic documentation placeholder.

- [ ] **Step 2: Document frontend usage**

Describe login, opening `/views/ai.html`, sending a message, daily remaining requests, clearing a conversation, and expected error messages. Update `docs/ENDPOINTS.md` with `/api/ai/capabilities` and `/api/ai/chat` rather than any direct PolyService browser request.

- [ ] **Step 3: Run complete backend verification**

From `backend-core`:

```powershell
npm.cmd test -- --runInBand
npm.cmd run build
```

Expected: every Jest suite passes and Nest build exits 0.

- [ ] **Step 4: Run complete frontend verification**

From `frontend-landing`:

```powershell
npm.cmd run build:css
npx.cmd playwright test
```

Expected: every Playwright test passes.

- [ ] **Step 5: Perform repository secret scan**

Run from the workspace root:

```powershell
rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' "pr_ai_[A-Za-z0-9_-]{40,}|Authorization:\s*Bearer\s+[A-Za-z0-9_-]{20,}" work/backend-core work/frontend-landing
```

Expected: no real secret matches. Documentation may contain only `Authorization: Bearer <API_KEY>` and `POLYSERVICE_AI_KEY=<secret>` placeholders.

- [ ] **Step 6: Run one controlled real-provider test locally**

Set `POLYSERVICE_AI_KEY` only in the current process and call the local backend with a test user's authenticated cookie using one message and `maxTokens: 64`. Verify the response model, assistant content, token usage, and SQL metadata row; then remove the environment variable. Do not print the key or commit local `.env` files.

- [ ] **Step 7: Inspect the VPS read-only before any production change**

Verify available memory, current container health, SQL connectivity, and that no AI-related environment variable is currently present. This step is read-only and must not install packages, restart containers, apply SQL, or write secrets.

- [ ] **Step 8: Commit documentation locally**

Backend:

```powershell
git add README.md docs/POLYSERVICE_AI.md
git commit -m "docs: document PolyService AI integration"
```

Frontend:

```powershell
git add README.md docs/ENDPOINTS.md
git commit -m "docs: document AI chat usage"
```

- [ ] **Step 9: Stop at the publication gate**

Present the user with:

- Backend and frontend commit lists.
- Full test/build results.
- Secret-scan result.
- Controlled integration-test result without content or key.
- Read-only VPS capacity/health summary.
- Exact required production changes: rotate key, add `POLYSERVICE_AI_KEY` secret, apply additive migration through candidate startup, and push backend before frontend.

Do not set GitHub secrets, modify the VPS, apply production SQL, or push either `main` until the user explicitly approves.
