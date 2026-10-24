# TALL-NOTIF-01 · Confirmaciones de Talleres

Base: `9a5bbcbc4584480b5440901ac985a177a877e3ef`.
Rama: `fix/workshop-confirmation-events-20261024`.
Contrato y tareas: [Talleres en Governance](https://app.notion.com/p/3fed78f71463817cb396d4322846a6e0).

## Defecto y corrección

El checkout guardaba pagos y reservas sin emitir `booking.created`. Las reglas
existentes no podían crear las confirmaciones. Lectura productiva del 24 de
octubre: cinco compras con anticipo de 300 MXN, 25 reservas, cero eventos y cero
intentos de entrega asociados. Las cinco participantes tienen teléfono; en el
mismo estudio constan 11 confirmaciones ordinarias entregadas en las últimas
24 horas. Esto no demuestra entrega futura a cada destinataria.

La migración reemplaza únicamente `workshop_checkout_confirm_v2`, conservando su
cuerpo anterior y añadiendo la emisión del evento después de vincular cada
reserva con la compra. Usa la clave ordinaria `booking.created:<reservation_id>`
y el payload de reserva, sesión y alumna. El retorno de replay ocurre antes de
la emisión. Evento, reserva y pago se confirman o revierten juntos. No modifica
ACL, reglas, plantillas, canales, reservas ordinarias ni compras históricas.

## Evidencia ejecutada

- Antes del cambio, la nueva regresión falla: **0 eventos frente a 3 esperados**
  ([salida](before.txt)).
- Después: **82/82 escenarios PostgreSQL 17 aislado PASS**
  ([salida](postgres.txt)). Incluye migración repetible y ACL conservadas, compra
  completa e individual con anticipo, payload/tenant correctos, replay sin otro
  evento ni pago, rechazo de importe insuficiente y estudio ajeno, y fallo del
  segundo evento con reversión de compra, reservas y primer evento.
- Se instalan el ledger, persistencia y runtime reales de notificaciones. Los
  eventos nuevos producen exactamente una entrada pendiente del motor por
  reserva. No se instala dispatcher ni proveedor: no se acredita aceptación o
  entrega de WhatsApp.
- Docker con `--network none`, PostgreSQL fijado por digest en el runner, datos
  ficticios, sin puertos publicados ni credenciales de aplicación. Contenedor
  eliminado por el runner. No se usa la base compartida de Sandbox ni producción
  para ejecutar las compras de prueba.
- Vitest: **2.065 PASS, 13 SKIP**, 268 archivos aprobados y uno omitido.
- TypeScript, formato y build: **PASS**. ESLint: **0 errores, 20 advertencias
  heredadas**. Los archivos de configuración regenerados por Next se restauran;
  no forman parte del cambio.

No hay una nueva decisión funcional o visual: se restaura la confirmación ya
configurada, por lo que no se pide repetir la UAT histórica de Talleres. La
verificación técnica anterior corresponde al sandbox local aislado; no se
presenta como prueba de transporte externo ni despliegue en Sandbox compartido.

## Recuperación revisable y puerta productiva

`scripts/uat/workshop-confirmation-recovery-plan.sql` es exclusivamente de lectura.
Limita el inventario a las cinco compras afectadas y excluye fechas pasadas o
canceladas, reservas/compras no elegibles, teléfono ausente, evento existente o
ejecución histórica que requiera conciliación. La consulta se verificó en
producción, sólo lectura: **25 `missing_event_candidate`**.

La migración NO hace backfill. Tras autorización productiva inequívoca para este
fix y para recuperar esos avisos, volver a leer el inventario y bloquear cualquier
discrepancia de alcance. Emitir sólo los eventos aún ausentes con sus claves
estables, sin recrear compra, pago o reserva. Las reglas y preferencias existentes
deciden la entrega; no se eluden bloqueos de contacto. Registrar por separado
eventos creados, avisos encolados, aceptados, entregados y fallidos.

Al corte de esta evidencia no se ha modificado producción ni enviado mensajes.
El PR y CI se vinculan al contrato canónico; un CI de otro PR no acredita éste.
PR #397 de catálogo de Demi conserva su alcance y candidata independientes.

## Rollback

Antes de aplicar en producción, guardar la definición y ACL efectivas de
`workshop_checkout_confirm_v2` y comparar el cuerpo original con el de la base de
esta entrega; detenerse ante drift funcional. Revertir sólo la función a la
definición anterior si aparece una regresión. No borrar eventos, pagos, reservas
ni historial; la reversión del código no puede retirar mensajes ya entregados.
Para avisos pendientes, usar los controles existentes después de revisar su
estado. No desactivar globalmente las confirmaciones ordinarias del estudio.
