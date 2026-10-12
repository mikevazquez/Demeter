# Matriz de seguimiento SaaS

Actualizada: 2026-10-11. Responsable técnico: Codex; decisiones y aceptación funcional: Mike.

Estados: pendiente, en curso, bloqueado, verificado técnicamente en Sandbox, aprobado por Mike, verificado en producción. Las pruebas técnicas no sustituyen la aceptación funcional.

| ID  | Frente                     | Estado                             | Pendiente / criterio de cierre                                     | Evidencia                                                                                                                                                               |
| --- | -------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Recuperación e integración | Verificado técnicamente en Sandbox | Revisión funcional y aprobación de Mike.                           | 29 migraciones archivadas, tres restauraciones aplicadas; componentes y funciones recuperados.                                                                          |
| S02 | Alta de estudios           | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Alta desde navegador; propietario reutilizado sin restablecer contraseña; URL duplicada rechazada.                                                                      |
| S03 | Activación                 | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Activación completa desde navegador; enlace inválido y reutilizado rechazados.                                                                                          |
| S04 | Separación entre estudios  | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Lecturas y RPC ajenas rechazadas; alta de alumna respeta estudio seleccionado en cuenta con varios estudios.                                                            |
| S05 | Configuración por estudio  | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Identidad, región y políticas guardadas; configuración ajena rechazada; portal público refleja cambios.                                                                 |
| S06 | Planes y módulos           | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Core/Growth/Pro comprobados; Core bloquea integraciones e inteligencia sin cerrar sesión; All Access interno.                                                           |
| S07 | Límites y consumo          | Verificado técnicamente en Sandbox | Aceptación funcional.                                              | Core admite 100 y rechaza 101 alumnas; segunda sede rechazada; límites Growth/Pro y uso verificados.                                                                    |
| S08 | Contratación Stripe        | Verificado técnicamente en Sandbox | Aceptación funcional de Mike.                                      | Core contratado desde UI con tarjeta de prueba; Checkout paid, tres webhooks completed, asignación activa. Ver `s08-stripe-validation-20261011.md`.                     |
| S09 | Ciclo de suscripción       | Verificado técnicamente en Sandbox | Aceptación funcional de Mike.                                      | Renovación, rechazo, recuperación, cancelación y duplicado firmado; 15 eventos completed sin error. Ver `s09-stripe-lifecycle-20261011.md`.                             |
| S10 | Pantalla de suscripción    | Verificado técnicamente en Sandbox | Aceptación funcional de Mike.                                      | Precios, Checkout, retorno confirmado, periodos y portal con factura Paid verificados desde navegador.                                                                  |
| S11 | Recorrido integral         | Verificado técnicamente en Sandbox | Aceptación funcional de Mike.                                      | Actividad → paquete → alta/venta → reserva → cancelación desde UI, cupo y créditos comprobados; dos incompatibilidades corregidas. Ver `s11-integral-flow-20261011.md`. |
| S12 | Preparación producción     | Bloqueado                          | Stripe Live, backup/restauración y aceptación funcional.           | Paquete de 5 migraciones ensayado con rollback; plan de promoción/reversión en `s12-release-preparation-20261011.md`.                                                   |
| S13 | Publicación y verificación | Pendiente                          | Publicar después de aprobación S01–S12 y verificar Demeter/piloto. | Sin publicación SaaS a producción.                                                                                                                                      |

## Bloqueos externos

- Bloqueos de Stripe Sandbox resueltos. S08, S09 y S10 verificados técnicamente; evidencias en `s08-stripe-validation-20261011.md` y `s09-stripe-lifecycle-20261011.md`. Aceptación funcional pendiente de Mike.
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
