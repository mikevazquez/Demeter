# Matriz de seguimiento SaaS

Actualizada: 2026-10-12. Responsable técnico: Codex; decisiones y aceptación funcional: Mike.

Estados: pendiente, en curso, bloqueado, verificado técnicamente en Sandbox, aprobado por Mike, verificado en producción. Las pruebas técnicas no sustituyen la aceptación funcional.

| ID  | Frente                     | Estado                  | Pendiente / criterio de cierre                                     | Evidencia                                                                                                                                                               |
| --- | -------------------------- | ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Recuperación e integración | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | 29 migraciones archivadas, tres restauraciones aplicadas; componentes y funciones recuperados.                                                                          |
| S02 | Alta de estudios           | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Alta desde navegador; propietario reutilizado sin restablecer contraseña; URL duplicada rechazada.                                                                      |
| S03 | Activación                 | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Activación completa desde navegador; enlace inválido y reutilizado rechazados.                                                                                          |
| S04 | Separación entre estudios  | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Lecturas y RPC ajenas rechazadas; alta de alumna respeta estudio seleccionado en cuenta con varios estudios.                                                            |
| S05 | Configuración por estudio  | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Identidad, región y políticas guardadas; configuración ajena rechazada; portal público refleja cambios.                                                                 |
| S06 | Planes y módulos           | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Core/Growth/Pro comprobados; Core bloquea integraciones e inteligencia sin cerrar sesión; All Access interno.                                                           |
| S07 | Límites y consumo          | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Core admite 100 y rechaza 101 alumnas; segunda sede rechazada; límites Growth/Pro y uso verificados.                                                                    |
| S08 | Contratación Stripe        | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Core/Growth/Pro contratados desde UI con tarjeta de prueba; Checkout paid, asignaciones y portales verificados. Ver `s08-stripe-validation-20261011.md`.                |
| S09 | Ciclo de suscripción       | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Renovación, rechazo, recuperación, cancelación y duplicado firmado; 15 eventos completed sin error. Ver `s09-stripe-lifecycle-20261011.md`.                             |
| S10 | Pantalla de suscripción    | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Precios, Checkout, retorno confirmado, periodos y portal con factura Paid verificados desde navegador.                                                                  |
| S11 | Recorrido integral         | Aprobado por Mike       | Aceptación registrada del recorrido presentado.                    | Actividad → paquete → alta/venta → reserva → cancelación desde UI, cupo y créditos comprobados; dos incompatibilidades corregidas. Ver `s11-integral-flow-20261011.md`. |
| S12 | Preparación producción     | Verificado técnicamente | Checks del candidato integrado y autorización final.               | Paquete de 5 migraciones ensayado con rollback; plan de promoción/reversión en `s12-release-preparation-20261011.md`.                                                   |
| S13 | Publicación y verificación | Pendiente               | Publicar después de aprobación S01–S12 y verificar Demeter/piloto. | Sin publicación SaaS a producción.                                                                                                                                      |

## Bloqueos externos

- Bloqueos de Stripe Sandbox resueltos. S08, S09 y S10 verificados técnicamente; evidencias en `s08-stripe-validation-20261011.md` y `s09-stripe-lifecycle-20261011.md`. Mike confirmó «Funciona como espero» tras revisar planes, portales y evidencia del recorrido integral.
- Cuenta Live, precios y portal preparados; mapeo, webhook y secretos se ejecutarán dentro de la publicación después del respaldo. Ningún valor secreto se guarda en el repositorio.

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

## Cierre de preparación sin respaldo · 2026-10-11 (America/Mexico_City)

Mike pidió diferir el respaldo hasta tener acceso a su Mac y avanzar con la preparación restante. Después del guion del Preview, confirmó «Funciona como espero». S01–S11 registran aceptación del recorrido y la evidencia presentada; no se afirma que haya repetido personalmente cada prueba técnica.

Código `a6f2a1371ce1348c008202ada2637456383f281d`: CI #3175/run 38209445488 success y Vercel READY sobre el mismo SHA. Paquete técnico identificado en `release-manifest.json` y configuración Live en `release-live-price-mapping.sql`, ambos preparados para revisión y sin ejecución en producción.

Bloqueo diferido: generar respaldo, verificar restauración y ensayar las migraciones sobre el esquema productivo aislado. Los pasos de despliegue y configuración Live quedan programados después de ese bloqueo; la autorización final de publicación sigue separada de la aceptación funcional.

## Restauración comprobada · 2026-10-12

Demeter Pro confirmado. Backup físico COMPLETED `2026-10-12T05:10:44Z` restaurado a `uweqtwmgpsftnntyzpbh` (restore-ust); cinco migraciones, controles RLS/ACL, preservación All Access, regresión S11 y mapping Live con rollback comprobados. Ver `s12-restoration-rehearsal-20261012.md`.

Main avanzó por Demi temporal a `7f6c463…`; se integró sin conflictos y su migración actual se reprodujo en la copia. La preparación pendiente del Mac queda sustituida para el gate DB por esta restauración gestionada. La publicación requiere checks del SHA integrado y autorización final; aún no se aplicó el paquete SaaS a producción.
