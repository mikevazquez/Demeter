# Alumnas CRM: approved HTML template

The contact directory and student profile adopt the user-approved light CRM template: purple accents, four summary cards, stage filters, conversation context, and Resumen / Conversación / Operación / Historial navigation. The shared Studio Flow navigation remains in place.

All names, counts, package balances, expiry dates and conversation content come from the current studio. Existing creation, duplicate handling, sales, enrollment, documents, evaluations, rewards, lifecycle and access flows remain available. Unconverted prospects have a scoped contact page; converted contacts redirect to their student profile.

Renewal recommendations cover active students whose current package expires within seven calendar days in the studio timezone. They lead to the existing sale flow. The suggested message is an editable, copyable draft; it is never sent automatically or recorded as a sent message. There is no fabricated checkout URL. Internal notes display the existing notes profile field when configured and link to profile fields for editing.

CRM channel metadata uses the existing students.read policy. Message content retains the existing assistant-table settings.write permission and RLS. Only real WhatsApp user/assistant inbound/outbound messages are included; tool/system messages and internal demos are excluded. Missing data, insufficient permissions and loading failures have explicit states. This change adds no database migrations, new messaging channels or payment processing.

Validation uses unit tests, a production build and local browser checks against Studio Flow Sandbox. Synthetic sales/payments are reversed and fixtures deactivated after the check. Production is not modified by this branch.
