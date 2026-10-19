# Talleres: implementación y verificación del 19 de octubre de 2026

Entrega sobre el Draft existente [#317](https://github.com/mikevazquez/Demeter/pull/317), conciliado con `main` `e2b3e1d6fb5c310d02eb4c24ca4515fc13c88278`. Los documentos UAT del 15–16 de octubre conservan su carácter histórico: no acreditan aceptación de Mike de esta entrega.

## Comportamiento implementado

- Actividades configura talleres, eventos y masterclass; Agenda configura las fechas y recursos. Asistencia, reservas y abonos se operan desde Hoy, con enlace a la fecha local de la sesión.
- Compra completa o fechas individuales habilitadas: validación de inscripción en cada fecha local, selección explícita, anticipo y saldo exigible al comenzar la primera fecha adquirida. Una oferta que permite invitadas prevalece sobre la política general de inscripción.
- Demi consulta catálogo vigente, cotiza, presenta condiciones y exige aceptación en otro turno. Un comprobante crea únicamente un apartado provisional atómico. Solo la revisión de fondos recibidos por personal autorizado crea la venta, el pago y las reservas confirmadas.
- Los reintentos conservan la identidad de la operación; dos comprobantes compitiendo por el último lugar no sobrevendieron. Los abonos usan el motor de ventas existente y una referencia estable; operaciones simultáneas no cobran por encima del saldo.
- Alumnas muestra compras, fechas, pagos, saldo e historial. El abandono explícito libera solo reservas futuras de esa compra, conserva pagos y deuda y deja auditoría.
- La primera ausencia registrada con deuda permite una pregunta de continuidad. Una respuesta afirmativa conserva lugares y genera recordatorios de saldo sin volver a preguntar. La baja requiere una frase explícita; un «no» aislado se rechaza. La política congelada de liberación después de gracia se aplica con el mismo bloqueo de venta que los abonos.
- Demi para talleres está **desactivado por defecto**. El control está en Actividades → Talleres → Configuración. Además requiere seguimientos generales habilitados, preferencias de contacto válidas y plantillas aprobadas fuera de la ventana de WhatsApp. No se habilitó ningún estudio ni se envió ningún mensaje durante esta entrega.

## Evidencia técnica y límites

En el checkout aislado se ejecutaron 1.678 pruebas Vitest, TypeScript, ESLint, Prettier y compilación Next.js con las variables públicas ficticias de CI. ESLint mantiene advertencias preexistentes; no se declara ausencia de advertencias.

`npm run test:workshops:db` usa PostgreSQL 17 con imagen fijada por digest, contenedor sin red y sin puertos. Reconstruye las migraciones de talleres y ejecuta 62 escenarios, incluyendo conexiones simultáneas, permisos, saldo, revisión, reintentos, continuidad y carrera abono/liberación. Los dominios externos Auth/CRM/inscripción tienen un esquema reducido explícito; esta prueba no sustituye la integración en Supabase. El fixture usa el enum real de reservas, no estados de cancelación inventados. Los cambios de reloj de las fechas se limitan a datos sintéticos del contenedor.

En **Sandbox `hedouonyhynuvwbckdlg`** se ejecutó `scripts/uat/workshop-completion-rollback-20261019.sql`: 11 comprobaciones pasaron contra las tablas, permisos SaaS, funciones y roles reales. Cubre cotización y aceptación separadas, ausencia de ingresos prematuros, apartado y replay, revisión administrativa, vencimiento, abono y replay, historial, baja sin borrar dinero y rechazo de RPC anónimos. Todos los datos sintéticos se revirtieron; comprobación posterior: cero estudios sintéticos y cero estudios con Demi de talleres habilitado.

La preparación usa un usuario activo existente únicamente como actor de un contexto de rol en SQL y una suscripción de prueba del estudio sintético que también se revierte. **No es un login de navegador ni una prueba de transporte, OCR/modelo o recepción de fondos.** No se crearon ni leyeron registros de autenticación, claves privadas ni sesiones.

La integración real detectó `reservation_status` incompatible con `cancelled`. Se corrigió con una migración adicional a `cancelled_by_studio`; no se modificó el historial de migraciones ya aplicado. La prueba de Sandbox pasó después de esa corrección.

## Migraciones aplicadas exclusivamente en Sandbox

El historial remoto asigna su propia versión a las llamadas MCP. Correspondencia por nombre:

| Archivo local                                                 | Versión remota   |
| ------------------------------------------------------------- | ---------------- |
| `20261019041433_workshop_operational_contract.sql`            | `20261019111610` |
| `20261019042048_workshop_continuation_and_history.sql`        | `20261019111618` |
| `20261019042239_demi_workshop_purchase_flow.sql`              | `20261019111625` |
| `20261019042632_workshop_atomic_hold_replay.sql`              | `20261019111630` |
| `20261019043144_workshop_demi_continuation_followups.sql`     | `20261019111635` |
| `20261019043300_workshop_existing_sales_installments.sql`     | `20261019111642` |
| `20261019112001_workshop_reservation_cancellation_status.sql` | `20261019112020` |

No ejecutar un `db push` indiscriminado contra Sandbox: el historial previo de #317 también tiene versiones remotas diferentes. Producción no recibió estas migraciones. Cualquier futura promoción exige reconciliar por nombre y contenido y revisar el destino antes de aplicarlas.

Las funciones de cupo provisional que Sandbox ya tenía y faltaban en archivos versionados se recuperaron y revisaron. El motor genérico de abonos se conservó, agregando solo el total cobrable de una compra de taller vinculada al mismo estudio, venta y alumna. Las ventas ordinarias conservan su cálculo y desbloqueo, verificados en integración.

## Revisión de seguridad

Todas las tablas nuevas tienen RLS y carecen de escritura directa para clientes. Las mutaciones pasan por RPC con comprobaciones de estudio, identidad y capacidades; los helpers internos no son invocables por clientes. Los comprobantes privados requieren permisos de alumnas, agenda y ventas. El trigger de sincronización financiera dejó de ser invocable por `anon`.

Advisors antes/después: avisos de definers anónimos 5→4; cuatro tablas internas adicionales con RLS sin políticas directas, intencionalmente accesibles solo por RPC; los RPC administrativos nuevos generan el aviso general de definer autenticado y tienen controles de autorización explícitos. Permanecen cuatro entrypoints anónimos anteriores ajenos a este alcance y la protección de contraseñas filtradas desactivada. [Criterio de revisión de definers](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Pendientes antes de cerrar funcionalmente

Verificar CI y Preview del SHA final y efectuar UAT autenticado en ese Preview: edición de taller, compra completa/individual, comprobante provisional y rechazo/aprobación, asistencia y abono en Hoy, historial y abandono, continuidad y vencimiento. La aceptación visual/funcional de Mike continúa pendiente; no se ha marcado ninguna prueba histórica como aprobada por él. Tampoco se ha acreditado una conversación real de WhatsApp con plantillas aprobadas para esta nueva función.

La entrega queda en Draft/Sandbox para esa validación. No se fusionó, desplegó ni cambió producción.
