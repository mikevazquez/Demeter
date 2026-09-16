# Studio Flow · Checkpoint de fase actual

Última actualización: 2026-09-15

## Estado vigente

- F8 · Asistencia: **CERRADA / UAT APROBADA**. Ver `docs/f8-uat-closure.md`.
- F9 · Ventas/Pagos: **CERRADA / UAT APROBADA**. Ver `docs/f9-uat-closure.md` y `docs/f9-implementation-decisions.md`.
- F10 · Portal alumna: **CERRADA / UAT APROBADA**. Ver `docs/f10-uat-closure.md`.
- F11 queda **DESBLOQUEADA / NO INICIADA**. Antes de comenzar debe recuperarse su alcance exacto desde el Documento Maestro y backlog SF-*; no se debe inferir ni redefinir desde memoria.

## F10 · contratos cerrados

- Portal Student implementado sobre el modelo canónico: `students/persons`, `product_acquisitions`, `credit_ledger`, `reservations`, `sales/payments` y `student_enrollments`.
- Reservar/cancelar reutiliza `booking_eligibility`, `book_student` y `cancel_reservation`; los wrappers Student resuelven la alumna desde `auth.uid()`.
- Login visible del MVP: teléfono + contraseña. Supabase Auth usa por detrás un alias técnico de email derivado del teléfono para evitar depender de Phone provider/Twilio; el teléfono no es PK ni ID interno.
- El aprovisionamiento mantiene separado el expediente operativo de la cuenta Auth, usa contraseña temporal y obliga al cambio en el primer acceso.
- `persons/person_contacts` Student exige contexto activo `private.is_current_student(...)`.
- Nombre, apellido y teléfono son sólo lectura para la alumna; correo editable. La restricción está protegida también en backend/RPC.
- Inicio aprobado con resumen de paquete sin créditos duplicados, agenda prioritaria cuando existen reservas, carrusel semanal/clases del día y cancelación directa.
- Reservar aprobado con navegación semanal lunes-domingo y sin filtro por disciplina.
- Documentos sigue siendo acceso futuro de F12; F10 no simula documentos ni aceptaciones.

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

## QA / observaciones no bloqueantes

- Supabase Security Advisor conserva advertencias globales/preexistentes de funciones `SECURITY DEFINER` y leaked-password protection deshabilitada; no fueron introducidas por el cierre UAT de F10.
- Se detectó una cuenta de prueba legacy creada antes del esquema Auth definitivo; el flujo aprobado corresponde a cuentas nuevas creadas con el esquema actual.

## Regla para continuar

No reabrir F8, F9 ni F10 salvo bug/regresión o cambio de alcance aprobado explícitamente.

Antes de iniciar F11 se debe consultar `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx` y el backlog SF-* para recuperar su alcance exacto, aceptación, UX y dependencias. No redefinir arquitectura ni reglas cerradas al comenzar la siguiente fase.
