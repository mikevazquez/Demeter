import { describe, expect, it } from "vitest";
import { followingWeek, programError, type ProgramDraft } from "../lib/programs/draft";
const draft = (): ProgramDraft => ({
  name: "Danzas aéreas para principiantes",
  description: "Cinco domingos",
  kind: "workshop",
  fullPriceMinor: 90000,
  allowSingle: true,
  dates: Array.from({ length: 5 }, (_, i) => ({
    date: `2026-11-${String(1 + i * 7).padStart(2, "0")}`,
    time: "10:00",
    disciplineId: `discipline-${i}`,
    durationMinutes: 180,
    capacity: 5,
    priceMinor: 25000,
    instructorId: "",
    spaceId: "",
  })),
});
describe("programs with fixed dates", () => {
  it("accepts five dates with different disciplines and standalone prices", () =>
    expect(programError(draft())).toBeNull());
  it("accepts the same discipline across all dates", () => {
    const p = draft();
    p.dates = p.dates.map((r) => ({ ...r, disciplineId: "same" }));
    expect(programError(p)).toBeNull();
  });
  it("requires each standalone day price", () => {
    const p = draft();
    p.dates[2].priceMinor = 0;
    expect(programError(p)).toContain("precio de cada");
  });
  it("accepts a three-hour one-day event without standalone sale", () => {
    const p = draft();
    p.kind = "event";
    p.allowSingle = false;
    p.dates = [p.dates[0]];
    p.dates[0].priceMinor = 0;
    expect(programError(p)).toBeNull();
  });
  it("rejects duplicate dates at the same time", () => {
    const p = draft();
    p.dates[1] = { ...p.dates[0] };
    expect(programError(p)).toContain("duplicados");
  });
  it("rejects zero capacity and fractional durations", () => {
    const p = draft();
    p.dates[0].capacity = 0;
    expect(programError(p)).toContain("lugar");
    p.dates[0].capacity = 5;
    p.dates[0].durationMinutes = 60.5;
    expect(programError(p)).toContain("duración");
  });
  it("adds a Sunday without moving it across month or year boundaries", () => {
    expect(followingWeek("2026-11-29")).toBe("2026-12-06");
    expect(followingWeek("2026-12-27")).toBe("2027-01-03");
  });
  it("rejects malformed input", () => expect(programError({} as ProgramDraft)).toContain("Revisa"));
});
