"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { birthdaySummary, type BirthdayOccurrence } from "./birthdays";
import { GiftIcon } from "./GiftIcon";

export function MonthlyBirthdays({
  birthdays,
  selectedDate,
  today,
  locale,
}: {
  birthdays: BirthdayOccurrence[];
  selectedDate: string;
  today: string;
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${selectedDate}T12:00:00Z`),
  );
  return (
    <section className="today-birthdays" aria-label={`Cumpleaños de ${month}`}>
      <button
        type="button"
        className="today-birthdays-heading"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <span className="today-birthdays-icon">
          <GiftIcon size={22} />
        </span>
        <span className="today-birthdays-copy">
          <strong>Cumpleaños de {month}</strong>
          <span>{birthdaySummary(birthdays, today, locale)}</span>
        </span>
        <span className="today-birthdays-count">{birthdays.length}</span>
        <svg
          className={`today-birthdays-arrow${open ? " is-open" : ""}`}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
      <div id={listId} hidden={!open} className="today-birthdays-list">
        {birthdays.map((student) => {
          const date = new Date(`${student.date}T12:00:00Z`);
          const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
            .format(date)
            .replace(".", "");
          return (
            <Link
              key={student.studentId}
              href={`/admin?date=${student.date}`}
              scroll={false}
              className={`today-birthday-row${student.date < today ? " is-past" : ""}`}
              aria-label={`${student.name}, cumpleaños el ${date.getUTCDate()} de ${month}`}
            >
              <span className="today-birthday-date">
                <b>{date.getUTCDate()}</b>
                <small>{weekday}</small>
              </span>
              <span className="today-birthday-person">
                <strong>{student.name}</strong>
                <small>{student.packageLabel}</small>
              </span>
              {student.date === today ? <span className="today-birthday-today">Hoy</span> : null}
            </Link>
          );
        })}
        {!birthdays.length ? <p>Sin cumpleaños registrados</p> : null}
      </div>
    </section>
  );
}
