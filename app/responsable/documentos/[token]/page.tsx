import { notFound } from "next/navigation";

import QueryNotice from "@/app/components/QueryNotice";
import { createClient } from "@/lib/supabase/server";

import { verifyGuardianIdentityAction } from "../actions";

type Invitation = {
  invitation_id: string;
  status: string;
  expires_at: string;
  studio: {
    id: string;
    name: string;
    tagline: string | null;
    timezone: string;
    locale: string;
    primary_color: string | null;
    logo_path: string | null;
  };
  guardian: {
    id: string;
    full_name: string;
    relationship: string;
    relationship_detail?: string | null;
  };
  student: { id: string; full_name: string };
  items?: unknown[];
};

export default async function GuardianInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_document_invitation", {
    p_token: token,
  });

  if (error || !data) notFound();
  const invitation = data as Invitation;
  const brandColor = invitation.studio.primary_color ?? "#FF0A8A";
  const logoUrl = invitation.studio.logo_path
    ? supabase.storage.from("studio-branding").getPublicUrl(invitation.studio.logo_path).data.publicUrl
    : null;

  return (
    <main className="min-h-screen bg-[#090a0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="text-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={invitation.studio.name}
              className="mx-auto mb-4 h-14 max-w-[180px] object-contain"
            />
          ) : null}
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.26em]"
            style={{ color: brandColor }}
          >
            {invitation.studio.name} · Documentos
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Invitación para responsable</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {invitation.studio.tagline ||
              "Antes de mostrar documentos necesitamos confirmar que esta invitación corresponde a ti."}
          </p>
        </header>

        {query.error ? (
          <QueryNotice
            eyebrow="Documentos"
            title="Confirma tu identidad"
            message="Necesitamos tu confirmación antes de mostrar los documentos pendientes."
            tone="error"
          />
        ) : null}

        <section className="rounded-[32px] border border-fuchsia-500/25 bg-[radial-gradient(circle_at_50%_0%,rgba(217,70,239,.14),transparent_40%),#0d0f16] p-6 shadow-[0_0_30px_rgba(217,70,239,.08)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.08] text-xl text-fuchsia-200">
            ✓
          </div>
          <p className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Invitación válida
          </p>
          <h2 className="mt-2 text-center text-xl font-semibold text-white">
            {invitation.student.full_name}
          </h2>
          <p className="mt-1 text-center text-sm text-zinc-500">
            {invitation.items?.length ?? 0} documento
            {(invitation.items?.length ?? 0) === 1 ? "" : "s"} por revisar
          </p>

          <div className="mt-6 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Responsable</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {invitation.guardian.full_name}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                Relación declarada
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {invitation.guardian.relationship_detail || invitation.guardian.relationship}
              </p>
            </div>
          </div>

          <form action={verifyGuardianIdentityAction} className="mt-5">
            <input type="hidden" name="token" value={token} />
            <label className="flex items-start gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-sm leading-6 text-zinc-300">
              <input
                type="checkbox"
                name="confirmed"
                value="true"
                required
                className="mt-1 accent-fuchsia-500"
              />
              Confirmo que soy {invitation.guardian.full_name} y que mi relación con la alumna es la
              indicada arriba.
            </label>
            <button
              className="mt-4 w-full rounded-2xl px-5 py-3 text-sm font-semibold text-white"
              style={{ backgroundColor: brandColor }}
            >
              Ver documentos pendientes
            </button>
          </form>
        </section>

        <p className="text-center text-[11px] leading-5 text-zinc-600">
          La invitación vence el{" "}
          {new Intl.DateTimeFormat(invitation.studio.locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: invitation.studio.timezone,
          }).format(new Date(invitation.expires_at))}
          .
        </p>
      </div>
    </main>
  );
}
