# SF-OS-001 B02 — Controles de promoción por canal (diseño verificable, sin aplicarlos a producción)

**Estado:** propuesta operativa, **NO habilita promoción**. Actualizado 2026-10-14.
**Fuente de verdad:** SF-GOV-001 Notion y [issue #287](https://github.com/mikevazquez/Demeter/issues/287).
**Cambio aislado:** PR #278 rama `governance/sf-gov-001-release-gates`. Se prohíben cambios directos a Production con esta tarea.

## Principio de autorización

**Dos puertas separadas.** La aprobación técnica de código y QA, delegada al asistente, no constituye aceptación funcional ni autorización de producción. El PO debe emitir la frase literal **«Autorizo promoción»** con proyecto, target, alcance y SHA. La autorización no se almacena como un booleano escrito por un job ni como un JSON autodeclarado. Debe asociarse a un evento auditado del controlador y no puede ser sustituida por un comentario de PR, CI verde o un despliegue Preview.

## Matriz de riesgo y barreras

| Canal | Acceso observado | Barrera existente | Riesgo residual | Barrera y prueba aún exigidas |
| --- | --- | --- | --- | --- |
| GitHub `main` | Rol repo admin del PO | Ruleset #24974628 ACTIVE, `update` sobre rama predeterminada, bypass vacío, `quality` requerido; entorno `sf-gov-schema-capture` rechaza ref del PR | El gate protege ref/flujo de Git, pero no credenciales administrativas de Vercel/Supabase ni otros endpoints | Controller de promoción autorizado por PO, branch de controlador restringida, prohibir ejecuciones no autorizadas; prueba de denegación y aprobación atada al mismo SHA |
| Vercel `demeterbueno` | Team con OWNER; 7 overrides Preview aislados de rama | Build preflight verifica Candidate exacto y provider markers inertes | OWNER puede promover otro artefacto o alterar secrets/alias desde fuera del PR; Previews históricos u otras ramas no certificados | Deploy Controller con permisos mínimos y environments/roles si capacidad disponible, prohibir auto-promote a producción, verificar recursos protegidos y trazas auditables; no cambiar proyecto productivo sin «Autorizo promoción» |
| Supabase producción `qfhojvgvhrbautvczffq` | API de administración con privilegios directos; PostgreSQL `postgres` posee DML elevado | Políticas de app, RLS y CI no restringen administrador / service-role | SQL, funciones Edge, secretos y Auth pueden mutarse fuera de GitHub | Evitar claves productivas en Candidate/CI/Preview; controlador de migraciones con aprobación externa, credenciales efímeras y alcance mínimo si plataforma lo permite, acceso/operaciones auditadas; test de rechazo de operación NO ejecutado sobre producción |
| Supabase Candidate `sdmxtlgjkodidjtvikng` | Proyecto separado, Auth public `disable_signup=true` según settings | 8 Edge con guarda 503 antes de proveedor, diagnóstico 200/PASS, 7 overrides Preview inertes | Faltan coverage de rutas indirectas/SDK, identidad/tenant positiva | Ampliar mock/transports e identidad sintética por rol/tenant, E2E seguros, leer logs y verificar no tránsitos a proveedores |

## Antes de cualquier promoción de producción

1. **No ejecutar** en esta auditoría: merge de PR, `vercel promote`, rollback productivo, producción SQL, Edge deploy, escritura de secrets, configuraciones productivas ni operación con cuenta/mensaje/pago real.
2. Capturar SHA de artefacto build inmutable y manifiesto de alcance; schema attestation firmada, matrices UAT y resultado de CI vinculados al SHA.
3. Registrar aprobación funcional del PO y autorización explícita **«Autorizo promoción»** con SHA, destino y módulos. Son decisiones diferentes.
4. Requerir aprobación auditable en environment separado del deploy y verificar que mismo artefacto/SHA llegó al target. No autorizar acceso service role a Preview.
5. Negativo: intento desde rama o actor no autorizados no debe arrancar job ni obtener token de plataforma; almacenar job annotations y HTTP códigos sin revelar secretos. Positivo: sólo después de autorización explícita.
6. Tener reversión no destructiva y verificar integridad de movimientos, pagos, reservas y auditoría. Conservar históricos.

## Criterios de evidencia para cerrar B02

- [x] Gate GitHub `main` en freeze (evidencia ya registrada; no repetir ni modificar).
- [x] CI del SHA `448bfd4c34c1c7bcfcfa2daebcc80b337b852422` pasó: https://github.com/mikevazquez/Demeter/actions/runs/38649085812.
- [x] Candidate public Auth `disable_signup=true` verificado mediante GET (sin crear usuarios).
- [x] Candidate ocho negativas 503 y sesión user sintética en evidencia versionada.
- [ ] Nuevas pruebas de cierre del **HEAD final** después de modificar documentación.
- [ ] Prueba auditable de denegación de **cada** camino de promoción directa; no inferirla del freeze de Git.
- [ ] Matriz completa de egress dinámico/SDK/rutas operativas y E2E por rol/tenant; ninguna transacción real.
- [ ] Aprobación funcional, decisiones PO y manifiesto de cierre SHA-linked con DoD de SF-OS-001.

La separación en ambientes no evita por sí misma operaciones del propietario (OWNER/admin). **No revocar credenciales ni roles al PO sin plan de recuperación/segundo administrador**, pues provocaría pérdida de acceso. No sustituir controles técnicos inexistentes por la promesa de un proceso manual.

## Siguiente bloque operativo

Implementar/verificar el controlador de promoción **sin conceder acceso productivo al ejecutor de CI**. Si el plan o permisos actuales no ofrecen un enforcement verificable sin cambiar producción, mantener B02 bloqueado e informar exactamente la decisión administrativa requerida al PO. Al cerrar B02, habilitar B03 de identidades sintéticas por rol y tenant con sus gates independientes.
