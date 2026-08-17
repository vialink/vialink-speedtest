// A quem o IP está designado — consulta RDAP (o whois moderno, em JSON).
//
// O card já mostra o ASN e o estado, mas ASN é o dono da REDE, não de quem
// aquele endereço foi designado. A diferença aparece justamente quando importa:
// um IP dentro do bloco de um provedor pode estar sub-alocado (REASSIGNED) a
// outra empresa, e é esse nome que responde "de quem é este IP".
//
//   187.45.160.21 → Vialink Soluções de Tecnologia Ltda   (187.45.160.0/20)
//   187.45.173.50 → Mais Link Telecomunicação Ltda.       (187.45.173.0/25)
//
// Por que RDAP e não whois: o whois clássico é texto livre (cada RIR com um
// formato) e fala na porta 43, fora do alcance do navegador. O RDAP é HTTP+JSON,
// padronizado (RFC 7483) e os servidores dos RIRs mandam `Access-Control-Allow-
// Origin: *` — dá para consultar direto do cliente, sem proxy no servidor. Como
// cada visitante consulta com o próprio IP de origem, também não concentramos
// rate limit num endereço só, que é o que aconteceria com um proxy nosso.
//
// É tráfego para terceiros (como o geo-IP e o STUN): quem hospeda pode apontar
// para outro servidor RDAP com `rdapEndpoint` no tenant, ou desligar a consulta
// com `rdapEndpoint: ''`.

(function () {
  'use strict';

  // A primeira consulta é a lenta: resolver o rdap.org, TLS, o redirect para o
  // RIR e a resposta dele. Medido em 2 a 7 s conforme o RIR (a ARIN é a pior).
  // Nada aqui bloqueia o usuário — apertar o tempo só faz perder a informação.
  var TIMEOUT = 8000;
  // Bootstrap: redireciona para o RDAP do RIR responsável (LACNIC/registro.br,
  // ARIN, RIPE, APNIC, AFRINIC). Todos os hops mandam CORS.
  var ENDPOINT_PADRAO = 'https://rdap.org/ip/';

  // Endereços que não têm registro público — nem adianta perguntar.
  function semRegistro(ip) {
    if (!ip || ip === '—') return true;
    if (ip.indexOf(':') >= 0) {
      var v6 = ip.toLowerCase();
      return v6 === '::1' || v6.indexOf('fe80:') === 0 ||
             v6.indexOf('fc') === 0 || v6.indexOf('fd') === 0;   // link-local / ULA
    }
    var p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(function (n) { return isNaN(n); })) return true;
    if (p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;  // CGNAT: bloco reservado
    return false;
  }

  // fn (nome) e kind (org/group/individual) do vCard de uma entidade RDAP.
  function vcard(e) {
    var r = { fn: '', kind: '' };
    var va = e && e.vcardArray;
    if (!va || !va[1]) return r;
    for (var i = 0; i < va[1].length; i++) {
      var campo = va[1][i];
      if (!campo) continue;
      if (campo[0] === 'fn' && typeof campo[3] === 'string') r.fn = campo[3].trim();
      if (campo[0] === 'kind' && typeof campo[3] === 'string') r.kind = campo[3].trim();
    }
    return r;
  }

  // Extrai o nome de quem detém o bloco.
  //
  // A ordem dos papéis não é estética: `registrant` é o titular; `technical` e
  // `abuse` costumam ser PESSOA FÍSICA ou o contato do provedor pai — no
  // 187.45.173.0/25 o registrant é a Mais Link e o abuse é a Vialink, e quem
  // responde à pergunta é o primeiro. Dentro do papel, `kind: org` na frente
  // porque a RIPE devolve o objeto de manutenção (RIPE-NCC-MNT, individual)
  // como um segundo registrant.
  function nomeDoRdap(d) {
    if (!d || typeof d !== 'object') return null;
    var ents = d.entities || [];
    var papeis = ['registrant', 'administrative', 'technical', 'abuse'];
    var kinds = ['org', 'group', ''];

    for (var p = 0; p < papeis.length; p++) {
      for (var k = 0; k < kinds.length; k++) {
        for (var i = 0; i < ents.length; i++) {
          var e = ents[i];
          var roles = e && e.roles;
          if (!roles || roles.indexOf(papeis[p]) < 0) continue;
          var vc = vcard(e);
          if (!vc.fn) continue;
          if (kinds[k] && vc.kind !== kinds[k]) continue;
          return vc.fn;
        }
      }
    }

    // Último recurso: o nome do próprio bloco. No registro.br ele é um número
    // interno ("421646"), que não diz nada — nesse caso é melhor não mostrar
    // linha nenhuma do que mostrar um número.
    if (typeof d.name === 'string' && d.name && !/^\d+$/.test(d.name)) return d.name.trim();
    return null;
  }

  function cache(ip) {
    try { return JSON.parse(sessionStorage.getItem('vlkWhois:' + ip)); } catch (e) { return null; }
  }
  function guarda(ip, v) {
    try { sessionStorage.setItem('vlkWhois:' + ip, JSON.stringify(v)); } catch (e) {}
  }

  // Promise com {nome, bloco, tipo} ou null. NUNCA rejeita: a linha é um extra
  // do card — se o RIR estiver fora do ar, lento ou limitando, o card fica como
  // era antes e ninguém vê erro.
  function lookup(ip, opts) {
    opts = opts || {};
    var cfg = window._tenantConfig || {};
    var base = (opts.endpoint !== undefined) ? opts.endpoint
             : (cfg.rdapEndpoint !== undefined) ? cfg.rdapEndpoint
             : ENDPOINT_PADRAO;

    if (!base || semRegistro(ip)) return Promise.resolve(null);

    // Cache da sessão. Guarda também o "consultei e não achei nome" (0), para
    // não repetir a consulta — mas NÃO guarda falha de rede: essa merece nova
    // tentativa no próximo carregamento.
    var guardado = cache(ip);
    if (guardado !== null && guardado !== undefined) return Promise.resolve(guardado || null);

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || TIMEOUT);

    return fetch(base + encodeURIComponent(ip), {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Accept': 'application/rdap+json' }
    })
      .then(function (r) { if (!r.ok) throw 1; return r.json(); })
      .then(function (d) {
        var nome = nomeDoRdap(d);
        var res = nome ? { nome: nome, bloco: d.handle || '', tipo: d.type || '' } : 0;
        guarda(ip, res);
        return res || null;
      })
      .catch(function () { return null; })
      .then(function (res) { clearTimeout(timer); return res; });
  }

  window.VLK_WHOIS = {
    lookup: lookup,

    // exposto para teste (a extração roda fora do navegador)
    _test: {
      nomeDoRdap: nomeDoRdap,
      semRegistro: semRegistro,
      vcard: vcard
    }
  };
})();
