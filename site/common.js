/* @omfy 論点マップ 共通モジュール
 * 詳細ビュー（detail.html）と俯瞰ビュー（overview.html）で共有する。ガイド（index.html）は使わない。
 *  - 公開用スプレッドシートの CSV（論点・意見・属性マスタ）を取得して木を組み立てる
 *  - 意見リストの HTML を作る
 * ブラウザでは window.OMFY、Node（テスト）では module.exports で使える。
 */
(function (root) {
  'use strict';

  // 公開用スプレッドシートの CSV 公開 URL（ファイル → 共有 → ウェブに公開 → CSV）。
  // シートを公開し直して URL が変わったら、ここだけ直せば両方の画面に反映される。
  const CSV_URLS = {
    nodes: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlAW55KSksgmHytcuHjtNz_ovRS2_02lzsrIIlpJSHflrlonXEZ8Rs5FDoToE49oKs7zImGOjDh1w9/pub?gid=209843467&single=true&output=csv',
    opinions: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlAW55KSksgmHytcuHjtNz_ovRS2_02lzsrIIlpJSHflrlonXEZ8Rs5FDoToE49oKs7zImGOjDh1w9/pub?gid=732075855&single=true&output=csv',
    roles: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlAW55KSksgmHytcuHjtNz_ovRS2_02lzsrIIlpJSHflrlonXEZ8Rs5FDoToE49oKs7zImGOjDh1w9/pub?gid=198592258&single=true&output=csv',
  };

  // 意見を書く Google フォーム。スプレッドシートの omfy → 5（またはリンク情報を表示）で
  // 出る 2 行をここに貼る。url が空のあいだは「この論点に意見を書く」ボタンを出さない。
  const FORM = {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSfOYr0s4RfBfvcTLm4szYQKq6bH-90AHkR0yhGDKkmlgIF8iQ/viewform',
    nodeEntry: 'entry.813697348',
  };
  // フォームの論点の選択肢から外している状態（omfy_setup.gs の CFG.FORM.HIDE_STATUSES と合わせる）
  const FORM_HIDE_STATUSES = ['取り下げ', '統合済'];

  const KINDS = ['目的', 'テーマ', '評価軸', '対象', '外部環境', '問い'];
  const KIND_COLOR = { '目的': 'var(--k-objective)', 'テーマ': 'var(--k-theme)', '評価軸': 'var(--k-criterion)', '対象': 'var(--k-object)', '問い': 'var(--k-issue)', '外部環境': 'var(--k-context)' };
  const STANCES = ['賛成', '条件付き', '中立', '問い', '反対'];
  const STANCE_COLOR = { '賛成': 'var(--st-support)', '条件付き': 'var(--st-cond)', '中立': 'var(--st-neutral)', '問い': 'var(--st-question)', '反対': 'var(--st-oppose)' };
  const CRITERIA_COLS = ['安全性', '安定供給', '経済効率性', '環境適合'];

  const COL = {
    id: 'ID', label: '論点名（20字以内）', kind: '種別', parent: '親論点', question: '問い（〜か）', status: '状態',
    date: '記入日', handle: 'ハンドル', node: '論点', role: '記入者属性', stance: '立場', basis: '根拠タイプ',
    claim: '主張（60字以内）', note: '補足・出典（任意）',
    roleName: '属性（エネルギーに対する立場）', roleDesc: '説明', roleAgg: '集約先（任意）', roleOrder: '並び順',
  };

  const t = (v) => String(v == null ? '' : v).trim();

  // CSV の行（ヘッダー付きオブジェクト）から、木・意見・属性を組み立てる
  function build(nodeRows, opRows, roleRows) {
    const warnings = [];

    const nodes = nodeRows.filter((r) => t(r[COL.id]) && t(r[COL.label])).map((r) => ({
      id: t(r[COL.id]),
      label: t(r[COL.label]),
      kind: t(r[COL.kind]),
      parentLabel: t(r[COL.parent]),
      question: t(r[COL.question]),
      status: t(r[COL.status]),
      flags: Object.fromEntries(CRITERIA_COLS.map((c) => [c, t(r[c]) === '○'])),
      children: [],
      opinions: [],
      parent: null,
    }));

    const byId = {};
    const byLabel = {};
    nodes.forEach((n) => {
      if (byId[n.id]) warnings.push('ID が重複: 「' + n.id + '」');
      if (byLabel[n.label]) warnings.push('論点名が重複: 「' + n.label + '」');
      byId[n.id] = n;
      byLabel[n.label] = n;
    });

    let rootNode = null;
    nodes.forEach((n) => {
      if (!n.parentLabel) {
        if (rootNode) warnings.push('親のない論点が複数あります: 「' + n.label + '」');
        else rootNode = n;
        return;
      }
      const p = byLabel[n.parentLabel];
      if (p) { p.children.push(n); n.parent = p; }
      else warnings.push('親論点「' + n.parentLabel + '」が見つかりません（' + n.label + '）');
    });

    if (rootNode) {
      (function walk(n, d) {
        n.depth = d;
        n.leaves = n.children.length ? n.children.reduce((a, c) => a + walk(c, d + 1), 0) : 1;
        return n.leaves;
      })(rootNode, 0);
    }
    // 根から辿れない論点（親の付け間違いなど）は表示から外し、警告だけ出す
    const reachable = nodes.filter((n) => typeof n.depth === 'number');
    nodes.filter((n) => typeof n.depth !== 'number' && n.parentLabel && byLabel[n.parentLabel])
      .forEach((n) => warnings.push('根から辿れない論点: 「' + n.label + '」'));

    const opinions = opRows.filter((r) => t(r[COL.claim])).map((r) => ({
      date: t(r[COL.date]),
      handle: t(r[COL.handle]),
      nodeLabel: t(r[COL.node]),
      role: t(r[COL.role]),
      stance: t(r[COL.stance]),
      basis: t(r[COL.basis]),
      claim: t(r[COL.claim]),
      note: t(r[COL.note]),
      isExample: t(r[COL.handle]).indexOf('@example_') === 0,
    }));
    opinions.forEach((o) => {
      const n = byLabel[o.nodeLabel];
      if (n) n.opinions.push(o);
      else warnings.push('意見の論点名「' + o.nodeLabel + '」が論点シートに見つかりません（' + (o.handle || 'ハンドル未記入') + '）');
      if (!o.stance) warnings.push('立場が未記入の意見があります（' + (o.handle || 'ハンドル未記入') + '）');
      if (!o.basis) warnings.push('根拠タイプが未記入の意見があります（' + (o.handle || 'ハンドル未記入') + '）');
    });

    const roles = roleRows.filter((r) => t(r[COL.roleName])).map((r) => ({
      name: t(r[COL.roleName]),
      desc: t(r[COL.roleDesc]),
      agg: t(r[COL.roleAgg]),
      order: Number(t(r[COL.roleOrder])) || 999,
    })).sort((a, b) => a.order - b.order);

    return {
      tree: {
        root: rootNode,
        nodes: reachable,
        byId,
        byLabel,
        maxDepth: Math.max(0, ...reachable.map((n) => n.depth)),
      },
      opinions,
      roles,
      warnings,
    };
  }

  async function loadCSV(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' で取得に失敗しました');
    const text = await res.text();
    if (/^\s*<!DOCTYPE html/i.test(text)) throw new Error('CSV ではなく HTML が返りました（ウェブ公開が外れている可能性があります）');
    return root.Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  }

  async function loadAll() {
    const [n, o, r] = await Promise.all([loadCSV(CSV_URLS.nodes), loadCSV(CSV_URLS.opinions), loadCSV(CSV_URLS.roles)]);
    const data = build(n, o, r);
    if (!data.tree.root) throw new Error('論点シートから木の根（親論点が空の論点）が見つかりませんでした。');
    return data;
  }

  function countStances(ops) {
    const c = { total: ops.length };
    STANCES.forEach((s) => { c[s] = 0; });
    ops.forEach((o) => { if (c[o.stance] !== undefined) c[o.stance]++; });
    return c;
  }

  function subtreeOpinions(node) {
    let all = node.opinions.slice();
    node.children.forEach((c) => { all = all.concat(subtreeOpinions(c)); });
    return all;
  }

  function descendantCount(node) {
    return node.children.reduce((a, c) => a + 1 + descendantCount(c), 0);
  }

  function pathOf(node) {
    const out = [];
    for (let p = node; p; p = p.parent) out.unshift(p);
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stanceColor(s) { return STANCE_COLOR[s] || 'var(--muted)'; }
  function kindColor(k) { return KIND_COLOR[k] || 'var(--muted)'; }

  function opinionHtml(o, showRole) {
    const c = stanceColor(o.stance);
    return '<div class="op' + (o.isExample ? ' example' : '') + '">' +
      '<div class="claim">' + escapeHtml(o.claim) + '</div>' +
      (o.note ? '<div class="note">' + escapeHtml(o.note) + '</div>' : '') +
      '<div class="meta2">' +
        '<span class="st" style="background:color-mix(in srgb, ' + c + ' 16%, var(--surface));color:' + c + '">' + escapeHtml(o.stance || '立場未記入') + '</span>' +
        '<span>根拠: ' + escapeHtml(o.basis || '未記入') + '</span>' +
        (showRole ? '<span>' + escapeHtml(o.role || '属性未記入') + '</span>' : '') +
        '<span class="au">' + escapeHtml(o.handle) + '</span>' +
      '</div></div>';
  }

  // 意見を「記入者属性別」または「立場別」にまとめた HTML
  function opinionsHtml(node, group, roles) {
    const ops = node.opinions;
    if (!ops.length) return '<div class="empty">この論点への意見はまだありません。</div>';
    const block = (title, color, list, showRole) =>
      '<div class="grp"><div class="grp-h"><span' + (color ? ' style="color:' + color + '"' : '') + '>' + escapeHtml(title) + '</span>' +
      '<span class="n">' + list.length + ' 件</span></div>' + list.map((o) => opinionHtml(o, showRole)).join('') + '</div>';
    let html = '';
    if (group === 'stance') {
      STANCES.forEach((s) => { const g = ops.filter((o) => o.stance === s); if (g.length) html += block(s, stanceColor(s), g, true); });
      const other = ops.filter((o) => STANCES.indexOf(o.stance) < 0);
      if (other.length) html += block('立場未記入', '', other, true);
    } else {
      roles.forEach((r) => { const g = ops.filter((o) => o.role === r.name); if (g.length) html += block(r.name, '', g, false); });
      const other = ops.filter((o) => !roles.some((r) => r.name === o.role));
      if (other.length) html += block('属性未記入・その他', '', other, false);
    }
    return html;
  }

  // 「この論点に意見を書く」: 論点名を入れた状態でフォームを別タブに開く
  function formUrl(node) {
    if (!FORM.url || !FORM.nodeEntry) return '';
    return FORM.url + '?usp=pp_url&' + FORM.nodeEntry + '=' + encodeURIComponent(node.label);
  }
  function writeLinkHtml(node) {
    const url = formUrl(node);
    if (!url || FORM_HIDE_STATUSES.indexOf(node.status) >= 0) return '';
    return '<div class="write"><a class="btn primary" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">この論点に意見を書く</a>' +
      '<span>Google フォームが開きます。送信後、数分でここに表示されます（ページを開き直すと最新になります）</span></div>';
  }

  function criteriaChipsHtml(node) {
    const on = CRITERIA_COLS.filter((c) => node.flags[c]);
    if (!on.length) return '<span style="font-size:12px;color:var(--muted)">（評価軸へのリンクなし）</span>';
    return on.map((c) => '<span class="chip"><span class="dot" style="background:var(--k-criterion)"></span>' + escapeHtml(c) + '</span>').join('');
  }

  function nowJST() {
    return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
  }

  // URL の #n=<論点ID> を読む・書く（画面間で選択中の論点を引き継ぐため）
  function readHashId() {
    const m = /(?:^#|&)n=([^&]+)/.exec(root.location ? root.location.hash : '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeHashId(id) {
    if (!root.history || !root.location) return;
    const url = root.location.pathname + root.location.search + (id ? '#n=' + encodeURIComponent(id) : '');
    root.history.replaceState(null, '', url);
  }

  const api = {
    CSV_URLS, FORM, KINDS, KIND_COLOR, STANCES, STANCE_COLOR, CRITERIA_COLS,
    build, loadCSV, loadAll,
    countStances, subtreeOpinions, descendantCount, pathOf,
    escapeHtml, stanceColor, kindColor, opinionHtml, opinionsHtml, criteriaChipsHtml, formUrl, writeLinkHtml,
    nowJST, readHashId, writeHashId,
  };
  root.OMFY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
