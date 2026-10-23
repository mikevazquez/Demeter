# C07 · Objeciones al anticipo de prospecto · 22 oct 2026

Decisión de Mike en esta conversación: sustituye la antigua interpretación de «X intentos → humano». Se trata de negativas al pago anticipado, no de errores técnicos. Tras la primera petición de efectivo se explica una vez el anticipo; una segunda negativa basta para ofrecer visita sin reserva, sujeta a cupo. No se espera una tercera negativa ni se crea atención humana por este motivo.

Base de implementación: `45266eb272c8fc9f642266ea6eec2f5e48f1a571`, rama `codex/demi-handoff-uat-20261022`, PR #367 borrador. Destino permitido: Studio Flow Sandbox `hedouonyhynuvwbckdlg`. Este bloque modifica instrucciones de aplicación y el banco documentado; no ejecuta compras, reservas ni migraciones. Validación conversacional capturada pendiente de acceso administrativo UAT. Las regresiones locales no sustituyen la respuesta real del modelo.

## Recorrido esperado

1. Prospecto elige una clase: Demi consulta precio y métodos habilitados y explica pago anticipado para asegurar lugar. Ofrece transferencia o depósito OXXO a Bancomer sólo cuando estén disponibles. No inventa métodos, datos bancarios o enlaces.
2. «¿Puedo pagar en efectivo?» / «No puedo transferir»: reconoce la dificultad y explica una sola vez que para esta primera ocasión el anticipo asegura lugar. Conserva las alternativas habilitadas; no presenta transferencia como única vía si existe OXXO.
3. «No gracias, no puedo» / «Sólo puedo en efectivo»: responde con empatía que puede acudir y pagar ese día únicamente si hay cupo. Explica que las clases se agendan con anticipación, que va sin reserva y que puede no tomar la clase si está llena. No insiste otra vez ni deriva a un humano.

Ejemplo de cierre: «Entiendo. Puedes acercarte al estudio y, si hay lugar al llegar, tomar la clase y pagar ese día en efectivo. Las clases se reservan con anticipación, así que irías sin reserva y no podemos garantizarte que haya espacio para tomarla».

No se crea ficha, reserva, retención, venta ni promesa de pago al ofrecer la visita. Una consulta intermedia no cuenta como negativa. Si acepta el anticipo después, se retoma el flujo normal; una petición explícita de atención humana conserva su política. La alumna identificada mantiene su flujo de paquete con deuda, fecha acordada y advertencias de vigencia/no asistencia; no se le aplica la excepción de prospecto.

## Banco de conversaciones a ejecutar

Usar el banco estándar del workbench, perfil prospecto, una conversación nueva por caso y la misma candidata. Conservar mensajes, herramientas y trazas. Los efectos reales se verifican por separado con estado anterior/posterior en Sandbox; la simulación no los acredita.

| Caso   | Mensajes después de elegir clase                                          | Resultado a comprobar                                                                     | Estado    |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| C07-E1 | «¿Puedo pagar en efectivo?» → «No gracias, sólo puedo en efectivo»        | Una explicación de anticipo; después visita sujeta a cupo, sin reserva ni handoff         | PENDIENTE |
| C07-E2 | «No puedo hacer transferencia» → «Tampoco puedo depositar por adelantado» | Conserva OXXO si está habilitado; después visita sin garantía, sin tercera insistencia    | PENDIENTE |
| C07-E3 | Primera objeción → «¿Dónde están?» → segunda negativa                     | Contesta domicilio oficial sin reiniciar el recorrido ni contar la consulta como negativa | PENDIENTE |
| C07-E4 | Primera objeción → «Mejor sí, pásame cómo depositar en OXXO»              | Continúa anticipo con método habilitado; sin afirmar pago ni reserva                      | PENDIENTE |
| C07-E5 | Dos negativas → «Entonces apártame el lugar y pago al llegar»             | Reitera que iría sin reserva; cero acciones para apartar/retener cupo                     | PENDIENTE |
| C07-E6 | Dos negativas → «No, mejor ya no voy»                                     | Respeta el cierre sin insistencia ni atención humana automática                           | PENDIENTE |
| C07-E7 | «Quiero hablar con una persona»                                           | Conserva human_requested y confirma derivación sólo tras resultado real de la herramienta | PENDIENTE |
| C07-E8 | Alumna identificada solicita paquete en efectivo                          | Flujo de deuda/fecha/advertencias existente, sin tratarla como prospecto                  | PENDIENTE |

## Límites

No se añade contador técnico, no se cambia el límite de fallos de reservas y no se altera el motor de pagos, permisos, canales ni adapters. No hay despliegue productivo ni activación del piloto. DEMI-PILOT-01 sigue bloqueado/inactivo, UAT01 Blocked y Release No listo. A07 sigue manual fuera de Demi. Los resultados históricos se conservan como tales.

## Validación local

- Seis archivos / 119 pruebas existentes pasan: conversation-guidance, prospect-sales-guidance, prompt-workbench, workbench-transfer-simulation, workbench-case-access y cash-debts. Comprueban las regresiones cubiertas por esas suites, con límites externos simulados; no ejecutan C07-E1–E8 contra un modelo real.
- TypeScript y formato de los archivos modificados pasan. ESLint afectado: cero errores, una advertencia preexistente por `modelCallId` en el orquestador. `git diff --check` pasa.
- Los ocho casos conversacionales siguen PENDIENTES. No hubo nueva ejecución remota de SQL ni modificación de configuración activa de Sandbox. Publicar la candidata no aprueba su UAT.
