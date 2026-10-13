# Recuperación SaaS de Studio Flow

Fecha: 2026-10-11. Base de integración: `20fece92` (producción con la corrección de Messenger).

## Fuentes recuperadas

- Rama `dev-03-studio-config`, commit `9a7a63bde0d4e2d3cc3bd817734a428b8cce67d0`: panel de alta, administración de planes, funciones Stripe y documento DEV-04H.
- Historial de migraciones y esquema efectivo de Supabase Sandbox y producción.
- Funciones Stripe actualmente desplegadas: checkout v4, portal v4, webhook v6. Se comprobó que coinciden con las fuentes recuperadas.

`recovered-migrations/` conserva 29 migraciones históricas como referencia. No está dentro del directorio de migraciones ejecutables: aplicar esas versiones completas sobre la aplicación actual podría revertir correcciones posteriores.

Las tres migraciones nuevas de restauración recuperan únicamente las dependencias de alta, administración y facturación compatibles con la base actual. Se conserva el esquema de auditoría de octubre (`metadata`, `created_at`). Se conservan los mecanismos de sesión y valida cuenta, membresía y estudio antes de aplicar permisos del plan. Los errores de consulta del plan no cierran la sesión.

## Causa de la divergencia

La migración de Sandbox `20261007054052_align_sandbox_public_schema_to_production_20261007` eliminó las tablas de precios, checkout y eventos Stripe, además de columnas SaaS. Las funciones desplegadas y su historial anterior permanecieron. Tener una migración registrada no demuestra que sus objetos sigan presentes.

## Decisiones comerciales recuperadas

| Plan   | Mensual MXN |                    Alumnas activas | Sedes | Administradores |
| ------ | ----------: | ---------------------------------: | ----: | --------------: |
| Core   |         899 |                                100 |     1 |               3 |
| Growth |        1399 |                                250 |     1 |               8 |
| Pro    |        1999 | Sin límite, sujeto a uso razonable |     2 |      Sin límite |

Coaches ilimitados. All Access es interno y no se ofrece en contratación. Los precios anuales no se inventan. Los identificadores Stripe documentados son del entorno de pruebas y nunca deben trasladarse a producción.

## Entornos

- Sandbox: `hedouonyhynuvwbckdlg`.
- Producción: `qfhojvgvhrbautvczffq`.
- Las modificaciones de esta recuperación se aplican primero a Sandbox.
- Producción requiere cerrar los criterios de la matriz y preparar su propia configuración Stripe Live.

## Seguimiento

La matriz se mantiene en `seguimiento.md`; la evidencia se añade al aprobar cada punto. Ningún estado se marca aprobado únicamente por existir código.
