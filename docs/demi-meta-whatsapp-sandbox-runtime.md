# Demi · Meta WhatsApp Sandbox runtime

This note documents the server-side requirements for the Sandbox-only Meta WhatsApp inbound pilot.

- Vercel Preview must point to the Studio Flow Sandbox Supabase project.
- The server runtime requires `SUPABASE_SERVICE_ROLE_KEY` in Preview only.
- The value may use Supabase's current server-side secret key format (`sb_secret_...`) or the legacy service-role key while compatibility remains available.
- Never expose the server secret through a `NEXT_PUBLIC_` variable.
- Meta App Secret and Verify Token are stored through the Studio Flow integration UI / Supabase Vault.
- Asistian remains enabled in parallel.
- Demi must stay out of Production until explicitly authorized.

This file intentionally contains no credentials.
