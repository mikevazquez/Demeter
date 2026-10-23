import { describe, expect, it } from "vitest";
import { workshopDraftError, workshopEditorError, type WorkshopDraft } from "./editor";
const id = "00000000-0000-4000-8000-000000000001";
const draft = (): WorkshopDraft => ({
  title: "Taller",
  fullPriceMinor: 60029,
  allowIndividualSessions: false,
  requiresEnrollment: null,
  depositMode: "full",
  depositValue: null,
  balanceDueLocal: "",
  overdueMode: null,
  graceMinutes: null,
  dates: [
    {
      sessionId: "",
      date: "2027-01-10",
      time: "10:00",
      disciplineId: id,
      instructorId: "",
      spaceId: "",
      durationMinutes: 60,
      capacity: 10,
      priceMinor: null,
    },
  ],
});
describe("workshop editor validation", () => {
  it("accepts inherited policies and explicit optional tenant references", () =>
    expect(workshopDraftError(draft())).toBeNull());
  it("accepts only the name for locked editing, never for creation", () => {
    expect(workshopDraftError({ title: "Nombre" }, true)).toBeNull();
    expect(workshopDraftError({ title: "Nombre" })).toBeTruthy();
    expect(workshopDraftError({ title: "Nombre", fullPriceMinor: 1 }, true)).toBeTruthy();
  });
  it.each(["2027-02-30", "2027-13-01", "bad"])("rejects impossible calendar date %s", (date) => {
    const d = draft();
    d.dates[0].date = date;
    expect(workshopDraftError(d)).toContain("fecha y hora");
  });
  it("rejects duplicate dates and reused session identifiers", () => {
    const d = draft();
    d.dates.push({ ...d.dates[0] });
    expect(workshopDraftError(d)).toContain("mismo horario");
    d.dates[0].sessionId = id;
    d.dates[1] = { ...d.dates[0], date: "2027-01-11" };
    expect(workshopDraftError(d)).toContain("sesión repetida");
  });
  it("requires positive individual prices and a valid deposit/due date", () => {
    const d = draft();
    d.allowIndividualSessions = true;
    expect(workshopDraftError(d)).toContain("precio individual");
    d.dates[0].priceMinor = 15029;
    d.depositMode = "percent";
    d.depositValue = 50.123;
    expect(workshopDraftError(d)).toContain("anticipo");
    d.depositValue = 50;
    expect(workshopDraftError(d)).toContain("vencimiento");
    d.balanceDueLocal = "2027-01-01T12:00";
    expect(workshopDraftError(d)).toBeNull();
    d.depositMode = "fixed";
    d.depositValue = 60030;
    expect(workshopDraftError(d)).toContain("anticipo");
  });
  it("requires explicit grace for automatic release", () => {
    const d = draft();
    d.overdueMode = "release_after_grace";
    expect(workshopDraftError(d)).toContain("gracia");
    d.graceMinutes = 0;
    expect(workshopDraftError(d)).toBeNull();
  });
  it("explains a stale edit without exposing SQL details", () =>
    expect(workshopEditorError("workshop_revision_conflict")).toContain("Otra persona"));
});
