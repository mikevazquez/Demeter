# Futuro · Check-in por QR

Estado: **decisión funcional aprobada**. No forma parte de F9 ni debe implementarse durante el cierre actual de F9.

## Objetivo

Permitir que cada reserva confirmada genere un QR único y que administración pueda escanearlo para registrar automáticamente la asistencia reutilizando el motor de Attendance ya existente.

## Regla principal

El QR identifica **una reserva concreta**, no a la alumna de forma permanente.

- Una alumna con varias reservas tendrá un QR diferente por reserva.
- Si una reserva se cancela, su QR queda inválido.
- El QR no debe contener nombre, teléfono, correo ni otros datos personales legibles.
- El QR debe contener únicamente un token aleatorio/seguro asociado a la reserva.

## Portal de alumna

En la próxima clase reservada debe existir una acción tipo **Mostrar QR**.

Ejemplo:

- Pole Fitness · Hoy 19:00
- Reserva confirmada
- Mostrar QR

## Administración

Dentro de **Hoy** debe existir una acción **Abrir check-in**.

Al abrirla:

1. Se activa la cámara del dispositivo.
2. Se escanea el QR de la alumna.
3. El backend valida token, estudio, reserva, clase, estado y ventana permitida.
4. Si todo es válido, registra `attended` usando el mismo flujo/servicio canónico de asistencia de F8.
5. La interfaz muestra una confirmación clara, por ejemplo: `✓ Check-in registrado · Ana López · Pole Fitness · 19:00`.

## Idempotencia y correcciones

- Escanear dos veces el mismo QR no debe duplicar efectos ni créditos; debe responder `Asistencia ya registrada`.
- Si la reserva ya fue marcada `no_show`, un escaneo posterior no debe modificarla silenciosamente; debe entrar al flujo de **Corrección** con trazabilidad definido en F8.
- Una sesión ya finalizada no acepta check-in normal.

## Ventana de check-in

Debe ser configurable por estudio.

Valor inicial sugerido para el MVP futuro:

- desde 30 minutos antes del inicio;
- hasta 20 minutos después del inicio.

La validación debe ocurrir en backend, no sólo en UI.

## Casos inválidos

El sistema debe rechazar y explicar como mínimo:

- QR de reserva cancelada;
- QR inexistente o manipulado;
- QR de otro estudio;
- QR fuera de la ventana de check-in;
- sesión cancelada;
- sesión finalizada;
- QR válido ya registrado, mostrando estado idempotente y no un error genérico.

## Modo kiosco futuro

Debe contemplarse un modo opcional para recepción con un iPad/tablet fijo:

1. cámara siempre lista para escanear;
2. alumna muestra su QR;
3. pantalla muestra durante unos segundos nombre, clase y `CHECK-IN EXITOSO ✓`;
4. vuelve automáticamente al escáner.

Este modo debe reutilizar exactamente las mismas reglas y API de check-in; no debe existir un motor paralelo de asistencia.

## Arquitectura esperada

La futura implementación debe reutilizar:

- Reservations como origen del QR;
- Attendance/F8 como estado de asistencia;
- las mismas reglas de corrección y trazabilidad de F8;
- permisos de administración para abrir el escáner/check-in.

No crear un sistema de asistencia independiente sólo para QR.
