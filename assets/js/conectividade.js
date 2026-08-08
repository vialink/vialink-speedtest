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
  // Este módulo expõe:
  //
  //   VLK_CONECT.run(opts)          mede e, salvo modo silencioso, pinta ao vivo
  //   VLK_CONECT.render(opts, res)  pinta a partir de um resultado já medido
  //   VLK_CONECT.placeholder(opts)  pinta as linhas "aguardando…"
  //
  // É usado pela página standalone (conectividade.html) e pela seção embutida no
  // teste "Complete" (index.html). Cada página tem UM conjunto de tabelas, então
  // os ids de linha 'cli-N'/'srv-N' nunca colidem.
  //
  // O modo silencioso (opts.silent) existe para o PRÉ-AQUECIMENTO: quando o
  // teste rápido termina, o link fica ocioso e o usuário está lendo o resultado
  // — é a única janela em que dá para medir latência sem contaminar nada (medir
  // DURANTE o teste de banda daria números de link saturado e ainda roubaria
  // banda da medição). Medimos ali, sem tabelas na tela; se o usuário pedir a
  // análise depois, render() pinta o resultado instantaneamente.
  var houveFiltrado = false;

  function celula(valor, classe) {
    return '<td class="' + (classe || '') + '">' + valor + '</td>';
  }

  function subDestino(t) {
    return t.oca
      ? tr('connect.ocaSub', 'Open Connect (CDN local)')
      : (t.host + (t.ip && t.ip !== t.host ? ' (' + t.ip + ')' : ''));
  }

  // Rótulo do destino: marcas ficam como estão; rótulos genéricos (ex.: o de
  // referência internacional) trazem labelKey para tradução via i18n.
  function rotulo(t) {
    return t.labelKey ? tr(t.labelKey, t.label) : t.label;
  }

  function celulaDestino(label, sub) {
    return '<td class="destino">' + label + '<br><span class="host">' + sub + '</span></td>';
  }

  function linhaPendente(id, label, sub) {
    return '<tr id="' + id + '">' + celulaDestino(label, sub) +
      '<td class="estado" colspan="4">' + tr('connect.pending', 'aguardando…') + '</td></tr>';
  }

  // Células de resultado a partir do registro já coletado (o mesmo formato que
  // vai para o relatório e para o banco). Ficam separadas da medição para que
  // um resultado pré-aquecido possa ser pintado depois, sem remedir.
  function celulasCliente(c) {
    if (!c || !c.amostras) {
      return '<td class="ruim" colspan="4">' + tr('connect.unreachable', 'sem resposta no navegador') + '</td>';
    }
    // Latência = mediana (típica); segunda linha mostra o mínimo (melhor caso).
    return '<td class="' + classeLatencia(c.latency) + '">' + fmt(c.latency) + ' ms' +
      '<br><span class="host">' + tr('connect.min', 'mín') + ' ' + fmt(c.min) + ' ms</span></td>' +
      celula(fmt(c.jitter) + ' ms', classeJitter(c.jitter)) +
      celula(fmt(c.loss, 0) + '%', classePerda(c.loss)) +
      celula(c.amostras + '/' + SAMPLES, '');
  }

  function celulasServidor(s) {
    if (!s || s.na) {
      return '<td class="estado" colspan="4">' + tr('connect.srvNa', 'indisponível') + '</td>';
    }
    var latTxt, lossTxt, lossCls;
    if (s.filtered) {
      // Destino filtra ICMP: a latência é até o último salto que respondeu e a
      // perda até o destino não é mensurável por ICMP.
      latTxt = '≈ ' + fmt(s.avg) + ' ms';
      lossTxt = '—'; lossCls = '';
    } else {
      latTxt = fmt(s.avg) + ' ms';
      lossTxt = fmt(s.loss, 0) + '%'; lossCls = classePerda(s.loss);
    }
    return celula((s.hops != null ? s.hops : '—'), '') +
      celula(latTxt, classeLatencia(s.avg)) +
      celula(fmt(s.jitter) + ' ms', classeJitter(s.jitter)) +
      celula(lossTxt, lossCls);
  }

  // Resposta do endpoint -> registro persistível (relatório/banco)
  function normServidor(t, j) {
    var d = j && j.dest;
    return {
      label: rotulo(t), host: t.host,
      hops: (j && j.hops != null) ? j.hops : null,
      avg: d ? d.avg : null, jitter: d ? d.jitter : null,
      loss: d ? d.loss : null, filtered: !!(d && d.filtered), na: !d
    };
  }

  function preencheLinha(id, celulas) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = el.querySelector('.destino').outerHTML + celulas;
  }

  // A camada do servidor é COMPARTILHADA (a rota "nossa rede -> destino" é a
  // mesma para todo cliente) e vem de um cache atualizado por cron. Dizer há
  // quanto tempo foi medida é mais honesto do que deixar parecer que saiu do
  // clique deste usuário.
  function textoIdade(seg) {
    if (seg < 90) return tr('connect.srvAgeNow', 'Medição do servidor: agora há pouco.');
    return tr('connect.srvAge', 'Medição do servidor: há {n} min — a rota é a mesma para todos os clientes e é atualizada a cada 5 minutos.', { n: Math.round(seg / 60) });
  }

  function aplicaNotas(opts, res) {
    var aviso = opts.avisoId ? document.getElementById(opts.avisoId) : null;
    var nota  = opts.notaId  ? document.getElementById(opts.notaId)  : null;
    var idade = opts.idadeId ? document.getElementById(opts.idadeId) : null;
    if (aviso) aviso.style.display = res.temServidor ? 'none' : '';
    if (nota)  nota.style.display  = res.houveFiltrado ? '' : 'none';
    if (idade) {
      var mostra = res.temServidor && res.idade != null;
      idade.textContent = mostra ? textoIdade(res.idade) : '';
      idade.style.display = mostra ? '' : 'none';
    }
  }

  // Pinta as linhas "aguardando…" (usado ao abrir a seção antes de haver dados)
  function placeholder(opts) {
    var alvos = (window._tenantConfig || {}).connectivityTargets || [];
    var cc = document.getElementById(opts.clienteId);
    var cs = document.getElementById(opts.servidorId);
    if (cc) {
      cc.innerHTML = alvos.map(function (t, i) {
        return linhaPendente('cli-' + i, rotulo(t), subDestino(t));
      }).join('');
    }
    if (cs) {
      cs.innerHTML = alvos.map(function (t, i) {
        return linhaPendente('srv-' + i, rotulo(t), t.host);
      }).join('');
    }
  }

  // Pinta um resultado JÁ medido (pré-aquecimento ou cache de sessão)
  function render(opts, res) {
    if (!res) return;
    var cc = document.getElementById(opts.clienteId);
    var cs = document.getElementById(opts.servidorId);
    if (cc) {
      cc.innerHTML = (res.cliente || []).map(function (c) {
        return '<tr>' + celulaDestino(c.label, c.sub) + celulasCliente(c) + '</tr>';
      }).join('');
    }
    if (cs) {
      cs.innerHTML = (res.servidor || []).map(function (s) {
        return '<tr>' + celulaDestino(s.label, s.host) + celulasServidor(s) + '</tr>';
      }).join('');
    }
    aplicaNotas(opts, res);
  }

  // Executa a análise e devolve os resultados coletados (para o relatório). opts:
  //   { clienteId, servidorId, avisoId?, notaId?, idadeId?, silent?, onStart?, onFinish? }
  // Com silent=true não toca no DOM — é o modo do pré-aquecimento.
  var rodando = false;
  async function run(opts) {
    opts = opts || {};
    var mudo = !!opts.silent;
    var alvos = (window._tenantConfig || {}).connectivityTargets || [];
    var corpoCliente  = mudo ? null : document.getElementById(opts.clienteId);
    var corpoServidor = mudo ? null : document.getElementById(opts.servidorId);
    var vazio = { cliente: [], servidor: [], temServidor: false, houveFiltrado: false, idade: null };
    if (rodando || !alvos.length) return vazio;
    if (!mudo && (!corpoCliente || !corpoServidor)) return vazio;

    rodando = true;
    houveFiltrado = false;
    if (opts.onStart) opts.onStart();
    if (!mudo) {
      aplicaNotas(opts, vazio);           // esconde notas da rodada anterior
      placeholder(opts);                  // reinicia as tabelas
    }

    var resCliente = new Array(alvos.length);
    var resServidor = new Array(alvos.length);

    // Dispara TODOS os diagnósticos do servidor em paralelo (leem o cache do
    // cron no CT714 — não competem com a medição do cliente). O `idade` é o
    // mais velho dos retornos: todos vêm do mesmo ciclo do cron.
    var temServidor = false;
    var idade = null;
    var promServidor = alvos.map(function (t, idx) {
      return diagnosticoServidor(idx).then(function (j) {
        if (j) temServidor = true;
        if (j && typeof j.age === 'number' && (idade === null || j.age > idade)) idade = j.age;
        var s = normServidor(t, j);
        if (s.filtered) houveFiltrado = true;
        resServidor[idx] = s;
        if (!mudo) preencheLinha('srv-' + idx, celulasServidor(s));
      });
    });

    // Camada cliente: sequencial (destinos em paralelo disputariam a banda e
    // inflariam a latência). Atualiza a linha ao terminar cada destino.
    for (var a = 0; a < alvos.length; a++) {
      var estado = null;
      if (!mudo) {
        var tr_ = document.getElementById('cli-' + a);
        estado = tr_ && tr_.querySelector('.estado');
      }
      /* eslint-disable no-loop-func */
      var r = await medeCliente(alvos[a], (function (cell) {
        if (!cell) return null;
        return function (n, tot) { cell.textContent = tr('connect.measuring', 'medindo… {n}/{tot}', { n: n, tot: tot }); };
      })(estado));
      var c = {
        label: rotulo(alvos[a]), sub: subDestino(alvos[a]),
        latency: r.latency, min: r.min, jitter: r.jitter,
        loss: r.loss, amostras: r.amostras
      };
      resCliente[a] = c;
      if (!mudo) preencheLinha('cli-' + a, celulasCliente(c));
    }

    await Promise.all(promServidor);
    var res = {
      cliente: resCliente, servidor: resServidor,
      temServidor: temServidor, houveFiltrado: houveFiltrado, idade: idade
    };
    if (!mudo) aplicaNotas(opts, res);
    if (opts.onFinish) opts.onFinish();
    rodando = false;

    return res;
  }

  window.VLK_CONECT = { run: run, render: render, placeholder: placeholder };

  // Página standalone (conectividade.html): liga o botão à execução.
  function init() {
    var botao = document.getElementById('btn-analisar');
    if (!botao) return;
    var alvos = (window._tenantConfig || {}).connectivityTargets || [];
    if (!alvos.length) { botao.disabled = true; botao.textContent = tr('connect.noTargets', 'Nenhum destino configurado'); return; }
    botao.addEventListener('click', function () {
      run({
        clienteId: 'tabela-cliente', servidorId: 'tabela-servidor',
        avisoId: 'aviso-servidor', notaId: 'nota-filtrado', idadeId: 'nota-idade',
        onStart:  function () { botao.disabled = true;  botao.textContent = tr('connect.running', 'Analisando…'); },
        onFinish: function () { botao.disabled = false; botao.textContent = tr('connect.again', 'Analisar novamente'); }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
