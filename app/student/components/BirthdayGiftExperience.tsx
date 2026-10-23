"use client";

import Link from "next/link";
import { useState } from "react";

import {
  birthdayDateLabel,
  birthdayPassDaysLeft,
  type BirthdayPassSnapshot,
} from "@/lib/birthday/pass";

export type { BirthdayPassSnapshot };

function GiftIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M3 9h18M12 9v11" />
      <path d="M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

const USE_PASS_HREF = "/student/reservar?pase=cumpleanos";

export default function BirthdayGiftExperience({
  firstName,
  studioName,
  pass,
}: {
  firstName: string;
  studioName: string;
  pass: BirthdayPassSnapshot | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);

  if (!pass) return null;
  const showGreeting = pass.is_birthday === true;
  const showPass = pass.eligible === true;
  if (!showGreeting && !showPass) return null;

  const available = pass.state === "available";
  const used = pass.state === "used";
  const remaining = birthdayPassDaysLeft(pass.today, pass.expires_on);
  const expiresLabel = birthdayDateLabel(pass.expires_on);
  const friendEnabled = pass.friend_enabled !== false;
  const shareCopy = friendEnabled ? "Úsalo tú o regálaselo a una amiga" : "Úsalo en la clase que elijas";

  return (
    <>
      {showGreeting ? (
        <section
          data-home-block="birthday-message"
          className="relative overflow-hidden rounded-[28px] border border-[#f6d67a]/35 bg-[radial-gradient(circle_at_85%_15%,rgba(246,214,122,0.18),transparent_34%),linear-gradient(145deg,#302a31,#17181d)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] sm:p-6"
        >
          <div aria-hidden="true" className="absolute right-5 top-4 text-[#f6d67a]/45">
            ✦ ✦ ✦
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-[#f6d67a]">
            {studioName}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            Feliz cumpleaños, {firstName}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200">
            Hoy todo {studioName} celebra contigo. Gracias por compartir tu fuerza en cada clase;
            hoy te toca a ti.
          </p>
          <p className="mt-4 text-sm font-medium italic text-[#f6d67a]">
            Con cariño, tu familia {studioName}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-[11px] text-zinc-300">
            <LockIcon />
            Solo tú ves este mensaje
          </div>
        </section>
      ) : null}

      {showPass ? (
        <section
          data-home-block="birthday-pass"
          className="relative overflow-hidden rounded-[26px] border border-[#f6d67a]/25 bg-[linear-gradient(145deg,rgba(246,214,122,0.09),rgba(205,184,236,0.04)),rgba(255,255,255,0.025)] p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f6d67a]/12 text-[#f6d67a]">
              <GiftIcon />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f6d67a]">
                Regalo de cumpleaños
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {available
                  ? showGreeting
                    ? "Tu regalo te espera"
                    : "Este mes te festejamos"
                  : used
                    ? "Regalo usado"
                    : "Tu regalo venció"}
              </h2>
            </div>
            <span
              className={
                used
                  ? "rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300"
                  : available
                    ? "rounded-full border border-[#f6d67a]/30 bg-[#f6d67a]/10 px-2.5 py-1 text-[10px] font-semibold text-[#f6d67a]"
                    : "rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-zinc-400"
              }
            >
              {used
                ? "Usado"
                : !available
                  ? "Vencido"
                  : remaining === null
                    ? "Disponible"
                    : remaining === 1
                      ? "Último día"
                      : `${remaining} días para usarlo`}
            </span>
          </div>

          {available ? (
            <>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                <p className="text-xl font-semibold text-white">1 pase de clase</p>
                <p className="mt-1 text-xs leading-5 text-zinc-300">
                  {shareCopy}. Es un saldo aparte y no descuenta clases de tu paquete.
                </p>
                {expiresLabel ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Disponible hasta el {expiresLabel}.
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setRevealed(false);
                    setModalOpen(true);
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-[#f6d67a] px-4 text-sm font-bold text-[#26231b] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6d67a]"
                >
                  Abrir mi regalo
                </button>
                <Link
                  href={USE_PASS_HREF}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/[0.05]"
                >
                  Usar mi pase
                </Link>
              </div>
              <p className="mt-3 text-center text-[11px] text-zinc-500">
                Tus clases del paquete siguen igual.{" "}
                <Link href="/student/paquete" className="underline underline-offset-2">
                  Ver mis créditos
                </Link>
              </p>
            </>
          ) : used ? (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
              <p className="text-sm font-semibold text-emerald-200">Tu pase ya fue utilizado</p>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                {pass.recipient_kind === "friend"
                  ? `Se lo regalaste a ${pass.recipient_name ?? "una amiga"}. Que disfruten la experiencia ${studioName}.`
                  : "Disfruta tu clase de cumpleaños."}
                {pass.used_class_name ? ` Clase: ${pass.used_class_name}.` : ""}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs leading-5 text-zinc-400">
              El pase era válido hasta el {expiresLabel ?? "fin de tu mes"}. ¡Nos vemos en clase!
            </p>
          )}
        </section>
      ) : null}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="birthday-gift-title"
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-[30px] border border-[#f6d67a]/25 bg-[#1d1e23] p-5 text-center shadow-2xl sm:p-6">
            <button
              type="button"
              aria-label="Cerrar regalo"
              onClick={() => setModalOpen(false)}
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
            >
              ×
            </button>

            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-[#f6d67a]/30 bg-[#f6d67a]/10 text-[#f6d67a]">
              <GiftIcon className="h-10 w-10" />
            </div>

            {!revealed ? (
              <>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.26em] text-[#f6d67a]">
                  {studioName}
                </p>
                <h2 id="birthday-gift-title" className="mt-2 text-2xl font-semibold text-white">
                  {showGreeting
                    ? `Feliz cumpleaños, ${firstName}`
                    : `Feliz mes de cumpleaños, ${firstName}`}
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  En {studioName} te queremos mucho y queremos hacerte un regalo.
                </p>
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[#f6d67a] px-4 text-sm font-bold text-[#26231b]"
                >
                  Abrir mi regalo
                </button>
              </>
            ) : (
              <>
                <h2 id="birthday-gift-title" className="mt-5 text-2xl font-semibold text-white">
                  Un pase de clase para ti
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {friendEnabled
                    ? `Úsalo tú o regálaselo a una amiga para que venga a vivir ${studioName} contigo.`
                    : "Úsalo en la clase que elijas durante tu mes de cumpleaños."}
                </p>
                <span className="mt-4 inline-flex rounded-full border border-[#f6d67a]/30 bg-[#f6d67a]/10 px-3 py-1.5 text-xs font-semibold text-[#f6d67a]">
                  {expiresLabel ? `Válido hasta el ${expiresLabel}` : "Ya está disponible en tu portal"}
                </span>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Link
                    href={USE_PASS_HREF}
                    onClick={() => setModalOpen(false)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-[#f6d67a] px-4 text-sm font-bold text-[#26231b]"
                  >
                    Elegir clase
                  </Link>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-white/10 px-4 text-sm font-semibold text-white"
                  >
                    Después
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
