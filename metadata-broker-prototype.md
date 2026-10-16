# INV-UAT-01 — prototipo de frontera para captura de metadatos

> Continuación: [identidad y reserva durable implementadas](metadata-broker-auth-reservation.md).
> Las limitaciones históricas de este primer prototipo se conservan abajo;
> la integración de Actions y el transporte productivo siguen sin activarse.

## Resultado de este bloque

Prototipo local implementado en `scripts/metadata-broker-prototype.mjs`, separado
de la captura vigente. No publica un servidor ni carga credenciales. Solo acepta
versión, SHA candidato completo y UUID de solicitud. El código fija la consulta
SQL y los dos proyectos; no acepta SQL, hosts, destinos, rutas ni claves del
solicitante.

El contexto de autorización debe llegar de un anfitrión confiable, no del cuerpo
de una petición externa. Vincula SHA candidato, SHA del controlador, hash SHA256
de consulta, UUID y caducidad máxima de cinco minutos. En este bloque ese contexto
se genera exclusivamente en pruebas con datos sintéticos: no autentica usuarios.

El adaptador de reservas debe consumir cada UUID de forma atómica y durable antes
de consultar. Las pruebas usan un Set en memoria para ensayar repetición y carrera;
no demuestran persistencia entre procesos o reinicios. No hay implementación
productiva de almacenamiento ni de autenticación.

El transporte recibe únicamente referencia fija, SQL fijo y señal de cancelación.
No recibe una clave de firma. La consulta usa REPEATABLE READ READ ONLY, timeout
SQL de 15 segundos y límite del transporte de 30 segundos. La expiración se vuelve
a comprobar entre proyectos y antes de devolver el resultado. Los fallos consumen
la solicitud; reintentar requiere otra autorización. Cancelar el Promise no
asegura detener una consulta remota si el futuro transporte ignora la señal: el
adaptador real debe respetarla y conservar el timeout del servidor.

La respuesta permite solo siete categorías, conteos enteros no negativos y
huellas MD5. Se rechazan columnas adicionales, definiciones, categorías faltantes
o duplicadas y errores crudos del transporte. Las huellas son señales de
comparación de catálogo, no una prueba de integridad de todo el sistema.

## Imposibilidad de confundirlo con aprobación

El resultado siempre declara `release_eligible: false`, usa
`source: supabase-broker-prototype-diagnostic` y no contiene firma. El verificador
actual rechaza esa fuente. Aunque las huellas coincidan en un ensayo, no autoriza
una liberación. No se cambia el guard de lector ni el verificador vigente.

## Diagnóstico real separado del prototipo

Se ejecutó la misma consulta catalogal fija, en transacción READ ONLY, por el
conector Supabase ya disponible en ambos proyectos. No se usaron credenciales
nuevas, no hubo DDL, lectura de filas de negocio o llamadas HTTP del proyecto.
La observación se registra en `evidence/metadata-broker-20261016/catalog-diagnostic.json`.

Esa lectura fue supervisada por el conector; **no pasó por un intermediario
productivo autenticado**, no tiene firma ni vínculo con el SHA servido de la
aplicación. El ensayo que reproduce sus respuestas es local y no representa una
segunda captura real.

| Categoría | Producción | Candidate |
| --------- | ---------: | --------: |
| column    |       2653 |       772 |
| extension |          7 |         5 |
| index     |        787 |       254 |
| policy    |        352 |       123 |
| routine   |        383 |        95 |
| table_rls |        218 |        66 |
| trigger   |        172 |        20 |

Las huellas difieren en **7/7 categorías**. Esto evidencia dos trabajos separados:
resolver la frontera de captura protegida y conciliar Candidate con la base de
referencia. No se copiarán datos productivos ni se aplicarán cambios de esquema
como consecuencia automática de este diagnóstico.

## Pruebas y evidencia

`evidence/metadata-broker-20261016/tests.txt` conserva la ejecución local:
32 pruebas del prototipo, 9 de contrato de captura/petición existentes y
7 de permisos en PostgreSQL WASM aislado. Los datos de autorización y adaptadores
son sintéticos. `verification.json` registra entorno y hashes de fuentes.

Se reutilizaron las dependencias PGlite ya instaladas, sin instalar servicios.
El prototipo no está enlazado a un workflow ni al controlador activo. El PR apunta
a la rama de #308; no se presenta la ejecución local como GitHub Actions.

## Condiciones concretas antes de activar

1. Elegir un anfitrión existente y sin costo adicional, con identidad y control
   de acceso acreditados. No hay hoy un endpoint de intermediario disponible.
2. Implementar allí autenticación del controlador y autorización del SHA/hash,
   reservas atómicas durables y transporte que respete cancelación y SQL fijo.
3. Revisar el modelo de confianza y aprovisionar credenciales solo en el
   componente confiable. La autorización del antiguo lector NOLOGIN no concede
   automáticamente uso de una credencial productiva privilegiada en otro diseño.
4. Probar el circuito completo con datos sintéticos: inyección, identidad,
   repetición entre procesos/reinicio, expiración y fallas durante ambos accesos.
5. Diseñar la atestación de esta nueva fuente, pinning de versión, validación
   independiente y migración del contrato. Mantener denegación hasta aprobarlos.
6. Conciliar Candidate y demostrar coincidencia y un negativo real antes de
   certificar. La observación actual no permite declarar equivalencia.

No se pide al propietario ninguna acción todavía: primero se debe concretar la
implementación revisable del anfitrión. No se compra infraestructura ni se
sustituye la captura protegida por una consulta privilegiada manual.

## Progreso estable

9/24 hitos completos (37.5%); faltan 15/24 (62.5%). Fases: 3/8, 4/7, 2/6, 0/3.
Este prototipo y diagnóstico son subpasos; no cierran captura ni equivalencia.
Se conservan las decisiones y criterios originales de SF-GOV-001.
