# Demi: información temporal de eventos y promociones

## Alcance

Demi consulta eventos, talleres y promociones guardados por estudio. Responde desde promotion_starts_on hasta registration_deadline inclusive; sin fecha límite de inscripción, hasta event_ends_on inclusive. Usa la zona horaria del estudio. Vencidos, borradores y archivados se conservan y no se ofrecen. No envía promociones proactivas.

## Cierre UAT — 12 de octubre de 2026, America/Mexico_City

**Validación técnica: 13/13 aprobadas. UAT conversacional/UI ejecutado por Codex: 13/13 satisfactorios. Aceptación final de Mike: **aprobada el 12 de octubre de 2026**. Autorización de promoción: **pendiente**. Producción sin modificaciones.**

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

## Ajuste solicitado por Mike: información del estudio como base

Mike revisó el preview y pidió que ubicación y pagos se tomen del estudio cuando el taller no publique una excepción. El precio, las fechas, el horario y los requisitos específicos siguen siendo del taller. Una excepción cambia sólo ese dato, no toda la información general. Las políticas generales se consultan con get_policy_information. Si faltan datos en ambas fuentes, Demi reconoce el faltante.

| ID      | Caso                                        | Técnico  | UAT ejecutado             | Evidencia                                                                                                                                                             |
| ------- | ------------------------------------------- | -------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEMP-09 | Ubicación sin repetirla en el taller        | Aprobada | **Aprobado en ejecución** | WhatsApp: taller de cintas sin sede publicada; respondió Avenida San Gaspar #240, Tonalá, Jalisco y precio del taller $500.                                           |
| TEMP-10 | Métodos y cuenta del estudio                | Aprobada | **Aprobado en ejecución** | WhatsApp: respondió los métodos activos configurados y cuenta ficticia UAT 0000. No creó venta, reserva ni intención de transferencia.                                |
| TEMP-11 | Sede y pago diferentes publicados           | Aprobada | **Aprobado en ejecución** | Facebook: cubo respondió Recinto UAT, Calle Prueba 123; únicamente transferencia a Banco Alterno UAT 1111, sin efectivo. No sustituyó por la sede/cuenta del estudio. |
| TEMP-12 | Precio ausente, ubicación y pagos heredados | Aprobada | **Aprobado en ejecución** | Instagram: bandas respondió domicilio y métodos del estudio; reconoció que el precio no estaba publicado. No tomó $150 de primera clase ni $600 de paquete regular.   |
| TEMP-13 | Excepción de sede sin excepción de pago     | Aprobada | **Aprobado en ejecución** | Facebook: rueda respondió Salón UAT, Calle Ensayo 456 y conservó la cuenta ficticia del estudio 0000.                                                                 |

Las cinco conversaciones recorrieron los receptores reales con transporte capturado: HTTP 200, outcome replied. Consulta de integridad: cero ventas, reservas o intenciones de transferencia nuevas durante estas consultas. El formulario explica que ubicación y pago sólo deben repetirse si son diferentes.

[Evidencia del ajuste](./demi-temporary-information-uat-evidence-20261012.json). No se modificó producción ni se copiaron fixtures a ella. Mike aprobó este ajuste el 12 de octubre de 2026 mediante «Aprobado». La autorización explícita de promoción permanece pendiente.

## Preview y conexión comprobada

- [Preview estable](https://demeterbueno-git-codex-demi-seasonal-events-demeter3.vercel.app/admin/mas/demi/temporales).
- [Banco UAT](https://demeterbueno-git-codex-demi-seasonal-events-demeter3.vercel.app/admin/mas/demi/uat).
- Rama: codex/demi-seasonal-events.
- Versión funcional del ajuste verificada: 635a753c5012801cd0e9f0d417383d90fb597a97. Despliegue: dpl_2Xdb9Jvvkq8abXj9QqUVQUEikDoz. La evidencia anterior se conserva.
- Build: “Preview isolation verified: Studio Flow Sandbox”.
- Registro creado desde UI y leído con el mismo ID en sandbox hedouonyhynuvwbckdlg: 8bdbbc4a-0791-4263-b379-f4c30a044f69. Esto comprueba conexión efectiva.
- Canales: estudio aislado 29af8ae6-1c55-497d-b53c-d6d7b6fc828d; ejecución 3b03aaf5-b014-4277-bc69-cef7aa2ba271. Se agregaron fixtures TEMP sin alterar evidencias anteriores.
- El reloj sólo se establece desde acciones autenticadas del banco sandbox. No proviene de cabeceras entrantes ni cambia el reloj del servidor, reservas o fechas del estudio.

## Correcciones necesarias para probar

1. La configuración consultaba Demi y Polina juntas con maybeSingle. Se delimitó a assistant_key = demi.
2. Instagram buscaba una credencial real dentro de UAT. En el contexto aislado ahora valida la firma ficticia de la ejecución. Fuera de UAT conserva la credencial específica y la validación de firma.
3. Se agregó fecha UTC opcional al banco Meta para probar vigencias y registrar la medianoche local.

## Evidencia técnica y límites

- Suite completa actual: **189 archivos, 1,246 pruebas aprobadas**.
- Feature: 4 pruebas de reglas, 8 de runtime, 1 del reloj UAT y 4 de herencia de datos del estudio.
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

La comparación con main mantiene el alcance en información temporal, configuración y herramientas UAT. UAT final aceptado por Mike el 12 de octubre de 2026. Antes de promover: autorización explícita vinculada a este alcance y versión, y revisión de main y del destino.

Reversión: regresar al despliegue previo y conservar la tabla e históricos. No borrar registros para ocultar incidencias.

## Registro de aceptación

- Usuario: Mike.
- Fecha: 12 de octubre de 2026, America/Mexico_City.
- Instrucción: «Aprobado».
- Alcance: información temporal de Demi, incluyendo herencia de ubicación y pagos del estudio con excepciones específicas del taller; TEMP-01 a TEMP-13.
- Versión revisada: 635a753c5012801cd0e9f0d417383d90fb597a97; matriz y evidencia en 1a34586795df3d8e400a1134a89bf61eef0d18ac.
- Estado: UAT aprobado por el usuario. Promoción pendiente de autorización explícita.


## Autorización de promoción — 2026-10-12

Mike autorizó explícitamente: «Autorizo promoción de información temporal de Demi».
La migración aditiva se aplicó a producción (qfhojvgvhrbautvczffq). Candidato integrado con main: 1,246 tests/189 archivos aprobados, typecheck aprobado y 10 pruebas específicas de compatibilidad/herencia aprobadas. Se conserva la compatibilidad del esquema antiguo sin assistant_key. No se copian fixtures UAT. Promoción mediante PR #271 y despliegue de main con variables de producción. Rollback previsto: dpl_7tFzKhL2Km3KEa7qneQAcZJAwphR; conservar tabla e historial.
