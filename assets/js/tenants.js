// Tabela de tenants e resolução por hostname.
// Carregado no <head> do index.html e das páginas (relatorio/manual/sobre),
// ANTES de qualquer outro script — define window._tenantConfig, aplica as
// cores como CSS custom properties e troca os favicons.
//
// Para testar um tenant em qualquer hostname: ?tenant=<chave>
(function () {
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
      sobre: true
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
