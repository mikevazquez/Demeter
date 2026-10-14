#!/usr/bin/env node
/**
 * Sandbox-only concurrency test. Requires a dedicated EMPTY synthetic session
 * belonging to the offer, capacity 1, two synthetic students and two unique
 * idempotency keys. Never point this script at production.
 *
 * Required env:
 *   WORKSHOP_UAT_SUPABASE_URL
 *   WORKSHOP_UAT_SERVICE_ROLE_KEY
 *   WORKSHOP_UAT_STUDIO_ID
 *   WORKSHOP_UAT_OFFER_ID
 *   WORKSHOP_UAT_SESSION_ID
 *   WORKSHOP_UAT_STUDENT_A_ID
 *   WORKSHOP_UAT_STUDENT_B_ID
 *   WORKSHOP_UAT_IDEMPOTENCY_A
 *   WORKSHOP_UAT_IDEMPOTENCY_B
 *   WORKSHOP_UAT_ACK_SYNTHETIC_PAYMENTS=I_ACKNOWLEDGE_SANDBOX_ONLY
 *
 * This creates SYNTHETIC payment, sale and reservation rows in Sandbox.
 * It does NOT verify actual funds. It must not be wired into CI by default.
 */
import { createClient } from '@supabase/supabase-js';

const required = [
  'WORKSHOP_UAT_SUPABASE_URL',
  'WORKSHOP_UAT_SERVICE_ROLE_KEY',
  'WORKSHOP_UAT_STUDIO_ID',
  'WORKSHOP_UAT_OFFER_ID',
  'WORKSHOP_UAT_SESSION_ID',
  'WORKSHOP_UAT_STUDENT_A_ID',
  'WORKSHOP_UAT_STUDENT_B_ID',
  'WORKSHOP_UAT_IDEMPOTENCY_A',
  'WORKSHOP_UAT_IDEMPOTENCY_B',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const env = process.env;
if (env.WORKSHOP_UAT_ACK_SYNTHETIC_PAYMENTS !== 'I_ACKNOWLEDGE_SANDBOX_ONLY') {
  throw new Error('Explicit acknowledgement required: this test writes synthetic payment records');
}
const url = new URL(env.WORKSHOP_UAT_SUPABASE_URL);
if (!url.hostname.endsWith('.supabase.co') || url.hostname.split('.')[0] !== 'hedouonyhynuvwbckdlg') {
  throw new Error('Refusing to run outside the approved Sandbox project');
}
if (env.WORKSHOP_UAT_IDEMPOTENCY_A === '11111111-2222-4333-8444-555555555555' ||
    env.WORKSHOP_UAT_IDEMPOTENCY_B === '11111111-2222-4333-8444-555555555555') {
  throw new Error('Do not reuse the original deposit checkout key');
}
if (env.WORKSHOP_UAT_STUDENT_A_ID === env.WORKSHOP_UAT_STUDENT_B_ID ||
    env.WORKSHOP_UAT_IDEMPOTENCY_A === env.WORKSHOP_UAT_IDEMPOTENCY_B) {
  throw new Error('Students and idempotency keys must be distinct');
}
const client = () => createClient(url.toString(), env.WORKSHOP_UAT_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = client();
const sessionId = env.WORKSHOP_UAT_SESSION_ID;
const { data: session, error: sessionError } = await admin
  .from('class_sessions').select('id,studio_id,capacity,status')
  .eq('id', sessionId).single();
if (sessionError || !session || session.studio_id !== env.WORKSHOP_UAT_STUDIO_ID ||
    session.capacity !== 1 || session.status !== 'scheduled') {
  throw new Error('Session must be a scheduled Sandbox fixture with capacity exactly 1');
}
const { count: beforeCount, error: beforeError } = await admin
  .from('reservations').select('id', { count: 'exact', head: true })
  .eq('session_id', sessionId).in('status', ['reserved', 'attended']);
if (beforeError || beforeCount !== 0) throw new Error('Fixture session must have zero active reservations');
const { data: membership, error: membershipError } = await admin
  .from('workshop_offer_sessions').select('session_id')
  .eq('offer_id', env.WORKSHOP_UAT_OFFER_ID).eq('session_id', sessionId);
if (membershipError || membership?.length !== 1) throw new Error('Fixture session must belong to the offer');
const { data: offer, error: offerError } = await admin.from('workshop_offers')
  .select('studio_id,full_price_minor,deposit_mode,deposit_value,allow_individual_sessions')
  .eq('id', env.WORKSHOP_UAT_OFFER_ID).single();
if (offerError || !offer || offer.studio_id !== env.WORKSHOP_UAT_STUDIO_ID) {
  throw new Error('Offer/studio mismatch');
}
// The fixture offer must contain exactly one session, otherwise full-purchase
// checkout may attempt to reserve sessions outside this test.
const { count: offerSessionCount, error: offerSessionsError } = await admin
  .from('workshop_offer_sessions').select('session_id', { count: 'exact', head: true })
  .eq('offer_id', env.WORKSHOP_UAT_OFFER_ID);
if (offerSessionsError || offerSessionCount !== 1) {
  throw new Error('Dedicated concurrency offer must have exactly one session');
}
if (offer.deposit_mode !== 'full') {
  throw new Error('Use a dedicated full-payment synthetic offer for this concurrency test');
}
const studentIds = [env.WORKSHOP_UAT_STUDENT_A_ID, env.WORKSHOP_UAT_STUDENT_B_ID];
const keys = [env.WORKSHOP_UAT_IDEMPOTENCY_A, env.WORKSHOP_UAT_IDEMPOTENCY_B];
const { data: students, error: studentsError } = await admin
  .from('students').select('id,studio_id').in('id', studentIds);
if (studentsError || students?.length !== 2 ||
    students.some((student) => student.studio_id !== env.WORKSHOP_UAT_STUDIO_ID)) {
  throw new Error('Both synthetic students must belong to the approved Sandbox studio');
}
const { count: existingKeys, error: existingKeysError } = await admin
  .from('workshop_purchases').select('id', { count: 'exact', head: true })
  .eq('studio_id', env.WORKSHOP_UAT_STUDIO_ID).in('idempotency_key', keys);
if (existingKeysError || existingKeys !== 0) {
  throw new Error('Both idempotency keys must be unused before the race');
}
const attempt = (studentId, key) => client().rpc('workshop_checkout_confirm', {
  p_studio_id: env.WORKSHOP_UAT_STUDIO_ID,
  p_offer_id: env.WORKSHOP_UAT_OFFER_ID,
  p_student_id: studentId,
  p_session_ids: [sessionId],
  p_idempotency_key: key,
  p_confirmed_amount_minor: offer.full_price_minor,
  p_payment_method: 'cash',
  p_payment_reference: 'UAT-SYNTHETIC-NO-REAL-PAYMENT',
});
const results = await Promise.all([
  attempt(env.WORKSHOP_UAT_STUDENT_A_ID, env.WORKSHOP_UAT_IDEMPOTENCY_A),
  attempt(env.WORKSHOP_UAT_STUDENT_B_ID, env.WORKSHOP_UAT_IDEMPOTENCY_B),
]);
const winners = results.filter((r) => !r.error && r.data?.status === 'reserved' && !r.data?.replayed);
const losers = results.filter((r) => r.error?.message?.includes('session_full'));
const { count: afterCount, error: afterError } = await admin
  .from('reservations').select('id', { count: 'exact', head: true })
  .eq('session_id', sessionId).in('status', ['reserved', 'attended']);
const { data: purchases, error: purchasesError } = await admin
  .from('workshop_purchases')
  .select('id,sale_id,student_id,idempotency_key,status')
  .eq('studio_id', env.WORKSHOP_UAT_STUDIO_ID)
  .in('idempotency_key', keys);
const { data: linkedSessions, error: linksError } = await admin
  .from('workshop_purchase_sessions')
  .select('purchase_id,session_id,reservation_id')
  .in('purchase_id', (purchases ?? []).map((p) => p.id));
const { data: payments, error: paymentsError } = await admin
  .from('payments')
  .select('id,sale_id,amount_minor,kind')
  .in('sale_id', (purchases ?? []).map((p) => p.sale_id).filter(Boolean));
const winnerPurchase = purchases?.[0];
const persistedCorrectly = !purchasesError && !linksError && !paymentsError &&
  purchases?.length === 1 &&
  winnerPurchase?.status === 'reserved' &&
  linkedSessions?.length === 1 &&
  linkedSessions[0].purchase_id === winnerPurchase.id &&
  linkedSessions[0].session_id === sessionId &&
  Boolean(linkedSessions[0].reservation_id) &&
  payments?.length === 1 &&
  payments[0].sale_id === winnerPurchase.sale_id &&
  payments[0].amount_minor === offer.full_price_minor &&
  payments[0].kind === 'payment';
const passed = winners.length === 1 && losers.length === 1 &&
  !afterError && afterCount === 1 && persistedCorrectly;
console.log(JSON.stringify({
  passed,
  winnerCount: winners.length,
  soldOutRejections: losers.length,
  activeReservations: afterCount,
  persistedPurchaseCount: purchases?.length ?? null,
  persistedPaymentCount: payments?.length ?? null,
  purchaseIntegrityPassed: persistedCorrectly,
  errors: results.map((r) => r.error?.message ?? null),
}, null, 2));
if (!passed) process.exitCode = 1;
