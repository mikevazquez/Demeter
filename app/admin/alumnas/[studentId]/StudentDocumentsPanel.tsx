import Link from "next/link";

import QueryNotice from "@/app/components/QueryNotice";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { documentTypeLabels } from "@/lib/documents";

import { invalidateStudentDocumentAcceptanceAction } from "./actions";

type CurrentDocument = {
  document_id: string;
  version_id: string;
  name: string;
  document_type: string;
  version_number: number;
  enforcement_scope: string;
  satisfied: boolean;
  accepted_current_version_by_student: boolean;
  accepted_current_version_by_guardian: boolean;
  blocks_new_booking: boolean;
  current_student_acceptance?: {
    id: string;
    accepted_at: string;
    decision: string;
    method: string;
  } | null;
  current_guardian_acceptance?: {
    id: string;
    accepted_at: string;
    decision: string;
    method: string;
    guardian_name?: string | null;
  } | null;
};

type AcceptanceHistory = {
  acceptance_id: string;
  accepted_at: string;
  acceptor_kind: "student" | "guardian";
  decision: "accepted" | "declined";
  method: string;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  affirmation_text?: string | null;
  document_id: string;
  version_number: number;
  file_name?: string | null;
  file_path?: string | null;
  content_sha256?: string | null;
  document_name: string;
  document_type: string;
  invalidated?: boolean;
  invalidation_reason?: string | null;
};

type Guardian = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  relationship: string;
  relationship_detail?: string | null;
  active: boolean;
};

type Invitation = {
  id: string;
  status: string;
  destination_hint?: string | null;
  sent_at: string;
};

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function acceptanceMethodLabel(method: string) {
  const labels: Record<string, string> = {
    student_portal: "Portal de alumna",
    guardian_link: "Enlace de responsable",
    in_person: "Presencial",
    external: "Evidencia externa",
  };
  return labels[method] ?? method.replaceAll("_", " ");
}

function relationshipLabel(value: string) {
  const labels: Record<string, string> = {
    mother: "Madre",
    father: "Padre",
    legal_guardian: "Tutor legal",
    family: "Familiar",
    other: "Otra relación",
  };
  return labels[value] ?? value;
}

export default async function StudentDocumentsPanel({
  studentId,
  timeZone,
  result,
  error,
}: {
  studentId: string;
  timeZone: string;
  result?: string;
  error?: string;
}) {
  const { supabase, can } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);
  const { data, error: loadError } = await supabase.rpc("admin_student_document_profile", {
    p_student_id: studentId,
  });

  const snapshot = (data ?? {}) as {
    is_minor?: boolean | null;
    current?: CurrentDocument[];
    history?: AcceptanceHistory[];
    guardians?: Guardian[];
    invitations?: Invitation[];
  };

  const current = snapshot.current ?? [];
  const history = snapshot.history ?? [];
  const guardians = snapshot.guardians ?? [];
  const invitations = snapshot.invitations ?? [];
  const pending = current.filter((item) => !item.satisfied);
  const completed = current.filter((item) => item.satisfied);
  const bookingBlocked = current.filter((item) => item.blocks_new_booking);

  const signedUrls = new Map<string, string>();
  await Promise.all(
    history.map(async (item) => {
      if (!item.file_path) return;
      const { data: signed } = await supabase.storage
        .from("studio-documents")
        .createSignedUrl(item.file_path, 60 * 15);
      if (signed?.signedUrl) signedUrls.set(item.acceptance_id, signed.signedUrl);
    }),
  );

  const activeGuardian = guardians.find((guardian) => guardian.active) ?? null;
  const latestInvitation = invitations[0] ?? null;
  const canManage = can(CAPABILITIES.DOCUMENTS_MANAGE);

  return (
    <section className="profile360-view-panel">
      {result === "invalidated" ? (
        <QueryNotice
          eyebrow="Documentos"
          title="Aceptación invalidada"
          message="La evidencia original se conserva y el requisito volvió a quedar pendiente para la alumna."
          tone="success"
        />
      ) : null}

      {error || loadError ? (
        <QueryNotice
          eyebrow="Documentos"
          title="No pudimos completar la operación"
          message={
            error === "invalidation_required"
              ? "Escribe un motivo de al menos 3 caracteres para invalidar la aceptación."
              : error === "acceptance_not_found"
                ? "La aceptación ya no está disponible en este expediente."
                : "Revisa la información e inténtalo nuevamente."
          }
          tone="error"
        />
      ) : null}

      <div className="profile360-view-heading">
        <div>
          <p className="eyebrow">DOCUMENTOS</p>
          <h2>Documentos de la alumna</h2>
          <p>Documentos pendientes y completados de este expediente.</p>
        </div>
      </div>

      <div className="profile360-approved-indicators">
        <article>
          <span>Completados</span>
          <strong>{completed.length}</strong>
        </article>
        <article>
          <span>Pendientes</span>
          <strong>{pending.length}</strong>
        </article>
      </div>

      <div className="profile360-rewards-section">
        <div className="profile360-package-group-heading">
          <strong>Pendientes</strong>
          <span>{pending.length}</span>
        </div>

        {pending.length ? (
          <div className="profile360-reward-list">
            {pending.map((item) => (
              <article key={item.version_id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {(documentTypeLabels[item.document_type] ?? item.document_type) +
                      " · v" +
                      String(item.version_number)}
                  </span>
                  <span>
                    {item.blocks_new_booking
                      ? "Bloquea nuevas reservas"
                      : item.enforcement_scope === "activity_booking"
                        ? "Se exige solo en actividades aplicables"
                        : "Requiere atención"}
                  </span>
                </div>
                <span className="status-pill">Pendiente</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-100">
            La alumna no tiene documentos pendientes.
          </div>
        )}
      </div>

      <div className="profile360-rewards-section">
        <div className="profile360-package-group-heading">
          <strong>Completados</strong>
          <span>{completed.length}</span>
        </div>

        {completed.length ? (
          <div className="grid gap-3">
            {completed.map((item) => {
              const documentHistory = history.filter(
                (entry) => entry.document_id === item.document_id,
              );
              const currentEvidence = documentHistory.filter(
                (entry) =>
                  entry.version_number === item.version_number && !entry.invalidated,
              );
              const previousEvidence = documentHistory.filter(
                (entry) => entry.version_number !== item.version_number,
              );
              const validByPrevious =
                item.satisfied &&
                !item.accepted_current_version_by_student &&
                !item.accepted_current_version_by_guardian;

              return (
                <details
                  key={item.version_id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-white">{item.name}</strong>
                          <span className="text-xs text-zinc-500">
                            {"v" + String(item.version_number)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {documentTypeLabels[item.document_type] ?? item.document_type}
                        </p>
                        {item.current_student_acceptance ? (
                          <p className="mt-2 text-xs text-zinc-400">
                            {"Alumna: " +
                              (item.current_student_acceptance.decision === "declined"
                                ? "No autorizó"
                                : "Aceptó") +
                              " · " +
                              formatDateTime(
                                item.current_student_acceptance.accepted_at,
                                timeZone,
                              )}
                          </p>
                        ) : null}
                        {item.current_guardian_acceptance ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            {"Responsable: " +
                              (item.current_guardian_acceptance.guardian_name || "Registrado") +
                              " · " +
                              formatDateTime(
                                item.current_guardian_acceptance.accepted_at,
                                timeZone,
                              )}
                          </p>
                        ) : null}
                        {validByPrevious ? (
                          <p className="mt-2 text-xs leading-5 text-cyan-200">
                            Vigente por una aceptación anterior.
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                        Completo
                      </span>
                    </div>
                  </summary>

                  <div className="mt-4 border-t border-white/10 pt-4">
                    {currentEvidence.length ? (
                      <div className="grid gap-3">
                        {currentEvidence.map((entry) => (
                          <div
                            key={entry.acceptance_id}
                            className="rounded-xl border border-white/10 bg-black/20 p-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-white">
                                  {entry.acceptor_kind === "guardian"
                                    ? entry.guardian_name || "Responsable"
                                    : "Alumna"}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  {acceptanceMethodLabel(entry.method) +
                                    " · " +
                                    formatDateTime(entry.accepted_at, timeZone)}
                                </p>
                              </div>
                              <span
                                className={
                                  entry.decision === "declined"
                                    ? "rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200"
                                    : "rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300"
                                }
                              >
                                {entry.decision === "declined" ? "No autorizó" : "Aceptó"}
                              </span>
                            </div>

                            {entry.affirmation_text ? (
                              <div className="mt-3 rounded-xl border border-white/10 p-3">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                                  Confirmación registrada
                                </p>
                                <p className="mt-2 text-xs leading-5 text-zinc-300">
                                  {entry.affirmation_text}
                                </p>
                              </div>
                            ) : null}

                            <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                              <div>
                                <span>Archivo exacto</span>
                                <p className="mt-1 break-words text-zinc-300">
                                  {entry.file_name || "—"}
                                </p>
                              </div>
                              <div>
                                <span>Huella del archivo</span>
                                <p className="mt-1 break-all text-zinc-300">
                                  {entry.content_sha256 || "—"}
                                </p>
                              </div>
                            </div>

                            {signedUrls.get(entry.acceptance_id) ? (
                              <a
                                href={signedUrls.get(entry.acceptance_id)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white"
                              >
                                Ver PDF exacto
                              </a>
                            ) : null}

                            {canManage ? (
                              <form
                                action={invalidateStudentDocumentAcceptanceAction}
                                className="mt-3 rounded-xl border border-rose-400/15 p-3"
                              >
                                <input type="hidden" name="student_id" value={studentId} />
                                <input
                                  type="hidden"
                                  name="acceptance_id"
                                  value={entry.acceptance_id}
                                />
                                <textarea
                                  name="reason"
                                  required
                                  minLength={3}
                                  rows={2}
                                  placeholder="Motivo para invalidar"
                                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"
                                />
                                <button className="mt-2 rounded-xl border border-rose-400/25 px-3 py-2 text-xs font-semibold text-rose-200">
                                  Invalidar sin borrar evidencia
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs leading-5 text-cyan-200">
                        Este documento sigue válido por una aceptación anterior.
                      </p>
                    )}

                    {previousEvidence.length ? (
                      <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-zinc-300">
                          {"Ver versiones anteriores (" +
                            String(previousEvidence.length) +
                            ")"}
                        </summary>
                        <div className="mt-3 grid gap-2">
                          {previousEvidence.map((entry) => (
                            <div
                              key={entry.acceptance_id}
                              className="rounded-xl border border-white/10 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold text-white">
                                    {"v" + String(entry.version_number)}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {(entry.acceptor_kind === "guardian"
                                      ? entry.guardian_name || "Responsable"
                                      : "Alumna") +
                                      " · " +
                                      formatDateTime(entry.accepted_at, timeZone)}
                                  </p>
                                </div>
                                <span
                                  className={
                                    entry.invalidated
                                      ? "rounded-full bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-200"
                                      : "rounded-full bg-zinc-400/10 px-2.5 py-1 text-xs font-semibold text-zinc-300"
                                  }
                                >
                                  {entry.invalidated ? "Invalidada" : "Anterior"}
                                </span>
                              </div>
                              {signedUrls.get(entry.acceptance_id) ? (
                                <a
                                  href={signedUrls.get(entry.acceptance_id)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-3 inline-flex text-xs font-semibold text-fuchsia-300"
                                >
                                  Ver PDF exacto
                                </a>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">La alumna todavía no tiene documentos completados.</div>
        )}
      </div>

      {snapshot.is_minor === true ? (
        <div className="profile360-rewards-section">
          <div className="profile360-package-group-heading">
            <strong>Responsable</strong>
            <span>{activeGuardian ? "Registrado" : "Pendiente"}</span>
          </div>
          {activeGuardian ? (
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <strong className="text-sm text-white">{activeGuardian.full_name}</strong>
              <p className="mt-1 text-xs text-zinc-500">
                {activeGuardian.relationship_detail ||
                  relationshipLabel(activeGuardian.relationship)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {activeGuardian.email || activeGuardian.phone || "Sin contacto visible"}
              </p>
              {latestInvitation ? (
                <p className="mt-2 text-xs text-cyan-200">
                  {"Invitación: " +
                    latestInvitation.status +
                    " · enviada " +
                    formatDateTime(latestInvitation.sent_at, timeZone)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">No hay responsable activo registrado.</div>
          )}
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-zinc-600">
        La configuración de documentos se administra en{" "}
        <Link href="/admin/documentos" className="font-semibold text-fuchsia-300">
          Documentos
        </Link>
        . Aquí se muestra exclusivamente la relación de esos documentos con esta alumna.
      </p>
    </section>
  );
}
