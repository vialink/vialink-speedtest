// Perfis de uso — o que dá para fazer com esta conexão.
//
// O teste entrega números (Mbps, ms, %) que só significam alguma coisa para
// quem já sabe o que significam. Quem liga para o suporte não pergunta "meu
// jitter está alto?"; pergunta se dá para trabalhar de casa, se a chamada da
// escola vai travar, por que o jogo do filho engasga. Este módulo traduz as
// medições que já foram feitas — velocidade, latência ociosa, jitter, latência
// SOB CARGA (bufferbloat), estabilidade e o que um único fluxo TCP entrega —
// em uma nota por tipo de uso.
//
// Duas regras dão honestidade ao resultado:
//
//   1. A NOTA DE CADA PERFIL É O PIOR CRITÉRIO, não a média deles. Uma conexão
//      de 500 Mbps com 300 ms de latência sob carga é péssima para videochamada,
//      e uma média entre "banda ótima" e "latência ruim" devolveria "bom" — a
//      nota erraria justamente no caso em que a pessoa reclama. O critério que
//      puxou a nota para baixo é exibido como fator limitante: é nele que se
//      mexe para melhorar.
//
//   2. NADA É INVENTADO. Cada critério vem de uma medição real deste teste; o
//      que não foi medido simplesmente não entra na conta (e o perfil sai
//      marcado como parcial). A única estimativa declarada é o MOS da voz, que
//      é um modelo padronizado (E-model, ITU-T G.107) aplicado sobre latência,
//      jitter e perda medidos aqui.
//
// Nada disso custa tempo ao usuário: não há medição nova. É releitura do que as
// frentes anteriores já produziram.

(function () {
  'use strict';

  // --- escala ---------------------------------------------------------------

  // 3 = ótimo, 2 = bom, 1 = limitado, 0 = ruim. A ordem importa: o mínimo entre
  // os critérios é a nota do perfil.
  var NOTAS = ['ruim', 'limitado', 'bom', 'otimo'];

  function classeNivel(n) { return n >= 2 ? 'bom' : n === 1 ? 'medio' : 'ruim'; }

  // Classifica um valor em 4 níveis. `cortes` são os limiares do melhor para o
  // pior; `maiorMelhor` inverte o sentido (banda: mais é melhor; latência:
  // menos é melhor).
  function faixa(v, cortes, maiorMelhor) {
    if (v == null || !isFinite(v)) return null;
    if (maiorMelhor) {
      if (v >= cortes[0]) return 3;
      if (v >= cortes[1]) return 2;
      if (v >= cortes[2]) return 1;
      return 0;
    }
    if (v < cortes[0]) return 3;
    if (v < cortes[1]) return 2;
    if (v < cortes[2]) return 1;
    return 0;
  }

  // --- MOS (E-model simplificado, ITU-T G.107) -------------------------------
  //
  // O E-model calcula um "R-factor" descontando de uma nota máxima os prejuízos
  // de atraso e de perda, e converte esse R em MOS (1 a 5). É o modelo que a
  // indústria de telefonia usa para prever a qualidade percebida sem precisar
  // de gente ouvindo ligação.
  //
  // Premissas declaradas (e por quê):
  //   * codec G.711 com PLC (Ie = 0, Bpl = 25.1) — é o codec de referência do
  //     modelo e o mais comum em telefonia IP corporativa;
  //   * atraso em um sentido ≈ RTT/2 — o teste mede ida e volta;
  //   * jitter buffer ≈ 2× jitter + 20 ms — regra prática de dimensionamento
  //     (o buffer precisa cobrir a variação, e cada ms de buffer é atraso);
  //   * 20 ms de pacotização do codec.
  //
  // O resultado é uma ESTIMATIVA — o que o modelo faz bem é ordenar cenários
  // (esta conexão é melhor ou pior que aquela para voz), não cravar a nota que
  // um ouvinte daria.
  function mos(rttMs, jitterMs, perdaPct) {
    if (rttMs == null || !isFinite(rttMs)) return null;
    var jit = (jitterMs != null && isFinite(jitterMs)) ? jitterMs : 0;
    var ppl = (perdaPct != null && isFinite(perdaPct)) ? Math.max(0, perdaPct) : 0;

    var ta = rttMs / 2 + (2 * jit + 20) + 20;          // atraso boca a ouvido (ms)
    var id = ta <= 177.3 ? 0.024 * ta
                         : 0.024 * ta + 0.11 * (ta - 177.3);
    var ieEff = 95 * ppl / (ppl + 25.1);               // G.711 + PLC: Ie = 0, Bpl = 25.1
    var r = 93.2 - id - ieEff;

    if (r <= 0) return 1;
    if (r >= 100) return 4.5;
    var m = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6;
    return Math.max(1, Math.min(4.5, m));
  }

  // --- coleta ---------------------------------------------------------------

  // Reúne, num único objeto, o que as medições anteriores produziram. Preferimos
  // sempre o valor SUSTENTADO ao exibido: o velocímetro mostra a média do teste
  // inteiro, que inclui o turbo inicial do plano — e ninguém assiste a um filme
  // nos três primeiros segundos da conexão.
  function coleta() {
    var r = window.vlkResults || null;
    var q = window.vlkQos || null;
    var s = window.vlkSingle || null;
    if (!r && !q) return null;

    var qv = (q && q.velocidade) || {};
    var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null; };

    var dl = (qv.dl && qv.dl.sustentado) || num(r && r.d);
    var ul = (qv.ul && qv.ul.sustentado) || num(r && r.u);
    var ping = (q && q.idle != null) ? q.idle : num(r && r.p);
    var jitter = num(r && r.j);

    // Perda estimada: fração das sondas de latência que não voltaram dentro do
    // tempo limite enquanto o link estava saturado. Não é a perda de pacotes de
    // um fluxo UDP (isso é a frente seguinte do roteiro), mas é a única perda
    // que este teste mede de fato — e sondas que somem sob carga são exatamente
    // o que corta o áudio de uma chamada.
    var perda = null;
    if (q && (q.dl || q.ul)) {
      var perdidas = 0, total = 0;
      ['dl', 'ul'].forEach(function (f) {
        if (!q[f]) return;
        perdidas += q[f].perdas || 0;
        total += (q[f].perdas || 0) + (q[f].amostras || 0);
      });
      if (total >= 5) perda = perdidas / total * 100;
    }

    // Variação sob carga: aproximação de jitter para o cenário "link ocupado".
    // O jitter do teste é medido com o link ocioso; sob carga a fila cresce e a
    // dispersão junto. Metade da distância entre a mediana e o p95 é uma medida
    // conservadora dessa dispersão (não é desvio padrão, e não se pretende
    // equivalente — serve para não usar o jitter ocioso num cenário que não é
    // ocioso).
    var jitterCarga = jitter;
    ['dl', 'ul'].forEach(function (f) {
      var d = q && q[f];
      if (!d || d.p95 == null || d.latencia == null) return;
      var est = Math.max(0, (d.p95 - d.latencia) / 2);
      if (jitterCarga == null || est > jitterCarga) jitterCarga = est;
    });

    return {
      dl: dl,
      ul: ul,
      ping: ping,
      jitter: jitter,
      jitterCarga: jitterCarga,
      // Aumento de latência sob carga, pior sentido (é o pior que a pessoa sente)
      bloat: q && q.aumento != null ? q.aumento : null,
      perda: perda,
      // Estabilidade por sentido, e não só o pior dos dois: assistir a um filme
      // não sofre com o upload oscilando, e subir um backup não sofre com o
      // download. Usar o pior sempre marcaria o perfil errado (visto na
      // validação: streaming caindo de nota por causa do upload).
      cvDl: (qv.dl && qv.dl.cv != null) ? qv.dl.cv : null,
      cvUl: (qv.ul && qv.ul.cv != null) ? qv.ul.cv : null,
      cv: (function () {
        var a = qv.dl && qv.dl.cv, b = qv.ul && qv.ul.cv;
        if (a == null) return b == null ? null : b;
        if (b == null) return a;
        return Math.max(a, b);
      })(),
      quedasDl: qv.dl ? qv.dl.quedas || 0 : 0,
      quedas: (qv.dl ? qv.dl.quedas || 0 : 0) + (qv.ul ? qv.ul.quedas || 0 : 0),
      singleMbps: s ? s.single : null,
      singleRatio: s ? s.ratio : null
    };
  }

  // --- critérios por perfil --------------------------------------------------
  //
  // Cada entrada é { fator, nivel } — o fator é o nome exibido quando ele for o
  // limitante. Critério sem dado devolve null e é descartado.
  //
  // Os limiares vieram das recomendações públicas dos próprios serviços (Zoom,
  // Meet, Netflix) e das réguas já usadas neste projeto para bufferbloat e
  // estabilidade; onde as fontes divergem, ficamos com o valor mais exigente —
  // errar para o lado pessimista é preferível a prometer uma experiência que a
  // conexão não entrega.

  function crit(fator, nivel) {
    return nivel == null ? null : { fator: fator, nivel: nivel };
  }

  var PERFIS = [
    {
      key: 'call',     // videochamada (Zoom, Meet, Teams)
      criterios: function (d) {
        return [
          // Upload é o gargalo típico: é a sua imagem subindo. 3,8 Mbps é o que
          // o Zoom pede para 1080p; abaixo de ~1,2 nem SD estável se sustenta.
          crit('ul', faixa(d.ul, [6, 3, 1.2], true)),
          crit('dl', faixa(d.dl, [10, 4, 1.5], true)),
          // Bufferbloat: a chamada engasga quando alguém em casa baixa algo.
          crit('bloat', faixa(d.bloat, [30, 100, 250], false)),
          crit('jitter', faixa(d.jitter, [10, 30, 50], false)),
          crit('perda', faixa(d.perda, [0.5, 1.5, 4], false))
        ];
      },
      detalhe: function (d, t) {
        return [
          [t('prof.d.upload'), fmtMbps(d.ul)],
          [t('prof.d.underLoad'), d.bloat != null ? '+' + Math.round(d.bloat) + ' ms' : '—']
        ];
      }
    },
    {
      key: 'streaming',   // vídeo 4K
      criterios: function (d) {
        return [
          // Régua da própria Netflix: 15 Mbps para 4K, 5 para 1080p, 3 para
          // 720p. Daí os cortes: 25 é 4K com folga para outro aparelho, 15 é 4K
          // no limite, 6 entrega Full HD mas não 4K, abaixo disso nem isso.
          crit('dl', faixa(d.dl, [25, 15, 6], true)),
          // Streaming baixa segmento por segmento, normalmente um fluxo por vez:
          // o que importa não é a soma das 6 conexões, é o que UMA entrega.
          crit('single', faixa(d.singleMbps, [25, 15, 6], true)),
          // Só a estabilidade do DOWNLOAD: é ela que faz o vídeo parar para
          // carregar. O upload oscilando não atrapalha quem está assistindo.
          crit('cv', faixa(d.cvDl != null ? d.cvDl : d.cv, [0.10, 0.20, 0.35], false)),
          crit('quedas', d.cvDl == null && d.cv == null ? null
                       : faixa(d.quedasDl != null ? d.quedasDl : d.quedas, [1, 2, 3], false))
        ];
      },
      detalhe: function (d, t) {
        var cv = d.cvDl != null ? d.cvDl : d.cv;
        return [
          [t('prof.d.download'), fmtMbps(d.dl)],
          [d.singleMbps != null ? t('prof.d.oneFlow') : t('prof.d.variation'),
           d.singleMbps != null ? fmtMbps(d.singleMbps) : fmtPct(cv)]
        ];
      }
    },
    {
      key: 'gaming',   // jogos online
      criterios: function (d) {
        return [
          crit('ping', faixa(d.ping, [30, 60, 100], false)),
          crit('jitter', faixa(d.jitter, [5, 15, 30], false)),
          // Jogar enquanto alguém baixa é o caso real que faz o cliente ligar.
          crit('bloat', faixa(d.bloat, [30, 80, 200], false)),
          crit('perda', faixa(d.perda, [0.3, 1, 2.5], false)),
          // Banda importa pouco para jogar e muito para atualizar o jogo.
          crit('dl', faixa(d.dl, [15, 5, 3], true))
        ];
      },
      detalhe: function (d, t) {
        return [
          [t('prof.d.latency'), fmtMs(d.ping)],
          [t('prof.d.underLoad'), d.bloat != null ? '+' + Math.round(d.bloat) + ' ms' : '—']
        ];
      }
    },
    {
      key: 'work',   // home office: VPN, nuvem, arquivos grandes
      criterios: function (d) {
        return [
          crit('ul', faixa(d.ul, [20, 10, 3], true)),
          // Subir backup, sincronizar nuvem e restaurar dump são um fluxo só —
          // é aqui que a diferença entre 1 e 6 conexões vira tempo de espera.
          crit('single', faixa(d.singleRatio, [0.85, 0.55, 0.25], true)),
          // VPN sofre com fila: o túnel serializa e o atraso aparece em tudo.
          crit('bloat', faixa(d.bloat, [60, 150, 300], false)),
          crit('cv', faixa(d.cv, [0.15, 0.30, 0.45], false))
        ];
      },
      detalhe: function (d, t) {
        return [
          [t('prof.d.upload'), fmtMbps(d.ul)],
          [t('prof.d.oneFlowShare'), fmtPct(d.singleRatio != null ? Math.min(1, d.singleRatio) : null)]
        ];
      }
    },
    {
      key: 'voip',   // telefonia IP
      criterios: function (d, extra) {
        // Atraso em um sentido, que é a grandeza da recomendação G.114 (até
        // 150 ms a conversa é transparente; até 400 ms ainda é aceitável em
        // certos cenários; acima disso, não). Sob carga é o número que vale —
        // é quando o telefone toca no meio de um download.
        var oneWay = (d.ping != null)
          ? (d.ping + (d.bloat || 0)) / 2 : null;
        return [
          // A nota segue o MOS COM O LINK OCUPADO, não o ocioso: telefone em
          // empresa toca enquanto alguém está baixando, e é aí que a ligação
          // pica. O MOS ocioso aparece ao lado, para mostrar o quanto se perde.
          crit('mos', faixa(extra.mosCarga != null ? extra.mosCarga : extra.mosIdle,
                            [4.0, 3.6, 3.1], true)),
          crit('ping', faixa(oneWay, [150, 300, 400], false)),
          // Jitter sob carga contra o jitter buffer: um buffer típico cobre uns
          // 30–50 ms; o que chega fora dele é descartado e vira áudio picotado.
          // O E-model sozinho é tolerante demais com esse caso — por isso o
          // jitter entra também como critério próprio.
          crit('jitter', faixa(d.jitterCarga, [10, 30, 60], false)),
          // Uma chamada G.711 usa ~90 kbps em cada sentido; abaixo de 0,5 Mbps
          // de upload nem isso se sustenta com folga.
          crit('ul', faixa(d.ul, [2, 1, 0.5], true)),
          crit('perda', faixa(d.perda, [0.5, 1.5, 3], false))
        ];
      },
      detalhe: function (d, t, extra) {
        var l = [
          [t('prof.d.mosIdle'), fmtMos(extra.mosIdle)],
          [t('prof.d.mosLoad'), fmtMos(extra.mosCarga)]
        ];
        // Sem esta linha o card fica contraditório quando o jitter é o
        // limitante: dois MOS altos e a nota "Limitado", sem nada à vista que
        // explique por quê (visto na validação).
        if (d.jitterCarga != null && isFinite(d.jitterCarga)) {
          l.push([t('prof.d.jitterLoad'), fmtMs(d.jitterCarga)]);
        }
        return l;
      }
    }
  ];

  // --- cálculo ---------------------------------------------------------------

  function compute(dados) {
    var d = dados || coleta();
    if (!d) return null;
    // Sem velocidade e sem latência não há o que traduzir.
    if (d.dl == null && d.ul == null && d.ping == null) return null;

    var extra = {
      mosIdle: mos(d.ping, d.jitter, d.perda),
      mosCarga: d.bloat != null && d.ping != null
        ? mos(d.ping + d.bloat, d.jitterCarga, d.perda) : null
    };

    var out = [];
    PERFIS.forEach(function (p) {
      var cs = p.criterios(d, extra).filter(Boolean);
      if (!cs.length) return;

      var nivel = 3, limitante = null;
      cs.forEach(function (c) {
        if (c.nivel < nivel) { nivel = c.nivel; limitante = c.fator; }
      });
      // Nota máxima não tem "fator limitante" — não há o que consertar.
      if (nivel >= 3) limitante = null;

      out.push({
        key: p.key,
        nivel: nivel,
        nota: NOTAS[nivel],
        cls: classeNivel(nivel),
        limitante: limitante,
        criterios: cs,
        _perfil: p
      });
    });

    if (!out.length) return null;
    return {
      perfis: out,
      dados: d,
      mosIdle: extra.mosIdle,
      mosCarga: extra.mosCarga,
      extra: extra,
      // Parcial quando faltou a medição de qualidade (bufferbloat/estabilidade):
      // as notas continuam válidas para o que foi medido, mas o cenário "com o
      // link ocupado" fica de fora — e é ele que separa uma conexão boa de uma
      // que só parece boa.
      parcial: d.bloat == null
    };
  }

  // --- formatação ------------------------------------------------------------

  function fmtMbps(v) { return v == null || !isFinite(v) ? '—' : v.toFixed(1) + ' Mbps'; }
  function fmtMs(v) { return v == null || !isFinite(v) ? '—' : Math.round(v) + ' ms'; }
  function fmtPct(v) { return v == null || !isFinite(v) ? '—' : Math.round(v * 100) + '%'; }
  function fmtMos(v) { return v == null || !isFinite(v) ? '—' : v.toFixed(1); }

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

  // Fallbacks em português — o dicionário do idioma corrente sobrepõe; se um
  // idioma ainda não traduziu as chaves, o i18n cai no inglês (mesma regra dos
  // outros módulos).
  var FB = {
    'prof.name.call': 'Videochamada',
    'prof.name.streaming': 'Streaming 4K',
    'prof.name.gaming': 'Jogos online',
    'prof.name.work': 'Home office',
    'prof.name.voip': 'Telefonia VoIP',

    'prof.grade.otimo': 'Ótimo',
    'prof.grade.bom': 'Bom',
    'prof.grade.limitado': 'Limitado',
    'prof.grade.ruim': 'Ruim',

    'prof.factor.dl': 'banda de download',
    'prof.factor.ul': 'banda de upload',
    'prof.factor.ping': 'latência',
    'prof.factor.jitter': 'jitter',
    'prof.factor.bloat': 'latência sob carga',
    'prof.factor.cv': 'estabilidade',
    'prof.factor.quedas': 'quedas de velocidade',
    'prof.factor.perda': 'perda de pacotes',
    'prof.factor.single': 'velocidade de um fluxo só',
    'prof.factor.mos': 'qualidade de voz estimada',

    'prof.d.download': 'Download',
    'prof.d.upload': 'Upload',
    'prof.d.latency': 'Latência',
    'prof.d.underLoad': 'Com o link ocupado',
    'prof.d.oneFlow': 'Com 1 conexão',
    'prof.d.oneFlowShare': 'Um fluxo entrega',
    'prof.d.variation': 'Variação',
    'prof.d.mosIdle': 'MOS (link livre)',
    'prof.d.mosLoad': 'MOS (link ocupado)',
    'prof.d.jitterLoad': 'Variação sob carga',

    'prof.limitedBy': 'O que pesou: {fator}.',
    'prof.noLimit': 'tudo dentro do necessário',

    'prof.expl.call.otimo': 'Chamadas em HD com folga, inclusive com outras pessoas usando a rede ao mesmo tempo.',
    'prof.expl.call.bom': 'Dá para fazer chamadas em HD. Sob uso pesado da rede pode haver algum engasgo.',
    'prof.expl.call.limitado': 'A chamada funciona, mas com risco de travar ou perder qualidade — principalmente enquanto alguém baixa ou envia arquivos.',
    'prof.expl.call.ruim': 'Videochamada tende a congelar a imagem ou cair. Nesta conexão, reunião por vídeo não é confiável.',

    'prof.expl.streaming.otimo': 'Vídeo em 4K roda sem travar, e ainda sobra banda para outros aparelhos.',
    'prof.expl.streaming.bom': 'Dá para assistir em 4K. Com vários aparelhos ao mesmo tempo pode cair de resolução.',
    'prof.expl.streaming.limitado': 'Full HD roda bem; 4K deve travar para carregar ou reduzir a resolução no meio do filme.',
    'prof.expl.streaming.ruim': 'Nem Full HD é confortável: o vídeo para para carregar ou cai de resolução sozinho. 4K está fora de alcance.',

    'prof.expl.gaming.otimo': 'Latência e estabilidade adequadas até para jogo competitivo.',
    'prof.expl.gaming.bom': 'Boa para a maioria dos jogos online. Em jogos de reflexo pode haver alguma desvantagem.',
    'prof.expl.gaming.limitado': 'Dá para jogar, mas com atraso perceptível — pior ainda se alguém baixar algo enquanto você joga.',
    'prof.expl.gaming.ruim': 'Atraso alto: personagem teleportando, comando que não registra. Não é conexão para jogar online.',

    'prof.expl.work.otimo': 'VPN, videoconferência e transferência de arquivos grandes rodam sem gargalo.',
    'prof.expl.work.bom': 'Serve bem para trabalho remoto. Arquivo grande leva um tempo para subir, mas o dia a dia flui.',
    'prof.expl.work.limitado': 'O dia a dia funciona, mas enviar arquivo grande, subir backup ou usar VPN pesada vai incomodar.',
    'prof.expl.work.ruim': 'Enviar arquivo grande, backup ou VPN pesada trava o resto da conexão. Não é conexão de trabalho remoto.',

    'prof.expl.voip.otimo': 'Voz nítida e sem cortes, inclusive com o link ocupado.',
    'prof.expl.voip.bom': 'Qualidade de voz boa. Se o link saturar, pode haver leve degradação.',
    'prof.expl.voip.limitado': 'A voz sai compreensível, mas com cortes e atraso quando a rede é usada ao mesmo tempo.',
    'prof.expl.voip.ruim': 'Voz picotada e atraso alto — os dois lados se atropelam. Não é conexão para telefonia.',

    'prof.title': 'O que dá para fazer com esta conexão',
    'prof.intro': 'As mesmas medições deste teste, traduzidas para o uso do dia a dia. A nota de cada perfil segue o pior fator — é ele que a pessoa sente.',
    'prof.partial': 'A latência sob carga não foi medida neste teste: as notas consideram apenas o cenário com a rede livre.',
    'prof.mosNote': 'MOS: qualidade de voz estimada pelo modelo E-model (ITU-T G.107) a partir da latência, do jitter e da perda medidos aqui. Vai de 1 (inaudível) a 4,4 (telefonia fixa).',
    'prof.reportTitle': 'Perfis de uso',
    'prof.thProfile': 'Uso',
    'prof.thGrade': 'Nota',
    'prof.thWhy': 'O que determinou'
  };

  function t(key, params) { return tr(key, FB[key] != null ? FB[key] : key, params); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function card(p, res) {
    var linhas = '';
    (p._perfil.detalhe(res.dados, t, res.extra) || []).forEach(function (par) {
      linhas += '<tr><th>' + esc(par[0]) + '</th><td>' + esc(par[1]) + '</td></tr>';
    });

    var expl = t('prof.expl.' + p.key + '.' + p.nota);
    if (p.limitante) {
      expl += ' ' + t('prof.limitedBy', { fator: t('prof.factor.' + p.limitante) });
    }

    return '<div class="qos-card">' +
      '<div class="qos-cab"><span class="qos-nota ' + p.cls + '">' +
        esc(t('prof.grade.' + p.nota)) + '</span>' +
      '<h3>' + esc(t('prof.name.' + p.key)) + '</h3></div>' +
      (linhas ? '<table>' + linhas + '</table>' : '') +
      '<p class="qos-expl">' + esc(expl) + '</p>' +
      '</div>';
  }

  // Preenche e revela a seção. Devolve true se havia o que mostrar.
  function render(res) {
    res = res || compute();
    var cont = document.getElementById('vlk-perfis-cards');
    var sec = document.getElementById('vlk-perfis');
    if (!cont || !sec || !res) return false;

    var html = '';
    res.perfis.forEach(function (p) { html += card(p, res); });
    if (!html) return false;
    cont.innerHTML = html;

    // Publicado para o PDF e para o link do relatório. Só depois de renderizar:
    // o que não está na tela não deve aparecer no relatório.
    window.vlkPerfis = res;

    var parc = document.getElementById('vlk-perfis-parcial');
    if (parc) parc.style.display = res.parcial ? '' : 'none';
    var mn = document.getElementById('vlk-perfis-mos');
    var temVoip = res.perfis.some(function (p) { return p.key === 'voip'; });
    if (mn) mn.style.display = temVoip ? '' : 'none';

    sec.classList.add('aberto');
    sec.setAttribute('aria-hidden', 'false');
    document.body.classList.add('vlk-qos-open');
    return true;
  }

  // --- API -------------------------------------------------------------------

  window.VLK_PERFIS = {
    compute: compute,
    render: render,
    coleta: coleta,
    label: t,

    // exposto para teste (o cálculo roda fora do navegador)
    _test: { faixa: faixa, mos: mos, compute: compute, PERFIS: PERFIS }
  };
})();
