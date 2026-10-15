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
    if (docker(["exec", container, "pg_isready", "-U", "postgres"]).status === 0) break;
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
    "supabase/migrations/20261015120000_workshop_verified_manual_payment.sql",
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
  console.log(
    `${passed}/${passed} local PostgreSQL integration scenarios passed. No remote database used.`,
  );
} finally {
  if (started) {
    const cleanup = docker(["rm", "-f", container]);
    assert.equal(cleanup.status, 0, cleanup.stderr);
  }
}
