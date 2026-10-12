# Matriz de seguimiento SaaS

Actualizada: 2026-10-11. Responsable técnico: Codex; decisiones y aceptación funcional: Mike.

Estados: pendiente, en curso, bloqueado, verificado técnicamente en Sandbox, aprobado por Mike, verificado en producción. Las pruebas técnicas no sustituyen la aceptación funcional.

| ID  | Frente                     | Estado                             | Pendiente / criterio de cierre                                          | Evidencia                                                                                                     |
| --- | -------------------------- | ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| S01 | Recuperación e integración | Verificado técnicamente en Sandbox | Revisión funcional y aprobación de Mike.                                | 29 migraciones archivadas, tres restauraciones aplicadas; componentes y funciones recuperados.                |
| S02 | Alta de estudios           | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Alta desde navegador; propietario reutilizado sin restablecer contraseña; URL duplicada rechazada.            |
| S03 | Activación                 | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Activación completa desde navegador; enlace inválido y reutilizado rechazados.                                |
| S04 | Separación entre estudios  | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Lecturas y RPC ajenas rechazadas; alta de alumna respeta estudio seleccionado en cuenta con varios estudios.  |
| S05 | Configuración por estudio  | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Identidad, región y políticas guardadas; configuración ajena rechazada; portal público refleja cambios.       |
| S06 | Planes y módulos           | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Core/Growth/Pro comprobados; Core bloquea integraciones e inteligencia sin cerrar sesión; All Access interno. |
| S07 | Límites y consumo          | Verificado técnicamente en Sandbox | Aceptación funcional.                                                   | Core admite 100 y rechaza 101 alumnas; segunda sede rechazada; límites Growth/Pro y uso verificados.          |
| S08 | Contratación Stripe        | Bloqueado                          | Corregir `STRIPE_SECRET_KEY` en Sandbox; completar Checkout desde UI.   | Origen y Auth pasan; Stripe rechaza clave API; detalle en `s08-stripe-validation-20261011.md`.                |
| S09 | Ciclo de suscripción       | En curso                           | Eventos reales Stripe, renovación y duplicados sobre la versión actual. | Pruebas transaccionales: activo, impago, gracia, evento antiguo, restricción, recuperación y cancelación.     |
| S10 | Pantalla de suscripción    | En curso                           | Contratación y portal de pagos después de S08.                          | Plan, consumo y restricciones visibles desde navegador; errores preservan sesión.                             |
| S11 | Recorrido integral         | En curso                           | Completar clases/reservas y facturación de extremo a extremo.           | Alta → activación → configuración verificados; estudios UAT independientes.                                   |
| S12 | Preparación producción     | Pendiente                          | Validar paquete de migraciones, funciones, Stripe Live y reversión.     | Cambios preparados en rama aislada; producción sin cambios SaaS de esta recuperación.                         |
| S13 | Publicación y verificación | Pendiente                          | Publicar después de aprobación S01–S12 y verificar Demeter/piloto.      | Sin publicación SaaS a producción.                                                                            |

## Bloqueos externos

- Stripe reconectado al Sandbox correcto. El origen ya está configurado y pasa validación tras normalizar una barra final. Stripe rechaza la clave `STRIPE_SECRET_KEY` cargada en las funciones de Sandbox; reemplazar por una clave API válida de `acct_1TwhQF6zvrymwOJv`. Las herramientas disponibles no gestionan ese secreto. Ver `s08-stripe-validation-20261011.md`.
- La configuración Stripe Live se verificará al preparar S12; ningún secreto se guardará en el repositorio.

## Registro de evidencia

- La cuenta administradora autenticada pudo consultar catálogo comercial, auditoría, suscripción y uso sin errores.
- La restauración corrigió incompatibilidades de esquema: la auditoría actual usa `created_at` y `metadata`.
- El alta UAT generó propietario nuevo, enlace de activación y membresía owner. Se verificó el enlace y se completó el cambio de contraseña.
- No se envían correos de activación durante la prueba; la función genera un enlace para su entrega posterior por el administrador.

## Verificación de esta recuperación

- Suite completa tras el ajuste multiestudio: 188 archivos, 1243 pruebas aprobadas; tres pruebas adicionales del cliente con contexto también aprobadas.
- Compilación de producción con Webpack aprobada; lint sin errores (advertencias existentes).
- El cliente administrativo envía `x-studio-id` solamente después de validar la membresía seleccionada. Las consultas de identidad y selección siguen sin contexto; se conserva la separación de sesiones entre alumno y administrador.
- Las pruebas SQL de límites y suscripción terminan con rollback; las cuentas/estudios UAT permanecen exclusivamente en Sandbox.
