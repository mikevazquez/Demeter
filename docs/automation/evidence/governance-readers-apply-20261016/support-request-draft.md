# Borrador para el administrador/soporte de Supabase — no enviado

Proyecto: `qfhojvgvhrbautvczffq` (producción).

Necesitamos un ajuste puntual para un lector dedicado de metadatos. El
propietario del proyecto lo autorizó. El esquema net pertenece a supabase_admin;
la conexión postgres no es superuser, no pertenece al rol propietario y no puede
retirar su grant a PUBLIC. Un intento transaccional abortó y fue verificado sin
migración aplicada ni lector creado.

Solicitamos que un operador con autoridad del propietario ejecute únicamente:

```sql
REVOKE USAGE ON SCHEMA net FROM PUBLIC;
```

Conservar los grants explícitos actuales para postgres, supabase_functions_admin,
anon, authenticated y service_role, así como los permisos del propietario
supabase_admin. No cambiar tablas, funciones, propietarios, membresías, crons,
extensión ni datos; no reiniciar workers ni enviar solicitudes HTTP.

Por favor confirmar el resultado y que los grants explícitos siguen presentes.
No necesitamos contraseñas, acceso de superuser para la aplicación ni cambios de
plan/servicio. Ingeniería verificará después la ACL y preparará el lector NOLOGIN.
