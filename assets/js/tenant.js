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
  var detectStacks = function (data) {
    if (!data.ip || data.ip === '—') return;
    window._vlkIpData = data;
    applyIpToSvg();

    var isV6 = data.ip.indexOf(':') !== -1;
    // Se temos um v6, buscamos o v4. Se temos um v4, buscamos o v6.
    var sources = isV6
      ? ['https://api.ipify.org', 'https://ipv4.icanhazip.com', 'https://ident.me']
      : ['https://api64.ipify.org', 'https://ipv6.icanhazip.com', 'https://v6.ident.me'];

    var trySource = function (idx) {
      if (idx >= sources.length) return;
      fetch(sources[idx], { mode: 'cors' })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var otherIp = text.trim();
          var isOtherV6 = otherIp.indexOf(':') !== -1;
          if (otherIp && isOtherV6 !== isV6 && otherIp.length > 6) {
            if (isV6) {
              data.ipv4 = otherIp;
            } else {
              data.ipv4 = data.ip;
              data.ip = otherIp;
            }
            window._vlkIpData = data;
            applyIpToSvg();
          } else {
            trySource(idx + 1);
          }
        })
        .catch(function () { trySource(idx + 1); });
    };
    trySource(0);
  };

  var processIP = function (d) {
    if (!d || !d.ip) return;
    detectStacks({
      ip: d.ip,
      asn: d.asn || (d.connection && d.connection.asn) || d.org || '',
      // Estado (UF) em vez da cidade: o geo-IP acerta o estado, mas erra a
      // cidade com frequência. ipapi.co/ipwho.is → region (nome do estado);
      // region_code (sigla) como reforço.
      region: d.region || d.region_name || d.region_code || ''
    });
  };

  // Ordem dos provedores: ipapi.co primeiro — ASN ("AS263946") e cidade no
  // formato original (decisão do dono, 2026-07-06); ipwho.is e ipify como
  // fallbacks para quando o ipapi.co falhar (429/CORS).
  fetch('https://ipapi.co/json/')
    .then(function (r) { if (!r.ok) throw 1; return r.json(); })
    .then(function (d) { if (d && d.ip) processIP(d); else throw 1; })
    .catch(function () {
      fetch('https://ipwho.is/')
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.success) processIP(d); else throw 1; })
        .catch(function () {
          fetch('https://api64.ipify.org?format=json')
            .then(function (r) { return r.json(); })
            .then(processIP)
            .catch(function () { processIP({ ip: '—' }); });
        });
    });
})();

// UID do teste (por carregamento de página): liga a gravação da velocidade
// (salvar-teste.php) às linhas de conectividade gravadas depois
// (salvar-conectividade.php). 32 chars hex.
function vlkTesteUid() {
  if (window._vlkTesteUid) return window._vlkTesteUid;
  var hex = '';
  try {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) hex += ('0' + a[i].toString(16)).slice(-2);
  } catch (e) {
    for (var j = 0; j < 32; j++) hex += Math.floor(Math.random() * 16).toString(16);
  }
  window._vlkTesteUid = hex;
  return hex;
}

// POST resiliente melhor-esforço: fetch → 1 retry (1,5s) → sendBeacon (sobrevive
// a navegação/fechamento da aba). Falha nunca afeta a experiência do usuário.
// O endpoint lê php://input, então o content-type do Blob não atrapalha.
function vlkPostResiliente(url, corpo) {
  function enviar() {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
      keepalive: true
    }).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp;
    });
  }
  function viaBeacon() {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([corpo], { type: 'application/json' }));
      }
    } catch (e) { /* melhor-esforço */ }
  }
  try {
    enviar()
      .catch(function () {
        // 1 retry após breve espera (cobre saturação momentânea do PHP-FPM)
        return new Promise(function (res) { setTimeout(res, 1500); }).then(enviar);
      })
      .catch(viaBeacon); // se ainda falhar, tenta o beacon
  } catch (e) {
    viaBeacon();
  }
}

// Envia o resultado do teste para gravação no servidor (estatísticas).
// Chamada pelo app.js no bloco "SendR", logo após window.vlkResults existir —
// o "All done" do fim do upload aparece ANTES dos resultados, cedo demais.
var vlkResultadoSalvo = false;
function vlkSalvarResultado() {
  if (vlkResultadoSalvo || !window.vlkResults) return;
  vlkResultadoSalvo = true;
  var r = window.vlkResults;
  var ipd = window._vlkIpData || {};
  // Qualidade da conexão: achatada para o formato do banco (uma linha por
  // teste). Ausente se a medição não se completou — a velocidade grava assim
  // mesmo.
  var q = window.vlkQos, qv = (q && q.velocidade) || {}, qos = null;
  if (q && q.idle != null) {
    qos = {
      idle: q.idle, nota: q.nota, rpm: q.rpm,
      dl: q.dl ? q.dl.latencia : null,
      ul: q.ul ? q.ul.latencia : null,
      dlCv: qv.dl ? qv.dl.cv : null,
      ulCv: qv.ul ? qv.ul.cv : null,
      dlBoost: qv.dl ? qv.dl.boost : null,
      quedas: (qv.dl ? qv.dl.quedas : 0) + (qv.ul ? qv.ul.quedas : 0)
    };
  }
  vlkPostResiliente('/api/salvar-teste.php', JSON.stringify({
    uid: vlkTesteUid(),
    qos: qos,
    // o banco recebe a medição bruta, sem o fator de correção da exibição
    d: r.dRaw || r.d, u: r.uRaw || r.u, p: r.p, j: r.j, dd: r.dd, ud: r.ud,
    tenant: (window._tenantConfig && window._tenantConfig.key) || '',
    // coluna `cidade` do banco passa a guardar o estado (UF/região) — o geo-IP
    // erra a cidade; o nome real do cliente vem depois do enriquecimento NetBox
    asn: ipd.asn || '', cidade: ipd.region || ''
  }));
}

// Grava a análise de conectividade (teste "Complete") — uma linha por destino
// em testes_rede, ligada ao teste pai pelo mesmo uid. Chamada quando
// window.vlkNetResults fica pronto (vlkRunNetworkInline).
var vlkConectSalva = false;
function vlkSalvarConectividade(res) {
  if (vlkConectSalva || !res) return;
  var cli = res.cliente || [], srv = res.servidor || [];
  if (!cli.length && !srv.length) return;
  vlkConectSalva = true;
  vlkPostResiliente('/api/salvar-conectividade.php', JSON.stringify({
    uid: vlkTesteUid(), cliente: cli, servidor: srv
  }));
}

// Grava a medição de conexão única. Vai num POST próprio (e não junto da
// velocidade) porque ela só termina alguns segundos depois — quando o teste
// grava, este número ainda não existe. O endpoint faz UPDATE pelo mesmo uid.
var vlkSingleSalva = false;
function vlkSalvarSingle(s) {
  if (vlkSingleSalva || !s || !(s.single > 0)) return;
  vlkSingleSalva = true;
  vlkPostResiliente('/api/salvar-single.php', JSON.stringify({
    uid: vlkTesteUid(),
    single: s.single, multi: s.multi, ratio: s.ratio, grade: s.grade,
    windowKb: s.windowBytes != null ? Math.round(s.windowBytes / 1024) : null
  }));
}

// Aplica dados de IP nos elementos SVG (chamada quando o fetch ou o SVG estiver pronto)
function applyIpToSvg() {
  var d = window._vlkIpData;
  if (!d) return;

  var ip = d.ip;
  var ipv4 = d.ipv4;
  var org = [d.asn, d.region].filter(Boolean).join(' · ');

  // IPv6 (ou qualquer IP com mais de 16 chars) não cabe ao lado do ASN·cidade:
  var longo = ip.indexOf(':') !== -1 || ip.length > 16;
  var largura = { 'ip-addr-ui': 214, 'ip-addr-intro': 214, 'ip-addr-mob': 272 };
  var svgDoc = window._vlkSvgDoc || document;

  // Atualiza os rótulos de "SEU IP"
  ['ip-lbl-ui', 'ip-lbl-intro', 'ip-lbl-mob'].forEach(function (id) {
    var el = document.getElementById(id) || svgDoc.getElementById(id);
    if (!el) return;
    el.setAttribute('display', 'inline');
    // data-i18n acompanha o estado: troca de idioma ao vivo reescreve pelo atributo
    el.setAttribute('data-i18n', ipv4 ? 'app.yourIpV6' : 'app.yourIp');
    if (ipv4) {
      el.textContent = window.VLK_I18N ? window.VLK_I18N.t('app.yourIpV6') : 'SEU IP - IPv6';
      var isMob = id.indexOf('mob') !== -1;
      el.setAttribute('y', isMob ? '406' : '12');
    } else {
      el.textContent = window.VLK_I18N ? window.VLK_I18N.t('app.yourIp') : 'SEU IP';
      var isMob = id.indexOf('mob') !== -1;
      // Posições originais do layout single-stack (mobile: card em y=396..442)
      el.setAttribute('y', isMob ? '413' : '15');
    }
  });

  // Endereços e organização
  var ids = {
    addr: ['ip-addr-ui', 'ip-addr-intro', 'ip-addr-mob'],
    v4lbl: ['ip-v4-lbl-ui', 'ip-v4-lbl-intro', 'ip-v4-lbl-mob'],
    v4addr: ['ip-v4-addr-ui', 'ip-v4-addr-intro', 'ip-v4-addr-mob'],
    org: ['ip-org-ui', 'ip-org-intro', 'ip-org-mob']
  };

  ids.addr.forEach(function (id) {
    var el = document.getElementById(id) || svgDoc.getElementById(id);
    if (!el) return;
    el.setAttribute('display', 'inline');
    el.textContent = ip;
    var fs = Math.min(10.5, (largura[id] || 214) / (ip.length * 0.58));
    el.style.fontSize = (longo && fs < 10.5) ? fs.toFixed(1) + 'px' : '';
    if (ipv4) {
      var isMob = id.indexOf('mob') !== -1;
      el.setAttribute('y', isMob ? '418' : '25');
    } else {
      var isMob = id.indexOf('mob') !== -1;
      el.setAttribute('y', isMob ? '428' : '28');
    }
  });

  ids.v4addr.forEach(function (id, idx) {
    var el = document.getElementById(id) || svgDoc.getElementById(id);
    var lblId = ids.v4lbl[idx];
    var lblEl = document.getElementById(lblId) || svgDoc.getElementById(lblId);
    if (!el || !lblEl) return;

    if (ipv4) {
      var isMob = id.indexOf('mob') !== -1;
      el.textContent = ipv4;
      el.setAttribute('display', 'inline');
      el.style.fontSize = ipv4.length > 16 ? '9px' : '';
      el.setAttribute('y', isMob ? '442' : '51');
      lblEl.setAttribute('display', 'inline');
      lblEl.setAttribute('y', isMob ? '430' : '38');
      if (window.VLK_I18N) {
        lblEl.textContent = window.VLK_I18N.t('app.yourIpV4');
      }
    } else {
      el.setAttribute('display', 'none');
      lblEl.setAttribute('display', 'none');
    }
  });

  ids.org.forEach(function (id) {
    var el = document.getElementById(id) || svgDoc.getElementById(id);
    if (!el) return;

    var isMob = id.indexOf('mob') !== -1;
    var bgId = id.replace('org', 'bg');
    var bgEl = document.getElementById(bgId) || svgDoc.getElementById(bgId);

    if (ipv4) {
      // Caso dual-stack: esconde ASN/Cidade e mostra o segundo IP
      el.setAttribute('display', 'none');
      if (bgEl) {
        bgEl.setAttribute('display', 'inline');
        // Mobile mais baixo (51) para não invadir o rodapé "Powered by" (y=449.5)
        bgEl.setAttribute('height', isMob ? '51' : '62');
      }
    } else {
      // Caso normal: mostra ASN e Cidade
      el.setAttribute('display', 'inline');
      el.textContent = org;
      el.setAttribute('text-anchor', 'end');
      el.setAttribute('x', isMob ? '284' : '224.6');
      var orgY = { 'ip-org-ui': ['28', '15'], 'ip-org-intro': ['28', '15'], 'ip-org-mob': ['428', '413'] };
      if (orgY[id]) el.setAttribute('y', orgY[id][longo ? 1 : 0]);
      el.setAttribute('opacity', '0.65');
      el.style.fontSize = '';
      if (bgEl) {
        bgEl.setAttribute('display', 'inline');
        bgEl.setAttribute('height', isMob ? '46.18' : '37');
      }
    }
  });

  // Desloca os resultados se dual stack carregar para evitar sobreposição no Desktop
  ['vlk-res-col-ui', 'vlk-res-col-intro'].forEach(function (id) {
    var g = document.getElementById(id) || svgDoc.getElementById(id);
    if (g) {
      // 46 é o padrão no SVG; 78 é o novo valor para dual-stack
      g.setAttribute('transform', ipv4 ? 'translate(0, 78)' : 'translate(0, 46)');
    }
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
    var d = { ip: ip.ip, org: [ip.asn, ip.region].filter(Boolean).join(' · ') };
    if (ip.ipv4) d.ipv4 = ip.ipv4;
    return d;
  };

  // Menu "Relatório": injeta os resultados do teste (e IP) na URL antes de navegar.
  // Independe de tenant — vale para qualquer hostname.
  // Só é habilitado DEPOIS que um teste for realizado (window.vlkResults existe):
  // até lá fica com opacity 0.45 (SVG) e o clique não navega. O observer do
  // "All done" (abaixo) reativa esses elementos junto com o botão Compartilhar.
  var vlkSetHrefRelatorio = function (a) {
    var q = [];
    var r = window.vlkResults;
    if (r) q.push('d=' + r.d, 'u=' + r.u, 'p=' + r.p, 'j=' + r.j, 'dd=' + r.dd, 'ud=' + r.ud);
    var dados = vlkIpOrg();
    if (dados) {
      q.push('ip=' + encodeURIComponent(dados.ip));
      if (dados.org) q.push('org=' + encodeURIComponent(dados.org));
      if (dados.ipv4) q.push('ipv4=' + encodeURIComponent(dados.ipv4));
    }
    // Teste "Complete": sinaliza a rede (o relatório lê os dados do localStorage)
    if (window.vlkNetResults) q.push('net=1');
    // Qualidade da conexão: mesmo mecanismo (dados volumosos demais para a URL)
    if (window.vlkQos) q.push('qos=1');
    // Perfis de uso: o relatório os recalcula a partir das mesmas medições
    if (window.vlkPerfis) q.push('perfis=1');
    // Conexão única: idem — só entra se a medição já tiver terminado
    if (window.vlkSingle) q.push('single=1');
    if (window._tenantParam) q.push(window._tenantParam);
    var url = '/relatorio.html' + (q.length ? '?' + q.join('&') : '');
    if (a.setAttributeNS) a.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    a.setAttribute('href', url);
  };
  var relatorioEls = [];
  var vlkLigaRelatorio = function (a) {
    if (!a) return;
    relatorioEls.push(a);
    a.addEventListener('click', function (ev) {
      // Sem teste realizado, o botão está desabilitado: não navega.
      if (!window.vlkResults) { if (ev.preventDefault) ev.preventDefault(); return; }
      vlkSetHrefRelatorio(this);
    });
  };
  // Menu do SVG (desktop + mobile)
  ['vlk-menu-relatorio', 'vlk-menu-relatorio-mob'].forEach(function (id) {
    vlkLigaRelatorio(svgDoc.getElementById(id));
  });
  // Menu superior fixo do modo "Complete" (HTML, fora do SVG)
  vlkLigaRelatorio(document.getElementById('vlk-sticky-relatorio'));

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

    // Cabeçalho (logo + marca + tagline) — repetido no topo de cada página
    var desenhaCabecalho = function () {
      if (gear) doc.addImage(gear, 'PNG', 15, 12, 12, 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(azul[0], azul[1], azul[2]);
      doc.text(tName.toUpperCase(), 30, 19.5);
      doc.setFontSize(9);
      doc.setTextColor(cinza[0], cinza[1], cinza[2]);
      doc.setFont('helvetica', 'normal');
      doc.text(pT('pdf.tagline'), 30.4, 24);
    };
    desenhaCabecalho();

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
      [pT(dados && dados.ipv4 ? 'pdf.ipv6' : 'pdf.ip'), dados ? dados.ip : '—']
    ];
    if (dados && dados.ipv4) {
      linhas.push([pT('pdf.ipv4'), dados.ipv4]);
    }
    linhas.push([pT('pdf.provider'), dados && dados.org ? dados.org : '—']);
    linhas.push([pT('pdf.server'), location.hostname]);

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
    y = 92 + (dados && dados.ipv4 ? 9 : 0);
    var met = [
      [pT('app.download'), fmt1(r.d), 'Mbps'],
      [pT('app.upload'), fmt1(r.u), 'Mbps'],
      [pT('app.ping'), fmt1(r.p), 'ms'],
      [pT('app.jitter'), fmt1(r.j), 'ms']
    ];
    var bx = 15, bw = 42, bh = 30, gap = 4;
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
    var obsY = 132 + (dados && dados.ipv4 ? 9 : 0);
    var obs = pT('pdf.data', { dd: fmt1(r.dd), ud: fmt1(r.ud) });
    doc.text(obs, 15, obsY);
    var nota = doc.splitTextToSize(pT('pdf.note', { name: tName }), 180);
    doc.text(nota, 15, obsY + 7);

    // Nota técnica (caixa em destaque)
    var laranja = [225, 94, 48];
    var notaTec = doc.splitTextToSize(pT('pdf.tech'), 170);
    var notaY = obsY + 22, notaH = 13 + notaTec.length * 3.6;
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

    // Helpers compartilhados pelas páginas extras (qualidade e conectividade)
    var qcor = function (cls) {
      return cls === 'bom' ? [31, 157, 77] : cls === 'medio' ? [184, 134, 11]
           : cls === 'ruim' ? [211, 54, 43] : [60, 60, 60];
    };
    var clsLat  = function (v) { return v == null ? '' : v < 50 ? 'bom' : v < 120 ? 'medio' : 'ruim'; };
    var clsJit  = function (v) { return v == null ? '' : v < 10 ? 'bom' : v < 30  ? 'medio' : 'ruim'; };
    var clsLoss = function (v) { return v == null ? '' : v <= 0 ? 'bom' : v < 3  ? 'medio' : 'ruim'; };
    var msf  = function (v) { return (v == null || !isFinite(v)) ? '—' : fmt1(v) + ' ms'; };
    var pctf = function (v) { return (v == null || !isFinite(v)) ? '—' : Math.round(v) + '%'; };
    var mbpsf = function (v) { return (v == null || !isFinite(v)) ? '—' : fmt1(v) + ' Mbps'; };
    var cor = function (rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); };
    var cabTabela = function (hdr, cols, y) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); cor(azul);
      hdr.forEach(function (h, i) { doc.text(h, cols[i], y); });
      doc.setDrawColor(220, 224, 228); doc.line(15, y + 1.5, 195, y + 1.5);
      doc.setFont('helvetica', 'normal');
      return y + 6.5;
    };

    // ---- Qualidade da conexão — página extra ----
    // Abre com os perfis de uso (a leitura em linguagem de gente) e segue com as
    // medições que os geraram. A página existe se houver qualquer um dos dois.
    var qos = window.vlkQos;
    var perfis = window.vlkPerfis;
    var qy = 0;   // 0 = página de qualidade não existe (nada a mostrar)
    var clsBloat = function (v) { return v == null ? '' : v < 30 ? 'bom' : v < 200 ? 'medio' : 'ruim'; };
    var clsCv    = function (v) { return v == null ? '' : v < 0.10 ? 'bom' : v < 0.30 ? 'medio' : 'ruim'; };
    if ((perfis && perfis.perfis && perfis.perfis.length) || (qos && qos.idle != null)) {
      doc.addPage();
      desenhaCabecalho();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      cor(escuro); doc.text(pT('qos.reportTitle'), 15, 40);
      qy = 50;
    }

    if (perfis && perfis.perfis && perfis.perfis.length) {
      var pl = window.VLK_PERFIS ? window.VLK_PERFIS.label : function (k) { return k; };
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
      doc.text(pT('prof.reportTitle'), 15, qy); qy += 6;
      qy = cabTabela([pT('prof.thProfile'), pT('prof.thGrade'), pT('prof.thWhy')], [15, 80, 115], qy);
      perfis.perfis.forEach(function (p) {
        cor([40, 40, 40]); doc.text(pl('prof.name.' + p.key), 15, qy);
        cor(qcor(p.cls)); doc.text(pl('prof.grade.' + p.nota), 80, qy);
        cor([60, 60, 60]);
        doc.text(p.limitante ? pl('prof.factor.' + p.limitante) : pl('prof.noLimit'), 115, qy);
        doc.setDrawColor(240, 241, 243); doc.line(15, qy + 1.6, 195, qy + 1.6); qy += 6.5;
      });
      qy += 2;
      doc.setFontSize(8.5); cor([80, 85, 90]);
      var notaP = perfis.mosIdle != null ? pl('prof.mosNote') : '';
      if (perfis.parcial) notaP = (notaP ? notaP + ' ' : '') + pl('prof.partial');
      if (notaP) {
        var linhasP = doc.splitTextToSize(notaP, 180);
        doc.text(linhasP, 15, qy);
        qy += linhasP.length * 3.8 + 6;
      }
    }

    if (qos && qos.idle != null) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
      doc.text(pT('qos.reportBloat'), 15, qy); qy += 6;
      qy = cabTabela([pT('qos.thState'), pT('connect.thLat'), pT('qos.thIncrease')], [15, 95, 140], qy);

      cor([40, 40, 40]); doc.text(pT('qos.idle'), 15, qy);
      cor([60, 60, 60]); doc.text(msf(qos.idle), 95, qy); doc.text('—', 140, qy);
      doc.setDrawColor(240, 241, 243); doc.line(15, qy + 1.6, 195, qy + 1.6); qy += 6.5;

      [['dl', 'qos.duringDl'], ['ul', 'qos.duringUl']].forEach(function (f) {
        var x = qos[f[0]];
        if (!x) return;
        cor([40, 40, 40]); doc.text(pT(f[1]), 15, qy);
        cor(qcor(clsBloat(x.aumento)));
        doc.text(msf(x.latencia), 95, qy);
        doc.text('+' + Math.round(x.aumento) + ' ms', 140, qy);
        doc.setDrawColor(240, 241, 243); doc.line(15, qy + 1.6, 195, qy + 1.6); qy += 6.5;
      });

      var chaveB = (qos.nota === 'A+' || qos.nota === 'A') ? 'ok'
                 : (qos.nota === 'B' || qos.nota === 'C') ? 'medio' : 'ruim';
      qy += 2;
      doc.setFontSize(8.5); cor([80, 85, 90]);
      doc.text(doc.splitTextToSize(pT('qos.nota') + ': ' + qos.nota + ' — ' +
        pT('qos.bloatExpl.' + chaveB), 180), 15, qy);
      qy += 12;

      var vv = qos.velocidade || {};
      // pior dos dois sentidos, como na tela (ver qualidade.js)
      var refQ = (vv.dl && vv.ul) ? ((vv.dl.cv || 0) >= (vv.ul.cv || 0) ? vv.dl : vv.ul) : (vv.dl || vv.ul);
      if (refQ) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
        doc.text(pT('qos.reportStab'), 15, qy); qy += 6;
        qy = cabTabela([pT('qos.thPhase'), pT('qos.thMedian'), pT('qos.thMin'),
                        pT('qos.variation'), pT('qos.dips')], [15, 75, 115, 155, 180], qy);
        [['dl', 'qos.download'], ['ul', 'qos.upload']].forEach(function (f) {
          var r = vv[f[0]];
          if (!r) return;
          cor([40, 40, 40]); doc.text(pT(f[1]), 15, qy);
          cor([60, 60, 60]);
          doc.text(mbpsf(r.mediana), 75, qy);
          doc.text(mbpsf(r.minimo), 115, qy);
          cor(qcor(clsCv(r.cv)));
          doc.text(pctf(r.cv != null ? r.cv * 100 : null), 155, qy);
          if (r.quedas) { cor(qcor('ruim')); doc.text(String(r.quedas), 180, qy); }
          else { cor([60, 60, 60]); doc.text('—', 180, qy); }
          doc.setDrawColor(240, 241, 243); doc.line(15, qy + 1.6, 195, qy + 1.6); qy += 6.5;
        });
        qy += 2;
        doc.setFontSize(8.5); cor([80, 85, 90]);
        doc.text(doc.splitTextToSize(pT('qos.stab.' + refQ.estabilidade) + ' — ' +
          pT('qos.stabExpl.' + refQ.estabilidade), 180), 15, qy);
        qy += 16;
      }
    }

    // ---- Conexão única × múltiplas conexões ----
    // Fica junto da qualidade (é o mesmo assunto: o que a média em Mbps não
    // conta). Só ganha página própria quando a de qualidade não existe ou já
    // está cheia.
    var sc = window.vlkSingle;
    if (sc && sc.single > 0) {
      var sy;
      if (qy > 0 && qy < 235) {
        sy = qy;
      } else {
        doc.addPage();
        desenhaCabecalho();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        cor(escuro); doc.text(pT('qos.reportTitle'), 15, 40);
        sy = 50;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
      doc.text(pT('single.reportTitle'), 15, sy); sy += 6;
      sy = cabTabela([pT('single.thWhat'), pT('single.thValue')], [15, 120], sy);

      var linhaSc = function (rotulo, valor, cls) {
        cor([40, 40, 40]); doc.text(rotulo, 15, sy);
        cor(qcor(cls || ''));
        doc.text(valor, 120, sy);
        doc.setDrawColor(240, 241, 243); doc.line(15, sy + 1.6, 195, sy + 1.6);
        sy += 6.5;
      };
      linhaSc(pT('single.oneLabel'), mbpsf(sc.single), sc.cls);
      linhaSc(pT('single.sixLabel'), mbpsf(sc.multi));
      linhaSc(pT('single.ratio'), Math.round(Math.min(1, sc.ratio) * 100) + '%', sc.cls);
      if (sc.showWindow) {
        linhaSc(pT('single.window'),
          sc.windowBytes >= 1048576 ? fmt1(sc.windowBytes / 1048576) + ' MB'
                                    : Math.round(sc.windowBytes / 1024) + ' KB',
          sc.smallWindow ? 'ruim' : '');
      }
      sy += 2;
      var explSc = pT('single.expl.' + sc.grade);
      if (sc.smallWindow) explSc += ' ' + pT('single.smallWindow');
      doc.setFontSize(8.5); cor([80, 85, 90]);
      doc.text(doc.splitTextToSize(explSc, 180), 15, sy);
    }

    // ---- Análise de conectividade (teste "Complete") — página extra ----
    var net = window.vlkNetResults;
    if (net && ((net.cliente || []).length || (net.servidor || []).length)) {
      doc.addPage();
      desenhaCabecalho();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      cor(escuro); doc.text(pT('connect.title'), 15, 40);

      var yy = 50;
      // Tabela cliente
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
      doc.text(pT('connect.cliTitle'), 15, yy); yy += 6;
      var colsC = [15, 95, 130, 165];
      var hdrC = [pT('connect.thDest'), pT('connect.thLat'), pT('connect.thJit'), pT('connect.thFail')];
      doc.setFontSize(9); cor(azul);
      hdrC.forEach(function (h, i) { doc.text(h, colsC[i], yy); });
      doc.setDrawColor(220, 224, 228); doc.line(15, yy + 1.5, 195, yy + 1.5); yy += 6.5;
      doc.setFont('helvetica', 'normal');
      (net.cliente || []).forEach(function (rr) {
        cor([40, 40, 40]); doc.text(String(rr.label || ''), colsC[0], yy);
        if (!rr.amostras) {
          cor(qcor('ruim')); doc.text(pT('connect.unreachable'), colsC[1], yy);
        } else {
          cor(qcor(clsLat(rr.latency)));  doc.text(msf(rr.latency), colsC[1], yy);
          cor(qcor(clsJit(rr.jitter)));   doc.text(msf(rr.jitter),  colsC[2], yy);
          cor(qcor(clsLoss(rr.loss)));    doc.text(pctf(rr.loss),   colsC[3], yy);
        }
        doc.setDrawColor(240, 241, 243); doc.line(15, yy + 1.6, 195, yy + 1.6); yy += 6.5;
      });

      // Tabela servidor
      yy += 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); cor(azul);
      doc.text(pT('connect.srvTitle'), 15, yy); yy += 6;
      var colsS = [15, 85, 115, 150, 178];
      var hdrS = [pT('connect.thDest'), pT('connect.thHops'), pT('connect.thLat'), pT('connect.thJit'), pT('connect.thLoss')];
      doc.setFontSize(9); cor(azul);
      hdrS.forEach(function (h, i) { doc.text(h, colsS[i], yy); });
      doc.setDrawColor(220, 224, 228); doc.line(15, yy + 1.5, 195, yy + 1.5); yy += 6.5;
      doc.setFont('helvetica', 'normal');
      (net.servidor || []).forEach(function (rr) {
        cor([40, 40, 40]); doc.text(String(rr.label || ''), colsS[0], yy);
        if (rr.na) {
          cor([130, 130, 130]); doc.text(pT('connect.srvNa'), colsS[1], yy);
        } else {
          cor([60, 60, 60]); doc.text(rr.hops != null ? String(rr.hops) : '—', colsS[1], yy);
          cor(qcor(clsLat(rr.avg)));    doc.text((rr.filtered ? '~ ' : '') + msf(rr.avg), colsS[2], yy);
          cor(qcor(clsJit(rr.jitter))); doc.text(msf(rr.jitter), colsS[3], yy);
          if (rr.filtered) { cor([60, 60, 60]); doc.text('—', colsS[4], yy); }
          else { cor(qcor(clsLoss(rr.loss))); doc.text(pctf(rr.loss), colsS[4], yy); }
        }
        doc.setDrawColor(240, 241, 243); doc.line(15, yy + 1.6, 195, yy + 1.6); yy += 6.5;
      });
    }

    // Rodapé + numeração de páginas (N/total) em TODAS as páginas
    var totalPg = doc.getNumberOfPages();
    for (var pg = 1; pg <= totalPg; pg++) {
      doc.setPage(pg);
      doc.setDrawColor(236, 238, 241);
      doc.line(15, 280, 195, 280);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(cinza[0], cinza[1], cinza[2]);
      if (tcfg.poweredBy !== false) doc.text('Powered by Vialink - 2026', 15, 285.5);
      doc.text(pg + '/' + totalPg, 105, 285.5, { align: 'center' });
      doc.text(location.hostname, 195, 285.5, { align: 'right' });
    }

    return doc.output('blob');
  };

  // A pílula é só o ícone — a mensagem de feedback aparece ao lado dela
  var vlkShareFeedback = function (g, txtId, msg) {
    var t = document.getElementById(txtId) || svgDoc.getElementById(txtId);
    if (!t) return;
    t.textContent = msg;
    setTimeout(function () { t.textContent = ''; }, 2500);
  };

  // Gera o PDF do relatório e abre o painel nativo de compartilhamento (ou baixa,
  // se o navegador não suportar Web Share). Reutilizada pela pílula do menu (SVG)
  // e pelos botões da página do teste "Complete". `feedback(msg)` mostra o aviso.
  var vlkExecShare = function (feedback) {
    if (!window.vlkResults) { feedback(vlkT('share.first')); return; }
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
        feedback(vlkT('share.downloaded'));
      }
    }).catch(function () {
      feedback(vlkT('share.error'));
    });
  };

  var shareEls = pegaEls2(['vlk-share', 'vlk-share-mob']);
  function pegaEls2(ids) {
    return ids.map(function (id) { return svgDoc.getElementById(id); })
              .filter(function (el) { return el; });
  }
  shareEls.forEach(function (g) {
    var txtId = g.id === 'vlk-share' ? 'vlk-share-txt' : 'vlk-share-txt-mob';
    g.addEventListener('click', function () {
      vlkExecShare(function (msg) { vlkShareFeedback(g, txtId, msg); });
    });
  });

  // Botões "Relatório" e "Compartilhar" da resposta do teste "Complete" (HTML,
  // dentro de #vlk-net-inline). A seção só abre depois do teste, então já nascem
  // ativos. O Relatório reusa vlkLigaRelatorio (injeta os resultados na URL).
  vlkLigaRelatorio(document.getElementById('vlk-net-report'));
  var netShareBtn = document.getElementById('vlk-net-share');
  if (netShareBtn) {
    netShareBtn.addEventListener('click', function () {
      vlkExecShare(function (msg) {
        var fb = document.getElementById('vlk-net-share-fb');
        if (!fb) return;
        fb.textContent = msg;
        setTimeout(function () { fb.textContent = ''; }, 2500);
      });
    });
  }

  // Teste "Complete": ao fim da velocidade, revela a seção de rede embutida,
  // rola até ela e roda a análise de conectividade (mesma engine da aba Rede).
  // Os resultados vão para window.vlkNetResults e localStorage (para o relatório).
  // Barra de menu fixa: no modo Complete, mostra o menu superior (com o botão
  // Relatório) assim que o usuário rola para baixo do topo — onde o menu do SVG
  // já saiu da viewport. No topo fica oculta para não duplicar o menu do SVG.
  var vlkStickyScrollBound = false;
  function vlkSetupStickyScroll() {
    if (vlkStickyScrollBound) return;
    vlkStickyScrollBound = true;
    var onScroll = function () {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      document.body.classList.toggle('vlk-scrolled', y > 60);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var NET_OPTS = {
    clienteId: 'vlk-net-cli', servidorId: 'vlk-net-srv',
    avisoId: 'vlk-net-aviso', notaId: 'vlk-net-nota', idadeId: 'vlk-net-idade'
  };

  // Validade do resultado pré-aquecido. Curta de propósito: passado isso, a
  // conexão do usuário pode ter mudado e a medição deixa de representá-la.
  var VLK_NET_TTL = 3 * 60 * 1000;
  var vlkNetPromise = null; // pré-aquecimento em curso (reaproveitado pelo botão)

  function vlkNetCacheGrava(res) {
    try {
      sessionStorage.setItem('vlkNetPrewarm', JSON.stringify({ res: res, ts: Date.now() }));
    } catch (e) {}
  }

  function vlkNetCacheLe() {
    try {
      var o = JSON.parse(sessionStorage.getItem('vlkNetPrewarm'));
      if (!o || !o.res || (Date.now() - o.ts) > VLK_NET_TTL) return null;
      return o.res;
    } catch (e) { return null; }
  }

  // Adota um resultado: publica para o relatório/PDF e grava no banco.
  function vlkNetAdota(res) {
    if (!res || (!res.cliente.length && !res.servidor.length)) return;
    window.vlkNetResults = res;
    try {
      localStorage.setItem('vlkNetResults', JSON.stringify({
        cliente: res.cliente, servidor: res.servidor,
        houveFiltrado: res.houveFiltrado, ts: Date.now()
      }));
    } catch (e) {}
    vlkSalvarConectividade(res); // grava a conectividade no banco (testes_rede)
  }

  // Conexão única: mede o que UM fluxo TCP entrega, para comparar com as 6
  // conexões do teste. Precisa dos resultados (é deles que sai a referência) e
  // satura o link enquanto roda — por isso vem ANTES da análise de rede, que
  // mede latência e ficaria contaminada se as duas rodassem juntas. Tudo o que
  // depende da rede espera esta promise; ela nunca rejeita nem fica pendente
  // (há um teto de espera pelos resultados).
  var vlkSinglePromise = null;
  function vlkSingleDone() {
    if (vlkSinglePromise) return vlkSinglePromise;
    if (!window.VLK_SINGLE) return Promise.resolve(null);
    vlkSinglePromise = new Promise(function (resolve) {
      if (window.vlkResults) { resolve(); return; }
      var t = setTimeout(resolve, 8000);
      window.addEventListener('vlk:results', function () {
        clearTimeout(t);
        resolve();
      }, { once: true });
    }).then(function () {
      return window.VLK_SINGLE.run();
    }).then(function (s) {
      if (s) vlkSalvarSingle(s);
      return s;
    })["catch"](function () { return null; });
    return vlkSinglePromise;
  }

  // Pré-aquecimento: mede a rede em segundo plano, sem tocar na tela.
  //
  // Só faz sentido DEPOIS do "All done": durante o teste de banda o link está
  // saturado, e qualquer medição de latência/jitter sairia inútil (bufferbloat)
  // além de roubar banda da própria medição de velocidade. Já no fim do teste o
  // link fica ocioso enquanto o usuário lê o resultado — ~25 s livres, que é
  // exatamente o tempo da análise.
  function vlkPrewarmRede() {
    if (vlkNetPromise) return vlkNetPromise;
    if (!window.VLK_CONECT) return null;
    // Economia de dados ligada: não medimos o que o usuário não pediu
    var con = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (con && con.saveData) return null;

    var cache = vlkNetCacheLe();
    if (cache) {
      vlkNetAdota(cache);
      vlkNetPromise = Promise.resolve(cache);
      return vlkNetPromise;
    }
    vlkNetPromise = vlkSingleDone().then(function () {
      return window.VLK_CONECT.run({ silent: true });
    }).then(function (res) {
      if (res && (res.cliente.length || res.servidor.length)) {
        vlkNetCacheGrava(res);
        vlkNetAdota(res);
      }
      return res;
    });
    return vlkNetPromise;
  }

  // Rola até o início da resposta — a seção de qualidade, quando já estiver
  // pronta, senão a de rede. Só é chamada depois que a qualidade renderizou:
  // ela fica ACIMA da rede no documento, e rolar antes faria o conteúdo saltar
  // debaixo do usuário quando ela entrasse (chega uns 2 s após o "All done").
  var vlkRolou = false;
  function vlkRolaAteResposta() {
    if (vlkRolou) return;
    var alvo = document.getElementById('vlk-perfis');
    if (!alvo || !alvo.classList.contains('aberto')) alvo = document.getElementById('vlk-qos');
    if (!alvo || !alvo.classList.contains('aberto')) alvo = document.getElementById('vlk-net-inline');
    if (!alvo || !alvo.classList.contains('aberto')) return;
    vlkRolou = true;
    try { alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }

  // Revela a seção de rede embutida (o scroll vem depois — ver acima)
  function vlkAbreSecaoRede() {
    var sec = document.getElementById('vlk-net-inline');
    if (!sec || !window.VLK_CONECT) return null;
    document.body.classList.add('vlk-complete-open');
    vlkSetupStickyScroll();
    sec.classList.add('aberto');
    sec.setAttribute('aria-hidden', 'false');
    // Rede à espera dos resultados: se por algum motivo o evento não vier,
    // ainda assim rolamos, para o Complete não parecer que não fez nada.
    setTimeout(vlkRolaAteResposta, 4000);
    return sec;
  }

  // Perfis de uso: leitura das medições em linguagem do dia a dia. Recalcula do
  // zero a cada chamada — é barato (aritmética sobre números já medidos) e
  // garante que a conexão única, que chega alguns segundos depois, entre na
  // conta assim que existir.
  function vlkRenderPerfis() {
    if (!window.VLK_PERFIS) return;
    try { VLK_PERFIS.render(); } catch (e) {}
  }

  // Qualidade da conexão: renderizada quando os resultados existem de fato.
  window.addEventListener('vlk:results', function () {
    if (window.VLK_QOS && window.vlkQos) {
      try { VLK_QOS.render(window.vlkQos); } catch (e) {}
      // Disponível para o relatório, que abre em outra aba
      try { localStorage.setItem('vlkQos', JSON.stringify(window.vlkQos)); } catch (e) {}
    }
    vlkRenderPerfis();
    // Conexão única: começa agora, com o link livre e os resultados prontos.
    // Quem depende da rede já está encadeado nesta mesma promise.
    vlkSingleDone();
    if (window.vlkTestMode === 'complete') vlkRolaAteResposta();
  });

  // A conexão única chega depois de todo o resto e muda dois perfis (streaming
  // e home office dependem do que UM fluxo entrega). Reescrever os cards no
  // lugar não desloca nada: a quantidade e a ordem deles não mudam.
  window.addEventListener('vlk:single', vlkRenderPerfis);

  // Teste "Complete": ao fim da velocidade, abre a seção e mostra a análise.
  // Se o pré-aquecimento desta sessão ainda estiver válido (ex.: o usuário fez
  // um teste rápido, recarregou e pediu o Complete), o resultado aparece na
  // hora, sem remedir.
  function vlkRunNetworkInline() {
    if (!vlkAbreSecaoRede()) return;
    var cache = vlkNetCacheLe();
    if (cache) {
      window.VLK_CONECT.render(NET_OPTS, cache);
      vlkNetAdota(cache);
      return;
    }
    // A medição de conexão única satura o link; as latências desta análise só
    // fazem sentido depois que ela termina. Enquanto isso, as tabelas mostram
    // as linhas pendentes em vez de ficarem vazias.
    window.VLK_CONECT.placeholder(NET_OPTS);
    vlkSingleDone().then(function () {
      return window.VLK_CONECT.run(NET_OPTS);
    }).then(function (res) {
      if (!res) return;
      vlkNetCacheGrava(res);
      vlkNetAdota(res);
    });
  }

  // Teste "Fast": abre a seção com o resultado que já foi medido em segundo
  // plano. Se a medição ainda não terminou, mostra as linhas pendentes e pinta
  // quando ela chegar — em nenhum caso o teste de velocidade é refeito.
  function vlkAbreRedePreAquecida(p) {
    if (!vlkAbreSecaoRede()) return;
    if (window.vlkNetResults) {
      window.VLK_CONECT.render(NET_OPTS, window.vlkNetResults);
      return;
    }
    window.VLK_CONECT.placeholder(NET_OPTS);
    if (p) p.then(function (res) { if (res) window.VLK_CONECT.render(NET_OPTS, res); });
    else vlkRunNetworkInline(); // pré-aquecimento indisponível: mede ao vivo
  }

  // Convite "Análise de rede" no fim do teste rápido
  function vlkMostraCtaRede() {
    var cta = document.getElementById('vlk-net-cta');
    var btn = document.getElementById('vlk-net-cta-btn');
    var fb  = document.getElementById('vlk-net-cta-fb');
    if (!cta || !btn) return;
    var p = vlkNetPromise;
    document.body.classList.add('vlk-cta-ready');
    cta.setAttribute('aria-hidden', 'false');
    if (fb && p && !window.vlkNetResults) {
      fb.textContent = vlkT('connect.ctaPreparing');
      p.then(function () { fb.textContent = ''; });
    }
    btn.addEventListener('click', function () { vlkAbreRedePreAquecida(p); }, { once: true });
  }

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
        // Ativa os botões Compartilhar e Relatório e pré-carrega o gerador de PDF
        shareEls.forEach(function (el) { el.removeAttribute('opacity'); });
        relatorioEls.forEach(function (el) { if (el.removeAttribute) el.removeAttribute('opacity'); });
        vlkLoadJsPdf();
        vlkLoadGear();
        // Teste "Complete": encadeia a análise de rede logo após a velocidade.
        // Teste "Fast": mede a rede em segundo plano (o link está ocioso agora)
        // e oferece o resultado num botão — se o usuário quiser, ele aparece
        // pronto, sem refazer o teste de velocidade.
        if (window.vlkTestMode === 'complete') {
          vlkRunNetworkInline();
        } else {
          vlkPrewarmRede();
          setTimeout(vlkMostraCtaRede, 1200);
        }
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
