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

## Qualidade da conexão (`assets/js/qualidade.js`)

Três medidas derivadas do próprio teste de velocidade, **sem custo de tempo
adicional** — aparecem nos dois modos (Fast e Complete), logo abaixo do
velocímetro, e também no relatório e no PDF.

- **Latência sob carga (bufferbloat).** O ping do teste é medido com o link
  ocioso, que é a condição em que ninguém reclama. Agora a latência também é
  medida **durante o download e durante o upload**, e o aumento sobre a ociosa
  ganha nota **A+ a F** (mesma régua do Waveform/DSLReports, para permitir
  comparação) mais uma leitura em **RPM** (idas e voltas por minuto sob carga,
  no espírito do RFC 9097). É o número que explica "a internet é rápida mas a
  chamada trava quando alguém baixa arquivo".
- **Turbo inicial (burst vs. sustentado).** Compara os primeiros segundos com o
  fim do teste e sinaliza planos com *speedboost*, cuja média esconde a
  velocidade real de um download longo. Só reporta turbo quando o trecho
  inicial está **inteiro** acima do sustentado — sem isso, uma conexão que
  oscila seria rotulada de turbo, que é o diagnóstico oposto.
- **Estabilidade.** Coeficiente de variação, mediana, mínimo e contagem de
  **quedas** (blocos de mais de 1 s abaixo de metade da mediana) sobre a série
  de throughput instantâneo. O trecho de rampa do TCP e o próprio turbo são
  descartados do cálculo: cair de 300 para 100 Mbps porque o boost acabou é o
  plano, não oscilação da rede.
- A sonda de latência sai por **outro domínio da mesma instalação** quando o
  tenant tem mais de um: em HTTP/1.1 o navegador limita 6 conexões por origem e
  o teste já usa as 6 — sondar a mesma origem mediria a fila do próprio
  navegador. Havendo um único domínio, a medição segue pela mesma origem e a
  interface avisa que o número pode sair pessimista.
- Os resultados ficam em `window.vlkQos`, publicados junto com o novo evento
  **`vlk:results`** (disparado quando os números existem de fato — o texto
  "All done" do status aparece segundos antes disso).

## Conexão única × múltiplas conexões (`assets/js/single-connection.js`)

O teste abre **6 conexões** em paralelo e soma o que todas trazem — é a medida
certa de "quanto cabe no link", e é assim que todo speed test funciona. Só que
quase nada do que o assinante faz usa 6 conexões: baixar um arquivo, atualizar
um jogo, subir um backup e restaurar um dump são **um fluxo TCP**. Quando um
fluxo sozinho entrega muito menos que os seis juntos, a experiência real fica
abaixo do número anunciado — e o cliente tem razão ao reclamar mesmo com o teste
"dando certo".

- Um quarto card na seção de qualidade mostra **o que 1 conexão entrega**, o que
  as 6 do teste entregaram e a **proporção** entre os dois, com veredito em
  quatro faixas (entrega tudo / parcial / limitada / severa) e as causas
  prováveis: **policer por fluxo**, **janela TCP pequena** para a latência do
  enlace, ou **NAT/CGNAT sobrecarregado**.
- **Janela TCP efetiva** (banda × RTT) exibida quando há o que explicar. Se ela
  encosta em **64 KB**, a interface aponta janela sem *window scaling* — um
  diagnóstico que nenhuma banda contratada resolve. A faixa de alarme é estreita
  em torno dos 64 KB de propósito: janela apenas *pequena* é o resultado normal
  de pouca banda com latência baixa, e acusar ali seria apontar a causa errada.
- A medição roda **depois** do teste, na janela em que o link fica ocioso
  enquanto o usuário lê o resultado — a mesma ideia do pré-aquecimento da
  análise de rede, que agora espera por ela (as duas juntas se contaminariam:
  uma satura o link, a outra mede latência). São ~6 s de download, com teto de
  volume para não desperdiçar tráfego em links rápidos, e o card reserva seu
  lugar com um cartão "medindo…" para o layout não saltar.
- A comparação é **sustentado contra sustentado**: a referência é a velocidade
  do fim do teste (a mesma que o card de turbo usa), não a média exibida — assim
  o turbo inicial do plano não é creditado como "diferença de fluxo único".
- Entra também no **relatório** e no **PDF**, e pode ser gravada no banco
  (colunas `single_*` e endpoint `api/salvar-single.php`, ambos opcionais).
- Resultado em `window.vlkSingle` e no evento **`vlk:single`**.

## Perfis de uso (`assets/js/perfis.js`)

Uma nota por tipo de uso — **videochamada, streaming 4K, jogos online, home
office e telefonia VoIP** — derivada das medições que o teste já fez. Sem etapa
nova, sem custo de tempo: é releitura da velocidade, da latência, do jitter, da
latência sob carga, da estabilidade e do que um fluxo único entrega. Aparece nos
dois modos (Fast e Complete), acima da qualidade da conexão, e também no
relatório e no PDF.

- **A nota de cada perfil é o pior critério, não a média deles.** Um link de
  500 Mbps com 300 ms de latência sob carga é péssimo para videochamada; a média
  entre "banda ótima" e "latência ruim" devolveria "bom" — erraria justamente no
  caso em que o assinante reclama. O critério que puxou a nota para baixo é
  exibido como **fator limitante**: é nele que se mexe para melhorar.
- **Cada perfil olha o sentido que lhe interessa.** Streaming pesa a
  estabilidade do *download* (upload oscilando não atrapalha quem assiste), home
  office pesa o *upload* e o que **um fluxo só** entrega, jogos pesam latência,
  jitter e latência sob carga, videochamada pesa upload e bufferbloat.
- **MOS estimado para voz** pelo **E-model (ITU-T G.107)**, calculado duas
  vezes: com o link livre e **com o link ocupado** — a diferença entre os dois é
  o que explica a ligação que só pica quando alguém está baixando algo. As
  premissas (G.711 com PLC, atraso em um sentido ≈ RTT/2, jitter buffer ≈ 2×
  jitter + 20 ms) estão declaradas no código. Como o E-model é tolerante ao
  atraso puro, perda e jitter entram também como critérios próprios, com régua
  mais dura.
- **O que não foi medido não entra na conta:** sem a medição de qualidade, os
  perfis saem marcados como parciais (valem para a rede livre).
- **Nada é gravado no banco** — os perfis são derivados de colunas que já
  existem, e o relatório os recalcula com o mesmo módulo, para tela e relatório
  não divergirem.
- Limiares vindos das recomendações públicas dos próprios serviços (Zoom, Meet,
  Netflix) e das réguas já usadas aqui; onde as fontes divergem, fica o valor
  mais exigente. Todos reunidos na tabela `PERFIS`, com o comentário do porquê.

## Diagnóstico da conexão (`assets/js/diagnostico-rede.js`)

Três verificações no topo da análise de conectividade, que respondem a queixas
que a velocidade não explica. Rodam junto da análise de rede (Complete, ou o
pré-aquecimento do Fast) e vão para o relatório e o PDF.

- **Tipo de NAT / CGNAT.** Compara o endereço e a porta que um servidor STUN
  enxerga (UDP) com o IP que chega ao servidor (TCP). Reconhece **CGNAT** (faixa
  100.64/10 da RFC 6598, ou saídas UDP e TCP por endereços diferentes) e **NAT
  simétrico** — a mesma porta local mapeada em portas públicas diferentes por
  destino, que é o que impede conexão direta em jogos, VoIP e videochamada.
  Explica, com todas as letras, por que não dá para acessar a câmera de fora e
  por que aparece tanto CAPTCHA. Servidores STUN configuráveis por tenant
  (`stunServers`), incluindo desligar a checagem.
- **MTU do caminho** (novo endpoint `api/conexao.php`). O navegador não tem como
  medir — HTTP não escolhe tamanho de pacote e ICMP está fora de alcance —, mas o
  kernel do servidor negociou a MSS desta conexão e sabe a resposta. 1500 é o
  padrão, 1492 é PPPoE (normal em operadora), abaixo disso denuncia túnel/VPN, e
  é a causa clássica de site que abre pela metade e download que trava. O mesmo
  endpoint devolve o **RTT medido pelo kernel** — latência sem sonda nenhuma.
- **Tempo de resolução DNS**, pela Resource Timing API, comparado com o tempo de
  uma query aos resolvers públicos que a análise já mede. É o atraso que aparece
  antes do primeiro byte e faz a navegação parecer lenta com a velocidade em
  ordem. Quando o nome já estava em cache, o resultado é *não medido* — em vez de
  anunciar 0 ms, que enganaria.

Detalhes de método que evitam diagnóstico errado:

- A comparação UDP × TCP só vale com o servidor **em endereço público** e com
  ambos na **mesma família** (IPv4/IPv6): sem essas guardas, toda instalação em
  rede local e todo cliente dual-stack seriam acusados de CGNAT.
- O diagnóstico **não depende** da análise de conectividade: espera por ela para
  ganhar a referência de DNS, mas com teto de tempo — se a análise não responder,
  o diagnóstico sai assim mesmo.
- Não dizemos **qual** resolver o cliente usa: isso exigiria ver a query chegando
  no servidor autoritativo, apoio que está fora do alcance do navegador.
- **No relatório**, a tabela do diagnóstico é a única com uma coluna de texto
  corrido: sem exceção ao `white-space: nowrap` das colunas numéricas, a frase
  não quebrava e a tabela passava da largura da folha. No celular ela vira
  **blocos empilhados** (verificação, veredito e explicação um sob o outro), e as
  tabelas de conectividade — numéricas, que só se leem comparando linhas —
  ganharam rolagem **dentro da tabela**, em vez de fazer a página rolar de lado.

## Link compartilhável do teste (`/r/CODIGO`)

- Cada teste ganha um **código curto** e um link que abre o **relatório completo
  de qualquer máquina**. Até aqui o relatório só existia no navegador que fez o
  teste — os números vinham na query string e as seções de rede, qualidade,
  conexão única e diagnóstico saíam do `localStorage`. Ou seja, o cliente não
  tinha como *mostrar* o teste a ninguém: mandava print.
- O código é **aleatório**, nunca derivado do `id`: sequencial deixaria qualquer
  um andar pelos testes dos outros trocando um caractere. São 8 caracteres de um
  alfabeto de 32 (~2^40) que exclui os pares que se confundem ao ditar — 0/O,
  1/I/L —, porque o link costuma ser passado ao suporte, às vezes de viva voz.
- **O relatório mostra o link** numa linha própria (também na impressão e no
  PDF) e traz um botão de copiar.
- No modo link, **data, servidor e navegador são os do teste**, não os de quem
  está lendo. Sem isso o atendente veria o próprio navegador no lugar do que
  interessa — e não perceberia.
- Duas gravações, com propósitos diferentes: **colunas planas** (`diag_*`,
  `whois`) para consultar o conjunto — "quantos clientes atrás de CGNAT?" — e um
  **snapshot JSON** com os mesmos objetos que o navegador guardaria. É o
  snapshot que permite ao relatório usar **os mesmos renderizadores** da tela, em
  vez de uma segunda implementação que possa divergir; as colunas não bastam,
  porque o objeto de qualidade tem mediana, mínimo e estabilidade por sentido.
- **Link inválido tem mensagem própria** — mandar o visitante "fazer um teste"
  quando ele clicou num link que alguém passou seria responder outra pergunta.
- Persistência é opcional, como sempre: sem as colunas, o teste não ganha código
  e a linha do link simplesmente não aparece.
- ⚠️ **Quem tem o link vê o teste** (IP, provedor, navegador). É deliberado, e é
  a razão de o código não ser adivinhável e de não existir listagem.

## A quem o IP está designado (`assets/js/whois-ip.js`)

- **Terceira linha no card de IP**, logo abaixo do ASN e alinhada à direita: o
  nome de quem detém o bloco daquele endereço, segundo o **registro público**.
- **Não é a mesma coisa que o ASN**, e a diferença é justamente o caso
  interessante: o ASN é o dono da rede, enquanto o bloco pode estar
  **sub-alocado** (REASSIGNED) a outra empresa. Um endereço dentro do
  `187.45.160.0/20` sai como *Vialink Soluções de Tecnologia Ltda*; um dentro do
  sub-bloco `187.45.173.0/25`, com o mesmo ASN, sai como *Mais Link
  Telecomunicação Ltda.* — é essa granularidade que responde "de quem é este IP".
- **RDAP, não whois clássico**: o whois de sempre é texto livre (um formato por
  RIR) e fala na porta 43, fora do alcance do navegador. O RDAP é HTTP+JSON
  padronizado (RFC 7483) e os servidores dos RIRs mandam
  `Access-Control-Allow-Origin: *` — dá para consultar direto do cliente, sem
  proxy. Como cada visitante consulta com o próprio IP de origem, também não se
  concentra rate limit num endereço só, que é o que um proxy nosso faria.
- **A escolha do papel não é detalhe**: usamos o `registrant`, nunca o contato
  de `abuse` ou o `technical` — no sub-bloco do exemplo o abuse é o provedor
  **pai** e o technical é uma pessoa física; pegar qualquer um dos dois daria a
  resposta errada. Dentro do papel, entidade com `kind: org` na frente (a RIPE
  devolve o objeto de manutenção como um segundo `registrant`).
- **Nunca atrapalha**: a consulta é assíncrona e chega depois do card já
  preenchido; se o RIR estiver lento, fora do ar ou limitando, o card fica
  exatamente como era e nada aparece no console. Endereços privados, de
  loopback e de CGNAT não são consultados. Resultado guardado no
  `sessionStorage` para não repetir a consulta a cada teste.
- **Nome longo não transborda**: a fonte diminui até o mínimo e só então o texto
  é truncado — o nome completo continua no tooltip. O card cresce e a coluna de
  resultados acompanha; sem a linha, o layout volta ao anterior.
- **Também no relatório e no PDF**, como linha "Designado a" logo abaixo do
  provedor (nos dois, a linha só existe quando a consulta trouxe resposta). Ali
  ela aparece inclusive no dual-stack: a restrição do card é de espaço, e no
  documento não há essa disputa.
  - De passagem, o deslocamento vertical do PDF deixou de ser escrito à mão em
    dois pontos (`+9 se houver IPv4`) e passou a sair da **contagem de linhas** —
    com duas linhas opcionais, o número na mão vira erro na certa.
- **Configurável por tenant**: `rdapEndpoint` aponta para outro servidor RDAP e
  `rdapEndpoint: ''` desliga a consulta — é a única chamada a terceiros que essa
  linha faz.

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
