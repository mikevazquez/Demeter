# INV-UAT-01: ensayo DDL aislado y reconciliación

## Alcance y resultado

Se ejecutó `scripts/schema-physical-drift.test.mjs` en PostgreSQL 18.6
(PGlite 0.5.9, WASM, base en memoria), con objetos y datos exclusivamente sintéticos.
El ensayo no recibe URL ni credenciales y no conecta con Supabase.

1. Crear una tabla pública con PK, RLS, policy, función y trigger sintéticos.
2. Capturar el catálogo con el SQL versionado `schema-fingerprint.sql`.
3. Certificar referencia idéntica con el CLI: código de salida **0**.
4. Ejecutar `BEGIN; ALTER TABLE ... ADD COLUMN divergence_probe text`.
5. Capturar catálogo real: columnas **1 → 2**, seis categorías sin cambios.
6. Ejecutar el CLI de certificación: **1**, `certified=false`, categoría `column`.
7. Ejecutar `ROLLBACK`, capturar nuevamente: igualdad exacta con la referencia.
8. Certificar tras rollback: **0**; columna de prueba persistente: **0**.

Prueba local: pasó. Suite schema/atestación completa: **20/20**.
El workflow CI incluye este ensayo como paso obligatorio sin continue-on-error.
Se fija la dependencia exclusivamente de desarrollo y su integridad en lockfile.

## Límites

Este ensayo ejecuta DDL real del motor PostgreSQL en WASM; no es una fila
inyectada en un SELECT ni una simulación del comparador. No certifica restauración
Supabase, paridad de versiones (Supabase usa PostgreSQL 17), Auth, Storage, Edge,
integraciones ni un firmante protegido. **INV-UAT-01 sigue Preparado** hasta
completar captura de confianza y vinculación obligatoria al gate de release.
Los JSON históricos no autorizan un lanzamiento posterior.

## Estado real reconciliado

- PR #278 continúa borrador; referencia inicial de este ensayo: `fa37016a206f7d2d0f1876dec3bcc8cda84ad917`.
- El CI de `931ffacc` falló en siete tests por un import no contemplado en el
  harness de audio Meta Inbox. Se reprodujo localmente. La corrección llegó en
  `fa37016a`; se conservó sin duplicar cambios. Los siete tests y once tests
  de aislamiento pasaron localmente.
- Producción servida por `demeterfitness.com`: deployment
  `dpl_25n26m7uAQ5FBRkHSf2HG17sQM12`, SHA
  `87749e84d324c6c5263c0f0128075cbe8c7e61b7`, READY. La referencia histórica
  `e76495ee` no es el frontend actualmente servido. No se rebasó ni promovió.
- Producción y Candidate: las siete huellas siguen iguales al corte anterior,
  pero son diferentes entre sí. Captura actual en `2026-10-13-reverified.json`.
- Vercel: 14 registros de variables (4 producción, 10 Preview), sin custom
  environments. URL pública de Preview apunta al Sandbox histórico; producción
  a su proyecto real. No se descifraron secretos. No se cambió configuración.
- Ruleset 24974628 activo, quality obligatorio/strict, sin bypass, cero revisiones
  obligatorias. No prueba por sí solo aprobación humana del release.
- Mirror ausente; no se creó infraestructura. El proyecto adicional `restore-ust`
  está presente en el inventario, pero no se usa ni se presume autorizado.

## Conflictos documentales y siguiente paso

La matriz oficial identifica ENV-UAT-02 como efectos externos, ENV-UAT-03 como
roles/tenants, ENV-UAT-04 como restauración, REL-UAT-02 como identidad y REL-UAT-03
como rollback. Las enumeraciones antiguas del plan/ADR difieren; deben leerse
como históricas sin borrar criterios ni interpretar esas diferencias como UAT
aprobados. ADR-001A y la instrucción del propietario sustituyen Mirror persistente.

Siguiente: conectar una captura firmada de confianza con permisos de catálogo
de solo lectura y protección independiente de release. ENV-UAT-02 requiere
cobertura de salidas y mocks antes de conectar Candidate a Preview; existen
rechazos previos de herramientas para cambios de Edge, que no se eluden.
No se requieren cambios de negocio ni borrar funcionalidades para estas tareas.
