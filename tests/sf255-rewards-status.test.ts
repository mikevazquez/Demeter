import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const core = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921003000_sf255_reward_status_core.sql"),
  "utf8",
);
const medalOnboarding = readFileSync(
  join(process.cwd(), "supabase/migrations/20260923153500_rewards_medal_onboarding.sql"),
  "utf8",
);
const medalOnboardingPage = readFileSync(
  join(process.cwd(), "app/student/recompensas/RewardOnboardingActivation.tsx"),
  "utf8",
);
const waitlist = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921004500_sf255_waitlist_priority.sql"),
  "utf8",
);
const creditFix = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921005200_sf255_waitlist_credit_fix.sql"),
  "utf8",
);
const reservePage = readFileSync(join(process.cwd(), "app/student/reservar/page.tsx"), "utf8");
const detailPage = readFileSync(
  join(process.cwd(), "app/student/reservar/[sessionId]/page.tsx"),
  "utf8",
);
const classesPage = readFileSync(join(process.cwd(), "app/student/mis-clases/page.tsx"), "utf8");
const waitlistControl = readFileSync(
  join(process.cwd(), "app/student/reservar/WaitlistControl.tsx"),
  "utf8",
);
const homePage = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");
const profilePage = readFileSync(join(process.cwd(), "app/student/perfil/page.tsx"), "utf8");
const adminStudentProfilePage = readFileSync(
  join(process.cwd(), "app/admin/alumnas/[studentId]/page.tsx"),
  "utf8",
);
const studentActions = readFileSync(join(process.cwd(), "app/student/actions.ts"), "utf8");
const invitationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921014500_sf255_guest_invitations.sql"),
  "utf8",
);
const contactConfirmationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921020138_sf255_guest_contact_confirmation.sql"),
  "utf8",
);
const phoneNormalizationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921021023_sf255_guest_phone_normalization.sql"),
  "utf8",
);
const discountMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921013000_sf255_reward_checkout_discounts.sql"),
  "utf8",
);
const reservationDetail = readFileSync(
  join(process.cwd(), "app/student/mis-clases/[reservationId]/page.tsx"),
  "utf8",
);
const cancellationPage = readFileSync(
  join(process.cwd(), "app/student/mis-clases/[reservationId]/cancelar/page.tsx"),
  "utf8",
);
const guestCancellationPage = readFileSync(
  join(
    process.cwd(),
    "app/student/mis-clases/[reservationId]/invitacion/[invitationId]/cancelar/page.tsx",
  ),
  "utf8",
);
const singleClassPurchase = readFileSync(
  join(process.cwd(), "app/student/reservar/PurchaseSingleClassButton.tsx"),
  "utf8",
);
const checkoutReturn = readFileSync(
  join(process.cwd(), "app/student/reservar/checkout/page.tsx"),
  "utf8",
);

describe("SF-255A monthly level and waitlist contracts", () => {
  it("keeps the approved four deterministic levels", () => {
    expect(core).toContain("('bronze', 1, 'Bronce', 4, null::integer, 0, 15, 1, 5, 5, 0)");
    expect(core).toContain("('silver', 2, 'Plata', 6, 8, 2, 10, 2, 10, 10, 0)");
    expect(core).toContain("('gold', 3, 'Oro', 8, 12, 4, 7, 3, 15, 15, 1)");
    expect(core).toContain("('diamond', 4, 'Diamante', 10, 16, 6, 3, 4, 20, 20, 2)");
    expect(core).toContain("maintenance_attendance");
    expect(core).toContain("promotion_attendance");
  });

  it("preserves existing medals but requires activation before Bronze for new students", () => {
    expect(medalOnboarding).toContain("private.reward_medal_onboarding");
    expect(medalOnboarding).toContain("unlock_method in ('onboarding','admin','legacy')");
    expect(medalOnboarding).toContain("documents_completed_at");
    expect(medalOnboarding).toContain("profile_completed_at");
    expect(medalOnboarding).toContain("first_booking_at");
    expect(medalOnboarding).toContain("first_attendance_at");
    expect(medalOnboarding).toContain("private.reward_onboarding_sync_student");
    expect(medalOnboarding).toContain("'source', 'reward_onboarding'");
    expect(medalOnboarding).toContain("'legacy'");
    expect(medalOnboarding).toContain("New students no longer receive Bronze merely for being created");
    expect(medalOnboarding).toContain("insert into private.reward_medal_onboarding (studio_id, student_id)");
  });

  it("keeps core access available before a medal without leaking Bronze benefits", () => {
    expect(medalOnboarding).toContain("'discount_pct',v_pct");
    expect(medalOnboarding).toContain("'total',0,'used',0,'remaining',0");
    expect(medalOnboarding).toContain("coalesce(d.level_order,0) desc");
    expect(medalOnboarding).toContain("'waitlist_priority', coalesce(v_level.waitlist_priority,0)");
  });

  it("uses the approved first-medal activation UI and keeps medal language separate", () => {
    expect(medalOnboardingPage).toContain("Desbloquea tu primera");
    expect(medalOnboardingPage).toContain("Medalla Bronce");
    expect(medalOnboardingPage).toContain("Acepta tus documentos");
    expect(medalOnboardingPage).toContain("Completa tu perfil");
    expect(medalOnboardingPage).toContain("Reserva tu primera clase");
    expect(medalOnboardingPage).toContain("Asiste a tu primera clase");
    expect(medalOnboardingPage).toContain("Medallas y niveles técnicos son cosas distintas");
    expect(adminStudentProfilePage).toContain("Medalla actual");
    expect(adminStudentProfilePage).toContain("Sin medalla");
    expect(adminStudentProfilePage).not.toContain("Nivel general actual");
  });

  it("uses the SF-255 status membership as Profile 360 general level source", () => {
    expect(adminStudentProfilePage).toContain('.from("reward_status_memberships")');
    expect(adminStudentProfilePage).toContain('.from("reward_status_level_definitions")');
    expect(adminStudentProfilePage).toContain('select("current_level_key")');
    expect(adminStudentProfilePage).not.toContain("profileParticipation");
  });

  it("limits monthly movement and preserves the Bronze floor", () => {
    expect(core).toContain("v_to_level := v_next_level");
    expect(core).toContain("elsif v_from_level = 'bronze' then");
    expect(core).toContain("v_outcome := 'floor'");
    expect(core).toContain("v_outcome := 'partial_month'");
  });

  it("orders waitlist by current level and FIFO without public position", () => {
    expect(waitlist).toContain("order by d.level_order desc, w.joined_at asc, w.id asc");
    expect(waitlist).not.toContain("position_number");
    expect(waitlist).not.toContain("rank()");
  });

  it("revalidates eligibility and holds credit on automatic promotion", () => {
    expect(waitlist).toContain("private.waitlist_eligibility_core");
    expect(creditFix).toContain("from public.credit_ledger cl");
    expect(creditFix).toContain("'reserve'");
    expect(creditFix).toContain("'source', 'waitlist'");
  });

  it("uses the approved waitlist copy and visual states", () => {
    expect(reservePage).toContain("student_waitlist_feed");
    expect(detailPage).toContain("WaitlistControl");
    expect(waitlistControl).toContain("Unirme a lista de espera");
    expect(classesPage).toContain("En lista de espera");
    expect(classesPage).toContain("Te avisaremos si se libera un lugar.");
    expect(classesPage).toContain("border-amber-400");
  });

  it("integrates benefits and confirmed technical levels into Home while keeping Profile clean", () => {
    expect(homePage).toContain("student_reward_status_snapshot");
    expect(homePage).toContain("reward_status_memberships");
    expect(homePage).toContain("reward_status_level_definitions");
    expect(homePage).toContain("student_reward_invitation_balance");
    expect(homePage).toContain('data-home-block="identity-benefits-technical"');
    expect(homePage).toContain("Mis beneficios");
    expect(homePage).toContain("Ver mis beneficios");
    expect(homePage).toContain("Niveles técnicos");
    expect(homePage).toContain("resulting_level_title");
    expect(homePage).toContain("#CD7F32");
    expect(homePage).toContain("#C0C0C0");
    expect(homePage).toContain("#D4AF37");
    expect(homePage).toContain("#5EDFFF");
    expect(homePage).toContain("h-28 w-28");
    expect(homePage).toContain("rounded-[24px]");
    expect(homePage).not.toContain("Movimiento que transforma");
    expect(profilePage).toContain('data-profile-block="package"');
    expect(profilePage).not.toContain("student_reward_status_snapshot");
    expect(profilePage).not.toContain("Nivel actual");
    expect(profilePage).not.toContain("Tus beneficios");
  });

  it("uses real capacity reservations for monthly guest invitations without fake students", () => {
    expect(invitationMigration).toContain("guest_person_id uuid");
    expect(invitationMigration).toContain("host_reservation_id uuid");
    expect(invitationMigration).toContain("'reserved',0");
    expect(invitationMigration).toContain("student_create_guest_invitation");
    expect(invitationMigration).toContain("student_cancel_guest_invitation");
    expect(invitationMigration).toContain("cancelled_on_time");
    expect(invitationMigration).toContain("cancelled_late");
    expect(invitationMigration).toContain("no_show");
    expect(invitationMigration).toContain("lifecycle_status text not null default 'trial'");
    expect(invitationMigration).toContain("guest_already_student");
    expect(invitationMigration).not.toContain("insert into public.students(");
  });

  it("shows M03 and M04 inside the existing confirmed reservation detail", () => {
    expect(reservationDetail).toContain("student_reward_invitation_context");
    expect(reservationDetail).toContain("Invitar a alguien");
    expect(reservationDetail).toContain("Tu invitado asistirá a esta misma clase contigo.");
    expect(reservationDetail).toContain("Nombre completo");
    expect(reservationDetail).toContain("Número de teléfono");
    expect(reservationDetail).toContain("Confirmar invitación");
    expect(reservationDetail).toContain("ocupará un lugar real del aforo");
    expect(reservationDetail).not.toContain(
      "Invitación confirmada. Tu invitado ya ocupa un lugar real en esta clase.",
    );
    expect(reservationDetail).not.toContain("Invitación cancelada a tiempo.");
    expect(studentActions).not.toContain("?invited=1");
    expect(studentActions).not.toContain("?guest_cancelled=");
    expect(studentActions).toContain("?invite_error=");
  });

  it("normalizes Mexican guest phones from 10 local digits", () => {
    expect(studentActions).toContain("function normalizeMexicanPhone");
    expect(studentActions).toContain("`+52${digits}`");
    expect(reservationDetail).toContain('pattern="[0-9]{10}"');
    expect(reservationDetail).toContain("minLength={10}");
    expect(reservationDetail).toContain("maxLength={10}");
    expect(reservationDetail).toContain('placeholder="3312345678"');
    expect(reservationDetail).toContain("Agregamos el código de país automáticamente.");
    expect(phoneNormalizationMigration).toContain(
      "right(regexp_replace(pc.value,'[^0-9]','','g'),10)",
    );
    expect(phoneNormalizationMigration).toContain("'^\\+52[0-9]{10}$'");
  });

  it("warns before reusing a phone that belongs to a differently named contact", () => {
    expect(contactConfirmationMigration).toContain("student_guest_invitation_contact_lookup");
    expect(contactConfirmationMigration).toContain("student_guest_invitation_contact_identity");
    expect(contactConfirmationMigration).toContain("student_create_guest_invitation_existing");
    expect(studentActions).toContain("normalizeGuestIdentityName");
    expect(studentActions).toContain("contact_match=");
    expect(reservationDetail).toContain("Contacto encontrado");
    expect(reservationDetail).toContain("Usaremos ese contacto para esta invitación.");
    expect(reservationDetail).toContain(
      "No cambiaremos su nombre ni crearemos un registro duplicado.",
    );
    expect(reservationDetail).toContain("Usar este contacto");
    expect(reservationDetail).toContain("Corregir datos");
  });

  it("warns that cancelling the host reservation also cancels active guest invitations", () => {
    expect(cancellationPage).toContain("student_reward_invitation_context");
    expect(cancellationPage).toContain("También se cancelará");
    expect(cancellationPage).toContain("ya no podrá asistir a esta clase.");
    expect(cancellationPage).toContain("La invitación depende de tu reserva en esta misma clase");
    expect(cancellationPage).toContain("Sí, cancelar mi reserva y la invitación");
  });

  it("routes guest invitation cancellation through a dedicated warning screen", () => {
    expect(reservationDetail).toContain("/invitacion/");
    expect(reservationDetail).toContain("/cancelar");
    expect(guestCancellationPage).toContain("student_cancellation_preview");
    expect(guestCancellationPage).toContain("Estás fuera del horario de cancelación");
    expect(guestCancellationPage).toContain("perderá su lugar en esta clase");
    expect(guestCancellationPage).toContain("la invitación se consumirá. No");
    expect(guestCancellationPage).toContain("regresará a tu saldo de este mes.");
    expect(guestCancellationPage).toContain("Sí, cancelar y consumir invitación");
    expect(guestCancellationPage).toContain("No, mantener invitación");
  });

  it("snapshots the approved level discount into checkout and surfaces M05 pricing", () => {
    expect(discountMigration).toContain("reward_discount_eligible boolean not null default false");
    expect(discountMigration).toContain("regular_amount_minor");
    expect(discountMigration).toContain("reward_discount_pct");
    expect(discountMigration).toContain("reward_level_key_snapshot");
    expect(discountMigration).toContain("private.reward_checkout_price");
    expect(discountMigration).toContain("'private_class'");
    expect(discountMigration).toContain("'workshop'");
    expect(discountMigration).toContain("'masterclass'");
    expect(discountMigration).toContain("'event'");
    expect(singleClassPurchase).toContain("Precio regular");
    expect(singleClassPurchase).toContain("Beneficio");
    expect(singleClassPurchase).toContain("Total para ti");
    expect(checkoutReturn).toContain("Total pagado");
    expect(singleClassPurchase).not.toContain("Abriendo Mercado Pago");
  });
});
