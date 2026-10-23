import PendingActionButton from "@/app/admin/components/PendingActionButton";
import StudentEvaluationsPanel from "../StudentEvaluationsPanel";
import { unlockMedalsAccess } from "../actions";
import { formatDateTime, rewardBenefitLabel, rewardStatusLabel } from "../profile-format";
import type { Profile360Model } from "../load-profile-360";

export default function ProgressTab({ model }: { model: Profile360Model }) {
  const {
    query,
    student,
    canReadRewards,
    canManageRewards,
    canReadEvaluations,
    timeZone,
    locale,
    currency,
    levelTitle,
    rewardOnboarding,
    rewardsAvailable,
    technicalLevels,
    rewardAchievements,
    rewardLevelHistory,
    rewardInstancesDetail,
  } = model;

  return (
    <div className="p360v2-stack">
      <section className="crm-card">
        <p className="eyebrow">NIVEL TÉCNICO</p>
        <h2>Nivel por disciplina</h2>
        {canReadEvaluations && technicalLevels.length ? (
          <div className="p360v2-levels">
            {technicalLevels.map((item) => (
              <div key={item.disciplineName} className="p360v2-level">
                <span>{item.disciplineName}</span>
                <strong>{item.levelTitle}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="crm-meta">Sin nivel asignado. Se define en su evaluación diagnóstica.</p>
        )}
      </section>
      {canReadEvaluations ? (
        <div id="evaluaciones" className="scroll-mt-6">
          <StudentEvaluationsPanel
            studentId={student.id}
            timeZone={timeZone}
            locale={locale}
            error={query.evaluation_error}
          />
        </div>
      ) : null}
      {canReadRewards ? (
        <section id="medallas" className="profile360-view-panel scroll-mt-6">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">PROGRESO</p>
              <h2>Medallas, logros y recompensas</h2>
              <p>
                Las medallas representan progreso y beneficios de Rewards; son independientes de los
                niveles técnicos por disciplina.
              </p>
            </div>
          </div>

          {rewardOnboarding ? (
            <div className="mb-5 rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">ACTIVACIÓN DE MEDALLAS</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    {rewardOnboarding.accessUnlockedAt
                      ? "Acceso a Medallas habilitado"
                      : "Activando Medallas"}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {
                      [
                        rewardOnboarding.documentsCompletedAt,
                        rewardOnboarding.profileCompletedAt,
                        rewardOnboarding.appInstalledAt,
                        rewardOnboarding.notificationsEnabledAt,
                        rewardOnboarding.firstReservationAt,
                        rewardOnboarding.firstAttendanceAt,
                      ].filter(Boolean).length
                    }{" "}
                    de 6 pasos completados
                  </p>
                </div>
                <span className="status-pill">
                  {rewardOnboarding.accessUnlockedAt ? "Acceso activo" : "En activación"}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  ["Documentos", rewardOnboarding.documentsCompletedAt],
                  ["Perfil", rewardOnboarding.profileCompletedAt],
                  ["App instalada", rewardOnboarding.appInstalledAt],
                  ["Notificaciones Push", rewardOnboarding.notificationsEnabledAt],
                  ["Primera reserva", rewardOnboarding.firstReservationAt],
                  ["Primera asistencia", rewardOnboarding.firstAttendanceAt],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3"
                  >
                    <span className="text-sm font-medium text-white">{label}</span>
                    <span className={value ? "text-xs text-emerald-300" : "text-xs text-zinc-500"}>
                      {value ? "✓ " + formatDateTime(String(value), timeZone, locale) : "Pendiente"}
                    </span>
                  </div>
                ))}
              </div>

              {rewardOnboarding.accessUnlockedAt ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Acceso habilitado por{" "}
                  {rewardOnboarding.accessMethod === "admin"
                    ? "excepción administrativa"
                    : rewardOnboarding.accessMethod === "legacy"
                      ? "migración del sistema anterior"
                      : "onboarding"}
                  {rewardOnboarding.accessReason ? " · " + rewardOnboarding.accessReason : ""}
                </p>
              ) : canManageRewards ? (
                <form
                  action={unlockMedalsAccess}
                  className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3.5"
                >
                  <input type="hidden" name="student_id" value={student.id} />
                  <label className="block text-xs font-medium text-zinc-300">
                    Habilitar acceso a Medallas manualmente
                    <textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Motivo de la excepción"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-500/50"
                    />
                  </label>
                  <PendingActionButton
                    pendingLabel="Habilitando…"
                    className="mt-3 min-h-10 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/[0.08] px-4 text-xs font-semibold text-fuchsia-200"
                  >
                    Habilitar acceso a Medallas
                  </PendingActionButton>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Esta acción es excepcional y queda registrada con motivo y administrador.
                  </p>
                </form>
              ) : null}
            </div>
          ) : null}

          <div className="profile360-approved-indicators">
            <article>
              <span>Medalla actual</span>
              <strong>
                {levelTitle
                  ? "Medalla " + levelTitle
                  : rewardOnboarding?.accessUnlockedAt
                    ? "Sin medalla"
                    : "En activación"}
              </strong>
            </article>
            <article>
              <span>Recompensas disponibles</span>
              <strong>{rewardsAvailable ?? 0}</strong>
            </article>
            <article>
              <span>Logros obtenidos</span>
              <strong>{rewardAchievements.length}</strong>
            </article>
            <article>
              <span>Ciclos con Medalla</span>
              <strong>{rewardLevelHistory.length}</strong>
            </article>
          </div>

          <div className="profile360-rewards-section">
            <div className="profile360-package-group-heading">
              <strong>Recompensas</strong>
              <span>{rewardInstancesDetail.length}</span>
            </div>
            {rewardInstancesDetail.length ? (
              <div className="profile360-reward-list">
                {rewardInstancesDetail.map((reward) => (
                  <article key={reward.id}>
                    <div>
                      <strong>
                        {rewardBenefitLabel(
                          reward.kind,
                          reward.benefitDefinition,
                          locale,
                          currency,
                        )}
                      </strong>
                      <span>
                        {reward.expiresAt
                          ? "Vence " + formatDateTime(reward.expiresAt, timeZone, locale)
                          : "Sin vencimiento registrado"}
                      </span>
                    </div>
                    <span className="status-pill">{rewardStatusLabel(reward.status)}</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">No hay recompensas registradas.</div>
            )}
          </div>

          <div className="profile360-rewards-section">
            <div className="profile360-package-group-heading">
              <strong>Logros</strong>
              <span>{rewardAchievements.length}</span>
            </div>
            {rewardAchievements.length ? (
              <div className="profile360-history-list">
                {rewardAchievements.map((achievement) => (
                  <article key={achievement.id}>
                    <div className="profile360-history-dot is-reward" aria-hidden="true" />
                    <div>
                      <strong>{achievement.title}</strong>
                      <span>{formatDateTime(achievement.unlockedAt, timeZone, locale)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">Todavía no hay logros desbloqueados.</div>
            )}
          </div>

          {rewardLevelHistory.length ? (
            <div className="profile360-rewards-section">
              <div className="profile360-package-group-heading">
                <strong>Historial de Medallas</strong>
                <span>{rewardLevelHistory.length}</span>
              </div>
              <div className="profile360-history-list">
                {rewardLevelHistory.map((level) => (
                  <article key={level.id}>
                    <div className="profile360-history-dot is-level" aria-hidden="true" />
                    <div>
                      <strong>{level.title}</strong>
                      <span>
                        Medalla {level.title} · {formatDateTime(level.unlockedAt, timeZone, locale)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
