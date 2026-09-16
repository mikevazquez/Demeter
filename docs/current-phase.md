# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F10 · Portal alumna: **CERRADA / UAT APROBADA**. Ver `docs/f10-uat-closure.md`.
- El alcance del MVP fue **REBASELINED** por decisión explícita de producto: F0–F10 + release F14.
- F11 · Coach: **PAUSADA / POST-MVP**.
- F12 · Documentos/configuración: **PAUSADA / POST-MVP**.
- F13 · Reportes/hardening completo: **PAUSADA / POST-MVP**; sólo sus release gates críticos se ejecutan dentro de F14.
- F14 · Release: **SIGUIENTE FASE / AUTORIZADA PARA INICIAR**.
- Decisión y alcance: `docs/mvp-scope-rebaseline-2026-09-15.md`.

## Alcance del MVP rebaselined

El MVP que se liberará para operación real de Demeter corresponde a las capacidades ya construidas y aprobadas hasta F10: administración, auth/permisos, alumnas, instructores administrativos, agenda, productos/créditos, reservas, asistencia, ventas/pagos y Portal Alumna.

No forman parte del release inicial:

- experiencia Coach dedicada;
- documentos/versiones/aceptaciones y configuración avanzada;
- reportes/KPIs completos;
- hardening extendido/PWA/performance no bloqueante.

Estas capacidades no se eliminan: continúan como backlog post-MVP y se desarrollarán en un sandbox/staging aislado después del lanzamiento.

## Release gates obligatorios trasladados a F14

Aunque F13 queda pausada, F14 debe ejecutar antes de liberar:

- RLS/aislamiento crítico sobre los flujos que sí salen a producción;
- secret scan y comprobación de que service_role/secretos no están expuestos;
- smoke test Admin + Alumna;
- sanity responsive móvil/tablet/desktop en flujos operativos;
- verificación de error/unauthorized en rutas críticas;
- migraciones reproducibles, backup/rollback;
- observabilidad mínima de producción.

Estos gates son obligatorios y no se consideran funcionalidad de F13 reabierta.

## F10 · contratos cerrados

- Portal Student implementado sobre el modelo canónico: `students/persons`, `product_acquisitions`, `credit_ledger`, `reservations`, `sales/payments` y `student_enrollments`.
- Reservar/cancelar reutiliza `booking_eligibility`, `book_student` y `cancel_reservation`; los wrappers Student resuelven la alumna desde `auth.uid()`.
- Login visible del MVP: teléfono + contraseña. Supabase Auth usa por detrás un alias técnico de email derivado del teléfono para evitar depender de Phone provider/Twilio; el teléfono no es PK ni ID interno.
- El aprovisionamiento mantiene separado el expediente operativo de la cuenta Auth, usa contraseña temporal y obliga al cambio en el primer acceso.
- `persons/person_contacts` Student exige contexto activo `private.is_current_student(...)`.
- Nombre, apellido y teléfono son sólo lectura para la alumna; correo editable. La restricción está protegida también en backend/RPC.
- Inicio aprobado con resumen de paquete sin créditos duplicados, agenda prioritaria cuando existen reservas, carrusel semanal/clases del día y cancelación directa.
- Reservar aprobado con navegación semanal lunes-domingo y sin filtro por disciplina.
- Documentos sigue fuera del release inicial; F10 no simula documentos ni aceptaciones.

### Migraciones F10 aplicadas y versionadas

- `20260916003136_f10_student_portal_core`
- `20260916012349_f10_student_access_provisioning`
- `20260916012957_f10_harden_student_person_identity_rls`
- `20260916013227_f10_revoke_trigger_rpc_execute`
- `20260916023708_f10_service_link_security_definer`
- `20260916040850_f10_profile_identity_readonly`

## Validación final F10

- Aprovisionamiento nuevo desde administración: **APROBADO**.
- Contraseña temporal persistente hasta confirmación: **APROBADO**.
- Primer acceso → cambio obligatorio de contraseña → Portal Student: **APROBADO**.
- Inicio, paquete, próximas clases, Reservar, detalle/confirmación, Mis clases, cancelar, movimientos/pagos, Perfil y estadísticas: **APROBADOS EN UAT**.
- Ajustes UAT mergeados hasta PR `#24`.
- CI de cierre: Format, Lint, Typecheck, Tests y Build en verde.
- Vercel producción: deployments de cierre exitosos.
- UAT de producto: **APROBADA explícitamente**.

## Estrategia después del release

Después de F14 se debe crear un sandbox/staging separado de producción, con Supabase y Vercel aislados. F11, F12 y F13 se implementarán allí y sólo se promoverán a producción después de migraciones reproducibles, CI, QA/UAT y aprobación explícita.

## Regla para continuar

No reabrir F8, F9 ni F10 salvo bug/regresión o cambio de alcance aprobado explícitamente.

La siguiente ejecución es F14 rebaselined. No iniciar F11–F13 antes del release. Para F14 se reutilizan los contratos cerrados y se ejecutan únicamente los release gates definidos en `docs/mvp-scope-rebaseline-2026-09-15.md`.
