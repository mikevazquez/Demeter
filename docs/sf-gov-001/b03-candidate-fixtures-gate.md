# SF-GOV-001 / B03 — Control de habilitación de fixtures Candidate

Estado: **PREPARACIÓN**. No constituye permiso para escribir ni crear identidades. Fuente de verdad: Notion SF-GOV-001, GitHub #288. PR #278 permanece DRAFT; #289 bloquea toda promoción.

## Condiciones técnicas previas, todas obligatorias
1. Target exacto: Supabase Candidate `sdmxtlgjkodidjtvikng`, NO Sandbox ni Producción. Verificar origen, branch, SHA y deployment de aplicación que se usará en UAT. Rechazar cualquier target ambiguo.
2. Identidades: únicamente correo con sufijo `.invalid`; prohibido invitar, enviar correo, activar signup público o resetear passwords de cuentas existentes. El bootstrap B02 se retiró permanentemente; no reutilizarlo.
3. Aprovisionamiento: encontrar un flujo Auth Admin API oficialmente permitido que cree usuarios *confirmados sin email* y esté limitado por allowlist de identities, target, tiempo y SHA. Ningún paso debe aceptar service_role en cliente ni exponer secretos en logs. Primero validar ese método de punta a punta sin escritura ni comunicación.
4. Integraciones: confirmar default-deny efectivo, a nivel de runtime **y** credenciales, para Meta, OpenAI, Mercado Pago, Resend/SendGrid, webhooks, crons, workers y cualquier SDK dinámico; no asumir bloqueo por nombre de entorno. Prohibidas comunicaciones, transacciones monetarias o eventos reales.
5. Tenant: usar dos estudios **nuevos, con prefijo `sf-gov-b03-`** y IDs vinculados a una misma ejecución; no escribir ni cambiar el tenant Demeter ni sus registros. El acceso multitenant debe probarse también con JWT legítimo de ambas identidades, no solo con `SET ROLE`.
6. Observabilidad: auditar el actor, IDs sintéticos, request IDs, digest del SHA, hora, configuración de outbound, estado previo y posterior y los códigos 200/403/404 esperados; no persistir passwords/secretos/tokens.
7. Reversión: evitar borrar sin verificar relaciones y auditoría. Preparar inventario de dependencias, cleanup de datos sintéticos bajo owner controlado, expiración/revocación de sesiones y firma de cierre. Si no es reversible, detener.
8. El rechazo de la herramienta a una transacción con INSERT + ROLLBACK fue un límite de seguridad; **NO** repetirlo con otra forma de SQL, migration, Edge o shell para evitar la restricción.

## Casos que habilitaría (solo tras pasar todos los gates)
- B03-A02: admin Tenant A puede consultar solo su estudio/capabilities.
- B03-A03: alumna Tenant A solo su portal, su propio perfil; denegación admin.
- B03-A04: cookie y URL hacia Tenant B devuelven 403/404 y cero registros ajenos; tenant A permanece visible.
- B03-A05: sesión inválida y acceso sin membresía denegados.
- B03-A07: no se generan eventos externos.
- Repetir con SHA y Candidate Preview exactos, tomar request IDs y capturas de evidencias.

## Estado al 15-oct-2026
- Candidate: un estudio y ninguna membresía en último SELECT; una identidad Auth sintética histórica sin membresía.
- Negativas RLS de identidad sin membresía: ejecutadas en Candidate read-only.
- Simulación positiva con dos tenants: **PGlite en memoria**, CI #3385 SUCCESS, **no** UAT real Candidate.
- Fixture Candidate: **BLOCKED**, falta un mecanismo de aprovisionamiento permitido y evidencia de aislamiento outbound completo.
- Producción: prohibida hasta autorización expresa del Product Owner `Autorizo promoción` vinculada a SHA/destino/alcance y cierre independiente de #289.

## Criterio de salida
No declarar B03-A02/A03/A04 `passed` hasta conseguir ejecución HTTP/DB autenticada en Candidate, mismo SHA/entorno, evidencia positiva y negativa, monitoreo de efectos y cleanup verificado. De ser inviable el método seguro, mantener `blocked` y trabajar cobertura estática/dinámica independiente.
