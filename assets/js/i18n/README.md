# Traduções (i18n) / Translations

O velocímetro é multi-idioma. Cada idioma é **um único arquivo JS** nesta pasta,
com todos os textos da interface, dos tooltips, do relatório/PDF e das páginas
(manual, sobre, relatório).

The speed test is multi-language. Each language is **a single JS file** in this
folder, containing every text of the UI, tooltips, report/PDF and pages.

## Como o idioma é escolhido / How the language is picked

1. `?lang=<código>` na URL (para testes — ex.: `?lang=en-US`)
2. Cookie `vlk_lang` (escolha feita pelo usuário no seletor de bandeira)
3. Idioma do navegador (`navigator.languages`) — casa exato, depois pelo prefixo
   (`pt` → `pt-BR`)
4. Fallback: `en-US`

Chaves ausentes em um dicionário caem no `en-US` — por isso o `en-US.js` é o
dicionário de referência e deve estar sempre completo.

## Adicionar um novo idioma / Adding a new language

1. **Copie `en-US.js`** para `<código>.js` (ex.: `it-IT.js`) e traduza os
   valores. Preserve os placeholders `{name}`, `{d}`, `{dd}` etc. e a marcação
   HTML (`<strong>`, `<a>`, `<code>`) das chaves usadas com `data-i18n-html`.
2. Ajuste o cabeçalho do `register()`:
   - `code`: código BCP 47 (ex.: `it-IT`)
   - `country`: sigla exibida ao lado da bandeira (ex.: `IT`)
   - `name`: nome do idioma no próprio idioma (ex.: `Italiano`)
   - `flag`: caminho da bandeira (passo 3)
   - `locale`: locale para formatação de números e datas (ex.: `it-IT`)
   - `pdfLatin1: false` **somente** se o idioma usa caracteres fora do Latin-1
     (cirílico, chinês, japonês...) — a Helvetica embutida do jsPDF não os
     cobre, então o PDF do Compartilhar cai no inglês (a interface continua
     no idioma). Ver `ru-RU.js`/`zh-CN.js`/`ja-JP.js`.
3. **Crie a bandeira** em `assets/img/flags/<país>.svg` (viewBox `0 0 20 14`,
   cantos `rx="1.5"` — use `br.svg`/`us.svg` como modelo; formas simples, legível
   em 14×10 px).
4. **Inclua o script** nas 4 páginas, depois dos dicionários existentes:
   `index.html`, `relatorio.html`, `manual.html` e `sobre.html`:
   ```html
   <script src="/assets/js/i18n/it-IT.js"></script>
   ```
   (no `index.html` o caminho é relativo: `assets/js/i18n/it-IT.js`)

Pronto — o seletor de bandeira lista o idioma automaticamente, na ordem em que
os scripts são carregados. / That's it — the flag selector picks the language up
automatically, in script load order.

## Onde os textos são usados / Where strings are used

| Prefixo | Uso |
|---|---|
| `app.*` | Interface principal (menu, cards, botões do app.svg) |
| `status.*` | Mensagens durante o teste (app-2.5.4.js) |
| `tip.*` | Tooltips ao parar o mouse sobre os elementos |
| `share.*` / `pdf.*` | Botão Compartilhar e PDF gerado |
| `report.*` / `manual.*` / `about.*` | Páginas HTML |
| `tech.*` | Nota técnica (manual + relatório) |
| `common.*` | Textos compartilhados (voltar, formato de data) |
