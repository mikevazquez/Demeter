import { notFound } from "next/navigation";

// Preview-only harness: the iframe gives the real protected app a CSS viewport,
// without bypassing authentication or exposing test controls in production.
export default function CrmMobileUat() {
  if (process.env.VERCEL_ENV !== "preview") notFound();
  return (
    <section>
      <h1>CRM · revisión móvil</h1>
      <p>Vista del CRM a 440 × 956 px CSS.</p>
      <iframe
        title="CRM móvil a 440 × 956"
        src="/admin/crm"
        width={440}
        height={956}
        style={{
          width: 440,
          maxWidth: "100%",
          height: 956,
          border: "1px solid #e7eaf2",
          borderRadius: 16,
          background: "white",
        }}
      />
    </section>
  );
}
