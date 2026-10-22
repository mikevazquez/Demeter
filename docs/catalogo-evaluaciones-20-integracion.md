# Catálogo y Evaluaciones 2.0 · integración (POLE-01)

## Fuente canónica

Notion: épica POLE-01 «Catálogo como base: evaluación por nivel, combo de clase y
progreso» y la página «Studio Flow · Catálogo y Evaluaciones 2.0 · Integración y UAT».
Desglose técnico POLE-01-08 a 24. Bloque liberado por Mike el 22-oct-2026.

## Estado de esta rama (22-oct-2026)

- Incluye `main` hasta `bfd395e1`.
- **POLE-01-20 · migraciones con paridad exacta a Sandbox.** El catálogo vivía en
  Sandbox con migraciones que no estaban en el repositorio. Se agregan con el mismo
  texto que registra `supabase_migrations.schema_migrations` (md5 verificado):
  `20261012182710_pole_figures_domain`, `20261012182739_pole_figures_seed`,
  `20261012183439_pole_figures_integrity` y
  `20261020214233_catalog_c2_achievement_invoker_lock_fix`. El seed reproduce
  byte a byte el catálogo (1.206 figuras) de `lib/pole/catalog-seed.json` minificado.
- `20261020060255_catalog_c1_student_figure_progress` (bitácora de marcado en clase)
  existe en Sandbox pero **sin registro** en el historial de migraciones: Codex debe
  verificar la paridad y registrarla, no volver a aplicarla.
- Se quitaron `20261020060658` y `20261020060721`: copias idénticas de una tabla de
  progreso de elementos técnicos que ningún código usa y que Sandbox no tiene.
- **POLE-01-15 · se retiró la evaluación adaptativa de PR 351/352** (parte
  personalizada, pistas y `evaluaciones04_pole_adaptive`). Evaluaciones vuelve al
  estado de `main`; catálogo, combo de clase desde Hoy, figuras de la alumna y
  portal se conservan.

- **Paridad de funciones con Sandbox.** Sandbox tenía cambios fuera del historial:
  `private.pole_seed` corregido (`20261012190000_pole_seed_sandbox_parity`) y
  `pole_save_plan` / `pole_snapshot` (`20261020220000_pole_sandbox_parity_functions`).
  Las 26 funciones de Pole quedan con el mismo md5 de cuerpo que Sandbox.
- **POLE-01-08/09/10** (`20261022160000_pole01_level_map_mandatory_figures`):
  correspondencia de niveles y mínimos por estudio (85/87/90/92, Élite no sube),
  obligatorias por nivel de alumna (propuesta automática 4–5 por nivel, aprobación de
  Mike, máximo 5, del nivel de catálogo correspondiente) y funciones de escritura
  sólo para `evaluations.configure`.

## SQL local

Prueba aislada (PostgreSQL local, nunca Sandbox ni producción): aplicar
`tests/fixtures/pole-test-doubles.sql`, las migraciones de Pole en orden y
`tests/pole01-level-mandatory.sql` (9 controles, termina en rollback).

## Siguiente

POLE-01-12 (pantalla de obligatorias en el catálogo) y POLE-01-13, el generador de plantilla de tres apartados (40/30/30) sobre el motor
EVALUACIONES-01. Producción no se toca sin autorización explícita de Mike; ahí el
catálogo de pole no existe y el pase incluye todas las migraciones anteriores.
