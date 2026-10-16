# UAT — Activación de portal por WhatsApp Meta

**Entorno:** Supabase Sandbox `hedouonyhynuvwbckdlg`  
**Tenant:** `demeter-fitness`  
**Rama:** `fix/student-portal-whatsapp-activation-20261016`  
**PR:** #312  
**Producción:** fuera de alcance

## Gate previo

No ejecutar envío real hasta confirmar que la plantilla Meta configurada para `student_welcome`:

- está aprobada;
- usa botón URL dinámico en índice 0;
- tiene como base exacta la ruta HTTPS `/login/student/activar`;
- acepta el sufijo dinámico que contiene `token_hash` y `type=recovery`.

## Casos

| ID | Tipo | Escenario | Esperado |
| --- | --- | --- | --- |
| ACT-01 | Automatizado | Contrato de código | `provision-student-access` usa Meta y no Asistian |
| ACT-02 | Automatizado | Config faltante | El envío falla cerrado sin mandar URL incorrecta |
| ACT-03 | Manual/Integración | Alta nueva | Llega WhatsApp con botón de activación |
| ACT-04 | Manual/Integración | Abrir botón | Abre `/login/student/activar` con token válido |
| ACT-05 | Manual/Integración | Crear contraseña | La alumna completa activación y entra al portal |
| ACT-06 | Manual/Integración | Reenvío | Llega un nuevo enlace válido al mismo teléfono |
| ACT-07 | Negativo | Plantilla incompatible | No marcar como enviado; error rastreable |
| ACT-08 | Seguridad | Entorno | Ningún envío ni cambio en producción |
| ACT-09 | Regresión | student_welcome | No rompe otros usos de Meta WhatsApp |

## Definition of Done

- CI del SHA probado en verde.
- Plantilla Meta verificada.
- Función desplegada únicamente en Sandbox.
- ACT-01 y ACT-02 automatizados en verde.
- ACT-03 a ACT-09 con evidencia del mismo SHA.
- UAT aprobado explícitamente.
- Producción continúa bloqueada hasta `Autorizo promoción`.
