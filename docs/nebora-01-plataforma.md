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

### NEB-01-05 · Sin «Demeter» fijo dentro del estudio (`20261022214000`)

- Nueva columna `studios.brand_name`: es el nombre corto de marca. Para Demeter se llena con
  «Demeter»; si un estudio no lo tiene, se usa `studios.name`.
- `lib/platform/branding.ts` (`loadStudioBrandName`) lee ese nombre. Si la columna todavía no
  existe, usa el nombre del estudio y no falla.
- Ahora salen de la marca del estudio:
  - En el portal: la marca del encabezado, avisos, notificaciones Push, la portada, el medallero
    y la activación de medallas.
  - En el admin: los beneficios de las medallas.
  - En Demi: los saludos automáticos.
- Textos que cambiaron a genéricos («el estudio», «tu estudio»): placeholders y descripciones del
  admin, y la personalidad base de Demi.
- **Se queda igual a propósito:**
  - Cookies y encabezados de sesión (`session-policy.ts`, con contrato V2): renombrarlos cerraría
    la sesión de todas las personas.
  - Nombres de plantillas de WhatsApp `demeter_*`: están registradas en Meta para Demeter.
    Cada estudio tendrá las suyas (NEB-01-23).
  - Integración de Instagram de Demeter (`meta-inbox`).
  - Lo que se ve antes de entrar (login, activación, acceso público, la página `/`): depende de
    saber el estudio por el subdominio (NEB-01-04).
  - Páginas legales de Demeter (`/privacidad`, `/eliminacion-datos`): las de Nébora van en
    NEB-01-24.
  - «Pole Fitness» en `main` solo aparece como ejemplo o placeholder. El catálogo de pole que
    depende del nombre está en el PR 352 y se generaliza en NEB-01-25.
- **Orden de despliegue:** aplicar la migración antes de publicar el código. Si no, Demeter
  mostraría su nombre completo en lugar de «Demeter».

### NEB-01-10/11/12 · Consola de Nébora (`20261022215000`)

- Ruta `/plataforma`, fuera de `/admin`: es de la plataforma, no de un estudio. Usa la misma
  sesión del admin. Quien no está en `platform_admins` recibe 404.
- Lecturas nuevas, solo para plataforma (`platform_require_admin`), sin escrituras:
  - `platform_overview()`: ingreso mensual (estudios activos y en gracia), estudios por estado,
    lugares Founding usados, alumnas activas y módulos pedidos sin activar.
  - `platform_list_studios()`: marca, subdominio, plan, estado, mensualidad, mes de Founding,
    día y fecha de corte, alumnas activas y pedidos.
  - `platform_studio_detail(estudio)`: alumnas (registradas, activas, con paquete vigente,
    nuevas del mes), clases de la semana y del mes, reservas del mes (asistencias y
    cancelaciones), ventas confirmadas del mes, consumo de Demi del mes (llamadas, tokens y
    costo estimado en USD), último acceso del dueño, plan y módulos, pedidos pendientes y las
    últimas 20 entradas de la bitácora.
  - «Este mes» y «esta semana» se cuentan en hora de Ciudad de México.
- Pantallas:
  - Inicio (`/plataforma`): métricas y lista de estudios.
  - Ficha (`/plataforma/estudios/[id]`) con pestañas Números, Plan y módulos, Cobros y
    Bitácora.
  - Plan y módulos cambia plan y día de corte, activa o desactiva módulos sueltos y cambia el
    estado de la cuenta. Usa `platform_set_studio_plan/module/status`, que dejan todo en la
    bitácora. Activar aquí no cobra; el cobro llega con Stripe (NEB-01-07 y NEB-01-34).
  - Cobros es un aviso hasta que se conecte Stripe.
- Fuera de este alcance: entrar al estudio para corregir datos (NEB-01-13) y el alta guiada de
  estudios (NEB-01-14).

### NEB-01-35 · Hora de cada estudio (`20261022216000`)

- Nébora v1 es solo para México, pero cada estudio puede estar en otra zona horaria.
  `lib/studio-time.ts` calcula «hoy», la conversión de horas escritas y los valores de
  formulario con la zona del estudio (`studios.timezone`); sin zona válida usa la del centro.
- Configuración › Región: la zona se elige de una lista de zonas de México. Moneda y formato se
  muestran fijos (pesos y es-MX).
- App: ya no hay hora de CDMX ni desfase `-06:00` fijos en cumpleaños, retos y recompensas,
  consumo de Demi del mes, ventas (fecha de inicio de la inscripción) y el asistente de
  actividades (fecha de inicio por defecto).
- Base de datos (la base corre en UTC; después de las 18:00 en el centro, `current_date` ya es
  mañana):
  - `private.studio_timezone()` y `private.studio_local_today()`.
  - `payments.effective_on` sin valor por defecto; un trigger le pone la fecha local del
    estudio. `register_sale_payment` también usa la fecha local.
  - El paso a ex-alumna por inactividad (CRM) y la validación de fecha de nacimiento usan la
    fecha local del estudio.
  - La consola cuenta mes, semana, «hoy» y fecha de corte en la zona de cada estudio.
- Pendiente de bajo impacto: `student_is_minor` y la fecha por defecto de evaluaciones técnicas
  siguen con `current_date`. El simulador de Demi se ajusta en NEB-01-42.

## Pruebas

- SQL local, nunca contra Sandbox ni producción:
  `PGHOST=… PGPORT=… PGUSER=postgres scripts/neb01-sql-tests.sh`. Corre 18 controles de plataforma
  13 de bloqueos y solicitudes, 3 de marca, 12 de la consola y 7 de zona horaria, y deshace todo al terminar.
- Vitest: `tests/neb01-catalog.test.ts`, `tests/neb01-guards.test.ts`, `tests/neb01-branding.test.ts`,
  `tests/neb01-console.test.ts` y `tests/neb01-timezone.test.ts`.

## Para Codex

1. Aplicar en Sandbox, en orden, `20261022210000_neb01_platform_admins_audit` y
   `20261022211000_neb01_plans_modules_entitlements` y `20261022212000_neb01_entitlement_guards` y
   `20261022213000_neb01_module_activation_requests`, `20261022214000_neb01_studio_brand_name`,
   `20261022215000_neb01_platform_console_reads` y `20261022216000_neb01_studio_local_time`.
2. Insertar a Mike en `platform_admins` con su cuenta de Sandbox.
3. Verificar que todos los estudios quedaron en `allaccess/internal` y correr QA.
4. Con la cuenta de Mike, abrir `/plataforma` y la ficha de Demeter. Con una cuenta que no sea
   plataforma, confirmar que `/plataforma` da 404.
5. Zona horaria: registrar un pago después de las 18:00 (hora del centro) y confirmar que queda
   con la fecha de hoy. En un estudio de prueba con zona `America/Tijuana`, revisar Hoy,
   cumpleaños y fechas de retos.

Producción no se toca sin la autorización explícita de Mike.
