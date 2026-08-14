# Managed Database UX and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user create up to three databases, see progress and recover fresh credentials after refresh, and permanently delete owned databases.

**Architecture:** SQL Server owns authorization and deletion state through stored procedures. The backend performs Docker/XFS cleanup behind repository interfaces. The frontend uses capabilities for user-facing limits, a non-blocking creation state, and short-lived session storage for credentials.

**Tech Stack:** NestJS, SQL Server stored procedures, Docker/XFS helper, vanilla JavaScript, Playwright, Jest.

## Global Constraints

- Per-user limit is exactly 3 `pending` or `active` databases across MySQL and PostgreSQL.
- VPS total safety limit is exactly 4 `pending` or `active` databases.
- Plaintext credentials must never be written to SQL Server or a new API endpoint.
- Deletion is permanent and only applies to the authenticated owner's record.

---

### Task 1: Capacity contract

**Files:**
- Modify: `src/managed-databases/managed-databases.service.ts`
- Modify: `src/managed-databases/managed-databases.service.spec.ts`
- Modify: `src/managed-databases/managed-databases.controller.spec.ts`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces `capabilities(): { engines: ManagedEngine[]; maxPerUser: 3 }`.
- Deploys `MANAGED_DATABASE_MAX_TOTAL=4` by default.

- [ ] Write failing tests asserting `maxPerUser: 3` and default global capacity `4`.
- [ ] Run the focused Jest tests and confirm they fail.
- [ ] Implement the capability value and default capacity.
- [ ] Run focused Jest tests and commit `feat: expose managed database user limit`.

### Task 2: Ownership-safe deletion backend

**Files:**
- Modify: `scripts/sql/003-managed-databases.sql`
- Modify: `src/managed-databases/managed-database.types.ts`
- Modify: `src/managed-databases/managed-database.repository.ts`
- Modify: `src/managed-databases/sql-server-managed-database.repository.ts`
- Modify: `src/managed-databases/managed-databases.service.ts`
- Modify: `src/managed-databases/managed-databases.controller.ts`
- Modify: `src/managed-databases/managed-databases.service.spec.ts`
- Modify: `src/managed-databases/managed-databases.controller.spec.ts`
- Modify: `src/managed-databases/sql-contract.spec.ts`

**Interfaces:**
- Produces `service.remove(sessionToken, databaseId): Promise<void>`.
- Adds repository `beginDelete`, `completeDelete`, and `failDelete` methods.
- Adds `DELETE /api/managed-databases/:databaseId`.

- [ ] Write failing service/controller/SQL-contract tests for owner-only deletion and cleanup failure tracking.
- [ ] Run focused tests and confirm failure.
- [ ] Implement stored procedures with `deleting` state and repository methods.
- [ ] Implement service cleanup and controller route.
- [ ] Run focused tests and commit `feat: delete managed databases safely`.

### Task 3: Creation feedback and credential recovery

**Files:**
- Modify: `views/dashboard.html`
- Modify: `js/dashboard.js`
- Modify: `tests/dashboard.spec.ts`
- Modify: `tests/login.spec.ts`

**Interfaces:**
- Uses `sessionStorage` key `big-o:managed-database-credentials` with `{ expiresAt, credentials }`.
- Renders `N de 3 bases activas` and blocks only a duplicate form submission.

- [ ] Write failing Playwright tests for the 3-of-3 message, visible creation state, and credentials restored after reload.
- [ ] Run focused Playwright tests and confirm failure.
- [ ] Implement status, limit rendering, session storage restore/expiry, and delete confirmation/action.
- [ ] Run focused tests and commit `feat: improve managed database dashboard flow`.

### Task 4: Integration, configuration, and deployment

**Files:**
- Modify: `infra/managed-databases/README.md`
- Modify: deployment variables in GitHub.

- [ ] Run backend Jest suite and build; run frontend Playwright suite on an isolated local server.
- [ ] Set `MANAGED_DATABASE_MAX_TOTAL=4` in GitHub repository variables.
- [ ] Apply SQL migration on the VPS, deploy backend first, verify candidate and API health, then deploy frontend.
- [ ] Verify a temporary creation and deletion releases capacity without residual container, quota mapping, directory, or SQL record.
