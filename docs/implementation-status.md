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
- SF-002 Estructura modular: **PARCIAL** — existe separación `app`, `components`, `lib`, `supabase`, `tests` y `docs`; falta completar la capa application/domain al entrar en reglas de negocio complejas.
- SF-003 ESLint/Prettier/typecheck: **COMPLETO** — configuración versionada y verificada por CI.
- SF-004 CI: **COMPLETO** — pipeline reproducible con `npm ci`, format check, lint, typecheck, unit tests y build. Última ejecución base verificada en verde.
- SF-005 Env validation: **COMPLETO** — `.env.example` sin secretos y acceso a variables públicas centralizado/validado en `lib/env.ts`.
- SF-006 Supabase/Vercel: **PARCIAL** — Supabase oficial y despliegue funcional existen; quedan proyectos Vercel duplicados/históricos y el plan está bloqueando temporalmente nuevos builds por rate limit.
- SF-007 ADR arquitectura: **COMPLETO** — ADR versionado en `docs/adr/0001-studio-flow-architecture.md`.

F0 queda **operativamente cerrada salvo saneamiento externo de Vercel y evolución natural de la capa domain/application**. No se bloquea F1 por esas dos tareas residuales.

## F1 · Sistema visual / shell

- SF-008 Tokens visuales: **IMPLEMENTADO, PENDIENTE UAT** — dark UI carbón/azul, `#FF0A8A`, estados verde/ámbar/rojo y superficies/bordes normalizados contra M01.
- SF-009 Admin shell responsive: **IMPLEMENTADO, PENDIENTE UAT** — sidebar desktop/tablet y adaptación móvil.
- SF-010 Componentes base: **IMPLEMENTADO, ADOPCIÓN PROGRESIVA** — `Button`, `Card`, `Badge`, `Input` y `StatePanel` reutilizables; las pantallas existentes se migrarán sin rehacer lógica.
- SF-011 Estados UI: **IMPLEMENTADO COMO SISTEMA, ADOPCIÓN PARCIAL** — loading/empty/error/unauthorized/success disponibles; falta aplicarlos de forma uniforme en cada pantalla conforme se cierra su Epic.
- SF-012 Navegación admin: **IMPLEMENTADO, PENDIENTE UAT** — taxonomía canónica; módulos no construidos aparecen deshabilitados, no simulados.
- SF-013 Hoy: **IMPLEMENTADO CONTRA M01, PENDIENTE UAT** — saludo, KPIs operativos reales, próxima clase destacada, acciones rápidas y agenda del día; no se inventan KPIs comerciales de F13.
- SF-014 Shell móvil: **IMPLEMENTADO, PENDIENTE UAT** — bottom navigation y layouts responsive; falta prueba física iPad/móvil.

F1 no se declara cerrada hasta que exista un deployment disponible y se haga UAT visual real en desktop/iPad/móvil, como exige el Documento Maestro.

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

1. UAT visual de F1 en cuanto Vercel permita un deployment nuevo.
2. Mientras el deployment está bloqueado, completar F2 sin adelantar OTP: capabilities, AdminContext, login Student MVP teléfono+contraseña y pruebas RLS.
3. Completar F3 Alumnas y validar M02.
4. Implementar F4 Instructores.
5. Retomar F5 → F6 → F7 en orden, reutilizando lo compatible ya construido.
