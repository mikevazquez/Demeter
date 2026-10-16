# Governance — avance por hitos verificables

Base fija: **24 hitos técnicos**, igual peso por hito. Es un desglose del alcance existente: no crea tareas ni sustituye los 38 criterios originales de aceptación. No mide horas, dificultad ni fecha de entrega. Un hito de preparación puede estar terminado en Draft; no implica integración, activación o UAT aprobado.

Primera medición: **9/24 terminados (37,5%); 15/24 pendientes (62,5%)**. Incluye trabajo anterior, no nueve cierres nuevos de este bloque. Se conserva esta base en los siguientes reportes; cualquier cambio de alcance debe quedar explícito, sin borrar la medición anterior.

Fórmula: pendiente = (hitos pendientes / hitos de la fase) × 100. El global usa 15/24; no es el promedio simple de cuatro porcentajes.

| Fase                                                 | Terminados | Pendientes | Completado | Falta      |
| ---------------------------------------------------- | ---------- | ---------- | ---------- | ---------- |
| 1. Candidate confiable y UAT seguro                  | 3/8        | 5/8        | 37,5%      | **62,5%**  |
| 2. Governance automático y continuidad               | 4/7        | 3/7        | 57,1%      | **42,9%**  |
| 3. Protección y preparación de liberación            | 2/6        | 4/6        | 33,3%      | **66,7%**  |
| 4. Promoción autorizada y verificación de producción | 0/3        | 3/3        | 0,0%       | **100,0%** |

El frente principal sigue siendo la fase 1. Bloqueo inmediato: faltan lectores mínimos y credenciales seguras; crear el lector productivo exige autorización separada porque modifica producción. Mientras tanto se verificó evidencia independiente de fase 2, sin disparar otra tarea ni forzar ciclos. Ninguna fase está cerrada globalmente.

## Fase 1 — Candidate confiable y UAT seguro

- [x] CI de #278 aprobada en su SHA vigente. [Evidencia 1](https://github.com/mikevazquez/Demeter/actions/runs/38855648728).
- [x] Preflight de fixtures B03 implementado y probado con denegación segura. [Evidencia 1](https://github.com/mikevazquez/Demeter/actions/runs/38855648728).
- [x] Captura Session pooler preparada y red/TLS del runner comprobados. [Evidencia 1](https://github.com/mikevazquez/Demeter/pull/308) · [Evidencia 2](https://github.com/mikevazquez/Demeter/actions/runs/38857703808) · [Evidencia 3](https://github.com/mikevazquez/Demeter/actions/runs/38857703823).
- [ ] Lectores mínimos y secretos seguros disponibles, con ACL auditadas.
- [ ] Captura autenticada protegida y rechazo real ante divergencias.
- [ ] Esquema Candidate conciliado y equivalencia certificada.
- [ ] Aislamiento runtime, outbound, roles/tenants, fixtures y cleanup verificados.
- [ ] E2E críticos y fallo bloqueante del candidato aceptados.

## Fase 2 — Governance automático y continuidad

- [x] Núcleo de decisiones y pruebas automatizadas GOV implementados. [Evidencia 1](https://github.com/mikevazquez/Demeter/actions/runs/38818217574).
- [x] Puente y selección aislada de un solo ID probados. [Evidencia 1](https://github.com/mikevazquez/Demeter/pull/304) · [Evidencia 2](https://github.com/mikevazquez/Demeter/actions/runs/38835220556).
- [x] Piloto supervisado con certificación independiente y publicación Draft cerrado. [Evidencia 1](https://github.com/mikevazquez/Demeter/pull/307) · [Evidencia 2](https://github.com/mikevazquez/Demeter/issues/306).
- [x] Journal durable y recuperación desde runner independiente comprobados. [Evidencia 1](https://github.com/mikevazquez/Demeter/actions/runs/38818217563).
- [ ] Ejecutor incluido autenticado y puente automático operando en entorno autorizado.
- [ ] Tres despertares programados con evidencia por ciclo y recuperación acreditados.
- [ ] Aceptación operativa GOV-01…20, recuperación de errores y avisos cerrada.

## Fase 3 — Protección y preparación de liberación

- [x] Reglas de main y quality obligatorio configurados y consultados. [Evidencia 1](https://github.com/mikevazquez/Demeter/rules/24974628).
- [x] Environment de captura restringido y rechazo de rama PR comprobados. [Evidencia 1](https://github.com/mikevazquez/Demeter/actions/runs/38855648717).
- [ ] Gates efectivos de todos los canales y accesos aplicables acreditados. [Evidencia 1](https://github.com/mikevazquez/Demeter/issues/289).
- [ ] Delta, manifiesto, artefacto y destino exactos verificados.
- [ ] Restauración y rollback ensayados en aislamiento sin perder históricos.
- [ ] Trazabilidad y aceptación previa completa de DOC/PIL y UAT aplicables.

## Fase 4 — Promoción autorizada y verificación de producción

- [ ] Autorización específica «Autorizo promoción» para SHA/artefacto aceptados.
- [ ] Promoción del artefacto autorizado e identidad servida comprobada.
- [ ] Smoke, observación productiva y cierre documental/aceptación posterior.

## Evidencia de continuidad revisada en este bloque

[Auditoría reproducible](evidence/governance-continuity-20261015/README.md): el artefacto de otro runner recupera revisión y secuencia idénticas del journal; el no-op histórico no ejecutó ni publicó tareas. Se recuperaron las fuentes, no se infirió el resultado de un título o comentario.

La automatización alojada está habilitada. Las fuentes disponibles no acreditan tres despertares programados: **0/3 verificados**, que no equivale a afirmar cero despertares reales. Los dos eventos cycle guardados en el journal y el run GitHub de tipo push no se cuentan como tres ciclos programados. Ese hito sigue pendiente.

## Relación con la aceptación formal

[Matriz de 38 criterios originales](governance-closure-matrix.md). Los porcentajes son por hitos técnicos, no por UAT formal aprobado. B02 y el piloto supervisado permanecen cerrados bajo su alcance revisado; no se repiten ni se convierten en cierre del circuito funcional de producción. La promoción continúa sin autorización.
