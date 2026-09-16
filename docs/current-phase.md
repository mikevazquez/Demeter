# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-16

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F10 · Portal alumna: **CERRADA / UAT APROBADA**. Ver `docs/f10-uat-closure.md`.
- El alcance del MVP fue **REBASELINED** por decisión explícita de producto: F0–F10 + release F14.
- F11 · Coach: **EN DESARROLLO / POST-MVP EN SANDBOX-STAGING**.
- F12 · Documentos/configuración: **PAUSADA / POST-MVP**.
- F13 · Reportes/hardening completo: **PAUSADA / POST-MVP**.
- F14 · Release: **CERRADA / MVP EN PRODUCCIÓN**. Ver `docs/f14-release-closure.md`.
- Decisión de alcance: `docs/mvp-scope-rebaseline-2026-09-15.md`.

## Producción vigente

- Aplicación: `https://demeterbueno.vercel.app`
- GitHub: `mikevazquez/Demeter`, branch `main`.
- Commit de cierre de release en `main`: `4cf20911d43dc3a0f0645114a950115268f27540`.
- Último baseline funcional aprobado: PR #24 / commit `517810d49c3999963f8b37e1783f165f459033a5`.
- Supabase oficial: `Studio Flow` / ref `qfhojvgvhrbautvczffq`.
- Región verificada del proyecto Supabase: `us-east-1`.
- Edge Function `provision-student-access`: versión 6 ACTIVE con JWT obligatorio.
- Producción contiene datos reales del estudio y no se usa para desarrollo post-MVP.
- **Producción queda congelada durante F11**: no se mergea ni despliega F11 a `main` hasta que las pruebas y UAT estén aprobadas explícitamente.

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

## Sandbox / staging post-MVP

El aislamiento obligatorio para continuar F11–F13 está técnicamente listo. Ver `docs/sandbox-staging.md`.

Estado verificado:

- Proyecto Supabase sandbox: `Studio Flow Sandbox` / ref `hedouonyhynuvwbckdlg`, `us-east-1`, costo `US$0/mes` al momento de creación.
- Baseline F0–F10 reproducido sin copiar PII ni datos operativos de producción.
- 33 tablas `public`, todas con RLS; 0 views `public`.
- Seed ficticio versionado en `supabase/seed.sandbox.sql`.
- Edge Function `provision-student-access` desplegada en sandbox, ACTIVE, `verify_jwt=true`.
- Vercel Preview de `infra/sandbox-staging-f11` usa exclusivamente URL + publishable key del sandbox; el guard de `prebuild` lo verifica automáticamente.
- Commit de validación `c17c622724ae4ea5c4e77f5c1db6dd90860d5227`: Vercel `success` y GitHub Actions CI completo en verde.
- Se reconciliaron drifts de reproducibilidad detectados entre migraciones versionadas y el estado efectivo del release, sin cambiar producción ni reabrir fases cerradas.

La rama `infra/sandbox-staging-f11` queda como integración/staging de F11 y el PR #28 permanece **DRAFT** contra `main`.

## Estrategia post-MVP aprobada 2026-09-16

Todo desarrollo nuevo de F11 ocurre contra sandbox/staging aislado. Las migraciones se prueban primero en sandbox, el QA/UAT se ejecuta fuera de producción y **no se promueve nada a `main` mientras no esté bien probado y aprobado**.

Flujo:

1. Implementar F11 sobre staging/sandbox.
2. Ejecutar CI, smoke y pruebas de seguridad fuera de producción.
3. Ejecutar UAT de F11 en staging.
4. Sólo después de UAT explícitamente aprobado, preparar la promoción a `main`/producción.
5. La promoción productiva será una operación separada, auditable y con smoke posterior.

Antes de implementar F11 se deben releer FL-10, FL-11 y M05 del Documento Maestro. La experiencia Coach sólo accede a clases/datos necesarios para sus clases autorizadas y reutiliza la lógica canónica de asistencia, walk-in y finalización construida en F8.

## Regla para continuar

No reabrir F8, F9, F10 ni F14 salvo bug/regresión o cambio de alcance aprobado explícitamente.

Producción permanece congelada como baseline del MVP. F11 se desarrolla y prueba exclusivamente en sandbox/staging hasta UAT aprobado.
