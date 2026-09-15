# Studio Flow · Estado de implementación

Fuente de verdad funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx`.

Este archivo no sustituye el Documento Maestro ni Jira. Sirve únicamente para reconciliar el código real contra las tareas SF-* antes de seguir implementando.

## Regla de trabajo

1. Documento Maestro define intención, reglas, UX/UI y alcance.
2. Jira/backlog SF-* define orden y entregables.
3. Código implementa ambos.
4. Una tarea no se marca completa si faltan UI/UX, seguridad, estados, responsive o aceptación aplicables.
5. Cualquier contradicción se registra como cambio de alcance; no se resuelve improvisando en código.

## F0 · Fundaciones

- SF-001 Repo oficial: **COMPLETO** — `mikevazquez/Demeter`, rama `main`.
- SF-002 Estructura modular: **PARCIAL** — existe separación `app`, `components`, `lib`, `supabase`, `tests` y `docs`; la capa domain/application se seguirá consolidando con las reglas de negocio.
- SF-003 ESLint/Prettier/typecheck: **COMPLETO** — configuración versionada y verificada por CI.
- SF-004 CI: **COMPLETO** — pipeline reproducible con `npm ci`, format check, lint, typecheck, unit tests y build.
- SF-005 Env validation: **COMPLETO** — `.env.example` sin secretos y acceso a variables públicas centralizado/validado en `lib/env.ts`.
- SF-006 Supabase/Vercel: **PARCIAL POR INFRA EXTERNA** — Supabase oficial está operativo. GitHub ya muestra un único contexto Vercel, pero Vercel continúa rechazando builds nuevos por `build-rate-limit` del plan.
- SF-007 ADR arquitectura: **COMPLETO** — ADR versionado en `docs/adr/0001-studio-flow-architecture.md`.

F0 queda operativamente cerrada salvo el bloqueo externo de nuevos deployments Vercel y la evolución natural de la capa domain/application.

## F1 · Sistema visual / shell

- SF-008 Tokens visuales: **IMPLEMENTADO, PENDIENTE UAT** — dark UI carbón/azul, `#FF0A8A`, estados verde/ámbar/rojo y superficies/bordes normalizados contra M01.
- SF-009 Admin shell responsive: **IMPLEMENTADO, PENDIENTE UAT** — sidebar desktop/tablet y adaptación móvil.
- SF-010 Componentes base: **IMPLEMENTADO, ADOPCIÓN PROGRESIVA** — `Button`, `Card`, `Badge`, `Input` y `StatePanel` reutilizables; las pantallas existentes se migrarán sin rehacer lógica.
- SF-011 Estados UI: **IMPLEMENTADO COMO SISTEMA, ADOPCIÓN PARCIAL** — loading/empty/error/unauthorized/success disponibles; se aplican al cerrar cada Epic.
- SF-012 Navegación admin: **IMPLEMENTADO, PENDIENTE UAT** — taxonomía canónica; módulos no construidos aparecen deshabilitados, no simulados.
- SF-013 Hoy: **IMPLEMENTADO CONTRA M01, PENDIENTE UAT** — saludo, KPIs operativos reales, próxima clase destacada, acciones rápidas y agenda del día.
- SF-014 Shell móvil: **IMPLEMENTADO, PENDIENTE UAT** — bottom navigation y layouts responsive; falta prueba física iPad/móvil.

F1 no se declara 100% hasta que exista un deployment disponible y se haga UAT visual real en desktop/iPad/móvil.

## F2 · Auth / tenant / permisos

- SF-015 studios/sites/spaces: **PARCIAL** — `studios` y ubicación principal existen; falta reconciliar explícitamente `sites/spaces` con el modelo canónico.
- SF-016 identity/memberships/persons: **PARCIAL AVANZADO** — memberships, `persons` y `person_contacts` existen; falta cerrar la equivalencia/capa `user_accounts` del modelo maestro.
- SF-017 roles/permissions: **COMPLETO MVP** — roles canónicos y capabilities en servidor/UI; `coach` queda únicamente como valor legado sin permisos efectivos.
- SF-018 RLS base: **COMPLETO MVP** — helpers y policies capability-based; permitido/denegado/aislamiento entre estudios verificados.
- SF-019 login/logout: **COMPLETO MVP** — Admin correo+contraseña; Alumna teléfono+contraseña; OTP sigue reservado para 2.0.
- SF-020 protected routes/AdminContext: **COMPLETO** — `AdminContext` centralizado y rutas/acciones revalidan capabilities.
- SF-021 tests RLS: **COMPLETO BASE** — pruebas repetibles y verificación directa contra Supabase.

La seguridad y autenticación de F2 están cerradas para el MVP actual. Antes de iniciar F4 se debe cerrar la reconciliación estructural restante de SF-015/SF-016 para no perpetuar un modelo paralelo.

## F3 · Alumnas

- SF-022 modelo students: **IMPLEMENTADO + QA** — `Person + person_contacts + Student`; perfil operativo separado de cuenta de acceso.
- SF-023 dynamic fields: **IMPLEMENTADO + QA TÉCNICO** — definiciones/valores y soporte SHORT_TEXT, LONG_TEXT, NUMBER, DATE, BOOLEAN, SINGLE_SELECT y MULTI_SELECT; Perfil 360 renderiza/edita los campos configurados.
- SF-024 listado/búsqueda: **IMPLEMENTADO, PENDIENTE UAT VISUAL** — búsqueda por nombre, teléfono o correo y filtros por lifecycle.
- SF-025 alta rápida: **IMPLEMENTADO + QA** — nombre/teléfono base; apellido/correo opcionales; creación transaccional.
- SF-026 Perfil 360: **IMPLEMENTADO BASE, PENDIENTE UAT** — datos personales, campos configurables, estado y placeholders explícitos para dominios de fases posteriores.
- SF-027 editar: **IMPLEMENTADO, PENDIENTE UAT** — edición transaccional de persona/contactos y sincronización de compatibilidad.
- SF-028 profile completeness: **IMPLEMENTADO + QA** — COMPLETE/INCOMPLETE se calcula por campos configurados como requeridos, no por campos opcionales.
- SF-029 lifecycle: **IMPLEMENTADO + QA** — ACTIVE/INACTIVE/ARCHIVED separado de completeness.
- SF-030 archive/reactivate: **IMPLEMENTADO + QA** — sin borrado operativo normal.
- SF-031 E.164: **IMPLEMENTADO + QA** — teléfono normalizado y validado.
- SF-032 students permissions: **IMPLEMENTADO + QA RLS** — OWNER/ADMIN/RECEPTION según matriz; INSTRUCTOR no tiene lectura general de alumnas ni de sus campos dinámicos.

QA de base F3 verificado: alta mínima, campo requerido → INCOMPLETE, campo completado → COMPLETE, archive, reactivate, aislamiento cross-studio y matriz de capabilities. Datos QA eliminados tras la prueba. F3 queda técnicamente cerrado; falta UAT visual/flujo real cuando Vercel permita deployment.

## F4 · Instructores

**PENDIENTE.** No debe iniciarse hasta cerrar la reconciliación estructural SF-015/SF-016 de F2.

## F5 · Catálogo / agenda

- SF-042 disciplinas: **PARCIAL**.
- SF-043 actividades: **PARCIAL** — actualmente representadas por `class_templates`; revisar nombre/modelo contra maestro.
- SF-044 Session: **PARCIAL/AVANZADO**.
- SF-045 agenda: **PARCIAL** — listado funcional, todavía no calendario definitivo.
- SF-046 crear: **IMPLEMENTADO, PENDIENTE QA/UI**.
- SF-047 editar/cancelar: **PENDIENTE**.
- SF-048 cupo/espacio/instructor: **PARCIAL** — cupo/espacio sí; instructor incompleto.
- SF-049 recurrence: **PENDIENTE**.
- SF-050 detalle: **PARCIAL**.
- SF-051 conflictos básicos: **PENDIENTE**.

## F6 · Productos / créditos

- SF-052 ProductTemplate: **PARCIAL** — existe `packages`, pero el modelo comercial maestro es más amplio.
- SF-053 tipos: **PENDIENTE**.
- SF-054 listado/detalle: **PARCIAL**.
- SF-055 editor/duplicar: **PENDIENTE**.
- SF-056 ProductAcquisition: **PARCIAL** — `student_packages` cubre parte del concepto y requiere reconciliación.
- SF-057 credit ledger: **PENDIENTE CRÍTICO** — el maestro prohíbe usar únicamente contador mutable.
- SF-058 vigencia/expiración: **PARCIAL**.
- SF-059 disciplinas incluidas: **PENDIENTE**.
- SF-060 membresía ilimitada: **PARCIAL**.

## F7 · Reservas

- SF-061 Reservation: **PARCIAL**.
- SF-062 estados: **PARCIAL**.
- SF-063 eligibility service: **PENDIENTE COMO SERVICIO ÚNICO**.
- SF-064 reason codes: **PENDIENTE**.
- SF-065 atomic hold: **PARCIAL**.
- SF-066 anti-duplicado: **PARCIAL**.
- SF-067 anti-sobrecupo: **PARCIAL**.
- SF-068 reservar: **PARCIAL**.
- SF-069 cancel on-time: **PARCIAL**.
- SF-070 cancel late: **PENDIENTE**.
- SF-071 cancel studio: **PENDIENTE**.
- SF-072 estados UX: **PENDIENTE**.

## Trabajo adelantado detectado

Se implementaron partes de F5–F7 antes de cerrar los prerrequisitos. No se eliminan si son compatibles con el maestro, pero no se expanden hasta completar F2 estructural, F3 y F4 en orden.

## Próximo orden obligatorio

1. Cerrar SF-015/SF-016: `sites/spaces` y capa de identidad `user_accounts` sin romper auth actual.
2. Hacer UAT visual de F1/F3 en cuanto Vercel permita un deployment nuevo.
3. Implementar F4 Instructores completo, incluyendo separación perfil/acceso y permisos.
4. Retomar F5 → F6 → F7 en orden, reutilizando sólo lo compatible ya construido.
