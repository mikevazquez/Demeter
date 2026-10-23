# Demi · revisión funcional final

Candidata de aplicación: 24718f760cfd68087a41df6004c135bd982cbc40. Sólo Sandbox; datos, comprobantes y cobros de prueba. Estos son mensajes realmente obtenidos con esta candidata. La aprobación funcional de Mike sigue pendiente.

[Preview de Sandbox](https://demeterbueno-479vne56u-demeter3.vercel.app/admin/mas/demi). Acceso con cuenta habitual de Sandbox y Vercel; no se publican credenciales temporales. En Probar a Demi están los casos S11–S15. Las conversaciones de esta página permiten revisar el trato sin repetir operaciones financieras.

## Efectivo en primera clase

Persona: Quiero pagar mi primera clase en efectivo.

Demi: Entiendo que prefieras pagar en efectivo. Como los lugares se reservan con anticipación, el pago por adelantado nos permite confirmar un lugar para tu primera clase. Sin ese pago, el lugar sigue disponible para otras personas y no queda reservado a tu nombre. Puedes hacerlo por alguno de los métodos habilitados.

Persona: ¿Por qué tengo que pagar antes? No entendí.

Demi: Claro: la clase tiene un límite de lugares. El pago anticipado es el paso que permite confirmar uno para ti; mientras no se complete ese paso, otras personas pueden reservarlo. Por eso, sin el pago por adelantado no se confirma una reserva a tu nombre.

Persona: No gracias, no puedo.

Demi: Entiendo que el pago anticipado no sea una opción para ti. Puedes acercarte al estudio y pagar la clase ese día en efectivo, únicamente si hay lugar al llegar; recepción recibe y registra el pago. Como las clases se agendan con anticipación, irías sin reserva y no podemos garantizarte que haya espacio para tomarla.

## Insistencia en una clase llena

Persona: Pero yo quiero agendar a las siete ese viernes.

Demi: Entiendo que quieres ese horario, pero la clase está llena y no puedo confirmar una reserva. Puedo agregarte a la lista de espera de Pole Fitness del viernes 23 de octubre a las 19:00; entrar no descuenta crédito ni garantiza un lugar. ¿Confirmas?

Persona: No entendí, ¿por qué no me puedes agendar a esa hora?

Demi: Porque todos los lugares de esa clase ya están ocupados. Por eso no puedo crear una reserva adicional a las 19:00. La lista de espera es la opción para ese horario, pero no equivale a una reserva ni garantiza entrar.

La clase de prueba tenía un lugar ocupado de uno posible. La lista de espera aquí es simulada; esta conversación no demuestra una inscripción operativa a lista.

## Producto elegido y desglose

Persona: Quiero el Pase Descubre y pagarlo por transferencia.

Demi: El Pase Descubre cuesta $499 MXN e incluye 4 clases, con inscripción incluida. En esta demo no realices una transferencia real: el comprobante se simula desde este chat. Después del comprobante te pediré nombre completo, fecha de nacimiento y correo para activar el pase de forma provisional.

Persona: Quiero el paquete de 8 clases por transferencia.

Demi: El Paquete de 8 clases cuesta $600 y requiere la inscripción anual de $200. El total por transferencia sería de $800. ¿Aceptas pagar ambos juntos?

Alumna sin inscripción: El paquete UAT de 8 clases cuesta $600 y requiere inscripción anual de $200. El total por transferencia sería de $800. ¿Aceptas pagar ambos juntos?

## Después del comprobante

Demi: ¡Gracias! El siguiente paso es completar tu perfil. Envíame juntos tu nombre completo, fecha de nacimiento y correo electrónico; después activamos provisionalmente tu inscripción y paquete, sujetos a la validación del comprobante.

En el recorrido operativo se guardaron los tres datos, se validó administrativamente el recibo sintético y se confirmó una sola reserva: saldo8→7. El duplicado del mismo mensaje no cambió reservas, modelos, entregas ni dinero.

## Pendiente resuelto en la app

Persona: hola.

Demi: ¡Hola! 😊 Tienes un paquete activo con 8 clases disponibles. ¿Quieres que te ayude a reservar una?

Este saludo se probó en el simulador con pendiente cerrado; la conciliación real tiene siete controles SQL de Sandbox aprobados.

## Responsabilidad sobre efectivo

Demi informó que recepción recibe y registra el efectivo. El alta de paquete de la alumna quedó por cobrar, con fecha23oct, sin pago ficticio por Demi. La primera reserva descontó1crédito; la segunda quedó bloqueada hasta que recepción registró el cobro sintético por la API administrativa. Después se confirmó la segunda reserva: saldo6, vigencia23oct–22nov conservada. La fecha pendiente de cobro se limpia al saldar; la fecha acordada sigue en la confirmación auditada.

## Decisión pendiente

Revisar si el trato y los pasos son los esperados y aprobar explícitamente el alcance. Producción y el piloto siguen sin autorización. El timeout histórico tiene un reintento seguro de lectura y pruebas concurrentes bajo8s; su causa física no se da por demostrada y queda en observación. El piloto de WhatsApp permanece bloqueado incluso al preparar esta promoción.
