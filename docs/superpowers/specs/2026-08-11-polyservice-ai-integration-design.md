# PolyService AI Integration Design

## Goal

Allow authenticated Big O users to chat with PolyService AI from the web application while a single platform-managed API key remains secret in the backend. The first release supports only `llama-8b-nvidia`, has no permanent conversation history, and protects the shared upstream quota with persistent per-user and global limits.

## Scope

This release includes:

- A dedicated AI page in `frontend-landing`.
- Authenticated Big O API endpoints for AI capabilities and chat.
- A provider interface with a PolyService implementation.
- A single API key stored as the backend secret `POLYSERVICE_AI_KEY`.
- SQL Server-backed quota reservation and usage metadata.
- Local automated tests and one controlled integration test against PolyService.
- Deployment documentation and candidate-container verification.

This release does not include:

- User-managed or user-visible API keys.
- Grok or Qwen providers.
- Streaming responses.
- Permanent conversation, prompt, or response storage.
- Automatic retries of chat requests.

## Upstream Contract

- Base URL: `https://ia.polyrepo.andrescortes.dev`.
- Models endpoint: `GET /v1/models`.
- Chat endpoint: `POST /v1/chat/completions`.
- Model: `llama-8b-nvidia`.
- Authentication: `Authorization: Bearer <API_KEY>`.
- Streaming: unavailable; `stream` is always `false`.
- Upstream maximum output: 1,024 tokens.
- Current upstream limits: 10 requests per minute and 100 requests per day for the shared key.

The upstream API key must never be committed, logged, sent to the browser, placed in a URL, or stored in browser storage. The key shared during design validation must be rotated before production deployment because it was exposed outside a secret manager.

## Architecture

The request flow is:

1. An authenticated user submits chat messages from the AI page.
2. `AiController` passes the session token and validated request to `AiService`.
3. `AiService` asks `AiUsageRepository` to reserve quota atomically in SQL Server.
4. On successful reservation, `AiService` calls the provider through the `AiProvider` interface.
5. `PolyServiceAiProvider` supplies the secret authorization header, fixed model, `stream: false`, and timeout.
6. `AiService` records status, latency, provider status, and token usage against the reservation.
7. The controller returns only the assistant message and safe usage/capability metadata.

The module boundaries are:

- `AiController`: HTTP/session boundary.
- `AiService`: orchestration and application-level behavior.
- `AiUsageRepository`: interface for quota reservation and usage completion.
- `SqlServerAiUsageRepository`: stored-procedure adapter; the service does not know SQL Server details.
- `AiProvider`: provider-neutral chat interface.
- `PolyServiceAiProvider`: PolyService HTTP adapter and error translation.

This boundary allows later Grok and Qwen adapters without changing the frontend contract or quota service.

## API Contract

### `GET /api/ai/capabilities`

Requires a valid `session_token` cookie. Returns:

```json
{
  "models": ["llama-8b-nvidia"],
  "defaultModel": "llama-8b-nvidia",
  "maxTokens": 512,
  "defaultMaxTokens": 256,
  "perUser": { "perMinute": 3, "perDay": 10 },
  "remaining": { "today": 7 }
}
```

The response never includes the provider name, upstream URL, or API key.

### `POST /api/ai/chat`

Requires a valid `session_token` cookie. Request:

```json
{
  "messages": [
    { "role": "user", "content": "Explica qué es una API en una frase." }
  ],
  "maxTokens": 256
}
```

Accepted roles are `system`, `user`, and `assistant`. Rules:

- 1 to 10 messages.
- Each message contains 1 to 4,000 characters after trimming.
- Total content is at most 12,000 characters.
- `maxTokens` is optional, defaults to 256, and must be from 1 to 512.
- The server fixes `model` to `llama-8b-nvidia` and `stream` to `false`.

Successful response:

```json
{
  "model": "llama-8b-nvidia",
  "message": {
    "role": "assistant",
    "content": "Una API permite que dos sistemas se comuniquen."
  },
  "usage": {
    "promptTokens": 12,
    "completionTokens": 14,
    "totalTokens": 26
  },
  "remaining": {
    "today": 6
  }
}
```

## Quota and Persistence

SQL Server remains the control plane. An additive migration creates an AI request-usage table and stored procedures for authorization, reservation, completion, and capability usage.

Initial configurable limits are:

- Per user: 3 requests per minute and 10 requests per UTC day.
- Global: 9 requests per minute and 90 requests per UTC day.

The global limits leave headroom below PolyService's current key limits. Reservation is atomic and uses SQL Server locking so concurrent backend requests cannot exceed configured capacity.

The usage record stores only:

- Request identifier.
- User identifier.
- Reservation and completion timestamps.
- Request state.
- Provider HTTP status when available.
- Latency in milliseconds.
- Prompt, completion, and total token counts when available.

Prompts and assistant responses are never persisted. Requests rejected before a provider reservation do not count. Once a reservation is sent to the provider, it counts even if the provider fails because the upstream may have consumed quota.

## Provider Behavior and Error Mapping

`PolyServiceAiProvider` uses the built-in Node.js `fetch`, a 35-second abort timeout, and no automatic retry.

Errors are mapped to stable Big O responses:

- Invalid local input: `400 Bad Request`.
- Missing or expired Big O session: `401 Unauthorized`.
- Local user/global quota exhausted: `429 Too Many Requests`.
- Upstream `429`: `429 Too Many Requests` with a generic service-quota message.
- Upstream `401` or `403`: `503 Service Unavailable`; provider credential details are logged only as a safe status code.
- Upstream `502` or other retryable `5xx`: `502 Bad Gateway`.
- Upstream timeout or `504`: `504 Gateway Timeout`.
- Invalid upstream response: `502 Bad Gateway`.

Logs may contain request identifier, status, latency, and safe error category. They may not contain authorization headers, API keys, prompts, or responses.

## Frontend Experience

The frontend adds a dedicated AI page linked from the authenticated navigation. It contains:

- A visible, read-only `llama-8b-nvidia` model indicator.
- A transcript area for current in-memory messages.
- A text composer and submit button.
- A non-blocking `Generando respuesta…` state that prevents duplicate submission.
- A per-user daily remaining-requests indicator.
- A `Nueva conversación` action that clears only in-memory messages.
- Accessible status and error regions for session, quota, validation, and provider failures.

Messages exist only in JavaScript memory. Refreshing or closing the page clears the conversation. No API key or conversation is stored in `localStorage` or `sessionStorage`.

## Configuration and Deployment Safety

Local development reads `POLYSERVICE_AI_KEY` from an ignored `.env` or the process environment. Production receives it from a GitHub Actions secret with the same name.

The backend deployment workflow passes the secret into both candidate and final containers. The AI provider requires the configuration during module initialization, so a missing secret makes the candidate fail before it can replace the healthy production container.

The existing candidate deployment and rollback sequence remains mandatory. The AI health check must not generate chat completions or consume daily quota. General backend health plus configuration construction verifies candidate startup; a controlled authenticated smoke test is performed only after deployment.

No production secret, SQL migration, VPS configuration, or `main` branch is changed until local implementation, tests, builds, secret scans, and review are complete and the user explicitly approves publication.

## Testing Strategy

Backend automated coverage includes:

- DTO limits, roles, trimming, and total content length.
- Controller session propagation and safe response shape.
- Service quota reservation, provider success, provider failure, and usage completion.
- Provider authorization behavior without exposing the key in assertions or logs.
- Timeout and upstream status mapping.
- SQL migration contract and atomic quota rules.
- Deployment workflow contract for passing `POLYSERVICE_AI_KEY` to candidate and final containers.

Frontend Playwright coverage includes:

- Authenticated page loading and capabilities rendering.
- Successful chat and transcript rendering.
- Disabled duplicate submission and visible progress.
- New-conversation clearing.
- User quota, global quota, validation, session, timeout, and provider error states.
- Confirmation that no key is present in HTML, JavaScript, storage, or API responses.

Final local verification includes the full backend test suite and build, the full frontend Playwright suite and CSS build, and one manually controlled PolyService request with `max_tokens: 64`. Production publication requires a final diff review, secret scan, explicit approval to push `main`, successful candidate deployments, and post-deployment public health verification.

## Documentation Deliverables

- Backend README configuration and endpoint reference.
- Frontend usage instructions for the AI page.
- Environment-variable and GitHub-secret setup without secret values.
- Error and quota behavior.
- Local test instructions and production smoke-test checklist.
