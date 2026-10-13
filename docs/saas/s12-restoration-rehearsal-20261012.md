# S12 · Restauración y ensayo aislado · 12 de octubre de 2026

Se verificó la copia restaurada `uweqtwmgpsftnntyzpbh` (nombre `restore-ust`), organización Demeter Pro, región us-east-1, estado ACTIVE_HEALTHY. El usuario creó el proyecto tras revisar la cotización adicional de $9.68 USD/mes de compute y $0 de disco. No se restauró ni migró la base productiva para este ensayo.

## Respaldo y alcance

Capturas del Dashboard acreditan backup PHYSICAL COMPLETED de Studio Flow, `2026-10-12T05:10:44Z` (11 de octubre, 23:10:44 America/Mexico_City). Proyecto fuente `qfhojvgvhrbautvczffq`; copia creada `2026-10-12T13:43:06.343836Z`. La copia usa PostgreSQL 17.11.0.003; fuente observada anteriormente 17.6.1.166.

El clone recuperó un estudio, 58 usuarios Auth y 651 reservas. Demeter mantiene plan interno All Access, active y billing_provider null. La última migración del backup era `20261011011000`. La disponibilidad del backup se acreditó en Dashboard y su restauración a DB independiente se verificó mediante consultas y pruebas SQL. No es una prueba de restauración completa de Storage, Edge, secretos o configuración del proyecto, que la función Restore to new project no copia. No se hicieron pagos ni envíos externos desde la copia.

## Aislamiento

Se intentó desactivar Cron con UPDATE directo, que fue rechazado por ACL del catálogo. Se utilizó después `cron.alter_job(jobid,active=>false)` para jobs activos visibles; verificación: cero activos visibles. Cola `net.http_request_queue`: cero. No se copiaron claves Stripe ni se desplegaron Edge Functions en la copia. No se conectó Vercel a este proyecto.

## Cinco migraciones de Studio Flow

Aplicadas en el orden del manifiesto. El conector genera su propio timestamp de historial: la cuarta llamada inicial chocó con el timestamp de la tercera y falló; su reintento registró éxito. No hubo cambio en el contenido de los cinco archivos.

1. saas_restore_platform_and_billing_dependencies — 20261012134915.
2. saas_owner_usage_visibility — 20261012134916.
3. saas_plan_dependency_catalog — 20261012134918.
4. saas_recurring_template_resource_compatibility — 20261012134934.
5. saas_activity_package_discipline_bridge — aplicada con éxito después de la cuarta.

Verificaciones:

- Cuatro tablas de billing presentes y cuatro con RLS.
- Funciones service_provision_studio_v3/service_apply_stripe_subscription_state sin EXECUTE para anon/authenticated.
- Usuarios 58, reservas 651 y estudios 1 después de las migraciones.
- Huella de asignaciones sobre campos originales: `0c9a3d8977ebdb5226ee2a42caaf3361`, igual antes/después. La huella de la fila completa cambia por las seis columnas nuevas; se excluyeron sólo esas seis para la comparación.
- Regresión S11 ejecutada en transacción sobre el propietario restaurado de Demeter: actividad enlazada a disciplina, edición conserva enlace, sesión recurrente única/defaults correctos, repetición sin duplicados y nonmember forbidden. Rollback al terminar.
- release-live-price-mapping.sql ejecutado con rollback: tres precios mensuales Live correctos, All Access conservado y huella de asignaciones intacta. Cero precios persistidos al terminar.

## Actualización del baseline productivo

Durante el ensayo se detectó que main avanzó a `7f6c4634d2e64c050ba2d652d42623f1d6ddc71a` por PR #271 (Demi temporal). Producción registra `20261012134855_demi_temporary_information`, posterior al backup. Se recuperó el SQL de esa migración en lectura y se aplicó exclusivamente a la copia para representar el esquema actual. No se copió contenido nuevo de Demi ni se modificó producción.

Se incorporó origin/main al candidato sin conflictos, commit de integración `44eddd04524d1a2104e92d67564a64a20025e9be`. Se reejecutaron las cinco migraciones en una transacción sobre la copia con Demi ya presente, comprobando tabla Demi y huella de asignación; rollback y éxito. La nueva migración Demi afecta una tabla/políticas propias; el paquete Studio Flow no la sustituye. El backup sigue siendo anterior a esa publicación: registrar el backup más reciente disponible antes de promover para el punto de reversión final.

## Cierre y publicación

El gate de disponibilidad de backup, restauración DB aislada y ensayo de migraciones queda comprobado para el alcance de DB. El backup gestionado sustituye la necesidad inmediata del script CLI diferido. Mantener copias de Storage/configuración cuando una operación afecte esos componentes.

La aceptación funcional previa de Mike permanece registrada. Se deben confirmar CI y Preview del candidato integrado, conservar la funcionalidad vigente de Demi y obtener autorización final del SHA antes de aplicar DB/Edge/secretos/mappings/webhook/aplicación a producción. El nuevo baseline de rollback de aplicación es el deployment de main `7f6c463…`, no `20fece92…`. El proyecto de ensayo sigue activo y facturable; su pausa/eliminación se decidirá tras conservar evidencia y cerrar la publicación.
