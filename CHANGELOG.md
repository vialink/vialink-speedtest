# CHANGELOG — vlk-openspeedtest

> **Read this in English:** [CHANGELOG.en-US.md](CHANGELOG.en-US.md)

Registro de tudo que este fork mudou em relação ao
[OpenSpeedTest](https://github.com/openspeedtest/Speed-Test) original
(base: v2.5.4). Desenvolvido pela Vialink entre 2026-06-24 e 2026-07-05.

> Convenção: as mudanças estão agrupadas por área, não por data — este fork
> não versiona releases; a história detalhada está no log do git.

## Testes Fast e Complete (dois botões)

- O botão circular único de "Start" deu lugar a **dois botões**: **Fast** e
  **Complete** (rótulos traduzidos por idioma — pt-BR "Rápido"/"Completo").
- **Fast** roda apenas o teste de velocidade (download, upload, ping e jitter) —
  o comportamento clássico do Start. Também é o disparado por **Enter**.
- **Complete** roda o teste de velocidade **e, em seguida, a análise de rede
  completa na mesma página**: ao terminar a velocidade, a página cresce para
  baixo revelando as duas tabelas de conectividade (sua conexão + traceroute do
  servidor), com rolagem automática até elas. A engine de rede é a mesma da aba
  Rede (`assets/js/conectividade.js`, agora exposta como `window.VLK_CONECT.run`).
- **Relatório reflete o teste Complete**: quando há análise de rede, o
  `relatorio.html` acrescenta, após o bloco de velocidade, as duas tabelas de
  conectividade (dados passados via `localStorage` + `net=1` na URL).
- A **aba Rede** (`conectividade.html`) continua existindo como página autônoma.
- Item **"Rede"/"Network"** do menu (desktop) reposicionado com mais espaço
  antes do botão Compartilhar.
- **Botão "Relatório" só é habilitado depois que um teste é realizado**: começa
  esmaecido (`opacity` reduzida) e o clique não navega; ao terminar o teste
  ("All done"), é reativado junto com o botão Compartilhar.
- **Menu superior fixo no teste Complete**: como a página cresce para baixo com a
  resposta de rede, uma barra de navegação fixa no topo aparece assim que o
  usuário rola (some no topo para não duplicar o menu do próprio velocímetro),
  mantendo o acesso ao Relatório a qualquer momento.
- **Análise de rede pré-aquecida após o teste Fast**: quando o teste rápido
  termina, o link fica ocioso enquanto o usuário lê o resultado — a única janela
  em que dá para medir latência sem contaminar nada (durante o teste de banda o
  link está saturado, e medir ali daria números de bufferbloat além de roubar
  banda da própria medição). Nessa janela a análise roda **em segundo plano, sem
  aparecer na tela**, e um botão **"Análise de rede"** oferece o resultado já
  pronto: abre a seção **instantaneamente**, sem refazer o teste de velocidade.
  Se o usuário clicar antes de a medição terminar, a seção abre com as linhas
  "aguardando…" e se preenche ao chegar. O resultado fica em `sessionStorage`
  por 3 minutos, então um Complete pedido logo depois também aparece pronto.
  Respeita `navigator.connection.saveData` (não mede em modo de economia).
- **Botões "Relatório" e "Compartilhar" na resposta do Complete**: no topo da
  seção de conectividade, dois botões (pílula preenchida e contornada) dão acesso
  direto ao relatório e ao compartilhamento do PDF — a mesma ação da pílula do
  menu superior —, sem obrigar o usuário a subir até o menu do velocímetro.

## Análise de conectividade (`conectividade.html`)

- **Nova página "Rede"** (item no menu do app): mede **latência, jitter e perda
  de pacotes** até uma lista de destinos configurável por tenant
  (`connectivityTargets` no `tenants.js`), em duas camadas independentes:
  - **Cliente** (`assets/js/conectividade.js`): latência, jitter e taxa de falhas
    de cada destino, medidas no navegador com requisições HTTPS cronometradas via
    `Image()` (robusto a `Cross-Origin-Resource-Policy`/ORB, ao contrário do
    `fetch` no-cors). A latência é a **mediana das amostras mais rápidas** (descarta
    20% de picos) + o **mínimo** (melhor caso). O navegador não faz ICMP/traceroute
    — é uma aproximação (limite superior) da experiência real da conexão do usuário.
  - **Servidor**: `mtr` (traceroute/ICMP real) devolve saltos, latência, jitter e
    **perda de pacotes reais** da rota do servidor até o destino. O cliente envia
    só o índice do destino; o host vem da allowlist server-side
    (`api/diagnostico-targets.php`), nunca do request — trava contra injeção de
    comando/SSRF. Essa medição é **igual para todos os clientes** (é propriedade
    da rota, não da conexão de quem testa), então quem executa o `mtr` é um
    **cron de 5 em 5 minutos** (`scripts/atualizar-diagnostico.php`, os 9
    destinos em paralelo, gravação atômica) e o endpoint `api/diagnostico.php`
    **só lê o cache**. Antes cada requisição rodava o seu `mtr`, prendendo um
    worker do PHP-FPM por até 25 s — com cache frio e testes simultâneos o pool
    saturava. Agora a camada do servidor aparece na hora e a carga de `mtr` é
    constante. O endpoint recusa cache com mais de 30 min (se o cron parar, a
    seção diz "indisponível" em vez de mostrar medição velha como se fosse
    atual) e a interface informa a idade da medição.
- Degrada com elegância: sem o endpoint (ou sem `mtr`), a seção do servidor
  mostra "indisponível" e a página segue funcionando só com a camada do cliente.
- **Medição por tipo de destino** (o cliente mede o que de fato importa em cada um):
  servidores de DNS por uma **query DNS-over-HTTPS** real (~10ms, não o favicon);
  **Netflix pela OCA local** (Open Connect, ~10ms) em vez do site em AWS-EUA (~170ms),
  via `api/netflix-oca.php` (proxy da API do fast.com; a URL da OCA é ligada ao ASN);
  demais hosts pela forma canônica (www, sem redirect). Latência = mediana dos 80%
  mais rápidos + mínimo (melhor caso).
- i18n pt-BR + en-US; instalação documentada no manual (§10).

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
- **Fator de correção configurável** (`vlkCorrectionFactor`, default `1.0` = sem
  correção): os valores de download/upload apresentados são a medição
  multiplicada por esse fator; a escala do velocímetro acompanha. A
  persistência opcional grava o valor bruto, sem o fator. Configurado por
  instalação em `assets/js/vlk-config-local.js` (não versionado — sobrevive
  a upgrades; ver `vlk-config-local.example.js`).
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
  PDF; recebe os números por query string a partir do menu. Logo repetido no
  topo de cada página e numeração "N/total" no rodapé (teste Complete gera 2
  páginas). Margem superior do `@page` zerada para o navegador **não** desenhar
  seu cabeçalho nativo (título da aba + data) acima do conteúdo; o espaço no topo
  vem do padding do cabeçalho da tabela (que repete por página).
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
