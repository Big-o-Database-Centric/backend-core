# User-data quota implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a hard 20 MiB growth budget after each managed database engine initializes.

**Architecture:** Provisioners prepare a directory, initialize the engine and database user, then ask the XFS helper to set its hard limit to baseline bytes plus 20 MiB. SQL Server activation remains the final operation, so credentials are never returned before the limit succeeds.

**Tech Stack:** NestJS, TypeScript, Docker CLI, XFS project quotas, Bash, Jest.

## Global Constraints

- The user database may grow by at most 20 MiB after initialization.
- A quota failure removes the container and marks the SQL Server reservation failed.
- XFS with `prjquota` or `pquota` is mandatory in production.
- Candidate health checks and rollback remain mandatory for backend and frontend deployment.

---

### Task 1: Separate directory preparation and quota activation

**Files:**
- Modify: `src/managed-databases/provisioners/docker-runner.ts`
- Modify: `src/managed-databases/provisioners/base-docker.provisioner.ts`
- Test: `src/managed-databases/provisioners/mysql.provisioner.spec.ts`

**Interfaces:**
- `DockerRunner.prepareInstance(instanceId: string): Promise<void>` creates project mapping only.
- `DockerRunner.applyUserDataQuota(instanceId: string): Promise<void>` invokes the helper `limit` operation.
- `BaseDockerProvisioner.limitUserData(instanceId: string): Promise<void>` delegates to the runner.

- [ ] **Step 1: Write the failing order test**

```ts
expect(runner.prepareInstance).toHaveBeenCalledWith('db-1');
expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
expect(runner.applyUserDataQuota.mock.invocationCallOrder[0])
  .toBeGreaterThan(runner.waitForCommand.mock.invocationCallOrder[0]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- mysql.provisioner.spec.ts --runInBand`

Expected: FAIL because the runner has only `prepareQuota` and the provisioner returns before a post-initialization limit.

- [ ] **Step 3: Implement the minimum lifecycle methods**

```ts
await this.docker.prepareInstance(input.instanceId);
// Docker start and engine-specific readiness
await this.limitUserData(input.instanceId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- mysql.provisioner.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/managed-databases/provisioners/docker-runner.ts src/managed-databases/provisioners/base-docker.provisioner.ts src/managed-databases/provisioners/mysql.provisioner.spec.ts
git commit -m "feat: apply quota after engine setup"
```

### Task 2: Limit each engine after its user setup

**Files:**
- Modify: `src/managed-databases/provisioners/mysql.provisioner.ts`
- Modify: `src/managed-databases/provisioners/postgresql.provisioner.ts`
- Modify: `src/managed-databases/provisioners/mongodb.provisioner.ts`
- Modify: `src/managed-databases/provisioners/sqlserver.provisioner.ts`

**Interfaces:**
- Each `provision` resolves only after `limitUserData(input.instanceId)` succeeds.

- [ ] **Step 1: Write failing invocation tests**

```ts
expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
```

- [ ] **Step 2: Verify failure**

Run: `npm.cmd test -- mysql.provisioner.spec.ts --runInBand`

Expected: FAIL because no engine invokes `applyUserDataQuota`.

- [ ] **Step 3: Call the limiter after authenticated engine setup**

```ts
await this.docker.waitForCommand(...);
await this.limitUserData(input.instanceId);
return this.connection(input, port);
```

MongoDB limits after `createUser`; SQL Server limits after `CREATE DATABASE` and `CREATE LOGIN`.

- [ ] **Step 4: Verify tests and build**

Run: `npm.cmd test -- --runInBand; npm.cmd run build`

Expected: all tests pass and Nest compiles.

### Task 3: Implement quota-helper operations

**Files:**
- Modify: `infra/managed-databases/prepare-quotas.sh`
- Modify: `infra/managed-databases/README.md`
- Create: `src/managed-databases/quota-contract.spec.ts`

**Interfaces:**
- Helper usage is `prepare-quotas prepare <instance-id>` and `prepare-quotas limit <instance-id>`.
- `limit` calculates `du -sb` and applies XFS hard limit equal to baseline plus `20 * 1024 * 1024` bytes.

- [ ] **Step 1: Write the failing helper-contract test**

```ts
expect(script).toContain('case "$operation" in');
expect(script).toContain('baseline_bytes=$(du -sb');
expect(script).toContain('20 * 1024 * 1024');
```

- [ ] **Step 2: Verify failure**

Run: `npm.cmd test -- quota-contract.spec.ts --runInBand`

Expected: FAIL because the helper sets a fixed 20 MiB limit before initialization.

- [ ] **Step 3: Implement prepare and limit**

```bash
case "$operation" in
  prepare) ensure_project_mapping ;;
  limit) ensure_project_mapping; baseline_bytes=$(du -sb "$instance_path" | awk '{print $1}') ;;
esac
```

- [ ] **Step 4: Verify script and tests**

Run: `bash -n infra/managed-databases/prepare-quotas.sh; npm.cmd test -- quota-contract.spec.ts --runInBand`

Expected: PASS.

### Task 4: Verify and publish

**Files:**
- Verify: `backend-core/.github/workflows/deploy.yml`
- Verify: `frontend-landing/.github/workflows/deploy.yml`
- Verify: `frontend-landing/css/tailwind.css`

- [ ] **Step 1: Verify backend**

Run: `npm.cmd test -- --runInBand; npm.cmd run build`

Expected: all tests pass and compilation succeeds.

- [ ] **Step 2: Verify frontend**

Run: `npm.cmd run build:css; npm.cmd exec -- playwright test`

Expected: generated CSS exists and browser tests pass.

- [ ] **Step 3: Inspect staged diffs**

Run: `git status -sb; git diff --check`

Expected: only managed database, deployment safety, dashboard, and stylesheet files are staged.

- [ ] **Step 4: Commit and push each main branch**

Run: `git push origin main`

Expected: GitHub Actions validates a candidate first; a failed candidate leaves the existing public container running.
