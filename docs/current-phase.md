# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F9 incluye como contratos cerrados: Sale/Payment separados, adquisición/créditos anti-duplicados, reembolsos/anulaciones con historia, inscripción configurable, inscripción obligatoria en eligibility, vigencia vitalicia y presets.
- F10 · Portal alumna: **DESPLEGADA EN PRODUCCIÓN / UAT EN CURSO**.
- PR de integración F10: `#13` (`f10-student-portal` → `main`), **MERGED** mediante merge normal.
- Ajustes UAT ya mergeados: acceso/provisioning, login técnico por alias interno y navegación semanal de Reservar (`#14`–`#22`).
- Ajuste UAT actual: `#23` (`f10-uat-home-profile` → `main`) para Inicio diario, cancelación directa, resumen de créditos y Perfil sólo lectura en identidad.

## F10 · checkpoint técnico

- Portal Student implementado sobre el modelo canónico: `students/persons`, `product_acquisitions`, `credit_ledger`, `reservations`, `sales/payments` y `student_enrollments`.
- Reservar/cancelar reutiliza `booking_eligibility`, `book_student` y `cancel_reservation`; los wrappers Student resuelven la alumna desde `auth.uid()`.
- Login visible del MVP conserva teléfono + contraseña. Supabase Auth usa por detrás un alias técnico de email derivado del teléfono para evitar depender de Phone provider/Twilio; el teléfono no es PK ni ID interno.
- El aprovisionamiento mantiene separado el expediente operativo de la cuenta Auth y obliga a cambiar la contraseña temporal antes de entrar al portal.
- La Edge Function `provision-student-access` usa `@supabase/server`, está desplegada y ACTIVE en el proyecto oficial y mantiene Auth Admin sólo dentro del runtime privilegiado.
- `persons/person_contacts` Student quedaron endurecidos al contexto activo `private.is_current_student(...)`.
- Nombre, apellido y teléfono son datos de identidad del expediente y no son editables por la alumna; el correo sí puede actualizarse. Esta regla está protegida también en el RPC, no sólo en UI.
- Documentos sigue siendo sólo acceso futuro de F12; F10 no simula documentos ni aceptaciones.

### Migraciones F10 aplicadas y versionadas

- `20260916003136_f10_student_portal_core`
- `20260916012349_f10_student_access_provisioning`
- `20260916012957_f10_harden_student_person_identity_rls`
- `20260916013227_f10_revoke_trigger_rpc_execute`
- `20260916023708_f10_service_link_security_definer`
- `20260916040850_f10_profile_identity_readonly`

## UAT validado hasta ahora

- Aprovisionamiento nuevo desde administración: **FUNCIONA**.
- Contraseña temporal visible/persistente hasta confirmación: **FUNCIONA**.
- Primer acceso → cambio obligatorio de contraseña → Portal Student: **FUNCIONA** en cuentas creadas con el esquema actual.
- Se identificó una cuenta de prueba legacy creada antes del cambio de Auth; no representa el flujo nuevo.
- Inicio Student carga correctamente estado sin paquete y navegación principal.
- Reservar fue ajustado por UAT a semana fija lunes-domingo, sin filtro por disciplina; PR `#22` mergeado.
- F10 permanece abierta hasta aprobación UAT explícita.

## QA técnico

- Los PR de ajustes UAT se mergean sólo con Format, Lint, Typecheck, Tests, Build y Vercel en verde.
- Supabase Security Advisor sigue mostrando advertencias preexistentes de funciones `SECURITY DEFINER` expuestas a `authenticated`, incluidas operaciones Student intencionales que validan contexto/capabilities. No se amplió el acceso con el ajuste de Perfil.
- Supabase mantiene además la advertencia global de leaked-password protection deshabilitada; no forma parte del alcance funcional de F10.

## Pendiente para cerrar F10

- Terminar UAT de Inicio: resumen de paquete sin duplicados, carrusel semanal/clases del día y cancelación directa.
- Terminar UAT de Reservar, detalle/confirmación y estados de bloqueo.
- Terminar UAT de Mi paquete, movimientos/pagos, Mis clases y Perfil.
- Validar visualmente móvil/iPad/desktop durante UAT.
- Obtener aprobación UAT explícita antes de marcar F10 como cerrada.

## Regla para continuar

No reabrir F8/F9 ni redefinir sus reglas salvo bug/regresión o cambio de alcance aprobado explícitamente. F10 no se cierra sin UAT explícito y F11 no inicia antes de ese cierre.

Antes de iniciar cualquier fase posterior se debe consultar el Documento Maestro y backlog SF-* para recuperar su alcance exacto. Este checkpoint prevalece sobre snapshots históricos de implementación que todavía puedan contener estados anteriores.
