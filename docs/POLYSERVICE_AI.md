# Integración de PolyService AI

Esta guía describe el contrato operativo de la IA administrada de Big O. La integración es
backend-to-backend: el navegador se autentica con Big O y el backend llama a PolyService.

## Propiedad y manejo de la credencial

Big O administra una sola credencial del proveedor en el backend mediante
`POLYSERVICE_AI_KEY`. Los usuarios registrados **nunca configuran, reciben ni pueden consultar**
esa credencial. No debe aparecer en el código, logs, respuestas HTTP, almacenamiento del
navegador, Dockerfile ni archivos `.env` versionados. Tampoco se debe enviar desde el navegador
una petición directa a PolyService.

Para desarrollo local, inyectar la credencial solo en un archivo `.env` ignorado o en el
proceso actual:

```dotenv
POLYSERVICE_AI_KEY=<secret>
```

No sustituir `<secret>` en documentación, capturas, reportes ni commits.

## Configuración

| Variable | Requerida | Valor por defecto | Uso |
|---|---:|---:|---|
| `POLYSERVICE_AI_KEY` | Sí | — | Credencial backend-to-backend. El proceso falla al iniciar si falta. |
| `POLYSERVICE_AI_BASE_URL` | No | `https://ia.polyrepo.andrescortes.dev` | Base del proveedor; el backend añade `/v1/chat/completions`. |
| `AI_USER_PER_MINUTE` | No | `3` | Reservas máximas por usuario en el minuto UTC actual. |
| `AI_USER_PER_DAY` | No | `10` | Reservas máximas por usuario en el día UTC actual. |
| `AI_GLOBAL_PER_MINUTE` | No | `9` | Reservas máximas de toda la plataforma en el minuto UTC actual. |
| `AI_GLOBAL_PER_DAY` | No | `90` | Reservas máximas de toda la plataforma en el día UTC actual. |

Los cuatro límites aceptan únicamente enteros positivos seguros. Un valor ausente, cero,
negativo, fraccionario o fuera del rango seguro de JavaScript usa el valor por defecto.
Las demás variables de SQL, sesión, OAuth y CORS continúan siendo necesarias según
`.env.example`.

## Autenticación y flujo

1. El usuario inicia sesión en Big O y recibe la cookie httpOnly `session_token`.
2. El navegador consulta `GET /api/ai/capabilities` con `credentials: 'include'`.
3. Para cada mensaje, el backend reserva cuota atómicamente en SQL Server antes de llamar al proveedor.
4. El backend llama al modelo fijo `llama-8b-nvidia`, registra metadatos de finalización y devuelve una respuesta neutral.

No se acepta una clave del proveedor por header, cookie o body. Solo se propaga la cookie
`session_token` hacia los procedimientos almacenados de autorización.

## API HTTP

Todas las rutas requieren una sesión de Big O vigente.

### `GET /api/ai/capabilities`

Petición:

```http
GET /api/ai/capabilities HTTP/1.1
Cookie: session_token=<session-token>
```

Respuesta `200`:

```json
{
  "models": ["llama-8b-nvidia"],
  "defaultModel": "llama-8b-nvidia",
  "maxTokens": 512,
  "defaultMaxTokens": 256,
  "perUser": {
    "perMinute": 3,
    "perDay": 10
  },
  "remaining": {
    "today": 9
  }
}
```

`remaining.today` es el número de nuevas reservas que el usuario puede realizar durante el
día UTC actual. Este endpoint no reserva ni consume cuota. Los límites globales no se exponen.

### `POST /api/ai/chat`

Petición:

```http
POST /api/ai/chat HTTP/1.1
Content-Type: application/json
Cookie: session_token=<session-token>

{
  "messages": [
    { "role": "user", "content": "Resume el concepto de índice compuesto." }
  ],
  "maxTokens": 64
}
```

Respuesta `200`:

```json
{
  "model": "llama-8b-nvidia",
  "message": {
    "role": "assistant",
    "content": "<assistant-content>"
  },
  "usage": {
    "promptTokens": 18,
    "completionTokens": 42,
    "totalTokens": 60
  },
  "remaining": {
    "today": 8
  }
}
```

Restricciones de entrada:

| Campo | Regla |
|---|---|
| `messages` | Arreglo requerido de 1 a 10 elementos. |
| `messages[].role` | Uno de `system`, `user` o `assistant`. |
| `messages[].content` | Texto de 1 a 4.000 caracteres; se recortan espacios en los extremos y no puede quedar vacío. |
| Contenido agregado | Máximo 12.000 caracteres después del recorte. |
| `maxTokens` | Entero opcional entre 1 y 512; por defecto `256`. |

## Cuotas

SQL Server aplica las cuatro cuotas dentro de una transacción y un bloqueo compartido de
aplicación. Así, dos procesos backend no pueden sobreasignar capacidad simultáneamente.

| Alcance | Ventana | Default | Resultado cuando se alcanza |
|---|---|---:|---|
| Usuario | Minuto calendario UTC | 3 | `429`, `User AI quota reached` |
| Usuario | Día calendario UTC | 10 | `429`, `User AI quota reached` |
| Plataforma | Minuto calendario UTC | 9 | `429`, `Global AI quota reached` |
| Plataforma | Día calendario UTC | 90 | `429`, `Global AI quota reached` |

Una reserva consume cuota antes de contactar al proveedor. Por diseño, una llamada que luego
falla o expira también cuenta durante su ventana: su fila pasa de `reserved` a `failed`.
`remaining.today` refleja únicamente la cuota diaria del usuario; todavía puede haber un
bloqueo temporal por minuto o por cuota global.

## Errores seguros

| HTTP | Causa | Respuesta segura del backend |
|---:|---|---|
| `400` | DTO inválido, contenido vacío tras recorte o más de 12.000 caracteres agregados | Error de validación o `AI request is too large`; no se reserva cuota para la validación de tamaño adicional. |
| `401` | Cookie ausente, inválida o expirada | `{"message":"Unauthorized","statusCode":401}` |
| `429` | Cuota local de usuario/plataforma | Cadena JSON `"User AI quota reached"` o `"Global AI quota reached"`. |
| `429` | PolyService devuelve límite de proveedor | `"AI service quota reached"`. |
| `502` | Fallo upstream o respuesta inválida | `{"message":"AI service unavailable","error":"Bad Gateway","statusCode":502}` |
| `503` | Credencial rechazada por el proveedor | `{"message":"AI service unavailable","error":"Service Unavailable","statusCode":503}` |
| `504` | Tiempo de espera del proveedor superior a 35 s | `{"message":"AI service timeout","error":"Gateway Timeout","statusCode":504}` |
| `500` | Fallo inesperado de SQL/control interno | Respuesta genérica; nunca contiene la credencial ni detalles del proveedor. |

Los mensajes del proveedor no se retransmiten. La interfaz también transforma estos estados
en textos seguros y redirige al login ante `401`.

## Persistencia y privacidad

El backend y SQL Server **no persisten prompts ni respuestas**. La tabla `dbo.AiRequests`
guarda solamente:

- identificadores de solicitud y usuario;
- timestamps UTC de reserva y finalización;
- estado (`reserved`, `completed` o `failed`);
- status HTTP del proveedor y latencia;
- conteos de tokens de prompt, respuesta y total.

El navegador conserva la conversación solo en memoria de la pestaña. No usa `localStorage`
ni `sessionStorage`; recargar o pulsar «Nueva conversación» elimina el transcript local.

## Verificación local sin proveedor real

Instalar dependencias y comprobar el backend:

```powershell
npm.cmd test -- --runInBand
npm.cmd run build
```

Las pruebas unitarias simulan repositorio y proveedor; verifican autorización, reservas,
límites, traducción de errores, ausencia de contenido en SQL y manejo seguro de la credencial.

## Prueba controlada con proveedor real

Esta prueba es una puerta de publicación y se ejecuta una sola vez, únicamente cuando existen
todos estos prerrequisitos:

- SQL Server local, desechable y aislado, con las migraciones aplicadas; las variables
  `SQL_*` deben apuntar a ese entorno y **nunca** a SQL de producción;
- un usuario de prueba local y una cookie autenticada obtenida contra ese mismo backend;
- la credencial de PolyService disponible mediante un canal seguro, sin guardarla en `.env`,
  archivos, portapapeles compartidos, historial de shell ni línea de comandos;
- puerto local disponible y build del backend terminado con `npm.cmd run build`.

SQL de producción no es un sustituto aceptable para ningún paso. Si falta un prerrequisito,
registrar la prueba como pendiente y detenerse.

### 1. Inyectar la clave solo en el proceso y arrancar el backend aislado

Abrir una PowerShell dedicada, después de configurar allí las variables `SQL_*` del entorno
aislado. Capturar la clave sin eco, iniciar el proceso hijo para que herede la variable y
eliminarla inmediatamente del proceso padre:

```powershell
$secureProviderKey = Read-Host 'PolyService key' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureProviderKey)
try {
  $plainProviderKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:POLYSERVICE_AI_KEY = $plainProviderKey
  $backendProcess = Start-Process -FilePath 'node.exe' -ArgumentList 'dist/main.js' `
    -WindowStyle Hidden -PassThru
} finally {
  $plainProviderKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  $secureProviderKey.Dispose()
  Remove-Item Env:POLYSERVICE_AI_KEY -ErrorAction SilentlyContinue
}
```

No imprimir la variable, inspeccionar el environment del proceso hijo ni redirigirlo a un
archivo. Confirmar que `GET http://localhost:3000/api/stats` responde antes de continuar.

### 2. Crear la sesión de prueba sin mostrar la cookie

Usar una cuenta que exista solo en el SQL aislado. `WebRequestSession` conserva la cookie
httpOnly en memoria y evita copiarla a la terminal:

```powershell
$testSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ email = '<test-email>'; password = '<test-password>' } | ConvertTo-Json
$null = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' `
  -ContentType 'application/json' -Body $loginBody -WebSession $testSession
```

### 3. Enviar exactamente una solicitud al proveedor

Hacer una sola llamada a `/api/ai/chat`, con un único mensaje no sensible y
`maxTokens: 64`. Conservar la respuesta solo en memoria y producir únicamente verificaciones
booleanas; no imprimir ni guardar el contenido del asistente:

```powershell
$chatBody = @{
  messages = @(@{ role = 'user'; content = '<non-sensitive-test-message>' })
  maxTokens = 64
} | ConvertTo-Json -Depth 4
$chatResult = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/ai/chat' `
  -ContentType 'application/json' -Body $chatBody -WebSession $testSession

$checks = [ordered]@{
  FixedModel = $chatResult.model -eq 'llama-8b-nvidia'
  AssistantRole = $chatResult.message.role -eq 'assistant'
  AssistantContentNonEmpty = -not [string]::IsNullOrWhiteSpace([string]$chatResult.message.content)
  PromptUsagePresent = $null -ne $chatResult.usage.promptTokens -and $chatResult.usage.promptTokens -ge 0
  CompletionUsagePresent = $null -ne $chatResult.usage.completionTokens -and $chatResult.usage.completionTokens -ge 0
  TotalUsageConsistent = $chatResult.usage.totalTokens -eq `
    ($chatResult.usage.promptTokens + $chatResult.usage.completionTokens)
}
if ($checks.Values -contains $false) { throw 'Controlled AI response verification failed' }
$checks
```

### 4. Verificar la fila SQL sin contenido

En el SQL aislado, consultar la fila más reciente del usuario de prueba creada después de
iniciar el test:

```sql
SELECT TOP (1)
    RequestId, UserId, ReservedAt, CompletedAt, State,
    ProviderStatus, LatencyMs, PromptTokens, CompletionTokens, TotalTokens
FROM dbo.AiRequests
WHERE UserId = <test-user-id>
  AND ReservedAt >= <test-start-utc>
ORDER BY ReservedAt DESC;
```

Verificar `State = 'completed'`, `ProviderStatus = 200`, timestamps presentes, latencia no
negativa y los mismos tres conteos de tokens. La tabla no debe tener columnas ni valores de
prompt/respuesta; no añadirlos al query, captura o reporte.

### 5. Limpiar siempre

Después de verificar —o en un bloque `finally` si algo falla— borrar las referencias en
memoria, detener únicamente el backend local iniciado para la prueba y volver a asegurar que
la variable no existe en el proceso actual:

```powershell
$chatResult = $null
$testSession = $null
if ($backendProcess -and -not $backendProcess.HasExited) {
  Stop-Process -Id $backendProcess.Id
}
Remove-Item Env:POLYSERVICE_AI_KEY -ErrorAction SilentlyContinue
if (Test-Path Env:POLYSERVICE_AI_KEY) { throw 'Provider key cleanup failed' }
```

El reporte registra solamente el resultado de las comprobaciones, status/metadatos y la
limpieza; nunca la clave, el mensaje de prueba ni el contenido del asistente.

## Publicación segura

Detenerse en la puerta de publicación hasta tener aprobación explícita y evidencia de tests,
builds, E2E, escaneo de secretos, capacidad del VPS y prueba controlada. Después, el orden es:

1. Rotar la credencial de PolyService; no reutilizar una credencial expuesta durante desarrollo.
2. Añadir el valor rotado como secreto de GitHub `POLYSERVICE_AI_KEY` sin imprimirlo.
3. Configurar, solo si se quieren cambiar los defaults, las variables `AI_USER_PER_MINUTE`,
   `AI_USER_PER_DAY`, `AI_GLOBAL_PER_MINUTE` y `AI_GLOBAL_PER_DAY`.
4. Publicar primero el backend. Su contenedor candidato se conecta a SQL Server y aplica en
   orden las migraciones aditivas, incluida `scripts/sql/004-ai-usage.sql`; solo una migración
   y health check exitosos permiten reemplazar el contenedor activo.
5. Verificar en producción autenticación, `GET /api/ai/capabilities`, métricas y ausencia de
   secretos en logs/respuestas, sin enviar contenido sensible.
6. Publicar el frontend únicamente después de que el backend compatible esté saludable.

No cambiar secretos, SQL, contenedores, VPS ni ramas remotas como parte de una verificación
local. Un fallo del candidato debe bloquear el frontend y conservar el backend anterior.
