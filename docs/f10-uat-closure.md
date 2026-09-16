# Studio Flow · Cierre UAT F10 — Portal de alumna

Fecha de aprobación: 2026-09-15

Fuente funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx`.

## Estado

**F10 · Portal de alumna: CERRADA / APROBADA POR UAT.**

La aprobación funcional fue confirmada por el propietario del producto en producción después de validar acceso, navegación, paquete, agenda, reservas, cancelaciones, movimientos/pagos y perfil.

## Alcance cerrado

- SF-094 shell Student.
- SF-095 Inicio.
- SF-096 próximas clases.
- SF-097 Reservar por fecha.
- SF-098 detalle reservable.
- SF-099 confirmación.
- SF-100 Mis clases.
- SF-101 cancelar.
- SF-102 Mi paquete.
- SF-103 movimientos.
- SF-104 Perfil.
- SF-105 accesos de documentos/pagos.
- SF-106 estadísticas.
- SF-107 hardening de identidad y acceso propio.

## Contratos funcionales confirmados

1. Student sólo puede consultar y operar sobre su propio contexto.
2. Reservar y cancelar reutilizan los motores canónicos `booking_eligibility`, `book_student` y `cancel_reservation`; no existe una lógica paralela exclusiva del portal.
3. El login visible del MVP es teléfono + contraseña.
4. El teléfono no es PK ni identificador interno de dominio.
5. Supabase Auth usa un alias técnico interno de email derivado del teléfono para evitar depender de Phone provider/Twilio en el MVP.
6. El expediente operativo y la cuenta Auth permanecen separados.
7. El aprovisionamiento desde administración genera una contraseña temporal, la muestra de forma persistente hasta confirmación y obliga a sustituirla en el primer acceso.
8. Las cuentas creadas con el esquema actual completan correctamente: aprovisionamiento → contraseña temporal → cambio obligatorio → Portal Student.
9. Nombre, apellido y teléfono son datos de identidad del expediente y son sólo lectura para la alumna; el correo puede actualizarse.
10. La restricción de nombre/apellido está protegida también en backend/RPC, no sólo en UI.
11. Documentos permanece como acceso futuro de F12; F10 no simula documentos ni aceptaciones inexistentes.
12. La política de cancelación y créditos sigue siendo la canónica definida en fases anteriores.

## UAT visual y de experiencia aprobado

Se validaron y ajustaron en producción los siguientes bloques:

- navegación principal responsive de Student;
- Inicio con paquete y resumen de créditos sin información duplicada;
- jerarquía dinámica de Inicio: si hay clases agendadas, `Tu agenda` aparece antes del carrusel; si no hay reservas, el carrusel aparece primero;
- carrusel semanal lunes-domingo;
- clases del día visibles desde Inicio;
- cancelación directa desde Inicio;
- Reservar sin filtro innecesario por disciplina, navegando por día/semana;
- posibilidad de avanzar y regresar entre días y semanas sin perder fechas anteriores válidas;
- detalle de clase y confirmación de reserva;
- estados sin paquete, sin créditos, clase llena y otras razones de `booking_eligibility`;
- Mis clases y cancelación;
- Mi paquete y movimientos/pagos;
- Perfil con identidad sólo lectura y correo editable;
- estadísticas en Inicio;
- experiencia móvil validada durante UAT.

## Seguridad y hardening confirmados

- Wrappers Student resuelven la alumna desde `auth.uid()` y no aceptan un `student_id` arbitrario como autoridad.
- RLS de `persons/person_contacts` exige contexto Student activo mediante `private.is_current_student(...)`.
- Student no puede escribir directamente ventas, pagos, adquisiciones ni ledger.
- `service_link_student_access` está restringida al contexto privilegiado correspondiente y no expone DML general a usuarios autenticados.
- `provision-student-access` usa Auth Admin sólo dentro del runtime servidor y no expone secretos al cliente.
- El schedule feed no expone información privada innecesaria de otras alumnas.
- No se amplió el set de capabilities de Student para cerrar F10.

## Migraciones F10 aplicadas y versionadas

- `20260916003136_f10_student_portal_core`
- `20260916012349_f10_student_access_provisioning`
- `20260916012957_f10_harden_student_person_identity_rls`
- `20260916013227_f10_revoke_trigger_rpc_execute`
- `20260916023708_f10_service_link_security_definer`
- `20260916040850_f10_profile_identity_readonly`

## Validación técnica final

- CI de los PR de cierre UAT: format, lint, typecheck, unit tests y build en verde.
- Vercel: deployments de preview y producción exitosos para los merges aprobados.
- Supabase: Edge Function de aprovisionamiento ACTIVE y migraciones F10 aplicadas en el proyecto oficial.
- Supabase Security Advisor: no se introdujo un hallazgo nuevo por los últimos ajustes UAT; permanecen advertencias globales/preexistentes fuera del alcance funcional de F10.
- Producción: flujo Student validado por producto.

## Nota sobre cuenta legacy de prueba

Durante UAT se detectó una cuenta creada antes del cambio definitivo de Auth que conservó un historial híbrido `phone → email` y no representaba el flujo vigente. Las cuentas creadas después del cambio nacen con el esquema actual y fueron las utilizadas para aprobar el acceso final. Esta observación no reabre F10 y no altera el contrato de producción aprobado.

## Regla de cierre

F10 no se reabre salvo bug/regresión o un cambio de alcance aprobado explícitamente. Las fases posteriores deben reutilizar sus contratos de identidad, acceso propio, eligibility, reservas y cancelaciones y no redefinirlos de forma implícita.
