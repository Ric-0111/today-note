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
    tagline: '毎朝5分で、世の中の大切な動きが分かるニュースサイト',
    dataBase: 'data/',
    searchDays: 120,
    recentCategoryDays: 7
  };

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
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
    return (
      (withYear ? p.year + '年' : '') +
      +p.month + '月' + +p.day + '日 ' + p.hour + ':' + p.minute
    );
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

  function renderItem(item, opts) {
    opts = opts || {};
    var cat = CAT_BY_KEY[item.category];
    var imp = normImportance(item.importance);
    var url = safeUrl(item.url);
    var title = item.title || '(タイトルなし)';

    // 1行目：重要度・カテゴリ
    var meta = el('p', { class: 'item-meta' }, [
      opts.number
        ? el('span', { class: 'lead-no', text: (opts.number < 10 ? '0' : '') + opts.number })
        : null,
      el('span', {
        class: 'stars imp-' + imp,
        'aria-label': '重要度 ' + imp + '（3段階）',
        text: '★★★'.slice(0, imp)
      }),
      cat ? el('span', { class: 'cat', text: cat.label }) : null
    ]);

    // タイトル
    var heading = el('h3', { class: 'item-title' }, [
      url ? externalLink(url, title) : title
    ]);

    // 要約（RSSから取れなかったときは、その旨を正直に表示する）
    var summary = el('p', {
      class: 'item-summary',
      text: item.summary || '概要は取得できませんでした。詳しくは元記事をご覧ください。'
    });

    // 背景・影響（あるときだけ）
    var background = item.background
      ? el('div', { class: 'background' }, [
          el('span', { class: 'background-label', text: '背景・影響' }),
          el('p', { text: item.background })
        ])
      : null;

    // 情報元・日時・リンク
    var foot = el('p', { class: 'item-foot' }, [
      item.source ? el('span', { class: 'source', text: item.source }) : null,
      item.published
        ? el('span', { class: 'time', text: formatDateTime(item.published, opts.withYear) })
        : null,
      url ? externalLink(url, '元記事を読む →', 'read') : null
    ]);

    // 同じ話題を報じた他の情報元
    var others = Array.isArray(item.others) ? item.others : [];
    var alsoLinks = [];
    others.forEach(function (o) {
      var ou = safeUrl(o && o.url);
      if (!o || !o.source) return;
      if (alsoLinks.length) alsoLinks.push('、');
      alsoLinks.push(ou ? externalLink(ou, o.source) : o.source);
    });
    if (alsoLinks.length) {
      foot.appendChild(el('span', { class: 'also' }, ['同じ話題：'].concat(alsoLinks)));
    }

    return el('article', { class: 'item' + (opts.lead ? ' lead' : '') }, [
      meta,
      heading,
      summary,
      background,
      foot
    ]);
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

  function renderHeader(activeKey) {
    var cfg = state.config;
    var t = dateObj(todayJST());

    var nav = el('nav', { class: 'nav', 'aria-label': 'メニュー' });
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
    addLink('search.html', '検索', 'search');

    var header = $('#site-header');
    header.textContent = '';
    header.appendChild(el('a', { class: 'brand', href: 'index.html', text: cfg.siteName }));
    header.appendChild(
      el('p', { class: 'today' }, [
        el('span', { class: 'today-main', text: t.m + '月' + t.d + '日' }),
        el('span', { class: 'today-sub', text: t.y + '年・' + t.w + '曜日' })
      ])
    );
    header.appendChild(el('p', { class: 'tagline', text: cfg.tagline }));
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
        text:
          '正確な内容は、必ず元の記事でご確認ください。記事の著作権は、それぞれの情報元に帰属します。'
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
    return fetchJSON(state.base + 'index.json').then(function (idx) {
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
    return fetchJSON(state.base + 'days/' + date + '.json').catch(function () {
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

    fetchJSON(state.base + 'latest.json')
      .then(function (day) {
        var items = sortItems(Array.isArray(day.items) ? day.items : []);
        var nodes = [];

        if (day.sample) nodes.push(sampleNotice());

        // 更新日時
        var updatedText = '';
        if (day.generated_at) updatedText = '更新：' + formatDateTime(day.generated_at, true);
        if (day.date && day.date < todayJST()) {
          updatedText += (updatedText ? '　' : '') + '※ 最新のニュースは ' + formatDateJa(day.date) + ' 分です';
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
          var leadList = el('div', { class: 'lead-list' });
          top.forEach(function (it, idx) {
            leadList.appendChild(renderItem(it, { lead: true, number: idx + 1 }));
          });
          nodes.push(leadList);
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
        showError('ニュースのデータを読み込めませんでした。しばらくしてから、もう一度開いてください。');
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

        var sample = dayList.some(function (d) {
          return d.sample;
        });
        if (sample) nodes.push(sampleNotice());

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
        showError('ニュースのデータを読み込めませんでした。しばらくしてから、もう一度開いてください。');
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
        showError('ニュースのデータを読み込めませんでした。しばらくしてから、もう一度開いてください。');
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
        if (!items.length) nodes.push(statusNode('この日のニュースはありません。'));
        else nodes.push(renderItems(items));
      }

      // 前の日・次の日へのリンク
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
            : el('span'),
        ])
      );
      nodes.push(
        el('p', { class: 'more' }, [el('a', { href: 'archive.html', text: '日付の一覧に戻る' })])
      );
      setMain(nodes);
    });
  }

  // ------------------------------------------------------------
  // ページ：検索
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
    var info = el('p', { class: 'search-count' });
    var results = el('div', { class: 'items' });

    setMain([
      el('h1', { class: 'page-title', text: '検索' }),
      el('p', { class: 'page-lead', text: '過去のニュースを、キーワードで探せます。' }),
      form,
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

      // アドレス欄にも検索語を残す（あとで同じ検索を開けるように）
      try {
        var url = new URL(window.location.href);
        if (q) url.searchParams.set('q', input.value.trim());
        else url.searchParams.delete('q');
        window.history.replaceState(null, '', url.toString());
      } catch (e) {
        /* 失敗しても検索自体は続けられます */
      }

      if (!ready) return;
      if (!q) {
        info.textContent = all.length + '件のニュースから探せます。';
        return;
      }

      var words = q.split(/\s+/).filter(Boolean);
      var hits = all.filter(function (entry) {
        return words.every(function (w) {
          return entry.text.indexOf(w) !== -1;
        });
      });

      hits.sort(function (a, b) {
        return (Date.parse(b.item.published) || 0) - (Date.parse(a.item.published) || 0);
      });

      var MAX = 50;
      info.textContent =
        '「' + input.value.trim() + '」の検索結果：' + hits.length + '件' +
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
                [item.title, item.summary, item.background, item.source, cat ? cat.label : ''].join(' ')
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
        showError('ニュースのデータを読み込めませんでした。しばらくしてから、もう一度開いてください。');
      });
  }

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------

  function init() {
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
