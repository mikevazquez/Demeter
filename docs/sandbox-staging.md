# Studio Flow · Sandbox / Staging

Fecha: 2026-09-16

## Objetivo

Aislar todo desarrollo post-MVP (F11, F12 y F13) de la producción operativa. Producción no se usa como sandbox y no se copian datos reales de alumnas.

## Entornos

### Producción — NO usar para desarrollo

- Supabase: `Studio Flow`
- Project ref: `qfhojvgvhrbautvczffq`
- Región: `us-east-1`
- Web: `https://demeterbueno.vercel.app`
- Git branch productiva: `main`

### Sandbox

- Supabase: `Studio Flow Sandbox`
- Project ref: `hedouonyhynuvwbckdlg`
- Región: `us-east-1`
- Costo verificado al crear el proyecto: `US$0/mes`
- Git branch de bootstrap: `infra/sandbox-staging-f11`
- Datos: exclusivamente ficticios/sanitizados.

## Supabase sandbox

Se reconstruyó el baseline F0–F10 desde las migraciones/versiones vigentes y el estado efectivo de producción, sin copiar filas operativas de producción.

Verificación posterior al replay:

- 33 tablas `public`.
- 0 tablas `public` sin RLS.
- 0 views `public`.
- RPC canónicos presentes: `booking_eligibility`, `book_student`, `cancel_reservation`, `finalize_attendance`, `add_existing_walkin_student`.
- Wrappers Student presentes: `student_portal_snapshot`, `student_schedule_feed`, `student_session_detail`, `student_book_session`, `student_cancel_own_reservation`, `student_classes_feed`, `student_update_own_profile`.
- `service_link_student_access` no es ejecutable por `authenticated` y sí por `service_role`.
- `attendance_corrections` no tiene SELECT directo para `anon` ni `authenticated`, igual que producción.

## Drift de reproducibilidad encontrado

El replay limpio expuso estados de producción que no estaban completamente versionados en `main`:

1. `capability_based_membership_access` estaba aplicada en producción pero faltaba como archivo de migración separado en GitHub.
2. El hardening efectivo de grants de tablas del release no se reproducía en un proyecto nuevo.
3. `anon` conservaba ejecución sobre `admin_set_student_lifecycle` en un replay limpio, mientras producción no la permite.

Se agregaron migraciones de reconciliación a esta rama para que futuros entornos limpios reproduzcan el baseline efectivo del release sin depender de cambios manuales invisibles.

Estas reconciliaciones no introducen funcionalidad de negocio nueva y no reabren F8–F10/F14.

## Seed sandbox

Archivo: `supabase/seed.sandbox.sql`.

Reglas:

- No contiene nombres, teléfonos, correos, ventas ni paquetes reales.
- Usa correos `@example.invalid` y teléfonos ficticios con prefijo `+999`.
- No crea usuarios de `auth.users` por SQL.
- Es idempotente mediante un registro centinela.

Dataset inicial:

- 3 alumnas ficticias.
- 1 instructor ficticio sin login.
- 2 disciplinas de prueba.
- 1 producto ficticio de 8 clases.
- 3 adquisiciones ficticias.
- 2 sesiones futuras asignadas al instructor ficticio.
- 2 reservas en una sesión para probar roster de F11.
- 0 usuarios de Supabase Auth.

Smoke del seed:

- Las 3 alumnas usan datos sintéticos.
- Sesión `Sandbox · Pole Fitness`: capacidad 8, ocupación 2.
- Sesión `Sandbox · Exotic Pole`: capacidad 8, ocupación 0.
- Balances de ledger esperados: 7, 7 y 8 créditos.

## Edge Function

La función productiva `provision-student-access` está ACTIVE, versión 6 y `verify_jwt=true`.

El intento de desplegar la misma fuente al sandbox mediante la herramienta conectada fue bloqueado por el control de seguridad de la herramienta. No se intentó evitar ese bloqueo.

Gate pendiente antes de declarar el entorno completamente listo: desplegar `provision-student-access` al proyecto sandbox usando el mecanismo oficial permitido (Supabase Dashboard/CLI/connector con capacidad de deploy) y verificar `verify_jwt=true`.

## Vercel Preview / staging

La integración GitHub → Vercel está operativa y creó el Preview de la rama `infra/sandbox-staging-f11`. GitHub identificó el proyecto Vercel `demeterbueno` (`prj_nE53dwTfcSsoLkx1XeAm6rsJ1AJ6`) y el Preview branch URL.

El conector Vercel disponible en ChatGPT no tiene acceso al proyecto y no puede leer/modificar sus variables. Para impedir que un Preview use accidentalmente producción se agregó `scripts/verify-deployment-env.mjs`, ejecutado como `prebuild`.

El guard exige en `VERCEL_ENV=preview`:

- `NEXT_PUBLIC_SUPABASE_URL` = `https://hedouonyhynuvwbckdlg.supabase.co`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` correspondiente al sandbox, validada por hash SHA-256 sin guardar la clave en el repositorio.

También impide que `VERCEL_ENV=production` use la URL del sandbox.

Resultado real: el primer deployment con el guard **falló**, por lo que las variables actuales del Preview no coinciden todavía con las dos variables aprobadas del sandbox. El guard permanece activo; no se permite eliminarlo para hacer pasar el deployment.

Gate obligatorio: corregir el scope `Preview` de ambas variables en Vercel y redeployar hasta obtener `success` con el guard activo.

## Promoción sandbox → producción

1. Desarrollar en branch de feature contra sandbox.
2. Aplicar migraciones nuevas primero en sandbox.
3. Mantener seed sintético; nunca copiar PII de producción para QA.
4. Ejecutar CI y smoke/integration tests.
5. Crear Preview Vercel apuntando sólo al Supabase sandbox.
6. Realizar QA/UAT en sandbox.
7. Abrir/actualizar PR y documentar cualquier decisión de producto.
8. Sólo con UAT/aprobación correspondiente: merge a `main`.
9. Antes de cualquier cambio destructivo de producción, verificar backup/restorable point o dump lógico.
10. Promover migraciones/Edge Functions a producción de forma explícita y auditable.
11. Ejecutar smoke productivo y verificar métricas/regresiones.

## Estado para F11

F11 sigue **PAUSADA / POST-MVP** hasta cerrar estos gates de infraestructura:

- [x] Supabase aislado.
- [x] Replay de F0–F10.
- [x] Drift de grants/reproducibilidad reconciliado.
- [x] Seed ficticio.
- [x] Smoke de esquema/seed.
- [x] CI del PR #28 en verde antes del guard y nuevamente en verde con el guard incorporado.
- [ ] Edge Function `provision-student-access` desplegada y verificada en sandbox.
- [ ] Vercel Preview con las dos variables Preview apuntando al sandbox y build `success` con el guard activo.

Cuando los dos gates restantes estén cerrados, el siguiente trabajo funcional es F11 comenzando por SF-108, después de releer FL-10, FL-11 y M05.
