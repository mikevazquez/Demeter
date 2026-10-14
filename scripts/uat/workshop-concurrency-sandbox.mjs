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
const url = new URL(env.WORKSHOP_UAT_SUPABASE_URL);
if (!url.hostname.endsWith('.supabase.co') || url.hostname.split('.')[0] !== 'hedouonyhynuvwbckdlg') {
  throw new Error('Refusing to run outside the approved Sandbox project');
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
const passed = winners.length === 1 && losers.length === 1 && !afterError && afterCount === 1;
console.log(JSON.stringify({
  passed,
  winnerCount: winners.length,
  soldOutRejections: losers.length,
  activeReservations: afterCount,
  errors: results.map((r) => r.error?.message ?? null),
}, null, 2));
if (!passed) process.exitCode = 1;
