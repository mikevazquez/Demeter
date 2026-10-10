# WhatsApp M18: desvío exclusivo del piloto hacia Sandbox

Ajuste aislado sobre la versión de producción a36539793290a4b2393c3ae4656395abab60acd7. No incluye la integración completa Demi 2.0 ni migraciones.

El callback Meta conserva su URL y el receptor de producción verifica primero la firma original. Con DEMI_M18_WHATSAPP_PILOT_RELAY=true, únicamente mensajes/estados del número 3323291878 (formatos 52 y 521) en el estudio f1d69ae2-84c5-4b76-b77c-d792c9318225 y emisor/WABA configurados se separan y reenvían al receptor fijo https://meta-sandbox.demeterfitness.com/api/integrations/meta-whatsapp/webhook?studio=9fe23cfa-fb47-4670-afeb-ed4a56433772.

El cuerpo del piloto conserva identificadores originales y se firma de nuevo con el secreto de la misma app. No se envían otros contactos a Sandbox. Los mensajes/estados de clientes conservan su receptor nativo de producción y se procesan en paralelo incluso si falla Sandbox. Un fallo de Sandbox devuelve HTTP 503 a Meta; no hay reenvío ciego ni segundo procesamiento del piloto en producción. Los reintentos se deduplican por identificadores nativos en ambos receptores.

Sin la variable habilitada, la partición no ocurre y continúa el recorrido original. La reversión consiste en deshabilitar la variable y redeplegar la misma versión; no cambia las suscripciones Meta ni datos financieros. Durante el piloto, este número debe usarse exclusivamente para UAT porque su conversación se atenderá en Sandbox.

Preparación: diez controles de aislamiento, cuenta/emisor, firma, respuesta y fallo/reintento pasaron; regresión completa 1008/1008 pruebas en 165 archivos, typecheck y lint de archivos modificados sin errores. El receptor Sandbox respondió al challenge real de verificación HTTP 200. Hace falta publicación y habilitación explícita del ajuste en producción; sólo después se solicita el audio al número piloto. Ningún cambio de producción se ejecutó durante la preparación.
