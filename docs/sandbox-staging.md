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
- Estado durante F11: **congelado**. No se mergea ni despliega F11 antes de pruebas completas y UAT aprobado.

### Sandbox / staging

- Supabase: `Studio Flow Sandbox`
- Project ref: `hedouonyhynuvwbckdlg`
- Región: `us-east-1`
- Costo verificado al crear el proyecto: `US$0/mes`
- Git branch de integración/staging: `infra/sandbox-staging-f11`
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

La misma fuente versionada en GitHub fue desplegada al proyecto sandbox mediante el conector oficial disponible:

- sandbox slug: `provision-student-access`;
- versión sandbox: `1`;
- estado: `ACTIVE`;
- `verify_jwt=true`;
- hash del bundle: `f8f3096cadf9699ac1c5ec5d09e1ee8f157567f94ce02436ca9bbb4961c346f3`, coincidente con producción.

Este gate queda cerrado sin haber creado usuarios reales ni copiado datos de producción.

## Vercel Preview / staging

La integración GitHub → Vercel está operativa y creó el Preview de la rama `infra/sandbox-staging-f11`. GitHub identificó el proyecto Vercel `demeterbueno` (`prj_nE53dwTfcSsoLkx1XeAm6rsJ1AJ6`).

Para impedir que un Preview use accidentalmente producción se agregó `scripts/verify-deployment-env.mjs`, ejecutado como `prebuild`.

El guard exige en `VERCEL_ENV=preview`:

- `NEXT_PUBLIC_SUPABASE_URL` = `https://hedouonyhynuvwbckdlg.supabase.co`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` correspondiente al sandbox, validada por hash SHA-256 sin guardar la clave en el repositorio.

También impide que `VERCEL_ENV=production` use la URL del sandbox.

El primer deployment con el guard falló y permitió detectar una URL sandbox mal escrita en la variable branch-specific. Se corrigió únicamente el override `Preview` de `infra/sandbox-staging-f11`, sin modificar Production.

Validación final: commit `c17c622724ae4ea5c4e77f5c1db6dd90860d5227` obtuvo Vercel `success` con el guard completo activo. Esto verifica que URL y publishable key del Preview corresponden al Supabase Sandbox aprobado.

## Desarrollo F11 sin tocar producción

Decisión explícita aprobada el 2026-09-16: **no enviar nada a producción hasta que esté bien probado y aprobado**.

Por lo tanto:

1. `main` permanece en el baseline productivo F14.
2. PR #28 permanece DRAFT y no se mergea durante el desarrollo de F11.
3. `infra/sandbox-staging-f11` funciona como rama de integración/staging.
4. F11 se implementa y prueba contra `Studio Flow Sandbox`.
5. QA, smoke, seguridad y UAT se completan en staging.
6. Sólo después de UAT aprobado se prepara una promoción separada a `main`.
7. Ninguna migración de F11 se aplica a Supabase producción antes de esa promoción aprobada.

## Promoción sandbox → producción

1. Desarrollar F11 contra sandbox/staging.
2. Aplicar migraciones nuevas primero en sandbox.
3. Mantener seed sintético; nunca copiar PII de producción para QA.
4. Ejecutar CI y smoke/integration tests.
5. Validar Vercel staging apuntando sólo al Supabase sandbox.
6. Realizar QA/UAT completo en sandbox.
7. Documentar resultados y cualquier decisión de producto.
8. Solicitar aprobación explícita para promoción.
9. Antes de cualquier cambio destructivo de producción, verificar backup/restorable point o dump lógico.
10. Sólo con aprobación: promover código, migraciones y Edge Functions a producción de forma explícita y auditable.
11. Ejecutar smoke productivo y verificar métricas/regresiones.

## Estado para F11

Gates de infraestructura cerrados:

- [x] Supabase aislado.
- [x] Replay de F0–F10.
- [x] Drift de grants/reproducibilidad reconciliado.
- [x] Seed ficticio.
- [x] Smoke de esquema/seed.
- [x] Edge Function `provision-student-access` desplegada y verificada en sandbox.
- [x] Vercel Preview con URL + publishable key del sandbox y build `success` con guard activo.
- [x] CI del commit de validación final en verde.

El sandbox/staging está listo. F11 puede iniciar por SF-108 sin mergear a `main`. La promoción productiva queda bloqueada hasta UAT explícitamente aprobado.
