# Catálogo y Evaluaciones 2.0 · integración en revisión

## Estado y procedencia

Continuación autorizada por Mike el 20 de octubre de 2026 bajo Governance 2.0.
Bloque canónico: https://app.notion.com/p/3ffd78f7146381a6ae39c89b6c66a5e6.

Base Catálogo C1/C2: PR #348, `807d2441440859ce0f19ab88f18edba57add5cd6`.
Capa de Evaluaciones: PR #351, `4661d37da94a91d8e86d7bad23710ac934696228`.
Se reutilizan sus componentes de evaluación y se adaptan a C1/C2. Las ramas
originales permanecen intactas. Esta integración todavía no es una entrega UAT.

## Problema resuelto en código

PR #351 consultaba `student_pole_achievements`, con `element_id`, y dependía de
`pole_level_map`. Sandbox y C1/C2 usan `student_pole_figure_achievements`, con
`figure_element_id`. La migración de PR #274 intentaría recrear tablas que ya
existen con otra estructura. No se debe aplicar como prerrequisito de esta entrega.

La capa de Evaluaciones ahora lee y escribe el progreso canónico existente.
Conserva las rutas de catálogo, clase y portal de C1/C2; agrega las pistas y la
parte personalizada a Evaluaciones. Cada lectura filtra por estudio. Una consulta
fallida desactiva esta capa en lugar de presentar logros como inexistentes.
El mapeo usa los cinco `level_key` confirmados en Sandbox y la correspondencia
funcional documentada por el desarrollo original.

El guardado y la regeneración de ítems bloquean primero su evaluación para
serializarse con la publicación. También se corrigen la preparación de plantillas
vacías y las pistas de validaciones con fecha futura.

## Decisión funcional pendiente

Se preguntó a Mike si publicar una evaluación debe marcar automáticamente como
hechas las figuras con resultado Cumple, o si el instructor debe marcarlas aparte.
El SQL y la vista previa de cambios del portal conservan la **propuesta** de PR
#351: publicar valida las figuras aprobadas. Esto no representa una decisión
aprobada. No aplicar esta migración en Sandbox ni solicitar UAT hasta resolverlo;
si la respuesta es marcado separado, cambiar juntos SQL, copy y pruebas.

La propuesta de plantillas de #351 conserva hasta ocho figuras, 80% figuras y
20% técnica/seguridad. Las plantillas existentes no se reemplazan.

## Verificación y límites

Los resultados finales del candidato se registran en Notion y en su PR.
Las pruebas SQL usan PostgreSQL 17 sin red, datos sintéticos y dobles explícitos
para los servicios base de Supabase. Ejercitan la migración y el activador real
versionado de plantillas. No acreditan login, transporte de Supabase, auditoría
canónica desplegada ni UAT visual/funcional en Sandbox.

Las lecturas de Sandbox confirmaron columnas y restricciones del progreso,
firmas RPC y los cinco niveles. No se aplicaron migraciones ni se modificaron
datos de Sandbox o producción durante esta preparación.

## Reproducir la prueba SQL aislada

Desde la raíz del repositorio, con Docker y Python disponibles:

```sh
python - <<'PY'
import csv, json
with open('/tmp/pole-evaluations-seed.csv', 'w') as output:
    csv.writer(output).writerow([json.dumps(json.load(open('app/admin/catalogo/pole-catalog-data.json')))])
PY
docker run -d --name pole-evaluation-test --network none --memory 512m --cpus 1 -e POSTGRES_HOST_AUTH_METHOD=trust -v "$PWD:/src:ro" postgres:17-alpine
docker exec pole-evaluation-test pg_isready -U postgres
docker cp /tmp/pole-evaluations-seed.csv pole-evaluation-test:/tmp/pole-evaluations-seed.csv
docker exec pole-evaluation-test psql -U postgres -v ON_ERROR_STOP=1 -f /src/tests/evaluations-pole-adaptive-uat.sql
```

Esperar a que `pg_isready` indique que acepta conexiones antes de ejecutar psql.
Las aserciones y rechazos incorrectos detienen la prueba. El contenedor no publica
puertos ni recibe credenciales de Supabase. Se puede detener después de revisar.

## Siguiente acción

Resolver la regla de publicación con Mike, verificar la migración contra el esquema
completo pertinente y preparar una única versión Sandbox con demo sintético.
Después: UAT técnico del recorrido Hoy → combo → catálogo → evaluación → portal,
y UAT funcional de Mike sobre esa misma versión. Producción requiere autorización
explícita posterior; este bloque no fusiona main ni promueve una versión.
