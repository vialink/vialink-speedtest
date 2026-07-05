# CHANGELOG — vlk-openspeedtest

> **Leia em português:** [CHANGELOG.md](CHANGELOG.md)

A record of everything this fork changed compared to the original
[OpenSpeedTest](https://github.com/openspeedtest/Speed-Test)
(baseline: v2.5.4). Developed by Vialink between 2026-06-24 and 2026-07-05.

> Convention: changes are grouped by area, not by date — this fork does not
> version releases; the detailed history lives in the git log.

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
- Test results published in `window.vlkResults` for the report, the PDF and
  the recording (upstream only assembled a redirect URL).
- **No redirects to openspeedtest.com**: the final number is no longer a
  link, "Network Error" points to the local manual, and the original brand's
  credits/tooltips were removed from the interface.

## Interface

- **Right column redesigned** (desktop): IP/network card on top + three
  uniform result cards with rounded corners; live graphs drawn inside the
  cards themselves; ping/jitter block relocated.
- **"YOUR IP" card**: address, ASN and city of whoever is testing (via
  `ipapi.co`), with an adaptive layout for IPv6 (long addresses rearrange
  the card).
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

- **`relatorio.html`** — result report ready to print/save as PDF (single A4
  page, no browser headers, extension overlays hidden); receives the numbers
  via query string from the menu.
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
