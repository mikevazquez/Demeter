# Cumpleaños · WhatsApp y disparador

La administradora revisa **Notificaciones → Marketing → Cumpleaños**, registra/asigna la plantilla aprobada y activa el disparador. Cada 15 minutos el motor consulta los cumpleaños del día de Ciudad de México y entrega una felicitación por alumna y año mediante el adaptador existente de Meta.

## Demo de Sandbox

- Estudio: Studio Flow Sandbox, proyecto `hedouonyhynuvwbckdlg`.
- Alumna sintética existente: **Demo · Camila Torres**. Cumpleaños: **19 de octubre**; no tiene acceso de alumna ni teléfono destinatario preparado para envíos.
- Ruta del demo: `/admin/notificaciones/marketing/birthday?preview_date=2026-10-19`.
- El selector de fecha consulta elegibilidad y muestra el mensaje sin programar ni enviar nada. El disparador real permanece desactivado.
- Meta recibió `demeter_cumpleanos`, `es_MX`, `MARKETING`, ID `1147860590925080`, el 20 de octubre de 2026. Respuesta inicial: `PENDING`; consulta posterior: **APPROVED**. La plantilla quedó asignada a `birthday` únicamente en Sandbox, conservando las demás asignaciones. La pantalla consulta el estado real de Meta. Registrar la plantilla no envía mensajes.

Mensaje: «¡Feliz cumpleaños, Camila Torres! En Demeter Fitness Studio celebramos contigo y te deseamos un día lleno de alegría. Gracias por ser parte de nuestra comunidad.»

## Cómo validar

1. Entrar como owner/staff autorizado al estudio de Sandbox y abrir la ruta del demo. Confirmar Camila y su felicitación; no se muestra edad ni año de nacimiento.
2. Revisar nombre, idioma, categoría, dos variables y estado de Meta. No se permite asignar una plantilla pendiente, rechazada, de categoría distinta o con variables incompatibles.
3. Cambiar la fecha a un día sin cumpleaños: aparece el estado vacío. Una fecha inválida usa hoy en Ciudad de México.
4. Mientras falte aprobación/asignación o WhatsApp esté apagado en Preferencias, el botón de activar permanece bloqueado. La prueba de vista previa no cambia este estado.
5. Un usuario de solo lectura no tiene acciones para registrar, asignar o activar. Coach, alumna, anónimo y otro estudio no acceden a la consulta de cumpleaños.
6. La activación real y un envío a un teléfono requieren una prueba autorizada aparte; esta entrega no envía felicitaciones para demostrar el flujo.

## Evidencia técnica

- Suite completa local inicial: **1696/1696** pruebas; después se agregó la regresión de pausar al retirar WhatsApp. **25/25** pruebas focalizadas en la cabeza final. CI del PR verifica también la suite completa.
- Build local aprobado; lint sin errores y con 19 avisos heredados. TypeScript aprobado.
- `tests/birthday-whatsapp-actions.test.ts`: aprobación/categoría/variables, preferencias globales, permisos, pausa, mapeo conservando otras plantillas y registro sin duplicar.
- `tests/birthday-whatsapp-editor.test.tsx`: render del demo, fecha de México, fecha elegida/inválida, permisos y errores de consulta.
- `tests/birthday-whatsapp-delivery.test.ts`: ejecuta las funciones reales del worker sin red; descarta mensajes tardíos o destinatarias inelegibles, respeta opt-out y entrega una sola vez al adaptador simulado.
- `tests/birthday-whatsapp-template.test.ts`: compatibilidad entre catálogos y orden de parámetros, sin fecha de nacimiento en el payload de Meta.
- `tests/sql/birthday-whatsapp.sql`: prueba real en Sandbox con rollback. Cubre febrero 29, fechas vacías/inválidas, pruebas no convertidas, exalumnas, estudio, regla apagada, idempotencia de instalación, deduplicación anual, medianoche de México, privacidad y permisos. Los eventos de prueba nunca son visibles a workers externos a la transacción.
- Solo canal WhatsApp: sin Inbox de alumna, Push o Email para esta regla. No se modifican portal, regalos, pases, paquetes, créditos ni asistencia.

## Coordinación del runtime compartido

El worker de Sandbox v33 contenía cambios de Email, campañas y validación general de destinatarias que todavía no están en `main`. Para conservarlos, Sandbox v34 aplica únicamente el parche de cumpleaños sobre ese runtime; los archivos de Email, Asistian y envío Meta permanecen idénticos. Las cuatro pruebas del worker pasaron también sobre ese código combinado mediante `BIRTHDAY_DELIVERY_SOURCE`.

El PR contiene solamente el cambio de cumpleaños sobre `main`, no incorpora esos cambios ajenos. Antes de promover el worker a producción se debe reconciliar su código desplegado y conservar sus mejoras, con el mismo control de diferencias; no sustituirlo a ciegas por el archivo completo de esta rama. Esta reconciliación forma parte del preflight de promoción, después del UAT y la autorización de este nuevo alcance.

PR #344 es independiente: regalos y portal. Su migración antigua de cumpleaños no debe sobrescribir el emisor, cron o regla de esta entrega si se despliega fuera del orden de migraciones. La migración de esta entrega es posterior y no depende de tablas de regalos.

Rollback de Sandbox del worker: versión previa 33, bundle `f3100c60e46442bd5c55fe7e4717d4303f168f6375762f56e5fb153db9240c22`. Para parar saludos, desactivar `marketing.birthday`; no borrar fechas de perfil ni eventos históricos. No se modificó la base ni el despliegue de producción.
