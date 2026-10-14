# UAT — Activación de alumnas por Meta WhatsApp (Sandbox)

**Estado:** BLOQUEADO — no ejecutar ni promover hasta verificar plantilla y canal.  
**Proyecto permitido:** `hedouonyhynuvwbckdlg` (Studio Flow Sandbox). Producción excluida.

## Hallazgos confirmados
- `notification-delivery-worker` v33 no tiene caso explícito `account_created`; el PR añade alias a `student_welcome`.
- `provision-student-access` v20 genera URL con `token_hash` y `type=recovery` y usa `sendAsistianWebhook` tanto para alta como para reenvío.
- `_shared/meta-whatsapp-template.ts` usa `student_welcome: ["nombre"]`, sin parámetro ni botón de URL dinámica en el payload.
- El `return_link` del aprovisionamiento devuelve la URL al llamador autenticado, pero **no prueba** entrega por WhatsApp.

## Bloqueadores antes de implementar envío
1. Confirmar en Meta la estructura **exacta** de la plantilla aprobada (nombre, idioma, componentes y botón URL si existe); no modificar una plantilla aprobada a ciegas.
2. Elegir plantilla compatible con URL de activación, o solicitar aprobación de una nueva plantilla. El `student_welcome` actual **no entrega la URL**.
3. Evitar enviar tokens de recuperación en logs, eventos, historial, notificaciones internas o respuestas públicas.
4. Resolver idempotencia y reenvíos: token vigente, caducidad, destinatario, rate limiting y estado de entrega.
5. Reconciliar dependencias desde Sandbox antes de desplegar funciones; preservar JWT y permisos de `settings.write`.

## Casos UAT (datos sintéticos, Sandbox)
| ID | Escenario | Resultado esperado |
|---|---|---|
| ACT-01 | Alta nueva con teléfono válido | Cuenta creada; enlace generado; Meta acepta envío; plantilla correcta |
| ACT-02 | Abrir enlace de ACT-01 | Página de activación acepta token y permite crear contraseña |
| ACT-03 | Reenviar activación pendiente | Nuevo enlace enviado a teléfono correcto; sin Asistian |
| ACT-04 | Alumna ya activada | Reenvío rechazado con `activation_already_completed` |
| ACT-05 | Teléfono inválido | Error seguro; sin envío |
| ACT-06 | Sin permiso `settings.write` | 403; no se genera enlace |
| ACT-07 | Meta sin conexión / plantilla no configurada | Error rastreable; no marcar enviado |
| ACT-08 | Reintento de entrega | Sin duplicados indebidos ni exposición de token |
| ACT-09 | Regresión `student_welcome` | Resto de notificaciones WhatsApp continúa funcionando |
| ACT-10 | Verificación de entornos | Ningún cambio ni mensaje real en producción |

**Criterio de aprobación:** evidencia del envío real a número de prueba, entrega y activación; pruebas de seguridad y regresión completas. Aprobar UAT no autoriza promoción a producción.
