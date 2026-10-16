## Continuación autorizada: misma tarea, ejecutor de la sesión actual

El propietario autorizó expresamente: «Hagámoslo así en lo que resuelvo el inicio de sesion», aceptando usar esta sesión de Codex como ejecutor supervisado.

Se conserva el ID `governante-codex-local-20261015-v1`, el archivo `tests/automation/fixtures/governante-codex-local-proof.mjs`, su objeto esperado y todos los límites de no producción/costos. Se sustituye únicamente el transporte de generación: el agente Codex de esta conversación escribe el archivo admitido; no se lanza otra CLI ni se resetea su reserva consumida. El intento anterior 401 y sus hashes permanecen en el historial.

Esta continuación acreditará una ejecución supervisada por el usuario y verificación determinista en un clon separado. No acreditará delegación automática entre agentes, autenticación reparada de la CLI ni jobs de Actions. No se presenta como un segundo agente independiente: el certificado provendrá de un proceso de verificación aislado reconstruido desde el SHA original.

La admisión se revalidará contra el issue vivo y su nuevo updated_at. Antes de generar se persistirán el contrato y la autorización de esta modalidad; la selección volverá a fijarse mediante `CODEX_PILOT_TASK_ID` y límite 1. Ninguna de las otras cuatro tareas de la cola cambia ni se ejecuta.

El resultado solo podrá publicarse como un Draft con un único archivo contra la rama de integración de #304. Sin cambios en main/control, producción, datos, secretos/permisos, suscripciones, API keys o promoción.
