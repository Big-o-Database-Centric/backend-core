# MySQL y PostgreSQL MVP Design

## Objetivo

Habilitar de forma segura la creación de bases MySQL y PostgreSQL en el VPS actual, sin interrumpir la web ni el SQL Server de control.

## Reglas de negocio

- Un usuario no puede tener más de tres bases activas.
- Cada base tiene una cuota de datos de 20 MiB.
- El usuario de la base es exactamente el email del usuario autenticado y la contraseña se genera aleatoriamente y se cifra en SQL Server.

## Alcance del MVP

- Motores habilitados: MySQL y PostgreSQL.
- MongoDB y SQL Server de usuarios responden como motores no disponibles hasta una ampliación de capacidad.
- Límite técnico global: dos reservas o bases activas en total. Es una protección temporal del VPS, no reemplaza la regla de tres bases por usuario.
- Cada instancia MySQL se ejecuta con un máximo de 512 MiB y 0.5 CPU; PostgreSQL con 256 MiB y 0.5 CPU.

## Almacenamiento y cuota

El VPS no tiene un disco secundario. Se crea un archivo de 4 GiB en el disco principal, con tamaño fijo, y se monta como un dispositivo loop XFS en `/srv/big-o/instances` con `prjquota`. El archivo se reserva por completo, por lo que no puede llenar el disco principal progresivamente. El VPS conserva aproximadamente 20 GiB libres después de reservarlo.

La configuración persistente incluye la entrada del loop y de XFS en `/etc/fstab`. Se crea una copia fechada de `/etc/fstab` antes de modificarlo. Las aplicaciones actuales no cambian de volumen ni se reinician durante esta preparación.

El ayudante de cuota existente crea un proyecto XFS por instancia, mide el almacenamiento inicial tras inicializar el motor y aplica `baseline + 20 MiB`. Si falla cualquier paso, elimina el contenedor, el proyecto de cuota y el directorio de la instancia.

## Admisión y recursos

`sp_ReserveManagedDatabase` recibe un máximo global y, dentro del bloqueo de aplicación existente, rechaza reservas cuando hay dos estados `pending` o `active` en total. Conserva el límite de tres por usuario.

El servicio valida que el motor esté en `MANAGED_DATABASE_ENABLED_ENGINES` antes de reservar. La capa Docker añade límites de memoria y CPU por motor. Docker conserva las bases en la red privada; el host devuelto es `MANAGED_DATABASE_HOST`.

## Despliegue seguro

El workflow recibe estas variables de GitHub:

- `MANAGED_DATABASE_HOST=91.99.146.122`
- `MANAGED_DATABASE_DATA_ROOT=/srv/big-o/instances`
- `MANAGED_DATABASE_ENABLED_ENGINES=mysql,postgresql`
- `MANAGED_DATABASE_MAX_TOTAL=2`

El backend mantiene el despliegue candidato y la reversión automática actual. El despliegue no se publica si el candidato no responde a `/api/stats`.

## Pruebas de aceptación

1. El usuario autenticado puede crear MySQL o PostgreSQL y recibe host, puerto, su email y una contraseña aleatoria.
2. MongoDB y SQL Server se rechazan como no disponibles en el MVP.
3. Con `MANAGED_DATABASE_MAX_TOTAL=2`, la tercera reserva global se rechaza sin crear contenedor. Una prueba aislada del procedimiento con un máximo global superior confirma que la cuarta reserva del mismo usuario se rechaza por la regla de negocio existente.
4. La conexión con las credenciales devueltas funciona para MySQL y PostgreSQL.
5. El almacenamiento de una instancia no puede superar su línea base más 20 MiB.
6. La web y `/api/stats` responden correctamente antes y después del despliegue.
