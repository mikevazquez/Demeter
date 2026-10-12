# TALLERES-01 · Talleres y eventos con fechas concretas

Entorno: Studio Flow Sandbox, Supabase `hedouonyhynuvwbckdlg`.
Rama: `feat/workshops-events-20261012`, basada en main `5d2e163e`.
Producción: sin modificaciones. UAT de Mike pendiente; promoción sin autorizar.

## Comportamiento

- Nueva actividad ofrece clase normal, taller/curso y evento especial.
- Clase normal conserva el creador semanal actual.
- Taller/evento usa un programa de 1 a 100 fechas concretas.
- Cada fecha indica disciplina, horario, duración, capacidad, coach y espacio.
- Se puede repetir disciplina o elegir una diferente por fecha.
- Una fecha vende solo el completo. Varias fechas pueden habilitar venta por día con precio por fecha.
- La inscripción administrativa registra pago completo recibido (efectivo o transferencia ya verificada).
- Compra completa: venta, pago y todas las reservas en una transacción. Si una fecha está llena, ya pasó o está cancelada, falla sin registros parciales.
- Compra por día: venta y reserva únicamente de la fecha elegida.
- Ambas compras comparten el mismo cupo de Agenda.
- No se pueden usar paquetes regulares para acceder al taller, ni usar una compra por día en otra fecha.
- Reintentar una inscripción con la misma clave devuelve su venta original.
- Se conservan los mecanismos existentes de inscripción, documentos, cancelaciones, créditos, roster e históricos. No se eliminan ventas/reservas.

## Alcance de esta versión

El pago e inscripción se operan desde administración, en el detalle del programa. No se agregó checkout autónomo al portal ni venta conversacional por Demi. Los productos del programa se ocultan a Demi y las ventas genéricas están bloqueadas para evitar vender sin asegurar cupo.
Los programas se crean y se consultan; las sesiones individuales se abren desde Agenda. No se implementó edición masiva de un programa ya vendido.

## Validación automatizada

19 pruebas unitarias/regresión pasaron. TypeScript, ESLint, formato de archivos modificados y compilación completa de Next.js pasaron.
Las pruebas siguientes se ejecutaron contra la base Sandbox dentro de una transacción revertida, con estudio, alumnas, ventas y reservas ficticias; no se enviaron mensajes reales ni se persistieron operaciones comerciales de prueba.

| Caso | Validación                                                 | Resultado técnico | UAT de Mike |
| ---- | ---------------------------------------------------------- | ----------------- | ----------- |
| T01  | evento de un día, tres horas, solo precio completo         | Pasó              | Pendiente   |
| T02  | cinco fechas, misma disciplina                             | Pasó              | Pendiente   |
| T03  | cinco fechas, disciplinas alternas, cinco sesiones reales  | Pasó              | Pendiente   |
| T04  | completo registra pago exacto y cinco reservas             | Pasó              | Pendiente   |
| T05  | compra suelta paga una fecha y reserva un lugar            | Pasó              | Pendiente   |
| T06  | cupo compartido, una fecha llena revierte toda la compra   | Pasó              | Pendiente   |
| T07  | fecha duplicada rechazada sin programa parcial             | Pasó              | Pendiente   |
| T08  | venta genérica no puede prometer cupo sin reservar         | Pasó              | Pendiente   |
| T09  | paquete regular no permite acceso a taller                 | Pasó              | Pendiente   |
| T10  | reintento de inscripción devuelve la misma venta           | Pasó              | Pendiente   |
| T11  | RPC sin autenticación rechazada                            | Pasó              | Pendiente   |
| T12  | usuario sin membresía del estudio no puede crear programas | Pasó              | Pendiente   |
| T13  | clase normal conserva reserva y créditos 8 a 7             | Pasó              | Pendiente   |
| T14  | compra suelta no permite otra fecha del mismo taller       | Pasó              | Pendiente   |

## Preview bloqueado

La revisión automática rechazó subir la rama al repositorio público oficial `mikevazquez/Demeter`, aun después de verificar propietario, permisos, URL del remote y ausencia de secretos en el diff. Motivo: publicar código y migraciones nuevos requiere autorización explícita de divulgación externa. No se eludió el rechazo por otra API. Falta autorización para subir esta rama y generar el preview conectado a Sandbox; no es autorización de producción.

## Revisión visual pendiente

- Abrir Nueva actividad y elegir los tres tipos.
- Crear programa, comprobar sesiones de Agenda y resumen de precios/cupo.
- Registrar inscripción completa y suelta desde el detalle.
- Revisar las reservas en el portal de la alumna.
- Revisar presentación en móvil.

## Promoción y reversión

No promover hasta cerrar revisión visual, UAT del usuario y recibir autorización explícita para este alcance/version.
Las migraciones son aditivas. Reversión funcional: retirar navegación al módulo y desactivar nuevas ventas de programas; conservar tablas, ventas, pagos, reservas y auditoría. No ejecutar DROP ni borrar datos para revertir.
Los RPC de creación e inscripción usan SECURITY DEFINER intencionalmente para transacciones sin permisos de escritura directa, con auth.uid, capacidades y comprobación de pertenencia al estudio; EXECUTE está revocado a anon/PUBLIC. Las tablas tienen RLS y SELECT por capacidades.
