# Portal de administración · primera entrega del bloque A

Se implementan roles, navegación y la nueva superficie Hoy a partir del documento de producto. Los bloques B–F quedan fuera de esta entrega.

## Comportamiento

- Navegación principal: Hoy, Agenda, Alumnas y Más. Coach: Mis clases, Agenda y Más. Las rutas hijas conservan la selección del grupo.
- Más organizado en cuatro grupos, cuenta con rol real y acceso a configuración según permisos. Plan y suscripción permanece exclusivo de Owner.
- Recepción puede operar reservas, asistencia y cobros sin editar horarios. Admin puede editar configuración del estudio.
- Hoy incluye semana, navegación por fecha, reloj del estudio, búsqueda por nombre/teléfono y etapas CRM, próxima clase, cinco tipos de pendientes, fechas especiales y cuatro indicadores.
- Una lista abierta por clase; asistencia desde 20 minutos antes hasta el cierre, cobro previo de pendientes, selección explícita de clase suelta y visita de prueba a $150.
- Marcar todas omite pagos pendientes y permite deshacer durante cinco segundos, conservando cambios posteriores hechos por otra operación.
- Correcciones de listas cerradas exigen motivo y ajustan créditos con auditoría. Las clases canceladas se agrupan al final con motivo y fecha.
- Coach opera únicamente clases asignadas. Las rutas anteriores de clase llevan a la lista integrada de Mis clases.
- Kiosco oscuro, sin padrón ni conteo de alumnas, con bloqueo por pago pendiente, PIN de salida cifrado y límite de intentos, reloj y cambio de cámara persistente.
- Manrope local, diseño móvil y escritorio, modos claro y oscuro.

## Validación

- `VERCEL_ENV=preview npm run ci`: formato, lint, tipos, 1,189 pruebas existentes y compilación. Se actualizan contratos antiguos que esperaban las etiquetas, navegación y reservas automáticas sustituidas.
- 12 comprobaciones funcionales SQL en Sandbox: permisos de recepción, visita de prueba, bloqueo de cobro, marca masiva/undo y concurrencia, pago+asistencia, ventana de tiempo, correcciones y saldo, Admin/Plan/PIN, cancelación auditada y alcance de Coach.
- El guion `sandbox-functional.sql` usa exclusivamente fixtures de Studio Flow Sandbox y transacciones con rollback. No utilizar en otro proyecto. Las consultas se ejecutaron con JWT del actor de pruebas; no sustituyen una matriz completa de navegadores autenticados por rol.
- Smoke de 135 llamadas RPC sobre los 45 estudios sintéticos disponibles.
- Playwright: nueve comprobaciones de rutas, búsqueda modal, cuatro grupos de Más, ausencia de desbordamiento a 390 px, modo oscuro y ausencia de errores de JavaScript. Capturas con compilación optimizada a 390 px y 1280 px.
- Cuatro migraciones nuevas aplicadas únicamente a Supabase Sandbox `hedouonyhynuvwbckdlg`.

## Pendientes para cerrar el bloque A

- Deshacer durante cinco segundos una reserva o su cancelación. Esta entrega sí cubre deshacer la marca masiva de asistencia.
- Mostrar el nombre/rol concreto del autor de cancelación; actualmente muestra Equipo del estudio o Automático.
- Verificación física del QR y cambio de cámara en dispositivos reales; Chromium sin cámara no acredita esa prueba.
- Revisión visual y de tareas con cuentas reales de Recepción y Coach, además de la comprobación de permisos en RPC.

## Decisiones conservadas

Se conserva el cierre automático actual al terminar la clase, la operación posterior al cierre existente y el sidebar de escritorio. El documento deja esos tres puntos sujetos a decisión de producto.

La ventana de QR 20/30 estaba aplicada en Sandbox por el PR #231. Esta entrega recoge la definición vigente con bloqueo de pago y alcance de Coach; revisar esa relación antes de integrar ambas ramas.

## Capturas

- [Hoy móvil](admin-a-hoy-390.png)
- [Búsqueda móvil](admin-a-busqueda-390.png)
- [Más móvil](admin-a-mas-390.png)
- [Hoy escritorio](admin-a-hoy-1280.png)
- [Hoy escritorio oscuro](admin-a-hoy-oscuro-1280.png)
