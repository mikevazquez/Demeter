# S12 · Preparación de producción · 2026-10-11

Estado: **preparación técnica realizada; bloqueado por Stripe Live, backup y aceptación funcional**. S13 no autorizado. No se aplicaron migraciones ni se desplegaron funciones SaaS en producción.

## Baseline observado

- GitHub `main`: `20fece92e991efeb9b1b15b27b4a0c59d5cbc7ec` (corrección vigente de Messenger). Usar este baseline actual para rollback de aplicación; las referencias antiguas del MVP no sustituyen este punto.
- Proyecto productivo: `qfhojvgvhrbautvczffq`, aplicación `https://demeterbueno.vercel.app`.
- Última migración productiva observada: `20261011011000_demi_rejected_payment_followup`.
- Demeter `demeter-fitness`: plan `all_access`, active, proveedor de billing null. Debe conservarse como plan interno; no crearle una suscripción comercial Stripe por migración.
- Producción tiene `platform_admins`, `saas_plans` y `studio_plan_assignments` con RLS. No tiene `saas_plan_prices`, `studio_plan_assignment_events`, Checkout attempts ni ledger de webhook restaurados.
- La lista de Edge Functions productivas no contiene `provision-studio`, `saas-stripe-checkout`, `saas-stripe-portal` ni `saas-stripe-webhook`.
- La conexión Stripe disponible sólo expone `acct_1TwhQF6zvrymwOJv`, `livemode=false`. No hay evidencia de una cuenta Live accesible en esta sesión.
- El conector no ofrece inventario de backups ni gestión de secretos de Edge Functions. No se presume un backup existente ni credenciales productivas configuradas.

## Paquete concreto

Aplicar únicamente estas cinco migraciones, en este orden, después de cerrar los gates:

1. `20261011192941_saas_restore_platform_and_billing_dependencies.sql`.
2. `20261011193659_saas_owner_usage_visibility.sql`.
3. `20261011194902_saas_plan_dependency_catalog.sql`.
4. `20261012034141_saas_recurring_template_resource_compatibility.sql`.
5. `20261012034759_saas_activity_package_discipline_bridge.sql`.

No reaplicar los archivos archivados en `recovered-migrations/`. No ejecutar fixtures o scripts UAT sobre producción. Los IDs Stripe Sandbox de las evidencias tampoco forman parte de las migraciones.

Se reejecutó el conjunto de cinco migraciones en una sola transacción de Sandbox, se verificó que la huella de todas las asignaciones de plan existentes permaneciera igual y se hizo rollback. Esto comprueba sintaxis, dependencias presentes e idempotencia en Sandbox; no demuestra una instalación desde cero sobre una copia exacta de producción. Esa limitación debe cerrarse con un entorno aislado que reproduzca el esquema productivo, o una revisión del paquete contra dicho esquema antes de la autorización final.

Fuentes Edge a desplegar como un conjunto coherente, incluyendo `_shared/stripe-billing.ts`:

| Función              | JWT   | Autorización                                                                     |
| -------------------- | ----- | -------------------------------------------------------------------------------- |
| provision-studio     | true  | Usuario autenticado y platform admin; propietario existente conserva contraseña. |
| saas-stripe-checkout | true  | Owner validado del estudio, plan vendible, precio y origen permitidos.           |
| saas-stripe-portal   | true  | Owner validado y customer del estudio.                                           |
| saas-stripe-webhook  | false | Firma Stripe obligatoria; ledger y estados aplicados del proveedor.              |

Snapshot Sandbox observado: provision-studio v10, Checkout v17, portal v9, webhook v9. Versiones aumentan al guardar secretos; la identidad del código debe comprobarse por contenido/hash, no sólo por número de versión.

## Gates pendientes antes de publicar

Validación local final: suite candidata 190 archivos / 1262 pruebas aprobadas; comparación completa contra `20fece92…` con cero fallos en base/candidato, cero pruebas perdidas y un rename explícito. Compilación `npm run build -- --webpack` aprobada. El CI previo había fallado únicamente por ese rename no registrado; su corrección conserva el test y las reglas del ratchet. CI remoto de `68c223aad655a252a8c6929fd4b6f16918dbee3b` confirmado success: run `38207857195` (CI #3173). Cambios posteriores requieren verificar su SHA antes de promover.

1. Mike revisa funcionalmente S01–S11 en el Preview del PR #270 y acepta el recorrido. La evidencia técnica no se marca como aprobación de producto.
2. Verificar un backup/restorable point real de Supabase producción y su procedimiento de restauración, con hora/ref registradas antes de cambiar esquema o datos. Si no existe, generar un dump lógico verificable por un canal con credenciales adecuadas; el conector SQL no sustituye un backup completo.
3. Conectar la cuenta Stripe Live correcta y confirmar `livemode=true`. Verificar negocio/cuenta, productos Core/Growth/Pro y precios mensuales de $899/$1,399/$1,999 MXN. No inventar precios anuales ni ofrecer All Access. No crear suscripciones ni cobrar para «verificar» la conexión.
4. Configurar secretos exclusivamente en producción: `STRIPE_SECRET_KEY` de Live (preferiblemente restricted con permisos necesarios), `STRIPE_WEBHOOK_SIGNING_SECRET` de su endpoint productivo y `SAAS_BILLING_RETURN_ORIGINS=https://demeterbueno.vercel.app`. Nunca usar el secreto `whsec_` como clave API ni una URL en `STRIPE_SECRET_KEY`.
5. Crear/verificar el destino Live hacia `https://qfhojvgvhrbautvczffq.supabase.co/functions/v1/saas-stripe-webhook`, API snapshot `2026-08-26.dahlia`, con eventos Checkout/subscription/invoice usados por la función. Verificar que no haya dos destinos entregando el mismo conjunto por accidente.
6. Verificar portal Live: facturas, método de pago y cancelación al final del periodo. Cambio de plan sólo si se configura explícitamente su catálogo comercial.
7. Definir/verificar tratamiento fiscal, registros aplicables y política de conversión de moneda. Sandbox ofreció Adaptive Pricing por geolocalización; no se debe asumir que los importes Live siempre se mostrarán/cobrarán en MXN sin revisar esa configuración. No activar `automatic_tax` sin registros vigentes.
8. Mapear los Prices Live verificados en `saas_plan_prices` de producción, nunca copiar los IDs `price_1UK…` de Sandbox. Releer importe, intervalo, moneda, entorno y producto antes de habilitar contratación.
9. Confirmar GitHub CI y Vercel del commit final, variables de Production hacia `qfhojvgvhrbautvczffq` y Preview hacia `hedouonyhynuvwbckdlg`. Revalidar que `main` sigue en el baseline observado o actualizar la comparación si hubo cambios.
10. Preparar el orden operativo DB → Edge → configuración/Prices → aplicación y pedir autorización de promoción para el paquete final identificado por SHA. S13 permanece separado.

## Verificación posterior prevista

Ejecutar `release-preflight.sql` en modo lectura antes y después. Confirmar RLS, ACL y controles de funciones; Demeter active/All Access y sin Stripe comercial; rutas Admin/Student, agenda existente, reservas y productos actuales; selección multistudio y alta de un piloto autorizado. No crear datos ficticios ni cargos en producción para reemplazar la UAT de Sandbox.

Para el piloto, la contratación real requiere autorización específica del propietario; se verifica Checkout/portal/webhook con los objetos de su operación. No ejecutar pagos reales automáticos como smoke.

## Reversión

Antes de promover, guardar un snapshot verificable de esquema, funciones, políticas, catálogo y asignaciones, más el backup de datos. Conservar también las versiones Edge previas y su configuración sin registrar valores secretos en Git.

Ante una regresión de aplicación, volver al deployment asociado a `20fece92…` y validar Admin/Student/Agenda. Deshabilitar contratación/alta SaaS nueva y detener la promoción. El rollback de aplicación no revierte funciones SQL, ACL, mappings o secretos.

Si existen eventos o suscripciones Live nuevas, preservar ledger y auditoría. No borrar tablas, Prices ni suscripciones para «deshacer» la migración. Coordinar la suspensión de nuevas contrataciones y el tratamiento de eventos; restaurar DB únicamente con el punto anterior comprobado y una conciliación que evite perder eventos posteriores. Repetir smoke y comprobar las asignaciones y registros de Demeter antes de reabrir.

No se adjunta una reversión destructiva automática: no hay backup verificado ni prueba de restauración completa, y eliminar billing/auditoría produciría pérdida de información. Este documento prepara una operación revisable; no habilita su ejecución.

## Seguimiento de gates · 2026-10-12 UTC

- Compras Sandbox de Growth y Pro y sus portales comprobados; evidencia ampliada en S08.
- Se confirmó con el usuario usar la misma organización Supabase para cotizar una rama aislada. La conexión devuelve `UNAVAILABLE` para `get_cost` (“MCP tool get_cost was not returned by tools/list”). No existe cotización válida, confirmación de costo ni rama temporal creada. `list_branches` de producción sólo muestra main/default, que no debe usarse como fixture. El ensayo desde el esquema productivo sigue pendiente.
- Se entregó al usuario el enlace de Stripe para agregar acceso Live conservando Sandbox. Pendiente confirmación del usuario y verificación de `livemode=true`; no se realizaron escrituras Live.
- Backup/restauración real y aceptación funcional siguen sin evidencia. El CI verde y las compras Sandbox no cierran esos gates.
