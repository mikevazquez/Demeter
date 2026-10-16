# Captura gobernada: identidad y reserva durable implementadas, sin activación

Este incremento continúa #311. Conserva el prototipo diagnóstico y el rechazo de
su fuente como atestación de liberación. No modifica workflows ni secretos.

## Anfitrión elegido para la siguiente integración

Se propone reutilizar el job del controlador protegido de GitHub Actions y el
entorno existente `sf-gov-schema-capture`; no contratar un servidor nuevo. El
checkout del controlador debe permanecer fijado a un SHA revisado, sin ejecutar
código candidato en el job que tenga credenciales. No existe aún esa integración
activada: las funciones de este PR son módulos importables, no un endpoint.

## Autenticación implementada

`metadata-broker-identity.mjs` verifica JWT RS256 con las claves públicas del
emisor GitHub Actions. El cargador usa exclusivamente
`https://token.actions.githubusercontent.com/.well-known/jwks`, rechaza redirects,
limita tiempo/tamaño y no sigue URLs del encabezado del token. Exige claves RSA
públicas de al menos 2048 bits, identificador único y firma válida. Rechaza
algoritmos alternativos, tokens malformados y fechas inválidas o vencidas.

La identidad debe acreditar conjuntamente:

- Repo `mikevazquez/Demeter`, ID 1370494017, propietario ID 55609925.
- Audience `sf-gov-metadata-broker-v1` y entorno `sf-gov-schema-capture`.
- Rama protegida `governance/sf-gov-001-controller`, evento push, runner alojado.
- Workflow `.github/workflows/schema-controller.yml`, SHA del workflow y del
  controlador iguales al SHA fijado por configuración confiable.
- Primer intento del run; no delegación a otro reusable workflow.

No basta con conocer el SHA o aportar un objeto con esos campos: debe existir
firma del emisor verificada. El SHA permitido y las claves públicas deben venir
del anfitrión confiable, nunca del cuerpo de una petición.

`metadata-broker-authenticated.mjs` compone esa identidad con la autorización
revisada de candidato/UUID/hash/caducidad y el prototipo. La autorización no puede
sobrevivir al token. Una identidad válida tampoco autoriza un candidato distinto.
La respuesta continúa siendo diagnóstica, sin firma de liberación y con
`release_eligible: false`.

Las pruebas usan claves RSA generadas localmente y claims sintéticos. Se verificó
el discovery público oficial y que anuncia RS256 y los claims requeridos; **no se
obtuvo ni verificó un token real de Actions**. No hay tokens en evidencia o logs.

## Reserva durable implementada

`metadata-broker-reservation.mjs` crea un registro Git por UUID mediante el endpoint
create-ref. La creación es la operación atómica: un segundo creador no debe mover
la referencia existente. El transporte solo admite GET y POST; no hay update-ref,
force push, eliminación ni reintento automático. Cualquier resultado incierto o
error de permisos deniega la captura.

Cada registro vincula UUID, hash de la autorización y SHA del controlador. El
commit conserva el árbol previo, suma un archivo de evidencia y mantiene su
parent; no modifica la cola ni las ramas de control. El transporte autenticado
queda en el anfitrión. El módulo no carga un token de GitHub ni lo entrega al
proceso SQL.

Antes de activación se debe proteger el namespace
`refs/heads/evidence/sf-gov-broker-reservations/*` contra actualizaciones, borrados
y force pushes, permitiendo únicamente creación. La persistencia observada **no
acredita todavía esa protección administrativa**. Un administrador que altere
reglas sigue siendo parte del modelo de confianza de GitHub.

Las carreras concurrentes se ensayaron contra un servidor Git simulado, con un
solo ganador. No se declara una carrera remota real. Ante 422 se rechaza el
intento, aunque el error tuviera otra causa; nunca se autoriza por inferencia.

## Prueba real de persistencia y reinicio

Se ejecutó el módulo real de reservas en dos procesos Node separados. Un puente
JSON por stdin/stdout trasladó sus operaciones a la app GitHub ya conectada; el
proceso Node no recibió credenciales. Las respuestas de la app se normalizaron al
contrato REST y se verificó la referencia publicada por lectura posterior.

- UUID de ensayo: `f4c8e712-2c46-48d1-b1a9-cf0ef476ca31`.
- Namespace exclusivo de ensayo: `evidence/sf-gov-broker-reservation-rehearsal/`.
- Primera ejecución: reserva concedida.
- Segundo proceso, con nueva lectura de GitHub y sin caché de la primera ejecución:
  reserva rechazada. No emitió escrituras.
- Registro conservado:
  https://github.com/mikevazquez/Demeter/blob/fb5772bf01eebeff0543dc00f59462a7d6b0694c/evidence/broker-reservation.json.

Es un registro sintético de ensayo. Su binding no autoriza acceso productivo. No
se ejecutó captura, consulta SQL, tarea de cola o petición de modelo en ese ensayo.
La primera invocación del harness sin stdin interactivo se denegó antes de tener
transporte; el ensayo efectivo se realizó después con un canal abierto. No dejó
un registro adicional ni se usó como evidencia positiva.

## Evidencia y límites de la aceptación

`evidence/metadata-broker-20261016/auth-reservation/` conserva el resultado de
pruebas, hashes de fuentes y la comprobación del registro real. El conjunto local
integra autenticación, composición, reservas y las pruebas previas del prototipo,
contratos y permisos SQL aislados. No se presenta como jobs exitosos de Actions.

Para activar faltan, en este orden:

1. Integración del controlador con OIDC real, validación independiente y pruebas
   sin secretos productivos de identidad, autorización y repetición.
2. Reglas verificables de creación sin modificación/borrado del registro.
3. Transporte SQL acotado en el anfitrión y revisión del nuevo modelo de confianza.
   Aprovisionar credenciales productivas privilegiadas no está cubierto por la
   autorización anterior para crear lectores NOLOGIN; no se hará implícitamente.
4. Captura protegida real, certificación de la nueva fuente y controles negativos.
   El verificador de atestación anterior sigue intacto y rechaza el prototipo.
5. Conciliación de Candidate: el diagnóstico anterior muestra divergencias en
   7/7 categorías. Identidad y persistencia no eliminan esa diferencia.

La siguiente tarea es preparar y ensayar la integración sin secretos, no volver a
solicitar el REVOKE ni pedir claves al usuario. No hay petición de aprobación en
este bloque ni modificación de producción.

## Avance global sin cambiar el denominador

Se mantiene el avance de 9/24 hitos (37.5%), con 15/24 pendientes (62.5%).
Fases completas: 3/8, 4/7, 2/6, 0/3. Autenticación y reserva son subpasos de la
captura, no un hito completo ni UAT aprobado.

Fuentes: discovery https://token.actions.githubusercontent.com/.well-known/openid-configuration,
https://docs.github.com/en/actions/reference/security/oidc y
https://docs.github.com/en/rest/git/refs#create-a-reference.
