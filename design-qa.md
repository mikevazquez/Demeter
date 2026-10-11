# Hoy · HTML source comparison

Source visual truth: uploaded `StudioFlow Panel.html`, local path `/workspace/attachments/0171ca1a-942d-431a-b995-5e5124d7acaf/StudioFlow Panel.html`. Original rendered source: `docs/uat/admin-a/html-hoy/source.png`.

Implementation screenshot: `work/hoy-reference-shots/admin-a-hoy-390.png`. Combined comparison: `docs/uat/admin-a/html-hoy/comparison.png` (source left, implementation right). Viewport 390×844 CSS px, deviceScaleFactor 1, dark theme. Both captures have the same pixel density; no browser chrome is included.

## Comparison state

The source's in-browser demo records were normalized to one historical Pole Fitness UAT class with capacity five and zero reservations, matching the existing Sandbox screen. The demo clock and studio name were changed only in the local reference browser. No database records were created or changed. The source's full five-class demo state is retained in source.png.

Clock time, weekly class dots, today's underline, and enabled arrows reflect the different live/generated data and are intentional. The app retains its existing roster and mutation behavior.

## Findings and history

1. The previous screenshot-based implementation used smaller typography, estimated spacings and a different heading arrangement. It was replaced with the uploaded HTML's CSS declaration values and corresponding React markup. The source's automatic date navigation is implemented with the existing admin route.
2. The initial HTML comparison found inherited layout styles centering the heading, stacking clock/search vertically, adding eight pixels to the week heading and offsetting the bottom navigation. These were removed explicitly within Hoy. The following combined capture shows the heading/calendar/metrics/class card/bottom navigation aligned to the HTML structure.
3. Historical labels use the source's weekday/day/short-month wording. Completed-class summaries omit zero no-show/unmarked counts. KPI rows retain the source's shared separators.

## Required surfaces

- Typography: rendered system sans-serif matches the supplied HTML's actual fallback. Exact source title (28 px), class name (17 px), class metadata (13 px), KPI count (20 px), labels (12 px), wordmark letter spacing and weights transferred. Existing font styling on other screens is retained.
- Layout: 760 px maximum content width, 16 px horizontal padding, 14 px section gap, flex-wrapped title tools, 40 px calendar arrows, 38 px automatic date picker, seven-day grid, shared KPI grid and 58 px class-time track transferred. The full combined image is legible at original size and serves as focused evidence for heading/calendar and KPI/class regions; no enlarged region is necessary.
- Colors: original light/dark source tokens used; the previous forced-dark approximation removed. Gradient and semantic state colors follow the HTML.
- Assets: existing functional navigation icons retained; Phosphor check-in/search/plus/chevron icons preserve source dimensions. Holiday globe remains a vector icon. These minor icon-shape differences are P3.
- Copy/content: real studio name, clock, dates, attendance, financial figures and permissions retained. The live clock says Ahora rather than Demo. No demo PIN, students, payments or workflows were copied into the backend.

## Browser verification

At 390 px: no horizontal overflow, roster expands, quick actions open, global search opens, date picker navigates without a submit button, expected routes load and zero browser JavaScript errors. Desktop 1280 px and dark styling captured by the same script. Logs: `work/html-hoy-browser-final.log`.

The original full source additionally shows next class, five pending types and a holiday. Their markup and declarations were transferred directly, but the current historical Sandbox fixture has none of those records; their source-data counts are not claimed as live data.

## Follow-up polish

- P3: source icon paths differ slightly from the existing/library icons.
- Live data can change labels, counts, enabled arrows and card heights; it is not replaced with demonstration records.

No actionable P0/P1/P2 mismatch remains in the matched historical state.

final result: passed
