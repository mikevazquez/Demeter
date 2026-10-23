# Catalogo C2: escenario de prueba disponible

## Regla de entrega UAT

Antes de pedir a Mike que valide un flujo, preparar y comprobar sus precondiciones en el entorno de prueba: acceso existente, datos sinteticos, estado de la entidad, niveles, historial necesario, enlace estable y ventana de disponibilidad. Un Preview READY sin escenario utilizable no basta. No alterar las reglas reales de disponibilidad ni restablecer credenciales para preparar pruebas.

## Escenario creado

- Entorno: Studio Flow Sandbox, proyecto `hedouonyhynuvwbckdlg`.
- Estudio: Demeter Fitness Studio, `9fe23cfa-fb47-4670-afeb-ed4a56433772`.
- Etiqueta de datos: `CAT-C2-UAT-20261020`.
- Clase: `[UAT] Pole - combos por nivel`.
- Sesion: `be91b6bf-495d-4607-b8c7-4e9ed24213d3`.
- Ventana sintetica: 20 de octubre, 15:35:38, a 22 de octubre de 2026, 15:40:38, America/Mexico_City.
- Estado persistido: `scheduled`; fase calculada: `live` dentro de esa ventana.
- No se modifico el reloj ni la condicion live de la aplicacion.
- Acceso: `/admin?date=2026-10-20#session-be91b6bf-495d-4607-b8c7-4e9ed24213d3` sobre el alias estable de la rama de Catalogo.

## Alumnas sinteticas

- Clara Principiante: `af69395e-4d41-4d77-9bd0-274bc7a5054e`, Principiante, 3 figuras previas.
- Ana Intermedio: `d2574ea2-d524-46a2-b859-c9e1bbac6f24`, Intermedio, 8 figuras previas.
- Berta Intermedio: `4c42da8e-216b-4177-b83c-1177e03a7311`, Intermedio, 8 figuras previas.
- Diana Avanzado: `4e11de53-3d39-4285-9c54-b31b74d9c848`, Avanzado, 14 figuras previas.

Ana y Berta comparten 7 figuras; Ana ademas conoce `hip-hold-ball` y Berta `flatline`. El generador debe usar la interseccion de lo conocido, no asumir que ambas tienen todo el historial de la otra.

## Evidencia comprobada

Verificado mediante consultas y pruebas transaccionales en Sandbox el 20 de octubre de 2026, alrededor de las 21:43 UTC:

- La clase esta live, con 4 reservas y 3 grupos: 1 Principiante, 2 Intermedio, 1 Avanzado.
- Hay al menos 2 candidatas nuevas con todos los prerrequisitos satisfechos por cada grupo.
- Candidatas verificadas: `firelady`, `pike-fireman`, `thigh-hold-crossed`, `advanced-jamilla`, `eros`, `aerial-jamilla-ext-butterfly`.
- Las candidatas siguen pendientes; las pruebas de escritura se revirtieron mediante savepoint.
- La RPC de logros se probo como `authenticated` con el contexto owner existente, no como service role.
- Se verificaron marcado, lectura, autor, sesion, auditoria, repeticion idempotente y desmarcado.
- Marcar para Ana no modifica el progreso de Berta.
- El total de antecedentes sinteticos sigue siendo 33 despues del rollback.

Se detecto y corrigio un error real: `SELECT FOR UPDATE` requeria un permiso UPDATE que la tabla no otorga. La migracion `20261020214233_catalog_c2_achievement_invoker_lock_fix.sql` conserva SECURITY INVOKER y RLS, y usa un bloqueo transaccional por estudio/alumna/figura. No se ampliaron permisos UPDATE. La ejecucion anonima se revoco explicitamente; `authenticated` conserva EXECUTE.

## Aislamiento y limites

Las alumnas no tienen correo, telefono, persona vinculada ni cuenta Auth. La sesion tiene `assistant_visible=false`, no exige recursos, no cobra ni usa adquisiciones o creditos. Los eventos de dominio de creacion se conservaron; su procesamiento de notificaciones se suprimio y las solicitudes pg_net de sincronizacion correspondientes exclusivamente a estas nuevas alumnas se retiraron antes del commit. No quedan eventos salientes pendientes para este escenario.

No se modificaron clases reales, credenciales, configuracion global de notificaciones ni Produccion. No hay mantenimiento automatico ni reloj congelado: la ventana vence el 22 de octubre a las 15:40. Reutilizar los datos sin borrar los resultados del UAT; antes de otra entrega comprobar o renovar exclusivamente la ventana de esta sesion sintetica. Archivar el escenario despues de la aceptacion, sin eliminar su auditoria.

La revision visual en navegador sigue pendiente de Mike. Estas alumnas no tienen cuenta de portal, por lo que este escenario no certifica la carga de fotos en el portal de alumna. Los advisors se ejecutaron; existen avisos de otras tablas/funciones y Auth fuera de este cambio, sin afirmar que todo el proyecto este libre de avisos.

## Recorrido manual

1. Abrir el enlace estable, elegir Demeter Fitness Studio y desplegar la clase UAT.
2. Pulsar Generar combos: deben aparecer 3 grupos, con Ana y Berta juntas en Intermedio.
3. Probar Otra opcion y confirmar que solo cambia el grupo seleccionado.
4. Registrar resultados: marcar La logro solo para Ana y guardar.
5. Revisar Operacion > Figuras en Ana y Berta: solo Ana debe tener el nuevo logro.

Esto habilita la revision funcional; no constituye UAT aprobado, CI completo ni autorizacion de promocion.
