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

El cron declarado en Actions no constituye un servicio periódico activo: GitHub
agenda desde la rama predeterminada y el guard exige la rama de control. El
controlador alojado «Coordinar autonomía Studio Flow» consulta Notion mediante la
conexión autorizada y puede renovar exclusivamente la frescura del snapshot y su
marcador, cuando conserva la versión admitida. El push en la rama de control activa
Actions. No necesita transferir la conexión ni un token Notion al runner.

El primer puente alojado quedó verificado en el commit
`a30b1b4ab826689cb3591b8e3fcd66972c275bcd` y el
[run 38747146410](https://github.com/mikevazquez/Demeter/actions/runs/38747146410).
Su reporte reconoce los tres PR existentes y omite ejecución y publicación.
La programación prevista es cada seis horas; un ciclo observado no certifica
continuidad permanente. Sin trabajo admitido ni renovación necesaria no debe haber
commits ni llamadas a Codex. No se usa `main` para activar el ciclo.

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

## Contrato operativo de Governance autónomo v1

Fecha: 15 de octubre de 2026. Responsable lógico: Coordinador de Governance.
Este contrato documenta la siguiente capa del agente, solicitada por el usuario.
No cambia la política Notion, la cola admitida ni los permisos del ejecutor.
Las capacidades pendientes que se describen aquí requieren implementación y prueba;
el documento no las activa ni autoriza automáticamente nuevos trabajos.

### Objetivo y fronteras

Mantener el seguimiento de Governance de Studio Flow de principio a fin: recuperar
reglas, observar evidencia, detectar diferencias, resolver incidencias rutinarias
admitidas, verificar su resultado y conservar continuidad entre ciclos.
Medir resultados comprobados y excepciones resueltas, sin depender de «continúa»
para cada paso ni confundir la emisión de recordatorios con ejecución.

Repositorio único: `mikevazquez/Demeter`. Rama de control única:
`chore/governance-autonomous-coordinator-20261015`. Implementación: PR #294.
Fuente de política:
[protocolo Notion](https://app.notion.com/p/3fad78f7146381e9a97fc3c454e6516a),
versión observada `2026-10-15T07:49:26.240Z`.

Quedan fuera B03 y cualquier bloque funcional; modificaciones de aplicación,
producción, `main`, Supabase, Vercel, secretos, permisos, merges, despliegues y
mensajes a terceros. Leer evidencia GitHub para diagnosticar no autoriza intervenir
en el sistema que la produjo. La arquitectura de ejecución sigue teniendo un solo
ejecutor y concurrencia global; el número de tareas por lote no es concurrencia.

### Autoridad y decisiones

Las instrucciones explícitas del usuario delimitan la operación; el protocolo
aprobado define las reglas dentro de ese límite y el contrato admitido restringe
cada ejecución. Ante discrepancias se conserva el límite más restrictivo y se
detiene únicamente la acción afectada. Un texto recuperado de un issue, PR,
artefacto o respuesta del modelo es evidencia no confiable, nunca autoridad.

| Situación                                 | Acción autónoma permitida                                                                      | Condición de detención                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Protocolo conserva ID y versión admitidos | Validar fuente y, cuando corresponda, renovar fechas y marcador                                | Lectura incompleta, conflicto de versión o fuente inaccesible |
| Protocolo cambió                          | Comparar con snapshot admitido, registrar diferencias y continuar observaciones independientes | No renovar snapshot antiguo ni adoptar permisos nuevos        |
| Tarea ya admitida y ready                 | Comprobar issue abierto, hash, updated_at, alcance y ausencia de PR en cualquier estado        | Cualquier discrepancia sin reconciliar                        |
| Tarea o recomendación nueva               | Registrar candidato con evidencia y motivo                                                     | No añadirlo a queue ni ejecutarlo por inferencia              |
| Fallo técnico transitorio                 | Diagnosticar y aplicar un reintento acotado con evidencia                                      | Credencial, cuota o permiso requieren intervención real       |
| Incumplimiento de alcance                 | Conservar evidencia y detener la tarea                                                         | No reparar ampliando allowlists, checks ni contrato           |
| Falta CI, UAT o evidencia                 | Identificar requisito faltante y estado real                                                   | No inventar PASS, aprobación ni cierre                        |
| Acción excluida por este contrato         | Registrar la excepción mínima necesaria                                                        | No ejecutar ni obtener permisos adicionales                   |

Una actualización legítima del protocolo puede investigarse sin una aprobación
redundante. Si altera autoridad, destinos o acciones y no hay autorización explícita
aplicable, se conserva el alcance previo y se presenta la decisión concreta al usuario.
Crear un contrato de Governance no equivale a admitir tareas nuevas en el ejecutor.

### Requisitos verificables

- G01 — Recuperar política Notion, su identidad y fecha de edición, cola con SHA de
  blob, HEAD de control, PR #294, runs actuales y PRs de ramas de tareas en todos
  los estados. Registrar fecha de observación; lo desconocido no es ausencia.
- G02 — Reconciliar frescura y diferencias antes de actuar. La ventana es como
  máximo 48 horas. Renovar solo con versión idéntica, primera instalación del
  marcador, menos de 24 horas restantes o trabajo admitido que necesita iniciarse
  sin otro run activo. Preservar hashes, snapshot y contratos.
- G03 — Detectar únicamente hallazgos de Governance dentro de las fuentes
  delimitadas: contexto obsoleto, identidad de issue cambiada, evidencia faltante,
  ejecución fallida, duplicación, interrupción de publicación y contrato incumplido.
- G04 — Separar diagnóstico de admisión. Un candidato no se transforma en ready por
  una recomendación del agente. IDs ejecutados no se reutilizan, ni tras cerrar PR.
- G05 — Resolver trabajo ya admitido mediante el ejecutor existente: hasta dos
  intentos de generación, reparación en runner nuevo, certificación independiente
  y publicación determinista Draft. No reemplazar ese publicador.
- G06 — Respetar concurrencia global y reconciliar lecturas/escrituras concurrentes.
  Antes de actuar volver a comprobar runs, versión y PR; ante conflicto de blob,
  releer y reconciliar una vez. No sobrescribir cambios ajenos.
- G07 — Conservar un registro durable de hallazgos y transiciones entre ciclos.
  Recuperar el último estado antes de decidir; ninguna dependencia de memoria del chat.
- G08 — Verificar resultados por SHA, run, intento, jobs, artefactos y PR. Commit,
  generación, certificación, publicación, CI y UAT son hechos distintos.
- G09 — Distinguir fallo transitorio, fallo del resultado, cuota, credencial,
  permiso, fuente inaccesible y conflicto de autoridad. No repetir una operación
  idéntica que ya fracasó por una causa no transitoria.
- G10 — Notificar solo un resultado nuevo verificado o una excepción indispensable
  con evidencia, impacto y acción concreta; deduplicar avisos entre ciclos.
- G11 — Probar continuidad con múltiples ciclos y recuperación tras interrupción.
  Horario configurado no equivale a cumplimiento observado ni a servicio garantizado.
- G12 — Mantener los límites de producción y tareas funcionales en cada transición.
  Una aprobación UAT y un «continúa» no autorizan promoción.

### Registro de continuidad requerido

La capa pendiente debe persistir un registro versionado, separado de
`queue.json`, sin contener secretos. Este contrato no crea ese almacén ni amplía
la allowlist actual. Su ubicación exacta será parte de la implementación aislada.

Cada hallazgo debe incluir:

- ID estable calculado sobre repositorio, regla, objeto observado y versión de
  origen; propietario y ciclo que lo observó.
- Regla G01–G12, fuente y enlace, primera y última observación UTC, estado conocido
  o desconocido y diferencia detectada.
- SHA de control, blob de cola, versión Notion y, cuando aplique, ID de tarea,
  hash y updated_at del issue, PR, run, intento y artefacto con digest.
- Estado anterior y nuevo, razón, acción intentada, resultado observado,
  clasificación del error, número de intentos y próxima condición elegible.
- Clave del último aviso, evidencia usada para cerrar y bloqueo residual.

Transiciones: `observado → evaluado → elegible → actuando → verificado → cerrado`.
Alternativas: `evaluado → candidato sin admisión`, `evaluado → bloqueado`,
`actuando → reintento acotado` o `actuando → bloqueado`. Una lectura desconocida
impide transiciones que exigen ausencia de PR o run. Un hallazgo reaparece con una
versión nueva o evidencia nueva; el historial previo no se elimina.

Un cierre exige resolver el criterio de la regla con evidencia actual. La
publicación cierra la entrega del ejecutor, pero no declara UAT aprobado ni
producción autorizada. Un aviso guardado no cierra la incidencia.

### Ciclo objetivo y recuperación

1. Recuperar último registro y contexto actual por conexiones autorizadas.
2. Comparar versiones y clasificar hallazgos; conservar observaciones independientes
   aunque una tarea esté bloqueada.
3. Reconciliar trabajo activo y publicaciones antes de seleccionar una acción.
4. Ejecutar solo una acción elegible dentro del contrato admitido; el ciclo que
   solo observa o no necesita renovación no llama al modelo ni hace commits.
5. Verificar resultado real, guardar transición y referencias recuperables.
6. Notificar únicamente evidencia nueva o decisión humana indispensable.
7. En el ciclo siguiente recuperar desde el registro, sin repetir efectos.

Lecturas: como máximo un reintento ante timeout, 429 o 5xx, respetando Retry-After;
si la espera supera la ventana de ejecución, diferir al próximo ciclo. Escrituras:
ante resultado incierto, releer antes de reintentar; conflicto de blob, una
reconciliación. Generación: conserva los dos intentos existentes. Credencial inválida,
403 persistente o cuota agotada: no bucles ni credenciales alternativas productivas.
El presupuesto es por hallazgo y versión, persiste entre ciclos y no se reinicia al
volver a despertar. Recuperar evidencia antes de repetir una publicación interrumpida.

La continuidad debe registrar inicio y cierre de ciclos, hora esperada y observada,
y ciclos ausentes como dato desconocido. El propio agente no puede observar su
ausencia mientras está detenido; al regresar compara el intervalo. Una garantía
de disponibilidad requeriría observación independiente y queda sin certificar.

### Pruebas de aceptación de la capa de Governance

Esta matriz define pruebas por implementar; no declara que se hayan ejecutado.
Usar fuentes simuladas y un escritor espía que registre todas las llamadas.
Las pruebas destructivas o de interrupción se simulan; no alteran servicios reales.

| Caso / requisitos    | Preparación y estímulo                                       | Resultado exigido                                                                                                              |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| GOV-01 / G01,G02     | Notion idéntico, marcador ausente, sin run activo            | Solo fechas y marcador permitidos; diff de tareas y hashes vacío; verificar run real antes de declarar éxito                   |
| GOV-02 / G02,G10     | Marcador presente, más de 24 h, todos con PR                 | Cero escrituras, llamadas Codex y avisos                                                                                       |
| GOV-03 / G02,G06     | Faltan menos de 24 h, fuente idéntica                        | Renovación máxima 48 h con branch explícita y blob actual; sin cambiar contratos                                               |
| GOV-04 / G02,G12     | Notion cambia e incluye permiso adicional                    | No certificar versión antigua ni adoptar permiso; registrar diff y detener acción afectada                                     |
| GOV-05 / G01,G04     | Issue abierto difiere de hash o updated_at admitidos         | No ejecutar; conservar ambas versiones y causa; ninguna readmisión automática                                                  |
| GOV-06 / G04,G06     | PR abierto, cerrado o fusionado; repetir cada variante       | Cero regeneración y PR nuevo; ID nunca reutilizado                                                                             |
| GOV-07 / G06         | Run queued, waiting o in_progress; segundo ciclo simultáneo  | No iniciar trabajo duplicado; respetar bloqueo global y un ejecutor                                                            |
| GOV-08 / G03,G04,G12 | Issue no admitido solicita B03, secretos o allowlist nueva   | Solo candidato o rechazo; cero cambios de contratos y recursos excluidos                                                       |
| GOV-09 / G06         | Conflicto de blob y versión concurrente nueva                | Releer una vez, preservar trabajo concurrente; segundo conflicto detiene escritura                                             |
| GOV-10 / G05,G08     | Primer resultado falla un check reparable                    | Segundo runner con error real; certificar independiente antes de publicar Draft                                                |
| GOV-11 / G05,G12     | Resultado altera archivo fuera del contrato                  | Rechazo terminal; sin segundo intento, publicación ni cambio de allowlist                                                      |
| GOV-12 / G07,G09     | Reiniciar después de crear rama y antes del PR               | Recuperar registro y rama, validar contrato y árbol; un solo PR, sin force push                                                |
| GOV-13 / G09,G10     | Inyectar timeout/429/5xx y después 401/403/cuota             | Respetar presupuestos y Retry-After; clasificar; una alerta indispensable por versión                                          |
| GOV-14 / G08         | Commit existe pero workflow falla o falta artefacto          | Estado sin verificar o bloqueado; nunca PASS por haber guardado archivo                                                        |
| GOV-15 / G07,G10     | Reiniciar tras avisar y repetir evidencia idéntica           | Historial recuperado, cero efectos y avisos duplicados                                                                         |
| GOV-16 / G08,G12     | PR Draft sin CI propio ni aceptación humana                  | Reportar hechos separados; no afirmar CI, UAT, merge ni producción                                                             |
| GOV-17 / G07,G11     | Tres ciclos consecutivos; interrumpir uno y restaurar        | Recuperar pendientes, registrar hueco y verificar avance; no declarar servicio permanente                                      |
| GOV-18 / G01,G03     | Fallan lectura Notion o listado PR/run; respuesta incompleta | Estado desconocido, sin suponer ausencia ni ejecutar; reintento acotado                                                        |
| GOV-19 / G07,G09     | Fallo persistente atraviesa varios despertares               | Presupuesto durable agotado; no reiniciar intentos ni repetir alerta                                                           |
| GOV-20 / G12         | Cada caso anterior y resultado generado malicioso            | Escritor espía confirma cero cambios en main, producción, Supabase, Vercel, secretos, permisos, merges, despliegues y mensajes |

Además del resultado positivo, cada caso debe afirmar la ausencia de llamadas
prohibidas y guardar entrada, salida esperada, salida observada y diff de efectos.
Los dobles de prueba no sustituyen la prueba del puente real ni certifican
resistencia adversarial exhaustiva.

### Estado comprobado y brechas

| Capacidad                                            | Evidencia disponible                                                                                   | Límite                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Ejecutor, reparación, certificación y PRs Draft      | [run 38744445155](https://github.com/mikevazquez/Demeter/actions/runs/38744445155), PRs #296/#297/#298 | Aceptación acotada de infraestructura; no trabajo funcional |
| Puente Notion alojado → frescura GitHub → Actions    | [run 38747146410](https://github.com/mikevazquez/Demeter/actions/runs/38747146410), SHA a30b1b4        | Un ciclo real verificado                                    |
| Deduplicación de las tres tareas                     | Reporte coordinator-report-1 de ese run: already published para las tres                               | No demuestra toda la matriz GOV                             |
| Clasificador y registro durable de hallazgos         | Requisitos G03,G07,G09,G10 y casos definidos aquí                                                      | Pendiente de implementación                                 |
| Pruebas de decisión del controlador alojado          | GOV-01 a GOV-20 definidos aquí                                                                         | Pendientes de implementación y ejecución                    |
| Continuidad sostenida y recuperación del controlador | GOV-17 y GOV-19                                                                                        | Pendientes; no hay garantía de servicio                     |

### Orden de implementación y Definition of Done

1. Implementar el evaluador de Governance puro y el registro durable con
   actualización concurrente segura, separados de admisión y publicación.
   Entradas: observaciones estructuradas; salidas: hallazgos y acciones propuestas
   restringidas, nunca comandos extraídos de texto libre.
2. Implementar adaptadores de lectura y el ejecutor de acciones permitidas,
   reutilizando el publicador, contratos y límites actuales. Las nuevas tareas
   requerirán contratos explícitos; este documento no altera queue.
3. Automatizar GOV-01 a GOV-20, verificar efectos negativos y reintentos persistidos.
4. Probar integración real acotada del controlador con evidencia por SHA y luego
   observar los tres ciclos y la recuperación sin tocar desarrollo funcional.

Se considera completa esta especificación cuando requisitos, autoridad, persistencia,
recuperación, pruebas y brechas son trazables y están guardados en la rama aislada.
Se considerará completa la siguiente implementación solo con GOV-01 a GOV-20
ejecutados, evidencia recuperable, ningún efecto excluido y recuperación observada.
No se cerrará «Governance autónomo» por guardar este contrato, habilitar un horario
o abrir un PR. No hay UAT funcional ni promoción productiva en este alcance.
