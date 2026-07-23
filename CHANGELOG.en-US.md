# CHANGELOG — vlk-openspeedtest

> **Leia em português:** [CHANGELOG.md](CHANGELOG.md)

A record of everything this fork changed compared to the original
[OpenSpeedTest](https://github.com/openspeedtest/Speed-Test)
(baseline: v2.5.4). Developed by Vialink between 2026-06-24 and 2026-07-05.

> Convention: changes are grouped by area, not by date — this fork does not
> version releases; the detailed history lives in the git log.

## Fast and Complete tests (two buttons)

- The single circular "Start" button was replaced by **two buttons**: **Fast**
  and **Complete** (labels translated per language).
- **Fast** runs only the speed test (download, upload, ping and jitter) — the
  classic Start behavior. It is also the one triggered by **Enter**.
- **Complete** runs the speed test **and then the full network analysis on the
  same page**: when the speed test finishes, the page grows downward to reveal
  the two connectivity tables (your connection + server traceroute), auto-
  scrolling to them. It reuses the Network-tab engine
  (`assets/js/conectividade.js`, now exposed as `window.VLK_CONECT.run`).
- **The report reflects a Complete test**: when a network analysis is present,
  `relatorio.html` appends both connectivity tables after the speed block (data
  passed via `localStorage` + `net=1` in the URL).
- The **Network tab** (`conectividade.html`) still exists as a standalone page.
- The menu **"Network"** item (desktop) was repositioned with more room before
  the Share button.
- **"Report" and "Share" buttons in the Complete response**: at the top of the
  connectivity section, two buttons (a filled and an outlined pill) give direct
  access to the report and to sharing the PDF — the same action as the top-menu
  pill — without forcing the user to scroll back up to the gauge menu.
- **The "Report" button is enabled only after a test has run**: it starts dimmed
  (reduced `opacity`) and the click does not navigate; once the test finishes
  ("All done"), it is re-enabled together with the Share button.
- **Sticky top menu on the Complete test**: since the page grows downward with the
  network results, a fixed nav bar appears at the top as soon as the user scrolls
  (hidden at the top so it doesn't duplicate the speedometer's own menu), keeping
  the Report button reachable at any time.

## Connectivity analysis (`conectividade.html`)

- **New "Network" page** (app menu item): measures **latency, jitter and packet
  loss** to a per-tenant configurable list of destinations
  (`connectivityTargets` in `tenants.js`), in two independent layers:
  - **Client** (`assets/js/conectividade.js`): latency, jitter and failure rate
    for each destination, measured in the browser with timed HTTPS requests via
    `Image()` (robust to `Cross-Origin-Resource-Policy`/ORB, unlike `fetch`
    no-cors). Latency is the **median of the fastest samples** (drops the slowest
    20%) plus the **minimum** (best case). The browser cannot do ICMP/traceroute
    — it is an approximation (upper bound) of the user's real connection experience.
  - **Server** (`api/diagnostico.php`): runs `mtr` (real traceroute/ICMP) and
    returns hops, latency, jitter and **real packet loss** for the route from the
    server to the destination. The client sends only the destination index; the
    host comes from a server-side allowlist (`api/diagnostico-targets.php`),
    never from the request — a guard against command injection/SSRF. Result
    cached for 60 s.
- Degrades gracefully: without the endpoint (or without `mtr`), the server
  section shows "unavailable" and the page keeps working with the client layer.
- **Per-destination measurement** (the client measures what actually matters for
  each): DNS servers via a real **DNS-over-HTTPS query** (~10ms, not the favicon);
  **Netflix via the local OCA** (Open Connect, ~10ms) instead of the AWS-US site
  (~170ms), through `api/netflix-oca.php` (fast.com API proxy; the OCA URL is bound
  to the ASN); other hosts via the canonical form (www, redirect-free). Latency =
  median of the fastest 80% + minimum (best case).
- i18n pt-BR + en-US; installation documented in the manual (§10).

## Measurement (engine — `assets/js/app-2.5.4.js`)

- **Fix: the live graph never rendered.** At the start of a measurement the
  first sample could be `Infinity` (`dTotal/dtTotal` with time ~0), poisoning
  the graph's `maxValue` for the whole test — every point collapsed invisibly.
  Fixed with `isFinite` guards in `Graph()` and `calcPoints` (bug present
  upstream).
- Fixed an operator-precedence bug inherited from the original.
- **Dynamic gauge scale**, with a 1.5 s pre-estimation: the gauge adapts to
  the connection's real speed instead of saturating on fast links;
  intermediate label (0.75·max) on scales up to 200.
- **Upload data ~160× faster to prepare**: the payload is generated with
  `crypto.getRandomValues()` instead of `Math.random()` (100 MB in
  milliseconds); `ulDataSize` 30 → 100 MB.
- Download/upload threads 8 → 6 (HTTP/1.1 caps at 6 connections per origin —
  threads 7 and 8 never ran).
- **Configurable correction factor** (`vlkCorrectionFactor`, default `1.0` = no
  correction): displayed download/upload values are the measurement multiplied
  by this factor; the gauge scale follows. The optional persistence records
  the raw value, without the factor. Set per installation in
  `assets/js/vlk-config-local.js` (not versioned — survives upgrades; see
  `vlk-config-local.example.js`).
- Test results published in `window.vlkResults` for the report, the PDF and
  the recording (upstream only assembled a redirect URL).
- **No redirects to openspeedtest.com**: the final number is no longer a
  link, "Network Error" points to the local manual, and the original brand's
  credits/tooltips were removed from the interface.

## Interface

- **Right column redesigned** (desktop): IP/network card on top + three
  uniform result cards with rounded corners; live graphs drawn inside the
  cards themselves; ping/jitter block relocated.
- **"YOUR IP" card**: address, ASN and city of whoever is testing, with an
  adaptive layout for IPv6 (long addresses rearrange the card).
- **Dual-stack "YOUR IP" card** (contributed by Mauricio Nunes, 2026-07-06):
  when the connection has both IPv4 and IPv6, the card shows both addresses
  ("YOUR IP - IPv6" / "YOUR IP - IPv4") and the report/PDF gain an
  "IPv4 address" row. Primary IP detected via `ipapi.co` (fallbacks
  `ipwho.is` -> `api64.ipify.org`), the other protocol probed via
  ipify/icanhazip/ident.me. Desktop right column restructured into
  repositionable SVG groups; cards use a `#1f1f1f` tone in dark theme.
- **Dark theme by default**, with an always-visible sun/moon toggle
  (365-day cookie persistence) and an alternate per-theme logo when the
  tenant provides one.
- **Mobile layout reworked**: dedicated top strip for the menu, IP card and
  footer present on mobile, gauge repositioned (the original overlapped the
  menu and the gauge).
- **Menu** Report / Manual / About in the top-left corner.
- **"Test again" button** (SVG) replaces the progress bar when the test ends.
- **Share button** (icon-only): generates a **PDF of the result in the
  browser** (jsPDF 2.5.2 vendored, no CDN) and opens the native share sheet
  (Web Share API); without support, downloads the PDF. Inactive until the
  test finishes, with feedback next to the icon.
- "Powered by Vialink" footer (can be disabled per tenant).
- Color palette and gradients parameterized with CSS custom properties (the
  upstream had the hex values scattered across the SVG/CSS).

## New pages

- **`relatorio.html`** — result report ready to print/save as PDF; receives the
  numbers via query string from the menu. The logo repeats at the top of every
  page and the footer shows "N/total" page numbers (a Complete test produces 2
  pages). The `@page` top margin is zeroed so the browser does **not** draw its
  native header (tab title + date) above the content; the top spacing comes from
  the table header padding (which repeats per page).
- **`manual.html`** — how to use it, what each metric means, tips for an
  accurate test and URL parameters.
- **`sobre.html`** — the fork's origin, what changed and the licensing.
- **Technical note** ("what the test really measures": available bandwidth ≠
  subscribed bandwidth, hardware limits) in the manual, the report and the PDF.

## Multi-tenant (multiple domains on one installation)

- **`assets/js/tenants.js`**: each domain answers with its own identity —
  name, logo (light/dark), gauge and interface colors, favicons, title, PDF
  and reports. Static configuration, no backend.
- Unknown hostnames (including access by IP) fall back to the default tenant;
  `?tenant=` override for testing.
- Tenant shipped in the repository: **Vialink** (additional tenants are local configuration of each installation).
- Assets organized per tenant in `assets/tenants/<tenant>/`; general images
  in `assets/img/`.

## Multi-language (i18n)

- Home-grown system, no dependencies (`assets/js/i18n/`): texts marked with
  `data-i18n`/`data-i18n-html`, one dictionary file per language,
  placeholders (`{name}` = tenant), live switching without reload.
- **8 languages**: Portuguese (pt-BR), English (en-US), Spanish (es-ES),
  French (fr-FR), Chinese (zh-CN), Japanese (ja-JP), Russian (ru-RU) and
  German (de-DE).
- **Flag + country-code selector** in the app (desktop and mobile) and on
  the pages.
- Resolution: `?lang=` → cookie (the user's choice) → browser language →
  English. Missing keys fall back to English.
- The original OpenSpeedTest tooltips translated into every language.
- Languages outside Latin-1 (Russian, Chinese, Japanese) set
  `pdfLatin1: false` and the Share PDF comes out in English (jsPDF's
  Helvetica lacks those alphabets); the interface stays in the language.

## Result persistence (optional)

- **`api/salvar-teste.php`**: every completed test is recorded in MariaDB
  (best-effort — a failure never affects the user). IP, user agent and
  hostname captured from the request; bounds validation on the numbers.
- The `site` column classifies the requested domain; enrichment columns
  filled by `scripts/enriquecer-netbox.php` (NetBox integration, specific to
  Vialink's infrastructure).
- Credentials outside the web root (`/etc/vlk-speedtest/db.ini`).

## Infrastructure and deployment

- **`.gitlab-ci.yml`**: automatic deployment on every push (runner on the
  server itself) + generation of the 100 MB `downloading` file when absent.
- `downloading` kept out of version control (`.gitignore`); empty `upload`
  file versioned.
- Reference nginx configuration documented (upload discarded with 200, no
  gzip, no caching, no access_log, timeouts for stress mode).

## Documentation and licensing

- **Complete installation manuals** in PT-BR and EN-US
  (`docs/INSTALL.*.md`): nginx and Apache, HTTPS/Let's Encrypt, multi-tenant
  branding, language creation, optional persistence, troubleshooting.
- `assets/js/i18n/README.md` — guide for contributing translations.
- **`COPYRIGHT.md`** — ownership per component; Vialink/MaisLink logos and
  trademarks **outside the MIT license**.
- `LICENSE` — upstream MIT preserved + copyright of the modifications
  (© 2026 Vialink).
- This `CHANGELOG`.
