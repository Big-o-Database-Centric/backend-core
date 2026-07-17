# Backend Database-Centric (NestJS) — Diseño

Fecha: 2026-07-16
Repo: `backend-core` (reemplaza por completo el Next.js + NextAuth OAuth existente)

## Contexto

`backend-core` tenía una implementación previa en Next.js 16 + NextAuth v5 (OAuth Google/GitHub,
ver `HANDOFF.md`). Se descarta por completo: el nuevo backend es NestJS puro, auth por
email/password contra Stored Procedures, sin OAuth y sin ORM de dominio.

El frontend (`frontend-landing`) ya existe y hoy simula todo el flujo (login/register hacen
`setTimeout` y navegan a `dashboard.html` sin llamar red — ver `js/login.js`, `js/register.js`).
Este backend es lo que permite reemplazar esa simulación por `fetch()` reales.

## Arquitectura

```
frontend-landing (fetch, credentials:'include')
        │
        ▼
NestJS (backend-core) ─ cookie-parser + CORS (credentials:true)
        │  Controller → Service → SqlService.execute(spName, params)
        ▼
mssql pool (singleton, .env)
        │
        ▼
SQL Server ─ EXEC sp_X @p1, @p2  →  recordset
```

Regla de oro (heredada del spec original del proyecto): el backend NO implementa reglas de
negocio. Cada endpoint ejecuta un único SP y retransmite su recordset.

## Módulos

- `DatabaseModule` (global): lee `.env` vía `@nestjs/config`, crea un único `ConnectionPool` de
  `mssql` al arrancar la app, lo expone como provider inyectable.
- `SqlService`: método genérico `execute(spName: string, params: Record<string, { type, value }>)`
  que arma `pool.request().input(name, type, value)...execute(spName)`. Es el único punto de
  contacto con `mssql`; no existe ningún otro lugar del código que arme texto SQL. Esto hace
  estructuralmente imposible la concatenación de SQL (regla estricta #4 del spec).
- `AuthController` + `AuthService`: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`.
- `StatsController` + `StatsService`: `/api/stats`.
- `UserController` + `UserService`: `/api/me`, `/api/my-databases`.
- Sin guards de Nest que bloqueen requests antes de llegar al SP. El valor de la cookie de sesión
  (o `null` si no existe) siempre se pasa como parámetro al SP correspondiente; es el SP quien
  decide si es válido.

## Contratos de los Stored Procedures

Estos SPs no existen todavía — se diseñan como parte de este entregable (a implementar del lado
SQL Server por separado, este documento fija el contrato que el backend espera).

| SP | Parámetros | Recordset[0] esperado |
|---|---|---|
| `sp_Register` | `@Name varchar, @Email varchar, @Password varchar` | `Success bit, Message varchar, UserId int` |
| `sp_Login` | `@Email varchar, @Password varchar` | `Success bit, Message varchar, UserId int, SessionToken varchar, Name varchar, Email varchar` |
| `sp_GetPlatformStats` | (ninguno) | 6 columnas de estadísticas públicas (nombres definidos del lado SQL; el backend no las interpreta, solo las retransmite) |
| `sp_GetUserInfo` | `@SessionToken varchar` | `Success bit, UserId int, Name varchar, Email varchar` (`Success=0` si el token es inválido o venció) |
| `sp_GetUserDatabases` | `@SessionToken varchar` | filas de bases de datos del usuario, o `Success bit = 0` si no autenticado |

### Manejo de contraseña

El backend pasa el password en texto plano como parámetro parametrizado (nunca lo hashea, nunca lo
valida). El SP hace `HASHBYTES` + salt en T-SQL para generar/comparar el hash. Esto mantiene al
backend sin ninguna lógica de seguridad de negocio. Requiere `SQL_SERVER_ENCRYPT=true` (TLS
obligatorio en la conexión) para no exponer el password en tránsito hacia el SQL Server.

## Sesión

`sp_Login` exitoso → columna `SessionToken` poblada → el backend hace:

```ts
res.cookie('session_token', token, { httpOnly: true, secure: true, sameSite: 'lax' });
```

`/api/me` y `/api/my-databases` leen `req.cookies.session_token` (puede venir `undefined`, en cuyo
caso se pasa `null` al SP) y lo retransmiten sin interpretarlo.

`POST /api/auth/logout`: no está en la tabla de endpoints original del spec, pero el frontend
(`dashboard.js`, botón "Cerrar sesión") lo necesita para completar el ciclo. Es puro transporte:
solo `res.clearCookie('session_token')`, sin llamar ningún SP (no hay revocación de sesión del lado
SQL en este alcance).

## Errores / Códigos HTTP

- `400`: falta un campo obligatorio en el body (chequeo de tipo básico — presencia y tipo string —
  no reglas de negocio como "email ya existe" o "contraseña corta", eso lo decide el SP vía
  `Success`/`Message`).
- `401`: el SP devuelve `Success = 0` en login, `/api/me` o `/api/my-databases`.
- `500`: excepción de conexión a SQL Server o error no controlado del SP (catch genérico, log del
  lado servidor, respuesta `{ error: 'Database error' }`).
- `200`: el resto de los casos — se devuelve el recordset (o su primera fila, según el endpoint) tal
  cual lo entrega el SP.

## CORS

```ts
app.enableCors({ origin: 'https://big-o.andrescortes.dev', credentials: true });
```

`credentials: true` es obligatorio: la cookie httpOnly de sesión es cross-origin (frontend estático
en un origen, backend en otro tras el mismo dominio/proxy en `/api`).

## Variables de entorno (`.env.example`)

```
SQL_SERVER=
SQL_DATABASE=
SQL_USER=
SQL_PASSWORD=
SQL_PORT=1433
SQL_SERVER_ENCRYPT=true
SQL_SERVER_TRUST_SERVER_CERT=false
PORT=3000
CORS_ORIGIN=https://big-o.andrescortes.dev
```

## Entregables

- `package.json`: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/config`,
  `mssql`, `cookie-parser`, `dotenv`.
- `src/`: `database/` (módulo + `SqlService`), `auth/`, `stats/`, `user/`, `main.ts` (bootstrap,
  CORS, cookie-parser).
- `.env.example` (sin secretos reales).
- `Dockerfile` (`node:18-alpine`, `npm run start:prod`).
- Puerto `3000`, expuesto tras el proxy de `big-o.andrescortes.dev/api`.

## Testing

Sin ORM ni entidades de dominio que mockear, y el spec original no pide suite formal. Se documenta
en el README un smoke test manual (curl/Postman) para las 6 rutas contra el VPS real. No se incluye
e2e automatizado en este alcance — decisión explícita del usuario para no sobre-construir sobre un
backend que solo transporta.

## Fuera de alcance (explícito)

- OAuth (Google/GitHub) — se elimina junto con NextAuth.
- Guards/roles/permisos en Nest — los decide el SP.
- Revocación de sesión del lado SQL al hacer logout.
- Rate limiting, microservicios, gateways, cachés de reglas.
- Validación de reglas de negocio (email duplicado, longitud de password, etc.) en el backend.
