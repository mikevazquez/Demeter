# Check-in por QR

## Regla vigente

El QR identifica **una reserva concreta**, no a la alumna de forma permanente.

- Cada reserva tiene un QR diferente.
- Si una reserva se cancela, su QR queda inválido.
- El QR contiene un token seguro asociado a la reserva, sin datos personales legibles.
- El check-in se abre 20 minutos antes de la hora de inicio y se cierra 30 minutos después de la hora de inicio.
- El backend valida la ventana; la interfaz no puede ampliarla.
- El QR de una reserva válida sigue disponible durante la ventana de check-in.

## Administración

Desde **Hoy**, administración abre el check-in y escanea el QR. El backend valida el token, estudio, reserva, clase, estado y ventana. Si todo es válido, registra la asistencia mediante el flujo canónico de Attendance.

Escanear dos veces el mismo QR no duplica efectos ni créditos: responde que la asistencia ya estaba registrada. Reservas canceladas, sesiones canceladas, reservas marcadas como no_show y códigos inválidos no se aceptan.

## Arquitectura

- Reservations es el origen del QR.
- Attendance conserva el estado de asistencia y su trazabilidad.
- El endpoint de kiosco delega la decisión al RPC check_in_reservation.
