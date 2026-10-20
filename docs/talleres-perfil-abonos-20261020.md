# Talleres: perfil, abonos anticipados y tipo de sesión

La compra del taller se muestra en el resumen de la alumna, con fechas, total, pagado y saldo. El formulario permite abonar o liquidar antes de la primera sesión; no depende de abrir esa fecha en Hoy. El saldo y el importe máximo se actualizan tras un abono parcial.

Hoy y Agenda muestran Taller, Evento o Masterclass según la propiedad del taller o el programa asociado. Las clases habituales conservan su presentación sin identificador adicional. Se conserva el nombre original de la actividad.

## Una sola autoridad de pagos

Se conservó la implementación compartida del perfil y las etiquetas, recibida en `ce860b56949da2cd7e96b6e4b94dc4fcaba7ca22`, y se concilió con main `cdec53bbb1570edcae6afa2124ae13b71ddd4a4d` sin modificar esas referencias remotas.

La RPC existente `admin_register_workshop_payment` ahora delega en el motor `admin_register_sale_payment`. Bloquea venta y después compra, en el mismo orden que Hoy y la evaluación de vencimientos. Una referencia repetida con el mismo importe y método recupera el resultado; una referencia alterada se rechaza. Los cobros simultáneos desde Hoy y el perfil no exceden el saldo. Se conserva el vencimiento original de la compra liquidada.

El formulario exige referencia y confirmación de fondos recibidos. Los métodos se normalizan a efectivo/transferencia y se validan contra los métodos habilitados del estudio. Ante resultado desconocido se pide consultar el historial, sin repetir el pago automáticamente.

La migración local `20261020161915_workshop_profile_payment_replay.sql` se aplicó **solo en Sandbox `hedouonyhynuvwbckdlg`**, versión remota `20261020162455`. No se creó otra cola ni otro mecanismo de publicación o cobro.

## Verificación

- 1.736 pruebas Vitest aprobadas; TypeScript y formato correctos. ESLint sin errores, con 20 advertencias heredadas.
- 64 escenarios PostgreSQL sin red aprobados, incluyendo abono anticipado, replay, liquidación y carrera entre pagos desde perfil/Hoy.
- La prueba `scripts/uat/workshop-completion-rollback-20261019.sql` pasó 11 comprobaciones con roles reales en Sandbox, usando la RPC del perfil. Los datos sintéticos y las asignaciones de prueba se revirtieron; no quedaron estudios de prueba ni se modificaron pagos del usuario.
- El acceso anónimo a la RPC está revocado. Identidad, estudio activo y capacidades de ventas/alumnas se comprueban en el servidor.
- Pruebas de renderizado confirman las tres etiquetas especiales y ausencia de etiqueta en las clases diarias.

Se preservaron las acciones de recuperación de acceso agregadas en la rama compartida. Se corrigió su formato y se actualizaron sus dos referencias de integridad tras revisar el diff; cuatro pruebas ejecutables verifican la recuperación sin llamadas a Auth ni envío de correo reales. Los demás hashes del límite de sesión/autenticación permanecen intactos.

## Datos existentes y aceptación

Una reserva sin compra asociada no se presenta como compra pagada ni se convierte automáticamente en ingreso. La inscripción comercial pendiente requiere identificar la actividad e indicar el pago efectivamente recibido. No se duplicaron las compras ya existentes.

CI y Preview deben verificarse contra el SHA publicado de esta corrección. Las pruebas de base de datos no equivalen a una sesión de navegador autenticada ni a aceptación funcional de Mike. No se fusionó ni desplegó a producción.
