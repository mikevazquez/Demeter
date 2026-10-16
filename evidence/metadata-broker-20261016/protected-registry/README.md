# Regla creada por el propietario: configuración verificada

La acción administrativa está completada. El verificador existente acepta el
ruleset **25272082** leído directamente de GitHub:

- Active; target branch.
- Include exacto: `refs/heads/evidence/sf-gov-broker-reservations/*`.
- Sin exclusiones ni bypass.
- Restrict updates, Restrict deletions y Block force pushes.

`ruleset-observed.json` conserva la respuesta observada. No se probó borrando ni
modificando referencias históricas. No se hizo reserva, captura o consulta SQL.

## Verificación desde Actions y limitación encontrada

Las pruebas unitarias del runner pasaron, pero los tres ensayos completos **no
pasaron** el preflight de política. No se presentan como certificación positiva:

| Run                                                                            | Pruebas del runner | Resultado completo                           |
| ------------------------------------------------------------------------------ | -----------------: | -------------------------------------------- |
| [38959095297](https://github.com/mikevazquez/Demeter/actions/runs/38959095297) |            55 PASS | failure: preflight denegado                  |
| [38959362037](https://github.com/mikevazquez/Demeter/actions/runs/38959362037) |            56 PASS | failure: vista de política insuficiente      |
| [38959685958](https://github.com/mikevazquez/Demeter/actions/runs/38959685958) |            58 PASS | failure: consulta pública posterior HTTP 403 |

La documentación oficial explica que `bypass_actors` solo se devuelve si quien
consulta tiene acceso de escritura a la regla. El token temporal de lectura del
job no acredita ese acceso. Una lista no visible no se puede interpretar como
vacía. La consulta pública de respaldo tampoco resolvió la verificación.

Se retiró ese intento de respaldo: el código final deniega inmediatamente cuando
la vista oculta bypass. No se amplió el permiso del job, no se pidió una credencial
administrativa y no se relajó el contrato. **58 pruebas locales relevantes PASS**
en el código final, incluidas la denegación sin reintento y sin elevar permisos.

Fuente oficial:
https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset

> To prevent leaking sensitive information, the bypass_actors property is only
> returned if the user making the API request has write access to the ruleset.

El ensayo OIDC previo
[38950798442](https://github.com/mikevazquez/Demeter/actions/runs/38950798442)
continúa siendo evidencia positiva de firma real/denegación, no de esta nueva
lectura completa de política. En los nuevos ensayos la etapa OIDC posterior se
omitió porque el preflight falló correctamente.

## Estado y siguiente integración

No se requiere que el propietario vuelva a editar la regla. El dato completo se
verificó desde la conexión disponible en esta sesión. Para automatizar, la
comprobación completa debe permanecer en un componente de confianza que pueda
leer esa vista; el runner de ejecución no debe inferirla desde una respuesta
incompleta. Falta concretar esa integración y su autorización, además del
transporte SQL, identidad positiva del controlador, atestación y conciliación de
Candidate. La captura sigue desactivada.

No se marcan hitos completos por una prueba parcial: 9/24 (37.5%) completos;
15/24 (62.5%) pendientes. Fases completas: 3/8, 4/7, 2/6 y 0/3.
