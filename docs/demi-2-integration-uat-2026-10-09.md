# Demi 2.0: integración y UAT, 9 de octubre de 2026

Integración local de `codex/demi-production-baseline-20261008` (941ec5c) sobre `feat/alumnas-crm-template` (adafdde). Conserva el CRM y añade configuración por capas, banco operativo `/admin/mas/demi/uat`, comprobantes, captura de mensajes, fallos y aislamiento. La rama mencionada en la URL del documento no existe como referencia Git; se identificó por su commit. No publicado ni desplegado.

Correcciones: confirmación «Sí, confirmo la reserva», solicitud de celular mexicano para resolver identidad y clasificación por inscripción en Demi y CRM. Un paquete vencido o la inactividad no convierten por sí solos a una alumna en exalumna. Se añadió registro persistente de resultados por caso, responsable y versión en el banco UAT.

## Verificación

Suite base 986/986; suite integrada 1017/1017; TypeScript, lint focalizado y build pasan. Preparación del banco pasó en Sandbox `hedouonyhynuvwbckdlg`. `demi-prospect-prepayment-uat.sql`: ocho variantes; `demi-2-operational-uat.sql`: diez variantes. Se ejecutaron RPC y triggers reales con datos ficticios, transacciones y ROLLBACK. Cero ejecuciones residuales de estas pruebas en la consulta posterior. No se modificó producción ni se enviaron mensajes a clientes.

Las 18 variantes SQL no equivalen a los 18 casos maestros completos. Asistencia y rechazo usaron la identidad Owner del estudio ficticio. Un primer intento con un miembro sin capacidad de asistencia recibió forbidden; se corrigió el actor del harness sin cambiar permisos del producto.

## Matriz completa

| Caso | Resultado | Evidencia nueva y pendiente |
| --- | --- | --- |
| M01 Canales | Bloqueado externo | WhatsApp integrado; faltan recepción y entrega con cuentas UAT Meta. Instagram/Facebook no tienen adaptadores en esta integración. |
| M02 Identidad | Parcial técnico | Identidad cruzada bloqueada por RPC; guía solicita celular sin lada. Faltan resolución conversacional, ambigüedad y vínculo entre canales. |
| M03 No clasifica | Sin ejecutar completo | Falta transición CRM con motivo, supresión y retorno. La edición manual del CRM no acredita automatización de Demi. |
| M04 Seguimientos | Sin ejecutar completo | Faltan disparadores de ambos mensajes, respuesta intermedia, No agendó y cese global. |
| M05 Pago antes de datos | Parcial operativo | Preparación sin reserva, monto/identidad/vencimiento bloqueados y reserva provisional en revisión pasan. Falta conversación con datos posteriores y enlace externo Mercado Pago. SQL usa una ficha precreada, no acredita orden conversacional. |
| M06 Grupo | Sin ejecutar completo | Faltan conciliación única, pagador separado, dos reservas, teléfonos repetidos y fallos parciales. No se agregó una operación transaccional de grupos. |
| M07 Cupo/reembolso | Parcial operativo | Sesión llena bloquea preparación de cobro. Faltan alternativas y atención humana específica por reembolso. |
| M08 Primera reserva | Parcial operativo | Reserva provisional, reenvío idempotente, una venta/reserva y segundo comprobante bloqueado pasan. Falta recorrido conversacional completo y QR por canal. |
| M09 Reintentos | Parcial operativo | Tres fallos de entrega capturados con contador. Falta timeout de reserva y escalamiento automático al tercer fallo. El cuarto llamado verifica agotamiento de inyección, no autoriza un cuarto reintento productivo. |
| M10 Cancelación | Parcial operativo | Exactamente cinco horas restaura crédito; menos de cinco consume una vez; replay no duplica consumo. Faltan recordatorio, vencimiento original y definición del inicio de siete días de prueba. |
| M11 Asistencia | Parcial operativo | Asistencia real persiste attended y conserva tipo trial. Faltan inscripción pagada, conversión del proveedor y dos seguimientos. |
| M12 Rechazo | Parcial operativo | Revisión real de comprobante de prueba persiste rejected, revoca reserva y conserva histórico. Faltan inscripción, paquete y entrega del aviso. |
| M13 Alumna | Parcial operativo | Reserva y crédito únicos, duplicado bloqueado, ausencia consumida una vez y replay sin otro descuento pasan. Confirmación natural cubierta por función real. Faltan conversación, efectivo, inicio con primera reserva, adeudos y exclusiones. |
| M14 Recuperación | Defecto vigente | Consulta real: sólo marketing.package_recovery_1 y _2, desactivadas. Semilla 7/14, sin tercera a 30. Falta implementar/verificar 7/15/30 e inactividad 14 días; no se activaron campañas. |
| M15 Inscripción | Parcial operativo | Inscripción vencida bloquea reserva y preserva créditos. Clasificación operativa/CRM corregida. Falta conversación en preview actualizado y resto de variantes. |
| M16 Retorno | Parcial operativo | Renovación de vigencia ficticia recupera reserva y consume una vez; no equivale a pago del proveedor. Faltan recuperación 7/15/30 y paradas. |
| M17 Humano | Parcial operativo | Caso persistente real creado. Faltan todos los motivos, asignación, pausa y devolución del control. |
| M18 Multimedia | Bloqueado externo | Pruebas locales de comprobante con límites y dependencias simuladas. Faltan audio, transcripción y recepción real por cada canal. |

**0 casos maestros aprobados completos en esta ejecución.** No se asigna aprobación por pruebas técnicas ni por evidencia histórica. La integración y el UAT integral son alcances distintos.

## Dependencias

El usuario indicó usar por ahora la app de Meta. Continuar por la integración Meta de Demeter; no se infiere un destinatario real. Se requiere un preview actualizado y servicio/modelo configurados: este executor no tiene SUPABASE_SERVICE_ROLE_KEY ni OPENAI_API_KEY. El conector SQL permitió pruebas operativas sin sustituir el modelo ni la entrega externa. Grupos y recuperación requieren implementación adicional, no sólo credenciales. La especificación deja abierto el evento que inicia los siete días del crédito de prueba.

Diagnóstico de Meta en Sandbox: proveedor meta_whatsapp habilitado y predeterminado, webhook_configured=true, pilot_contact_configured=true y connection_repair_required=false. Esto acredita configuración registrada; no se ejecutó envío ni recepción externa ni se verificó el token contra Graph API.

No se tomó el texto del documento adjunto como instrucción para publicar ni modificar producción.
