# Acceso administrativo UAT · Sandbox · 22 oct 2026

Autorización de Mike: «vamos a habilitar el acceso administrativo de UAT para Sandbox». Acceso técnico habilitado y comprobado; no implica aprobación de la matriz conversacional.

- Aplicación comprobada: `995f4466411051e752f1cb97c90215af0e67c5c2`, PR #367 borrador.
- [Workbench](https://demeterbueno-9e8kcq7sw-demeter3.vercel.app/admin/mas/demi) y [banco operativo](https://demeterbueno-9e8kcq7sw-demeter3.vercel.app/admin/mas/demi/uat), deployment `dpl_9tcVnNRtoZNtyHNoiGiT3cTAwBCo`, Preview READY. CI39846767894 y Supervisor39846763878 SUCCESS.
- Único backend: `hedouonyhynuvwbckdlg`. Cuenta sintética nueva `0fd86d7b-f7ea-410a-8fc6-8017cbeb8a81`, rol `admin` únicamente en estudio sintético `54dd112f-12ab-4e77-928c-877b12276eb2`. Sin reactivar cuentas anteriores.
- Vencimiento: **23 oct 2026, 00:18 UTC**. Job puntual37 del Cron existente deshabilita la cuenta y membresías, bloquea nuevos inicios, elimina sesiones/refresh tokens y se retira. Revocar antes si termina el bloque. Acceso Vercel temporal únicamente a este Preview, sin bypass global ni cambio de variables.

## Comprobación

Login normal de la aplicación, workbench con los cinco casos S11–S15 y banco operativo accesibles; estudio sintético correcto. Contraseña aleatoria y sesión guardadas en archivos privados0600 fuera del repositorio; no se incluyen aquí ni en Notion. No se obtuvieron claves service_role/OpenAI ni se enviaron invitaciones o mensajes externos.

API con la identidad real `authenticated`: una membresía propia admin y una configuración Demi del estudio permitido; cero filas de configuración del otro estudio y cero runs ajenos. La primera aserción del arnés esperaba una configuración sin filtrar asistente y obtuvo dos (Demi y Polina). Se inspeccionaron las claves y se repitió con `assistant_key=demi`; no se alteraron reglas ni RLS. Se conserva el intento preliminar fallido en `access-check.json`.

Se ejecutó el mismo bloque SQL de revocación dentro de una transacción revertida: cuenta disabled/banned, cero membresías activas/sesiones/refresh y job retirado. Tras rollback se verifican cuenta/membresía activas, tres sesiones restauradas y job de vencimiento vigente. Esto comprueba la limpieza de DB sin cerrar el acceso que se necesita para continuar; no certifica todavía una denegación HTTP posterior al vencimiento.

Los tres accesos anteriores inspeccionados siguen disabled/banned con cero sesiones y membresías activas. `database-check.json` recoge estado inicial, prueba revertida de revocación y estado posterior. No hubo nuevas compras, reservas, ejecución de conversaciones ni mensajes externos en este bloque.

## Continuación

Se retira el impedimento de acceso mientras la sesión siga vigente. Revalidarlo al retomar, ya que caduca automáticamente. Ejecutar C07-E1–E8 y retests F01/F02/F03/F06 con la misma candidata, conservar trazas y contrastar efectos persistidos. Elegibilidad/timeouts, perfil completo y aceptación funcional de Mike permanecen pendientes. La matriz integral no queda aprobada; Release No listo. A07 sigue manual fuera de Demi.

Producción `qfhojvgvhrbautvczffq`, canales/adapters y variables/despliegues productivos intactos. DEMI-PILOT-01 bloqueado/inactivo; ningún PR fusionado. No se creó migración ni se modificaron permisos o políticas.
