# Backend Core - Database-Centric Platform API

Plataforma de hosting de bases de datos para desarrolladores. **Backend tipo API** con arquitectura Database-Centric: toda la lógica de negocio reside en SQL Server (Stored Procedures), el backend solo media comunicación HTTP.

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Auth**: NextAuth.js v5 (OAuth2: Google + GitHub)
- **Database**: Microsoft SQL Server (lógica de negocio vía SPs)
- **Driver**: `mssql` + `zod` para validación

## Arquitectura

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│  Next.js API │────▶│  SQL Server  │
│  (Frontend)  │     │  (Middleware)│     │  (Stored Procs)│
└──────────────┘     └──────────────┘     └──────────────┘
```

**Regla de Oro**: El backend NO implementa reglas de negocio. Solo:
1. Recibe petición HTTP
2. Invoca SP con parámetros
3. Retorna respuesta estructurada

## Configuración

### 1. Clonar y dependencias

```bash
git clone <repo>
cd backend-core
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Editar `.env.local` con:
- `AUTH_SECRET` (generar con `openssl rand -base64 32`)
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `SQL_SERVER_*` (conexión a VPS)

### 3. Base de datos

Ejecutar `scripts/sql/auth.sql` en SQL Server para crear tablas y SPs.

### 4. Desarrollo

```bash
npm run dev
```

API disponible en `http://localhost:3000`

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | API info |
| GET | `/api/health` | Health check |
| GET | `/api/auth/providers` | Lista OAuth providers |
| GET/POST | `/api/auth/*` | NextAuth handlers |

## Estructura

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── auth/providers/route.ts
│   │   └── health/route.ts
│   ├── layout.tsx
│   └── page.tsx
├── config/
│   └── env.ts
├── db/
│   └── sqlserver.ts
├── domain/
│   ├── entities.ts
│   └── contracts/
│       ├── IUserRepository.ts
│       └── ISessionRepository.ts
├── repositories/
│   ├── SqlServerUserRepository.ts
│   ├── SqlServerSessionRepository.ts
│   └── SqlServerAuditRepository.ts
└── lib/
    └── auth/
        ├── config.ts
        ├── providers.ts
        ├── callbacks.ts
        └── repository.factory.ts
```

## Scripts

```bash
npm run dev      # Desarrollo
npm run build    # Build para producción
npm run lint     # ESLint
npm start        # Servidor de producción
```

## Handoff

Ver `HANDOFF.md` para instrucciones de integración OAuth con tu compañero.

Ver `scripts/sql/auth.sql` para SPs de base de datos.

## Seguridad

- ✅ OAuth2 con Google/GitHub
- ✅ JWT firmado
- ✅ Parámetros en SPs (no SQL concatenación)
- ✅ HTTPS obligatorio en producción
- ⚠️ Rate limiting pendiente (implementar en gateway)

## Próximos pasos

1. Integrar OAuth providers (companion task)
2. Implementar SPs de provisioning MySQL
3. Dashboard endpoints
4. Rate limiting por IP/usuario
5. SSL/TLS en VPS

## Licencia

MIT