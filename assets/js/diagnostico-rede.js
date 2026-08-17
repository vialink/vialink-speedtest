// Diagnóstico da conexão — três coisas que a velocidade não conta e que
// aparecem em quase toda reclamação de suporte.
//
//   1. TIPO DE NAT / CGNAT. Quem está atrás de CGNAT divide um IP público com
//      dezenas de assinantes: não recebe conexão de fora (câmera, DVR, acesso
//      remoto, servidor de jogo), cai em CAPTCHA com frequência e às vezes é
//      bloqueado por reputação do IP alheio. Pior ainda quando o NAT é
//      SIMÉTRICO — o mapeamento muda conforme o destino, o que quebra a conexão
//      direta de jogos, VoIP e videochamada, que passa a depender de relay.
//      Descobrimos comparando o IP/porta que um servidor STUN enxerga (UDP) com
//      o IP que chega no nosso servidor (TCP).
//
//   2. MTU DO CAMINHO. O navegador não pode medir: HTTP não escolhe tamanho de
//      pacote e ICMP está fora de alcance. Mas o kernel do servidor negociou a
//      MSS desta conexão e sabe a resposta (ver api/conexao.php). MTU menor que
//      1500 é normal em PPPoE (1492); bem menor denuncia túnel/VPN, e é a causa
//      clássica de "abre uns sites e outros não" e de download que trava.
//
//   3. TEMPO DE RESOLUÇÃO DNS. É o atraso que aparece ANTES de qualquer byte —
//      o sintoma de "internet lenta para abrir sites" em uma conexão cuja
//      velocidade está ótima. Medimos com a Resource Timing API do próprio
//      navegador e comparamos com o tempo de uma query aos resolvers públicos,
//      que a análise de conectividade já mede.
//
// O que este módulo NÃO faz: dizer QUAL resolver o cliente usa (8.8.8.8, o do
// provedor, o da casa). Isso exige ver a query chegando no servidor autoritativo
// — apoio do lado do DNS, não do navegador. Ficou registrado como evolução.

(function () {
  'use strict';

  var STUN_TIMEOUT = 2500;      // tempo máximo esperando candidatos
  var FETCH_TIMEOUT = 4000;

  // Servidores STUN padrão. Um binding request STUN não carrega dado do
  // usuário: pergunta "de que IP/porta você me vê?" e recebe a resposta. Ainda
  // assim é tráfego para terceiros — quem hospeda pode apontar para um STUN
  // próprio ou desligar a checagem com `stunServers: []` no tenant.
  var STUN_PADRAO = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

  // --- utilidades ------------------------------------------------------------

  function privado(ip) {
    if (!ip || ip.indexOf(':') >= 0) return null;   // IPv6: fora deste teste
    var p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(isNaN)) return null;
    if (p[0] === 10) return 'rfc1918';
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 'rfc1918';
    if (p[0] === 192 && p[1] === 168) return 'rfc1918';
    if (p[0] === 169 && p[1] === 254) return 'linklocal';
    // 100.64.0.0/10 — espaço reservado para CGNAT (RFC 6598). Ver este
    // endereço já É a resposta: há NAT de operadora no caminho.
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return 'cgnat';
    return null;
  }

  // Extrai {ip, porta, tipo, portaLocal} de uma linha de candidato ICE.
  // Formato: "candidate:<fund> <comp> udp <pri> <ip> <porta> typ <tipo> [raddr <ip> rport <porta>]"
  function parseCandidato(linha) {
    if (!linha) return null;
    var m = /candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\S+)/i.exec(linha);
    if (!m) return null;
    var c = { proto: m[1].toLowerCase(), ip: m[2], porta: +m[3], tipo: m[4].toLowerCase() };
    var r = /rport (\d+)/i.exec(linha);
    if (r) c.portaLocal = +r[1];
    // Navegadores modernos trocam o IP local por um nome mDNS (xxx.local) para
    // não vazar a rede interna. Não é erro — só não temos o endereço local.
    c.mdns = /\.local$/i.test(c.ip);
    return c;
  }

  // Coleta candidatos ICE com UM ÚNICO RTCPeerConnection e os dois servidores
  // STUN. Tem de ser um só: é a mesma porta local consultando destinos
  // diferentes que revela NAT simétrico (mapeamento dependente do destino).
  // Dois PeerConnections usariam portas locais diferentes e a comparação não
  // significaria nada.
  function coletaCandidatos(servidores) {
    return new Promise(function (resolve) {
      var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection ||
                window.mozRTCPeerConnection;
      if (!RTC || !servidores || !servidores.length) { resolve(null); return; }

      var pc, pronto = false, cands = [];
      function fim() {
        if (pronto) return;
        pronto = true;
        try { pc.close(); } catch (e) {}
        resolve(cands);
      }
      try {
        pc = new RTC({ iceServers: [{ urls: servidores }] });
      } catch (e) { resolve(null); return; }

      pc.onicecandidate = function (e) {
        if (!e.candidate) { fim(); return; }          // fim da coleta
        var c = parseCandidato(e.candidate.candidate);
        if (c) cands.push(c);
      };
      try {
        pc.createDataChannel('vlk');
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
          ["catch"](function () { fim(); });
      } catch (e) { fim(); return; }
      setTimeout(fim, STUN_TIMEOUT);
    });
  }

  // --- NAT -------------------------------------------------------------------

  // Classifica o NAT a partir dos candidatos e do IP que o NOSSO servidor vê.
  //
  // `direct`    — o endereço público é do próprio dispositivo: sem NAT.
  // `nat`       — NAT comum, mapeamento estável (o caso doméstico saudável).
  // `symmetric` — a porta pública muda conforme o destino: conexão direta de
  //               jogo/VoIP/vídeo quebra e passa a depender de relay.
  // `cgnat`     — NAT da operadora: endereço 100.64/10 no caminho, ou o IP de
  //               saída UDP diferente do de saída TCP (pool de endereços).
  // `unknown`   — WebRTC bloqueado ou STUN inacessível: sem diagnóstico.
  function classificaNat(cands, ipServidor) {
    if (!cands) return { tipo: 'unknown', motivo: 'sem-webrtc' };

    var srflx = cands.filter(function (c) { return c.tipo === 'srflx'; });
    var host  = cands.filter(function (c) { return c.tipo === 'host' && !c.mdns; });

    if (!srflx.length) {
      return { tipo: 'unknown', motivo: cands.length ? 'sem-srflx' : 'sem-candidatos' };
    }

    var ips = {}, portasPorLocal = {};
    srflx.forEach(function (c) {
      ips[c.ip] = true;
      var k = c.portaLocal || 0;
      (portasPorLocal[k] = portasPorLocal[k] || {})[c.porta] = true;
    });
    var listaIps = Object.keys(ips);

    // Mesma porta local mapeada em portas públicas diferentes = simétrico.
    var simetrico = Object.keys(portasPorLocal).some(function (k) {
      return Object.keys(portasPorLocal[k]).length > 1;
    });

    var cgnatPorFaixa = listaIps.some(function (ip) { return privado(ip) === 'cgnat'; }) ||
                        host.some(function (c) { return privado(c.ip) === 'cgnat'; });

    // Saídas diferentes para UDP (STUN) e TCP (este servidor) indicam um pool de
    // endereços entre o assinante e a internet — assinatura de CGNAT.
    //
    // Duas guardas, ambas necessárias:
    //   * mesma família de endereço — com IPv6 no HTTP e IPv4 no STUN os dois
    //     endereços diferem por natureza, e todo cliente dual-stack viraria
    //     falso CGNAT;
    //   * o IP visto pelo servidor precisa ser PÚBLICO. Quando o teste é
    //     acessado pela rede interna (127.0.0.1, 192.168.x, intranet), o
    //     servidor vê um endereço privado e o STUN vê o público: são grandezas
    //     diferentes, não um pool. Sem esta guarda, toda instalação em rede
    //     local acusa CGNAT — foi o que aconteceu no primeiro teste real.
    var mesmaFamilia = ipServidor && ipServidor.indexOf(':') < 0 &&
                       listaIps.every(function (ip) { return ip.indexOf(':') < 0; });
    var servidorPublico = ipServidor && privado(ipServidor) === null &&
                          ipServidor.indexOf('127.') !== 0;
    var poolDeIps = mesmaFamilia && servidorPublico && listaIps.length > 0 &&
                    listaIps.indexOf(ipServidor) < 0;

    var tipo;
    if (cgnatPorFaixa || poolDeIps) tipo = 'cgnat';
    else if (simetrico) tipo = 'symmetric';
    else if (host.some(function (c) { return listaIps.indexOf(c.ip) >= 0; })) tipo = 'direct';
    else tipo = 'nat';

    return {
      tipo: tipo,
      ipPublico: listaIps[0] || null,
      ipsPublicos: listaIps,
      ipServidor: ipServidor || null,
      simetrico: simetrico,
      cgnatPorFaixa: cgnatPorFaixa,
      poolDeIps: poolDeIps
    };
  }

  // --- MTU -------------------------------------------------------------------

  function classificaMtu(mtu) {
    if (mtu == null) return null;
    if (mtu >= 1500) return { chave: 'ethernet', cls: 'bom' };
    if (mtu >= 1492) return { chave: 'pppoe', cls: 'bom' };      // PPPoE é a norma no ISP
    // Faixa dos túneis reais: WireGuard ~1420, OpenVPN/IPsec ~1400, e há VPN
    // corporativa em 1360–1380 (uma delas medida em produção: MSS 1335 = MTU
    // 1375). Chamar isso de "muito baixa" seria alarme falso — custa desempenho,
    // mas funciona. Abaixo de 1300 é que costuma ser túnel sobre túnel, aí a
    // fragmentação começa a quebrar site.
    if (mtu >= 1300) return { chave: 'tunel', cls: 'medio' };
    return { chave: 'baixo', cls: 'ruim' };
  }

  function leConexao() {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, FETCH_TIMEOUT);
      fetch('/api/conexao.php', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { clearTimeout(t); resolve(j); })
        ["catch"](function () { clearTimeout(t); resolve(null); });
    });
  }

  // --- DNS -------------------------------------------------------------------

  // Tempo de resolução do nome, pela Resource Timing API do navegador.
  //
  // Duas fontes, nesta ordem: a navegação da própria página (sempre exposta) e
  // os recursos carregados de outros domínios desta instalação. Ambas só trazem
  // número quando houve resolução DE VERDADE — com o nome em cache, os dois
  // carimbos são iguais e o resultado é zero. Zero não é "DNS instantâneo": é
  // "não medido", e é assim que reportamos, porque anunciar 0 ms enganaria.
  //
  // ⚠️ Para recursos de outra origem, os campos de DNS só aparecem se o servidor
  // mandar `Timing-Allow-Origin` (ver INSTALL). Sem o header, resta a navegação.
  function medeDns() {
    try {
      if (!window.performance || !performance.getEntriesByType) return null;
      var cands = [];
      var nav = performance.getEntriesByType('navigation') || [];
      nav.forEach(function (e) {
        if (e.domainLookupEnd > 0 && e.domainLookupStart > 0) {
          cands.push(e.domainLookupEnd - e.domainLookupStart);
        }
      });
      (performance.getEntriesByType('resource') || []).forEach(function (e) {
        if (e.domainLookupEnd > 0 && e.domainLookupStart > 0 &&
            e.domainLookupEnd - e.domainLookupStart > 0) {
          cands.push(e.domainLookupEnd - e.domainLookupStart);
        }
      });
      var uteis = cands.filter(function (v) { return v > 0.5; });   // <0,5 ms = cache
      if (!uteis.length) return null;
      uteis.sort(function (a, b) { return a - b; });
      return uteis[Math.floor(uteis.length / 2)];                   // mediana
    } catch (e) { return null; }
  }

  // Referência: o tempo de uma query DNS real aos resolvers públicos, que a
  // análise de conectividade já mede (destinos marcados com `doh`). Serve para
  // dizer "o seu DNS está lento" com um número ao lado, em vez de no vácuo.
  function referenciaDns() {
    var r = window.vlkNetResults;
    if (!r || !r.cliente) return null;
    var vals = r.cliente.filter(function (d) {
      return d && d.doh && d.latency != null && d.amostras;
    }).map(function (d) { return d.latency; });
    if (!vals.length) return null;
    return Math.min.apply(null, vals);
  }

  function classificaDns(ms, ref) {
    if (ms == null) return null;
    // Régua absoluta primeiro: até 50 ms ninguém percebe; acima de 200 ms cada
    // domínio novo de uma página pesa antes do primeiro byte.
    var cls = ms < 50 ? 'bom' : ms < 200 ? 'medio' : 'ruim';
    // Comparação com o resolver público só piora a nota, nunca melhora: um DNS
    // rápido em termos absolutos está bom mesmo que o público seja mais rápido.
    if (ref != null && ref > 0 && ms > ref * 4 && ms > 60 && cls === 'bom') cls = 'medio';
    return cls;
  }

  // --- execução --------------------------------------------------------------

  var ultimo = null;
  var rodando = null;

  function run(opts) {
    if (rodando) return rodando;
    opts = opts || {};
    var cfg = window._tenantConfig || {};
    var stun = cfg.stunServers === undefined ? STUN_PADRAO : cfg.stunServers;

    rodando = Promise.all([coletaCandidatos(stun), leConexao()]).then(function (r) {
      var cands = r[0], con = r[1];
      var ipServidor = con && con.ip ? con.ip : null;

      var mtuInfo = null;
      if (con && con.mtu) {
        mtuInfo = {
          mtu: con.mtu, mss: con.mss, pmtu: con.pmtu,
          rtt: con.rtt, rttvar: con.rttvar,
          classe: classificaMtu(con.mtu)
        };
      }

      var dnsMs = medeDns(), dnsRef = referenciaDns();

      ultimo = {
        nat: classificaNat(cands, ipServidor),
        mtu: mtuInfo,
        dns: dnsMs == null ? null : { ms: dnsMs, ref: dnsRef, cls: classificaDns(dnsMs, dnsRef) },
        ipServidor: ipServidor
      };
      window.vlkDiag = ultimo;
      try { localStorage.setItem('vlkDiag', JSON.stringify(ultimo)); } catch (e) {}
      if (!opts.silent) render(ultimo);
      try { window.dispatchEvent(new CustomEvent('vlk:diag')); } catch (e) {}
      return ultimo;
    })["catch"](function () { return null; });

    return rodando;
  }

  // --- apresentação ----------------------------------------------------------

  function tr(key, fallback, params) {
    if (window.vlkT) {
      var s = window.vlkT(key, params);
      if (s && s !== key) return s;
    }
    if (params) {
      fallback = String(fallback).replace(/\{(\w+)\}/g, function (_, k) {
        return params[k] != null ? params[k] : '';
      });
    }
    return fallback;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var FB = {
    'diag.title': 'Diagnóstico da conexão',
    'diag.intro': 'Três verificações que explicam problemas que a velocidade não mostra.',
    'diag.thCheck': 'Verificação',
    'diag.thResult': 'Resultado',
    'diag.nat': 'Tipo de conexão',
    'diag.mtu': 'MTU do caminho',
    'diag.dns': 'Resolução de nomes (DNS)',

    'diag.nat.direct': 'IP público direto',
    'diag.nat.nat': 'NAT comum',
    'diag.nat.symmetric': 'NAT simétrico',
    'diag.nat.cgnat': 'CGNAT (IP compartilhado)',
    'diag.nat.unknown': 'não verificado',
    'diag.nat.expl.direct': 'O endereço público é do seu próprio equipamento. Você pode receber conexões de fora (câmera, acesso remoto, servidor) sem intermediário.',
    'diag.nat.expl.nat': 'Conexão atrás de um NAT comum, com mapeamento estável — o normal de uma casa ou escritório. Jogos e chamadas conseguem conexão direta.',
    'diag.nat.expl.symmetric': 'O endereço público muda conforme o destino (NAT simétrico). Jogos, videochamadas e VoIP não conseguem conexão direta e passam por servidor intermediário, o que adiciona atraso.',
    'diag.nat.expl.cgnat': 'Você compartilha o endereço público com outros assinantes (CGNAT). Consequências: não é possível receber conexões de fora sem IP dedicado, CAPTCHA aparece com mais frequência e um bloqueio causado por outro usuário do mesmo IP atinge você.',
    'diag.nat.expl.unknown': 'Não foi possível verificar — o navegador bloqueou o WebRTC ou o servidor STUN não respondeu.',
    'diag.nat.ports': 'porta pública muda conforme o destino',
    'diag.nat.pool': 'a saída UDP e a TCP usam endereços diferentes',

    'diag.mtu.ethernet': '{v} bytes (padrão)',
    'diag.mtu.pppoe': '{v} bytes (PPPoE)',
    'diag.mtu.tunel': '{v} bytes (túnel/VPN)',
    'diag.mtu.baixo': '{v} bytes (muito baixa)',
    'diag.mtu.expl.ethernet': 'Tamanho de pacote padrão da internet — nada sendo perdido em fragmentação.',
    'diag.mtu.expl.pppoe': 'Valor normal de conexões PPPoE (fibra e ADSL de operadora). Não é problema.',
    'diag.mtu.expl.tunel': 'Há um túnel ou VPN no caminho reduzindo o tamanho do pacote. Custa desempenho, e sites que não tratam bem a fragmentação podem abrir pela metade.',
    'diag.mtu.expl.baixo': 'Tamanho de pacote bem abaixo do normal — costuma vir de túnel sobre túnel. É causa clássica de página que não carrega e download que trava no meio.',
    'diag.mtu.rtt': 'latência medida pelo servidor: {v} ms',

    'diag.dns.value': '{v} ms',
    'diag.dns.expl.bom': 'Os nomes de sites são resolvidos rapidamente — nada a fazer aqui.',
    'diag.dns.expl.medio': 'A resolução de nomes está mais lenta que o desejável: cada site novo demora um pouco antes do primeiro byte, mesmo com a velocidade em ordem.',
    'diag.dns.expl.ruim': 'A resolução de nomes está lenta. É o que faz a navegação parecer arrastada mesmo com a velocidade alta — trocar o servidor DNS do roteador costuma resolver.',
    'diag.dns.ref': 'um resolver público responde em {v} ms',
    'diag.dns.cached': 'não medido (o nome já estava em cache)',
    'diag.checking': 'verificando…'
  };

  function t(key, params) { return tr(key, FB[key] != null ? FB[key] : key, params); }

  function ms(v) { return v == null ? '—' : (v < 10 ? v.toFixed(1) : String(Math.round(v))); }

  function linha(rotulo, valor, cls, expl, extra) {
    return '<tr><th>' + esc(rotulo) + '</th>' +
      '<td class="' + (cls || '') + '">' + esc(valor) +
      (extra ? ' <span class="diag-extra">' + esc(extra) + '</span>' : '') + '</td>' +
      '<td class="diag-expl">' + esc(expl) + '</td></tr>';
  }

  function html(d) {
    var linhas = '';

    if (d.nat) {
      var cls = d.nat.tipo === 'cgnat' || d.nat.tipo === 'symmetric' ? 'medio'
              : d.nat.tipo === 'unknown' ? '' : 'bom';
      var extra = d.nat.simetrico ? t('diag.nat.ports')
                : d.nat.poolDeIps ? t('diag.nat.pool') : null;
      linhas += linha(t('diag.nat'), t('diag.nat.' + d.nat.tipo), cls,
                      t('diag.nat.expl.' + d.nat.tipo), extra);
    }

    if (d.mtu && d.mtu.classe) {
      linhas += linha(t('diag.mtu'),
                      t('diag.mtu.' + d.mtu.classe.chave, { v: d.mtu.mtu }),
                      d.mtu.classe.cls,
                      t('diag.mtu.expl.' + d.mtu.classe.chave),
                      d.mtu.rtt != null ? t('diag.mtu.rtt', { v: ms(d.mtu.rtt) }) : null);
    }

    if (d.dns) {
      linhas += linha(t('diag.dns'), t('diag.dns.value', { v: ms(d.dns.ms) }), d.dns.cls,
                      t('diag.dns.expl.' + d.dns.cls),
                      d.dns.ref != null ? t('diag.dns.ref', { v: ms(d.dns.ref) }) : null);
    }

    return linhas;
  }

  function render(d) {
    d = d || ultimo;
    var sec = document.getElementById('vlk-diag');
    var corpo = document.getElementById('vlk-diag-corpo');
    if (!sec || !corpo || !d) return false;
    var linhas = html(d);
    if (!linhas) return false;
    corpo.innerHTML = linhas;
    sec.style.display = '';
    return true;
  }

  // Linhas em branco enquanto a verificação roda. Existem para o bloco já
  // ocupar o seu espaço: ele fica ACIMA das tabelas de destino, e aparecer
  // depois empurraria a tabela para baixo debaixo do olho de quem está lendo.
  function placeholder() {
    var sec = document.getElementById('vlk-diag');
    var corpo = document.getElementById('vlk-diag-corpo');
    if (!sec || !corpo || corpo.innerHTML) return false;
    corpo.innerHTML = [t('diag.nat'), t('diag.mtu'), t('diag.dns')].map(function (r) {
      return '<tr><th>' + esc(r) + '</th><td class="estado">…</td>' +
             '<td class="diag-expl estado">' + esc(t('diag.checking')) + '</td></tr>';
    }).join('');
    sec.style.display = '';
    return true;
  }

  // --- API -------------------------------------------------------------------

  window.VLK_DIAG = {
    run: run,
    render: render,
    placeholder: placeholder,
    summary: function () { return ultimo; },
    reset: function () {
      rodando = null; ultimo = null; window.vlkDiag = null;
      try { localStorage.removeItem('vlkDiag'); } catch (e) {}
    },
    label: t,

    // exposto para teste (a classificação roda fora do navegador)
    _test: {
      privado: privado,
      parseCandidato: parseCandidato,
      classificaNat: classificaNat,
      classificaMtu: classificaMtu,
      classificaDns: classificaDns
    }
  };
})();
