// Isolated PostgreSQL integration tests. No remote URL, credentials or ports.
// Requires Docker; deliberately separate from Vitest and all Sandbox UAT scripts.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const image =
  "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const container = `demeter-workshop-payment-${randomUUID()}`;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studio = id(1),
  otherStudio = id(2),
  admin = id(11),
  student = id(21);
const sqlString = (value) => (value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const array = (ids) => `array[${ids.map(sqlString).join(",")}]::uuid[]`;
const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", cwd: root });
const psqlArgs = [
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-U",
  "postgres",
];
const execute = (sql) => docker(psqlArgs, sql);
function query(sql) {
  const result = execute(sql);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function json(sql) {
  return JSON.parse(query(sql));
}
function denied(sql, message) {
  const result = execute(sql);
  assert.notEqual(result.status, 0, "Expected SQL rejection");
  assert.ok(result.stderr.includes(message), result.stderr);
}
function asRole(role, user, sql) {
  const claims = { role, ...(user ? { sub: user } : {}) };
  return `begin; set local role ${role}; set local request.jwt.claims = ${sqlString(JSON.stringify(claims))}; ${sql}; commit;`;
}
function concurrent(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(sql);
  });
}
function offer({ capacity = 3, count = 2, deposit = false } = {}) {
  const offerId = randomUUID(),
    sessions = Array.from({ length: count }, () => randomUUID()).sort();
  query(`insert into public.workshop_offers(id,studio_id,title,full_price_minor,allow_individual_sessions,deposit_mode,deposit_value,balance_due_at)
    values (${sqlString(offerId)},${sqlString(studio)},'Local payment test',60000,true,
    '${deposit ? "percent" : "full"}',${deposit ? 50 : "null"},now()+interval '10 days');
    ${sessions
      .map(
        (
          session,
        ) => `insert into public.class_sessions(id,studio_id,starts_at,capacity) values (${sqlString(session)},${sqlString(studio)},now()+interval '20 days',${capacity});
    insert into public.workshop_offer_sessions values (${sqlString(offerId)},${sqlString(session)},15000);`,
      )
      .join("\n")}`);
  return { offerId, sessions, capacity };
}
function review(workshop, overrides = {}) {
  return {
    ...workshop,
    studio,
    student,
    mode: "full",
    key: randomUUID(),
    amount: 60000,
    currency: "MXN",
    method: "bank_transfer",
    reference: `local-${randomUUID()}`,
    received: true,
    ...overrides,
  };
}
function authorizationSql(r) {
  return `select public.admin_authorize_workshop_payment(${sqlString(r.studio)},${sqlString(r.offerId)},${sqlString(r.student)},${array(r.sessions)},${sqlString(r.mode)},${sqlString(r.key)},${r.amount},${sqlString(r.currency)},${sqlString(r.method)},${sqlString(r.reference)},${r.received === null ? "null" : r.received})`;
}
function authorize(r) {
  return json(asRole("authenticated", admin, authorizationSql(r))).authorization_id;
}
function confirmSql(authorization, r) {
  return `select public.workshop_checkout_confirm_authorized(${sqlString(r.studio)},${sqlString(authorization)},${sqlString(r.key)})`;
}
function confirm(authorization, r) {
  return json(asRole("service_role", null, confirmSql(authorization, r)));
}
function unconsumed(authorization) {
  assert.equal(
    query(
      `select consumed_purchase_id is null from public.workshop_payment_authorizations where id=${sqlString(authorization)}`,
    ),
    "t",
  );
}
function noPurchase(r) {
  assert.equal(
    query(
      `select count(*) from public.workshop_purchases where studio_id=${sqlString(r.studio)} and idempotency_key=${sqlString(r.key)}`,
    ),
    "0",
  );
  assert.equal(
    query(
      `select count(*) from public.sales where studio_id=${sqlString(r.studio)} and idempotency_key=${sqlString(r.key)}`,
    ),
    "0",
  );
}
let passed = 0,
  started = false;
async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
try {
  const start = docker([
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data:rw",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    image,
  ]);
  assert.equal(start.status, 0, start.stderr || start.error?.message);
  started = true;
  for (let attempt = 0; ; attempt++) {
    // The image starts a temporary initialization server before restarting it.
    // Wait for PID 1 to become the final postgres process, not that temporary socket.
    if (
      docker(["exec", container, "cat", "/proc/1/comm"]).stdout?.trim() === "postgres" &&
      docker(["exec", container, "pg_isready", "-U", "postgres"]).status === 0
    )
      break;
    assert.ok(attempt < 100, "PostgreSQL did not become ready");
    await setTimeout(100);
  }
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  query(source("supabase/tests/fixtures/workshop-payment-host.sql"));
  const history = JSON.parse(
    source("supabase/tests/fixtures/workshop-migration-history-20261015.json"),
  );
  await test("six historical migrations reconstruct the exact Sandbox workshop catalog", () => {
    const versions = history.migrations.map((migration) => migration.version);
    assert.deepEqual(versions, [...versions].sort());
    assert.equal(versions.length, 6);
    for (const migration of history.migrations) {
      const sql = source(migration.path);
      assert.equal(
        createHash("sha256").update(sql.trimEnd()).digest("hex"),
        migration.normalizedSha256,
      );
      query(`begin; ${sql}; commit;`);
    }
    const actual = json(source("supabase/tests/workshop-catalog.sql"));
    const expected = JSON.parse(
      source("supabase/tests/fixtures/workshop-sandbox-catalog-20261015.json"),
    );
    assert.deepEqual(actual, expected);
  });
  // Exercise a real historical confirmed purchase BEFORE applying the replacement.
  // Its evidence must survive migration, while its callable paths are retired.
  const legacy = review(offer({ count: 1 }));
  const legacyReceipt = json(
    asRole(
      "authenticated",
      admin,
      `select public.admin_confirm_workshop_payment(${sqlString(legacy.offerId)},${sqlString(legacy.student)},${array(legacy.sessions)},'full',${sqlString(legacy.key)},60000,'transfer',${sqlString(legacy.reference)},true)`,
    ),
  );
  const legacyEvidenceSql = `select to_jsonb(a) from private.workshop_payment_authorizations a where id=${sqlString(legacyReceipt.authorization_id)}`;
  const legacyEvidence = json(legacyEvidenceSql);
  const replacement = source(
    "supabase/migrations/20261015141539_workshop_verified_manual_payment.sql",
  );
  query(`begin; ${replacement}; commit;`);

  await test("all seven module tables enable RLS and deny direct client writes", () => {
    const tables =
      json(`select jsonb_build_object('count',count(*),'rls',bool_and(c.relrowsecurity),
      'client_writes',bool_or(has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
        or has_table_privilege('anon',c.oid,'DELETE') or has_table_privilege('authenticated',c.oid,'INSERT')
        or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE')))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and left(c.relname,9)='workshop_' and c.relkind='r'`);
    assert.deepEqual(tables, { count: 7, rls: true, client_writes: false });
  });

  await test("replacement preserves historical authorization, purchase and payment records", () => {
    assert.deepEqual(json(legacyEvidenceSql), legacyEvidence);
    assert.equal(
      query(
        `select count(*) from public.payments where sale_id=${sqlString(legacyReceipt.sale_id)}`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_purchases where id=${sqlString(legacyReceipt.purchase_id)}`,
      ),
      "1",
    );
  });
  await test("both public and private historical review entrypoints are retired for all client roles", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const schema of ["public", "private"]) {
        denied(
          asRole(
            role,
            admin,
            `select ${schema}.admin_confirm_workshop_payment(null,null,null,null,null,null,null,null,null)`,
          ),
          "permission denied",
        );
      }
    }
  });
  await test("historical request IDs and received-payment references cannot be spent again", () => {
    denied(
      asRole("authenticated", admin, authorizationSql({ ...legacy, reference: randomUUID() })),
      "idempotency_conflict",
    );
    denied(
      asRole("authenticated", admin, authorizationSql({ ...legacy, key: randomUUID() })),
      "historical_payment_conflict",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where provider_event_id=${sqlString(legacy.reference)}`,
      ),
      "0",
    );
  });
  await test("review preserves schedule permissions and active account/studio restrictions", () => {
    const r = review(offer());
    query(
      `update public.studio_memberships set role='sales_only' where user_id=${sqlString(admin)}`,
    );
    denied(asRole("authenticated", admin, authorizationSql(r)), "forbidden");
    query(`update public.studio_memberships set role='admin' where user_id=${sqlString(admin)};
      update public.user_accounts set status='inactive' where id=${sqlString(admin)}`);
    denied(asRole("authenticated", admin, authorizationSql(r)), "forbidden");
    query(`update public.user_accounts set status='active' where id=${sqlString(admin)};
      update public.studios set status='inactive' where id=${sqlString(studio)}`);
    denied(asRole("authenticated", admin, authorizationSql(r)), "forbidden");
    query(`update public.studios set status='active' where id=${sqlString(studio)}`);
    const authorization = authorize(r);
    query(`update public.studios set status='inactive' where id=${sqlString(studio)}`);
    denied(asRole("service_role", null, confirmSql(authorization, r)), "studio_inactive");
    unconsumed(authorization);
    noPurchase(r);
    query(`update public.studios set status='active' where id=${sqlString(studio)}`);
  });

  await test("only authenticated staff with sales/schedule permissions in this studio can attest", () => {
    const r = review(offer());
    denied(asRole("anon", null, authorizationSql(r)), "permission denied");
    denied(asRole("service_role", null, authorizationSql(r)), "permission denied");
    denied(asRole("authenticated", id(12), authorizationSql(r)), "forbidden");
    denied(asRole("authenticated", id(13), authorizationSql(r)), "forbidden");
    denied(asRole("authenticated", null, authorizationSql(r)), "forbidden");
  });
  await test("pending/absent confirmation and unsupported currency/method are rejected", () => {
    const r = review(offer());
    for (const received of [false, null])
      denied(
        asRole("authenticated", admin, authorizationSql({ ...r, received })),
        "payment_not_verified",
      );
    for (const override of [
      { currency: "USD" },
      { method: "card" },
      { reference: " " },
      { amount: 0 },
    ])
      denied(
        asRole("authenticated", admin, authorizationSql({ ...r, ...override })),
        "invalid_payment_authorization",
      );
    noPurchase(r);
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where idempotency_key=${sqlString(r.key)}`,
      ),
      "0",
    );
  });
  await test("review records the real actor and database quote without reserving or selling", () => {
    const r = review(offer(), { mode: "sessions", amount: 30000 });
    const authorization = authorize(r);
    const row = json(
      `select to_jsonb(a) from public.workshop_payment_authorizations a where id=${sqlString(authorization)}`,
    );
    assert.equal(row.verified_by, admin);
    assert.equal(row.total_minor, 30000);
    assert.equal(row.provider, "manual_review");
    assert.deepEqual(row.session_ids, r.sessions);
    unconsumed(authorization);
    noPurchase(r);
    assert.equal(
      query(`select count(*) from public.reservations where session_id=any(${array(r.sessions)})`),
      "0",
    );
  });
  await test("cross-studio students/offers, duplicate selection and required enrollment fail closed", () => {
    const r = review(offer());
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, student: id(23) })),
      "student_not_found",
    );
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, offerId: randomUUID() })),
      "offer_not_found",
    );
    denied(
      asRole(
        "authenticated",
        admin,
        authorizationSql({ ...r, sessions: [r.sessions[0], r.sessions[0]] }),
      ),
      "duplicate_session",
    );
    query(
      `update public.workshop_offers set requires_enrollment=true where id=${sqlString(r.offerId)}`,
    );
    denied(asRole("authenticated", admin, authorizationSql(r)), "enrollment_verification_required");
  });
  await test("both unsafe RPCs and direct evidence writes are inaccessible", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      denied(
        asRole(
          role,
          role === "authenticated" ? admin : null,
          "select public.workshop_checkout_confirm(null,null,null,null,null,null,null,null)",
        ),
        "permission denied",
      );
      denied(
        asRole(
          role,
          role === "authenticated" ? admin : null,
          "select public.workshop_checkout_confirm_v2(null,null,null,null,null,null,null,null,null)",
        ),
        "permission denied",
      );
      denied(
        asRole(
          role,
          admin,
          "insert into public.workshop_payment_authorizations(studio_id) values(null)",
        ),
        "permission denied",
      );
      denied(
        asRole(role, admin, "update public.workshop_payment_authorizations set amount_minor=1"),
        "permission denied",
      );
      denied(
        asRole(role, admin, "delete from public.workshop_payment_authorizations"),
        "permission denied",
      );
    }
    denied(
      asRole("authenticated", admin, "select * from public.workshop_payment_authorizations"),
      "permission denied",
    );
    denied(
      asRole(
        "authenticated",
        admin,
        "select public.workshop_checkout_confirm_authorized(null,null,null)",
      ),
      "permission denied",
    );
  });
  await test("authorized individual checkout persists one sale/payment and every reservation", () => {
    const r = review(offer(), { mode: "sessions", amount: 30000 });
    const authorization = authorize(r),
      receipt = confirm(authorization, r);
    assert.equal(receipt.total_minor, 30000);
    assert.equal(receipt.replayed, false);
    const row =
      json(`select jsonb_build_object('total',s.total_minor,'paid',p.amount_minor,'method',p.method,
      'reference',p.reference,'reservations',(select count(*) from public.workshop_purchase_sessions where purchase_id=w.id),
      'consumed',a.consumed_purchase_id=w.id) from public.workshop_purchases w
      join public.sales s on s.id=w.sale_id join public.payments p on p.sale_id=s.id
      join public.workshop_payment_authorizations a on a.consumed_purchase_id=w.id where w.id=${sqlString(receipt.purchase_id)}`);
    assert.deepEqual(row, {
      total: 30000,
      paid: 30000,
      method: r.method,
      reference: r.reference,
      reservations: 2,
      consumed: true,
    });
    assert.deepEqual(confirm(authorization, r), { ...receipt, replayed: true });
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(receipt.sale_id)}`),
      "1",
    );
  });
  await test("review replays reordered sessions but rejects changed amount, mode, student or reference", () => {
    const r = review(offer()),
      authorization = authorize(r);
    assert.equal(authorize({ ...r, sessions: [...r.sessions].reverse() }), authorization);
    for (const override of [
      { amount: 30000 },
      { mode: "sessions" },
      { student: id(22) },
      { reference: randomUUID() },
    ])
      denied(
        asRole("authenticated", admin, authorizationSql({ ...r, ...override })),
        "idempotency_conflict",
      );
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, key: randomUUID() })),
      "payment_event_conflict",
    );
  });
  await test("checkout rejects missing evidence, another tenant and a changed checkout key", () => {
    const r = review(offer()),
      authorization = authorize(r);
    denied(
      asRole("service_role", null, confirmSql(randomUUID(), r)),
      "payment_authorization_not_found",
    );
    denied(
      asRole("service_role", null, confirmSql(authorization, { ...r, studio: otherStudio })),
      "payment_authorization_not_found",
    );
    denied(
      asRole("service_role", null, confirmSql(authorization, { ...r, key: randomUUID() })),
      "idempotency_conflict",
    );
    unconsumed(authorization);
    noPurchase(r);
  });
  await test("overpayment, inadequate deposit and a missing balance date are rejected", () => {
    const r = review(offer({ deposit: true }), { amount: 30000 });
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, amount: 60001 })),
      "payment_exceeds_total",
    );
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, amount: 29999 })),
      "insufficient_deposit",
    );
    query(`update public.workshop_offers set balance_due_at=null where id=${sqlString(r.offerId)}`);
    denied(asRole("authenticated", admin, authorizationSql(r)), "balance_due_date_required");
  });
  await test("deposit checkout preserves balance/policy and replay survives subsequent payments", () => {
    const r = review(offer({ deposit: true }), { amount: 30000 }),
      authorization = authorize(r);
    const receipt = confirm(authorization, r);
    assert.equal(receipt.paid_minor, 30000);
    assert.equal(receipt.total_minor, 60000);
    assert.equal(
      query(
        `select balance_due_at is not null from public.workshop_purchases where id=${sqlString(receipt.purchase_id)}`,
      ),
      "t",
    );
    query(
      `update public.workshop_purchases set paid_minor=60000 where id=${sqlString(receipt.purchase_id)}`,
    );
    assert.deepEqual(confirm(authorization, r), { ...receipt, replayed: true });
  });
  await test("price/deposit changes after review cannot silently change the authorized purchase", () => {
    const r = review(offer()),
      authorization = authorize(r);
    query(
      `update public.workshop_offers set full_price_minor=65000 where id=${sqlString(r.offerId)}`,
    );
    denied(asRole("service_role", null, confirmSql(authorization, r)), "authorized_price_changed");
    unconsumed(authorization);
    noPurchase(r);
    const d = review(offer({ deposit: true }), { amount: 30000 }),
      a = authorize(d);
    query(`update public.workshop_offers set deposit_value=75 where id=${sqlString(d.offerId)}`);
    denied(asRole("service_role", null, confirmSql(a, d)), "insufficient_deposit");
    unconsumed(a);
    noPurchase(d);
  });
  await test("a full session after review leaves authorization and all financial rows untouched", () => {
    const r = review(offer()),
      authorization = authorize(r);
    query(`insert into public.reservations(studio_id,session_id,student_id,status,credits_held)
      select ${sqlString(studio)},${sqlString(r.sessions[1])},${sqlString(id(22))},'reserved',0 from generate_series(1,${r.capacity})`);
    denied(asRole("service_role", null, confirmSql(authorization, r)), "session_full");
    unconsumed(authorization);
    noPurchase(r);
    assert.equal(
      query(
        `select count(*) from public.reservations where session_id=${sqlString(r.sessions[0])}`,
      ),
      "0",
    );
  });
  await test("induced second-reservation failure rolls back sale, payment, reservations and consumption", () => {
    const r = review(offer()),
      authorization = authorize(r);
    query(`create function private.local_test_fail() returns trigger language plpgsql as $$ begin
      if new.session_id=${sqlString(r.sessions[1])}::uuid then raise exception 'induced_reservation_failure'; end if;
      return new; end $$;
      create trigger local_test_fail before insert on public.workshop_purchase_sessions for each row execute function private.local_test_fail();`);
    denied(
      asRole("service_role", null, confirmSql(authorization, r)),
      "induced_reservation_failure",
    );
    unconsumed(authorization);
    noPurchase(r);
    assert.equal(
      query(`select count(*) from public.reservations where session_id=any(${array(r.sessions)})`),
      "0",
    );
    query(
      "drop trigger local_test_fail on public.workshop_purchase_sessions; drop function private.local_test_fail();",
    );
    assert.equal(confirm(authorization, r).replayed, false);
  });
  await test("evidence cannot be edited/deleted, including by its database owner", () => {
    const r = review(offer()),
      authorization = authorize(r);
    denied(
      `update public.workshop_payment_authorizations set amount_minor=1 where id=${sqlString(authorization)}`,
      "payment_authorization_immutable",
    );
    denied(
      `delete from public.workshop_payment_authorizations where id=${sqlString(authorization)}`,
      "payment_authorization_immutable",
    );
    confirm(authorization, r);
    denied(
      `update public.workshop_payment_authorizations set consumed_purchase_id=null,consumed_at=null,checkout_result=null where id=${sqlString(authorization)}`,
      "payment_authorization_immutable",
    );
  });
  await test("two independent connections consume the same authorization exactly once", async () => {
    const r = review(offer()),
      authorization = authorize(r);
    const call =
      confirmSql(authorization, r).replace(
        "select ",
        "select jsonb_build_object('pid',pg_backend_pid(),'receipt',",
      ) + ")";
    const results = await Promise.all(
      [0, 1].map(() => concurrent(asRole("service_role", null, `${call}; select pg_sleep(0.3)`))),
    );
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const receipts = results.map((result) => JSON.parse(result.stdout.trim()));
    assert.notEqual(receipts[0].pid, receipts[1].pid);
    assert.deepEqual(receipts.map((r) => r.receipt.replayed).sort(), [false, true]);
    assert.equal(receipts[0].receipt.purchase_id, receipts[1].receipt.purchase_id);
    assert.equal(
      query(
        `select count(*) from public.payments where sale_id=${sqlString(receipts[0].receipt.sale_id)}`,
      ),
      "1",
    );
  });
  await test("two independent buyers of the last seat produce one sale and one unconsumed authorization", async () => {
    const workshop = offer({ capacity: 1, count: 1 });
    const r1 = review(workshop),
      r2 = review(workshop, { student: id(22) });
    const a1 = authorize(r1),
      a2 = authorize(r2);
    const results = await Promise.all(
      [
        [a1, r1],
        [a2, r2],
      ].map(([a, r]) =>
        concurrent(asRole("service_role", null, `${confirmSql(a, r)}; select pg_sleep(0.3)`)),
      ),
    );
    assert.equal(results.filter((r) => r.status === 0).length, 1);
    assert.equal(
      results.filter((r) => r.status !== 0 && r.stderr.includes("session_full")).length,
      1,
    );
    assert.equal(
      query(
        `select count(*) from public.reservations where session_id=${sqlString(workshop.sessions[0])}`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where id=any(${array([a1, a2])}) and consumed_purchase_id is null`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.sales where idempotency_key=any(${array([r1.key, r2.key])})`,
      ),
      "1",
    );
  });
  await test("expired sessions and disabled payment methods cannot be attested", () => {
    const r = review(offer());
    query(
      `update public.class_sessions set starts_at=now()-interval '1 day' where id=${sqlString(r.sessions[0])}`,
    );
    denied(asRole("authenticated", admin, authorizationSql(r)), "session_unavailable");
    const d = review(offer());
    query(
      `update public.studio_payment_methods set active=false where studio_id=${sqlString(studio)} and code='bank_transfer'`,
    );
    denied(asRole("authenticated", admin, authorizationSql(d)), "payment_method_unavailable");
  });
  query(
    `update public.studio_payment_methods set active=true where studio_id=${sqlString(studio)}`,
  );
  query(
    `begin; ${source("supabase/migrations/20261015141548_workshop_admin_checkout.sql")}; commit;`,
  );
  const contextSql = (scope, offerId = null) =>
    `select public.admin_workshop_context(${sqlString(scope)},${sqlString(offerId)})`;
  const purchaseSql = (r) =>
    `select public.admin_purchase_workshop(${sqlString(r.studio)},${sqlString(r.offerId)},${sqlString(r.student)},${array(r.sessions)},${sqlString(r.mode)},${sqlString(r.key)},${r.amount},${sqlString(r.method)},${sqlString(r.reference)},${r.received})`;
  const adminPurchase = (r) => json(asRole("authenticated", admin, purchaseSql(r)));
  const noAuthorization = (r) =>
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where studio_id=${sqlString(r.studio)} and idempotency_key=${sqlString(r.key)}`,
      ),
      "0",
    );
  await test("authenticated context scopes offers, students, prices and cupos to this studio", () => {
    const r = review(offer());
    const foreign = randomUUID();
    query(
      `insert into public.workshop_offers(id,studio_id,title,full_price_minor) values (${sqlString(foreign)},${sqlString(otherStudio)},'Other studio',10000)`,
    );
    const list = json(asRole("authenticated", admin, contextSql(studio)));
    assert.ok(list.offers.some((o) => o.id === r.offerId));
    assert.ok(!list.offers.some((o) => o.id === foreign));
    const detail = json(asRole("authenticated", admin, contextSql(studio, r.offerId)));
    assert.equal(detail.offer.fullPriceMinor, 60000);
    assert.equal(detail.sessions.length, 2);
    assert.equal(detail.sessions[0].priceMinor, 15000);
    assert.equal(detail.sessions[0].capacityRemaining, 3);
    assert.ok(detail.students.every((s) => s.id !== id(23)));
    denied(asRole("authenticated", admin, contextSql(studio, foreign)), "offer_not_found");
    denied(asRole("authenticated", admin, contextSql(otherStudio)), "forbidden");
    denied(asRole("anon", null, contextSql(studio)), "permission denied");
  });
  await test("read context hides student identities without students.read and refuses writes", () => {
    const r = review(offer());
    query(`update public.studio_memberships set role='reader' where user_id=${sqlString(id(12))}`);
    const detail = json(asRole("authenticated", id(12), contextSql(studio, r.offerId)));
    assert.deepEqual(detail.students, []);
    denied(asRole("authenticated", id(12), purchaseSql(r)), "forbidden");
    query(`update public.studio_memberships set role='student' where user_id=${sqlString(id(12))}`);
    noPurchase(r);
    noAuthorization(r);
  });
  await test("admin action RPC atomically buys selected individual dates with a deposit and stable replay", () => {
    const r = review(offer({ deposit: true }), { mode: "sessions", amount: 15000 });
    const receipt = adminPurchase(r);
    assert.equal(receipt.total_minor, 30000);
    assert.equal(receipt.paid_minor, 15000);
    assert.deepEqual(adminPurchase(r), { ...receipt, replayed: true });
    assert.equal(
      query(
        `select count(*) from public.workshop_purchase_sessions where purchase_id=${sqlString(receipt.purchase_id)}`,
      ),
      "2",
    );
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(receipt.sale_id)}`),
      "1",
    );
    query(
      `insert into private.local_booking_gate_fixture(student_id,session_id,blocked) values (${sqlString(student)},${sqlString(r.sessions[0])},true)`,
    );
    assert.equal(adminPurchase(r).replayed, true);
  });
  await test("admin RPC denies service/anonymous callers and cross-studio or inactive students", () => {
    const r = review(offer());
    for (const role of ["anon", "service_role"])
      denied(asRole(role, null, purchaseSql(r)), "permission denied");
    denied(
      asRole("authenticated", admin, purchaseSql({ ...r, student: id(23) })),
      "student_not_operable",
    );
    denied(asRole("authenticated", admin, purchaseSql({ ...r, studio: otherStudio })), "forbidden");
    query(`update public.students set active=false where id=${sqlString(id(22))}`);
    denied(
      asRole("authenticated", admin, purchaseSql({ ...r, student: id(22) })),
      "student_not_operable",
    );
    query(`update public.students set active=true where id=${sqlString(id(22))}`);
    noPurchase(r);
    noAuthorization(r);
  });
  await test("booking/enrollment domain blockers roll back even the received-payment authorization", () => {
    for (const flag of ["blocked", "enrollment_missing"]) {
      const r = review(offer());
      query(
        `insert into private.local_booking_gate_fixture(student_id,session_id,${flag}) values (${sqlString(student)},${sqlString(r.sessions[1])},true)`,
      );
      denied(
        asRole("authenticated", admin, purchaseSql(r)),
        flag === "blocked" ? "booking_blocked" : "enrollment_required",
      );
      noPurchase(r);
      noAuthorization(r);
      query(
        `delete from private.local_booking_gate_fixture where student_id=${sqlString(student)} and session_id=${sqlString(r.sessions[1])}`,
      );
      assert.equal(adminPurchase(r).replayed, false);
    }
  });
  await test("admin transaction requires explicit receipt attestation and rejects altered replay parameters", () => {
    const r = review(offer());
    denied(
      asRole("authenticated", admin, purchaseSql({ ...r, received: false })),
      "payment_not_verified",
    );
    noPurchase(r);
    noAuthorization(r);
    adminPurchase(r);
    denied(
      asRole("authenticated", admin, purchaseSql({ ...r, amount: 30000 })),
      "idempotency_conflict",
    );
  });
  await test("two authenticated administrative buyers serialize the last seat with no losing authorization", async () => {
    const workshop = offer({ capacity: 1, count: 1 });
    const buyers = [review(workshop), review(workshop, { student: id(22) })];
    const results = await Promise.all(
      buyers.map((r) =>
        concurrent(asRole("authenticated", admin, `${purchaseSql(r)};select pg_sleep(0.3)`)),
      ),
    );
    assert.equal(results.filter((r) => r.status === 0).length, 1);
    assert.equal(
      results.filter((r) => r.status !== 0 && r.stderr.includes("session_full")).length,
      1,
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where idempotency_key=any(${array(buyers.map((r) => r.key))})`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.reservations where session_id=${sqlString(workshop.sessions[0])}`,
      ),
      "1",
    );
  });
  query(`begin; ${source("supabase/migrations/20261015141559_workshop_editor.sql")}; commit;`);
  query(`insert into public.disciplines(id,studio_id,name) values
    (${sqlString(id(101))},${sqlString(studio)},'Aro'),(${sqlString(id(102))},${sqlString(studio)},'Telas'),(${sqlString(id(103))},${sqlString(otherStudio)},'Other');
    insert into public.persons(id,studio_id,first_name) values (${sqlString(id(110))},${sqlString(studio)},'Local coach'),(${sqlString(id(114))},${sqlString(otherStudio)},'Other coach');
    insert into public.instructors(id,studio_id,person_id) values (${sqlString(id(111))},${sqlString(studio)},${sqlString(id(110))}),(${sqlString(id(113))},${sqlString(otherStudio)},${sqlString(id(114))});
    insert into public.spaces(id,studio_id,name,capacity) values (${sqlString(id(121))},${sqlString(studio)},'Local room',8),(${sqlString(id(122))},${sqlString(studio)},'Small room',1),(${sqlString(id(123))},${sqlString(otherStudio)},'Other room',8);`);
  let editorSequence = 0;
  const futureDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const draft = () => {
    const sequence = editorSequence++;
    return {
      title: `Editor ${sequence}`,
      fullPriceMinor: 60000,
      allowIndividualSessions: true,
      requiresEnrollment: null,
      depositMode: "percent",
      depositValue: 50,
      balanceDueLocal: futureDate(60) + "T12:00",
      overdueMode: "release_after_grace",
      graceMinutes: 60,
      dates: [0, 1].map((offset) => ({
        sessionId: "",
        date: futureDate(100 + sequence * 4 + offset),
        time: "10:00",
        disciplineId: id(101 + offset),
        durationMinutes: 60,
        capacity: 3,
        priceMinor: 15000,
        instructorId: id(111),
        spaceId: id(121),
      })),
    };
  };
  const editorContextSql = (offerId = null, scope = studio) =>
    `select public.admin_workshop_editor_context(${sqlString(scope)},${sqlString(offerId)})`;
  const editorContext = (offerId) =>
    json(asRole("authenticated", admin, editorContextSql(offerId)));
  const saveSql = (
    body,
    { offerId = null, revision = null, key = randomUUID(), scope = studio } = {},
  ) =>
    `select public.admin_save_workshop(${sqlString(scope)},${sqlString(offerId)},${sqlString(key)},${revision ?? "null"},${sqlString(JSON.stringify(body))}::jsonb)`;
  const save = (body, options) => json(asRole("authenticated", admin, saveSql(body, options)));
  const checkedSql = (r, revision = 1) =>
    purchaseSql(r)
      .replace("admin_purchase_workshop(", "admin_purchase_workshop_checked(")
      .replace(/\)$/, `,${revision})`);
  const checkedPurchase = (r, revision = 1) =>
    json(asRole("authenticated", admin, checkedSql(r, revision)));
  const purchaseFor = (context, offerId, overrides = {}) =>
    review({ offerId, sessions: context.draft.dates.map((row) => row.sessionId) }, overrides);

  await test("editor context and save require active schedule/products permissions in this studio", () => {
    const body = draft();
    denied(asRole("anon", null, saveSql(body)), "permission denied");
    denied(asRole("service_role", null, saveSql(body)), "permission denied");
    denied(asRole("authenticated", id(12), saveSql(body)), "forbidden");
    denied(asRole("authenticated", admin, saveSql(body, { scope: otherStudio })), "forbidden");
    denied(asRole("authenticated", admin, editorContextSql(null, otherStudio)), "forbidden");
    const ctx = editorContext(null);
    assert.equal(ctx.timeZone, "America/Mexico_City");
    assert.equal(ctx.disciplines.length, 2);
    assert.ok(!ctx.spaces.some((s) => s.id === id(123)));
    denied(
      asRole("authenticated", admin, "select * from private.workshop_editor_requests"),
      "permission denied",
    );
  });
  await test("creation creates dedicated Agenda dates with studio timezone and preserves inherited policy", () => {
    const body = draft(),
      receipt = save(body),
      ctx = editorContext(receipt.offer_id);
    assert.equal(receipt.revision, 1);
    assert.equal(ctx.locked, false);
    assert.equal(ctx.draft.requiresEnrollment, null);
    assert.equal(ctx.draft.depositValue, 50);
    assert.equal(ctx.draft.dates.length, 2);
    assert.equal(ctx.draft.dates[0].date, body.dates[0].date);
    assert.equal(ctx.draft.dates[0].time, "10:00");
    assert.equal(
      query(
        `select extract(hour from starts_at at time zone 'UTC') from public.class_sessions where id=${sqlString(ctx.draft.dates[0].sessionId)}`,
      ),
      "16",
    );
    assert.equal(
      query(
        `select count(*) from public.class_templates where workshop_offer_id=${sqlString(receipt.offer_id)} and not active`,
      ),
      "2",
    );
    assert.equal(
      query(
        `select count(*) from public.class_sessions s join public.class_templates t on t.id=s.template_id where t.workshop_offer_id=${sqlString(receipt.offer_id)} and not s.assistant_visible`,
      ),
      "2",
    );
    assert.equal(
      query(
        `select count(*) from public.sales where student_id=${sqlString(student)} and idempotency_key=${sqlString(receipt.offer_id)}`,
      ),
      "0",
    );
  });
  await test("creation and edits are idempotent, including simultaneous retries", async () => {
    const body = draft(),
      key = randomUUID();
    const results = await Promise.all(
      [0, 1].map(() =>
        concurrent(
          asRole("authenticated", admin, `${saveSql(body, { key })};select pg_sleep(0.2)`),
        ),
      ),
    );
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const receipts = results.map((result) => JSON.parse(result.stdout.trim()));
    assert.equal(receipts[0].offer_id, receipts[1].offer_id);
    assert.deepEqual(receipts.map((r) => r.replayed).sort(), [false, true]);
    denied(
      asRole("authenticated", admin, saveSql({ ...body, title: "Changed" }, { key })),
      "idempotency_conflict",
    );
  });
  await test("invalid date, foreign discipline, insufficient space and conflicts roll back all authoring rows", () => {
    const before = query("select count(*) from public.workshop_offers");
    const beforeSessions = query("select count(*) from public.class_sessions");
    for (const [patch, error] of [
      [{ disciplineId: id(103) }, "invalid_discipline"],
      [{ spaceId: id(122) }, "invalid_space"],
      [{ instructorId: id(113) }, "invalid_instructor"],
      [{ date: "2026-02-30" }, "date/time field value out of range"],
    ]) {
      const body = draft();
      body.dates[1] = { ...body.dates[1], ...patch };
      denied(asRole("authenticated", admin, saveSql(body)), error);
    }
    const overlap = draft();
    overlap.dates[1].date = overlap.dates[0].date;
    overlap.dates[1].time = "10:30";
    denied(asRole("authenticated", admin, saveSql(overlap)), "session_conflict");
    assert.equal(query("select count(*) from public.workshop_offers"), before);
    assert.equal(query("select count(*) from public.class_sessions"), beforeSessions);
  });
  await test("unsold edit preserves existing session identity and retires removed dates without deletion", () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      original = ctx.draft.dates[1].sessionId;
    const update = {
      ...ctx.draft,
      title: "Edited future workshop",
      fullPriceMinor: 65000,
      dates: [{ ...ctx.draft.dates[0], time: "11:00", capacity: 4 }],
    };
    const changed = save(update, { offerId: made.offer_id, revision: ctx.revision });
    assert.equal(changed.revision, 2);
    const after = editorContext(made.offer_id);
    assert.equal(after.draft.dates.length, 1);
    assert.equal(after.draft.dates[0].sessionId, ctx.draft.dates[0].sessionId);
    assert.equal(
      query(`select status from public.class_sessions where id=${sqlString(original)}`),
      "cancelled",
    );
    denied(
      `delete from public.class_sessions where id=${sqlString(original)}`,
      "workshop_session_delete_forbidden",
    );
  });
  await test("stale edits and cross-offer session reassignment are rejected", () => {
    const first = save(draft()),
      second = save(draft()),
      a = editorContext(first.offer_id),
      b = editorContext(second.offer_id);
    save({ ...a.draft, title: "First update" }, { offerId: first.offer_id, revision: 1 });
    denied(
      asRole(
        "authenticated",
        admin,
        saveSql({ ...a.draft, title: "Stale update" }, { offerId: first.offer_id, revision: 1 }),
      ),
      "workshop_revision_conflict",
    );
    const current = editorContext(first.offer_id);
    current.draft.dates[0].sessionId = b.draft.dates[0].sessionId;
    denied(
      asRole(
        "authenticated",
        admin,
        saveSql(current.draft, { offerId: first.offer_id, revision: 2 }),
      ),
      "invalid_workshop_session",
    );
  });
  await test("commercial history freezes prices/policy/dates while allowing an audited name-only edit", () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      r = purchaseFor(ctx, made.offer_id, { amount: 30000 });
    const purchase = checkedPurchase(r);
    const historical = query(
      `select to_jsonb(w)::text from public.workshop_purchases w where id=${sqlString(purchase.purchase_id)}`,
    );
    assert.equal(editorContext(made.offer_id).locked, true);
    denied(
      asRole(
        "authenticated",
        admin,
        saveSql({ ...ctx.draft, fullPriceMinor: 65000 }, { offerId: made.offer_id, revision: 1 }),
      ),
      "workshop_edit_locked",
    );
    const renamed = save({ title: "New public name" }, { offerId: made.offer_id, revision: 1 });
    assert.equal(renamed.revision, 2);
    assert.equal(
      query(
        `select to_jsonb(w)::text from public.workshop_purchases w where id=${sqlString(purchase.purchase_id)}`,
      ),
      historical,
    );
    denied(
      `update public.class_sessions set capacity=10 where id=${sqlString(r.sessions[0])}`,
      "workshop_edit_locked",
    );
    denied(
      `update public.class_sessions set status='cancelled' where id=${sqlString(r.sessions[0])}`,
      "workshop_edit_locked",
    );
    assert.equal(checkedPurchase(r, 1).replayed, true);
  });
  await test("unconsumed reviewed payment and historical reservations also freeze configuration", () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      r = purchaseFor(ctx, made.offer_id);
    // Trusted owner executes the preserved review primitive; client grant is retired.
    query(
      `begin;set local request.jwt.claims=${sqlString(JSON.stringify({ role: "authenticated", sub: admin }))};${authorizationSql(r)};commit;`,
    );
    assert.equal(editorContext(made.offer_id).locked, true);
    denied(
      asRole(
        "authenticated",
        admin,
        saveSql(
          { ...ctx.draft, title: "Full forbidden edit" },
          { offerId: made.offer_id, revision: 1 },
        ),
      ),
      "workshop_edit_locked",
    );
    const other = save(draft()),
      o = editorContext(other.offer_id);
    query(
      `insert into public.reservations(studio_id,session_id,student_id,status,credits_held) values (${sqlString(studio)},${sqlString(o.draft.dates[0].sessionId)},${sqlString(student)},'cancelled_by_studio',0)`,
    );
    assert.equal(editorContext(other.offer_id).locked, true);
  });
  await test("changed prices reject stale checkout without recording an unexpected balance", () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      r = purchaseFor(ctx, made.offer_id);
    save({ ...ctx.draft, fullPriceMinor: 65000 }, { offerId: made.offer_id, revision: 1 });
    denied(asRole("authenticated", admin, checkedSql(r, 1)), "workshop_revision_conflict");
    noPurchase(r);
    noAuthorization(r);
    assert.equal(checkedPurchase(r, 2).total_minor, 65000);
    denied(
      asRole("authenticated", admin, purchaseSql({ ...r, key: randomUUID() })),
      "permission denied",
    );
    denied(
      asRole("authenticated", admin, authorizationSql({ ...r, key: randomUUID() })),
      "permission denied",
    );
  });
  await test("concurrent purchase/edit yields either a frozen edit or a stale checkout, never a mixed contract", async () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      r = purchaseFor(ctx, made.offer_id);
    const results = await Promise.all([
      concurrent(asRole("authenticated", admin, `${checkedSql(r, 1)};select pg_sleep(0.2)`)),
      concurrent(
        asRole(
          "authenticated",
          admin,
          `${saveSql({ ...ctx.draft, fullPriceMinor: 70000 }, { offerId: made.offer_id, revision: 1 })};select pg_sleep(0.2)`,
        ),
      ),
    ]);
    assert.equal(results.filter((r) => r.status === 0).length, 1, JSON.stringify(results));
    assert.ok(
      results.some(
        (r) =>
          r.stderr.includes("workshop_edit_locked") ||
          r.stderr.includes("workshop_revision_conflict"),
      ),
    );
  });
  await test("regular packages cannot enter owned or retired workshop dates; legacy/normal rules remain intact", () => {
    const made = save(draft()),
      ctx = editorContext(made.offer_id),
      product = randomUUID();
    assert.equal(
      query(
        `select private.program_product_allows_session(${sqlString(product)},${sqlString(ctx.draft.dates[0].sessionId)})`,
      ),
      "f",
    );
    const regular = json(
      `insert into public.class_templates(studio_id,discipline_id,name,duration_minutes,capacity) values (${sqlString(studio)},${sqlString(id(101))},'Regular',60,3) returning to_jsonb(class_templates)`,
    );
    const session = json(
      `insert into public.class_sessions(studio_id,template_id,starts_at,capacity) values (${sqlString(studio)},${sqlString(regular.id)},now()+interval '1000 days',3) returning to_jsonb(class_sessions)`,
    );
    assert.equal(
      query(
        `select private.program_product_allows_session(${sqlString(product)},${sqlString(session.id)})`,
      ),
      "t",
    );
    const program = randomUUID();
    query(`insert into public.activity_programs(id,studio_id,full_product_id) values (${sqlString(program)},${sqlString(studio)},${sqlString(product)});
      update public.class_templates set program_id=${sqlString(program)} where id=${sqlString(regular.id)};
      insert into public.activity_program_sessions(program_id,session_id) values (${sqlString(program)},${sqlString(session.id)})`);
    assert.equal(
      query(
        `select private.program_product_allows_session(${sqlString(product)},${sqlString(session.id)})`,
      ),
      "t",
    );
    assert.equal(
      query(
        `select private.program_product_allows_session(${sqlString(randomUUID())},${sqlString(session.id)})`,
      ),
      "f",
    );
  });
  // Minimal external enrollment/queue contracts for the new operational migration.
  // The payment, quote, editor, reservations and purchase functions remain real PostgreSQL.
  query(`create table public.student_enrollments (
    id uuid primary key default gen_random_uuid(), studio_id uuid, student_id uuid,
    status text, starts_on date, expires_on date, refunded_at timestamptz);
    create table public.demi_receipt_review_notices (
      id uuid primary key, studio_id uuid, conversation_id uuid, source_kind text, source_id uuid,
      decision text, notification_status text, notification_lease uuid,
      notification_claimed_at timestamptz, notification_error text);
    create table public.assistant_conversations(id uuid primary key,studio_id uuid,student_id uuid);
    create table public.workshop_provisional_holds(id uuid primary key,studio_id uuid,student_id uuid,state text);
    create table public.demi_workshop_hold_links(hold_id uuid,studio_id uuid,conversation_id uuid);
    create table public.demi_enrollment_receipts(id uuid,intent_id uuid,studio_id uuid,status text);
    create table public.assistant_enrollment_intents(id uuid,studio_id uuid,status text,receipt_reference text,conversation_id uuid);
    create table public.assistant_transfer_purchase_intents(id uuid,studio_id uuid,conversation_id uuid,status text,created_at timestamptz);
    grant select,update on public.demi_receipt_review_notices to service_role;
    grant select on public.assistant_conversations,public.workshop_provisional_holds,
      public.demi_workshop_hold_links,public.demi_enrollment_receipts,
      public.assistant_enrollment_intents,public.assistant_transfer_purchase_intents to service_role;`);
  query(
    `begin; ${source("supabase/migrations/20261019041433_workshop_operational_contract.sql")}; commit;`,
  );

  await test("enrollment-required workshop accepts a valid enrollment across all selected dates", () => {
    const w = offer(),
      r = review(w);
    query(`update public.workshop_offers set requires_enrollment=true where id=${sqlString(w.offerId)};
      insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on)
      values (${sqlString(studio)},${sqlString(student)},'active',current_date-1,current_date+30)`);
    const result = json(asRole("authenticated", admin, checkedSql(r, 1)));
    assert.ok(result.purchase_id);
    assert.equal(
      json(asRole("authenticated", admin, checkedSql(r, 1))).purchase_id,
      result.purchase_id,
    );
  });
  await test("expired, refunded, future and other-tenant enrollments cannot authorize funds", () => {
    query("delete from public.student_enrollments");
    for (const policy of [
      "'active',current_date-30,current_date-1,null",
      "'active',current_date-1,current_date+30,now()",
      "'active',current_date+21,current_date+40,null",
      "'cancelled',current_date-1,current_date+30,null",
    ]) {
      const w = offer(),
        r = review(w);
      query(`update public.workshop_offers set requires_enrollment=true where id=${sqlString(w.offerId)};
        insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on,refunded_at)
        values (${sqlString(studio)},${sqlString(student)},${policy})`);
      denied(asRole("authenticated", admin, checkedSql(r, 1)), "enrollment_required");
      noPurchase(r);
      assert.equal(
        query(
          `select count(*) from public.workshop_payment_authorizations where idempotency_key=${sqlString(r.key)}`,
        ),
        "0",
      );
      query("delete from public.student_enrollments");
    }
    const w = offer(),
      r = review(w);
    query(`update public.workshop_offers set requires_enrollment=true where id=${sqlString(w.offerId)};
      insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on)
      values (${sqlString(otherStudio)},${sqlString(student)},'active',current_date-1,current_date+40)`);
    denied(asRole("authenticated", admin, checkedSql(r, 1)), "enrollment_required");
    noPurchase(r);
    query("delete from public.student_enrollments");
  });
  await test("enrollment expires inclusively on each selected local date, not just today", () => {
    const w = offer(),
      r = review(w);
    query(`update public.workshop_offers set requires_enrollment=true where id=${sqlString(w.offerId)};
      insert into public.student_enrollments(studio_id,student_id,status,starts_on,expires_on)
      values (${sqlString(studio)},${sqlString(student)},'active',current_date-1,
        (select (starts_at at time zone 'America/Mexico_City')::date from public.class_sessions where id=${sqlString(w.sessions[0])}));`);
    assert.ok(json(asRole("authenticated", admin, checkedSql(r, 1))).purchase_id);
    query("delete from public.student_enrollments");
  });
  await test("explicit guest offer bypasses enrollment while inherited required policy still blocks", () => {
    const w = offer(),
      r = review(w);
    query(`insert into public.workshop_studio_policies(studio_id,requires_enrollment)
      values (${sqlString(studio)},true) on conflict(studio_id) do update set requires_enrollment=true;
      update public.workshop_offers set requires_enrollment=false where id=${sqlString(w.offerId)}`);
    assert.ok(json(asRole("authenticated", admin, checkedSql(r, 1))).purchase_id);
    const inherited = review(offer());
    denied(asRole("authenticated", admin, checkedSql(inherited, 1)), "enrollment_required");
    noPurchase(inherited);
    query(
      `update public.workshop_studio_policies set requires_enrollment=false where studio_id=${sqlString(studio)}`,
    );
  });
  await test("new deposits freeze their first selected date and the studio-local accounting deadline", () => {
    const w = offer({ deposit: true }),
      r = review(w, { amount: 30000 });
    query(`update public.workshop_offers set balance_due_at=now()+interval '2 years' where id=${sqlString(w.offerId)};
      update public.class_sessions set starts_at=current_date+interval '20 days 03 hours' where id=any(${array(w.sessions)})`);
    const result = json(asRole("authenticated", admin, checkedSql(r, 1)));
    assert.equal(
      query(`select p.balance_due_at=min(s.starts_at) from public.workshop_purchases p
      join public.workshop_purchase_sessions ps on ps.purchase_id=p.id join public.class_sessions s on s.id=ps.session_id
      where p.id=${sqlString(result.purchase_id)} group by p.balance_due_at`),
      "t",
    );
    assert.equal(
      query(`select s.payment_due_on=(p.balance_due_at at time zone st.timezone)::date
      from public.sales s join public.workshop_purchases p on p.sale_id=s.id join public.studios st on st.id=p.studio_id
      where p.id=${sqlString(result.purchase_id)}`),
      "t",
    );
    assert.equal(
      json(asRole("authenticated", admin, contextSql(studio, w.offerId))).offer.dueAt,
      query(
        `select to_json(starts_at)#>>'{}' from public.class_sessions where id=${sqlString(w.sessions[0])}`,
      ),
    );
  });
  await test("individual selection keeps its own deadline and full payments carry no debt date", () => {
    const w = offer({ deposit: true }),
      r = review(w, { mode: "sessions", sessions: [w.sessions[1]], amount: 7500 });
    const result = json(asRole("authenticated", admin, checkedSql(r, 1)));
    assert.equal(
      query(`select p.balance_due_at=s.starts_at from public.workshop_purchases p
      join public.class_sessions s on s.id=${sqlString(w.sessions[1])} where p.id=${sqlString(result.purchase_id)}`),
      "t",
    );
    const fully = json(asRole("authenticated", admin, checkedSql(review(offer()), 1)));
    assert.equal(
      query(
        `select balance_due_at is null from public.workshop_purchases where id=${sqlString(fully.purchase_id)}`,
      ),
      "t",
    );
  });
  await test("workshop review notices revalidate their actual hold, conversation and lease", () => {
    for (const [state, decision, expected] of [
      ["confirmed", "approved", true],
      ["rejected", "rejected", true],
      ["expired", "rejected", true],
      ["reserved_provisionally", "approved", false],
      ["rejected", "approved", false],
    ]) {
      const conversation = randomUUID(),
        hold = randomUUID(),
        notice = randomUUID(),
        lease = randomUUID();
      query(`insert into public.assistant_conversations values(${sqlString(conversation)},${sqlString(studio)},${sqlString(student)});
        insert into public.workshop_provisional_holds values(${sqlString(hold)},${sqlString(studio)},${sqlString(student)},${sqlString(state)});
        insert into public.demi_workshop_hold_links values(${sqlString(hold)},${sqlString(studio)},${sqlString(conversation)});
        insert into public.demi_receipt_review_notices values(${sqlString(notice)},${sqlString(studio)},${sqlString(conversation)},'workshop',${sqlString(hold)},${sqlString(decision)},'claimed',${sqlString(lease)},now(),null)`);
      const revalidate = () =>
        json(
          asRole(
            "service_role",
            null,
            `select public.service_revalidate_demi_receipt_review_notice(${sqlString(notice)},${sqlString(lease)})`,
          ),
        );
      assert.equal(revalidate().eligible, expected);
      if (expected) {
        assert.equal(revalidate().eligible, true);
        query(
          `update public.assistant_conversations set student_id=${sqlString(id(22))} where id=${sqlString(conversation)}`,
        );
        assert.equal(revalidate().eligible, false);
      }
      assert.equal(
        json(
          asRole(
            "service_role",
            null,
            `select public.service_revalidate_demi_receipt_review_notice(${sqlString(notice)},${sqlString(randomUUID())})`,
          ),
        ).eligible,
        false,
      );
      denied(
        asRole(
          "authenticated",
          admin,
          `select public.service_revalidate_demi_receipt_review_notice(${sqlString(notice)},${sqlString(lease)})`,
        ),
        "permission denied",
      );
    }
  });
  // Reconstruct the real provisional-hold modules, replacing only the small queue
  // contract fixture used above. No fake claim/Codex/payment engine is involved.
  query(`drop table public.demi_workshop_hold_links; drop table public.workshop_provisional_holds;
    alter table public.assistant_conversations add column status text default 'open',add column assistant_key text default 'demi';
    create table public.assistant_turns(id uuid primary key default gen_random_uuid(),studio_id uuid,conversation_id uuid,role text,direction text,content text,created_at timestamptz default clock_timestamp());
    create table public.assistant_whatsapp_events(id uuid primary key,studio_id uuid,assistant_conversation_id uuid,provider_event_id text);
    create table public.demi_group_bookings(id uuid,studio_id uuid,conversation_id uuid,status text,expires_at timestamptz);
    create table public.demi_group_receipts(id uuid,studio_id uuid,sha256 text,event_id uuid);
    alter table public.demi_enrollment_receipts add column sha256 text, add column event_id uuid;
    alter table public.demi_receipt_review_notices alter column id set default gen_random_uuid(),add column notification_text text,add column amount_minor integer,add column currency text,add column created_at timestamptz default now();
    create unique index local_review_notice_once on public.demi_receipt_review_notices(studio_id,conversation_id,source_kind,source_id,decision);
    create table public.studio_bank_transfer_settings(studio_id uuid primary key,enabled boolean,bank_name text,account_holder text,clabe text,account_number text,instructions text);
    insert into public.studio_bank_transfer_settings values (${sqlString(studio)},true,'UAT bank','Synthetic studio',null,null,'Synthetic fixture; no real payment');
    create table public.assistant_pending_actions(id uuid primary key default gen_random_uuid(),studio_id uuid,conversation_id uuid,action_type text constraint assistant_pending_actions_action_type_check check(action_type in ('booking.create')),action_token_hash text,action_payload jsonb,confirmation_summary jsonb,status text default 'pending',expires_at timestamptz,confirmed_at timestamptz,executed_at timestamptz,execution_ref text,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
    create schema storage;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;`);
  for (const path of [
    "20261016183000_workshop_provisional_hold_storage.sql",
    "20261019042632_workshop_atomic_hold_replay.sql",
    "20261016200000_workshop_preflight_provisional_capacity.sql",
    "20261016213000_workshop_provisional_close_and_reject.sql",
    "20261016220000_workshop_confirm_provisional_hold.sql",
    "20261016230000_workshop_reservation_capacity_gate.sql",
    "20261016231000_workshop_session_hold_capacity_gate.sql",
    "20261016235000_demi_workshop_hold_bridge.sql",
    "20261016235500_demi_workshop_decision_notices.sql",
    "20261019042048_workshop_continuation_and_history.sql",
  ])
    query(`begin; ${source(`supabase/migrations/${path}`)}; commit;`);
  // Re-apply the operational replacement after the recovered historical bridge.
  // CREATE OR REPLACE preserves its existing ACLs and all historical rows.
  query(
    `begin; ${source("supabase/migrations/20261019041433_workshop_operational_contract.sql")}; commit;`,
  );
  query(
    `begin; ${source("supabase/migrations/20261019042239_demi_workshop_purchase_flow.sql")}; commit;`,
  );
  query(
    `update public.workshop_studio_policies set demi_enabled=true where studio_id=${sqlString(studio)}`,
  );
  query(
    `begin; ${source("supabase/migrations/20261019112001_workshop_reservation_cancellation_status.sql").split("create or replace function public.service_process_workshop_overdues")[0]}; commit;`,
  );
  // Actual Supabase roles can SELECT their own source events; functions above are real.
  query("grant select on public.assistant_whatsapp_events to service_role");
  const service = (sql) => json(asRole("service_role", null, sql));
  function conversation(studentId = student) {
    const c = randomUUID(),
      turn = randomUUID();
    query(`insert into public.assistant_conversations(id,studio_id,student_id) values(${sqlString(c)},${sqlString(studio)},${sqlString(studentId)});
      insert into public.assistant_turns(id,studio_id,conversation_id,role,direction,content) values(${sqlString(turn)},${sqlString(studio)},${sqlString(c)},'user','inbound','Quiero comprar el taller')`);
    return { id: c, turn };
  }
  const prepareSql = (w, c) =>
    `select public.service_prepare_demi_workshop_purchase(${sqlString(studio)},${sqlString(c.id)},${sqlString(w.offerId)},${array(w.sessions)},'full',${sqlString(c.turn)})`;
  function accept(c, text = "Sí", turn = randomUUID()) {
    query(
      `insert into public.assistant_turns(id,studio_id,conversation_id,role,direction,content) values(${sqlString(turn)},${sqlString(studio)},${sqlString(c.id)},'user','inbound',${sqlString(text)})`,
    );
    return {
      turn,
      sql: `select public.service_accept_demi_workshop_purchase(${sqlString(studio)},${sqlString(c.id)},${sqlString(turn)})`,
    };
  }
  function receipt(intent, c, hash = createHash("sha256").update(randomUUID()).digest("hex")) {
    const event = randomUUID(),
      provider = `local:${event}`,
      path = `${studio}/workshop/${intent.intent_id}/${hash}`;
    query(
      `insert into public.assistant_whatsapp_events values(${sqlString(event)},${sqlString(studio)},${sqlString(c.id)},${sqlString(provider)})`,
    );
    return {
      event,
      provider,
      hash,
      path,
      sql: `select public.service_record_demi_workshop_receipt(${sqlString(studio)},${sqlString(c.id)},${sqlString(intent.intent_id)},${sqlString(event)},${sqlString(provider)},${sqlString(path)},${sqlString(hash)},${intent.amount_minor},'MXN',0.99)`,
    };
  }
  await test("Demi catalog and quote use live workshops while preparation holds no capacity or funds", () => {
    const w = offer({ deposit: true }),
      c = conversation(),
      intent = service(prepareSql(w, c));
    assert.equal(intent.amount_minor, 30000);
    assert.equal(intent.total_minor, 60000);
    assert.equal(intent.confirmation_required, true);
    assert.equal(service(prepareSql(w, c)).intent_id, intent.intent_id);
    assert.equal(
      query(
        `select count(*) from public.workshop_provisional_holds where request_id=${sqlString(intent.intent_id)}`,
      ),
      "0",
    );
    assert.equal(
      query(
        `select count(*) from public.sales where idempotency_key=${sqlString(intent.intent_id)}`,
      ),
      "0",
    );
    assert.ok(
      service(`select public.service_demi_workshop_catalog(${sqlString(studio)})`).some(
        (x) => x.workshop_ref === `workshop:${w.offerId}`,
      ),
    );
    denied(asRole("authenticated", admin, prepareSql(w, c)), "permission denied");
    const changed = { ...w, sessions: [w.sessions[0]] };
    denied(asRole("service_role", null, prepareSql(changed, c)), "idempotency_conflict");
    denied(
      asRole(
        "service_role",
        null,
        `select public.service_accept_demi_workshop_purchase(${sqlString(studio)},${sqlString(c.id)},${sqlString(c.turn)})`,
      ),
      "explicit_confirmation_required",
    );
    denied(asRole("service_role", null, accept(c, "¿Sí?").sql), "explicit_confirmation_required");
    assert.equal(service(accept(c).sql).status, "receipt_required");
  });
  await test("receipt atomically holds selected seats with no income; duplicate delivery is idempotent", async () => {
    const w = offer({ deposit: true }),
      c = conversation(),
      intent = service(prepareSql(w, c));
    service(accept(c).sql);
    const r = receipt(intent, c),
      responses = await Promise.all([
        concurrent(asRole("service_role", null, r.sql)),
        concurrent(asRole("service_role", null, r.sql)),
      ]);
    assert.ok(
      responses.every((x) => x.status === 0),
      JSON.stringify(responses),
    );
    const hold = service(r.sql);
    assert.equal(hold.replayed, true);
    assert.equal(
      query(
        `select count(*) from public.workshop_provisional_hold_sessions where hold_id=${sqlString(hold.hold_id)}`,
      ),
      "2",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_purchases where idempotency_key=${sqlString(intent.intent_id)}`,
      ),
      "0",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_payment_authorizations where idempotency_key=${sqlString(intent.intent_id)}`,
      ),
      "0",
    );
    assert.equal(editorContext(w.offerId).locked, true);
    denied(
      `update public.class_sessions set starts_at=starts_at+interval '1 hour' where id=${sqlString(w.sessions[0])}`,
      "workshop_edit_locked",
    );
    const approve = () =>
      json(
        asRole(
          "authenticated",
          admin,
          `select public.admin_confirm_workshop_provisional_hold(${sqlString(studio)},${sqlString(hold.hold_id)},true)`,
        ),
      );
    const bought = approve();
    assert.equal(approve().purchase_id, bought.purchase_id);
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(bought.sale_id)}`),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.demi_receipt_review_notices where source_id=${sqlString(hold.hold_id)} and decision='approved'`,
      ),
      "1",
    );
    assert.equal(query(`select private.workshop_receipt_read_allowed(${sqlString(r.path)})`), "f");
    assert.equal(
      query(
        asRole(
          "authenticated",
          admin,
          `select private.workshop_receipt_read_allowed(${sqlString(r.path)})`,
        ),
      ),
      "t",
    );
    assert.equal(
      query(
        asRole(
          "authenticated",
          id(13),
          `select private.workshop_receipt_read_allowed(${sqlString(r.path)})`,
        ),
      ),
      "f",
    );
    const other = offer({ deposit: true }),
      again = { ...c, turn: randomUUID() };
    query(
      `insert into public.assistant_turns(id,studio_id,conversation_id,role,direction,content) values(${sqlString(again.turn)},${sqlString(studio)},${sqlString(c.id)},'user','inbound','Otro taller')`,
    );
    const next = service(prepareSql(other, again));
    service(accept(again).sql);
    denied(asRole("service_role", null, receipt(next, again, r.hash).sql), "receipt_already_used");
  });
  await test("two real receipt transactions competing for the last seat create exactly one hold", async () => {
    const w = offer({ capacity: 1, count: 1, deposit: true }),
      a = conversation(),
      b = conversation(id(22));
    const ai = service(prepareSql(w, a)),
      bi = service(prepareSql(w, b));
    service(accept(a).sql);
    service(accept(b).sql);
    const ar = receipt(ai, a),
      br = receipt(bi, b);
    const outcomes = await Promise.all([
      concurrent(asRole("service_role", null, ar.sql)),
      concurrent(asRole("service_role", null, br.sql)),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 0).length, 1, JSON.stringify(outcomes));
    assert.ok(
      outcomes.some((x) => /session_full|session_unavailable/.test(x.stderr)),
      JSON.stringify(outcomes),
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_provisional_holds where offer_id=${sqlString(w.offerId)} and state='reserved_provisionally'`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_purchases where offer_id=${sqlString(w.offerId)}`,
      ),
      "0",
    );
  });
  await test("unaccepted, mismatched, wrong-source and stale quotes cannot reserve seats", () => {
    const w = offer({ deposit: true }),
      c = conversation(),
      intent = service(prepareSql(w, c)),
      r = receipt(intent, c);
    denied(asRole("service_role", null, r.sql), "workshop_receipt_not_expected");
    service(accept(c).sql);
    denied(
      asRole(
        "service_role",
        null,
        r.sql.replace(`${intent.amount_minor},'MXN'`, `${intent.amount_minor - 1},'MXN'`),
      ),
      "receipt_amount_mismatch",
    );
    denied(
      asRole("service_role", null, r.sql.replace(sqlString(r.path), sqlString("foreign/path"))),
      "receipt_source_mismatch",
    );
    query(`update public.workshop_offers set revision=revision+1 where id=${sqlString(w.offerId)}`);
    denied(asRole("service_role", null, r.sql), "workshop_revision_conflict");
    assert.equal(
      query(
        `select count(*) from public.workshop_provisional_holds where offer_id=${sqlString(w.offerId)}`,
      ),
      "0",
    );
  });
  await test("withdrawal releases only this student's future dates and preserves payments, debt and history", () => {
    const w = offer({ count: 2, deposit: true }),
      a = review(w, { amount: 30000 }),
      b = review(w, { student: id(22), amount: 30000 });
    const purchase = json(asRole("authenticated", admin, checkedSql(a, 1))),
      other = json(asRole("authenticated", admin, checkedSql(b, 1)));
    // Test clock advancement only: the production guard remains enabled after this fixture setup.
    query(`alter table public.class_sessions disable trigger guard_configurable_workshop_session;
      update public.class_sessions set starts_at=now()-interval '1 day' where id=${sqlString(w.sessions[0])};
      alter table public.class_sessions enable trigger guard_configurable_workshop_session;
      update public.reservations set status='no_show' where id=(select reservation_id from public.workshop_purchase_sessions where purchase_id=${sqlString(purchase.purchase_id)} and session_id=${sqlString(w.sessions[0])})`);
    const request = randomUUID(),
      sql = `select public.admin_record_workshop_continuation(${sqlString(studio)},${sqlString(purchase.purchase_id)},${sqlString(request)},'withdraw','La alumna confirmó que no continúa')`;
    denied(asRole("authenticated", id(13), sql), "forbidden");
    const result = json(asRole("authenticated", admin, sql));
    assert.equal(result.released_count, 1);
    assert.equal(json(asRole("authenticated", admin, sql)).replayed, true);
    assert.equal(
      query(
        `select status from public.reservations where id=(select reservation_id from public.workshop_purchase_sessions where purchase_id=${sqlString(purchase.purchase_id)} and session_id=${sqlString(w.sessions[0])})`,
      ),
      "no_show",
    );
    assert.equal(
      query(
        `select count(*) from public.reservations r join public.workshop_purchase_sessions ps on ps.reservation_id=r.id where ps.purchase_id=${sqlString(other.purchase_id)} and r.status='reserved'`,
      ),
      "2",
    );
    assert.equal(
      query(
        `select total_minor-paid_minor from public.workshop_purchases where id=${sqlString(purchase.purchase_id)}`,
      ),
      "30000",
    );
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(purchase.sale_id)}`),
      "1",
    );
    const history = json(
      asRole(
        "authenticated",
        admin,
        `select public.admin_student_workshops(${sqlString(studio)},${sqlString(student)})`,
      ),
    ).find((p) => p.id === purchase.purchase_id);
    assert.equal(history.balanceMinor, 30000);
    assert.equal(history.status, "cancelled");
    assert.equal(history.sessions.length, 2);
    denied(
      asRole("authenticated", admin, sql.replace("'withdraw'", "'continue'")),
      "idempotency_conflict",
    );
  });
  // Reduced external sales/CRM host contracts; workshop and followup functions are real migrations.
  query(`alter table public.sales add column collection_note text, add column updated_at timestamptz;
    alter table public.payments add column sale_line_id uuid,add column notes text,add column effective_on date,add column created_by uuid;
    create table public.sale_lines(id uuid primary key default gen_random_uuid(),sale_id uuid,line_total_minor integer,refunded_at timestamptz);
    create table public.product_acquisitions(id uuid primary key,studio_id uuid,student_id uuid,expires_on date,created_at timestamptz default now(),sale_line_id uuid,status text,refunded_at timestamptz,refund_access_blocked boolean,access_blocked boolean,updated_at timestamptz);
    alter table public.students add column person_id uuid;
    alter table public.assistant_conversations add column channel text default 'whatsapp',add column last_activity_at timestamptz default now(),add column context jsonb default '{}';
    create table public.person_communication_preferences(studio_id uuid,person_id uuid,whatsapp_blocked boolean default false,retention_enabled boolean default true);
    create table public.assistant_handoffs(id uuid primary key default gen_random_uuid(),studio_id uuid,conversation_id uuid,status text default 'open');
    create table public.crm_followups(studio_id uuid,person_id uuid,qualification text,qualification_reason text,revision integer default 0,updated_at timestamptz);
    create table public.crm_contacts(id uuid,studio_id uuid,person_id uuid);
    create table public.demi_uat_runs(studio_id uuid);
    create function public.assistant_create_handoff(uuid,uuid,uuid,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
    insert into public.role_capabilities values('admin','settings.write');
    insert into public.persons(id,studio_id,first_name) values(${sqlString(id(71))},${sqlString(studio)},'Synthetic student');
    update public.students set person_id=${sqlString(id(71))} where id=${sqlString(student)};`);
  for (const path of [
    "20261016161000_workshop_paid_minor_sync_on_installments.sql",
    "20261019043300_workshop_existing_sales_installments.sql",
    "20261009162319_demi_2_followup_runtime.sql",
    "20261009163154_demi_2_followup_sources_and_revalidation.sql",
    "20261010030500_demi_2_followup_stage_content.sql",
    "20261019043144_workshop_demi_continuation_followups.sql",
  ])
    query(`begin; ${source(`supabase/migrations/${path}`)}; commit;`);
  query(
    `insert into public.demi_followup_settings(studio_id,enabled) values(${sqlString(studio)},true)`,
  );
  query(
    `begin; ${source("supabase/migrations/20261019112001_workshop_reservation_cancellation_status.sql")}; commit;`,
  );
  function installment(p, w, amount, reference = randomUUID(), method = "cash") {
    const reservation = query(
      `select reservation_id from public.workshop_purchase_sessions where purchase_id=${sqlString(p.purchase_id)} and session_id=${sqlString(w.sessions[0])}`,
    );
    return `select public.admin_register_workshop_installment(${sqlString(studio)},${sqlString(p.sale_id)},${sqlString(reservation)},${sqlString(w.sessions[0])},${amount},${sqlString(method)},${sqlString(reference)})`;
  }
  await test("installments use the existing ledger, synchronize balance and reject conflicting replay or excess", () => {
    const w = offer({ deposit: true }),
      p = json(asRole("authenticated", admin, checkedSql(review(w, { amount: 30000 }), 1)));
    const sql = installment(p, w, 10000);
    denied(asRole("authenticated", id(13), sql), "forbidden");
    assert.equal(json(asRole("authenticated", admin, sql)).balance_minor, 20000);
    assert.equal(json(asRole("authenticated", admin, sql)).replayed, true);
    denied(
      asRole("authenticated", admin, sql.replace(",10000,", ",11000,")),
      "idempotency_conflict",
    );
    denied(asRole("authenticated", admin, installment(p, w, 20001)), "payment_exceeds_balance");
    assert.equal(
      query(
        `select paid_minor from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      "40000",
    );
    assert.equal(json(asRole("authenticated", admin, installment(p, w, 20000))).balance_minor, 0);
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(p.sale_id)}`),
      "3",
    );
    assert.equal(
      query(`select payment_due_on is null from public.sales where id=${sqlString(p.sale_id)}`),
      "t",
    );
  });
  await test("parallel installments cannot overcollect a workshop balance", async () => {
    const w = offer({ deposit: true }),
      p = json(asRole("authenticated", admin, checkedSql(review(w, { amount: 30000 }), 1)));
    const results = await Promise.all([
      concurrent(asRole("authenticated", admin, installment(p, w, 20000))),
      concurrent(asRole("authenticated", admin, installment(p, w, 20000))),
    ]);
    assert.equal(results.filter((r) => r.status === 0).length, 1);
    assert.ok(results.find((r) => r.status !== 0).stderr.includes("payment_exceeds_balance"));
    assert.equal(
      query(
        `select paid_minor from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      "50000",
    );
  });
  await test("ordinary sale lines keep their collectible and unlock behavior", () => {
    const sale = randomUUID(),
      line = randomUUID(),
      acquisition = randomUUID();
    query(`insert into public.sales(id,studio_id,student_id,folio,status,currency,total_minor) values(${sqlString(sale)},${sqlString(studio)},${sqlString(student)},${sqlString(sale)},'confirmed','MXN',12000);
      insert into public.sale_lines(id,sale_id,line_total_minor) values(${sqlString(line)},${sqlString(sale)},12000);
      insert into public.product_acquisitions(id,sale_line_id,status,refund_access_blocked,access_blocked) values(${sqlString(acquisition)},${sqlString(line)},'active',false,true);`);
    const sql = `select public.register_sale_payment(${sqlString(sale)},12000,'cash','ordinary-sale',null)`;
    assert.equal(json(asRole("authenticated", admin, sql)).balance_minor, 0);
    assert.equal(
      query(
        `select access_blocked from public.product_acquisitions where id=${sqlString(acquisition)}`,
      ),
      "f",
    );
  });
  function missedWorkshop({ paid = false, release = false } = {}) {
    const c = conversation(),
      w = offer({ deposit: !paid });
    const p = json(
      asRole("authenticated", admin, checkedSql(review(w, { amount: paid ? 60000 : 30000 }), 1)),
    );
    query(`alter table public.class_sessions disable trigger guard_configurable_workshop_session;
      update public.class_sessions set starts_at=now()-interval '1 day',ends_at=now()-interval '23 hours' where id=${sqlString(w.sessions[0])};
      alter table public.class_sessions enable trigger guard_configurable_workshop_session;
      update public.reservations set status='no_show' where id=(select reservation_id from public.workshop_purchase_sessions where purchase_id=${sqlString(p.purchase_id)} and session_id=${sqlString(w.sessions[0])});
      update public.workshop_purchases set balance_due_at=now()-interval '1 day',overdue_mode=${sqlString(release ? "release_after_grace" : "keep_and_notify")},grace_minutes=60 where id=${sqlString(p.purchase_id)};`);
    return { c, w, p };
  }
  await test("only the first recorded absence with debt seeds one continuity question", () => {
    const { p } = missedWorkshop(),
      paid = missedWorkshop({ paid: true });
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    assert.equal(
      query(
        `select count(*) from public.demi_followups where source_ref='workshop:${p.purchase_id}'`,
      ),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from public.demi_followups where source_ref='workshop:${paid.p.purchase_id}'`,
      ),
      "0",
    );
  });
  await test("continuation requires delivered question and a later explicit owned reply; withdrawal keeps debt", () => {
    const { c, w, p } = missedWorkshop();
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    const turn = randomUUID();
    query(
      `insert into public.assistant_turns(id,studio_id,conversation_id,role,direction,content) values(${sqlString(turn)},${sqlString(studio)},${sqlString(c.id)},'user','inbound','me retiro del taller')`,
    );
    const sql = `select public.service_record_workshop_continuation(${sqlString(studio)},${sqlString(c.id)},${sqlString(p.purchase_id)},${sqlString(turn)},'withdraw')`;
    denied(asRole("service_role", null, sql), "workshop_question_not_delivered");
    const f = query(
        `select id from public.demi_followups where source_ref='workshop:${p.purchase_id}'`,
      ),
      token = randomUUID();
    query(
      `update public.demi_followups set state='processing',attempt_count=1,lease_token=${sqlString(token)},lease_until=now()+interval '1 hour' where id=${sqlString(f)}`,
    );
    assert.ok(
      service(
        `select public.service_get_demi_followup_message(${sqlString(f)},${sqlString(token)})`,
      ).text.includes("¿Continuarás"),
    );
    // Local provider delivery fixture: no external transport is invoked.
    query(
      `insert into public.demi_followup_attempts(followup_id,attempt,status,recorded_at) values(${sqlString(f)},1,'accepted',now()-interval '1 second'); update public.demi_followups set state='accepted' where id=${sqlString(f)};`,
    );
    query(`update public.assistant_turns set content='no' where id=${sqlString(turn)}`);
    denied(asRole("service_role", null, sql), "explicit_continuation_required");
    query(
      `update public.assistant_turns set content='me retiro del taller' where id=${sqlString(turn)}`,
    );
    assert.equal(service(sql).released_count, 1);
    assert.equal(service(sql).replayed, true);
    assert.equal(
      query(
        `select total_minor-paid_minor from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      "30000",
    );
    assert.equal(
      query(
        `select count(*) from public.workshop_purchase_sessions ps join public.reservations r on r.id=ps.reservation_id where ps.purchase_id=${sqlString(p.purchase_id)} and r.status='cancelled_by_studio'`,
      ),
      "1",
    );
  });
  await test("frozen overdue policy releases future dates once; keep and fully paid purchases remain", () => {
    const release = missedWorkshop({ release: true }),
      keep = missedWorkshop(),
      paid = missedWorkshop({ paid: true, release: true });
    service(`select public.service_process_workshop_overdues(${sqlString(studio)})`);
    assert.equal(
      query(
        `select status from public.workshop_purchases where id=${sqlString(release.p.purchase_id)}`,
      ),
      "released",
    );
    assert.equal(
      query(
        `select status from public.workshop_purchases where id=${sqlString(keep.p.purchase_id)}`,
      ),
      "reserved",
    );
    assert.equal(
      query(
        `select status from public.workshop_purchases where id=${sqlString(paid.p.purchase_id)}`,
      ),
      "reserved",
    );
    assert.equal(
      service(`select public.service_process_workshop_overdues(${sqlString(studio)})`),
      0,
    );
    assert.equal(
      query(
        `select count(*) from private.workshop_overdue_releases where purchase_id=${sqlString(release.p.purchase_id)}`,
      ),
      "1",
    );
  });
  await test("continuing retains future seats, schedules debt reminders once and never repeats the question", () => {
    const { c, w, p } = missedWorkshop();
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    const f = query(
      `select id from public.demi_followups where source_ref='workshop:${p.purchase_id}'`,
    );
    query(`update public.demi_followups set state='accepted',attempt_count=1 where id=${sqlString(f)};
      insert into public.demi_followup_attempts(followup_id,attempt,status,recorded_at) values(${sqlString(f)},1,'accepted',now()-interval '1 second');`);
    const turn = randomUUID();
    query(
      `insert into public.assistant_turns(id,studio_id,conversation_id,role,direction,content) values(${sqlString(turn)},${sqlString(studio)},${sqlString(c.id)},'user','inbound','Sí continúo con el taller')`,
    );
    const sql = `select public.service_record_workshop_continuation(${sqlString(studio)},${sqlString(c.id)},${sqlString(p.purchase_id)},${sqlString(turn)},'continue')`;
    assert.equal(service(sql).decision, "continue");
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    assert.equal(
      query(
        `select count(*) from public.demi_followups where source_ref='workshop:${p.purchase_id}'`,
      ),
      "3",
    );
    assert.equal(
      query(
        `select count(*) from public.reservations r join public.workshop_purchase_sessions ps on ps.reservation_id=r.id where ps.purchase_id=${sqlString(p.purchase_id)} and r.status='reserved'`,
      ),
      "1",
    );
    const next = query(
        `select id from public.demi_followups where source_ref='workshop:${p.purchase_id}' and step=2`,
      ),
      token = randomUUID();
    query(
      `update public.demi_followups set state='processing',attempt_count=1,lease_token=${sqlString(token)},lease_until=now()+interval '1 hour' where id=${sqlString(next)}`,
    );
    const text = service(
      `select public.service_get_demi_followup_message(${sqlString(next)},${sqlString(token)})`,
    ).text;
    assert.ok(text.includes("no necesitas volver a confirmar"));
    assert.ok(!text.includes("¿Continuarás"));
    json(asRole("authenticated", admin, installment(p, w, 30000)));
    assert.equal(
      service(
        `select public.service_get_demi_followup_message(${sqlString(next)},${sqlString(token)})`,
      ).ok,
      false,
    );
  });
  await test("contact opt-out and human control suppress workshop messages before delivery", () => {
    const { p, c } = missedWorkshop();
    service(`select public.service_seed_workshop_followups(${sqlString(studio)})`);
    const f = query(
        `select id from public.demi_followups where source_ref='workshop:${p.purchase_id}'`,
      ),
      token = randomUUID();
    query(`update public.demi_followups set state='processing',attempt_count=1,lease_token=${sqlString(token)},lease_until=now()+interval '1 hour' where id=${sqlString(f)};
      insert into public.person_communication_preferences(studio_id,person_id,whatsapp_blocked) values(${sqlString(studio)},${sqlString(id(71))},true);`);
    assert.equal(
      service(
        `select public.service_get_demi_followup_message(${sqlString(f)},${sqlString(token)})`,
      ).ok,
      false,
    );
    query(`delete from public.person_communication_preferences;
      insert into public.assistant_handoffs(studio_id,conversation_id) values(${sqlString(studio)},${sqlString(c.id)});`);
    assert.equal(
      service(
        `select public.service_get_demi_followup_message(${sqlString(f)},${sqlString(token)})`,
      ).ok,
      false,
    );
  });
  await test("payment and overdue evaluation serialize on the same sale without erasing money", async () => {
    const { p, w } = missedWorkshop({ release: true });
    const results = await Promise.all([
      concurrent(asRole("authenticated", admin, installment(p, w, 30000))),
      concurrent(
        asRole(
          "service_role",
          null,
          `select public.service_process_workshop_overdues(${sqlString(studio)})`,
        ),
      ),
    ]);
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    assert.equal(
      query(
        `select paid_minor from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      "60000",
    );
    assert.equal(
      query(`select sum(amount_minor) from public.payments where sale_id=${sqlString(p.sale_id)}`),
      "60000",
    );
    const released = query(
      `select count(*) from private.workshop_overdue_releases where purchase_id=${sqlString(p.purchase_id)}`,
    );
    const cancelled = query(
      `select count(*) from public.reservations r join public.workshop_purchase_sessions ps on ps.reservation_id=r.id where ps.purchase_id=${sqlString(p.purchase_id)} and r.status='cancelled_by_studio'`,
    );
    assert.equal(cancelled, released);
  });

  query(
    `begin; ${source("supabase/migrations/20261020001500_workshop_installment_payment.sql")}; commit;`,
  );
  query(
    `begin; ${source("supabase/migrations/20261020161915_workshop_profile_payment_replay.sql")}; commit;`,
  );
  function profileInstallment(p, amount, ref = randomUUID(), method = "efectivo") {
    return `select public.admin_register_workshop_payment(${sqlString(studio)},${sqlString(p.purchase_id)},${amount},${sqlString(method)},${sqlString(ref)},'Synthetic profile payment')`;
  }
  await test("profile payments before the first date replay and settle through the existing ledger", () => {
    const w = offer({ deposit: true }),
      p = json(asRole("authenticated", admin, checkedSql(review(w, { amount: 30000 }), 1)));
    const due = query(
      `select balance_due_at from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
    );
    const ref = randomUUID(),
      sql = profileInstallment(p, 10000, ref);
    denied(asRole("authenticated", id(13), sql), "forbidden");
    assert.equal(json(asRole("authenticated", admin, sql)).balance_minor, 20000);
    assert.equal(json(asRole("authenticated", admin, sql)).replayed, true);
    denied(
      asRole("authenticated", admin, profileInstallment(p, 11000, ref)),
      "idempotency_conflict",
    );
    assert.equal(
      json(asRole("authenticated", admin, profileInstallment(p, 20000))).balance_minor,
      0,
    );
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(p.sale_id)}`),
      "3",
    );
    assert.equal(
      query(
        `select balance_due_at from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      due,
    );
    denied(
      asRole("authenticated", admin, profileInstallment(p, 10000, "")),
      "payment_reference_required",
    );
    denied(asRole("anon", null, sql), "permission denied");
  });
  await test("cash request identities replay purchases and allow equal distinct installments without duplicate payments", () => {
    const w = offer({ deposit: true });
    const r = review(w, { amount: 30000, method: "cash" });
    r.reference = `cash:${r.key}`;
    const purchaseSql = checkedSql(r, 1);
    const p = json(asRole("authenticated", admin, purchaseSql));
    assert.equal(json(asRole("authenticated", admin, purchaseSql)).replayed, true);
    const first = `cash:${randomUUID()}`;
    const second = `cash:${randomUUID()}`;
    const paymentSql = profileInstallment(p, 10000, first, "cash");
    assert.equal(json(asRole("authenticated", admin, paymentSql)).balance_minor, 20000);
    assert.equal(json(asRole("authenticated", admin, paymentSql)).replayed, true);
    denied(
      asRole("authenticated", admin, profileInstallment(p, 11000, first, "cash")),
      "idempotency_conflict",
    );
    assert.equal(
      json(asRole("authenticated", admin, profileInstallment(p, 10000, second, "cash")))
        .balance_minor,
      10000,
    );
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(p.sale_id)}`),
      "3",
    );
    assert.equal(
      query(`select sum(amount_minor) from public.payments where sale_id=${sqlString(p.sale_id)}`),
      "50000",
    );
    denied(
      asRole("authenticated", admin, profileInstallment(p, 10000, "", "bank_transfer")),
      "payment_reference_required",
    );
  });
  await test("simultaneous Hoy and profile payments use the same lock order and cannot overcollect", async () => {
    const w = offer({ deposit: true }),
      p = json(asRole("authenticated", admin, checkedSql(review(w, { amount: 30000 }), 1)));
    const results = await Promise.all([
      concurrent(asRole("authenticated", admin, profileInstallment(p, 20000))),
      concurrent(asRole("authenticated", admin, installment(p, w, 20000))),
    ]);
    assert.equal(results.filter((r) => r.status === 0).length, 1);
    assert.ok(results.find((r) => r.status !== 0).stderr.includes("payment_exceeds_balance"));
    assert.equal(
      query(
        `select paid_minor from public.workshop_purchases where id=${sqlString(p.purchase_id)}`,
      ),
      "50000",
    );
  });
  query(
    `begin; ${source("supabase/migrations/20261023134522_demi_workshop_conversation_context.sql")}; commit;`,
  );
  const workshopContextSql = (c, tenant = studio) =>
    `select public.service_demi_workshop_context(${sqlString(tenant)},${sqlString(c?.id)})`;
  await test("workshop information distinguishes disabled from empty and denies foreign or client recovery", () => {
    const c = conversation();
    for (const role of ["anon", "authenticated"])
      denied(asRole(role, admin, workshopContextSql(c)), "permission denied");
    denied(
      asRole("service_role", null, workshopContextSql(c, otherStudio)),
      "conversation_identity_mismatch",
    );
    denied(
      asRole("service_role", null, workshopContextSql({ id: randomUUID() })),
      "conversation_identity_mismatch",
    );
    query(
      `update public.workshop_studio_policies set demi_enabled=false where studio_id=${sqlString(studio)}`,
    );
    assert.deepEqual(service(workshopContextSql(c)), {
      ok: true,
      enabled: false,
      workshops: [],
      current_purchase: null,
    });
    query(
      `update public.workshop_studio_policies set demi_enabled=true where studio_id=${sqlString(studio)}`,
    );
    assert.equal(service(workshopContextSql(null)).enabled, true);
    assert.equal(service(workshopContextSql(null)).current_purchase, null);
  });
  await test("Demi recovers quote, receipt, provisional and verified purchase without premature income", () => {
    const w = offer({ deposit: true }),
      c = conversation();
    const intent = service(prepareSql(w, c));
    let status = service(workshopContextSql(c)).current_purchase;
    assert.equal(status.status, "quoted");
    assert.equal(status.title, "Local payment test");
    assert.equal(status.payment_verified, false);
    assert.equal(status.receipt_received, false);
    assert.equal(status.reservation_confirmed, false);
    service(accept(c).sql);
    assert.equal(service(workshopContextSql(c)).current_purchase.status, "receipt_required");
    const held = service(receipt(intent, c).sql);
    status = service(workshopContextSql(c)).current_purchase;
    assert.equal(status.status, "reserved_provisionally");
    assert.equal(status.receipt_received, true);
    assert.equal(status.capacity_held, true);
    assert.equal(status.payment_verified, false);
    assert.equal(status.paid_minor, 0);
    assert.equal(
      query(
        `select count(*) from public.workshop_purchases where idempotency_key=${sqlString(intent.intent_id)}`,
      ),
      "0",
    );
    const other = conversation();
    assert.equal(service(workshopContextSql(other)).current_purchase, null);
    const purchase = json(
      asRole(
        "authenticated",
        admin,
        `select public.admin_confirm_workshop_provisional_hold(${sqlString(studio)},${sqlString(held.hold_id)},true)`,
      ),
    );
    status = service(workshopContextSql(c)).current_purchase;
    assert.equal(status.status, "confirmed");
    assert.equal(status.payment_verified, true);
    assert.equal(status.reservation_confirmed, true);
    assert.equal(status.paid_minor, 30000);
    assert.equal(status.balance_minor, 30000);
    json(asRole("authenticated", admin, profileInstallment(purchase, 10000)));
    assert.equal(service(workshopContextSql(c)).current_purchase.balance_minor, 20000);
    json(
      asRole(
        "authenticated",
        admin,
        `select public.admin_record_workshop_continuation(${sqlString(studio)},${sqlString(purchase.purchase_id)},${sqlString(randomUUID())},'withdraw','Synthetic recovery withdrawal')`,
      ),
    );
    status = service(workshopContextSql(c)).current_purchase;
    assert.equal(status.status, "cancelled");
    assert.equal(status.reservation_confirmed, false);
    assert.equal(status.paid_minor, 40000);
    assert.equal(status.balance_minor, 20000);
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(purchase.sale_id)}`),
      "2",
    );
  });
  await test("expired workshop quote does not recover as a valid payment or confirmed reservation", () => {
    const w = offer({ deposit: true }),
      c = conversation();
    const intent = service(prepareSql(w, c));
    service(accept(c).sql);
    query(
      `update public.demi_workshop_purchase_intents set expires_at=now()-interval '1 second' where id=${sqlString(intent.intent_id)}`,
    );
    const status = service(workshopContextSql(c)).current_purchase;
    assert.equal(status.status, "expired");
    assert.equal(status.payment_verified, false);
    assert.equal(status.capacity_held, false);
    assert.equal(status.reservation_confirmed, false);
  });
  // Exercise the exact release worker; pg_cron registration requires the hosted extension.
  query(
    source("supabase/migrations/20261023191123_workshop_provisional_expiry_scheduler.sql").split(
      "select cron.schedule(",
    )[0],
  );
  await test("expiry worker denies client roles and invalid batch sizes", () => {
    for (const role of ["anon", "authenticated", "service_role"])
      denied(
        asRole(role, admin, "select private.workshop_expire_due_holds_cron(100)"),
        "permission denied",
      );
    for (const limit of ["null", "0", "201"])
      denied(`select private.workshop_expire_due_holds_cron(${limit})`, "invalid_batch_limit");
  });
  await test("rejected or expired receipt cannot recover as confirmed and context reads change no financial records", () => {
    for (const decision of ["reject", "expire"]) {
      const w = offer({ deposit: true }),
        c = conversation();
      const intent = service(prepareSql(w, c));
      service(accept(c).sql);
      const held = service(receipt(intent, c).sql);
      if (decision === "reject")
        json(
          asRole(
            "authenticated",
            admin,
            `select public.admin_reject_workshop_provisional_hold(${sqlString(studio)},${sqlString(held.hold_id)},'Synthetic rejected receipt')`,
          ),
        );
      else
        query(
          `update public.workshop_provisional_holds set expires_at=now()-interval '1 second' where id=${sqlString(held.hold_id)}`,
        );
      const before = query(
        "select jsonb_build_object('payments',(select count(*) from public.payments),'purchases',(select count(*) from public.workshop_purchases),'reservations',(select count(*) from public.reservations))",
      );
      if (decision === "expire") {
        assert.ok(Number(query("select private.workshop_expire_due_holds_cron(100)")) >= 1);
        assert.equal(
          query(
            `select state from public.workshop_provisional_holds where id=${sqlString(held.hold_id)}`,
          ),
          "expired",
        );
        assert.equal(query("select private.workshop_expire_due_holds_cron(100)"), "0");
      }
      for (let i = 0; i < 2; i++) {
        const status = service(workshopContextSql(c)).current_purchase;
        assert.equal(status.status, decision === "reject" ? "rejected" : "expired");
        assert.equal(status.receipt_received, true);
        assert.equal(status.payment_verified, false);
        assert.equal(status.capacity_held, false);
        assert.equal(status.reservation_confirmed, false);
      }
      assert.equal(
        query(
          "select jsonb_build_object('payments',(select count(*) from public.payments),'purchases',(select count(*) from public.workshop_purchases),'reservations',(select count(*) from public.reservations))",
        ),
        before,
      );
    }
  });
  // Reduced CRM/profile host contracts; the workshop registration and existing
  // ensure-trial bridge below are the real SQL implementations, not doubles.
  query(`alter table public.students alter column id set default gen_random_uuid(),
    add column phone text,add column email text,add column student_type text default 'regular',
    add column trial_status text,add column profile_status text default 'incomplete',
    add column acquisition_source text,add column created_at timestamptz default now(),add column updated_at timestamptz;
    alter table public.persons add column updated_at timestamptz;
    alter table public.crm_contacts add primary key(id),add column converted_student_id uuid,
      add column lifecycle_status text default 'prospect',add column source text,add column updated_at timestamptz;
    alter table public.assistant_conversations add column external_thread_ref text,add column crm_conversation_id uuid,add column updated_at timestamptz;
    create table public.person_contacts(id uuid primary key default gen_random_uuid(),studio_id uuid,person_id uuid,kind text,value text,is_primary boolean,created_at timestamptz default now());
    create table public.crm_conversations(id uuid primary key,studio_id uuid,crm_contact_id uuid,student_id uuid);
    create table public.assistant_channel_identities(id uuid primary key,studio_id uuid,provider text,provider_account_id text,provider_contact_id text,person_id uuid,crm_contact_id uuid,student_id uuid,metadata jsonb default '{}',updated_at timestamptz);
    create function private.student_profile_status(uuid) returns text language sql as $$select 'incomplete'::text$$;`);
  const trialBridge = source(
    "supabase/migrations/20261003170400_demi_native_trial_booking_bridge.sql",
  );
  query(
    trialBridge.slice(
      trialBridge.indexOf("create or replace function public.assistant_ensure_trial_student("),
      trialBridge.indexOf("create or replace function public.assistant_book_payment_pending("),
    ),
  );
  query(
    `begin; ${source("supabase/migrations/20261023140144_demi_workshop_guest_registration.sql")}; commit;`,
  );
  function guestFixture() {
    const w = offer({ deposit: true }),
      c = conversation(null),
      person = randomUUID(),
      contact = randomUUID(),
      crm = randomUUID();
    const phone = `+5299${String(BigInt(`0x${person.replaceAll("-", "").slice(0, 10)}`) % 100000000n).padStart(8, "0")}`;
    const name = "UAT Nueva Participante",
      turn = accept(c, `Me llamo ${name}`).turn;
    query(`update public.workshop_offers set requires_enrollment=false where id=${sqlString(w.offerId)};
      insert into public.persons(id,studio_id,first_name,last_name) values(${sqlString(person)},${sqlString(studio)},'UAT','Contacto');
      insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(${sqlString(studio)},${sqlString(person)},'phone',${sqlString(phone)},true);
      insert into public.crm_contacts(id,studio_id,person_id) values(${sqlString(contact)},${sqlString(studio)},${sqlString(person)});
      insert into public.crm_conversations values(${sqlString(crm)},${sqlString(studio)},${sqlString(contact)},null);
      update public.assistant_conversations set crm_conversation_id=${sqlString(crm)},external_thread_ref=${sqlString(phone.slice(1))},
        context=jsonb_build_object('crm_contact_id',${sqlString(contact)},'contact_phone',${sqlString(phone)},'provider','meta_whatsapp') where id=${sqlString(c.id)}`);
    return { w, c, person, contact, phone, turn, name };
  }
  const registerGuestSql = (g) =>
    `select public.service_register_demi_workshop_participant(${sqlString(studio)},${sqlString(g.c.id)},${sqlString(g.w.offerId)},${sqlString(g.turn)},${sqlString(g.name)})`;
  await test("new workshop participant has no enrollment, package, trial credit, Auth, payment or reservation until checkout", () => {
    const g = guestFixture(),
      registered = service(registerGuestSql(g));
    assert.equal(registered.profile_registered, true);
    assert.equal(registered.reservation_confirmed, false);
    assert.equal(registered.payment_verified, false);
    const sid = registered.student_id;
    assert.deepEqual(
      json(
        `select jsonb_build_object('type',student_type,'trial_status',trial_status,'source',acquisition_source,'user_id',user_id) from public.students where id=${sqlString(sid)}`,
      ),
      { type: "trial", trial_status: null, source: "demi_workshop_guest", user_id: null },
    );
    for (const table of ["student_enrollments", "product_acquisitions", "reservations", "sales"])
      assert.equal(
        query(`select count(*) from public.${table} where student_id=${sqlString(sid)}`),
        "0",
      );
    assert.equal(service(registerGuestSql(g)).student_id, sid);
    const intent = service(prepareSql(g.w, g.c));
    service(accept(g.c).sql);
    const held = service(receipt(intent, g.c).sql);
    const bought = json(
      asRole(
        "authenticated",
        admin,
        `select public.admin_confirm_workshop_provisional_hold(${sqlString(studio)},${sqlString(held.hold_id)},true)`,
      ),
    );
    assert.equal(
      query(
        `select student_id from public.workshop_purchases where id=${sqlString(bought.purchase_id)}`,
      ),
      sid,
    );
    assert.equal(
      query(`select count(*) from public.payments where sale_id=${sqlString(bought.sale_id)}`),
      "1",
    );
  });
  await test("concurrent participant registration creates exactly one profile and one audit record", async () => {
    const g = guestFixture(),
      sql = asRole("service_role", null, registerGuestSql(g));
    const results = await Promise.all([concurrent(sql), concurrent(sql)]);
    assert.ok(
      results.every((r) => r.status === 0),
      JSON.stringify(results),
    );
    const sid = service(registerGuestSql(g)).student_id;
    assert.equal(
      query(`select count(*) from public.students where person_id=${sqlString(g.person)}`),
      "1",
    );
    assert.equal(
      query(
        `select count(*) from private.demi_workshop_participant_registrations where student_id=${sqlString(sid)}`,
      ),
      "1",
    );
    denied(
      asRole("service_role", null, registerGuestSql({ ...g, name: "Otro Nombre" })),
      "idempotency_conflict",
    );
  });
  await test("participant registration rejects client authority, invented names, foreign turns and required enrollment", () => {
    const g = guestFixture();
    for (const role of ["anon", "authenticated"])
      denied(asRole(role, admin, registerGuestSql(g)), "permission denied");
    denied(
      asRole("service_role", null, registerGuestSql({ ...g, name: "Nombre Inventado" })),
      "full_name_required",
    );
    denied(
      asRole("service_role", null, registerGuestSql({ ...g, turn: randomUUID() })),
      "full_name_required",
    );
    query(
      `update public.workshop_offers set requires_enrollment=true where id=${sqlString(g.w.offerId)}`,
    );
    denied(asRole("service_role", null, registerGuestSql(g)), "guest_offer_unavailable");
    assert.equal(
      query(`select count(*) from public.students where person_id=${sqlString(g.person)}`),
      "0",
    );
  });
  await test("a phone belonging to another person cannot create or claim a workshop participant", () => {
    const g = guestFixture(),
      otherPerson = randomUUID();
    query(`insert into public.persons(id,studio_id,first_name) values(${sqlString(otherPerson)},${sqlString(studio)},'Other');
      insert into public.person_contacts(studio_id,person_id,kind,value,is_primary) values(${sqlString(studio)},${sqlString(otherPerson)},'phone',${sqlString(g.phone)},true)`);
    denied(asRole("service_role", null, registerGuestSql(g)), "identity_verification_required");
    assert.equal(
      query(`select count(*) from public.students where person_id=${sqlString(g.person)}`),
      "0",
    );
  });
  await test("Meta guest uses only its bound channel identity and does not authenticate a claimed phone", () => {
    const g = guestFixture(),
      identity = randomUUID();
    query(`delete from public.person_contacts where person_id=${sqlString(g.person)};
      insert into public.assistant_channel_identities(id,studio_id,provider,provider_account_id,provider_contact_id,person_id,crm_contact_id,metadata)
        values(${sqlString(identity)},${sqlString(studio)},'facebook_messenger','page','sender',${sqlString(g.person)},${sqlString(g.contact)},
          jsonb_build_object('claimed_phone',${sqlString(g.phone)},'minimal_identification_completed',true,'phone_authentication_verified',false));
      update public.assistant_conversations set channel='facebook_messenger',external_thread_ref='page:sender',context=context||
        jsonb_build_object('identity_id',${sqlString(identity)},'provider_account_id','page','provider_contact_id','wrong') where id=${sqlString(g.c.id)}`);
    denied(
      asRole("service_role", null, registerGuestSql(g)),
      "minimal_phone_identification_required",
    );
    query(
      `update public.assistant_conversations set context=context||'{"provider_contact_id":"sender"}'::jsonb where id=${sqlString(g.c.id)}`,
    );
    const registered = service(registerGuestSql(g));
    assert.equal(
      query(
        `select student_id from public.assistant_channel_identities where id=${sqlString(identity)}`,
      ),
      registered.student_id,
    );
    assert.equal(
      query(
        `select metadata->>'phone_authentication_verified' from public.assistant_channel_identities where id=${sqlString(identity)}`,
      ),
      "false",
    );
  });
  console.log(
    `${passed}/${passed} local PostgreSQL integration scenarios passed. No remote database used.`,
  );
} finally {
  if (started) {
    const cleanup = docker(["rm", "-f", container]);
    assert.equal(cleanup.status, 0, cleanup.stderr);
  }
}
