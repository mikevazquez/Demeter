# UAT funcional — abonos de Talleres dentro de Agenda

**Entorno:** Solo Sandbox Supabase `hedouonyhynuvwbckdlg` / preview Vercel `https://demeterbueno-dcoq7h46u-demeter3.vercel.app`.
**Rama/PR:** `feat/talleres-saldos-configurables-uat` / #284.
**SHA verificado READY al preparar:** `24386a87febcbaa7a9365c71e29d4d478c41554d`.
**Estado:** PREPARADO. Los casos funcionales se encuentran **NO EJECUTADOS**. No promover a producción.

## Datos sintéticos ya existentes (no crear pantallas ni alumnos adicionales)

**Fixture A — abono pendiente (para TALL-10).**
- Alumna: `UAT TALL Synthetic Buyer`.
- Sesión Agenda: `/admin/agenda/38f8b939-3d2f-42ca-a313-7c32de6b4726` (2026-11-13 05:48 UTC).
- Reserva `fc0bc539-f7ed-4ccf-b93b-ced768ad15b3`.
- Venta `080f5a7c-8d3f-4abd-b77b-6be37a7f2569`.
- Precio $600 MXN, recibido $300, saldo inicial **$300**.

**Fixture B — liquidado (control negativo visual).**
- Misma alumna sintética, *otra compra*.
- Sesión Agenda: `/admin/agenda/25e4a80d-4b8c-4986-9d8a-20530c3d54cb` (2026-11-28 06:18 UTC).
- Reserva `4831cda8-0e90-4cff-9e3e-d04d6c6aa146`.
- Venta `6347498c-82f3-4f7e-8525-0c76b13b06d6`.
- Precio $600 MXN, recibido $600, saldo **$0**.

**Fixture C — sesión individual pagada (control negativo visual).**
- Alumna: `UAT Luna Prueba técnica`.
- Sesión Agenda: `/admin/agenda/8c744fbd-7f18-41e0-8f1e-fb2ae5c00711`.
- Reserva `0fd4275d-7637-4a8c-bfca-28b02426f386`.
- Venta `eb6f62a4-44df-4da8-9cb3-44797e7fdacf`.
- Precio $150 MXN, saldo **$0**.

## Ejecución visual manual / browser autenticado

Abrir el preview de Sandbox, iniciar sesión de administración de **Sandbox** (no producción), entrar por las rutas arriba. No realizar un cobro real a alumna real. Como los pagos de pruebas funcionales crean registros financieros auditablemente persistentes, ejecutar los pasos de escritura **solo cuando se confirme que es seguro registrar pagos ficticios** en la venta sintética. No borrar el historial a mano.

| ID | Preparación / acción | Resultado esperado | Estado inicial |
| --- | --- | --- | --- |
| AB-01 | Abrir fixture A desde tarjeta de Agenda | Alumna y saldo $300 visibles; botón Registrar abono dentro de la tarjeta | NO EJECUTADO |
| AB-02 | Abrir Registrar abono | Formulario modal en la misma sesión; monto, método y referencia | NO EJECUTADO |
| AB-03 | Confirmar abono ficticio $100 con referencia única `UAT-AB-03-<runid>` | Un movimiento de $100, saldo $200, venta y compra sincronizadas, sin pantalla adicional | NO EJECUTADO |
| AB-04 | Reenviar referencia de AB-03 | Error de duplicado; sin segundo pago ni cambio de saldo | NO EJECUTADO |
| AB-05 | Intentar abono $201 (si AB-03 pasó) | Servidor rechaza excedente; sin movimiento | NO EJECUTADO |
| AB-06 | Abonar $200 con referencia distinta | Saldo $0, estado liquidado, botón de abono oculto | NO EJECUTADO |
| AB-07 | Abrir fixture B | Estado liquidado; no mostrar cobro, sí asistencia | NO EJECUTADO |
| AB-08 | Abrir fixture C | Individual pagada; no mostrar cobro, sí asistencia | NO EJECUTADO |
| AB-09 | Verificar registro de asistencia existente sin modificar pago | Asistencia y cobro son independientes; no duplicación financiera | NO EJECUTADO |
| AB-10 | Usuario sin `sales.write` y acceso cruzado de estudio | Sin capacidad de cobro; backend rechaza el intento | NO EJECUTADO |

**TALL-10:** AB-01 a AB-06 cubren los abonos, pero no aprobar hasta adjuntar evidencia del flujo real. AB-07 a AB-09 cubren la regresión de Agenda, AB-10 autorización/tenant.

## Evidencia de cada ejecución

Anotar: fecha/hora, SHA desplegado, usuario/rol de prueba (sin secretos), ID caso, estado, captura o log, ID de pago si hubo, total y saldo anterior/posterior, errores y enlace de preview. Después de cada prueba de escritura comparar la venta y la compra con el ledger; conservar el historial, no borrarlo.

Consulta de verificación (solo lectura, en Sandbox):

```sql
select wp.id as purchase_id, wp.total_minor, wp.paid_minor,
       s.id as sale_id,
       coalesce((select sum(case when p.kind='refund' then -p.amount_minor else p.amount_minor end)
                 from public.payments p where p.sale_id = s.id),0) as paid_from_ledger
from public.workshop_purchases wp
join public.sales s on s.id = wp.sale_id
where s.id in (
  '080f5a7c-8d3f-4abd-b77b-6be37a7f2569',
  '6347498c-82f3-4f7e-8525-0c76b13b06d6',
  'eb6f62a4-44df-4da8-9cb3-44797e7fdacf'
);
```

## Evidencia técnica previa (no sustituye UAT visual)

- `docs/uat-talleres-abonos-agenda-sandbox-20261016.md`: abono parcial, duplicado y liquidación probados mediante SQL reversible, sin pagos permanentes.
- El índice único y el trigger de sincronización están aplicados en Sandbox.
- Ningún permiso de promoción a producción implícito.
