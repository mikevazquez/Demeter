# Lectores mínimos — propuesta revisable, no aplicada

[Propuesta exacta](https://github.com/mikevazquez/Demeter/blob/b9e1291b66d0ee3866c112de199b7633c65853a4/reader-permissions-proposal.md), [PR #308 Draft](https://github.com/mikevazquez/Demeter/pull/308). SHA `b9e1291b66d0ee3866c112de199b7633c65853a4`.

## Resultado

Auditoría SELECT-only: el lector sigue ausente en ambas bases. Producción concede PUBLIC USAGE de net y permisos sobre net.http_request_queue y net._http_response. Un rol nuevo con NOINHERIT conservaría ese acceso. Candidate registra cero relaciones/definers accesibles por PUBLIC en el preflight. No se crearon roles ni cambiaron ACL remotas.

Se propuso retirar únicamente USAGE de net a PUBLIC, preservando grants explícitos ya observados para los roles conocidos. El alta NOLOGIN del lector se niega si los permisos heredados exceden el contrato o el lector ya existe. SQL fuera de workflows, con guardas/transacciones, sin contraseñas, membresías, grants de negocio ni eliminación de históricos.

Se observaron cinco dispatchers privados de postgres y cuatro cron directos net ejecutados como postgres; ese rol tiene USAGE explícito. El event trigger issue_pg_net_access observado se limita a CREATE EXTENSION. No se ejecutó ningún dispatcher, cron o función HTTP; no se leyeron comandos cron, payloads HTTP, vault ni secretos. Clientes externos y cobertura funcional completa no están certificados: no se presume impacto cero.

## Validación

- Seis pruebas de PostgreSQL WASM aislado PASS, cero fallos. Detectan PUBLIC, demuestran que NOINHERIT/REVOKE individual no bastan, ensayan el REVOKE específico conservando roles explícitos, bloquean adopción del lector existente, rechazan versión de extensión incorrecta y detectan regresión de ACL.
- El positivo usa un emulador SQL, no pg_net nativo; no certifica impacto productivo ni comunicaciones. El guard productivo completo solo tiene negativo aislado; las precondiciones reales se observaron mediante SELECT-only.
- [Contrato y TLS del SHA SUCCESS](https://github.com/mikevazquez/Demeter/actions/runs/38859805792): nueve pruebas PASS y handshake del pooler con hostname verificado. Sin autenticación DB ni SQL remoto desde ese workflow.
- [Runtime del SHA SUCCESS](https://github.com/mikevazquez/Demeter/actions/runs/38859805808).

## Decisión indispensable

La regla vigente del usuario dice «No modificar ni desplegar producción». Revocar USAGE de PUBLIC en net y crear un rol productivo son cambios de producción: falta autorización específica para este alcance revisable. No concede promoción.

Alcance propuesto: ajuste único de USAGE net/PUBLIC en producción, preservando roles explícitos y con verificación/reversión acotadas; después del preflight, alta NOLOGIN de sf_gov_schema_reader en producción y Candidate. La habilitación de LOGIN, contraseña y carga de secretos requiere administrador por canal seguro, nunca por chat. Un NOLOGIN creado no termina el hito de lector utilizable.

No ejecutar por publicar la propuesta o pasar CI; no fusionar ni activar controller/request.json por inferencia. Después de lectores utilizables faltan captura autenticada, rechazo real por divergencia, conciliación Candidate y B03.

## Porcentajes conservados

Mismos 24 hitos: **9/24 terminados (37,5%), 15/24 pendientes (62,5%)**. Fase 1: 3/8 terminados, 5/8 pendientes (62,5%); fase 2 falta 42,9%; fase 3 falta 66,7%; fase 4 falta 100%. Preparación probada no equivale a permisos aplicados ni credenciales disponibles; el contador no aumenta.

Los 38 criterios formales conservan sus estados. Producción, main y ambas ramas de control intactas. Sin otra tarea de cola, compras ni API de modelo de pago.
