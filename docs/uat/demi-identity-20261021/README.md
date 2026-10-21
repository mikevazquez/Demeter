# Demi · identidad y contexto

Contrato: [R20-EP05](https://app.notion.com/p/3dbd78f714638141bf93ce6f37b02206).
Plan y aceptación: [DEMI-UAT-01](https://app.notion.com/p/400d78f71463817a8705cd1c263dfbd5).

## Preparación previa al desarrollo

- Base de código y producción observada: `bfd395e11e6bb54f2841a3c3c1f3b6a0d8863cd9`.
- Rama: `codex/demi-identity-context-20261021`.
- Sólo identidad, contexto e instrucciones y uso de herramientas existentes. No
  modificar canales, adapters ni motores de pagos/reservas/créditos.
- Banco: acciones simuladas; no acredita efectos operativos. Flujos completos:
  WhatsApp personal de Mike hacia Demi Sandbox, comprobando Studio Flow Sandbox.
- No activar el piloto hasta preparar candidata estable y comprobar aislamiento.
  Al terminar, restaurar el enrutamiento previo. No modificar producción.

## Línea base reproducible

El benchmark utiliza el orquestador real con `testSimulation`, lecturas del catálogo
en un tenant sintético y el modelo/instrucciones del snapshot inicial. Registra por
caso respuesta, herramientas, modelo, tokens, costo y duración total del turno.
No envía mensajes Meta ni ejecuta acciones de negocio. No es UAT de WhatsApp.

Diez casos, tres repeticiones por versión, mismo tenant y configuración, ejecución
secuencial. Conservar errores y muestras lentas; no eliminarlos del informe. Para
la comparación final se reportan mediana y p95 por clase de caso y total, con el
tamaño de muestra. Objetivo previo al cambio: reducir tiempos sin perder exactitud;
la candidata debe tener mediana y p95 no mayores a la base en la misma superficie,
cero acciones indebidas y cero errores críticos de identidad, pago o cupo. Los
tiempos de WhatsApp requieren medición independiente durante el piloto.

| Caso | Requisito       | Persona y mensaje                      | Resultado esperado                                                        |
| ---- | --------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| S01  | BASE-01         | Alumna vigente: hola                   | Usa estado actual, saludo natural; no vende primera clase                 |
| S02  | BASE-02/03      | Prospecto: hola tras pago pendiente    | Retoma pendiente comprobado sin repetir datos bancarios                   |
| S03  | BASE-01         | Alumna: cuántas clases quedan          | Consulta estado actual y responde saldo/vigencia                          |
| S04  | BASE-04         | Horarios de mañana, Pole Fitness       | Sólo actividad y fecha pedidas, sin inventar                              |
| S05  | BASE-04         | Todos los horarios de la semana        | Busca el período completo, no sólo hoy o tres resultados                  |
| S06  | BASE-04         | Hoy después de las 18:00               | Respeta hora local y no ofrece clases pasadas                             |
| S07  | PROS-01         | Ninguna de tres opciones sirve         | Explora otra disponibilidad sin descartar al prospecto                    |
| S08  | PROS-01/02      | No puede pagar anticipadamente         | Efectivo al llegar como último recurso, sin reserva/cupo garantizado      |
| S09  | BASE-01/UAT-A01 | Alumna pide reservar opción exacta     | Prepara acción una vez con derechos vigentes; no ejecuta sin confirmación |
| S10  | UAT-A03         | Alumna pide cancelar reserva existente | Usa reserva correcta y consecuencias oficiales, sin devolución inventada  |

Estos treinta turnos no sustituyen los casos operativos A01–A07 ni las regresiones
R01–R04 del plan de Notion. Cada caso se registra como aprobado, fallido o bloqueado
tras comprobar evidencia; preparar el caso no lo aprueba.

## Fixtures aislados

Creación con la función existente `service_create_demi_uat_run` en el proyecto
Sandbox `hedouonyhynuvwbckdlg`; sin migraciones ni proveedores externos clonados.
Run: `f476451f-bc32-4139-a7c3-7a6dbcd18c60`.
Tenant: `d0357e3d-f962-4628-8ba8-a401708b6157`.
Contiene prospecto, alumna vigente, paquete vencido, exalumna, prueba pendiente,
cancelada y asistida, y seis sesiones sintéticas futuras/pasadas y sin cupo.
No son la cuenta ni el teléfono personal de Mike. Su piloto se preparará sobre su
vínculo verificado existente; no se suplantan identidades desde el chat.

## Antecedentes reconciliados

- [PR #299](https://github.com/mikevazquez/Demeter/pull/299): integrado en main,
  commit de integración `67daf5719a84a24a4f13bf7ae611d87861d25b1e`.
- [PR #320](https://github.com/mikevazquez/Demeter/pull/320): Draft abierto,
  `c230255a9fb29a423857fe1742dbadf6439b0287`; CI histórico verde, pero consulta
  `created_at` en eventos cuyo esquema vigente usa `received_at`. No integrado.
- 79 pruebas iniciales aprobadas: banco, piloto, replay y entrega incierta.
  Eso no demuestra agrupación funcional ni UAT aprobado.

Las correcciones de transporte quedan fuera de esta rama; cualquier caso crítico
bloqueado por ellas permanece visible y no se declara terminado.
