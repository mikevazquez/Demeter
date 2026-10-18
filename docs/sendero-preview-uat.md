# Sendero home preview: class states

Scope: administration home on `preview/sendero-inicio`.

The expanded roster uses a light lavender surface, including student cards, empty states, and add-student inputs. Full classes have a separate capacity badge. Active waitlist counts and names are read from `class_waitlist_entries`, scoped to the current studio and selected sessions, only with `schedule.write`. The expanded waitlist lists names without asserting promotion order. A query error produces a visible warning rather than a fabricated empty state.

Sandbox fixtures were inserted only in Supabase **Studio Flow Sandbox** (`hedouonyhynuvwbckdlg`), studio `9fe23cfa-fb47-4670-afeb-ed4a56433772`. No production database or schema changes were made.

Fixture marker: `sendero-visual-preview-20261018` in session notes, template description, and student acquisition source. IDs are deterministic; inserts are idempotent. New demo students have no telephone, email, or login, and demo sessions are hidden from the assistant (`assistant_visible = false`). These are visual UAT fixtures, not commercial-payment test evidence.

The following examples exist on both **18 and 19 October 2026**, America/Mexico_City:

| Time  | Class                              | Reservations | Waitlist | Status    |
| ----- | ---------------------------------- | ------------ | -------- | --------- |
| 18:00 | Pole Fitness · Demo llena y espera | 8/8          | 2        | Scheduled |
| 19:00 | Flexibilidad · Demo con reservas   | 5/8          | 0        | Scheduled |
| 20:00 | Danza Aérea · Demo cancelada       | 0/6          | 0        | Cancelled |
| 21:00 | Heels · Demo llena                 | 6/6          | 0        | Scheduled |

Verification: persisted counts were queried after insertion; 21 focused tests passed (including full/cancelled/partial/waitlist presentation); browser checks use the real home components with isolated data fixtures to verify expansion, light roster styling, active waitlist names, and responsive behavior. Authenticated staging review remains available through the Vercel preview with a sandbox account.

## Commercial review cases

Additional marker: `sendero-commercial-preview-20261018`.

- **Demo · Irene Transferencia**: a $1,200 MXN package purchase with a linked sale, provisional active acquisition, and Demi transfer intent in `provisional_active`. It appears in today's pending-payment review. The conversation uses `internal_demo`. Its note explicitly identifies a simulated receipt; no real bank receipt is attached. The actual approve and reject RPC paths were verified inside transactions and rolled back, preserving the pending case for user review.
- **Demo · Natalia Paquete**: a paid, active eight-class package valid 18 October–16 November 2026; one reservation in the 19:00 Flexibilidad demo on each of 18 and 19 October. The ledger grants eight credits and holds two, leaving six. Balance was verified under the sandbox owner's authorization context.
- **Demo · Gabriela Clase150**: one normal individual-class reservation in the same 19:00 demo on each date, each linked to a $150 MXN sale and payment, with commercial status `paid`. The roster displays the saved amount as paid rather than using the current class price or treating a pending payment as settled.

The class now has 7/8 reserved places on each date. New demo profiles have no telephone, email, or login. Verification includes five payment-summary tests, 24 total focused tests, TypeScript, browser checks of the paid-class label and package credit balance, and persisted payment/linkage queries. There are no production changes.
