# CHANGELOG — vlk-openspeedtest

> **Read this in English:** [CHANGELOG.en-US.md](CHANGELOG.en-US.md)

Registro de tudo que este fork mudou em relação ao
[OpenSpeedTest](https://github.com/openspeedtest/Speed-Test) original
(base: v2.5.4). Desenvolvido pela Vialink entre 2026-06-24 e 2026-07-05.

> Convenção: as mudanças estão agrupadas por área, não por data — este fork
> não versiona releases; a história detalhada está no log do git.

## Medição (engine — `assets/js/app-2.5.4.js`)

- **Correção: o gráfico ao vivo nunca renderizava.** No início da medição a
  primeira amostra podia ser `Infinity` (`dTotal/dtTotal` com tempo ~0),
  contaminando o `maxValue` do gráfico pelo teste inteiro — todos os pontos
  colapsavam invisíveis. Corrigido com guardas `isFinite` no `Graph()` e no
  `calcPoints` (bug presente no upstream).
- Correção de um bug de precedência de operador herdado do original.
- **Escala do velocímetro dinâmica**, com pré-estimativa de 1,5 s: o gauge se
  ajusta à velocidade real da conexão em vez de saturar em links rápidos;
  rótulo intermediário (0,75·máx) nas escalas até 200.
- **Upload ~160× mais rápido de preparar**: massa de dados gerada com
  `crypto.getRandomValues()` em vez de `Math.random()` (100 MB em
  milissegundos); `ulDataSize` 30 → 100 MB.
- Threads de download/upload 8 → 6 (HTTP/1.1 limita a 6 conexões por origem —
  as threads 7 e 8 nunca rodavam).
- Resultados do teste publicados em `window.vlkResults` para consumo do
  relatório, do PDF e da gravação (o upstream só montava uma URL de redirect).
- **Sem redirects para openspeedtest.com**: o número final não vira link, o
  "Network Error" aponta para o manual local e os créditos/tooltips da marca
  original foram removidos da interface.

## Interface

- **Coluna direita redesenhada** (desktop): card de IP/rede no topo + três
  cards de resultado uniformes com cantos arredondados; gráficos ao vivo
  desenhados dentro dos próprios cards; bloco ping/jitter realocado.
- **Card "SEU IP"**: endereço, ASN e cidade de quem testa, com layout
  adaptativo para IPv6 (endereços longos reorganizam o card).
- **Card "SEU IP" dual-stack** (contribuição de Mauricio Nunes, 2026-07-06):
  quando a conexão tem IPv4 e IPv6, o card mostra os dois endereços
  ("SEU IP - IPv6" / "SEU IP - IPv4"), o relatório e o PDF ganham a linha
  "Endereço IPv4". Detecção do IP primário via `ipapi.co` (fallbacks
  `ipwho.is` → `api64.ipify.org`) e sonda do outro protocolo via
  ipify/icanhazip/ident.me. Coluna direita do desktop reestruturada em
  grupos SVG reposicionáveis; cards em tom `#1f1f1f` no tema escuro.
- **Tema escuro como padrão**, com toggle sol/lua sempre visível (persistência
  em cookie de 365 dias) e logo alternativo por tema quando o tenant tiver.
- **Layout mobile refeito**: faixa superior própria para o menu, card de IP e
  rodapé presentes no mobile, gauge reposicionado (o original sobrepunha
  menu e gauge).
- **Menu** Relatório / Manual / Sobre no canto superior esquerdo.
- **Botão "Testar novamente"** (SVG) substitui a barra de progresso ao final
  do teste.
- **Botão Compartilhar** (só ícone): gera um **PDF do resultado no navegador**
  (jsPDF 2.5.2 vendorizado, sem CDN) e abre o painel nativo de
  compartilhamento (Web Share API); sem suporte, baixa o PDF. Inativo até o
  teste terminar, com feedback ao lado do ícone.
- Rodapé "Powered by Vialink" (desabilitável por tenant).
- Paleta de cores e degradês parametrizados por CSS custom properties (o
  upstream tinha os hex espalhados pelo SVG/CSS).

## Páginas novas

- **`relatorio.html`** — relatório do resultado pronto para imprimir/salvar em
  PDF (1 página A4, sem cabeçalhos do navegador, overlays de extensões
  ocultos); recebe os números por query string a partir do menu.
- **`manual.html`** — como usar, o que significa cada métrica, dicas para um
  teste correto e parâmetros de URL.
- **`sobre.html`** — a origem do fork, o que mudou e o licenciamento.
- **Nota técnica** ("o que o teste realmente mede": banda disponível ≠ banda
  contratada, limites de hardware) no manual, no relatório e no PDF.

## Multi-tenant (vários domínios na mesma instalação)

- **`assets/js/tenants.js`**: cada domínio responde com a própria identidade —
  nome, logo (claro/escuro), cores do gauge e da interface, favicons, título,
  PDF e relatórios. Configuração estática, sem backend.
- Hostname desconhecido (inclusive acesso por IP) cai no tenant padrão;
  override `?tenant=` para testes.
- Tenant incluído no repositório: **Vialink** (tenants adicionais são configuração local de cada instalação).
- Assets organizados por tenant em `assets/tenants/<tenant>/`; imagens gerais
  em `assets/img/`.

## Multi-idioma (i18n)

- Sistema próprio, sem dependências (`assets/js/i18n/`): textos marcados com
  `data-i18n`/`data-i18n-html`, um arquivo de dicionário por idioma,
  placeholders (`{name}` = tenant), troca ao vivo sem recarregar.
- **8 idiomas**: português (pt-BR), inglês (en-US), espanhol (es-ES), francês
  (fr-FR), chinês (zh-CN), japonês (ja-JP), russo (ru-RU) e alemão (de-DE).
- **Seletor de bandeira + sigla** no app (desktop e mobile) e nas páginas.
- Resolução: `?lang=` → cookie (escolha do usuário) → idioma do navegador →
  inglês. Chaves ausentes caem no inglês.
- Tooltips originais do OpenSpeedTest traduzidos em todos os idiomas.
- Idiomas fora do Latin-1 (russo, chinês, japonês) marcam `pdfLatin1: false`
  e o PDF do Compartilhar sai em inglês (a Helvetica do jsPDF não cobre
  esses alfabetos); a interface permanece no idioma.

## Persistência de resultados (opcional)

- **`api/salvar-teste.php`**: cada teste concluído é gravado em MariaDB
  (melhor-esforço — falha nunca afeta o usuário). IP, user agent e hostname
  capturados do request; validação de limites nos números.
- Coluna `site` classifica o domínio chamado; colunas de enriquecimento
  preenchidas por `scripts/enriquecer-netbox.php` (integração com NetBox,
  específica da infraestrutura Vialink).
- Credenciais fora do web root (`/etc/vlk-speedtest/db.ini`).

## Infraestrutura e deploy

- **`.gitlab-ci.yml`**: deploy automático a cada push (runner no próprio
  servidor) + geração do arquivo `downloading` de 100 MB quando ausente.
- `downloading` fora do versionamento (`.gitignore`); `upload` vazio versionado.
- Configuração nginx de referência documentada (upload descartado com 200,
  sem gzip, sem cache, sem access_log, timeouts para modo stress).

## Documentação e licenciamento

- **Manuais de instalação** completos em PT-BR e EN-US
  (`docs/INSTALL.*.md`): nginx e Apache, HTTPS/Let's Encrypt, branding
  multi-tenant, criação de idioma, persistência opcional, troubleshooting.
- `assets/js/i18n/README.md` — guia para contribuir com traduções.
- **`COPYRIGHT.md`** — titularidade por componente; logotipos e marcas
  Vialink/MaisLink **fora da licença MIT**.
- `LICENSE` — MIT do upstream preservada + copyright das modificações
  (© 2026 Vialink).
- Este `CHANGELOG.md`.
