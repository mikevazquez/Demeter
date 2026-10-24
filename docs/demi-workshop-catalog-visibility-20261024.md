# Demi · Taller existente omitido por visibilidad de clases regulares

## Incidente y alcance

Reporte de Mike: Demi responde que no hay talleres en WhatsApp.
Lectura productiva del 24 de octubre de 2026: la ejecución de
`get_workshop_options` a las 05:22:57 UTC devuelve ambas listas vacías.
El nuevo catálogo sí contiene «Aparatos aéreos», creado el 23 de octubre
23:23 UTC, con cinco fechas programadas de noviembre, todas futuras y con
`assistant_visible=false`. Demi de Talleres está habilitado para Demeter.
El programa anterior está inactivo y sus fechas canceladas; no debe reactivarse.
Despliegue consultado: main `9a5bbcbc4584480b5440901ac985a177a877e3ef`, READY.

## Causa y corrección

`admin_save_workshop` crea deliberadamente fechas dedicadas con plantillas
inactivas y `assistant_visible=false` para separarlas de ventas ordinarias.
`service_demi_workshop_catalog` y el alta de invitadas exigen ese mismo flag
verdadero. Por eso el taller creado desde el editor desaparece del catálogo
y tampoco admite una participante nueva por Demi.

La migración `20261024052608_demi_workshop_dedicated_catalog_visibility.sql`
reemplaza sólo las dos funciones, eliminando tres condiciones sobre el flag.
Conserva pertenencia explícita al taller/estudio, fechas futuras, estado
programado, configuración de Demi, permisos e identidad. No modifica filas,
precios, capacidad, reservas, pagos, visibilidad de clases ni programas legacy.
La función de alta conserva ACL exclusiva de servicio; el catálogo conserva
su ACL al usar CREATE OR REPLACE. Se mantiene search_path vacío.

DoD: reproducir con el editor real en PostgreSQL aislado, listar precios y fechas,
conservar ocultación en clases regulares, excluir canceladas/pasadas/otro estudio,
respetar flag deshabilitado y permisos; alta nueva con fechas ocultas y checkout
sin derechos regulares ni confirmación de pago antes de revisión.

## Validación y entrega

Regresión antes de corregir: falla con «The workshop editor’s real dates must
appear in Demi’s workshop catalog» usando `admin_save_workshop` real.
Después de aplicar dos veces la migración en PostgreSQL 17 aislado:
**79/79 escenarios aprobados**, incluyendo permisos, fechas pasadas/canceladas,
catálogo del editor y alta nueva con fechas ocultas seguida de checkout revisado.
**33/33 Vitest** de herramientas de Talleres/programas aprobados. TypeScript,
formato focalizado y diff-check aprobados. ESLint focalizado sin errores;
una advertencia preexistente de variable sin uso en el runner.
CI/Preview remotos y candidata exacta: consultar el PR de esta corrección.
No se ejecutan conversaciones, OCR, mensajes ni dinero contra personas reales.
La prueba SQL integra funciones reales con contratos externos reducidos;
no acredita por sí sola respuesta generada ni entrega WhatsApp.

Producción sólo se inspeccionó en lectura. La promoción exige autorización
explícita para esta candidata. No requiere reactivar el programa anterior ni
recargar el taller. Validar después el RPC con una conversación existente y
cinco fechas; verificar respuesta WhatsApp con Mike sin mensajes de prueba
iniciados por el agente.

Rollback: restaurar las dos funciones desde las migraciones
`20261019042239_demi_workshop_purchase_flow.sql` y
`20261023140144_demi_workshop_guest_registration.sql`, conservando sus ACL.
No borrar historial ni cambiar assistant_visible. Restaurarlas recupera también
la omisión conocida del catálogo; no es una solución funcional permanente.
