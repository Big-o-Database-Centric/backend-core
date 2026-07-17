# NestJS Database-Centric Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing Next.js + NextAuth (OAuth) `backend-core` with a NestJS backend that exposes 6 HTTP endpoints, each executing exactly one SQL Server stored procedure and returning its recordset, with zero business logic in the backend.

**Architecture:** A single global `DatabaseModule` owns one shared `mssql` `ConnectionPool` and exposes a generic `SqlService.execute(spName, params)` that is the only code path allowed to talk to SQL Server (parametrized `.input()` calls, never string concatenation). Three feature modules (`AuthModule`, `StatsModule`, `UserModule`) each wrap one or more stored procedures behind a thin controller/service pair. Session state is a `session_token` httpOnly cookie whose value is opaquely forwarded to whichever SP needs it — the backend never inspects or validates it itself.

**Tech Stack:** NestJS 10 (Express platform), `mssql` (already a proven dependency in this repo), `@nestjs/config`, `cookie-parser`, `class-validator`/`class-transformer` for input-shape checks, Jest for unit tests.

**Reference spec:** `docs/superpowers/specs/2026-07-16-nestjs-database-centric-backend-design.md`

## Global Constraints

- Env vars (exact names, from spec): `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `SQL_PORT`.
- One shared connection pool for the whole app — never open a pool per request.
- **Never concatenate SQL.** Every parameter goes through `request.input(name, type, value)`. `SqlService.execute` is the only place that touches `mssql` directly.
- Each of the 5 spec endpoints executes exactly one stored procedure and returns its recordset. No business-rule branching in TypeScript (e.g. no "if email exists" checks in the backend — that's the SP's job).
- HTTP codes: `200` ok, `400` missing/malformed input (basic type/presence check only), `401` the SP indicates "not authenticated" (login failure, or `/api/me` / `/api/my-databases` with an invalid/missing session), `500` DB/connection error.
- CORS: `origin: 'https://big-o.andrescortes.dev'`, `credentials: true` (required — session travels as an httpOnly cookie cross-origin).
- No ORM with domain entities, no ORM at all beyond the raw `mssql` pool. No ACL/roles/guards in Nest — the SP decides everything auth-related.
- `package.json` must list `mssql`, `cors`, `dotenv` as explicit dependencies (per spec deliverables), even where a framework dependency would transitively cover the same behavior.

---

## File Structure

```
backend-core/
├── package.json                     (rewrite — NestJS deps)
├── tsconfig.json                    (rewrite — Nest defaults)
├── tsconfig.build.json              (new)
├── nest-cli.json                    (new)
├── .env.example                     (rewrite)
├── Dockerfile                       (new)
├── .dockerignore                    (new)
├── README.md                        (rewrite)
├── HANDOFF.md                       (delete — OAuth handoff doc, obsolete)
├── eslint.config.mjs                (rewrite — plain TS/Nest, no Next.js plugin)
├── scripts/sql/auth.sql             (delete — old OAuth SPs)
├── scripts/sql/schema.sql           (new — tables + 5 SPs)
└── src/
    ├── main.ts                      (new — bootstrap: cookie-parser, CORS, ValidationPipe)
    ├── app.module.ts                (new — root module)
    ├── database/
    │   ├── database.module.ts       (new — global, owns the mssql pool)
    │   ├── sql.service.ts           (new — generic SP executor)
    │   └── sql.service.spec.ts      (new)
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts
    │   ├── auth.controller.spec.ts
    │   ├── auth.service.ts
    │   ├── auth.service.spec.ts
    │   └── dto/
    │       ├── register.dto.ts
    │       ├── login.dto.ts
    │       └── dto.spec.ts
    ├── stats/
    │   ├── stats.module.ts
    │   ├── stats.controller.ts
    │   ├── stats.controller.spec.ts
    │   └── stats.service.ts
    └── user/
        ├── user.module.ts
        ├── user.controller.ts
        ├── user.controller.spec.ts
        └── user.service.ts

(everything under src/app, src/config, src/db, src/domain, src/lib, src/repositories,
 src/middleware.ts, next.config.ts is deleted in Task 1)
```

Deleted (Next.js/NextAuth OAuth prototype, entire tree):
- `src/app/**`, `src/config/env.ts`, `src/db/sqlserver.ts`, `src/domain/**`, `src/lib/**`,
  `src/middleware.ts`, `src/repositories/**`, `next.config.ts`.

---

## Task 1: Strip Next.js scaffold, bootstrap bare NestJS app

**Files:**
- Delete: `src/app/`, `src/config/`, `src/db/`, `src/domain/`, `src/lib/`, `src/middleware.ts`, `src/repositories/`, `next.config.ts`
- Create: `package.json` (rewrite), `tsconfig.json` (rewrite), `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs` (rewrite), `src/main.ts`, `src/app.module.ts`
- Test: `src/app.module.spec.ts`

**Interfaces:**
- Produces: `AppModule` (root module later tasks import feature modules into), Nest bootstrap in `src/main.ts` that later tasks extend (CORS/cookie-parser already wired here).

- [ ] **Step 1: Delete the Next.js/NextAuth tree**

```bash
rm -rf src/app src/config src/db src/domain src/lib src/middleware.ts src/repositories next.config.ts
```

- [ ] **Step 2: Replace `package.json`**

```json
{
  "name": "backend-core",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "mssql": "^12.7.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.9",
    "@nestjs/testing": "^10.4.15",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/mssql": "^12.3.0",
    "@types/node": "^20",
    "@eslint/js": "^9.17.0",
    "eslint": "^9",
    "typescript-eslint": "^8.18.0",
    "jest": "^29.7.0",
    "source-map-support": "^0.5.21",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: installs cleanly, `package-lock.json` updated.

- [ ] **Step 4: Replace `tsconfig.json`, add `tsconfig.build.json` and `nest-cli.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": false,
    "esModuleInterop": true,
    "moduleResolution": "node"
  }
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

`nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 5: Replace `eslint.config.mjs`**

The existing file wires in `eslint-config-next`, which no longer exists as a dependency
once `package.json` is replaced (Step 2) — running lint would crash on a missing module.
Replace it with a plain TypeScript flat config:

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

This needs `@eslint/js` alongside `typescript-eslint`. Add it to `package.json`
devDependencies from Step 2 (`"@eslint/js": "^9.17.0"`) and re-run `npm install`.

- [ ] **Step 6: Write the failing test for the root module**

`src/app.module.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the root module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
```

- [ ] **Step 7: Run the test, verify it fails**

Run: `npx jest app.module.spec.ts`
Expected: FAIL — `Cannot find module './app.module'`.

- [ ] **Step 8: Create `src/app.module.ts` and `src/main.ts`**

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule {}
```

`src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'https://big-o.andrescortes.dev',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
```

- [ ] **Step 9: Run the test again, verify it passes**

Run: `npx jest app.module.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 10: Verify the project builds and lints**

Run: `npm run build`
Expected: exits 0, `dist/main.js` created.

Run: `npm run lint`
Expected: exits 0 (no errors) against the new `eslint.config.mjs` from Step 5.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: replace Next.js/NextAuth scaffold with bare NestJS app"
```

---

## Task 2: Database module + generic SP executor

**Files:**
- Create: `src/database/database.module.ts`, `src/database/sql.service.ts`, `src/database/sql.service.spec.ts`
- Modify: `src/app.module.ts:1-8` (import `DatabaseModule`)

**Interfaces:**
- Consumes: none beyond `mssql` and `@nestjs/config` (Task 1's `AppModule`/`ConfigModule`).
- Produces: `SqlService.execute<T>(spName: string, params?: Record<string, { type: unknown; value: unknown }>): Promise<T[]>` — every later feature module depends on this exact signature. Injection token for the raw pool: `'MSSQL_POOL'`.

- [ ] **Step 1: Write the failing test for `SqlService`**

`src/database/sql.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import * as sql from 'mssql';
import { SqlService } from './sql.service';

describe('SqlService', () => {
  let service: SqlService;
  let mockRequest: { input: jest.Mock; execute: jest.Mock };
  let mockPool: { request: jest.Mock };

  beforeEach(async () => {
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    mockPool = { request: jest.fn().mockReturnValue(mockRequest) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SqlService, { provide: 'MSSQL_POOL', useValue: mockPool }],
    }).compile();

    service = module.get(SqlService);
  });

  it('parametrizes every input and executes the named stored procedure', async () => {
    mockRequest.execute.mockResolvedValue({ recordset: [{ Success: true }] });

    const result = await service.execute('sp_Login', {
      Email: { type: sql.NVarChar, value: 'a@b.com' },
    });

    expect(mockPool.request).toHaveBeenCalledTimes(1);
    expect(mockRequest.input).toHaveBeenCalledWith('Email', sql.NVarChar, 'a@b.com');
    expect(mockRequest.execute).toHaveBeenCalledWith('sp_Login');
    expect(result).toEqual([{ Success: true }]);
  });

  it('returns an empty array when the SP returns no rows', async () => {
    mockRequest.execute.mockResolvedValue({ recordset: undefined });

    const result = await service.execute('sp_GetPlatformStats');

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest sql.service.spec.ts`
Expected: FAIL — `Cannot find module './sql.service'`.

- [ ] **Step 3: Implement `SqlService`**

`src/database/sql.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import * as sql from 'mssql';

export interface SqlParam {
  type: unknown;
  value: unknown;
}

@Injectable()
export class SqlService {
  constructor(@Inject('MSSQL_POOL') private readonly pool: sql.ConnectionPool) {}

  async execute<T = Record<string, unknown>>(
    spName: string,
    params: Record<string, SqlParam> = {},
  ): Promise<T[]> {
    const request = this.pool.request();

    for (const [name, { type, value }] of Object.entries(params)) {
      request.input(name, type as sql.ISqlType, value);
    }

    const result = await request.execute(spName);
    return (result.recordset ?? []) as T[];
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest sql.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `DatabaseModule` and wire it into `AppModule`**

`src/database/database.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { SqlService } from './sql.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'MSSQL_POOL',
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<sql.ConnectionPool> => {
        const pool = new sql.ConnectionPool({
          server: config.getOrThrow<string>('SQL_SERVER'),
          database: config.getOrThrow<string>('SQL_DATABASE'),
          user: config.getOrThrow<string>('SQL_USER'),
          password: config.getOrThrow<string>('SQL_PASSWORD'),
          port: Number(config.get('SQL_PORT', '1433')),
          options: {
            encrypt: config.get('SQL_SERVER_ENCRYPT', 'true') === 'true',
            trustServerCertificate:
              config.get('SQL_SERVER_TRUST_SERVER_CERT', 'false') === 'true',
          },
        });
        return pool.connect();
      },
    },
    SqlService,
  ],
  exports: [SqlService],
})
export class DatabaseModule {}
```

Modify `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
})
export class AppModule {}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`
Expected: PASS (`app.module.spec.ts` still passes — the pool factory only runs at real bootstrap, not under `Test.createTestingModule` unless `AppModule` is instantiated with a real `ConfigService`; if `app.module.spec.ts` now fails because it tries to connect to a real DB, override the provider in that spec with a mock, matching the pattern below).

If `app.module.spec.ts` fails trying to connect, update it:
```ts
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the root module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('MSSQL_POOL')
      .useValue({ request: () => ({ input: () => {}, execute: async () => ({ recordset: [] }) }) })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
```
Run: `npx jest` again — Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add mssql pool + generic stored-procedure executor"
```

---

## Task 3: SQL schema + stored procedures

**Files:**
- Delete: `scripts/sql/auth.sql`
- Create: `scripts/sql/schema.sql`

**Interfaces:**
- Produces: the 5 stored procedures (`sp_Register`, `sp_Login`, `sp_GetPlatformStats`, `sp_GetUserInfo`, `sp_GetUserDatabases`) and the 3 tables (`Users`, `Sessions`, `UserDatabases`) that Tasks 4–6 call by exact name and parameter list.

No automated test here — there is no SQL Server instance in this dev environment. Verification is manual (run the script against a real SQL Server, documented in Task 8's README).

- [ ] **Step 1: Remove the old OAuth SQL script**

```bash
rm scripts/sql/auth.sql
```

- [ ] **Step 2: Write `scripts/sql/schema.sql`**

```sql
-- ============================================================
-- Big-O Database-Centric Platform — schema + stored procedures
-- Replaces the old OAuth-based scripts/sql/auth.sql.
-- Run once against the target database before starting the API.
-- ============================================================

IF OBJECT_ID('dbo.Sessions', 'U') IS NOT NULL DROP TABLE dbo.Sessions;
IF OBJECT_ID('dbo.UserDatabases', 'U') IS NOT NULL DROP TABLE dbo.UserDatabases;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;
GO

CREATE TABLE dbo.Users (
    UserId       INT IDENTITY(1,1) PRIMARY KEY,
    Name         NVARCHAR(100)    NOT NULL,
    Email        NVARCHAR(256)    NOT NULL UNIQUE,
    PasswordSalt UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    PasswordHash VARBINARY(32)    NOT NULL,
    CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.Sessions (
    SessionToken UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId       INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresAt    DATETIME2 NOT NULL
);
GO

CREATE TABLE dbo.UserDatabases (
    DatabaseId   INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    DatabaseName NVARCHAR(100) NOT NULL,
    Engine       NVARCHAR(50)  NOT NULL,
    CreatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ============================================================
-- sp_Register(@Name, @Email, @Password)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_Register
    @Name     NVARCHAR(100),
    @Email    NVARCHAR(256),
    @Password NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.Users WHERE Email = @Email)
    BEGIN
        SELECT CAST(0 AS BIT) AS Success, 'Email already registered' AS Message, CAST(NULL AS INT) AS UserId;
        RETURN;
    END

    DECLARE @Salt UNIQUEIDENTIFIER = NEWID();
    DECLARE @Hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password);

    INSERT INTO dbo.Users (Name, Email, PasswordSalt, PasswordHash)
    VALUES (@Name, @Email, @Salt, @Hash);

    SELECT CAST(1 AS BIT) AS Success, 'Registered' AS Message, CAST(SCOPE_IDENTITY() AS INT) AS UserId;
END
GO

-- ============================================================
-- sp_Login(@Email, @Password)
-- ============================================================
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

    IF @UserId IS NULL OR @StoredHash <> HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password)
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success,
            'Invalid credentials' AS Message,
            CAST(NULL AS INT) AS UserId,
            CAST(NULL AS UNIQUEIDENTIFIER) AS SessionToken,
            CAST(NULL AS NVARCHAR(100)) AS Name,
            CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    DECLARE @Token UNIQUEIDENTIFIER = NEWID();
    INSERT INTO dbo.Sessions (SessionToken, UserId, ExpiresAt)
    VALUES (@Token, @UserId, DATEADD(DAY, 7, SYSUTCDATETIME()));

    SELECT
        CAST(1 AS BIT) AS Success,
        'OK' AS Message,
        @UserId AS UserId,
        @Token AS SessionToken,
        @Name AS Name,
        @Email AS Email;
END
GO

-- ============================================================
-- sp_GetPlatformStats()
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetPlatformStats
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        (SELECT COUNT(*) FROM dbo.Users)                                                          AS TotalUsers,
        (SELECT COUNT(*) FROM dbo.UserDatabases)                                                   AS TotalDatabases,
        (SELECT COUNT(*) FROM dbo.Sessions WHERE ExpiresAt > SYSUTCDATETIME())                     AS ActiveSessions,
        (SELECT COUNT(DISTINCT Engine) FROM dbo.UserDatabases)                                     AS EnginesSupported,
        (SELECT COUNT(*) FROM dbo.Users WHERE CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME()))     AS NewUsersLast30Days,
        (SELECT COUNT(*) FROM dbo.UserDatabases WHERE CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME())) AS NewDatabasesLast30Days;
END
GO

-- ============================================================
-- sp_GetUserInfo(@SessionToken)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetUserInfo
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT;

    SELECT @UserId = s.UserId
    FROM dbo.Sessions s
    WHERE s.SessionToken = @SessionToken AND s.ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT
            CAST(0 AS BIT) AS Success,
            CAST(NULL AS INT) AS UserId,
            CAST(NULL AS NVARCHAR(100)) AS Name,
            CAST(NULL AS NVARCHAR(256)) AS Email;
        RETURN;
    END

    SELECT CAST(1 AS BIT) AS Success, UserId, Name, Email
    FROM dbo.Users
    WHERE UserId = @UserId;
END
GO

-- ============================================================
-- sp_GetUserDatabases(@SessionToken)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.sp_GetUserDatabases
    @SessionToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId INT;

    SELECT @UserId = s.UserId
    FROM dbo.Sessions s
    WHERE s.SessionToken = @SessionToken AND s.ExpiresAt > SYSUTCDATETIME();

    IF @UserId IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS Success;
        RETURN;
    END

    SELECT DatabaseId, DatabaseName, Engine, CreatedAt
    FROM dbo.UserDatabases
    WHERE UserId = @UserId;
END
GO
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add schema + stored procedures for register/login/stats/user endpoints"
```

---

## Task 4: Auth module (register, login, logout)

**Files:**
- Create: `src/auth/dto/register.dto.ts`, `src/auth/dto/login.dto.ts`, `src/auth/dto/dto.spec.ts`, `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.controller.spec.ts`, `src/auth/auth.module.ts`
- Modify: `src/app.module.ts` (import `AuthModule`)

**Interfaces:**
- Consumes: `SqlService.execute<T>(spName, params)` from Task 2.
- Produces: `AuthService.register(name, email, password): Promise<RegisterResult>`, `AuthService.login(email, password): Promise<LoginResult>` where:
  ```ts
  interface RegisterResult { Success: boolean; Message: string; UserId: number | null }
  interface LoginResult { Success: boolean; Message: string; UserId: number | null; SessionToken: string | null; Name: string | null; Email: string | null }
  ```

- [ ] **Step 1: Write the failing DTO validation test**

`src/auth/dto/register.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

`src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

`src/auth/dto/dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';

describe('RegisterDto', () => {
  it('rejects a payload missing email', async () => {
    const dto = plainToInstance(RegisterDto, { name: 'Ada', password: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('accepts a well-formed payload', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'x',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('LoginDto', () => {
  it('rejects a non-email value', async () => {
    const dto = plainToInstance(LoginDto, { email: 'not-an-email', password: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
```

This step already includes the DTOs (they have no behavior beyond decorators, so writing them alongside the test — rather than after a red run — avoids a meaningless "cannot find module" failure). Run the next step to confirm the validation rules themselves are exercised correctly.

- [ ] **Step 2: Run the DTO test, verify it passes**

Run: `npx jest dto.spec.ts`
Expected: PASS (3 tests). If any fails, fix the decorators (not the test).

- [ ] **Step 3: Write the failing test for `AuthService`**

`src/auth/auth.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SqlService } from '../database/sql.service';

describe('AuthService', () => {
  let service: AuthService;
  let sqlService: { execute: jest.Mock };

  beforeEach(async () => {
    sqlService = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: SqlService, useValue: sqlService }],
    }).compile();

    service = module.get(AuthService);
  });

  it('calls sp_Register with Name/Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([{ Success: true, Message: 'Registered', UserId: 1 }]);

    const result = await service.register('Ada', 'ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Register',
      expect.objectContaining({
        Name: expect.objectContaining({ value: 'Ada' }),
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result).toEqual({ Success: true, Message: 'Registered', UserId: 1 });
  });

  it('calls sp_Login with Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([
      { Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@example.com' },
    ]);

    const result = await service.login('ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Login',
      expect.objectContaining({
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result.SessionToken).toBe('tok');
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npx jest auth.service.spec.ts`
Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 5: Implement `AuthService`**

`src/auth/auth.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';

export interface RegisterResult {
  Success: boolean;
  Message: string;
  UserId: number | null;
}

export interface LoginResult {
  Success: boolean;
  Message: string;
  UserId: number | null;
  SessionToken: string | null;
  Name: string | null;
  Email: string | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly sqlService: SqlService) {}

  async register(name: string, email: string, password: string): Promise<RegisterResult> {
    const [row] = await this.sqlService.execute<RegisterResult>('sp_Register', {
      Name: { type: sql.NVarChar, value: name },
      Email: { type: sql.NVarChar, value: email },
      Password: { type: sql.NVarChar, value: password },
    });
    return row;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const [row] = await this.sqlService.execute<LoginResult>('sp_Login', {
      Email: { type: sql.NVarChar, value: email },
      Password: { type: sql.NVarChar, value: password },
    });
    return row;
  }
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx jest auth.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the failing test for `AuthController`**

`src/auth/auth.controller.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as import('express').Response;
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('register returns the SP row as-is, even when Success is false', async () => {
    authService.register.mockResolvedValue({ Success: false, Message: 'Email already registered', UserId: null });

    const result = await controller.register({ name: 'Ada', email: 'ada@example.com', password: 'x' });

    expect(result).toEqual({ Success: false, Message: 'Email already registered', UserId: null });
  });

  it('login sets the session cookie and returns the row when Success is true', async () => {
    authService.login.mockResolvedValue({
      Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@example.com',
    });
    const res = mockResponse();

    const result = await controller.login({ email: 'ada@example.com', password: 'x' }, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'session_token',
      'tok',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
    );
    expect(result.UserId).toBe(1);
  });

  it('login throws Unauthorized when Success is false', async () => {
    authService.login.mockResolvedValue({
      Success: false, Message: 'Invalid credentials', UserId: null, SessionToken: null, Name: null, Email: null,
    });
    const res = mockResponse();

    await expect(controller.login({ email: 'ada@example.com', password: 'wrong' }, res)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout clears the cookie', () => {
    const res = mockResponse();

    const result = controller.logout(res);

    expect(res.clearCookie).toHaveBeenCalledWith('session_token');
    expect(result).toEqual({ success: true });
  });
});
```

- [ ] **Step 8: Run the test, verify it fails**

Run: `npx jest auth.controller.spec.ts`
Expected: FAIL — `Cannot find module './auth.controller'`.

- [ ] **Step 9: Implement `AuthController` and `AuthModule`**

`src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.name, dto.email, dto.password);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);

    if (!result?.Success) {
      throw new UnauthorizedException(result?.Message ?? 'Invalid credentials');
    }

    res.cookie('session_token', result.SessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    return result;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('session_token');
    return { success: true };
  }
}
```

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

Modify `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule],
})
export class AppModule {}
```

- [ ] **Step 10: Run the full test suite**

Run: `npx jest`
Expected: PASS (all tests across Tasks 1–4).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add auth module (register/login/logout via sp_Register/sp_Login)"
```

---

## Task 5: Stats module

**Files:**
- Create: `src/stats/stats.service.ts`, `src/stats/stats.controller.ts`, `src/stats/stats.controller.spec.ts`, `src/stats/stats.module.ts`
- Modify: `src/app.module.ts` (import `StatsModule`)

**Interfaces:**
- Consumes: `SqlService.execute<T>(spName, params)`.
- Produces: `StatsService.getStats(): Promise<Record<string, number>>`.

- [ ] **Step 1: Write the failing controller test**

`src/stats/stats.controller.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let statsService: { getStats: jest.Mock };

  beforeEach(async () => {
    statsService = { getStats: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: statsService }],
    }).compile();

    controller = module.get(StatsController);
  });

  it('returns whatever the service resolves, unmodified', async () => {
    const stats = { TotalUsers: 3, TotalDatabases: 5 };
    statsService.getStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(result).toBe(stats);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest stats.controller.spec.ts`
Expected: FAIL — `Cannot find module './stats.controller'`.

- [ ] **Step 3: Implement `StatsService`, `StatsController`, `StatsModule`**

`src/stats/stats.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { SqlService } from '../database/sql.service';

@Injectable()
export class StatsService {
  constructor(private readonly sqlService: SqlService) {}

  async getStats(): Promise<Record<string, number>> {
    const [row] = await this.sqlService.execute<Record<string, number>>('sp_GetPlatformStats');
    return row;
  }
}
```

`src/stats/stats.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('api')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('stats')
  async getStats() {
    return this.statsService.getStats();
  }
}
```

`src/stats/stats.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
```

Modify `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule, StatsModule],
})
export class AppModule {}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest stats.controller.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full test suite and commit**

Run: `npx jest`
Expected: PASS (all tests).

```bash
git add -A
git commit -m "feat: add public stats endpoint via sp_GetPlatformStats"
```

---

## Task 6: User module (me, my-databases)

**Files:**
- Create: `src/user/user.service.ts`, `src/user/user.controller.ts`, `src/user/user.controller.spec.ts`, `src/user/user.module.ts`
- Modify: `src/app.module.ts` (import `UserModule`)

**Interfaces:**
- Consumes: `SqlService.execute<T>(spName, params)`.
- Produces: `UserService.getMe(sessionToken: string | null): Promise<{ Success: boolean; UserId: number | null; Name: string | null; Email: string | null }>`, `UserService.getMyDatabases(sessionToken: string | null): Promise<Array<{ Success?: boolean; DatabaseId?: number; DatabaseName?: string; Engine?: string; CreatedAt?: string }>>`.

- [ ] **Step 1: Write the failing controller test**

`src/user/user.controller.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

function requestWithCookie(token?: string) {
  return { cookies: token ? { session_token: token } : {} } as unknown as import('express').Request;
}

describe('UserController', () => {
  let controller: UserController;
  let userService: { getMe: jest.Mock; getMyDatabases: jest.Mock };

  beforeEach(async () => {
    userService = { getMe: jest.fn(), getMyDatabases: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    }).compile();

    controller = module.get(UserController);
  });

  it('GET /api/me passes the cookie value through and returns it on success', async () => {
    userService.getMe.mockResolvedValue({ Success: true, UserId: 1, Name: 'Ada', Email: 'ada@example.com' });

    const result = await controller.getMe(requestWithCookie('tok'));

    expect(userService.getMe).toHaveBeenCalledWith('tok');
    expect(result.UserId).toBe(1);
  });

  it('GET /api/me passes null when there is no cookie', async () => {
    userService.getMe.mockResolvedValue({ Success: false, UserId: null, Name: null, Email: null });

    await expect(controller.getMe(requestWithCookie())).rejects.toThrow(UnauthorizedException);

    expect(userService.getMe).toHaveBeenCalledWith(null);
  });

  it('GET /api/my-databases returns the row list on success', async () => {
    const rows = [{ DatabaseId: 1, DatabaseName: 'shop', Engine: 'mysql', CreatedAt: '2026-01-01' }];
    userService.getMyDatabases.mockResolvedValue(rows);

    const result = await controller.getMyDatabases(requestWithCookie('tok'));

    expect(result).toEqual(rows);
  });

  it('GET /api/my-databases throws Unauthorized when the SP reports Success=false', async () => {
    userService.getMyDatabases.mockResolvedValue([{ Success: false }]);

    await expect(controller.getMyDatabases(requestWithCookie())).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest user.controller.spec.ts`
Expected: FAIL — `Cannot find module './user.controller'`.

- [ ] **Step 3: Implement `UserService`, `UserController`, `UserModule`**

`src/user/user.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';

export interface UserInfoResult {
  Success: boolean;
  UserId: number | null;
  Name: string | null;
  Email: string | null;
}

export interface UserDatabaseRow {
  Success?: boolean;
  DatabaseId?: number;
  DatabaseName?: string;
  Engine?: string;
  CreatedAt?: string;
}

@Injectable()
export class UserService {
  constructor(private readonly sqlService: SqlService) {}

  async getMe(sessionToken: string | null): Promise<UserInfoResult> {
    const [row] = await this.sqlService.execute<UserInfoResult>('sp_GetUserInfo', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
    });
    return row;
  }

  async getMyDatabases(sessionToken: string | null): Promise<UserDatabaseRow[]> {
    return this.sqlService.execute<UserDatabaseRow>('sp_GetUserDatabases', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
    });
  }
}
```

`src/user/user.controller.ts`:
```ts
import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { UserService } from './user.service';

@Controller('api')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@Req() req: Request) {
    const token = req.cookies?.session_token ?? null;
    const result = await this.userService.getMe(token);

    if (!result?.Success) {
      throw new UnauthorizedException();
    }

    return result;
  }

  @Get('my-databases')
  async getMyDatabases(@Req() req: Request) {
    const token = req.cookies?.session_token ?? null;
    const rows = await this.userService.getMyDatabases(token);

    if (rows.length === 1 && rows[0].Success === false) {
      throw new UnauthorizedException();
    }

    return rows;
  }
}
```

`src/user/user.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

Modify `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StatsModule } from './stats/stats.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    StatsModule,
    UserModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest user.controller.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite and commit**

Run: `npx jest`
Expected: PASS (all tests across Tasks 1–6).

```bash
git add -A
git commit -m "feat: add /api/me and /api/my-databases via sp_GetUserInfo/sp_GetUserDatabases"
```

---

## Task 7: Dockerfile + finalize `.env.example`

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `.env.example` (rewrite)

**Interfaces:** none (deployment artifacts only).

- [ ] **Step 1: Rewrite `.env.example`**

```
# Node environment
NODE_ENV=production
PORT=3000

# SQL Server connection (exact names required by the backend)
SQL_SERVER=your-vps-host.com
SQL_DATABASE=database_centric_platform
SQL_USER=your-db-user
SQL_PASSWORD=your-db-password
SQL_PORT=1433
SQL_SERVER_ENCRYPT=true
SQL_SERVER_TRUST_SERVER_CERT=false

# CORS
CORS_ORIGIN=https://big-o.andrescortes.dev
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.env
.env.local
*.log
```

- [ ] **Step 3: Write `Dockerfile`**

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev=false

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start:prod"]
```

- [ ] **Step 4: Verify the build config is internally consistent**

Run: `npm run build` (already verified in Task 1/2/4/5/6, re-run once more here as the final gate before packaging)
Expected: exits 0.

(No `docker build` here — Docker is not available in this dev environment. Note in the README, Task 8, that the image build must be verified on the VPS or CI before first deploy.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Dockerfile and finalize .env.example"
```

---

## Task 8: README rewrite, cleanup, final verification

**Files:**
- Modify: `README.md` (rewrite)
- Delete: `HANDOFF.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Delete the obsolete OAuth handoff doc**

```bash
rm HANDOFF.md
```

- [ ] **Step 2: Rewrite `README.md`**

```markdown
# Backend Core — Database-Centric Platform API

Backend NestJS puro para la plataforma de hosting de bases de datos. Arquitectura
database-centric: toda la lógica de negocio vive en Stored Procedures de SQL Server: el
backend solo ejecuta el SP correspondiente y retransmite su recordset.

## Stack

- NestJS 10 (Express)
- `mssql` — único driver de acceso a datos, sin ORM de dominio
- `class-validator` — solo valida forma/tipo de los inputs, nunca reglas de negocio

## Setup

```bash
npm install
cp .env.example .env
# editar .env con los datos reales del VPS / SQL Server
```

Ejecutar `scripts/sql/schema.sql` una vez contra la base de datos objetivo — crea las tablas
(`Users`, `Sessions`, `UserDatabases`) y los 5 stored procedures.

```bash
npm run start:dev   # desarrollo
npm run build        # build de producción
npm run start:prod    # servir dist/main.js
npm test              # suite de unit tests (Jest)
```

## Endpoints

| Método | Ruta | Body | SP |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` | `sp_Register` |
| POST | `/api/auth/login` | `{ email, password }` | `sp_Login` |
| POST | `/api/auth/logout` | — | (solo limpia la cookie, sin SP) |
| GET | `/api/stats` | — (público) | `sp_GetPlatformStats` |
| GET | `/api/me` | — (cookie `session_token`) | `sp_GetUserInfo` |
| GET | `/api/my-databases` | — (cookie `session_token`) | `sp_GetUserDatabases` |

## Sesión

`sp_Login` exitoso setea una cookie httpOnly `session_token`. El frontend debe llamar con
`fetch(url, { credentials: 'include' })` para que el navegador la mande de vuelta en cada
request a `/api/me` y `/api/my-databases`.

## Reglas de arquitectura

- Ningún SQL se concatena — `SqlService.execute` es el único punto de contacto con `mssql`
  y siempre usa `.input(name, type, value)`.
- El backend no valida reglas de negocio (email duplicado, longitud de password, etc.) —
  esas decisiones las toma el SP y viajan en el recordset (columnas `Success`/`Message`).
- Sin guards de Nest ni roles: el token de sesión (o `null` si no hay cookie) siempre se
  pasa al SP; es el SP quien decide si es válido.

## Docker

```bash
docker build -t backend-core .
docker run --env-file .env -p 3000:3000 backend-core
```

Verificar el build de la imagen en el VPS/CI antes del primer deploy — no se pudo probar
`docker build` en el entorno de desarrollo donde se escribió este backend.

## Smoke test manual

Con el servidor corriendo y `scripts/sql/schema.sql` ya aplicado:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"secret123"}'

curl -X POST http://localhost:3000/api/auth/login -i \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"secret123"}'
# copiar el valor de Set-Cookie: session_token=...

curl http://localhost:3000/api/stats

curl http://localhost:3000/api/me --cookie "session_token=<valor copiado>"
curl http://localhost:3000/api/my-databases --cookie "session_token=<valor copiado>"
```
```

- [ ] **Step 3: Run the full test suite, lint, and build one last time**

Run: `npx jest && npm run build`
Expected: all tests PASS, build exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: rewrite README for the NestJS database-centric backend, remove OAuth handoff doc"
```

---

## Self-Review Notes

- **Spec coverage:** all 5 required endpoints (Task 4, 5, 6) + logout (Task 4, approved addition) +
  parametrized SP execution (Task 2) + no-business-logic HTTP codes (Tasks 4/6) + CORS (Task 1) +
  `.env`/Dockerfile/package.json deliverables (Tasks 1, 7) all have a task.
- **Placeholder scan:** no TBD/TODO; every step has runnable code.
- **Type consistency:** `SqlService.execute<T>(spName, params)` signature from Task 2 is used
  identically in Tasks 4/5/6. `SqlParam` shape (`{ type, value }`) matches every call site.
- **Scope:** single subsystem (one backend repo), no decomposition needed.
