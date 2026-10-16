# INV-UAT-01 — lectores mínimos: propuesta pendiente de autorización

Estado: **PREPARADO PARA REVISIÓN; NO APLICADO**. El PR sigue Draft. No se ha
ejecutado DDL, creado un lector, cambiado una ACL remota ni leído filas de negocio.

## Hallazgo comprobado por SELECT-only

En producción (`qfhojvgvhrbautvczffq`), `PUBLIC` tiene USAGE sobre `net` y permisos
de tabla sobre `net.http_request_queue` y `net._http_response`. Un rol nuevo los
heredaría aunque use NOINHERIT y no reciba grants propios. La propuesta de lector
ahora debe rechazar ese estado; no basta crear el usuario y llamarlo read-only.

Candidate (`sdmxtlgjkodidjtvikng`) no muestra relaciones ni SECURITY DEFINER
accesibles por PUBLIC en la auditoría consultada. En ambas bases falta
`sf_gov_schema_reader`. Ambas conceden CONNECT/TEMPORARY a PUBLIC.

Se consultaron únicamente ACL, nombres de objetos/roles, versión de extensión y
metadatos de ejecución. No se consultaron colas/respuestas HTTP, comandos cron,
definiciones con secretos, vault, tokens ni mensajes.

## Cambio productivo mínimo propuesto

1. Tras autorización específica, verificar proyecto, versión `pg_net 0.20.4`,
   propietario y grants actuales. La base `postgres` por sí sola no identifica el
   proyecto: usar el conector ligado al project_id exacto o el endpoint verificado.
2. Aplicar únicamente `REVOKE USAGE ON SCHEMA net FROM PUBLIC`, con las guardas de
   [production-net-usage.proposal.sql](scripts/sql/production-net-usage.proposal.sql).
   Se conservan los grants explícitos existentes para postgres,
   supabase_functions_admin, anon, authenticated y service_role; el propietario
   supabase_admin conserva su acceso. No se revocan masivamente tablas/funciones,
   no se alteran crons ni se disparan solicitudes HTTP.
3. Repetir el preflight de catálogo. Solo si da cero accesos incompatibles, aplicar
   [reader-role.proposal.sql](scripts/sql/reader-role.proposal.sql) en cada proyecto
   autorizado. Crea un rol **NOLOGIN**, sin password, superuser, BYPASSRLS,
   membresías ni grants de negocio; límite de dos conexiones, timeout 15 s,
   search_path pg_catalog y default_transaction_read_only=on.
4. Conservar las observaciones previas/posteriores y verificar identidad y ACL.
   Si la lectura es incompleta o cambia la configuración, detener; no continuar
   por inferencia. Si tras el ajuste debe revertirse, el inverso exacto es
   `GRANT USAGE ON SCHEMA net TO PUBLIC`, sujeto al mismo alcance autorizado y
   verificación del estado. Un lector creado se conserva NOLOGIN; no borrar roles
   ni históricos como limpieza automática.

Los SQL no se invocan desde ningún workflow. No constituyen una migración
automática ni una autorización implícita. El alta rechaza un lector preexistente:
no modifica, adopta o cambia contraseñas de otro rol. Cada archivo es transaccional;
si falla un guard, el administrador debe hacer rollback y reauditar, sin bucles.

## Impacto conocido y límite de la auditoría

Los cinco dispatchers privados catalogados son SECURITY DEFINER de postgres. Los
cuatro cron con llamadas directas net observados también usan postgres. Este rol
ya tiene USAGE explícito, igual que los otros roles previstos. El repositorio
contiene usos de net.http_post; no se llamó a ninguno durante la revisión.

Esto respalda el cambio específico y evita una revocación global innecesaria,
pero no identifica clientes externos, roles futuros o todos los efectos del
runtime. Por tanto, **no equivale a impacto productivo cero probado ni a UAT
funcional de comunicaciones**. Se necesita autorización del propietario y
observación acotada después de aplicar. La cobertura de canales sigue en #289.

El default read-only del rol es configuración, no una prohibición irreversible:
un usuario puede cambiar parámetros de su sesión. TEMPORARY heredado de PUBLIC y
las funciones invoker no quedan certificados exhaustivamente por este guard.
La captura segura depende también del controlador protegido que ejecuta solo SQL
versionado, transacción READ ONLY, auditoría de identidad/permisos y ningún código
candidato. No distribuir la credencial del lector ni afirmar cero capacidad de
cualquier efecto SQL basándose únicamente en NOINHERIT/default read-only.

## Credenciales y activación posterior

El rol NOLOGIN no permite capturar ni cuenta como lector disponible. Una vez
auditados los permisos y autorizado el alta utilizable, un administrador deberá
habilitar LOGIN y establecer una contraseña mediante un mecanismo seguro como
psql `\password`; no ponerla en SQL versionado, chat, logs o historial de comandos.
Guardar únicamente en `sf-gov-schema-capture` las URLs de ambos lectores y la clave
de firma. La sesión actual no aporta ese canal administrativo de aprovisionamiento
de credenciales; no usar postgres/service_role para sustituir al lector.

No activar `controller/request.json`, fusionar el PR ni emitir una atestación solo
por completar esta preparación. Faltan captura autenticada, negativo real por
divergencia, conciliación Candidate y aceptación correspondiente.

## Pruebas realizadas

Seis pruebas en PostgreSQL WASM aislado, sin red ni pg_net nativo:

- PUBLIC net bloquea el alta y no deja un rol creado.
- NOINHERIT y REVOKE individual no eliminan los permisos de PUBLIC.
- El REVOKE específico de USAGE conserva los roles explícitos; el lector preparado
  queda NOLOGIN y no puede leer la cola ni llamar al emulador SQL de net.http_post.
- Un lector existente no se adopta ni modifica.
- La propuesta productiva rechaza un entorno sin la versión exacta de pg_net.
- Si reaparecen grants de PUBLIC, la captura vuelve a detectar el acceso.

El positivo ensaya la instrucción de ACL y el alta, **no** carga pg_net, envía HTTP
ni certifica dependencias productivas. El guard productivo completo solo tiene
negativo aislado; sus precondiciones reales se observaron mediante SELECT-only.

Desde un checkout con la dependencia PGlite existente, sin instalar servicios:

```sh
node --test --test-concurrency=1 /ruta/al/controlador/scripts/controller-reader-role.test.mjs
```

## Autorización necesaria y porcentaje

El siguiente cambio que exige decisión del propietario es el ajuste específico de
USAGE de net en producción y el alta NOLOGIN de los lectores en los dos proyectos.
No hay autorización vigente para modificar producción. Esta autorización de ACL
no concede promoción; «Autorizo promoción» sigue siendo requisito independiente.

El hito de lectores continúa pendiente hasta contar con ACL auditadas, identidad
utilizable y secretos seguros. La base de 24 hitos no cambia: 9/24 terminados
(37,5%), 15/24 pendientes (62,5%); fase 1 pendiente 5/8 (62,5%). Preparar y probar
la propuesta no se contabiliza como aplicar permisos ni completar ese hito.

Referencias: https://supabase.com/docs/guides/database/postgres/roles y
https://www.postgresql.org/docs/current/sql-grant.html.
