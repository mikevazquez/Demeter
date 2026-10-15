# SF-OS-001 B02 — Controles de promoción por canal (diseño verificable, sin aplicarlos a producción)

**Estado:** propuesta operativa, **NO habilita promoción**. Actualizado 2026-10-14.
**Fuente de verdad:** SF-GOV-001 Notion y [issue #287](https://github.com/mikevazquez/Demeter/issues/287).
**Cambio aislado:** PR #278 rama `governance/sf-gov-001-release-gates`. Se prohíben cambios directos a Production con esta tarea.

## Principio de autorización

**Dos puertas separadas.** La aprobación técnica de código y QA, delegada al asistente, no constituye aceptación funcional ni autorización de producción. El PO debe emitir la frase literal **«Autorizo promoción»** con proyecto, target, alcance y SHA. La autorización no se almacena como un booleano escrito por un job ni como un JSON autodeclarado. Debe asociarse a un evento auditado del controlador y no puede ser sustituida por un comentario de PR, CI verde o un despliegue Preview.

## Matriz de riesgo y barreras

**GitHub `main`:** repo admin conserva acceso; ruleset #24974628 está ACTIVE con `update`, `quality` obligatorio y bypass vacío. El freeze del ref no bloquea Vercel ni Supabase. Falta controlador de promoción autorizado por PO, prueba de denegación y evidencia ligada al SHA.

**Vercel `demeterbueno`:** equipo con OWNER y siete overrides exclusivos de la rama Preview. Preflight verifica Candidate y credenciales inertes, pero OWNER puede promover otro artefacto o editar secretos/alias fuera del PR. Falta verificar gate de permisos, identidad del artefacto y trazas auditables. Nada de cambios productivos sin «Autorizo promoción».

**Supabase producción `qfhojvgvhrbautvczffq`:** acceso administrativo y PostgreSQL `postgres` con DML elevado. Las políticas de aplicación y CI no restringen estas vías directas. Exigir credenciales mínimas, flujo aprobado, registro de operaciones y pruebas de rechazo; no ejercitar cambios sobre producción.

**Supabase Candidate `sdmxtlgjkodidjtvikng`:** Auth público `disable_signup=true`, ocho Edge con 503 antes del proveedor, diagnóstico 200/PASS y overrides Preview inertes. Falta certificar rutas indirectas/SDK e identidad sintética por rol/tenant.

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

## Ensayo GitHub Production de solo aprobación (sin promoción)

En la rama de gobierno existe el workflow `.github/workflows/sf-gov-production-approval-rehearsal.yml`: entrada `workflow_dispatch` solo en `main`, actor `mikevazquez`, SHA hexadecimal exacto de 40 caracteres y alcance no vacío. El job de revisión consume `environment: Production`, sin permisos de token (`permissions: {}`), checkout, credenciales ni comandos de despliegue. CI valida estáticamente esta estructura en `scripts/sf-gov-production-approval-rehearsal.test.mjs`.

**No está activo para producción mientras el PR #278 siga DRAFT y sin merge.** Ni el texto del alcance ni el actor ni una ejecución verde equivalen a «Autorizo promoción». La protección de GitHub Environment debe comprobarse con una ejecución **pendiente de revisión** y con negativa ante rama/actor/SHA incorrectos **después de una habilitación independiente expresamente autorizada**, sin habilitar credenciales reales en el ensayo. Un job de ambiente no puede impedir que el propietario despliegue directamente por el panel Vercel o ejecute SQL con credenciales administrativas Supabase: son bloqueos independientes que siguen sin certificarse.

Nunca agregar al workflow de ensayo `vercel promote`, `supabase db push`, deploy Edge, service-role, alias ni secretos. Un release real requiere controlador separado y manifest/UAT/PO vinculados a la misma versión.
