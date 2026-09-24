import Image from "next/image";
import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import { updateStudentAvatarAction, updateStudentProfileAction } from "../actions";
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

function ProfileRow({
  href,
  title,
  subtitle,
  dataBlock,
}: {
  href: string;
  title: string;
  subtitle: string;
  dataBlock?: string;
}) {
  return (
    <Link
      href={href}
      data-profile-block={dataBlock}
      className="group grid min-h-16 grid-cols-[1fr_auto] items-center gap-4 px-4 py-3.5 transition hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
    >
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-white">{title}</strong>
        <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{subtitle}</span>
      </span>
      <span
        aria-hidden="true"
        className="text-xl text-zinc-600 transition group-hover:text-fuchsia-300"
      >
        ›
      </span>
    </Link>
  );
}

function ProfileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {title}
      </h2>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
        {children}
      </div>
    </section>
  );
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
  const query = await searchParams;
  const { snapshot, studio, supabase } = await getStudentPortalContext();
  const activePackage =
    snapshot.acquisitions.find((item) => item.active_now && !item.reward_credit_wallet) ?? null;
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

  const packageSummary = activePackage
    ? activePackage.unlimited
      ? `Ilimitado · vence ${formatDate(activePackage.expires_on, studio.timezone)}`
      : `${activePackage.available_credits ?? 0} clases disponibles · vence ${formatDate(
          activePackage.expires_on,
          studio.timezone,
        )}`
    : "Sin paquete activo";

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="student-eyebrow">Perfil</p>
        <h1 className="student-page-title mt-1">Mi cuenta</h1>
        <p className="student-body mt-2">
          Tus datos, entrenamiento, medallas y membresía en un solo lugar.
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

      <section data-profile-block="identity" className="student-card overflow-hidden p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/35 bg-fuchsia-500/10 text-xl font-semibold text-white">
            {initials}
            <Image src="/student/perfil/avatar" alt="" fill unoptimized className="object-cover" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{fullName}</h2>
            <p className="mt-1 text-sm text-zinc-400">Alumna de Demeter</p>
            {!editingProfile ? (
              <Link
                href="/student/perfil?edit=1"
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/[0.06] px-4 py-2.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/[0.1]"
              >
                Editar mis datos
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {editingProfile ? (
        <section className="student-card overflow-hidden">
          <div className="border-b border-white/10 p-5 sm:p-6">
            <p className="student-eyebrow">Mis datos</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Edita tu información</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Puedes cambiar tu foto, correo y fecha de nacimiento.
            </p>
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <h3 className="text-sm font-semibold text-white">Foto de perfil</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Selecciona una imagen, revisa la vista previa y confírmala.
              </p>
              <form action={updateStudentAvatarAction} className="mt-3">
                <AvatarFilePicker initials={initials} />
                <PendingActionButton
                  pendingLabel="Guardando foto…"
                  className="student-action-primary mt-3 w-full sm:w-auto"
                >
                  Usar esta foto
                </PendingActionButton>
              </form>
            </div>

            <div className="border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold text-white">Datos administrados por Demeter</h3>
              <dl className="mt-3 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
                  <dt className="text-xs text-zinc-500">Nombre</dt>
                  <dd className="text-sm text-white">{snapshot.profile.first_name}</dd>
                </div>
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
                  <dt className="text-xs text-zinc-500">Apellidos</dt>
                  <dd className="text-sm text-white">{snapshot.profile.last_name || "—"}</dd>
                </div>
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
                  <dt className="text-xs text-zinc-500">Teléfono</dt>
                  <dd className="text-sm text-white">{snapshot.profile.phone}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Si necesitas corregir tu nombre o teléfono, ponte en contacto con Demeter.
              </p>
            </div>

            <form action={updateStudentProfileAction} className="border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold text-white">Datos que puedes cambiar</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block min-w-0 text-sm text-zinc-300">
                  Correo electrónico
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={snapshot.profile.email ?? ""}
                    autoComplete="email"
                    className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/15"
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
                    className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-white outline-none transition focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/15"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <PendingActionButton
                  pendingLabel="Guardando…"
                  className="student-action-primary w-full sm:w-auto"
                >
                  Guardar cambios
                </PendingActionButton>
                <Link href="/student/perfil" className="student-action-secondary w-full sm:w-auto">
                  Cancelar
                </Link>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      <ProfileGroup title="Mi cuenta">
        <ProfileRow
          href="/student/perfil?edit=1"
          title="Mis datos"
          subtitle="Foto, correo, fecha de nacimiento y datos de contacto"
        />
        <ProfileRow
          href="/student/perfil/notificaciones"
          title="Notificaciones"
          subtitle="Elige cómo quieres recibir los avisos de Demeter"
        />
        <ProfileRow
          href="/student/documentos"
          title="Documentos"
          subtitle="Reglamentos, responsivas y aceptaciones"
        />
      </ProfileGroup>

      <ProfileGroup title="Mi entrenamiento">
        <ProfileRow
          href="/student/evaluaciones"
          title="Nivel técnico y evaluaciones"
          subtitle="Consulta tu nivel por disciplina, evaluaciones y resultados"
        />
      </ProfileGroup>

      <ProfileGroup title="Medallas y beneficios">
        <ProfileRow
          href="/student/recompensas"
          title="Mi medalla y beneficios"
          subtitle="Tu medalla actual y los beneficios disponibles"
        />
        <ProfileRow
          href="/student/retos"
          title="Retos"
          subtitle="Objetivos temporales y competencias"
        />
        <ProfileRow
          href="/student/recompensas/logros"
          title="Logros"
          subtitle="Consulta los logros que has conseguido"
        />
        <ProfileRow
          href="/student/recompensas/mis-recompensas"
          title="Recompensas"
          subtitle="Premios que has ganado y puedes utilizar"
        />
      </ProfileGroup>

      <ProfileGroup title="Mi membresía">
        <ProfileRow
          href="/student/paquete"
          title="Mi paquete"
          subtitle={packageSummary}
          dataBlock="package"
        />
        <ProfileRow
          href="/student/movimientos"
          title="Uso de mis clases"
          subtitle="Consulta cómo has utilizado y recuperado tus clases"
        />
        <ProfileRow href="/student/pagos" title="Mis pagos" subtitle="Compras y reembolsos" />
      </ProfileGroup>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-semibold text-white">Cuenta</h2>
        <form action={signOut} className="mt-3">
          <PendingActionButton
            pendingLabel="Cerrando sesión…"
            className="student-action-secondary w-full sm:w-auto"
          >
            Cerrar sesión
          </PendingActionButton>
        </form>
      </section>
    </main>
  );
}
