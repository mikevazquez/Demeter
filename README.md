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
3. Confirmar Node >=22, `/usr/bin/psql` >=17, certificados del sistema y conectividad
   IPv6 directa a Supabase en el runner. El workflow falla cerrado si faltan.
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
