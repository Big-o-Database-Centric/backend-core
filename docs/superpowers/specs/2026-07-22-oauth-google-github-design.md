# OAuth Google + GitHub sobre NestJS database-centric — Diseño

Fecha: 2026-07-22
Repos: `backend-core` (NestJS), `frontend-landing` (HTML estático + nginx)

## Contexto

El spec previo (`2026-07-16-nestjs-database-centric-backend-design.md`) descartó el OAuth de
Next.js + NextAuth y dejó auth por email/password contra Stored Procedures. Este documento lo
reincorpora, ahora sobre la arquitectura NestJS.

Estado real encontrado al investigar:

- Los botones Google/GitHub del frontend son decorativos. `views/login.html:161` lo declara:
  `<!-- OAuth buttons (decorative placeholders, not wired to a provider) -->`. Son `<button>`
  sin handler.
- El frontend no llama al backend en absoluto: cero coincidencias de `fetch(`, `axios`,
  `XMLHttpRequest` o `api/` en todo el repo.
- `js/login.js:34-42` simula el login con `setTimeout` y redirige al dashboard sin validar nada.
  `js/register.js:28` redirige directo.
- El backend sí tiene `/api/auth/register|login|logout` funcionando contra SPs, pero nadie los
  llama.
- El dashboard no tiene guard de sesión: `/views/dashboard.html` es accesible por URL directa.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Alcance | Email/password se queda; OAuth se suma |
| Vinculación de cuentas | Vincular por email **solo si el proveedor lo reporta verificado** |
| Topología | Same-origin: `big-o.andrescortes.dev/api/*` → backend `:3000` vía reverse proxy |
| Librería OAuth | Passport (`@nestjs/passport` + estrategias) |
| Protección CSRF (`state`) | State store propio con cookie firmada por HMAC, sin `express-session` |
| `sp_Logout` | Incluido en el alcance |

### Nota sobre la regla de oro

El spec original dice: *"Sin guards de Nest que bloqueen requests antes de llegar al SP."* Esa
regla aplica a guards de **autorización** (validar sesión, decidir acceso). `AuthGuard('google')`
no autoriza: ejecuta el handshake del protocolo OAuth (redirect e intercambio de `code`). Toda
decisión de negocio —¿existe el usuario?, ¿se vincula?, ¿se crea sesión?— sigue viviendo en
`sp_OAuthLogin`. La regla se mantiene intacta.

## Arquitectura

```
Browser  ──GET /api/auth/google──▶  NestJS  ──302──▶  Google consent
                                                          │
Browser  ◀───────────── 302 con ?code=... ────────────────┘
   │
   └──GET /api/auth/google/callback?code=...──▶ NestJS
                                                  │ 1. Passport: code → access_token
                                                  │ 2. Passport: token → perfil
                                                  │ 3. estrategia normaliza a OAuthProfile
                                                  ▼
                                          sp_OAuthLogin(@Provider, @ProviderAccountId,
                                                        @Email, @Name, @EmailVerified)
                                                  │
                                                  ▼ Success + SessionToken
                                          set-cookie session_token
                                          302 → /views/dashboard.html
```

Propiedades del flujo:

- **Es navegación del navegador, no `fetch`.** Los botones son `<a href>`. Por eso la cookie
  `sameSite: 'lax'` funciona: Lax sí se envía en navegación top-level.
- **Un solo SP por callback.** `sp_OAuthLogin` devuelve el mismo recordset que `sp_Login`
  (`Success, Message, UserId, SessionToken, Name, Email`), así el resto del sistema no cambia.
- **Errores por redirect, no por JSON.** Un 401 con JSON le mostraría al usuario texto crudo en
  pantalla blanca. Los rechazos redirigen a `/views/login.html?error=<código>`.

## Cambios de base de datos

Van en `scripts/sql/002-oauth.sql`, idempotente. **No se edita `schema.sql`**: ese archivo
empieza con `DROP TABLE dbo.Users` (línea 9) y volver a correrlo borraría los usuarios. Queda
como instalador limpio.

### Tabla nueva

```sql
CREATE TABLE dbo.UserOAuthAccounts (
    OAuthAccountId    INT IDENTITY(1,1) PRIMARY KEY,
    UserId            INT           NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    Provider          NVARCHAR(20)  NOT NULL,        -- 'google' | 'github'
    ProviderAccountId NVARCHAR(255) NOT NULL,
    LinkedAt          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UX_UserOAuthAccounts UNIQUE (Provider, ProviderAccountId)
);
```

Tabla aparte, no columnas en `Users`. El `auth.sql` viejo guardaba `provider` y
`provider_account_id` en `Users`, lo que amarra un usuario a un solo proveedor: la misma persona
entrando por Google y por GitHub generaría dos filas, y la segunda chocaría contra el `UNIQUE`
de email. Con tabla aparte, un usuario puede tener ambos proveedores vinculados.

### Modificación de `Users`

`PasswordSalt` y `PasswordHash` pasan a nullable. NULL significa cuenta solo-OAuth.

### `sp_OAuthLogin`

Parámetros: `@Provider NVARCHAR(20)`, `@ProviderAccountId NVARCHAR(255)`,
`@Email NVARCHAR(256)`, `@Name NVARCHAR(100)`, `@EmailVerified BIT`.

Lógica:

1. Buscar en `UserOAuthAccounts` por `(Provider, ProviderAccountId)`. Si existe → ese usuario,
   saltar al paso 4.
2. Si no existe y `@EmailVerified = 0` o `@Email IS NULL` → `Success = 0`,
   `Message = 'Email no verificado por el proveedor'`. Corte de seguridad del account linking.
3. Buscar en `Users` por email. Si existe → vincular. Si no → crear usuario con
   `PasswordSalt = NULL, PasswordHash = NULL` y vincular.
4. Crear sesión de 7 días en `Sessions` y devolver el recordset.

Los pasos 3-4 van en transacción con `TRY/CATCH` sobre violación de unique (errores 2627/2601),
igual que `sp_Register`, para que dos logins simultáneos del mismo usuario nuevo no dupliquen fila.

### Corrección de seguridad en `sp_Login`

`schema.sql:92` compara así:

```sql
IF @UserId IS NULL OR @StoredHash <> HASHBYTES('SHA2_256', CONVERT(NVARCHAR(36), @Salt) + @Password)
```

Hoy `PasswordHash` es `NOT NULL`, así que el caso no se da. Al volverlo nullable se vuelve
explotable: si `@StoredHash` es NULL, `NULL <> algo` evalúa a NULL (no TRUE), entonces
`false OR NULL` no entra al bloque de rechazo y el procedimiento **cae a crear sesión**.
Resultado: cualquiera entraría a una cuenta solo-OAuth escribiendo ese email con una contraseña
inventada.

Corrección obligatoria, en el mismo cambio que vuelve nullable la columna:

```sql
IF @UserId IS NULL OR @StoredHash IS NULL OR @StoredHash <> HASHBYTES('SHA2_256', ...)
```

### `sp_Logout`

`auth.controller.ts:33-37` solo borra la cookie; la fila en `Sessions` sigue válida sus 7 días.
Un token copiado antes del logout sigue funcionando. `sp_Logout(@SessionToken)` borra la fila y
el controller lo invoca antes de limpiar la cookie.

## Estructura del backend

```
src/auth/
  auth.controller.ts              (mod: + 4 rutas OAuth, logout llama SP)
  auth.service.ts                 (mod: + oauthLogin(), + logout())
  auth.module.ts                  (mod: registra estrategias)
  strategies/
    google.strategy.ts            (nuevo)
    github.strategy.ts            (nuevo)
  oauth/
    oauth-profile.interface.ts    (nuevo)
    signed-state.store.ts         (nuevo)
```

Dependencias nuevas: `@nestjs/passport`, `passport`, `passport-google-oauth20`,
`passport-github2`, más `@types/passport-google-oauth20` y `@types/passport-github2` en dev.

### El contrato que aísla los proveedores

```ts
export interface OAuthProfile {
  provider: 'google' | 'github';
  providerAccountId: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
}
```

Cada estrategia traduce su proveedor a esta forma. El controller nunca ve la respuesta cruda de
Google ni la de GitHub. Agregar un tercer proveedor es un archivo nuevo en `strategies/` sin
tocar nada más.

Particularidades encerradas en cada estrategia:

- `google.strategy.ts` — lee `profile._json.email_verified`.
- `github.strategy.ts` — GitHub no entrega el flag de verificación en el perfil. Requiere scope
  `['user:email']` y una llamada extra a `GET https://api.github.com/user/emails` con el access
  token, para localizar el email `primary` y leer su campo `verified`. Es obligatoria por la
  decisión de vincular solo con email verificado.

### Rutas

`GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/github`,
`GET /api/auth/github/callback`.

Las dos rutas de inicio tienen cuerpo vacío a propósito: el guard redirige antes de entrar al
método.

```ts
@Get('google')
@UseGuards(AuthGuard('google'))
googleStart(): void {}

@Get('google/callback')
@UseGuards(AuthGuard('google'))
async googleCallback(@Req() req: Request, @Res() res: Response) {
  return this.finishOAuth(req.user as OAuthProfile, res);
}
```

Los dos callbacks comparten un método privado `finishOAuth(profile, res)`: llama
`sp_OAuthLogin`; si `Success` pone la cookie de sesión y redirige al dashboard, si no redirige a
login con `?error=`.

`auth.service.ts` mantiene la regla de oro: `oauthLogin()` y `logout()` son cada uno una llamada
a `sqlService.execute()` que retransmite el recordset, sin lógica.

### State store con cookie firmada

`signed-state.store.ts` implementa la interfaz `store(req, meta, cb)` / `verify(req, state, meta, cb)`
que acepta `passport-oauth2`.

- `store()`: genera un nonce aleatorio, lo firma con HMAC-SHA256 usando `AUTH_SECRET`, lo guarda
  en cookie httpOnly + secure + sameSite lax con vida ~10 min, y devuelve el nonce como `state`.
- `verify()`: lee la cookie, recalcula la firma y compara con `crypto.timingSafeEqual`.

Se eligió sobre `express-session` porque no agrega dependencia, no mantiene estado en memoria y
sobrevive reinicios del contenedor. Desactivar `state` no es opción: deja el callback expuesto a
CSRF.

## Frontend

### Botones OAuth

Pasan de `<button>` decorativo a enlace, conservando las clases CSS (aspecto idéntico):

```html
<a href="/api/auth/google" class="..."><!-- svg -->Google</a>
```

En `views/login.html` y `views/register.html`. Se eliminan los comentarios que los declaran
decorativos.

### `js/login.js`

Se elimina el mock `setTimeout` completo. Entra la llamada real:

```js
const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email, password }),
});
```

Éxito → `/views/dashboard.html`. Fallo → mensaje de error visible. **Hoy no existe ningún
elemento donde mostrar errores**; hay que agregarlo al markup de login y register.

Además lee `?error=` de la URL para mostrar rechazos de OAuth.

### `js/register.js`

Igual, contra `POST /api/auth/register`.

### `js/dashboard.js`

Guard de sesión, inexistente hoy: al cargar, `fetch('/api/me', { credentials: 'include' })`; si
`Success` es falso, redirige a login. Sin esto el dashboard sigue accesible por URL directa.

El botón de logout pasa a llamar `POST /api/auth/logout` antes de redirigir, para que `sp_Logout`
invalide la sesión del lado servidor.

## Testing

Los tests actuales de `tests/login.spec.ts` afirman el comportamiento del mock
(`getByText('Verifying...')`, comentario `// El mock tarda ~2.1s`). Al conectar el backend real
dejan de tener sentido y se reescriben.

Estrategia: interceptar la red con `page.route()` de Playwright para simular respuestas del
backend. Así los E2E corren sin depender del VPS ni de credenciales OAuth reales.

Casos a cubrir:

- Login correcto → redirige a dashboard.
- Login incorrecto → muestra error, no redirige.
- Dashboard sin sesión (`/api/me` devuelve `Success: false`) → redirige a login.
- Logout → llama al endpoint y vuelve a login.
- Botones OAuth apuntan a `/api/auth/google` y `/api/auth/github`.
- Landing con `?error=oauth_email_not_verified` → muestra el mensaje.

Del lado backend, tests unitarios de las estrategias verificando la normalización a
`OAuthProfile`, incluido el caso de GitHub con email no verificado.

## Configuración y despliegue

### Variables de entorno nuevas

`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`PUBLIC_BASE_URL` (para construir las URLs de callback). Se agregan a `.env.example` y al
workflow de deploy.

### CORS

Al quedar todo bajo el mismo origen, el `enableCors` de `main.ts:14-17` deja de ser necesario
para el navegador. Se mantiene igual —no estorba y cubre el caso de desarrollo local, donde el
frontend puede servirse desde otro puerto—. No se modifica en este trabajo.

### Trabajo manual fuera del código

1. **nginx del VPS** — `location /api/ { proxy_pass http://127.0.0.1:3000; }`, el resto al 8081.
   Sin esto no hay same-origin. Nota: el `nginx.conf` del repo `frontend-landing` es el de dentro
   del contenedor, no el del VPS; el reverse proxy se configura en el servidor.
2. **Google Cloud Console** — registrar callback
   `https://big-o.andrescortes.dev/api/auth/google/callback`.
3. **GitHub OAuth App** — registrar callback
   `https://big-o.andrescortes.dev/api/auth/github/callback`.

Los secrets `AUTH_GOOGLE_ID/SECRET` y `AUTH_GITHUB_ID/SECRET` ya existen en GitHub desde la etapa
Next.js, así que probablemente solo haga falta actualizar las URLs de callback en cada consola.

### Workflow de deploy

`main` no tiene workflow: `.github/workflows` está vacío. El `deploy.yml` solo existe en la rama
`origin-main-nextjs` y **sus nombres de variable no coinciden** con los que lee este backend:

| Workflow Next.js | `.env.example` NestJS |
|---|---|
| `SQL_SERVER_HOST` | `SQL_SERVER` |
| `SQL_SERVER_PORT` | `SQL_PORT` |
| `SQL_SERVER_USER` | `SQL_USER` |
| `SQL_SERVER_PASSWORD` | `SQL_PASSWORD` |
| `SQL_SERVER_DATABASE` | `SQL_DATABASE` |

Copiarlo tal cual produce un backend que arranca y no conecta a la base. El workflow nuevo usa
los nombres correctos y agrega las variables OAuth.

## Fuera de alcance

- Desvincular un proveedor de una cuenta ya creada.
- Vincular un segundo proveedor desde el dashboard estando ya logueado (el schema lo soporta,
  pero no hay UI).
- Refresh tokens y renovación de sesión.
- Recuperación de contraseña.
