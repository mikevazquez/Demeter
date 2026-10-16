# Ensayo OIDC real, sin captura ni autorización productiva

Resultado verificado: **SUCCESS** en
https://github.com/mikevazquez/Demeter/actions/runs/38950798442,
SHA `8bef3243b3d873898f65d837c3fa9b9f2cb9859b`.

El runner obtuvo una identidad efímera de GitHub Actions, verificó la firma con
las claves públicas del emisor, rechazó una alteración sin firma válida y denegó
su uso como identidad productiva. El resultado es diagnóstico, no una atestación
de esquema ni una autorización de producción.

## Evidencia leída y verificada

- **50 pruebas del runner aprobadas**, 0 fallidas.
- **105 pruebas locales aprobadas**, 0 fallidas ni omitidas.
- Todos los pasos del job, incluida la carga del artefacto, terminaron success.
- `actions-report.json` es el reporte descargado del artefacto, sin bearer token,
  con `signature_verified=true`, `production_identity_denied=true`,
  `tampered_token_denied=true`, `release_eligible=false`, `sql_executed=false`.
- `actions-run.json` registra run/job/artefacto, SHA y resultados de pasos.
- SHA256 del ZIP descargado coincide con el digest del artefacto de GitHub:
  `8885e857d76a9244ddf397060e06c09f8a90c1b2eb6dd925f2ce784806624a05`.
- `verification.json` conserva hashes de fuentes y del reporte. La copia del
  reporte en Git conserva evidencia después de expirar el artefacto temporal.

El repo es público y se utilizó el runner Linux estándar disponible. No se activó
ningún servicio adicional, API de modelo ni runner de pago. El workflow no solicita
entorno protegido, no referencia secretos productivos, no ejecuta SQL y no tiene
permiso de escritura de contenido. `id-token: write` permite solicitar la identidad
OIDC del job; no permite escribir contenido ni autoriza una captura por sí solo.

## Error investigado y corregido

Dos intentos anteriores fallaron sin autorizar producción. El diagnóstico acotado
identificó el rechazo del encabezado JWT. GitHub añade el campo público `x5t`; el
validador inicial admitía únicamente alg/kid/typ. Se aceptó ese campo informativo
con tipo y formato acotados, conservando RS256, kid único, claves desde URL fija,
firma válida y todas las condiciones productivas. El reporte real confirma los
cuatro nombres de campo, sin registrar sus valores o el token.

También se añadió una regresión para tomar la hora de verificación después de
obtener el token: la lectura de red no debe provocar una comparación contra una
hora anterior a su emisión. Esa mejora no se presenta como causa del primer fallo.

Los runs fallidos se conservan y figuran en actions-run.json. El intento exitoso
es una nueva ejecución desde el SHA corregido, no una reinterpretación del fallo.

## Protección del registro: pendiente real

`namespace-audit.json` recoge las reglas activas observadas. Main y controlador
están protegidos; no existe la regla create-only del namespace de reservas.

La reserva productiva exige ahora un ID de regla y relee esa regla desde GitHub
antes de cualquier reserva. Si la regla está ausente, desactivada, con bypass,
exclusiones o restricciones incompletas, deniega antes de escribir. Las pruebas
negativas cubren esas condiciones. No se afirma que la regla esté aplicada.

La conexión de la app GitHub no aporta administración de rulesets. La propuesta
concreta y las instrucciones para el propietario están en
[broker-reservation-admin-steps.md](../../../broker-reservation-admin-steps.md)
y `controller/broker-reservations.ruleset.proposal.json`.

## Límites y siguiente bloque

La firma real se comprobó desde la rama de ensayo, por lo que debe ser denegada
para producción. No se ha probado todavía la identidad positiva del controlador
protegido ni una captura/atestación real. No se cambia el contrato de atestación
vigente. Las divergencias de Candidate (7/7 categorías) siguen pendientes.

Siguiente requisito administrativo: crear únicamente la regla del registro y
releerla. Después se puede continuar la integración revisada del controlador y
el transporte acotado; no se necesitan contraseñas ni cambios de permisos Supabase
para crear la regla.

Mismos 24 hitos: 9 completos (37.5%), 15 pendientes (62.5%). Fases: 3/8, 4/7, 2/6,
0/3. Este resultado cierra el ensayo de firma/denegación, no el hito de captura.
