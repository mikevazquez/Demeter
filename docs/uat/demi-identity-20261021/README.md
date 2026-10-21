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

## Ejecución de Codex · 21 octubre, 20:21–20:24 UTC

Fuente de migraciones y scripts: `claude/demi-prospect-transfer-20261021`,
`b0d0b7a66423a78783e1433a796f86d64c61d7d4`. Proyecto comprobado:
Studio Flow Sandbox, `hedouonyhynuvwbckdlg`. Producción, canales, adapters,
variables productivas y activación del piloto quedaron fuera de la ejecución.

Las tres migraciones se aplicaron mediante Supabase MCP, en el orden solicitado.
MCP asigna la versión de ejecución remota; se conserva esta correspondencia para
evitar reaplicarlas por una diferencia de timestamp:

| Archivo de origen | Versión remota | Nombre                               |
| ----------------- | -------------- | ------------------------------------ |
| 20261021190000    | 20261021202125 | demi_supersede_resolved_pendings     |
| 20261021200000    | 20261021202130 | demi_transfer_enrollment_and_package |
| 20261021210000    | 20261021202138 | demi_prospect_transfer_purchase      |

| Script                                   | Resultado final             | Controles | Límite                                                                       |
| ---------------------------------------- | --------------------------- | --------- | ---------------------------------------------------------------------------- |
| demi-resolved-pendings-uat.sql           | Pasa sin ajuste             | 7         | SQL; no acredita la respuesta al saludo                                      |
| demi-transfer-enrollment-package-uat.sql | Pasa tras ajuste de fixture | 4         | Vista previa/preparación; no prueba activación con comprobante               |
| demi-prospect-transfer-purchase-uat.sql  | Pasa sin ajuste             | 7         | Compra sintética con perfil/activación; no acredita conversación ni WhatsApp |

Primer intento de inscripción: `42501 permission denied for function
student_has_active_enrollment`. Sólo se cambió la selección de fixture: consulta
equivalente con `NOT EXISTS` sobre `student_enrollments`, mismo predicado de
estado/fechas, sin llamar directamente a la función privada desde `service_role`.
No se cambiaron reglas, funciones ni grants. Los tres scripts usan rollback; una
consulta posterior confirmó cero runs creados desde 20:21 UTC. La evidencia cruda,
incluido el intento fallido, está en `sandbox-sql-20261021.json`.

Banco: S11–S15 preparados en `workbench-cases-20261021.json`, **bloqueados**, sin
conversaciones ejecutadas ni inserción en la UI autenticada. No hay sesión de
aplicación disponible en este ejecutor. La Preview de `01d8d9cb` está READY
(`dpl_ASB3bUroDZ5DQ1gTzcS5CuJwhxBP`); usando el acceso protegido de Vercel MCP,
la aplicación entrega `/login/studio`. El acceso de Vercel no inicia sesión de
administrador en Studio Flow.

Además, el simulador del workbench no representa todavía los estados requeridos:
`simulateAssistantAction` devuelve `simulation_not_supported` para
`prepare_bank_transfer_purchase` y `complete_purchase_profile`; los contextos
operativos `awaiting_profile` y pendientes cerrados se omiten con `testSimulation`.
El fixture de alumna no define inscripción vigente/ausente. Estos límites se
comprobaron por lectura de código, no mediante una corrida conversacional.
`test-simulation.ts` es idéntico en `b0d0b7a` y `01d8d9cb`.

Velocidad base `bfd395e1` contra candidata `01d8d9cb`: **bloqueada por acceso**,
0/30 turnos por versión. Mediana, p95 y tokens de salida: no disponibles.
C03: bloqueado, sin ejecución. No se reutilizaron tiempos históricos como si
fueran esta comparación. El manifiesto conserva protocolo, agrupaciones y
criterios para reanudar; no hay aprobación técnica completa, funcional ni de
liberación.

Siguiente acción: recuperar sesión autenticada Sandbox; Claude debe preparar
fixtures/simulación de compras, inscripción, comprobante y pendiente cerrado en
el workbench, manteniendo la interceptación de efectos. Ejecutar S11–S15,
comparación alternada S01–S10 (30 turnos por versión) y C03 sobre sus SHA reales.
DEMI-PILOT-01 continúa bloqueado; UAT funcional de Mike pendiente.
