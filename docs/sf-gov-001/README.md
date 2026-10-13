# Studio Flow — Protocolo de liberación SF-GOV-001

> **BORRADOR EN RAMA, NO APLICADO EN PRODUCCIÓN.** Este protocolo no
> autoriza promocionar código ni datos. El manifiesto es información
> autodeclarada; nunca sustituye una aprobación real del propietario.

## Estructura de entornos

| Entorno | Uso | Datos | Integraciones |
| --- | --- | --- | --- |
| Producción | Operación real de Studio Flow | Reales | Reales |
| Espejo | Línea base de producción reproducible | Sintéticos | Deshabilitadas |
| Sandbox candidato | Cambios autorizados para integración | Sintéticos | Simuladores |
| Previews por PR | Desarrollo y pruebas por módulo | Sintéticos | Simuladores |

No se certificará ningún preview hasta verificar **todas** sus
credenciales y destinos externos. Una URL de Supabase Sandbox no garantiza
que Mercado Pago, OpenAI, Meta, WhatsApp o Email estén aislados. Los cron
de prueba no pueden enviar mensajes a personas reales.

## Puertas de promoción

1. **Ready**: ID, requisitos, dependencias, diseño, matriz UAT y SHA base
   de producción documentados.
2. **Desarrollo**: rama corta por cambio, PR a una base conocida, CI y
   evidencia de pruebas funcionales en entorno sin efectos reales.
3. **Autorización Sandbox**: Mike autoriza el conjunto **exacto** de
   commits, migraciones, funciones y flags que puede entrar al candidato.
4. **Integración**: reconstrucción del candidato desde base verificada,
   aplicación únicamente del delta autorizado, pruebas E2E y regresión.
5. **Autorización Producción**: aprobación **separada y expresa** del
   manifiesto con SHA, evidencia, impacto y rollback.
6. **Release**: etapa de producción sin alias de dominio, controles
   obligatorios de GitHub y aprobación mediante environment reviewers.
   Pruebas no destructivas sobre el build preparado; promoción del mismo
   artefacto, no de un Preview reconstruido.
7. **Cierre**: smoke, monitoreo, incidentes, Bitácora Notion, rollback
   documentado y sincronización del espejo con producción.

**Los UAT aprobados no constituyen permiso de promoción.**

## Validación mecánica del manifiesto

El archivo `scripts/validate-release-manifest.mjs` comprueba que la
descripción de la entrega incluye identidad SHA, UAT identificados,
archivos de migración con hash, módulos, enlaces y rollback.

```sh
node --test tests/validate-release-manifest.test.mjs
node scripts/validate-release-manifest.mjs docs/sf-gov-001/release-manifest.example.json
```

Para asociar la descripción a la versión real:

```sh
node scripts/validate-release-manifest.mjs RELEASE.json FULL_40_CHARACTER_SHA
```

Este chequeo verifica **forma e identidad**, no consentimiento. La
autorización se impone exclusivamente por un **reviewer protegido en
GitHub/Vercel** con registros de auditoría que no pueda falsificar la
persona que modifica la rama.

## Observaciones del diagnóstico

- Baseline identificado: `e76495ee63173de8634c664cd33fa5a9ef0f24e0`.
- 322 ramas, 52 PR abiertos; el Sandbox actual contiene trabajo adicional
  y no es un espejo limpio. No reiniciarlo ni borrar ramas.
- Consulta de rulesets de GitHub: vacía; lectura de branch protection
  legacy: 403 por la integración. Protección **no certificada**.
- Credenciales sensibles existen en Previews. No leerlas ni copiarlas a
  repositorios, documentos o conversaciones.
- No modificar producción hasta lograr aislamiento, UAT, gates y
  autorización explícita para cada promoción.

[Especificación y matriz UAT en Notion](https://app.notion.com/p/3f8d78f7146381e49f16cc31a235f575).
