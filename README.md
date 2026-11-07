# BizNova — Growth Overview & Website Agent

BizNova combines a business dashboard based on the supplied [Figma prototype](https://www.figma.com/proto/hxovmgyfemgTMiBxvJBzp1/Biznova?node-id=5-720) with a local Website Agent workspace. This directory contains the frontend, backend APIs, SQLite schemas, migrations, and project generation tools.

## Run locally

Use **Node.js 24+** and npm. The standalone local app does not require ChatGPT sign-in, a Cloudflare account, a cloud database, or an API key. The frontend, API, images, and database run on your computer. Installing dependencies initially requires an internet connection; offline mode runs without external services afterward; DeepSeek mode needs an internet connection and your own API key.

From the project directory:

```sh
npm ci             # First installation or dependency changes only
npm run local      # Build the frontend, initialize SQLite, and start the app
```

Open **http://127.0.0.1:3000**. On macOS, you can also double-click `start-local.command` if Node.js 24+ is available in your terminal. Keep the terminal open while using the app. Press `Ctrl+C` to stop it.

Use `npm run local` for subsequent starts; it rebuilds the frontend and preserves your data. If the frontend has already been built and its source has not changed, use `npm run local:start` to skip the build.

| Local content | Location |
| --- | --- |
| Dashboard source and interactions | `app/page.tsx`, `app/globals.css` |
| Standalone entry point and build configuration | `local/main.tsx`, `vite.local.config.ts` |
| Node.js API and static file server | `local/server.mjs` |
| SQLite setup, migrations, and demo initialization | `local/database.mjs` |
| Built frontend and image assets | `.local/dist/` |
| SQLite database | `data/biznova.sqlite` |
| Database journals that may exist while running | `data/biznova.sqlite-wal`, `data/biznova.sqlite-shm` |

`.local/` and `data/` are generated locally and excluded from version control. **Do not delete `data/` unless you intend to discard the local records.** To back up the database, stop the service and copy the entire `data/` directory. The server listens only on the local loopback address.

To choose a different port or data directory:

```sh
PORT=3001 npm run local:start
BIZNOVA_DATA_DIR=/absolute/path/to/data npm run local:start
```

To move the source to another computer, retain the source files, `package.json`, `package-lock.json`, `drizzle/`, and `public/`, install Node.js 24+, and run the commands above. To transfer existing records, stop the service before copying `data/` as well. `.wrangler/state` belongs to the older Workers emulator; the standalone app does not depend on it. Both implementations began with the same dashboard demo records and subsequently maintain their data separately.

### Run a packaged copy

The delivery ZIP includes the complete frontend build in `.local/dist/`. After installing Node.js 24+ and extracting the entire archive, run:

```sh
node local/server.mjs
```

This command requires neither npm dependencies nor an internet connection. On macOS, `start-local.command` starts the server directly when `node_modules` is absent but the frontend build is present. Open http://127.0.0.1:3000. To edit the source and rebuild it, run `npm ci` followed by `npm run local`.

### Optional Workers compatibility mode

The original Vinext/Workers build remains available for possible future deployment. Normal standalone use does not require these commands and does not synchronize or publish anything to the cloud.

```sh
npm run build
# Run this migration once when creating a new emulator database:
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_yellow_prodigy.sql
npm start
```

This compatibility mode uses http://127.0.0.1:8787 by default. The standalone app uses port 3000.

## Implemented features

- The dashboard retains the prototype's gradient background, navigation, sidebar, card layout, product images, and principal figures.
- Top products, revenue, advertising ROAS and spend, orders, best ad, platform rankings, hourly audience activity, a daily trend for the selected period, and a revenue calendar.
- Preset and custom date ranges and platform filters, with consistent calculations across cards and CSV exports.
- Product details, expanded audience activity, chart tooltips, daily calendar details, and daily revenue CSV export.
- Light and dark themes, keyboard-accessible native dialogs, loading/error/empty states, and mobile layouts.
- The **AI Chatbot** entry opens Website Agent: enterprise briefs, nine visual directions, persistent projects, conversational edits, version restoration, source inspection, preview inquiries, and full-stack ZIP export.
- The **Website** entry opens the Nova Home storefront at `/#website`. Browse six drinkware products, search and sort the catalog, and review and download an order preview. The bag is saved in the browser. [Photo credits and price references](public/images/store/SOURCES.md) document the proposed catalog. A separate Analytics module remains planned.

## Architecture

The frontend uses React 19 and TypeScript. The standalone app uses Vite, Node.js HTTP, and Node's built-in SQLite support while reusing dashboard types and calculation logic. The original Vinext/Cloudflare Workers/D1 implementation remains an optional compatibility path; standalone startup does not load cloud plugins, authentication, or connectors.

| Path | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/globals.css` | Dashboard UI, interactions, and responsive styles |
| `app/api/dashboard/route.ts` | Date/platform validation and dashboard JSON API |
| `app/api/dashboard/export/route.ts` | Daily revenue CSV using the same reporting rules |
| `app/api/health/route.ts` | Database health check |
| `lib/dashboard-data.ts` | Types, demo records, integer-cent allocation, and aggregation |
| `lib/dashboard-repository.ts` | Database queries and idempotent demo initialization |
| `db/schema.ts`, `drizzle/` | Database schema and migrations |
| `tests/dashboard.test.mjs` | Totals, partitioned filters, dates, and input validation |

## Dashboard API

```text
GET /api/dashboard?from=2026-09-12&to=2026-10-11&platform=all
GET /api/dashboard/export?from=2026-10-02&to=2026-10-11&platform=tiktok
GET /api/health
```

`platform` accepts `all`, `tiktok`, `meta`, or `google`. Dates use UTC, include both endpoints, and support a maximum range of 366 days. Invalid parameters return HTTP 400; a database failure returns HTTP 503. Dates outside the dataset return zero values. Comparisons use the immediately preceding period of equal length; revenue growth is `null` when that previous period has no revenue. Monetary amounts are stored and allocated as integer cents and returned as dollars in JSON.

## Demo data and future integrations

The dashboard uses **explicitly labeled demo data**. No live store, payment provider, ad account, or user system is connected. The standalone app initializes its demo records on first startup; the Workers compatibility version initializes them on its first dashboard API request. Initialization is idempotent and creates 540 product-day records and 180 ad-day records. Subsequent requests query SQLite rather than returning frontend hardcoded totals. The `dataset` table records initialization, and records persist across local restarts.

The default prototype period is September 12 through October 11, 2026: $18,612.85 revenue, 915 orders, and $2,028.60 advertising spend. The final 10 days total $6,869 and 326 orders. Product totals, platform spend, and attributed advertising sales follow the prototype. Its rounded calendar figures total $18,631, which is $18.15 above its headline revenue. The implementation reconciles that difference on the first day while preserving the headline and exact 10-day trend. ROAS uses attributed ad sales divided by ad spend, separately from total store revenue. Product/date/platform allocations, previous-period breakdowns, clicks, and impressions are synthetic. Hourly audience activity is an estimate scaled to the selected period's order volume and is not a real analytics conclusion.

Product and avatar images were captured from the visible supplied prototype and are limited by its preview resolution. Replace the files in `public/images/` when original Figma exports are available.

Real integrations require store and advertising import jobs, mapping those records to the fact tables, and removing demo initialization. A multi-store or multi-user product also needs account authentication, tenant fields, and tenant-scoped authorization. The standalone app requires no sign-in and listens only locally. The earlier hosted site is owner-private. This is not currently a multi-tenant production system.

## Validation

```sh
npm run local:build
npm test
npm run typecheck
```

Tests cover dashboard reconciliation across products, platforms, and the calendar; platform partition totals; single-day, 10-day, and empty ranges; filter validation; HTTP APIs; and CSV totals.

Standalone integration tests cover automatic migrations and initialization, local static assets, API/CSV consistency, invalid requests, and edited SQLite records surviving restarts without duplicate seeding. Tests use temporary system directories and do not modify the user's `data/` directory.

## Website Agent

Open http://127.0.0.1:3000/#studio or click **AI Chatbot** in the top navigation.

### Build and refine a website

1. Describe your brand, business, and goals in the left panel, or choose a technology/SaaS, consultancy, or creative studio example.
2. Open **Browse styles**, explore the nine design directions, select a style and click **Use**. Then describe your website and click **Build website**. For an existing project, the library previews your own content and **Apply** sends a scoped style change through the agent.
3. Use **Preview** to inspect desktop and mobile layouts, including navigation, hero, services, about, FAQ, contact, and footer sections.
4. Continue with explicit changes, such as:

   ```text
   Change the headline to "Make good business happen."
   Change the accent color to #f97316
   Change the brand to Northstar
   Change the CTA to "Book a consultation"
   Change the navigation to Services, About, Contact
   Change the footer to "Made with intention."
   ```

   You can also switch visual directions directly. With DeepSeek configured, choose **Edit scope** to lock an edit to Hero, Services, About, Navigation, Footer, Theme, Brand, or Contact. **Auto** lets the agent choose the relevant fields. The server enforces locked scopes even if the model requests a different section.

5. **Tools** displays real tool calls, arguments, results, selected scope, changed fields and model-turn counts. **Project files** displays the generated source. **Versions** restores earlier versions. **Backend & Data** displays inquiries submitted through the preview's contact form.
6. Click **Export project** to download a ZIP. Extract it, open the `website` directory, and run `node server.mjs` using Node.js 24+. Open http://127.0.0.1:3100. Exported sites require no `npm install` and include `POST /api/leads` and a `data/site.sqlite` database. Edit `public/index.html` to customize the exported frontend independently.

### Autonomous pages and components

With DeepSeek configured, describe the website goal and required pages. The model plans and uses tools for new builds as well as revisions. The **Pages** tab displays the saved page tree and ordered components; preview selectors and internal navigation open the actual page route. Structure actions prepare precise conversation instructions for you to submit.

Supported components are hero, features, content, FAQ, CTA, contact, pricing, gallery and metrics. Each has compatible choices among split, centered, grid, list, alternating and banner layouts. Sites support up to 8 pages and 12 sections per page. Internal routes use `/`, `/projects` and similar one-level paths; a contact component retains the working Node.js/SQLite enquiry backend. Pricing and metrics must come from the user's supplied facts.

New builds record required pages/section types and visual notes with `plan_site`. `inspect_site` renders all pages and checks links and component hierarchy against that plan. Failed checks are returned to the model for repair. `finish_site` distinguishes completed, partial and unsupported work and delivers immediately after its tool batch is complete; a redundant model reply is not required. Budget warnings near the limit tell the model to finish remaining edits and report an honest outcome. The **Tools** tab retains the plan, checks, outcome and actual tool calls. These are structural/HTML checks, **not automated screenshots or browser visual inspection**. Rendered previews should still be reviewed for visual quality.

Existing single-page projects remain unchanged until a structure tool migrates their home content. Auto scope is required for page/component structure changes; existing locked Hero/About edits synchronize with the visible home component. Versions retain the complete page tree. Exports include `public/index.html`, `public/<slug>/index.html` for additional pages, and the standalone server serves those actual routes without dependencies.

The builder has deliberate boundaries: it composes supported components and their layouts; it does not provide arbitrary source-file editing, new backend business APIs, accounts, payments or deployment. A bounded run is staged atomically and can be restored through versions; background job continuation and browser feedback tools remain future work.

### Nine design directions

Each direction changes composition, navigation, hero artwork, content layout and footer treatment. Existing site copy, page type and accent remain unchanged when applying a style. Browsing previews does not save changes or call the model. The DeepSeek agent can inspect the same catalog with `list_styles` and apply a chosen ID with `update_theme`.

| Direction | Distinct composition |
| --- | --- |
| Prism / Glass | Dark split hero, ambient sculpture, translucent surfaces |
| Forma / Editorial | Warm paper, serif typography, asymmetric editorial layout |
| Signal / Expressive | Oversized type, electric contrast, sculptural geometry |
| Still / Minimal | Fixed side navigation, architectural study, indexed lists |
| Grid / Bento | Centered product hero, asymmetric cards, illustrative workspace |
| Block / Brutalist | Bold split panels, heavy borders, offset shadows, poster footer |
| Halo / Aurora | Floating pill navigation, luminous orbital artwork, glass panels |
| Current / Kinetic | Sticky chapter navigation, oversized poster, wide art band, expandable rows |
| Pop / Clay 3D | Pastel sculpture, pill navigation, lifted collection cards, rounded footer |

The style library filters Business, Creative and Commerce directions and offers a full-size preview. Saved toy-store introductions keep their collection text and original brick artwork across all nine directions. All visuals are original local CSS/SVG; the gallery links are references, not asset integrations. Glass directions use CSS/SVG visual treatments and do not claim real DOM refraction. Motion honors reduced-motion preferences.

### Model providers and scope

Website Agent supports **DeepSeek**, optional local Ollama, and an offline rule-based mode. DeepSeek is implemented on the server; the frontend receives only the provider name, model and safe status information. It never receives the API key.

For DeepSeek, copy `.env.example` to `.env.local` in this project directory, then set the provider to `deepseek` and enter your own key:

```dotenv
DEEPSEEK_API_KEY=replace-with-your-own-key
BIZNOVA_MODEL_PROVIDER=deepseek
BIZNOVA_DEEPSEEK_MODEL=deepseek-flash
```

The standalone CLI loads this file automatically on startup. Keep its permissions restricted to your account (`chmod 600 .env.local` on macOS/Linux). `.env.local` is ignored by Git and must be excluded from every delivery archive. A recipient should configure their own key. Existing shell environment variables take precedence over the file.

Restart with `npm run local:start`, then open Website Agent. DeepSeek requests use the official `https://api.deepseek.com/chat/completions` endpoint. New builds and revisions use multi-round tool calling: the model selects functions and receives their results before deciding the next action. Requests send the website brief and relevant structured website fields to DeepSeek; the workspace database, collected contact records, and unrelated files are not uploaded. The API key is used only in the HTTPS authorization header. Errors are sanitized, and paid generation requests are not retried automatically.

The default documented model is `deepseek-flash`; `BIZNOVA_DEEPSEEK_MODEL` can select another model available to your account. Model output is strictly validated and rendered through the nine original design systems. The model customizes website content and the supported structure, but this is not an unrestricted code-execution agent: authentication, payments, commerce and arbitrary layouts require additional implementation. Failed model requests leave saved projects and versions unchanged.

### Tool-calling architecture

The workspace frontend uses React and TypeScript. The local backend is a Node.js HTTP server with SQLite. The website agent is a bounded ReAct-style loop implemented directly in JavaScript using DeepSeek tool calls; it does not depend on LangChain or LangGraph. The model selects tools autonomously within the supported website schema. New DeepSeek builds now start with a plan, compose actual pages and sections, inspect the result and report an explicit outcome. Recent project messages are included as bounded context.

| Tool | Action |
| --- | --- |
| `plan_site` | Record the goal, design notes, implementation steps and required pages/sections |
| `list_sections` | Inspect component types and compatible layouts |
| `add_page`, `update_page`, `remove_page` | Manage pages and their routes |
| `add_section`, `update_page_section` | Add components or change their content, type and layout |
| `move_section`, `remove_section` | Reorder or remove page components |
| `inspect_site` | Check page hierarchy, internal links, declared requirements and rendering |
| `finish_site` | Report completed, partial or unsupported with an explanation |
| `list_styles` | Inspect nine original style directions, their layout traits and default colors |
| `read_site` | Read the current staged website or one section |
| `update_section` | Patch supplied hero, about, footer, contact or brand fields |
| `update_service` | Patch an existing service by index |
| `update_theme` | Change the visual preset, accent color, or explicit page layout (`business` / `toy-store`) |
| `update_navigation` | Update internal navigation labels and section links |
| `validate_site` | Validate the staged website schema |
| `render_preview` | Render HTML and return its size and fingerprint; no browser inspection |

This follows DeepSeek's [tool-calling protocol](https://api-docs.deepseek.com/guides/tool_calls/). Each request allows at most 48 model turns and 128 tool calls, with a shared 600-second limit. Invalid tool arguments become observations the model can correct. Changes are staged in memory, validated, then saved atomically with their version and tool trace. Failed runs leave the saved website unchanged; concurrent edits use revision checks. Successful runs with no actual changes retain the current version. **Versions** can restore prior content.

An explicit `pageType: "toy-store"` selects an original building-toy storefront introduction with collection illustrations and inquiry-oriented copy. The model can select this layout using `update_theme` in Auto or Theme scope. Existing projects without a page type keep their original layout. This introduction layout includes no cart, checkout, prices, inventory or payment processing.

These tools build and modify a declarative page/component tree, rendered by the existing design systems. They do not provide arbitrary file editing, shell execution, package installation, or unrestricted React component generation. Exported websites currently use standalone HTML/CSS/JavaScript with a Node.js backend and SQLite.

To explicitly use the offline builder without removing your key:

```sh
BIZNOVA_MODEL_PROVIDER=local npm run local:start
```

Without a key or model setting, the app defaults to offline presets and explicit field/color/style edits. This mode clearly states that no model is connected. It never silently replaces a failed DeepSeek request with a template result.

For an optional local Ollama model:

```sh
BIZNOVA_MODEL_PROVIDER=ollama BIZNOVA_OLLAMA_MODEL=your-installed-model npm run local:start
```

`BIZNOVA_OLLAMA_URL` accepts only a local loopback HTTP endpoint and defaults to `http://127.0.0.1:11434`. Provider selection is implemented in `local/studio-model.mjs`; the DeepSeek adapter requires no OpenAI SDK. Interface and generated default copy remain English.

### Storage, previews, and exports

- Projects, conversations, versions, and preview inquiries are stored in the `studio_*` tables in `data/biznova.sqlite`, alongside dashboard records.
- Previews run in a sandboxed iframe. Form submissions are relayed after validating the source window and project ID. Exported sites use their own `/api/leads` endpoint and a separate database.
- Exports contain frontend/backend source, configuration, launchers, and a README. They **exclude workspace conversations, API configuration, and previously collected inquiry records**.
- Current backend capabilities cover service health, input validation, and persistent inquiries. Authentication, payments, CMS, inventory, and other business features require further implementation.
- Website Agent APIs currently run only through the standalone Node server started by `npm run local`. The Workers build still targets the dashboard; this feature did not update the cloud deployment.

| File | Responsibility |
| --- | --- |
| `components/studio/website-studio.tsx`, `.css` | Workspace, chat, source, versions, data panels, and responsive previews |
| `local/studio-routes.mjs` | Projects, messages, versions, previews, source, ZIP, and inquiry APIs |
| `local/studio-repository.mjs` | SQLite project storage and version transactions |
| `local/studio-model.mjs` | Provider selection, local rules and model integration |
| `local/studio-agent.mjs` | Bounded tool-calling loop, scoped edits and result observations |
| `lib/studio-styles.ts` | Shared design catalog for frontend, model tools and renderer validation |
| `local/site-style-variants.mjs` | Six structurally distinct additional website compositions |
| `local/site-generator.mjs` | Website rendering and standalone full-stack project generation |
| `tests/studio.test.mjs`, `tests/site-generator.test.mjs` | Generation, validation, versions, ZIPs, forms, and independent startup |

### Design references

The supplied references informed navigation, hero, CTA, footer, motion, depth, and glass treatments. They are inspiration sources rather than connected asset APIs. Generated sites do not contain copied third-party screenshots or paid gallery assets. Their CSS/SVG artwork is original, and runtime resources remain local.

- [Scrolltide](https://www.scrolltide.co/): motion and component hierarchy.
- [Navbar Gallery](https://www.navbar.gallery/): navigation structure.
- [Footer Design](https://www.footer.design/): footer composition and large typography.
- [CTA Gallery](https://cta.gallery/): calls to action.
- [Refero Styles](https://styles.refero.design/): coherent design systems. The working domain uses `styles`, rather than `style`.
- [Supahero](https://supahero.io/): hero composition and storytelling.
- [3dicons](https://3dicons.co/): three-dimensional visual direction. The working name is `3dicons`, rather than `3discons`.
- [Liquid Glass](https://glass.samasante.com/): glass material direction. This implementation uses CSS glass effects and does not claim to reproduce that site's refraction implementation.
