// Sistema de tradução (i18n) do velocímetro.
//
// Os dicionários vivem em assets/js/i18n/<código>.js e se registram aqui via
// VLK_I18N.register({...}) — ver README.md nesta pasta para adicionar um idioma.
//
// Resolução do idioma: ?lang=<código> (testes) → cookie vlk_lang (escolha do
// usuário no seletor de bandeira) → idioma do navegador → en-US.
//
// Textos traduzíveis são marcados no HTML/SVG com:
//   data-i18n="chave"          → textContent = tradução
//   data-i18n-html="chave"     → innerHTML  = tradução (valores com marcação)
//   data-i18n-content="chave"  → atributo content (meta tags)
// Placeholders {name} etc. são substituídos; {name} default = nome do tenant.
(function () {
  'use strict';

  var COOKIE = 'vlk_lang';
  var FALLBACK = 'en-US';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var langs = {};      // código -> definição registrada
  var order = [];      // ordem de registro = ordem no seletor
  var current = null;  // código resolvido (lazy)
  var svgChips = [];   // chips construídos dentro dos SVGs

  function getCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : '';
  }
  function setCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; max-age=31536000; path=/; SameSite=Lax';
  }

  // Casa um código pedido com os idiomas registrados: exato, depois só a língua
  // ("pt" casa com "pt-BR"; "pt-PT" também cai em "pt-BR" se não houver pt-PT).
  function match(code, exactOnly) {
    if (!code) return null;
    code = String(code).toLowerCase();
    for (var i = 0; i < order.length; i++) {
      if (order[i].toLowerCase() === code) return order[i];
    }
    if (exactOnly) return null;
    var base = code.split('-')[0];
    for (var j = 0; j < order.length; j++) {
      if (order[j].toLowerCase().split('-')[0] === base) return order[j];
    }
    return null;
  }

  function resolve() {
    var m = window.location.search.match(/[?&]lang=([A-Za-z-]+)/);
    var c = m && match(m[1]);
    if (c) return c;
    c = match(getCookie(COOKIE));
    if (c) return c;
    var nav = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < nav.length; i++) { c = match(nav[i], true); if (c) return c; }
    for (var j = 0; j < nav.length; j++) { c = match(nav[j]); if (c) return c; }
    return langs[FALLBACK] ? FALLBACK : order[0];
  }

  function cur() {
    if (!current) current = resolve();
    return current;
  }

  function fill(s, params) {
    return s.replace(/\{(\w+)\}/g, function (m, p) {
      if (params && Object.prototype.hasOwnProperty.call(params, p)) return params[p];
      if (p === 'name' && window._tenantConfig) return window._tenantConfig.name;
      return m;
    });
  }

  function lookup(code, key, params) {
    var def = langs[code];
    var s = def && def.strings ? def.strings[key] : null;
    if (s == null && langs[FALLBACK]) s = langs[FALLBACK].strings[key];
    if (s == null) return key;
    return fill(s, params);
  }

  function t(key, params) {
    return lookup(cur(), key, params);
  }

  // O PDF do Compartilhar usa a Helvetica embutida do jsPDF, que só cobre
  // caracteres latinos. Idiomas com pdfLatin1:false (cirílico, CJK...) caem
  // no en-US SÓ no PDF — a interface continua no idioma escolhido.
  function pdfCode() {
    var d = langs[cur()];
    return (d && d.pdfLatin1 === false && langs[FALLBACK]) ? FALLBACK : cur();
  }

  // O texto corresponde à chave em QUALQUER idioma registrado? (usado pelos
  // observers do tenant.js — o texto pode ter sido escrito em outro idioma)
  function matches(text, key) {
    for (var i = 0; i < order.length; i++) {
      var d = langs[order[i]];
      if (d.strings && d.strings[key] === text) return true;
    }
    return false;
  }

  function applyRoot(root) {
    var i, els;
    els = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < els.length; i++) els[i].innerHTML = t(els[i].getAttribute('data-i18n-html'));
    els = root.querySelectorAll('[data-i18n-content]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('content', t(els[i].getAttribute('data-i18n-content')));
  }

  function applyAll() {
    document.documentElement.setAttribute('lang', cur());
    applyRoot(document);
    var svg = window._vlkSvgDoc;
    if (svg && svg !== document) applyRoot(svg);
    refreshChips();
    buildHtmlChip();
  }

  function setLang(code) {
    var c = match(code);
    if (!c || c === current) { closeMenus(); return; }
    current = c;
    setCookie(COOKIE, c);
    applyAll();
    closeMenus();
  }

  // ---------- Seletor dentro do SVG do app (desktop e mobile) ----------

  var LAYOUTS = {
    'vlk-lang-desk': { x: 501, y: 13, menuX: 425, menuW: 120 },
    'vlk-lang-mob':  { x: 232, y: 10, menuX: 174, menuW: 120 }
  };

  function svgEl(doc, tag, attrs) {
    var el = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function setHref(el, href) {
    el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    el.setAttribute('href', href);
  }

  function closeMenus() {
    for (var i = 0; i < svgChips.length; i++) svgChips[i].menu.setAttribute('display', 'none');
    var drop = document.getElementById('vlk-lang-drop');
    if (drop) drop.hidden = true;
  }

  function buildSvgChip(doc, anchorId) {
    var g = doc.getElementById(anchorId);
    var layout = LAYOUTS[anchorId];
    if (!g || !layout || g.getAttribute('data-vlk-built')) return;
    g.setAttribute('data-vlk-built', '1');

    var title = svgEl(doc, 'title', {});
    var flag = svgEl(doc, 'image', { x: layout.x, y: layout.y, width: 14, height: 9.8 });
    var code = svgEl(doc, 'text', { 'class': 'vlk-lang-code', x: layout.x + 17.5, y: layout.y + 8.6 });
    var hit = svgEl(doc, 'rect', {
      x: layout.x - 3, y: layout.y - 4, width: 46, height: 18,
      fill: 'transparent', 'pointer-events': 'visible'
    });
    g.appendChild(title);
    g.appendChild(flag);
    g.appendChild(code);
    g.appendChild(hit);

    // Menu suspenso — irmão do chip, appendado por último = desenhado por cima
    var menu = svgEl(doc, 'g', { display: 'none' });
    var rowH = 17, pad = 4;
    var bg = svgEl(doc, 'rect', {
      'class': 'vlk-lang-menu-bg', x: layout.menuX, y: 34,
      width: layout.menuW, height: order.length * rowH + pad * 2, rx: 5
    });
    menu.appendChild(bg);
    for (var i = 0; i < order.length; i++) {
      (function (lc) {
        var d = langs[lc];
        var y0 = 34 + pad + order.indexOf(lc) * rowH;
        var row = svgEl(doc, 'g', { 'class': 'vlk-lang-item', style: 'cursor:pointer' });
        var rowBg = svgEl(doc, 'rect', {
          'class': 'vlk-lang-row', x: layout.menuX + 3, y: y0, width: layout.menuW - 6,
          height: rowH - 1, rx: 3, fill: 'transparent', 'pointer-events': 'visible'
        });
        var f = svgEl(doc, 'image', { x: layout.menuX + 8, y: y0 + 3, width: 14, height: 9.8 });
        setHref(f, d.flag);
        var txt = svgEl(doc, 'text', { 'class': 'vlk-lang-name', x: layout.menuX + 28, y: y0 + 11.5 });
        txt.textContent = d.country + ' · ' + d.name;
        row.appendChild(rowBg);
        row.appendChild(f);
        row.appendChild(txt);
        row.addEventListener('click', function (e) {
          e.stopPropagation();
          setLang(lc);
        });
        menu.appendChild(row);
      })(order[i]);
    }
    g.parentNode.appendChild(menu);

    g.style.cursor = 'pointer';
    g.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.getAttribute('display') !== 'none';
      closeMenus();
      if (!open) menu.removeAttribute('display');
    });

    svgChips.push({ flag: flag, code: code, title: title, menu: menu });
    refreshChips();
  }

  function refreshChips() {
    var d = langs[cur()];
    if (!d) return;
    for (var i = 0; i < svgChips.length; i++) {
      setHref(svgChips[i].flag, d.flag);
      svgChips[i].code.textContent = d.country;
      svgChips[i].title.textContent = t('lang.label');
    }
  }

  // Chamado pelo tenant.js quando o SVG do app está disponível
  function initSvg(svgDoc) {
    applyRoot(svgDoc);
    buildSvgChip(svgDoc, 'vlk-lang-desk');
    buildSvgChip(svgDoc, 'vlk-lang-mob');
  }

  // ---------- Seletor nas páginas HTML (relatorio, manual, sobre) ----------

  function buildHtmlChip() {
    var host = document.getElementById('vlk-lang-html');
    if (!host) return;
    var d = langs[cur()];
    if (!d) return;
    host.innerHTML = '';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vlk-lang-btn';
    btn.title = t('lang.label');
    btn.innerHTML = '<img src="' + d.flag + '" alt=""><span>' + d.country + '</span>';

    var drop = document.createElement('div');
    drop.className = 'vlk-lang-drop';
    drop.id = 'vlk-lang-drop';
    drop.hidden = true;
    for (var i = 0; i < order.length; i++) {
      (function (lc) {
        var ld = langs[lc];
        var item = document.createElement('button');
        item.type = 'button';
        item.innerHTML = '<img src="' + ld.flag + '" alt=""><span>' + ld.country + ' · ' + ld.name + '</span>';
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          setLang(lc);
        });
        drop.appendChild(item);
      })(order[i]);
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      drop.hidden = !drop.hidden;
    });
    host.appendChild(btn);
    host.appendChild(drop);
  }

  // Clique fora fecha os menus
  document.addEventListener('click', closeMenus);

  document.addEventListener('DOMContentLoaded', function () {
    applyAll();
  });

  window.VLK_I18N = {
    register: function (def) {
      if (!def || !def.code || langs[def.code]) return;
      langs[def.code] = def;
      order.push(def.code);
    },
    t: t,
    tPdf: function (key, params) { return lookup(pdfCode(), key, params); },
    matches: matches,
    setLang: setLang,
    current: cur,
    locale: function () { return (langs[cur()] && langs[cur()].locale) || 'en-US'; },
    pdfLocale: function () { return (langs[pdfCode()] && langs[pdfCode()].locale) || 'en-US'; },
    applyAll: applyAll,
    initSvg: initSvg
  };
  window.vlkT = t;
})();
