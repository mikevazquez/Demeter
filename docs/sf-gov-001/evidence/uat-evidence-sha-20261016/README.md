# SF-GOV-001: vínculo de evidencia UAT con el candidato

Incremento aislado de fase 3, preparado el 16 de octubre de 2026 mientras se
espera la resolución del propietario administrado de `net` en Supabase.

## Defecto y corrección

En la base `27e90f1d8ec1ec75725aa6a533e45b267d4ae7ce` (#278), un caso UAT
ordinario `passed` era aceptado con una URL permitida aunque su `candidate_sha`
faltara o perteneciera a otra versión. Los casos PIL/DOC ya exigían el vínculo
en sus dos etapas.

La corrección exige el SHA completo e idéntico al del manifiesto para cada caso
ordinario aprobado. Conserva los borradores pendientes y GOV-COM-02. No aprueba
UAT ni demuestra la procedencia del contenido remoto de una URL.

## Evidencia reproducible

- `regression-before.txt`: las nuevas pruebas contra el validador original
  arrojan **22 aprobadas y 3 fallidas**, incluyendo el rechazo por CLI.
- `verification-after.txt`: validador corregido, captura y atestación:
  **41 aprobadas, 0 fallidas, 0 omitidas** (25 de política, 8 de captura y
  8 de atestación). Incluye PostgreSQL local aislado PGlite.
- `verification.json`: base, versión de Node, códigos de salida y SHA256 de
  las fuentes probadas.
- Prettier de los archivos modificados y `git diff --check`: aprobados.

Desde esta rama, con las dependencias del proyecto ya disponibles:

```sh
node --test scripts/governance-policy-checks.mjs scripts/schema-capture.test.mjs scripts/schema-attestation.test.mjs
```

Son pruebas locales; no se presentan como jobs de Actions. El workflow CI de
esta base solo se activa para PR contra `main`, mientras este incremento apunta
a la rama de #278. No se cambia ese filtro ni se solicita un despliegue.

## Alcance y trabajo pendiente

No se ejecutó ninguna tarea de cola, llamada de modelo de pago, operación de
base remota ni despliegue. Se reutilizaron las dependencias instaladas. Se
preservan #278, #308 y las ramas de control sin cambios.

La corrección permanece en Draft. Aún faltan su integración controlada,
validación de procedencia de evidencia y del artefacto/destino de liberación;
las copias del validador en el controlador aislado todavía conservan su versión
anterior. El hito completo de identidad de liberación continúa pendiente.

Avance estable: **9/24 hitos completos (37.5%); 15/24 pendientes (62.5%)**.
Fase 1: 3/8 completos; fase 2: 4/7; fase 3: 2/6; fase 4: 0/3.
