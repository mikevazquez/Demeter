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
- SF-002 Estructura modular: **PARCIAL** — existe separación `app`, `lib`, `supabase`, pero falta completar capa application/domain definida.
- SF-003 ESLint/Prettier/typecheck: **PARCIAL** — typecheck existe; faltan ESLint y Prettier.
- SF-004 CI: **PENDIENTE** — falta pipeline reproducible con install, format, lint, typecheck, test y build.
- SF-005 Env validation: **PARCIAL** — existe `.env.example`; falta validación formal de variables.
- SF-006 Supabase/Vercel: **PARCIAL** — Supabase y despliegue funcional existen; quedan proyectos Vercel duplicados/históricos y actualmente el plan bloquea builds por rate limit.
- SF-007 ADR arquitectura: **PARCIAL** — existe documentación de decisiones, falta ADR formal en repo.

## F1 · Sistema visual / shell

- SF-008 Tokens visuales: **EN CORRECCIÓN** — se migró a dark UI carbón/azul, `#FF0A8A`, estados verde/ámbar/rojo.
- SF-009 Admin shell responsive: **EN CORRECCIÓN** — añadido sidebar desktop y shell adaptativo.
- SF-010 Componentes base: **PARCIAL** — estilos existen, faltan componentes reutilizables formales.
- SF-011 Estados UI: **PARCIAL** — hay empty/error/success; faltan loading/unauthorized consistentes.
- SF-012 Navegación admin: **EN CORRECCIÓN** — navegación canónica añadida; módulos aún no implementados quedan explícitamente deshabilitados.
- SF-013 Hoy: **PARCIAL** — funcional con KPIs y clases del día; necesita validación visual final contra mockup M01.
- SF-014 Shell móvil: **EN CORRECCIÓN** — bottom navigation añadida; pendiente UAT responsive real.

## F2 · Auth / tenant / permisos

- SF-015 studios/sites/spaces: **PARCIAL** — `studios` y ubicación principal existen; revisar nomenclatura conceptual sites/spaces.
- SF-016 identity/memberships/persons: **PARCIAL** — memberships existen; modelo operativo actual de students todavía no refleja completamente `persons/person_contacts` del maestro.
- SF-017 roles/permissions: **PARCIAL** — roles base existen; falta capability model completo.
- SF-018 RLS base: **PARCIAL/AVANZADO** — RLS y helpers existen y Security Advisor no reporta problemas DB relevantes; faltan pruebas formales de aislamiento.
- SF-019 login/logout: **PARCIAL** — admin funciona. Student debe ser teléfono + contraseña para MVP; OTP queda 2.0.
- SF-020 protected routes/AdminContext: **PARCIAL** — protección existe en páginas/acciones; falta centralizar AdminContext.
- SF-021 tests RLS: **PENDIENTE**.

## F3 · Alumnas

- SF-022 modelo students: **PARCIAL**.
- SF-023 dynamic fields: **PENDIENTE**.
- SF-024 listado/búsqueda: **PARCIAL** — listado existe; búsqueda falta.
- SF-025 alta rápida: **PARCIAL** — nombre/teléfono; teléfono obligatorio y normalizado a E.164; falta cerrar validaciones/UX.
- SF-026 Perfil 360: **PENDIENTE**.
- SF-027 editar: **PENDIENTE**.
- SF-028 profile completeness: **PENDIENTE**.
- SF-029 lifecycle: **PENDIENTE**.
- SF-030 archive/reactivate: **PENDIENTE**.
- SF-031 E.164: **IMPLEMENTADO, PENDIENTE QA**.
- SF-032 students permissions: **PARCIAL**.

## F4 · Instructores

**PENDIENTE.** No debe saltarse esta fase al continuar el roadmap.

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
- SF-056 ProductAcquisition: **PARCIAL** — `student_packages` cubre parte del concepto, necesita reconciliación.
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

Se implementaron partes de F5–F7 antes de cerrar F1, F3 y F4. No se eliminarán si son compatibles con el maestro, pero no se continuará expandiéndolas hasta cerrar los prerrequisitos y reconciliar el modelo de datos.

## Próximo orden obligatorio

1. Completar F0 faltante crítico: tooling/CI/ADR/env validation.
2. Cerrar F1 y realizar UAT visual de Hoy, Agenda y Alumnas.
3. Terminar F2 pendiente, especialmente RLS tests y contrato de login Student MVP teléfono+contraseña.
4. Completar F3 Alumnas.
5. Implementar F4 Instructores.
6. Retomar F5 → F6 → F7 en orden, reutilizando lo compatible ya construido.
