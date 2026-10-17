import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { workshopUuid, type WorkshopAdminContext } from "@/src/lib/workshops/admin";
import { WorkshopPurchaseForm } from "./WorkshopPurchaseForm";
import { WorkshopTransferReview, type ProvisionalReviewItem } from "./WorkshopTransferReview";

export default async function WorkshopPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  if (!workshopUuid.test(offerId)) notFound();
  const ctx = await getAdminContext("schedule.read");
  const { data, error } = ctx.can("sales.read")
    ? await ctx.supabase.rpc("admin_workshop_context", {
        p_studio_id: ctx.studio.id,
        p_offer_id: offerId,
      })
    : { data: null, error: { message: "forbidden" } };
  if (error?.message.includes("offer_not_found")) notFound();
  const context = data as WorkshopAdminContext | null;
  const review = context && ctx.can("sales.read")
    ? await ctx.supabase.rpc("admin_workshop_provisional_review_queue", {
        p_studio_id: ctx.studio.id,
        p_offer_id: offerId,
      })
    : null;
  const reviewItems = !review?.error && Array.isArray(review?.data)
    ? (review.data as ProvisionalReviewItem[])
    : null;
  return (
    <main className="activities-v2 activities-editor-page program-detail-page">
      <Link className="activities-v2-back" href="/admin/actividades/talleres">
        ← Talleres configurables
      </Link>
      {error || !context ? (
        <p role="alert">No pudimos cargar este taller. Revisa tu acceso e intenta nuevamente.</p>
      ) : (
        <>
          <header className="program-detail-summary">
            <div className="program-detail-heading">
              <h1>{context.offer.title}</h1>
              {ctx.can("products.write") && ctx.can("schedule.write") ? (
                <Link href={`/admin/actividades/talleres/${offerId}/editar`}>Editar taller</Link>
              ) : null}
              <p>{context.sessions.length} fechas</p>
            </div>
          </header>
          {review?.error && ctx.can("sales.write") && ctx.can("schedule.write") ? (
            <p role="alert">No fue posible cargar los comprobantes pendientes. No apruebes pagos sin revisar el registro.</p>
          ) : null}
          {reviewItems && ctx.can("sales.write") && ctx.can("schedule.write") ? (
            <WorkshopTransferReview items={reviewItems} />
          ) : null}
          <WorkshopPurchaseForm
            context={context}
            locale={ctx.studio.locale}
            currency={ctx.studio.currency}
            timeZone={ctx.studio.timezone}
            requestId={randomUUID()}
            canPurchase={
              ctx.can("sales.write") && ctx.can("schedule.write") && ctx.can("students.read")
            }
          />
        </>
      )}
    </main>
  );
}
