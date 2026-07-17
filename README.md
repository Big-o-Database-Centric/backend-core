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
