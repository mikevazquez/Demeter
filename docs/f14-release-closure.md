# Studio Flow · F14 Release MVP · Cierre

Fecha de liberación: 2026-09-15 (America/Mexico_City)

## Resultado

**F14 · Release: CERRADA / MVP EN PRODUCCIÓN.**

El alcance liberado corresponde al MVP rebaselined aprobado: F0–F10 + release F14. F11 Coach, F12 Documentos/Configuración y F13 completo permanecen pausadas como post-MVP y se desarrollarán posteriormente en un sandbox/staging aislado.

## Baseline liberado

- Repositorio: `mikevazquez/Demeter`
- Branch: `main`
- Commit de release documental: `7efc09bc39340bdca24afa63ebd4cd89f7e4cf89`
- Último commit funcional aprobado por UAT: `517810d49c3999963f8b37e1783f165f459033a5` (PR #24)
- Producción: `https://demeterbueno.vercel.app`
- Supabase: `Studio Flow` / `qfhojvgvhrbautvczffq`
- Región real verificada: `us-east-1`
- Estado Supabase al cierre: `ACTIVE_HEALTHY`
- Edge Function `provision-student-access`: versión 6, `ACTIVE`, `verify_jwt=true`

## Release gates ejecutados

### CI y deploy

- PR #26 de rebaseline: CI completo en verde (format, lint, typecheck, tests, build).
- Commit de release en `main`: Vercel reporta `success`.
- Último commit funcional aprobado (PR #24): Vercel reporta `success`.
- Después de la aprobación UAT de F10 no se introdujeron cambios funcionales; PR #25 y #26 fueron exclusivamente documentación/alcance.

### UAT / smoke funcional

- Admin: flujos operativos construidos hasta F10 aprobados durante UAT previo.
- Alumna: aprovisionamiento, contraseña temporal, cambio obligatorio, Inicio, Reservar, detalle/confirmación, Mis clases, cancelación, paquete, movimientos/pagos, perfil y estadísticas aprobados explícitamente en producción.
- Responsive móvil validado durante UAT real en iPhone; el cierre no introduce cambios de UI posteriores.
- El probe HTTP automatizado desde el entorno del agente no pudo resolver el dominio externo por limitación DNS del entorno; no se interpreta como fallo de producción porque Vercel reporta deployment exitoso y el mismo dominio fue usado exitosamente durante UAT.

### Seguridad / aislamiento

- Todas las tablas del schema `public` tienen RLS habilitado.
- No existen views públicas que puedan bypassar RLS.
- Secret scan del repositorio: sin `SUPABASE_SERVICE_ROLE_KEY`, `service_role` secret ni claves `sb_secret_` expuestas.
- `service_link_student_access` permanece ejecutable únicamente por `service_role`/owner.
- Los RPC `SECURITY DEFINER` expuestos a `authenticated` revisados incorporan controles de capability, `auth.uid()` y/o `private.is_current_student(...)` según el caso.
- `attendance_corrections` tiene RLS y no concede SELECT/INSERT/UPDATE/DELETE a `anon` ni `authenticated`; su warning de falta de policies no representa acceso directo de cliente.

### Consistencia de datos

Comprobación sobre producción al cierre:

- 0 adquisiciones duplicadas por `sale_line`.
- 0 inscripciones duplicadas por `sale_line`.
- 0 ventas con total inconsistente.
- 0 reservaciones malformadas.
- 0 adquisiciones finitas sin límite de créditos.

### Advisors aceptados como no bloqueantes

- Advertencias de `SECURITY DEFINER`: revisadas y clasificadas; no se encontró un P0 de autorización dentro del alcance liberado.
- `auth_leaked_password_protection`: deshabilitada; queda como hardening post-release.
- Performance Advisor: índices faltantes, policies permisivas múltiples y dos initplans RLS; se clasifican como optimizaciones post-MVP, no bloquean el volumen operativo inicial de Demeter.

## Backup y rollback

El conector disponible no expone el plan ni el inventario de backups del proyecto Supabase; por lo tanto no se asume ni se documenta falsamente que exista un backup diario disponible.

Regla operativa desde este release:

1. No ejecutar cambios destructivos de esquema/datos en producción sin confirmar previamente un backup/restorable point en Supabase Dashboard o generar un dump lógico verificable.
2. Para rollback de aplicación, volver al último baseline funcional conocido-bueno: commit `517810d49c3999963f8b37e1783f165f459033a5` / deployment Vercel asociado a PR #24.
3. Para rollback de base de datos, restaurar desde el backup disponible más cercano anterior al incidente; si no hay backup administrado disponible, detener cambios y generar/usar un dump lógico antes de cualquier DDL destructivo.
4. Después de rollback, repetir smoke Admin + Alumna y comprobaciones de consistencia antes de reabrir operación.

## Observabilidad mínima

- GitHub/Vercel status se usa como gate de deploy.
- Supabase Project status, migrations, Edge Functions y Advisors se revisaron al cierre.
- Incidentes operativos deben tratarse como bug/regresión del MVP sin reabrir fases cerradas salvo cambio de alcance explícito.

## Estado post-release

- MVP: **EN PRODUCCIÓN / OPERATIVO**.
- F11: **POST-MVP / PAUSADA**.
- F12: **POST-MVP / PAUSADA**.
- F13: **POST-MVP / PAUSADA**.
- Próximo paso de ingeniería: crear sandbox/staging aislado de producción y continuar allí F11–F13; sólo promover a producción después de CI, migraciones reproducibles, QA/UAT y aprobación explícita.
