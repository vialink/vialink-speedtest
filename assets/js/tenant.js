// Aplicação do tenant no app. A tabela de tenants e a resolução por hostname
// vivem em tenants.js (carregado antes, no <head>) — aqui cfg está sempre
// definido (fallback Vialink para hostname desconhecido).
(function () {
  var cfg = window._tenantConfig;
  if (!cfg) return;

  if (cfg.title) document.title = cfg.title;
  if (cfg.description) {
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', cfg.description);
  }

  // Busca IP/rede de forma assíncrona e armazena globalmente.
  // injectTenantBranding() usa esses dados quando o SVG estiver pronto.
  fetch('https://ipapi.co/json/')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      window._vlkIpData = { ip: d.ip || '—', asn: d.asn || '', city: d.city || '' };
      applyIpToSvg();
    })
    .catch(function () {
      fetch('https://api.ipify.org?format=json')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          window._vlkIpData = { ip: d.ip || '—', asn: '', city: '' };
          applyIpToSvg();
        })
        .catch(function () {
          window._vlkIpData = { ip: '—', asn: '', city: '' };
          applyIpToSvg();
        });
    });
})();

// Envia o resultado do teste para gravação no servidor (estatísticas).
// Chamada pelo app.js no bloco "SendR", logo após window.vlkResults existir —
// o "All done" do fim do upload aparece ANTES dos resultados, cedo demais.
// Melhor-esforço: falha de rede não afeta a experiência do usuário.
var vlkResultadoSalvo = false;
function vlkSalvarResultado() {
  if (vlkResultadoSalvo || !window.vlkResults) return;
  vlkResultadoSalvo = true;
  var r = window.vlkResults;
  var ipd = window._vlkIpData || {};
  var corpo = JSON.stringify({
    d: r.d, u: r.u, p: r.p, j: r.j, dd: r.dd, ud: r.ud,
    tenant: (window._tenantConfig && window._tenantConfig.key) || '',
    asn: ipd.asn || '', cidade: ipd.city || ''
  });
  try {
    fetch('/api/salvar-teste.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
      keepalive: true
    }).catch(function () { /* gravação é melhor-esforço */ });
  } catch (e) { /* idem */ }
}

// Aplica dados de IP nos elementos SVG (chamada quando o fetch ou o SVG estiver pronto)
function applyIpToSvg() {
  var d = window._vlkIpData;
  if (!d) return;

  var ip  = d.ip;
  var org = [d.asn, d.city].filter(Boolean).join(' · ');

  // IPv6 (ou qualquer IP com mais de 16 chars) não cabe ao lado do ASN·cidade:
  // o org sobe para a linha do rótulo "SEU IP" e o endereço usa o card inteiro,
  // encolhendo a fonte só se ainda não couber.
  var longo = ip.indexOf(':') !== -1 || ip.length > 16;
  var orgY    = { 'ip-org-ui': ['64', '51'], 'ip-org-intro': ['64', '51'], 'ip-org-mob': ['428', '413'] };
  var largura = { 'ip-addr-ui': 214, 'ip-addr-intro': 214, 'ip-addr-mob': 272 };

  // Após window.onload o SVG é inline — getElementById funciona diretamente
  var ids = { addr: ['ip-addr-ui', 'ip-addr-intro', 'ip-addr-mob'], org: ['ip-org-ui', 'ip-org-intro', 'ip-org-mob'] };
  ids.addr.forEach(function (id) {
    var el = document.getElementById(id) ||
             (window._vlkSvgDoc && window._vlkSvgDoc.getElementById(id));
    if (!el) return;
    el.textContent = ip;
    var fs = Math.min(11, (largura[id] || 214) / (ip.length * 0.58));
    el.style.fontSize = (longo && fs < 11) ? fs.toFixed(1) + 'px' : '';
  });
  ids.org.forEach(function (id) {
    var el = document.getElementById(id) ||
             (window._vlkSvgDoc && window._vlkSvgDoc.getElementById(id));
    if (!el) return;
    el.textContent = org;
    if (orgY[id]) el.setAttribute('y', orgY[id][longo ? 1 : 0]);
  });
}

function injectTenantBranding() {
  var obj = document.getElementById('OpenSpeedTest-UI');
  var svgDoc = (obj && obj.contentDocument) ? obj.contentDocument : document;
  window._vlkSvgDoc = svgDoc;

  // Traduz os textos/tooltips do SVG e monta o seletor de idioma (bandeiras)
  if (window.VLK_I18N) VLK_I18N.initSvg(svgDoc);

  // Dados de IP formatados (usados no relatório e no PDF)
  var vlkIpOrg = function () {
    var ip = window._vlkIpData;
    if (!ip || !ip.ip || ip.ip === '—') return null;
    return { ip: ip.ip, org: [ip.asn, ip.city].filter(Boolean).join(' · ') };
  };

  // Menu "Relatório": injeta os resultados do teste (e IP) na URL antes de navegar.
  // Independe de tenant — vale para qualquer hostname.
  ['vlk-menu-relatorio', 'vlk-menu-relatorio-mob'].forEach(function (id) {
    var a = svgDoc.getElementById(id);
    if (!a) return;
    a.addEventListener('click', function () {
      var q = [];
      var r = window.vlkResults;
      if (r) q.push('d=' + r.d, 'u=' + r.u, 'p=' + r.p, 'j=' + r.j, 'dd=' + r.dd, 'ud=' + r.ud);
      var dados = vlkIpOrg();
      if (dados) {
        q.push('ip=' + encodeURIComponent(dados.ip));
        if (dados.org) q.push('org=' + encodeURIComponent(dados.org));
      }
      if (window._tenantParam) q.push(window._tenantParam);
      var url = '/relatorio.html' + (q.length ? '?' + q.join('&') : '');
      this.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
      this.setAttribute('href', url);
    });
  });

  // ---- Botão "Compartilhar": gera o PDF do relatório e abre o painel nativo ----
  var vlkLocale = function () {
    return window.VLK_I18N ? VLK_I18N.locale() : 'pt-BR';
  };
  var fmt1 = function (v) {
    var n = parseFloat(v);
    return isFinite(n) ? n.toLocaleString(vlkLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  };
  var tcfg = window._tenantConfig || {};
  var tName = tcfg.name || 'Vialink';
  var hex2rgb = function (h) {
    h = (h || '').replace('#', '');
    return h.length === 6
      ? [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]
      : [0, 149, 190];
  };

  var jsPdfPromise = null;
  var vlkLoadJsPdf = function () {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jsPdfPromise) return jsPdfPromise;
    jsPdfPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/vendor/jspdf.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return jsPdfPromise;
  };

  // Ícone do tenant como dataURL (para o cabeçalho do PDF)
  var gearDataUrl = null;
  var vlkLoadGear = function () {
    if (gearDataUrl) return Promise.resolve(gearDataUrl);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          gearDataUrl = c.toDataURL('image/png');
        } catch (e) { gearDataUrl = null; }
        resolve(gearDataUrl);
      };
      img.onerror = function () { resolve(null); };
      img.src = tcfg.logoPdf || '/assets/tenants/vialink/icon-192.png';
    });
  };

  var vlkGerarPdfBlob = function (gear) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var r = window.vlkResults;
    var dados = vlkIpOrg();
    var azul = hex2rgb(tcfg.colors && tcfg.colors.accent), escuro = [20, 50, 70], cinza = [102, 112, 122];
    // A Helvetica do jsPDF só cobre caracteres latinos — em idiomas com
    // pdfLatin1:false (russo, chinês, japonês...) o PDF sai em inglês
    var pT = function (k, p) { return window.VLK_I18N ? VLK_I18N.tPdf(k, p) : vlkT(k, p); };
    var pLoc = window.VLK_I18N ? VLK_I18N.pdfLocale() : vlkLocale();
    var agora = new Date();
    var dataHora = pT('common.dateAt', {
      date: agora.toLocaleDateString(pLoc, { day: '2-digit', month: 'long', year: 'numeric' }),
      time: agora.toLocaleTimeString(pLoc, { hour: '2-digit', minute: '2-digit' })
    });

    // Cabeçalho
    if (gear) doc.addImage(gear, 'PNG', 15, 12, 12, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(azul[0], azul[1], azul[2]);
    doc.text(tName.toUpperCase(), 30, 19.5);
    doc.setFontSize(9);
    doc.setTextColor(cinza[0], cinza[1], cinza[2]);
    doc.setFont('helvetica', 'normal');
    doc.text(pT('pdf.tagline'), 30.4, 24);

    doc.setFontSize(17);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(escuro[0], escuro[1], escuro[2]);
    doc.text(pT('pdf.title'), 15, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(cinza[0], cinza[1], cinza[2]);
    doc.text(dataHora, 15, 46.5);

    // Informações
    var linhas = [
      [pT('pdf.ip'), dados ? dados.ip : '—'],
      [pT('pdf.provider'), dados && dados.org ? dados.org : '—'],
      [pT('pdf.server'), location.hostname]
    ];
    var y = 58;
    doc.setFontSize(10.5);
    linhas.forEach(function (l) {
      doc.setTextColor(azul[0], azul[1], azul[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(l[0], 15, y);
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      doc.text(String(l[1]), 65, y);
      doc.setDrawColor(236, 238, 241);
      doc.line(15, y + 2.2, 195, y + 2.2);
      y += 9;
    });

    // Métricas (4 caixas)
    var met = [
      [pT('app.download'), fmt1(r.d), 'Mbps'],
      [pT('app.upload'), fmt1(r.u), 'Mbps'],
      [pT('app.ping'), fmt1(r.p), 'ms'],
      [pT('app.jitter'), fmt1(r.j), 'ms']
    ];
    var bx = 15, bw = 42, bh = 30, gap = 4;
    y = 92;
    met.forEach(function (m, i) {
      var x = bx + i * (bw + gap);
      doc.setFillColor(242, 248, 250);
      doc.setDrawColor(217, 232, 238);
      doc.roundedRect(x, y, bw, bh, 2.5, 2.5, 'FD');
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(azul[0], azul[1], azul[2]);
      doc.text(m[0], x + bw / 2, y + 7.5, { align: 'center' });
      doc.setFontSize(19);
      doc.setTextColor(escuro[0], escuro[1], escuro[2]);
      doc.text(m[1], x + bw / 2, y + 18.5, { align: 'center' });
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(cinza[0], cinza[1], cinza[2]);
      doc.text(m[2], x + bw / 2, y + 25.5, { align: 'center' });
    });

    // Observações
    doc.setFontSize(9);
    doc.setTextColor(cinza[0], cinza[1], cinza[2]);
    var obs = pT('pdf.data', { dd: fmt1(r.dd), ud: fmt1(r.ud) });
    doc.text(obs, 15, 132);
    var nota = doc.splitTextToSize(pT('pdf.note', { name: tName }), 180);
    doc.text(nota, 15, 139);

    // Nota técnica (caixa em destaque)
    var laranja = [225, 94, 48];
    var notaTec = doc.splitTextToSize(pT('pdf.tech'), 170);
    var notaY = 154, notaH = 13 + notaTec.length * 3.6;
    doc.setFillColor(253, 246, 242);
    doc.setDrawColor(238, 205, 188);
    doc.roundedRect(15, notaY, 180, notaH, 2, 2, 'FD');
    doc.setFillColor(laranja[0], laranja[1], laranja[2]);
    doc.rect(15, notaY + 1, 1.5, notaH - 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(laranja[0], laranja[1], laranja[2]);
    doc.text(pT('pdf.techTitle'), 21, notaY + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 85, 90);
    doc.text(notaTec, 21, notaY + 13);

    // Rodapé — "Powered by Vialink" é o crédito do fork (desabilitável por tenant)
    doc.setDrawColor(236, 238, 241);
    doc.line(15, 280, 195, 280);
    doc.setFontSize(8.5);
    if (tcfg.poweredBy !== false) doc.text('Powered by Vialink - 2026', 15, 285.5);
    doc.text(location.hostname, 195, 285.5, { align: 'right' });

    return doc.output('blob');
  };

  // A pílula é só o ícone — a mensagem de feedback aparece ao lado dela
  var vlkShareFeedback = function (g, txtId, msg) {
    var t = document.getElementById(txtId) || svgDoc.getElementById(txtId);
    if (!t) return;
    t.textContent = msg;
    setTimeout(function () { t.textContent = ''; }, 2500);
  };

  var shareEls = pegaEls2(['vlk-share', 'vlk-share-mob']);
  function pegaEls2(ids) {
    return ids.map(function (id) { return svgDoc.getElementById(id); })
              .filter(function (el) { return el; });
  }
  shareEls.forEach(function (g) {
    var txtId = g.id === 'vlk-share' ? 'vlk-share-txt' : 'vlk-share-txt-mob';
    g.addEventListener('click', function () {
      if (!window.vlkResults) {
        vlkShareFeedback(g, txtId, vlkT('share.first'));
        return;
      }
      Promise.all([vlkLoadJsPdf(), vlkLoadGear()]).then(function (res) {
        var blob = vlkGerarPdfBlob(res[1]);
        var pdfNome = vlkT('share.file', { tenant: tcfg.key || 'vialink' });
        var file = new File([blob], pdfNome, { type: 'application/pdf' });
        var r = window.vlkResults;
        var texto = vlkT('share.text', { name: tName, d: fmt1(r.d), u: fmt1(r.u), p: fmt1(r.p) });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: vlkT('share.title', { name: tName }), text: texto })
            .catch(function () { /* usuário cancelou */ });
        } else {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = pdfNome;
          a.click();
          vlkShareFeedback(g, txtId, vlkT('share.downloaded'));
        }
      }).catch(function () {
        vlkShareFeedback(g, txtId, vlkT('share.error'));
      });
    });
  });

  // Observa oDoLiveStatus: quando "All done", troca a barra de progresso pelo
  // botão "Testar novamente" (grupos SVG, alinhados no lugar exato da barra).
  // Referências resolvidas AGORA: depois o app.js move o SVG para o documento
  // principal e svgDoc.getElementById passa a retornar null.
  var pegaEls = function (ids) {
    return ids.map(function (id) { return svgDoc.getElementById(id); })
              .filter(function (el) { return el; });
  };
  var retestEls = pegaEls(['vlk-retest', 'vlk-retest-mob']);
  var barEls = pegaEls(['vlk-progress-desk', 'vlk-progress-mob', 'progressStatus-Desk', 'progressStatus-Mob']);
  var setDisplay = function (els, hide) {
    els.forEach(function (el) {
      if (hide) el.setAttribute('display', 'none');
      else el.removeAttribute('display');
    });
  };
  var statusEl = svgDoc.getElementById('oDoLiveStatus');
  if (statusEl) {
    // O texto do status é escrito já traduzido pelo app.js — compara com a
    // chave em qualquer idioma registrado (o usuário pode trocar no meio)
    var isAllDone = function (txt) {
      return window.VLK_I18N ? VLK_I18N.matches(txt, 'status.done') : txt === 'All done';
    };
    var statusObs = new MutationObserver(function () {
      if (isAllDone(statusEl.textContent)) {
        statusObs.disconnect();
        setDisplay(barEls, true);
        setDisplay(retestEls, false);
        statusEl.setAttribute('visibility', 'hidden');
        // Ativa o botão Compartilhar e pré-carrega o gerador de PDF
        shareEls.forEach(function (el) { el.removeAttribute('opacity'); });
        vlkLoadJsPdf();
        vlkLoadGear();
      }
    });
    statusObs.observe(statusEl, { childList: true, characterData: true, subtree: true });
  }

  var cfg = window._tenantConfig;
  if (!cfg) return;

  if (cfg.name) {
    var el = document.getElementById('credits-area');
    if (el) el.innerHTML = '<a href="' + (cfg.site || '/') + '">' + vlkT('app.credits', { name: cfg.name }) + '</a>';
  }

  // "Powered by Vialink" é fixo (crédito do fork), mas desabilitável por tenant
  if (cfg.poweredBy === false) {
    pegaEls2(['vlk-footer-desk', 'vlk-footer-mob']).forEach(function (g) {
      g.setAttribute('display', 'none');
    });
  }

  // Item "Sobre" do menu — habilitável/desabilitável por tenant
  if (cfg.sobre === false) {
    pegaEls2(['vlk-menu-sobre', 'vlk-menu-sobre-mob']).forEach(function (a) {
      a.setAttribute('display', 'none');
    });
  }

  if (!cfg.logo) return;

  // Esvazia symbol#logo para remover a marca OpenSpeedTest do centro do gauge
  var logoSymbol = svgDoc.querySelector('symbol#logo');
  if (logoSymbol) {
    while (logoSymbol.firstChild) logoSymbol.removeChild(logoSymbol.firstChild);
  }

  // Injeta logo nos 4 grupos (intro + UI) × (desktop + mobile) na mesma posição.
  var targets = [
    { groupId: 'intro-Desk', x: '93', y: '207', w: '110', h: '28' },
    { groupId: 'UI-Desk',    x: '93', y: '207', w: '110', h: '28' },
    { groupId: 'intro-Mob',  x: '93', y: '207', w: '110', h: '28' },
    { groupId: 'UI-Mob',     x: '93', y: '207', w: '110', h: '28' }
  ];

  var logoImgs = [];
  var setLogoHref = function (img, href) {
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    img.setAttribute('href', href);
  };
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var group = svgDoc.getElementById(t.groupId);
    if (!group) continue;
    var img = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'image');
    setLogoHref(img, cfg.logo);
    img.setAttribute('x', t.x);
    img.setAttribute('y', t.y);
    img.setAttribute('width', t.w);
    img.setAttribute('height', t.h);
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    group.appendChild(img);
    logoImgs.push(img);
  }

  // Tenant com logoDark: troca o logo junto com o toggle de tema.
  // (getCookieValue é global, definida no <head> do index.html; setSkin vem do darkmode.js)
  if (cfg.logoDark) {
    var applyLogoTheme = function (mode) {
      var href = (mode === 'light') ? cfg.logo : cfg.logoDark;
      logoImgs.forEach(function (img) { setLogoHref(img, href); });
    };
    applyLogoTheme((typeof getCookieValue === 'function' && getCookieValue('mode') === 'light') ? 'light' : 'dark');
    var hookSetSkin = function () {
      if (typeof window.setSkin === 'function') {
        var origSetSkin = window.setSkin;
        window.setSkin = function (a) { origSetSkin(a); applyLogoTheme(a); };
        return true;
      }
      return false;
    };
    // darkmode.js pode ainda não ter carregado quando o <object> dispara o onload
    if (!hookSetSkin()) window.addEventListener('load', hookSetSkin);
  }

  // Ativa o card de IP (remove display:none dos 8 elementos SVG)
  var ipIds = ['ip-bg-ui', 'ip-lbl-ui', 'ip-addr-ui', 'ip-org-ui',
               'ip-bg-intro', 'ip-lbl-intro', 'ip-addr-intro', 'ip-org-intro',
               'ip-bg-mob', 'ip-lbl-mob', 'ip-addr-mob', 'ip-org-mob'];
  for (var j = 0; j < ipIds.length; j++) {
    var ipEl = svgDoc.getElementById(ipIds[j]);
    if (ipEl) ipEl.removeAttribute('display');
  }

  // Popula dados de IP se o fetch já retornou; se não, applyIpToSvg() fará isso quando chegar
  applyIpToSvg();

  // Observa oDoLiveSpeed: quando app.js escreve "OpenSpeedTest™", esconde o elemento.
  var speedEl = svgDoc.getElementById('oDoLiveSpeed');
  if (speedEl) {
    var speedObs = new MutationObserver(function () {
      if (speedEl.textContent.indexOf('OpenSpeedTest') !== -1) {
        speedObs.disconnect();
        speedEl.setAttribute('visibility', 'hidden');
      }
    });
    speedObs.observe(speedEl, { childList: true, characterData: true, subtree: true });
  }

}
