# Demi: información temporal de eventos y promociones

## Alcance

Demi consulta eventos, talleres y promociones guardados por estudio. Responde desde promotion_starts_on hasta registration_deadline inclusive; sin fecha límite de inscripción, hasta event_ends_on inclusive. Usa la zona horaria del estudio. Vencidos, borradores y archivados se conservan y no se ofrecen. No envía promociones proactivas.

## Cierre UAT — 11 de octubre de 2026, America/Mexico_City

**Validación técnica: 8/8 aprobadas. UAT conversacional/UI ejecutado por Codex: 8/8 satisfactorios. Aceptación final de Mike y autorización de promoción: pendientes. Producción sin modificaciones.**

“Aprobado en ejecución” describe lo comprobado por Codex; no sustituye la aceptación final de Mike ni autoriza producción.

| ID      | Caso                                            | Técnico  | UAT ejecutado                         | Evidencia                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------- | -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEMP-01 | Promoción anticipada, sin cierre de inscripción | Aprobada | **Aprobado en ejecución**             | Aro ofrecido el 11/oct, antes del evento. Reloj UAT: 30/sep excluido; 5/nov disponible; 30/nov disponible; 1/dic excluido.                                                                                                               |
| TEMP-02 | Inscripción cierra antes del fin del evento     | Aprobada | **Aprobado en ejecución**             | Trapecio disponible el 10/nov hasta 23:59 local; excluido desde 11/nov 00:00, aunque el evento termina el 30/nov.                                                                                                                        |
| TEMP-03 | Horario guardado                                | Aprobada | **Aprobado en ejecución**             | Respuesta: domingos de 9:00 a 10:30 y sede Tonalá, desde los datos guardados.                                                                                                                                                            |
| TEMP-04 | Antes de iniciar promoción                      | Aprobada | **Aprobado en ejecución**             | Acrobacia programada para anunciarse desde 20/oct no se ofreció el 11/oct. Aro no se ofreció el 30/sep.                                                                                                                                  |
| TEMP-05 | Vencidos, borradores, archivados e historial    | Aprobada | **Aprobado en ejecución**             | Equilibrio vencido, contorsión en borrador y malabares archivado excluidos. UI mostró registros y estados. Contorsión y péndulo se archivaron desde UI, conservando IDs y contenido. Después, Demi dejó de ofrecer el péndulo publicado. |
| TEMP-06 | Canales de Demi                                 | Aprobada | **Aprobado con transporte capturado** | WhatsApp, Facebook Messenger e Instagram recorrieron sus receptores, consultaron datos y respondieron correctamente; HTTP 200 y outcome replied. Entrega externa de Meta no comprobada.                                                  |
| TEMP-07 | Dato no cargado                                 | Aprobada | **Aprobado en ejecución**             | Precio omitido deliberadamente. Demi reconoció que no tiene publicado el precio; no inventó importe.                                                                                                                                     |
| TEMP-08 | Límites y zona local                            | Aprobada | **Aprobado con reloj UAT**            | 2026-11-11T05:59:00.000Z = 10/nov 23:59 local: disponible. 2026-11-11T06:00:00.000Z = 11/nov 00:00 local: excluido. checked_on_local registrado en ambos casos.                                                                          |

## Preview y conexión comprobada

- [Preview estable](https://demeterbueno-git-codex-demi-seasonal-events-demeter3.vercel.app/admin/mas/demi/temporales).
- [Banco UAT](https://demeterbueno-git-codex-demi-seasonal-events-demeter3.vercel.app/admin/mas/demi/uat).
- Rama: codex/demi-seasonal-events.
- Versión funcional verificada: a561487af221e17d83ccc6eac1efbe8608e756ef. Despliegue: dpl_7RyWsZ2EfcAYfuvuwXroe1Q77Dkb.
- Build: “Preview isolation verified: Studio Flow Sandbox”.
- Registro creado desde UI y leído con el mismo ID en sandbox hedouonyhynuvwbckdlg: 8bdbbc4a-0791-4263-b379-f4c30a044f69. Esto comprueba conexión efectiva.
- Canales: estudio aislado 29af8ae6-1c55-497d-b53c-d6d7b6fc828d; ejecución 3b03aaf5-b014-4277-bc69-cef7aa2ba271. Se agregaron fixtures TEMP sin alterar evidencias anteriores.
- El reloj sólo se establece desde acciones autenticadas del banco sandbox. No proviene de cabeceras entrantes ni cambia el reloj del servidor, reservas o fechas del estudio.

## Correcciones necesarias para probar

1. La configuración consultaba Demi y Polina juntas con maybeSingle. Se delimitó a assistant_key = demi.
2. Instagram buscaba una credencial real dentro de UAT. En el contexto aislado ahora valida la firma ficticia de la ejecución. Fuera de UAT conserva la credencial específica y la validación de firma.
3. Se agregó fecha UTC opcional al banco Meta para probar vigencias y registrar la medianoche local.

## Evidencia técnica y límites

- Suite completa actual: **188 archivos, 1,242 pruebas aprobadas**.
- Feature: 4 pruebas de reglas, 8 de runtime y 1 del reloj UAT.
- Typecheck aprobado.
- Lint aprobado sin errores; 19 advertencias preexistentes ajenas a este cambio.
- Formato Prettier y git diff --check aprobados.
- Build Vercel aprobado con TypeScript e aislamiento verificados.
- [Evidencia de canales y herramientas](./demi-temporary-information-uat-evidence-20261011.json).
- Fixtures con prefijo UAT TEMP; permanecen en sandbox y no deben copiarse a producción.
- Incidencia independiente: “Crear escenarios aislados” mostró React #441. Se recuperó una ejecución existente para completar TEMP. La creación de una nueva ejecución no se marcó como aprobada.
- La revisión de UI fue de escritorio. No se afirma UAT móvil ni recepción externa de Meta.
- Al vencer un evento en una conversación ya iniciada, Demi vuelve a consultar y deja de ofrecerlo. Puede redactar una disculpa por la respuesta anterior, aunque hubiera sido vigente; mejora de copy posible, sin bloqueo funcional de este alcance.

## Promoción pendiente

Migración: supabase/migrations/20261012020450_demi_temporary_information.sql.

La comparación con main mantiene el alcance en información temporal, configuración y herramientas UAT. Antes de promover: aceptación final de Mike, autorización explícita vinculada a este alcance y versión, y revisión de main y del destino.

Reversión: regresar al despliegue previo y conservar la tabla e históricos. No borrar registros para ocultar incidencias.
