# Demi: stickers y validación de respuestas a estados

## Alcance y entorno

Rama `codex/demi-sticker-vision`, basada en main `7f6c4634d2e64c050ba2d652d42623f1d6ddc71a`. Desarrollo y UAT en Supabase sandbox `hedouonyhynuvwbckdlg`; sin cambios de producción. La autorización de información temporal no cubre esta mejora.

## Stickers

Antes: `[sticker recibido]` y revisión de archivo. Ahora: descarga autenticada de WebP, conversión a PNG y análisis visual en el mismo runtime de Demi, con historial, personalidad, presupuestos y registro de tokens/costos. Los animados aportan hasta tres fotogramas (inicio, mitad, fin); no se afirma comprensión de cada instante de la animación. Máximo 1 MB y 300 fotogramas, decodificación limitada y salida de hasta 512 px. No se guarda base64 ni se publica el archivo descargado.

El sticker es conversacional y no confirma reservas, cancelaciones, compras o pagos. No se exponen herramientas y también se bloquean las confirmaciones deterministas del servidor. Un formato corrupto, archivo vencido o lectura fallida conserva el flujo de revisión y pide aclaración sin fingir que se vio.

Pruebas automatizadas: normalización estática, animación real de tres fotogramas, archivo corrupto, MIME disfrazado, tamaño, contexto conversacional, bloqueo de acciones, registro de uso y presupuestos. Banco UAT: cargar WebP y marcar «Enviar como sticker», canal WhatsApp. Transporte capturado: no envía a alumnos reales.

| Caso                                                  | Validación técnica                                | UAT conversacional                 |
| ----------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| STK-01 saludo con texto                               | Aprobada                                          | Pendiente                          |
| STK-02 agradecimiento y despedida sin reiniciar venta | Aprobada en canal visual                          | Pendiente                          |
| STK-03 animado                                        | Aprobada extracción de tres fotogramas            | Pendiente                          |
| STK-04 gesto ambiguo                                  | Prompt conserva incertidumbre                     | Pendiente                          |
| STK-05 «sí» con reserva pendiente                     | Aprobado bloqueo de confirmación y herramientas   | Pendiente                          |
| STK-06 texto que solicita reserva/pago                | Aprobado bloqueo de herramientas                  | Pendiente                          |
| STK-07 corrupto, vencido o no descargable             | Aprobado rechazo de contenido; fallback existente | Pendiente de receptor completo     |
| STK-08 reintento del webhook                          | Se conserva deduplicación existente               | Pendiente con transporte capturado |

## Respuestas a estados: resultado de investigación

El extractor actual ignora `message.context`. La tabla `assistant_whatsapp_events` conserva preview, media_id y payload_fingerprint, pero no el payload ni el contexto citado. Consulta de producción, únicamente lectura: 1,018 eventos, 10 stickers; no permite atribuir ningún evento a un estado ni recuperar su foto. No se considera una prueba de que Meta no soporte respuestas a estados.

La documentación pública de Meta contempla `context` en respuestas a mensajes. Eso no demuestra que una respuesta a un estado del teléfono entregue la imagen, un media_id descargable o un ID asociable. `referral` de anuncios es otro caso y no demuestra soporte de estados orgánicos. No se debe deducir «el estado más reciente» ni asociarlo por hora: podrían existir varias publicaciones.

Validación real pendiente: publicar un estado controlado con horarios ficticios, responder «yo a las ocho» desde un número de prueba y revisar el webhook original recibido por un entorno aislado autorizado. Comprobar: llegada del evento, `type`, `context` y sus claves, referencia exacta, contenido o media_id, acceso a ese recurso, y separación entre respuesta a chat/estado/anuncio. Repetir con dos estados distintos, foto, texto y estado vencido. No cambiar suscripciones/webhooks de producción ni enviar mensajes reales como parte de esta investigación.

Decisión: integración automática de estados todavía no confirmada. Si llega el contenido, puede leerse; si llega sólo una referencia, requiere un vínculo verificable con una publicación guardada; si no llega referencia recuperable, Demi debe pedir aclaración. No implementar una interpretación basada en conjeturas.

Fuentes primarias consultadas: documentación de Meta en Postman (Messages Object, Context Object, Received Media Message with Sticker); OpenAI Images and vision; Sharp constructor/page metadata. Las páginas nuevas de Meta no pudieron recuperarse, por lo que no se afirma soporte especial de estados con esa documentación.

## Promoción

UAT y aceptación de Mike pendientes. Promoción pendiente de autorización explícita para este alcance. Reversión: restaurar deployment anterior; no requiere migración ni borrar historial.
