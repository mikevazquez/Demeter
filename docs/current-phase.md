# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F9 incluye como contratos cerrados: Sale/Payment separados, adquisición/créditos anti-duplicados, reembolsos/anulaciones con historia, inscripción configurable, inscripción obligatoria en eligibility, vigencia vitalicia y presets.
- F10 · Portal alumna: **EN DESARROLLO / UAT PENDIENTE** en `f10-student-portal`.
- PR de integración F10: `#13` (`f10-student-portal` → `main`), abierto como draft mientras termina QA técnico.

## F10 · checkpoint técnico

- Portal Student implementado sobre el modelo canónico: `students/persons`, `product_acquisitions`, `credit_ledger`, `reservations`, `sales/payments` y `student_enrollments`.
- Reservar/cancelar reutiliza `booking_eligibility`, `book_student` y `cancel_reservation`; los wrappers Student resuelven la alumna desde `auth.uid()`.
- Login MVP conserva teléfono + contraseña. El aprovisionamiento mantiene separado el expediente operativo de la cuenta Auth.
- Migraciones F10 aplicadas y versionadas:
  - `20260916003136_f10_student_portal_core`
  - `20260916012349_f10_student_access_provisioning`
  - `20260916012957_f10_harden_student_person_identity_rls`
  - `20260916013227_f10_revoke_trigger_rpc_execute`
- La Edge Function `provision-student-access` está desplegada y ACTIVE en el proyecto oficial con `verify_jwt=true`. Usa Auth Admin únicamente dentro del runtime privilegiado; la clave `service_role` no se expone al cliente ni se guarda en Git.
- La cuenta aprovisionada usa contraseña temporal aleatoria y queda obligada a establecer una contraseña propia antes de entrar a `/student`.
- `persons/person_contacts` Student quedaron endurecidos al contexto activo `private.is_current_student(...)`.
- Documentos sigue siendo sólo acceso futuro de F12; F10 no simula documentos ni aceptaciones.

## Pendiente antes de merge/producción

- Completar CI verde sobre el head final del PR.
- Validar el preview responsive y rutas críticas.
- Ejecutar el primer aprovisionamiento real desde administración y comprobar login teléfono + contraseña temporal → cambio obligatorio → Portal Student.
- Completar UAT explícito antes de cerrar F10.

## Regla para continuar

No reabrir F8/F9 ni redefinir sus reglas salvo bug/regresión o cambio de alcance aprobado explícitamente. F10 no se cierra sin UAT explícito y F11 no inicia antes de ese cierre.

Antes de iniciar cualquier fase posterior se debe consultar el Documento Maestro y backlog SF-* para recuperar su alcance exacto. Este checkpoint prevalece sobre snapshots históricos de implementación que todavía puedan contener estados anteriores.
