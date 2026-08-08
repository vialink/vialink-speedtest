// Qualidade da conexão — o que os Mbps não contam.
//
// Três medidas derivadas do próprio teste de velocidade, sem custo de tempo
// adicional para o usuário:
//
//   1. BUFFERBLOAT (latência sob carga). O ping do teste é medido com o link
//      ocioso — justamente a condição em que ninguém reclama. O que trava
//      videochamada e jogo é a latência DURANTE a saturação: um link de 500 Mbps
//      com fila mal dimensionada sai de 8 ms para 400 ms no upload. Medimos a
//      latência ociosa e a latência durante o download e o upload, e reportamos
//      o aumento.
//
//   2. BURST vs. SUSTENTADO. Muitos planos entregam um "turbo" nos primeiros
//      segundos. A média do teste inteiro mistura os dois e esconde a velocidade
//      que o cliente realmente tem num download longo. Comparamos os primeiros
//      segundos com o fim do teste.
//
//   3. ESTABILIDADE. Duas conexões com a mesma média podem ser muito diferentes:
//      uma entrega 300 Mbps o tempo todo, a outra oscila entre 500 e 100. A
//      segunda é a que faz o vídeo travar. Medimos a variação e as quedas.
//
// Nada aqui gera tráfego durante o teste além de sondas de latência minúsculas
// (um request por vez, resposta de poucos bytes) — o custo em banda é
// desprezível frente aos ~100 MB do teste em si.
//
// A sonda de latência sai por um HOSTNAME ALTERNATIVO da mesma instalação
// (os tenants têm vários domínios apontando para o mesmo servidor). Motivo: em
// HTTP/1.1 o navegador limita 6 conexões por origem, e o teste já usa as 6 —
// uma sonda na mesma origem ficaria na fila do navegador e mediria o tempo de
// espera do próprio browser, não a latência da rede. Origem diferente = pool de
// conexões próprio. Sem domínio alternativo, cai no mesmo host e a medida fica
// pessimista (marcada em `sameOrigin`).

(function () {
  'use strict';

  // --- estatística -----------------------------------------------------------

  function percentil(arr, p) {
    if (!arr || !arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = (a.length - 1) * p;
    var lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  function media(arr) {
    if (!arr || !arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function desvio(arr) {
    if (!arr || arr.length < 2) return null;
    var m = media(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / (arr.length - 1));
  }

  // --- notas -----------------------------------------------------------------

  // Escala de bufferbloat em ms de AUMENTO sobre a latência ociosa. Os cortes
  // seguem a régua usada pelo Waveform/DSLReports, que é a referência de fato
  // do assunto — mantê-los iguais permite ao usuário comparar com outros testes.
  var ESCALA_BLOAT = [
    { max: 5,   nota: 'A+' },
    { max: 30,  nota: 'A'  },
    { max: 60,  nota: 'B'  },
    { max: 200, nota: 'C'  },
    { max: 400, nota: 'D'  },
    { max: Infinity, nota: 'F' }
  ];

  function notaBloat(ms) {
    if (ms == null) return null;
    for (var i = 0; i < ESCALA_BLOAT.length; i++) {
      if (ms < ESCALA_BLOAT[i].max) return ESCALA_BLOAT[i].nota;
    }
    return 'F';
  }

  // Classe visual (bom/medio/ruim) — mesma convenção da análise de conectividade
  function classeBloat(ms) {
    return ms == null ? '' : ms < 30 ? 'bom' : ms < 200 ? 'medio' : 'ruim';
  }

  // Coeficiente de variação da velocidade, já descartada a rampa inicial.
  // Uma conexão doméstica saudável fica abaixo de ~10%; acima de 30% a oscilação
  // é perceptível (buffer de vídeo, chamada picotando).
  function classeEstab(cv) {
    return cv == null ? '' : cv < 0.10 ? 'bom' : cv < 0.30 ? 'medio' : 'ruim';
  }

  function chaveEstab(cv) {
    return cv == null ? null : cv < 0.05 ? 'excelente' : cv < 0.10 ? 'boa'
                             : cv < 0.30 ? 'variavel' : 'instavel';
  }

  // --- estado ----------------------------------------------------------------

  var SONDA_TIMEOUT = 3000;   // uma sonda que passa disso conta como perdida
  var SONDA_GAP = 80;         // respiro entre sondas (ms)
  var DESCARTA_INICIO = 2;    // amostras iniciais de cada fase (fila enchendo)
  var JANELA_MS = 500;        // agregação da série de throughput
  var SLOW_START_S = 2;       // trecho inicial ignorado na estabilidade
  var BURST_S = 3;            // trecho inicial que representa o "turbo"
  var FIM_S = 5;              // trecho final que representa o sustentado

  var st = null;

  function novoEstado() {
    return {
      idle: [],                       // latências com o link ocioso (ms)
      lat: { dl: [], ul: [] },        // latências sob carga (ms)
      perdas: { dl: 0, ul: 0 },       // sondas sem resposta / estouradas
      serie: { dl: [], ul: [] },      // {t, mbps} agregados por JANELA_MS
      bruto: { dl: null, ul: null },  // último {t, bytes} recebido
      acum: { dl: null, ul: null },   // acumulador da janela corrente
      mult: 1,
      probeUrl: null,
      sameOrigin: true,
      fase: null,
      rodando: false
    };
  }

  // --- sonda de latência -----------------------------------------------------

  // Cronometra uma requisição minúscula. Usa Image() porque o retorno é medido
  // tanto no onload quanto no onerror: não depende de CORS nem do tipo de
  // conteúdo (o alvo é o arquivo de ping do próprio speedtest, que não é uma
  // imagem — o onerror dispara na hora em que a resposta chega, e é isso que
  // queremos cronometrar). Mesma técnica já usada na análise de conectividade.
  function sonda(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var t0 = performance.now();
      var pronto = false;
      var timer = setTimeout(function () {
        if (pronto) return;
        pronto = true;
        img.src = '';
        resolve(null);
      }, SONDA_TIMEOUT);
      img.onload = img.onerror = function () {
        if (pronto) return;
        pronto = true;
        clearTimeout(timer);
        resolve(performance.now() - t0);
      };
      img.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'q=' + Math.random();
    });
  }

  // Dispara sondas em sequência (nunca em paralelo — sondas concorrentes
  // disputariam entre si e mediriam a própria fila) enquanto a fase durar.
  function laco(destino, perdaKey) {
    if (!st || !st.rodando || !st.probeUrl) return;
    var meu = st.fase;
    sonda(st.probeUrl).then(function (ms) {
      if (!st || st.fase !== meu || !st.rodando) return;
      if (ms == null) { if (perdaKey) st.perdas[perdaKey]++; }
      else destino.push(ms);
      setTimeout(function () { laco(destino, perdaKey); }, SONDA_GAP);
    });
  }

  // Deriva o host da sonda: outro domínio da MESMA instalação, se houver.
  //
  // Trocar de hostname só é legítimo quando sabemos que o host atual pertence à
  // lista do tenant — aí os outros nomes da lista são, por definição, o mesmo
  // servidor. Fora disso (acesso pelo IP, instalação de terceiros que caiu no
  // tenant padrão), a lista é de OUTRA gente: sondá-la mandaria requisições
  // para um servidor alheio e mediria a latência errada. Nesse caso ficamos na
  // mesma origem e assumimos a medida pessimista.
  function resolveProbeUrl(urlPing) {
    var res = { url: urlPing, sameOrigin: true };
    if (!urlPing) return res;
    try {
      var cfg = window._tenantConfig || {};
      var lista = cfg.latencyProbeHosts || cfg.domains || [];
      var atual = location.hostname;
      if (lista.indexOf(atual) < 0) return res;      // host atual não é da lista
      if (location.port) return res;                 // porta atípica: não presumir
      var alt = null;
      for (var i = 0; i < lista.length; i++) {
        if (lista[i] && lista[i] !== atual) { alt = lista[i]; break; }
      }
      if (!alt) return res;
      var u = new URL(urlPing, location.href);
      u.hostname = alt;
      res.url = u.toString();
      res.sameOrigin = false;
    } catch (e) {}
    return res;
  }

  // Aquecimento da conexão da sonda.
  //
  // A janela de link ocioso é curta (dura só a fase de ping do teste), e a
  // PRIMEIRA requisição a um host novo paga DNS + TCP + TLS. Sem aquecer, esse
  // handshake domina as poucas amostras e a latência ociosa sai inflada — o que
  // é pior do que não medir: uma base alta demais ESCONDE o bufferbloat (medido
  // em produção: base 65 ms contra 22 ms sob carga, aumento zerado, quando a
  // latência real é ~10 ms).
  //
  // Uma requisição descartada no carregamento da página resolve: quando o teste
  // começa, a conexão já está estabelecida e toda amostra mede rede, não
  // handshake. Só vale para o host alternativo — a origem do próprio site já
  // está quente por definição.
  function aquecer() {
    try {
      var r = resolveProbeUrl(location.origin + '/upload');
      if (r.sameOrigin) return;
      var img = new Image();
      img.src = r.url + (r.url.indexOf('?') >= 0 ? '&' : '?') + 'q=warm' + Math.random();
    } catch (e) {}
  }
  if (typeof document !== 'undefined') {   // guarda: os testes de cálculo rodam fora do navegador
    if (document.readyState === 'complete') setTimeout(aquecer, 200);
    else window.addEventListener('load', function () { setTimeout(aquecer, 200); });
  }

  // --- série de throughput ---------------------------------------------------

  // Recebe bytes acumulados e o tempo da fase; deriva a velocidade instantânea
  // e agrega em janelas de JANELA_MS. Trabalhamos com o acumulado bruto (e não
  // com a média que o velocímetro exibe) porque a média do motor tem resets
  // periódicos embutidos — ótimos para o ponteiro não tremer, péssimos para
  // enxergar oscilação real.
  function tick(fase, bytes, tSeg) {
    if (!st || !st.serie[fase]) return;
    var ant = st.bruto[fase];
    st.bruto[fase] = { t: tSeg, b: bytes };
    if (!ant) return;
    var dt = tSeg - ant.t, db = bytes - ant.b;
    if (!(dt > 0) || !(db >= 0)) return;

    var ac = st.acum[fase];
    if (!ac) { ac = st.acum[fase] = { t0: ant.t, dt: 0, db: 0 }; }
    ac.dt += dt;
    ac.db += db;
    if (ac.dt * 1000 < JANELA_MS) return;

    var mbps = (ac.db * 8) / ac.dt / 1e6 * st.mult;
    if (isFinite(mbps)) st.serie[fase].push({ t: ac.t0 + ac.dt, mbps: mbps });
    st.acum[fase] = null;
  }

  // --- resumo ----------------------------------------------------------------

  function resumoFase(serie) {
    if (!serie || serie.length < 4) return null;
    var fim = serie[serie.length - 1].t;
    var mbps = function (p) { return p.mbps; };

    var burst = serie.filter(function (p) { return p.t <= BURST_S; }).map(mbps);
    var sust  = serie.filter(function (p) { return p.t >= fim - FIM_S; }).map(mbps);

    // "Turbo" (speedboost) só quando o trecho inicial está INTEIRO acima do
    // sustentado. Sem essa exigência, uma conexão que oscila entre 150 e 50
    // Mbps seria reportada como turbo só porque calhou de começar alto — o
    // oposto do diagnóstico correto, que ali é instabilidade.
    var mBurst = percentil(burst, 0.5), minBurst = percentil(burst, 0);
    var mSust = percentil(sust, 0.5);
    var boost = null;
    if (mBurst && mSust && mSust > 0 && minBurst > mSust * 1.05 &&
        mBurst / mSust >= 1.15 && (mBurst - mSust) >= 5) {
      boost = mBurst / mSust;
    }

    // A estabilidade é medida no regime permanente. Além da rampa inicial do
    // TCP, descartamos o próprio turbo quando ele existe: cair de 300 para 100
    // porque o plano acabou o boost não é oscilação da rede, é o plano — e
    // contá-lo como tal marcaria "instável" toda conexão com speedboost.
    var iniEstavel = boost ? Math.max(SLOW_START_S, BURST_S + 0.5) : SLOW_START_S;
    var estavel = serie.filter(function (p) { return p.t >= iniEstavel; }).map(mbps);
    if (estavel.length < 3) estavel = serie.map(mbps);

    var med = media(estavel), sd = desvio(estavel);
    var cv = (med && med > 0 && sd != null) ? sd / med : null;
    var mediana = percentil(estavel, 0.5);

    // Quedas: janelas abaixo de metade da mediana, contadas em blocos contíguos
    // de pelo menos 1 s (uma janela isolada é ruído de medição; um segundo
    // inteiro de queda o usuário sente).
    var quedas = 0, corrida = 0;
    var minBlocos = Math.max(1, Math.round(1000 / JANELA_MS));
    for (var i = 0; i < serie.length; i++) {
      if (serie[i].t < iniEstavel) continue;
      if (mediana && serie[i].mbps < mediana * 0.5) {
        corrida++;
        if (corrida === minBlocos) quedas++;
      } else corrida = 0;
    }

    return {
      burst: mBurst,
      sustentado: mSust,
      boost: boost,
      mediana: mediana,
      minimo: percentil(estavel, 0),
      p10: percentil(estavel, 0.1),
      cv: cv,
      estabilidade: chaveEstab(cv),
      quedas: quedas,
      amostras: serie.length
    };
  }

  // Descarte inicial adaptativo: nas fases de carga cobre a fila da rede
  // enchendo; no baseline, qualquer resíduo de conexão fria que tenha escapado
  // do aquecimento. Quanto pior o bufferbloat, menos sondas cabem na fase — e é
  // justamente o caso grave que não pode ficar sem diagnóstico por falta de
  // amostra, daí o descarte ceder quando há poucas.
  function util(amostras) {
    var descarta = Math.min(DESCARTA_INICIO, Math.max(0, amostras.length - 3));
    return amostras.slice(descarta);
  }

  function summary() {
    if (!st) return null;
    var idle = percentil(util(st.idle), 0.5);
    if (idle == null) return null;

    function bloat(fase) {
      var amostras = util(st.lat[fase]);
      if (amostras.length < 2) return null;
      var p50 = percentil(amostras, 0.5);
      return {
        latencia: p50,
        p95: percentil(amostras, 0.95),
        aumento: Math.max(0, p50 - idle),
        perdas: st.perdas[fase],
        amostras: amostras.length
      };
    }

    var dl = bloat('dl'), ul = bloat('ul');
    var aumento = null;
    if (dl && ul) aumento = Math.max(dl.aumento, ul.aumento);
    else if (dl) aumento = dl.aumento;
    else if (ul) aumento = ul.aumento;

    var out = {
      idle: idle,
      dl: dl,
      ul: ul,
      aumento: aumento,
      nota: notaBloat(aumento),
      classe: classeBloat(aumento),
      // Round-trips por minuto sob carga: quantas idas e voltas cabem num
      // minuto quando o link está ocupado. É o mesmo espírito da métrica RPM
      // do RFC 9097 — um número em que "maior é melhor", mais intuitivo que
      // "milissegundos a mais".
      rpm: aumento != null ? Math.round(60000 / (idle + aumento)) : null,
      sameOrigin: st.sameOrigin,
      velocidade: { dl: resumoFase(st.serie.dl), ul: resumoFase(st.serie.ul) }
    };
    return out;
  }

  // --- apresentação ----------------------------------------------------------

  function tr(key, fallback, params) {
    if (window.vlkT) {
      var s = window.vlkT(key, params);
      if (s && s !== key) return s;
    }
    if (params) {
      fallback = fallback.replace(/\{(\w+)\}/g, function (_, k) {
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

  function ms(v) { return v == null ? '—' : Math.round(v) + ' ms'; }
  function mbps(v) { return v == null ? '—' : v.toFixed(1) + ' Mbps'; }
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(0) + '%'; }

  function linha(rotulo, valor, extra, classe) {
    return '<tr><th>' + esc(rotulo) + '</th><td class="' + (classe || '') + '">' +
      esc(valor) + (extra ? ' <span class="qos-extra">' + esc(extra) + '</span>' : '') +
      '</td></tr>';
  }

  function cardBloat(s) {
    var linhas = linha(tr('qos.idle', 'Link ocioso'), ms(s.idle));
    ['dl', 'ul'].forEach(function (f) {
      var d = s[f];
      if (!d) return;
      linhas += linha(
        tr(f === 'dl' ? 'qos.duringDl' : 'qos.duringUl',
           f === 'dl' ? 'Baixando' : 'Enviando'),
        ms(d.latencia),
        '+' + Math.round(d.aumento) + ' ms',
        classeBloat(d.aumento));
    });

    var chave = s.nota === 'A+' || s.nota === 'A' ? 'ok'
              : s.nota === 'B' || s.nota === 'C' ? 'medio' : 'ruim';
    var expl = {
      ok:    'A latência se mantém baixa mesmo com o link saturado: uma videochamada não sofre quando alguém está baixando arquivo em casa.',
      medio: 'A latência sobe de forma perceptível quando o link satura — chamadas e jogos podem engasgar enquanto há download ou upload pesado.',
      ruim:  'A latência dispara quando o link satura (bufferbloat). Na prática: a chamada trava e o jogo fica injogável enquanto alguém baixa ou envia arquivos, mesmo com a velocidade contratada inteira.'
    }[chave];

    return '<div class="qos-card">' +
      '<div class="qos-cab"><span class="qos-nota ' + s.classe + '">' + esc(s.nota) + '</span>' +
      '<h3>' + esc(tr('qos.bloatTitle', 'Latência sob carga')) + '</h3></div>' +
      '<table>' + linhas + '</table>' +
      (s.rpm ? '<p class="qos-rpm">' + esc(tr('qos.rpm', '{n} idas e voltas por minuto sob carga', { n: s.rpm })) + '</p>' : '') +
      '<p class="qos-expl">' + esc(tr('qos.bloatExpl.' + chave, expl)) + '</p>' +
      '</div>';
  }

  function cardEstabilidade(s) {
    var dl = s.velocidade.dl, ul = s.velocidade.ul;
    if (!dl && !ul) return '';
    // O selo mostra o PIOR dos dois sentidos, como o bufferbloat faz com o
    // aumento: anunciar "excelente" pelo download enquanto o upload oscila 20%
    // daria uma nota melhor que a realidade — e é no upload que a chamada de
    // vídeo do usuário vai engasgar.
    var ref = (dl && ul) ? ((dl.cv || 0) >= (ul.cv || 0) ? dl : ul) : (dl || ul);
    var rot = tr('qos.stab.' + ref.estabilidade, {
      excelente: 'Excelente', boa: 'Boa', variavel: 'Variável', instavel: 'Instável'
    }[ref.estabilidade] || '—');

    function col(r, rotulo) {
      if (!r) return '';
      return linha(rotulo, mbps(r.mediana),
        tr('qos.minLabel', 'mín {v}', { v: mbps(r.minimo) }), classeEstab(r.cv)) +
        linha(tr('qos.variation', 'Variação'), pct(r.cv), null, classeEstab(r.cv)) +
        (r.quedas ? linha(tr('qos.dips', 'Quedas'),
          tr('qos.dipsN', '{n} de mais de 1 s', { n: r.quedas }), null, 'ruim') : '');
    }

    var expl = {
      excelente: 'A velocidade se manteve praticamente constante durante todo o teste.',
      boa: 'A velocidade oscilou pouco — comportamento normal de uma conexão saudável.',
      variavel: 'A velocidade oscilou de forma perceptível. Em vídeo isso aparece como queda de resolução no meio da reprodução.',
      instavel: 'A velocidade variou muito durante o teste. Vale repetir com cabo, sem outros aparelhos usando a rede — se persistir, é caso de olhar o enlace.'
    }[ref.estabilidade];

    return '<div class="qos-card">' +
      '<div class="qos-cab"><span class="qos-nota ' + classeEstab(ref.cv) + '">' + esc(rot) + '</span>' +
      '<h3>' + esc(tr('qos.stabTitle', 'Estabilidade')) + '</h3></div>' +
      '<table>' +
        col(dl, tr('qos.download', 'Download')) +
        col(ul, tr('qos.upload', 'Upload')) +
      '</table>' +
      '<p class="qos-expl">' + esc(tr('qos.stabExpl.' + ref.estabilidade, expl)) + '</p>' +
      '</div>';
  }

  function cardTurbo(s) {
    var f = (s.velocidade.dl && s.velocidade.dl.boost) ? s.velocidade.dl
          : (s.velocidade.ul && s.velocidade.ul.boost) ? s.velocidade.ul : null;
    if (!f) return '';
    var qual = (s.velocidade.dl && s.velocidade.dl.boost)
      ? tr('qos.download', 'Download') : tr('qos.upload', 'Upload');
    return '<div class="qos-card">' +
      '<div class="qos-cab"><span class="qos-nota medio">' + esc(f.boost.toFixed(1)) + '×</span>' +
      '<h3>' + esc(tr('qos.turboTitle', 'Turbo inicial')) + '</h3></div>' +
      '<table>' +
        linha(tr('qos.turboStart', 'Primeiros segundos'), mbps(f.burst)) +
        linha(tr('qos.turboEnd', 'Velocidade sustentada'), mbps(f.sustentado)) +
      '</table>' +
      '<p class="qos-expl">' + esc(tr('qos.turboExpl',
        'O {qual} começou bem mais rápido do que terminou. É o comportamento de planos com turbo: downloads curtos aproveitam a velocidade alta, mas um arquivo grande ou um vídeo longo roda na velocidade sustentada.',
        { qual: qual.toLowerCase() })) + '</p>' +
      '</div>';
  }

  // Preenche e revela a seção de qualidade. Devolve true se havia o que mostrar.
  function render(s) {
    s = s || summary();
    var cont = document.getElementById('vlk-qos-cards');
    var sec = document.getElementById('vlk-qos');
    if (!cont || !sec || !s) return false;

    var html = cardBloat(s) + cardTurbo(s) + cardEstabilidade(s);
    if (!html) return false;
    cont.innerHTML = html;

    var nota = document.getElementById('vlk-qos-nota-origem');
    if (nota) nota.style.display = s.sameOrigin ? '' : 'none';

    sec.classList.add('aberto');
    sec.setAttribute('aria-hidden', 'false');
    document.body.classList.add('vlk-qos-open');
    return true;
  }

  // --- API -------------------------------------------------------------------

  window.VLK_QOS = {
    render: render,
    // Novo teste: zera tudo. `mult` são os mesmos ajustes que o motor aplica ao
    // valor exibido (compensação de overhead × fator de correção da instalação),
    // para que a série de throughput fale a mesma língua do velocímetro.
    reset: function (mult) {
      st = novoEstado();
      st.mult = (isFinite(mult) && mult > 0) ? mult : 1;
    },

    // Latência ociosa: roda durante a fase de ping do teste, quando o link
    // ainda não tem carga. Mesma sonda e mesmo destino usados sob carga — é a
    // comparação entre as duas que dá sentido ao número.
    baselineStart: function (urlPing) {
      if (!st) this.reset(1);
      var r = resolveProbeUrl(urlPing);
      st.probeUrl = r.url;
      st.sameOrigin = r.sameOrigin;
      st.fase = 'idle';
      st.rodando = true;
      laco(st.idle, null);

      // Rede de segurança: se o domínio alternativo não responder (DNS que só
      // existe internamente, nome fora do certificado, host desligado), a
      // medição inteira ficaria sem baseline e a seção simplesmente não
      // apareceria — falha silenciosa. Depois de um tempo sem nenhuma resposta,
      // voltamos para a origem do próprio teste, que sabidamente responde.
      if (!r.sameOrigin) {
        setTimeout(function () {
          if (!st || st.fase !== 'idle' || st.idle.length) return;
          st.probeUrl = urlPing;
          st.sameOrigin = true;
        }, 1500);
      }
    },

    // Início de uma fase de carga ('dl' ou 'ul')
    beginPhase: function (fase) {
      if (!st || !st.lat[fase]) return;
      st.fase = fase;
      st.rodando = true;
      laco(st.lat[fase], fase);
    },

    endPhase: function () {
      if (!st) return;
      st.fase = null;
      st.rodando = false;
    },

    tick: tick,

    summary: summary,

    // exposto para teste
    _test: {
      percentil: percentil, media: media, desvio: desvio,
      notaBloat: notaBloat, resumoFase: resumoFase,
      serie: function (fase) { return st && st.serie[fase]; }
    }
  };
})();
