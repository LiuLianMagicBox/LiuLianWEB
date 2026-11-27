# Frontend development and testing

[Project home](../README.md) · [繁體中文（香港）](development.zh-HK.md)

## Run the development servers

Install dependencies with `npm ci` in `website-part` and configure the database and session secret from the [quick start](../README.md#quick-start). Run `npm run dev` for the Express API. In a second terminal in the same directory, run `npm run dev:frontend` for Vite hot reload. Vite uses port 5173 and proxies `/api` and `/connect`, including WebSocket requests under those paths, to `http://127.0.0.1:3000`. Set `WEBSITE_DEV_PROXY` to change the backend target.

## Build and test

Run the following from `website-part`. The full check runs syntax validation, builds the frontend and runs the tests.

```sh
npm run check
```

Use `npm run check:js` for syntax, `npm run build` for the production frontend, or `npm test` for the Node and jsdom suites. Commit rebuilt `public/` files with any frontend changes. CI checks the build on Linux and Windows and exercises the R6 roller endpoints in the Linux runtime image. After changing the API contract, regenerate [OpenAPI](openapi.json) with `npm run docs:api` and update the [API reference](API.md).

## Frontend layout

The website is a multi-page React application built with Vite:

- `frontend/*.html` keeps one entry per guarded route (`/login.html`,
  `/roller.html`, `/admin.html`, ...); Express still authorizes each page before
  it is served, and every entry renders `<App />` from `frontend/src/main.jsx`.
- `frontend/src/pages/` contains one component per page,
  `frontend/src/components/` holds the shared navigation, tabs, modal and toast
  components, and `frontend/src/hooks/` holds the auth, visibility, busy-state
  and toast hooks.
- Framework-independent logic lives next to the components:
  `frontend/src/lib/apiClient.mjs`, `authStore.mjs`, `dialog.mjs`,
  `chromiumSession.mjs`, and `frontend/src/lib/rdp/`.
- `frontend/static/` is the Vite public directory; its CSS, icons, manifest and
  vendored Socket.IO/RDP decoder files are copied to `public/` on build.
- Heavy pages are code-split: `frontend/src/App.jsx` exports `PAGE_LOADERS`
  (dynamic `import()`) and renders them through `React.lazy`/`Suspense`, so the
  login and public share pages do not download the admin, RDP or file-browser
  chunks. `NotFoundPage`, `LoginPage` and `TermsPage` stay in the main bundle.
- `vite-plugins/html-head.mjs` injects the shared `<head>` metadata (icons,
  manifest, theme colour, social preview, and the `noindex` policy for private
  pages) at build time, so `frontend/*.html` only keeps the per-page title,
  stylesheets and entry script.
- A page-level `ErrorBoundary` (`frontend/src/components/ErrorBoundary.jsx`)
  shows a retry screen instead of a blank document when a page throws.

### Design system

`frontend/static/css/style.css` is the single source of truth for the look of
every page. It defines the palette, spacing, radii, elevation and focus tokens
once — brand blue `--brand: #1c6ba0` (matching the PWA `theme-color`) with
`--accent-2: #66d9c5` as the secondary highlight — and then styles the shared
components (buttons, form fields, tabs, tables, badges, modals, toasts, empty
states). `frontend/static/css/files.css` layers the FnOS file browser and public
share screens on top of the same tokens.

### App frame

Authenticated pages render inside a console-style frame: `App.jsx` wraps the page
in `.app-shell` (grid), which holds the navigation rail and `.app-main` (top bar
plus page content).

- The rail lives in `frontend/src/components/NavBar.jsx`: brand, **Main** links,
  then the collapsible **Workspaces**, **Connected websites** and
  **Administration** sections, with the account chip, logout and a collapse
  control pinned to the bottom. Wide screens can fold it down to an icon rail;
  below 1080 px the same rail becomes an overlay drawer opened from the top bar
  (with a backdrop, `Escape` and outside-click closing it).
- The top bar shows the section title from `PAGE_TITLES` in `App.jsx`, so every
  page inherits the same header without repeating markup.
- Page visibility and the per-account remote permission filter the rail and the
  dashboard exactly as they did before.

The dashboard (`frontend/src/pages/DashboardPage.jsx`) follows the same pattern:
a page heading with actions, four KPI cards (upcoming events, your signups,
connected websites, available tools), a two-column row of the priority event list
and the tools list, then a full-width panel with a search/status/sort filter bar,
an event table and pagination.

Page entries reference the stylesheet with a version query
(`/css/style.css?v=...`); bump that value whenever the CSS changes so browsers do
not serve a cached copy after a deployment.

Locale dictionaries live in `frontend/src/locales/zh-HK.mjs` and `zh-CN.mjs`. Use `t()` for interface copy and `message()` for interpolated notifications stored in state so that an open page can change language without losing user input. Frontend tests install jsdom through `test/support/dom-env.mjs` and compile JSX with `test/support/jsx-loader.mjs`.

## Browser tests

After building the frontend, run these commands from `website-part` with a local Chrome or Chromium executable.

```sh
WEBSITE_BROWSER_PATH=/path/to/chrome npm run test:website-browser
RDP_BROWSER_PATH=/path/to/chrome npm run test:rdp-browser
CHROMIUM_TEST_BROWSER_PATH=/path/to/chrome node --test test/chromium_browser.test.js
```

The website smoke test uses local API fixtures and the production CSP to exercise desktop and mobile flows, navigation, retries, login and uploads. Set `WEBSITE_SCREENSHOT_DIR` to save screenshots outside the repository. The RDP smoke test runs a mock Socket.IO server and covers decoder startup, RLE rendering, focus, scaled pointer input, password clearing, cancellation and reconnection. Set `RDP_SCREENSHOT_PATH` to capture the desktop.

The Chromium suite checks isolated browser contexts and the per-session proxy. For test containers without a browser sandbox, the website smoke and Chromium suite respectively support `WEBSITE_BROWSER_NO_SANDBOX=1` and `CHROMIUM_TEST_NO_SANDBOX=1`. Verify actual Windows desktop authentication separately on the deployment host.
