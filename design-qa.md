# Hoy · revisión de las referencias móviles

Source visual truth: two images attached to the user message requesting the Hoy screen, originally 1320×2868, displayed at 943×2048. The image files are not exposed in the workspace attachments directory.

Implementation screenshot: work/hoy-reference-shots/admin-a-hoy-390.png. CSS viewport 390×844, deviceScaleFactor 1. Browser chrome in the source is excluded from the app surface. Source content is interpreted at approximately 393 CSS px; source browser bars and demonstration time are not reproduced.

## Findings and comparison history

- First browser capture: a long historical date heading pushed the mobile surface beyond the viewport, and inherited narrow-screen CSS hid class attendance metadata. Both were fixed: a short heading with date subtitle, explicit metadata visibility, and a compact horizontal clock/search group. A second capture shows no horizontal overflow and visible class summary metadata.
- Font: existing local Manrope retained; title, class heading, counts and secondary labels use the reference hierarchy.
- Layout: brand/check-in/quick actions, heading/date/clock/search, week/date navigation, next class, pending chips, holidays, shared 2×2 metrics and class list in that order. The browser's title/status/action chrome is excluded.
- Colors: dark background #0d1522, card #162132, muted labels, green navigation/calendar accents, semantic status colors and green-to-blue next-class surface.
- Assets: Phosphor icons for search, plus, arrows, check-in and globe. The holiday globe is a vector UI icon, rather than the source's globe emoji.
- Content: real studio name, clock, dates, classes, counts and pending states retained; no demonstration records or time introduced.

## Verification limits

The rendered historical Sandbox state contains one finished class and no pending holiday/next-class card. Its data differs from the reference. A combined source-file/rendered-image comparison cannot be produced because the supplied image files are not available locally. Thus exact full-state visual parity is not certified; the preview is suitable for review of the implemented changes.

Primary browser checks and console results are recorded in work/hoy-reference-browser-final.log. Production build and existing test suite are recorded in work/build-hoy-reference.log and work/ci-hoy-reference.log, with the whitespace-sensitive transfer label regression checked separately in work/test-hoy-transfer.log.

final result: blocked
