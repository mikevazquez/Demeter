# Verificación del portal en Sandbox

11 de octubre de 2026. Base de datos `hedouonyhynuvwbckdlg`; no se modificó producción.

- Compilación Next.js, TypeScript y lint: correctos (17 advertencias existentes, ningún error).
- Suite completa de este avance: 186 archivos, 1.238 pruebas correctas. Transportes de correo y contratos relacionados: 20 pruebas correctas.
- Deno: funciones de acceso al equipo y entrega de notificaciones comprobadas y publicadas únicamente en Sandbox (versiones 11 y 30).
- SQL transaccional con rollback: edición atómica de sesión, precio explícito vacío, importes de reservas existentes, duración inválida, reapertura y rechazo a Recepción; creación CRM con origen y duplicados; roles, reemplazo obligatorio, reasignación y reactivación del equipo.
- Comprobaciones anteriores con rollback: ajuste de recompensas, documentos, campos personalizados, versiones de evaluación y separación de asistentes.
- Navegación móvil: 16 módulos y revisión adicional de Hoy, Equipo, Configuración, Correo, Polina, Comunicación, Documentos y Evaluaciones devuelven HTTP 200 y no desbordan horizontalmente.

## Continúa en revisión

La ausencia de desbordamiento no demuestra fidelidad visual completa. Se continúa comparando cada pantalla y formulario con el HTML. El control de alcance conserva sin marcar las reglas que aún necesitan revisión o implementación. Las decisiones del Anexo A mantienen la política existente.

## Segundo avance

- Ventas: inicio al terminar el paquete actual; fecha real de pago hasta −7 días; reembolso parcial conserva derechos y permite bloquear el paquete, con saldo calculado desde importes netos por línea.
- Equipo: edición completa de datos y rol, protección del Owner, métricas reales de los últimos 30 días, especialidades derivadas de Agenda, estado de acceso y último ingreso.
- Comunicación: cumpleaños diario comercial, pausado por defecto; campañas con borrador, audiencia, programación, aprobación de WhatsApp y conteos de entregas reales. No se enviaron mensajes de prueba a personas reales.
- Alumnas: motivo obligatorio para inactivar, conservar reservas, omitir automatizaciones y exigir ELIMINAR; historial de acciones documentales.
- Inteligencia: tema oscuro, orden de pestañas, primeros paquetes por inicio, señales de riesgo, asistencia sobre resultados capturados, renovación dentro de ocho días y gastos con eliminación reversible.
- SQL con rollback: pagos fechados, cumpleaños/deduplicación, campañas/exclusión/estados, ciclo de vida, edición de equipo, reembolso parcial/bloqueo/límites y gastos/deshacer/fecha futura.
- Navegación adicional: 30 comprobaciones en móvil oscuro y escritorio claro; ninguna terminó en login, error de página o desbordamiento. Se corrigió el recorrido para detectar las redirecciones al acceso.

- Prueba financiera adicional bajo el rol real `authenticated`: reembolso con saldo pendiente, liquidación posterior y conservación del bloqueo opcional. Protección del rol y estado del Owner comprobada con rollback. Perfil de integrante y Gastos también revisados en dos tamaños.
