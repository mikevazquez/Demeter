# Nébora SaaS v1 · plataforma (NEB-01)

## Fuente canónica

La fuente canónica es Notion: la épica NEB-01 del Tablero Agile V2 y la página «StudioFlow SaaS ·
Definición (borrador)». Mike aprobó la definición y el demo de la consola el 22-oct-2026.

## Entregado en esta rama

### NEB-01-01 · Rol de plataforma y bitácora (`20261023150000`)

- Tabla `platform_admins`. La migración no da de alta a nadie: Codex inserta el `user_id` de
  Mike después de aplicarla (en Sandbox, su cuenta de pruebas; en producción, solo con su
  autorización).
- Tabla `platform_audit_log`. Es inmutable: un trigger impide editar o borrar renglones, aun
  siendo superusuario.
- Funciones privadas `private.is_platform_admin()`, `private.platform_require_admin()` y
  `private.platform_audit()`.
- Funciones públicas `platform_is_admin()` y `platform_audit_list()`. La segunda solo la usa la
  plataforma.

### NEB-01-02 · Planes, módulos y derechos (`20261023151000`)

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

### NEB-01-03 · Bloqueo de lo no contratado (`20261023152000`)

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
  - La activación (`studio_request_module`, `20261023153000`) por ahora deja la solicitud en la
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

### NEB-01-05 · Sin «Demeter» fijo dentro del estudio (`20261023154000`)

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

### NEB-01-10/11/12 · Consola de Nébora (`20261023155000`)

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

### NEB-01-35 · Hora de cada estudio (`20261023156000`)

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

### NEB-01-38/39/40 · Reglas de reserva por estudio y por actividad (`20261023157000`)

- Reglas nuevas en `studio_operating_policies` (estudio) y en `class_templates` (actividad; vacío
  = como el estudio):
  - Tiempo para cancelar (ya existía en el estudio; ahora también por actividad).
  - Apertura de reservas: sin límite (como hoy), X horas o días antes de cada clase, o un día y
    hora fijos que abren toda la semana siguiente (ej. domingo 20:00), en la hora del estudio.
  - Cierre de reservas: minutos antes del inicio (arranque: 30, lo que Demi ya usaba).
  - Registro con QR: minutos antes y después del inicio (arranque: 20 y 30, como hoy).
- `private.session_booking_rules(clase)` calcula todo para una clase; de ahí salen la apertura,
  el cierre, la hora límite para cancelar y la ventana del QR.
- Dónde se aplica:
  - Un trigger en `reservations` rechaza reservar fuera de la ventana (`booking_not_open`,
    `booking_closed`) a alumnas y Demi. El equipo con `schedule.write` o `attendance.write`
    (recepción, coaches, administración) la puede saltar, y las promociones desde lista de
    espera y las reservas que llegan desde Asistian no se frenan.
  - La elegibilidad de la alumna y la de Demi dicen «Abre el …» o «Reservas cerradas».
  - Cancelar (alumna, Demi, invitadas y Asistian) usa el tiempo de la actividad.
  - El QR de la alumna y el registro usan la misma ventana configurada.
  - Las funciones de pago de Demi (grupo, prospecto, Mercado Pago) usan la ventana en lugar de
    los 30 minutos fijos.
  - Estas funciones se ajustan sobre su definición vigente en la base; si alguna no tiene el
    texto esperado, la migración se detiene con «NEB-01: definición inesperada».
- Pantallas: Configuración › Reservas tiene la sección «Apertura, cierre y registro», y la
  ficha de cada actividad tiene «Reglas de reserva de esta actividad». En el portal, una clase
  que todavía no abre muestra «Abre …». Demi no ofrece clases cerradas y avisa cuándo abre una.
- Cambio para Demeter: la app de la alumna ya no reserva en los últimos 30 minutos (antes solo
  Demi lo respetaba). Mike confirma ese valor en la demo; se cambia en Configuración › Reservas.

### NEB-01-41 · Penalizaciones para alumnas regulares (`20261023158000`)

- Por estudio y por separado para faltas (no-show) y cancelaciones tardías; todo apagado por
  defecto (Demeter no cambia):
  - Pausa de reservas: tras N eventos en D días, la alumna no puede reservar por X días aunque
    tenga paquete activo. Se quita sola al vencer. (Decisión de Mike: reemplaza el «pago
    adelantado».)
  - Cargo en dinero por evento en paquetes con créditos, además de gastar el crédito (los
    ilimitados ya tenían el suyo). Queda como adeudo en `student_operating_charges`.
  - «Un cargo pendiente no deja reservar», activado por defecto.
- `student_booking_penalties` guarda cada pausa; no se enciman pausas del mismo tipo y los
  eventos que ya generaron una pausa no vuelven a contar.
- La alumna y Demi no pueden reservar ni unirse a la lista de espera con pausa o adeudo
  (`student_booking_blocked`, `student_charge_pending`). El equipo del estudio sí puede reservar
  por ella y las promociones desde lista de espera no se frenan.
- Pantallas: Configuración › Reservas › «Penalizaciones por faltas y cancelaciones tardías».
  En la ficha de la alumna, «Reservas en pausa y adeudos» con «Quitar pausa» (queda quién y por
  qué) y «Marcar pagado / Condonar» para los cargos. En el portal, aviso con la fecha de fin de la
  pausa o el monto del adeudo, y «Reservas en pausa hasta …» en cada clase.
- Pendiente: avisar por notificación Push o WhatsApp cuando empieza una pausa (hoy la alumna lo
  ve en el portal y Demi lo explica).

### NEB-01-36 · Primera clase y abono configurables (`20261023159000`)

- En `trial_booking_policies`: precio de la primera clase, monto del abono, inscripción mínima
  para aplicarlo y días para usarlo (0 = mismo día). Arranque = Demeter hoy ($150, $150, $150,
  mismo día). El interruptor sigue siendo la regla de Demi `trial_payment_towards_enrollment`.
- Se ajustan sobre su definición vigente: opciones de abono (monto configurado, nunca más de lo
  pagado; plazo en días), compra con abono, y el cobro de primera clase de Demi (precio
  configurado). Si alguna no tiene el texto esperado, la migración se detiene.
- `trial_enrollment_credits` ya no exige 15000.
- Pantallas: Configuración › Reservas › «Primera clase». El alta de alumna muestra el monto real
  del abono.

### NEB-01-37 · Tiempos de los recordatorios de Demi (`20261023160000`)

- En `demi_followup_settings`: horas de recordatorio de pago, días de recuperación de paquete o
  inscripción, días para alumna inactiva, días antes de vencer el paquete y minutos de apartado
  de la primera clase pagada por adelantado. Arranque = Demeter hoy (2 y 6 h; 7, 15 y 30 días;
  14 días; 3 días antes; 30 minutos).
- `service_schedule_demi_followups` se ajusta sobre su definición vigente; el apartado usa la
  configuración. Pantalla: Demi › Seguimientos › «Tiempos de los recordatorios» (dueño).

### NEB-01-42 · Ejemplos genéricos

- Placeholders del admin (actividades, instructores, productos, automatizaciones), la frase de
  ejemplo del chat de Demi, el simulador de Demi y el evento de prueba de Asistian ya no dicen
  «Pole Fitness» ni «Estudio Demeter».
- Se quedan a propósito: los ejemplos de nombres de clase dentro de las instrucciones de Demi
  (están afinados para Demeter; la personalización por estudio va con NEB-01-25 y Demi por
  estudio) y el guion de UAT de Demi, que corre sobre el estudio de pruebas de Demeter.

## Pruebas

- SQL local, nunca contra Sandbox ni producción:
  `PGHOST=… PGPORT=… PGUSER=postgres scripts/neb01-sql-tests.sh`. Corre 18 controles de plataforma
  13 de bloqueos y solicitudes, 3 de marca, 12 de la consola, 7 de zona horaria, 13 de reglas de reserva, 9 de penalizaciones, 6 de primera clase y 4 de recordatorios de Demi, y deshace todo al terminar.
- Vitest: `tests/neb01-catalog.test.ts`, `tests/neb01-guards.test.ts`, `tests/neb01-branding.test.ts`,
  `tests/neb01-console.test.ts`, `tests/neb01-timezone.test.ts`,
  `tests/neb01-booking-windows.test.ts`, `tests/neb01-penalties.test.ts`,
  `tests/neb01-trial-credit.test.ts` y `tests/neb01-demi-timings.test.ts`.

## Para Codex

1. Aplicar en Sandbox, en orden, `20261023150000_neb01_platform_admins_audit` y
   `20261023151000_neb01_plans_modules_entitlements` y `20261023152000_neb01_entitlement_guards` y
   `20261023153000_neb01_module_activation_requests`, `20261023154000_neb01_studio_brand_name`,
   `20261023155000_neb01_platform_console_reads`, `20261023156000_neb01_studio_local_time`,
   `20261023157000_neb01_booking_windows`, `20261023158000_neb01_student_penalties`,
   `20261023159000_neb01_trial_enrollment_credit` y `20261023160000_neb01_demi_reminder_timings`.
2. Insertar a Mike en `platform_admins` con su cuenta de Sandbox.
3. Verificar que todos los estudios quedaron en `allaccess/internal` y correr QA.
4. Con la cuenta de Mike, abrir `/plataforma` y la ficha de Demeter. Con una cuenta que no sea
   plataforma, confirmar que `/plataforma` da 404.
5. Zona horaria: registrar un pago después de las 18:00 (hora del centro) y confirmar que queda
   con la fecha de hoy. En un estudio de prueba con zona `America/Tijuana`, revisar Hoy,
   cumpleaños y fechas de retos.
6. Reglas de reserva: la migración no debe mostrar «NEB-01: definición inesperada». Con una
   alumna de prueba, confirmar que no reserva en los últimos 30 minutos y que recepción sí; poner
   apertura «domingo 20:00» y ver «Abre …» en el portal; poner a una actividad 12 h para cancelar
   y confirmar que la cancelación es tardía dentro de esas 12 h; revisar que el QR abre y cierra
   según la configuración; pedirle a Demi una clase que aún no abre.
7. Penalizaciones: configurar «2 faltas en 30 días → 7 días» y $100 por falta en un estudio de
   prueba; marcar dos faltas a una alumna de prueba y confirmar el cargo, la pausa, el aviso en el
   portal, que Demi no reserva, que recepción sí y que «Quitar pausa» la libera.
8. Primera clase: en un estudio de prueba poner precio $200, abono $100, inscripción mínima $500
   y 3 días; confirmar que Demi cobra $200, que el alta ofrece abonar $100 hasta 3 días después y
   que en Demeter todo sigue en $150 el mismo día.
9. Recordatorios de Demi: confirmar que Demeter conserva 2/6 h, 7/15/30 días, 14 días, 3 días y
   30 minutos; en un estudio de prueba cambiarlos y revisar las fechas de `demi_followups` nuevos.

Producción no se toca sin la autorización explícita de Mike.

## NEB-01-17 · Entrar al estudio como soporte

Migración `20261023161000_neb01_support_sessions.sql`. Desde la ficha del estudio en la consola, «Entrar al
estudio» pide un motivo y abre una sesión de soporte de 2 horas (una por admin y estudio). Con la sesión
abierta aparecen las pestañas Diagnóstico, Paquetes (nombre, precio y activo editables) y Horario (14 días).
Abrir/cerrar, cada pestaña leída y cada cambio quedan en `platform_audit_log`. La dueña ve un aviso en su
panel mientras soporte está dentro y el historial en Suscripción. No se suplanta su cuenta.

Pruebas: `tests/neb01-support.sql` (11) y `tests/neb01-support.test.ts`.
Producción: bloqueada por NEB-01-24 (el contrato debe autorizar el acceso de soporte).

Paso para Codex (Sandbox): aplicar después de `20261023160000`. Para probar, Mike debe estar en `platform_admins`.

## NEB-01-18 · Revisión de configuración

Migración `20261023162000_neb01_config_issues.sql`: 9 reglas con gravedad y corrección guiada. Se ve en
Más › Revisión de configuración (dueña), en el Diagnóstico del modo soporte y como «errores de configuración»
por estudio en el inicio de la consola. Pruebas: `tests/neb01-config-issues.sql` (5).

## NEB-01-19 · Ayuda de Nébora

Migración `20261023163000_neb01_support_requests.sql`: la dueña pide ayuda en Más › Ayuda de Nébora; la consola
tiene Soporte (abiertas/resueltas/todas) y resuelve con respuesta. Pruebas: `tests/neb01-support-requests.sql` (7).

## NEB-01-20 · Lanzamientos

Migración `20261023164000_neb01_feature_releases.sql`: funciones con etapa Sandbox → Beta → Todos; pasar a
Todos exige confirmar. `public.platform_environment` dice si la base es Sandbox (sin renglón = producción).
Arrancan en Sandbox: `config_review` y `support_requests`. Novedades en Más. Pruebas: `tests/neb01-feature-releases.sql` (8).

Paso para Codex (solo Sandbox): `insert into public.platform_environment (name) values ('sandbox');`
Nunca en producción.
