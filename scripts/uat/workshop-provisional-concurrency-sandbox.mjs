#!/usr/bin/env node
/**
 * Live two-client provisional-seat race on the approved Sandbox only.
 * Does NOT post sale or payment. Leaves rejected synthetic audit holds.
 * Requires an actual authenticated staff access token and service key.
 * Never run on production. This intentionally does not use revoked checkout RPCs.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const names = [
  "WORKSHOP_UAT_SUPABASE_URL",
  "WORKSHOP_UAT_SERVICE_ROLE_KEY",
  "WORKSHOP_UAT_STAFF_ACCESS_TOKEN",
  "WORKSHOP_UAT_STUDIO_ID",
  "WORKSHOP_UAT_OFFER_ID",
  "WORKSHOP_UAT_SESSION_ID",
  "WORKSHOP_UAT_STUDENT_A_ID",
  "WORKSHOP_UAT_STUDENT_B_ID",
];
for (const name of names) if (!process.env[name]) throw new Error(`Missing ${name}`);
if (process.env.WORKSHOP_UAT_ACK_SYNTHETIC_HOLDS !== "I_ACKNOWLEDGE_SANDBOX_ONLY")
  throw new Error("Explicit synthetic-hold acknowledgement required");
const e = process.env;
const url = new URL(e.WORKSHOP_UAT_SUPABASE_URL);
if (url.protocol !== "https:" || url.hostname !== "hedouonyhynuvwbckdlg.supabase.co")
  throw new Error("Refusing non-Sandbox project");
if (e.WORKSHOP_UAT_STUDENT_A_ID === e.WORKSHOP_UAT_STUDENT_B_ID)
  throw new Error("Two distinct fixture students required");

const admin = createClient(url.toString(), e.WORKSHOP_UAT_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const staffClient = () =>
  createClient(url.toString(), e.WORKSHOP_UAT_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${e.WORKSHOP_UAT_STAFF_ACCESS_TOKEN}` } },
  });
const [{ data: session, error: se }, { data: offer, error: oe }, { data: members, error: me }] =
  await Promise.all([
    admin
      .from("class_sessions")
      .select("id,studio_id,capacity,status,starts_at")
      .eq("id", e.WORKSHOP_UAT_SESSION_ID)
      .single(),
    admin
      .from("workshop_offers")
      .select("id,studio_id,full_price_minor,deposit_mode")
      .eq("id", e.WORKSHOP_UAT_OFFER_ID)
      .single(),
    admin
      .from("workshop_offer_sessions")
      .select("session_id")
      .eq("offer_id", e.WORKSHOP_UAT_OFFER_ID),
  ]);
if (
  se ||
  oe ||
  me ||
  !session ||
  !offer ||
  session.studio_id !== e.WORKSHOP_UAT_STUDIO_ID ||
  offer.studio_id !== e.WORKSHOP_UAT_STUDIO_ID ||
  session.capacity !== 1 ||
  session.status !== "scheduled" ||
  Date.parse(session.starts_at) <= Date.now() ||
  offer.deposit_mode !== "full" ||
  offer.full_price_minor <= 0 ||
  members?.length !== 1 ||
  members[0].session_id !== session.id
)
  throw new Error(
    "Fixture must be a future single-session full-price workshop with exactly one seat",
  );
const { data: students, error: studentsError } = await admin
  .from("students")
  .select("id,studio_id")
  .in("id", [e.WORKSHOP_UAT_STUDENT_A_ID, e.WORKSHOP_UAT_STUDENT_B_ID]);
if (
  studentsError ||
  students?.length !== 2 ||
  students.some((s) => s.studio_id !== e.WORKSHOP_UAT_STUDIO_ID)
)
  throw new Error("Invalid fixture students");
const [{ count: reserved, error: re }, { count: holds, error: he }] = await Promise.all([
  admin
    .from("reservations")
    .select("id", { head: true, count: "exact" })
    .eq("studio_id", e.WORKSHOP_UAT_STUDIO_ID)
    .eq("session_id", session.id)
    .in("status", ["reserved", "attended"]),
  admin
    .from("workshop_provisional_hold_sessions")
    .select("hold_id,workshop_provisional_holds!inner(id)", { head: true, count: "exact" })
    .eq("session_id", session.id)
    .eq("workshop_provisional_holds.state", "reserved_provisionally")
    .gt("workshop_provisional_holds.expires_at", new Date().toISOString()),
]);
if (re || he || reserved !== 0 || holds !== 0)
  throw new Error("Fixture must have no active reservations or provisional holds");
const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
const attempt = async (studentId) => {
  const requestId = randomUUID();
  return staffClient().rpc("admin_create_workshop_provisional_hold", {
    p_studio_id: e.WORKSHOP_UAT_STUDIO_ID,
    p_offer_id: offer.id,
    p_student_id: studentId,
    p_session_ids: [session.id],
    p_selection_mode: "full",
    p_request_id: requestId,
    p_transfer_reference: `UAT-HOLD-${requestId}`,
    p_amount_minor: offer.full_price_minor,
    p_expires_at: expiresAt,
  });
};
const outcomes = await Promise.all([
  attempt(e.WORKSHOP_UAT_STUDENT_A_ID),
  attempt(e.WORKSHOP_UAT_STUDENT_B_ID),
]);
const winners = outcomes.filter((x) => !x.error && x.data?.state === "reserved_provisionally");
const losers = outcomes.filter(
  (x) =>
    x.error?.message?.includes("session_full") || x.error?.message?.includes("session_unavailable"),
);
// Always attempt cleanup, including an unexpected double-winner result.
const cleanupResults = await Promise.all(
  winners.map((winner) =>
    staffClient().rpc("admin_reject_workshop_provisional_hold", {
      p_studio_id: e.WORKSHOP_UAT_STUDIO_ID,
      p_hold_id: winner.data.hold_id,
      p_reason: "Synthetic Sandbox concurrency UAT cleanup",
    }),
  ),
);
const cleanupPassed =
  cleanupResults.length === winners.length &&
  cleanupResults.every((x) => !x.error && x.data?.state === "rejected");
const { count: finalActive, error: finalError } = await admin
  .from("workshop_provisional_hold_sessions")
  .select("hold_id,workshop_provisional_holds!inner(id)", { head: true, count: "exact" })
  .eq("session_id", session.id)
  .eq("workshop_provisional_holds.state", "reserved_provisionally")
  .gt("workshop_provisional_holds.expires_at", new Date().toISOString());
const passed =
  winners.length === 1 && losers.length === 1 && cleanupPassed && !finalError && finalActive === 0;
console.log(
  JSON.stringify(
    {
      passed,
      winners: winners.length,
      capacityRejections: losers.length,
      cleanupPassed,
      finalActiveProvisionalHolds: finalActive,
      errors: outcomes.map((x) => x.error?.message ?? null),
      cleanupErrors: cleanupResults.map((x) => x.error?.message ?? null),
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
