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

## Follow-up: populated-screen verification

The earlier review covered only the historical one-class state; it did not verify all populated widgets. User review identified drift in class summaries, holidays, shortcuts and Para hoy. These findings are addressed in this iteration:

- Removed the legacy dashboard/hoy-approved/hoy-v2 layout classes from the Hoy root, which were still influencing fields and spacing. Existing form styling is retained only inside quick-action form cards.
- Class summaries use the source grid, correct caption weights/colors, singular reservation copy, explicit line wrapping and one minimum-status badge.
- Para hoy is a bounded wrapping group with stable count circles and source button sizing. Hero CTAs are vertically centered.
- Holiday cards use the source native icons and accent colors for individual holidays, source row spacing and state colors.
- Shortcuts are a bottom sheet, rather than an inline dropdown; options have icon/copy/chevron tracks. Escape, focus containment, backdrop closing and body-scroll locking are implemented.

Populated proof uses a temporary local authenticated visual route containing the production page's actual JSX and the real TodayClasses/QuickActions components, with five fixture classes, all five task chips and one holiday. The route was removed before build/commit; no Sandbox data was modified.

Evidence: docs/uat/admin-a/html-hoy/all-sections-390.png, all-sections-440.png, quick-sheet-390.png. A combined source/implementation comparison was opened from work/all-sections-comparison.png; source left, implementation right. Both use 390 CSS px, density 1. Header/calendar/KPIs were omitted identically to focus the four reported surfaces. Native calendar/data state, icons and development tooling are excluded where they do not belong to these surfaces.

The populated component checks passed at 320/390/440/1280 px with zero horizontal overflow and zero browser JavaScript errors. Five cards, five task chips and one holiday were confirmed. Quick action menu and new-student sheet opened; Escape closed the sheet. Work log: work/hoy-all-sections-browser-final.log.

Fonts, spacing, colors, assets and copy were checked for all four populated regions. No P0/P1/P2 finding remains in those states. The live preview retains real data and permissions.

final result: passed
