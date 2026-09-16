# Studio Flow · Rebaseline de alcance MVP

Fecha de aprobación: 2026-09-15

Decisión aprobada por producto: cerrar el alcance funcional del MVP con lo construido y validado hasta F10, pausar F11–F13 y pasar directamente a F14 para liberar Studio Flow a operación real en Demeter.

## Nuevo alcance del MVP

El MVP operativo incluye F0–F10 ya implementadas/cerradas y el release F14.

Quedan fuera del release inicial y pasan a post-MVP:

- F11 · Coach.
- F12 · Documentos + configuración avanzada.
- F13 · Reportes/hardening completo.

Este cambio no elimina esas fases ni sus tickets. Se conservan como backlog post-MVP para continuar después del lanzamiento.

## Regla de release

No se omite el hardening mínimo necesario para operar en producción. F14 absorbe como release gates únicamente los controles críticos que originalmente vivían en F13:

- validación de RLS/aislamiento en flujos críticos del alcance actual;
- secret scan y verificación de que no hay credenciales/service_role en cliente o repositorio;
- smoke test de Admin y Portal Alumna;
- sanity responsive en móvil/tablet/desktop de los flujos usados en operación;
- verificación de estados error/unauthorized en rutas críticas;
- backup/rollback y migraciones reproducibles;
- observabilidad mínima suficiente para detectar fallos de producción.

El resto de F13 (KPIs/reportes completos, E2E extendido, PWA/performance exhaustivo y hardening no bloqueante) pasa a post-MVP.

## F14 rebaselined

F14 pasa a ser la fase inmediata y su objetivo es poner en operación el producto actual de forma segura.

Incluye:

1. congelar alcance funcional del release;
2. validar seed/datos operativos necesarios de Demeter;
3. validar entorno oficial de producción Supabase/Vercel;
4. ejecutar migraciones reproducibles y comprobar consistencia;
5. ejecutar release gates críticos de seguridad/QA;
6. UAT final Admin y Alumna sobre el alcance actual;
7. smoke test producción;
8. checklist de release;
9. plan de rollback;
10. estabilización inicial.

No se exige UAT Coach porque F11 queda fuera de este MVP rebaselined.

## Estrategia post-lanzamiento

Después de liberar el MVP:

- Producción queda estable para operación diaria de Demeter.
- Se crea un entorno sandbox/staging aislado de producción, con su propio proyecto Supabase y su propio deployment/configuración de Vercel.
- El sandbox debe reflejar esquema/configuración de producción sin compartir credenciales ni depender de datos vivos.
- F11, F12 y F13 se desarrollan y prueban en sandbox.
- Las migraciones/cambios sólo se promueven a producción después de CI, QA/UAT y una revisión explícita de impacto.

## Fuente de verdad

Esta decisión explícita es posterior al Documento Maestro y, por la regla de precedencia del proyecto, redefine el alcance del MVP sin reabrir contratos ya cerrados en F0–F10.

F8, F9 y F10 permanecen cerradas salvo bug/regresión o cambio de alcance explícito.
