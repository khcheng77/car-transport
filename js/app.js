/* ============================================================
   app.js — 前端控制器：導覽、渲染、互動
   純前端記憶體版原型（無資料庫、無後端）

   架構：使用者「申請端」與業務單位「審核/調度端」分離，
   三模組各拆成兩個軟體單元 → 共 6 個業務單元。
   ============================================================ */

/* ---------- 工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

function toast(msg, type = '') {
  const wrap = $('#toast-wrap');
  const t = el(`<div class="toast ${type}">${msg}</div>`);
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
}
function openModal(title, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-mask').classList.add('show');
}
function closeModal() { $('#modal-mask').classList.remove('show'); }

/* 通用狀態徽章（mod 用來區分同名狀態 matched 的顯示文字）*/
function stBadge(s, mod) {
  const map = {
    submitted: ['待審核', 'b-gray'],
    approved: ['已核准待排', 'b-navy'],
    unscheduled: ['未排入·請改期', 'b-amber'],
    rejected: ['已駁回', 'b-red'],
    accepted: ['已接受待交貨', 'b-amber'],
    delivered: ['已交貨', 'b-green'],
    loaded: ['已派車待接受', 'b-navy'],
    coordinate: ['待人工協調', 'b-amber'],
    manual: ['手動併車', 'b-navy'],
    void: ['逾期作廢', 'b-red'],
    boarded: ['已上車', 'b-amber'],
    completed: ['行程完成', 'b-green'],
    matched: mod === 'C' ? ['已媒合待上車', 'b-navy'] : ['已排班待接受', 'b-navy'],
  };
  const m = map[s];
  return m ? `<span class="badge ${m[1]}">${m[0]}</span>` : s;
}

/* ---------- 導覽（2 共用 + 6 業務單元）---------- */
const NAV = [
  { group: '總覽', items: [{ id: 'dashboard', ico: '▤', label: '系統儀表板' }] },
  { group: '共用基礎', items: [
    { id: 'engine', ico: '⚙', label: '裝載判定引擎' },
    { id: 'master', ico: '▦', label: '主檔資料' },
  ] },
  { group: '模組 A · 區域內物流', items: [
    { id: 'a_apply', ico: '📝', label: 'A｜收貨申請（使用者）' },
    { id: 'a_review', ico: '🗂', label: 'A｜車次追蹤（業務）' },
  ] },
  { group: '模組 B · 南北幹線', items: [
    { id: 'b_apply', ico: '📝', label: 'B｜幹線託運申請（使用者）' },
    { id: 'b_approve', ico: '✅', label: 'B｜主管准駁（主管）' },
    { id: 'b_review', ico: '🚚', label: 'B｜派車調度（業務）' },
  ] },
  { group: '模組 C · 差旅共乘', items: [
    { id: 'c_apply', ico: '📝', label: 'C｜出差用車申請（使用者）' },
    { id: 'c_approve', ico: '✅', label: 'C｜主管准駁（主管）' },
    { id: 'c_review', ico: '🔀', label: 'C｜媒合調度（業務）' },
  ] },
];
const PAGE_META = {
  dashboard: { title: '系統儀表板', crumb: '車輛派遣系統整合 · 原型 v0.2' },
  engine: { title: '裝載判定引擎', crumb: '共用基礎層 · Phase 1 · G01–G05' },
  master: { title: '主檔資料', crumb: '共用基礎層 · Phase 0' },
  a_apply: { title: '區域內物流 · 收貨申請（使用者）', crumb: '模組 A · 申請端 · 送出即自動媒合 · G10–G19' },
  a_review: { title: '區域內物流 · 車次追蹤（業務單位）', crumb: '模組 A · 調度端 · G18/G20' },
  b_apply: { title: '南北幹線 · 幹線託運申請（使用者）', crumb: '模組 B · 申請端 · G34/G38' },
  b_approve: { title: '南北幹線 · 主管准駁（直屬主管）', crumb: '模組 B · 主管端 · G63' },
  b_review: { title: '南北幹線 · 派車調度（業務單位）', crumb: '模組 B · 調度端 · G30–G44' },
  c_apply: { title: '差旅共乘 · 出差用車申請（使用者）', crumb: '模組 C · 申請端 · G54/G55/G56' },
  c_approve: { title: '差旅共乘 · 主管准駁（直屬主管）', crumb: '模組 C · 主管端 · G63' },
  c_review: { title: '差旅共乘 · 媒合調度（業務單位）', crumb: '模組 C · 調度端 · G50–G63' },
};

function buildNav() {
  const nav = $('#nav');
  NAV.forEach(g => {
    nav.appendChild(el(`<div class="nav-group-label">${g.group}</div>`));
    g.items.forEach(it => {
      const n = el(`<div class="nav-item" data-page="${it.id}"><span class="ico">${it.ico}</span>${it.label}</div>`);
      n.onclick = () => goto(it.id);
      nav.appendChild(n);
    });
  });
}
function goto(pageId) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + pageId));
  const m = PAGE_META[pageId];
  $('#topbar-title').textContent = m.title;
  $('#topbar-crumb').textContent = m.crumb;
  RENDER[pageId] && RENDER[pageId]();
  window.scrollTo(0, 0);
}

/* ============================================================
   儀表板
   ============================================================ */
const RENDER = {};
RENDER.dashboard = function () {
  const p = $('#page-dashboard');
  const aMatched = ModuleA.applications.filter(a => ['matched', 'accepted', 'delivered'].includes(a.status)).length;
  const bLoaded = ModuleB.orders.filter(o => ['loaded', 'accepted', 'delivered'].includes(o.status)).length;
  const cMatched = ModuleC.applications.filter(a => ['matched', 'boarded', 'completed'].includes(a.status)).length;
  const pendReview = ModuleA.applications.filter(a => a.status === 'submitted').length
    + ModuleB.orders.filter(o => o.status === 'submitted').length
    + ModuleC.applications.filter(a => a.status === 'submitted').length;
  p.innerHTML = `
    <div class="section-h">系統儀表板</div>
    <div class="section-sub">車輛派遣系統整合原型 — 純前端可動版。依審批流程（G63）將「使用者申請」「主管准駁」「業務審核/調度」三種角色各自獨立，三模組各拆三個單元，共 9 個業務單元。三模組資源池分開，互不搶用。</div>
    <div class="stat-row">
      <div class="stat"><div class="k">待主管准駁（三模組）</div><div class="v accent">${pendReview}</div></div>
      <div class="stat"><div class="k">物流 · 已排班</div><div class="v">${aMatched}</div></div>
      <div class="stat"><div class="k">幹線 · 已裝載</div><div class="v">${bLoaded}</div></div>
      <div class="stat"><div class="k">共乘 · 已媒合</div><div class="v green">${cMatched}</div></div>
    </div>

    <div class="card-title" style="font-size:14px;margin:8px 0 12px;color:var(--ink-soft);">共用基礎層</div>
    <div class="grid-2">
      ${dashCard('⚙ 裝載判定引擎', 'Level 1 體積 + 地板面積 + Level 2 六方向 + 重量累計。可解釋、不做 3D 碰撞模擬。', 'engine', 'G01–G05')}
      ${dashCard('▦ 主檔資料', '據點/站點/車輛/司機/浪費係數/保修/請假等示範主檔。', 'master', 'Phase 0')}
    </div>

    <div class="card-title" style="font-size:14px;margin:22px 0 12px;color:var(--ink-soft);">業務單元（申請端 ｜ 主管 ｜ 審核/調度端）</div>
    <div class="grid-3">
      ${unitCard('📝 A｜收貨申請', '使用者填收貨單，送出即自動媒合並告知班次時間與車號；查看狀態、接受排班與交貨確認。', 'a_apply', '申請端')}
      ${unitCard('🗂 A｜車次追蹤', '追蹤已自動排定車次與交貨狀態、路線班次、駕駛異常回報。', 'a_review', '審核端')}
      ${unitCard('📝 B｜幹線託運申請', '使用者建立幹線託運單（直達/非直達）、查看狀態。', 'b_apply', '申請端')}
      ${unitCard('✅ B｜主管准駁', '直屬主管准駁幹線託運單，駁回保留紀錄不進派車池。', 'b_approve', '主管')}
      ${unitCard('🚚 B｜派車調度', '貪婪/直達派車決策、回程直達鎖定、決策矩陣、貨況追蹤。', 'b_review', '審核端')}
      ${unitCard('📝 C｜出差用車申請', '使用者填來回/單程用車申請、查看狀態、手動併車找便車。', 'c_apply', '申請端')}
      ${unitCard('✅ C｜主管准駁', '直屬主管准駁出差用車申請，駁回保留紀錄不進排班池。', 'c_approve', '主管')}
      ${unitCard('🔀 C｜媒合調度', '批次媒合、資源檢核、逾期作廢、派車追蹤。', 'c_review', '審核端')}
    </div>

    <div class="callout info" style="margin-top:22px;">
      本原型依 <b>docs/PLAN.md</b> 建置，並依審批流程（G63）將「使用者申請」與「業務單位審核」分離為獨立單元。
      正式版技術棧為 .NET Framework 4.8 / MVC，本原型僅供互動驗證流程與規則，不含資料庫與後端。
    </div>`;
  $$('#page-dashboard [data-go]').forEach(c => c.onclick = () => goto(c.dataset.go));
};
function dashCard(title, desc, go, gtag) {
  return `<div class="card" data-go="${go}" style="cursor:pointer;">
    <div class="card-title">${title} <span class="g-tag">${gtag}</span></div>
    <div class="card-desc" style="margin-bottom:0;">${desc}</div></div>`;
}
function unitCard(title, desc, go, side) {
  const badge = side === '申請端' ? '<span class="badge b-navy">申請端</span>'
    : side === '主管' ? '<span class="badge b-green">主管</span>'
    : '<span class="badge b-amber">審核端</span>';
  return `<div class="card" data-go="${go}" style="cursor:pointer;">
    <div class="card-title" style="justify-content:space-between;">${title} ${badge}</div>
    <div class="card-desc" style="margin-bottom:0;">${desc}</div></div>`;
}

/* ============================================================
   裝載判定引擎 Demo（共用）
   ============================================================ */
let engineItems = [];
RENDER.engine = function () {
  const p = $('#page-engine');
  const vehOpts = DB.vehicles.filter(v => v.pool === 'LOGI')
    .map(v => `<option value="${v.id}">${v.name}（${v.dims.l}×${v.dims.w}×${v.dims.h}cm｜${v.volume.toFixed(0)}L｜${v.weight}kg）</option>`).join('');
  p.innerHTML = `
    <div class="section-h">裝載判定引擎</div>
    <div class="section-sub">輸入貨物與車輛，執行 Level 1 + 地板面積 + Level 2 + 重量累計判定。回傳含失敗原因碼與逐步 trace。</div>
    <div class="grid-2">
      <div class="card">
        <div class="card-title">① 選擇車輛</div>
        <div class="field"><select id="eng-veh">${vehOpts}</select></div>
        <div class="card-title" style="margin-top:14px;">② 既有負載（逐站累計用 G05）</div>
        <div class="row">
          <div class="field"><label>既有體積 (L)</label><input type="number" id="eng-startvol" value="0"></div>
          <div class="field"><label>既有重量 (kg)</label><input type="number" id="eng-startwt" value="0"></div>
        </div>
        <div class="card-title" style="margin-top:14px;">③ 貨物項目</div>
        <div id="eng-items"></div>
        <button class="btn btn-ghost btn-sm" id="eng-add">＋ 新增貨物</button>
        <div class="divider"></div>
        <button class="btn btn-primary" id="eng-run">▶ 執行裝載判定</button>
        <button class="btn btn-ghost" id="eng-demo">載入範例</button>
      </div>
      <div class="card">
        <div class="card-title">判定結果</div>
        <div id="eng-result"><div class="empty"><div class="big">⚙</div>尚未執行判定</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">浪費係數表（WasteFactorProvider · static 單例 + 快取 G03/G04）</div>
      <div class="card-desc">查無類別使用保底值 ${DB.wasteDefault}，不中斷流程。DB 讀取次數（驗證快取命中）：<b id="eng-dbhits">${WasteFactorProvider.dbHitCount()}</b></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>類別碼</th><th>名稱</th><th>浪費係數</th><th>狀態</th></tr></thead><tbody>
        ${DB.wasteFactors.map(f => `<tr><td>${f.code}</td><td>${f.name}</td><td>${f.factor}</td><td><span class="badge b-green">生效</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  if (engineItems.length === 0) engineItems = [{ name: '貨物 1', l: 100, w: 60, h: 50, qty: 1, category: 'BOX', weight: 20 }];
  renderEngineItems();
  $('#eng-add').onclick = () => { engineItems.push({ name: '貨物 ' + (engineItems.length + 1), l: 80, w: 60, h: 40, qty: 1, category: 'BOX', weight: 15 }); renderEngineItems(); };
  $('#eng-run').onclick = runEngine;
  $('#eng-demo').onclick = () => {
    engineItems = [
      { name: '棧板貨A', l: 120, w: 100, h: 150, qty: 2, category: 'PALLET', weight: 300 },
      { name: '長管材', l: 500, w: 20, h: 20, qty: 4, category: 'LONG', weight: 40 },
      { name: '易碎箱', l: 60, w: 60, h: 60, qty: 3, category: 'FRAG', weight: 25 },
    ];
    renderEngineItems(); toast('已載入範例貨物', 'ok');
  };
};
function renderEngineItems() {
  const box = $('#eng-items');
  const catOpts = (sel) => DB.wasteFactors.map(f => `<option value="${f.code}" ${f.code === sel ? 'selected' : ''}>${f.name}</option>`).join('');
  box.innerHTML = engineItems.map((it, i) => `
    <div class="item-row">
      <div><div class="mini-label">品名</div><input type="text" value="${it.name}" data-i="${i}" data-k="name"></div>
      <div><div class="mini-label">長cm</div><input type="number" value="${it.l}" data-i="${i}" data-k="l"></div>
      <div><div class="mini-label">寬cm</div><input type="number" value="${it.w}" data-i="${i}" data-k="w"></div>
      <div><div class="mini-label">高cm</div><input type="number" value="${it.h}" data-i="${i}" data-k="h"></div>
      <div><div class="mini-label">類別</div><select data-i="${i}" data-k="category">${catOpts(it.category)}</select></div>
      <div><div class="mini-label">數量</div><input type="number" value="${it.qty}" data-i="${i}" data-k="qty"></div>
      <button class="x-btn" data-del="${i}">✕</button>
    </div>
    <div class="item-row" style="margin-top:-4px;margin-bottom:12px;grid-template-columns:1fr;">
      <div style="max-width:160px;"><div class="mini-label">單件重量 kg</div><input type="number" value="${it.weight}" data-i="${i}" data-k="weight"></div>
    </div>`).join('');
  $$('#eng-items input, #eng-items select').forEach(inp => {
    inp.oninput = () => {
      const i = +inp.dataset.i, k = inp.dataset.k;
      engineItems[i][k] = (k === 'name' || k === 'category') ? inp.value : +inp.value;
    };
  });
  $$('#eng-items .x-btn').forEach(b => b.onclick = () => { engineItems.splice(+b.dataset.del, 1); renderEngineItems(); });
}
function runEngine() {
  const veh = DB.vehicles.find(v => v.id === $('#eng-veh').value);
  const startLoad = { volume: +$('#eng-startvol').value || 0, weight: +$('#eng-startwt').value || 0 };
  const res = checkLoad(engineItems, veh, startLoad);
  $('#eng-dbhits').textContent = WasteFactorProvider.dbHitCount();
  const cls = res.ok ? 'ok' : 'fail';
  const head = res.ok ? '✓ 可裝載' : '✗ 無法裝載';
  let reasonsHtml = '';
  if (!res.ok) {
    reasonsHtml = `<div style="margin-top:10px;font-weight:600;">失敗原因碼：</div><ul>` +
      res.reasons.map(r => `<li><span class="badge b-red">${r.code}</span> ${r.msg}</li>`).join('') + `</ul>`;
  }
  const m = res.metrics;
  $('#eng-result').innerHTML = `
    <div class="result ${cls}">
      <div class="r-head">${head}</div>
      <div>有效體積 <b>${m.usedVol.toFixed(0)}L</b> / ${m.capVol.toFixed(0)}L｜地板占用 <b>${m.floorUsePct.toFixed(0)}%</b>｜重量 <b>${m.usedWt}kg</b> / ${m.capWt}kg</div>
      ${reasonsHtml}
    </div>
    <div class="trace">${res.trace.join('\n')}</div>`;
}

/* 共用：貨物項目編輯器（給 A 申請端）*/
function renderItemEditor(boxSel, arr, onChange) {
  const box = $(boxSel);
  const catOpts = (sel) => DB.wasteFactors.map(f => `<option value="${f.code}" ${f.code === sel ? 'selected' : ''}>${f.name}</option>`).join('');
  box.innerHTML = arr.map((it, i) => `
    <div class="item-row">
      <div><div class="mini-label">品名</div><input type="text" value="${it.name}" data-i="${i}" data-k="name"></div>
      <div><div class="mini-label">長</div><input type="number" value="${it.l}" data-i="${i}" data-k="l"></div>
      <div><div class="mini-label">寬</div><input type="number" value="${it.w}" data-i="${i}" data-k="w"></div>
      <div><div class="mini-label">高</div><input type="number" value="${it.h}" data-i="${i}" data-k="h"></div>
      <div><div class="mini-label">類別</div><select data-i="${i}" data-k="category">${catOpts(it.category)}</select></div>
      <div><div class="mini-label">數量</div><input type="number" value="${it.qty}" data-i="${i}" data-k="qty"></div>
      <button class="x-btn" data-del="${i}">✕</button>
    </div>`).join('');
  $$(boxSel + ' input, ' + boxSel + ' select').forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.i, k = inp.dataset.k;
    arr[i][k] = (k === 'name' || k === 'category') ? inp.value : +inp.value;
  });
  $$(boxSel + ' .x-btn').forEach(b => b.onclick = () => { arr.splice(+b.dataset.del, 1); onChange(); });
}

/* ============================================================
   模組 A · 申請端（使用者）
   ============================================================ */
let aaItems = [];
// 申請功能的子畫面狀態：list 查詢 / new 新增 / detail 明細
let aApply = { view: 'list', detailId: null, query: { applicant: '', station: '', status: '', mode: '' }, resultIds: null };

function fmtTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

RENDER.a_apply = function () {
  const p = $('#page-a_apply');
  if (aApply.view === 'new') return renderAApplyNew(p);
  if (aApply.view === 'detail') return renderAApplyDetail(p, aApply.detailId);
  return renderAApplyList(p);
};

/* ---------- 查詢畫面：上半查詢條件 + 下半歷史紀錄 grid ---------- */
function renderAApplyList(p) {
  const q = aApply.query;
  const stOpts = ['<option value="">全部站點</option>'].concat(
    DB.stations.map(s => `<option value="${s.id}" ${q.station === s.id ? 'selected' : ''}>${s.order}. ${s.name}</option>`)).join('');
  const statusOpts = [['', '全部狀態'], ['matched', '已排班待接受'], ['unscheduled', '未排入·請改期'],
    ['accepted', '已接受待交貨'], ['delivered', '已交貨']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  const modeOpts = [['', '全部模式'], ['asap', '越快越好'], ['exact', '指定期望時間']]
    .map(([v, t]) => `<option value="${v}" ${q.mode === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">收貨申請（使用者）</div>
    <div class="section-sub">先查詢歷史申請紀錄，點擊任一筆可檢視明細；或按「新增」建立新的收貨申請單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="aq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="aq-new">＋ 新增</button>
        </span>
      </div>
      <div class="grid-2">
        <div class="field"><label>申請人（模糊）</label><input type="text" id="aq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字"></div>
        <div class="field"><label>目的地站點</label><select id="aq-station">${stOpts}</select></div>
        <div class="field"><label>狀態</label><select id="aq-status">${statusOpts}</select></div>
        <div class="field"><label>收貨模式</label><select id="aq-mode">${modeOpts}</select></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史申請紀錄</span>
        <span><span class="muted" id="aq-count"></span>
          <button class="btn btn-ghost btn-sm" id="aq-demo" style="margin-left:10px;">載入範例資料</button></span>
      </div>
      <div id="aq-grid"></div>
    </div>`;
  $('#aq-search').onclick = () => { runAQuery(); };
  $('#aq-new').onclick = () => { aApply.view = 'new'; RENDER.a_apply(); };
  $('#aq-demo').onclick = () => {
    [['S3', 'asap', 15, [{ name: '零件箱', l: 50, w: 40, h: 30, qty: 6, category: 'BOX', weight: 12 }]],
     ['S6', 'exact', 20, [{ name: '棧板', l: 110, w: 90, h: 120, qty: 1, category: 'PALLET', weight: 200 }]],
     ['S3', 'asap', 25, [{ name: '長料', l: 480, w: 25, h: 25, qty: 3, category: 'LONG', weight: 30 }]]
    ].forEach(([s, mode, h, items]) => ModuleA.submit({
      applicant: '業務部-周雅婷', station: s, building: DB.stations.find(x => x.id === s).buildings[0],
      items, recvMode: mode, expectTime: '13:00', handleMin: h }));
    aApply.resultIds = null; renderAGrid(); toast('已載入 3 筆收貨申請（送出即自動媒合）', 'ok');
  };
  renderAGrid();
}
function runAQuery() {
  aApply.query = {
    applicant: $('#aq-applicant').value.trim(),
    station: $('#aq-station').value,
    status: $('#aq-status').value,
    mode: $('#aq-mode').value,
  };
  const q = aApply.query;
  const res = ModuleA.applications.filter(a =>
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.station || a.station === q.station) &&
    (!q.status || a.status === q.status) &&
    (!q.mode || a.recvMode === q.mode));
  aApply.resultIds = res.map(a => a.id);
  renderAGrid();
  toast(`查詢完成，共 ${res.length} 筆`, 'ok');
}
function renderAGrid() {
  if (!$('#aq-grid')) return;
  // resultIds=null 代表尚未查詢，預設顯示全部歷史
  const rows = aApply.resultIds == null
    ? ModuleA.applications
    : aApply.resultIds.map(id => ModuleA.applications.find(a => a.id === id)).filter(Boolean);
  $('#aq-count').textContent = `${rows.length} 筆`;
  $('#aq-grid').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">🔍</div>查無符合條件的申請紀錄</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>目的地</th><th>模式</th><th>班次</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        return `<tr>
          <td><button class="btn btn-ghost btn-sm" data-detail="${a.id}">細節</button></td>
          <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
          <td>${st.name}/${a.building}</td>
          <td>${a.recvMode === 'exact' ? '指定 ' + a.expectTime : '越快越好'}</td>
          <td>${sh ? sh.label : '—'}</td><td>${stBadge(a.status)}</td>
          <td class="muted">${fmtTime(a.createdAt)}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可跳轉至申請單明細。</div>`;
  $$('#aq-grid [data-detail]').forEach(b => b.onclick = () => {
    aApply.detailId = b.dataset.detail; aApply.view = 'detail'; RENDER.a_apply();
  });
}

/* ---------- 明細畫面 ---------- */
function renderAApplyDetail(p, id) {
  const a = ModuleA.applications.find(x => x.id === id);
  if (!a) { aApply.view = 'list'; return RENDER.a_apply(); }
  const st = DB.stations.find(s => s.id === a.station);
  const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
  const veh = sh ? DB.vehicles.find(v => v.id === sh.vehicle) : null;
  const totalVol = a.items.reduce((s, it) => s + (it.l * it.w * it.h / 1000) * (it.qty || 1), 0);
  let action = '';
  if (a.status === 'matched') action = `<button class="btn btn-primary" data-accept="${a.id}">確認接受排班</button>`;
  else if (a.status === 'accepted') action = `<button class="btn btn-accent" data-recv="${a.id}">確認已收到貨</button>`;
  else if (a.status === 'delivered') action = '<span class="badge b-green">✓ 已完成</span>';
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="ad-back">← 返回查詢</button>
      收貨申請明細 · ${a.id}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(a.status)}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${a.id}</div></div>
        <div class="field"><label>申請人</label><div>${a.applicant}</div></div>
        <div class="field"><label>目的地</label><div>${st.name} / ${a.building}</div></div>
        <div class="field"><label>收貨模式</label><div>${a.recvMode === 'exact' ? '指定期望時間 ' + a.expectTime : '越快越好'}</div></div>
        <div class="field"><label>上下貨時間</label><div>${a.handleMin} 分</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(a.createdAt)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">貨物項目（總體積約 ${totalVol.toFixed(0)}L）</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>品名</th><th>長×寬×高(cm)</th><th>類別</th><th>數量</th><th>單件重(kg)</th></tr></thead><tbody>
        ${a.items.map(it => { const cat = DB.wasteFactors.find(f => f.code === it.category);
          return `<tr><td>${it.name}</td><td>${it.l}×${it.w}×${it.h}</td><td>${cat ? cat.name : it.category}</td><td>${it.qty || 1}</td><td>${it.weight || 0}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-title">自動媒合結果</div>
      ${a.status === 'unscheduled'
        ? `<div class="callout warn"><b>未排入 — 請改期</b><br>${a.note || '當日各班次皆無法排入（不留候補、不排隔日 G12）。'}</div>`
        : `<div class="grid-2">
        <div class="field"><label>排定班次</label><div>${sh ? sh.label : '<span class="muted">尚未排班</span>'}</div></div>
        <div class="field"><label>車號</label><div>${veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '—'}</div></div>
        <div class="field"><label>預計到站時間</label><div>${a.arrival ? `<b style="color:var(--navy);">${a.arrival}</b>` : '—'}</div></div>
        <div class="field"><label>異常回報</label><div>${a.incident ? '<span class="badge b-red">' + a.incident + '</span>' : '無'}</div></div>
      </div>`}
      ${action ? `<div class="divider"></div><div><b>接收人操作：</b> ${action}</div>` : ''}
    </div>`;
  $('#ad-back').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  const acc = $(`#page-a_apply [data-accept]`);
  if (acc) acc.onclick = () => { ModuleA.acceptSchedule(a); toast(`${a.id} 已確認接受排班`, 'ok'); RENDER.a_apply(); if ($('#ar-tab-review')) renderAr_review(); };
  const rcv = $(`#page-a_apply [data-recv]`);
  if (rcv) rcv.onclick = () => { ModuleA.confirmDelivery(a, a.applicant); toast(`${a.id} 已確認收到貨`, 'ok'); RENDER.a_apply(); if ($('#ar-tab-review')) renderAr_review(); };
}

/* ---------- 新增畫面 ---------- */
function renderAApplyNew(p) {
  const stOpts = DB.stations.map(s => `<option value="${s.id}">${s.order}. ${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="an-back">← 返回查詢</button>
      新增收貨申請單
    </div>
    <div class="card">
      <div class="card-title">填寫收貨申請單 <span class="g-tag">G13/G19</span></div>
      <div class="field"><label>申請人</label><input type="text" id="aa-applicant" value="業務部-周雅婷"></div>
      <div class="row">
        <div class="field"><label>目的地站點</label><select id="aa-station">${stOpts}</select></div>
        <div class="field"><label>建物</label><select id="aa-building"></select></div>
      </div>
      <div class="field"><label>收貨時間模式 <span class="hint">兩種皆不享班次內插隊優先權 G19</span></label>
        <div class="radio-group">
          <label class="radio-pill sel" id="aa-mode-asap"><input type="radio" name="aa-recv" value="asap" checked>越快越好</label>
          <label class="radio-pill" id="aa-mode-exact"><input type="radio" name="aa-recv" value="exact">指定期望時間</label>
        </div>
      </div>
      <div class="field" id="aa-exact-wrap" style="display:none;"><label>期望到站時間</label><input type="time" id="aa-expect" value="13:00"></div>
      <div class="field"><label>上下貨時間（分鐘，自填 G15）</label><input type="number" id="aa-handle" value="15"></div>
      <div class="divider"></div>
      <div class="card-title">貨物項目</div>
      <div id="aa-items"></div>
      <button class="btn btn-ghost btn-sm" id="aa-add">＋ 新增貨物</button>
      <div class="divider"></div>
      <div class="callout info" style="margin-bottom:10px;">送出後系統<b>立即自動媒合</b>（無需主管核准、無需業務按鈕），並直接告知媒合到的<b>班次時間與車號</b>。</div>
      <button class="btn btn-primary" id="aa-submit">▶ 送出並自動媒合</button>
      <button class="btn btn-ghost" id="aa-cancel">取消</button>
    </div>`;
  const fillBuildings = () => {
    const st = DB.stations.find(s => s.id === $('#aa-station').value);
    $('#aa-building').innerHTML = st.buildings.map(b => `<option>${b}</option>`).join('');
  };
  $('#aa-station').onchange = fillBuildings; fillBuildings();
  $$('#page-a_apply input[name=aa-recv]').forEach(r => r.onchange = () => {
    const exact = $('#page-a_apply input[value=exact]').checked;
    $('#aa-mode-asap').classList.toggle('sel', !exact);
    $('#aa-mode-exact').classList.toggle('sel', exact);
    $('#aa-exact-wrap').style.display = exact ? 'block' : 'none';
  });
  if (aaItems.length === 0) aaItems = [{ name: '文件箱', l: 40, w: 30, h: 30, qty: 5, category: 'BOX', weight: 10 }];
  renderAaItems();
  $('#aa-add').onclick = () => { aaItems.push({ name: '貨物', l: 50, w: 40, h: 30, qty: 1, category: 'BOX', weight: 12 }); renderAaItems(); };
  $('#aa-cancel').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  $('#aa-submit').onclick = () => {
    const mode = $('#page-a_apply input[name=aa-recv]:checked').value;
    // 送出即自動媒合（G10–G12/G16/G19）
    const { app, result } = ModuleA.submit({
      applicant: $('#aa-applicant').value, station: $('#aa-station').value, building: $('#aa-building').value,
      items: aaItems.map(x => ({ ...x })), recvMode: mode, expectTime: $('#aa-expect').value,
      handleMin: +$('#aa-handle').value || 0,
    });
    aaItems = [];
    if (result.ok) {
      const veh = DB.vehicles.find(v => v.id === result.shift.vehicle);
      toast(`${app.id} 已自動媒合：${result.shift.label}／車 ${veh ? veh.id : result.shift.vehicle}／到站約 ${result.arrival}`, 'ok');
    } else {
      toast(`${app.id} 未能排入：${result.msg}`, 'err');
    }
    aApply.resultIds = null;        // 回到查詢畫面顯示全部（含新單）
    aApply.view = 'detail'; aApply.detailId = app.id; // 送出後直接看媒合結果明細
    RENDER.a_apply();
  };
}
function renderAaItems() { renderItemEditor('#aa-items', aaItems, renderAaItems); }
// 相容：審核端動作呼叫此函式刷新申請端 grid（若目前正在查詢畫面）
function renderAaList() { if ($('#aq-grid')) renderAGrid(); }

/* ============================================================
   模組 A · 車次追蹤（業務單位）— 已排定車次 / 路線班次 / 異常回報
   （媒合已於使用者送出時自動完成，本單元不再執行媒合）
   ============================================================ */
RENDER.a_review = function () {
  const p = $('#page-a_review');
  p.innerHTML = `
    <div class="section-h">車次追蹤（業務單位）</div>
    <div class="section-sub">使用者送出收貨申請時系統即自動媒合，本單元不再執行媒合；供業務單位追蹤已排定車次與交貨狀態、維護路線班次、進行駕駛異常回報。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="review">① 已排定車次</div>
      <div class="pill-tab" data-tab="route">② 路線與班次</div>
      <div class="pill-tab" data-tab="incident">③ 駕駛異常回報</div>
    </div>
    <div id="ar-tab-review"></div>
    <div id="ar-tab-route" style="display:none;"></div>
    <div id="ar-tab-incident" style="display:none;"></div>`;
  $$('#page-a_review .pill-tab').forEach(t => t.onclick = () => {
    $$('#page-a_review .pill-tab').forEach(x => x.classList.toggle('active', x === t));
    ['review', 'route', 'incident'].forEach(k => $('#ar-tab-' + k).style.display = k === t.dataset.tab ? 'block' : 'none');
  });
  renderAr_review(); renderA_route(); renderA_incident();
};
function renderAr_review() {
  // 媒合已於使用者送出時自動完成，本頁僅追蹤結果
  const unsched = ModuleA.applications.filter(a => a.status === 'unscheduled');
  const unschedCard = unsched.length === 0 ? '' : `
    <div class="card">
      <div class="card-title">未排入·待使用者改期 <span class="g-tag">G12/G17</span></div>
      <div class="card-desc">自動媒合時當日各班次皆裝不下或時間額度已滿，系統已即時提醒該使用者改期（不留候補、不排隔日 G12）。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>原因</th></tr></thead><tbody>
        ${unsched.map(a => { const st = DB.stations.find(s => s.id === a.station);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}/${a.building}</td><td class="muted">${a.note || '—'}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div>`;
  $('#ar-tab-review').innerHTML = `
    <div class="card">
      <div class="card-title">自動媒合機制 <span class="g-tag">G10–G12/G16/G19</span></div>
      <div class="card-desc">使用者送出收貨申請後，系統即時執行「時間軸最近班次」媒合：裝得下即排入並同步告知班次時間與車號（G10/G11）；裝不下順延下一班（G17）；當日末班仍不行即提醒改期（G12）。同站多單依<b>送出先後</b>累計站內時間額度（G16）。無主管核准、無業務按鈕。</div>
    </div>
    ${unschedCard}
    ${renderAr_scheduled()}`;
  // 已排定車次：調度/駕駛端確認交貨
  $$('#ar-tab-review [data-deliver]').forEach(b => b.onclick = () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.deliver);
    ModuleA.confirmDelivery(a, '調度室'); toast(`${a.id} 已確認交貨`, 'ok');
    renderAr_review(); renderAaList();
  });
}
// 已排定車次一覽（被安排的車次 + 媒合狀況 + 接受/交貨狀態）
function renderAr_scheduled() {
  const rows = ModuleA.applications.filter(a => ['matched', 'accepted', 'delivered'].includes(a.status));
  const body = rows.length === 0 ? `<div class="empty">尚無已排定車次。使用者送出申請並自動媒合成功後即會出現在此。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>目的地</th><th>班次</th><th>車輛</th><th>到站</th>
      <th>接收人接受</th><th>交貨</th><th>操作</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        const veh = sh ? DB.vehicles.find(v => v.id === sh.vehicle) : null;
        const acc = (a.status === 'accepted' || a.status === 'delivered')
          ? '<span class="badge b-green">已接受</span>' : '<span class="badge b-gray">待接受</span>';
        const del = a.status === 'delivered'
          ? `<span class="badge b-green">已交貨</span>` : '<span class="badge b-gray">未交貨</span>';
        let op = '<span class="muted">—</span>';
        if (a.status === 'accepted') op = `<button class="btn btn-accent btn-sm" data-deliver="${a.id}">確認交貨</button>`;
        else if (a.status === 'matched') op = '<span class="muted">待接收人接受</span>';
        else if (a.status === 'delivered') op = `<span class="muted">${a.deliveredBy || ''} 完成</span>`;
        return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}/${a.building}</td>
          <td>${sh ? sh.label : '—'}</td><td>${veh ? veh.name : '—'}</td><td>${a.arrival || '—'}</td>
          <td>${acc}</td><td>${del}</td><td>${op}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  return `<div class="card">
    <div class="card-title">已排定車次一覽（被安排車次 · 媒合狀況 · 接受/交貨追蹤）</div>
    <div class="card-desc">顯示每張已排班申請單的班次、車輛、到站時間，以及接收人接受與交貨狀態。交貨可由接收人於申請端確認收到，或由調度室在此確認送達。</div>
    ${body}</div>`;
}
function renderA_route() {
  $('#ar-tab-route').innerHTML = `
    <div class="card">
      <div class="card-title">固定 10 站路線 <span class="g-tag">G14</span></div>
      <div class="card-desc">固定地理順序、無貨跳過、不重排。同站先卸後裝、多單時間加總。</div>
      <div class="route">${DB.stations.map(s => `<div class="stop"><div class="s-name">${s.order}. ${s.name}</div><div class="s-meta">${s.buildings.join(' / ')}</div></div>`).join('')}</div>
    </div>
    <div class="card">
      <div class="card-title">今日班次 · 車輛對應 <span class="g-tag">G18</span></div>
      <div class="card-desc">「今日哪台車跑哪班次」人工每日排定，系統只記錄對應並代入容量參數。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>班次</th><th>出發</th><th>車輛</th><th>容量</th><th>重量上限</th></tr></thead><tbody>
        ${DB.regionalShifts.map(sh => { const v = DB.vehicles.find(x => x.id === sh.vehicle);
          return `<tr><td>${sh.label}</td><td>${sh.depart}</td><td>${v.name}</td><td>${v.volume.toFixed(0)}L</td><td>${v.weight}kg</td></tr>`; }).join('')}
      </tbody></table></div>
    </div>`;
}
function renderA_incident() {
  const matched = ModuleA.applications.filter(a => ['matched', 'accepted', 'delivered'].includes(a.status));
  $('#ar-tab-incident').innerHTML = `
    <div class="card">
      <div class="card-title">駕駛異常回報 <span class="g-tag">G20</span></div>
      <div class="card-desc">跑完整趟回總部後回報，只標異常站點，記錄到申請單層級，存檔＋立即自動寄信給申請人＋直屬主管（沿用審批對應）。一單一信。</div>
      ${matched.length === 0 ? `<div class="empty">尚無已排班申請單可回報。先於「審核與排班」核准並執行媒合。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>班次</th><th>異常回報</th></tr></thead><tbody>
        ${matched.map(a => { const st = DB.stations.find(s => s.id === a.station);
          const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}</td><td>${sh.label}</td>
            <td><button class="btn btn-ghost btn-sm" data-inc="${a.id}" data-t="late">標記不準時</button>
                <button class="btn btn-ghost btn-sm" data-inc="${a.id}" data-t="noshow">標記沒出現</button></td></tr>`; }).join('')}
      </tbody></table></div>`}
    </div>`;
  $$('#ar-tab-incident [data-inc]').forEach(b => b.onclick = () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.inc);
    const reason = b.dataset.t === 'late' ? '使用者不準時' : '使用者沒出現';
    const mgr = DB.approvalMap[a.applicant] || '（查無對應主管）';
    a.incident = reason;
    openModal('已存檔並自動寄信（示意）',
      `<div class="result ok"><div class="r-head">✓ 異常已記錄到申請單層級</div>
        <div>單號 <b>${a.id}</b>｜站點異常原因：<b>${reason}</b></div></div>
      <div class="callout info" style="margin-top:14px;">
        <b>立即自動寄信（一單一信 G20）</b><br>
        收件人：${a.applicant}（申請人）、${mgr}（直屬主管）<br>
        內容：站點 ${DB.stations.find(s=>s.id===a.station).name}／原因 ${reason}／日期 2026-08-25<br>
        <span class="muted">※ 信件格式為「待後續設計」項，此為簡潔版 TODO。</span></div>`);
    toast(`${a.id} 異常已回報並寄信`, 'ok');
  });
}

/* ============================================================
   模組 B · 申請端（使用者）
   ============================================================ */
let bApply = { view: 'list', detailId: null, query: { applicant: '', leg: '', site: '', status: '', direct: '' }, resultIds: null };

RENDER.b_apply = function () {
  const p = $('#page-b_apply');
  if (bApply.view === 'new') return renderBApplyNew(p);
  if (bApply.view === 'detail') return renderBApplyDetail(p, bApply.detailId);
  return renderBApplyList(p);
};

/* ---------- 查詢畫面 ---------- */
function renderBApplyList(p) {
  const q = bApply.query;
  const siteOpts = ['<option value="">全部據點</option>'].concat(
    DB.sites.map(s => `<option value="${s.id}" ${q.site === s.id ? 'selected' : ''}>${s.name}</option>`)).join('');
  const dirOpts = [['', '全部型態'], ['1', '直達'], ['0', '非直達']]
    .map(([v, t]) => `<option value="${v}" ${q.direct === v ? 'selected' : ''}>${t}</option>`).join('');
  const statusOpts = [['', '全部狀態'], ['submitted', '待審核'], ['approved', '已核准待排'], ['loaded', '已派車待接受'],
    ['accepted', '已接受待交貨'], ['delivered', '已交貨'], ['rejected', '已駁回']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">幹線託運申請（使用者）</div>
    <div class="section-sub">先查詢歷史託運紀錄，點擊任一筆可檢視明細；或按「新增」建立新的幹線託運單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="bq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="bq-new">＋ 新增</button>
        </span>
      </div>
      <div class="grid-2">
        <div class="field"><label>申請人（模糊）</label><input type="text" id="bq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字"></div>
        <div class="field"><label>據點</label><select id="bq-site">${siteOpts}</select></div>
        <div class="field"><label>派送型態</label><select id="bq-direct">${dirOpts}</select></div>
        <div class="field"><label>狀態</label><select id="bq-status">${statusOpts}</select></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史託運紀錄</span>
        <span><span class="muted" id="bq-count"></span>
          <button class="btn btn-ghost btn-sm" id="bq-demo" style="margin-left:10px;">載入去程範例</button>
          <button class="btn btn-ghost btn-sm" id="bq-demo-ret">載入回程範例</button></span>
      </div>
      <div id="bq-grid"></div>
    </div>`;
  $('#bq-search').onclick = () => runBQuery();
  $('#bq-new').onclick = () => { bApply.view = 'new'; RENDER.b_apply(); };
  $('#bq-demo').onclick = () => {
    [['D3', false, 1500, 600, 25, 'BOX'], ['D2', false, 1800, 700, 30, 'PALLET'], ['D6', false, 1200, 500, 20, 'BOX'],
     ['D1', true, 2500, 900, 40, 'DRUM'], ['D5', false, 2200, 800, 30, 'LONG']].forEach(([site, direct, v, w, h, c]) =>
      ModuleB.createOrder({ applicant: '研發部-吳承恩', leg: 'outbound', site, direct, volume: v, weight: w, handleMin: h, category: c }));
    bApply.resultIds = null; renderBGrid(); toast('已載入 5 筆去程範例（含 1 直達）', 'ok');
  };
  $('#bq-demo-ret').onclick = () => {
    [['D2', true, 2000, 700, 30, 'BOX'], ['D3', false, 1200, 500, 20, 'FRAG'], ['D5', false, 900, 400, 15, 'BOX']].forEach(([site, direct, v, w, h, c]) =>
      ModuleB.createOrder({ applicant: '業務部-周雅婷', leg: 'return', site, direct, volume: v, weight: w, handleMin: h, category: c }));
    bApply.resultIds = null; renderBGrid(); toast('已載入 3 筆回程範例（含 1 直達）', 'ok');
  };
  renderBGrid();
}
function runBQuery() {
  bApply.query = {
    applicant: $('#bq-applicant').value.trim(), leg: '',
    site: $('#bq-site').value, direct: $('#bq-direct').value, status: $('#bq-status').value,
  };
  const q = bApply.query;
  const res = ModuleB.orders.filter(o =>
    (!q.applicant || o.applicant.includes(q.applicant)) &&
    (!q.leg || o.leg === q.leg) &&
    (!q.site || o.origin === q.site || o.dest === q.site) &&
    (!q.direct || String(o.direct ? 1 : 0) === q.direct) &&
    (!q.status || o.status === q.status));
  bApply.resultIds = res.map(o => o.id);
  renderBGrid();
  toast(`查詢完成，共 ${res.length} 筆`, 'ok');
}
function renderBGrid() {
  if (!$('#bq-grid')) return;
  const rows = bApply.resultIds == null ? ModuleB.orders
    : bApply.resultIds.map(id => ModuleB.orders.find(o => o.id === id)).filter(Boolean);
  $('#bq-count').textContent = `${rows.length} 筆`;
  $('#bq-grid').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">🔍</div>查無符合條件的託運紀錄</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>收貨據點</th><th>型態</th><th>貨量</th><th>車號</th><th>來收時間</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(o => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-detail="${o.id}">細節</button></td>
        <td><b style="color:var(--navy);">${o.id}</b></td><td>${o.applicant}</td>
        <td>${ModuleB.siteById(o.leg === 'return' ? o.pickupSite : o.dest).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td>
        <td>${o.dispatchVehicle ? '<b>' + o.dispatchVehicle + '</b>' : '<span class="muted">—</span>'}</td>
        <td>${o.pickupTime ? '<b style="color:var(--navy);">' + o.pickupTime + '</b>' : '<span class="muted">待派車</span>'}</td>
        <td>${stBadge(o.status)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可跳轉至託運單明細。幹線車沿南北路線逐據點收貨，<b>來收時間依收貨據點遠近而不同</b>（越南邊越晚），非全部由同一地點出發。</div>`;
  $$('#bq-grid [data-detail]').forEach(b => b.onclick = () => {
    bApply.detailId = b.dataset.detail; bApply.view = 'detail'; RENDER.b_apply();
  });
}

/* ---------- 明細畫面 ---------- */
function renderBApplyDetail(p, id) {
  const o = ModuleB.orders.find(x => x.id === id);
  if (!o) { bApply.view = 'list'; return RENDER.b_apply(); }
  const veh = o.dispatchVehicle ? DB.vehicles.find(v => v.id === o.dispatchVehicle) : null;
  let action = '';
  if (o.status === 'loaded') action = `<button class="btn btn-primary" data-baccept="${o.id}">確認接受</button>`;
  else if (o.status === 'accepted') action = `<button class="btn btn-accent" data-brecv="${o.id}">確認已收到貨</button>`;
  else if (o.status === 'delivered') action = '<span class="badge b-green">✓ 已完成</span>';
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="bd-back">← 返回查詢</button>
      幹線託運單明細 · ${o.id}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(o.status)}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${o.id}</div></div>
        <div class="field"><label>申請人</label><div>${o.applicant}</div></div>
        <div class="field"><label>收貨據點</label><div>${ModuleB.siteById(o.leg === 'return' ? o.pickupSite : o.dest).name}<span class="hint" style="margin-left:6px;">幹線車到此收貨</span></div></div>
        <div class="field"><label>派送型態</label><div>${o.direct ? '直達（單一目的地 G38）' : '非直達（沿線收送）'}</div></div>
        <div class="field"><label>貨量 / 重量</label><div>${o.volume}L / ${o.weight}kg</div></div>
        <div class="field"><label>貨物類別（浪費係數 G03）</label><div>${(DB.wasteFactors.find(f => f.code === o.category) || {}).name || o.category}　係數 ${WasteFactorProvider.get(o.category)}</div></div>
        <div class="field"><label>有效體積（容量計算用）</label><div><b>${ModuleB.effVolume(o).toFixed(0)}L</b></div></div>
        <div class="field"><label>裝卸時間</label><div>${o.handleMin} 分</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(o.createdAt)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">派車資訊</div>
      <div class="grid-2">
        <div class="field"><label>指派車號</label><div>${veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '<span class="muted">尚未派車</span>'}</div></div>
        <div class="field"><label>預計來收時間</label><div>${o.pickupTime ? `<b style="color:var(--navy);">${o.pickupTime}</b>　<span class="hint">幹線車抵達「${ModuleB.siteById(o.leg === 'return' ? o.pickupSite : o.dest).name}」收貨的時間</span>` : '<span class="muted">待派車</span>'}</div></div>
      </div>
      ${action ? `<div class="divider"></div><div><b>接收人操作：</b> ${action}</div>` : ''}
    </div>`;
  $('#bd-back').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  const acc = $('#page-b_apply [data-baccept]');
  if (acc) acc.onclick = () => { ModuleB.acceptDelivery(o); toast(`${o.id} 已確認接受`, 'ok'); RENDER.b_apply(); if ($('#br-tracking')) renderBr_tracking(); };
  const rcv = $('#page-b_apply [data-brecv]');
  if (rcv) rcv.onclick = () => { ModuleB.confirmDelivery(o, o.applicant); toast(`${o.id} 已確認收到貨`, 'ok'); RENDER.b_apply(); if ($('#br-tracking')) renderBr_tracking(); };
}

/* ---------- 新增畫面 ---------- */
function renderBApplyNew(p) {
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="bn-back">← 返回查詢</button>
      新增幹線託運單
    </div>
    <div class="card">
      <div class="card-title">建立幹線託運單 <span class="g-tag">G38/G40</span></div>
      <div class="field"><label>申請人</label><input type="text" id="ba-applicant" value="研發部-吳承恩"></div>
      <div class="field"><label>行程方向</label>
        <div class="radio-group">
          <label class="radio-pill sel" id="ba-out"><input type="radio" name="ba-leg" value="outbound" checked>去程（南下）</label>
          <label class="radio-pill" id="ba-ret"><input type="radio" name="ba-leg" value="return">回程（北上回 D10）</label>
        </div>
      </div>
      <div class="field"><label id="ba-site-label">收貨據點</label><span class="hint">幹線車沿南北路線到此據點收貨</span><select id="ba-site">${siteOpts}</select></div>
      <div class="field"><label>派送型態 <span class="hint">直達不湊單、單一目的地 G38</span></label>
        <div class="radio-group">
          <label class="radio-pill sel" id="ba-nd"><input type="radio" name="ba-direct" value="0" checked>非直達（沿線收送）</label>
          <label class="radio-pill" id="ba-d"><input type="radio" name="ba-direct" value="1">直達</label>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>貨量 (L)</label><input type="number" id="ba-vol" value="2000"></div>
        <div class="field"><label>重量 (kg)</label><input type="number" id="ba-wt" value="800"></div>
        <div class="field"><label>裝卸(分)</label><input type="number" id="ba-handle" value="30"></div>
      </div>
      <div class="field" style="max-width:280px;"><label>貨物類別 <span class="hint">供浪費係數查表 G03</span></label>
        <select id="ba-cat">${DB.wasteFactors.map(f => `<option value="${f.code}">${f.name}（係數 ${f.factor}）</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="ba-submit">▶ 送出申請（待業務審核）</button>
      <button class="btn btn-ghost" id="ba-cancel">取消</button>
    </div>`;
  const setDirect = () => {
    $('#ba-nd').classList.toggle('sel', $('#page-b_apply input[value="0"]').checked);
    $('#ba-d').classList.toggle('sel', $('#page-b_apply input[value="1"]').checked);
  };
  $$('#page-b_apply input[name=ba-direct]').forEach(r => r.onchange = setDirect);
  const setLeg = () => {
    const ret = $('#page-b_apply input[value=return]').checked;
    $('#ba-out').classList.toggle('sel', !ret);
    $('#ba-ret').classList.toggle('sel', ret);
    $('#ba-site-label').textContent = ret ? '收貨（上車）據點' : '收貨據點';
  };
  $$('#page-b_apply input[name=ba-leg]').forEach(r => r.onchange = setLeg);
  $('#ba-cancel').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  $('#ba-submit').onclick = () => {
    const o = ModuleB.createOrder({
      applicant: $('#ba-applicant').value,
      leg: $('#page-b_apply input[name=ba-leg]:checked').value,
      site: $('#ba-site').value,
      direct: $('#page-b_apply input[value="1"]').checked,
      volume: +$('#ba-vol').value, weight: +$('#ba-wt').value, handleMin: +$('#ba-handle').value,
      category: $('#ba-cat').value,
    });
    toast(`${o.id} 已送出，等待業務審核`, 'ok');
    bApply.resultIds = null; bApply.view = 'detail'; bApply.detailId = o.id;
    RENDER.b_apply();
  };
}
// 相容：審核端動作呼叫此函式刷新申請端 grid
function renderBaList() { if ($('#bq-grid')) renderBGrid(); }

/* ============================================================
   模組 B · 主管准駁（直屬主管）— 獨立單元
   ============================================================ */
RENDER.b_approve = function () {
  const p = $('#page-b_approve');
  const submitted = ModuleB.orders.filter(o => o.status === 'submitted');
  const decided = ModuleB.orders.filter(o => ['approved', 'rejected'].includes(o.status));
  p.innerHTML = `
    <div class="section-h">主管准駁（直屬主管）</div>
    <div class="section-sub">員工建立幹線託運單後由直屬主管准駁。駁回保留紀錄但不進派車池；核准後才進入業務單位派車調度。（G63）</div>
    <div class="card">
      <div class="card-title">待准駁託運單 <span class="g-tag">G63</span></div>
      ${submitted.length === 0 ? `<div class="empty">目前無待准駁託運單。</div>` : `
      <div style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="bap-approve-all">✓ 全部核准</button></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>方向</th><th>路線</th><th>型態</th><th>貨量</th><th>操作</th></tr></thead><tbody>
        ${submitted.map(o => `<tr><td>${o.id}</td><td>${o.applicant}</td>
          <td>${o.leg === 'return' ? '回程' : '去程'}</td>
          <td>${ModuleB.siteById(o.origin).name} → ${ModuleB.siteById(o.dest).name}</td>
          <td>${o.direct ? '直達' : '非直達'}</td><td>${o.volume}L</td>
          <td><button class="btn btn-primary btn-sm" data-ap="${o.id}">核准</button>
              <button class="btn btn-ghost btn-sm" data-rj="${o.id}">駁回</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
    <div class="card">
      <div class="card-title">已處理紀錄</div>
      ${decided.length === 0 ? `<div class="muted">尚無已准駁紀錄。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>路線</th><th>准駁結果</th></tr></thead><tbody>
        ${decided.map(o => `<tr><td>${o.id}</td><td>${o.applicant}</td>
          <td>${ModuleB.siteById(o.origin).name} → ${ModuleB.siteById(o.dest).name}</td><td>${stBadge(o.status)}</td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  const all = $('#bap-approve-all');
  if (all) all.onclick = () => { submitted.forEach(o => ModuleB.approve(o)); toast(`已核准 ${submitted.length} 筆`, 'ok'); RENDER.b_approve(); renderBaList(); if ($('#br-approved')) renderBr_approved(); };
  $$('#page-b_approve [data-ap]').forEach(b => b.onclick = () => { ModuleB.approve(ModuleB.orders.find(o => o.id === b.dataset.ap)); toast(`${b.dataset.ap} 已核准`, 'ok'); RENDER.b_approve(); renderBaList(); if ($('#br-approved')) renderBr_approved(); });
  $$('#page-b_approve [data-rj]').forEach(b => b.onclick = () => { ModuleB.reject(ModuleB.orders.find(o => o.id === b.dataset.rj)); toast(`${b.dataset.rj} 已駁回`, 'err'); RENDER.b_approve(); renderBaList(); });
};

/* ============================================================
   模組 B · 派車調度（業務單位）— 派車決策 / 決策矩陣 / 貨況追蹤
   ============================================================ */
RENDER.b_review = function () {
  const p = $('#page-b_review');
  p.innerHTML = `
    <div class="section-h">派車調度（業務單位）</div>
    <div class="section-sub">對已核准託運單依核准時間排序派車：貪婪終點判斷 / 直達獨立派車 / 回程全域直達鎖定，並顯示派遣模式與觸發原因。主管准駁為獨立單元。</div>
    <div class="card">
      <div class="card-title">派車決策（調度室）<span class="g-tag">G32/G40/G44</span></div>
      <div class="card-desc">僅對已核准託運單派車，依核准時間排序逐張檢查。系統顯示每台車派遣模式與觸發原因。</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px;font-weight:600;">去程</div>
      <button class="btn btn-accent" id="br-dispatch-direct">派直達車</button>
      <button class="btn btn-primary" id="br-dispatch-greedy">派非直達車（貪婪）</button>
      <div style="font-size:12px;color:var(--ink-soft);margin:12px 0 6px;font-weight:600;">回程（全域直達鎖定 G40）</div>
      <button class="btn btn-primary" id="br-dispatch-return">派回程車（非直達）</button>
      <button class="btn btn-ghost" id="br-dispatch-return-direct">派回程車（原為直達車）</button>
      <div id="br-approved" style="margin-top:14px;"></div>
      <div id="br-dispatch-result"></div>
    </div>
    <div id="br-matrix">${renderB_matrix()}</div>
    <div class="card">
      <div class="card-title">已派車貨況一覽（被安排車次 · 派遣模式 · 接受/交貨追蹤）</div>
      <div class="card-desc">顯示每張已派車託運單的車輛、派遣模式、終點，以及接收人接受與交貨狀態。交貨可由接收人於申請端確認收到，或由調度室在此確認送達。</div>
      <div id="br-tracking"></div>
    </div>`;
  $('#br-dispatch-direct').onclick = () => dispatchB('direct');
  $('#br-dispatch-greedy').onclick = () => dispatchB('greedy');
  $('#br-dispatch-return').onclick = () => dispatchBReturn(false);
  $('#br-dispatch-return-direct').onclick = () => dispatchBReturn(true);
  renderBr_approved(); renderBr_tracking();
};
// 3.7 四／五模式決策矩陣（G44 顯示，供調度員覆核）
function renderB_matrix(activeRow) {
  const rows = [
    ['1', '去程・非直達', '動態淨值（2.4）', '貪婪法自動判斷（2.3）', '逐站收送非直達貨'],
    ['2', '去程・直達', '純容量加總（3.3）', '申請單目的地', '不停靠'],
    ['3', '回程・非直達且無撞期', '動態淨值', '出發據點（2.7）', '逐站收送非直達貨'],
    ['4', '回程・被迫鎖定直達', '動態淨值（延續，3.6）', '出發據點（3.6）', '不收新非直達貨，仍依序經過'],
    ['5', '回程・原本就是直達車', '純容量加總', '出發據點', '不停靠'],
  ];
  return `<div class="card">
    <div class="card-title">派遣模式決策矩陣（3.7 · G44）</div>
    <div class="card-desc">五種情境的容量計算、終點與中途停靠規則，供調度員一眼覆核。派車後會標示本趟落在哪一列。</div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>#</th><th>情境</th><th>容量計算</th><th>終點</th><th>中途停靠</th></tr></thead><tbody>
      ${rows.map(r => `<tr${activeRow && +r[0] === activeRow ? ' style="outline:2px solid var(--accent);outline-offset:-2px;"' : ''}>
        <td>${r[0]}</td><td>${activeRow && +r[0] === activeRow ? '<b>' + r[1] + '</b> <span class="badge b-amber">本趟</span>' : r[1]}</td>
        <td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
function renderBr_tracking() {
  if (!$('#br-tracking')) return;
  const rows = ModuleB.orders.filter(o => ['loaded', 'accepted', 'delivered'].includes(o.status));
  $('#br-tracking').innerHTML = rows.length === 0 ? `<div class="empty">尚無已派車託運單。核准後派車即會出現在此。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>路線</th><th>派遣模式</th><th>車輛</th><th>貨量</th>
      <th>接收人接受</th><th>交貨</th><th>操作</th></tr></thead><tbody>
      ${rows.map(o => {
        const veh = o.dispatchVehicle ? DB.vehicles.find(v => v.id === o.dispatchVehicle) : null;
        const acc = (o.status === 'accepted' || o.status === 'delivered')
          ? '<span class="badge b-green">已接受</span>' : '<span class="badge b-gray">待接受</span>';
        const del = o.status === 'delivered' ? '<span class="badge b-green">已交貨</span>' : '<span class="badge b-gray">未交貨</span>';
        let op = '<span class="muted">—</span>';
        if (o.status === 'accepted') op = `<button class="btn btn-accent btn-sm" data-bdeliver="${o.id}">確認交貨</button>`;
        else if (o.status === 'loaded') op = '<span class="muted">待接收人接受</span>';
        else if (o.status === 'delivered') op = `<span class="muted">${o.deliveredBy || ''} 完成</span>`;
        const modeBadge = o.dispatchMode === '直達' ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>';
        const route = `${ModuleB.siteById(o.origin).name} → ${ModuleB.siteById(o.dest).name}`;
        return `<tr><td>${o.id}</td><td>${o.applicant}</td><td>${route}</td>
          <td>${modeBadge}</td><td>${veh ? veh.name : '—'}</td><td>${o.volume}L</td>
          <td>${acc}</td><td>${del}</td><td>${op}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $$('#br-tracking [data-bdeliver]').forEach(b => b.onclick = () => {
    const o = ModuleB.orders.find(x => x.id === b.dataset.bdeliver);
    ModuleB.confirmDelivery(o, '調度室'); toast(`${o.id} 已確認交貨`, 'ok');
    renderBr_tracking(); renderBaList();
  });
};
function renderBr_approved() {
  if (!$('#br-approved')) return;
  const rows = ModuleB.orders.filter(o => o.status === 'approved');
  $('#br-approved').innerHTML = rows.length === 0 ? `<div class="muted">尚無已核准待派車託運單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>方向</th><th>路線</th><th>型態</th><th>貨量</th><th>裝卸</th></tr></thead><tbody>
      ${rows.map(o => `<tr><td>${o.id}</td>
        <td>${o.leg === 'return' ? '<span class="badge b-gray">回程</span>' : '<span class="badge b-navy">去程</span>'}</td>
        <td>${ModuleB.siteById(o.origin).name} → ${ModuleB.siteById(o.dest).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${o.handleMin}分</td></tr>`).join('')}
    </tbody></table></div>`;
}
function updateBMatrix(row) { const m = $('#br-matrix'); if (m) m.innerHTML = renderB_matrix(row); }
// 共用派車結果渲染（去程/回程通用）
function renderBDispatchResult(r, startLabel) {
  const endpoint = r.endpoint ? ModuleB.siteById(r.endpoint).name : '—';
  const amber = r.locked || r.mode === 'direct' || r.matrixRow === 2 || r.matrixRow === 5;
  const modeBadge = `<span class="badge ${amber ? 'b-amber' : 'b-navy'}">${r.modeLabel}</span>`;
  let routeViz = '';
  if (r.stops && r.stops.length) {
    const back = r.mode && r.mode.startsWith('return');
    const startStop = `<div class="stop hit"><div class="s-name">${startLabel}</div><div class="s-meta">${back ? '折返起點' : '出發'}</div></div>`;
    const stopHtml = r.stops.map(s => `<div class="stop ${s.site.id === r.endpoint ? 'end' : (s.count ? 'hit' : 'skip')}">
        <div class="s-name">${s.site.name}</div><div class="s-meta">${s.count ? '收 ' + s.count + ' 單' : '無貨'}｜${s.cumVol}L</div></div>`).join('');
    const endStop = back ? `<div class="stop end"><div class="s-name">${ModuleB.siteById('D10').name}</div><div class="s-meta">回到出發據點</div></div>` : '';
    routeViz = `<div class="route" style="margin-top:12px;">${back ? '' : startStop}${stopHtml}${back ? endStop : ''}</div>`;
  }
  const deferredHtml = (r.deferred && r.deferred.length)
    ? `<div style="margin-top:6px;">被排擠順延（G42）：${r.deferred.map(o => o.id).join(', ')}</div>` : '';
  $('#br-dispatch-result').innerHTML = `
    <div class="result ${r.carried && r.carried.length ? 'ok' : 'warn'}" style="margin-top:16px;">
      <div class="r-head">派車模式：${modeBadge}　終點：${endpoint}${r.days && r.days !== '—' ? `　出勤天數：${r.days} 天 <span class="g-tag">G37</span>` : ''}</div>
      <div>觸發原因：${r.reason || '—'}｜容量使用 <b>${r.capUsed || 0}L</b> / ${r.capTotal || 0}L${r.timeUsed != null ? `｜時間 <b>${r.timeUsed}分</b> / ${r.timeTotal}分` : ''}</div>
      ${r.carried ? `<div style="margin-top:6px;">載運：${r.carried.map(o => o.id).join(', ') || '（無）'}</div>` : ''}
      ${deferredHtml}
      ${routeViz}
    </div>
    <div class="trace">${r.trace.join('\n')}</div>`;
  updateBMatrix(r.matrixRow);
}
function dispatchB(mode) {
  const veh = mode === 'direct' ? 'V-T02' : 'V-T01';
  const r = ModuleB.dispatch(veh, mode);
  renderBDispatchResult(r, '台北據點');
  toast(`${r.modeLabel || ''} 派車完成`, 'ok');
  renderBr_approved(); renderBaList(); renderBr_tracking();
}
function dispatchBReturn(originallyDirect) {
  const rets = ModuleB.orders.filter(o => o.status === 'approved' && o.leg === 'return');
  if (!originallyDirect && rets.length === 0) { toast('無已核准回程託運單，請先核准回程單', 'err'); return; }
  // 折返起點＝最南端的已核准回程收貨據點（涵蓋所有回程收貨），無則預設 D1
  let turnaround = 'D1';
  if (rets.length) turnaround = rets.reduce((min, o) =>
    ModuleB.siteById(o.pickupSite).order < ModuleB.siteById(min).order ? o.pickupSite : min, rets[0].pickupSite);
  const r = ModuleB.dispatchReturn('V-T02', turnaround, originallyDirect, 0);
  renderBDispatchResult(r, ModuleB.siteById(turnaround).name);
  toast(`${r.modeLabel} 派車完成`, 'ok');
  renderBr_approved(); renderBaList(); renderBr_tracking();
}

/* ============================================================
   模組 C · 申請端（使用者）
   ============================================================ */
let cApply = { view: 'list', detailId: null, query: { applicant: '', type: '', origin: '', dest: '', status: '' }, resultIds: null };

RENDER.c_apply = function () {
  const p = $('#page-c_apply');
  if (cApply.view === 'new') return renderCApplyNew(p);
  if (cApply.view === 'detail') return renderCApplyDetail(p, cApply.detailId);
  return renderCApplyList(p);
};

/* ---------- 查詢畫面 ---------- */
function renderCApplyList(p) {
  const q = cApply.query;
  const oOpts = ['<option value="">全部出發地</option>'].concat(
    DB.bizOrigins.map(o => `<option ${q.origin === o ? 'selected' : ''}>${o}</option>`)).join('');
  const dOpts = ['<option value="">全部目的地</option>'].concat(
    DB.bizDests.map(d => `<option ${q.dest === d ? 'selected' : ''}>${d}</option>`)).join('');
  const typeOpts = [['', '全部型態'], ['round', '來回單'], ['oneway', '單程單']]
    .map(([v, t]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${t}</option>`).join('');
  const statusOpts = [['', '全部狀態'], ['submitted', '待審核'], ['approved', '已核准'], ['matched', '已媒合待上車'],
    ['boarded', '已上車'], ['completed', '行程完成'], ['coordinate', '待人工協調'], ['void', '逾期作廢'], ['rejected', '已駁回']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">出差用車申請（使用者）</div>
    <div class="section-sub">先查詢歷史用車申請，點擊任一筆可檢視明細；或按「新增」建立新的出差用車申請單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="cq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="cq-new">＋ 新增</button>
        </span>
      </div>
      <div class="grid-2">
        <div class="field"><label>申請人（模糊）</label><input type="text" id="cq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字"></div>
        <div class="field"><label>任務型態</label><select id="cq-type">${typeOpts}</select></div>
        <div class="field"><label>出發地</label><select id="cq-origin">${oOpts}</select></div>
        <div class="field"><label>目的地</label><select id="cq-dest">${dOpts}</select></div>
        <div class="field"><label>狀態</label><select id="cq-status">${statusOpts}</select></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史用車申請</span>
        <span><span class="muted" id="cq-count"></span>
          <button class="btn btn-ghost btn-sm" id="cq-demo" style="margin-left:10px;">載入範例批次</button></span>
      </div>
      <div id="cq-grid"></div>
    </div>`;
  $('#cq-search').onclick = () => runCQuery();
  $('#cq-new').onclick = () => { cApply.view = 'new'; RENDER.c_apply(); };
  $('#cq-demo').onclick = () => { loadCDemo(); cApply.resultIds = null; renderCGrid(); };
  renderCGrid();
}
function runCQuery() {
  cApply.query = {
    applicant: $('#cq-applicant').value.trim(), type: $('#cq-type').value,
    origin: $('#cq-origin').value, dest: $('#cq-dest').value, status: $('#cq-status').value,
  };
  const q = cApply.query;
  const res = ModuleC.applications.filter(a =>
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.type || a.type === q.type) &&
    (!q.origin || a.origin === q.origin) &&
    (!q.dest || a.dest === q.dest) &&
    (!q.status || a.status === q.status));
  cApply.resultIds = res.map(a => a.id);
  renderCGrid();
  toast(`查詢完成，共 ${res.length} 筆`, 'ok');
}
function renderCGrid() {
  if (!$('#cq-grid')) return;
  const rows = cApply.resultIds == null ? ModuleC.applications
    : cApply.resultIds.map(id => ModuleC.applications.find(a => a.id === id)).filter(Boolean);
  $('#cq-count').textContent = `${rows.length} 筆`;
  $('#cq-grid').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">🔍</div>查無符合條件的申請紀錄</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>去程</th><th>回程</th><th>人</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-detail="${a.id}">細節</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
        <td>${a.type === 'round' ? '來回' : '單程'}</td><td>${a.origin} → ${a.dest}</td>
        <td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.type === 'round' ? a.returnDate.slice(5) + ' ' + a.earliestReturn : '<span class="muted">—</span>'}</td>
        <td>${a.pax}</td>
        <td>${stBadge(a.status, 'C')}</td><td class="muted">${fmtTime(a.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可跳轉至申請單明細。</div>`;
  $$('#cq-grid [data-detail]').forEach(b => b.onclick = () => {
    cApply.detailId = b.dataset.detail; cApply.view = 'detail'; RENDER.c_apply();
  });
}

/* ---------- 明細畫面 ---------- */
function renderCApplyDetail(p, id) {
  const a = ModuleC.applications.find(x => x.id === id);
  if (!a) { cApply.view = 'list'; return RENDER.c_apply(); }
  const veh = a.vehicle ? DB.vehicles.find(v => v.id === a.vehicle) : null;
  const drv = a.driver ? DB.drivers.find(d => d.id === a.driver) : null;
  let action = '';
  if (a.status === 'matched') action = `<button class="btn btn-primary" data-board="${a.id}">確認上車</button>`;
  else if (a.status === 'boarded') action = `<button class="btn btn-accent" data-done="${a.id}">確認行程完成</button>`;
  else if (a.status === 'completed') action = '<span class="badge b-green">✓ 已完成</span>';
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="cd-back">← 返回查詢</button>
      出差用車申請明細 · ${a.id}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(a.status, 'C')}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${a.id}</div></div>
        <div class="field"><label>申請人</label><div>${a.applicant}（${a.dept}/${a.ext}）</div></div>
        <div class="field"><label>任務型態</label><div>${a.type === 'round' ? '來回單' : '單程單（交通轉運點）'}</div></div>
        <div class="field"><label>路線</label><div>${a.origin} → ${a.dest}</div></div>
        <div class="field"><label>去程（出發日期 / 上車時間）</label><div>${a.departDate} ${a.earliestPickup}</div></div>
        ${a.type === 'round'
          ? `<div class="field"><label>回程（回程日期 / 上車時間）</label><div>${a.returnDate} ${a.earliestReturn || '—'}</div></div>`
          : `<div class="field"><label>回程</label><div class="muted">單程單不適用</div></div>`}
        <div class="field"><label>最晚抵達（參考 G55）</label><div class="muted">${ModuleC.latestArrival(a)}</div></div>
        <div class="field"><label>人數</label><div>${a.pax}</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(a.createdAt)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">媒合與行程狀態</div>
      <div class="grid-2">
        <div class="field"><label>指派車輛</label><div>${veh ? veh.name : '<span class="muted">尚未媒合</span>'}</div></div>
        <div class="field"><label>司機</label><div>${drv ? drv.name : '—'}</div></div>
        <div class="field"><label>併車群組</label><div>${a.groupId || '—'}</div></div>
        <div class="field"><label>備註</label><div>${a.note || '—'}</div></div>
      </div>
      ${action ? `<div class="divider"></div><div><b>乘客操作：</b> ${action}</div>` : ''}
    </div>
    ${['approved', 'coordinate', 'manual'].includes(a.status) ? `
    <div class="card">
      <div class="card-title">手動併車（找便車）<span class="g-tag">G56</span></div>
      <div class="card-desc">自動媒合未成時，您可自行向「已確定有車」的單搭便車。候選＝出發日期前後 1 天、已派車的單（不篩目的地、不比時間）。聯繫對方後按「完成合併」即成立，免調度室確認。</div>
      <button class="btn btn-primary btn-sm" id="cd-find">🔍 列出候選便車</button>
      <div id="cd-candidates"></div>
    </div>` : ''}`;
  $('#cd-back').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  const brd = $('#page-c_apply [data-board]');
  if (brd) brd.onclick = () => { ModuleC.confirmBoard(a); toast(`${a.id} 已確認上車`, 'ok'); RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track(); };
  const dn = $('#page-c_apply [data-done]');
  if (dn) dn.onclick = () => { ModuleC.completeTrip(a, a.applicant); toast(`${a.id} 行程完成`, 'ok'); RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track(); };
  const find = $('#cd-find');
  if (find) find.onclick = () => {
    const cands = ModuleC.manualCandidates(a);
    if (cands.length === 0) { $('#cd-candidates').innerHTML = `<div class="callout" style="margin-top:12px;">出發日期前後 1 天內查無已派車的候選單。</div>`; return; }
    $('#cd-candidates').innerHTML = `
      <div class="callout info" style="margin-top:12px;">為 <b>${a.id}</b>（${a.origin}→${a.dest}）尋找便車，需要 ${a.pax} 個空位。不顯示私人手機。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>候選單</th><th>目的地</th><th>出發/最晚抵達</th><th>申請人 部門/分機</th><th>已載/剩餘</th><th></th></tr></thead><tbody>
        ${cands.map(c => `<tr><td>${c.app.id}</td><td>${c.dest}</td><td>${c.depart} / ${c.latest}</td>
          <td>${c.applicant}（${c.dept}/${c.ext}）</td><td>${c.loaded} / 剩 ${c.remain}</td>
          <td><button class="btn btn-primary btn-sm" data-merge="${c.app.id}" ${c.remain < a.pax ? 'disabled' : ''}>完成合併</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('#cd-candidates [data-merge]').forEach(b => b.onclick = () => {
      const target = ModuleC.applications.find(x => x.id === b.dataset.merge);
      ModuleC.doManualMerge(a, target);
      toast(`${a.id} 已搭 ${target.id} 便車，合併成立`, 'ok');
      RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track();
    });
  };
}

/* ---------- 新增畫面 ---------- */
function renderCApplyNew(p) {
  const oOpts = DB.bizOrigins.map(o => `<option>${o}</option>`).join('');
  const dOpts = DB.bizDests.map(d => `<option>${d}</option>`).join('');
  p.innerHTML = `
    <div class="section-h" style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-ghost btn-sm" id="cn-back">← 返回查詢</button>
      新增出差用車申請單
    </div>
    <div class="card">
      <div class="card-title">出差用車申請 <span class="g-tag">G50/G54</span></div>
      <div class="row">
        <div class="field"><label>申請人</label><input type="text" id="ca-applicant" value="業務部-周雅婷"></div>
        <div class="field"><label>部門</label><input type="text" id="ca-dept" value="業務部"></div>
        <div class="field"><label>分機</label><input type="text" id="ca-ext" value="2201"></div>
      </div>
      <div class="field"><label>任務型態</label>
        <div class="radio-group">
          <label class="radio-pill sel" id="ca-round"><input type="radio" name="ca-type" value="round" checked>來回單</label>
          <label class="radio-pill" id="ca-oneway"><input type="radio" name="ca-type" value="oneway">單程單（轉運點）</label>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>出發地</label><select id="ca-origin">${oOpts}</select></div>
        <div class="field"><label>目的地</label><select id="ca-dest">${dOpts}</select></div>
      </div>
      <div style="font-size:12px;color:var(--ink-soft);font-weight:600;margin:6px 0 4px;">去程（起始）</div>
      <div class="row">
        <div class="field"><label>出發日期</label><input type="date" id="ca-date" value="2026-08-27"></div>
        <div class="field"><label>最早上車時間</label><input type="time" id="ca-pickup" value="09:00"></div>
      </div>
      <div id="ca-return-wrap">
        <div style="font-size:12px;color:var(--ink-soft);font-weight:600;margin:6px 0 4px;">回程（結束）</div>
        <div class="row">
          <div class="field"><label>回程日期</label><input type="date" id="ca-rdate" value="2026-08-27"></div>
          <div class="field"><label>回程上車時間</label><input type="time" id="ca-return" value="16:00"></div>
        </div>
      </div>
      <div class="field" style="max-width:160px;"><label>人數</label><input type="number" id="ca-pax" value="2"></div>
      <div class="callout info">來回單須「出發地、目的地、出發日期、回程日期、去程上車、回程上車」六項完全相同才能媒合（G54）。最晚抵達時間僅供參考，<b>不參與媒合判斷</b>（G55）。</div>
      <button class="btn btn-primary" id="ca-submit">▶ 送出申請（待主管准駁）</button>
      <button class="btn btn-ghost" id="ca-cancel">取消</button>
    </div>`;
  const setType = () => {
    const round = $('#page-c_apply input[value=round]').checked;
    $('#ca-round').classList.toggle('sel', round);
    $('#ca-oneway').classList.toggle('sel', !round);
    $('#ca-return-wrap').style.display = round ? 'block' : 'none';
  };
  $$('#page-c_apply input[name=ca-type]').forEach(r => r.onchange = setType);
  $('#ca-cancel').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  $('#ca-submit').onclick = () => {
    const type = $('#page-c_apply input[name=ca-type]:checked').value;
    const app = ModuleC.createApp({
      applicant: $('#ca-applicant').value, dept: $('#ca-dept').value, ext: $('#ca-ext').value,
      type, origin: $('#ca-origin').value, dest: $('#ca-dest').value,
      departDate: $('#ca-date').value, earliestPickup: $('#ca-pickup').value,
      returnDate: type === 'round' ? $('#ca-rdate').value : $('#ca-date').value,
      earliestReturn: $('#ca-return').value, pax: +$('#ca-pax').value,
    });
    toast(`${app.id} 已送出，等待主管准駁`, 'ok');
    cApply.resultIds = null; cApply.view = 'detail'; cApply.detailId = app.id;
    RENDER.c_apply();
  };
}
function loadCDemo() {
  const D = '2026-08-27', D2 = '2026-08-29';
  const demos = [
    // BZ001/BZ002：同地點、同起訖日期、同去回上車時間 → 可合併（多天來回）
    { type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '16:00', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' },
    { type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '16:00', pax: 2, applicant: '財務部-鄭安琪', dept: '財務部', ext: '3310' },
    // 單程單一對（4 小時窗配對）
    { type: 'oneway', origin: '台北總部', dest: '桃園機場T1', departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 3, applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' },
    { type: 'oneway', origin: '桃園機場T1', dest: '台北總部', departDate: D, earliestPickup: '11:00', returnDate: D, earliestReturn: '', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' },
    // BZ005：回程日期不同（單天來回）→ 與 BZ001/002 不合併，示範日期須完全相同
    { type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: D, earliestPickup: '09:00', returnDate: D, earliestReturn: '16:00', pax: 3, applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' },
  ];
  demos.forEach(d => ModuleC.createApp(d));
  toast('已載入 5 筆共乘申請（待審核）', 'ok');
}
// 相容：審核端動作呼叫此函式刷新申請端 grid
function renderCaList() { if ($('#cq-grid')) renderCGrid(); }

/* ============================================================
   模組 C · 主管准駁（直屬主管）— 獨立單元
   ============================================================ */
RENDER.c_approve = function () {
  const p = $('#page-c_approve');
  const submitted = ModuleC.applications.filter(a => a.status === 'submitted');
  const decided = ModuleC.applications.filter(a => ['approved', 'rejected'].includes(a.status));
  p.innerHTML = `
    <div class="section-h">主管准駁（直屬主管）</div>
    <div class="section-sub">員工填單後由直屬主管審核出差用車本身的准駁。駁回保留紀錄但不進排班池；核准後才進入業務單位的批次媒合。（G63）</div>
    <div class="card">
      <div class="card-title">待准駁申請 <span class="g-tag">G63</span></div>
      ${submitted.length === 0 ? `<div class="empty">目前無待准駁申請單。</div>` : `
      <div style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="cap-approve-all">✓ 全部核准</button></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>去程</th><th>回程</th><th>人</th><th>操作</th></tr></thead><tbody>
        ${submitted.map(a => `<tr><td>${a.id}</td><td>${a.applicant}（${a.dept}）</td><td>${a.type === 'round' ? '來回' : '單程'}</td>
          <td>${a.origin}→${a.dest}</td><td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
          <td>${a.type === 'round' ? a.returnDate.slice(5) + ' ' + a.earliestReturn : '—'}</td><td>${a.pax}</td>
          <td><button class="btn btn-primary btn-sm" data-ap="${a.id}">核准</button>
              <button class="btn btn-ghost btn-sm" data-rj="${a.id}">駁回</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
    <div class="card">
      <div class="card-title">已處理紀錄</div>
      ${decided.length === 0 ? `<div class="muted">尚無已准駁紀錄。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>路線</th><th>准駁結果</th></tr></thead><tbody>
        ${decided.map(a => `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${a.origin}→${a.dest}</td><td>${stBadge(a.status, 'C')}</td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  const all = $('#cap-approve-all');
  if (all) all.onclick = () => { submitted.forEach(a => ModuleC.approve(a)); toast(`已核准 ${submitted.length} 筆`, 'ok'); RENDER.c_approve(); renderCaList(); };
  $$('#page-c_approve [data-ap]').forEach(b => b.onclick = () => { ModuleC.approve(ModuleC.applications.find(a => a.id === b.dataset.ap)); toast(`${b.dataset.ap} 已核准`, 'ok'); RENDER.c_approve(); renderCaList(); });
  $$('#page-c_approve [data-rj]').forEach(b => b.onclick = () => { ModuleC.reject(ModuleC.applications.find(a => a.id === b.dataset.rj)); toast(`${b.dataset.rj} 已駁回`, 'err'); RENDER.c_approve(); renderCaList(); });
};

/* ============================================================
   模組 C · 媒合調度（業務單位）— 批次媒合 / 逾期作廢 / 派車追蹤
   ============================================================ */
RENDER.c_review = function () {
  const p = $('#page-c_review');
  p.innerHTML = `
    <div class="section-h">媒合調度（業務單位）</div>
    <div class="section-sub">對已核准申請執行批次媒合（未來 7 天）、資源檢核、逾期作廢與派車追蹤。手動併車由申請人於申請端自行處理、主管准駁為獨立單元。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="batch">① 批次媒合</div>
      <div class="pill-tab" data-tab="void">② 逾期作廢</div>
      <div class="pill-tab" data-tab="track">③ 派車追蹤</div>
    </div>
    <div id="cr-tab-batch"></div>
    <div id="cr-tab-void" style="display:none;"></div>
    <div id="cr-tab-track" style="display:none;"></div>`;
  $$('#page-c_review .pill-tab').forEach(t => t.onclick = () => {
    $$('#page-c_review .pill-tab').forEach(x => x.classList.toggle('active', x === t));
    ['batch', 'void', 'track'].forEach(k => $('#cr-tab-' + k).style.display = k === t.dataset.tab ? 'block' : 'none');
    if (t.dataset.tab === 'batch') renderCr_batch();
    if (t.dataset.tab === 'void') renderCr_void();
    if (t.dataset.tab === 'track') renderCr_track();
  });
  renderCr_batch(); renderCr_void(); renderCr_track();
};
// 派車追蹤：被安排的車次 · 司機 · 乘客上車/行程完成
function renderCr_track() {
  if (!$('#cr-tab-track')) return;
  const rows = ModuleC.applications.filter(a => ['matched', 'boarded', 'completed'].includes(a.status));
  $('#cr-tab-track').innerHTML = `
    <div class="card">
      <div class="card-title">派車追蹤（被安排車次 · 乘客上車/行程完成）</div>
      <div class="card-desc">顯示每張已媒合申請的車輛、司機、併車群組，以及乘客上車與行程完成狀態。乘客可於申請端確認上車/完成，或由調度室在此回報完成。</div>
      ${rows.length === 0 ? `<div class="empty">尚無已媒合車次。核准後執行批次媒合即會出現在此。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>單號</th><th>申請人</th><th>路線</th><th>人</th><th>車輛</th><th>司機</th><th>群組</th>
        <th>上車</th><th>行程</th><th>操作</th></tr></thead><tbody>
        ${rows.map(a => {
          const veh = a.vehicle ? DB.vehicles.find(v => v.id === a.vehicle) : null;
          const drv = a.driver ? DB.drivers.find(d => d.id === a.driver) : null;
          const brd = (a.status === 'boarded' || a.status === 'completed')
            ? '<span class="badge b-green">已上車</span>' : '<span class="badge b-gray">待上車</span>';
          const cmp = a.status === 'completed' ? '<span class="badge b-green">已完成</span>' : '<span class="badge b-gray">進行中</span>';
          let op = '<span class="muted">—</span>';
          if (a.status === 'boarded') op = `<button class="btn btn-accent btn-sm" data-ccomplete="${a.id}">確認完成</button>`;
          else if (a.status === 'matched') op = '<span class="muted">待乘客上車</span>';
          else if (a.status === 'completed') op = `<span class="muted">${a.completedBy || ''} 完成</span>`;
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${a.origin}→${a.dest}</td><td>${a.pax}</td>
            <td>${veh ? veh.name : '—'}</td><td>${drv ? drv.name : '—'}</td><td>${a.groupId || '—'}</td>
            <td>${brd}</td><td>${cmp}</td><td>${op}</td></tr>`; }).join('')}
      </tbody></table></div>`}
    </div>`;
  $$('#cr-tab-track [data-ccomplete]').forEach(b => b.onclick = () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.ccomplete);
    ModuleC.completeTrip(a, '調度室'); toast(`${a.id} 行程完成`, 'ok');
    renderCr_track(); renderCaList();
  });
}
function renderCr_batch() {
  const approved = ModuleC.applications.filter(a => a.status === 'approved').length;
  $('#cr-tab-batch').innerHTML = `
    <div class="card">
      <div class="card-title">批次媒合引擎 <span class="g-tag">G53/G61</span></div>
      <div class="card-desc">手動觸發，處理未來 7 天內（以出發日期為準）<b>已核准</b>申請單。已成功單不重排。按下當下即時呼叫請假 API（示意）。</div>
      <div class="row" style="max-width:420px;align-items:end;">
        <div class="field"><label>批次起算日期</label><input type="date" id="cr-batch-date" value="2026-08-25"></div>
        <div class="field" style="flex:0 0 auto;"><button class="btn btn-accent" id="cr-run-batch">▶ 執行批次媒合</button></div>
      </div>
      <div class="muted">目前已核准待媒合：${approved} 筆</div>
      <div id="cr-batch-result"></div>
    </div>
    <div class="card">
      <div class="card-title">資源可用性檢核狀態 <span class="g-tag">G60/G61</span></div>
      <div class="grid-2">
        <div><div class="muted" style="margin-bottom:6px;">車輛保修排程</div>
          <div class="table-wrap"><table class="dt"><thead><tr><th>車輛</th><th>期間</th><th>原因</th></tr></thead><tbody>
            ${DB.maintenance.map(m => `<tr><td>${m.vehicle}</td><td>${m.from}~${m.to}</td><td>${m.reason}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div><div class="muted" style="margin-bottom:6px;">司機請假（模擬 API 精確起訖）</div>
          <div class="table-wrap"><table class="dt"><thead><tr><th>司機</th><th>日期</th><th>時段</th></tr></thead><tbody>
            ${DB.driverLeaves.map(l => { const d = DB.drivers.find(x => x.id === l.driver);
              return `<tr><td>${d.name}</td><td>${l.date}</td><td>${l.from}~${l.to}</td></tr>`; }).join('')}
          </tbody></table></div></div>
      </div>
    </div>`;
  $('#cr-run-batch').onclick = () => {
    const { batch, trace } = ModuleC.runBatch($('#cr-batch-date').value);
    $('#cr-batch-result').innerHTML = `
      <div class="result ok" style="margin-top:14px;">
        <div class="r-head">✓ 批次 ${batch.id} 完成</div>
        <div>成功 ${batch.items.filter(i => i.result === 'matched').length} 筆｜待人工協調 ${batch.items.filter(i => i.result === 'coordinate').length} 筆</div>
      </div>
      <div class="trace">${trace.join('\n')}</div>`;
    toast(`批次 ${batch.id} 完成`, 'ok'); renderCaList(); renderCr_track();
  };
}
// 逾期自動作廢（調度端監控；手動併車已移至申請端）
function renderCr_void() {
  if (!$('#cr-tab-void')) return;
  // 尚未上車成局、可能逾期的單：已核准未媒合 / 待人工協調 / 已媒合待上車
  const active = ModuleC.applications.filter(a => ['approved', 'coordinate', 'matched'].includes(a.status));
  $('#cr-tab-void').innerHTML = `
    <div class="card">
      <div class="card-title">逾期自動作廢 <span class="g-tag">G57</span></div>
      <div class="card-desc">到出發時間仍未成功 → 自動作廢、通知申請人、紀錄保留供統計、不轉待人工協調。（此處以按鈕模擬逾期）手動併車由申請人於申請端自行處理。</div>
      ${active.length === 0 ? `<div class="empty">無可作廢單</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>路線</th><th>去程</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        ${active.map(a => `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${a.origin}→${a.dest}</td>
          <td>${a.departDate.slice(5)} ${a.earliestPickup}</td><td>${stBadge(a.status, 'C')}</td>
          <td><button class="btn btn-danger btn-sm" data-void="${a.id}">模擬逾期作廢</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  $$('#cr-tab-void [data-void]').forEach(b => b.onclick = () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.void);
    const r = ModuleC.voidOverdue(a);
    openModal('逾期自動作廢（示意）', `
      <div class="result fail"><div class="r-head">✗ ${a.id} 已自動作廢</div>
        <div>系統已通知申請人：<b>${r.notified}</b></div></div>
      <div class="callout" style="margin-top:12px;">紀錄保留供媒合失敗率統計（G57），不轉待人工協調。作廢即最終結局。</div>`);
    toast(`${a.id} 逾期作廢並通知申請人`, 'err');
    renderCr_void(); renderCaList();
  });
}
function statusText(s) {
  return ({ submitted: '待審核', approved: '已核准', rejected: '已駁回', matched: '已媒合', boarded: '已上車', completed: '行程完成', coordinate: '待人工協調', manual: '手動併車', void: '作廢' })[s] || s;
}

/* ============================================================
   主檔資料（共用）
   ============================================================ */
RENDER.master = function () {
  const p = $('#page-master');
  p.innerHTML = `
    <div class="section-h">主檔資料</div>
    <div class="section-sub">示範主檔（記憶體）。正式版對應 VD_ 前綴資料表。類別與天數對照表為示意值，待業務盤點。</div>
    <div class="grid-2">
      <div class="card"><div class="card-title">車輛主檔（含資源池別）</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>ID</th><th>名稱</th><th>資源池</th><th>歸屬</th><th>容量/座位</th></tr></thead><tbody>
        ${DB.vehicles.map(v => `<tr><td>${v.id}</td><td>${v.name}</td>
          <td>${v.pool === 'LOGI' ? '<span class="badge b-navy">物流</span>' : '<span class="badge b-green">商務</span>'}</td>
          <td>${v.home}</td><td>${v.pool === 'BIZ' ? v.seats + ' 座' : v.volume.toFixed(0) + 'L/' + v.weight + 'kg'}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-title">司機主檔（獨立資源）</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>ID</th><th>姓名</th><th>資源池</th><th>歸屬</th></tr></thead><tbody>
        ${DB.drivers.map(d => `<tr><td>${d.id}</td><td>${d.name}</td>
          <td>${d.pool === 'LOGI' ? '物流' : '商務'}</td><td>${d.home}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-title">南北據點順序（G30）</div>
        <div class="route">${DB.sites.map(s => `<div class="stop"><div class="s-name">${s.name}</div><div class="s-meta">序 ${s.order}</div></div>`).join('')}</div></div>
      <div class="card"><div class="card-title">天數對照表（示意 · P1 待確認）</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>終點</th><th>直達</th><th>有停靠</th></tr></thead><tbody>
        ${DB.sites.filter(s => DB.dayCountStopover[s.id]).map(s =>
          `<tr><td>${s.name}</td><td>${DB.dayCountDirect[s.id] || '—'} 天</td><td>${DB.dayCountStopover[s.id]} 天</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>`;
};

/* ============================================================
   初始化
   ============================================================ */
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleString('zh-TW', { hour12: false });
}
window.addEventListener('DOMContentLoaded', () => {
  buildNav();
  $('#modal-close').onclick = closeModal;
  $('#modal-mask').onclick = (e) => { if (e.target.id === 'modal-mask') closeModal(); };
  tick(); setInterval(tick, 1000);
  goto('dashboard');
});
