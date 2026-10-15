# Modelo operativo de desarrollo SaaS y agentes — propuesta aislada

Estado: propuesta para revisión; **no activada**. Fecha: 2026-10-15.
Repositorio: `mikevazquez/Demeter`. Fuente de gobierno: [Protocolo Universal — Notion](https://app.notion.com/p/3fad78f7146381e9a97fc3c454e6516a).
Coordinador piloto: PR #294 (Draft). Piloto anterior: PR #290 (Draft).

## Objetivo

Transformar una solicitud como «corrige este problema» en un bloque verificable, con investigación, implementación aislada, reparación, pruebas, UAT y decisión de publicación, sin solicitar confirmación por cada operación rutinaria. El usuario interviene únicamente por permisos imprescindibles, decisiones de negocio, UAT humano o autorización de promoción. Esta descripción no habilita nuevas acciones del controlador actual.

## Flujo y contratos

1. **Entrada / clasificación.** Identificar producto (Studio Flow, Finance Core u otro), problema, resultado esperado, criticidad, tenant, repositorio, entorno, evidencia inicial y riesgo de efectos externos. Recuperar gobierno vigente y comprobar PRs/issues concurrentes antes de crear trabajo. No inferir que Finance Core comparte infraestructura o credenciales con Studio Flow.
2. **Bloque admitido.** Registrar ID, propietario único, alcance de rutas/datos, rama y base SHA, fuente de autoridad y versión, Definition of Done, presupuesto de reintentos, pruebas exigidas y efectos prohibidos. Sin admisión explícita, solo investigar y proponer; el texto de una incidencia no concede permisos.
3. **Investigación.** Reproducir en Sandbox cuando sea seguro, clasificar hechos, hipótesis y riesgos; obtener logs o evidencia mínima. Un fallo técnico rutinario se diagnostica y corrige sin devolverlo al usuario prematuramente.
4. **Ejecución.** Un ejecutor por bloque, cambios exclusivamente en rama aislada, validación de rutas, aislamiento de credenciales y presupuesto de reintentos acotado. Reintentar con el error real, nunca ampliar permisos por conveniencia.
5. **Certificación independiente.** Otro contexto/runner reconstruye desde SHA inmutable y ejecuta verificaciones del contrato, CI, regresión y controles de seguridad. El certificador no publica ni dispone de credenciales de producción.
6. **Entrega.** PR Draft con SHA, resultados, evidencias, defectos restantes y trazabilidad; evitar PR duplicado por bloque y recuperar resultados tras interrupción. Si no existe trabajo nuevo, no generar commits artificiales.
7. **UAT y promoción.** UAT funcional separado de CI y de la autorización productiva. Un PR verde no equivale a UAT aprobado. La promoción exige autorización explícita por proyecto/versión, gates y rollback. El controlador no hace merge ni despliegues por defecto.
8. **Continuidad.** Journal compartido de reservas, intentos, SHA, resultados, expiración y recuperaciones; verificar el estado antes de cada reintento. Alertar solo al cerrar con evidencia o si se necesita intervención real.

## Separación de responsabilidades

| Rol lógico | Puede | No puede |
| --- | --- | --- |
| Solicitante | Definir resultado, aceptar UAT, autorizar promoción específica | Conceder permisos implícitos con un «continúa» |
| Coordinador | Recuperar gobierno, admitir tareas dentro de contrato, detectar duplicados, asignar y verificar | Cambiar reglas, secretos, producción o ampliar allowlists unilateralmente |
| Investigador | Consultar código, logs y evidencias autorizadas | Escribir en producción o asumir hipótesis como hechos |
| Ejecutor Codex | Modificar rutas admitidas en rama aislada, probar y reparar | Publicar, acceder a secretos productivos o ejecutar tareas no admitidas |
| Certificador | Reconstruir artefactos y validar resultados de forma independiente | Modificar el resultado certificado |
| Publicador restringido | Abrir PR Draft desde artefactos certificados | Fusionar o desplegar sin gates y autorización |
| Responsable UAT | Validar experiencia/resultado de negocio | Sustituir la evidencia técnica o autorización de producción |

## Aislamiento entre productos y trabajos

- **Studio Flow:** conservar SF-GOV-001 y límites del piloto #294. No invadir ramas de Demi, Talleres, SaaS onboarding ni otros PR activos.
- **Finance Core:** primero descubrir repositorio, propietario, entornos, identidad y gobierno propios; nunca reutilizar identificadores, claves o credenciales de Studio Flow.
- **Paralelismo:** permitido solo para bloques sin solapamiento de archivos, datos, entornos o efectos. Un único responsable por bloque y una reserva durable previenen duplicación.
- **Datos y terceros:** nunca mensajes reales, pagos, cancelaciones, migraciones destructivas o escrituras productivas como pruebas sin autorización específica.

## Piloto de aceptación 80/20

**Fase A — Documentación (este PR):** aprobar o corregir el contrato de entrada/salida y separación de roles, sin activar automatizaciones nuevas.

**Fase B — Prueba controlada en entorno aislado (futuro PR):**
- Una incidencia sintética admitida se transforma en bloque con DoD y propietario.
- El ejecutor realiza un cambio permitido; una prueba falla y se corrige dentro del presupuesto.
- El certificador independiente reconstruye el SHA y el publicador crea exactamente un PR Draft.
- Un segundo ciclo no duplica PR ni trabajo; una interrupción deja journal recuperable.
- Un intento de cambiar ruta prohibida, acceder a secretos o publicar a producción se rechaza y registra.

**Fase C — Aplicación por producto:** integrar primero Studio Flow tras aprobación del piloto y UAT; Finance Core solo después de descubrir su perfil y aceptar límites propios.

## Criterios de cierre

- [x] Contrato y roles documentados en rama independiente.
- [ ] Revisión de gobierno y aceptación de este diseño.
- [ ] Prueba operativa aislada con evidencias por SHA, run y entorno.
- [ ] UAT humano del flujo cuando corresponda.
- [ ] Autorización separada para cualquier promoción.

**No confundir este documento con una implementación funcional.** El PR #294 mantiene su propio ciclo de verificación programada y no se modifica desde este bloque.
