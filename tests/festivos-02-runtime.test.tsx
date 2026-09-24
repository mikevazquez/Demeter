import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  HolidayConfigurationClient,
  type CalendarDayRow,
} from "../app/admin/configuracion/festivos/HolidayConfigurationClient";

describe("FESTIVOS-02 configuration runtime render", () => {
  it("renders official holiday rows without throwing", () => {
    const rows: CalendarDayRow[] = [
      {
        date: "2026-11-16",
        name: "Revolución Mexicana",
        sourceKind: "official",
        operationMode: "closed",
        message:
          "Hoy conmemoramos la historia, la lucha y la transformación que marcaron a México.",
        themeKey: "revolution",
        heroUrl: null,
        messageUrl: null,
        configured: true,
        sourceLabel: "Gobierno de México · PROFEDET · Art. 74 LFT",
      },
    ];

    expect(() =>
      renderToString(<HolidayConfigurationClient year={2026} rows={rows} />),
    ).not.toThrow();
  });
});
