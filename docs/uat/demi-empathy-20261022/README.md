# Objeciones y efectivo · Sandbox · 22–23 oct 2026

Demi informa sobre el efectivo; recepción lo recibe y registra en el estudio. Ante una objeción, reconoce la preferencia, explica la causa real y reformula si la persona no entiende. **Verificación técnica de estos casos completada; aprobación funcional de Mike y UAT integral pendientes.**

Backend único: Studio Flow Sandbox hedouonyhynuvwbckdlg. Rama codex/demi-handoff-uat-20261022, PR #367 borrador. Producción, canales/adapters y piloto WhatsApp sin cambios.

## Versiones y resultados

- 971c2e0cc852f746cd9ab2f68839b2a5a72dbd32: explicación causal, recepción como responsable y guía general de empatía. Primer banco de15turnos: E02 FALLIDO al ofrecer visita sin reserva ante una pregunta de explicación; E04 PARCIAL por repetición de confirmación.
- 8c54cf162524aa78b7fda691fec8ef210e3d70c9: las preguntas de explicación conservan la etapa sin incrementar negativas y reciben otra redacción. Segundo banco de15turnos: E02 supera el fallo, E04 aún repite la confirmación y describe la lista como sólo aviso; E03 conserva una frase poco acogedora. PARCIAL, no aprobado. CI cancelado al publicarse la siguiente candidata; no se interpreta como éxito.
- 8812da6bf89b2dc6e5b1b2fd6d8828b52b8f8ad1: instrucción específica para el turno de explicación, sin repetir confirmación ni cerrar con otra pregunta; aclara lista de espera y evita lenguaje acusatorio sobre pagos. Tercer banco independiente de15turnos. Preview demeterbueno-83d139jbr-demeter3.vercel.app, deployment dpl_98TEyxTEGT4SoyGGdyMCqd39fVCK, READY.

Run de fixture bd236dcb-0c6b-4dbf-aa72-acb9c67857be, estudio sintético5d9f9367-5be6-4504-9010-76b18da0baf5; su baseline de creación conserva971c2e0c. Cada banco declara su runtime: no se atribuye toda la actividad del run a8812da6b. La cuenta temporal nueva perteneció sólo a los dos estudios sintéticos necesarios.

## Casos observados en la fuente final

| Caso                                                       | Resultado técnico                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E01 · primera objeción, segunda negativa e insistencia     | Explica anticipo/capacidad; después ofrece visita sin reserva/sin garantía con pago a recepción; nueva insistencia recibe otra explicación. Cero modelo/herramientas en esos3turnos.                                                       |
| E02 · por qué / no entendí / otra forma                    | Conserva primera etapa y reformula con ejemplo; no ofrece visita antes de otra negativa. Cero modelo/herramientas.                                                                                                                         |
| E03 · quién recibe / comprobante / validar efectivo        | Informa que recepción recibe y registra; no pide comprobante ni revisa/valida/cobra efectivo. Tres llamadas del modelo, cero herramientas. La redacción exacta se conserva para revisión funcional, sin declararla aprobada por Mike.      |
| E04 · clase llena / insiste a las siete / pide explicación | Consulta disponibilidad real, reconoce preferencia y explica que los lugares están ocupados. Prepara lista sólo en simulación y pide una confirmación. Ante la duda, reformula sin pedir otro sí ni preparar de nuevo; no promete entrada. |
| E05 · negativa definitiva y gracias                        | Respeta el cierre sin continuar la venta ni crear acciones.                                                                                                                                                                                |

Clase llena real: ec7e9fd8-d727-4e1d-8802-ca6f756fde57, capacidad1/reserva1. Se movió sólo su horario a23oct19:00 local para distinguirla de otra clase a18:00. No se inventó instructor: «Paul» era el ejemplo del usuario; la fixture usa Pole Fitness. La consulta auxiliar supuso class_session_id y falló después de persistir el cambio; se inspeccionó esquema, corrigió a session_id y reconcilió horario/reserva sin repetir UPDATE. Sin cambios de reglas.

Traza final:10llamadas de modelo,0errores/0bloqueos y3herramientas: dos búsquedas reales y una preparación simulada de lista. La lista simulada **no valida elegibilidad operativa** ni crea una inscripción real. Ocho respuestas de efectivo/explicación usan etapa controlada, sin modelo ni acciones. No es una prueba exhaustiva de toda objeción ni un nuevo benchmark de velocidad.

Conteos comerciales antes/después idénticos:11alumnas sintéticas,5adquisiciones y2reservas de fixture,0ventas/0pagos. No se ejecutó cobro de efectivo ni revisión de transferencia. Se conserva el alta previamente autorizada de paquete por cobrar para alumna; no equivale a recibir su efectivo. F07 de confirmación del alta con fecha sigue fallido.

## Verificación y evidencia

120pruebas de4archivos pasan, tipos/formato pasan; lint afectado0errores/1advertencia previa por modelCallId. [CI39875514146](https://github.com/mikevazquez/Demeter/actions/runs/39875514146) y [Supervisor39875514170](https://github.com/mikevazquez/Demeter/actions/runs/39875514170) SUCCESS para8812da6b. CI incluye formato, lint, tipos, regresión contra base y build; no equivale a aprobación funcional.

bank.json, bank-v2.json y bank-v3.json conservan45solicitudes/respuestas por SHA. database-traces.json conserva trazas persistidas y conteos; fixture.json/fixture-check.json identifican el escenario; summary.json distingue resultados por versión. Personalidad existente: docs/uat/demi-identity-20261021/candidate-personality.md, hash registrado por banco; guía operativa del runtime correspondiente. No se alteró el prompt activo del estudio.

## Cierre y pendientes

Después de capturar conteos se cancelaron clases sintéticas, deshabilitaron seguimientos de esa fixture y cancelaron/suprimieron colas. Cuenta336a7b3d disabled/banned,0membresías/sesiones/refresh; job38 retirado. Sesión anterior redirige a login y login nuevo400/user_banned. Tres enlaces temporales revocados y14archivos privados retirados. Ocho intentos automáticos capturados/uat:,0externos.

Siguen abiertos F07, timeout histórico F04, limitación E4 del simulador y matriz/aceptación funcional del checkpoint anterior. A07 sigue manual fuera de Demi. Siguiente acción: revisión funcional de estas respuestas y continuación de F07/F04 con evidencia previa; crear acceso temporal nuevo si se retoma UAT, sin reactivar cuentas revocadas. Release No listo, DEMI-PILOT-01 bloqueado/inactivo, sin merge.
