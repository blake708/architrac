# ADR 0007: Address lookup with Google Places

- **Status:** Accepted
- **Date:** 2026-11-03
- **Decided by:** Blake

## Decision
1. Address fields on projects and companies look up real US addresses with **Google Places API (New)**: Autocomplete while typing, then Place Details (field mask `addressComponents` only) when a suggestion is picked. Picking one fills street, suite/unit, city, state and ZIP; every field stays editable.
2. **The key stays on the server.** The browser calls our server actions (`src/server/address/actions.ts`), which need a signed-in session and call Google with `GOOGLE_MAPS_API_KEY` in a header. Nothing about the key is sent to the browser.
3. Typing and the pick share one **session token**, so Google bills them as one lookup session. Suggestions wait 250 ms after typing stops and need 3+ characters; results are limited to the US.
4. **Optional.** Without the key, the lookup is off and the fields are plain inputs. Tests run without it; the parsing and the Google calls are unit tested with a stubbed `fetch`.
5. Suggestions show "Powered by Google", as Google's terms require when results aren't shown on a Google map.

## Why
Google has the best coverage of US street addresses, including new construction sites. A small firm's use should stay within Google's free monthly allowance.

## Consequences
- A Google Cloud project with billing turned on, and the **Places API (New)** enabled. Restrict the key to that API. It is called from servers, so restrict it by API, not by website.
- Set `GOOGLE_MAPS_API_KEY` in `.env.local` and in Vercel (Production and Preview); see `docs/DEPLOY.md`.
- Only the parsed fields are stored. We don't keep Google place IDs or coordinates. If maps are needed later (Release 3+), revisit Google's caching rules first.
