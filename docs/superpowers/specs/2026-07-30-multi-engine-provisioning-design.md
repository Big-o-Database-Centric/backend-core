# Multi-engine database provisioning

## Purpose

Turn Big O into a managed database platform. An authenticated user can create and manage up to three active databases, choosing MySQL, PostgreSQL, MongoDB, or SQL Server. The dashboard must show the real inventory rather than placeholder data.

## Scope

- Provision an isolated database instance and a database user for each request.
- Generate a cryptographically secure database password and show it only in the successful creation response.
- Store the database name, engine, connection endpoint, port, username, encrypted password, lifecycle state, and timestamps in the platform SQL Server database.
- Enforce a maximum of three active database instances per platform user.
- Enforce a 20 MB storage quota for each managed instance at the infrastructure layer.
- Connect the frontend dashboard to the authenticated profile and managed-database API.

The existing SQL Server database remains the control plane for users, sessions, provisioning records, and credentials. It is not replaced by a managed user database.

## Architecture

The NestJS application is split into a control-plane repository and engine-specific provisioning adapters.

- Application services depend on repository interfaces only.
- The SQL Server control-plane repository implements persistence through the existing stored-procedure gateway.
- MySQL, PostgreSQL, MongoDB, and SQL Server adapters implement a shared `DatabaseProvisioner` contract for engine-specific creation, health checks, and deprovisioning.
- Only each adapter imports its own driver or executes its own container-management integration. The application service has no engine-specific branches beyond selecting an adapter by the validated engine value.

The apparent requirement that a repository “does not know another database besides SQL Server” is implemented as: the control-plane repository uses SQL Server only, while each engine adapter is isolated behind the common provisioning interface.

## Provisioning workflow

1. The dashboard sends a creation request with a supported engine and validated database name.
2. The API obtains the user from the session cookie.
3. The control-plane stored procedure atomically reserves a pending provisioning record only when fewer than three active or pending instances exist.
4. The service derives a safe engine username from the logged-in email and a unique suffix, then generates a random password.
5. The selected adapter starts or configures the isolated engine instance, creates the database and user, grants only that database's permissions, and verifies connectivity.
6. The service encrypts the generated password with an application key and marks the SQL Server record active.
7. The API returns the connection information and plaintext password once. Subsequent reads return connection metadata but never the plaintext password.
8. If a step fails, the service attempts cleanup, records a failed state and a non-sensitive failure reason, and returns an appropriate error.

## Infrastructure and 20 MB limit

Each managed database runs in an isolated container with a persistent data directory assigned a 20 MB filesystem/project quota. This prevents writes once the allocation is exhausted and is the authoritative enforcement mechanism.

Before production deployment, the VPS filesystem must be verified to support project quotas (for example, XFS with project quotas). Docker volumes alone do not provide a portable per-instance size cap. If the current disk cannot supply a strict quota, the deployment is blocked until the volume is prepared with a quota-capable filesystem or another equivalent host-level storage policy is supplied.

Container ports are not exposed directly on the public internet by default. The platform records an endpoint usable from the approved access path. Any later requirement to expose direct client connections will require firewall rules, TLS, and IP access controls.

## Control-plane data and API

`UserDatabases` will be expanded (or migrated) to include engine, unique instance identifier, hostname, port, database username, encrypted password, quota bytes, state, failure reason, and lifecycle timestamps. SQL Server stored procedures own authorization, count limits, and persistence transitions.

The API will provide authenticated endpoints to:

- create a managed database;
- list the caller's managed databases;
- retrieve non-secret connection metadata;
- later deactivate/delete an instance (included as a lifecycle-ready design, not required for the first create-and-list slice).

## Frontend

The frontend will replace static profile, counts, engine cards, and database rows with API data. It will add a creation form, pending/error states, empty states, and a one-time credential reveal after successful provisioning. Session failures redirect to login.

## Security

- The SQL Server `sa` credential supplied outside the repository must be rotated because it was exposed in chat.
- Runtime secrets stay in VPS environment variables or a secret manager, never in source control.
- Database passwords use a CSPRNG and are encrypted at rest with a separate application encryption key.
- User-provided names are normalized and validated; credentials and identifiers are never concatenated into executable SQL.
- API errors never return internal database passwords, driver errors, or host paths.

## Testing and rollout

- Unit-test service limits, state transitions, credential encryption boundaries, and all adapter contracts with fakes.
- Add integration tests per engine against disposable containers, including quota-exceeded behavior where the host supports it.
- Add frontend tests for real dashboard loading, creation states, and the three-instance limit.
- Deploy prerequisites first, then SQL Server migration and backend, then frontend. Smoke-test one database per engine with a non-production account.

## Out of scope

- Publicly exposing database ports without a defined network-access policy.
- Password recovery or repeated display of existing database passwords.
- Backups, billing, custom quota sizes, and database resizing.
