// Conexão única × múltiplas conexões — a diferença que explica
// "o teste dá 300 Mbps mas o Steam baixa a 20".
//
// O teste de velocidade abre 6 conexões em paralelo (o limite que o navegador
// permite por origem em HTTP/1.1) e soma o que todas trazem. É a medida certa
// para "quanto cabe no link", e é assim que todo speed test funciona. Só que
// quase nada do que o usuário faz no dia a dia usa 6 conexões: baixar um
// arquivo, atualizar um jogo, subir um backup, restaurar um dump — tudo isso
// costuma ser UM fluxo TCP. Quando um fluxo sozinho entrega bem menos que os
// seis juntos, a experiência real fica abaixo do número anunciado, e o assinante
// tem razão ao reclamar mesmo com o teste "dando certo".
//
// As três causas típicas de um fluxo só não encher o link:
//
//   * POLICER POR FLUXO — limitador no caminho (borda, CPE, plano) que corta
//     cada conexão num teto. Seis conexões contornam; uma, não.
//   * JANELA TCP PEQUENA para a latência do enlace. A quantidade de dados em
//     voo é limitada pela janela; com RTT alto, uma janela modesta trava o
//     fluxo bem abaixo da banda disponível (o clássico "long fat network").
//     A janela efetiva estimada aqui — banda × RTT — mostra isso de frente:
//     ~64 KB denuncia window scaling desligado em algum ponto.
//   * NAT/CGNAT SOBRECARREGADO ou middlebox que trata mal um fluxo longo.
//
// A medição roda DEPOIS do teste de velocidade, na janela em que o link fica
// ocioso enquanto o usuário lê o resultado — mesma ideia do pré-aquecimento da
// análise de rede. Uma única requisição GET, alguns segundos, com teto de
// volume para não desperdiçar tráfego em links rápidos.

(function () {
  'use strict';

  var TARGET_S = 6;                        // duração alvo da medição
  // Piso de duração: 1,5 s de rampa do TCP + 1,5 s de regime, que em janelas de
  // 250 ms dão as ~6 amostras necessárias para uma mediana honesta. O teto de
  // volume só pode encerrar a medição depois disso.
  var MIN_S = 3;
  var MAX_BYTES = 150 * 1024 * 1024;       // teto de tráfego por medição
  // Janela menor que a do teste principal (500 ms): esta medição é curta, e
  // metade da janela dobra as amostras úteis sem perder estabilidade.
  var WINDOW_MS = 250;
  var SLOW_START_S = 1.5;                  // trecho inicial ignorado (rampa do TCP)
  var MIN_MULTI_MBPS = 1;                  // abaixo disso a comparação não diz nada

  // Faixas da razão fluxo único / teste completo. O corte de 0.85 reconhece que
  // um único fluxo dificilmente empata com seis (há overhead e concorrência de
  // CPU); abaixo de 0.55 a diferença já aparece no uso real, e abaixo de 0.25 o
  // que o cliente percebe é outro serviço, não o contratado.
  var GRADES = [
    { min: 0.85, grade: 'full',    cls: 'bom'   },
    { min: 0.55, grade: 'partial', cls: 'medio' },
    { min: 0.25, grade: 'limited', cls: 'ruim'  },
    { min: -1,   grade: 'severe',  cls: 'ruim'  }
  ];

  function gradeFor(ratio) {
    for (var i = 0; i < GRADES.length; i++) {
      if (ratio >= GRADES[i].min) return GRADES[i];
    }
    return GRADES[GRADES.length - 1];
  }

  var server = null;   // { url, mult } publicados pelo motor do teste
  var last = null;     // último resumo
  var running = null;  // Promise em curso

  // --- estatística (local, para o módulo ser autocontido) ---------------------

  function percentile(arr, p) {
    if (!arr || !arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = (a.length - 1) * p;
    var lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  // --- medição ---------------------------------------------------------------

  // Coletor de série: recebe (tempo em segundos, bytes acumulados) e agrega em
  // janelas de WINDOW_MS, como o módulo de qualidade faz com o teste principal —
  // a mesma linguagem, para que os dois números sejam comparáveis.
  function newSeries(mult) {
    var series = [], prev = null, acc = null;
    return {
      series: series,
      push: function (t, bytes) {
        var before = prev;
        prev = { t: t, b: bytes };
        if (!before) return;
        var dt = t - before.t, db = bytes - before.b;
        if (!(dt > 0) || !(db >= 0)) return;
        if (!acc) acc = { t0: before.t, dt: 0, db: 0 };
        acc.dt += dt;
        acc.db += db;
        if (acc.dt * 1000 < WINDOW_MS) return;
        var mbps = (acc.db * 8) / acc.dt / 1e6 * mult;
        if (isFinite(mbps)) series.push({ t: acc.t0 + acc.dt, mbps: mbps });
        acc = null;
      }
    };
  }

  // Lê o corpo em streaming e descarta cada pedaço. Com XHR seria preciso
  // acumular a resposta inteira na memória (centenas de MB num link rápido);
  // aqui só o contador cresce.
  function measureFetch(url, mult) {
    return new Promise(function (resolve, reject) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var t0 = performance.now();
      var bytes = 0, stopped = false;
      var col = newSeries(mult);
      var elapsed = function () { return (performance.now() - t0) / 1000; };

      function stop() {
        if (stopped) return;
        stopped = true;
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        resolve({ series: col.series, bytes: bytes, seconds: elapsed() });
      }

      function get() {
        if (stopped) return;
        fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'n=' + Math.random(),
              { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(function (resp) {
            if (!resp.ok || !resp.body || !resp.body.getReader) {
              throw new Error('sem streaming');
            }
            var reader = resp.body.getReader();
            function pump() {
              return reader.read().then(function (r) {
                if (stopped) return;
                if (r.done) { get(); return; }   // arquivo acabou: pede de novo, mesma conexão
                bytes += r.value.length;
                col.push(elapsed(), bytes);
                if (elapsed() >= TARGET_S || (bytes >= MAX_BYTES && elapsed() >= MIN_S)) {
                  stop();
                  return;
                }
                return pump();
              });
            }
            return pump();
          })
          .catch(function (err) {
            if (stopped) return;
            // Abortar ao terminar é o caminho normal, não erro.
            if (col.series.length) stop();
            else reject(err);
          });
      }
      get();
    });
  }

  // Fallback para navegador sem Streams: XHR com teto de volume mais apertado,
  // já que a resposta inteira fica na memória até o request ser reciclado.
  function measureXhr(url, mult) {
    return new Promise(function (resolve, reject) {
      var t0 = performance.now();
      var bytes = 0, stopped = false, req = null;
      var col = newSeries(mult);
      var elapsed = function () { return (performance.now() - t0) / 1000; };

      function stop() {
        if (stopped) return;
        stopped = true;
        if (req) { try { req.abort(); } catch (e) {} }
        resolve({ series: col.series, bytes: bytes, seconds: elapsed() });
      }

      function get() {
        if (stopped) return;
        var lastLoaded = 0;
        var r = new XMLHttpRequest();
        req = r;
        r.open('GET', url + (url.indexOf('?') >= 0 ? '&' : '?') + 'n=' + Math.random(), true);
        r.responseType = 'arraybuffer';
        r.onprogress = function (e) {
          var chunk = e.loaded - lastLoaded;
          lastLoaded = e.loaded;
          if (chunk > 0) bytes += chunk;
          col.push(elapsed(), bytes);
          if (elapsed() >= TARGET_S || (bytes >= MAX_BYTES && elapsed() >= MIN_S)) stop();
        };
        r.onload = function () { if (!stopped) get(); };
        r.onerror = function () {
          if (col.series.length) stop();
          else reject(new Error('falha na requisição'));
        };
        r.send();
      }
      get();
    });
  }

  // --- interpretação ---------------------------------------------------------

  // Velocidade sustentada do teste completo. Preferimos o sustentado que o
  // módulo de qualidade já calculou (mediana do fim do teste) em vez da média
  // exibida: comparar sustentado com sustentado evita creditar ao "fluxo único"
  // uma diferença que na verdade é o turbo inicial do plano.
  function multiReference() {
    var q = window.vlkQos;
    if (q && q.velocidade && q.velocidade.dl && q.velocidade.dl.sustentado > 0) {
      return { mbps: q.velocidade.dl.sustentado, from: 'sustained' };
    }
    var r = window.vlkResults;
    var d = r && parseFloat(r.d);
    if (isFinite(d) && d > 0) return { mbps: d, from: 'average' };
    return null;
  }

  function summarize(raw) {
    var multi = multiReference();
    if (!multi || multi.mbps < MIN_MULTI_MBPS) return null;

    var useful = raw.series.filter(function (p) { return p.t >= SLOW_START_S; });
    if (useful.length < 3) useful = raw.series;
    if (useful.length < 2) return null;

    var speeds = useful.map(function (p) { return p.mbps; });
    var single = percentile(speeds, 0.5);
    if (!(single > 0)) return null;

    var ratio = single / multi.mbps;
    var g = gradeFor(ratio);

    // Janela TCP efetiva = quantos bytes ficam em voo para sustentar essa
    // velocidade com o RTT medido. É a leitura direta de "por que o fluxo não
    // cresce": perto de 64 KB significa janela sem escala em algum ponto do
    // caminho, o que nenhuma banda contratada resolve.
    // Abaixo de 1 ms o RTT do teste não tem resolução para isso (rede local,
    // loopback): a conta daria "2 KB de janela" e induziria a conclusão errada.
    var rtt = window.vlkResults && parseFloat(window.vlkResults.p);
    var windowBytes = null;
    if (isFinite(rtt) && rtt >= 1) windowBytes = single * 1e6 / 8 * (rtt / 1000);

    last = {
      single: single,
      multi: multi.mbps,
      multiFrom: multi.from,
      ratio: ratio,
      grade: g.grade,
      cls: g.cls,
      peak: percentile(speeds, 1),
      rtt: isFinite(rtt) ? rtt : null,
      windowBytes: windowBytes,
      // Janela sem window scaling: a assinatura é a janela ficar ENCOSTADA no
      // teto de 64 KB, não apenas pequena. Uma janela bem abaixo disso é o
      // resultado normal de pouca banda com latência baixa (um policer de 50
      // Mbps a 8 ms de RTT dá 49 KB sem que nada limite a janela) — acusar ali
      // seria apontar a causa errada. Faixa estreita em torno de 65.535 bytes,
      // com folga para o ruído da medição, e só quando há banda sobrando.
      smallWindow: windowBytes != null && ratio < 0.85 &&
                   windowBytes >= 55 * 1024 && windowBytes <= 75 * 1024,
      // A janela só é exibida quando há o que explicar: com o fluxo único
      // entregando o link inteiro, ela é curiosidade e só polui o card.
      showWindow: windowBytes != null && ratio < 0.85,
      samples: useful.length,
      seconds: raw.seconds,
      bytes: raw.bytes
    };
    return last;
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

  function mbpsTxt(v) { return v == null ? '—' : v.toFixed(1) + ' Mbps'; }

  // Um fluxo sozinho não entrega mais do que seis juntos: quando a conta passa
  // de 100% é ruído (as duas medições são de momentos diferentes), e exibir
  // "112%" só confunde. O valor real fica no objeto, para o banco.
  function pctRatio(r) { return Math.round(Math.min(1, r) * 100) + '%'; }

  function sizeTxt(bytes) {
    if (bytes == null) return '—';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB'
                            : Math.round(bytes / 1024) + ' KB';
  }

  function row(label, value, extra, cls) {
    return '<tr><th>' + esc(label) + '</th><td class="' + (cls || '') + '">' +
      esc(value) + (extra ? ' <span class="qos-extra">' + esc(extra) + '</span>' : '') +
      '</td></tr>';
  }

  var EXPL = {
    full: 'Uma conexão sozinha entrega praticamente toda a banda do link. Baixar um arquivo, atualizar um jogo ou subir um backup aproveita o plano inteiro.',
    partial: 'Uma conexão sozinha entrega boa parte da banda, mas não toda. Downloads de arquivo único costumam ficar um pouco abaixo do número do teste — o resto só aparece com vários downloads ao mesmo tempo.',
    limited: 'Uma conexão sozinha fica bem abaixo do total. É isto que explica "o teste dá muito, mas o download real dá pouco": o número cheio só aparece somando vários fluxos. Causas típicas: limitador por fluxo no caminho, janela TCP pequena para a latência do enlace, ou NAT/CGNAT sobrecarregado.',
    severe: 'Uma conexão sozinha entrega uma fração do total. Na prática o cliente só alcança a velocidade contratada com muitos downloads simultâneos — um arquivo único fica preso bem abaixo. Vale investigar limitador por fluxo (policer), janela TCP e o caminho de NAT/CGNAT.'
  };

  function card(s) {
    var rows =
      row(tr('single.oneLabel', 'Com 1 conexão'), mbpsTxt(s.single), null, s.cls) +
      row(tr('single.sixLabel', 'Com 6 conexões (teste)'), mbpsTxt(s.multi));

    if (s.showWindow) {
      rows += row(tr('single.window', 'Janela TCP efetiva'), sizeTxt(s.windowBytes),
        s.rtt != null ? tr('single.atRtt', 'com {v} ms de latência', { v: Math.round(s.rtt) }) : null,
        s.smallWindow ? 'ruim' : '');
    }

    var expl = tr('single.expl.' + s.grade, EXPL[s.grade]);
    if (s.smallWindow) {
      expl += ' ' + tr('single.smallWindow',
        'A janela efetiva está próxima de 64 KB, o limite do TCP sem a opção de escala — sinal de que algum equipamento no caminho está cortando a janela.');
    }

    return '<div class="qos-cab"><span class="qos-nota ' + s.cls + '">' +
        esc(pctRatio(s.ratio)) + '</span>' +
      '<h3>' + esc(tr('single.title', 'Conexão única')) + '</h3></div>' +
      '<table>' + rows + '</table>' +
      '<p class="qos-expl">' + esc(expl) + '</p>';
  }

  // O card entra na mesma seção de qualidade, ao lado dos outros — mas chega
  // alguns segundos depois deles (a medição só pode começar quando o link fica
  // livre). Para o layout não saltar sob o usuário, reservamos o lugar com um
  // cartão "medindo…" e depois o substituímos. O elemento é o próprio
  // `.qos-card`, não um invólucro: os cards são itens diretos do grid.
  function slot() {
    var box = document.getElementById('vlk-qos-cards');
    if (!box) return null;
    var el = document.getElementById('vlk-single-card');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vlk-single-card';
      el.className = 'qos-card';
      box.appendChild(el);
    }
    return el;
  }

  function placeholder() {
    var el = slot();
    if (!el) return;
    el.className = 'qos-card qos-aguardando';
    el.innerHTML =
      '<div class="qos-cab"><h3>' + esc(tr('single.title', 'Conexão única')) + '</h3></div>' +
      '<p class="qos-expl">' + esc(tr('single.measuring', 'Medindo o que uma única conexão entrega…')) + '</p>';
  }

  function render(s) {
    s = s || last;
    var el = slot();
    if (!el || !s) return false;
    el.className = 'qos-card';
    el.innerHTML = card(s);
    var sec = document.getElementById('vlk-qos');
    if (sec && !sec.classList.contains('aberto')) {
      sec.classList.add('aberto');
      sec.setAttribute('aria-hidden', 'false');
      document.body.classList.add('vlk-qos-open');
    }
    return true;
  }

  function clear() {
    var el = document.getElementById('vlk-single-card');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // --- API -------------------------------------------------------------------

  window.VLK_SINGLE = {
    // O motor do teste publica aqui o servidor escolhido (o mesmo do download)
    // e o multiplicador que ele aplica ao valor exibido — sem o multiplicador,
    // a comparação sairia enviesada contra a conexão única.
    setServer: function (url, mult) {
      if (!url) return;
      server = { url: url, mult: (isFinite(mult) && mult > 0) ? mult : 1 };
    },

    // Mede e desenha. Devolve uma Promise que resolve com o resumo (ou null) e
    // NUNCA rejeita: é conteúdo adicional, não pode derrubar o fluxo do teste
    // nem travar quem encadear a análise de rede depois dela.
    run: function (opts) {
      if (running) return running;
      opts = opts || {};
      var quiet = !!opts.silent;

      var con = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!server || (con && con.saveData)) return Promise.resolve(null);
      if (!multiReference()) return Promise.resolve(null);

      if (!quiet) placeholder();
      var measure = (typeof fetch === 'function' && typeof ReadableStream !== 'undefined')
        ? measureFetch : measureXhr;

      running = measure(server.url, server.mult)
        .then(function (raw) {
          var s = summarize(raw);
          if (!s) { clear(); return null; }
          window.vlkSingle = s;
          try { localStorage.setItem('vlkSingle', JSON.stringify(s)); } catch (e) {}
          if (!quiet) render(s);
          try { window.dispatchEvent(new CustomEvent('vlk:single')); } catch (e) {}
          return s;
        })
        .catch(function () { clear(); return null; });
      return running;
    },

    reset: function () {
      running = null;
      last = null;
      window.vlkSingle = null;
      try { localStorage.removeItem('vlkSingle'); } catch (e) {}
      clear();
    },
    summary: function () { return last; },
    render: render,

    // exposto para teste
    _test: {
      percentile: percentile,
      gradeFor: gradeFor,
      summarize: summarize,
      newSeries: newSeries
    }
  };
})();
