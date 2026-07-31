# Managed Database UX, Capacity, and Delete Design

## Goal

Allow each authenticated user to manage up to three MySQL/PostgreSQL databases, understand creation progress, recover newly generated credentials after a same-tab refresh, and permanently delete their own database to free VPS capacity.

## Capacity rules

- `sp_ReserveManagedDatabase` remains the authoritative per-user limit: three `pending` or `active` records across all engines.
- The VPS safety cap becomes four total `pending` or `active` records through `MANAGED_DATABASE_MAX_TOTAL=4`.
- The UI receives `maxPerUser: 3` from the capabilities endpoint and displays the user count. It disables creation at three while the stored procedure remains the race-safe enforcement point.

## Creation experience

- Submitting a creation request keeps the dashboard usable and replaces the submit button label with a clear creation status. Inputs and only the submit action are disabled to prevent duplicates.
- The UI persists the successful response in `sessionStorage` for ten minutes. On a same-tab reload, it reopens the credentials dialog. Credentials are cleared after explicit dismissal or expiry; they are never persisted by a new backend endpoint.
- The existing backend response remains the sole source of the plaintext password.

## Permanent deletion

- `DELETE /api/managed-databases/:databaseId` accepts only the logged-in user's active or failed record.
- SQL Server atomically marks the owned record `deleting` and returns its engine and instance ID. This prevents concurrent creation/deletion races and keeps the global count reserved during cleanup.
- The service destroys the matching Docker instance and XFS quota. Only after successful cleanup it permanently deletes the marked SQL Server row.
- Cleanup failure restores the record to `failed` with a reason, so it remains visible and can be retried instead of silently losing tracking.
- The dashboard asks for explicit confirmation, disables the row action while deletion runs, reloads the list on success, and immediately makes capacity available.

## Out of scope

- MongoDB and user-managed SQL Server engines.
- Password recovery after the ten-minute same-tab window.
- Soft-delete retention or restore.
