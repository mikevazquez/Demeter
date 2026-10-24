# GOV-WORKER-005 · Codex Managed Worker

Seguimiento: [issue #395](https://github.com/mikevazquez/Demeter/issues/395).

## Objetivo de esta fase

Preparar un adapter Codex administrado por Governance 2.0 sin registrarlo todavía en el
Supervisor operativo. Esta fase demuestra contrato, aislamiento y requisitos de host; no acredita
un host real ni una ejecución de Codex.

El worker se identifica como `codex-managed-worker` y empieza deliberadamente limitado a
`repository_review`, `repository:read` y `riskTier=0`.

## Requisitos del host

El host debe:

1. tener Codex CLI instalado;
2. tener una sesión existente autenticada con **ChatGPT**;
3. conseguir que `codex login status` reporte `Logged in using ChatGPT` bajo el mismo entorno
   restringido que usará el proceso administrado;
4. tener un checkout limpio en la rama y SHA exactos admitidos por Governance;
5. ejecutar el proceso mediante `createManagedWorkerDispatch`; una sesión abierta fuera del
   adapter no se considera observable por Governance.

El adapter no pasa `HOME`, `CODEX_HOME`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN` ni
secrets de producto. Si la autenticación no funciona sin esos valores, el host queda
`disconnected`; no se amplía el entorno para forzar disponibilidad.

## Ejecución

`buildCodexManagedRegistration` usa el protocolo JSONL ya observado por
`supervisor-process.mjs` y fuerza:

```text
codex exec --json --sandbox read-only -
```

Antes de construir stdin se vuelve a comprobar:

- raíz exacta del checkout;
- rama exacta del contrato;
- HEAD igual a `base_sha`;
- árbol de trabajo limpio;
- contrato `read_only=true`;
- recuperación `read_only`;
- identidad exacta de task, attempt, contract hash y dispatch fingerprint.

Un drift o árbol sucio detiene el lanzamiento antes de entregar trabajo al modelo.

## Frontera de esta entrega

Esta rama **no**:

- añade el worker a `registeredWorkers` de `supervisor-runner.mjs`;
- modifica el authority registry;
- publica `GOVERNANCE_WORKER_STATE_V1` para Codex;
- ejecuta Codex real;
- concede permisos de escritura, push, PR, merge o producción.

El siguiente gate, después de liberar el slot actual, es registrar un host real y hacer un piloto
E2E read-only. Sólo con esa evidencia se decidirá si ampliar el worker a trabajo generativo.

## Criterios del piloto posterior

El E2E debe demostrar, con el mismo `task_id` y contrato:

1. probe ChatGPT válido bajo el entorno administrado;
2. un solo attempt y un solo launch claim;
3. eventos JSONL observados;
4. cierre del process group;
5. no cambios en el checkout;
6. receipt/evidencia independiente;
7. slot liberado por el Supervisor;
8. `no_capacity` o auth failure tratados fail-closed, sin regeneración silenciosa.
