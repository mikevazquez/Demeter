import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const core = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921003000_sf255_reward_status_core.sql"),
  "utf8",
);
const waitlist = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921004500_sf255_waitlist_priority.sql"),
  "utf8",
);
const monthlyMedals = readFileSync(
  join(process.cwd(), "supabase/migrations/20260923222500_rewards_monthly_medals.sql"),
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
  it("keeps the four Medals but supersedes the old ladder with monthly requirements", () => {
    expect(core).toContain("level_key in ('bronze','silver','gold','diamond')");
    expect(monthlyMedals).toContain("required_active_days");
    expect(monthlyMedals).toContain("max_no_shows");
    expect(monthlyMedals).toContain("min_continuity_months");
    expect(monthlyMedals).toContain("max_renewal_gap_days");
    expect(monthlyMedals).toContain("when 'bronze' then 6");
    expect(monthlyMedals).toContain("when 'silver' then 9");
    expect(monthlyMedals).toContain("when 'gold' then 12");
    expect(monthlyMedals).toContain("when 'diamond' then 16");
  });

  it("uses onboarding as access and permits an activated student to have no Medal", () => {
    expect(monthlyMedals).toContain("alter column current_level_key drop not null");
    expect(monthlyMedals).toContain("access_unlocked_at");
    expect(monthlyMedals).toContain("current_level_key = null");
    expect(monthlyMedals).toContain("'no_medal'");
  });

  it("uses the SF-255 status membership as Profile 360 general level source", () => {
    expect(adminStudentProfilePage).toContain('.from("reward_status_memberships")');
    expect(adminStudentProfilePage).toContain('.from("reward_status_level_definitions")');
    expect(adminStudentProfilePage).toContain('select("current_level_key")');
    expect(adminStudentProfilePage).not.toContain("profileParticipation");
  });

  it("assigns the highest eligible Medal directly instead of moving one step at a time", () => {
    expect(monthlyMedals).toContain("order by d.level_order desc");
    expect(monthlyMedals).toContain("v_to_level := nullif(v_metrics->>'eligible_level_key','')");
    expect(monthlyMedals).toContain(
      "case when v_to_level is null then 'no_medal' else 'awarded' end",
    );
    expect(monthlyMedals).not.toContain("v_to_level := v_next_level");
  });

  it("orders waitlist by current Medal and FIFO while keeping no-Medal students eligible", () => {
    expect(waitlist).toContain("order by d.level_order desc, w.joined_at asc, w.id asc");
    expect(monthlyMedals).toContain("left join public.reward_status_memberships");
    expect(monthlyMedals).toContain("coalesce(d.level_order,0) desc");
    expect(waitlist).not.toContain("position_number");
    expect(waitlist).not.toContain("rank()");
  });

  it("revalidates eligibility and holds credit on automatic promotion", () => {
    expect(waitlist).toContain("private.waitlist_eligibility_core");
    expect(creditFix).toContain("from public.credit_ledger cl");
    expect(creditFix).toContain("'reserve'");
    expect(creditFix).toContain("'source', 'waitlist'");
  });

  it("uses the approved waitlist copy without exposing Medal ranking mechanics", () => {
    expect(reservePage).toContain("student_waitlist_feed");
    expect(detailPage).toContain("WaitlistControl");
    expect(waitlistControl).toContain("Unirme a lista de espera");
    expect(waitlistControl).toContain("Te avisaremos si se libera un lugar.");
    expect(waitlistControl).not.toContain("levelTitle");
    expect(classesPage).toContain("En lista de espera");
    expect(classesPage).toContain("Te avisaremos si se libera un lugar.");
    expect(classesPage).toContain("border-amber-400");
  });

  it("keeps Medals and confirmed technical levels separate on Home while Profile stays clean", () => {
    expect(homePage).toContain("student_reward_status_snapshot");
    expect(homePage).toContain("reward_status_memberships");
    expect(homePage).toContain("reward_status_level_definitions");
    expect(homePage).toContain('data-home-block="technical-level"');
    expect(homePage).toContain('data-home-block="medal"');
    expect(homePage).toContain("Tu medalla");
    expect(homePage).toContain("Activa tus Medallas");
    expect(homePage).toContain("Ver medallas y beneficios");
    expect(homePage).toContain("Sin medalla este mes");
    expect(homePage).toContain("Ver Medallero");
    expect(homePage).toContain("Nivel técnico");
    expect(homePage).toContain("resulting_level_title");
    expect(homePage).toContain("#CD7F32");
    expect(homePage).toContain("#C0C0C0");
    expect(homePage).toContain("#D4AF37");
    expect(homePage).toContain("#5EDFFF");
    expect(homePage).not.toContain("Movimiento que transforma");
    expect(profilePage).toContain('href="/student/paquete"');
    expect(profilePage).toContain('title="Mi paquete"');
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
