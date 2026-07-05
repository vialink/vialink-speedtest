# Contribuindo / Contributing

Obrigado pelo interesse! / Thanks for your interest!

## 🌍 Novos idiomas / New languages

A contribuição mais bem-vinda. Cada idioma é **um único arquivo JS** + uma
bandeira SVG — passo a passo completo em
[`assets/js/i18n/README.md`](assets/js/i18n/README.md).

The most welcome contribution. Each language is **a single JS file** + an SVG
flag — full walkthrough in [`assets/js/i18n/README.md`](assets/js/i18n/README.md).

Checklist do PR de tradução / Translation PR checklist:

- [ ] `assets/js/i18n/<código>.js` copiado do `en-US.js`, com `code`,
      `country`, `name`, `flag` e `locale` corretos (e `pdfLatin1: false` se
      o idioma usa caracteres fora do Latin-1);
- [ ] Placeholders (`{name}`, `{d}`, `{dd}`…) e marcação HTML
      (`<strong>`, `<a>`, `<code>`) preservados;
- [ ] Bandeira em `assets/img/flags/` (viewBox `0 0 20 14`, `rx="1.5"`);
- [ ] `<script>` adicionado nas 4 páginas (`index.html`, `relatorio.html`,
      `manual.html`, `sobre.html`);
- [ ] Testado com `?lang=<código>`: interface, tooltips, as 3 páginas e o
      seletor de bandeira.

## 🐛 Correções e melhorias / Fixes and improvements

- O projeto é **JavaScript puro, sem build e sem dependências** (exceção:
  jsPDF vendorizado). Mantenha assim. / The project is **vanilla JavaScript,
  no build step, no dependencies** (exception: vendored jsPDF). Keep it that way.
- Descreva como validou (o manual de instalação explica como rodar
  localmente). / Describe how you validated (the install manual explains how
  to run locally).
- Melhorias de interesse geral ao teste em si podem caber melhor no
  [OpenSpeedTest original](https://github.com/openspeedtest/Speed-Test) —
  considere propor lá também. / General-interest improvements to the test
  itself may belong upstream — consider proposing them there too.

## 🚫 O que não aceitamos / What we don't accept

- Alterações aos logotipos, nomes ou cores **Vialink**/**MaisLink** — são
  marcas registradas, fora da licença MIT (ver [COPYRIGHT.md](COPYRIGHT.md)).
  Para usar a sua marca, configure um tenant próprio
  ([manual](docs/INSTALL.pt-BR.md)). / Changes to the **Vialink**/**MaisLink**
  logos, names or colors — they are trademarks, outside the MIT license (see
  [COPYRIGHT.md](COPYRIGHT.md)). To use your own brand, configure your own
  tenant ([manual](docs/INSTALL.en-US.md)).
- Dependências externas, CDNs ou build steps. / External dependencies, CDNs
  or build steps.
