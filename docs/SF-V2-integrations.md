# Studio Flow V2 · Integraciones

Estado: Sandbox.

## Decisión de producto

El módulo visible **Avanzado** se retira. Su lugar lo ocupa **Integraciones**, cuyo alcance es exclusivamente conectar Studio Flow con servicios externos.

No deben colocarse dentro de Integraciones configuraciones internas del estudio como región, recursos físicos, apariencia, reservas o suscripción.

## Navegación

- Integraciones: `/admin/integraciones`
- La ruta histórica `/admin/configuracion` redirige a Integraciones para conservar compatibilidad.
- Región y formatos: `/admin/configuracion/region`
- Recursos y espacios: `/admin/configuracion/recursos`
- Plan y suscripción: `/admin/suscripcion`
- Las tres configuraciones anteriores permanecen accesibles desde **Más**.

## Integraciones actuales

### Asistian
- Reserva y sincronización operativa.
- Relación entre servicios de Asistian y actividades de Studio Flow.
- Eventos recibidos y herramientas de diagnóstico.
- Detalle: `/admin/integraciones/asistian`.

### Mercado Pago
- Proveedor actual del checkout online de alumnas.
- El estudio puede consultar productos disponibles para compra online, intentos y pagos aprobados.
- La activación de compra online sigue perteneciendo a cada producto/paquete.
- Detalle: `/admin/integraciones/mercado-pago`.

### Meta · WhatsApp
- Proveedor para entrega de mensajes de WhatsApp.
- Integraciones muestra el estado de la conexión.
- Comunicación conserva la responsabilidad sobre procesos, marketing, plantillas y horarios.
- Detalle: `/admin/integraciones/meta-whatsapp`.
- Las credenciales sensibles nunca se muestran en UI.

## Integraciones futuras visibles

- Stripe: futura integración para cobros del estudio a sus alumnas. No confundir con Stripe usado para facturación SaaS de Studio Flow.
- Facebook / Instagram: futura integración de Meta para captación, mensajes y automatizaciones.

Estas opciones se muestran como **Próximamente** y no deben aparentar estar activas.

## Pagos

Se descarta el módulo de configuración **Pagos V2**. Métodos manuales como efectivo, transferencia o tarjeta no justifican una pantalla independiente de configuración. El registro del método seguirá ocurriendo dentro del flujo comercial cuando corresponda.

El branch `feat/sf-v2-payments` no forma parte de esta arquitectura y no debe promocionarse.

## Seguridad

La UI puede consultar estado básico de proveedores, nunca secretos. Para Meta/WhatsApp se habilitó lectura autenticada de `notification_studio_channel_providers` protegida por la capacidad `integrations.read`. Tokens, secretos y credenciales permanecen fuera de la UI.

## Producción

No promover ningún cambio de este bloque hasta autorización explícita del usuario.
