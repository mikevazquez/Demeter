# SF-GOV-001 · Evidencia de equivalencia de esquemas

Este directorio contiene **solo resúmenes de metadatos** de los catálogos PostgreSQL; no contiene registros de alumnas, pagos, claves ni definiciones SQL en texto claro.

## Qué se verificó

- Producción: `qfhojvgvhrbautvczffq`. Solo SELECT de catálogos.
- Candidate: `sdmxtlgjkodidjtvikng`. Solo SELECT de catálogos.
- Capturas del 13 de octubre de 2026: `2026-10-13-production.json`, `2026-10-13-candidate.json`.
- Control negativo reproducible: `scripts/sql/schema-fingerprint-readonly-negative.sql` agrega una **fila ficticia solo dentro de la consulta**. No crea, altera ni elimina objetos en PostgreSQL. El archivo `2026-10-13-candidate-readonly-negative.json` es su salida real.
- `scripts/certify-schema-parity.mjs` **rechaza** la equivalencia entre producción y Candidate (siete categorías diferentes) y rechaza el control negativo de Candidate (una categoría diferente). Esto NO demuestra equivalencia.

## Procedimiento de comprobación sin secretos

1. Ejecutar `scripts/sql/schema-fingerprint.sql` como **SELECT de solo lectura** en cada proyecto autorizado y guardar las dos respuestas JSON sin información personal.
2. Comparar: `node scripts/certify-schema-parity.mjs baseline.json candidate.json`. Código 0 significa únicamente que coinciden las siete categorías del resumen; código 1 deniega por diferencias; código 2 indica evidencia incompleta o inválida.
3. Control negativo: ejecutar `scripts/sql/schema-fingerprint-readonly-negative.sql` **solo contra Candidate**, comparar con la lectura normal de Candidate y comprobar que el código sea 1 y la categoría `column` sea la única diferencia.
4. **No utilizar capturas históricas para liberar una versión.** Una captura sin origen autenticado y vigencia no es prueba de paridad actual.

## Gate firmado (preparado en código, NO operativo para liberación)

`scripts/verify-schema-attestation.mjs` y `scripts/validate-release-manifest.mjs` exigen una atestación HMAC-SHA256 firmada, con referencias exactas de los dos proyectos, SHA del candidato, fecha UTC dentro de 60 minutos y paridad completa. El CLI usa la variable `SF_GOV_SCHEMA_ATTESTATION_KEY`; sin ella, o con firma inválida, caducada, SHA incorrecto o drift, **deniega**. El código y sus tests no contienen ninguna clave real.

**Pendiente para hacerlo confiable:** conectar un **firmante de confianza** que lea ambas bases en modo solo lectura y firme los resultados _directamente_ dentro de un GitHub Environment protegido y aprobado por un revisor, con secreto aislado de los PR. El verificador criptográfico comprueba integridad respecto a la clave; **no prueba por sí mismo que la fuente haya sido una BD real**. Nunca aceptar una atestación creada por un actor que controla tanto el JSON como el secreto. Tampoco un PASS del verificador reemplaza el UAT completo ni la autorización explícita del propietario para producción.

## UAT todavía pendientes

- El ensayo DDL físico local ya pasó en `scripts/schema-physical-drift.test.mjs`: PostgreSQL WASM, rechazo durante ALTER y aceptación tras ROLLBACK. Ver `2026-10-13-physical-negative.md`. No certifica restauración Supabase.
- Instalar y proteger el firmante y el secreto sin exponer valores en logs o Notion; ligar el gate a un workflow real de certificación del SHA exacto.
- Aislar Preview de credenciales y efectos externos (pagos, WhatsApp, Meta, correo, cron). Ningún test debe contactar destinatarios reales.
- No recrear Mirror (eliminado intencionalmente) ni generar costos sin autorización.

**Estado actual:** detector, control negativo de solo lectura y ensayo DDL local implementados; Candidate NO equivalente; `INV-UAT-01` continúa Preparado por procedencia y gate protegido pendientes.

**Prerrequisito de firmante revisado (solo lectura, 13 octubre):** en producción
y Candidate no existe el rol propuesto `sf_gov_schema_reader`; sí existe
`supabase_read_only_user`, con `rolbypassrls=true`. No se recuperó ni reutilizó
su contraseña y no se cambió ningún permiso. El nombre "read only" no
demuestra por sí solo una cuenta limitada a catálogos. Antes de activar un
capturador protegido hay que definir y verificar permisos mínimos y el
mecanismo de secretos; cualquier cambio productivo requiere autorización
independiente. La aprobación GOV-COM-02 no cubre esa activación.
