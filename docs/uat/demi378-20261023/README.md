# DEMI-378 — evidencia de validación

Destino único: **Studio Flow Sandbox `hedouonyhynuvwbckdlg`**, PostgreSQL 17.6. PR [#380](https://github.com/mikevazquez/Demeter/pull/380). No se modificó producción, no se fusionó a main y no se activó ningún piloto/canal. La rama incorpora `main` `c03865e7` para conservar los cambios concurrentes de Talleres. Governance: se reutilizó [DEMI-BATCH-02](https://app.notion.com/p/3fcd78f71463819395e2f0d2273232c9) con el bloque DEMI-378/A–D y UAT definido antes de implementar.

## Superficies verificadas

| Evidencia                             | Resultado y alcance                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 17 aislado                 | 13 pruebas ejecutables: dos textos/timestamps iguales, entrada durante generación, entrada entre reserva/autorización, 12 sesiones concurrentes, replay, DB caída, red incierta, aceptación con registro fallido, lease abandonado/token antiguo, ledger de acciones, medios/contactos/estudios, máximo 12 s y ACL. Meta y efectos comerciales son dobles explícitos. |
| Webhook firmado local                 | Rutas generada y caché con flag activo, descarte durante generación, DB caída y rollback del flag sin resucitar intentos atómicos. Las regresiones anteriores ejecutan flag apagado.                                                                                                                                                                                  |
| Sandbox: concurrencia                 | 12 solicitudes independientes: 1 propietario y 11 busy. Reserva anterior invalidada por otra entrada; autorización vieja rechazada. [Traza](sandbox-evidence.json).                                                                                                                                                                                                   |
| Sandbox: cliente real de coordinación | 7 escenarios, incluyendo 6 sesiones competidoras, corte entre reserva/autorización, Meta simulado aceptado seguido de DB fallida, recuperación y ledger comercial simulado. [Resultado](sandbox-runtime.json).                                                                                                                                                        |
| Sandbox: webhook firmado real         | Código del webhook + cliente de coordinación + preparación real de identidad, historial y PostgreSQL de Sandbox; modelo y Meta capturados explícitamente. Dos textos conservados, un solo outbound persistido y replay sin otra entrega. Repetición final en [resultado](sandbox-webhook-final.json).                                                                 |
| Sandbox: operaciones nativas          | Las 5 variantes de `tests/demi-payment-flow-uat.sql` pasan: normal, tardía sin hold, clase pasada, clase llena y alternativa. Operaciones reales de DB con órdenes/pagos de proveedor simulados; reservas, pagos y créditos no se duplican. Todo en transacción con ROLLBACK. No acredita un cargo externo.                                                           |
| Talleres                              | Gate histórico de PostgreSQL: 77/77; conserva los handlers de main dentro del guard.                                                                                                                                                                                                                                                                                  |

El harness `scripts/demi378-sandbox-coordination-uat.mjs` no recibe credenciales: emite solicitudes JSON de SQL y consume respuestas por stdin, verificando el ID de Sandbox y el slug del tenant sintético. Se ejecutó mediante el conector SQL conectado. El modo `--webhook-only` repite el recorrido del webhook. La bandera se activa sólo dentro de ese proceso controlado; todos los providers/modelos se sustituyen por capturas. El arnés aislado se ejecuta con `DEMI378_PG_TESTS=1 npx vitest run tests/demi-turn-coordination-postgres-378.test.ts --maxWorkers=1` y forma parte de un job obligatorio de CI.

Tenant sintético conservado para trazabilidad: `8fb290c2-6411-4396-b7f9-f8eb8ade8868`, slug `demi378-concurrency-20261023`. Sin integraciones ni credenciales de proveedor. Los eventos, recibos y una acción deliberadamente incierta son fixtures; no borrar/reutilizar sus tokens para reintentar. Las pruebas financieras crean tenants sintéticos transaccionales y hacen rollback.

## Migraciones verificadas

| Archivo                                              | Versión aplicada en Sandbox                      |
| ---------------------------------------------------- | ------------------------------------------------ |
| `20261023183000_demi378_atomic_send_claims.sql`      | `20261023193554`                                 |
| `20261023194048_demi378_preserve_burst_deadline.sql` | `20261023194307`                                 |
| `20261023194826_demi378_service_role_acl.sql`        | Ver recibo y consulta en `schema-security.json`. |

Los nombres de versión del conector reflejan la hora de aplicación; los SHA256 de los archivos están en `source-manifest.txt`. Se verificó el esquema antes de aplicar: IDs UUID, timestamps timestamptz, contacto nullable y trigger de identidad existente conservado. El trigger nuevo ignora contactos nulos. Las tres tablas usan RLS; PUBLIC/anon/authenticated no pueden ejecutar las funciones nuevas; servicio carece de INSERT/UPDATE/DELETE directos. Los tres avisos INFO de RLS sin políticas son intencionales en tablas sin acceso de cliente; no se abrieron políticas para silenciarlos.

## Aceptación y límites

UAT técnico de coordinación y del webhook aprobado en las superficies indicadas. No hay cambio de interfaz, prompt ni regla comercial que requiera un nuevo juicio visual o comercial: la aceptación de este bloque es técnica. No se afirma una sesión nueva con el modelo real, entrega WhatsApp real, pago real ni aprobación humana independiente. Todos los envíos a Meta y cobros reales estuvieron excluidos por el encargo.

La autorización SQL es la frontera irreversible antes de Meta; no hay transacción distribuida. Los resultados inciertos y las acciones sin recibo requieren reconciliación manual, nunca reenvío/repetición automática. La espera de un worker ocupado depende de un webhook nuevo/reintentado; no se añadió un servicio de barrido permanente.

El CI final y el SHA exacto se registran en la conversación del PR; un resultado previo no certifica una cabeza posterior. Hasta que ese CI termine en verde, el bloque no se presenta listo para promoción. La autorización de producción continúa pendiente y separada, incluso tras UAT técnico verde.
