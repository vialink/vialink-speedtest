# Vialink Speedtest

Self-hosted, **multi-tenant**, **multi-language** network speed test — a fork
of [OpenSpeedTest™](https://github.com/openspeedtest/Speed-Test). 100% static
files (HTML, CSS, JavaScript and SVG): no build step, no Node.js, no mandatory
backend — any web server will do.

> 🇧🇷 **Português:** [README.pt-BR.md](README.pt-BR.md) ·
> [Manual de instalação](docs/INSTALL.pt-BR.md) · [Changelog](CHANGELOG.md)

<p align="center">
  <img src="docs/img/screenshot-desktop.png" alt="Speed test — desktop, dark theme" width="68%">
  <img src="docs/img/screenshot-mobile.png" alt="Speed test — mobile" width="23%">
</p>

## Highlights

- **Multi-tenant** — several domains on the same installation, each with its
  own logo (light/dark), colors, favicon, title and reports; static
  configuration in [`assets/js/tenants.js`](assets/js/tenants.js).
- **8 languages** — English, Portuguese, Spanish, French, Chinese, Japanese,
  Russian and German, with a flag selector, browser-language detection and a
  cookie-stored preference. [Contribute your language](assets/js/i18n/README.md)
  — it's a single JS file.
- **Fast & Complete tests** — the classic speed test, or a **Complete** run
  that also measures **network health**: latency, jitter and packet loss to
  popular destinations (Google, Netflix, WhatsApp, DNS resolvers…), from **two
  vantage points** — the browser *and* the server (real `traceroute`/ICMP).
- **Report and PDF** — printable report page (speed **and** network) and a PDF
  generated in the browser (vendored jsPDF, no CDN), shareable through the
  phone's native share sheet.
- **IP/provider card**, **dynamic** gauge scale, dark theme by default,
  dedicated mobile layout.
- **Fixes over upstream** — a live graph that never rendered, upload payload
  ~160× faster to prepare, threads tuned to HTTP/1.1 — all documented in the
  [CHANGELOG](CHANGELOG.en-US.md).
- **Optional persistence** of results (PHP + MariaDB) for history and
  internal reporting.
- **Privacy** — the server sends nothing to third parties; the test runs
  against *your* infrastructure.

<p align="center">
  <img src="docs/img/screenshot-network.png" alt="Complete test — network analysis (client + server layers)" width="46%">
  <img src="docs/img/screenshot-idiomas.png" alt="Language selector (8 languages)" width="46%">
</p>

## Self-hosting

Complete manual (nginx and Apache, HTTPS with Let's Encrypt, multi-tenant
branding, language creation, optional persistence and troubleshooting):

- **English:** [docs/INSTALL.en-US.md](docs/INSTALL.en-US.md)
- **Português:** [docs/INSTALL.pt-BR.md](docs/INSTALL.pt-BR.md)

In short: clone, generate the download blob
(`dd if=/dev/urandom of=downloading bs=1M count=100`), apply the web-server
configuration from the manual and you're done.

## Contributing

Contributions are welcome — especially **new languages** (one dictionary file
+ one SVG flag) and fixes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License and trademarks

- Code under the **MIT** license — © 2013–2023 OpenSpeedTest™ (original
  project) and © 2026 [Vialink](https://vialink.com.br) (fork modifications).
  See [LICENSE](LICENSE) and [COPYRIGHT.md](COPYRIGHT.md).
- **The Vialink and MaisLink logos, names and colors are not MIT** — when
  hosting publicly, configure a tenant with your own brand
  ([manual, §6](docs/INSTALL.en-US.md#6-branding--logo-colors-and-domains-tenants)).
- OpenSpeedTest™ is a trademark of the original project. This fork is not
  affiliated with OpenSpeedTest; improvements of general interest can be
  proposed back to the
  [original project](https://github.com/openspeedtest/Speed-Test).
