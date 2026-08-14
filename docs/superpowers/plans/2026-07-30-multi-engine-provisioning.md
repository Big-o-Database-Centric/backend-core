# Multi-engine database provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Provision and display real isolated MySQL, PostgreSQL, MongoDB, and SQL Server databases for authenticated Big O users.

**Architecture:** SQL Server remains the control plane for sessions, inventory, encrypted credentials, and state changes. A NestJS service selects an isolated engine adapter through a common interface. The static frontend reads authenticated APIs instead of placeholder content.

**Tech Stack:** NestJS 10, TypeScript, SQL Server, Docker, MySQL, PostgreSQL, MongoDB, Node crypto, static HTML/JS, Jest, and Playwright.

## Global Constraints

- SQL Server owns platform users, sessions, inventory, and encrypted credentials.
- Services depend only on repository and provisioner interfaces; adapters own engine details.
- Each pending or active instance has a 20 MiB host-enforced storage quota.
- One platform user has at most three pending or active instances.
- Passwords use crypto.randomBytes, are encrypted at rest, and are plaintext only in the create response.
- Validate identifiers; never concatenate user input into SQL or shell commands.
- Runtime secrets are environment variables and never committed.
- Engine ports remain private until a network-access policy is approved.

---

## File structure

- src/managed-databases/: DTO, controller, service, contracts, SQL Server repository, credential cipher.
- src/managed-databases/provisioners/: Docker runner and one provisioner per engine.
- scripts/sql/003-managed-databases.sql: additive production migration.
- infra/managed-databases/: quota preparation and Docker deployment reference.
- Frontend views/dashboard.html and js/dashboard.js: real renderer and creation form.

### Task 1: Create the additive SQL Server control-plane migration

**Files:**
- Create: scripts/sql/003-managed-databases.sql
- Modify: scripts/sql/schema.sql
- Create: src/managed-databases/sql-contract.spec.ts

**Interfaces:**
- Produces: sp_ReserveManagedDatabase, sp_ActivateManagedDatabase, sp_FailManagedDatabase, and sp_GetManagedDatabases.

- [ ] **Step 1: Write the failing contract test**

~~~ts
it('reserves only when fewer than three rows are pending or active', () => {
  const sql = readFileSync(resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'), 'utf8');
  expect(sql).toContain("State IN ('pending', 'active')");
  expect(sql).toContain('>= 3');
});
~~~

- [ ] **Step 2: Run the test**

Run: npm test -- sql-contract.spec.ts

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Implement the migration**

~~~sql
ALTER TABLE dbo.UserDatabases ADD
  InstanceId UNIQUEIDENTIFIER NULL, HostName NVARCHAR(255) NULL, Port INT NULL,
  DatabaseUser NVARCHAR(128) NULL, EncryptedPassword VARBINARY(MAX) NULL,
  QuotaBytes BIGINT NOT NULL CONSTRAINT DF_UserDatabases_QuotaBytes DEFAULT 20971520,
  State NVARCHAR(20) NOT NULL CONSTRAINT DF_UserDatabases_State DEFAULT 'active',
  FailureReason NVARCHAR(250) NULL, ActivatedAt DATETIME2 NULL;
GO
~~~

Create the four stored procedures. sp_ReserveManagedDatabase resolves the session, uses sp_getapplock, rejects three pending or active rows, and inserts a pending row. Update the fresh schema to create the same columns and procedures without depending on this migration.

- [ ] **Step 4: Run the test**

Run: npm test -- sql-contract.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add scripts/sql/003-managed-databases.sql scripts/sql/schema.sql src/managed-databases/sql-contract.spec.ts
git commit -m "feat: add managed database control plane"
~~~

### Task 2: Add contracts, encryption, and the SQL Server repository

**Files:**
- Create: src/managed-databases/managed-database.types.ts
- Create: src/managed-databases/managed-database.repository.ts
- Create: src/managed-databases/database-provisioner.ts
- Create: src/managed-databases/credential-cipher.service.ts
- Create: src/managed-databases/sql-server-managed-database.repository.ts
- Test: src/managed-databases/credential-cipher.service.spec.ts

**Interfaces:**
- Produces: ManagedEngine, ManagedDatabaseRepository, DatabaseProvisioner, and CredentialCipherService.

- [ ] **Step 1: Write the failing cipher test**

~~~ts
it('round-trips a secret without retaining plaintext bytes', () => {
  const encrypted = cipher.encrypt('secret-value');
  expect(encrypted.toString('utf8')).not.toContain('secret-value');
  expect(cipher.decrypt(encrypted)).toBe('secret-value');
});
~~~

- [ ] **Step 2: Run the test**

Run: npm test -- credential-cipher.service.spec.ts

Expected: FAIL because the cipher does not exist.

- [ ] **Step 3: Implement the contract and cipher**

~~~ts
export type ManagedEngine = 'mysql' | 'postgresql' | 'mongodb' | 'sqlserver';
export interface DatabaseProvisioner {
  readonly engine: ManagedEngine;
  provision(input: { instanceId: string; databaseName: string; username: string; password: string }): Promise<{ host: string; port: number }>;
  destroy(instanceId: string): Promise<void>;
}
~~~

Use a 32-byte base64 DATABASE_CREDENTIALS_KEY, random 12-byte IV, and aes-256-gcm. Serialize version, IV, tag, and ciphertext. The repository calls only existing SqlService stored procedures.

- [ ] **Step 4: Run the test**

Run: npm test -- credential-cipher.service.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/managed-databases
git commit -m "feat: add managed database contracts"
~~~

### Task 3: Implement authenticated provisioning API

**Files:**
- Create: src/managed-databases/dto/create-managed-database.dto.ts
- Create: src/managed-databases/managed-databases.service.ts
- Create: src/managed-databases/managed-databases.controller.ts
- Create: src/managed-databases/managed-databases.module.ts
- Modify: src/app.module.ts
- Test: src/managed-databases/managed-databases.service.spec.ts
- Test: src/managed-databases/managed-databases.controller.spec.ts

**Interfaces:**
- Consumes: ManagedDatabaseRepository.reserve, DatabaseProvisioner.provision, and CredentialCipherService.encrypt.
- Produces: POST /api/managed-databases and GET /api/managed-databases.

- [ ] **Step 1: Write the failing limit test**

~~~ts
it('does not call a provisioner when reservation reports the limit', async () => {
  repository.reserve.mockResolvedValue({ Success: false, Message: 'Maximum of 3 active databases reached' });
  await expect(service.create('token', { engine: 'mysql', databaseName: 'shop' })).rejects.toThrow(ConflictException);
  expect(provisioner.provision).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run the test**

Run: npm test -- managed-databases.service.spec.ts

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement service and controller**

~~~ts
@Post('managed-databases')
create(@Req() req: Request, @Body() dto: CreateManagedDatabaseDto) {
  return this.service.create(req.cookies?.session_token ?? null, dto);
}
~~~

Validate databaseName with the expression shown in the design: it begins with a letter and uses lowercase letters, digits, and underscore only. Generate a 24-byte base64url password, derive a safe username from email plus database id, mark adapter failures through sp_FailManagedDatabase, and omit encrypted credentials from list responses.

- [ ] **Step 4: Run API tests**

Run: npm test -- managed-databases.service.spec.ts managed-databases.controller.spec.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/app.module.ts src/managed-databases
git commit -m "feat: add managed database API"
~~~

### Task 4: Implement isolated engine adapters

**Files:**
- Create: src/managed-databases/provisioners/docker-runner.ts
- Create: src/managed-databases/provisioners/mysql.provisioner.ts
- Create: src/managed-databases/provisioners/postgresql.provisioner.ts
- Create: src/managed-databases/provisioners/mongodb.provisioner.ts
- Create: src/managed-databases/provisioners/sqlserver.provisioner.ts
- Create: src/managed-databases/provisioners/provisioners.module.ts
- Test: src/managed-databases/provisioners/*.spec.ts

**Interfaces:**
- Consumes: DatabaseProvisioner and DockerRunner.run(args: string[]): Promise<void>.
- Produces: all four adapters registered by engine.

- [ ] **Step 1: Write a failing MySQL adapter test**

~~~ts
await provisioner.provision(input);
expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining([
  'run', '--detach', '--name', 'big-o-mysql-' + input.instanceId,
  '--network', 'big-o-private', 'mysql:8.4'
]));
~~~

- [ ] **Step 2: Run the adapter tests**

Run: npm test -- provisioners

Expected: FAIL because no provisioner exists.

- [ ] **Step 3: Implement runner and adapters**

Use execFile with argument arrays, never a shell. Each adapter creates a private-network container named big-o-engine-instanceId, mounts /srv/big-o/instances/instanceId as its data directory, creates exactly one non-admin database user and database, waits for readiness, and returns the private hostname and default port. Do not publish host ports.

- [ ] **Step 4: Run the adapter tests**

Run: npm test -- provisioners

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/managed-databases/provisioners package.json package-lock.json
git commit -m "feat: add isolated engine provisioners"
~~~

### Task 5: Add VPS quota preparation and smoke coverage

**Files:**
- Create: infra/managed-databases/prepare-quotas.sh
- Create: infra/managed-databases/README.md
- Create: infra/managed-databases/compose.yml
- Create: test/managed-databases.integration.spec.ts

**Interfaces:**
- Consumes: Docker socket access and /srv/big-o/instances mounted on XFS with project quotas.
- Produces: a private Docker network and one 20 MiB project quota per instance directory.

- [ ] **Step 1: Write the failing quota test**

~~~ts
it('reports a 20 MiB project quota before provisioning', async () => {
  expect((await infrastructure.getQuota(instanceId)).bytes).toBe(20 * 1024 * 1024);
});
~~~

- [ ] **Step 2: Run it**

Run: npm test -- managed-databases.integration.spec.ts

Expected: FAIL until the VPS has a quota-capable filesystem.

- [ ] **Step 3: Implement host preparation**

The script exits nonzero unless the target mount is XFS with project quotas. It creates an instance directory, assigns a unique project id, and applies a 20 MiB hard limit using xfs_quota. The README includes exact preflight, service-account Docker permission, and cleanup commands.

- [ ] **Step 4: Run it on the prepared VPS**

Run: npm test -- managed-databases.integration.spec.ts

Expected: PASS, including a write rejected at quota capacity.

- [ ] **Step 5: Commit**

~~~bash
git add infra test/managed-databases.integration.spec.ts
git commit -m "feat: add managed database quota infrastructure"
~~~

### Task 6: Replace frontend mocks with authenticated API data

**Files:**
- Modify: views/dashboard.html
- Modify: js/dashboard.js
- Modify: js/login.js
- Modify: js/register.js
- Create: tests/dashboard.spec.ts
- Modify: tests/login.spec.ts
- Modify: tests/register.spec.ts

**Interfaces:**
- Consumes: login/register APIs plus GET /api/me, GET /api/managed-databases, and POST /api/managed-databases.
- Produces: a dashboard without placeholder profile, counts, or database rows.

- [ ] **Step 1: Write a failing dashboard test**

~~~ts
await page.route('**/api/me', route => route.fulfill({ json: { Success: true, Name: 'Ada' } }));
await page.route('**/api/managed-databases', route => route.fulfill({ json: [{ DatabaseId: 7, DatabaseName: 'shop', Engine: 'mysql', State: 'active', QuotaBytes: 20971520 }] }));
await page.goto('/views/dashboard.html');
await expect(page.getByText('Ada')).toBeVisible();
await expect(page.getByText('shop')).toBeVisible();
~~~

- [ ] **Step 2: Run it**

Run: npm test -- dashboard.spec.ts

Expected: FAIL because the dashboard is static.

- [ ] **Step 3: Implement real forms and rendering**

Replace static profile, metrics, and database rows with empty containers filled by dashboard.js. Add a modal form with engine select and database-name input. On create success render host, port, user, database, and plaintext password in a copyable dialog; clear its password when closed. On 401 redirect to login; on 409 show the limit message; on 422 show field validation. Replace mocked login/register delays with credentialed JSON fetch calls and redirect only after successful responses.

- [ ] **Step 4: Run frontend tests**

Run: npm test

Expected: PASS with no hard-coded user name, counts, or database names.

- [ ] **Step 5: Commit**

~~~bash
git add views/dashboard.html js/dashboard.js js/login.js js/register.js tests
git commit -m "feat: connect dashboard to managed databases"
~~~

### Task 7: Build, deploy, and publish

**Files:**
- Modify: .env.example
- Modify: README.md
- Modify: frontend nginx.conf

**Interfaces:**
- Consumes: prepared VPS, valid SQL Server control plane, DATABASE_CREDENTIALS_KEY, and GitHub session for monterrosag18.
- Produces: deployed services and separate draft pull requests for backend and frontend.

- [ ] **Step 1: Document runtime configuration and proxy**

Add variable names, not values, for DATABASE_CREDENTIALS_KEY, MANAGED_DATABASE_DATA_ROOT, and MANAGED_DATABASE_HOST. Add Nginx /api/ proxy forwarding with cookies and X-Forwarded headers.

- [ ] **Step 2: Build and test**

Run: npm test && npm run build in backend-core, then npm test in frontend-landing.

Expected: all checks pass.

- [ ] **Step 3: Run VPS smoke checks**

Create one database per engine using a test account, connect with only its generated credentials, verify 20 MiB quota enforcement and fourth-create rejection, then remove all test instances.

- [ ] **Step 4: Publish repository-specific work**

~~~bash
gh auth status
git status -sb
git push -u origin agent/multi-engine-provisioning
gh pr create --draft --fill
~~~

Repeat from frontend with its own branch and draft pull request. Push only after gh auth status identifies monterrosag18.

