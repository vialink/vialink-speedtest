// Análise de conectividade (conectividade.html).
//
// Duas camadas, medidas de origens diferentes e rotuladas como tal:
//
//  1. CLIENTE (este arquivo, no navegador do usuário): latência, jitter e taxa
//     de falhas de cada destino, medidas com requisições HTTPS cronometradas
//     (fetch no-cors). É a latência de conexão TCP/TLS — não é ICMP; o navegador
//     não tem acesso a socket raw, então traceroute/ping ICMP são impossíveis
//     aqui. Reflete a experiência real da conexão do assinante.
//
//  2. SERVIDOR (api/diagnostico.php, roda mtr no CT714): traceroute com salto a
//     salto, latência, jitter (desvio-padrão) e PERDA DE PACOTES reais (ICMP).
//     Mede a rota "nossa rede -> destino" (igual para todos os clientes) — útil
//     para diagnosticar o nosso peering/uplink. Se o endpoint não existir (ex.:
//     ambiente estático local), a seção degrada para "indisponível".
//
// Destinos: window._tenantConfig.connectivityTargets (definidos no tenants.js).
(function () {
  'use strict';

  var SAMPLES   = 12;      // amostras cronometradas por destino
  var WARMUP     = 3;      // amostras iniciais descartadas — estabelecem DNS/TCP/TLS
                            // para as medidas pegarem o RTT "quente" (keep-alive), não o handshake
  var TIMEOUT_MS = 4000;   // além disto a amostra conta como falha
  var GAP_MS     = 90;     // intervalo entre amostras (espaça como um ping)
  var TRIM       = 0.2;    // descarta os 20% de amostras mais lentas (picos) antes da mediana

  // Tradução com fallback pt-BR (i18n é opcional nesta página)
  function tr(key, fallback, params) {
    if (window.vlkT) { var s = window.vlkT(key, params); if (s && s !== key) return s; }
    if (params) fallback = fallback.replace(/\{(\w+)\}/g, function (_, k) { return params[k] != null ? params[k] : ''; });
    return fallback;
  }

  function fmt(v, dec) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dec == null ? 1 : dec); }

  // Faixa de qualidade -> classe de cor (bom / médio / ruim)
  function classeLatencia(ms) { return ms == null ? '' : ms < 50 ? 'bom' : ms < 120 ? 'medio' : 'ruim'; }
  function classeJitter(ms)   { return ms == null ? '' : ms < 10 ? 'bom' : ms < 30  ? 'medio' : 'ruim'; }
  function classePerda(pct)   { return pct == null ? '' : pct <= 0 ? 'bom' : pct < 3 ? 'medio' : 'ruim'; }

  // Uma sonda cronometrada, via Image() (técnica clássica de "web ping").
  //
  // Por que Image e não fetch: só nos interessa o TEMPO, não o conteúdo. O
  // onload/onerror dispara QUANDO a resposta volta — mesmo que o navegador
  // decida bloquear a leitura dos bytes. Já o `fetch` no-cors REJEITA quando o
  // host marca o recurso com Cross-Origin-Resource-Policy / ORB (UOL, Teams,
  // Microsoft fazem isso no favicon) — dava "sem resposta" em hosts que estão
  // perfeitamente acessíveis. Com Image, esses hosts passam a medir o RTT real.
  //
  // Só o timeout conta como falha (destino inalcançável ou porta 443 fechada).
  // Limitação assumida: um host realmente morto pode disparar onerror muito
  // rápido (RTT falso-baixo) — a camada do servidor (mtr) é a medida autoritativa.
  function sonda(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var acabou = false;
      var t0 = performance.now();
      var timer = setTimeout(function () {
        if (acabou) return; acabou = true;
        img.src = 'about:blank'; // aborta a tentativa em curso
        resolve({ ok: false, dt: null });
      }, TIMEOUT_MS);
      img.onload = img.onerror = function () {
        if (acabou) return; acabou = true; clearTimeout(timer);
        resolve({ ok: true, dt: performance.now() - t0 });
      };
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      img.src = url + sep + 'vlkcb=' + Date.now() + '_' + Math.random().toString(36).slice(2);
    });
  }

  // Sonda cronometrada por fetch (para alvos que liberam CORS e cuja resposta é
  // legível): uma QUERY DNS-over-HTTPS (dns.google/1.1.1.1) ou uma OCA local da
  // Netflix (range pequeno). Mede o RTT real da requisição; param aleatório fura
  // o cache HTTP para cada amostra ir de fato à rede.
  function sondaFetch(url, accept) {
    return new Promise(function (resolve) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var acabou = false;
      var t0 = performance.now();
      var timer = setTimeout(function () {
        if (acabou) return; acabou = true;
        if (ctrl) ctrl.abort();
        resolve({ ok: false, dt: null });
      }, TIMEOUT_MS);
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      var busted = url + sep + '_vlk=' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var opts = { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined };
      if (accept) opts.headers = { 'accept': accept }; // header safelisted → sem preflight
      fetch(busted, opts)
        .then(function (r) { return r.text().catch(function () { return ''; }); })
        .then(function () {
          if (acabou) return; acabou = true; clearTimeout(timer);
          resolve({ ok: true, dt: performance.now() - t0 });
        })
        .catch(function () {
          if (acabou) return; acabou = true; clearTimeout(timer);
          resolve({ ok: false, dt: null });
        });
    });
  }

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Descobre uma OCA local da Netflix pelo nosso proxy (api/netflix-oca.php).
  // Retorna a URL de teste (range pequeno) ou null se indisponível.
  async function descobreOca() {
    try {
      var r = await fetch('/api/netflix-oca.php', { cache: 'no-store' });
      if (!r.ok) return null;
      var j = await r.json();
      return (j && j.ok && j.url) ? j.url : null;
    } catch (e) { return null; }
  }

  // Mede um destino: WARMUP descartadas + SAMPLES medidas -> {avg, jitter, loss}
  async function medeCliente(target, onProgress) {
    // Escolhe como medir cada destino:
    //  - Netflix (`oca`): mede a OCA LOCAL (streaming) — o que o cliente percebe;
    //    se o proxy falhar, cai no favicon do site (www.netflix.com).
    //  - Servidor de DNS (`doh`): mede o tempo de uma query DNS-over-HTTPS.
    //  - Demais: sonda HTTPS por Image().
    var probeFn;
    if (target.oca) {
      var ocaUrl = await descobreOca();
      if (ocaUrl) {
        probeFn = function () { return sondaFetch(ocaUrl); };
      } else {
        var fav = target.probe || ('https://' + target.host + '/favicon.ico');
        probeFn = function () { return sonda(fav); };
      }
    } else if (target.doh) {
      probeFn = function () { return sondaFetch(target.doh, target.dohAccept); };
    } else {
      var url = target.probe || ('https://' + target.host + '/favicon.ico');
      probeFn = function () { return sonda(url); };
    }
    for (var w = 0; w < WARMUP; w++) { await probeFn(); await espera(GAP_MS); }

    var oks = [], falhas = 0;
    for (var i = 0; i < SAMPLES; i++) {
      var r = await probeFn();
      if (r.ok) oks.push(r.dt); else falhas++;
      if (onProgress) onProgress(i + 1, SAMPLES);
      await espera(GAP_MS);
    }

    if (!oks.length) {
      return { latency: null, min: null, jitter: null, loss: 100, amostras: 0, falhas: falhas };
    }

    // Jitter: média das diferenças absolutas consecutivas (variação percebida),
    // na ordem de chegada e sobre todas as amostras boas.
    var jitter = 0;
    if (oks.length > 1) {
      var dif = 0; for (var j = 1; j < oks.length; j++) dif += Math.abs(oks[j] - oks[j - 1]);
      jitter = dif / (oks.length - 1);
    }

    // Latência: descarta os TRIM% mais lentos (picos de GC/rede/handshake
    // residual) e toma a MEDIANA do restante — número típico e estável. O
    // mínimo é o "melhor caso", mais perto do RTT puro da rota.
    var ordenado = oks.slice().sort(function (a, b) { return a - b; });
    var min = ordenado[0];
    var manter = Math.max(1, Math.floor(ordenado.length * (1 - TRIM)));
    var base = ordenado.slice(0, manter);
    var meio = Math.floor(base.length / 2);
    var latency = (base.length % 2) ? base[meio] : (base[meio - 1] + base[meio]) / 2;

    return { latency: latency, min: min, jitter: jitter, loss: (falhas / SAMPLES) * 100, amostras: oks.length, falhas: falhas };
  }

  // Diagnóstico do servidor (mtr). Envia só o ÍNDICE do destino — o host vem da
  // allowlist do servidor, nunca do cliente. Retorna null se indisponível.
  async function diagnosticoServidor(indice) {
    try {
      var resp = await fetch('/api/diagnostico.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ target: indice })
      });
      if (!resp.ok) return null;
      var j = await resp.json();
      return (j && j.ok) ? j : null;
    } catch (e) { return null; }
  }

  // ---- Renderização + execução ----
  // Este módulo expõe window.VLK_CONECT.run(opts) — usado tanto pela página
  // standalone (conectividade.html) quanto pela seção embutida no teste
  // "Complete" (index.html). Cada página tem UM conjunto de tabelas, então os
  // ids de linha 'cli-N'/'srv-N' nunca colidem.
  var houveFiltrado = false;

  function celula(valor, classe) {
    return '<td class="' + (classe || '') + '">' + valor + '</td>';
  }

  function subDestino(t) {
    return t.oca
      ? tr('connect.ocaSub', 'Open Connect (CDN local)')
      : (t.host + (t.ip && t.ip !== t.host ? ' (' + t.ip + ')' : ''));
  }

  function linhaClienteInicial(t, idx) {
    var sub = subDestino(t);
    return '<tr id="cli-' + idx + '">' +
      '<td class="destino">' + t.label + '<br><span class="host">' + sub + '</span></td>' +
      '<td class="estado" colspan="4">' + tr('connect.pending', 'aguardando…') + '</td></tr>';
  }

  function preencheCliente(idx, r) {
    var tr_ = document.getElementById('cli-' + idx);
    if (!tr_) return;
    if (!r.amostras) {
      tr_.innerHTML = tr_.querySelector('.destino').outerHTML +
        '<td class="ruim" colspan="4">' + tr('connect.unreachable', 'sem resposta no navegador') + '</td>';
      return;
    }
    // Latência = mediana (típica); segunda linha mostra o mínimo (melhor caso).
    var latCell = '<td class="' + classeLatencia(r.latency) + '">' + fmt(r.latency) + ' ms'
      + '<br><span class="host">' + tr('connect.min', 'mín') + ' ' + fmt(r.min) + ' ms</span></td>';
    tr_.innerHTML = tr_.querySelector('.destino').outerHTML +
      latCell +
      celula(fmt(r.jitter) + ' ms', classeJitter(r.jitter)) +
      celula(fmt(r.loss, 0) + '%', classePerda(r.loss)) +
      celula(r.amostras + '/' + SAMPLES, '');
  }

  function linhaServidorInicial(t, idx) {
    return '<tr id="srv-' + idx + '">' +
      '<td class="destino">' + t.label + '<br><span class="host">' + t.host + '</span></td>' +
      '<td class="estado" colspan="4">' + tr('connect.pending', 'aguardando…') + '</td></tr>';
  }

  function preencheServidor(idx, j) {
    var tr_ = document.getElementById('srv-' + idx);
    if (!tr_) return;
    var destinoHtml = tr_.querySelector('.destino').outerHTML;
    if (!j || !j.dest) {
      tr_.innerHTML = destinoHtml + '<td class="estado" colspan="4">' + tr('connect.srvNa', 'indisponível') + '</td>';
      return;
    }
    var d = j.dest;
    var latTxt, lossTxt, lossCls;
    if (d.filtered) {
      // Destino filtra ICMP: a latência é até o último salto que respondeu e a
      // perda até o destino não é mensurável por ICMP.
      latTxt = '≈ ' + fmt(d.avg) + ' ms';
      lossTxt = '—'; lossCls = '';
      houveFiltrado = true;
    } else {
      latTxt = fmt(d.avg) + ' ms';
      lossTxt = fmt(d.loss, 0) + '%'; lossCls = classePerda(d.loss);
    }
    tr_.innerHTML = destinoHtml +
      celula((j.hops != null ? j.hops : '—'), '') +
      celula(latTxt, classeLatencia(d.avg)) +
      celula(fmt(d.jitter) + ' ms', classeJitter(d.jitter)) +
      celula(lossTxt, lossCls);
  }

  // Executa a análise nas tabelas indicadas por opts e devolve os resultados
  // coletados (para o relatório). opts:
  //   { clienteId, servidorId, avisoId?, notaId?, onStart?, onFinish? }
  var rodando = false;
  async function run(opts) {
    opts = opts || {};
    var alvos = (window._tenantConfig || {}).connectivityTargets || [];
    var corpoCliente  = document.getElementById(opts.clienteId);
    var corpoServidor = document.getElementById(opts.servidorId);
    var avisoServidor = opts.avisoId ? document.getElementById(opts.avisoId) : null;
    var notaFiltrado  = opts.notaId ? document.getElementById(opts.notaId) : null;
    if (rodando || !corpoCliente || !corpoServidor || !alvos.length) {
      return { cliente: [], servidor: [], temServidor: false, houveFiltrado: false };
    }
    rodando = true;
    houveFiltrado = false;
    if (notaFiltrado) notaFiltrado.style.display = 'none';
    if (avisoServidor) avisoServidor.style.display = 'none';
    if (opts.onStart) opts.onStart();

    // Reinicia as tabelas
    corpoCliente.innerHTML = '';
    corpoServidor.innerHTML = '';
    for (var i = 0; i < alvos.length; i++) {
      corpoCliente.insertAdjacentHTML('beforeend', linhaClienteInicial(alvos[i], i));
      corpoServidor.insertAdjacentHTML('beforeend', linhaServidorInicial(alvos[i], i));
    }

    var resCliente = new Array(alvos.length);
    var resServidor = new Array(alvos.length);

    // Dispara TODOS os diagnósticos do servidor em paralelo (rodam no CT714,
    // não competem com a medição do cliente). Preenche cada um ao chegar.
    var temServidor = false;
    var promServidor = alvos.map(function (t, idx) {
      return diagnosticoServidor(idx).then(function (j) {
        if (j) temServidor = true;
        preencheServidor(idx, j);
        var d = j && j.dest;
        resServidor[idx] = {
          label: t.label, host: t.host,
          hops: (j && j.hops != null) ? j.hops : null,
          avg: d ? d.avg : null, jitter: d ? d.jitter : null,
          loss: d ? d.loss : null, filtered: !!(d && d.filtered), na: !d
        };
      });
    });

    // Camada cliente: sequencial (destinos em paralelo disputariam a banda e
    // inflariam a latência). Atualiza a linha ao terminar cada destino.
    for (var a = 0; a < alvos.length; a++) {
      var tr_ = document.getElementById('cli-' + a);
      var estado = tr_ && tr_.querySelector('.estado');
      /* eslint-disable no-loop-func */
      var r = await medeCliente(alvos[a], (function (cell) {
        return function (n, tot) { if (cell) cell.textContent = tr('connect.measuring', 'medindo… {n}/{tot}', { n: n, tot: tot }); };
      })(estado));
      preencheCliente(a, r);
      resCliente[a] = {
        label: alvos[a].label, sub: subDestino(alvos[a]),
        latency: r.latency, min: r.min, jitter: r.jitter,
        loss: r.loss, amostras: r.amostras
      };
    }

    await Promise.all(promServidor);
    if (!temServidor && avisoServidor) avisoServidor.style.display = '';
    if (houveFiltrado && notaFiltrado) notaFiltrado.style.display = '';
    if (opts.onFinish) opts.onFinish();
    rodando = false;

    return { cliente: resCliente, servidor: resServidor, temServidor: temServidor, houveFiltrado: houveFiltrado };
  }

  window.VLK_CONECT = { run: run };

  // Página standalone (conectividade.html): liga o botão à execução.
  function init() {
    var botao = document.getElementById('btn-analisar');
    if (!botao) return;
    var alvos = (window._tenantConfig || {}).connectivityTargets || [];
    if (!alvos.length) { botao.disabled = true; botao.textContent = tr('connect.noTargets', 'Nenhum destino configurado'); return; }
    botao.addEventListener('click', function () {
      run({
        clienteId: 'tabela-cliente', servidorId: 'tabela-servidor',
        avisoId: 'aviso-servidor', notaId: 'nota-filtrado',
        onStart:  function () { botao.disabled = true;  botao.textContent = tr('connect.running', 'Analisando…'); },
        onFinish: function () { botao.disabled = false; botao.textContent = tr('connect.again', 'Analisar novamente'); }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
