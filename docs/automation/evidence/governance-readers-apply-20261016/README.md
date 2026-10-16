# Aplicación autorizada de lectores — resultado parcial verificado

Autorización del propietario: «Autorizo», referida al alcance del PR #308 en
`b9e1291b66d0ee3866c112de199b7633c65853a4`: ajuste puntual de USAGE net/PUBLIC en
producción y alta NOLOGIN de lectores en producción/Candidate. No autoriza LOGIN,
contraseñas ni promoción. No debe volver a pedirse esta misma autorización.

## Candidate: aplicado y verificado

Proyecto `sdmxtlgjkodidjtvikng`, migración `20261016061746`, nombre
`sf_gov_001_candidate_schema_reader_nologin`. El lector existe con NOLOGIN,
sin superuser, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS ni INHERIT; límite dos
conexiones; default read-only, timeout 15 s y search_path pg_catalog.
La verificación de catálogo devuelve cero membresías, accesos efectivos a
relaciones fuera de catálogos y SECURITY DEFINER accesibles. No hay password
generada ni acceso autenticado del lector; no confundir con captura real.

## Producción: transacción abortada, sin lector ni migración aplicada

Proyecto `qfhojvgvhrbautvczffq`. Se enviaron juntas las dos propuestas revisadas
mediante una migración transaccional. La guarda posterior al REVOKE detectó que
PUBLIC seguía teniendo acceso y abortó: `PUBLIC grants exceed reader contract;
no role created`. La relectura confirma: lector ausente, PUBLIC conserva acceso
a las dos tablas net y no existe entrada de la migración intentada.

La conexión actúa como postgres, no superuser, sin membresía en supabase_admin y
sin grant option de USAGE net. El esquema pertenece a supabase_admin. Esta es
una limitación de autoridad real del esquema gestionado, no falta de aprobación
del propietario ni rechazo de revisión automática. No se intentó elevar roles,
reemplazar credenciales ni alterar propietarios.

## Corrección técnica y pruebas

[Código corregido](https://github.com/mikevazquez/Demeter/commit/c8200d130bfa186c74a06114d38b204c3e248f4e): el guard de ACL comprueba ownership antes del REVOKE, para rechazar una
sesión que tenga USAGE pero no autoridad sobre grants del propietario.

- Siete pruebas PostgreSQL WASM aisladas PASS, incluida la nueva negativa de
  sesión sin ownership. No se carga pg_net nativo ni se prueba envío HTTP.
- [Contrato y TLS SUCCESS](https://github.com/mikevazquez/Demeter/actions/runs/38860868225): nueve pruebas de contrato y hostname del pooler verificado.
- [Runtime SUCCESS](https://github.com/mikevazquez/Demeter/actions/runs/38860868220).
- Inventario de advisors guardado como resumen; no es comparación antes/después
  ni aprobación global de seguridad/RLS. No se alteraron schemas de aplicación.

La CLI de GitHub devolvió 401 al recuperar CI; se utilizó el conector GitHub ya
conectado para completar la evidencia. No se pidió ni obtuvo otra credencial.

## Intervención humana mínima

Usar el canal administrativo/soporte de Supabase ya disponible para solicitar a
un operador con autoridad de supabase_admin que aplique el cambio puntual en el
proyecto productivo. El SQL Editor normal utiliza postgres y no resuelve ese
límite. [Texto listo para copiar](support-request-draft.md); **no enviado**.
No contratar planes ni delegar superuser a la aplicación.

Después de la confirmación, Ingeniería releerá ACL/preflight y ejecutará solo el
alta NOLOGIN productiva ya autorizada. Candidate no se reprovisiona. LOGIN,
contraseñas y secretos seguros siguen pendientes de administrador por canal
seguro; no deben compartirse por chat. No reintentar automáticamente la migración
productiva completa ni activar controller/request.json por inferencia.

## Porcentaje y efectos

La preparación de Candidate es un subpaso real terminado; el hito completo de
lectores/ACL/secretos permanece pendiente. Mismos 24 hitos: **9 terminados
(37,5%), 15 pendientes (62,5%)**. Falta por fase: 1=62,5%; 2=42,9%; 3=66,7%;
4=100%. No se cambian los estados formales de los 38 criterios por este resultado.

No hay cambios persistentes nuestros en producción, promociones, merges,
ejecución de otras tareas de cola, llamadas HTTP/cron, compras ni API de modelo
de pago. Candidate conserva el lector NOLOGIN y su historial administrativo.
