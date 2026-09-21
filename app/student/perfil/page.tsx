import Image from "next/image";
import Link from "next/link";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import { updateStudentAvatarAction, updateStudentProfileAction } from "../actions";
import PendingActionButton from "../components/PendingActionButton";
import StudentNoticeDialog from "../components/StudentNoticeDialog";

type RewardLevelView = {
  key?: string;
  title?: string;
  maintenance_attendance?: number;
  promotion_attendance?: number;
  min_active_months?: number;
  max_uncovered_days?: number;
  waitlist_priority?: number;
  private_discount_pct?: number;
  event_discount_pct?: number;
  monthly_guest_invites?: number;
};

type RewardLevelDefinitionRow = RewardLevelView & {
  level_key: string;
  level_order: number;
};

type RewardStatusSnapshot = {
  level_title?: string | null;
  attendance_count?: number;
  active_months?: number;
  max_uncovered_days?: number;
  maintenance_met?: boolean;
  promotion_met?: boolean;
  period_end?: string;
  current_level?: RewardLevelView | null;
  next_level?: RewardLevelView | null;
};

const errorCopy: Record<string, string> = {
  email_invalid: "Revisa el formato de tu correo.",
  profile_update_failed: "No pudimos guardar los cambios. Intenta de nuevo.",
  forbidden: "Tu cuenta no tiene permiso para editar estos datos.",
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
    benefits?: string;
  }>;
}) {
  const query = await searchParams;
  const { snapshot, studio, supabase, membership } = await getStudentPortalContext();
  const [rewardStatusResult, rewardMembershipResult, rewardLevelsResult] = await Promise.all([
    supabase.rpc("student_reward_status_snapshot"),
    supabase
      .from("reward_status_memberships")
      .select("current_level_key")
      .eq("studio_id", membership.studio_id)
      .eq("student_id", snapshot.profile.student_id)
      .maybeSingle(),
    supabase
      .from("reward_status_level_definitions")
      .select(
        "level_key,level_order,title,maintenance_attendance,promotion_attendance,min_active_months,max_uncovered_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites",
      )
      .eq("studio_id", membership.studio_id)
      .order("level_order"),
  ]);

  const rewardStatus = (rewardStatusResult.data as RewardStatusSnapshot | null) ?? null;
  const levelDefinitions = (rewardLevelsResult.data ?? []) as RewardLevelDefinitionRow[];
  const fallbackLevelKey = rewardMembershipResult.data?.current_level_key ?? null;
  const fallbackLevelRow =
    levelDefinitions.find((level) => level.level_key === fallbackLevelKey) ?? null;
  const fallbackNextRow = fallbackLevelRow
    ? levelDefinitions.find((level) => level.level_order === fallbackLevelRow.level_order + 1) ?? null
    : null;
  const toLevelView = (row: RewardLevelDefinitionRow | null): RewardLevelView | null =>
    row
      ? {
          key: row.level_key,
          title: row.title,
          maintenance_attendance: row.maintenance_attendance,
          promotion_attendance: row.promotion_attendance,
          min_active_months: row.min_active_months,
          max_uncovered_days: row.max_uncovered_days,
          waitlist_priority: row.waitlist_priority,
          private_discount_pct: row.private_discount_pct,
          event_discount_pct: row.event_discount_pct,
          monthly_guest_invites: row.monthly_guest_invites,
        }
      : null;
  const currentLevel = rewardStatus?.current_level ?? toLevelView(fallbackLevelRow);
  const nextLevel = rewardStatus?.next_level ?? toLevelView(fallbackNextRow);
  const attendanceCount =
    rewardStatus?.attendance_count ?? snapshot.stats.attended_this_month ?? 0;
  const maintenanceTarget = currentLevel?.maintenance_attendance ?? 0;
  const promotionTarget = nextLevel?.promotion_attendance ?? 0;
  const maintenanceProgress = maintenanceTarget
    ? Math.min(100, Math.round((attendanceCount / maintenanceTarget) * 100))
    : 100;
  const promotionProgress = promotionTarget
    ? Math.min(100, Math.round((attendanceCount / promotionTarget) * 100))
    : 100;
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const fullName = [snapshot.profile.first_name, snapshot.profile.last_name]
    .filter(Boolean)
    .join(" ");
  const initials = profileInitials(snapshot.profile.first_name, snapshot.profile.last_name);
  const editingEmail = query.edit === "1" || Boolean(query.error);

  return (
    <main className="space-y-4 pb-4 sm:space-y-5">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Perfil
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mi cuenta
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
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
          title="Tu correo está actualizado"
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

      {query.benefits === "1" && currentLevel ? (
        <StudentNoticeDialog
          eyebrow={`Nivel ${currentLevel.title ?? rewardStatus?.level_title ?? ""}`}
          title="Tus beneficios"
          dismissHref="/student/perfil"
          confirmLabel="Cerrar"
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <p className="font-semibold text-white">Beneficios activos este mes</p>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                <p>
                  Lista de espera ·{" "}
                  {currentLevel.title === "Bronce"
                    ? "prioridad base"
                    : `prioridad ${currentLevel.title}`}
                </p>
                <p>Clases privadas · {currentLevel.private_discount_pct ?? 0}% de descuento</p>
                <p>Eventos elegibles · {currentLevel.event_discount_pct ?? 0}% de descuento</p>
                <p>
                  Invitaciones ·{" "}
                  {(currentLevel.monthly_guest_invites ?? 0) > 0
                    ? `${currentLevel.monthly_guest_invites} al mes`
                    : "sin invitaciones"}
                </p>
              </div>
            </div>
            {nextLevel ? (
              <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
                  Siguiente nivel · {nextLevel.title}
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  {nextLevel.private_discount_pct}% en privadas · {nextLevel.event_discount_pct}% en
                  eventos
                  {(nextLevel.monthly_guest_invites ?? 0) > 0
                    ? ` · ${nextLevel.monthly_guest_invites} invitación${nextLevel.monthly_guest_invites === 1 ? "" : "es"} al mes`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                Nivel máximo. Mantén tu constancia para conservar Diamante.
              </p>
            )}
          </div>
        </StudentNoticeDialog>
      ) : null}

      <section
        data-profile-block="identity"
        className="overflow-hidden rounded-3xl border border-fuchsia-500/15 bg-[radial-gradient(circle_at_18%_0%,rgba(236,72,153,0.15),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))]"
      >
        <div className="border-b border-white/10 p-5 sm:p-6">
          <div className="grid grid-cols-[auto_1fr] items-center gap-4 sm:grid-cols-[auto_1fr_auto]">
            <div className="shrink-0">
              <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-500/70 to-fuchsia-950 text-xl font-semibold text-white shadow-[0_0_28px_rgba(236,72,153,0.22)] sm:h-20 sm:w-20 sm:text-2xl">
                {initials}
                <Image
                  src="/student/perfil/avatar"
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <form action={updateStudentAvatarAction} className="mt-2 space-y-1.5">
                <input
                  name="avatar"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  className="block w-24 text-[9px] text-zinc-500 file:mr-1 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-[9px] file:font-semibold file:text-zinc-200"
                />
                <PendingActionButton
                  pendingLabel="Guardando…"
                  className="min-h-8 w-full rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-fuchsia-500/35 hover:text-white disabled:cursor-wait disabled:opacity-60"
                >
                  Guardar foto
                </PendingActionButton>
              </form>
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{fullName}</h2>
              <p className="mt-1 text-sm text-zinc-400">Alumna · {studio.name}</p>
            </div>
            {currentLevel ? (
              <div className="col-span-2 rounded-2xl border border-fuchsia-500/20 bg-black/25 p-3 sm:col-span-1 sm:w-64">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Nivel actual
                    </p>
                    <p className="mt-0.5 text-base font-semibold text-white">
                      {currentLevel.title}
                    </p>
                  </div>
                  <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
                    {attendanceCount}/{maintenanceTarget} asistencias
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-fuchsia-500"
                    style={{ width: `${maintenanceProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-[10px] leading-4 text-zinc-500">
                  {rewardStatus?.maintenance_met
                    ? "Mantenimiento cumplido este mes."
                    : `Te faltan ${Math.max(maintenanceTarget - attendanceCount, 0)} asistencias para mantener ${currentLevel.title}.`}
                </p>
                {nextLevel ? (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-zinc-500">Hacia {nextLevel.title}</span>
                      <span className="font-semibold text-zinc-300">
                        {attendanceCount}/{promotionTarget}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-fuchsia-500/70"
                        style={{ width: `${promotionProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] font-semibold text-zinc-400">Nivel máximo</p>
                )}
                <Link
                  href="/student/perfil?benefits=1"
                  className="mt-3 inline-flex text-[11px] font-semibold text-fuchsia-300"
                >
                  Tus beneficios →
                </Link>
              </div>
            ) : null}
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
            {!editingEmail ? (
              <Link
                href="/student/perfil?edit=1"
                className="inline-flex min-h-9 w-fit items-center justify-center rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/[0.08] px-3 py-2 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/[0.14]"
              >
                Editar correo
              </Link>
            ) : null}
          </div>
        </div>

        {editingEmail ? (
          <form
            action={updateStudentProfileAction}
            className="border-t border-fuchsia-500/15 bg-black/20 p-5 sm:p-6"
          >
            <div className="sm:flex sm:items-end sm:gap-3">
              <label className="block min-w-0 flex-1 text-sm text-zinc-300">
                Correo electrónico
                <input
                  name="email"
                  type="email"
                  defaultValue={snapshot.profile.email ?? ""}
                  autoComplete="email"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-500/60 focus:ring-2 focus:ring-fuchsia-500/15"
                  placeholder="tu@correo.com"
                />
              </label>
              <div className="mt-3 flex gap-2 sm:mt-0">
                <PendingActionButton
                  pendingLabel="Guardando…"
                  className="min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
                >
                  Guardar cambios
                </PendingActionButton>
                <Link
                  href="/student/perfil"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                >
                  Cancelar
                </Link>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Tu nombre y teléfono forman parte de tu expediente y los administra el estudio.
            </p>
          </form>
        ) : null}
      </section>

      <Link
        href="/student/paquete"
        data-profile-block="package"
        className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05]"
      >
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Paquete vigente
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
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
          <h2 className="text-lg font-semibold text-white">Accesos rápidos</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Todo lo relacionado con tu cuenta, en un solo lugar.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href="/student/paquete"
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              ◇
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-semibold text-white">Mi paquete</strong>
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
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.055] px-4 py-3 transition hover:border-fuchsia-400/35 hover:bg-fuchsia-500/[0.08]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              ✦
            </span>
            <span>
              <strong className="block text-sm font-semibold text-white">Mi progreso</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Programas, retos, logros y recompensas
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
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              ≡
            </span>
            <span>
              <strong className="block text-sm font-semibold text-white">Mis clases</strong>
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
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              ↔
            </span>
            <span>
              <strong className="block text-sm font-semibold text-white">Movimientos</strong>
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
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              $
            </span>
            <span>
              <strong className="block text-sm font-semibold text-white">Pagos</strong>
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
            href="/student/documentos"
            className="group grid min-h-24 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-fuchsia-500/25 hover:bg-white/[0.05] sm:col-span-2"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/10 text-lg text-fuchsia-300"
            >
              □
            </span>
            <span>
              <strong className="block text-sm font-semibold text-white">Documentos</strong>
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
