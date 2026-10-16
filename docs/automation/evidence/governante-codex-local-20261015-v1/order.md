## Piloto Gobernante → Codex local autorizado

El propietario autorizó en esta conversación la ejecución local con la sesión incluida de Codex, certificación en checkout separado y publicación Draft con evidencias GitHub. No se atribuirán jobs de Actions a estas etapas.

ID único: `governante-codex-local-20261015-v1`.
Producto: Studio Flow. Responsable: codex-1.
Fuente de implementación: PR #304, SHA `2af9188523c5e18bed2d647092c3395c6f428cd9`.
Un único archivo permitido: `tests/automation/fixtures/governante-codex-local-proof.mjs`.

Crear un módulo ESM de texto, sin imports, llamadas a servicios, acceso a entorno, I/O ni otros efectos. Exportar únicamente la constante `pilotProof`, congelada con `Object.freeze`, con exactamente estos campos:
- marker: `GOVERNANTE-CODEX-LOCAL-V1`
- taskId: `governante-codex-local-20261015-v1`
- selectionLimit: 1
- execution: `local-chatgpt`
- productionAuthorized: false

Incluir un comentario que identifique el archivo como fixture sintético: el objeto por sí mismo no acredita ejecución de Codex, selección ni certificación. La evidencia será el registro real de las etapas y sus hashes.

Definition of Done:
1. Admitir el contrato mediante el adaptador existente de #304 y verificar issue/hash/updated_at.
2. Conservar las cuatro tareas originales en el manifiesto aislado; fijar `CODEX_PILOT_TASK_ID` al ID de arriba y `maxTasksPerRun=1`. La cola de control no cambia.
3. Registrar el contrato y una reserva local persistente en GitHub antes de la generación; máximo una invocación de Codex para esta tarea. No reutilizar el ID para una nueva generación.
4. Generación real con la sesión ChatGPT existente, sin API keys, compras ni transferencia de credenciales. Solicitar salida JSON de texto, sin herramientas del modelo ni escrituras del modelo al repositorio.
5. Validar y materializar solo la ruta admitida. Certificar exactamente esos bytes en un clon nuevo del SHA fuente, con pruebas sin red, sin credenciales y sin acceso al home de Codex.
6. Publicar un único Draft contra la rama de integración de #304, nunca contra main. La diferencia del Draft será únicamente el fixture certificado.
7. Repetir la selección y comprobar cero tareas nuevas; conservar evidencia del SHA, issue, contrato, selección, proceso de Codex, pruebas, certificación, publicación y límites de esta modalidad local.

Exclusiones: no producción, app, datos, Supabase, Vercel, secretos, cambios de permisos, main, rama de control, merges, despliegues, cobros, nuevas suscripciones o mensajes a terceros. No contar evidencia histórica de #300/#301 ni declarar jobs de Actions exitosos. El publicador corre separado del modelo y no ejecuta código generado.
