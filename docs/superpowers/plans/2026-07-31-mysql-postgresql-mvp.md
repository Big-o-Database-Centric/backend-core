# MySQL y PostgreSQL MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar un MVP seguro de MySQL y PostgreSQL con cuota de 20 MiB en el VPS actual sin interrumpir la web ni el SQL Server de control.

**Architecture:** El backend filtra motores mediante configuración, reserva capacidad global dentro del procedimiento SQL bloqueado y crea contenedores con límites por motor. Un volumen loop XFS fijo aloja solo los datos administrados y el ayudante de cuota existente aplica el límite tras inicializar cada motor. El frontend obtiene los motores disponibles desde el backend para no ofrecer servicios deshabilitados.

**Tech Stack:** NestJS, SQL Server stored procedures, Docker, XFS project quotas, GitHub Actions, Playwright.

## Global Constraints

- Motores MVP: `mysql,postgresql`.
- Máximo técnico global: dos reservas o bases `pending`/`active`.
- Máximo técnico MySQL: 512 MiB y 0.5 CPU; PostgreSQL: 256 MiB y 0.5 CPU.
- Cuota de datos: línea base inicial + 20 MiB.
- No mover, detener ni reconfigurar `frontend-landing`, `backend-core`, `docs-site` ni `sqlserver` durante la preparación del volumen.
- No publicar a `main` hasta completar pruebas locales y una revisión de cambios.

---

### Task 1: Configuración de motores y capacidad global

**Files:**
- Modify: `src/managed-databases/managed-databases.service.ts`
- Modify: `src/managed-databases/sql-server-managed-database.repository.ts`
- Modify: `scripts/sql/003-managed-databases.sql`
- Modify: `src/managed-databases/managed-databases.service.spec.ts`
- Modify: `src/managed-databases/sql-contract.spec.ts`

**Interfaces:**
- Consumes: `MANAGED_DATABASE_ENABLED_ENGINES` y `MANAGED_DATABASE_MAX_TOTAL` desde `ConfigService`.
- Produces: rechazo HTTP 409 sin crear contenedor cuando el motor está deshabilitado o se alcanza la capacidad global.

- [ ] **Step 1: Escribir pruebas fallidas**

```ts
it('rejects an engine not enabled for the MVP before reserving', async () => {
  await expect(service.create('token', { engine: 'mongodb', databaseName: 'shop' }))
    .rejects.toThrow(ConflictException);
  expect(repository.reserve).not.toHaveBeenCalled();
});
```

```ts
expect(migration).toContain('@MaxTotal INT');
expect(migration).toContain('Maximum managed database capacity reached');
```

- [ ] **Step 2: Ejecutar pruebas para confirmar fallo**

Run: `npm.cmd test -- --runInBand src/managed-databases/managed-databases.service.spec.ts src/managed-databases/sql-contract.spec.ts`

Expected: fallo por falta de validación de motores y parámetro global.

- [ ] **Step 3: Implementar el mínimo cambio**

```ts
const enabled = new Set(this.config.get<string>('MANAGED_DATABASE_ENABLED_ENGINES', 'mysql,postgresql')
  .split(',').map((engine) => engine.trim()));
if (!enabled.has(dto.engine)) throw new ConflictException('Database engine is unavailable');
```

Agregar `@MaxTotal` a `sp_ReserveManagedDatabase`, contar estados `pending`/`active` dentro del bloqueo existente y devolver `Maximum managed database capacity reached` antes de insertar una reserva. Pasar el máximo desde el repositorio.

- [ ] **Step 4: Ejecutar pruebas de la tarea**

Run: `npm.cmd test -- --runInBand src/managed-databases/managed-databases.service.spec.ts src/managed-databases/sql-contract.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/managed-databases scripts/sql/003-managed-databases.sql
git commit -m "feat: gate managed database capacity"
```

### Task 2: Límites Docker por motor

**Files:**
- Modify: `src/managed-databases/provisioners/base-docker.provisioner.ts`
- Modify: `src/managed-databases/provisioners/mysql.provisioner.spec.ts`
- Modify: `src/managed-databases/provisioners/user-data-quota.spec.ts`

**Interfaces:**
- Consumes: `engine` del provisionador.
- Produces: argumentos Docker `--memory` y `--cpus` antes de la imagen.

- [ ] **Step 1: Escribir pruebas fallidas**

```ts
expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining([
  '--memory', '512m', '--cpus', '0.5',
]));
```

```ts
expect(postgresRunner.run).toHaveBeenCalledWith(expect.arrayContaining([
  '--memory', '256m', '--cpus', '0.5',
]));
```

- [ ] **Step 2: Ejecutar pruebas para confirmar fallo**

Run: `npm.cmd test -- --runInBand src/managed-databases/provisioners/mysql.provisioner.spec.ts src/managed-databases/provisioners/user-data-quota.spec.ts`

Expected: fallo porque `docker run` no incluye los límites.

- [ ] **Step 3: Implementar el mínimo cambio**

```ts
protected resourceLimits(): string[] {
  return this.engine === 'mysql'
    ? ['--memory', '512m', '--cpus', '0.5']
    : ['--memory', '256m', '--cpus', '0.5'];
}
```

Incluir `...this.resourceLimits()` en el argumento `docker run` de `start`.

- [ ] **Step 4: Ejecutar pruebas de la tarea**

Run: `npm.cmd test -- --runInBand src/managed-databases/provisioners/mysql.provisioner.spec.ts src/managed-databases/provisioners/user-data-quota.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/managed-databases/provisioners
git commit -m "feat: limit managed database resources"
```

### Task 3: Capacidades para el frontend

**Files:**
- Modify: `src/managed-databases/managed-databases.controller.ts`
- Modify: `src/managed-databases/managed-databases.service.ts`
- Create: `src/managed-databases/managed-databases.controller.spec.ts`
- Modify: `views/dashboard.html`
- Modify: `js/dashboard.js`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**
- Produces: `GET /api/managed-databases/capabilities` con `{ engines: ['mysql', 'postgresql'] }`.
- Consumes: la lista para poblar el selector del formulario.

- [ ] **Step 1: Escribir pruebas fallidas**

```ts
expect(await controller.capabilities()).toEqual({ engines: ['mysql', 'postgresql'] });
```

```ts
await expect(page.locator('#engine option')).toHaveText(['MySQL', 'PostgreSQL']);
```

- [ ] **Step 2: Ejecutar pruebas para confirmar fallo**

Run: `npm.cmd test -- --runInBand src/managed-databases/managed-databases.controller.spec.ts`

Run: `npm.cmd exec -- playwright test tests/dashboard.spec.ts`

Expected: fallo porque no existe el endpoint y el selector contiene cuatro motores estáticos.

- [ ] **Step 3: Implementar el mínimo cambio**

Exponer `capabilities()` desde el servicio y controlador. Sustituir las opciones estáticas por opciones construidas desde la respuesta de capacidades antes de abrir el formulario.

- [ ] **Step 4: Ejecutar pruebas de la tarea**

Run: `npm.cmd test -- --runInBand src/managed-databases/managed-databases.controller.spec.ts`

Run: `npm.cmd exec -- playwright test tests/dashboard.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C work/backend-core add src/managed-databases
git -C work/backend-core commit -m "feat: expose managed database capabilities"
git -C work/frontend-landing add views/dashboard.html js/dashboard.js tests/dashboard.spec.ts
git -C work/frontend-landing commit -m "feat: show enabled database engines"
```

### Task 4: Preparar el volumen XFS del VPS

**Files:**
- Modify: `infra/managed-databases/README.md`
- Remote create: `/var/lib/big-o-managed-storage.img`
- Remote modify: `/etc/fstab`
- Remote create: `/srv/big-o/instances`
- Remote create: `/etc/projects`, `/etc/projid`

**Interfaces:**
- Produces: `/srv/big-o/instances` montado como XFS con `prjquota`.
- Consumes: `MANAGED_DATABASE_DATA_ROOT=/srv/big-o/instances`.

- [ ] **Step 1: Registrar el procedimiento y la verificación previa**

Añadir al README que la imagen es fija de 4 GiB y que nunca se debe aplicar `mkfs` sobre `/dev/sda` ni sus particiones.

- [ ] **Step 2: Verificar previamente el estado remoto**

Run por SSH: `test ! -e /var/lib/big-o-managed-storage.img && findmnt -T /srv/big-o/instances`

Expected: la imagen no existe y la ruta no corresponde a un montaje de datos administrados.

- [ ] **Step 3: Crear el almacenamiento aislado con sudo**

Ejecutar solo después de que el paso 2 confirme que la imagen no existe:

```bash
sudo fallocate -l 4G /var/lib/big-o-managed-storage.img
sudo chmod 600 /var/lib/big-o-managed-storage.img
loop_device=$(sudo losetup --find --show /var/lib/big-o-managed-storage.img)
sudo mkfs.xfs -f "$loop_device"
sudo losetup --detach "$loop_device"
sudo install -d -m 0750 /srv/big-o/instances
sudo cp -a /etc/fstab "/etc/fstab.big-o-backup-$(date +%Y%m%d%H%M%S)"
printf '%s\n' '/var/lib/big-o-managed-storage.img /srv/big-o/instances xfs loop,defaults,prjquota 0 0' | sudo tee -a /etc/fstab
sudo mount /srv/big-o/instances
sudo touch /etc/projects /etc/projid
```

- [ ] **Step 4: Verificar el montaje sin reiniciar ni tocar contenedores actuales**

Run por SSH: `findmnt -no SOURCE,FSTYPE,OPTIONS --target /srv/big-o/instances && df -hT /srv/big-o/instances`

Expected: `xfs` y `prjquota`/`pquota`, tamaño aproximado 4 GiB.

- [ ] **Step 5: Commit**

```bash
git add infra/managed-databases/README.md
git commit -m "docs: document mvp quota volume"
```

### Task 5: Configurar, publicar y comprobar de forma secuencial

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Remote configure: variables GitHub del repositorio

**Interfaces:**
- Consumes: volumen XFS, límites del backend y variables GitHub.
- Produces: backend MVP operativo sin reemplazar la versión sana si el candidato falla.

- [ ] **Step 1: Escribir prueba de contrato fallida**

```ts
expect(workflow).toContain('MANAGED_DATABASE_ENABLED_ENGINES="${{ vars.MANAGED_DATABASE_ENABLED_ENGINES || \'mysql,postgresql\' }}"');
expect(workflow).toContain('MANAGED_DATABASE_MAX_TOTAL="${{ vars.MANAGED_DATABASE_MAX_TOTAL || \'2\' }}"');
```

- [ ] **Step 2: Ejecutar prueba para confirmar fallo**

Run: `npm.cmd test -- --runInBand src/managed-databases/deployment-contract.spec.ts`

Expected: fallo porque el workflow no propaga esas variables.

- [ ] **Step 3: Implementar y probar localmente**

Pasar las dos variables al contenedor en el workflow. Ejecutar toda la suite backend, compilación, generación CSS y Playwright antes de preparar commits.

- [ ] **Step 4: Configurar variables y publicar backend primero**

Crear las cuatro variables de GitHub definidas en la especificación:

```bash
gh variable set MANAGED_DATABASE_HOST --repo Big-o-Database-Centric/backend-core --body '91.99.146.122'
gh variable set MANAGED_DATABASE_DATA_ROOT --repo Big-o-Database-Centric/backend-core --body '/srv/big-o/instances'
gh variable set MANAGED_DATABASE_ENABLED_ENGINES --repo Big-o-Database-Centric/backend-core --body 'mysql,postgresql'
gh variable set MANAGED_DATABASE_MAX_TOTAL --repo Big-o-Database-Centric/backend-core --body '2'
```

Publicar backend a `main`, esperar que su flujo termine y comprobar `https://big-o.andrescortes.dev/api/stats` antes de publicar frontend.

- [ ] **Step 5: Publicar frontend y validar producción**

Publicar frontend a `main`, esperar el flujo, comprobar web, API y CSS con HTTP 200. Crear una base MySQL de prueba, conectarse, verificar la cuota, borrar los recursos de prueba y repetir con PostgreSQL.
