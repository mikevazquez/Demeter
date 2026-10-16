# Studio Flow — Protocolo de liberación SF-GOV-001

> **BORRADOR EN RAMA, NO APLICADO EN PRODUCCIÓN.** Este protocolo no
> autoriza promocionar código ni datos. El manifiesto es información
> autodeclarada; nunca sustituye una aprobación real del propietario.

## Estructura de entornos

| Entorno           | Uso                                   | Datos      | Integraciones |
| ----------------- | ------------------------------------- | ---------- | ------------- |
| Producción        | Operación real de Studio Flow         | Reales     | Reales        |
| Espejo            | Retirado; no recrear sin autorización | No aplica  | No aplica     |
| Sandbox candidato | Cambios autorizados para integración  | Sintéticos | Simuladores   |
| Previews por PR   | Desarrollo y pruebas por módulo       | Sintéticos | Simuladores   |

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
   documentado y actualización de la referencia verificable de producción.

**Los UAT aprobados no constituyen permiso de promoción.**

## GOV-COM-02: validación previa y cierre posterior

Mike autorizó esta separación el 13 de octubre de 2026, 14:40
America/Mexico_City. Es una decisión metodológica, no autorización productiva.

Solo para `SF-GOV-001`, `PIL-UAT-01` y `DOC-UAT-01` pueden mantener su
resultado global `pending` antes de producción cuando su etapa
`phases.predeployment` está `passed`, con `evidence_url` válido y
`candidate_sha` idéntico al del manifiesto. Su etapa
`phases.postdeployment` debe permanecer `pending`. Los demás casos conservan
el requisito de aprobación completa antes de preparar producción.

No se marca un caso global `passed` hasta que **ambas** etapas tengan
evidencia y el mismo SHA. Para validar el cierre completo se usa:

```sh
node scripts/validate-release-manifest.mjs RELEASE.json FULL_SHA SCHEMA_ATTESTATION.json --closure
```

El cierre rechaza cualquier caso pendiente. Esta regla no omite los checks
de firma, paridad del esquema, identidad del artefacto ni aprobación humana
protegida. Los JSON y los tests solo validan estructura; no autentican por
sí solos la aprobación UAT ni autorizan un despliegue.

En Notion se conservan los 18 casos originales. PIL-UAT-01 continúa
Bloqueado y DOC-UAT-01 Preparado hasta completar sus evidencias; aprobar
esta regla no equivale a aprobar sus etapas.

## Validación mecánica del manifiesto

El archivo `scripts/validate-release-manifest.mjs` comprueba que la
descripción de la entrega incluye identidad SHA, UAT identificados,
archivos de migración con hash, módulos, enlaces y rollback.

```sh
node --test scripts/governance-policy-checks.mjs
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

## Observaciones del diagnóstico inicial (histórico)

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

### Identidad de evidencia UAT aprobada

Cada caso ordinario con `result: "passed"` requiere `evidence_url` permitido y
`candidate_sha` completo de 40 caracteres hexadecimales, idéntico al del
manifiesto. Se rechazan evidencias sin SHA o de otro candidato tanto en Sandbox
como en preparación de producción y cierre. Cada caso se comprueba por separado.
Los casos PIL/DOC de GOV-COM-02 conservan el vínculo de SHA en ambas etapas;
no necesitan un SHA superior redundante. Los borradores Sandbox pueden seguir
pendientes.

Esta comprobación valida la declaración del manifiesto. No autentica el
contenido remoto del enlace, no aprueba UAT y no autoriza una promoción. La
validación de artefactos, destino y aprobación protegida sigue siendo necesaria.
