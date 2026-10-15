# Coordinador autónomo de Studio Flow

Esta implementación continúa el piloto verificado del PR #290. Su alcance es el
ciclo de trabajo del agente; no retoma bloques funcionales ni modifica producción.

## Ciclo de ejecución

1. `select` consulta los issues de la cola admitida, comprueba su versión y omite
   cualquier tarea que ya tenga PR, abierto, cerrado o fusionado.
2. Un único ejecutor procesa las tareas seleccionadas en secuencia. Recupera la
   orden y el contexto, ejecuta Codex y valida los archivos y criterios del contrato.
3. Si la validación detecta un problema corregible, Codex recibe el error real y
   dispone de un segundo intento en un runner nuevo, restaurando solo los archivos
   admitidos del intento anterior. Las violaciones de alcance no se reintentan.
4. `certify` reconstruye el resultado en otro runner desde el SHA original y vuelve
   a validar el alcance y las pruebas. No dispone de credenciales de publicación.
5. `publish` verifica la procedencia del artefacto certificado y crea una rama y
   un PR Draft por tarea mediante APIs GitHub. No ejecuta código generado.

Las ramas `automation/codex/<task-id>` son deterministas. Si la creación del PR se
interrumpe después de crear la rama, la ejecución siguiente recupera ese resultado,
comprueba su contrato y árbol, lo certifica y continúa la publicación. Nunca fuerza
una rama ajena ni sustituye un resultado diferente. La generación puede repetirse
tras un fallo del runner; no se promete ejecución exactamente una vez.

## Contratos y fuentes

`.github/codex-coordinator/queue.json` contiene las tareas admitidas, propietario,
issue, hash y versión de su contenido, archivos exactos permitidos, comprobaciones
y criterios de aceptación. Cambiar un issue invalida su admisión hasta reconciliar
el contrato. Ni el texto de un issue ni una respuesta del modelo conceden permisos.

El protocolo se recuperó del conector Notion y se conserva con su URL, versión,
hash y ventana máxima de 48 horas. Sin `CODEX_NOTION_TOKEN`, Actions usa ese snapshot
fechado y lo identifica como tal. Con un token de integración dedicado y de lectura,
consulta la versión viva de la página antes de seleccionar y publicar. Una fuente
caducada, inaccesible o modificada detiene el trabajo; no se presume contexto vivo.
La integración Notion de este chat no se transfiere automáticamente a Actions.

Las tareas de documentación se limitan a archivos Markdown exactos en
`docs/automation/`. Las tareas de código admiten archivos concretos en `app`,
`components`, `lib` y `tests`, con comprobaciones obligatorias. Este segundo modo
requiere validación específica antes de admitir trabajo funcional. El lote inicial
contiene las pruebas de aceptación #292, #293 y #295. La última comprueba el modo
código y sus límites de ejecución sin modificar el comportamiento de la aplicación.
Incluye un fallo controlado de aceptación en el primer intento para probar la
reparación real en un runner nuevo; esa sonda no se aplica a tareas ordinarias.

## Aislamiento y verificaciones

- El job de Codex tiene permisos GitHub de lectura; la clave exclusiva OpenAI solo
  se suministra al paso de generación. No se introducen secretos de la aplicación.
- El verificador y el contrato se copian a una ubicación protegida antes de Codex.
- Las pruebas de código se ejecutan en namespaces de red y procesos separados,
  sin variables heredadas, sin acceso a Codex home y con `.git` de solo lectura.
- Se rechazan rutas fuera del contrato, symlinks, archivos ejecutables, binarios,
  borrados y resultados vacíos. Se verifican run ID, SHA, contrato y contenido.
- El publicador dispone de escritura GitHub y lectura de issues, pero nunca de la
  clave OpenAI ni de credenciales de producción. Solo publica texto certificado.
- Los PR creados con `GITHUB_TOKEN` no activan otros workflows automáticamente.
  Las pruebas del Coordinador quedan en el run originador; no se afirma CI del PR
  generado sin ejecutarlo. Abrir PR no autoriza merge ni producción.

## Activación y límites operativos

El workflow se activa por cambios de control en la rama
`chore/governance-autonomous-coordinator-20261015` y acepta `workflow_dispatch` sobre
esa rama si GitHub lo permite. Está restringido al repositorio y al actor propietario.
La concurrencia global cubre todo el ciclo y la matriz tiene `max-parallel: 1`.
Cada ejecución consume hasta tres tareas independientes de la cola inicial,
siempre en secuencia por un solo ejecutor. Un job final consolida resultados,
PRs y bloqueos en un reporte JSON y Markdown, incluso si una fase falla.

El cron declarado no constituye un servicio periódico activo: GitHub ejecuta los
eventos programados desde la rama predeterminada y el guard actual exige la rama
de control. No se fusionará en `main` para activarlo, porque eso podría disparar
producción. La activación persistente necesita resolver ese gate de forma explícita.

GitHub debe permitir que Actions cree PRs. Si la política lo deniega, la rama y
evidencia se conservan para recuperar la publicación después de habilitar el permiso.
No se usan credenciales de producción para eludir esa restricción.

## Validación del propio Coordinador

`node --test tests/automation/coordinator.node.mjs` comprueba admisión, frescura,
aislamiento de rutas, identidad del issue, procedencia del artefacto, publicación
Draft, deduplicación y un ciclo real del verificador: fallo, reparación y rechazo
de una ampliación de alcance. El workflow ejecuta estas pruebas antes de seleccionar.

Las pruebas de aceptación en Actions deben demostrar dos resultados independientes,
certificación y PRs recuperables. Después se ejecuta de nuevo la selección para
comprobar que no vuelve a generar ni publicar trabajo ya entregado. Las evidencias
se guardan por tarea, SHA, ejecución e intento. Una ejecución técnica satisfactoria
no implica autorización productiva ni aceptación funcional de Studio Flow.
