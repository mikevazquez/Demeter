# Única acción administrativa pendiente: proteger el registro de reservas

La conexión GitHub disponible permite publicar ramas y PR, pero no administrar
rulesets. La auditoría encuentra reglas para main y para el controlador, ninguna
para el registro de reservas. No se debe desactivar ni ampliar esas reglas.

Este cambio protege solamente nuevas ramas de evidencia. No concede captura,
credenciales, despliegues ni promoción. No activa un servicio de pago.

## Pasos para el propietario del repositorio

1. Abrir https://github.com/mikevazquez/Demeter/settings/rules y elegir **New
   ruleset → New branch ruleset**.
2. Nombre: **SF GOV broker reservations create-only**. Enforcement: **Active**.
3. Dejar **Bypass list vacía**.
4. En Target branches añadir **Include by pattern** con exactamente
   `evidence/sf-gov-broker-reservations/*`. No seleccionar main, controlador ni
   todas las ramas; no añadir exclusiones.
5. Marcar **Restrict updates**, **Restrict deletions** y **Block force pushes**.
   No marcar **Restrict creations** ni permitir fetch-and-merge como excepción.
6. Guardar. Conservar la URL de la regla o avisar que quedó creada; el agente
   releerá su ID, patrón, estado y condiciones desde GitHub antes de utilizarla.

Alternativa si la interfaz permite importar una regla: usar el archivo
`controller/broker-reservations.ruleset.proposal.json` de este PR y revisar los
mismos campos antes de guardar. No pegar tokens ni credenciales en el chat.

## Verificación preparada

`scripts/metadata-broker-rules.mjs` exige exactamente el namespace anterior,
Active, sin bypass/exclusiones y las tres restricciones. La reserva productiva
consulta la regla por ID mediante GitHub antes de cada intento. Si falla la
lectura o la protección no coincide, rechaza antes de crear cualquier registro.

El namespace de ensayo `evidence/sf-gov-broker-reservation-rehearsal/*` queda fuera
de esta regla. Su prueba anterior demuestra persistencia; no se presenta como
inmutabilidad protegida de la configuración productiva.

No hace falta modificar los permisos de Supabase, volver a ejecutar REVOKE,
habilitar LOGIN ni integrar #311 para crear esta regla. Después de verificarla
seguirán pendientes la integración autorizada del controlador, el transporte
acotado, captura/atestación y conciliación de Candidate.
