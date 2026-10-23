import { describe, expect, it } from "vitest";
import { resolveSessionKind, sessionKindLabel } from "@/src/lib/sessions/session-kind";

describe("session kind classification", () => {
  it("classifies configurable workshop templates by workshop ownership", () => {
    expect(resolveSessionKind({ workshopOfferId: "offer-1" })).toBe("workshop");
  });

  it("classifies activity program sessions by their program kind", () => {
    expect(resolveSessionKind({ programKind: "event" })).toBe("event");
    expect(resolveSessionKind({ programKind: "masterclass" })).toBe("masterclass");
    expect(resolveSessionKind({ programKind: "workshop" })).toBe("workshop");
  });

  it("falls back to ordinary class only when there is no special ownership", () => {
    expect(resolveSessionKind({})).toBe("class");
  });

  it("exposes user-facing labels", () => {
    expect(sessionKindLabel("class")).toBe("Clase");
    expect(sessionKindLabel("workshop")).toBe("Taller");
    expect(sessionKindLabel("event")).toBe("Evento");
    expect(sessionKindLabel("masterclass")).toBe("Masterclass");
  });
});
