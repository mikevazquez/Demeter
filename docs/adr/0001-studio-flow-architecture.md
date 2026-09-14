# ADR 0001 · Arquitectura base de Studio Flow

- Estado: Aceptada
- Fecha: 2026-09-14
- Fuente: Documento Maestro TOTAL v3

## Contexto

Studio Flow debe operar estudios boutique de movimiento/fitness usando Demeter Fitness Studio como tenant inicial, sin impedir multiestudio futuro y sin introducir complejidad SaaS prematura.

## Decisión

### Aplicación

- Frontend: Next.js 16 + React 19 + TypeScript + Tailwind CSS.
- Arquitectura: monolito modular.
- Backend de aplicación: Server Actions y capa application/domain dentro del mismo producto desplegable.
- Responsive web desde el inicio; evolución PWA dentro del MVP/hardening.

### Datos

- PostgreSQL alojado en Supabase.
- Todo dato de negocio tenant-scoped pertenece a un studio.
- Separación conceptual obligatoria entre identidad/cuenta y perfiles operativos.
- `Student` e `Instructor` no equivalen a `auth.users`.
- Una persona puede existir sin credenciales.

### Identidad y autorización

- Supabase Auth.
- Roles/capabilities sobre la membresía del estudio.
- RLS como última barrera de autorización.
- Las acciones de servidor vuelven a validar permisos; ocultar un botón en UI no es autorización.
- No usar `user_metadata` como fuente de roles.
- No exponer `service_role` ni secretos al cliente/repo.

### Dominios

- Identity & Access
- People
- Scheduling
- Commercial
- Credits
- Booking
- Attendance
- Compliance
- Reporting
- Platform

Los dominios comparten una única fuente de verdad. No se duplican reglas de reserva/crédito/asistencia por canal.

### Integraciones

- Vercel para hosting.
- Supabase Storage sólo cuando sea necesario.
- Outbox previsto para integraciones/eventos futuros.
- WhatsApp/Demi, checkout y OTP avanzado pertenecen a evolución 2.0, no al núcleo inicial.

## Consecuencias

- Se prioriza consistencia del dominio frente a velocidad de crear pantallas aisladas.
- Las fases deben seguir el roadmap F0→F14 y sus dependencias.
- Todo cambio que contradiga el Documento Maestro debe registrarse como cambio de alcance.
- Cada pantalla se considera terminada sólo con funcionalidad, UX/UI, responsive, permisos, estados y QA aplicables.

## Decisiones específicas del MVP

- Admin: acceso privado con credenciales autorizadas.
- Alumna MVP: teléfono + contraseña.
- Alumna 2.0: OTP/autoregistro.
- Teléfono de alumna: obligatorio, normalizado a E.164, pero nunca usado como PK/ID universal.
- No borrado operativo de alumnas: archivar/reactivar.
- Créditos: ledger como fuente auditable; no sólo contador mutable.
