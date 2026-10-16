# INV-UAT-01: restricción de plataforma y cambio de ruta

## Decisión vigente

El 16 de octubre de 2026 el propietario compartió una respuesta de soporte de
Supabase. Soporte confirma que `net` pertenece a `supabase_admin`, que `postgres`
no puede retirar sus grants y que los cambios de grants de pg_net por proyecto
no están soportados. La documentación oficial coincide. La aparente ejecución
exitosa del SQL Editor no acredita un cambio de ACL.

Se descarta la ruta «esperar a soporte y repetir REVOKE». No repetir la consulta
modificadora, no cambiar de propietario, no asumir privilegios administrativos,
no desinstalar pg_net, no habilitar LOGIN ni debilitar la auditoría del lector.
La aplicación utiliza comunicaciones dependientes de pg_net; retirarlo no es una
alternativa compatible con el alcance autorizado.

Lectura remota posterior mediante SELECT de catálogo en transacción READ ONLY:
`audit_actor=postgres`, `net_owner=supabase_admin`, `public_net_usage=true`,
`net_relations=2`, `reader_exists=false`. No se consultaron filas de esas tablas,
colas HTTP, cabeceras, cuerpos, secretos ni datos de negocio. No hubo DDL.

## Consecuencia técnica

Un nuevo rol de conexión recibe el acceso concedido a PUBLIC. NOINHERIT,
search_path y default_transaction_read_only no constituyen una denegación de
esos permisos. La captura directa propuesta exige cero acceso a relaciones no
catalogales y por tanto permanece bloqueada correctamente. La autorización
previa del usuario no modifica esa limitación técnica.

El lector NOLOGIN de Candidate se conserva; no acredita captura utilizable.
La preparación de Session pooler, TLS, captura y sus pruebas se conserva como
trabajo demostrado. No se declara cerrada INV-UAT-01 ni equivalencia de esquema.

## Alternativa a evaluar: intermediario controlado de metadatos

Diseño propuesto, todavía **no implementado ni aprobado como sustituto**:

1. Mantener las credenciales de conexión de producción dentro de un componente
   administrativo de confianza existente; nunca entregarlas al ejecutor Codex
   ni al checkout candidato.
2. Exponer únicamente una operación fija, revisada e inmutable que obtenga las
   huellas de las siete categorías de catálogo. No aceptar SQL, nombres de
   proyecto, destinos HTTP ni rutas arbitrarias del solicitante.
3. Vincular el resultado a proyectos verificados, SHA candidato, versión y hash
   de la consulta, fecha y firma desde el entorno protegido. Exigir captura de
   ambos proyectos y controles negativos reales antes de certificar.
4. Evaluar autenticación, autorización, inyección, repetición, caducidad y
   aislamiento del componente. Un intermediario con credencial privilegiada
   tiene un modelo de confianza distinto al del lector restringido; no se puede
   etiquetar como equivalente sin revisar ese contrato.
5. Reutilizar capacidades existentes sin contratar infraestructura. Antes de
   habilitar un componente o credencial productivos, preparar y revisar su
   implementación y el alcance de la autorización correspondiente.

Una extracción supervisada por el conector actual podría apoyar el diagnóstico,
pero no sustituye por sí sola a la captura protegida ni a su atestación. No se
firmarán resultados manuales como si hubieran pasado el guard del lector.

## Fuentes verificadas

- [Restricción y alternativas oficiales de pg_net](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).
- [Privilegios heredados de PUBLIC y límites de read-only/NOINHERIT](https://supabase.com/docs/guides/troubleshooting/custom-role-inherits-privileges-that-were-not-explicitly-granted-ddaa1c).
- Changelog oficial consultado: https://supabase.com/changelog.md.
- Respuesta de soporte compartida por el propietario en esta conversación;
  no se envió ninguna respuesta a soporte desde el agente.

## Avance

Mismos 24 hitos: 9 completos (37.5%), 15 pendientes (62.5%). Fases 1–4:
3/8, 4/7, 2/6 y 0/3. Se resuelve la incertidumbre sobre el REVOKE, pero no el
hito de captura. La siguiente acción técnica es concretar y probar la alternativa
sin cambios en producción; no se necesita repetir acciones en SQL Editor.
