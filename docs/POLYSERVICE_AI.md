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

### Procedimiento único con limpieza garantizada

Abrir una PowerShell dedicada después de configurar allí las variables `SQL_*` del entorno
aislado. Ejecutar el bloque completo como una sola unidad: arranque, login, la única llamada
de chat, comprobaciones de respuesta y consulta de metadatos están dentro del mismo `try`; el
`finally` siempre limpia aunque cualquiera de esos pasos lance una excepción.

El query usa el paquete `mssql` ya instalado por el backend y hereda las variables del SQL
aislado. Reemplazar únicamente los placeholders entre `<...>`:

```powershell
$backendProcess = $null
$secureProviderKey = $null
$keyPointer = [IntPtr]::Zero
$plainProviderKey = $null
$testSession = $null
$loginBody = $null
$chatBody = $null
$chatResult = $null
$metadata = $null
$testStartedUtc = [DateTime]::UtcNow

try {
  # Captura sin eco; nunca imprimir, guardar ni pasar la clave por línea de comandos.
  $secureProviderKey = Read-Host 'PolyService key' -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureProviderKey)
  $plainProviderKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:POLYSERVICE_AI_KEY = $plainProviderKey

  # Solo este proceso hijo hereda la clave. Se conserva su objeto/Id para limpieza exacta.
  $backendProcess = Start-Process -FilePath 'node.exe' -ArgumentList 'dist/main.js' `
    -WindowStyle Hidden -PassThru

  # El hijo ya heredó el valor: borrarlo inmediatamente del proceso PowerShell padre.
  Remove-Item Env:POLYSERVICE_AI_KEY -ErrorAction SilentlyContinue
  $plainProviderKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  $keyPointer = [IntPtr]::Zero
  $secureProviderKey.Dispose()
  $secureProviderKey = $null

  # Esperar readiness sin iniciar otra instancia ni continuar si el hijo terminó.
  $ready = $false
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    if ($backendProcess.HasExited) { throw 'Isolated backend exited before readiness' }
    try {
      $statsResponse = Invoke-WebRequest -Uri 'http://localhost:3000/api/stats' `
        -UseBasicParsing -TimeoutSec 2
      $ready = $statsResponse.StatusCode -eq 200
    } catch {
      Start-Sleep -Seconds 1
    }
  } until ($ready -or [DateTime]::UtcNow -ge $readyDeadline)
  if (-not $ready) { throw 'Isolated backend readiness timed out' }

  # Cookie httpOnly solo en memoria, obtenida con una cuenta del SQL aislado.
  $testSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $loginBody = @{ email = '<test-email>'; password = '<test-password>' } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' `
    -ContentType 'application/json' -Body $loginBody -WebSession $testSession

  # Exactamente una llamada al proveedor: un mensaje no sensible y maxTokens 64.
  $chatBody = @{
    messages = @(@{ role = 'user'; content = '<non-sensitive-test-message>' })
    maxTokens = 64
  } | ConvertTo-Json -Depth 4
  $chatResult = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/ai/chat' `
    -ContentType 'application/json' -Body $chatBody -WebSession $testSession

  $responseChecks = [ordered]@{
    FixedModel = $chatResult.model -eq 'llama-8b-nvidia'
    AssistantRole = $chatResult.message.role -eq 'assistant'
    AssistantContentNonEmpty = `
      -not [string]::IsNullOrWhiteSpace([string]$chatResult.message.content)
    PromptUsagePresent = `
      $null -ne $chatResult.usage.promptTokens -and $chatResult.usage.promptTokens -ge 0
    CompletionUsagePresent = `
      $null -ne $chatResult.usage.completionTokens -and $chatResult.usage.completionTokens -ge 0
    TotalUsageConsistent = $chatResult.usage.totalTokens -eq `
      ($chatResult.usage.promptTokens + $chatResult.usage.completionTokens)
  }
  if ($responseChecks.Values -contains $false) {
    throw 'Controlled AI response verification failed'
  }

  # Consulta metadata-only dentro del mismo try. No selecciona prompt ni respuesta.
  $metadataProbe = @'
const sql = require('mssql');
(async () => {
  const pool = await sql.connect({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: Number(process.env.SQL_PORT || 1433),
    options: {
      encrypt: (process.env.SQL_SERVER_ENCRYPT || 'true') === 'true',
      trustServerCertificate:
        (process.env.SQL_SERVER_TRUST_SERVER_CERT || 'false') === 'true'
    }
  });
  const result = await pool.request()
    .input('userId', sql.Int, Number(process.argv[1]))
    .input('testStartedUtc', sql.DateTime2, new Date(process.argv[2]))
    .query(`SELECT TOP (1)
      RequestId, UserId, ReservedAt, CompletedAt, State,
      ProviderStatus, LatencyMs, PromptTokens, CompletionTokens, TotalTokens
      FROM dbo.AiRequests
      WHERE UserId = @userId AND ReservedAt >= @testStartedUtc
      ORDER BY ReservedAt DESC`);
  process.stdout.write(JSON.stringify(result.recordset[0] || null));
  await pool.close();
})().catch(() => {
  process.stderr.write('Metadata query failed');
  process.exit(1);
});
'@
  $metadataJson = & node.exe -e $metadataProbe '<test-user-id>' `
    ($testStartedUtc.ToString('o'))
  if ($LASTEXITCODE -ne 0) { throw 'Metadata query process failed' }
  $metadata = $metadataJson | ConvertFrom-Json

  $metadataChecks = [ordered]@{
    RowPresent = $null -ne $metadata
    Completed = $metadata.State -eq 'completed'
    ProviderStatusOk = $metadata.ProviderStatus -eq 200
    TimestampsPresent = $null -ne $metadata.ReservedAt -and $null -ne $metadata.CompletedAt
    LatencyNonNegative = $null -ne $metadata.LatencyMs -and $metadata.LatencyMs -ge 0
    PromptTokensMatch = $metadata.PromptTokens -eq $chatResult.usage.promptTokens
    CompletionTokensMatch = `
      $metadata.CompletionTokens -eq $chatResult.usage.completionTokens
    TotalTokensMatch = $metadata.TotalTokens -eq $chatResult.usage.totalTokens
    MetadataOnly = @($metadata.PSObject.Properties.Name | Where-Object {
      $_ -match 'PromptContent|ResponseContent|MessageContent'
    }).Count -eq 0
  }
  if ($metadataChecks.Values -contains $false) {
    throw 'Controlled AI metadata verification failed'
  }

  # Imprimir solo booleanos; nunca contenido, cookie, credenciales ni valores sensibles.
  $responseChecks
  $metadataChecks
} finally {
  $chatResult = $null
  $metadata = $null
  $testSession = $null
  $loginBody = $null
  $chatBody = $null
  $plainProviderKey = $null

  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $keyPointer = [IntPtr]::Zero
  }
  if ($secureProviderKey) {
    $secureProviderKey.Dispose()
    $secureProviderKey = $null
  }
  Remove-Item Env:POLYSERVICE_AI_KEY -ErrorAction SilentlyContinue

  $cleanupFailures = @()
  if ($backendProcess) {
    if (-not $backendProcess.HasExited) {
      Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
      Wait-Process -Id $backendProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    $backendProcess.Refresh()
    if (-not $backendProcess.HasExited) {
      $cleanupFailures += 'The specific isolated backend process is still running'
    }
  }
  if (Test-Path Env:POLYSERVICE_AI_KEY) {
    $cleanupFailures += 'Provider key remains in the current process environment'
  }
  if ($cleanupFailures.Count -gt 0) {
    throw ($cleanupFailures -join '; ')
  }
}
```

El `finally` usa exclusivamente `$backendProcess.Id`: no mata procesos por nombre ni afecta
otras instancias. Espera hasta 10 segundos y confirma `HasExited`; también borra y comprueba
la ausencia de `POLYSERVICE_AI_KEY` aunque fallen login, proveedor, validación o SQL. El
reporte registra solo los booleanos, status/metadatos y resultado de limpieza; nunca la clave,
cookie, mensaje de prueba ni contenido del asistente.

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
