# Demi: stickers y validación de respuestas a estados

## Alcance y entorno

Rama `codex/demi-sticker-vision`, basada en main `7f6c4634d2e64c050ba2d652d42623f1d6ddc71a`. Desarrollo y UAT en Supabase sandbox `hedouonyhynuvwbckdlg`; sin cambios de producción. La autorización de información temporal no cubre esta mejora.

## Stickers

Antes: `[sticker recibido]` y revisión de archivo. Ahora: descarga autenticada de WebP, conversión a PNG y análisis visual en el mismo runtime de Demi, con historial, personalidad, presupuestos y registro de tokens/costos. Los animados aportan hasta tres fotogramas (inicio, mitad, fin); no se afirma comprensión de cada instante de la animación. Máximo 1 MB y 300 fotogramas, decodificación limitada y salida de hasta 512 px. No se guarda base64 ni se publica el archivo descargado.

El sticker es conversacional y no confirma reservas, cancelaciones, compras o pagos. No se exponen herramientas y también se bloquean las confirmaciones deterministas del servidor. Un formato corrupto, archivo vencido o fallo de decodificación conserva el flujo de revisión y pide aclaración sin fingir que se vio.

Pruebas automatizadas: normalización estática, animación real de tres fotogramas, archivo corrupto, MIME disfrazado, tamaño, contexto conversacional, bloqueo de acciones, registro de uso y presupuestos. Banco UAT: cargar WebP y marcar «Enviar como sticker», canal WhatsApp. Transporte capturado: no envía a alumnos reales.

| Caso | Validación técnica | UAT ejecutado por Codex |
| --- | --- | --- |
| STK-01 saludo | Aprobada | Satisfactorio: saludo natural |
| STK-02 agradecimiento | Aprobada | Satisfactorio: respuesta breve, sin venta |
| STK-03 animado | Aprobada: hasta tres fotogramas | Satisfactorio: reconoce saludo, agradecimiento y despedida |
| STK-04 gesto ambiguo | Aprobada: sin acciones | Satisfactorio: admite incertidumbre o responde con un emoji sin inventar datos |
| STK-05 «sí» no confirma acciones | Aprobado bloqueo de confirmación y herramientas | Satisfactorio: pide la intención por escrito; no ejecuta acción |
| STK-06 solicitud de reserva/pago | Aprobado bloqueo de herramientas | Satisfactorio: pide fecha/horario por escrito; sin reserva ni pago |
| STK-07 archivo corrupto | Aprobado rechazo de contenido | Satisfactorio: pide aclaración y conserva revisión de archivo |
| STK-08 webhook duplicado | Aprobada deduplicación | Satisfactorio: duplicate_already_handled; sin nueva entrega |

Los ocho escenarios observados fueron satisfactorios con el modelo real y transporte capturado. La aceptación final de Mike está pendiente. STK-05 comprueba el bloqueo de confirmaciones pendientes en tests de runtime; en el recorrido vivo no se creó una nueva reserva pendiente. Archivos vencidos/no descargables no se reprodujeron separadamente en el recorrido vivo. No se afirma entrega externa de Meta.

## Respuestas a estados: resultado de investigación

El extractor actual ignora `message.context`. La tabla `assistant_whatsapp_events` conserva preview, media_id y payload_fingerprint, pero no el payload ni el contexto citado. Consulta de producción, únicamente lectura: 1,018 eventos, 10 stickers; no permite atribuir ningún evento a un estado ni recuperar su foto. No se considera una prueba de que Meta no soporte respuestas a estados.

La documentación pública de Meta contempla `context` en respuestas a mensajes. Eso no demuestra que una respuesta a un estado del teléfono entregue la imagen, un media_id descargable o un ID asociable. `referral` de anuncios es otro caso y no demuestra soporte de estados orgánicos. No se debe deducir «el estado más reciente» ni asociarlo por hora: podrían existir varias publicaciones.

Validación real pendiente: publicar un estado controlado con horarios ficticios, responder «yo a las ocho» desde un número de prueba y revisar el webhook original recibido por un entorno aislado autorizado. Comprobar: llegada del evento, `type`, `context` y sus claves, referencia exacta, contenido o media_id, acceso a ese recurso, y separación entre respuesta a chat/estado/anuncio. Repetir con dos estados distintos, foto, texto y estado vencido. No cambiar suscripciones/webhooks de producción ni enviar mensajes reales como parte de esta investigación.

Decisión: integración automática de estados todavía no confirmada. Si llega el contenido, puede leerse; si llega sólo una referencia, requiere un vínculo verificable con una publicación guardada; si no llega referencia recuperable, Demi debe pedir aclaración. No implementar una interpretación basada en conjeturas.

Fuentes primarias consultadas: documentación de Meta en Postman (Messages Object, Context Object, Received Media Message with Sticker); OpenAI Images and vision; Sharp constructor/page metadata. Las páginas nuevas de Meta no pudieron recuperarse, por lo que no se afirma soporte especial de estados con esa documentación.

## Promoción

UAT de los ocho escenarios observados ejecutado satisfactoriamente por Codex. Aceptación de Mike pendiente. Promoción pendiente de autorización explícita para este alcance. Reversión: restaurar deployment anterior; no requiere migración ni borrar historial.

## Evidencia técnica y preview — 12 de octubre de 2026

- 190 archivos y 1,252 pruebas aprobadas; 6 pruebas nuevas de visión y límites.
- Typecheck aprobado; lint sin errores y 19 advertencias preexistentes; Prettier y diff --check aprobados.
- Versión funcional: f1d457ad9c21139cb8aa76f426da29dba66abda0. Deployment dpl_7XRNuKJTnCXsK7CX1Bu4Q2wsPyZN READY; build «Preview isolation verified: Studio Flow Sandbox».
- [Banco UAT de stickers](https://demeterbueno-git-codex-demi-sticker-vision-demeter3.vercel.app/admin/mas/demi/uat).
- Se abrió la página autenticada y se recuperó el escenario aislado 3b03aaf5-b014-4277-bc69-cef7aa2ba271, estudio 29af8ae6-1c55-497d-b53c-d6d7b6fc828d. El formulario muestra la opción de sticker y archivo WebP.
- El navegador restringió las operaciones después de la autenticación nativa («retained_data_restricted» / «native credential state cannot be safely resumed»), incluso al abrir una pestaña nueva. Esa limitación corresponde al primer intento por navegador. Posteriormente el receptor se ejecutó dentro del build aislado de Vercel con modelo real y salidas capturadas; ver cierre siguiente.
- Para probar: recuperar la ejecución, elegir una persona ficticia, canal WhatsApp, cargar un WebP y marcar Enviar como sticker. Enviar al flujo real. Los fixtures estáticos y animados están en tests/fixtures/demi-stickers.
- Producción sin escrituras. Respuestas a estados: pendiente de webhook real controlado; no basta una prueba sintética para afirmar recuperación de una publicación orgánica.

Referencias: [Meta Messages Object](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object), [Meta Context Object](https://www.postman.com/meta/whatsapp-business-platform/folder/hysdhqs/context-object), [OpenAI visión](https://developers.openai.com/api/docs/guides/images-vision), [Sharp](https://sharp.pixelplumbing.com/api-constructor/).

## Cierre de ejecución conversacional — 12 de octubre de 2026

- Versión funcional verificada: ad0dd6daa85a3521611c05da4a1ab414e6e4332c. Deployment dpl_GCJG3cxypjqRcHx91VzRkM8uoy7i READY, preview/staging conectado a sandbox. El build verificó aislamiento.
- Dos lotes de ocho escenarios quedaron guardados; se revisaron sus respuestas. El runner no aprueba automáticamente: la revisión de Codex quedó como un artefacto adicional sticker_uat_review.
- Sin nuevas ventas, pagos, reservas, movimientos de créditos, acciones pendientes, ejecuciones de herramientas ni intenciones de inscripción/transferencia. Los conteos antes y después son iguales. No se afirma una comparación campo por campo de históricos.
- El duplicado devolvió duplicate_already_handled y mantuvo el mismo número de entregas.
- La creación de un nuevo estudio de prueba falló con 23505; se recuperó la ejecución aislada existente con lease, sin borrar ni sustituir su historial.
- Se retiró el disparador temporal de UAT del build al terminar. El runner queda como herramienta de prueba manual limitada a la rama de stickers y al sandbox.
- [Evidencia detallada](./demi-sticker-uat-evidence-20261012.json). Fuente: demi_uat_artifacts del sandbox.
- La suite anterior de 1,252 tests permanece como evidencia técnica de la implementación; el build final aprobó TypeScript. No se afirma un nuevo resultado de suite completa que no pueda recuperarse.

## Lo que falta para estados de WhatsApp

La tabla de proveedores del sandbox tiene Meta WhatsApp habilitado, pero esa etiqueta no comprueba que exista un número separado ni que el webhook real esté dirigido al sandbox. Antes de una respuesta real a un estado hay que verificar el enrutamiento de Meta y contar con un estado y número de prueba autorizados. No se cambió el enrutamiento de producción. No pedir una respuesta al número real sin tener primero una captura que conserve su contexto: la integración actual lo descarta.

| Caso de estados | Estado |
| --- | --- |
| EST-01 recibir respuesta a estado y conservar contexto original | Pendiente de muestra real |
| EST-02 recuperar la foto o texto referenciado | Pendiente de EST-01 |
| EST-03 distinguir dos estados distintos | Pendiente de muestra real |
| EST-04 interpretar «yo a las ocho» y confirmar clase/día | Pendiente de contenido recuperable |
| EST-05 estado vencido o referencia inaccesible | Pendiente de muestra real |

Stickers y estados son alcances separados. Los estados no forman parte de una promoción de stickers.
