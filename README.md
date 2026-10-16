# SF-GOV-001 — Controlador aislado (Preparado; no activado)

Esta rama contiene únicamente scripts de gobierno, SQL de metadatos y el workflow
`schema-controller.yml`. Fuente revisada de los siete módulos existentes:
`d53d7e86a872160e216ee89f3fd3c4dedc6042ba` (PR #278, CI SUCCESS 38476131928).
No contiene la aplicación ni comandos de despliegue. `vercel.json` deshabilita
los despliegues Git para este árbol. No fusionar esta rama completa en main.

## Activación pendiente

1. Proteger exactamente `governance/sf-gov-001-controller` con ruleset activo:
   impedir eliminación y force push, exigir PR para cambios y no permitir bypass.
   Revisar cambios del controlador antes de fusionarlos; el propietario revisará
   también el SHA exacto en cada aprobación del environment.
2. En `sf-gov-schema-capture`, sustituir la regla `main` por esa rama exacta.
   Conservar reviewer mikevazquez y bypass administrativo desactivado. No añadir
   ramas de candidato, comodines ni refs de PR. Verificar mediante otro intento
   negativo desde PR y un intento permitido desde controlador sin credenciales.
3. Confirmar Node >=22, `/usr/bin/psql` >=17 y certificados del sistema. Se admite
   endpoint directo IPv6 o el Shared Session pooler IPv4 ya confirmado para ambos
   proyectos: `aws-0-us-east-1.pooler.supabase.com:5432`, base `postgres`, usuario
   `sf_gov_schema_reader.<project-ref>`. El usuario SQL verificado sigue siendo
   `sf_gov_schema_reader`. TLS sigue siendo `verify-full`, sin parámetros de URL.
   El pooler usa la CA pública oficial versionada en `scripts/certs`; el endpoint
   directo conserva los certificados del sistema. No se descarga CA en runtime.
   No se admite el pooler transaccional 6543, otro host/región ni usuario postgres.
   Validar red/TLS desde el runner no sustituye la captura autenticada de catálogo.
   No contratar runner, IPv4 ni recursos nuevos sin autorización de costo.
4. Resolver lectores dedicados y ACL conforme al documento de captura del PR278.
   No existe autorización aquí para cambiar roles/permisos productivos. No usar
   postgres, service_role ni usuarios BYPASSRLS. Auditar efectos heredados de PUBLIC.
5. Solo después de verificar protección/lectores, cargar los tres secretos en el
   environment: SF_GOV_PRODUCTION_READER_URL, SF_GOV_CANDIDATE_READER_URL y
   SF_GOV_SCHEMA_ATTESTATION_KEY. Nunca en repositorio, chat ni Notion.
6. Preparar `docs/sf-gov-001/release-manifest.json` en un commit de evidencias.
   Debe referenciar el SHA candidato y superar el validador y GOV-COM-02. Su SHA
   es distinto del candidato: incluir el hash de un commit dentro de sí mismo
   produciría una dependencia circular. No se ejecuta código del manifiesto.
7. Abrir y revisar un cambio de `controller/request.json` con exactamente:
   `{"candidate_sha":"<40 hex>","manifest_sha":"<40 hex>"}`. Su merge dispara
   el workflow. El archivo no existe en esta preparación para no activar captura.
   El checkout usa el SHA inmutable del evento de la rama protegida; el manifiesto
   se descarga únicamente como JSON desde el commit de evidencias del mismo repo.

## Evidencia y límites

Los tests de petición cubren SHA/URL/ruta no permitidos, respuesta ausente,
JSON inválido, límite 256 KiB, destino y SHA incorrectos. No ejecutan SQL remoto.
No se instalan dependencias ni se ejecuta código candidato en el job con secretos.
Los secretos solo se suministran al paso de captura. El artefacto de éxito contiene
metadatos agregados y firma, nunca credenciales ni filas de negocio; retención siete
días. Exportar su referencia y checksum a Notion antes de caducar. Un fallo no
produce certificación y el artefacto no se publica. El HMAC requiere custodiar
la clave en este mismo límite de confianza; no entregarla a jobs de candidato.

Las siete divergencias existentes deben rechazar la certificación; un rechazo
esperado sirve de evidencia negativa, no prueba equivalencia. El workflow no
promueve nada. Toda promoción exige autorización expresa separada para su SHA.

INV-UAT-01 permanece Preparado. El controlador no ha realizado captura remota.

## Continuación INV-UAT-01 — Session pooler preparado

La protección de rama/environment y PostgreSQL 17 ya tienen evidencia histórica;
no hay que repetir su configuración. El diagnóstico anterior del runner mostró
endpoint directo IPv6 sin ruta. La alternativa Session pooler utiliza capacidades
existentes; no exige contratar IPv4 ni otro runner.

El contrato se prueba sin dependencias, secretos ni bases remotas:

```sh
node --test scripts/controller-request.test.mjs scripts/controller-capture.test.mjs
```

Los positivos simulados no certifican conectividad ni paridad. El nuevo workflow
de contrato carece de permisos, environment y secretos; no produce atestaciones.
La captura protegida ejecutará estos tests antes del paso que recibe secretos.
No se ha creado `controller/request.json`, fusionado ni activado el controlador.

Actualización del 16 octubre 2026 UTC: el propietario autorizó el ajuste específico
de ACL y alta NOLOGIN. El lector Candidate ya existe y fue verificado sin
membresías ni accesos de negocio; migración `20261016061746`. Producción sigue sin
lector: la transacción abortó y su ACL no cambió. El conector postgres carece de
ownership sobre net, cuyo propietario es supabase_admin. Hace falta que un
operador de Supabase aplique el ajuste ya autorizado. Credenciales y habilitación
de LOGIN siguen pendientes de administrador por canal seguro.

Después faltan: auditoría de privilegios efectivos, red/TLS desde el ejecutor,
captura protegida con negativo real por divergencia y conciliación del esquema
Candidate. Un rechazo por drift no es paridad aprobada ni autorización de release.

Referencia oficial de conexión Session pooler:
https://supabase.com/docs/guides/database/connecting-to-postgres

La continuación de lectores está en [la propuesta de permisos](reader-permissions-proposal.md).
La auditoría actual detectó permisos heredados de PUBLIC sobre dos tablas net en
producción; el alta se deniega hasta resolverlos con autoridad del propietario.
Los SQL no se ejecutan desde workflows. El alta NOLOGIN Candidate sí se aplicó;
el intento productivo no dejó cambios persistentes ni migración aplicada.
