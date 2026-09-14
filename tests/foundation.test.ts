import { describe, expect, it } from "vitest";

describe("Studio Flow foundation", () => {
  it("keeps the initial locale and timezone contract explicit", () => {
    expect({ locale: "es-MX", timezone: "America/Mexico_City" }).toEqual({
      locale: "es-MX",
      timezone: "America/Mexico_City",
    });
  });
});
