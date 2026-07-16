# Backend Core - Auth Module

## Overview

Este módulo provee la autenticación OAuth2 con Google y GitHub usando **NextAuth.js v5** con estrategia JWT. Toda la lógica de persistencia se ejecuta en SQL Server mediante Stored Procedures (Database-Centric Architecture).

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│ NextAuth.js v5 (JWT Strategy)                               │
│  - providers: Google, GitHub                                │
│  - callbacks: signIn, jwt, session                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Repositories (DIP - Inversión de Dependencias)              │
│  - IUserRepository (interface)                              │
│  - ISessionRepository (interface)                           │
│  - IAuditRepository (interface)                             │
│  - SqlServer*Repository (implementaciones)                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ SQL Server (Stored Procedures)                              │
│  - sp_UpsertOAuthUser                                       │
│  - sp_FindUserByProvider                                    │
│  - sp_FindUserById                                          │
│  - sp_UpdateLastLogin                                       │
│  - sp_CreateSession                                         │
│  - sp_FindSession                                           │
│  - sp_RevokeSession                                         │
│  - sp_LogAudit                                              │
└─────────────────────────────────────────────────────────────┘
```

## Setup para tu compañero (OAuth Integration)

### 1. Configurar Google OAuth

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear nuevo proyecto o seleccionar existente
3. Habilitar **Google+ API**
4. Ir a **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configurar **Authorized redirect URIs**:
   ```
   https://tu-dominio.com/api/auth/callback/google
   ```
6. Copiar `Client ID` y `Client Secret`
7. Añadir a `.env.local`:
   ```bash
   AUTH_GOOGLE_ID=tu-client-id
   AUTH_GOOGLE_SECRET=tu-client-secret
   ```

### 2. Configurar GitHub OAuth

1. Ir a [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. **New OAuth App**
3. **Application name**: Backend Core Auth
4. **Homepage URL**: https://tu-dominio.com
5. **Authorization callback URL**:
   ```
   https://tu-dominio.com/api/auth/callback/github
   ```
6. **Generate a new client secret**
7. Copiar `Client ID` y `Client Secret`
8. Añadir a `.env.local`:
   ```bash
   AUTH_GITHUB_ID=tu-client-id
   AUTH_GITHUB_SECRET=tu-client-secret
   ```

### 3. Configurar SQL Server

Asegurar que los Stored Procedures existen en la base de datos. Ver `scripts/sql/auth.sql` en el repo.

```bash
# Variables de entorno necesarias
SQL_SERVER_HOST=your-vps-host.com
SQL_SERVER_PORT=1433
SQL_SERVER_USER=your-db-user
SQL_SERVER_PASSWORD=your-db-password
SQL_SERVER_DATABASE=database_centric_platform
```

### 4. Generar AUTH_SECRET

```bash
openssl rand -base64 32
```

Añadir a `.env.local`:
```bash
AUTH_SECRET=generado-con-openssl
```

## Endpoints Disponibles

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/auth/providers` | Lista providers disponibles |
| GET | `/api/auth/signin` | Página de login |
| POST | `/api/auth/callback/google` | Callback de Google OAuth |
| POST | `/api/auth/callback/github` | Callback de GitHub OAuth |
| GET | `/api/health` | Health check |

## Flujo de Autenticación

```
1. Usuario hace clic en "Login con Google/GitHub"
   │
   ▼
2. Redirige a proveedor OAuth
   │
   ▼
3. Usuario autoriza
   │
   ▼
4. Proveedor redirige a /api/auth/callback/{provider}
   │
   ▼
5. NextAuth ejecuta signIn callback
   │
   ├──→ upsertOAuthUser() → sp_UpsertOAuthUser (SQL Server)
   ├──→ logAudit() → sp_LogAudit (SQL Server)
   │
   ▼
6. NextAuth ejecuta jwt callback
   │
   ├──→ findByProvider() → sp_FindUserByProvider
   ├──→ updateLastLogin() → sp_UpdateLastLogin
   │
   ▼
7. JWT firmado con payload del usuario
   │
   ▼
8. session callback → expone datos al cliente
   │
   ▼
9. Usuario redirigido a /dashboard
```

## Estructura de Archivos

```
src/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── [...nextauth]/route.ts  # NextAuth handlers
│   │   │   └── providers/route.ts      # Lista providers
│   │   └── health/route.ts             # Health check
│   ├── layout.tsx
│   └── page.tsx
├── config/
│   └── env.ts                          # Validación de vars con zod
├── db/
│   └── sqlserver.ts                    # Pool mssql + helpers
├── domain/
│   ├── entities.ts                     # Tipos (User, AuthSession, AuditLog)
│   └── contracts/
│       ├── IUserRepository.ts          # Interface
│       └── ISessionRepository.ts       # Interfaces
├── repositories/
│   ├── SqlServerUserRepository.ts      # Impl SQL Server
│   ├── SqlServerSessionRepository.ts
│   └── SqlServerAuditRepository.ts
└── lib/
    └── auth/
        ├── config.ts                   # NextAuth config
        ├── providers.ts                # Google + GitHub providers
        ├── callbacks.ts                # signIn/jwt/session callbacks
        └── repository.factory.ts       # Dependency injection
```

## Scripts SQL Server

Ver `scripts/sql/auth.sql` para los Stored Procedures necesarios. Cada SP debe:
- Usar parámetros (nunca concatenación SQL)
- Manejar transacciones
- Retornar resultados consistentes
- Registrar errores en tabla de auditoría

## Comandos

```bash
# Desarrollo
npm run dev

# Build
npm run build

# Lint
npm run lint

# Typecheck
npx tsc --noEmit
```

## Pruebas

1. Iniciar servidor: `npm run dev`
2. Acceder a `http://localhost:3000/api/auth/providers`
3. Verificar que devuelve `["google", "github"]`
4. Probar login con cada provider
5. Verificar tabla `Users` en SQL Server después del login
6. Verificar tabla `AuditLog` con el evento de login

## Seguridad

- ✅ OAuth2 con proveedores verificados
- ✅ JWT firmado con AUTH_SECRET
- ✅ HTTPS obligatorio en producción
- ✅ Parámetros en SPs (no concatenación SQL)
- ✅ Rate limiting pendiente (implementar en gateway)
- ✅ Middleware protege rutas `/dashboard` y `/api/dashboard`

## Próximos Pasos (Post-Auth)

1. Implementar SPs de provisioning de MySQL
2. Añadir endpoints de dashboard
3. Implementar rate limiting por IP/usuario
4. Configurar SSL/TLS en VPS
5. Implementar logging centralizado

## Contacto

Para dudas sobre la integración OAuth, revisar `src/lib/auth/callbacks.ts` y `src/lib/auth/providers.ts`.