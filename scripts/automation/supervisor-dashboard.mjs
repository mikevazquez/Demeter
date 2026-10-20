const ALLOWED_LINK_HOSTS = new Set(["github.com", "api.github.com", "claude.ai"]);
const VERIFIED = new Set(["verified", "passed", "success"]);
const DELIVERED = new Set(["completed", "delivered", "receipt_received", "succeeded", "done"]);
const WORKING = new Set(["running", "active", "executing", "dispatched", "sent", "started"]);
const SHA = /^[a-f0-9]{40}$/i;

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const plain = (value) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
const key = (value) => plain(value).toLowerCase().replace(/[ -]/g, "_");
const html = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
// Escaping punctuation also prevents GFM from turning task text into unapproved links.
const markdown = (value) =>
  plain(String(value)).replace(
    /[&<>\\`*_\[\]()#!|~:.@]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );

function safeUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !ALLOWED_LINK_HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      [...url.searchParams.keys()].some((name) =>
        /token|secret|password|credential|authorization|api[-_]?key/i.test(name),
      )
    )
      return null;
    return url.href.replace(
      /[()[\]<>`\\]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    return null;
  }
}

function instant(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function timestamp(value, now) {
  const time = instant(value);
  if (time === null) return { text: "No registrada", age: "", ms: null, iso: null };
  const text =
    new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(time) + " CDMX";
  const elapsed = now === null ? null : now - time;
  let age = "Antigüedad no comprobada";
  if (elapsed !== null) {
    if (elapsed < 0) age = "Fecha futura; revisar reloj";
    else if (elapsed < 60_000) age = "Hace menos de 1 min";
    else if (elapsed < 3_600_000) age = `Hace ${Math.floor(elapsed / 60_000)} min`;
    else if (elapsed < 86_400_000) age = `Hace ${Math.floor(elapsed / 3_600_000)} h`;
    else age = `Hace ${Math.floor(elapsed / 86_400_000)} días`;
  }
  return { text, age, ms: time, iso: new Date(time).toISOString() };
}

function taskView(task, now, staleAfterMinutes) {
  const contract = record(task.contract) ? task.contract : {};
  const attempts = Array.isArray(task.attempts) ? task.attempts.filter(record) : [];
  const attempt = attempts.at(-1) ?? {};
  const evidence = record(task.evidence) ? task.evidence : {};
  const checkpoint = record(task.checkpoint) ? task.checkpoint : {};
  const signalDates = [task.last_worker_activity_at, attempt.last_activity_at]
    .filter((value) => instant(value) !== null)
    .sort((left, right) => instant(right) - instant(left));
  // Intent, task.updated_at and supervisor ticks are not worker heartbeats.
  const signal = timestamp(signalDates[0], now);
  const intent = timestamp(attempt.intent_at, now);
  const status = key(task.status);
  const verification = key(task.verification_status);
  const links = [
    ["PR", evidence.pr_url],
    ["CI", evidence.ci_url],
    ["Receipt", evidence.receipt_url ?? task.reported_receipt_url],
    ["Sesión", attempt.session_url],
    ["Ejecución", attempt.run_url],
  ]
    .map(([label, url]) => ({ label, url: safeUrl(url) }))
    .filter((link) => link.url);
  const sha = plain(evidence.sha) || plain(checkpoint.current_sha);
  const verifiedEvidence =
    VERIFIED.has(verification) &&
    SHA.test(sha) &&
    links.some((link) => ["PR", "CI", "Receipt"].includes(link.label));
  const requiresUat = contract.requires_uat === true;
  const uatApproved = ["approved", "passed", "verified"].includes(key(task.uat_status));
  const staleMs = staleAfterMinutes * 60_000;
  const signalFresh =
    signal.ms !== null && now !== null && now >= signal.ms && now - signal.ms <= staleMs;
  const dispatchStale =
    intent.ms !== null && now !== null && now >= intent.ms && now - intent.ms > staleMs;
  let state = {
    label: "Estado no registrado",
    tone: "neutral",
    detail: "Falta el estado de esta tarea.",
  };

  if (
    [
      "blocked",
      "failed",
      "waiting_human",
      "waiting_user",
      "auth_required",
      "paused_error",
    ].includes(status)
  ) {
    state = {
      label: "Bloqueado",
      tone: "danger",
      detail: "La siguiente acción debe resolver el bloqueo registrado.",
    };
  } else if (["uncertain", "dispatch_uncertain", "recovery_required"].includes(status)) {
    state = {
      label: "Incierto",
      tone: "attention",
      detail: "Reconciliar el intento anterior antes de volver a ejecutar.",
    };
  } else if (["cancelled", "canceled", "aborted"].includes(status)) {
    state = {
      label: "Cancelado",
      tone: "neutral",
      detail: "Este trabajo no se reanuda automáticamente.",
    };
  } else if (["waiting_uat", "uat_pending"].includes(status)) {
    state = {
      label: "UAT pendiente",
      tone: "attention",
      detail: "Falta aceptación funcional; no implica autorización de producción.",
    };
  } else if (
    DELIVERED.has(status) ||
    ["verified", "verifying", "verification_pending"].includes(status)
  ) {
    if (verifiedEvidence && requiresUat && !uatApproved) {
      state = {
        label: "UAT pendiente",
        tone: "attention",
        detail: "Verificación técnica registrada. Falta aceptación funcional.",
      };
    } else if (verifiedEvidence) {
      state = {
        label: "Verificado",
        tone: "success",
        detail: "Verificación técnica con evidencia registrada. Producción tiene su propio gate.",
      };
    } else if (
      ["verifying", "verified", "verification_pending"].includes(status) ||
      ["running", "verifying", "checking"].includes(verification) ||
      VERIFIED.has(verification)
    ) {
      state = {
        label: "Verificando",
        tone: "attention",
        detail: "Todavía falta la verificación completa o su evidencia.",
      };
    } else {
      state = {
        label: "Entregado",
        tone: "attention",
        detail: "El worker reportó un resultado; falta comprobarlo.",
      };
    }
  } else if (status === "dispatching") {
    state = {
      label: "Intento reservado",
      tone: "info",
      detail: "Reserva persistida antes de la activación. Todavía falta el acuse del worker.",
    };
  } else if (["stale", "no_signal"].includes(status)) {
    state = {
      label: "Sin señal",
      tone: "attention",
      detail: "No se acredita actividad reciente del worker. No autoriza un relevo por sí solo.",
    };
  } else if (
    status === "running" &&
    ["turn.completed", "turn.failed"].includes(attempt.last_activity_type)
  ) {
    state = {
      label: "Cierre pendiente",
      tone: "attention",
      detail: "Se recibió un evento terminal. Todavía falta comprobar el cierre del proceso.",
    };
  } else if (WORKING.has(status)) {
    const awaiting = ["dispatched", "sent"].includes(status);
    if (
      (!awaiting && !signalFresh) ||
      (signal.ms !== null && !signalFresh) ||
      (signal.ms === null && dispatchStale)
    ) {
      state = {
        label: "Sin señal",
        tone: "attention",
        detail: "No se acredita actividad reciente del worker. No autoriza un relevo por sí solo.",
      };
    } else {
      state = awaiting
        ? {
            label: "Enviado",
            tone: "info",
            detail: "La entrega al worker no acredita que el trabajo haya terminado.",
          }
        : {
            label: "Ejecutando",
            tone: "info",
            detail: "Estado activo con una señal reciente del worker.",
          };
    }
  } else if (
    ["queued", "ready", "admitted", "pending", "ready_to_resume", "retry_scheduled"].includes(
      status,
    )
  ) {
    state = {
      label: "En cola",
      tone: "neutral",
      detail: "Aún no se acredita un ejecutor activo para esta tarea.",
    };
  } else if (status === "paused_capacity") {
    state = {
      label: "Bloqueado",
      tone: "attention",
      detail: "Capacidad insuficiente; conservar el checkpoint y respetar el próximo reintento.",
    };
  } else if (status) {
    state = {
      label: "Estado sin clasificar",
      tone: "neutral",
      detail: `Estado recibido: ${plain(task.status)}`,
    };
  }

  const needsUser = task.requires_user_action === true || state.label === "UAT pendiente";
  const userAction = needsUser
    ? "Sí"
    : task.requires_user_action === false
      ? "No requerida"
      : "No registrada";
  return {
    id: plain(task.task_id) || "ID no registrado",
    title: plain(task.title) || plain(contract.objective) || "Tarea sin título registrado",
    objective: plain(contract.objective),
    state,
    needsUser,
    userAction,
    worker: plain(attempt.worker_id) || "No registrado",
    attempt: plain(attempt.attempt_id) || "No registrado",
    branch: plain(contract.branch) || "No registrada",
    sha: sha || "No registrado",
    next: plain(task.next_action) || "No registrada",
    signal,
    intent,
    links,
  };
}

function dashboardView(
  state,
  { now = new Date().toISOString(), runUrl = null, staleAfterMinutes = 30 } = {},
) {
  const source = record(state) ? state : {};
  const currentTime = instant(now);
  const threshold =
    Number.isFinite(staleAfterMinutes) && staleAfterMinutes > 0 ? staleAfterMinutes : 30;
  const tasks = (Array.isArray(source.tasks) ? source.tasks : [])
    .filter(record)
    .map((task) => taskView(task, currentTime, threshold));
  return {
    tasks,
    threshold,
    generated: timestamp(now, currentTime),
    tick: timestamp(source.observer_checked_at, currentTime),
    transition: timestamp(source.last_tick_at, currentTime),
    updated: timestamp(source.updated_at, currentTime),
    runUrl: safeUrl(runUrl),
    activeTask: plain(source.active_task_id) || "No registrada",
    sequence:
      Number.isSafeInteger(source.sequence) && source.sequence >= 0
        ? String(source.sequence)
        : "No registrada",
    legacySha: record(source.legacy) ? plain(source.legacy.head_sha) : "",
  };
}

function timeText(time) {
  return time.age ? `${time.text} · ${time.age}` : time.text;
}

export function renderSupervisorMarkdown(state, options = {}) {
  const view = dashboardView(state, options);
  const lines = [
    "# Governance · Supervisor de trabajo",
    "",
    `**Última consulta del supervisor:** ${markdown(timeText(view.tick))}`,
    `**Última transición persistida:** ${markdown(timeText(view.transition))}`,
    `**Vista generada:** ${markdown(view.generated.text)}`,
    `**Registro actualizado:** ${markdown(timeText(view.updated))}`,
    `**Secuencia:** ${markdown(view.sequence)} · **Asignación activa registrada:** ${markdown(view.activeTask)}`,
    "",
    `La actividad del worker se comprueba por su propia señal. Umbral de antigüedad: ${view.threshold} min.`,
    "Un resultado entregado todavía requiere verificación; la aprobación de producción se registra por separado.",
    "",
  ];
  if (view.runUrl) lines.push(`[Consultar ejecución del supervisor](<${view.runUrl}>)`, "");
  if (!view.tasks.length) {
    lines.push(
      "## Sin tareas registradas",
      "",
      "No hay tareas en este registro. Esto no acredita que todos los chats estén terminados.",
      "",
    );
  } else {
    lines.push(
      "| Tarea | Estado | Worker | Última señal del worker | Intervención de Mike |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const task of view.tasks) {
      lines.push(
        `| ${markdown(task.id)} · ${markdown(task.title)} | ${markdown(task.state.label)} | ${markdown(task.worker)} | ${markdown(timeText(task.signal))} | ${markdown(task.userAction)} |`,
      );
    }
    lines.push("");
    for (const task of view.tasks) {
      lines.push(
        `## ${markdown(task.title)}`,
        "",
        `**${markdown(task.state.label)}** · ${markdown(task.state.detail)}`,
        "",
      );
      if (task.objective) lines.push(markdown(task.objective), "");
      lines.push(
        `- **Tarea:** ${markdown(task.id)}`,
        `- **Worker / intento:** ${markdown(task.worker)} / ${markdown(task.attempt)}`,
        `- **Última señal del worker:** ${markdown(timeText(task.signal))}`,
        `- **Envío solicitado:** ${markdown(timeText(task.intent))}`,
        `- **Rama:** ${markdown(task.branch)}`,
        `- **SHA del resultado:** <code>${html(task.sha)}</code>`,
        `- **Siguiente acción:** ${markdown(task.next)}`,
        `- **Intervención de Mike:** ${markdown(task.userAction)}`,
        "",
        task.links.length
          ? task.links.map((link) => `[${link.label}](<${link.url}>)`).join(" · ")
          : "Sin enlaces de evidencia registrados.",
        "",
      );
    }
  }
  if (view.legacySha)
    lines.push(
      `**Referencia observada del registro anterior:** <code>${html(view.legacySha)}</code>`,
      "",
    );
  return lines.join("\n");
}

export function renderSupervisorHtml(state, options = {}) {
  const view = dashboardView(state, options);
  const link = ({ label, url }) =>
    `<a href="${html(url)}" rel="noopener noreferrer">${html(label)} <span aria-hidden="true">↗</span></a>`;
  const field = (label, value) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`;
  const cards = view.tasks
    .map(
      (task) => `<article class="task">
    <div class="task-top"><span class="task-id">${html(task.id)}</span><span class="badge ${task.state.tone}">${html(task.state.label)}</span></div>
    <h2>${html(task.title)}</h2>
    ${task.objective && task.objective !== task.title ? `<p class="objective">${html(task.objective)}</p>` : ""}
    <p class="state-detail">${html(task.state.detail)}</p>
    <dl class="task-fields">
      ${field("Worker", task.worker)}${field("Intento", task.attempt)}
      ${field("Última señal del worker", timeText(task.signal))}${field("Envío solicitado", timeText(task.intent))}
      ${field("Rama", task.branch)}<div><dt>SHA del resultado</dt><dd><code>${html(task.sha)}</code></dd></div>
    </dl>
    <div class="next"><h3>Siguiente acción</h3><p>${html(task.next)}</p><p class="intervention">Intervención de Mike: <strong>${html(task.userAction)}</strong></p></div>
    <nav class="evidence" aria-label="Evidencia de ${html(task.id)}">${task.links.length ? task.links.map(link).join("") : '<span class="muted">Sin enlaces de evidencia registrados.</span>'}</nav>
  </article>`,
    )
    .join("\n");
  const active = view.tasks.filter((task) => task.state.label === "Ejecutando").length;
  const verified = view.tasks.filter((task) => task.state.label === "Verificado").length;
  const attention = view.tasks.filter((task) =>
    ["attention", "danger"].includes(task.state.tone),
  ).length;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Governance · Supervisor de trabajo</title>
<style>
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #192637; background: #f3f5f8; }
  * { box-sizing: border-box; }
  body { margin: 0; line-height: 1.55; }
  main { max-width: 1180px; margin: 0 auto; padding: 44px 28px 56px; }
  h1, h2, h3, p { margin: 0; }
  .eyebrow { color: #465b76; font-size: .75rem; letter-spacing: .14em; font-weight: 750; text-transform: uppercase; }
  h1 { font-size: clamp(1.9rem, 4vw, 2.7rem); line-height: 1.18; letter-spacing: -.035em; margin-top: 8px; }
  .intro { color: #526278; max-width: 760px; margin-top: 12px; }
  .overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 28px 0 20px; }
  .metric { background: #fff; border: 1px solid #dbe2ea; border-radius: 12px; padding: 18px 20px; }
  .metric strong { display: block; font-size: 1.9rem; line-height: 1.15; }
  .metric span { color: #526278; font-size: .84rem; }
  .supervisor { border-left: 3px solid #657a96; padding: 4px 0 4px 18px; margin-bottom: 28px; }
  .supervisor p { margin-bottom: 4px; font-size: .85rem; overflow-wrap: anywhere; }
  .supervisor a { display: inline-block; margin-top: 6px; }
  .tasks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
  .task { background: #fff; border: 1px solid #dbe2ea; border-radius: 16px; padding: 24px; min-width: 0; }
  .task-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
  .task-id { font: .73rem ui-monospace, SFMono-Regular, Consolas, monospace; color: #596b82; overflow-wrap: anywhere; padding-top: 5px; }
  .badge { font-weight: 700; font-size: .72rem; padding: 4px 9px; border-radius: 5px; flex-shrink: 0; }
  .neutral { color: #43546b; background: #ecf0f5; } .info { color: #174a8b; background: #e8f0fd; }
  .attention { color: #754600; background: #fff1ce; } .danger { color: #962627; background: #fce8e8; }
  .success { color: #186143; background: #e1f2e8; }
  h2 { font-size: 1.18rem; line-height: 1.35; letter-spacing: -.018em; overflow-wrap: anywhere; }
  .objective { margin-top: 9px; font-size: .87rem; color: #526278; overflow-wrap: anywhere; }
  .state-detail { font-size: .8rem; margin-top: 9px; color: #526278; }
  .task-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
  dt { font-size: .7rem; color: #65748a; margin-bottom: 3px; } dd { margin: 0; font-size: .81rem; overflow-wrap: anywhere; }
  code { font: .74rem ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  .next { background: #f5f7fa; border-radius: 8px; padding: 13px 15px; overflow-wrap: anywhere; }
  h3 { font-size: .74rem; font-weight: 750; margin-bottom: 5px; } .next p { font-size: .84rem; }
  .next .intervention { color: #526278; font-size: .74rem; margin-top: 9px; }
  .evidence { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 18px; font-size: .79rem; }
  a { color: #245b9b; text-decoration-thickness: 1px; text-underline-offset: 3px; overflow-wrap: anywhere; }
  a:focus-visible { outline: 3px solid #245b9b; outline-offset: 4px; border-radius: 2px; }
  .muted, footer { color: #5d6d81; } footer { font-size: .77rem; margin-top: 28px; overflow-wrap: anywhere; }
  footer p + p { margin-top: 7px; } .empty { background: #fff; border: 1px solid #dbe2ea; border-radius: 16px; padding: 32px; }
  .empty p { color: #526278; margin-top: 10px; }
  @media (max-width: 720px) { main { padding: 26px 16px 36px; } .overview { grid-template-columns: repeat(2, 1fr); } .tasks { grid-template-columns: 1fr; } .task { padding: 20px; } }
  @media (max-width: 360px) { .task-top { flex-wrap: wrap; } .task-fields { grid-template-columns: 1fr; } .metric { padding: 14px; } }
  @media print { body { background: #fff; } main { padding: 0; } .task { break-inside: avoid; } }
</style>
</head>
<body><main>
  <header><p class="eyebrow">Governance 2.0</p><h1>Supervisor de trabajo</h1><p class="intro">Quién tiene cada tarea, qué evidencia dejó y cuál es la siguiente acción.</p></header>
  <section class="overview" aria-label="Resumen de tareas">
    <div class="metric"><strong>${view.tasks.length}</strong><span>Tareas registradas</span></div>
    <div class="metric"><strong>${active}</strong><span>Con actividad reciente</span></div>
    <div class="metric"><strong>${attention}</strong><span>Requieren atención</span></div>
    <div class="metric"><strong>${verified}</strong><span>Verificadas</span></div>
  </section>
  <section class="supervisor" aria-label="Estado de la consulta">
    <p><strong>Última consulta del supervisor:</strong> ${html(timeText(view.tick))}</p>
    <p><strong>Última transición persistida:</strong> ${html(timeText(view.transition))}</p>
    <p><strong>Vista generada:</strong> ${html(view.generated.text)}</p>
    <p><strong>Registro actualizado:</strong> ${html(timeText(view.updated))}</p>
    <p><strong>Secuencia:</strong> ${html(view.sequence)} · <strong>Asignación activa registrada:</strong> ${html(view.activeTask)}</p>
    ${view.runUrl ? link({ label: "Consultar ejecución del supervisor", url: view.runUrl }) : ""}
  </section>
  ${view.tasks.length ? `<section class="tasks" aria-label="Tareas y evidencia">${cards}</section>` : '<section class="empty"><h2>Sin tareas registradas</h2><p>No hay tareas en este registro. Esto no acredita que todos los chats estén terminados.</p></section>'}
  <footer><p>La actividad del worker se comprueba por su propia señal. Umbral de antigüedad: ${view.threshold} min. Una consulta nueva del supervisor no renueva esa señal.</p><p>Entregado significa resultado recibido. Verificado requiere evidencia técnica. UAT y autorización de producción se registran por separado.</p>${view.legacySha ? `<p>Referencia observada del registro anterior: <code>${html(view.legacySha)}</code></p>` : ""}</footer>
</main></body></html>`;
}
