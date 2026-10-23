# DEMI-378 — coordinación persistente de turnos

Implementación en PR [#380](https://github.com/mikevazquez/Demeter/pull/380), rama `fix/demi-turn-coordination-378-20261023`. Evidencia y límites en [UAT](../uat/demi378-20261023/README.md). No implica autorización de producción ni cierre del issue.

## Protocolo

- Clave: estudio + proveedor Meta WhatsApp + contacto canónico (incluye equivalencia mexicana 521/52). Ningún histórico se reescribe.
- El trigger AFTER INSERT incrementa la generación y registra el texto vigente bajo bloqueo de fila. Un replay rechazado por la clave única no mueve la generación. No se ordenan turnos exclusivamente por timestamps.
- Un worker obtiene token y lease persistente de 60 segundos, renovado cada 10 segundos. Las RPC validan propietario y vigencia; un token vencido no puede admitir acciones ni autorizar un envío. La liberación ocurre en `finally`, incluso ante `continue`; otro webhook recupera una reserva abandonada después del vencimiento.
- Un mensaje nuevo invalida el texto en generación y cualquier envío todavía reservado. Se conserva su historial; el worker nuevo procesa el contexto actualizado. Si encuentra un propietario activo responde error reintentable, sin admitir otro procesamiento concurrente. Los textos capturados que aún no tenían historial se preparan antes de generar.
- Quietud: 4 segundos configurable con flag activo; máximo de espera 12 segundos desde el primer texto. No se reinicia el máximo con cada entrada. La quietud sólo optimiza; PostgreSQL decide la vigencia. Sin flag, el default anterior sigue siendo 2500 ms.
- Medios, audio y comprobantes no se descartan por batching. Sus acciones y respuestas usan el mismo propietario y protección de envío.

## Autorización y resultados

Todos los cinco call sites del webhook pasan por `sendReply`: respuesta generada, caché, mensaje no compatible, comprobante/media y elección de paquete. Talleres de `main` también queda dentro del guard de comprobantes. No se modifican pruebas administrativas de plantillas ni el transporte Messenger/Instagram: son acciones explícitas independientes del turno de Demi.

Una reserva de envío es reversible (`reserved`); la RPC final vuelve a comprobar el token y la generación y la convierte una sola vez en `dispatching`. Después hay **un solo intento HTTP**, sin reintento inline de 429 en este modo. El comportamiento anterior del sender sigue disponible sin el flag.

- `accepted`: conserva el ID devuelto por Meta antes de persistir el resto del historial. Se puede repetir la escritura del recibo, nunca la petición a Meta.
- `uncertain`: timeout, corte de red, respuesta ambigua o worker abandonado después de autorizar. No se vuelve a enviar ese evento.
- `failed_final`: rechazo conocido; tampoco se reabre automáticamente ese evento. Una entrada nueva sigue disponible.
- `invalidated`: reserva anterior a autorización que puede recuperarse con otro token si sigue correspondiendo al evento vigente.

El índice activo excluye resultados inciertos: un recibo desconocido no bloquea indefinidamente las respuestas a mensajes nuevos. La clave única del evento sí impide repetir su envío. Un fallo al guardar un resultado aceptado deja el evento en revisión o el claim sellado. La respuesta preparada se guarda antes del despacho, para no regenerar acciones tras un fallo previo al envío.

**Límite distribuido:** PostgreSQL y Meta no comparten transacción. La autorización de despacho es el punto irreversible del turno; una entrada posterior inicia otro turno y no puede retirar una petición ya autorizada. No se promete exactly-once del proveedor, cancelación del modelo en ejecución ni rollback de una acción ya admitida. Los checks antes de acciones y después del modelo descartan cooperativamente el trabajo obsoleto.

## Acciones e idempotencia

Todas las herramientas de acción del orquestador y los handlers directos de comprobantes/elección de paquete pasan por un ledger persistente independiente del envío. La clave incluye evento y argumentos canónicos de la acción. Un resultado completo se reutiliza; un intento `started` cuyo resultado se perdió **no se ejecuta otra vez**, ni se libera por TTL. Las operaciones comerciales conservan además su idempotencia nativa (reserva, crédito, orden/pago y pendientes); las pruebas de Sandbox contrastan esas filas reales.

Una acción incierta bloquea nuevas acciones del mismo contacto hasta reconciliación. Este bloqueo comercial deliberado protege contra un cobro/reserva duplicado; no es una reserva de generación abandonada que pueda robarse. Las respuestas informativas y otros contactos siguen independientes.

## Reconciliación y rollback

1. Inspeccionar claim, evento, entregas y recibo del proveedor usando referencias anonimizadas. No usar la ausencia de una fila local como prueba de que Meta no recibió el mensaje.
2. Con recibo positivo verificable, registrar `accepted` con el token original y el mismo provider ID mediante `assistant_whatsapp_finish_text_claim`; acepta el recibo tardío desde `uncertain`. Conservar la evidencia en el incidente. No enviar otra petición.
3. Si no hay prueba suficiente, conservar `uncertain`. Un rechazo definitivo se documenta para revisión operativa; no existe una transición automática que vuelva a habilitar el envío.
4. Para acciones `started`, contrastar el identificador nativo de reserva/pago/orden y su ledger. Registrar el resultado con el token original únicamente con evidencia suficiente. Sin evidencia, intervención operativa; nunca borrar la reserva para repetir una operación.
5. Rollback de aplicación: apagar `DEMI_ATOMIC_TEXT_SEND_CLAIMS`, conservar esquema, tokens, recibos e históricos. Los eventos que ya llevaron coordinación atómica quedan identificados y no pueden caer al reintento legacy sin guard. No reiniciar claims, reactivar eventos antiguos ni repetir acciones inciertas.

## Esquema y permisos

Aplicar las tres migraciones en orden, con el flag apagado: `20261023183000`, `20261023194048`, `20261023194826`. La última revoca explícitamente los permisos de escritura que Supabase puede conceder por defecto a `service_role`; no basta con conceder SELECT. Las RPC `SECURITY DEFINER` tienen search_path vacío, rol de servicio obligatorio y EXECUTE revocado a PUBLIC/anon/authenticated. Las tres tablas tienen RLS y sólo SELECT directo para servicio; las mutaciones requieren las RPC.

El advisor muestra tres avisos INFO de [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): es deliberado, pues los clientes no tienen grants ni políticas y las escrituras sólo pasan por las funciones internas. No se añadieron funciones de coordinación ejecutables por anon/authenticated.

La promoción y activación en producción requieren autorización separada, CI del SHA exacto, verificación de destino/esquema y este paquete de evidencia. No fusionar ni desplegar desde este documento.
