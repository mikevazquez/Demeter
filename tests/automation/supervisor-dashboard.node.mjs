import assert from "node:assert/strict";
import test from "node:test";
import {
  renderSupervisorHtml,
  renderSupervisorMarkdown,
} from "../../scripts/automation/supervisor-dashboard.mjs";

const NOW = "2026-10-20T18:00:00.000Z";
const SHA = "a".repeat(40);
const OPTIONS = { now: NOW };
const task = (overrides = {}) => ({
  task_id: "GOV-TEST-01",
  title: "Comprobar continuidad",
  status: "running",
  contract: {
    objective: "Recuperar la misma tarea",
    branch: "feat/supervisor",
    requires_uat: false,
  },
  last_worker_activity_at: "2026-10-20T17:50:00.000Z",
  attempts: [
    {
      attempt_id: "attempt-1",
      worker_id: "claude-code-web",
      intent_at: "2026-10-20T17:45:00.000Z",
    },
  ],
  ...overrides,
});
const state = (tasks = [], overrides = {}) => ({
  schema: "governance2-supervisor-v1",
  sequence: 2,
  updated_at: NOW,
  last_tick_at: NOW,
  tasks,
  ...overrides,
});

test("renders an empty or incomplete registry without inventing activity", () => {
  for (const input of [undefined, null, {}, state(), state([null])]) {
    const md = renderSupervisorMarkdown(input, OPTIONS);
    const page = renderSupervisorHtml(input, OPTIONS);
    assert.match(md, /Sin tareas registradas/);
    assert.match(page, /Sin tareas registradas/);
    assert.doesNotMatch(page, /class="badge success"/);
  }
  const page = renderSupervisorHtml(state([{}]), OPTIONS);
  assert.match(page, /Estado no registrado/);
  assert.match(page, /<dt>Worker<\/dt><dd>No registrado<\/dd>/);
  assert.doesNotMatch(page, /class="badge info">Ejecutando/);
});

test("does not invent a worker when a task has no registered attempt", () => {
  const page = renderSupervisorHtml(state([task({ attempts: [] })]), OPTIONS);
  assert.match(page, /<dt>Worker<\/dt><dd>No registrado<\/dd>/);
  assert.doesNotMatch(page, /claude-code-web|codex/);
});

test("separates a fresh supervisor tick from an old worker signal", () => {
  const snapshot = state([task({ last_worker_activity_at: "2026-10-20T16:00:00.000Z" })], {
    observer_checked_at: NOW,
    last_tick_at: "2026-10-20T17:00:00.000Z",
  });
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  const md = renderSupervisorMarkdown(snapshot, OPTIONS);
  assert.match(page, /class="badge attention">Sin señal/);
  assert.match(
    page,
    /<p><strong>Última consulta del supervisor:<\/strong> [^<]*Hace menos de 1 min<\/p>/,
  );
  assert.match(page, /<p><strong>Última transición persistida:<\/strong> [^<]*Hace 1 h<\/p>/);
  assert.match(page, /Última señal del worker[\s\S]*?Hace 2 h/);
  assert.match(md, /Sin señal/);
  assert.doesNotMatch(page, /class="badge info">Ejecutando/);
});

test("a recent state transition does not invent an observer consultation", () => {
  const snapshot = state([task()]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  const md = renderSupervisorMarkdown(snapshot, OPTIONS);
  assert.match(page, /<p><strong>Última consulta del supervisor:<\/strong> No registrada<\/p>/);
  assert.match(
    page,
    /<p><strong>Última transición persistida:<\/strong> [^<]*Hace menos de 1 min<\/p>/,
  );
  assert.match(md, /^\*\*Última consulta del supervisor:\*\* No registrada$/m);
});

test("a reserved attempt is not an accepted delivery or an executing worker", () => {
  const snapshot = state([task({ status: "dispatching", last_worker_activity_at: null })]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  assert.match(page, /class="badge info">Intento reservado/);
  assert.doesNotMatch(page, /class="badge info">(?:Enviado|Ejecutando)/);
});

test("makes staleness configurable and uses the latest real signal", () => {
  const snapshot = state([task({ last_worker_activity_at: "2026-10-20T17:20:00.000Z" })]);
  assert.match(renderSupervisorHtml(snapshot, OPTIONS), /class="badge attention">Sin señal/);
  assert.match(
    renderSupervisorHtml(snapshot, { now: NOW, staleAfterMinutes: 45 }),
    /class="badge info">Ejecutando/,
  );
  const recent = state([
    task({
      last_worker_activity_at: "2026-10-20T16:00:00.000Z",
      attempts: [{ worker_id: "claude-code-web", last_activity_at: "2026-10-20T17:59:00.000Z" }],
    }),
  ]);
  assert.match(renderSupervisorHtml(recent, OPTIONS), /class="badge info">Ejecutando/);
});

test("intent timestamps and future dates do not prove running activity", () => {
  for (const signal of [undefined, "invalid", "2026-10-21T17:50:00.000Z"]) {
    const snapshot = state([
      task({
        last_worker_activity_at: signal,
        attempts: [{ intent_at: NOW, started_at: NOW, worker_id: "codex" }],
      }),
    ]);
    assert.match(renderSupervisorHtml(snapshot, OPTIONS), /class="badge attention">Sin señal/);
  }
  const pending = state([task({ status: "dispatched", last_worker_activity_at: null })]);
  assert.match(renderSupervisorHtml(pending, OPTIONS), /class="badge info">Enviado/);
  assert.match(
    renderSupervisorHtml(pending, { now: "2026-10-20T19:00:00.000Z" }),
    /class="badge attention">Sin señal/,
  );
});

test("a completed receipt alone is never displayed as verified green", () => {
  const snapshot = state([
    task({
      status: "completed",
      evidence: {
        receipt_url: "https://github.com/mikevazquez/Demeter/issues/341#issuecomment-1",
        sha: SHA,
      },
    }),
  ]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  assert.match(page, /class="badge attention">Entregado/);
  assert.doesNotMatch(page, /class="badge success"/);
  assert.match(renderSupervisorMarkdown(snapshot, OPTIONS), /falta comprobarlo/);
});

test("pending verification inherited from admission does not claim verification has started", () => {
  for (const status of ["completed", "delivered"]) {
    const snapshot = state([task({ status, verification_status: "pending" })]);
    const page = renderSupervisorHtml(snapshot, OPTIONS);
    assert.match(page, /class="badge attention">Entregado/);
    assert.doesNotMatch(page, /class="badge attention">Verificando/);
    assert.doesNotMatch(page, /class="badge success"/);
  }
  const verifying = state([task({ status: "verifying", verification_status: "pending" })]);
  assert.match(renderSupervisorHtml(verifying, OPTIONS), /class="badge attention">Verificando/);
});

test("received receipt evidence is linked while independent verification remains pending", () => {
  const receiptUrl = "https://github.com/mikevazquez/Demeter/issues/341#issuecomment-123";
  const snapshot = state([
    task({
      status: "verifying",
      verification_status: "pending",
      reported_receipt_url: receiptUrl,
      checkpoint: { current_sha: SHA },
    }),
  ]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  assert.match(page, /class="badge attention">Verificando/);
  assert.ok(page.includes(`href="${receiptUrl}"`));
  assert.ok(renderSupervisorMarkdown(snapshot, OPTIONS).includes(`[Receipt](<${receiptUrl}>)`));
  assert.doesNotMatch(page, /class="badge success"/);
});

test("a terminal worker event awaits confirmed process closure without hiding stronger states", () => {
  for (const last_activity_type of ["turn.completed", "turn.failed"]) {
    const terminalTask = task({
      status: "running",
      attempts: [
        {
          worker_id: "registered-local-worker",
          last_activity_at: NOW,
          last_activity_type,
        },
      ],
    });
    const page = renderSupervisorHtml(state([terminalTask]), OPTIONS);
    assert.match(page, /class="badge attention">Cierre pendiente/);
    assert.doesNotMatch(page, /class="badge info">Ejecutando/);
    assert.doesNotMatch(page, /class="badge success"/);
    for (const [status, label] of [
      ["uncertain", "Incierto"],
      ["verifying", "Verificando"],
    ]) {
      const stronger = renderSupervisorHtml(state([{ ...terminalTask, status }]), OPTIONS);
      assert.ok(stronger.includes(`class="badge attention">${label}`));
      assert.doesNotMatch(stronger, /class="badge attention">Cierre pendiente/);
    }
  }
});

test("requires explicit verification and evidence and keeps UAT separate", () => {
  const completed = task({
    status: "completed",
    verification_status: "verified",
    evidence: { sha: SHA, ci_url: "https://github.com/mikevazquez/Demeter/actions/runs/123" },
  });
  assert.match(
    renderSupervisorHtml(state([completed]), OPTIONS),
    /class="badge success">Verificado/,
  );
  assert.match(
    renderSupervisorHtml(state([{ ...completed, evidence: null }]), OPTIONS),
    /class="badge attention">Verificando/,
  );
  const uat = { ...completed, contract: { ...completed.contract, requires_uat: true } };
  const page = renderSupervisorHtml(state([uat]), OPTIONS);
  assert.match(page, /class="badge attention">UAT pendiente/);
  assert.doesNotMatch(page, /class="badge success"/);
  assert.match(page, /Intervención de Mike: <strong>Sí/);
});

test("escapes task content and SHA for both renderers", () => {
  const attack = '[Entrar](javascript:alert(1)) | <img src=x onerror="alert(1)"> `x`\n# heading';
  const snapshot = state([
    task({
      task_id: attack,
      title: attack,
      next_action: attack,
      checkpoint: { current_sha: "<script>alert(1)</script>" },
      attempts: [{ worker_id: attack }],
      contract: { objective: attack, branch: attack },
    }),
  ]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  const md = renderSupervisorMarkdown(snapshot, OPTIONS);
  assert.doesNotMatch(page, /<img|<script|href="javascript:/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(md, /\[Entrar\]\(|<img|<script|\n# heading/);
  assert.match(md, /&#124;/);
  assert.match(md, /<code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code>/);
});

test("only links HTTPS GitHub or Claude destinations, without credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://github.com/repo",
    "https://github.com.evil.test/repo",
    "https://github.com@evil.test/repo",
    "https://user:secret@github.com/repo",
    "https://github.com:444/repo",
    "https://evil.test/",
    "https://github.com/repo?access_token=secret",
    "https://github.com/repo\n#x",
  ]) {
    const snapshot = state([
      task({ evidence: { pr_url: url }, attempts: [{ session_url: url, run_url: url }] }),
    ]);
    assert.doesNotMatch(renderSupervisorHtml(snapshot, { ...OPTIONS, runUrl: url }), /<a /);
    assert.doesNotMatch(renderSupervisorMarkdown(snapshot, { ...OPTIONS, runUrl: url }), /\]\(/);
  }
  const snapshot = state([
    task({
      evidence: { pr_url: "https://github.com/mikevazquez/Demeter/pull/1" },
      attempts: [{ session_url: "https://claude.ai/code/session_1" }],
    }),
  ]);
  const page = renderSupervisorHtml(snapshot, OPTIONS);
  assert.match(page, /href="https:\/\/github.com\/mikevazquez\/Demeter\/pull\/1"/);
  assert.match(page, /href="https:\/\/claude.ai\/code\/session_1"/);
});

test("escapes Markdown link destinations and does not expose arbitrary state fields", () => {
  const snapshot = state(
    [
      task({
        evidence: { pr_url: "https://github.com/mikevazquez/Demeter/issues/1?x=(ok)" },
        secret: "DO_NOT_RENDER_THIS",
      }),
    ],
    { token: "DO_NOT_RENDER_THIS" },
  );
  const md = renderSupervisorMarkdown(snapshot, OPTIONS);
  assert.match(md, /x=%28ok%29/);
  assert.doesNotMatch(md, /DO_NOT_RENDER_THIS/);
  assert.doesNotMatch(renderSupervisorHtml(snapshot, OPTIONS), /DO_NOT_RENDER_THIS/);
});

test("rendering is deterministic for a supplied clock and never mutates state", () => {
  const snapshot = state([task()]);
  const before = structuredClone(snapshot);
  const first = renderSupervisorHtml(snapshot, OPTIONS);
  assert.equal(renderSupervisorHtml(snapshot, OPTIONS), first);
  renderSupervisorMarkdown(snapshot, OPTIONS);
  assert.deepEqual(snapshot, before);
  assert.match(first, /<meta name="viewport"/);
  assert.doesNotMatch(first, /<button|<script|<form|<iframe|<img|<link /);
});
