# User-data quota design

## Decision

Each managed database permits 20 MiB of growth after its engine has completed initialization. Engine-owned files that exist before the user receives credentials are treated as the baseline; they are not part of the user's allocation.

## Lifecycle

1. The provisioning service prepares a dedicated instance directory without a hard byte limit.
2. It starts the selected engine, waits for an authenticated readiness check, and creates the caller's database user.
3. The quota helper measures the directory's allocated byte count and applies one XFS project hard limit equal to that baseline plus 20 MiB.
4. Only after that command succeeds does the service store the encrypted credentials and mark the SQL Server control-plane record active.

If the quota operation fails, the service removes the engine container and marks the reservation failed. It never returns credentials for an unbounded instance.

## Enforcement boundary

The quota applies to the instance data directory on the VPS. Since each managed database has its own engine container and directory, every subsequent database write competes against the 20 MiB user-growth budget. Internal writes after baseline also consume remaining space, which can only reduce usable user space; they cannot let a user exceed the allocation.

## Host requirements

The VPS data root must be an XFS filesystem mounted with project quotas. The helper owns project mappings and exposes two narrow operations: `prepare` and `limit`. The limit operation must run after all engine-specific initialization and before credentials are activated.

## Verification

Unit tests cover lifecycle ordering and failure cleanup. Before production activation, the VPS preflight must verify XFS project quotas and a disposable instance of each engine must demonstrate that a write beyond the calculated limit fails. The deployment remains candidate-checked and rolls back on unhealthy service startup.
