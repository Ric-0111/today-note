/* TODAY NOTE — app.js
   ニュースのデータ（JSON）を読み込んで、画面に表示するプログラムです。
   すべてのページで共通して使います。 */

(function () {
  'use strict';

  // ------------------------------------------------------------
  // 設定
  // ------------------------------------------------------------

  var CATEGORIES = [
    { key: 'domestic', label: '国内', short: '国内' },
    { key: 'world', label: '海外・国際情勢', short: '海外' },
    { key: 'politics', label: '政治・行政', short: '政治' },
    { key: 'economy', label: '経済・金融', short: '経済' },
    { key: 'society', label: '社会・事件', short: '社会' },
    { key: 'science', label: '科学・医療', short: '科学' },
    { key: 'tech', label: 'AI・テクノロジー', short: 'AI・テック' },
    { key: 'business', label: 'ビジネス', short: 'ビジネス' },
    { key: 'environment', label: '環境・災害', short: '環境' }
  ];

  var CAT_BY_KEY = {};
  CATEGORIES.forEach(function (c) {
    CAT_BY_KEY[c.key] = c;
  });

  var DEFAULT_CONFIG = {
    siteName: 'TODAY NOTE',
    tagline: '',
    dataBase: 'data/',
    searchDays: 120,
    recentCategoryDays: 7
  };

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var PREF_KEY = 'today-note-prefs';

  var state = {
    config: DEFAULT_CONFIG,
    base: 'data/'
  };

  // ------------------------------------------------------------
  // 小さな道具
  // ------------------------------------------------------------

  function $(selector) {
    return document.querySelector(selector);
  }

  // HTMLの部品を安全に作る（文字はすべて「文字」として扱うので、悪いコードは動きません）
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgIcon(parts) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    parts.forEach(function (p) {
      var node = document.createElementNS(SVG_NS, p.tag);
      Object.keys(p.attrs).forEach(function (k) {
        node.setAttribute(k, p.attrs[k]);
      });
      svg.appendChild(node);
    });
    return svg;
  }

  var ICON_SEARCH = [
    { tag: 'circle', attrs: { cx: '11', cy: '11', r: '7' } },
    { tag: 'line', attrs: { x1: '21', y1: '21', x2: '16.65', y2: '16.65' } }
  ];

  var ICON_GEAR = [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
    {
      tag: 'path',
      attrs: {
        d:
          'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'
      }
    }
  ];

  // リンク先は http / https のものだけ許可する
  function safeUrl(u) {
    if (typeof u !== 'string') return '';
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function externalLink(url, text, cls) {
    return el('a', {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: cls || null,
      text: text
    });
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // ニュースのデータを読む。まず設定の場所（GitHub）から、だめならこのサイト内の data/ から
  function fetchData(path) {
    return fetchJSON(state.base + path).catch(function (err) {
      if (state.base === 'data/') throw err;
      return fetchJSON('data/' + path);
    });
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  // ------------------------------------------------------------
  // 表示の設定（文字の大きさ・画像の表示）。この端末のブラウザにだけ保存します
  // ------------------------------------------------------------

  function loadPrefs() {
    try {
      var p = JSON.parse(window.localStorage.getItem(PREF_KEY) || '{}');
      return p && typeof p === 'object' ? p : {};
    } catch (e) {
      return {};
    }
  }

  function savePrefs(p) {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch (e) {
      /* 保存できなくても、表示は問題なく使えます */
    }
  }

  function applyPrefs(p) {
    var size = p.size === 's' || p.size === 'l' ? p.size : 'm';
    var images = p.images === 'off' ? 'off' : 'on';
    document.documentElement.setAttribute('data-size', size);
    document.documentElement.setAttribute('data-images', images);
  }

  // ------------------------------------------------------------
  // 日付・時刻（すべて日本時間で表示）
  // ------------------------------------------------------------

  function jstParts(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    var o = {};
    parts.forEach(function (p) {
      o[p.type] = p.value;
    });
    return o;
  }

  function todayJST() {
    var p = jstParts(new Date());
    return p.year + '-' + p.month + '-' + p.day;
  }

  function dateObj(ds) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds || '');
    if (!m) return null;
    return {
      y: +m[1],
      m: +m[2],
      d: +m[3],
      w: WEEK[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]
    };
  }

  function formatDateJa(ds) {
    var o = dateObj(ds);
    if (!o) return ds || '';
    return o.y + '年' + o.m + '月' + o.d + '日（' + o.w + '）';
  }

  function formatDateTime(iso, withYear) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = jstParts(d);
    return (withYear ? p.year + '年' : '') + +p.month + '月' + +p.day + '日 ' + p.hour + ':' + p.minute;
  }

  function formatShort(iso, withDate) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = jstParts(d);
    return (withDate ? +p.month + '/' + +p.day + ' ' : '') + p.hour + ':' + p.minute;
  }

  // ------------------------------------------------------------
  // ニュースの並べ替え・表示
  // ------------------------------------------------------------

  function normImportance(n) {
    n = parseInt(n, 10);
    if (isNaN(n) || n < 1) return 1;
    return n > 3 ? 3 : n;
  }

  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      var d = normImportance(b.importance) - normImportance(a.importance);
      if (d !== 0) return d;
      return (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0);
    });
  }

  // 画像の枠。画像がない・読み込めないときは、カテゴリ名の代わり画像になります
  function renderThumb(item, cat) {
    var thumb = el('div', {
      class: 'thumb' + (cat ? ' cat-' + cat.key : ''),
      'aria-hidden': 'true'
    });
    thumb.appendChild(el('span', { text: cat ? cat.short : 'NEWS' }));

    var src = safeUrl(item.image);
    if (src) {
      var img = el('img', {
        src: src,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer'
      });
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      thumb.appendChild(img);
    }
    return thumb;
  }

  function renderItem(item, opts) {
    opts = opts || {};
    var cat = CAT_BY_KEY[item.category];
    var imp = normImportance(item.importance);
    var url = safeUrl(item.url);
    var title = item.title || '(タイトルなし)';

    // 1行目：カテゴリ・情報元・時刻 と 重要度
    var metaText = [
      cat ? cat.label : '',
      item.source || '',
      item.published ? formatShort(item.published, opts.withYear) : ''
    ]
      .filter(Boolean)
      .join('・');

    var row = el('div', { class: 'row' }, [
      el('p', { class: 'meta', text: metaText }),
      el('span', {
        class: 'stars imp-' + imp,
        role: 'img',
        'aria-label': '重要度 ' + imp + '（3段階）',
        text: '★★★'.slice(0, imp)
      })
    ]);

    var titleBtn = el('button', { type: 'button', class: 'title-btn', 'aria-expanded': 'false', text: title });
    var heading = el('h3', { class: 'title' }, [titleBtn]);

    // 要約（RSSから取れなかったときは、その旨を正直に表示する）
    // 概要がない記事は、閉じた状態ではタイトルだけにして、すっきり見せる
    var summary = item.summary ? el('p', { class: 'summary', text: item.summary }) : null;

    var bgText = item.background || item.glossary || '';
    var bgLabel = item.background ? '背景・影響' : 'ことば';
    var background = bgText
      ? el('p', { class: 'bg' }, [el('span', { class: 'bg-label', text: bgLabel }), bgText])
      : null;

    // タップして開いたときに出る部分（元記事リンク・同じ話題の他の情報元）
    var detail = el('div', { class: 'detail' });
    var linkLine = el('p', {}, [
      item.source ? item.source + '　' : '',
      item.published ? formatDateTime(item.published, true) + '　' : '',
      url ? externalLink(url, '元記事を読む →', 'read') : null
    ]);
    detail.appendChild(linkLine);
    if (!item.summary) {
      detail.appendChild(
        el('p', { text: '配信元から概要が提供されていないため、タイトルのみを表示しています。' })
      );
    }

    var alsoLinks = [];
    (Array.isArray(item.others) ? item.others : []).forEach(function (o) {
      if (!o || !o.source) return;
      var ou = safeUrl(o.url);
      if (alsoLinks.length) alsoLinks.push('、');
      alsoLinks.push(ou ? externalLink(ou, o.source) : o.source);
    });
    if (alsoLinks.length) {
      detail.appendChild(el('p', { class: 'also' }, ['同じ話題：'].concat(alsoLinks)));
    }

    var body = el('div', { class: 'body' }, [row, heading, summary, background, detail]);
    var card = el('article', { class: 'card' }, [renderThumb(item, cat), body]);

    // カードをタップすると、詳しい表示に切り替わる（リンクをタップしたときは切り替えない）
    card.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length > 0) return;
      var open = card.classList.toggle('open');
      titleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    return card;
  }

  function renderItems(items, opts) {
    var wrap = el('div', { class: 'items' });
    items.forEach(function (it) {
      wrap.appendChild(renderItem(it, opts));
    });
    return wrap;
  }

  // ------------------------------------------------------------
  // ヘッダー・フッター
  // ------------------------------------------------------------

  function settingRow(label, key, options) {
    var prefs = loadPrefs();
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });

    function current() {
      return loadPrefs()[key] || options[0].value;
    }

    function refresh() {
      var cur = current();
      Array.prototype.forEach.call(seg.children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-value') === cur ? 'true' : 'false');
      });
    }

    options.forEach(function (o) {
      var b = el('button', { type: 'button', 'data-value': o.value, text: o.label });
      b.addEventListener('click', function () {
        var p = loadPrefs();
        p[key] = o.value;
        savePrefs(p);
        applyPrefs(p);
        refresh();
      });
      seg.appendChild(b);
    });

    void prefs;
    refresh();
    return el('div', { class: 'setting-row' }, [el('span', { class: 'setting-label', text: label }), seg]);
  }

  function renderHeader(activeKey) {
    var cfg = state.config;
    var t = dateObj(todayJST());

    var searchLink = el(
      'a',
      {
        class: 'icon-btn',
        href: 'search.html',
        'aria-label': '検索',
        title: '検索',
        'aria-current': activeKey === 'search' ? 'page' : null
      },
      [svgIcon(ICON_SEARCH)]
    );

    var settingsBtn = el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '表示の設定',
        title: '表示の設定',
        'aria-expanded': 'false',
        'aria-controls': 'settings'
      },
      [svgIcon(ICON_GEAR)]
    );

    var settings = el('div', { class: 'settings', id: 'settings', hidden: 'hidden' }, [
      settingRow('文字の大きさ', 'size', [
        { value: 'm', label: '標準' },
        { value: 's', label: '小さめ' },
        { value: 'l', label: '大きめ' }
      ]),
      settingRow('画像', 'images', [
        { value: 'on', label: '表示する' },
        { value: 'off', label: '表示しない' }
      ])
    ]);

    settingsBtn.addEventListener('click', function () {
      var open = settings.hasAttribute('hidden');
      if (open) settings.removeAttribute('hidden');
      else settings.setAttribute('hidden', 'hidden');
      settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var nav = el('nav', { class: 'nav', 'aria-label': 'カテゴリ' });
    function addLink(href, text, key) {
      nav.appendChild(
        el('a', { href: href, 'aria-current': activeKey === key ? 'page' : null, text: text })
      );
    }
    addLink('index.html', '今日', 'home');
    CATEGORIES.forEach(function (c) {
      addLink('category.html?c=' + c.key, c.short, c.key);
    });
    addLink('archive.html', '過去', 'archive');

    var header = $('#site-header');
    header.textContent = '';
    header.appendChild(
      el('div', { class: 'head-row' }, [
        el('div', {}, [
          el('a', { class: 'brand', href: 'index.html', text: cfg.siteName }),
          el('p', { class: 'today' }, [
            el('span', { class: 'today-main', text: t.m + '月' + t.d + '日' }),
            el('span', { class: 'today-sub', text: t.y + '年・' + t.w + '曜日' })
          ])
        ]),
        el('div', { class: 'icons' }, [searchLink, settingsBtn])
      ])
    );
    header.appendChild(settings);
    header.appendChild(nav);
  }

  function renderFooter() {
    var footer = $('#site-footer');
    footer.textContent = '';
    footer.appendChild(
      el('p', {
        text:
          'このサイトは、各報道機関などが公開しているRSS（記事の見出しや概要をまとめた配信データ）を、' +
          'プログラムで読みやすく整えて紹介しています。AIが記事の全文を読んで要約したものではありません。'
      })
    );
    footer.appendChild(
      el('p', {
        text: '正確な内容は、必ず元の記事でご確認ください。記事の著作権は、それぞれの情報元に帰属します。'
      })
    );
  }

  function setTitle(pageName) {
    var site = state.config.siteName;
    document.title = pageName ? pageName + ' | ' + site : site;
  }

  // ------------------------------------------------------------
  // 画面の共通部品
  // ------------------------------------------------------------

  function setMain(nodes) {
    var main = $('#main');
    main.textContent = '';
    nodes.forEach(function (n) {
      if (n) main.appendChild(n);
    });
  }

  function statusNode(text) {
    return el('p', { class: 'status', text: text });
  }

  function showError(message) {
    setMain([statusNode(message)]);
  }

  function sampleNotice() {
    return el('p', {
      class: 'notice',
      text:
        'これは画面の確認用のサンプルです。実際のニュースではありません。' +
        '自動更新が始まると、本物のニュースに置き換わります。'
    });
  }

  var LOAD_ERROR = 'ニュースのデータを読み込めませんでした。しばらくしてから、もう一度開いてください。';

  // ------------------------------------------------------------
  // データの読み込み
  // ------------------------------------------------------------

  function loadConfig() {
    return fetchJSON('site-config.json')
      .catch(function () {
        return {};
      })
      .then(function (cfg) {
        var merged = {};
        Object.keys(DEFAULT_CONFIG).forEach(function (k) {
          merged[k] = cfg && cfg[k] !== undefined && cfg[k] !== '' ? cfg[k] : DEFAULT_CONFIG[k];
        });
        var base = String(merged.dataBase || 'data/');
        if (base.charAt(base.length - 1) !== '/') base += '/';
        state.config = merged;
        state.base = base;
      });
  }

  // data/index.json から、日付の一覧（新しい順）を取り出す
  function loadIndex() {
    return fetchData('index.json').then(function (idx) {
      var list = Array.isArray(idx && idx.dates) ? idx.dates : [];
      var dates = [];
      list.forEach(function (d) {
        var date = typeof d === 'string' ? d : d && d.date;
        var count = typeof d === 'object' && d ? d.count : null;
        if (typeof date === 'string' && DATE_RE.test(date)) {
          dates.push({ date: date, count: count });
        }
      });
      dates.sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      });
      return dates;
    });
  }

  function loadDay(date) {
    if (!DATE_RE.test(date)) return Promise.resolve(null);
    return fetchData('days/' + date + '.json').catch(function () {
      return null;
    });
  }

  function loadDays(dates) {
    return Promise.all(dates.map(loadDay)).then(function (days) {
      return days.filter(function (d) {
        return d && Array.isArray(d.items);
      });
    });
  }

  // たくさんの日を、少しずつまとめて読み込む（一度に大量のアクセスをしないため）
  function loadDaysInBatches(dates, size) {
    var result = [];
    var chain = Promise.resolve();
    for (var i = 0; i < dates.length; i += size) {
      (function (chunk) {
        chain = chain
          .then(function () {
            return loadDays(chunk);
          })
          .then(function (days) {
            result = result.concat(days);
          });
      })(dates.slice(i, i + size));
    }
    return chain.then(function () {
      return result;
    });
  }

  // ------------------------------------------------------------
  // ページ：トップ
  // ------------------------------------------------------------

  function pageHome() {
    setTitle('');
    setMain([statusNode('読み込み中…')]);

    fetchData('latest.json')
      .then(function (day) {
        var items = sortItems(Array.isArray(day.items) ? day.items : []);
        var nodes = [];

        if (day.sample) nodes.push(sampleNotice());

        var updatedText = '';
        if (day.generated_at) updatedText = '更新：' + formatDateTime(day.generated_at, true);
        if (day.date && day.date < todayJST()) {
          updatedText +=
            (updatedText ? '　' : '') + '※ 最新のニュースは ' + formatDateJa(day.date) + ' 分です';
        }
        if (updatedText) nodes.push(el('p', { class: 'updated', text: updatedText }));

        if (!items.length) {
          nodes.push(statusNode('今日のニュースはまだありません。'));
          setMain(nodes);
          return;
        }

        // 今日の重要ニュース：重要度★★以上から最大3件（無理に増やさない）
        var top = items
          .filter(function (i) {
            return normImportance(i.importance) >= 2;
          })
          .slice(0, 3);
        var inTop = new Set(top);
        var rest = items
          .filter(function (i) {
            return !inTop.has(i);
          })
          .slice(0, 12);

        if (top.length) {
          nodes.push(el('h2', { class: 'section-title', text: '今日の重要ニュース' }));
          nodes.push(renderItems(top));
        }
        if (rest.length) {
          nodes.push(el('h2', { class: 'section-title', text: '今日のニュース' }));
          nodes.push(renderItems(rest));
        }

        var shown = top.length + rest.length;
        if (items.length > shown && day.date) {
          nodes.push(
            el('p', { class: 'more' }, [
              el('a', {
                href: 'archive.html?d=' + encodeURIComponent(day.date),
                text: 'この日のニュースをすべて見る（' + items.length + '件） →'
              })
            ])
          );
        }
        setMain(nodes);
      })
      .catch(function () {
        showError(LOAD_ERROR);
      });
  }

  // ------------------------------------------------------------
  // ページ：カテゴリ別
  // ------------------------------------------------------------

  function pageCategory(cat) {
    setTitle(cat.label);
    setMain([statusNode('読み込み中…')]);

    var days = Number(state.config.recentCategoryDays) || 7;

    loadIndex()
      .then(function (dates) {
        var target = dates.slice(0, days).map(function (d) {
          return d.date;
        });
        return loadDays(target);
      })
      .then(function (dayList) {
        dayList.sort(function (a, b) {
          return a.date < b.date ? 1 : -1;
        });

        var nodes = [
          el('h1', { class: 'page-title', text: cat.label }),
          el('p', { class: 'page-lead', text: '最近' + days + '日分のニュースです。' })
        ];

        if (
          dayList.some(function (d) {
            return d.sample;
          })
        ) {
          nodes.push(sampleNotice());
        }

        var count = 0;
        dayList.forEach(function (day) {
          var items = sortItems(
            day.items.filter(function (i) {
              return i.category === cat.key;
            })
          );
          if (!items.length) return;
          count += items.length;
          nodes.push(el('h2', { class: 'day-heading', text: formatDateJa(day.date) }));
          nodes.push(renderItems(items));
        });

        if (!count) nodes.push(statusNode('このカテゴリのニュースはまだありません。'));
        setMain(nodes);
      })
      .catch(function () {
        showError(LOAD_ERROR);
      });
  }

  function pageCategoryMenu() {
    setTitle('カテゴリ');
    var list = el('ul', { class: 'date-list' });
    CATEGORIES.forEach(function (c) {
      list.appendChild(
        el('li', {}, [el('a', { href: 'category.html?c=' + c.key }, [el('span', { text: c.label })])])
      );
    });
    setMain([el('h1', { class: 'page-title', text: 'カテゴリ' }), list]);
  }

  // ------------------------------------------------------------
  // ページ：過去のニュース
  // ------------------------------------------------------------

  function pageArchive() {
    var date = getParam('d');
    setMain([statusNode('読み込み中…')]);

    loadIndex()
      .then(function (dates) {
        if (DATE_RE.test(date)) return archiveDay(date, dates);
        return archiveList(dates);
      })
      .catch(function () {
        showError(LOAD_ERROR);
      });
  }

  function archiveList(dates) {
    setTitle('過去のニュース');
    var nodes = [
      el('h1', { class: 'page-title', text: '過去のニュース' }),
      el('p', { class: 'page-lead', text: '日付を選ぶと、その日のニュースを読めます。' })
    ];

    if (!dates.length) {
      nodes.push(statusNode('まだ過去のニュースはありません。'));
      setMain(nodes);
      return;
    }

    var currentMonth = '';
    var list = null;
    dates.forEach(function (d) {
      var month = d.date.slice(0, 7);
      if (month !== currentMonth) {
        currentMonth = month;
        var o = dateObj(d.date);
        nodes.push(el('h2', { class: 'day-heading', text: o.y + '年' + o.m + '月' }));
        list = el('ul', { class: 'date-list' });
        nodes.push(list);
      }
      list.appendChild(
        el('li', {}, [
          el('a', { href: 'archive.html?d=' + d.date }, [
            el('span', { text: formatDateJa(d.date) }),
            d.count !== null && d.count !== undefined
              ? el('span', { class: 'count', text: d.count + '件' })
              : null
          ])
        ])
      );
    });
    setMain(nodes);
  }

  function archiveDay(date, dates) {
    setTitle(formatDateJa(date));
    return loadDay(date).then(function (day) {
      var nodes = [el('h1', { class: 'page-title', text: formatDateJa(date) })];

      if (!day) {
        nodes.push(statusNode('この日のニュースは見つかりませんでした。'));
      } else {
        if (day.sample) nodes.push(sampleNotice());
        var items = sortItems(day.items || []);
        nodes.push(el('div', { class: 'spacer' }));
        if (!items.length) nodes.push(statusNode('この日のニュースはありません。'));
        else nodes.push(renderItems(items));
      }

      var pos = -1;
      dates.forEach(function (d, i) {
        if (d.date === date) pos = i;
      });
      var newer = pos > 0 ? dates[pos - 1] : null;
      var older = pos >= 0 && pos < dates.length - 1 ? dates[pos + 1] : null;
      nodes.push(
        el('div', { class: 'day-nav' }, [
          older
            ? el('a', { href: 'archive.html?d=' + older.date, text: '← ' + formatDateJa(older.date) })
            : el('span'),
          newer
            ? el('a', { href: 'archive.html?d=' + newer.date, text: formatDateJa(newer.date) + ' →' })
            : el('span')
        ])
      );
      nodes.push(el('p', { class: 'more' }, [el('a', { href: 'archive.html', text: '日付の一覧に戻る' })]));
      setMain(nodes);
    });
  }

  // ------------------------------------------------------------
  // ページ：検索（キーワード＋カテゴリ）
  // ------------------------------------------------------------

  function normalizeText(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase();
  }

  function pageSearch() {
    setTitle('検索');

    var input = el('input', {
      type: 'search',
      id: 'q',
      name: 'q',
      placeholder: 'キーワードを入力（例：円安、地震、AI）',
      autocomplete: 'off',
      enterkeyhint: 'search',
      'aria-label': 'キーワード'
    });
    var form = el('form', { class: 'search-box', role: 'search' }, [input]);

    // カテゴリの絞りこみ
    var selectedCat = CAT_BY_KEY[getParam('c')] ? getParam('c') : '';
    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'カテゴリで絞りこむ' });
    var chipDefs = [{ key: '', label: 'すべて' }].concat(CATEGORIES);
    chipDefs.forEach(function (c) {
      var b = el('button', {
        type: 'button',
        class: 'chip',
        'data-key': c.key,
        'aria-pressed': 'false',
        text: c.key ? c.short : c.label
      });
      b.addEventListener('click', function () {
        selectedCat = c.key;
        run();
      });
      chips.appendChild(b);
    });

    var info = el('p', { class: 'search-count' });
    var results = el('div', { class: 'items' });

    setMain([
      el('h1', { class: 'page-title', text: '検索' }),
      el('p', { class: 'page-lead', text: '過去のニュースを、キーワードやカテゴリで探せます。' }),
      form,
      chips,
      info,
      results
    ]);

    var all = [];
    var ready = false;
    var limit = Number(state.config.searchDays) || 120;

    info.textContent = '過去のニュースを読み込み中…';

    function run() {
      var q = normalizeText(input.value).trim();
      results.textContent = '';

      Array.prototype.forEach.call(chips.children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-key') === selectedCat ? 'true' : 'false');
      });

      // アドレス欄にも検索条件を残す（あとで同じ検索を開けるように）
      try {
        var url = new URL(window.location.href);
        if (q) url.searchParams.set('q', input.value.trim());
        else url.searchParams.delete('q');
        if (selectedCat) url.searchParams.set('c', selectedCat);
        else url.searchParams.delete('c');
        window.history.replaceState(null, '', url.toString());
      } catch (e) {
        /* 失敗しても検索自体は続けられます */
      }

      if (!ready) return;
      if (!q && !selectedCat) {
        info.textContent = all.length + '件のニュースから探せます。';
        return;
      }

      var words = q.split(/\s+/).filter(Boolean);
      var hits = all.filter(function (entry) {
        if (selectedCat && entry.item.category !== selectedCat) return false;
        return words.every(function (w) {
          return entry.text.indexOf(w) !== -1;
        });
      });

      hits.sort(function (a, b) {
        return (Date.parse(b.item.published) || 0) - (Date.parse(a.item.published) || 0);
      });

      var MAX = 50;
      var label = [];
      if (selectedCat) label.push(CAT_BY_KEY[selectedCat].label);
      if (q) label.push('「' + input.value.trim() + '」');
      info.textContent =
        label.join(' ') + ' の結果：' + hits.length + '件' +
        (hits.length > MAX ? '（新しい順に' + MAX + '件を表示）' : '');

      if (!hits.length) {
        results.appendChild(statusNode('見つかりませんでした。別の言葉でお試しください。'));
        return;
      }
      hits.slice(0, MAX).forEach(function (entry) {
        results.appendChild(renderItem(entry.item, { withYear: true }));
      });
    }

    var timer = null;
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 200);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      run();
    });

    // 読み込み中も、カテゴリのボタンの状態は先に反映しておく
    Array.prototype.forEach.call(chips.children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-key') === selectedCat ? 'true' : 'false');
    });

    loadIndex()
      .then(function (dates) {
        var target = dates.slice(0, limit).map(function (d) {
          return d.date;
        });
        return loadDaysInBatches(target, 6);
      })
      .then(function (days) {
        days.forEach(function (day) {
          day.items.forEach(function (item) {
            var cat = CAT_BY_KEY[item.category];
            all.push({
              item: item,
              text: normalizeText(
                [item.title, item.summary, item.background, item.glossary, item.source, cat ? cat.label : ''].join(' ')
              )
            });
          });
        });
        ready = true;
        var initial = getParam('q');
        if (initial) input.value = initial;
        run();
      })
      .catch(function () {
        info.textContent = '';
        showError(LOAD_ERROR);
      });
  }

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------

  function init() {
    applyPrefs(loadPrefs());
    var page = document.body.getAttribute('data-page');

    loadConfig().then(function () {
      var activeKey = page;
      var cat = null;

      if (page === 'category') {
        cat = CAT_BY_KEY[getParam('c')] || null;
        activeKey = cat ? cat.key : 'category';
      }

      renderHeader(activeKey);
      renderFooter();

      if (page === 'home') pageHome();
      else if (page === 'category') (cat ? pageCategory(cat) : pageCategoryMenu());
      else if (page === 'archive') pageArchive();
      else if (page === 'search') pageSearch();
    });
  }

  init();
})();
