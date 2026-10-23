import { describe, expect, it } from "vitest";
import {
  answerUntil,
  isTemporaryInformationAnswerable,
  rankTemporaryInformation,
  type TemporaryInformation,
} from "@/lib/assistant/temporary-information";

const item = (overrides: Partial<TemporaryInformation> = {}): TemporaryInformation => ({
  id: "1",
  title: "Taller de aro aéreo",
  kind: "workshop",
  discipline: "Aro aéreo",
  details: "Horario: domingos de 9:00 a 10:30. Inscripción por WhatsApp. Precio: $500.",
  promotion_starts_on: "2026-10-01",
  event_starts_on: "2026-11-01",
  event_ends_on: "2026-11-30",
  registration_deadline: null,
  status: "published",
  ...overrides,
});

describe("Demi temporary information", () => {
  it("answers from announcement day through the event end when enrollment has no earlier cutoff", () => {
    const record = item();
    expect(answerUntil(record)).toBe("2026-11-30");
    expect(isTemporaryInformationAnswerable(record, "2026-10-01")).toBe(true);
    expect(isTemporaryInformationAnswerable(record, "2026-11-30")).toBe(true);
    expect(isTemporaryInformationAnswerable(record, "2026-12-01")).toBe(false);
  });

  it("stops answering on the registration deadline when it comes before the event end", () => {
    const record = item({ registration_deadline: "2026-11-10" });
    expect(answerUntil(record)).toBe("2026-11-10");
    expect(isTemporaryInformationAnswerable(record, "2026-11-10")).toBe(true);
    expect(isTemporaryInformationAnswerable(record, "2026-11-11")).toBe(false);
  });

  it("does not answer before publication begins or for drafts and archived records", () => {
    expect(isTemporaryInformationAnswerable(item(), "2026-09-30")).toBe(false);
    expect(isTemporaryInformationAnswerable(item({ status: "draft" }), "2026-10-15")).toBe(false);
    expect(isTemporaryInformationAnswerable(item({ status: "archived" }), "2026-10-15")).toBe(
      false,
    );
  });

  it("ranks matching current information and accent-insensitively matches the topic", () => {
    const unrelated = item({ id: "2", title: "Promo de flexibilidad", discipline: "Flexibilidad" });
    expect(rankTemporaryInformation([unrelated, item()], "horario del taller de aro")[0].id).toBe(
      "1",
    );
    expect(rankTemporaryInformation([item()], "taller de aro")[0].id).toBe("1");
    expect(rankTemporaryInformation([item()], "twerk")).toEqual([]);
  });

  it("finds workshops by their type for a generic plural question, even without taller in the name", () => {
    const workshop = item({
      title: "Aparatos Aéreos para principiantes",
      details: "",
      discipline: null,
    });
    const promotion = item({ id: "promo", kind: "promotion", title: "Descuento mensual" });
    expect(
      rankTemporaryInformation([workshop, promotion], "¿Qué talleres tienen disponibles?"),
    ).toEqual([workshop]);
    expect(rankTemporaryInformation([workshop], "información de talleres")).toEqual([workshop]);
    expect(
      rankTemporaryInformation([workshop], "precio de aparatos aereos para principiantes"),
    ).toEqual([workshop]);
    expect(rankTemporaryInformation([workshop], "taller de twerk")).toEqual([]);
  });
});
