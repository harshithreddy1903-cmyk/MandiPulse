# Verification record

Final checks on 1 November 2026; earlier checks on 29 October are identified below. This records what was exercised; it is not a guarantee of future provider availability.

## Automated checks

- Backend: 165 tests passed, including scoped official fallback, category follow-ups, whole/processed pulse handling, date restrictions, cache validation and shop-plan preferences.
- Frontend: 38 tests passed, covering HTTP errors, catalog versus priced coverage, dated-feed display, account configuration, saved snapshots, quantity precision, PDF freight math and pagination.
- Production build: passed with the final PDF rounding fix (267 modules).
- Launcher: 14 pure safety checks, syntax validation, healthy reuse and a verified-process restart passed.

Automated unit tests use controlled records and mocked providers. The separate real-data and browser checks below use the configured local application and official sources.

## Public Vercel deployment - 1 November 2026

- Production deployment `dpl_DD2cYoVZcjiqY93HMrGrLV8D57vU` reached READY, with the stable URL https://mandipulse-rosy.vercel.app/.
- Anonymous HTTPS requests returned 200 for the website, `/api/health`, `/api/config` and `/api/market-prices`. The API health status was OK. Source API settings were approved explicitly before transfer to the new Vercel project; local env files were excluded.
- The same seven category/context/plan/guidance smoke scenarios passed against the public address. Available remote prices used official weekly fallback, with actual dates and partial coverage shown. The ten-vegetable table and six-dal table were available through scoped reports; the initial overview had fewer observations. No statewide live-coverage claim is made.
- A new apple-browning question returned a successful AI answer. A public browser session rendered the dal table and optional 50 kg plan, then downloaded the PDF. No browser warnings/errors were recorded in that check.
- Vercel uses same-origin API routing and temporary writable cache storage. Backend tests increased to 165 and frontend tests to 38; the production build succeeded on Vercel.
- Supabase production email confirmation/reset redirect configuration and an authenticated save/reopen check remain unverified. Guest asking, comparisons, plans and downloads were exercised publicly.
- Global agent setup: official Vercel CLI65.9.0 authenticated, official Vercel plugin installed/enabled, and user-level https://mcp.vercel.com configured with successful OAuth. Newly added MCP tools are not exposed in this already-running chat; documentation/team tool checks need a fresh agent session. No MCP mutations were auto-approved.

## Final real-data and browser checks - 1 November 2026

- The API health endpoint returned OK and the fixed-port launcher restart succeeded. The primary feed returned 31 Karnataka rows covering 30 crop names, dated 1 November, in the final coverage check. Counts may change as reports arrive.
- Seven dependent HTTP smoke checks passed using real official data: vegetable list; exact `give me for dals`; `Sort them from lowest to highest price`; 50 kg, ten-vegetable shop plan; `Give me the same for dals`; `Give me the same for tomato`; and practical dry-dal storage guidance.
- The category chain was replayed in the browser. Lists rendered as actual tables. The sorted follow-up retained dals, and processed-dal labels were shown separately from whole pulses.
- The missing live dal category used six public official weekly product reports from Bengaluru APMC, with observations between 26 and 30 October. Each answer showed **Dated official records - not live**, its source dates and partial coverage. Overview retained the available primary feed. Scoped fallback does not claim statewide cheapest prices.
- An explicit today/date request does not substitute older observations. Recent last-good snapshots are validated and can support provider failures; no synthetic test data was seeded into the production cache. The full official catalog is separate from actual priced coverage, with on-demand checks and no guaranteed availability for every entry.
- Plan follow-ups retained 50 kg, Rs 5,000 budget, Bengaluru destination and Rs 100/quintal freight. The dal plan warned that it exceeded that budget. Switching to tomato produced a single-crop plan with the same inputs.
- Guest mode offered a PDF only for a plan. The final 50 kg, six-dal PDF downloaded from the browser, and both pages were rendered and visually inspected. All weights and rows were present. The corrected breakdown is Rs 5,199.97 wholesale + Rs 50.00 entered freight = Rs 5,249.97 total, with source dates and trial-mix warnings.
- Phone portrait (390 x 844) and short landscape (844 x 390) had no page-wide horizontal overflow. Chat kept the composer visible in landscape; the home page scrolls. Tables retain their own scroll area. Dry-pulse guidance appeared as five practical steps, without a price table or unwanted PDF.
- No browser console errors were recorded in the final chat replay. The final source archive excludes credentials, local caches, logs, dependencies and generated build output.

## Earlier hands-on browser checks - 29 October 2026

- Live official feed loaded: 598 records, 96 crop types and 30 districts, dated 29 October 2026 at the time of checking. Coverage can change with the upstream feed.
- Tomato comparison rendered as a numeric, ascending table with market, district, variety/grade, date and both quintal and kilogram prices.
- A 2 tonne Tomato plan preserved a Rs 50,000 budget, Bengaluru destination and Rs 100/quintal freight. The cheapest listed estimate was Rs 8,000, with transport and availability caveats.
- Chained follow-ups `plan` and `Give me the same for apple` preserved weight, destination, budget and freight. The Apple estimate correctly warned that it exceeded the budget.
- Mixed vegetable starter plans displayed individual weights and costs as the first columns, with a visible scrolling hint. The final shop request kept Bengaluru as the destination, allowed buying comparisons across available markets, and excluded dried pulses from fresh vegetables. Trial weights were labelled as assumptions; unavailable sales-demand data was stated explicitly.
- Guidance questions displayed numbered practical steps rather than a price table or an unwanted PDF.
- The final live ten-vegetable PDF downloaded and all three pages were rendered and visually inspected, with 50 kg total and Rs 706.25 including the entered freight estimate. The one-market Apple PDF fits one page after consolidating repeated warnings; custom caveats remain intact. PDF offers appeared for plans. Guests could decline, download later, or download without signing up. An actual browser download was opened and rendered for inspection.
- Searchable crop picker supported scrolling, filtering and keyboard selection beyond the first visible options.
- Overview search, pagination, refresh and crop-specific history were exercised. Missing trend/forecast history was shown honestly.
- Guest saving opened the optional account form. Modal focus, Escape, keyboard navigation, cancellation and starting a new chat were exercised.
- Phone portrait and short landscape layouts were checked, including table scrolling and a visible composer without page-wide horizontal overflow.
- English/Kannada answers, PDF text rendering, unsupported voice handling and read-aloud controls were checked.
- Local price-alert validation and saving were exercised without granting unwanted notification permission.

## Accounts and privacy

The approved database setup was applied to the configured Supabase project. Read-only verification found both saving tables, row-level security enabled, and owner-only SELECT/INSERT/UPDATE/DELETE policies. Saved quantities use five decimal places in quintals. Anonymous reads returned no saved rows. Local Auth redirect addresses for both localhost and 127.0.0.1 on port 5175 were present.

The user chose to finish with guest mode checked for now. The signed-in end-user save/reopen flow was not exercised with the user's private credentials. Snapshot round-trip tests cover the saved-plan format, including older rows and fractional kilogram quantities. Database configuration and anonymous-access checks do not replace an authenticated browser check.

## Local startup and release

The launcher was checked for reuse of healthy project services, strict fixed ports, refusal to stop unknown processes and safe restart of verified project processes. Fourteen pure launcher checks and a live restart passed. The API health endpoint responded successfully.

The earlier local result runs at http://127.0.0.1:5175/. The later public Vercel deployment is recorded above. No Git push or automatic background monitoring was performed.

## Practical limits

- Official records do not establish present stock, sales demand or a supplier quote. Confirm quality, date, distance and actual transport costs before buying.
- Available crops and market coverage depend on the official source and fetch limit. Provider outages and quotas remain possible.
- Genuine price trends require comparable dated history; a single day's observations cannot support demand predictions.
- Price alerts run only while this browser page is open and visible. Guest chat is not recovered after a reload.
- The app supports agriculture and market guidance; it cannot reliably answer every conceivable question or guarantee an error-free response.
