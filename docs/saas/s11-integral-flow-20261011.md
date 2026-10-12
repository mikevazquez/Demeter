# S11 · Recorrido integral · 2026-10-11

Estado: **verificado técnicamente en Sandbox**. Aprobación funcional de Mike pendiente. Producción no modificada.

## Recorrido verificado

Se usó `Studio Flow S08 Stripe UAT` (`774945b0-ea16-4d26-a4f7-e6107a2ff330`), el mismo estudio vacío creado mediante el alta SaaS que tiene Core pagado en Stripe Sandbox. El owner autenticado seleccionó ese estudio en el Preview del PR #270.

Desde la UI se configuró la actividad `S11 Flow Test`, duración 60 minutos, cupo 1, Sala UAT, martes 13 de octubre a las 18:00 de America/Mexico_City. Se creó el paquete ficticio `S11 2 clases UAT`, $200 MXN, dos créditos y vigencia mensual. Se dio de alta `S11 Alumna UAT`, con teléfono ficticio y sin correo.

La compra se completó desde el alta de la alumna: pago ficticio Efectivo por $200, nota explícita de UAT y saldo pendiente 0. Se creó una sola venta confirmada y una adquisición con dos créditos. No hubo pago ni efectivo real por esa venta.

| Comprobación          | Evidencia                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Agenda                | La actividad generó una sola sesión, `resource_uses_per_item=1` e `is_schedule_exception=false`.                                          |
| Paquete incompatible  | Antes de vincular el paquete, reservar mostraba «El paquete no incluye esta disciplina» y no ofrecía el botón de reserva.                 |
| Reserva desde UI      | Después de configurar el vínculo, mostró dos créditos disponibles. «Reservar» redirigió al perfil con `alta=reserva_realizada`.           |
| Crédito y cupo        | Saldo 2 → 1; roster 1/1, cero lugares, misma alumna y paquete visibles.                                                                   |
| Duplicado             | Repetir `admin_book_student` autenticado devolvió `already_reserved`. Quedó una reserva y saldo 1.                                        |
| Cupo completo         | Segunda alumna ficticia `S11 Cupo UAT`: elegibilidad y escritura rechazadas con `session_full`; no se añadió reserva.                     |
| Cancelación desde UI  | Más acciones → Cancelar reserva → Reserva por error → Confirmar. Resultado `created=cancel`, roster 0/1 y un lugar disponible.            |
| Devolución            | Reserva `cancelled_on_time`, saldo 1 → 2.                                                                                                 |
| Identidad del estudio | Actividad, sesión, producto, alumnas, venta, adquisición y reserva pertenecen al estudio S08. Demeter y el estudio S09 no se modificaron. |

## Defectos encontrados y corregidos

1. `materialize_recurring_schedule` leía directamente `class_templates.resource_uses_per_item`, columna ausente en el esquema actual. Crear actividad fallaba con `42703`. Además, en días sin override de festivo, el generador escribía NULL en el campo NOT NULL `is_schedule_exception`. La migración `20261012034141_saas_recurring_template_resource_compatibility.sql` usa el mismo fallback JSON a 1 que los triggers de compatibilidad existentes y escribe false para un día normal. Conserva permisos y tipo SECURITY INVOKER.
2. `admin_save_activity` creaba actividades con `discipline_id=null`, mientras los paquetes y la elegibilidad requieren ese vínculo. Un tenant nuevo no podía configurar un paquete válido. La migración `20261012034759_saas_activity_package_discipline_bridge.sql` crea o reutiliza un vínculo del mismo estudio para actividades nuevas o sin vínculo al guardarlas. Conserva vínculos existentes, los permisos, el `search_path` vacío y las verificaciones explícitas de identidad/capacidad. No reactiva silenciosamente una disciplina inactiva.

Las dos migraciones se aplicaron únicamente a Supabase Sandbox. La UI no añadió un selector técnico ni cambió el flujo de actividades. Los paquetes conservan su selección explícita de disciplinas. La actividad UAT se volvió a guardar y el paquete se vinculó desde la UI; no se realizó un backfill global de actividades existentes.

## Validación

`tests/saas-recurring-materialization-uat.sql` crea datos transaccionales, verifica vínculo de paquete del mismo estudio, valores normales de sesión, generación sin duplicados, edición que conserva el vínculo sin añadir disciplinas y rechazo de un no miembro. Termina con rollback. La comprobación de vínculo falló antes de la segunda migración y pasó después; también se reprodujo el fallo de la primera desde UI y RPC.

Suite completa: 190 archivos, 1262 pruebas aprobadas. Las últimas modificaciones son SQL; el motor vigente se verificó directamente con la prueba transaccional y el recorrido de navegador. No se cambiaron componentes TSX.

Advisors revisados en Sandbox. No cambió el conteo de funciones SECURITY DEFINER accesibles por anon (4 avisos previos); el RPC modificado tiene EXECUTE sólo para postgres/authenticated/service_role y conserva sus checks. Continúan avisos de funciones privilegiadas autenticadas, RLS sin política y protección de contraseñas, que requieren evaluación del release y no se resuelven concediendo acceso público. Referencia: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

## Objetos UAT retenidos

- Activity/template: `9f7e7975-a4db-4e34-b714-2516432adac2`.
- Session: `5bed0592-b701-49b8-b099-b474a0e4ef40`.
- Package: `553601b7-f4eb-45fe-9189-0d23611917e8`.
- Student: `16488e71-3ee3-4ccb-9696-614e29d27070`.
- Capacity-test student: `6767122e-78c3-463c-aa31-1abc1ed9fde8`.
- Sale: `23130908-7ef5-42a6-8d1e-d298a183eb4d`.
- Acquisition: `26b8b4c4-665e-4215-9f4d-8effe756b67e`.
- Cancelled reservation: `4811ecaa-633a-4581-82ed-7446af8d234d`.

Los datos ficticios quedan sólo en el estudio UAT para revisión funcional. No hay reserva vigente ni consumo pendiente de esa clase. S11 no certifica asistencia, portal alumna, todos los módulos post-MVP ni todas las combinaciones comerciales; el recorrido pendiente de clases/reservas queda técnicamente cubierto junto con la evidencia previa de alta, activación, configuración y Stripe.
