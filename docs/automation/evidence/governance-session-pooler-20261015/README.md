# INV-UAT-01 — avance de Session pooler

PR #308 Draft, SHA `ea22378be7d76ba4a64c7fb8086d156ee97a6142`, dirigido únicamente al controlador protegido. No fusionado; sin request.json ni captura autenticada.

- [Contrato y TLS reales](https://github.com/mikevazquez/Demeter/actions/runs/38857703808): SUCCESS; 9 pruebas PASS, 0 FAIL; DNS IPv4, TCP y TLS 1.3 con hostname verificado PASS. Sin autenticación DB ni SQL. Se usó CA pública oficial versionada, con procedencia y huella en el PR.
- [Runtime](https://github.com/mikevazquez/Demeter/actions/runs/38857703823): SUCCESS; PostgreSQL 17 cliente disponible. El contrato se ejecuta antes de los secretos en una eventual captura protegida.
- Regresión local adicional: 8 tests previos de schema-capture PASS contra el módulo actualizado; incluye PostgreSQL WASM aislado, auditoría de ACL y rollback. No cuenta como UAT de bases remotas.
- Diagnóstico previo conservado: [run 38857608327](https://github.com/mikevazquez/Demeter/actions/runs/38857608327), TLS verify code 19, self-signed certificate in certificate chain. Se corrigió usando la CA publicada por Supabase Studio; nunca sslmode=require ni verificación deshabilitada.
- El entorno cloud local resolvió IPv4 pero rechazó TCP; se conserva ese resultado y no se extrapola al runner.
- Consulta SELECT-only por conector: lector dedicado ausente en ambos catálogos. No se alteraron roles, permisos ni datos.

## Pendiente para cerrar INV-UAT-01

1. Revisión del cambio aislado; no fusionar ni activar por inferencia de CI verde.
2. Preparación administrativa autorizada de los lectores mínimos y auditoría de ACL. Crear el rol productivo cambia producción y no está autorizado por este bloque.
3. Credenciales de ambos lectores y clave de firma únicamente en el environment protegido. No pedir contraseñas por chat; no sustituir por postgres/service_role.
4. Captura autenticada desde controlador y negativo real por divergencia ligado al SHA/manifiesto. La paridad actual no está aprobada; las diferencias deben bloquear la certificación.
5. Conciliar las diferencias Candidate y repetir antes de aceptación funcional.

INV-UAT-01 sigue Preparado. Producción, main, la rama controladora y la rama de control del coordinador no se modificaron. La cola general no se ejecutó. No se contrataron servicios ni se usaron APIs de modelos de pago.
