        .from("product_acquisitions")
        .select("id,product_template_id,expires_on,unlimited")
        .in("id", acquisitionIds)
    : {
        data: [] as {
          id: string;
          product_template_id: string;
          expires_on: string | null;
          unlimited: boolean;
        }[],
      };

  const productIds = [...new Set((acquisitions ?? []).map((item) => item.product_template_id))];
  const { data: products } = productIds.length
    ? await supabase.from("product_templates").select("id,name").in("id", productIds)
    : { data: [] as { id: string; name: string }[] };

  const balances = await Promise.all(
    (acquisitions ?? []).map(async (acquisition) => {
      if (acquisition.unlimited) return [acquisition.id, null] as const;
      const { data } = await supabase.rpc("acquisition_credit_balance", {
        target_acquisition_id: acquisition.id,
      });
      return [acquisition.id, typeof data === "number" ? data : 0] as const;
    }),
  );

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const personMap = new Map(
    (persons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Persona",
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((instructor) => [
      instructor.id,
      personMap.get(instructor.person_id) ?? "Instructor",
    ]),
  );
  const spaceMap = new Map((spaces ?? []).map((space) => [space.id, space.name]));
  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map(balances);

  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const classes: TodayClassItem[] = [];

  for (const session of selectedSessions ?? []) {
    const sessionReservations = reservationsBySession.get(session.id) ?? [];
    const bookedIds = new Set(
      sessionReservations.map((reservation) => reservation.student_id).filter(Boolean),
    );
    const candidates = (students ?? []).filter((student) => !bookedIds.has(student.id));
    const eligibilityEntries = canWriteSchedule
      ? await Promise.all(
          candidates.map(async (student) => {
            const { data } = await supabase.rpc("booking_eligibility", {
              target_session_id: session.id,
              target_student_id: student.id,
            });
            return [student.id, (data ?? {}) as EligibilityResult] as const;
          }),
        )
      : [];
    const eligibilityMap = new Map(eligibilityEntries);
    const template = templateMap.get(session.template_id);
    const occupied = sessionReservations.filter((reservation) =>
      occupyingReservationStatuses.has(reservation.status),
    ).length;

    classes.push({
      id: session.id,
      time: formatTime(session.starts_at, timeZone, locale),
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      name: template?.name ?? "Clase",
      instructor: session.instructor_id
        ? (instructorMap.get(session.instructor_id) ?? "Instructor")
        : "Sin instructor",
      space: session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio",
      occupied,
      capacity: session.capacity,
      color: template?.color_hex ?? "#FF0A8A",
      sessionStatus: session.status,
      available: Math.max(session.capacity - occupied, 0),
      evaluationCount: sessionReservations.filter((reservation) =>
        evaluationByReservation.has(reservation.id),
      ).length,
      returnTo: `/admin?date=${selectedKey}#session-${session.id}`,
      minimumReservationsEnabled: session.minimum_reservations_enabled ?? false,
      minimumReservations: session.minimum_reservations ?? 2,
      minimumReviewStatus: session.minimum_review_status ?? "not_required",
      roster: sessionReservations.map((reservation) => {
        const isGuest = Boolean(reservation.guest_person_id);
        const acquisition = reservation.acquisition_id
          ? acquisitionMap.get(reservation.acquisition_id)
          : null;
        const balance = reservation.acquisition_id
          ? balanceMap.get(reservation.acquisition_id)
          : null;

        const evaluationInvitation = evaluationByReservation.get(reservation.id);
        const attendanceCheckin = checkinByReservation.get(reservation.id);

        return {
          id: reservation.id,
          studentName: isGuest
            ? (personMap.get(reservation.guest_person_id!) ?? "Invitado")
            : reservation.student_id
              ? (studentMap.get(reservation.student_id) ?? "Alumna")
              : "Alumna",
          status: reservation.status,
          packageLabel: isGuest
            ? "Invitación"
            : acquisition
              ? (productMap.get(acquisition.product_template_id) ?? "Producto activo")
              : "Sin producto vinculado",
          creditsLabel: isGuest
            ? "Beneficio por nivel"
            : acquisition?.unlimited
              ? "Ilimitado"
              : acquisition
                ? `${balance ?? 0} créditos`
                : "—",
          expiresLabel: isGuest ? "Misma clase" : formatExpiry(acquisition?.expires_on ?? null, locale),
          studentId: reservation.student_id,
          evaluationInvitationId: evaluationInvitation?.id ?? null,
          evaluationStatus: evaluationInvitation?.status ?? null,
          attendanceSource: attendanceCheckin?.source ?? null,
          checkedInAt: attendanceCheckin?.checked_in_at ?? null,
          attendanceProvenance:
            session.status === "completed" &&
            new Date(reservation.booked_at).getTime() >= new Date(session.ends_at).getTime()
              ? "Agregada manualmente después del cierre"
              : null,
        };
      }),
      candidates: candidates.map((student) => {
        const eligibility = eligibilityMap.get(student.id);
        const reason = eligibility?.reason_code
          ? (eligibilityCopy[eligibility.reason_code] ?? "no elegible")
          : "no elegible";
        return {
          id: student.id,
          fullName: student.full_name,
          eligible: eligibility?.eligible === true,
          detail: eligibility?.eligible
            ? eligibility.unlimited
              ? "membresía ilimitada"
              : `${eligibility.available_credits ?? 0} créditos`
            : reason,
        };
      }),
    });
  }

  const totalDailyCapacity = classes.reduce((sum, item) => sum + item.capacity, 0);
  const totalDailyReservations = classes.reduce((sum, item) => sum + item.occupied, 0);
  const dailyReservationPercentage =
    totalDailyCapacity > 0 ? Math.round((totalDailyReservations / totalDailyCapacity) * 100) : 0;

  const visibleSales = (salesToday ?? []).filter((sale) => sale.status !== "voided");
  const salesTotalMinor = visibleSales.reduce((sum, sale) => sum + (sale.total_minor ?? 0), 0);
  const salesTotal = new Intl.NumberFormat(studio.locale, {
    style: "currency",
    currency: studio.currency,
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  return (
    <main className="dashboard-shell hoy-dashboard hoy-approved hoy-v2">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark" aria-label="Studio Flow">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>MOVIMIENTO QUE TRANSFORMA</small>
        </div>
        <div className="flex items-center gap-2">
          {canWriteAttendance ? (
            <Link
              href="/admin/kiosco"
              className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-3.5 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/[0.14]"
            >
              Check-in
            </Link>
          ) : null}
          <span className="hoy-product-avatar" aria-label={headerName}>
            {headerInitials}
          </span>
        </div>
      </header>

      <header className="hoy-title-block">
        <div>
          <span className="hoy-eyebrow">{selectedKey === todayKey ? "Hoy" : "Agenda"}</span>
          <h1>{selectedDayLabel(selectedDate, selectedKey === todayKey, locale)}</h1>
        </div>
        <div className="hoy-day-summary" aria-label="Resumen del día">
          <strong>{selectedSessions?.length ?? 0}</strong><span>clases</span>
          <i aria-hidden="true" />
          <strong>{totalDailyReservations}</strong><span>reservas</span>
        </div>
      </header>

      {params.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(params.error)}
        </div>
      ) : null}

      <section className="hoy-week-card" aria-label="Calendario semanal">
        <div className="hoy-week-heading">
          <Link href={`/admin?date=${previousWeekKey}`} aria-label="Semana anterior">
            ‹
          </Link>
          <strong>
            {weekStart.getUTCDate()} {shortMonth(weekStart, locale)} — {weekEnd.getUTCDate()}{" "}
            {shortMonth(weekEnd, locale)}
          </strong>
          <Link href={`/admin?date=${nextWeekKey}`} aria-label="Semana siguiente">
            ›
          </Link>
        </div>

        <nav className="mock-week-calendar">
          {weekDays.map((day) => {
            const key = utcDateKey(day);
            const isSelected = key === selectedKey;
            const isToday = key === todayKey;
            return (
              <Link
                key={key}
                href={`/admin?date=${key}`}
                className={`mock-week-day${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                aria-current={isSelected ? "date" : undefined}
              >
                <span>{shortWeekday(day, locale)}</span>
                <strong>{day.getUTCDate()}</strong>
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="hoy-glance" aria-label="Resumen rápido">
        <Link href="/admin/alumnas"><strong>{activeStudents ?? 0}</strong><span>Alumnas activas</span></Link>
        <Link href="/admin/ventas"><strong>{salesTotal}</strong><span>Ventas hoy</span></Link>
        <div><strong>{dailyReservationPercentage}%</strong><span>Ocupación · {totalDailyReservations}/{totalDailyCapacity}</span></div>
      </section>

      <TodayClasses
        classes={classes}
        returnDate={selectedKey}
        serverNow={String(serverNow ?? now.toISOString())}
        canAttendance={canWriteAttendance}
        canBook={canWriteSchedule}
        canCreateStudent={canWriteStudents}
        locale={locale}
        timeZone={timeZone}
        canCorrectCompleted
      />
    </main>
  );
}