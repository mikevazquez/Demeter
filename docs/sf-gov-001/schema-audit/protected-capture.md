# INV-UAT-01 — Captura protegida: implementación y activación pendiente

## Implementado en la rama de gobierno

`scripts/capture-schema-attestation.mjs` consulta directamente los dos endpoints
fijos con `/usr/bin/psql`. Solo acepta el usuario `sf_gov_schema_reader`, base
`postgres`, puerto 5432, TLS `verify-full` y certificados del sistema. No acepta
poolers, opciones de conexión arbitrarias, SQL ni snapshots aportados por el
candidato. Requiere libpq 17 o posterior con soporte de `sslrootcert=system` y
conectividad IPv6 al endpoint directo; si no están disponibles, falla cerrado.

Ejecuta el SQL versionado en transacción REPEATABLE READ READ ONLY con timeout,
search_path limitado a pg_catalog y rollback. Comprueba identidad, ausencia de
atributos privilegiados y membresías. No hereda variables de entorno hacia psql,
ni transmite la clave de firma al proceso hijo. Errores de conexión no se imprimen.
Solo firma si las siete categorías están completas y son iguales. Conserva los
controles existentes de fecha, SHA y proyecto.

`scripts/capture-release-gate.mjs` conecta esa captura al validador de manifiesto.
Exige target production-staged, SHA exacto y UAT según GOV-COM-02. Solo escribe
evidencia nueva (modo 0600, sin sobrescritura) si todo pasa. No despliega ni concede
consentimiento humano. Cada ejecución debe usar una ruta nueva en un runner limpio;
un consumidor nunca debe reutilizar evidencia antigua tras un fallo del comando.

## Límite de confianza y estado real

El código solo es confiable si el controlador, binario psql, runtime y SQL están
protegidos. **No activar desde el checkout de un PR o candidato, ni compartir los
secretos con sus tests, build, dependencias o scripts.** El módulo admite un runner
inyectado para tests; eso no constituye evidencia de captura real. Los tests usan
contraseñas ficticias, respuestas simuladas y PostgreSQL WASM aislado.

No se ha instalado un controlador protegido ni configurado secretos. No se ha
conectado este proceso nuevo a producción ni a Candidate. El HMAC es simétrico:
todo proceso que verifica con la clave también puede firmar; por ello ambos deben
vivir exclusivamente en el mismo límite de confianza. No distribuir esa clave a
jobs del candidato. INV-UAT-01 sigue Preparado, no Aprobado.

## Activación concreta, aún no ejecutada

1. Preparar un controlador de gobierno separado del despliegue de la app, con
   checkout de un SHA revisado e inmutable de estos scripts y su SQL. No ejecutar
   npm install, código ni workflows del candidato en ese job. El manifiesto se
   obtiene como JSON del SHA candidato y se trata solo como datos.
2. Proteger el entorno GitHub `sf-gov-schema-capture`: permitir exclusivamente la
   rama del controlador protegida; revisión del propietario para acceso; impedir
   que una rama de PR solicite secretos. Confirmar reglas antes de cargar secretos.
   El conector actual no expone administración de environments/secrets; esta
   configuración requiere acceso administrativo compatible o intervención de Mike.
3. Autorizar por separado el cambio de permisos productivos, si se usa un nuevo
   rol. Propuesta mínima: `sf_gov_schema_reader` LOGIN NOSUPERUSER NOCREATEDB
   NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; CONNECT a postgres; sin membresías,
   sin grants sobre tablas de alumnas, pagos o mensajes; default_transaction_read_only
   activado. Contraseña generada y guardada por un gestor, nunca en SQL versionado,
   chat o Notion. Aplicar igualmente en Candidate bajo el alcance autorizado.
4. Antes de activar, auditar privilegios efectivos heredados de PUBLIC, funciones
   SECURITY DEFINER, grants de tablas y capacidad de SET ROLE. NO revocar PUBLIC
   masivamente: puede romper negocio. El chequeo del capturador cubre atributos y
   membresías, **no certifica por sí solo todos los ACL**. Si los permisos efectivos
   exceden la lectura de catálogo, detener y proponer corrección específica.
5. Guardar exclusivamente en ese entorno los secretos
   `SF_GOV_PRODUCTION_READER_URL`, `SF_GOV_CANDIDATE_READER_URL` y
   `SF_GOV_SCHEMA_ATTESTATION_KEY` (aleatoria, mínimo 32 caracteres). No usar
   service_role ni supabase_read_only_user con BYPASSRLS. No reutilizar secretos de
   Preview. La URL admitida tiene formato
   `postgresql://sf_gov_schema_reader:<password-encoded>@db.<ref>.supabase.co:5432/postgres`.
6. En el controlador protegido ejecutar:

   ```sh
   node scripts/capture-release-gate.mjs manifest.json "$CANDIDATE_SHA" "$RUNNER_TEMP/schema-evidence-new.json"
   ```

   El job consumidor debe depender de su éxito, SHA exacto y evidencia fresca.
   Antes de cualquier despliegue debe existir otro gate con autorización expresa
   del propietario para ese SHA. No implementar un simple campo JSON de aprobación.

7. Ejecutar negativos reales: rama no autorizada sin acceso a secretos; lector sin
   escritura; captura con diferencias rechazada; firma/captura caducada o alterada
   rechazada; SHA diferente rechazado. Registrar logs sin secretos. Las siete
   diferencias actuales Prod/Candidate deben impedir la certificación.

Este documento prepara una activación revisable; no autoriza cambios productivos,
costos, merge, creación de Mirror ni reemplazo del Sandbox histórico.

## Referencias técnicas

- https://www.postgresql.org/docs/current/app-psql.html
- https://www.postgresql.org/docs/current/libpq-ssl.html
- SQL de captura: `scripts/sql/schema-fingerprint.sql`.
