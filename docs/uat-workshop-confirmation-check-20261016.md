# Sandbox confirmation verification

Integration checked with a simulated staff JWT context in a reversible SQL subtransaction. Approval returned confirmed; a second request returned replayed=true; one sale, payment, and reservation were created inside the test transaction. All test writes were rolled back. Post-test counts: 0 holds, 6 workshop purchases, 83 payments, 326 reservations.

Pending: actual signed-in staff session, real parallel clients, negative payment flag test, browser UAT, and normal reservation route checks. No production changes.
