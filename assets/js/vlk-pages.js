// Aplica o tenant nas páginas HTML (relatorio, manual, sobre).
// Requer tenants.js carregado antes (no <head>) — cores e favicon já foram
// aplicados lá; aqui ficam logo, nome do tenant, rodapé e links.
(function () {
  var cfg = window._tenantConfig;
  if (!cfg) return;

  // Nome do tenant no título da aba e nos pontos marcados do texto
  if (cfg.name && cfg.name !== 'Vialink') {
    document.title = document.title.replace(/Vialink/g, cfg.name);
  }
  var nomes = document.querySelectorAll('.t-nome');
  for (var i = 0; i < nomes.length; i++) nomes[i].textContent = cfg.name;

  // Logo do topo — páginas escuras usam logoDark quando o tenant tiver
  var logo = document.querySelector('.topo img.logo');
  if (logo && cfg.logo) {
    var claro = document.body.getAttribute('data-fundo') === 'claro';
    logo.src = (claro || !cfg.logoDark) ? cfg.logo : cfg.logoDark;
    logo.alt = cfg.name;
  }

  // Domínio de exemplo do manual acompanha o hostname atual
  var exemplo = document.getElementById('t-exemplo-url');
  if (exemplo) exemplo.textContent = 'https://' + location.hostname + '/?Run&Stress=300';

  // "Powered by Vialink" é fixo (crédito do fork), mas desabilitável por tenant
  if (cfg.poweredBy === false) {
    var pb = document.querySelectorAll('.rodape, .rodape-folha .marca');
    for (var j = 0; j < pb.length; j++) pb[j].style.display = 'none';
  }

  // Propaga o override ?tenant= (testes) nos links internos da página
  if (window._tenantParam) {
    var links = document.querySelectorAll('a[href^="/"]');
    for (var k = 0; k < links.length; k++) {
      var href = links[k].getAttribute('href');
      if (href.indexOf('tenant=') === -1) {
        links[k].setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + window._tenantParam);
      }
    }
  }
})();
