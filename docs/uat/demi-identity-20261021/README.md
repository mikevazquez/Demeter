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

## Banco comercial S11–S15 · preparación de Codex

Mike autorizó que Codex asumiera también el desarrollo del simulador en Sandbox.
Rama `codex/demi-workbench-state-uat-20261021`, sobre
`01d8d9cba024bc7bb4c254c96eb4c8d5f15b256b` (#361). No requiere nuevas migraciones.

El selector «Caso de prueba» aparece sólo en Sandbox y conserva «Conversación
libre» como valor predeterminado para el benchmark existente. Cambiar el caso,
perfil o borrador exige una conversación nueva. El servidor comprueba Sandbox,
propietario, estudio, caso y hash del borrador antes de utilizar el estado.

| Caso | Estado inicial                                              | Mensaje / comprobación                                                          |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| S11  | Prospecto sin ficha ni inscripción                          | Elegir Pase Descubre: sólo precio oficial; sin datos personales                 |
| S12  | Prospecto sin inscripción                                   | Elegir paquete de 8: desglose y confirmación antes de preparar; «no» no prepara |
| S13  | Comprobante ficticio coincidente; awaiting_profile          | Pedir juntos nombre completo, nacimiento y correo; validar antes de activar     |
| S14  | Alumna sin inscripción ni paquete                           | Mismo desglose; sólo preparar tras aceptación                                   |
| S15  | Paquete activo; pendiente cerrado; mensaje de cobro de ayer | «hola»: contexto actual y sin repetir pendiente, cobro ni datos bancarios       |

En S11/S12/S14, después de preparar, el botón «Simular comprobante coincidente»
introduce un evento explícito de fixture. Escribir «ya pagué» no lo introduce.
El prospecto sigue sin perfil hasta completar los tres datos válidos. El estado
provisional y los reintentos no crean ventas, personas, paquetes ni créditos en
las tablas de negocio. El comprobante inicial de S13 también queda identificado
como fixture. Nunca se valida definitivamente una transferencia.

Los importes se leen del producto y la política del estudio, con filtros de
estudio/visibilidad. Los datos bancarios del caso son rótulos de simulación, sin
números de cuenta reales. La simulación **no certifica elegibilidad operativa,
cupo, pago ni activación reales**; eso sigue en el UAT operativo separado.

Demo preparado en Studio Flow Sandbox `hedouonyhynuvwbckdlg`:

- Run `66f7d517-5aff-44e7-96b6-ce15db70b7ba`.
- Estudio **Demi UAT · 66f7d517**, `54dd112f-12ab-4e77-928c-877b12276eb2`.
- Pase Descubre `8aeacd90-8506-42e5-a0ee-b99534046343`: 499 MXN, cuatro clases,
  inscripción incluida; copia del producto de Sandbox `53b7dae5-5ed3-4923-8203-22bcd3041b5f`.
- Paquete UAT de 8 `acb28f46-e996-4b47-a288-621dea99a94e`: 600 MXN, sin inscripción;
  importe de «Mensual · 8 clases» `3ce3fad7-40e6-4b34-8aa2-9e4cee51ef66`.
- Inscripción UAT: 200 MXN; política vigente de fixture exige inscripción.
- No se modificó el run del benchmark `f476451f-bc32-4139-a7c3-7a6dbcd18c60`
  ni el catálogo del estudio de origen. El demo permanece preparado; no se borra
  como si fuera una corrida transaccional con rollback.

Verificación local: 1.726 pruebas en 232 archivos, cero fallos; tipos, lint
(19 advertencias preexistentes, cero errores), formato y build pasan. Incluye
pruebas de aislamiento, confirmación, comprobante, datos inválidos, replay,
precio cambiado, contexto del orquestador y rechazo de fixtures en producción.
La primera compilación con un enlace de node_modules falló por la raíz de
Turbopack; con las mismas dependencias copiadas dentro del worktree pasó.

## Resultado del bloque · 21 oct 21:29 UTC

[Informe completo y siguientes acciones](results-20261021.md): **bloque NO
APROBADO por velocidad**. El acceso temporal se habilitó, utilizó y revocó.

- S11–S15 pasan sus criterios en runtime `e5773f2f`, tras corregir dos fallos del
  simulador conservados en las corridas `48e83cb5` y `1a8de925`. CI39677677496
  success, suite completa sin fallos, formato/lint/tipos/build pasan. Los
  seguimientos auxiliares siguen bloqueados por capacidad del simulador.
- Comparación alternada completada: 30 turnos por versión, base runtimebfd395e1
  (Preview8c551473) frente a candidata exacta01d8d9cb. Mediana6,418→7,101s,
  p9511,673→10,117s; salida4.825→7.272tokens. **FALLA** el objetivo de mediana.
- C03 conserva actividad/horarios fuera de16 mensajes, aplica corrección y retiene
  memoria tras «Gracias». Hallazgo: tres búsquedas excedieron14 días y se
  corrigieron durante el turno. Vigencia de S03 sin fecha en fixture: bloqueada.
- Cuenta sintética desactivada, membresías/sesiones revocadas; login denegado y
  sesión vieja enviada al login. Archivos privados de acceso eliminados. Demo y
  trazas permanecen en Sandbox; cero nuevas filas de negocio en auditoría.

No se activa WhatsApp ni se toca producción. Claude debe corregir la regresión,
entregar nuevo SHA/CI/Preview y repetir la comparación; UAT funcional de Mike y
criterios operativos siguen pendientes. No hay PR integrado ni liberación.
