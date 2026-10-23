# Retests operativos y C07 · 22 oct 2026

Backend exclusivo: Studio Flow Sandbox `hedouonyhynuvwbckdlg`. PR #367 borrador, rama `codex/demi-handoff-uat-20261022`. **UAT integral no aprobado.** A07 sigue como proceso manual fuera de Demi; piloto WhatsApp bloqueado/inactivo y producción intacta.

## Versiones y método

- `995f4466411051e752f1cb97c90215af0e67c5c2`: primer banco y comienzo del run operativo.
- `8e53d64a62c8787039757a2c3172997c60507521`: segunda redacción, no eliminó todas las anticipaciones de efectivo.
- `18e0e291aee0c3536af09c99b194a9e2eb5c19c2`: etapa de pago derivada del historial. Tercer banco, continuación operativa de transferencia/handoff/notificaciones.
- `12ccbedad5ffec765e68077acabb78bb1f967591`: restricción de acciones durante objeciones; aún hubo respuesta anticipada después de aceptar OXXO. Variante fallida conservada.
- `d41135aab10670c3a0bcbab0ee77a8a5dea2ad80`: respuesta controlada para primera/segunda objeción, sin modelo ni acciones. Retest operativo en esta candidata, Preview `demeterbueno-4gf9hjlg4-demeter3.vercel.app`, deployment `dpl_5D6c9zLYKUWrUmPLjs2whUErJLYG`.

Run operativo `d1bce540-dd74-4cb8-b3c4-2f709517940f`, estudio sintético `22ace48d-3e0f-4639-8ba4-4ed9b19c8c70`. El baseline conserva la versión de creación; cada observación posterior indica su SHA y deployment. Las anteriores sin campo individual corresponden a995f4466. **Es una continuación con varias versiones, no una corrida integral de una sola candidata.**

Modelo real en el banco y receptor/RPC/DB reales con salida capturada en el operativo. Comprobantes, efectivo, datos personales y medios de pago son sintéticos. No se certifican banco, OCR ni Meta externos. No se accedió a secretos service_role/OpenAI ni se enviaron mensajes a clientes.

## Resultados comprobados

- **Efectivo/alumna:** una venta60000centavos, fecha23oct, sin pago ficticio al dar de alta. Primera reserva/saldo8→7/vigencia23oct–22nov; segunda reserva bloqueada por adeudo. Ausencia y replay conservan saldo7 y deuda; cobro sintético posterior por API con identidad real authenticated registra un único pago60000, conserva vigencia. `cash-collection.json`, `core.json`, `database-checks.json`.
- **Transferencia/perfil:** desglose600+200=800, aceptación antes de intención; no crea alumna antes del comprobante/datos. RPC real registra comprobante sintético, replay idempotente. Pide nombre, nacimiento y correo juntos; los tres quedan persistidos y nacimiento1995-05-10 tiene definición oficial en fixture. Perfil e inscripción/paquete provisionales, revisión administrativa posterior.
- **MATRIX-F03:** después de la revisión real, Demi reconoce «transferencia ya validada» y8clases. Reserva confirmada con un pago, un alta de8 y un único reserve de−1: saldo7. Antes se dudaba del pago a pesar de su estado validated. No se deduce validación de la afirmación del usuario.
- **MATRIX-F02:** crea un caso refund_request sin error de multiplicidad de políticas. Claim y resolve persisten y devuelven control automático; no reembolsa ni mueve dinero. El cliente del resolve dio RuntimeError; se reconcilió el artifact persistido con ok=true y no se repitió la acción.
- **MATRIX-F06:** motor real cancela los avisos del horario anterior y deja uno activo por reserva. Dos reservas×dos canales dan4entregas capturadas, una por aviso/canal; replay del worker devuelve0claims y0entregas nuevas. `makeDue` adelanta sólo jobs de la fixture: acredita deduplicación y entrega capturada, no puntualidad. Se conserva la configuración de6horas aunque la clave histórica diga5h.

## C07 y hallazgos abiertos

Tres bancos de22turnos: `c07-bank.json`, `c07-bank-v2.json` y `c07-bank-v3.json`. Todos los mensajes y respuestas se conservan. Las primeras dos candidatas ofrecían la visita antes de la segunda negativa. En18e0e291 las respuestas de las variantes respetan la secuencia, pero E4 sigue bloqueado por `simulation_not_supported` para instrucciones de primera clase. Una consulta invalid_session_ref fue rechazada y recuperada. E7 invoca una derivación simulada, sin crear caso real. `bank-traces.json` contiene21conversaciones/92herramientas y158llamadas de modelo,0errores de modelo/0bloqueos de presupuesto; acciones bloqueadas y límite de simulación no se cuentan como éxitos operativos.

La ruta operativa sí ofrece instrucciones ficticias de transferencia/OXXO, vuelve al pago cuando se acepta y mantiene cero reserva/ficha por mera objeción. Las versiones18e0e291/12ccbeda aún repetían datos o anticipaban la visita; esas variantes permanecen parciales/fallidas. La candidata d41135aa responde por etapa sin modelo ni acción; su ejecución se conserva por SHA en `core.json`.

**MATRIX-F07 sigue FALLIDO:** «Sí, confirmo la compra del paquete en efectivo. Lo pagaré mañana,23deoctubre» volvió a preparar y pidió otra confirmación. Una confirmación breve posterior ejecutó una sola venta. Se debe corregir la interpretación sin aceptar fechas/importes contradictorios, preguntas, negaciones ni preparación/ejecución en un turno. No borrar esta variante porque la ruta breve pase.

**MATRIX-F04 sigue abierto:** no se reprodujo el timeout histórico en las reservas de esta corrida. Eso no explica ni elimina SQLSTATE57014 previo. Hubo respuestas del banco de decenas de segundos; esta corrida no es P01 ni aprueba velocidad. No se amplió timeout ni se cambió configuración de DB.

## Ajustes del arnés

Sólo consultas/fixtures: columna enabled inexistente→mode; fecha de evento→received_at; ledger→quantity; notifications→state; tipo class_reminder_5h distinto de template class_reminder. Se inspeccionó esquema y se corrigió cada consulta. El primer registro auxiliar de artifact incluyó studio_id inexistente y revirtió toda la transacción; el mensaje posterior no encontró comprobante, correctamente. Después se corrigió run_id/kind/payload y se registró una sola fixture de recibo. Sin reglas, grants ni RLS cambiados. El conteo inicial de errores de modelo usó succeeded y se corrigió a completed/error/budget_blocked, conservando los datos reales de llamadas.

El perfil personalizado birth_date se copió de la definición oficial al estudio de prueba porque el creador de fixtures no lo copia. No se crean campos o reglas nuevos. Una consulta auxiliar de elegibilidad sin rol/claims devolvió forbidden; se corrigió el arnés para usar el rol real service_role y la consulta pasa.

## Candidata final y cierre del bloque

En d41135aa se ejecutó una conversación operativa nueva de prospecto: instrucciones de anticipo, primera objeción con explicación, segunda negativa con visita sin reserva, aceptación posterior de OXXO y nueva petición de efectivo que reinicia correctamente en primera objeción. Las tres respuestas de objeción tuvieron **cero llamadas de modelo, cero herramientas y cero cambios de ficha/reserva/venta/pago/paquete/handoff**; aceptar OXXO continúa el flujo normal y reutiliza la intención sin crear reserva ni alumna. Evidencia ordenada por timestamp: `c07-operational.json`. El depósito sigue siendo ficticio de UAT, no un pago real en OXXO.

Cobro sintético de efectivo por API administrativa con usuario authenticated: una reserva posterior se confirma, el saldo pasa7→6 y conserva23oct–22nov. La ausencia anterior y su replay no descontaron de nuevo. La transferencia conserva saldo7. Las versiones antiguas y F07 permanecen fallidas; no trasladarles el resultado posterior.

Validación de d41135aa:118pruebas locales de4archivos, tipos/formato pasan, lint0errores/1advertencia previa. [CI39854293624](https://github.com/mikevazquez/Demeter/actions/runs/39854293624) y [Supervisor39854293699](https://github.com/mikevazquez/Demeter/actions/runs/39854293699) SUCCESS; Preview READY. CI no equivale a aprobación funcional. Los casos se registraron en el banco: M13failed porF07; M05/M10/M17partial por alcance/límites abiertos, conservando las variantes técnicamente comprobadas.

Fixture cerrada y registros financieros conservados. Clases sintéticas canceladas para cerrar actividad, seguimientos sólo de esta fixture deshabilitados, colas/notificaciones pendientes canceladas y lease libre. Cuenta temporal disabled/banned, cero membresías activas/sesiones/refresh; job37 retirado. Sesión anterior rechazada y login400/user_banned.28intentos automáticos auditados, todos captured=true/uat:, cero externos. Cinco enlaces temporales de Preview revocados y18archivos privados retirados. Producción, configuración de canales/adapters y piloto intactos.

`core.json.gz` conserva sin pérdida el JSON completo anterior al cierre: snapshots, mensajes y artifacts. Se comprime para evitar versionar más de20MB de snapshots repetidos. `evidence-manifest.json` registra hashes y tamaño original; los resultados de limpieza están en `database-checks.json` y `access-cleanup.json`. El verificador lee gzip con la biblioteca estándar.

Siguiente acción: corregir F07 con comparación estricta de fecha/importes/producto y repetir el caso; investigar F04 con trazas realistas, completar la limitación del simulador para primera clase y después preparar la aceptación funcional de Mike. No pedir al usuario otra definición de X ni autorización genérica de Sandbox. No activar el piloto para resolver estos pendientes.
