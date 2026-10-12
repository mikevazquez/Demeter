# POLE-FIGURAS-01 · Catálogo de figuras de Pole, progreso de alumna y combos por clase

Fecha: 2026-10-12 · Estado: **EN REVISIÓN (PR) · pendiente de aplicar en Sandbox y UAT**

## Qué incluye

| Pieza                                             | Dónde                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Migración (tablas, RLS, RPC, bucket de fotos)     | `supabase/migrations/20261012220000_pole_figures_module.sql`                                                   |
| Catálogo semilla (1,206 figuras + 28 combos base) | `lib/pole/catalog-seed.json`                                                                                   |
| Reglas de estado, cadena de requisitos y resumen  | `lib/pole/figure-state.ts`                                                                                     |
| Generador de combos                               | `lib/pole/combo-generator.ts`                                                                                  |
| Admin · cargar y consultar catálogo               | `/admin/evaluaciones/figuras-pole`                                                                             |
| Admin · combos, validación y autorización Pro     | Detalle de sesión `/admin/agenda/[sessionId]` (sección "Figuras de Pole")                                      |
| Alumna · Mis figuras                              | `/student/perfil/figuras` (entrada desde Perfil)                                                               |
| Pruebas                                           | `tests/pole-figures-logic.test.ts`, `tests/pole-figures-module-contract.test.ts`, `tests/pole-figures-uat.sql` |

## Decisiones de producto

- El catálogo se basa en un libro de referencia. **Solo** se guardan nombre, nivel, tipo, familia y página (la página solo la ve staff). No se guardan textos ni imágenes del libro, y el libro no se vende.
- El catálogo y los combos no llevan imágenes. La única imagen es la foto que sube la alumna cuando logra una figura (bucket privado `pole-achievement-photos`).
- La alumna marca y desmarca sus figuras. Las que tienen un prerrequisito sin cumplir aparecen con candado y el servidor rechaza marcarlas.
- La instructora valida al final de la clase. Se guarda el origen (`student` o `instructor`).
- Desmarcar **no** desmarca en cascada lo que ya se logró después.
- Las figuras **Profesional** (286) llevan candado rojo y se abren solo por autorización de staff, figura por figura y solo para alumnas avanzadas. **Nunca** entran a los combos.
- El contador "X de Y" cuenta solo el **programa base** del nivel de la alumna (48 principiante, 50 intermedio y 25 avanzado). Las figuras extra se cargan y se ven en el admin, pero en esta fase no se muestran en el portal.
- **Mapeo de niveles** (confirmado por Mike, editable por estudio en `pole_level_map`):

  | Nivel técnico del estudio                  | Catálogo     | ¿Puede recibir Profesional? |
  | ------------------------------------------ | ------------ | --------------------------- |
  | Principiante (`beginner`)                  | Principiante | No                          |
  | Intermedio (`intermediate`)                | Intermedio   | No                          |
  | Intermedio Avanzado (`upper_intermediate`) | Intermedio   | No                          |
  | Avanzado (`advanced`)                      | Avanzado     | Sí                          |
  | Élite (`elite`)                            | Avanzado     | Sí                          |

- Una alumna sin evaluación en la disciplina se trata como principiante, con aviso en el admin y en su portal.

## Seguridad

- Las 7 tablas tienen RLS habilitado y forzado. Sin permisos para `anon`.
- Escritura de alumna y staff solo vía RPC `security definer` con `search_path = ''`.
- La regla para marcar figuras está en `private.pole_mark_block_reason`: nivel, prerrequisitos y autorización.
- Staff requiere `evaluations.write` para combos, validación y autorizaciones, y `evaluations.configure` para cargar el catálogo.
- Fotos: la alumna administra solo `{auth.uid()}/…`. Staff con `evaluations.read` del estudio de esa alumna puede leerlas.

## Cómo aplicarlo (Sandbox primero)

1. Aplicar `20261012220000_pole_figures_module.sql` en **Studio Flow Sandbox**.
2. En el admin, ir a **Evaluaciones → Figuras de Pole**, elegir **Pole Fitness** y pulsar **Cargar catálogo base**. Es idempotente: se puede repetir sin duplicar. Si en Evaluaciones ya existe un elemento con el mismo nombre, se reutiliza.
3. Revisar que las alumnas de prueba tengan nivel en Pole Fitness (Evaluaciones).
4. UAT (recorrido del prototipo aprobado):
   1. Clase de Pole con 2 principiantes y 1 avanzada. El detalle de sesión muestra los combos por nivel.
   2. "Otra opción" rota la figura nueva. "Usar en clase" guarda el combo.
   3. Marcar "La logró" a una alumna y guardar. En su portal, el contador sube y aparece "Lo que lograste hoy" con espacio para su foto.
   4. Autorizar una figura Profesional a la avanzada. En su portal aparece en "Autorizadas por tu instructora" y en la pestaña Pro.
   5. La alumna intenta marcar una figura bloqueada desde la cadena de requisitos: no puede.
5. Solo después de aprobar el UAT, aplicar en producción, con respaldo previo verificado (ver `docs/current-phase.md`).

## Verificación hecha en el desarrollo

- La migración se aplicó sobre un Postgres 16 local con stubs de Supabase. El import cargó 1,206 figuras, 118 prerrequisitos y 28 combos, y la segunda corrida no agregó nada.
- `tests/pole-figures-uat.sql` (vía RPC) confirmó:
  - La alumna no puede marcar figuras de siguiente nivel, con prerrequisito faltante o Profesional sin autorización.
  - Staff no puede autorizar Profesional a una principiante.
  - No se puede validar a una alumna sin reserva en la sesión.
  - Se rechazan los ciclos de prerrequisitos y las rutas de foto ajenas.
  - Una usuaria externa no ve filas.
- Las pruebas de lógica reproducen el combo del prototipo: Bombero básico → Bombero en pike para Ana y Sofía.

## Pendiente / fuera de esta entrega

- Editor de prerrequisitos y nombres en el admin. Hoy el catálogo se consulta; la edición fina queda para la siguiente iteración.
- Panel de "Figuras de Pole" en el Perfil 360 de la alumna. El componente `ProAuthorizationCard` ya es reutilizable.
- Revisar con las instructoras la cadena de prerrequisitos del programa base: hoy muchas figuras de principiante dependen de 2 o 3 figuras básicas.
