# Cumpleaños v1 (CUMP-01)

Épica en Notion: **CUMP-01 · Cumpleaños Demeter v1** (StudioFlow · Tablero Agile V2).
Rama consolidada: `claude/cumpleanos-v1` = main + #355 (WhatsApp del día) + #344 (pase B1/B2) + lo nuevo.

## Qué hace

| Tarea         | Qué ve cada quien                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CUMP-01-01    | Equipo: cumpleaños en Hoy (en producción desde #338).                                                                              |
| CUMP-01-02    | Alumna: WhatsApp de felicitación el día de su cumpleaños (`marketing.birthday`, apagada).                                          |
| CUMP-01-03/04 | Alumna: saludo privado el día exacto y tarjeta «Regalo de cumpleaños» todo su mes.                                                 |
| CUMP-01-06    | Alumna: «Usar mi pase de cumpleaños» en el detalle de la clase → para mí / para una amiga (nombre + WhatsApp).                     |
| CUMP-01-07    | Si cancela a tiempo o el estudio cancela la clase, el pase regresa. Cancelación tardía o falta: se pierde.                         |
| CUMP-01-08    | Equipo: estado del pase en la ficha de la alumna; en la lista de la clase, «Pase de cumpleaños» / «Invitada · pase de cumpleaños». |
| CUMP-01-09    | Dueño: Notificaciones › Marketing › Cumpleaños › «Regalo de cumpleaños» (activo sí/no, regalar a amiga sí/no).                     |
| CUMP-01-10    | Alumna: WhatsApp el día 1 de su mes avisando del regalo (`marketing.birthday_month`, apagada).                                     |

Reglas: 1 pase por alumna por año; vale del día 1 al último día de su mes (hora del estudio); no suma ni
descuenta créditos (también con ilimitado); no aplica a talleres ni a clases con lugar a elegir; respeta
cupo, ventana de reserva y pausas por penalización (NEB-01) cuando ambas ramas estén juntas.

## Migraciones (en este orden)

1. `20261020163648_birthday_whatsapp_notifications.sql` (#355; en Sandbox ya está como 20261020164249 + 20261020165406).
2. `20261023100000_birthday_passes.sql` (antes 20261020021000 de #344; en Sandbox ya existe sin registro; es idempotente).
3. `20261023100500_birthday_pass_snapshot_day.sql` (antes 20261020022500; ídem).
4. `20261023101000_birthday_gift_v1.sql` (nueva).

Pruebas SQL locales: `PGHOST=… PGPORT=… PGUSER=postgres scripts/cump01-sql-tests.sh` → `cump01 birthday: 22/22 OK`.
Nunca contra Sandbox ni producción (crea y borra la base `cump01_test`).

## Pasos para Codex (Sandbox `hedouonyhynuvwbckdlg`)

1. Aplicar 2, 3 y 4 (en ese orden). La 4 se detiene si `admin_update_meta_whatsapp_templates` no tiene la clave `birthday`.
2. Verificar: `select rule_key, enabled from notification_rules where rule_key like 'marketing.birthday%'` → dos reglas por estudio, apagadas.
3. Desplegar el worker `notification-delivery-worker` **sobre el runtime actual de Sandbox (v34)** agregando solo el caso `birthday_month` (no reemplazar a ciegas: v34 trae mejoras de Email/campañas que no están en main).
4. Registrar en Meta la plantilla del día 1 desde Notificaciones › Marketing › Cumpleaños (nombre `mes_cumpleanos_regalo`, MARKETING, es_MX, ejemplos «Camila» / nombre del estudio). Asignarla cuando Meta la apruebe. No activar reglas.
5. Datos de demo (sintéticos): Demo · Camila Torres (cumple 19-oct) con portal de prueba; una clase de octubre con cupo; dejar el pase disponible.
6. Security Advisor después del DDL.

## Guion del demo (Mike)

1. Admin › Hoy: cumpleaños visibles (ya en producción).
2. Notificaciones › Marketing › Cumpleaños: regalo activo; vista previa del día (19-oct) y del día 1 (octubre); ambas reglas apagadas.
3. Portal de Camila: tarjeta del regalo (y saludo con `?birthday_demo=day` en Preview), «Abrir mi regalo».
4. Reservar → clase de octubre → «Usar mi pase de cumpleaños» → Para mí. Mis clases: aparece sin usar créditos.
5. Cancelar a tiempo → el pase vuelve al portal. Ahora «Para una amiga» con nombre y WhatsApp.
6. Admin: ficha de Camila («Regalado a una amiga») y lista de la clase («Invitada · pase de cumpleaños»).
7. Apagar «regalar a una amiga» y luego el regalo: la tarjeta desaparece; el saludo del día sigue.

Decisiones a confirmar en el demo: devolución del pase al cancelar a tiempo; texto del aviso del día 1; la frase
«Las flores no compiten, solo florecen» se quitó del saludo para que sirva a cualquier estudio (se puede volver
como texto configurable).
