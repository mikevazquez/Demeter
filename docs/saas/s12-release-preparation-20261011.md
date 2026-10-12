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

## Cuenta Live y ausencia de backup confirmadas

La autorización actual expone Demeter Fitness `acct_1TwcF07pc7DxswTf`, `livemode=true`, junto al Sandbox existente. Revisión exclusivamente de lectura: Prices, configuraciones de portal, endpoints de webhook y registros fiscales devuelven listas vacías (`has_more=false`). Tax Settings tiene `status=pending`, `head_office=null` y falta `head_office`. La conexión Live está verificada; su configuración comercial/operativa sigue pendiente. Se preguntó al usuario política de moneda y tratamiento de IVA antes de crear el catálogo. No se crearon objetos Live ni cargos.

El usuario confirmó que Supabase muestra «Free Plan does not include project backups». No hay backup gestionado disponible según esa pantalla. La sesión sólo tiene credenciales públicas de Sandbox, no conexión Postgres productiva, por lo que no puede exportarse desde aquí.

Se preparó `scripts/saas-production-backup.sh`, con CLI Supabase 2.120.0, a partir de la [guía oficial de backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Requiere computadora de confianza con Bash, Python 3, Node/npm y Docker. Ejecutar `bash scripts/saas-production-backup.sh`; introducir la URL Session Pooler productiva por entrada oculta, nunca en chat/Git. La validación rechaza otros proyectos y el pooler transaccional. No resetear la contraseña vigente sólo para ejecutar el script: cualquier cambio de contraseña requiere evaluar conexiones existentes.

Exporta roles, esquema, datos y migration history en carpeta privada, con manifest de tamaños/hashes y `restore_verified=false`. Los logs son privados porque la CLI podría incluir información de conexión. El script no restaura ni cambia producción; sintaxis Bash verificada, ejecución con credencial real pendiente. La carpeta generada está excluida de Git en la raíz del repositorio; no adjuntar dumps al PR. Guardar una copia protegida fuera de la computadora de trabajo.

Este export no es todavía un backup completo verificado. Capturar también personalizaciones de Auth/Storage, archivos binarios de Storage, configuración/Edge y, si hay datos cifrados con Vault, el material requerido por la guía mediante canal seguro. Las exportaciones separadas no comparten un único snapshot: acordar una ventana sin escrituras si se requiere consistencia entre esquema, datos e historial. Restaurar en un destino aislado compatible, verificar integridad/usuarios/ACL/All Access y comparar esquema con producción antes de ensayar las cinco migraciones. No restaurar sobre producción para comprobarlo.

## Preparación Live autorizada y política comercial

El usuario confirmó: cobro siempre en MXN, IVA incluido en los importes publicados y respaldo con CLI en computadora sin subir de plan. Se crearon únicamente productos/Prices y configuración de portal en la cuenta Live confirmada; no suscripciones, sesiones de pago ni cargos Live. La aplicación y base de datos productivas aún no se modificaron.

| Plan   | Producto Live         | Price Live                       | Importe mensual |
| ------ | --------------------- | -------------------------------- | --------------- |
| Core   | `prod_VQSwPc6Hvd0njB` | `price_1UPc0p7pc7DxswTfuC75I0d9` | 89900 MXN       |
| Growth | `prod_VQSwdFuVmvXnAL` | `price_1UPc0x7pc7DxswTfakgBvEFP` | 139900 MXN      |
| Pro    | `prod_VQSwgphcakcjRN` | `price_1UPc0y7pc7DxswTfEoWHSabh` | 199900 MXN      |

Relectura de Prices: los tres activos, `livemode=true`, `currency=mxn`, `interval=month`, `interval_count=1`, `tax_behavior=inclusive` y producto correcto. No catálogo anual ni All Access comercial. Los IDs se guardan como evidencia; aún no están mapeados en la DB productiva.

Portal Live `bpc_1UPc1A7pc7DxswTf0QgPm9gq`, activo y default, retorno `https://demeterbueno.vercel.app/admin/suscripcion`: invoice history y actualización de tarjeta habilitadas, cancelación `at_period_end`, cambios de plan deshabilitados. Verificación de configuración, no recorrido de un cliente Live.

`tax_behavior=inclusive` declara el precio con impuestos incluidos; por sí solo no configura cálculo/desglose fiscal, registros ni emisión CFDI. Stripe Tax automático permanece sin activar y la configuración fiscal pendiente no se presume resuelta.

Se cambió Checkout para enviar `adaptive_pricing.enabled=false` independientemente del ajuste de Dashboard. Desplegado exclusivamente en Sandbox como Checkout v18, hash `b76bb2c5b55d1e5f494aa390365920befb8a0542a8bb9ae2f5fffabab3414743`, JWT requerido. UI real en fixture MXN `3e8219b8-4634-4a6a-afba-601a1a742142` abrió Checkout Sandbox mostrando MX$899, sin selector USD/MXN. Relectura de `cs_test_a13s9JchduBUaJL0cJcjV4eGDrBOCsMJ7f5zTkhQTAK8sABHxHcZn15rs5` confirma `adaptive_pricing.enabled=false`, `currency=mxn`, `amount_total=89900`, open/unpaid. No se pagó esta sesión de comprobación ni se alteraron las suscripciones UAT anteriores. Dieciséis pruebas Auth/allowlist siguen pasando.

El webhook Live se creará/configurará cuando el destino productivo y su firma estén listos dentro del paquete autorizado; no apuntar eventos a una función inexistente. Backups/restauración, ensayo sobre esquema productivo, aceptación funcional y autorización final siguen pendientes.

## Preparación restante y aceptación · 2026-10-11 (America/Mexico_City)

Mike autorizó posponer el respaldo hasta disponer de su Mac y continuar con la preparación restante. Tras revisar planes Core/Growth/Pro, portales Sandbox y evidencia del recorrido integral del PR, confirmó «Funciona como espero». Aceptación funcional registrada; no es autorización de publicación ni prueba de restauración.

Código `a6f2a1371ce1348c008202ada2637456383f281d`: CI #3175, run `38209445488`, success. Vercel `dpl_5cUpqHWEi8PrenMy4hH7iSWeCp74` READY sobre ese mismo SHA. Main permanece `20fece92e991efeb9b1b15b27b4a0c59d5cbc7ec`.

`release-manifest.json` fija proyecto/cuenta, orden de las cinco migraciones, funciones/JWT, nombres de secretos, política comercial, portal y los once eventos esperados en el webhook snapshot. Incluye SHA-256 de los archivos desplegables y del mapeo. Su `source_code_sha` identifica el código comprobado, aunque un commit posterior añada solamente documentación/archivos operativos. Nunca contiene valores secretos.

`release-live-price-mapping.sql` configura los tres Prices Live en una transacción, después de las migraciones y de releer los objetos Stripe. Rechaza catálogo incompleto, pérdida del baseline All Access, colisión con un precio activo diferente e inconsistencias de un mapping existente; conserva una huella de todas las asignaciones y verifica que no cambien. No añade catálogo anual ni All Access comercial.

Validación del SQL únicamente en transacciones revertidas de Sandbox: inserción correcta, segunda ejecución idempotente dentro de la misma transacción y rechazo de colisión de precio activo. Los precios Sandbox se desactivaron sólo dentro de la transacción aislada del ensayo positivo y quedaron restaurados al hacer rollback. Relectura posterior: las tres referencias Sandbox originales siguen activas y hay cero mappings Live persistidos. Esto comprueba el archivo operativo sobre el esquema Sandbox; el ensayo de las cinco migraciones desde el esquema productivo sigue pendiente junto al respaldo.

El bloqueo diferido queda agrupado como **respaldo → restauración verificada → ensayo del esquema productivo**. Las escrituras productivas restantes (migraciones, Edge, secretos, mappings, destino webhook y aplicación) son pasos del paquete de publicación, no tareas ya ejecutadas. Después de cerrar ese bloqueo, verificar el SHA final y pedir autorización final del paquete concreto. No hubo nuevos cambios Stripe Live ni cambios a DB/app productivas en esta preparación.

Se releyeron únicamente las URLs públicas de Supabase configuradas en Vercel: Production → `https://qfhojvgvhrbautvczffq.supabase.co`; Preview general → `https://hedouonyhynuvwbckdlg.supabase.co`. No hay override de URL específico para `feat/saas-reconciliation`; las otras ramas con override no forman parte de esta promoción. No se modificaron variables ni se leyeron claves secretas para esta verificación.

## Actualización vigente · 12 de octubre de 2026

La organización Demeter ya está en Pro. Backup físico COMPLETED `2026-10-12T05:10:44Z` restaurado y ensayado en el proyecto independiente `uweqtwmgpsftnntyzpbh`; evidencias en `s12-restoration-rehearsal-20261012.md`. El gate DB diferido al Mac queda cerrado para este alcance. Storage, Edge y secretos no forman parte de ese clone.

Main avanzó por PR #271 a `7f6c4634d2e64c050ba2d652d42623f1d6ddc71a`, actual baseline de aplicación/reversión. Producción añadió `20261012134855_demi_temporary_information` después del backup. Se reprodujo esa migración sólo en la copia, se incorporó main sin conflictos y el paquete Studio Flow volvió a pasar con rollback conservando Demi y la asignación All Access. Confirmar el SHA integrado y releer el backup más reciente antes de la publicación. Autorización final pendiente; no se cambiaron DB/app productivas desde este trabajo.
