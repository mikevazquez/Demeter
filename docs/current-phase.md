# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F9 incluye como contratos cerrados: Sale/Payment separados, adquisición/créditos anti-duplicados, reembolsos/anulaciones con historia, inscripción configurable, inscripción obligatoria en eligibility, vigencia vitalicia y presets.
- F10 · Portal alumna: **DESPLEGADA EN PRODUCCIÓN / UAT PENDIENTE**.
- PR de integración F10: `#13` (`f10-student-portal` → `main`), **MERGED** mediante merge normal.
- Merge F10 en `main`: `05212afe5174e8e9607f45ca4519cbe48f1c6360`.

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
- El intento de migrar el runtime privilegiado al helper moderno `@supabase/server` fue bloqueado por los controles de la herramienta de despliegue; repo y Supabase permanecen alineados con la implementación estándar actualmente desplegada. No cambia reglas de negocio ni expone secretos al cliente.

## QA técnico completado

- CI final de la rama F10: **GREEN**.
- CI del merge en `main`: **GREEN**.
- Format: success.
- Lint: success.
- Typecheck: success.
- Tests: success, 38/38.
- Build: success.
- Vercel Preview de F10: **READY**.
- Vercel producción para el merge `05212afe...`: **Deployment has completed / success**.

## Pendiente para cerrar F10

- Ejecutar el primer aprovisionamiento real desde administración.
- Comprobar login de alumna: teléfono + contraseña temporal → cambio obligatorio de contraseña → Portal Student.
- UAT funcional: Inicio, paquete, movimientos/pagos, reservar, detalle/confirmación, Mis clases, cancelar, Perfil y estados de bloqueo.
- Validar visualmente móvil/iPad/desktop durante UAT.
- Obtener aprobación UAT explícita antes de marcar F10 como cerrada.

## Regla para continuar

No reabrir F8/F9 ni redefinir sus reglas salvo bug/regresión o cambio de alcance aprobado explícitamente. F10 no se cierra sin UAT explícito y F11 no inicia antes de ese cierre.

Antes de iniciar cualquier fase posterior se debe consultar el Documento Maestro y backlog SF-* para recuperar su alcance exacto. Este checkpoint prevalece sobre snapshots históricos de implementación que todavía puedan contener estados anteriores.
