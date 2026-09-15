# F9 · Vigencia de inscripción

Decisión funcional aprobada durante UAT de F9.

## Regla

La inscripción es un derecho administrativo y puede tener una vigencia finita o ser vitalicia.

Opciones comunes en UI:

- 30 días
- 3 meses (90 días)
- 6 meses (180 días)
- 1 año (365 días)
- Vitalicia
- Días específicos

## Semántica de datos

- `product_templates.validity_days = NULL` representa una inscripción vitalicia.
- Sólo los productos de tipo `enrollment` pueden tener `validity_days = NULL`.
- Paquetes, membresías, clases sueltas y otros productos deben conservar una vigencia positiva.
- Al vender una inscripción vitalicia, `student_enrollments.expires_on` queda en `NULL`.
- Eligibility interpreta `expires_on = NULL` como inscripción sin fecha de vencimiento.

## UX

Cuando el tipo de producto es Inscripción, el formulario no muestra créditos, membresía ilimitada ni disciplinas. La vigencia se elige mediante los presets anteriores o días personalizados.
