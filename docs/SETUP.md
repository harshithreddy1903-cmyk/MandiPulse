# MandiPulse

[Project overview](../README.md) · [User guide](../USER_GUIDE.md) · [Verification](../VERIFICATION.md)

Live website: **https://mandipulse-rosy.vercel.app/**

MandiPulse helps you browse dated Karnataka mandi prices, compare markets and prepare buying estimates. Questions, comparisons, plans and PDF downloads work without an account. Optional Supabase sign-in saves plans and conversations to your account.

For plain-language instructions and every main control, read [USER_GUIDE.md](../USER_GUIDE.md).

## First-time setup on Windows

Install Python 3.10 or newer and a Node.js release supported by the installed Vite version: Node 20.19 or newer in the 20.x line, or Node 22.12 or newer. Open PowerShell in this project folder.

```powershell
npm ci
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item .env.example .env
```

Copy `.env.example` only when creating a new `.env`; preserve your existing settings. Edit `.env` locally:

| Setting | Purpose |
| --- | --- |
| `DATA_GOV_API_URL`, `DATA_GOV_API_KEY` | Primary official data.gov.in resource endpoint and your key for live prices. Dated official fallback reports have limited coverage. |
| `DATA_GOV_STATE` | Requested state; this interface is designed for Karnataka. |
| `DATA_GOV_LIMIT` | Maximum fetched rows, capped at 1,000. The source may return fewer rows. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional AI service for general answers and explanations. Direct record-based comparisons and calculations do not require an AI response. |
| `VITE_API_BASE_URL` | Browser's API address; locally use `http://127.0.0.1:8000`. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional browser account configuration. Use a publishable key with row-level security. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Matching backend account configuration/status. |
| `CORS_ORIGINS` | Allowed website origins, separated by commas. Local examples are in `.env.example`. |

Keep `.env` private. Backend service keys belong only in backend settings. Values beginning with `VITE_` are included in the browser build; never put an AI, data.gov.in or Supabase service-role secret there. The launcher does not inspect or print credentials.

For account saving, apply `supabase/migrations/001_mandipulse_workspace.sql`, then `supabase/migrations/002_preserve_plan_quantity_precision.sql`, in that order once in your Supabase SQL editor. Do this for new projects and when upgrading an existing project; both scripts are safe to reapply. The first script defines user-owned data and row-level security. The second widens the saved quantity to `numeric(18,5)` quintals so fractional kilogram weights, including 0.001 kg, are stored without rounding to zero. Version 2 saved-plan snapshots preserve their exact original weight and unit when older database rows were rounded.

Configure Auth site/redirect URLs for `http://127.0.0.1:5175` and your eventual deployed website. Asking questions and downloading PDFs remain available to guests. Guest chats are not restored after a page reload.

## Start MandiPulse

Run one command from this project folder:

```powershell
.\start.cmd -OpenBrowser
```

The launcher starts the API on `127.0.0.1:8000` and the website on `127.0.0.1:5175`, with hidden server windows. Omit `-OpenBrowser` to start without opening a browser. `start.cmd` invokes `start.ps1` with a policy override limited to that PowerShell process; it does not change your machine's execution policy. You can also run `.\start.ps1 -OpenBrowser` directly if your PowerShell policy allows local scripts.

Running the command again reuses healthy servers from this exact project. It checks each listening process's command line and the application response. It refuses an unrelated or unverifiable process using either required port and does not move to a different port. Close that other program yourself before trying again.

After changing backend code or `.env`, use the explicit restart option:

```powershell
.\start.cmd -Restart -OpenBrowser
```

Restart stops only verified processes from this project and their verified descendants. It refuses a process tree it cannot verify. Closing the launcher window leaves the servers running. Development frontend edits normally update automatically; backend edits require restart because the launcher does not enable automatic backend reload.

Launcher-created logs are in `.local/backend.out.log`, `.local/backend.err.log`, `.local/frontend.out.log` and `.local/frontend.err.log`. If a same-project server is unhealthy, inspect those logs and correct the problem before restarting. Logs are replaced when the launcher starts a replacement server. `.local/`, temporary files, dependencies and local credentials are excluded from Git. The launcher never installs packages automatically.

These are development servers bound to your own computer. A successful startup health check confirms that the services respond; live prices, AI and account saving still depend on their configuration and provider availability.

## What the data can tell you

The primary source is the official data.gov.in AGMARKNET feed. If it is unavailable, returns no usable Karnataka records, or lacks the requested product or product form, the app attempts public official AGMARKNET weekly reports. A dated answer can therefore appear while Overview still shows available live records. An explicit request for today or a specific date keeps that date restriction; older observations are not substituted for today. This fallback uses limited reports from selected Bengaluru markets, with their actual observation dates. It is explicitly marked **not live** and cannot establish the cheapest price across Karnataka. It does not bypass CAPTCHA-protected report endpoints.

The planning picker can search the full official product catalog when available. Selecting a product checks its report on demand; catalog membership does not guarantee a price for that product, market or date. Overview counts refer to actual priced records, not the full catalog.

Successful official observations are saved locally in `.local/market-feed-cache.json` for temporary provider failures. The cache contains whitelisted price/source/date metadata, never API credentials or user chats. Validation rejects corrupt, wrong-state, future-dated, non-official or expired observations; only recent records within seven days are accepted. A stored snapshot is always labelled as dated data. Alerts do not trigger from cached prices.

- Crops, markets and districts come from the returned official records. Coverage changes with the source, dates and fetch limit; the app does not claim to cover every Karnataka mandi or a fixed number of crops. Read the record dates and coverage information before using a price.
- Prices are wholesale modal prices per quintal. Comparisons preserve crop variety and grade when supplied. A buying plan is a provisional estimate, not a supplier quote. Confirm current prices, stock, loading charges and transport before purchasing.
- Weights can be entered in kilograms, quintals or metric tonnes. A mixed vegetable shop plan splits one total stock weight across the available selected vegetables. Per-crop costs and totals include freight only when you supply a rate per quintal; without a rate they are wholesale estimates before transport. Actual delivery charges still need confirmation. The split is a trial mix, not a prediction of customer demand. For specific individual crop weights, create separate crop plans.
- PDF downloads are optional and work for guests. PDFs include crop weights, market/date details and estimated costs; saved plans can be reopened and downloaded after signing in.
- Price alerts are stored in this browser. They refresh about every five minutes while the page is open and visible. Browser notifications require permission. There is no monitoring or notification service after the page is closed.
- Seven-day movement needs two complete consecutive weeks of comparable dated observations. Forecast readiness needs sufficient recent history and evaluation; a daily feed alone may not supply it. Missing history is shown explicitly. Any available baseline estimate is not a guaranteed future price.
- English/Kannada answers and browser voice/read-aloud support vary by browser and installed voices. Kannada or other user text in PDFs uses installed browser/system fonts. A geographic district map and unattended procurement execution are not included.

## Tests and production build

After the first-time dependency setup, run:

```powershell
npm run test:frontend
npm run test:backend
npm run build
```

Frontend tests explicitly cover plan persistence, units, PDF totals and pagination. Backend tests use synthetic market records to exercise routing, quantity handling and price analytics. These suites do not call external market, AI or account services. Live provider availability and browser interactions require separate smoke checks. The production website build is written to `dist/`.

To inspect the static production interface locally, run `npm run preview -- --host 127.0.0.1` and use the printed preview address. Preview does not provide the same-origin `/api` routes used in production; use the development launcher for a complete local frontend/API session or check the deployed Vercel app. A separate hosted API can be selected with an explicit remote `VITE_API_BASE_URL` before building. Preview is a local inspection server, not a deployment service.

The dated checks and remaining limits are recorded in [VERIFICATION.md](../VERIFICATION.md).

## Vercel deployment

The website and Python API are deployed together at https://mandipulse-rosy.vercel.app/ in the `mandipulse` Vercel project. `vercel.json` builds the Vite frontend and routes `/api/*` to `api/index.py`. Root `requirements.txt` lists runtime Python dependencies; keep it in sync with `backend/requirements.txt`. Python 3.12 is selected in `.python-version`.

The existing approved provider settings were added to Production environment variables. Backend API keys are stored as secrets. Browser Supabase settings are public configuration by design. `.vercelignore` excludes actual `.env` files, credentials, local data, dependencies and build output from source uploads. Production defaults to the same-origin API; localhost addresses are ignored in production.

After installing the official CLI and signing in, publish source changes from this folder with `vercel deploy --prod`. The local `.vercel` project link is ignored by Git; for a fresh checkout, link to your existing `mandipulse` project first. This CLI deployment does not create a GitHub repository or enable automatic Git pushes.

Vercel cache storage is temporary per function instance. Cached reports and rate limits are not shared across instances. Dated fallback coverage is shown explicitly; present stock, demand and live prices are not guaranteed. For production email confirmation/reset links, add the live website to Supabase Auth's allowed redirect URLs and use the live website as Site URL. The signed-in account flow remains unverified by the user's guest-mode preference.

## Deployment configuration

Deploy `dist/` to a static website host and the Python API to a separate ASGI-capable service. The Windows launcher is for local development and does not deploy the application.

1. On the frontend build host, install with `npm ci`, set the browser-safe `VITE_API_BASE_URL` to the HTTPS API URL plus any optional Supabase publishable settings, then run `npm run build`. Publish `dist/`. Changing a `VITE_` setting requires rebuilding.
2. On the backend host, install `backend/requirements.txt` and set backend-only data.gov.in/AI settings, optional Supabase settings, and `CORS_ORIGINS` to the exact HTTPS website origin. Run from the repository root; a fixed-port example is below. Substitute the port required by your hosting provider. Configure deployed secrets through your host's environment settings.

   ```text
   python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
   ```

3. Apply Supabase migration `001_mandipulse_workspace.sql`, then `002_preserve_plan_quantity_precision.sql`, as described in setup. Add the production website to Supabase Auth's site and redirect configuration if accounts are enabled. Keep row-level security enabled.
4. Check the deployed API's `/api/health`, then exercise live prices, plan download and optional sign-in from the deployed website. Ensure the browser never points at a local `127.0.0.1` API in production.

The request limiter and short-lived query caches are in memory per server process. The validated last-good official feed snapshot is persisted locally; ephemeral hosting storage may discard it on a restart or redeploy. Use shared infrastructure and appropriate host controls before scaling public traffic. Source/provider quotas, historical coverage and hosting capacity remain operational constraints.
