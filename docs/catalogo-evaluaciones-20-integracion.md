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

## Siguiente

POLE-01-08/09: correspondencia de niveles, obligatorias por nivel y mínimos por paso.
Después el generador de plantilla de tres apartados (40/30/30) sobre el motor
EVALUACIONES-01. Producción no se toca sin autorización explícita de Mike; ahí el
catálogo de pole no existe y el pase incluye todas las migraciones anteriores.
