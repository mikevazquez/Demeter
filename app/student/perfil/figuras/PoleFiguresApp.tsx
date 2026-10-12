"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { POLE_PHOTO_BUCKET, POLE_PHOTO_MAX_BYTES, POLE_PHOTO_MAX_SIDE } from "@/lib/pole/constants";
import {
  ancestorsOf,
  buildStateContext,
  childrenOf,
  figureStatus,
  groupByFamily,
  summarizeForStudent,
  type PoleFigureState,
} from "@/lib/pole/figure-state";
import {
  POLE_LEVEL_LABEL,
  type StudentPoleCatalog,
  type StudentPoleFigure,
} from "@/lib/pole/types";
import { createClient } from "@/lib/supabase/client";

import {
  markPoleFigureAction,
  setPolePhotoAction,
  unmarkPoleFigureAction,
  type StudentPoleActionResult,
} from "./actions";

type View =
  | { name: "home" }
  | { name: "list" }
  | { name: "detail"; id: string; from: "home" | "list" };
type Tab = "logradas" | "faltan" | "pro";

const ERROR_COPY: Record<string, string> = {
  pole_figure_prerequisites_missing: "Primero necesitas lograr la figura que va antes.",
  pole_figure_next_level: "Esta figura es de un nivel más alto que el tuyo.",
  pole_figure_requires_authorization: "Esta figura necesita autorización de tu instructora.",
  pole_figure_not_achieved: "Primero marca la figura como lograda.",
  pole_photo_invalid_path: "No pudimos guardar la foto. Intenta de nuevo.",
};

const STATE_PILL: Record<PoleFigureState, { label: string; className: string }> = {
  lograda: {
    label: "Lograda ✓",
    className: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300",
  },
  disponible: {
    label: "Disponible",
    className: "border-fuchsia-500/25 bg-fuchsia-500/[0.14] text-fuchsia-300",
  },
  bloqueada: { label: "Bloqueada", className: "border-white/10 bg-white/[0.03] text-zinc-400" },
  siguiente_nivel: {
    label: "Siguiente nivel",
    className: "border-white/10 bg-white/[0.03] text-zinc-400",
  },
  requiere_autorizacion: {
    label: "Requiere autorización",
    className: "border-red-400/25 bg-red-400/[0.08] text-red-300",
  },
  autorizada: {
    label: "Autorizada",
    className: "border-fuchsia-500/25 bg-fuchsia-500/[0.14] text-fuchsia-300",
  },
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${className}`}
    >
      {children}
    </span>
  );
}

function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function CameraIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white transition hover:bg-white/[0.06]"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-4 w-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, POLE_PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("resize"))),
      "image/jpeg",
      0.85,
    ),
  );
}

export function PoleFiguresApp({
  userId,
  catalog,
  photoUrls,
  todayIds,
}: {
  userId: string;
  catalog: StudentPoleCatalog;
  photoUrls: Record<string, string>;
  todayIds: string[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>({ name: "home" });
  const [tab, setTab] = useState<Tab>("faltan");
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const figures = catalog.figures;
  const byId = useMemo(() => new Map(figures.map((figure) => [figure.id, figure])), [figures]);
  const studentLevel = catalog.level?.catalog_level ?? "principiante";
  const proEligible = catalog.level?.pro_eligible ?? false;
  const context = useMemo(() => buildStateContext(figures, studentLevel), [figures, studentLevel]);
  const summary = useMemo(() => summarizeForStudent(figures, context), [figures, context]);
  const levelLabel = catalog.level?.title ?? POLE_LEVEL_LABEL[studentLevel];
  const todayFigures = todayIds
    .map((id) => byId.get(id))
    .filter((figure): figure is StudentPoleFigure => Boolean(figure?.achievement));
  const todayCore = todayFigures.filter((figure) => figure.core && figure.level === studentLevel);
  const nextFigures = (summary.next.length ? summary.next : summary.free).slice(0, 3);
  const percent = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;

  function run(action: () => Promise<StudentPoleActionResult>, success: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setNotice({ tone: "success", text: success });
        router.refresh();
      } else {
        setNotice({
          tone: "error",
          text: ERROR_COPY[result.error] ?? "No pudimos guardar el cambio. Intenta de nuevo.",
        });
      }
    });
  }

  function mark(figure: StudentPoleFigure) {
    run(() => markPoleFigureAction(figure.id), `Marcaste ${figure.name} como lograda.`);
  }

  function unmark(figure: StudentPoleFigure) {
    run(() => unmarkPoleFigureAction(figure.id), `Desmarcaste ${figure.name}.`);
  }

  function pickPhoto(figureId: string) {
    uploadTarget.current = figureId;
    fileInput.current?.click();
  }

  async function onPhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const figureId = uploadTarget.current;
    event.target.value = "";
    if (!file || !figureId) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setNotice({ tone: "error", text: "Usa una imagen JPG, PNG o WebP." });
      return;
    }

    setNotice(null);
    setUploadingId(figureId);
    try {
      const blob = await resizeImage(file).catch(() => file);
      if (blob.size > POLE_PHOTO_MAX_BYTES) {
        setNotice({ tone: "error", text: "La imagen debe pesar máximo 5 MB." });
        return;
      }
      const path = `${userId}/${figureId}/${Date.now()}.jpg`;
      const supabase = createClient("student");
      const { error: uploadError } = await supabase.storage
        .from(POLE_PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const result = await setPolePhotoAction(figureId, path);
      if (!result.ok) {
        await supabase.storage.from(POLE_PHOTO_BUCKET).remove([path]);
        setNotice({
          tone: "error",
          text: ERROR_COPY[result.error] ?? "No pudimos guardar la foto.",
        });
        return;
      }
      setNotice({ tone: "success", text: "Tu foto quedó guardada." });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: "No pudimos subir la foto. Intenta de nuevo." });
    } finally {
      setUploadingId(null);
    }
  }

  function removePhoto(figure: StudentPoleFigure) {
    run(() => setPolePhotoAction(figure.id, null), "Quitaste la foto.");
  }

  function open(id: string) {
    setNotice(null);
    setView({ name: "detail", id, from: view.name === "home" ? "home" : "list" });
    window.scrollTo({ top: 0 });
  }

  const noticeBlock = notice ? (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
        notice.tone === "error"
          ? "border-red-400/25 bg-red-400/[0.06] text-red-200"
          : "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200"
      }`}
    >
      {notice.text}
    </p>
  ) : null;

  const hiddenInput = (
    <input
      ref={fileInput}
      id="pole-photo-input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      onChange={onPhotoSelected}
    />
  );

  function figureRow(figure: StudentPoleFigure, trailing?: React.ReactNode, subtitle?: string) {
    return (
      <li
        key={figure.id}
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
      >
        <button type="button" onClick={() => open(figure.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-white underline decoration-white/20 underline-offset-4">
            {figure.name}
          </span>
          <span className="block truncate text-xs text-zinc-500">{subtitle ?? figure.type}</span>
        </button>
        {trailing}
      </li>
    );
  }

  function markButton(figure: StudentPoleFigure) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => mark(figure)}
        className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-zinc-100 transition hover:bg-white/[0.06] disabled:opacity-60"
      >
        <span aria-hidden="true" className="h-4 w-4 rounded-[5px] border-2 border-zinc-500" />
        Ya la logré
      </button>
    );
  }

  // ---------------------------------------------------------------- Detalle
  if (view.name === "detail") {
    const figure = byId.get(view.id);
    if (!figure) {
      return (
        <main className="space-y-4 pb-4">
          <BackButton onClick={() => setView({ name: "list" })} label="Volver" />
          <p className="text-sm text-zinc-400">Esta figura ya no está disponible.</p>
        </main>
      );
    }
    const status = figureStatus(figure, context);
    const pill = STATE_PILL[status.state];
    const chain = ancestorsOf(figure.id, byId);
    const children = childrenOf(figure.id, figures) as StudentPoleFigure[];
    const photo = figure.achievement?.photo_path ? photoUrls[figure.achievement.photo_path] : null;

    const chainItem = (id: string, current = false) => {
      const item = byId.get(id);
      if (!item) return null;
      const itemStatus = figureStatus(item, context);
      const itemPill = STATE_PILL[itemStatus.state];
      return (
        <li key={`${id}${current ? "-current" : ""}`} className="relative">
          <button
            type="button"
            onClick={() => open(id)}
            aria-current={current ? "true" : undefined}
            className={`flex w-full items-center gap-3 py-2 text-left ${current ? "rounded-2xl bg-fuchsia-500/10 px-3" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                itemStatus.state === "lograda"
                  ? "bg-emerald-400 text-emerald-950"
                  : itemStatus.state === "disponible" || itemStatus.state === "autorizada"
                    ? "border-2 border-fuchsia-500 bg-[#090a0f]"
                    : itemStatus.state === "requiere_autorizacion"
                      ? "bg-red-400/10 text-red-300"
                      : "bg-white/[0.06] text-zinc-400"
              }`}
            >
              {itemStatus.state === "lograda" ? (
                "✓"
              ) : itemStatus.state === "disponible" || itemStatus.state === "autorizada" ? null : (
                <LockIcon className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{item.name}</span>
              <span className="block truncate text-xs text-zinc-500">
                {item.level !== studentLevel ? `${POLE_LEVEL_LABEL[item.level]} · ` : ""}
                {item.type}
              </span>
            </span>
            <Pill className={itemPill.className}>{itemPill.label}</Pill>
          </button>
        </li>
      );
    };

    return (
      <main className="space-y-5 pb-4">
        {hiddenInput}
        <div className="flex items-center gap-3">
          <BackButton
            onClick={() => setView(view.from === "home" ? { name: "home" } : { name: "list" })}
            label="Volver"
          />
          <span className="text-xs font-semibold text-zinc-400">Mis figuras</span>
        </div>
        {noticeBlock}

        <header className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Pill className={pill.className}>{pill.label}</Pill>
            <Pill className="border-white/10 bg-white/[0.03] text-zinc-400">{figure.type}</Pill>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">{figure.name}</h1>
          <p className="text-sm text-zinc-500">
            {figure.name !== figure.original_name ? `${figure.original_name} · ` : ""}
            {POLE_LEVEL_LABEL[figure.level]}
          </p>
          {figure.description ? (
            <p className="text-sm leading-6 text-zinc-300">{figure.description}</p>
          ) : null}
        </header>

        {status.state === "lograda" ? (
          <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            {photo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo}
                  alt={`Tu foto haciendo ${figure.name}`}
                  className="max-h-80 w-full rounded-2xl object-cover"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => pickPhoto(figure.id)}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200"
                  >
                    Cambiar foto
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removePhoto(figure)}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-400"
                  >
                    Quitar foto
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => pickPhoto(figure.id)}
                disabled={uploadingId === figure.id}
                className="flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-fuchsia-500/30 bg-fuchsia-500/[0.04] p-4 text-center text-zinc-400"
              >
                <CameraIcon className="h-6 w-6" />
                <span className="text-sm font-semibold text-fuchsia-300">
                  {uploadingId === figure.id ? "Subiendo…" : "Sube tu foto haciéndola"}
                </span>
                <span className="text-xs">Guárdala como recuerdo de tu logro</span>
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => unmark(figure)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-zinc-200"
            >
              Desmarcar como lograda
            </button>
          </section>
        ) : status.state === "disponible" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => mark(figure)}
            className="w-full rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(255,10,138,0.16)] disabled:opacity-60"
          >
            Ya la logré
          </button>
        ) : status.state === "autorizada" ? (
          <div className="space-y-3">
            <p className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
              Tu instructora te autorizó esta figura. Practícala solo en clase y con ella presente.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => mark(figure)}
              className="w-full rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Ya la logré
            </button>
          </div>
        ) : (
          <div
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
              status.state === "requiere_autorizacion"
                ? "border-red-400/25 bg-red-400/[0.06] text-zinc-100"
                : "border-white/10 bg-white/[0.04] text-zinc-100"
            }`}
          >
            <LockIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${status.state === "requiere_autorizacion" ? "text-red-300" : "text-zinc-400"}`}
            />
            <span>
              {status.state === "bloqueada" ? (
                <>
                  Primero logra{" "}
                  <strong>
                    {status.missing.map((id) => byId.get(id)?.name ?? "").join(" y ")}
                  </strong>
                  .
                </>
              ) : status.state === "siguiente_nivel" ? (
                `Es de nivel ${POLE_LEVEL_LABEL[figure.level]}. Se abre cuando subas de nivel en tu evaluación.`
              ) : (
                <>
                  Figura de nivel <strong>Profesional</strong>. Solo se abre si tu instructora la
                  autoriza para ti
                  {proEligible ? "" : ", y primero necesitas llegar a nivel Avanzado"}.
                </>
              )}
            </span>
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Tu camino hacia esta figura</h2>
          {chain.length ? (
            <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[13px] before:top-4 before:w-0.5 before:bg-white/10">
              {chain.map((id) => chainItem(id))}
              {chainItem(figure.id, true)}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">
              {figure.level === "profesional"
                ? "No depende de otra figura del catálogo: tu instructora decide cuándo estás lista."
                : "No necesita otra figura antes. Es un punto de partida."}
            </p>
          )}
        </section>

        {children.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-white">
              {status.state === "lograda" ? "Esta figura te abrió" : "Cuando la logres, se abren"}
            </h2>
            <ol className="relative before:absolute before:bottom-4 before:left-[13px] before:top-4 before:w-0.5 before:bg-white/10">
              {children.map((child) => chainItem(child.id))}
            </ol>
          </section>
        ) : null}
      </main>
    );
  }

  // ---------------------------------------------------------------- Lista completa
  if (view.name === "list") {
    const families = groupByFamily(summary.pro.locked);
    const tabs: { key: Tab; label: React.ReactNode }[] = [
      { key: "logradas", label: `Logradas (${summary.done})` },
      { key: "faltan", label: `Por intentar (${summary.total - summary.done})` },
      {
        key: "pro",
        label: (
          <span className="inline-flex items-center gap-1">
            <LockIcon className="h-3.5 w-3.5" /> Pro
          </span>
        ),
      },
    ];
    const gallery = summary.achieved.filter(
      (figure) => figure.achievement?.photo_path && photoUrls[figure.achievement.photo_path],
    );

    return (
      <main className="space-y-5 pb-4">
        {hiddenInput}
        <div className="flex items-center gap-3">
          <BackButton onClick={() => setView({ name: "home" })} label="Volver a mi progreso" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Mis figuras</h1>
            <p className="text-xs text-zinc-500">
              {levelLabel} · {summary.done} de {summary.total}
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filtrar figuras"
          className="grid grid-cols-3 gap-1 rounded-[18px] border border-white/10 bg-black/25 p-1"
        >
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`min-h-10 rounded-[14px] px-2 text-xs font-bold transition ${
                tab === item.key
                  ? item.key === "pro"
                    ? "bg-red-400/20 text-red-100"
                    : "bg-fuchsia-600 text-white"
                  : item.key === "pro"
                    ? "text-red-300"
                    : "text-zinc-400"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {noticeBlock}

        {tab === "logradas" ? (
          <>
            {gallery.length ? (
              <section className="space-y-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">Mi galería</h2>
                  <p className="text-xs text-zinc-500">
                    {gallery.length} {gallery.length === 1 ? "foto" : "fotos"} de tus logros
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {gallery.map((figure) => (
                    <figure
                      key={figure.id}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrls[figure.achievement!.photo_path!]}
                        alt={figure.name}
                        className="aspect-[3/4] w-full object-cover"
                      />
                      <figcaption className="truncate px-2 py-1.5 text-[11px] font-semibold text-zinc-300">
                        {figure.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold text-white">Logradas ({summary.done})</h2>
                <p className="text-xs text-zinc-500">
                  Toca la palomita para desmarcar una figura. Sube una foto a cualquiera.
                </p>
              </div>
              {summary.achieved.length ? (
                <ul className="space-y-2">
                  {summary.achieved.map((figure) => {
                    const photo = figure.achievement?.photo_path
                      ? photoUrls[figure.achievement.photo_path]
                      : null;
                    return (
                      <li
                        key={figure.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
                      >
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => unmark(figure)}
                          aria-pressed="true"
                          aria-label={`Desmarcar ${figure.name}`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-emerald-400 text-xs font-bold text-emerald-950">
                            ✓
                          </span>
                        </button>
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-lg object-cover"
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => open(figure.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-sm font-semibold text-white underline decoration-white/20 underline-offset-4">
                            {figure.name}
                            {todayIds.includes(figure.id) ? (
                              <span className="ml-2 rounded-full bg-fuchsia-500/[0.14] px-2 py-0.5 text-[10px] font-bold text-fuchsia-300 no-underline">
                                Hoy
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {figure.type}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => pickPhoto(figure.id)}
                          disabled={uploadingId === figure.id}
                          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-fuchsia-300"
                        >
                          <CameraIcon className="h-3.5 w-3.5" />
                          {uploadingId === figure.id ? "Subiendo…" : photo ? "Cambiar" : "Foto"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
                  Todavía no tienes figuras logradas en tu nivel.
                </p>
              )}
            </section>
          </>
        ) : tab === "faltan" ? (
          <>
            {summary.next.length ? (
              <section className="space-y-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">Siguientes para ti</h2>
                  <p className="text-xs text-zinc-500">
                    Ya tienes el paso previo. Si ya la lograste, márcala.
                  </p>
                </div>
                <ul className="space-y-2">
                  {summary.next.map((figure) => figureRow(figure, markButton(figure)))}
                </ul>
              </section>
            ) : null}
            {summary.free.length ? (
              <section className="space-y-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">También puedes intentar</h2>
                  <p className="text-xs text-zinc-500">No necesitan otra figura antes.</p>
                </div>
                <ul className="space-y-2">
                  {summary.free.map((figure) => figureRow(figure, markButton(figure)))}
                </ul>
              </section>
            ) : null}
            {summary.blocked.length ? (
              <section className="space-y-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">Bloqueadas</h2>
                  <p className="text-xs text-zinc-500">
                    Se abren cuando logres la figura que va antes.
                  </p>
                </div>
                <ul className="space-y-2">
                  {summary.blocked.map(({ figure, missing }) => (
                    <li
                      key={figure.id}
                      className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-3"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400">
                        <LockIcon />
                      </span>
                      <button
                        type="button"
                        onClick={() => open(figure.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-sm font-semibold text-zinc-400 underline decoration-white/15 underline-offset-4">
                          {figure.name}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          Antes: {missing.map((id) => byId.get(id)?.name ?? "").join(", ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {!summary.next.length && !summary.free.length && !summary.blocked.length ? (
              <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-200">
                ¡Ya lograste todas las figuras de tu nivel!
              </p>
            ) : null}
          </>
        ) : !proEligible ? (
          <>
            <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3 text-sm text-zinc-100">
              <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>
                Las figuras <strong>Profesional</strong> son de alto riesgo. Se abren solo en nivel
                Avanzado y cuando tu instructora te autoriza cada una.
              </span>
            </div>
            <ul className="space-y-2">
              {families.map((group) => (
                <li
                  key={group.family}
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-red-400/15 bg-black/20 px-4 py-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-400/10 text-red-300">
                    <LockIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white">{group.family}</span>
                    <span className="block text-xs text-zinc-500">
                      {group.items.length} {group.items.length === 1 ? "figura" : "figuras"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold text-white">Autorizadas por tu instructora</h2>
                <p className="text-xs text-zinc-500">
                  {summary.pro.authorized.length
                    ? "Ya puedes marcarlas cuando las logres en clase."
                    : "Todavía no tienes figuras autorizadas. Pídele a tu instructora la primera."}
                </p>
              </div>
              <ul className="space-y-2">
                {summary.pro.authorized.map((figure) =>
                  figureRow(figure, markButton(figure), `Autorizada · ${figure.family}`),
                )}
              </ul>
            </section>
            {summary.pro.achieved.length ? (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-white">
                  Logradas ({summary.pro.achieved.length})
                </h2>
                <ul className="space-y-2">
                  {summary.pro.achieved.map((figure) =>
                    figureRow(
                      figure,
                      <Pill className={STATE_PILL.lograda.className}>Lograda ✓</Pill>,
                      figure.family,
                    ),
                  )}
                </ul>
              </section>
            ) : null}
            <section className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Requieren autorización ({summary.pro.locked.length})
                </h2>
                <p className="text-xs text-zinc-500">Toca una familia para verla.</p>
              </div>
              <ul className="space-y-2">
                {families.map((group) => {
                  const expanded = openFamily === group.family;
                  return (
                    <li key={group.family} className="space-y-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpenFamily(expanded ? null : group.family)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-red-400/15 bg-black/20 px-4 py-3 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-400/10 text-red-300">
                          <LockIcon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-white">
                            {group.family}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {group.items.length} {group.items.length === 1 ? "figura" : "figuras"}
                          </span>
                        </span>
                        <span aria-hidden="true" className="text-lg text-zinc-400">
                          {expanded ? "−" : "+"}
                        </span>
                      </button>
                      {expanded ? (
                        <ul className="space-y-2 pl-3">
                          {group.items.map((figure) =>
                            figureRow(figure, undefined, "Requiere autorización"),
                          )}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </main>
    );
  }

  // ---------------------------------------------------------------- Inicio
  const latestToday = todayFigures[0] ?? null;
  const latestPhoto = latestToday?.achievement?.photo_path
    ? photoUrls[latestToday.achievement.photo_path]
    : null;

  return (
    <main className="space-y-5 pb-4">
      {hiddenInput}
      <header>
        <Link
          href="/student/perfil"
          className="text-xs font-semibold text-zinc-400 hover:text-white"
        >
          ← Perfil
        </Link>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Mis figuras
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          {catalog.discipline?.name ?? "Pole"}
        </h1>
      </header>

      {noticeBlock}

      <button
        type="button"
        onClick={() => setView({ name: "list" })}
        className="relative block w-full overflow-hidden rounded-[28px] border border-fuchsia-500/35 bg-[linear-gradient(135deg,#250919_0%,#140813_42%,#090d13_100%)] p-5 text-left shadow-[0_0_34px_rgba(236,72,153,0.10)] sm:p-6"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,rgba(236,72,153,0.30),transparent_40%)]" />
        <span className="relative flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
            {levelLabel}
          </span>
          {todayCore.length ? (
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[0.12] px-2.5 py-1 text-xs font-bold text-emerald-300">
              +{todayCore.length} hoy
            </span>
          ) : null}
        </span>
        <span className="relative mt-3 flex items-baseline gap-2">
          <span className="text-6xl font-semibold leading-none tracking-tight text-white tabular-nums">
            {summary.done}
          </span>
          <span className="text-base text-zinc-300">de {summary.total} figuras logradas</span>
        </span>
        <span className="relative mt-4 block h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-300"
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="relative mt-4 flex items-center justify-between text-sm font-semibold text-white">
          Ver mis figuras
          <span aria-hidden="true">›</span>
        </span>
      </button>

      {!catalog.level ? (
        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
          Todavía no tienes una evaluación de nivel en esta disciplina. Mientras tanto ves las
          figuras de Principiante.
        </p>
      ) : null}

      {latestToday ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Lo que lograste hoy</h2>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => open(latestToday.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-base font-semibold text-white">
                  {latestToday.name}
                </span>
                <span className="block text-xs text-zinc-500">
                  {latestToday.achievement?.source === "instructor"
                    ? "Validada hoy por tu instructora"
                    : "La marcaste hoy"}
                </span>
              </button>
              <Pill className={STATE_PILL.lograda.className}>Lograda ✓</Pill>
            </div>
            {latestPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={latestPhoto}
                alt={`Tu foto haciendo ${latestToday.name}`}
                className="max-h-80 w-full object-cover"
              />
            ) : (
              <button
                type="button"
                onClick={() => pickPhoto(latestToday.id)}
                disabled={uploadingId === latestToday.id}
                className="mx-4 mb-4 flex min-h-36 w-[calc(100%-2rem)] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-fuchsia-500/30 bg-fuchsia-500/[0.04] p-4 text-center text-zinc-400"
              >
                <CameraIcon className="h-6 w-6" />
                <span className="text-sm font-semibold text-fuchsia-300">
                  {uploadingId === latestToday.id ? "Subiendo…" : "Sube tu foto haciéndola"}
                </span>
                <span className="text-xs">Guárdala como recuerdo de tu logro</span>
              </button>
            )}
          </div>
        </section>
      ) : null}

      {nextFigures.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Tus siguientes figuras</h2>
          <ul className="space-y-2">
            {nextFigures.map((figure) =>
              figureRow(figure, <Pill className={STATE_PILL.disponible.className}>Siguiente</Pill>),
            )}
          </ul>
        </section>
      ) : null}

      {proEligible && summary.pro.authorized.length ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Autorizadas por tu instructora</h2>
            <p className="text-xs text-zinc-500">Nivel Profesional</p>
          </div>
          <ul className="space-y-2">
            {summary.pro.authorized.map((figure) =>
              figureRow(
                figure,
                <Pill className={STATE_PILL.autorizada.className}>Autorizada</Pill>,
                figure.family,
              ),
            )}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setView({ name: "list" })}
        className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.06]"
      >
        Ver todas mis figuras
      </button>
    </main>
  );
}
