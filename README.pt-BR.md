# Velocímetro Vialink

Teste de velocidade auto-hospedado, **multi-tenant** e **multi-idioma** —
um fork do [OpenSpeedTest™](https://github.com/openspeedtest/Speed-Test).
100% arquivos estáticos (HTML, CSS, JavaScript e SVG): sem build, sem
Node.js, sem backend obrigatório — qualquer servidor web serve.

<p align="center">
  <a href="https://medidor.vialink.com.br"><strong>▶ Teste ao vivo</strong></a>
  &nbsp;·&nbsp; <a href="README.md">🇺🇸 English</a>
  &nbsp;·&nbsp; <a href="docs/INSTALL.pt-BR.md">Manual de instalação</a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/img/screenshot-desktop.png" alt="Velocímetro — desktop, tema escuro" width="68%">
  <img src="docs/img/screenshot-mobile.png" alt="Velocímetro — mobile" width="23%">
</p>

## Destaques

- **Multi-tenant** — vários domínios na mesma instalação, cada um com logo
  (claro/escuro), cores, favicon, título e relatórios próprios; configuração
  estática em [`assets/js/tenants.js`](assets/js/tenants.js).
- **8 idiomas** — português, inglês, espanhol, francês, chinês, japonês,
  russo e alemão, com seletor de bandeira, detecção do idioma do navegador e
  preferência em cookie. [Contribua com o seu idioma](assets/js/i18n/README.md)
  — é um único arquivo JS.
- **Testes Rápido e Completo** — o teste de velocidade clássico, ou um teste
  **Completo** que também mede a **saúde da rede**: latência, jitter e perda de
  pacotes até destinos populares (Google, Netflix, WhatsApp, resolvedores DNS…),
  de **duas origens** — o navegador *e* o servidor (`traceroute`/ICMP real).
- **Qualidade da conexão** — o que a média em Mbps esconde: **bufferbloat**
  (latência medida *enquanto* o link está saturado, com nota de A+ a F),
  **turbo inicial vs. velocidade sustentada** e **estabilidade** (variação,
  mínimo, quedas). Derivada do próprio teste, sem custo de tempo.
- **Conexão única × 6 conexões** — o que um fluxo TCP entrega contra as seis que
  o teste usa. É a resposta para "o teste dá 300 Mbps mas o Steam baixa a 20":
  limitador por fluxo, janela TCP pequena para a latência do enlace (a janela
  efetiva é exibida, com alerta em 64 KB) ou CGNAT sobrecarregado.
- **Perfis de uso** — os mesmos números como uma nota por tipo de uso:
  videochamada, streaming 4K, jogos, home office e VoIP (com **MOS estimado**,
  ITU-T G.107, calculado com o link livre e com o link ocupado). Cada perfil é
  avaliado pelo **pior** critério, nunca pela média, e diz qual é o fator
  limitante — assim "500 Mbps" nunca encobre 300 ms de latência sob carga.
- **Diagnóstico da conexão** — tipo de NAT com detecção de **CGNAT e NAT
  simétrico** (por que não dá para acessar a câmera de fora e por que o jogo não
  conecta direto), **MTU do caminho** lida da própria conexão TCP (1492 é PPPoE;
  abaixo disso é túnel) e tempo de resolução DNS. As respostas para as queixas
  que um número de velocidade não explica.
- **Relatório e PDF** — página de relatório imprimível (velocidade **e** rede) e
  PDF gerado no navegador (jsPDF vendorizado, sem CDN) compartilhável pelo painel
  nativo do celular.
- **Card de IP/provedor** — endereço, ASN, estado e **a quem o bloco está
  designado** (registro público, via RDAP), informação em geral mais específica
  que o ASN: bloco sub-alocado aparece com o nome de quem de fato o detém.
- Escala do velocímetro **dinâmica**, tema escuro por padrão, layout mobile
  dedicado.
- **Correções sobre o upstream** — gráfico ao vivo que nunca renderizava,
  medição de upload ~160× mais rápida de preparar, threads ajustadas ao
  HTTP/1.1 — tudo documentado no [CHANGELOG](CHANGELOG.md).
- **Persistência opcional** de resultados (PHP + MariaDB) para histórico e
  relatórios internos.
- **Privacidade** — nenhum dado enviado a terceiros pelo servidor; o teste
  roda contra a *sua* infraestrutura.

<p align="center">
  <img src="docs/img/screenshot-network.png" alt="Teste Completo — análise de rede (camadas cliente + servidor)" width="46%">
  <img src="docs/img/screenshot-idiomas.png" alt="Seletor de idiomas (8 idiomas)" width="46%">
</p>

## Instalação em servidor próprio

Manual completo (nginx e Apache, HTTPS com Let's Encrypt, branding
multi-tenant, criação de idioma, persistência opcional e troubleshooting):

- **Português:** [docs/INSTALL.pt-BR.md](docs/INSTALL.pt-BR.md)
- **English:** [docs/INSTALL.en-US.md](docs/INSTALL.en-US.md)

Resumo: clone, gere o arquivo de download
(`dd if=/dev/urandom of=downloading bs=1M count=100`), aplique a configuração
de servidor web do manual e pronto.

## Contribuindo

Contribuições são bem-vindas — especialmente **novos idiomas** (um arquivo de
dicionário + uma bandeira SVG) e correções. Veja o
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licença e marcas

- Código sob licença **MIT** — © 2013–2023 OpenSpeedTest™ (projeto original)
  e © 2026 [Vialink](https://vialink.com.br) (modificações do fork). Ver
  [LICENSE](LICENSE) e [COPYRIGHT.md](COPYRIGHT.md).
- **Logotipos, nomes e cores Vialink e MaisLink não são MIT** — ao hospedar
  publicamente, configure um tenant com a sua própria marca
  ([manual, §6](docs/INSTALL.pt-BR.md#6-personalização--marca-cores-e-domínios-tenants)).
- OpenSpeedTest™ é marca do projeto original. Este fork não é afiliado ao
  OpenSpeedTest; melhorias de interesse geral podem ser propostas de volta
  ao [projeto original](https://github.com/openspeedtest/Speed-Test).
