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
- **Network analysis pre-warmed after the Fast test**: when the quick test ends,
  the link sits idle while the user reads the result — the only window in which
  latency can be measured without contaminating anything (during the bandwidth
  test the link is saturated, so measuring there would yield bufferbloat numbers
  *and* steal bandwidth from the measurement itself). In that window the analysis
  runs **in the background, with nothing on screen**, and a **"Network analysis"**
  button offers the finished result: it opens the section **instantly**, without
  re-running the speed test. If the user clicks before the measurement finishes,
  the section opens with "pending…" rows and fills in on arrival. The result is
  kept in `sessionStorage` for 3 minutes, so a Complete run requested right after
  also shows up ready. Respects `navigator.connection.saveData`.
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

## Connection quality (`assets/js/qualidade.js`)

Three measurements derived from the speed test itself, at **no extra time
cost** — shown in both modes (Fast and Complete) right below the gauge, and
also in the report and the PDF.

- **Latency under load (bufferbloat).** The test's ping is measured on an idle
  link, which is precisely the condition nobody complains about. Latency is now
  also measured **during the download and during the upload**, and the increase
  over idle gets a grade from **A+ to F** (same scale as Waveform/DSLReports,
  so results are comparable) plus an **RPM** reading (round trips per minute
  under load, in the spirit of RFC 9097). This is the number that explains "the
  connection is fast but calls freeze when someone downloads a file".
- **Initial burst vs. sustained.** Compares the first seconds with the end of
  the test and flags *speedboost* plans, whose average hides the real speed of
  a long download. A burst is only reported when the initial stretch is
  **entirely** above the sustained speed — without that, a connection that
  merely oscillates would be labelled as burst, the opposite diagnosis.
- **Stability.** Coefficient of variation, median, minimum and a count of
  **drops** (blocks longer than 1 s below half the median) over the instant
  throughput series. TCP ramp-up and the burst itself are excluded from the
  calculation: falling from 300 to 100 Mbps because the boost ended is the
  plan, not network instability.
- The latency probe goes out over **another domain of the same installation**
  when the tenant has more than one: over HTTP/1.1 browsers cap connections at
  6 per origin and the test already uses all 6 — probing the same origin would
  measure the browser's own queue. With a single domain the probe stays on the
  same origin and the interface says the number may look pessimistic.
- Results live in `window.vlkQos`, published along with the new **`vlk:results`**
  event (fired when the numbers actually exist — the "All done" status text
  shows up seconds earlier).

## Single connection vs. multiple connections (`assets/js/single-connection.js`)

The test opens **6 parallel connections** and adds up what they all bring — the
right measure for "how much fits in the link", and how every speed test works.
Yet almost nothing a subscriber actually does uses 6 connections: downloading a
file, updating a game, uploading a backup or restoring a dump are all **one TCP
flow**. When a single flow delivers far less than the six together, the real
experience lands below the advertised number — and the customer is right to
complain even though the test "looks fine".

- A fourth card in the quality section shows **what 1 connection delivers**, what
  the 6 test connections delivered and the **ratio** between them, with a verdict
  in four bands (full / partial / limited / severe) and the likely causes:
  **per-flow policer**, **TCP window too small** for the link latency, or an
  **overloaded NAT/CGNAT**.
- **Effective TCP window** (bandwidth × RTT), shown when there is something to
  explain. If it sits at **64 KB**, the interface calls out a window without
  *window scaling* — a diagnosis no amount of contracted bandwidth fixes. The
  alarm band is deliberately narrow around 64 KB: a merely *small* window is the
  normal result of low bandwidth at low latency, and flagging it there would
  point at the wrong cause.
- The measurement runs **after** the test, in the window where the link sits idle
  while the user reads the result — the same idea as the network-analysis
  pre-warm, which now waits for it (running both together would contaminate each
  other: one saturates the link, the other measures latency). It takes ~6 s of
  download, with a volume cap so fast links do not waste traffic, and the card
  holds its place with a "measuring…" placeholder so the layout does not jump.
- The comparison is **sustained against sustained**: the reference is the speed
  at the end of the test (the same one the turbo card uses), not the displayed
  average — so the plan's initial turbo is not credited as a "single-flow gap".
- It also reaches the **report** and the **PDF**, and can be stored in the
  database (`single_*` columns and `api/salvar-single.php`, both optional).
- Result in `window.vlkSingle` and in the **`vlk:single`** event.

## Usage profiles (`assets/js/perfis.js`)

One grade per type of use — **video calls, 4K streaming, online gaming, remote
work and VoIP calling** — derived from measurements the test already took. No
new stage, no extra time: it is a re-reading of speed, latency, jitter, latency
under load, stability and what a single flow delivers. Shown in both modes (Fast
and Complete), above connection quality, and also in the report and the PDF.

- **Each profile is graded by its worst criterion, not by the average.** A
  500 Mbps link with 300 ms of latency under load is terrible for video calls;
  averaging "great bandwidth" with "bad latency" would return "good" — wrong in
  exactly the case the subscriber complains about. The criterion that pulled the
  grade down is shown as the **limiting factor**: that is what to fix.
- **Each profile looks at the direction that matters to it.** Streaming weighs
  *download* stability (an oscillating upload does not bother a viewer), remote
  work weighs *upload* and what a **single flow** delivers, gaming weighs
  latency, jitter and latency under load, video calls weigh upload and
  bufferbloat.
- **Estimated voice MOS** with the **E-model (ITU-T G.107)**, computed twice:
  with the link idle and **with the link busy** — the gap between the two is
  what explains the call that only breaks up while someone is downloading. The
  assumptions (G.711 with PLC, one-way delay ≈ RTT/2, jitter buffer ≈ 2× jitter
  + 20 ms) are stated in the code. Since the E-model is lenient toward pure
  delay, loss and jitter are also criteria of their own, with a stricter ruler.
- **What was not measured does not count:** without the quality measurement the
  profiles are flagged as partial (valid for the idle network).
- **Nothing is stored in the database** — profiles are derived from columns that
  already exist, and the report recomputes them with the same module so screen
  and report cannot diverge.
- Thresholds come from the services' own public recommendations (Zoom, Meet,
  Netflix) and from rulers already used here; where sources disagree, the
  stricter value wins. All of them live in the `PERFIS` table, with a comment on
  the reasoning.

## Connection diagnostics (`assets/js/diagnostico-rede.js`)

Three checks at the top of the connectivity analysis, answering complaints that
speed alone never explains. They run alongside the network analysis (Complete,
or the Fast test's pre-warm) and reach the report page and the PDF.

- **NAT type / CGNAT.** Compares the address and port a STUN server sees (UDP)
  with the IP that reaches the server (TCP). It recognises **CGNAT** (RFC 6598's
  100.64/10 range, or UDP and TCP leaving through different addresses) and
  **symmetric NAT** — the same local port mapped to different public ports per
  destination, which is what prevents direct connections in gaming, VoIP and
  video calls. It spells out why the camera can't be reached from outside and why
  CAPTCHAs keep showing up. STUN servers are configurable per tenant
  (`stunServers`), including turning the check off.
- **Path MTU** (new `api/conexao.php` endpoint). The browser cannot measure it —
  HTTP does not choose packet size and ICMP is out of reach — but the server's
  kernel negotiated this connection's MSS and knows the answer. 1500 is standard,
  1492 is PPPoE (normal on carrier links), lower than that means a tunnel/VPN on
  the path, and it is the classic cause of pages that load halfway and downloads
  that stall. The same endpoint returns the **RTT measured by the kernel** —
  latency with no probe at all.
- **DNS resolution time**, from the Resource Timing API, compared with the query
  time to the public resolvers the analysis already measures. This is the delay
  that lands before the first byte and makes browsing feel slow while speed is
  perfectly fine. When the name was already cached, the result is *not measured*
  — rather than reporting 0 ms, which would mislead.

Method details that keep the diagnosis honest:

- The UDP × TCP comparison only applies when the server is at a **public
  address** and both are in the **same family** (IPv4/IPv6): without those
  guards, every installation on a local network and every dual-stack client
  would be flagged as CGNAT.
- The diagnostics do **not depend** on the connectivity analysis: they wait for
  it to gain the DNS reference, but with a time cap — if the analysis never
  answers, the diagnostics are reported anyway.
- We do not report **which** resolver the client uses: that would require seeing
  the query arrive at the authoritative server, which is beyond the browser.
- **In the report**, the diagnostics table is the only one with a free-text
  column: with no exception to the numeric columns' `white-space: nowrap`, the
  sentence would not wrap and the table ran past the sheet's width. On phones it
  becomes **stacked blocks** (check, verdict and explanation one under the
  other), and the connectivity tables — numeric, and only readable by comparing
  rows — now scroll **inside the table** instead of making the whole page scroll
  sideways.

## Who the IP is assigned to (`assets/js/whois-ip.js`)

- **A third line in the IP card**, right below the ASN and right-aligned: the
  name of whoever holds that address's block, according to the **public
  registry**.
- **Not the same as the ASN**, and the difference is exactly the interesting
  case: the ASN is the network owner, while the block may be **sub-allocated**
  (REASSIGNED) to another company. An address inside `187.45.160.0/20` reads
  *Vialink Soluções de Tecnologia Ltda*; one inside the `187.45.173.0/25`
  sub-block, under the same ASN, reads *Mais Link Telecomunicação Ltda.* — that
  granularity is what answers "whose IP is this".
- **RDAP, not classic whois**: traditional whois is free-form text (one format
  per RIR) served on port 43, out of reach for a browser. RDAP is standard
  HTTP+JSON (RFC 7483) and RIR servers send `Access-Control-Allow-Origin: *`, so
  the client can query it directly, with no proxy. Since each visitor queries
  from their own source IP, rate limiting is not concentrated on a single
  address either — which is what a proxy of ours would do.
- **Picking the right role matters**: we use the `registrant`, never the `abuse`
  or `technical` contact — in the sub-block above, abuse points at the **parent**
  provider and technical at an individual; either would give the wrong answer.
  Within the role, entities with `kind: org` come first (RIPE returns the
  maintainer object as a second `registrant`).
- **Never gets in the way**: the query is async and arrives after the card is
  already filled in; if the RIR is slow, down or rate-limiting, the card stays
  exactly as it was and nothing shows up in the console. Private, loopback and
  CGNAT addresses are not queried. The result is kept in `sessionStorage` so the
  lookup is not repeated on every test.
- **Long names do not overflow**: the font shrinks to a floor and only then is
  the text truncated — the full name stays in the tooltip. The card grows and
  the results column follows; without the line, the layout goes back to what it
  was.
- **Also in the report and the PDF**, as an "Assigned to" row right below the
  provider (in both, the row only exists when the lookup returned something).
  There it shows up on dual-stack too: the card's restriction is about space,
  and a document has no such competition.
  - Along the way, the PDF's vertical offset stopped being hand-written in two
    places (`+9 if there is an IPv4`) and is now derived from the **row count** —
    with two optional rows, a hand-kept number is a bug waiting to happen.
- **Per-tenant configuration**: `rdapEndpoint` points at a different RDAP server
  and `rdapEndpoint: ''` turns the lookup off — it is the only third-party call
  this line makes.

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
  - **Server**: `mtr` (real traceroute/ICMP) returns hops, latency, jitter and
    **real packet loss** for the route from the server to the destination. The
    client sends only the destination index; the host comes from a server-side
    allowlist (`api/diagnostico-targets.php`), never from the request — a guard
    against command injection/SSRF. This measurement is **the same for every
    client** (it is a property of the route, not of the tester's connection), so
    `mtr` is run by a **cron job every 5 minutes**
    (`scripts/atualizar-diagnostico.php`, all 9 destinations in parallel, atomic
    writes) and the `api/diagnostico.php` endpoint **only reads the cache**.
    Previously every request ran its own `mtr`, holding a PHP-FPM worker for up
    to 25 s — with a cold cache and concurrent tests the pool saturated. Now the
    server layer appears instantly and the `mtr` load is constant. The endpoint
    refuses cache older than 30 min (if the cron stops, the section says
    "unavailable" instead of showing a stale measurement as the current state),
    and the UI reports the measurement's age.
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
