# OAuth Google/GitHub + Frontend Real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google + GitHub OAuth to the NestJS backend and connect the static frontend to the live backend, replacing the simulated login/register.

**Architecture:** Passport strategies handle only the OAuth protocol handshake; all account creation/linking/session logic lives in `sp_OAuthLogin`. CSRF `state` is stored in an HMAC-signed cookie (no express-session). The frontend talks to the same-origin `/api/*` backend with `credentials:'include'`.

**Tech Stack:** NestJS 10, Passport (`@nestjs/passport`, `passport-google-oauth20`, `passport-github2`), SQL Server stored procedures, mssql, Playwright (frontend E2E).

## Global Constraints

- Backend rule of gold: no business logic in TypeScript. Every endpoint calls exactly one stored procedure and relays its recordset. `AuthService` methods are one `sqlService.execute()` each.
- `SqlService.execute<T>(spName, params)` where `params: Record<string, { type, value }>`, `type` is an `mssql` type (e.g. `sql.NVarChar`, `sql.Bit`).
- Session cookie is named `session_token`, `{ httpOnly: true, secure: true, sameSite: 'lax' }`.
- Backend controllers: `AuthController` is `@Controller('api/auth')`, `UserController` is `@Controller('api')`.
- Env var names read by code: `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `SQL_PORT`, `CORS_ORIGIN`. New: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `PUBLIC_BASE_URL`.
- Production base URL: `https://big-o.andrescortes.dev`. OAuth callbacks: `${PUBLIC_BASE_URL}/api/auth/google/callback` and `${PUBLIC_BASE_URL}/api/auth/github/callback`.
- Account linking: link an OAuth identity to an existing email-user ONLY when the provider reports the email verified. Otherwise `Success = 0`.
- Run backend tests with `npm test`. Run a single suite with `npx jest src/path/file.spec.ts`.
- Frontend E2E: `cd frontend-landing && npx playwright test`. Backend calls are mocked with `page.route()`.
- Two repos: `backend-core` (NestJS) and `frontend-landing` (static). Commit in each repo separately.

---

## Task 1: SQL migration — schema, sp_OAuthLogin, sp_Logout, sp_Login fix

**Files:**
- Create: `backend-core/scripts/sql/002-oauth.sql`

**Interfaces:**
- Produces (contract the backend depends on):
  - `sp_OAuthLogin @Provider NVARCHAR(20), @ProviderAccountId NVARCHAR(255), @Email NVARCHAR(256), @Name NVARCHAR(100), @EmailVerified BIT` → recordset `{ Success bit, Message nvarchar, UserId int, SessionToken uniqueidentifier, Name nvarchar, Email nvarchar }` (same shape as `sp_Login`).
  - `sp_Logout @SessionToken UNIQUEIDENTIFIER` → recordset `{ Success bit }`.

This task has no automated test (no SQL Server in CI). The deliverable is an idempotent script; it is verified by running it against the database in Task 12 and probing the live endpoints.

- [ ] **Step 1: Write the migration script**

Create `backend-core/scripts/sql/002-oauth.sql`:

```sql
-- ============================================================
-- 002-oauth.sql — OAuth support (Google/GitHub), additive.
-- Idempotent: safe to run multiple times. Does NOT drop Users.
-- Run after scripts/sql/schema.sql.
-- ============================================================

-- --- Users: make password columns nullable (OAuth-only users have none) ---
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordHash' AND is_nullable = 0
)
BEGIN
    ALTER TABLE dbo.Users ALTER COLUMN PasswordHash VARBINARY(32) NULL;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordSalt' AND is_nullable = 0
)
BEGIN
    ALTER TABLE dbo.Users ALTER COLUMN PasswordSalt UNIQUEIDENTIFIER NULL;
END
GO

-- --- OAuth accounts: one row per linked provider identity ---
IF OBJECT_ID('dbo.UserOAuthAccounts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserOAuthAccounts (
        OAuthAccountId    INT IDENTITY(1,1) PRIMARY KEY,
        UserId            INT           NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
        Provider          NVARCHAR(20)  NOT NULL,
        ProviderAccountId NVARCHAR(255) NOT NULL,
        LinkedAt          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UX_UserOAuthAccounts UNIQUE (Provider, ProviderAccountId)
    );
END
GO

-- --- sp_Login: guard against NULL hash (OAuth-only users) ---
-- Without the IS NULL check, `NULL <> hash` is NULL, so `false OR NULL`
-- falls through to session creation, letting anyone log into an OAuth-only
-- account with any password.
CREATE OR ALTER PROCEDURE dbo.sp_Login
    @Email    NVARCHAR(256),
    @Password NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT, @Salt UNIQUEIDENTIFIER, @StoredHash VARBINARY(32), @Name NVARCHAR(100);

    SELECT @UserId = UserId, @Salt = PasswordSalt, @StoredHash = PasswordHash, @Name = Name
    FROM dbo.Users
    WHERE Email = @Email;

    IF @UserId IS NULL OR @StoredHash IS NULL OR @Salt IS NULL
       OR @StoredHash <> HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password)
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success, 'Invalid credentials' AS Message,
            CAST(NULL AS INT) AS UserId, CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
            CAST(NULL AS NVARCHAR(100)) AS Name, CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT CAST(1 AS BIT) AS Success, 'OK' AS Message, @UserId AS UserId,
           @Token AS SessionToken, @Name AS Name, @Email AS Email;
END
GO

-- --- sp_Logout: invalidate the session server-side ---
CREATE OR ALTER PROCEDURE dbo.sp_Logout
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.Sessions WHERE SessionToken = @SessionToken;
    SELECT CAST(1 AS BIT) AS Success;
END
GO

-- --- sp_OAuthLogin: find-or-link-or-create, then create session ---
CREATE OR ALTER PROCEDURE dbo.sp_OAuthLogin
    @Provider          NVARCHAR(20),
    @ProviderAccountId NVARCHAR(255),
    @Email             NVARCHAR(256),
    @Name              NVARCHAR(100),
    @EmailVerified     BIT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT, @ResolvedName NVARCHAR(100), @ResolvedEmail NVARCHAR(256);

    -- 1. Known provider identity → that user.
    SELECT @UserId = UserId FROM dbo.UserOAuthAccounts
    WHERE Provider = @Provider AND ProviderAccountId = @ProviderAccountId;

    IF @UserId IS NULL
    BEGIN
        -- 2. Unknown identity requires a verified email to link/create.
        IF @EmailVerified = 0 OR @Email IS NULL
        BEGIN
            SELECT CAST(0 AS BIT) AS Success, 'Email no verificado por el proveedor' AS Message,
                   CAST(NULL AS INT) AS UserId, CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
                   CAST(NULL AS NVARCHAR(100)) AS Name, CAST(NULL AS NVARCHAR(256)) AS Email;
            RETURN;
        END

        BEGIN TRY
            BEGIN TRANSACTION;

            -- 3. Existing email-user → link. Otherwise create.
            SELECT @UserId = UserId FROM dbo.Users WHERE Email = @Email;

            IF @UserId IS NULL
            BEGIN
                INSERT INTO dbo.Users (Name, Email, PasswordSalt, PasswordHash)
                VALUES (@Name, @Email, NULL, NULL);
                SET @UserId = CAST(SCOPE_IDENTITY() AS INT);
            END

            INSERT INTO dbo.UserOAuthAccounts (UserId, Provider, ProviderAccountId)
            VALUES (@UserId, @Provider, @ProviderAccountId);

            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            -- Concurrent create of the same identity/email: re-resolve.
            IF ERROR_NUMBER() IN (2627, 2601)
            BEGIN
                SELECT @UserId = UserId FROM dbo.UserOAuthAccounts
                WHERE Provider = @Provider AND ProviderAccountId = @ProviderAccountId;
                IF @UserId IS NULL
                    SELECT @UserId = UserId FROM dbo.Users WHERE Email = @Email;
            END
            ELSE THROW;
        END CATCH
    END

    -- 4. Create the session and return the sp_Login-shaped row.
    SELECT @ResolvedName = Name, @ResolvedEmail = Email FROM dbo.Users WHERE UserId = @UserId;

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT CAST(1 AS BIT) AS Success, 'OK' AS Message, @UserId AS UserId,
           @Token AS SessionToken, @ResolvedName AS Name, @ResolvedEmail AS Email;
END
GO
```

- [ ] **Step 2: Sanity-check the script parses**

The script cannot run in CI, but verify it has no obvious syntax slips: every `CREATE OR ALTER PROCEDURE` is followed by `GO`, and column types match `schema.sql` (`PasswordHash VARBINARY(32)`, `PasswordSalt UNIQUEIDENTIFIER`, `SessionToken UNIQUEIDENTIFIER`).

- [ ] **Step 3: Commit**

```bash
cd backend-core
git add scripts/sql/002-oauth.sql
git commit -m "feat(sql): add OAuth schema, sp_OAuthLogin, sp_Logout; fix sp_Login null-hash"
```

---

## Task 2: Real logout (backend)

**Files:**
- Modify: `backend-core/src/auth/auth.service.ts`
- Modify: `backend-core/src/auth/auth.controller.ts`
- Test: `backend-core/src/auth/auth.service.spec.ts`, `backend-core/src/auth/auth.controller.spec.ts`

**Interfaces:**
- Consumes: `SqlService.execute`, `sp_Logout` (Task 1).
- Produces: `AuthService.logout(token: string | null): Promise<void>`.

- [ ] **Step 1: Write the failing service test**

Add to `auth.service.spec.ts`:

```ts
it('calls sp_Logout with the session token', async () => {
  sqlService.execute.mockResolvedValue([{ Success: true }]);

  await service.logout('tok-123');

  expect(sqlService.execute).toHaveBeenCalledWith(
    'sp_Logout',
    expect.objectContaining({ SessionToken: expect.objectContaining({ value: 'tok-123' }) }),
  );
});

it('logout does not call the SP when token is null', async () => {
  await service.logout(null);
  expect(sqlService.execute).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/auth.service.spec.ts -t logout`
Expected: FAIL — `service.logout is not a function`.

- [ ] **Step 3: Implement `logout` in the service**

Add to `auth.service.ts` (import `sql` is already present):

```ts
async logout(token: string | null): Promise<void> {
  if (!token) return;
  await this.sqlService.execute('sp_Logout', {
    SessionToken: { type: sql.UniqueIdentifier, value: token },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend-core && npx jest src/auth/auth.service.spec.ts -t logout`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

Replace the existing `logout clears the cookie` test in `auth.controller.spec.ts` with:

```ts
it('logout invalidates the session and clears the cookie', async () => {
  authService.logout = jest.fn().mockResolvedValue(undefined);
  const res = mockResponse();
  const req = { cookies: { session_token: 'tok-123' } } as unknown as import('express').Request;

  const result = await controller.logout(req, res);

  expect(authService.logout).toHaveBeenCalledWith('tok-123');
  expect(res.clearCookie).toHaveBeenCalledWith('session_token');
  expect(result).toEqual({ success: true });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/auth.controller.spec.ts -t logout`
Expected: FAIL — controller.logout takes different args.

- [ ] **Step 7: Update the controller**

In `auth.controller.ts`, update imports and the logout handler:

```ts
import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
```

```ts
@Post('logout')
async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const token = req.cookies?.session_token ?? null;
  await this.authService.logout(token);
  res.clearCookie('session_token');
  return { success: true };
}
```

- [ ] **Step 8: Run the full auth suite**

Run: `cd backend-core && npx jest src/auth`
Expected: PASS (all).

- [ ] **Step 9: Commit**

```bash
cd backend-core
git add src/auth/auth.service.ts src/auth/auth.controller.ts src/auth/auth.service.spec.ts src/auth/auth.controller.spec.ts
git commit -m "feat(auth): invalidate session server-side on logout via sp_Logout"
```

---

## Task 3: OAuth dependencies + OAuthProfile interface

**Files:**
- Modify: `backend-core/package.json` (via npm)
- Create: `backend-core/src/auth/oauth/oauth-profile.interface.ts`

**Interfaces:**
- Produces: `OAuthProfile` interface used by every strategy and by `AuthService.oauthLogin`.

- [ ] **Step 1: Install dependencies**

```bash
cd backend-core
npm install @nestjs/passport passport passport-google-oauth20 passport-github2
npm install -D @types/passport-google-oauth20 @types/passport-github2
```

- [ ] **Step 2: Create the profile interface**

Create `src/auth/oauth/oauth-profile.interface.ts`:

```ts
export interface OAuthProfile {
  provider: 'google' | 'github';
  providerAccountId: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend-core && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd backend-core
git add package.json package-lock.json src/auth/oauth/oauth-profile.interface.ts
git commit -m "chore(auth): add passport deps and OAuthProfile interface"
```

---

## Task 4: SignedStateStore (CSRF state in an HMAC-signed cookie)

**Files:**
- Create: `backend-core/src/auth/oauth/signed-state.store.ts`
- Test: `backend-core/src/auth/oauth/signed-state.store.spec.ts`

**Interfaces:**
- Consumes: `AUTH_SECRET` env var, `req.res` (Express response) for setting the cookie, `cookie-parser` populated `req.cookies`.
- Produces: `SignedStateStore` implementing `store(req, meta, cb)` and `verify(req, providedState, meta, cb)` as expected by `passport-oauth2`. Constructor: `new SignedStateStore(secret: string)`.

- [ ] **Step 1: Write the failing test**

Create `src/auth/oauth/signed-state.store.spec.ts`:

```ts
import { SignedStateStore } from './signed-state.store';

function fakeReqRes() {
  const cookies: Record<string, string> = {};
  const req: any = {
    cookies,
    res: {
      cookie: (name: string, value: string) => { cookies[name] = value; },
      clearCookie: (name: string) => { delete cookies[name]; },
    },
  };
  return req;
}

describe('SignedStateStore', () => {
  it('stores a signed state and verifies it back', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.store(req, {}, (storeErr: Error | null, state?: string) => {
      expect(storeErr).toBeNull();
      expect(typeof state).toBe('string');

      store.verify(req, state as string, {}, (verifyErr: Error | null, ok?: boolean) => {
        expect(verifyErr).toBeNull();
        expect(ok).toBe(true);
        done();
      });
    });
  });

  it('rejects a tampered state', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.store(req, {}, (_e: Error | null, state?: string) => {
      store.verify(req, (state as string) + 'x', {}, (verifyErr: Error | null, ok?: boolean) => {
        expect(ok).toBe(false);
        done();
      });
    });
  });

  it('rejects when no state cookie is present', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.verify(req, 'anything', {}, (_e: Error | null, ok?: boolean) => {
      expect(ok).toBe(false);
      done();
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/oauth/signed-state.store.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/auth/oauth/signed-state.store.ts`:

```ts
import * as crypto from 'crypto';
import type { Request } from 'express';

const COOKIE = 'oauth_state';
const MAX_AGE_MS = 10 * 60 * 1000;

type Cb = (err: Error | null, ok?: boolean | string) => void;

/**
 * State store for passport-oauth2 that keeps the CSRF nonce in an
 * HMAC-signed, httpOnly cookie instead of express-session. No server-side
 * state, survives container restarts.
 */
export class SignedStateStore {
  constructor(private readonly secret: string) {}

  private sign(nonce: string): string {
    return crypto.createHmac('sha256', this.secret).update(nonce).digest('hex');
  }

  store(req: Request, _meta: unknown, cb: Cb): void {
    const nonce = crypto.randomBytes(16).toString('hex');
    const value = `${nonce}.${this.sign(nonce)}`;
    req.res?.cookie(COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: MAX_AGE_MS,
    });
    cb(null, nonce);
  }

  verify(req: Request, providedState: string, _meta: unknown, cb: Cb): void {
    const cookie = req.cookies?.[COOKIE];
    req.res?.clearCookie(COOKIE);

    if (!cookie || !providedState) return cb(null, false);

    const [nonce, mac] = cookie.split('.');
    if (!nonce || !mac) return cb(null, false);

    const expected = this.sign(nonce);
    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);

    const valid =
      macBuf.length === expBuf.length &&
      crypto.timingSafeEqual(macBuf, expBuf) &&
      nonce === providedState;

    cb(null, valid);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend-core && npx jest src/auth/oauth/signed-state.store.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd backend-core
git add src/auth/oauth/signed-state.store.ts src/auth/oauth/signed-state.store.spec.ts
git commit -m "feat(auth): HMAC-signed cookie state store for OAuth CSRF"
```

---

## Task 5: GoogleStrategy

**Files:**
- Create: `backend-core/src/auth/strategies/google.strategy.ts`
- Test: `backend-core/src/auth/strategies/google.strategy.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `PUBLIC_BASE_URL`, `AUTH_SECRET`), `SignedStateStore`, `OAuthProfile`.
- Produces: `GoogleStrategy` (Passport strategy name `'google'`). `validate()` returns `OAuthProfile`.

- [ ] **Step 1: Write the failing test**

Create `src/auth/strategies/google.strategy.spec.ts`:

```ts
import { GoogleStrategy } from './google.strategy';
import { ConfigService } from '@nestjs/config';

function config(): ConfigService {
  return {
    getOrThrow: (k: string) => `val-${k}`,
    get: (k: string) => `val-${k}`,
  } as unknown as ConfigService;
}

describe('GoogleStrategy.validate', () => {
  it('normalizes a verified Google profile to OAuthProfile', async () => {
    const strategy = new GoogleStrategy(config());
    const done = jest.fn();

    await strategy.validate('access', 'refresh', {
      id: '12345',
      displayName: 'Ada Lovelace',
      emails: [{ value: 'ada@gmail.com' }],
      _json: { email_verified: true },
    } as any, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerAccountId: '12345',
      email: 'ada@gmail.com',
      name: 'Ada Lovelace',
      emailVerified: true,
    });
  });

  it('marks emailVerified false when Google says so', async () => {
    const strategy = new GoogleStrategy(config());
    const done = jest.fn();

    await strategy.validate('a', 'r', {
      id: '1', displayName: 'X', emails: [{ value: 'x@gmail.com' }],
      _json: { email_verified: false },
    } as any, done);

    expect(done.mock.calls[0][1].emailVerified).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/strategies/google.strategy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the strategy**

Create `src/auth/strategies/google.strategy.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import { OAuthProfile } from '../oauth/oauth-profile.interface';
import { SignedStateStore } from '../oauth/signed-state.store';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('AUTH_GOOGLE_ID'),
      clientSecret: config.getOrThrow<string>('AUTH_GOOGLE_SECRET'),
      callbackURL: `${config.getOrThrow<string>('PUBLIC_BASE_URL')}/api/auth/google/callback`,
      scope: ['profile', 'email'],
      store: new SignedStateStore(config.getOrThrow<string>('AUTH_SECRET')),
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const oauth: OAuthProfile = {
      provider: 'google',
      providerAccountId: profile.id,
      email: profile.emails?.[0]?.value ?? null,
      name: profile.displayName ?? '',
      emailVerified: (profile._json as { email_verified?: boolean }).email_verified === true,
    };
    done(null, oauth as unknown as Express.User);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend-core && npx jest src/auth/strategies/google.strategy.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd backend-core
git add src/auth/strategies/google.strategy.ts src/auth/strategies/google.strategy.spec.ts
git commit -m "feat(auth): Google OAuth strategy normalizing to OAuthProfile"
```

---

## Task 6: GitHubStrategy (with verified-email lookup)

**Files:**
- Create: `backend-core/src/auth/strategies/github.strategy.ts`
- Test: `backend-core/src/auth/strategies/github.strategy.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `PUBLIC_BASE_URL`, `AUTH_SECRET`), `SignedStateStore`, `OAuthProfile`, global `fetch`.
- Produces: `GitHubStrategy` (Passport strategy name `'github'`). `validate()` returns `OAuthProfile`, resolving the primary verified email via the GitHub API.

- [ ] **Step 1: Write the failing test**

Create `src/auth/strategies/github.strategy.spec.ts`:

```ts
import { GitHubStrategy } from './github.strategy';
import { ConfigService } from '@nestjs/config';

function config(): ConfigService {
  return { getOrThrow: (k: string) => `val-${k}`, get: (k: string) => `val-${k}` } as unknown as ConfigService;
}

describe('GitHubStrategy.validate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves the primary verified email from the GitHub API', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { email: 'secondary@x.com', primary: false, verified: true },
        { email: 'ada@github.com', primary: true, verified: true },
      ],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('access-token', 'refresh', {
      id: '99', username: 'ada', displayName: 'Ada L',
    } as any, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'github',
      providerAccountId: '99',
      email: 'ada@github.com',
      name: 'Ada L',
      emailVerified: true,
    });
  });

  it('reports emailVerified false when the primary email is unverified', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ email: 'ada@github.com', primary: true, verified: false }],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '99', username: 'ada', displayName: 'Ada L' } as any, done);

    const arg = done.mock.calls[0][1];
    expect(arg.emailVerified).toBe(false);
  });

  it('falls back to username when displayName is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => [{ email: 'a@b.com', primary: true, verified: true }],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '1', username: 'ada', displayName: null } as any, done);

    expect(done.mock.calls[0][1].name).toBe('ada');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/strategies/github.strategy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the strategy**

Create `src/auth/strategies/github.strategy.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { OAuthProfile } from '../oauth/oauth-profile.interface';
import { SignedStateStore } from '../oauth/signed-state.store';

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubProfile {
  id: string;
  username?: string;
  displayName?: string | null;
}

type Done = (err: Error | null, user?: Express.User) => void;

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('AUTH_GITHUB_ID'),
      clientSecret: config.getOrThrow<string>('AUTH_GITHUB_SECRET'),
      callbackURL: `${config.getOrThrow<string>('PUBLIC_BASE_URL')}/api/auth/github/callback`,
      scope: ['user:email'],
      store: new SignedStateStore(config.getOrThrow<string>('AUTH_SECRET')),
    });
  }

  async validate(
    accessToken: string,
    _refreshToken: string,
    profile: GitHubProfile,
    done: Done,
  ): Promise<void> {
    // GitHub does not include verification in the profile; ask the API.
    let email: string | null = null;
    let emailVerified = false;

    const res = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'big-o-backend',
      },
    });

    if (res.ok) {
      const emails = (await res.json()) as GitHubEmail[];
      const primary = emails.find((e) => e.primary) ?? emails[0];
      if (primary) {
        email = primary.email;
        emailVerified = primary.verified === true;
      }
    }

    const oauth: OAuthProfile = {
      provider: 'github',
      providerAccountId: String(profile.id),
      email,
      name: profile.displayName || profile.username || '',
      emailVerified,
    };
    done(null, oauth as unknown as Express.User);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend-core && npx jest src/auth/strategies/github.strategy.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd backend-core
git add src/auth/strategies/github.strategy.ts src/auth/strategies/github.strategy.spec.ts
git commit -m "feat(auth): GitHub OAuth strategy with verified-email lookup"
```

---

## Task 7: AuthService.oauthLogin

**Files:**
- Modify: `backend-core/src/auth/auth.service.ts`
- Test: `backend-core/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `SqlService.execute`, `sp_OAuthLogin` (Task 1), `OAuthProfile` (Task 3).
- Produces: `AuthService.oauthLogin(profile: OAuthProfile): Promise<LoginResult>` (`LoginResult` already exported from `auth.service.ts`).

- [ ] **Step 1: Write the failing test**

Add to `auth.service.spec.ts` (add the import at top: `import { OAuthProfile } from './oauth/oauth-profile.interface';`):

```ts
it('calls sp_OAuthLogin with the normalized profile', async () => {
  sqlService.execute.mockResolvedValue([
    { Success: true, Message: 'OK', UserId: 5, SessionToken: 'tok', Name: 'Ada', Email: 'ada@x.com' },
  ]);
  const profile: OAuthProfile = {
    provider: 'google', providerAccountId: 'g-1', email: 'ada@x.com', name: 'Ada', emailVerified: true,
  };

  const result = await service.oauthLogin(profile);

  expect(sqlService.execute).toHaveBeenCalledWith(
    'sp_OAuthLogin',
    expect.objectContaining({
      Provider: expect.objectContaining({ value: 'google' }),
      ProviderAccountId: expect.objectContaining({ value: 'g-1' }),
      Email: expect.objectContaining({ value: 'ada@x.com' }),
      Name: expect.objectContaining({ value: 'Ada' }),
      EmailVerified: expect.objectContaining({ value: true }),
    }),
  );
  expect(result.SessionToken).toBe('tok');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/auth.service.spec.ts -t sp_OAuthLogin`
Expected: FAIL — `service.oauthLogin is not a function`.

- [ ] **Step 3: Implement `oauthLogin`**

Add the import at the top of `auth.service.ts`:

```ts
import { OAuthProfile } from './oauth/oauth-profile.interface';
```

Add the method to `AuthService`:

```ts
async oauthLogin(profile: OAuthProfile): Promise<LoginResult> {
  const [row] = await this.sqlService.execute<LoginResult>('sp_OAuthLogin', {
    Provider: { type: sql.NVarChar, value: profile.provider },
    ProviderAccountId: { type: sql.NVarChar, value: profile.providerAccountId },
    Email: { type: sql.NVarChar, value: profile.email },
    Name: { type: sql.NVarChar, value: profile.name },
    EmailVerified: { type: sql.Bit, value: profile.emailVerified },
  });
  return row;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend-core && npx jest src/auth/auth.service.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
cd backend-core
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): oauthLogin relaying to sp_OAuthLogin"
```

---

## Task 8: OAuth routes + module wiring

**Files:**
- Modify: `backend-core/src/auth/auth.controller.ts`
- Modify: `backend-core/src/auth/auth.module.ts`
- Modify: `backend-core/src/app.module.ts` (ensure `ConfigModule` is global — verify only)
- Test: `backend-core/src/auth/auth.controller.spec.ts`

**Interfaces:**
- Consumes: `AuthService.oauthLogin` (Task 7), `GoogleStrategy` (Task 5), `GitHubStrategy` (Task 6), `OAuthProfile`.
- Produces: routes `GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/github`, `GET /api/auth/github/callback`. Private `finishOAuth(profile, res)` redirects to the dashboard on success or to `/views/login.html?error=…` on failure.

- [ ] **Step 1: Write the failing controller test**

Add to `auth.controller.spec.ts`. Extend the `authService` mock to include `oauthLogin`, and add a redirect-capable response mock:

```ts
function redirectResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as unknown as import('express').Response;
}

describe('AuthController OAuth callback', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock; logout: jest.Mock; oauthLogin: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn(), logout: jest.fn(), oauthLogin: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('sets the cookie and redirects to the dashboard on success', async () => {
    authService.oauthLogin.mockResolvedValue({
      Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'A', Email: 'a@x.com',
    });
    const res = redirectResponse();
    const req = { user: { provider: 'google', providerAccountId: 'g1', email: 'a@x.com', name: 'A', emailVerified: true } } as any;

    await controller.googleCallback(req, res);

    expect(res.cookie).toHaveBeenCalledWith('session_token', 'tok', expect.objectContaining({ httpOnly: true }));
    expect(res.redirect).toHaveBeenCalledWith('/views/dashboard.html');
  });

  it('redirects to login with an error when the SP rejects', async () => {
    authService.oauthLogin.mockResolvedValue({
      Success: false, Message: 'Email no verificado por el proveedor', UserId: null, SessionToken: null, Name: null, Email: null,
    });
    const res = redirectResponse();
    const req = { user: { provider: 'github', providerAccountId: 'h1', email: null, name: 'A', emailVerified: false } } as any;

    await controller.githubCallback(req, res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/views/login.html?error=oauth_email_not_verified');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend-core && npx jest src/auth/auth.controller.spec.ts -t OAuth`
Expected: FAIL — `controller.googleCallback is not a function`.

- [ ] **Step 3: Add the routes and `finishOAuth`**

Update `auth.controller.ts` imports:

```ts
import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { OAuthProfile } from './oauth/oauth-profile.interface';
```

Add inside the class:

```ts
@Get('google')
@UseGuards(AuthGuard('google'))
googleStart(): void {}

@Get('google/callback')
@UseGuards(AuthGuard('google'))
async googleCallback(@Req() req: Request, @Res() res: Response) {
  return this.finishOAuth(req.user as unknown as OAuthProfile, res);
}

@Get('github')
@UseGuards(AuthGuard('github'))
githubStart(): void {}

@Get('github/callback')
@UseGuards(AuthGuard('github'))
async githubCallback(@Req() req: Request, @Res() res: Response) {
  return this.finishOAuth(req.user as unknown as OAuthProfile, res);
}

private async finishOAuth(profile: OAuthProfile, res: Response): Promise<void> {
  const result = await this.authService.oauthLogin(profile);

  if (!result?.Success) {
    const code =
      result?.Message?.includes('verificado') ? 'oauth_email_not_verified' : 'oauth_failed';
    res.redirect(`/views/login.html?error=${code}`);
    return;
  }

  res.cookie('session_token', result.SessionToken as string, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  res.redirect('/views/dashboard.html');
}
```

- [ ] **Step 4: Register strategies + PassportModule in the auth module**

Replace `auth.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { GitHubStrategy } from './strategies/github.strategy';

@Module({
  imports: [PassportModule.register({ session: false })],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, GitHubStrategy],
})
export class AuthModule {}
```

- [ ] **Step 5: Verify ConfigModule is global**

Open `src/app.module.ts` and confirm `ConfigModule.forRoot({ isGlobal: true })` (or equivalent) is present so strategies can inject `ConfigService`. If `isGlobal` is missing, add it. Do not change anything else.

- [ ] **Step 6: Run to verify tests pass and it builds**

Run: `cd backend-core && npx jest src/auth/auth.controller.spec.ts && npm run build`
Expected: PASS, then build exit 0.

- [ ] **Step 7: Run the whole backend suite**

Run: `cd backend-core && npm test`
Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
cd backend-core
git add src/auth/auth.controller.ts src/auth/auth.module.ts src/app.module.ts src/auth/auth.controller.spec.ts
git commit -m "feat(auth): Google/GitHub OAuth routes wired to sp_OAuthLogin"
```

---

## Task 9: Frontend — real login/register via fetch

**Files:**
- Modify: `frontend-landing/js/login.js`
- Modify: `frontend-landing/js/register.js`
- Test: `frontend-landing/tests/login.spec.ts`, `frontend-landing/tests/register.spec.ts`

**Interfaces:**
- Consumes: `POST /api/auth/login` `{ email, password }`, `POST /api/auth/register` `{ name, email, password }`. Success responses have `Success: true`; login returns `{ Success, SessionToken, ... }`, register returns `{ Success, Message, UserId }`.
- Produces: real network submission replacing the `SIMULACIÓN` blocks; error messages surfaced in `#form-message`.

- [ ] **Step 1: Update the login test to assert real fetch**

In `tests/login.spec.ts`, replace the `Flujo simulado con datos válidos` describe block with:

```ts
test.describe('Login real contra el backend (mockeado)', () => {
  test('login correcto guarda sesión y va al dashboard', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@x.com' }) }),
    );
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ Success: true, UserId: 1, Name: 'Ada', Email: 'ada@x.com' }) }),
    );

    await page.goto('/views/login.html');
    await page.fill('#email', 'ada@x.com');
    await page.fill('#password', 'secret123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/views\/dashboard\.html$/, { timeout: 8000 });
  });

  test('login inválido muestra el mensaje del backend y no redirige', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid credentials', statusCode: 401 }) }),
    );

    await page.goto('/views/login.html');
    await page.fill('#email', 'ada@x.com');
    await page.fill('#password', 'wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('#form-message')).toBeVisible();
    await expect(page).toHaveURL(/\/views\/login\.html$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend-landing && npx playwright test tests/login.spec.ts -g "Login real"`
Expected: FAIL — the mock still redirects without calling the route / no backend message.

- [ ] **Step 3: Replace the SIMULACIÓN block in `login.js`**

In `js/login.js`, replace the block between `----- SIMULACIÓN` and `----- FIN SIMULACIÓN` with:

```js
        const btn = form.querySelector('button[type="submit"]');
        btn.innerHTML = `<span class="material-symbols-outlined animate-spin">sync</span> <span class="font-label-xs text-label-xs uppercase tracking-widest">Verifying...</span>`;
        btn.disabled = true;

        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password }),
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.Success) {
                    const msg = res.status === 401 ? 'Correo o contraseña incorrectos.' : (data.message || 'No se pudo iniciar sesión.');
                    throw new Error(msg);
                }
                window.location.href = '/views/dashboard.html';
            })
            .catch((err) => {
                showMessage(err.message);
                btn.disabled = false;
                btn.innerHTML = `<span class="font-label-xs text-label-xs uppercase tracking-widest">Sign In</span> <span class="material-symbols-outlined text-[20px]">login</span>`;
            });
```

- [ ] **Step 4: Replace the SIMULACIÓN block in `register.js`**

In `js/register.js`, replace the block between `----- SIMULACIÓN` and `----- FIN SIMULACIÓN` with:

```js
            fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name, email, password }),
            })
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || !data.Success) {
                        throw new Error(data.Message || data.message || 'No se pudo crear la cuenta.');
                    }
                    // El registro no inicia sesión; enviar al login.
                    window.location.href = '/views/login.html';
                })
                .catch((err) => showMessage(err.message));
```

- [ ] **Step 5: Add a register test for the backend error path**

In `tests/register.spec.ts`, replace the `datos válidos redirigen al dashboard` test with:

```ts
  test('registro correcto envía al login', async ({ page }) => {
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ Success: true, Message: 'Registered', UserId: 7 }) }),
    );
    await page.goto('/views/register.html');
    await page.fill('#name', 'Linus Torvalds');
    await page.fill('#email', 'dev@big-o.systems');
    await page.fill('#password', 'secret123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/views\/login\.html$/, { timeout: 8000 });
  });

  test('email ya registrado muestra el mensaje del backend', async ({ page }) => {
    await page.route('**/api/auth/register', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ Success: false, Message: 'Email already registered', UserId: null }) }),
    );
    await page.goto('/views/register.html');
    await page.fill('#name', 'Linus Torvalds');
    await page.fill('#email', 'dev@big-o.systems');
    await page.fill('#password', 'secret123');
    await page.click('button[type="submit"]');
    await expect(page.locator('#form-message')).toContainText(/already registered/i);
    await expect(page).toHaveURL(/\/views\/register\.html$/);
  });
```

- [ ] **Step 6: Run the frontend suite**

Run: `cd frontend-landing && npx playwright test tests/login.spec.ts tests/register.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd frontend-landing
git add js/login.js js/register.js tests/login.spec.ts tests/register.spec.ts
git commit -m "feat: submit login/register to the live backend instead of the mock"
```

---

## Task 10: Frontend — dashboard session guard + real logout

**Files:**
- Modify: `frontend-landing/js/dashboard.js`
- Create: `frontend-landing/tests/dashboard.spec.ts`

**Interfaces:**
- Consumes: `GET /api/me` (200 `{ Success: true, ... }` when authenticated, 401 otherwise), `POST /api/auth/logout`.
- Produces: redirect to `/views/login.html` when `/api/me` is not authenticated; logout hits the backend before redirecting.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Guard de sesión del dashboard', () => {
  test('sin sesión redirige a login', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized', statusCode: 401 }) }),
    );
    await page.goto('/views/dashboard.html');
    await expect(page).toHaveURL(/\/views\/login\.html$/, { timeout: 8000 });
  });

  test('con sesión permanece en el dashboard', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ Success: true, UserId: 1, Name: 'Ada', Email: 'ada@x.com' }) }),
    );
    await page.goto('/views/dashboard.html');
    await expect(page).toHaveURL(/\/views\/dashboard\.html$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('logout llama al backend y vuelve a login', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ Success: true, UserId: 1, Name: 'Ada', Email: 'ada@x.com' }) }),
    );
    let logoutCalled = false;
    await page.route('**/api/auth/logout', (route) => {
      logoutCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.goto('/views/dashboard.html');
    await page.click('[data-nav="logout"]');
    await expect(page).toHaveURL(/\/views\/login\.html$/);
    expect(logoutCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend-landing && npx playwright test tests/dashboard.spec.ts`
Expected: FAIL — no guard; page stays without session, logout does not call backend.

- [ ] **Step 3: Add the guard and real logout to `dashboard.js`**

At the TOP of `js/dashboard.js` (before the visual code), add the guard, and replace the logout handler:

```js
// Guard de sesión: sin sesión válida, fuera del dashboard.
fetch('/api/me', { credentials: 'include' })
    .then((res) => {
        if (!res.ok) window.location.href = '/views/login.html';
    })
    .catch(() => { window.location.href = '/views/login.html'; });
```

Replace the existing logout block:

```js
// Navigation: logout invalida la sesión en el backend y vuelve al login.
document.querySelectorAll('[data-nav="logout"]').forEach(btn => {
    btn.addEventListener('click', () => {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
            .catch(() => {})
            .finally(() => { window.location.href = '/views/login.html'; });
    });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend-landing && npx playwright test tests/dashboard.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd frontend-landing
git add js/dashboard.js tests/dashboard.spec.ts
git commit -m "feat: guard the dashboard against /api/me and invalidate session on logout"
```

---

## Task 11: Frontend — OAuth buttons become real links

**Files:**
- Modify: `frontend-landing/views/login.html`
- Modify: `frontend-landing/views/register.html`
- Modify: `frontend-landing/js/login.js`, `frontend-landing/js/register.js` (remove the "disponible pronto" handler)
- Modify: `frontend-landing/tests/login.spec.ts`

**Interfaces:**
- Consumes: `GET /api/auth/google`, `GET /api/auth/github` (browser navigation, not fetch).
- Produces: the OAuth buttons are anchors that navigate to the backend start routes.

- [ ] **Step 1: Update the OAuth test**

In `tests/login.spec.ts`, replace the `Botones OAuth (aún sin backend)` describe block with:

```ts
test.describe('Botones OAuth', () => {
  test('Google apunta al backend', async ({ page }) => {
    await page.goto('/views/login.html');
    await expect(page.locator('#oauth-google')).toHaveAttribute('href', '/api/auth/google');
  });
  test('GitHub apunta al backend', async ({ page }) => {
    await page.goto('/views/login.html');
    await expect(page.locator('#oauth-github')).toHaveAttribute('href', '/api/auth/github');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend-landing && npx playwright test tests/login.spec.ts -g "Botones OAuth"`
Expected: FAIL — buttons are `<button>`, have no `href`.

- [ ] **Step 3: Convert the login buttons to anchors**

In `views/login.html`, change the GitHub button opening tag from:

```html
          <button
            id="oauth-github"
            type="button"
            data-provider="github"
            class="flex items-center justify-center gap-stack-sm bg-surface-container-lowest border border-outline-variant/30 py-3 rounded-lg font-label-xs text-label-xs text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 transition-all duration-300"
          >
```

to:

```html
          <a
            id="oauth-github"
            href="/api/auth/github"
            class="flex items-center justify-center gap-stack-sm bg-surface-container-lowest border border-outline-variant/30 py-3 rounded-lg font-label-xs text-label-xs text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 transition-all duration-300"
          >
```

and its closing `</button>` to `</a>`. Do the same for the Google button (`id="oauth-google"`, `href="/api/auth/google"`). There are two `</button>` closings for these — match each to its opening anchor.

- [ ] **Step 4: Do the same in `views/register.html`**

Same conversion for both OAuth buttons in `register.html`. Keep the `href` values identical (`/api/auth/github`, `/api/auth/google`) — registration and login start the same OAuth flow.

- [ ] **Step 5: Remove the "disponible pronto" handler**

In `js/login.js` and `js/register.js`, delete the block:

```js
    // Botones OAuth: todavía sin backend. Feedback honesto en vez de un clic muerto.
    document.querySelectorAll('[data-provider]').forEach(btn => {
        btn.addEventListener('click', () => {
            const provider = btn.dataset.provider === 'github' ? 'GitHub' : 'Google';
            showMessage(`El acceso con ${provider} estará disponible pronto.`, false);
        });
    });
```

(register.js uses the word "registro" — remove that variant there.)

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd frontend-landing && npx playwright test`
Expected: PASS (all). The old "disponible pronto" tests were replaced in Step 1.

- [ ] **Step 7: Commit**

```bash
cd frontend-landing
git add views/login.html views/register.html js/login.js js/register.js tests/login.spec.ts
git commit -m "feat: wire OAuth buttons to the backend start routes"
```

---

## Task 12: Config, deploy, and live verification

**Files:**
- Modify: `backend-core/.env.example`
- Modify: `backend-core/.github/workflows/deploy.yml` (add `PUBLIC_BASE_URL`)

**Interfaces:**
- Consumes: everything above.
- Produces: a deployable, configured system. Manual provider/DB steps are documented here.

- [ ] **Step 1: Add new env vars to `.env.example`**

Append to `backend-core/.env.example`:

```
# Auth / OAuth
AUTH_SECRET=generate-with-openssl-rand-base64-32
PUBLIC_BASE_URL=https://big-o.andrescortes.dev
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
```

- [ ] **Step 2: Pass `PUBLIC_BASE_URL` in the deploy workflow**

In `.github/workflows/deploy.yml`, inside the `docker run` env flags, add after the `AUTH_SECRET` line:

```yaml
              -e PUBLIC_BASE_URL="${{ vars.PUBLIC_BASE_URL || 'https://big-o.andrescortes.dev' }}" \
```

- [ ] **Step 3: Commit config**

```bash
cd backend-core
git add .env.example .github/workflows/deploy.yml
git commit -m "chore(auth): document OAuth env vars and pass PUBLIC_BASE_URL in deploy"
```

- [ ] **Step 4: MANUAL — run the SQL migration**

Run `scripts/sql/002-oauth.sql` against the production SQL Server (SSMS, `sqlcmd`, or Azure Data Studio). Verify:

```sql
SELECT name FROM sys.tables WHERE name = 'UserOAuthAccounts';           -- 1 row
SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordHash'; -- 1
SELECT name FROM sys.procedures WHERE name IN ('sp_OAuthLogin','sp_Logout'); -- 2 rows
```

- [ ] **Step 5: MANUAL — register OAuth callback URLs**

- Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs: add
  `https://big-o.andrescortes.dev/api/auth/google/callback`.
- GitHub → Settings → Developer settings → OAuth Apps → the app → Authorization callback URL:
  `https://big-o.andrescortes.dev/api/auth/github/callback`.
- Confirm org GitHub secrets exist: `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_GITHUB_ID/SECRET`.

- [ ] **Step 6: Push both repos to deploy**

```bash
cd backend-core && git push origin main
cd ../frontend-landing && git push origin main
```

Watch: `gh run watch <run-id> --exit-status` in each repo.

- [ ] **Step 7: MANUAL — verify live**

```bash
# OAuth start should now 302 to the provider, not 404.
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://big-o.andrescortes.dev/api/auth/google"
# Expect: 302 https://accounts.google.com/o/oauth2/v2/auth?...

curl -s -o /dev/null -w "%{http_code}\n" "https://big-o.andrescortes.dev/api/auth/github"
# Expect: 302
```

Then in a browser: open the landing → login → click Google, complete consent, land on the dashboard. Click logout, confirm return to login and that reopening the dashboard redirects to login (session gone).

- [ ] **Step 8: Final commit (if any docs/notes changed)**

No code change expected here; the manual steps are operational. If you kept a runbook, commit it.

---

## Self-Review notes

- **Spec coverage:** every spec section maps to a task — DB changes (T1), real logout (T2), deps+interface (T3), state store (T4), Google (T5), GitHub incl. verified-email lookup (T6), oauthLogin (T7), routes+wiring+error-redirect (T8), frontend real login/register (T9), dashboard guard+logout (T10), OAuth buttons (T11), config/deploy/manual provider steps + CORS unchanged (T12).
- **sp_Login fix** (nullable-hash vulnerability) is in T1, delivered together with making the columns nullable — they must ship together or the vulnerability opens.
- **Type consistency:** `OAuthProfile` fields identical across T3/T5/T6/T7/T8; `sp_OAuthLogin` recordset matches `LoginResult`; cookie name `session_token` and options identical in T2/T8.
- **Out of scope (unchanged):** provider unlink, linking a second provider from the dashboard, refresh tokens, password reset.
