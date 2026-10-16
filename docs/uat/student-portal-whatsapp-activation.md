# UAT — Activación de portal por WhatsApp Meta

**Entorno técnico:** Supabase Sandbox `hedouonyhynuvwbckdlg`  
**Tenant:** `demeter-fitness`  
**Rama:** `fix/student-portal-whatsapp-activation-20261016`  
**PR:** #312  
**UAT proveedor:** Producción, restringido a allowlist piloto `••••1878` por autorización explícita

## Gate previo

Plantilla verificada directamente en Meta:

- `bienvenida_alumna_portal`;
- estado `APPROVED`;
- idioma `es_MX`;
- categoría `UTILITY`;
- BODY con dos variables: nombre y URL;
- no usa botón dinámico.

El flujo UAT debe usar esta plantilla de forma aislada y solo puede enviar a la allowlist piloto configurada.

## Casos

| ID     | Tipo               | Escenario              | Esperado                                          |
| ------ | ------------------ | ---------------------- | ------------------------------------------------- |
| ACT-01 | Automatizado       | Contrato de código     | `provision-student-access` usa Meta y no Asistian |
| ACT-02 | Automatizado       | Config faltante        | El envío falla cerrado sin mandar URL incorrecta  |
| ACT-03 | Manual/Integración | Alta nueva             | Llega WhatsApp con liga de activación            |
| ACT-04 | Manual/Integración | Abrir liga            | Abre `/login/student/activar` con token válido    |
| ACT-05 | Manual/Integración | Crear contraseña       | La alumna completa activación y entra al portal   |
| ACT-06 | Manual/Integración | Reenvío                | Llega un nuevo enlace válido al mismo teléfono    |
| ACT-07 | Negativo           | Plantilla incompatible | No marcar como enviado; error rastreable          |
| ACT-08 | Seguridad          | Entorno                | Solo se permite el cambio UAT autorizado y envío al piloto              |
| ACT-09 | Regresión          | student_welcome        | No rompe otros usos de Meta WhatsApp              |

## Definition of Done

- CI del SHA probado en verde.
- Plantilla Meta verificada.
- Función compilada en Sandbox y promoción piloto limitada al destinatario autorizado.
- ACT-01 y ACT-02 automatizados en verde.
- ACT-03 a ACT-09 con evidencia del mismo SHA.
- UAT aprobado explícitamente.
- No habilitar rollout general a alumnas sin una autorización de promoción separada.
