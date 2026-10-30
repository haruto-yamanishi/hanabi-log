# Halloween seasonal artwork

Original SVG characters live in `src/components/seasonal/halloween-art.tsx`. Scene composition and animation are isolated in `halloween-scene.tsx` and `halloween.css`; the brand stylesheet is unchanged.

The client provider enables decorations every year from October 20 00:00 JST through October 31 23:59:59 JST. SSR and initial hydration both render without decorations, then `useSyncExternalStore` activates them. A timer at the next JST midnight and page visibility checks remove decorations even if a tab remains open. The initial loading screen keeps its original 1,100 ms minimum.

Development preview: run `npm run dev` and open `/?halloween=on`, `/?halloween=off`, or `/login?halloween=on`. The query override only works in development and applies to the current URL; production always uses the JST date. For the login page, run the existing app with `DEMO_MODE=false` without an authenticated browser session.

Decorations have no pointer events, are hidden from assistive technology, and contain no focusable elements. Reduced-motion disables all character motion. The bingo window retains the brand's 2px radius; its participant functionality remains available through the original event period, while its illustration follows the October seasonal switch.

Run `npx vitest run src/lib/halloween-season.test.ts` and `npx playwright test e2e/halloween-art.spec.ts --project=desktop --project=mobile`. Browser captures are stored in ignored `artifacts/halloween/`.

## Permanent report stamps

The detail-page stamp uses the report's `reportDate` (the date selected in the report form), not today's date, publication time, or update time. Reports dated October 20–31 retain the stamp after Halloween, including existing reports; other dates have no stamp even during Halloween. Changing a report's date updates the stamp accordingly. No database migration or backfill is required.

`seasonal-events.ts` owns recurring event windows. `HalloweenScene` gates live site decoration; `HalloweenComposition` only draws; `ReportSeasonalStamp` chooses artwork from the report date. To add Christmas, register its agreed dates in `SEASONAL_EVENTS` and add its SVG component to the typed `stampArtwork` map. Christmas is not enabled until its dates/artwork are defined. Stamps are static and accessible by an event label.
