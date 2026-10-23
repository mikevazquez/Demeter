# Demi · corrección y nueva comparación · 21 oct 2026

**El umbral de latencia total pasa en esta muestra; el bloque no queda aprobado.**
Consultas y acciones conservan regresiones de mediana y la salida sigue por encima
de la base. S03 sin vencimiento, seguimientos auxiliares y UAT funcional pendientes.
No se reemplaza el resultado fallido de01d8d9cb por esta corrida distinta.

## Versión y cambio

- Entorno: **Studio Flow Sandbox `hedouonyhynuvwbckdlg`**.
- Rama `codex/demi-latency-recovery-20261021`, [PR #364](https://github.com/mikevazquez/Demeter/pull/364), borrador.
- Base de desarrollo `c164924c2434889a4e4d7357b8f8434aae05abb2` (#363).
- Runtime probado **`4cc41e2247e60f6e01ddb81f5946bf3f4bdc3288`**.
- [Preview del runtime](https://demeterbueno-169ws0ykm-demeter3.vercel.app/admin/mas/demi),
  deployment `dpl_7FYTcF92YNCk12f6ry3oZ9kcL8P4`, READY.
- Stack pendiente: #356→#358→#359→#360→#361→#363→#364. #362 conserva aparte el
  ajuste exclusivo de fixture SQL. Ningún PR integrado.

Saludos y agradecimientos conservan automáticamente la memoria existente y
responden en texto, sin pedir al modelo generar otra memoria ni escribirla.
Mantienen las lecturas actuales de derechos/reservas y la barrera de acciones.
Los cambios de preferencias siguen usando memoria estructurada. La respuesta de
GPT-5 usa verbosidad baja; modelos anteriores conservan compatibilidad. Se aclara
el límite ya existente de14 días inclusivos en la herramienta de horarios, sin
cambiar su validación. No cambia la personalidad versionada, el modelo ni el
razonamiento configurado.

Cuatro archivos de código/prueba cambiados respecto de c164924c,83 líneas
agregadas/6 eliminadas. Local: **1.733/1.733 pruebas**, cero fallos; tipos, formato
y lint pasan (cero errores, aviso preexistente). [CI39681169906](https://github.com/mikevazquez/Demeter/actions/runs/39681169906)
**SUCCESS** en runtime4cc41e22: formato/lint/tipos/suite completa comparada
(cero fallos en base/candidata, cero pruebas eliminadas)/build. Supervisor39681169924
success. El commit que conserve estos archivos de evidencia sólo cambia docs.

## Método

`protocol-4cc41e22.json` conserva casos, estados e historial sembrado.

- Base runtime `bfd395e11e6bb54f2841a3c3c1f3b6a0d8863cd9`, Preview
  `8c551473f6ffdcca07e57741bf74a0cc4bf416e5` /
  `demeterbueno-qbysmk4fh-demeter3.vercel.app`; se comprobó igualdad de assistant y
  workbench-actions respecto de la base.
- Candidata exacta4cc41e22, sin atribuirle las métricas de01d8d9cb.
- Mismo workbench autenticado, tenant `d0357e3d-f962-4628-8ba8-a401708b6157`,
  run `f476451f-bc32-4139-a7c3-7a6dbcd18c60`, catálogo, casos/personas/estados y
  configuración `gpt-5.6-luna` / razonamiento `medium`.
- Instrucciones por variante preservadas: base hash
  `b52a02c38f1a8210c2afebb057c690aaad9183ed03452b8739774a8bf26c1047`, candidata
  `c194bffd2ae14111805ddef8ad841854078eabe8cd954bc5c119dd88f4b6ffb2`.
- Una prueba previa/calentamiento por versión, ambas válidas y guardadas aparte
  en `preflight-4cc41e22.json`, antes de la muestra declarada.
- **60 conversaciones nuevas**, S01–S10×3/versión; pares AB/BA alternados por caso,
  secuencialmente. Ningún otro ensayo con modelo en paralelo. C03 y banco se
  ejecutaron después. **Sin descartes:30/30 por versión, todos HTTP200/ok:true.**
- Duración total de petición del workbench, con red/modelo/herramientas; no es
  latencia de WhatsApp. p95 nearest-rank `ceil(0.95*n)`: con n3 por caso y n18
  consultas coincide con el máximo. Tokens = suma de `output_tokens` de todas las
  llamadas del turno, incluido razonamiento según proveedor, no sólo texto visible.

## Latencia y tokens

| Tipo             | n/versión | Base mediana/p95 s | Candidata mediana/p95 s | Salida base/candidata | Comparativo           |
| ---------------- | --------- | ------------------ | ----------------------- | --------------------- | --------------------- |
| Saludo S01–S02   | 6         | 4,260 /11,369      | 3,336 /5,054            | 175 /500              | PASA ambas duraciones |
| Consulta S03–S08 | 18        | 7,373 /16,342      | 7,540 /11,877           | 3.653 /4.025          | REGRESIÓN mediana     |
| Acción S09–S10   | 6         | 8,260 /12,314      | 8,668 /11,622           | 1.124 /1.352          | REGRESIÓN mediana     |
| Total            | 30        | 7,746 /12,314      | 6,793 /11,622           | 4.952 /5.877          | PASA umbral agregado  |

| Caso (n3/versión) | Base mediana/p95 s | Candidata mediana/p95 s | Salida base/candidata | Comparativo de duraciones         |
| ----------------- | ------------------ | ----------------------- | --------------------- | --------------------------------- |
| S01               | 4,388 /8,035       | 3,045 /3,284            | 64 /79                | PASA                              |
| S02               | 4,132 /11,369      | 4,518 /5,054            | 111 /421              | REGRESIÓN mediana                 |
| S03               | 6,950 /7,107       | 4,930 /5,509            | 625 /370              | PASA latencia; vigencia BLOQUEADA |
| S04               | 6,850 /16,342      | 9,041 /11,877           | 539 /680              | REGRESIÓN mediana                 |
| S05               | 8,340 /11,951      | 8,510 /9,243            | 902 /855              | REGRESIÓN mediana                 |
| S06               | 6,441 /8,476       | 9,579 /11,142           | 366 /642              | REGRESIÓN ambas                   |
| S07               | 8,638 /9,869       | 8,603 /8,628            | 751 /927              | PASA                              |
| S08               | 6,473 /7,882       | 4,644 /6,845            | 470 /551              | PASA                              |
| S09               | 8,003 /12,314      | 9,157 /9,858            | 551 /824              | REGRESIÓN mediana                 |
| S10               | 8,517 /11,322      | 8,178 /11,622           | 573 /528              | REGRESIÓN p95                     |

Total: **mediana−12,3%; p95−5,6%; salida+18,7% respecto de la base contemporánea**.
Base59 llamadas de modelo, candidata50. Consultas/acciones tienen mediana mayor;
no se declaran aprobados esos comparativos. La cifra de salida5.877 es menor que
los7.272 de la candidata fallida anterior, pero son corridas distintas y no prueba
una reducción de costo frente a la base actual. La base actual también fue más
lenta que la histórica6,418/11,673s: se acredita el umbral agregado de esta muestra,
no una mejora estable en cualquier carga ni aprobación integral de velocidad.

Calidad observada: S01 usa paquete activo; S02 retoma el historial sintético sin
bancos (no certifica pendiente operativo). S03 devuelve8 y reconoce vencimiento
desconocido: **fecha BLOQUEADA porque el fixture no la expone**. S04–S07 respetan
actividad/fechas/rangos; S08 ofrece efectivo sin reserva/cupo3/3 (la base omite
esa alternativa3/3). S09/S10 sólo preparan acciones simuladas y piden confirmación.
Todas las acciones auditadas tienen simulated=true y ninguna entidad real afectada.

Datos: `speed-alternated-4cc41e22.json`, `speed-summary-4cc41e22.json`,
`speed-assistant_model_calls.json`, `speed-assistant_tool_executions.json`.

## C03: PASA

Conversación `12457c26-dc61-4ba7-9c54-95e310bd1878`, runtime4cc41e22:

1. Guarda Pole/jueves desde18.
2. Tras16 mensajes neutros sintéticos, retoma jueves22 a18 sin volver a preguntar.
3. Corrige a viernes: memoria y respuesta pasan a viernes23.
4. «Gracias» mantiene exactamente campos y turn_id del tercer turno.
5. Tras otros16 mensajes neutros, conserva viernes23.

Cinco turnos con modelo y32 filas de relleno explícito. Cuatro búsquedas ejecutadas,
**cero bloqueos por rango**, frente a tres en C03 de01d8d9cb; no se alteró el límite.
No hubo acciones de negocio. Se inspeccionó memoria persistida, no el JSON crudo
del proveedor. Archivos `c03-live-4cc41e22.json` y `c03-tools-4cc41e22.json`.

## Regresión comercial S11–S15: PASA criterios del banco

Demo `54dd112f-12ab-4e77-928c-877b12276eb2` /
run `66f7d517-5aff-44e7-96b6-ce15db70b7ba`. Selector de UI comprobado y12 turnos
por la misma acción autenticada del workbench, todos HTTP200/ok:true.

| Caso     | Resultado observado en4cc41e22                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| S11 PASA | Pase499, inscripción incluida; sin pedir datos ni sustituir producto                                                          |
| S12 PASA | 600+200=800; negativa no prepara; aceptación prepara; comprobante pide tres datos; perfil válido activa sólo provisionalmente |
| S13 PASA | Tras comprobante sembrado pide nombre/nacimiento/correo; completa perfil y activa provisionalmente, sin otro cobro            |
| S14 PASA | Alumna sin inscripción mismo desglose; comprobante reconocido, paquete e inscripción provisionales, sin pedir otro archivo    |
| S15 PASA | Hola con cobro viejo/pendiente cerrado responde paquete activo8; cero herramientas y sin mencionar pago/bancos                |

**Cuatro intentos auxiliares update_contact_followup BLOQUEADOS** por
simulation_not_supported; no se acredita seguimiento/envío. Los dos bloqueos de
preparación enrollment_confirmation_required son esperados antes de aceptar.
El banco no acredita efectos operativos reales. Respuestas, estados y herramientas
en los archivos `bank-*4cc41e22.json`.

## Limpieza, límites y siguiente acción

Cuenta sintética nueva `5a6b9730-4969-4651-b858-e35068414a87` ya disabled/banned;
cero membresías activas/sesiones/refresh tokens. Login posterior400/user_banned;
navegador anterior vuelve a `/login/studio`. Se borraron seis archivos privados de
acceso. La cuenta anterior sigue revocada. Demo y conversaciones retenidos como
evidencia; no contienen identidades reales del usuario.

Auditoría en ambos tenants desde21:44: cero filas nuevas en las siete tablas de
negocio detalladas en `uat-access-cleanup-4cc41e22.json`. Se dejó artefacto de
revocación en el run del demo. SQL anterior7+4+7 conserva su evidencia de
b0d0b7a/fixturec3d6795c; no se repitieron migraciones ni se cambiaron reglas.

**Siguiente acción:** revisar las regresiones de consultas/acciones y el exceso de
salida; preparar fixture con vencimiento y resolver/certificar el seguimiento por
su superficie admitida. Una siguiente candidata requiere nuevo SHA/CI/Preview y
comparación alternada, sin descartar esta corrida ni la anterior. UAT funcional
de Mike y criterios operativos siguen pendientes. UAT-01 y Release permanecen
**No aprobados / No listo**; no se cierra la tarea por el total agregado.

Producción `qfhojvgvhrbautvczffq`, sus despliegues/variables, canales/adapters sin
cambios. DEMI-PILOT-01 bloqueado e inactivo. Ninguna integración de PR.
