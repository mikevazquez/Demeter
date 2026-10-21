import Image from "next/image";
import Link from "next/link";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import { updateStudentProfileAction } from "../actions";
import PendingActionButton from "../components/PendingActionButton";
import StudentNoticeDialog from "../components/StudentNoticeDialog";
import AvatarFilePicker from "./AvatarFilePicker";

const errorCopy: Record<string, string> = {
  email_invalid: "Revisa el formato de tu correo.",
  profile_update_failed: "No pudimos guardar los cambios. Intenta de nuevo.",
  forbidden: "Tu cuenta no tiene permiso para editar estos datos.",
  birth_date_required: "Agrega tu fecha de nacimiento.",
  birth_date_invalid: "Revisa tu fecha de nacimiento.",
  birth_date_field_missing: "No encontramos el campo de fecha de nacimiento.",
};

function profileInitials(firstName: string, lastName: string | null) {
  const words = [firstName, lastName].filter(Boolean) as string[];
  const initials = words.map((word) => word.trim().charAt(0)).join("");

  return (initials || firstName.slice(0, 2)).slice(0, 2).toUpperCase();
}

export default async function StudentProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    updated?: string;
    error?: string;
    edit?: string;
    avatar?: string;
    avatar_error?: string;
  }>;
}) {
  const [query, { snapshot, studio, supabase }] = await Promise.all([
    searchParams,
    getStudentPortalContext(),
  ]);
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const fullName = [snapshot.profile.first_name, snapshot.profile.last_name]
    .filter(Boolean)
    .join(" ");
  const initials = profileInitials(snapshot.profile.first_name, snapshot.profile.last_name);
  const editingProfile = query.edit === "1" || Boolean(query.error);

  const [{ data: studentIdentity }, { data: birthDateDefinition }] = await Promise.all([
    supabase
      .from("students")
      .select("person_id")
      .eq("id", snapshot.profile.student_id)
      .maybeSingle(),
    supabase
      .from("profile_field_definitions")
      .select("id")
      .eq("studio_id", snapshot.profile.studio_id)
      .eq("entity_type", "student")
      .eq("key", "birth_date")
      .eq("active", true)
      .maybeSingle(),
  ]);

  let birthDate = "";
  if (studentIdentity?.person_id && birthDateDefinition?.id) {
    const { data: birthDateValue } = await supabase
      .from("profile_field_values")
      .select("value")
      .eq("person_id", studentIdentity.person_id)
      .eq("definition_id", birthDateDefinition.id)
      .maybeSingle();

    birthDate = typeof birthDateValue?.value === "string" ? birthDateValue.value : "";
  }

  return (
    <main className="space-y-4 pb-4 sm:space-y-5">
      <header>
        <p className="sendero-brand">Perfil</p>
        <h1 className="mt-2 text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
          Mi cuenta
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--sendero-muted)]">
          Consulta tu información y accede a los datos asociados a tu cuenta.
        </p>
      </header>

      {query.avatar === "updated" ? (
        <StudentNoticeDialog
          eyebrow="Foto actualizada"
          title="Tu foto de perfil está lista"
          dismissHref="/student/perfil"
        >
          La nueva imagen ya está asociada a tu cuenta.
        </StudentNoticeDialog>
      ) : query.avatar_error ? (
        <StudentNoticeDialog
          eyebrow="No pudimos guardar la foto"
          title="Revisa la imagen"
          dismissHref="/student/perfil"
          tone="error"
        >
          {query.avatar_error === "type"
            ? "Usa una imagen JPG, PNG o WebP."
            : query.avatar_error === "size"
              ? "La imagen debe pesar máximo 5 MB."
              : "No pudimos guardar la foto. Intenta nuevamente."}
        </StudentNoticeDialog>
      ) : query.updated ? (
        <StudentNoticeDialog
          eyebrow="Cambios guardados"
          title="Tu perfil está actualizado"
          dismissHref="/student/perfil"
        >
          Tus datos se actualizaron correctamente.
        </StudentNoticeDialog>
      ) : query.error ? (
        <StudentNoticeDialog
          eyebrow="No pudimos guardar"
          title="Revisa tus datos"
          dismissHref="/student/perfil"
          tone="error"
        >
          {errorCopy[query.error] ?? errorCopy.profile_update_failed}
        </StudentNoticeDialog>
      ) : null}

      <Link
        href="/student/perfil/figuras"
        data-profile-block="pole-figures"
        className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-mint-soft)] text-lg text-[var(--sendero-mint)]"
        >
          ✦
        </span>
        <span className="min-w-0">
          <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
            Figuras de Pole
          </strong>
          <span className="mt-0.5 block text-xs text-zinc-500">
            Tu progreso, tus siguientes figuras y las fotos de tus logros.
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-xl text-zinc-600 transition group-hover:text-[var(--sendero-mint)]"
        >
          ›
        </span>
      </Link>

      <section data-profile-block="identity" className="sendero-surface overflow-hidden">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[rgba(205,184,236,0.45)] bg-[var(--sendero-lilac-soft)] text-xl font-semibold text-[var(--sendero-lilac)] sm:h-20 sm:w-20 sm:text-2xl">
                {initials}
                <Image
                  src="/student/perfil/avatar"
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="mt-2">
                <AvatarFilePicker />
              </div>
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl text-[var(--sendero-ink)] sm:text-3xl">
                {fullName}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">Alumna · {studio.name}</p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-white/10 px-5 sm:px-6">
          <div className="grid gap-1 py-3.5 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:gap-4">
            <p className="text-xs font-medium text-zinc-500">Nombre</p>
            <p className="text-sm text-white">{snapshot.profile.first_name}</p>
            <span className="text-[11px] text-zinc-600">Solo lectura</span>
          </div>
          <div className="grid gap-1 py-3.5 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:gap-4">
            <p className="text-xs font-medium text-zinc-500">Apellidos</p>
            <p className="text-sm text-white">{snapshot.profile.last_name || "—"}</p>
            <span className="text-[11px] text-zinc-600">Solo lectura</span>
          </div>
          <div className="grid gap-1 py-3.5 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:gap-4">
            <p className="text-xs font-medium text-zinc-500">Teléfono</p>
            <p className="text-sm text-white">{snapshot.profile.phone}</p>
            <span className="text-[11px] text-zinc-600">Solo lectura</span>
          </div>
          <div className="grid gap-2 py-3.5 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:gap-4">
            <p className="text-xs font-medium text-zinc-500">Correo electrónico</p>
            <p className="min-w-0 break-all text-sm text-white">
              {snapshot.profile.email || "Sin correo registrado"}
            </p>
            {!editingProfile ? (
              <Link
                href="/student/perfil?edit=1"
                className="sendero-button sendero-button-ghost !min-h-9 !px-3 !text-xs !text-[var(--sendero-mint)]"
              >
                Editar perfil
              </Link>
            ) : null}
          </div>
          <div className="grid gap-1 py-3.5 sm:grid-cols-[120px_1fr_auto] sm:items-center sm:gap-4">
            <p className="text-xs font-medium text-zinc-500">Fecha de nacimiento</p>
            <p className="text-sm text-white">{birthDate || "Sin registrar"}</p>
            <span className="text-[11px] text-zinc-600">
              {birthDate ? "Registrada" : "Pendiente"}
            </span>
          </div>
        </div>

        {editingProfile ? (
          <form
            action={updateStudentProfileAction}
            className="border-t border-[var(--sendero-line)] bg-black/15 p-5 sm:p-6"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block min-w-0 text-sm text-zinc-300">
                Correo electrónico
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={snapshot.profile.email ?? ""}
                  autoComplete="email"
                  className="mt-2 w-full rounded-[16px] border border-[var(--sendero-line)] bg-black/20 px-3 py-3 text-[var(--sendero-ink)] outline-none transition placeholder:text-[var(--sendero-faint)]"
                  placeholder="tu@correo.com"
                />
              </label>
              <label className="block min-w-0 text-sm text-zinc-300">
                Fecha de nacimiento
                <input
                  name="birth_date"
                  type="date"
                  required
                  defaultValue={birthDate}
                  className="mt-2 w-full rounded-[16px] border border-[var(--sendero-line)] bg-black/20 px-3 py-3 text-[var(--sendero-ink)] outline-none transition"
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <PendingActionButton
                pendingLabel="Guardando…"
                className="sendero-button sendero-button-primary disabled:cursor-wait disabled:opacity-60"
              >
                Guardar cambios
              </PendingActionButton>
              <Link href="/student/perfil" className="sendero-button sendero-button-ghost">
                Cancelar
              </Link>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Tu foto, correo y fecha de nacimiento forman parte de la activación de Medallas. Tu
              nombre y teléfono los administra el estudio.
            </p>
          </form>
        ) : null}
      </section>

      <Link
        href="/student/paquete"
        data-profile-block="package"
        className="sendero-surface grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 transition hover:bg-white/[0.04]"
      >
        <div className="min-w-0">
          <p className="sendero-eyebrow">Paquete vigente</p>
          <p className="mt-1 truncate text-base text-[var(--sendero-ink)]">
            {activePackage?.name ?? "Sin paquete activo"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {activePackage
              ? activePackage.unlimited
                ? `Ilimitado · vence ${formatDate(activePackage.expires_on, studio.timezone)}`
                : `${activePackage.available_credits ?? 0} clases disponibles · vence ${formatDate(activePackage.expires_on, studio.timezone)}`
              : "Compra o activa un paquete para reservar clases."}
          </p>
        </div>
        <span aria-hidden="true" className="text-xl text-zinc-600">
          ›
        </span>
      </Link>

      <section data-profile-block="accesses">
        <div className="mb-2">
          <h2 className="text-xl text-[var(--sendero-ink)]">Accesos rápidos</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Todo lo relacionado con tu cuenta, en un solo lugar.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href="/student/paquete"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ◇
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Mi paquete
              </strong>
              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                {activePackage
                  ? activePackage.unlimited
                    ? `Ilimitado · vence ${formatDate(activePackage.expires_on, studio.timezone)}`
                    : `${activePackage.available_credits} clases disponibles`
                  : "Sin paquete activo"}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/recompensas"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ✦
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Rewards
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Medallas, beneficios y recompensas obtenidas
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/evaluaciones"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ◎
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Evaluaciones
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Nivel técnico, próximas evaluaciones y resultados
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/mis-clases"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ≡
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Mis clases
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {snapshot.upcoming.length} próximas
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/movimientos"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ↔
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Movimientos
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">Historial de créditos</span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/pagos"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              $
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Pagos
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">Historial comercial</span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/perfil/notificaciones"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ◉
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Notificaciones
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Elige Push, WhatsApp y correo
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>

          <Link
            href="/student/documentos"
            className="sendero-surface group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04] sm:col-span-2"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              □
            </span>
            <span>
              <strong className="block text-sm font-semibold text-[var(--sendero-ink)]">
                Documentos
              </strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Versiones y aceptación · próxima fase
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
            >
              ›
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
