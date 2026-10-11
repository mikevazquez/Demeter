# Verificación del portal en Sandbox

11 de octubre de 2026. Base de datos `hedouonyhynuvwbckdlg`; no se modificó producción.

- Compilación Next.js, TypeScript y lint: correctos (17 advertencias existentes, ningún error).
- Suite base: 1.222 pruebas correctas; un contrato de creación de integrantes se actualizó al nuevo RPC y pasó sus 7 pruebas. Transportes de correo y contratos relacionados: 20 pruebas correctas.
- Deno: funciones de acceso al equipo y entrega de notificaciones comprobadas y publicadas únicamente en Sandbox.
- SQL transaccional con rollback: edición atómica de sesión, precio explícito vacío, importes de reservas existentes, duración inválida, reapertura y rechazo a Recepción; creación CRM con origen y duplicados; roles, reemplazo obligatorio, reasignación y reactivación del equipo.
- Comprobaciones anteriores con rollback: ajuste de recompensas, documentos, campos personalizados, versiones de evaluación y separación de asistentes.
- Navegación móvil: 16 módulos y revisión adicional de Hoy, Equipo, Configuración, Correo, Polina, Comunicación, Documentos y Evaluaciones devuelven HTTP 200 y no desbordan horizontalmente.

## Continúa en revisión

La ausencia de desbordamiento no demuestra fidelidad visual completa. Se continúa comparando cada pantalla y formulario con el HTML. El control de alcance conserva sin marcar las reglas que aún necesitan revisión o implementación. Las decisiones del Anexo A mantienen la política existente.
