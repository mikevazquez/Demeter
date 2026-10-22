# Nébora SaaS v1 · plataforma (NEB-01)

## Fuente canónica

La fuente canónica es Notion: la épica NEB-01 del Tablero Agile V2 y la página «StudioFlow SaaS ·
Definición (borrador)». Mike aprobó la definición y el demo de la consola el 22-oct-2026.

## Entregado en esta rama

### NEB-01-01 · Rol de plataforma y bitácora (`20261022210000`)

- Tabla `platform_admins`. La migración no da de alta a nadie: Codex inserta el `user_id` de
  Mike después de aplicarla (en Sandbox, su cuenta de pruebas; en producción, solo con su
  autorización).
- Tabla `platform_audit_log`. Es inmutable: un trigger impide editar o borrar renglones, aun
  siendo superusuario.
- Funciones privadas `private.is_platform_admin()`, `private.platform_require_admin()` y
  `private.platform_audit()`.
- Funciones públicas `platform_is_admin()` y `platform_audit_list()`. La segunda solo la usa la
  plataforma.

### NEB-01-02 · Planes, módulos y derechos (`20261022211000`)

- Catálogo de planes y módulos:
  - `platform_plans`: Core, Growth, Pro, Founding y All Access.
  - `platform_modules`: recompensas, recursos, catálogo y Demi.
  - `platform_settings`: 5 lugares Founding, 12 meses, 30 % de descuento y 7 días de gracia.
  - Precios en MXN con IVA incluido.
- `studio_subscriptions`: plan, estado (`invited`, `active`, `grace`, `read_only`, `suspended` o
  `internal`), Founding, día de corte y los identificadores de Stripe. Hay una por estudio.
- `studio_module_addons`: módulos contratados aparte.
- **Ningún estudio cambia de comportamiento.** Los estudios que ya existen se respaldan como
  All Access/internal, y un trigger hace que todo estudio nuevo nazca igual. La consola
  (NEB-01-14) le asigna su plan real después.
- Funciones de lectura:
  - `private.studio_has_module()`
  - `private.studio_can_operate()`
  - `private.studio_monthly_price_mxn()`
  - `private.studio_entitlements()`
  - `public.studio_entitlements()`, para miembros del estudio o para la plataforma.
- Funciones de escritura, solo para la plataforma y siempre con registro en la bitácora:
  - `platform_set_studio_plan()`, que respeta el cupo de Founding y marca el 30 % de los
    ex-Founding.
  - `platform_set_studio_module()`
  - `platform_set_studio_status()`
- Código de la app:
  - `lib/platform/catalog.ts`, que debe coincidir con la migración (lo verifica una prueba).
  - `lib/platform/entitlements.ts`. Si las tablas todavía no existen, `null` significa «no
    bloquear nada».

### NEB-01-03 · Bloqueo de lo no contratado (`20261022212000`)

- **Base de datos:** se bloquean las altas.
  - Si el estudio está en solo lectura o suspendido, no se pueden insertar ventas ni reservas
    (error `studio_read_only`). Cobrar pagos de ventas viejas sigue permitido.
  - Si el estudio no tiene el módulo, no se pueden crear sus registros (error
    `module_not_contracted`):
    - Recompensas: programas y retos.
    - Catálogo y evaluaciones: plantillas, evaluaciones e invitaciones.
    - Recursos y mapa: recursos, mapas y asignación de lugar.
- **Admin (self-service, decisión de Mike del 22-oct):**
  - Lo no contratado **no se oculta**: Retos, Rewards y Evaluaciones aparecen en el menú con
    candado, y en «Más» se marcan como «Bloqueado» con su precio.
  - La guardia de cada módulo (`layout.tsx`) muestra `module-offer.tsx` con qué hace el módulo,
    el precio, la nueva mensualidad, una sugerencia de plan cuando conviene y el botón
    «Activar». Lo ven dueño y administración (`settings.write`); los demás ven «Pídele a
    administración».
  - La activación (`studio_request_module`, `20261022213000`) por ahora deja la solicitud en la
    bitácora para que Mike la active. El cobro proporcional con Stripe y la activación
    automática se hacen en NEB-01-34.
  - La página `/admin/modulos/[module]` muestra el resultado de la solicitud.
  - Aparece un aviso cuando el estudio está en gracia, en solo lectura o suspendido.
- **Portal de la alumna:** Retos se oculta sin Recompensas. Recompensas, retos y evaluaciones
  también tienen guardia de módulo. En solo lectura, la alumna ve un mensaje claro al intentar
  reservar.
- **Demi:** el webhook de WhatsApp le confirma a Meta y no procesa los mensajes de un estudio
  sin Demi. Para eso usa `platform_studio_entitlements_service`, que solo puede llamar
  `service_role`.
- Si la migración no está aplicada, `entitlements` es `null` y nada se bloquea.

## Pruebas

- SQL local, nunca contra Sandbox ni producción:
  `PGHOST=… PGPORT=… PGUSER=postgres scripts/neb01-sql-tests.sh`. Corre 18 controles de plataforma
  y 13 de bloqueos y solicitudes, y deshace todo al terminar.
- Vitest: `tests/neb01-catalog.test.ts` y `tests/neb01-guards.test.ts`.

## Para Codex

1. Aplicar en Sandbox, en orden, `20261022210000_neb01_platform_admins_audit` y
   `20261022211000_neb01_plans_modules_entitlements` y `20261022212000_neb01_entitlement_guards` y
   `20261022213000_neb01_module_activation_requests`.
2. Insertar a Mike en `platform_admins` con su cuenta de Sandbox.
3. Verificar que todos los estudios quedaron en `allaccess/internal` y correr QA.

Producción no se toca sin la autorización explícita de Mike.
