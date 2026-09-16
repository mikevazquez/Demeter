# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F10 · Portal alumna: **CERRADA / UAT APROBADA**. Ver `docs/f10-uat-closure.md`.
- El alcance del MVP fue **REBASELINED** por decisión explícita de producto: F0–F10 + release F14.
- F11 · Coach: **PAUSADA / POST-MVP**.
- F12 · Documentos/configuración: **PAUSADA / POST-MVP**.
- F13 · Reportes/hardening completo: **PAUSADA / POST-MVP**.
- F14 · Release: **CERRADA / MVP EN PRODUCCIÓN**. Ver `docs/f14-release-closure.md`.
- Decisión de alcance: `docs/mvp-scope-rebaseline-2026-09-15.md`.

## Producción vigente

- Aplicación: `https://demeterbueno.vercel.app`
- GitHub: `mikevazquez/Demeter`, branch `main`.
- Último baseline funcional aprobado: PR #24 / commit `517810d49c3999963f8b37e1783f165f459033a5`.
- Supabase oficial: `Studio Flow` / ref `qfhojvgvhrbautvczffq`.
- Región verificada del proyecto Supabase: `us-east-1`.
- Edge Function `provision-student-access`: versión 6 ACTIVE con JWT obligatorio.

## Alcance del MVP liberado

El MVP operativo incluye las capacidades construidas y aprobadas hasta F10: administración, auth/permisos, alumnas, instructores administrativos, agenda, productos/créditos, reservas, asistencia, ventas/pagos y Portal Alumna.

Quedan fuera de este release y pasan a post-MVP:

- experiencia Coach dedicada;
- documentos/versiones/aceptaciones y configuración avanzada;
- reportes/KPIs completos;
- hardening extendido, PWA y optimizaciones de performance no bloqueantes.

## Release gates F14

Cerrados al release:

- RLS habilitado en todas las tablas `public`; sin views públicas que bypassen RLS.
- Secret scan sin service role/secret keys expuestas en el repositorio.
- RPC privilegiado `service_link_student_access` restringido a `service_role`.
- UAT Admin + Alumna aprobado; no hubo cambios funcionales después del último UAT, sólo documentación/rebaseline.
- CI del rebaseline en verde y Vercel `success` para el commit de release y el baseline funcional.
- Consistencia de producción sin duplicados de adquisiciones/inscripciones por sale line, sin ventas con total inconsistente, sin reservaciones malformadas y sin adquisiciones finitas sin límite.
- Supabase `ACTIVE_HEALTHY`; migraciones aplicadas hasta `20260916040850_f10_profile_identity_readonly`.
- Advisors revisados; warnings remanentes clasificados como hardening/performance post-MVP, sin P0 identificado en el alcance liberado.
- Rollback documentado en `docs/f14-release-closure.md`.

## Regla de backup / rollback

No ejecutar cambios destructivos en producción sin confirmar primero un backup/restorable point en Supabase Dashboard o generar un dump lógico verificable. El conector disponible no expone el inventario de backups, por lo que no se debe asumir su existencia.

Rollback de aplicación: volver al baseline funcional conocido-bueno `517810d49c3999963f8b37e1783f165f459033a5`, repetir smoke y validar consistencia.

## F10 · contratos cerrados

- Portal Student sobre `students/persons`, `product_acquisitions`, `credit_ledger`, `reservations`, `sales/payments` y `student_enrollments`.
- Reservar/cancelar reutiliza `booking_eligibility`, `book_student` y `cancel_reservation`; wrappers Student resuelven la alumna desde `auth.uid()`.
- Login visible: teléfono + contraseña; Auth usa alias técnico email derivado del teléfono sin Phone provider/Twilio.
- Aprovisionamiento con contraseña temporal y cambio obligatorio en primer acceso.
- Nombre, apellido y teléfono sólo lectura para alumna; correo editable; restricción también en backend.
- Inicio aprobado con agenda prioritaria si hay reservas, carrusel semanal/clases del día y cancelación directa.
- Reservar aprobado con navegación lunes-domingo y sin filtro por disciplina.

## Estrategia post-MVP

El siguiente paso de ingeniería es crear un sandbox/staging separado de producción, con Supabase y Vercel aislados. F11, F12 y F13 se implementarán allí y sólo se promoverán a producción después de migraciones reproducibles, CI, QA/UAT y aprobación explícita.

## Regla para continuar

No reabrir F8, F9, F10 ni F14 salvo bug/regresión o cambio de alcance aprobado explícitamente.

Producción queda congelada como baseline del MVP. El desarrollo funcional siguiente debe ocurrir en sandbox/staging, no directamente sobre producción.
