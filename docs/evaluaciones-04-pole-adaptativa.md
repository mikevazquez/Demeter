# EVALUACIONES-04 · Evaluación adaptativa de Pole

Depende de POLE-FIGURAS-01 (`20261012220000_pole_figures_module.sql`). Sandbox primero; producción sólo después de UAT y con respaldo verificado.

## Qué cambia

| Pieza              | Antes                       | Ahora                                                                                                                                                                                |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plantillas         | Se armaban a mano por nivel | "Crear plantillas base" en Evaluaciones → disciplina crea una por nivel sin plantilla: 8 figuras del programa base (80%) + Técnica y seguridad (20%). No toca plantillas existentes. |
| Inicio desde Hoy   | Plantilla del nivel         | Igual, más una parte personalizada que se arma sola al crear la evaluación (también en cada paso del diagnóstico).                                                                   |
| Evaluación en vivo | Bloques de la plantilla     | Preparación, base del nivel con pistas por figura, parte personalizada y panel "Qué cambia en su portal". Estilo Sendero.                                                            |
| Al publicar        | Sólo nivel                  | Además, todo lo que cumple queda validado en el progreso de figuras de la alumna.                                                                                                    |

## Parte personalizada

Hasta 3 figuras por grupo, sin repetir figuras de la plantilla:

1. **Pendientes de su evaluación anterior**: no cumplidas en su evaluación publicada más reciente de un día anterior.
2. **Por validar**: marcadas por ella en el portal, sin validar.
3. **Lista para intentar**: programa base del siguiente nivel, con todos sus pasos previos logrados. Nunca Profesional.

No cuenta para el resultado del nivel. "Volver a armar" la regenera conservando lo ya calificado.

## Pistas en la base del nivel

- Validada en clase en los últimos 14 días: "Basta 1 intento".
- Marcada por ella sin validar.
- Ya la tiene / Aún no la marca.

## Base de datos

- Tabla `technical_evaluation_personal_items` (RLS forzado; lectura con `evaluations.read`; escritura sólo por RPC).
- Triggers en `technical_evaluations`: generación al insertar, validación de figuras al publicar.
- RPC: `staff_save_evaluation_personal_item`, `staff_refresh_evaluation_personal_items`, `admin_seed_pole_evaluation_templates`.
- Pruebas locales: `tests/evaluations-pole-adaptive-uat.sql`.
