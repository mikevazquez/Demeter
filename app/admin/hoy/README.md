# Operación desde Hoy

Este bloque mantiene la pantalla **Hoy** como centro operativo para recepción e instructor.

- Abrir una clase no navega fuera de Hoy.
- El roster muestra reservas activas.
- La reserva inline usa `admin_book_student`, el mismo motor canónico de F7.
- La cancelación inline usa `admin_cancel_reservation`, incluida la regla de 8 horas.
- Un walk-in que ya es alumna sigue las reglas normales de paquete, disciplina, cupo y créditos.
- Alta de una persona nueva y cobro/clase de prueba quedan separados del motor de reserva hasta definir el flujo comercial correspondiente; no se inventa una adquisición fuera de F9.
- Registro de asistencia/no-show pertenece a F8 y no se implementa anticipadamente aquí.
