// Tabela de tenants e resolução por hostname.
// Carregado no <head> do index.html e das páginas (relatorio/manual/sobre),
// ANTES de qualquer outro script — define window._tenantConfig, aplica as
// cores como CSS custom properties e troca os favicons.
//
// Para testar um tenant em qualquer hostname: ?tenant=<chave>
(function () {
  // Destinos padrão da análise de conectividade (conectividade.html).
  // Hosts públicos e genéricos, servem como sugestão inicial — cada tenant
  // pode sobrescrever com o próprio array `connectivityTargets`.
  // `host` é o alvo do probe (cliente) e do traceroute (servidor); `ip` é só
  // informativo; `probe` (opcional) sobrescreve a URL de sonda do cliente.
  //   - Forma CANÔNICA (www) quando o apex redireciona: o 301 apex→www custa
  //     uma conexão/handshake extra e inflava a latência do cliente ~2-3×
  //     (ex.: google.com 279ms → www.google.com 86ms).
  //   - Servidores de DNS (`doh`): o cliente mede o TEMPO DE UMA QUERY real via
  //     DNS-over-HTTPS (CORS liberado nos dois) — é o que importa num resolver,
  //     e mede ~10ms em vez dos ~130ms que o favicon dava. Nome fixo (cache do
  //     resolver = RTT à rede) + param aleatório só p/ furar o cache HTTP. O
  //     servidor continua traçando o IP (8.8.8.8 / 1.1.1.1) por `mtr`.
  var DEFAULT_TARGETS = [
    { label: 'Google',            host: 'www.google.com' },
    { label: 'YouTube',           host: 'www.youtube.com' },
    { label: 'Netflix',           host: 'www.netflix.com', oca: true },
    { label: 'Cloudflare DNS',    host: '1.1.1.1', doh: 'https://1.1.1.1/dns-query?name=example.com&type=A', dohAccept: 'application/dns-json' },
    { label: 'Google DNS',        host: 'dns.google', ip: '8.8.8.8', doh: 'https://dns.google/resolve?name=example.com&type=A' },
    { label: 'Microsoft 365',     host: 'www.microsoft.com' },
    { label: 'WhatsApp',          host: 'whatsapp.com' },
    { label: 'Globo',             host: 'www.globo.com' },
    { label: 'Internacional (EUA)', labelKey: 'connect.dest.intl', host: 'whitehouse.gov' }
  ];

  // Servidores STUN usados pelo diagnóstico de NAT/CGNAT (assets/js/diagnostico-rede.js).
  // Cada tenant pode sobrescrever com `stunServers: [...]` — apontando para um STUN
  // próprio, por exemplo — ou desligar a checagem com `stunServers: []`. Um binding
  // request STUN não carrega dado do usuário (pergunta "de que IP/porta você me vê?"),
  // mas é tráfego para terceiros: quem preferir manter tudo em casa desliga aqui.
  // Sem a chave, valem os públicos definidos no próprio módulo.

  // Servidor RDAP usado para descobrir a quem o IP está designado, mostrado no
  // card abaixo do ASN (assets/js/whois-ip.js). O padrão é o bootstrap
  // `https://rdap.org/ip/`, que redireciona para o RIR responsável. Cada tenant
  // pode apontar para outro servidor com `rdapEndpoint: 'https://.../ip/'` (a
  // string é concatenada com o IP) ou desligar a consulta com
  // `rdapEndpoint: ''` — é a única chamada a terceiros dessa linha do card.

  var TENANTS = {
    vialink: {
      name: 'Vialink',
      domains: [
        'medidor.vialink.com.br',
        'velocimetro.vialink.com.br',
        'speedtest.vialink.com.br',
        'suavelocidade.vialink.com.br',
        'minhavelocidade.vialink.com.br'
      ],
      title: 'Velocímetro Vialink',
      description: 'Teste a velocidade da sua conexão Vialink',
      site: 'https://vialink.com.br',
      logo: '/assets/tenants/vialink/logo.svg',
      // logoDark ausente: o logo Vialink funciona nos dois temas
      logoPdf: '/assets/tenants/vialink/icon-192.png',
      iconsDir: '/assets/tenants/vialink',
      colors: {
        accent: '#0095BE',
        accentDark: '#007A9C',
        gaugeStart: '#56c4fb',
        gaugeEnd: '#005A73'
      },
      poweredBy: true,
      sobre: true,
      connectivityTargets: DEFAULT_TARGETS
    },
  };
  var DEFAULT_TENANT = 'vialink';

  // Override por query string (testes) tem prioridade sobre o hostname
  var key = null;
  var m = window.location.search.match(/[?&]tenant=([a-z0-9-]+)/i);
  if (m && TENANTS[m[1].toLowerCase()]) key = m[1].toLowerCase();

  if (!key) {
    var hostname = window.location.hostname;
    for (var k in TENANTS) {
      if (TENANTS[k].domains.indexOf(hostname) !== -1) { key = k; break; }
    }
  }
  if (!key) key = DEFAULT_TENANT;

  var cfg = TENANTS[key];
  cfg.key = key;
  window._tenantConfig = cfg;
  // Param para propagar o override de teste nos links internos ('' em produção)
  window._tenantParam = (m && m[1].toLowerCase() === key) ? 'tenant=' + key : '';

  // Cores do tenant como CSS custom properties (o CSS usa var() com fallback Vialink)
  var c = cfg.colors || {};
  var root = document.documentElement;
  if (c.accent) root.style.setProperty('--vlk-accent', c.accent);
  if (c.accentDark) root.style.setProperty('--vlk-accent-dark', c.accentDark);
  if (c.gaugeStart) root.style.setProperty('--vlk-gauge-start', c.gaugeStart);
  if (c.gaugeEnd) root.style.setProperty('--vlk-gauge-end', c.gaugeEnd);

  // Favicons por tenant (as páginas trazem os da Vialink como padrão estático)
  if (cfg.iconsDir && key !== DEFAULT_TENANT) {
    var links = document.querySelectorAll('link[rel*="icon"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href) continue;
      var file = href.split('/').pop();
      links[i].setAttribute('href', cfg.iconsDir + '/' + file);
    }
  }
})();
