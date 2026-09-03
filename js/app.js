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

/* SweetAlert 風格確認視窗：回傳 Promise<boolean>；確定→true、取消/關閉→false */
let _swalResolve = null;
function confirmDialog(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    _swalResolve = resolve;
    $('#swal-title').textContent = opts.title || '確認送出？';
    $('#swal-text').innerHTML = opts.text || '';
    $('#swal-ok').textContent = opts.okText || '確定';
    $('#swal-cancel').textContent = opts.cancelText || '取消';
    $('#swal-mask').classList.add('show');
    $('#swal-ok').focus();
  });
}
function _swalClose(result) {
  $('#swal-mask').classList.remove('show');
  const r = _swalResolve; _swalResolve = null;
  if (r) r(result);
}
/* 包裝任一動作：先跳確認視窗，按「確定」才執行 fn（取消則不動作）*/
function confirmThen(opts, fn) {
  return async function (ev) { if (await confirmDialog(opts)) return fn.call(this, ev); };
}
/* 頁面最下方置中的「回上一頁」按鈕（明細/新增頁共用）*/
function backBar(id) {
  return `<div style="text-align:center;margin-top:28px;"><button class="btn btn-ghost" id="${id}">← 回上一頁</button></div>`;
}

/* 通用狀態徽章（mod 用來區分同名狀態 matched 的顯示文字）*/
function stBadge(s, mod) {
  const map = {
    submitted: ['待審核', 'b-gray'],
    approved: ['已核准待排', 'b-navy'],
    unscheduled: ['未排入·請改期', 'b-amber'],
    rejected: ['已駁回', 'b-red'],
    delivered: ['已交貨', 'b-green'],
    loaded: ['已派車待接受', 'b-navy'],
    coordinate: ['待人工協調', 'b-amber'],
    manual: ['手動併車', 'b-navy'],
    void: ['逾期作廢', 'b-red'],
    boarded: ['已上車', 'b-amber'],
    completed: ['行程完成', 'b-green'],
    matched: mod === 'C' ? ['已媒合待上車', 'b-navy'] : ['已排班', 'b-navy'],
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
    { id: 'a_driver', ico: '🧑‍✈️', label: 'A｜司機任務單（駕駛）' },
  ] },
  { group: '模組 B · 南北幹線', items: [
    { id: 'b_apply', ico: '📝', label: 'B｜幹線託運申請（使用者）' },
    { id: 'b_approve', ico: '✅', label: 'B｜主管准駁（主管）' },
    { id: 'b_review', ico: '🚚', label: 'B｜派車調度（業務）' },
    { id: 'b_driver', ico: '🧑‍✈️', label: 'B｜司機任務單（駕駛）' },
  ] },
  { group: '模組 C · 差旅共乘', items: [
    { id: 'c_apply', ico: '📝', label: 'C｜出差用車申請（使用者）' },
    { id: 'c_approve', ico: '✅', label: 'C｜主管准駁（主管）' },
    { id: 'c_review', ico: '🔀', label: 'C｜媒合調度（業務）' },
    { id: 'c_driver', ico: '🧑‍✈️', label: 'C｜司機任務單（駕駛）' },
  ] },
];
const PAGE_META = {
  dashboard: { title: '系統儀表板', crumb: '車輛派遣系統整合 · 原型 v0.2' },
  engine: { title: '裝載判定引擎', crumb: '共用基礎層 · Phase 1 · G01–G05' },
  master: { title: '主檔資料', crumb: '共用基礎層 · Phase 0' },
  a_apply: { title: '區域內物流 · 收貨申請（使用者）', crumb: '模組 A · 申請端 · 送出即自動媒合 · G10–G19' },
  a_review: { title: '區域內物流 · 車次追蹤（業務單位）', crumb: '模組 A · 調度端 · G18/G20' },
  a_driver: { title: '區域內物流 · 司機任務單（駕駛）', crumb: '模組 A · 駕駛端 · 沿線收送任務' },
  b_apply: { title: '南北幹線 · 幹線託運申請（使用者）', crumb: '模組 B · 申請端 · G34/G38' },
  b_approve: { title: '南北幹線 · 主管准駁（直屬主管）', crumb: '模組 B · 主管端 · G63' },
  b_review: { title: '南北幹線 · 派車調度（業務單位）', crumb: '模組 B · 調度端 · G30–G44' },
  b_driver: { title: '南北幹線 · 司機任務單（駕駛）', crumb: '模組 B · 駕駛端 · 沿線取貨/卸貨' },
  c_apply: { title: '差旅共乘 · 出差用車申請（使用者）', crumb: '模組 C · 申請端 · G54/G55/G56' },
  c_approve: { title: '差旅共乘 · 主管准駁（直屬主管）', crumb: '模組 C · 主管端 · G63' },
  c_review: { title: '差旅共乘 · 媒合調度（業務單位）', crumb: '模組 C · 調度端 · G50–G63' },
  c_driver: { title: '差旅共乘 · 司機任務單（駕駛）', crumb: '模組 C · 駕駛端 · 今日行程與乘客' },
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
  const aMatched = ModuleA.applications.filter(a => ['matched', 'delivered'].includes(a.status)).length;
  const bLoaded = ModuleB.orders.filter(o => ['loaded', 'delivered'].includes(o.status)).length;
  const cMatched = ModuleC.applications.filter(a => ['matched', 'boarded', 'completed'].includes(a.status)).length;
  const pendReview = ModuleA.applications.filter(a => a.status === 'submitted').length
    + ModuleB.orders.filter(o => o.status === 'submitted').length
    + ModuleC.applications.filter(a => a.status === 'submitted').length;
  p.innerHTML = `
    <div class="section-h">系統儀表板</div>
    <div class="section-sub">車輛派遣系統整合原型 — 純前端可動版。依審批流程（G63）將「使用者申請」「主管准駁」「業務審核/調度」「司機任務單」四種角色各自獨立，三模組各拆四個單元，共 12 個業務單元。三模組資源池分開，互不搶用。</div>
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
      ${unitCard('🧑‍✈️ A｜司機任務單', '駕駛端：以班次（車輛）為單位，沿 10 站路線的收送任務、到站時間、接收人。', 'a_driver', '駕駛')}
      ${unitCard('📝 B｜幹線託運申請', '使用者建立幹線託運單（直達/非直達）、查看狀態。', 'b_apply', '申請端')}
      ${unitCard('✅ B｜主管准駁', '直屬主管准駁幹線託運單，駁回保留紀錄不進派車池。', 'b_approve', '主管')}
      ${unitCard('🚚 B｜派車調度', '貪婪/直達派車決策、回程直達鎖定、決策矩陣、貨況追蹤。', 'b_review', '審核端')}
      ${unitCard('🧑‍✈️ B｜司機任務單', '駕駛端：以車輛為單位，這一趟停靠哪些據點、各站取貨／卸貨。', 'b_driver', '駕駛')}
      ${unitCard('📝 C｜出差用車申請', '使用者填來回/單程用車申請、查看狀態、手動併車找便車。', 'c_apply', '申請端')}
      ${unitCard('✅ C｜主管准駁', '直屬主管准駁出差用車申請，駁回保留紀錄不進排班池。', 'c_approve', '主管')}
      ${unitCard('🔀 C｜媒合調度', '批次媒合、資源檢核、逾期作廢、派車追蹤。', 'c_review', '審核端')}
      ${unitCard('🧑‍✈️ C｜司機任務單', '駕駛端：以駕駛為單位，今日整個行程要接誰、去哪裡。', 'c_driver', '駕駛')}
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
    : side === '駕駛' ? '<span class="badge b-gray">駕駛</span>'
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

/* ---- 貨物編輯彈窗（新增/編輯共用）：送出 → onSave(新項目)，取消 → 關閉 ---- */
function openCargoEditor(item, onSave) {
  const it = Object.assign({ name: '', l: '', w: '', h: '', qty: 1, category: 'BOX', weight: '' }, item || {});
  const catOpts = DB.wasteFactors.map(f => `<option value="${f.code}" ${f.code === it.category ? 'selected' : ''}>${f.name}（係數 ${f.factor}）</option>`).join('');
  openModal(item ? '編輯貨物內容' : '新增貨物', `
    <div class="field"><label>品名</label><input type="text" id="ce-name" value="${it.name}"></div>
    <div class="row">
      <div class="field"><label>長 (cm)</label><input type="number" id="ce-l" value="${it.l}"></div>
      <div class="field"><label>寬 (cm)</label><input type="number" id="ce-w" value="${it.w}"></div>
      <div class="field"><label>高 (cm)</label><input type="number" id="ce-h" value="${it.h}"></div>
    </div>
    <div class="row">
      <div class="field"><label>類別 <span class="hint">浪費係數查表 G03</span></label><select id="ce-cat">${catOpts}</select></div>
      <div class="field"><label>數量</label><input type="number" id="ce-qty" value="${it.qty}"></div>
      <div class="field"><label>單件重 (kg)</label><input type="number" id="ce-wt" value="${it.weight}"></div>
    </div>
    <div style="text-align:center;margin-top:20px;">
      <button class="btn btn-primary" id="ce-ok">▶ 送出</button>
      <button class="btn btn-ghost" id="ce-cancel">取消</button>
    </div>`);
  $('#ce-cancel').onclick = closeModal;
  $('#ce-ok').onclick = () => {
    const name = $('#ce-name').value.trim();
    const l = +$('#ce-l').value, w = +$('#ce-w').value, h = +$('#ce-h').value;
    const qty = +$('#ce-qty').value, weight = +$('#ce-wt').value;
    if (!name) { toast('請填品名', 'err'); return; }
    if (!(l > 0 && w > 0 && h > 0)) { toast('長寬高需為正數', 'err'); return; }
    if (!(qty > 0)) { toast('數量需為正整數', 'err'); return; }
    onSave({ name, l, w, h, qty, category: $('#ce-cat').value, weight: weight > 0 ? weight : 0 });
    closeModal();
  };
}

/* ---- 貨物項目唯讀 grid；editable 時最左欄加「編輯／刪除」按鈕 ---- */
function renderCargoGrid(sel, items, editable, onChange) {
  const box = $(sel);
  if (!box) return;
  const catName = (c) => (DB.wasteFactors.find(f => f.code === c) || {}).name || c;
  const head = `${editable ? '<th></th>' : ''}<th>品名</th><th>長×寬×高(cm)</th><th>類別</th><th>數量</th><th>單件重(kg)</th>`;
  const body = items.length === 0
    ? `<tr><td colspan="${editable ? 6 : 5}" class="muted" style="text-align:center;padding:16px;">尚無貨物項目${editable ? '，請按右上角「新增」加入' : ''}。</td></tr>`
    : items.map((it, i) => `<tr>
        ${editable ? `<td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" data-cedit="${i}">編輯</button> <button class="btn btn-ghost btn-sm" data-cdel="${i}">刪除</button></td>` : ''}
        <td>${it.name}</td><td>${it.l}×${it.w}×${it.h}</td><td>${catName(it.category)}</td><td>${it.qty || 1}</td><td>${it.weight || 0}</td></tr>`).join('');
  box.innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  if (editable) {
    $$(sel + ' [data-cedit]').forEach(b => b.onclick = () => openCargoEditor(items[+b.dataset.cedit], upd => { items[+b.dataset.cedit] = upd; onChange(); }));
    $$(sel + ' [data-cdel]').forEach(b => b.onclick = () => { items.splice(+b.dataset.cdel, 1); onChange(); });
  }
}

/* ---- 建物下拉（含「其他」）＋「其他」文字框：選「其他」才顯示文字框 ---- */
const stationBuildings = id => { const s = DB.stations.find(x => x.id === id); return s ? s.buildings : []; };
const siteBuildings = id => { const s = DB.sites.find(x => x.id === id); return s ? (s.buildings || []) : []; };
function bldgFieldHtml(label, selId, otherId) {
  return `<div class="field"><label>${label}</label>
      <select id="${selId}"></select>
      <input type="text" id="${otherId}" placeholder="請輸入建物/位置" style="display:none;margin-top:6px;"></div>`;
}
// 依 site/station 填入建物選項並掛上「其他」顯示/隱藏
function wireBldg(siteSelId, bldgSelId, otherId, buildingsOf) {
  const toggle = () => { $('#' + otherId).style.display = ($('#' + bldgSelId).value === '其他') ? 'block' : 'none'; };
  const fill = () => {
    const bs = buildingsOf($('#' + siteSelId).value) || [];
    $('#' + bldgSelId).innerHTML = [...bs, '其他'].map(b => `<option>${b}</option>`).join('');
    toggle();
  };
  $('#' + siteSelId).onchange = fill;
  $('#' + bldgSelId).onchange = toggle;
  fill();
}
// 取得建物實際值（選「其他」則取文字框）
function bldgVal(bldgSelId, otherId) {
  const v = $('#' + bldgSelId).value;
  return v === '其他' ? ($('#' + otherId).value.trim() || '其他') : v;
}

/* ---- 接收人資訊（單位／姓名／電話＋代理人）：A/B 共用 ---- */
// 表單區塊；prefix 為欄位 id 前綴（如 'aa' / 'ba'）
function recipientFieldsHtml(prefix, r) {
  r = r || {};
  const v = s => (s || '').replace(/"/g, '&quot;');
  return `
    <div class="divider"></div>
    <div class="card-title">接收人資訊</div>
    <div class="row">
      <div class="field"><label>單位</label><input type="text" id="${prefix}-runit" value="${v(r.unit)}" placeholder="收貨單位／部門"></div>
      <div class="field"><label>姓名</label><input type="text" id="${prefix}-rname" value="${v(r.name)}" placeholder="接收人姓名"></div>
      <div class="field"><label>電話</label><input type="text" id="${prefix}-rphone" value="${v(r.phone)}" placeholder="聯絡電話"></div>
    </div>
    <div class="row">
      <div class="field"><label>代理人姓名 <span class="hint">選填</span></label><input type="text" id="${prefix}-aname" value="${v(r.agentName)}" placeholder="代理人姓名"></div>
      <div class="field"><label>代理人電話 <span class="hint">選填</span></label><input type="text" id="${prefix}-aphone" value="${v(r.agentPhone)}" placeholder="代理人電話"></div>
    </div>`;
}
// 讀取表單接收人資訊
function recipientVal(prefix) {
  const g = id => { const el = $('#' + prefix + '-' + id); return el ? el.value.trim() : ''; };
  return { unit: g('runit'), name: g('rname'), phone: g('rphone'), agentName: g('aname'), agentPhone: g('aphone') };
}
// 明細顯示：回傳 HTML（無資料時顯示 —）
function recipientDisplay(r) {
  if (!r || (!r.unit && !r.name && !r.phone && !r.agentName && !r.agentPhone)) return '<span class="muted">—</span>';
  const main = [r.unit, r.name, r.phone].filter(Boolean).join('　·　') || '—';
  const agent = (r.agentName || r.agentPhone)
    ? `<br><span class="hint">代理人：${[r.agentName, r.agentPhone].filter(Boolean).join('　·　')}</span>` : '';
  return main + agent;
}

/* ---- 司機任務單共用小工具 ---- */
// 貨物項目摘要（品名×數量）
function itemsSummary(items) {
  if (!items || !items.length) return '—';
  return items.map(it => `${it.name || '貨物'}×${it.qty || 1}`).join('、');
}
// 依車輛推定物流駕駛（示意：LOGI 車輛與 LOGI 司機依序對應）
function logiDriverName(vehId) {
  const logiV = DB.vehicles.filter(v => v.pool === 'LOGI');
  const logiD = DB.drivers.filter(d => d.pool === 'LOGI');
  const idx = logiV.findIndex(v => v.id === vehId);
  const d = idx >= 0 && logiD.length ? logiD[idx % logiD.length] : null;
  return d ? d.name : '待指派';
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
  const statusOpts = [['', '全部狀態'], ['matched', '已排班'], ['unscheduled', '未排入·請改期'], ['delivered', '已交貨']]
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
    // [收貨站(起), 送貨站(迄), 模式, 上貨分, 下貨分, 貨物, 接收人]（收貨站須在送貨站之前）
    [['S2', 'S3', 'asap', 10, 5, [{ name: '零件箱', l: 50, w: 40, h: 30, qty: 6, category: 'BOX', weight: 12 }], { unit: '生產部', name: '林建志', phone: '03-1234567#210', agentName: '陳怡君', agentPhone: '0912-345-678' }],
     ['S2', 'S6', 'exact', 12, 8, [{ name: '棧板', l: 110, w: 90, h: 120, qty: 1, category: 'PALLET', weight: 200 }], { unit: '倉儲課', name: '黃美玲', phone: '03-2345678#118' }],
     ['S3', 'S9', 'asap', 15, 10, [{ name: '長料', l: 480, w: 25, h: 25, qty: 3, category: 'LONG', weight: 30 }], { unit: '工務組', name: '吳志豪', phone: '03-3456789#305', agentName: '李國華', agentPhone: '0922-111-222' }]
    ].forEach(([pick, s, mode, lm, um, items, recipient]) => { const pSt = DB.stations.find(x => x.id === pick);
      ModuleA.submit({
        applicant: '業務部-周雅婷', station: s, building: DB.stations.find(x => x.id === s).buildings[0],
        pickStation: pick, pickupLoc: pSt.name + ' / ' + pSt.buildings[0],
        deliverTime: mode === 'exact' ? '14:00' : '', recipient, items, recvMode: mode, loadMin: lm, unloadMin: um }); });
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
      <th></th><th>單號</th><th>申請人</th><th>目的地</th><th>日期</th><th>模式</th><th>班次</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        return `<tr>
          <td><button class="btn btn-ghost btn-sm" data-detail="${a.id}">細節</button></td>
          <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
          <td>${st.name}/${a.building}</td>
          <td>${a.serviceDate || '—'}</td>
          <td>${a.recvMode === 'exact' ? '指定期望時間' : '越快越好'}</td>
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
  const canEdit = !['matched', 'delivered'].includes(a.status); // 媒合後不可編輯貨物
  let action = '';
  if (a.status === 'matched') action = `<button class="btn btn-accent" data-recv="${a.id}">確認已收到貨</button>`;
  else if (a.status === 'delivered') action = '<span class="badge b-green">✓ 已完成</span>';
  p.innerHTML = `
    <div class="section-h">收貨申請明細 · ${a.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(a.status)}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${a.id}</div></div>
        <div class="field"><label>申請人</label><div>${a.applicant}</div></div>
        <div class="field"><label>收貨地點（起）</label><div>${a.pickupLoc || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>送貨地點（迄）</label><div>${st.name} / ${a.building}</div></div>
        <div class="field"><label>收貨模式</label><div>${a.recvMode === 'exact' ? '指定期望時間' : '越快越好（離現在最近）'}</div></div>
        <div class="field"><label>排班日期</label><div><b>${a.serviceDate || '—'}</b>${a.serviceDate === ModuleA.todayStr() ? ' <span class="badge b-navy">今天</span>' : ''}</div></div>
        <div class="field"><label>期望收貨時間</label><div>${a.deliverTime || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>上貨 / 下貨時間</label><div>${a.loadMin || 0} 分 / ${a.unloadMin || 0} 分（合計 ${a.handleMin} 分）</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(a.createdAt)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      <div class="field"><div>${recipientDisplay(a.recipient)}</div></div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目（總體積約 ${totalVol.toFixed(0)}L）</span>
        ${canEdit ? `<button class="btn btn-accent btn-sm" id="ad-add">＋ 新增</button>` : ''}</div>
      <div id="ad-items"></div>
      ${canEdit ? `<div class="muted" style="margin-top:6px;">此單尚未媒合，可編輯貨物；編輯後可按下方「重新媒合」再試一次。</div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">自動媒合結果</div>
      ${a.status === 'unscheduled'
        ? `<div class="callout warn"><b>未排入 — 請改期</b><br>${a.note || '當日各班次皆無法排入（不留候補、不排隔日 G12）。'}</div>
           <div style="margin-top:12px;"><button class="btn btn-primary btn-sm" id="ad-rematch">↻ 重新媒合</button></div>`
        : `<div class="grid-2">
        <div class="field"><label>排定班次</label><div>${sh ? sh.label : '<span class="muted">尚未排班</span>'}</div></div>
        <div class="field"><label>車號</label><div>${veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '—'}</div></div>
        <div class="field"><label>預計到站時間</label><div>${a.arrival ? `<b style="color:var(--navy);">${a.arrival}</b>` : '—'}</div></div>
        <div class="field"><label>與期望時間差</label><div>${a.expectDiffMin == null ? '<span class="muted">—（未指定期望）</span>'
          : a.expectDiffMin === 0 ? '準時'
          : `較期望時間${a.expectDiffMin > 0 ? '晚' : '早'} ${Math.abs(a.expectDiffMin)} 分（僅提示）`}</div></div>
        <div class="field"><label>異常回報</label><div>${a.incident ? '<span class="badge b-red">' + a.incident + '</span>' : '無'}</div></div>
      </div>`}
      ${action ? `<div class="divider"></div><div><b>接收人操作：</b> ${action}</div>` : ''}
    </div>
    ${backBar('ad-back')}`;
  renderCargoGrid('#ad-items', a.items, canEdit, () => RENDER.a_apply());
  if (canEdit) {
    const add = $('#ad-add');
    if (add) add.onclick = () => openCargoEditor(null, it => { a.items.push(it); RENDER.a_apply(); });
    const rm = $('#ad-rematch');
    if (rm) rm.onclick = confirmThen({ title: '確認重新媒合？', text: '將依目前貨物內容重新執行自動媒合。' }, () => {
      const r = ModuleA.rematch(a);
      toast(r.ok ? `${a.id} 已媒合：${r.shift.label}／到站約 ${r.arrival}` : `${a.id}｜${r.msg}`, r.ok ? 'ok' : 'err');
      RENDER.a_apply(); if ($('#ar-tab-review')) renderAr_review();
    });
  }
  $('#ad-back').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  const rcv = $(`#page-a_apply [data-recv]`);
  if (rcv) rcv.onclick = confirmThen({ title: '確認已收到貨？', text: '確認後此收貨申請將標記為已交貨。' }, () => { ModuleA.confirmDelivery(a, a.applicant); toast(`${a.id} 已確認收到貨`, 'ok'); RENDER.a_apply(); if ($('#ar-tab-review')) renderAr_review(); });
}

/* ---------- 新增畫面 ---------- */
function renderAApplyNew(p) {
  const stOpts = DB.stations.map(s => `<option value="${s.id}">${s.order}. ${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">新增收貨申請單</div>
    <div class="card">
      <div class="card-title">填寫收貨申請單 <span class="g-tag">G13/G19</span></div>
      <div class="field"><label>申請人</label><input type="text" id="aa-applicant" value="業務部-周雅婷"></div>
      <div class="row">
        <div class="field"><label>收貨地點站點（起）</label><select id="aa-pickuploc">${stOpts}</select></div>
        ${bldgFieldHtml('收貨建物', 'aa-pickbldg', 'aa-pickother')}
      </div>
      <div class="row">
        <div class="field"><label>送貨地點站點（迄）</label><select id="aa-station">${stOpts}</select></div>
        ${bldgFieldHtml('送貨建物', 'aa-building', 'aa-destother')}
      </div>
      <div class="field"><label>收貨時間模式 <span class="hint">兩種皆不享班次內插隊優先權 G19</span></label>
        <div class="radio-group">
          <label class="radio-pill sel" id="aa-mode-asap"><input type="radio" name="aa-recv" value="asap" checked>越快越好（離現在最近）</label>
          <label class="radio-pill" id="aa-mode-exact"><input type="radio" name="aa-recv" value="exact">指定期望時間</label>
        </div>
      </div>
      <div class="row" id="aa-deliver-wrap" style="display:none;">
        <div class="field"><label>期望日期 <span class="hint">今天或未來日期</span></label><input type="date" id="aa-date"></div>
        <div class="field"><label>期望收貨時間 <span class="hint">僅用於挑選最接近的班次，非硬性截止（4.1）</span></label><input type="time" id="aa-deliver" value="14:00"></div>
      </div>
      <div class="callout info" id="aa-today-hint" style="display:none;margin-bottom:10px;">選擇<b>今天</b>時，<b>已經出發的班次不會被媒合</b>；若今日班次都已過，請改選未來日期。</div>
      <div class="row">
        <div class="field"><label>上貨時間（分，自填 G15）</label><input type="number" id="aa-load" value="10"></div>
        <div class="field"><label>下貨時間（分，自填 G15）</label><input type="number" id="aa-unload" value="5"></div>
      </div>
      ${recipientFieldsHtml('aa')}
      <div class="divider"></div>
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        <button class="btn btn-accent btn-sm" id="aa-add">＋ 新增</button></div>
      <div id="aa-items"></div>
      <div class="divider"></div>
      <div class="callout info" style="margin-bottom:10px;">送出後系統<b>立即自動媒合</b>（無需主管核准、無需業務按鈕），並直接告知媒合到的<b>班次時間與車號</b>。</div>
      <button class="btn btn-primary" id="aa-submit">▶ 送出並自動媒合</button>
      <button class="btn btn-ghost" id="aa-cancel">取消</button>
    </div>
    ${backBar('an-back')}`;
  $('#an-back').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  wireBldg('aa-pickuploc', 'aa-pickbldg', 'aa-pickother', stationBuildings); // 收貨建物
  wireBldg('aa-station', 'aa-building', 'aa-destother', stationBuildings);    // 送貨建物
  $$('#page-a_apply input[name=aa-recv]').forEach(r => r.onchange = () => {
    const exact = $('#page-a_apply input[value=exact]').checked;
    $('#aa-mode-asap').classList.toggle('sel', !exact);
    $('#aa-mode-exact').classList.toggle('sel', exact);
    $('#aa-deliver-wrap').style.display = exact ? '' : 'none'; // 期望日期/時間僅指定期望時間需要
    $('#aa-today-hint').style.display = exact ? '' : 'none';
  });
  // 期望日期預設今天、不可早於今天
  const _today = ModuleA.todayStr();
  $('#aa-date').value = _today; $('#aa-date').min = _today;
  renderAaItems(); // 一開始顯示空白清單
  $('#aa-add').onclick = () => openCargoEditor(null, it => { aaItems.push(it); renderAaItems(); });
  $('#aa-cancel').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  $('#aa-submit').onclick = async () => {
    if (aaItems.length === 0) { toast('請至少新增一項貨物', 'err'); return; }
    const ok = await confirmDialog({ title: '確認送出收貨申請？',
      text: '送出後系統將<b>立即自動媒合</b>並告知班次時間與車號。' });
    if (!ok) return;
    const mode = $('#page-a_apply input[name=aa-recv]:checked').value;
    // 送出即自動媒合（G10–G12/G16/G19）
    const pickSt = DB.stations.find(s => s.id === $('#aa-pickuploc').value);
    const dropSt = DB.stations.find(s => s.id === $('#aa-station').value);
    if (pickSt && dropSt && pickSt.order >= dropSt.order) {
      toast('收貨站須在送貨站之前（路線行進方向）', 'err'); return;
    }
    if (mode === 'exact') {
      const d = $('#aa-date').value;
      if (!d) { toast('請選擇期望日期', 'err'); return; }
      if (d < ModuleA.todayStr()) { toast('期望日期不可早於今天', 'err'); return; }
    }
    const { app, result } = ModuleA.submit({
      applicant: $('#aa-applicant').value, station: $('#aa-station').value,
      building: bldgVal('aa-building', 'aa-destother'),
      pickStation: $('#aa-pickuploc').value,
      pickupLoc: (pickSt ? pickSt.name : '') + ' / ' + bldgVal('aa-pickbldg', 'aa-pickother'),
      deliverTime: mode === 'exact' ? $('#aa-deliver').value : '', // 期望收貨時間（僅 exact 用於排序）
      serviceDate: mode === 'exact' ? $('#aa-date').value : ModuleA.todayStr(), // 排班日期（asap＝今天）

      recipient: recipientVal('aa'),
      items: aaItems.map(x => ({ ...x })), recvMode: mode,
      loadMin: +$('#aa-load').value || 0, unloadMin: +$('#aa-unload').value || 0,
    });
    aaItems = [];
    if (result.ok) {
      const veh = DB.vehicles.find(v => v.id === result.shift.vehicle);
      toast(`${app.id} 已自動媒合：${result.shift.label}／車 ${veh ? veh.id : result.shift.vehicle}／到站約 ${result.arrival}`, 'ok');
    } else {
      toast(`${app.id}｜${result.msg}`, 'err');
    }
    aApply.resultIds = null;        // 回到查詢畫面顯示全部（含新單）
    aApply.view = 'detail'; aApply.detailId = app.id; // 送出後直接看媒合結果明細
    RENDER.a_apply();
  };
}
function renderAaItems() { renderCargoGrid('#aa-items', aaItems, true, renderAaItems); }
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
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="ar-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
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
  $('#ar-goto-driver').onclick = () => goto('a_driver');
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
  $$('#ar-tab-review [data-deliver]').forEach(b => b.onclick = confirmThen({ title: '確認交貨？', text: '確認後此車次將標記為已交貨。' }, () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.deliver);
    ModuleA.confirmDelivery(a, '調度室'); toast(`${a.id} 已確認交貨`, 'ok');
    renderAr_review(); renderAaList();
  }));
}
// 已排定車次一覽（被安排的車次 + 媒合狀況 + 接受/交貨狀態）
function renderAr_scheduled() {
  const rows = ModuleA.applications.filter(a => ['matched', 'delivered'].includes(a.status));
  const body = rows.length === 0 ? `<div class="empty">尚無已排定車次。使用者送出申請並自動媒合成功後即會出現在此。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>目的地</th><th>日期</th><th>班次</th><th>車輛</th><th>到站</th>
      <th>交貨</th><th>操作</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        const veh = sh ? DB.vehicles.find(v => v.id === sh.vehicle) : null;
        const del = a.status === 'delivered'
          ? `<span class="badge b-green">已交貨</span>` : '<span class="badge b-gray">未交貨</span>';
        let op = '<span class="muted">—</span>';
        if (a.status === 'matched') op = `<button class="btn btn-accent btn-sm" data-deliver="${a.id}">確認交貨</button>`;
        else if (a.status === 'delivered') op = `<span class="muted">${a.deliveredBy || ''} 完成</span>`;
        return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}/${a.building}</td>
          <td>${a.serviceDate || '—'}</td>
          <td>${sh ? sh.label : '—'}</td><td>${veh ? veh.name : '—'}</td><td>${a.arrival || '—'}</td>
          <td>${del}</td><td>${op}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  return `<div class="card">
    <div class="card-title">已排定車次一覽（被安排車次 · 交貨追蹤）</div>
    <div class="card-desc">媒合成功即完成排班（免確認接受）。顯示每張已排班申請單的班次、車輛、到站時間與交貨狀態。交貨可由接收人於申請端確認收到，或由調度室在此確認送達。</div>
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
  const matched = ModuleA.applications.filter(a => ['matched', 'delivered'].includes(a.status));
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
  $$('#ar-tab-incident [data-inc]').forEach(b => b.onclick = confirmThen({ title: '確認回報異常並寄信？', text: '確認後將記錄異常並立即自動寄信給申請人與直屬主管（G20）。' }, () => {
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
  }));
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
  const statusOpts = [['', '全部狀態'], ['submitted', '待審核'], ['approved', '已核准待排'], ['loaded', '已派車'],
    ['delivered', '已交貨'], ['rejected', '已駁回']]
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
    // [收貨據點(起), 送貨據點(迄), 直達?, 裝卸分, 貨物]（去程南下：起北於迄）
    [['D9', 'D3', false, 30, [{ name: '紙箱', l: 50, w: 40, h: 40, qty: 10, category: 'BOX', weight: 15 }, { name: '長管', l: 300, w: 20, h: 20, qty: 2, category: 'LONG', weight: 25 }], { unit: '台南營業所', name: '鄭文彬', phone: '06-2223344#12', agentName: '周雅琳', agentPhone: '0933-556-677' }],
     ['D9', 'D2', false, 25, [{ name: '棧板料', l: 110, w: 90, h: 120, qty: 1, category: 'PALLET', weight: 200 }], { unit: '左營物流中心', name: '蔡宗翰', phone: '07-3334455#08' }],
     ['D6', 'D2', false, 20, [{ name: '文件箱', l: 40, w: 30, h: 30, qty: 8, category: 'BOX', weight: 10 }], { unit: '高雄分公司', name: '洪佳蓉', phone: '07-4445566#21', agentName: '張裕明', agentPhone: '0955-234-567' }],
     ['D6', 'D1', true, 40, [{ name: '桶裝', l: 60, w: 60, h: 90, qty: 4, category: 'DRUM', weight: 80 }], { unit: '屏東廠', name: '潘俊傑', phone: '08-7778899#33' }],
     ['D9', 'D5', false, 30, [{ name: '長料', l: 480, w: 25, h: 25, qty: 3, category: 'LONG', weight: 30 }], { unit: '雲林倉儲', name: '簡淑芬', phone: '05-5556677#14', agentName: '許志偉', agentPhone: '0966-345-678' }]
    ].forEach(([pick, drop, direct, handleMin, items, recipient]) => { const lm = Math.round(handleMin * 0.6);
      ModuleB.createOrder({ applicant: '研發部-吳承恩', site: pick, destSite: drop, direct, items, recipient,
        pickupLoc: (ModuleB.siteById(pick).buildings || [''])[0], deliverLoc: (ModuleB.siteById(drop).buildings || [''])[0],
        deliverTime: '18:00', loadMin: lm, unloadMin: handleMin - lm }); });
    bApply.resultIds = null; renderBGrid(); toast('已載入 5 筆去程範例（含 1 直達）', 'ok');
  };
  $('#bq-demo-ret').onclick = () => {
    // 回程北上：收貨南部據點 → 送回基地（主檔 homeSite）
    [['D2', DB.homeSite, true, 30, [{ name: '紙箱', l: 50, w: 40, h: 40, qty: 12, category: 'BOX', weight: 15 }], { unit: '台北總部收發', name: '謝孟儒', phone: '02-27001234#500', agentName: '王品瑄', agentPhone: '0977-456-789' }],
     ['D3', DB.homeSite, false, 20, [{ name: '易碎件', l: 60, w: 50, h: 50, qty: 3, category: 'FRAG', weight: 20 }], { unit: '研發部', name: '吳承恩', phone: '02-27005678#412' }],
     ['D5', DB.homeSite, false, 15, [{ name: '小箱', l: 40, w: 30, h: 25, qty: 6, category: 'BOX', weight: 8 }], { unit: '中央倉', name: '林曉琪', phone: '02-27009999#601', agentName: '陳柏宇', agentPhone: '0988-567-890' }]
    ].forEach(([pick, drop, direct, handleMin, items, recipient]) => { const lm = Math.round(handleMin * 0.6);
      ModuleB.createOrder({ applicant: '業務部-周雅婷', site: pick, destSite: drop, direct, items, recipient,
        pickupLoc: (ModuleB.siteById(pick).buildings || [''])[0], deliverLoc: (ModuleB.siteById(drop).buildings || [''])[0],
        deliverTime: '19:00', loadMin: lm, unloadMin: handleMin - lm }); });
    bApply.resultIds = null; renderBGrid(); toast('已載入 3 筆回程範例（含 1 直達）', 'ok');
  };
  renderBGrid();
}
function runBQuery() {
  bApply.query = {
    applicant: $('#bq-applicant').value.trim(),
    site: $('#bq-site').value, direct: $('#bq-direct').value, status: $('#bq-status').value,
  };
  const q = bApply.query;
  const res = ModuleB.orders.filter(o =>
    (!q.applicant || o.applicant.includes(q.applicant)) &&
    (!q.site || o.pickSite === q.site || o.dropSite === q.site) &&
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
      <th></th><th>單號</th><th>申請人</th><th>收貨→送貨據點</th><th>型態</th><th>貨量</th><th>車號</th><th>來收時間</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(o => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-detail="${o.id}">細節</button></td>
        <td><b style="color:var(--navy);">${o.id}</b></td><td>${o.applicant}</td>
        <td>${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}</td>
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
  const bCanEdit = ['submitted', 'approved'].includes(o.status); // 派車(loaded)後不可編輯貨物
  let action = '';
  if (o.status === 'loaded') action = `<button class="btn btn-accent" data-brecv="${o.id}">確認已收到貨</button>`;
  else if (o.status === 'delivered') action = '<span class="badge b-green">✓ 已完成</span>';
  p.innerHTML = `
    <div class="section-h">幹線託運單明細 · ${o.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(o.status)}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${o.id}</div></div>
        <div class="field"><label>申請人</label><div>${o.applicant}</div></div>
        <div class="field"><label>收貨據點（起）</label><div>${ModuleB.siteById(o.pickSite).name}<span class="hint" style="margin-left:6px;">幹線車到此收貨</span></div></div>
        <div class="field"><label>送貨據點（迄）</label><div>${ModuleB.siteById(o.dropSite).name}<span class="hint" style="margin-left:6px;">送達此據點</span></div></div>
        <div class="field"><label>收貨地點（建物）</label><div>${o.pickupLoc || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>送貨地點（建物）</label><div>${o.deliverLoc || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>派送型態</label><div>${o.direct ? '直達（單一目的地 G38）' : '非直達（沿線收送）'}</div></div>
        <div class="field"><label>交貨時間</label><div>${o.deliverTime || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>貨量 / 重量</label><div>${o.volume}L / ${o.weight}kg</div></div>
        <div class="field"><label>有效體積（容量計算用）</label><div><b>${ModuleB.effVolume(o).toFixed(0)}L</b></div></div>
        <div class="field"><label>上貨 / 下貨時間</label><div>${o.loadMin || 0} 分 / ${o.unloadMin || 0} 分（合計 ${o.handleMin} 分）</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(o.createdAt)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      <div class="field"><div>${recipientDisplay(o.recipient)}</div></div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        ${bCanEdit ? `<button class="btn btn-accent btn-sm" id="bd-add">＋ 新增</button>` : ''}</div>
      <div id="bd-items"></div>
      ${bCanEdit ? `<div class="muted" style="margin-top:6px;">此單尚未派車，可新增／編輯／刪除貨物項目。</div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">派車資訊</div>
      <div class="grid-2">
        <div class="field"><label>指派車號</label><div>${veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '<span class="muted">尚未派車</span>'}</div></div>
        <div class="field"><label>預計來收時間</label><div>${o.pickupTime ? `<b style="color:var(--navy);">${o.pickupTime}</b>　<span class="hint">幹線車抵達「${ModuleB.siteById(o.pickSite).name}」收貨的時間</span>` : '<span class="muted">待派車</span>'}</div></div>
      </div>
      ${action ? `<div class="divider"></div><div><b>接收人操作：</b> ${action}</div>` : ''}
    </div>
    ${backBar('bd-back')}`;
  renderCargoGrid('#bd-items', o.items, bCanEdit, () => { ModuleB.recompute(o); RENDER.b_apply(); });
  if (bCanEdit) {
    const add = $('#bd-add');
    if (add) add.onclick = () => openCargoEditor(null, it => { o.items.push(it); ModuleB.recompute(o); RENDER.b_apply(); });
  }
  $('#bd-back').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  const rcv = $('#page-b_apply [data-brecv]');
  if (rcv) rcv.onclick = confirmThen({ title: '確認已收到貨？', text: '確認後此託運單將標記為已交貨。' }, () => { ModuleB.confirmDelivery(o, o.applicant); toast(`${o.id} 已確認收到貨`, 'ok'); RENDER.b_apply(); if ($('#br-tracking')) renderBr_tracking(); });
}

/* ---------- 新增畫面 ---------- */
let baItems = []; // 幹線新增表單的貨物項目暫存（每筆含獨立尺寸與重量，比照 A）
function renderBaCargo() { renderCargoGrid('#ba-items', baItems, true, renderBaCargo); }
function renderBApplyNew(p) {
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">新增幹線託運單</div>
    <div class="card">
      <div class="card-title">建立幹線託運單 <span class="g-tag">G38/G40</span></div>
      <div class="field"><label>申請人</label><input type="text" id="ba-applicant" value="研發部-吳承恩"></div>
      <div class="callout info" style="margin-bottom:10px;">行程方向由系統依<b>收貨據點（起）／送貨據點（迄）</b>自動判斷（送貨據點較南＝南下、較北＝北上），無需自行勾選。<br>
        目前基地為 <b>${ModuleB.siteById(DB.homeSite).name}</b>；現行車次模型為「自基地南下、折返北上回基地」，<b>基地以北據點尚未納入排班</b>（排班方式待業務確認）。</div>
      <div class="row">
        <div class="field"><label id="ba-site-label">收貨據點（起）</label><select id="ba-site">${siteOpts}</select></div>
        ${bldgFieldHtml('收貨建物', 'ba-pickbldg', 'ba-pickother')}
      </div>
      <div class="row">
        <div class="field"><label>送貨據點（迄）</label><select id="ba-dest">${siteOpts}</select></div>
        ${bldgFieldHtml('送貨建物', 'ba-dropbldg', 'ba-dropother')}
      </div>
      <div class="field"><label>派送型態 <span class="hint">直達不湊單、單一目的地 G38</span></label>
        <div class="radio-group">
          <label class="radio-pill sel" id="ba-nd"><input type="radio" name="ba-direct" value="0" checked>非直達（沿線收送）</label>
          <label class="radio-pill" id="ba-d"><input type="radio" name="ba-direct" value="1">直達</label>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>交貨時間（幾點交貨）</label><input type="time" id="ba-deliver" value="15:00"></div>
        <div class="field"><label>上貨時間 (分，G35)</label><input type="number" id="ba-load" value="20"></div>
        <div class="field"><label>下貨時間 (分，G35)</label><input type="number" id="ba-unload" value="10"></div>
      </div>
      ${recipientFieldsHtml('ba')}
      <div class="divider"></div>
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        <button class="btn btn-accent btn-sm" id="ba-add">＋ 新增</button></div>
      <div id="ba-items"></div>
      <div class="divider"></div>
      <button class="btn btn-primary" id="ba-submit">▶ 送出申請（待業務審核）</button>
      <button class="btn btn-ghost" id="ba-cancel">取消</button>
    </div>
    ${backBar('bn-back')}`;
  $('#bn-back').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  const setDirect = () => {
    $('#ba-nd').classList.toggle('sel', $('#page-b_apply input[value="0"]').checked);
    $('#ba-d').classList.toggle('sel', $('#page-b_apply input[value="1"]').checked);
  };
  $$('#page-b_apply input[name=ba-direct]').forEach(r => r.onchange = setDirect);
  wireBldg('ba-site', 'ba-pickbldg', 'ba-pickother', siteBuildings); // 收貨建物
  wireBldg('ba-dest', 'ba-dropbldg', 'ba-dropother', siteBuildings); // 送貨建物
  // 預設：自基地北端收貨、送往南部（可自行改；方向由起迄自動判斷 B-2）
  $('#ba-site').value = 'D6'; $('#ba-dest').value = 'D3';
  $('#ba-site').onchange(); $('#ba-dest').onchange(); // 依預設據點重填建物選單
  renderBaCargo(); // 一開始顯示空白清單
  $('#ba-add').onclick = () => openCargoEditor(null, it => { baItems.push(it); renderBaCargo(); });
  $('#ba-cancel').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  $('#ba-submit').onclick = async () => {
    if (baItems.length === 0) { toast('請至少新增一項貨物', 'err'); return; }
    if ($('#ba-site').value === $('#ba-dest').value) { toast('收貨據點與送貨據點不可相同', 'err'); return; }
    const ok = await confirmDialog({ title: '確認送出幹線託運單？',
      text: '送出後將等待主管准駁，再由業務單位派車。' });
    if (!ok) return;
    const o = ModuleB.createOrder({
      applicant: $('#ba-applicant').value,
      site: $('#ba-site').value,
      destSite: $('#ba-dest').value,
      pickupLoc: bldgVal('ba-pickbldg', 'ba-pickother'),
      deliverLoc: bldgVal('ba-dropbldg', 'ba-dropother'),
      deliverTime: $('#ba-deliver').value,
      recipient: recipientVal('ba'),
      direct: $('#page-b_apply input[value="1"]').checked,
      loadMin: +$('#ba-load').value || 0, unloadMin: +$('#ba-unload').value || 0,
      items: baItems.map(x => ({ ...x })),
    });
    baItems = [];
    toast(`${o.id} 已送出，等待業務審核`, 'ok');
    bApply.resultIds = null; bApply.view = 'detail'; bApply.detailId = o.id;
    RENDER.b_apply();
  };
}
// 相容：審核端動作呼叫此函式刷新申請端 grid
function renderBaList() { if ($('#bq-grid')) renderBGrid(); }

/* ============================================================
   模組 B · 主管准駁（直屬主管）— 查詢 / grid / 明細審核
   ============================================================ */
let bApprove = { view: 'list', detailId: null, query: { applicant: '', leg: '', status: '' } };

RENDER.b_approve = function () {
  const p = $('#page-b_approve');
  if (bApprove.view === 'detail') return renderBApproveDetail(p, bApprove.detailId);
  return renderBApproveList(p);
};
function bApproveRows() {
  const q = bApprove.query;
  return ModuleB.orders.filter(o =>
    (!q.applicant || o.applicant.includes(q.applicant)) &&
    (!q.leg || (q.leg === 'return' ? !ModuleB.isSouthbound(o) : ModuleB.isSouthbound(o))) && // 方向由起迄推導（B-2）
    (!q.status || o.status === q.status));
}
function renderBApproveList(p) {
  const q = bApprove.query;
  const legOpts = [['', '全部方向'], ['outbound', '去程'], ['return', '回程']]
    .map(([v, t]) => `<option value="${v}" ${q.leg === v ? 'selected' : ''}>${t}</option>`).join('');
  const stOpts = [['', '全部狀態'], ['submitted', '待准駁'], ['approved', '已核准'], ['rejected', '已駁回']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">主管准駁（直屬主管）</div>
    <div class="section-sub">員工建立幹線託運單後由直屬主管准駁。點「細節」進入單據檢視與審核；駁回保留紀錄但不進派車池。（G63）</div>
    <div class="card">
      <div class="card-title">查詢條件</div>
      <div class="grid-2">
        <div class="field"><label>申請人（模糊）</label><input type="text" id="bap-q-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字"></div>
        <div class="field"><label>行程方向</label><select id="bap-q-leg">${legOpts}</select></div>
        <div class="field"><label>狀態</label><select id="bap-q-status">${stOpts}</select></div>
      </div>
      <button class="btn btn-primary btn-sm" id="bap-search">🔍 查詢</button>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>待准駁 / 已處理託運單</span>
        <button class="btn btn-accent btn-sm" id="bap-approve-all">✓ 全部核准</button>
      </div>
      <div id="bap-grid"></div>
    </div>`;
  $('#bap-search').onclick = () => {
    bApprove.query = { applicant: $('#bap-q-applicant').value.trim(), leg: $('#bap-q-leg').value, status: $('#bap-q-status').value };
    renderBApproveGrid(); toast('查詢完成', 'ok');
  };
  $('#bap-approve-all').onclick = confirmThen({ title: '確認全部核准？', text: '確認後將核准目前清單中所有「待准駁」託運單。' }, () => {
    const subs = bApproveRows().filter(o => o.status === 'submitted');
    subs.forEach(o => ModuleB.approve(o));
    toast(`已核准 ${subs.length} 筆`, 'ok');
    renderBApproveGrid(); renderBaList(); if ($('#br-approved')) renderBr_approved();
  });
  renderBApproveGrid();
}
function renderBApproveGrid() {
  if (!$('#bap-grid')) return;
  const rows = bApproveRows();
  $('#bap-grid').innerHTML = rows.length === 0 ? `<div class="empty">查無符合條件的託運單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>方向</th><th>收貨→送貨據點</th><th>型態</th><th>貨量</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(o => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-bvdetail="${o.id}">細節</button></td>
        <td><b style="color:var(--navy);">${o.id}</b></td><td>${o.applicant}</td>
        <td>${ModuleB.isSouthbound(o) ? '去程（南下）' : '回程（北上）'}</td>
        <td>${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${stBadge(o.status)}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('#bap-grid [data-bvdetail]').forEach(b => b.onclick = () => { bApprove.detailId = b.dataset.bvdetail; bApprove.view = 'detail'; RENDER.b_approve(); });
}
function renderBApproveDetail(p, id) {
  const o = ModuleB.orders.find(x => x.id === id);
  if (!o) { bApprove.view = 'list'; return RENDER.b_approve(); }
  const pending = o.status === 'submitted';
  p.innerHTML = `
    <div class="section-h">託運單審核 · ${o.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(o.status)}</div>
      <div class="grid-2">
        <div class="field"><label>單號</label><div>${o.id}</div></div>
        <div class="field"><label>申請人</label><div>${o.applicant}</div></div>
        <div class="field"><label>行程方向 <span class="hint">由起迄自動判斷</span></label><div>${ModuleB.isSouthbound(o) ? '去程（南下）' : `回程（北上回 ${ModuleB.siteById(DB.homeSite).name}）`}</div></div>
        <div class="field"><label>收貨據點（起）</label><div>${ModuleB.siteById(o.pickSite).name}</div></div>
        <div class="field"><label>送貨據點（迄）</label><div>${ModuleB.siteById(o.dropSite).name}</div></div>
        <div class="field"><label>收貨地點（建物）</label><div>${o.pickupLoc || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>送貨地點（建物）</label><div>${o.deliverLoc || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>派送型態</label><div>${o.direct ? '直達（單一目的地 G38）' : '非直達（沿線收送）'}</div></div>
        <div class="field"><label>交貨時間</label><div>${o.deliverTime || '<span class="muted">—</span>'}</div></div>
        <div class="field"><label>貨量 / 重量</label><div>${o.volume}L / ${o.weight}kg</div></div>
        <div class="field"><label>有效體積（容量計算用）</label><div><b>${ModuleB.effVolume(o).toFixed(0)}L</b></div></div>
        <div class="field"><label>上貨 / 下貨時間</label><div>${o.loadMin || 0} 分 / ${o.unloadMin || 0} 分（合計 ${o.handleMin} 分）</div></div>
        <div class="field"><label>建立時間</label><div>${fmtTime(o.createdAt)}</div></div>
        ${o.reviewNote ? `<div class="field"><label>審核備註</label><div>${o.reviewNote}</div></div>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      <div class="field"><div>${recipientDisplay(o.recipient)}</div></div>
    </div>
    <div class="card">
      <div class="card-title">貨物項目</div>
      <div id="bap-detail-items"></div>
    </div>
    ${pending ? `
    <div class="card">
      <div class="card-title">主管審核 <span class="g-tag">G63</span></div>
      <div class="field"><label>是否同意</label>
        <div class="radio-group">
          <label class="radio-pill sel" id="bsv-yes-pill"><input type="radio" name="bsv-agree" value="yes" checked>是</label>
          <label class="radio-pill" id="bsv-no-pill"><input type="radio" name="bsv-agree" value="no">否</label>
        </div>
      </div>
      <div class="field"><label>審核備註 <span class="hint" id="bsv-req" style="display:none;color:#c0392b;">（駁回時必填）</span></label>
        <input type="text" id="bsv-note" placeholder="請輸入審核意見（駁回為必填）"></div>
      <div style="text-align:center;margin-top:22px;">
        <button class="btn btn-primary" id="bsv-submit">▶ 送出</button>
        <button class="btn btn-ghost" id="bsv-cancel">取消</button>
      </div>
    </div>` : backBar('bsv-back')}`;
  renderCargoGrid('#bap-detail-items', o.items, false); // 審核端唯讀
  if (pending) {
    const syncReq = () => {
      const no = $('#page-b_approve input[name=bsv-agree][value=no]').checked;
      $('#bsv-yes-pill').classList.toggle('sel', !no);
      $('#bsv-no-pill').classList.toggle('sel', no);
      $('#bsv-req').style.display = no ? 'inline' : 'none';
    };
    $$('#page-b_approve input[name=bsv-agree]').forEach(r => r.onchange = syncReq);
    $('#bsv-submit').onclick = () => {
      const agree = $('#page-b_approve input[name=bsv-agree]:checked').value === 'yes';
      const note = $('#bsv-note').value.trim();
      if (!agree && !note) { toast('駁回時「審核備註」為必填', 'err'); $('#bsv-note').focus(); return; }
      if (agree) { ModuleB.approve(o, note); toast(`${o.id} 已核准`, 'ok'); }
      else { ModuleB.reject(o, note); toast(`${o.id} 已駁回`, 'err'); }
      bApprove.view = 'list'; RENDER.b_approve(); renderBaList(); if ($('#br-approved')) renderBr_approved();
    };
    $('#bsv-cancel').onclick = () => { bApprove.view = 'list'; RENDER.b_approve(); };
  } else {
    $('#bsv-back').onclick = () => { bApprove.view = 'list'; RENDER.b_approve(); };
  }
}

/* ============================================================
   模組 B · 派車調度（業務單位）— 派車決策 / 決策矩陣 / 貨況追蹤
   ============================================================ */
RENDER.b_review = function () {
  const p = $('#page-b_review');
  p.innerHTML = `
    <div class="section-h">派車調度（業務單位）</div>
    <div class="section-sub">對已核准託運單依核准時間排序派車：貪婪終點判斷 / 直達獨立派車 / 回程全域直達鎖定，並顯示派遣模式與觸發原因。主管准駁為獨立單元。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="br-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
    <div class="card">
      <div class="card-title">派車決策（調度室）<span class="g-tag">G32/G40/G44</span></div>
      <div class="card-desc">僅對已核准託運單派車，依核准時間排序逐張檢查。系統顯示每台車派遣模式與觸發原因。</div>
      <div class="row" style="max-width:420px;align-items:end;margin-bottom:10px;">
        <div class="field"><label>派車日 <span class="hint">媒合截止＝前 ${DB.matchCutoffDaysBefore} 天 ${DB.matchCutoffTime}（2.14）</span></label>
          <input type="date" id="br-dispatch-date"></div>
      </div>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px;font-weight:600;">去程</div>
      <button class="btn btn-accent" id="br-dispatch-direct">派直達車</button>
      <button class="btn btn-primary" id="br-dispatch-greedy">派非直達車（貪婪）</button>
      <div style="font-size:12px;color:var(--ink-soft);margin:12px 0 6px;font-weight:600;">回程（全域直達鎖定 G40）</div>
      <button class="btn btn-primary" id="br-dispatch-return">派回程車（非直達）</button>
      <button class="btn btn-ghost" id="br-dispatch-return-direct">派回程車（原為直達車）</button>
      <div id="br-approved" style="margin-top:14px;"></div>
      <div id="br-dispatch-result"></div>
    </div>
    <div id="br-vehstatus">${renderB_vehicleStatus()}</div>
    <div id="br-matrix">${renderB_matrix()}</div>
    <div class="card">
      <div class="card-title">已派車貨況一覽（被安排車次 · 派遣模式 · 交貨追蹤）</div>
      <div class="card-desc">顯示每張已派車託運單的車輛、派遣模式、終點與交貨狀態。交貨可由接收人於申請端確認收到，或由調度室在此確認送達。</div>
      <div id="br-tracking"></div>
    </div>`;
  $('#br-dispatch-direct').onclick = confirmThen({ title: '確認派直達車？', text: '確認後將對已核准直達單執行派車。' }, () => dispatchB('direct'));
  $('#br-dispatch-greedy').onclick = confirmThen({ title: '確認派非直達車？', text: '確認後將以貪婪法對已核准託運單執行派車。' }, () => dispatchB('greedy'));
  $('#br-dispatch-return').onclick = confirmThen({ title: '確認派回程車（非直達）？', text: '確認後將執行回程派車與全域直達鎖定檢查。' }, () => dispatchBReturn(false));
  $('#br-dispatch-return-direct').onclick = confirmThen({ title: '確認派回程車（原為直達車）？', text: '確認後將以直達模式執行回程派車。' }, () => dispatchBReturn(true));
  $('#br-goto-driver').onclick = () => goto('b_driver');
  // 派車日預設為「今天＋前置天數＋1」，確保預設情境下既有單皆趕得上媒合截止
  const _d = new Date(); _d.setDate(_d.getDate() + DB.matchCutoffDaysBefore + 1);
  $('#br-dispatch-date').value = `${_d.getFullYear()}-${pad2(_d.getMonth() + 1)}-${pad2(_d.getDate())}`;
  renderBr_approved(); renderBr_tracking();
};
// 3.7 五列決策矩陣（G44 顯示，供調度員覆核）— 資料來源＝ModuleB.DECISION_MATRIX 單一決策表（B-4）
function renderB_matrix(activeRow) {
  return `<div class="card">
    <div class="card-title">派遣模式決策矩陣（3.7 · G44）</div>
    <div class="card-desc">五種情境的容量計算、終點與中途停靠規則（單一決策表驅動 B-4），供調度員一眼覆核。派車後會標示本趟落在哪一列。</div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>#</th><th>情境</th><th>容量計算</th><th>終點</th><th>中途停靠</th></tr></thead><tbody>
      ${ModuleB.DECISION_MATRIX.map(m => `<tr${activeRow && m.row === activeRow ? ' style="outline:2px solid var(--accent);outline-offset:-2px;"' : ''}>
        <td>${m.row}</td><td>${activeRow && m.row === activeRow ? '<b>' + m.mode + '</b> <span class="badge b-amber">本趟</span>' : m.mode}</td>
        <td>${m.capacity}</td><td>${m.endpoint}</td><td>${m.stops}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
// B-6：每台車目前的派遣模式與觸發原因（維持 2.3「可解釋、調度員一眼看懂」）
function renderB_vehicleStatus() {
  const entries = Object.entries(ModuleB.vehicleStatus);
  const body = entries.length === 0
    ? `<div class="empty">尚無派車紀錄。執行派車後，此處顯示每台車的目前模式、觸發原因與終點判定依據。</div>`
    : `<div class="table-wrap"><table class="dt"><thead><tr>
        <th>車輛</th><th>目前模式</th><th>觸發原因</th><th>終點</th><th>終點判定依據</th></tr></thead><tbody>
        ${entries.map(([vid, s]) => { const veh = DB.vehicles.find(v => v.id === vid);
          const amber = s.matrixRow === 2 || s.matrixRow === 4 || s.matrixRow === 5;
          return `<tr><td><b style="color:var(--navy);">${vid}</b>${veh ? '（' + veh.name + '）' : ''}</td>
            <td><span class="badge ${amber ? 'b-amber' : 'b-navy'}">${s.modeLabel}</span> <span class="hint">矩陣第 ${s.matrixRow} 列</span></td>
            <td style="text-align:left;">${s.reason}</td>
            <td>${ModuleB.siteById(s.endpoint) ? ModuleB.siteById(s.endpoint).name : s.endpoint}</td>
            <td>${s.endpointBasis}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  return `<div class="card">
    <div class="card-title">車輛派遣狀態（模式與觸發原因）<span class="g-tag">3.8 / B-6</span></div>
    <div class="card-desc">疊加直達分流與回程鎖定後，光看貪婪法已無法判斷車輛狀態；此表顯示每台車目前的派遣模式（五列之一）、觸發原因與終點判定依據。</div>
    ${body}</div>`;
}
function renderBr_tracking() {
  if (!$('#br-tracking')) return;
  const rows = ModuleB.orders.filter(o => ['loaded', 'delivered'].includes(o.status));
  $('#br-tracking').innerHTML = rows.length === 0 ? `<div class="empty">尚無已派車託運單。核准後派車即會出現在此。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>路線</th><th>派遣模式</th><th>車輛</th><th>貨量</th>
      <th>交貨</th><th>操作</th></tr></thead><tbody>
      ${rows.map(o => {
        const veh = o.dispatchVehicle ? DB.vehicles.find(v => v.id === o.dispatchVehicle) : null;
        const del = o.status === 'delivered' ? '<span class="badge b-green">已交貨</span>' : '<span class="badge b-gray">未交貨</span>';
        let op = '<span class="muted">—</span>';
        if (o.status === 'loaded') op = `<button class="btn btn-accent btn-sm" data-bdeliver="${o.id}">確認交貨</button>`;
        else if (o.status === 'delivered') op = `<span class="muted">${o.deliveredBy || ''} 完成</span>`;
        const modeBadge = o.dispatchMode === '直達' ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>';
        const route = `${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}`;
        return `<tr><td>${o.id}</td><td>${o.applicant}</td><td>${route}</td>
          <td>${modeBadge}</td><td>${veh ? veh.name : '—'}</td><td>${o.volume}L</td>
          <td>${del}</td><td>${op}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $$('#br-tracking [data-bdeliver]').forEach(b => b.onclick = confirmThen({ title: '確認交貨？', text: '確認後此託運單將標記為已交貨。' }, () => {
    const o = ModuleB.orders.find(x => x.id === b.dataset.bdeliver);
    ModuleB.confirmDelivery(o, '調度室'); toast(`${o.id} 已確認交貨`, 'ok');
    renderBr_tracking(); renderBaList();
  }));
};
function renderBr_approved() {
  if (!$('#br-approved')) return;
  const rows = ModuleB.orders.filter(o => o.status === 'approved');
  $('#br-approved').innerHTML = rows.length === 0 ? `<div class="muted">尚無已核准待派車託運單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>方向</th><th>路線</th><th>型態</th><th>貨量</th><th>裝卸</th></tr></thead><tbody>
      ${rows.map(o => `<tr><td>${o.id}${ModuleB.isServable(o) ? '' : ' <span class="badge b-red" title="' + ModuleB.unservableReason(o) + '">基地以北・待確認</span>'}</td>
        <td>${ModuleB.isSouthbound(o) ? '<span class="badge b-navy">南下</span>' : '<span class="badge b-gray">北上</span>'}</td>
        <td>${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${o.handleMin}分</td></tr>`).join('')}
    </tbody></table></div>`;
}
function updateBMatrix(row) {
  const m = $('#br-matrix'); if (m) m.innerHTML = renderB_matrix(row);
  const vs = $('#br-vehstatus'); if (vs) vs.innerHTML = renderB_vehicleStatus(); // B-6 同步更新
}
// 共用派車結果渲染（去程/回程通用）
function renderBDispatchResult(r, startLabel) {
  const endpoint = r.endpoint ? ModuleB.siteById(r.endpoint).name : '—';
  const amber = r.locked || r.mode === 'direct' || r.matrixRow === 2 || r.matrixRow === 5;
  const modeBadge = `<span class="badge ${amber ? 'b-amber' : 'b-navy'}">${r.modeLabel}</span>`;
  let routeViz = '';
  if (r.stops && r.stops.length) {
    const back = r.mode && r.mode.startsWith('return');
    const startStop = `<div class="stop hit"><div class="s-name">${startLabel}</div><div class="s-meta">${back ? '折返起點' : '出發'}</div></div>`;
    const stopHtml = r.stops.map(s => `<div class="stop ${s.site.id === r.endpoint ? 'end' : ((s.count || s.unloaded) ? 'hit' : 'skip')}">
        <div class="s-name">${s.site.name}</div><div class="s-meta">${[s.count ? '收 ' + s.count + ' 單' : '', s.unloaded ? '卸 ' + s.unloaded + 'L' : ''].filter(Boolean).join('／') || '無貨'}｜車上 ${s.cumVol}L</div></div>`).join('');
    const endStop = back ? `<div class="stop end"><div class="s-name">${ModuleB.siteById(DB.homeSite).name}</div><div class="s-meta">回到出發據點</div></div>` : '';
    routeViz = `<div class="route" style="margin-top:12px;">${back ? '' : startStop}${stopHtml}${back ? endStop : ''}</div>`;
  }
  const deferredHtml = (r.deferred && r.deferred.length)
    ? `<div style="margin-top:6px;">被排擠順延（G42）：${r.deferred.map(o => o.id).join(', ')}</div>` : '';
  $('#br-dispatch-result').innerHTML = `
    <div class="result ${r.carried && r.carried.length ? 'ok' : 'warn'}" style="margin-top:16px;">
      <div class="r-head">派車模式：${modeBadge}　終點：${endpoint}${r.days && r.days !== '—' ? `　出勤天數：${r.days} 天 <span class="g-tag">G37</span>` : ''}</div>
      <div>觸發原因：${r.reason || '—'}｜容量使用 <b>${r.capUsed || 0}L</b> / ${r.capTotal || 0}L${
        r.timeUsed != null ? `｜當日在勤 <b>${r.timeUsed}分</b> / ${r.timeTotal}分（12.5h，2.13）` : ''}${
        r.dutyDays ? `｜精算出勤 <b>${r.dutyDays}</b> 天` : ''}</div>
      ${r.breaks && r.breaks.length ? `<div style="margin-top:6px;">司機休息用餐（2.12）：${r.breaks.join('、')}</div>` : ''}
      ${r.refDays != null ? `<div style="margin-top:6px;">最短天數表參考（3.1，不參與運算）：<b>${r.refDays} 天</b>${
        r.daysOver ? ' <span class="badge b-amber">▲ 本趟預估天數超出表定值，以精算為準照常派車</span>' : ''}</div>` : ''}
      ${r.naturalDirect ? `<div style="margin-top:6px;"><span class="badge b-gray">自然直達</span> 時間額度不足以順路停靠，屬排程結果，不觸發獨立派車或回程鎖定（3.2）</div>` : ''}
      ${r.stopReason ? `<div style="margin-top:6px;" class="muted">終點停止延伸原因：${r.stopReason}</div>` : ''}
      ${r.lateOrders && r.lateOrders.length ? `<div style="margin-top:6px;">逾媒合截止自動順延（2.14）：${r.lateOrders.map(o => o.id + (o.deferredToDate ? '→' + o.deferredToDate : '')).join('、')}</div>` : ''}
      ${r.carried ? `<div style="margin-top:6px;">載運：${r.carried.map(o => o.id).join(', ') || '（無）'}</div>` : ''}
      ${r.delivered && r.delivered.length ? `<div style="margin-top:6px;">沿線卸貨送達（G33）：${r.delivered.map(o => o.id + '→' + ModuleB.siteById(o.dropSite).name).join('、')}</div>` : ''}
      ${deferredHtml}
      ${routeViz}
    </div>
    <div class="trace">${r.trace.join('\n')}</div>`;
  updateBMatrix(r.matrixRow);
}
function dispatchB(mode) {
  const veh = mode === 'direct' ? 'V-T02' : 'V-T01';
  const dateEl = $('#br-dispatch-date');
  const r = ModuleB.dispatch(veh, mode, dateEl && dateEl.value ? dateEl.value : null);
  renderBDispatchResult(r, ModuleB.siteById(DB.homeSite).name);
  toast(`${r.modeLabel || ''} 派車完成`, 'ok');
  renderBr_approved(); renderBaList(); renderBr_tracking();
}
function dispatchBReturn(originallyDirect) {
  // 回程＝北上貨（方向由起迄推導 B-2）
  const rets = ModuleB.orders.filter(o => o.status === 'approved' && !ModuleB.isSouthbound(o));
  if (!originallyDirect && rets.length === 0) { toast('無已核准北上（回程）託運單，請先核准回程單', 'err'); return; }
  // 折返起點＝最南端的已核准回程收貨據點（涵蓋所有回程收貨），無則取最南據點
  let turnaround = DB.sites.reduce((m, s) => s.order < m.order ? s : m, DB.sites[0]).id;
  if (rets.length) turnaround = rets.reduce((min, o) =>
    ModuleB.siteById(o.pickSite).order < ModuleB.siteById(min).order ? o.pickSite : min, rets[0].pickSite);
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
    <div class="section-h">出差用車申請明細 · ${a.id}</div>
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
    </div>` : ''}
    ${backBar('cd-back')}`;
  $('#cd-back').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  const brd = $('#page-c_apply [data-board]');
  if (brd) brd.onclick = confirmThen({ title: '確認上車？', text: '確認後此趟共乘將標記為已上車。' }, () => { ModuleC.confirmBoard(a); toast(`${a.id} 已確認上車`, 'ok'); RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track(); });
  const dn = $('#page-c_apply [data-done]');
  if (dn) dn.onclick = confirmThen({ title: '確認行程完成？', text: '確認後此趟共乘將標記為行程完成。' }, () => { ModuleC.completeTrip(a, a.applicant); toast(`${a.id} 行程完成`, 'ok'); RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track(); });
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
    $$('#cd-candidates [data-merge]').forEach(b => b.onclick = confirmThen({ title: '確認完成合併？', text: '請先聯繫對方確認同意，確認後即向該已派車單搭便車、合併成立。' }, () => {
      const target = ModuleC.applications.find(x => x.id === b.dataset.merge);
      ModuleC.doManualMerge(a, target);
      toast(`${a.id} 已搭 ${target.id} 便車，合併成立`, 'ok');
      RENDER.c_apply(); if ($('#cr-tab-track')) renderCr_track();
    }));
  };
}

/* ---------- 新增畫面 ---------- */
function renderCApplyNew(p) {
  const oOpts = DB.bizOrigins.map(o => `<option>${o}</option>`).join('');
  const dOpts = DB.bizDests.map(d => `<option>${d}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">新增出差用車申請單</div>
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
    </div>
    ${backBar('cn-back')}`;
  $('#cn-back').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  const setType = () => {
    const round = $('#page-c_apply input[value=round]').checked;
    $('#ca-round').classList.toggle('sel', round);
    $('#ca-oneway').classList.toggle('sel', !round);
    $('#ca-return-wrap').style.display = round ? 'block' : 'none';
  };
  $$('#page-c_apply input[name=ca-type]').forEach(r => r.onchange = setType);
  // 回程日期不可早於出發日期（來回單多天任務依賴正確 returnDate：保修/佔用/C-3 全程檢核）
  const syncRDateMin = () => { $('#ca-rdate').min = $('#ca-date').value || ''; };
  $('#ca-date').onchange = syncRDateMin; syncRDateMin();
  $('#ca-cancel').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  $('#ca-submit').onclick = async () => {
    const type = $('#page-c_apply input[name=ca-type]:checked').value;
    const departDate = $('#ca-date').value;
    const returnDate = type === 'round' ? $('#ca-rdate').value : departDate;
    // 輸入驗證：來回單必須有回程日期且不早於出發日期，避免多天任務被誤當單日退化（保修/佔用漏中間天）
    if (!departDate) { toast('請選擇出發日期', 'err'); return; }
    if (type === 'round') {
      if (!returnDate) { toast('來回單請選擇回程日期', 'err'); return; }
      if (returnDate < departDate) { toast('回程日期不可早於出發日期', 'err'); return; }
    }
    const ok = await confirmDialog({ title: '確認送出出差用車申請？',
      text: '送出後將等待主管准駁，再由系統批次媒合。' });
    if (!ok) return;
    const app = ModuleC.createApp({
      applicant: $('#ca-applicant').value, dept: $('#ca-dept').value, ext: $('#ca-ext').value,
      type, origin: $('#ca-origin').value, dest: $('#ca-dest').value,
      departDate, earliestPickup: $('#ca-pickup').value,
      returnDate,
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
let cApprove = { view: 'list', detailId: null, query: { applicant: '', type: '', status: '' } };

RENDER.c_approve = function () {
  const p = $('#page-c_approve');
  if (cApprove.view === 'detail') return renderCApproveDetail(p, cApprove.detailId);
  return renderCApproveList(p);
};
function cApproveRows() {
  const q = cApprove.query;
  return ModuleC.applications.filter(a =>
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.type || a.type === q.type) &&
    (!q.status || a.status === q.status));
}
function renderCApproveList(p) {
  const q = cApprove.query;
  const typeOpts = [['', '全部型態'], ['round', '來回單'], ['oneway', '單程單']]
    .map(([v, t]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${t}</option>`).join('');
  const stOpts = [['', '全部狀態'], ['submitted', '待准駁'], ['approved', '已核准'], ['rejected', '已駁回']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">主管准駁（直屬主管）</div>
    <div class="section-sub">員工填單後由直屬主管審核出差用車准駁。點「細節」進入單據檢視與審核；駁回保留紀錄但不進排班池。（G63）</div>
    <div class="card">
      <div class="card-title">查詢條件</div>
      <div class="grid-2">
        <div class="field"><label>申請人（模糊）</label><input type="text" id="cap-q-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字"></div>
        <div class="field"><label>任務型態</label><select id="cap-q-type">${typeOpts}</select></div>
        <div class="field"><label>狀態</label><select id="cap-q-status">${stOpts}</select></div>
      </div>
      <button class="btn btn-primary btn-sm" id="cap-search">🔍 查詢</button>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>待准駁 / 已處理申請單</span>
        <button class="btn btn-accent btn-sm" id="cap-approve-all">✓ 全部核准</button>
      </div>
      <div id="cap-grid"></div>
    </div>`;
  $('#cap-search').onclick = () => {
    cApprove.query = { applicant: $('#cap-q-applicant').value.trim(), type: $('#cap-q-type').value, status: $('#cap-q-status').value };
    renderCApproveGrid(); toast('查詢完成', 'ok');
  };
  $('#cap-approve-all').onclick = confirmThen({ title: '確認全部核准？', text: '確認後將核准目前清單中所有「待准駁」出差用車申請。' }, () => {
    const subs = cApproveRows().filter(a => a.status === 'submitted');
    subs.forEach(a => ModuleC.approve(a));
    toast(`已核准 ${subs.length} 筆`, 'ok');
    renderCApproveGrid(); renderCaList();
  });
  renderCApproveGrid();
}
function renderCApproveGrid() {
  if (!$('#cap-grid')) return;
  const rows = cApproveRows();
  $('#cap-grid').innerHTML = rows.length === 0 ? `<div class="empty">查無符合條件的申請單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>去程</th><th>回程</th><th>人</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-cvdetail="${a.id}">細節</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}（${a.dept}）</td>
        <td>${a.type === 'round' ? '來回' : '單程'}</td><td>${a.origin}→${a.dest}</td>
        <td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.type === 'round' ? a.returnDate.slice(5) + ' ' + a.earliestReturn : '<span class="muted">—</span>'}</td>
        <td>${a.pax}</td><td>${stBadge(a.status, 'C')}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('#cap-grid [data-cvdetail]').forEach(b => b.onclick = () => { cApprove.detailId = b.dataset.cvdetail; cApprove.view = 'detail'; RENDER.c_approve(); });
}
function renderCApproveDetail(p, id) {
  const a = ModuleC.applications.find(x => x.id === id);
  if (!a) { cApprove.view = 'list'; return RENDER.c_approve(); }
  const pending = a.status === 'submitted';
  p.innerHTML = `
    <div class="section-h">出差用車審核 · ${a.id}</div>
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
        ${a.reviewNote ? `<div class="field"><label>審核備註</label><div>${a.reviewNote}</div></div>` : ''}
      </div>
    </div>
    ${pending ? `
    <div class="card">
      <div class="card-title">主管審核 <span class="g-tag">G63</span></div>
      <div class="field"><label>是否同意</label>
        <div class="radio-group">
          <label class="radio-pill sel" id="csv-yes-pill"><input type="radio" name="csv-agree" value="yes" checked>是</label>
          <label class="radio-pill" id="csv-no-pill"><input type="radio" name="csv-agree" value="no">否</label>
        </div>
      </div>
      <div class="field"><label>審核備註 <span class="hint" id="csv-req" style="display:none;color:#c0392b;">（駁回時必填）</span></label>
        <input type="text" id="csv-note" placeholder="請輸入審核意見（駁回為必填）"></div>
      <div style="text-align:center;margin-top:22px;">
        <button class="btn btn-primary" id="csv-submit">▶ 送出</button>
        <button class="btn btn-ghost" id="csv-cancel">取消</button>
      </div>
    </div>` : backBar('csv-back')}`;
  if (pending) {
    const syncReq = () => {
      const no = $('#page-c_approve input[name=csv-agree][value=no]').checked;
      $('#csv-yes-pill').classList.toggle('sel', !no);
      $('#csv-no-pill').classList.toggle('sel', no);
      $('#csv-req').style.display = no ? 'inline' : 'none';
    };
    $$('#page-c_approve input[name=csv-agree]').forEach(r => r.onchange = syncReq);
    $('#csv-submit').onclick = () => {
      const agree = $('#page-c_approve input[name=csv-agree]:checked').value === 'yes';
      const note = $('#csv-note').value.trim();
      if (!agree && !note) { toast('駁回時「審核備註」為必填', 'err'); $('#csv-note').focus(); return; }
      if (agree) { ModuleC.approve(a, note); toast(`${a.id} 已核准`, 'ok'); }
      else { ModuleC.reject(a, note); toast(`${a.id} 已駁回`, 'err'); }
      cApprove.view = 'list'; RENDER.c_approve(); renderCaList();
    };
    $('#csv-cancel').onclick = () => { cApprove.view = 'list'; RENDER.c_approve(); };
  } else {
    $('#csv-back').onclick = () => { cApprove.view = 'list'; RENDER.c_approve(); };
  }
}

/* ============================================================
   模組 C · 媒合調度（業務單位）— 批次媒合 / 逾期作廢 / 派車追蹤
   ============================================================ */
RENDER.c_review = function () {
  const p = $('#page-c_review');
  p.innerHTML = `
    <div class="section-h">媒合調度（業務單位）</div>
    <div class="section-sub">對已核准申請執行批次媒合（未來 7 天）、資源檢核、逾期作廢與派車追蹤。手動併車由申請人於申請端自行處理、主管准駁為獨立單元。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="cr-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
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
  $('#cr-goto-driver').onclick = () => goto('c_driver');
  renderCr_batch(); renderCr_void(); renderCr_track();
};
// 派車追蹤：被安排的車次 · 司機 · 乘客上車/行程完成
function renderCr_track() {
  if (!$('#cr-tab-track')) return;
  // 調度室確認/調整範圍：已媒合與待人工協調單皆可手動指派（C-4，不退回員工重新申請）
  const rows = ModuleC.applications.filter(a => ['matched', 'boarded', 'completed', 'coordinate'].includes(a.status));
  $('#cr-tab-track').innerHTML = `
    <div class="card">
      <div class="card-title">派車追蹤與調度室確認 <span class="g-tag">STEP4 / C-4</span></div>
      <div class="card-desc">顯示每張申請的車輛、司機、併車群組、空駛時間與上車/完成狀態。調度室可<b>直接手動改派</b>（含待人工協調單），不退回員工重新申請；每次調整都留下<b>人工覆寫紀錄</b>，且覆寫後不再被下一次批次重排。</div>
      ${rows.length === 0 ? `<div class="empty">尚無已媒合車次。核准後執行批次媒合即會出現在此。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>單號</th><th>申請人</th><th>路線</th><th>人</th><th>車輛</th><th>司機</th><th>群組</th>
        <th>空駛</th><th>批次</th><th>上車</th><th>行程</th><th>操作</th></tr></thead><tbody>
        ${rows.map(a => {
          const veh = a.vehicle ? DB.vehicles.find(v => v.id === a.vehicle) : null;
          const drv = a.driver ? DB.drivers.find(d => d.id === a.driver) : null;
          const brd = (a.status === 'boarded' || a.status === 'completed')
            ? '<span class="badge b-green">已上車</span>' : '<span class="badge b-gray">待上車</span>';
          const cmp = a.status === 'completed' ? '<span class="badge b-green">已完成</span>' : '<span class="badge b-gray">進行中</span>';
          let op = '';
          if (a.status === 'boarded') op = `<button class="btn btn-accent btn-sm" data-ccomplete="${a.id}">確認完成</button>`;
          else if (a.status === 'completed') op = `<span class="muted">${a.completedBy || ''} 完成</span>`;
          if (a.status !== 'completed') op += ` <button class="btn btn-ghost btn-sm" data-coverride="${a.id}">改派</button>`;
          const ovr = a.overridden ? ` <span class="badge b-amber" title="人工覆寫">覆寫</span>` : '';
          return `<tr><td>${a.id}${ovr}</td><td>${a.applicant}</td><td>${a.origin}→${a.dest}</td><td>${a.pax}</td>
            <td>${veh ? veh.name : '<span class="muted">—</span>'}</td><td>${drv ? drv.name : '<span class="muted">—</span>'}</td><td>${a.groupId || '—'}</td>
            <td>${a.deadheadMin != null ? a.deadheadMin + ' 分' : '—'}</td>
            <td>${a.lastBatch || '—'}</td>
            <td>${brd}</td><td>${cmp}</td><td>${op || '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${renderC_overrideLog()}`}
    </div>`;
  $$('#cr-tab-track [data-ccomplete]').forEach(b => b.onclick = confirmThen({ title: '確認行程完成？', text: '確認後此趟共乘將標記為行程完成，車輛與司機當前位置回復歸屬據點。' }, () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.ccomplete);
    ModuleC.completeTrip(a, '調度室'); toast(`${a.id} 行程完成`, 'ok');
    renderCr_track(); renderCaList();
  }));
  $$('#cr-tab-track [data-coverride]').forEach(b => b.onclick = () => openOverrideDialog(b.dataset.coverride));
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
      <div class="row" style="max-width:420px;align-items:end;">
        <div class="field"><label>觸發人</label><input type="text" id="cr-batch-by" value="調度室-值班人員"></div>
      </div>
      <div class="muted">目前已核准待媒合：${approved} 筆</div>
      <div id="cr-batch-result"></div>
    </div>
    <div id="cr-batch-log">${renderC_batchLog()}</div>
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
  $('#cr-run-batch').onclick = confirmThen({ title: '確認執行批次媒合？', text: '確認後將對 7 天範圍內待處理申請執行批次媒合（已成功單不重排）。' }, () => {
    const by = ($('#cr-batch-by') && $('#cr-batch-by').value.trim()) || '調度室';
    const { batch, trace } = ModuleC.runBatch($('#cr-batch-date').value, by);
    $('#cr-batch-result').innerHTML = `
      <div class="result ok" style="margin-top:14px;">
        <div class="r-head">✓ 批次 ${batch.id} 完成（觸發人 ${batch.triggeredBy}）</div>
        <div>處理 ${batch.processed} 筆｜成功 ${batch.matched} 筆｜待人工協調 ${batch.coordinate} 筆</div>
      </div>
      <div class="trace">${trace.join('\n')}</div>`;
    const log = $('#cr-batch-log'); if (log) log.innerHTML = renderC_batchLog();
    toast(`批次 ${batch.id} 完成`, 'ok'); renderCaList(); renderCr_track();
  });
}
/* C-4 人工覆寫：調度室手動改派車輛/司機 */
function openOverrideDialog(id) {
  const a = ModuleC.applications.find(x => x.id === id);
  if (!a) return;
  const vOpts = DB.vehicles.filter(v => v.pool === 'BIZ')
    .map(v => `<option value="${v.id}" ${a.vehicle === v.id ? 'selected' : ''}>${v.id}（${v.name}｜${v.seats} 座｜歸屬 ${v.homeSite}）</option>`).join('');
  const dOpts = DB.drivers.filter(d => d.pool === 'BIZ')
    .map(d => `<option value="${d.id}" ${a.driver === d.id ? 'selected' : ''}>${d.id}（${d.name}｜歸屬 ${d.homeSite}）</option>`).join('');
  openModal(`調度室手動改派 · ${a.id}`, `
    <div class="callout info" style="margin-bottom:12px;">
      ${a.origin} → ${a.dest}｜${a.pax} 人｜${a.departDate} ${a.earliestPickup}<br>
      調度室可直接調整，<b>不退回員工重新申請</b>；調整將留下人工覆寫紀錄，且此單不再被下一次批次重排。
    </div>
    <div class="field"><label>指派車輛</label><select id="ovr-veh">${vOpts}</select></div>
    <div class="field"><label>指派司機</label><select id="ovr-drv">${dOpts}</select></div>
    <div class="field"><label>調整人</label><input type="text" id="ovr-by" value="調度室-值班人員"></div>
    <div class="field"><label>調整原因（選填）</label><input type="text" id="ovr-note" placeholder="例：原車輛臨時故障，改派備用車"></div>
    <div style="text-align:center;margin-top:18px;">
      <button class="btn btn-primary" id="ovr-ok">▶ 確認改派</button>
      <button class="btn btn-ghost" id="ovr-cancel">取消</button>
    </div>`);
  $('#ovr-cancel').onclick = closeModal;
  $('#ovr-ok').onclick = async () => {
    const ok = await confirmDialog({ title: '確認手動改派？', text: '此調整將記錄為人工覆寫，且不再被批次媒合重排。' });
    if (!ok) return;
    const rec = ModuleC.overrideAssign(a,
      { vehicle: $('#ovr-veh').value, driver: $('#ovr-drv').value, note: $('#ovr-note').value.trim() },
      $('#ovr-by').value.trim() || '調度室');
    closeModal();
    toast(`${a.id} 已人工改派（覆寫紀錄已留存）`, 'ok');
    renderCr_track(); renderCaList();
    return rec;
  };
}
/* C-4 人工覆寫紀錄一覽（調整人、時間、調整前後內容）*/
function renderC_overrideLog() {
  const list = [];
  ModuleC.applications.forEach(a => (a.overrides || []).forEach(o => list.push({ app: a, o })));
  if (list.length === 0) return '';
  const nameOf = (id, arr) => { const x = arr.find(y => y.id === id); return x ? x.name : (id || '—'); };
  return `<div class="divider"></div>
    <div class="card-title" style="margin-top:4px;">人工覆寫紀錄 <span class="g-tag">C-4</span></div>
    <div class="card-desc">每筆調度室手動調整的紀錄標記：調整人、時間與調整前後內容。覆寫過的排班不會被下一次批次媒合重排。</div>
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>調整人</th><th>時間</th><th>調整前</th><th>調整後</th><th>原因</th></tr></thead><tbody>
      ${list.slice().reverse().map(({ app, o }) => `<tr>
        <td><b style="color:var(--navy);">${app.id}</b></td><td>${o.by}</td><td>${fmtTime(o.at)}</td>
        <td class="muted">車 ${nameOf(o.before.vehicle, DB.vehicles)} / 司機 ${nameOf(o.before.driver, DB.drivers)}<br>（${statusText(o.before.status)}）</td>
        <td>車 <b>${nameOf(o.after.vehicle, DB.vehicles)}</b> / 司機 <b>${nameOf(o.after.driver, DB.drivers)}</b><br>（${statusText(o.after.status)}）</td>
        <td>${o.note || '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;
}
/* C-5 批次媒合稽核紀錄（媒合失敗率統計基礎；依 Q45 不做保底偵測／自動補跑）*/
function renderC_batchLog() {
  const bs = ModuleC.batches;
  const body = bs.length === 0
    ? `<div class="empty">尚無批次紀錄。執行批次媒合後，每次觸發的時間、觸發人、處理範圍與結果統計都會記錄於此。</div>`
    : `<div class="table-wrap"><table class="dt"><thead><tr>
        <th>批次</th><th>觸發時間</th><th>觸發人</th><th>處理範圍</th><th>處理單數</th><th>成功</th><th>待人工協調</th><th>失敗率</th>
      </tr></thead><tbody>
      ${bs.slice().reverse().map(b => {
        const rate = b.processed ? ((b.coordinate / b.processed) * 100).toFixed(0) + '%' : '—';
        return `<tr><td><b style="color:var(--navy);">${b.id}</b></td><td>${b.at}</td><td>${b.triggeredBy}</td>
          <td>${b.from} ~ ${b.to}</td><td>${b.processed}</td>
          <td><span class="badge b-green">${b.matched}</span></td>
          <td>${b.coordinate ? '<span class="badge b-amber">' + b.coordinate + '</span>' : '0'}</td>
          <td>${rate}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  return `<div class="card">
    <div class="card-title">批次媒合稽核紀錄 <span class="g-tag">03B / C-5</span></div>
    <div class="card-desc">記錄每次批次的觸發時間戳記、觸發人、處理範圍與結果，並於申請單上標記最後處理批次——作為媒合失敗率統計基礎。依規格 Q45，系統<b>不做</b>保底偵測或自動補跑。</div>
    ${body}</div>`;
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
  $$('#cr-tab-void [data-void]').forEach(b => b.onclick = confirmThen({ title: '確認逾期作廢？', text: '確認後將作廢此申請並通知申請人，紀錄保留、不轉待人工協調（G57）。' }, () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.void);
    const r = ModuleC.voidOverdue(a);
    openModal('逾期自動作廢（示意）', `
      <div class="result fail"><div class="r-head">✗ ${a.id} 已自動作廢</div>
        <div>系統已通知申請人：<b>${r.notified}</b></div></div>
      <div class="callout" style="margin-top:12px;">紀錄保留供媒合失敗率統計（G57），不轉待人工協調。作廢即最終結局。</div>`);
    toast(`${a.id} 逾期作廢並通知申請人`, 'err');
    renderCr_void(); renderCaList();
  }));
}
function statusText(s) {
  return ({ submitted: '待審核', approved: '已核准', rejected: '已駁回', matched: '已媒合', boarded: '已上車', completed: '行程完成', coordinate: '待人工協調', manual: '手動併車', void: '作廢' })[s] || s;
}

/* ============================================================
   主檔資料（共用）
   ============================================================ */
RENDER.master = function () {
  const p = $('#page-master');
  const nodeName = id => (DB.sites.find(s => s.id === id) || DB.restHouses.find(r => r.id === id) || {}).name || id;

  /* 2.9 據點相互路程表（測試資料）：大車、小車各一張完整矩陣，對角線＝0（同車型內對稱） */
  const matIds = [...DB.sites.map(s => s.id), ...DB.restHouses.map(r => r.id)];
  const matHead = '<th>起＼迄</th>' + matIds.map(id => `<th>${id} ${nodeName(id)}</th>`).join('');
  const fullMatrix = (type, cellCls) => {
    const body = matIds.map(ri => {
      const cells = matIds.map(ci => ri === ci
        ? '<td class="diag">0</td>'
        : `<td class="${cellCls}">${DB.siteTravel[type][ri + '|' + ci]}</td>`).join('');
      return `<tr><th>${ri} ${nodeName(ri)}</th>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="dt matrix"><thead><tr>${matHead}</tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const matBig = fullMatrix('big', 'tri-big');
  const matSmall = fullMatrix('small', 'tri-small');

  /* 3.1 各據點最短天數表（大車／小車） */
  const dayIds = DB.sites.map(s => s.id).filter(id => DB.minTripDays.big[id] != null || DB.minTripDays.small[id] != null);
  const dayBody = dayIds.map(id => `<tr><td><b>${id}</b> ${nodeName(id)}</td>
    <td>${DB.minTripDays.big[id] != null ? DB.minTripDays.big[id] + ' 天' : '—'}</td>
    <td>${DB.minTripDays.small[id] != null ? DB.minTripDays.small[id] + ' 天' : '—'}</td></tr>`).join('');

  /* 2.12 司機休息／用餐門檻 */
  const brkBody = DB.driverBreaks.map(b => `<tr><td>${b.kind}</td>
    <td>純累積行駛滿 ${b.afterDriveMin} 分（${(b.afterDriveMin / 60).toFixed(1)} 小時）</td>
    <td>${b.costMin} 分</td></tr>`).join('');

  /* 區域內物流班次（每日 5 班，G18） */
  const shiftBody = DB.regionalShifts.map(s => {
    const veh = DB.vehicles.find(v => v.id === s.vehicle);
    return `<tr><td>${s.label}</td><td>${s.depart}</td><td>${s.vehicle}${veh ? '（' + veh.name + '）' : ''}</td></tr>`;
  }).join('');

  /* 商務共乘車程表（G62） */
  const bizBody = Object.entries(DB.bizTravel).map(([k, v]) => {
    const [o, d] = k.split('|');
    return `<tr><td>${o}</td><td>${d}</td><td>${v} 分</td></tr>`;
  }).join('');

  /* 限制條件與幹線時間參數 */
  const kv = [
    ['出車前停止媒合', `出車前 ${DB.matchCutoffDaysBefore} 日 ${DB.matchCutoffTime} 起停止媒合`],
    ['受限據點不前往時間', `每日 ${DB.noArrivalAfter} 後不前往受限據點`],
    ['回程直達鎖定窗寬', `${DB.directLockWindowMin} 分`],
    ['幹線出發基地', `${DB.homeSite}（${nodeName(DB.homeSite)}）`],
    ['每日總在勤上限', `${(DB.dailyDutyMin / 60).toFixed(1)} 小時`],
    ['出勤前緩衝／收工後緩衝', `${DB.prepMin} 分 / ${DB.closeMin} 分`],
    ['最小計算單位／大車加時', `${DB.travelUnitMin} 分 / +${DB.bigExtraMin} 分`],
    ['最大出勤天數', `${DB.maxTripDays} 天`],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  p.innerHTML = `
    <div class="section-h">主檔資料</div>
    <div class="section-sub">示範主檔（記憶體）。正式版對應 VD_ 前綴資料表。類別、路程與天數對照表均為<b>虛構測試資料</b>，待業務盤點後以實表覆寫。</div>
    <div class="grid-2">
      <div class="card"><div class="card-title">車輛主檔（含資源池別）<span class="g-tag">C-2</span></div>
        <div class="card-desc">歸屬據點＝行政/資產固定隸屬（不因出差改變）；當前位置＝排班可用性判斷依據（G59）。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>ID</th><th>名稱</th><th>資源池</th><th>歸屬據點</th><th>當前位置</th><th>容量/座位</th></tr></thead><tbody>
        ${DB.vehicles.map(v => `<tr><td>${v.id}</td><td>${v.name}</td>
          <td>${v.pool === 'LOGI' ? '<span class="badge b-navy">物流</span>' : '<span class="badge b-green">商務</span>'}</td>
          <td>${v.homeSite}</td><td>${v.currentSite}${v.currentSite !== v.homeSite ? ' <span class="badge b-amber">外派中</span>' : ''}</td>
          <td>${v.pool === 'BIZ' ? v.seats + ' 座' : v.volume.toFixed(0) + 'L/' + v.weight + 'kg'}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-title">司機主檔（獨立資源）<span class="g-tag">C-2</span></div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>ID</th><th>姓名</th><th>資源池</th><th>歸屬據點</th><th>當前位置</th></tr></thead><tbody>
        ${DB.drivers.map(d => `<tr><td>${d.id}</td><td>${d.name}</td>
          <td>${d.pool === 'LOGI' ? '物流' : '商務'}</td><td>${d.homeSite}</td>
          <td>${d.currentSite}${d.currentSite !== d.homeSite ? ' <span class="badge b-amber">外派中</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>

    <div class="card">
      <div class="card-title">2.9 據點相互路程表（分鐘）<span class="g-tag">測試資料</span></div>
      <div class="card-desc">大車、小車<b>各一張完整矩陣</b>，對角線為 0、同車型內對稱。
        下列數值為<b>依實表特徵產生之虛構測試資料</b>（規則見 <code>docs/SPEC-DATA.md</code>）：最小計算單位 30 分、路程具次可加性（長程 < 各段相加）、大車＝小車＋30 分（小車 ≤ 一個計算單位之短程則相同）。實表到位後直接覆寫 <code>siteTravel</code> 即可，演算法無須更動。</div>
      <div class="card-title" style="font-size:14px;margin:14px 0 8px;"><span class="badge b-navy">大車</span>　據點相互路程（分）</div>
      ${matBig}
      <div class="card-title" style="font-size:14px;margin:20px 0 8px;"><span class="badge b-amber">小車</span>　據點相互路程（分）</div>
      ${matSmall}
      <div class="legend">
        <span><span class="sw" style="background:#EDEFF2;"></span>對角線：同點＝0</span>
        <span>含休息會館：RH-S 南區／RH-M 中區／RH-N 北區</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-title">3.1 各據點最短天數表 <span class="g-tag">示意</span></div>
        <div class="card-desc">依車型 × 目的地查表；寬鬆估計、僅供排班參考顯示，不參與運算、不反向限制 12.5 小時精算。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>目的地據點</th><th>大車</th><th>小車</th></tr></thead><tbody>${dayBody}</tbody></table></div></div>

      <div class="card"><div class="card-title">2.12 司機休息／用餐門檻</div>
        <div class="card-desc">依純累積行駛時間觸發，共用不歸零時數線，每日歸零。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>項目</th><th>觸發條件</th><th>耗時</th></tr></thead><tbody>${brkBody}</tbody></table></div></div>

      <div class="card"><div class="card-title">區域內物流班次（每日 5 班）<span class="g-tag">G18</span></div>
        <div class="card-desc">人工每日排定，兩台車輪替。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>班次</th><th>發車</th><th>車輛</th></tr></thead><tbody>${shiftBody}</tbody></table></div></div>

      <div class="card"><div class="card-title">商務共乘車程表（分鐘）<span class="g-tag">G62</span></div>
        <div class="card-desc">公司自建；系統另加內建緩衝 ${DB.bizBuffer} 分。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>出發地</th><th>目的地</th><th>車程</th></tr></thead><tbody>${bizBody}</tbody></table></div></div>
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-title">限制條件與幹線時間參數</div>
        <div class="card-desc">業務單位公式頁參數；正式版存放於設定檔／主檔。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>參數</th><th>設定值</th></tr></thead><tbody>${kv}</tbody></table></div></div>
      <div class="card"><div class="card-title">南北據點順序（G30）</div>
        <div class="card-desc">南 → 北一直線固定順序。</div>
        <div class="route">${DB.sites.map(s => `<div class="stop"><div class="s-name">${s.name}</div><div class="s-meta">序 ${s.order}</div></div>`).join('')}</div></div>
    </div>`;
};

/* ============================================================
   司機任務單（駕駛端）— A/B/C 各一單元，讀取既有派車/媒合結果
   ============================================================ */

/* 模組 A · 司機任務單：以「班次（車輛）」為單位，沿固定 10 站路線的收送任務 */
RENDER.a_driver = function () {
  const p = $('#page-a_driver');
  const rows = ModuleA.applications.filter(a => ['matched', 'delivered'].includes(a.status) && a.assignedShift);
  // 以「日期＋班次」為一張任務單（不同日期不可混在同一張）
  const byKey = {};
  rows.forEach(a => { const k = (a.serviceDate || '—') + '|' + a.assignedShift; (byKey[k] = byKey[k] || []).push(a); });
  const keys = Object.keys(byKey).sort((x, y) => {
    const [dx, sx] = x.split('|'), [dy, sy] = y.split('|');
    return dx.localeCompare(dy) || DB.regionalShifts.findIndex(s => s.id === sx) - DB.regionalShifts.findIndex(s => s.id === sy);
  });
  let cards = keys.map(k => {
    const [date, shiftId] = k.split('|');
    const sh = DB.regionalShifts.find(s => s.id === shiftId);
    const veh = DB.vehicles.find(v => v.id === sh.vehicle);
    const list = byKey[k];
    const totalVol = list.reduce((s, a) => s + a.items.reduce((t, it) => t + (it.l * it.w * it.h / 1000) * (it.qty || 1), 0), 0);
    // 沿固定 10 站路線「一次通過」：為每張單建立取貨（收貨站）與卸貨（送貨站）兩個停靠事件，
    // 再依站序彙整成停靠站清單——同一站的收貨/送貨自動集中在一起（先卸後裝，比照佔用模型）
    const stops = {}; // order -> { order, name, picks:[], drops:[] }
    const ensure = (order, name) => (stops[order] = stops[order] || { order, name, picks: [], drops: [] });
    list.forEach(a => {
      const dropSt = DB.stations.find(s => s.id === a.station);
      const pickSt = a.pickStation ? DB.stations.find(s => s.id === a.pickStation) : null;
      ensure(pickSt ? pickSt.order : 0, pickSt ? pickSt.name : '路線起點').picks.push(a); // 取貨（起）
      ensure(dropSt.order, dropSt.name).drops.push(a);                                     // 卸貨（迄）
    });
    const ordered = Object.values(stops).sort((x, y) => x.order - y.order);
    const body = ordered.map((stp, i) => {
      const t = minToHHMM(ModuleA.shiftArrivalAtStation(sh, stp.order));
      const dropLines = stp.drops.map(a => {
        const del = a.status === 'delivered' ? '<span class="badge b-green">已交貨</span>' : '<span class="badge b-gray">待交貨</span>';
        return `<div style="margin:2px 0;"><span class="badge b-amber">卸貨</span> ${a.id}｜${stp.name} / ${a.building}｜接收：${recipientDisplay(a.recipient)} ${del}</div>`;
      }).join('');
      const pickLines = stp.picks.map(a =>
        `<div style="margin:2px 0;"><span class="badge b-navy">取貨</span> ${a.id}｜${a.pickupLoc || stp.name}｜${itemsSummary(a.items)}</div>`).join('');
      return `<tr><td>${i + 1}</td><td><b>${stp.name}</b></td>
        <td><b style="color:var(--navy);">${t}</b></td>
        <td style="text-align:left;">${dropLines}${pickLines}</td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚚 <b>${date}</b>${date === ModuleA.todayStr() ? ' <span class="badge b-navy">今天</span>' : ''}｜${sh.label}｜車 <b style="color:var(--navy);">${veh.id}</b>（${veh.name}）</span>
        <span class="badge b-navy">駕駛：${logiDriverName(veh.id)}</span></div>
      <div class="card-desc">沿固定 10 站路線<b>一次通過</b>，於 <b>${ordered.length}</b> 個停靠站依序<b>卸貨／取貨</b>；本班 <b>${list.length}</b> 筆、總貨量約 <b>${totalVol.toFixed(0)}L</b>。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>停靠站</th><th>抵達</th><th>作業（卸貨／取貨）</th>
      </tr></thead><tbody>${body}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已排定的班次任務。使用者送出收貨申請並自動媒合成功後，這裡會依班次（車輛）顯示司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">區域內物流 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「日期＋班次（車輛）」為單位，沿固定 10 站路線<b>一次通過</b>：每個停靠站依站序列出要<b>卸貨</b>與<b>取貨</b>的單、抵達時間、貨物與接收人（同一站的收貨自動彙整在一起）。</div>
    ${cards}`;
};

/* 模組 B · 司機任務單：以「車輛」為單位，這一趟停靠哪些據點、各站取貨／卸貨 */
RENDER.b_driver = function () {
  const p = $('#page-b_driver');
  const rows = ModuleB.orders.filter(o => ['loaded', 'delivered'].includes(o.status) && o.dispatchVehicle);
  const byVeh = {};
  rows.forEach(o => { (byVeh[o.dispatchVehicle] = byVeh[o.dispatchVehicle] || []).push(o); });
  let cards = Object.keys(byVeh).map(vid => {
    const veh = DB.vehicles.find(v => v.id === vid);
    const list = byVeh[vid];
    const events = [];
    list.forEach(o => {
      events.push({ siteId: o.pickSite, type: 'pick', time: o.pickupTime, o });
      events.push({ siteId: o.dropSite, type: 'drop', time: o.dispatchDropTime, o });
    });
    const bySite = {};
    events.forEach(e => { (bySite[e.siteId] = bySite[e.siteId] || []).push(e); });
    const siteIds = Object.keys(bySite).sort((a, b) => {
      const ta = Math.min(...bySite[a].map(e => e.time ? hhmmToMin(e.time) : 9999));
      const tb = Math.min(...bySite[b].map(e => e.time ? hhmmToMin(e.time) : 9999));
      return ta - tb || ModuleB.siteById(a).order - ModuleB.siteById(b).order;
    });
    const stopRows = siteIds.map((sid, idx) => {
      const site = ModuleB.siteById(sid);
      const evs = bySite[sid];
      const arrive = evs.map(e => e.time).filter(Boolean).sort()[0] || '—';
      const detail = [
        ...evs.filter(e => e.type === 'pick').map(e => `<div style="margin:2px 0;"><span class="badge b-navy">取貨</span> ${e.time || ''} ${e.o.id}｜${e.o.pickupLoc || '—'}｜${itemsSummary(e.o.items)}</div>`),
        ...evs.filter(e => e.type === 'drop').map(e => `<div style="margin:2px 0;"><span class="badge b-amber">卸貨</span> ${e.time || ''} ${e.o.id}｜${e.o.deliverLoc || '—'}｜接收：${recipientDisplay(e.o.recipient)}</div>`),
      ].join('');
      return `<tr><td>${idx + 1}</td><td><b>${site.name}</b></td><td>${arrive}</td><td style="text-align:left;">${detail}</td></tr>`;
    }).join('');
    const modeLabel = list.some(o => o.dispatchMode === '直達') && list.every(o => o.dispatchMode === '直達') ? '直達' : (list.every(o => o.dispatchMode === '非直達') ? '非直達（沿線收送）' : '混合');
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚛 車 <b style="color:var(--navy);">${veh.id}</b>（${veh.name}）<span class="hint" style="margin-left:6px;">${modeLabel}</span></span>
        <span class="badge b-navy">駕駛：${logiDriverName(veh.id)}</span></div>
      <div class="card-desc">本趟共 <b>${list.length}</b> 張託運單、<b>${siteIds.length}</b> 個停靠據點；依派車決策沿線<b>取貨／卸貨</b>。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>停靠據點</th><th>抵達</th><th>作業（取貨／卸貨）</th>
      </tr></thead><tbody>${stopRows}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已派車的幹線任務。於「B｜派車調度」執行派車後，這裡會依車輛顯示沿線取貨／卸貨的司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">南北幹線 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「車輛」為單位，顯示這一趟要停靠哪些據點、在每個據點<b>取貨</b>或<b>卸貨</b>哪些託運單、收貨/送貨地點與接收人。</div>
    ${cards}`;
};

/* 模組 C · 司機任務單：以「駕駛」為單位，今日整個行程要接誰、去哪裡 */
RENDER.c_driver = function () {
  const p = $('#page-c_driver');
  const rows = ModuleC.applications.filter(a => ['matched', 'boarded', 'completed'].includes(a.status) && a.driver && a.vehicle);
  const byDriver = {};
  rows.forEach(a => { (byDriver[a.driver] = byDriver[a.driver] || []).push(a); });
  let cards = Object.keys(byDriver).map(did => {
    const drv = DB.drivers.find(d => d.id === did);
    const groups = {};
    byDriver[did].forEach(a => { (groups[a.groupId || a.id] = groups[a.groupId || a.id] || []).push(a); });
    const gids = Object.keys(groups).sort((x, y) => {
      const ax = groups[x][0], ay = groups[y][0];
      return (ax.departDate + ax.earliestPickup).localeCompare(ay.departDate + ay.earliestPickup);
    });
    const tripRows = gids.map((gid, idx) => {
      const g = groups[gid];
      const head = g[0];
      const veh = DB.vehicles.find(v => v.id === head.vehicle);
      const pax = g.reduce((s, a) => s + a.pax, 0);
      const passengers = g.map(a => `${a.applicant}（${a.dept}/${a.ext}｜${a.pax}人）`).join('、');
      const typeLabel = head.type === 'round' ? '來回' : '單程';
      const retInfo = head.type === 'round'
        ? `<br><span class="hint">回程：${head.returnDate} ${head.earliestReturn} 於 ${head.dest} 上車返 ${head.origin}</span>` : '';
      return `<tr>
        <td>${idx + 1}</td>
        <td>${head.departDate}<br><b style="color:var(--navy);">${head.earliestPickup}</b></td>
        <td>${head.origin} → ${head.dest}<br><span class="hint">${typeLabel}｜車 ${veh ? veh.id : '—'}（${pax}人）｜最晚抵達 ${ModuleC.latestArrival(head)}</span>${retInfo}</td>
        <td style="text-align:left;">${passengers}</td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚐 駕駛 <b style="color:var(--navy);">${drv ? drv.name : did}</b></span>
        <span class="badge b-green">共 ${gids.length} 趟</span></div>
      <div class="card-desc">今日該駕駛的共乘任務：每趟出發時間、起訖地、車輛與<b>要接送的乘客</b>。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>出發</th><th>行程</th><th>接送乘客</th>
      </tr></thead><tbody>${tripRows}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已媒合的共乘任務。於「C｜媒合調度」執行批次媒合後，這裡會依駕駛顯示每趟要接誰、去哪裡的司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">差旅共乘 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「駕駛」為單位，顯示今日整個行程：每趟出發時間、起訖地、車輛，以及要接送的乘客（單位/分機/人數）。</div>
    ${cards}`;
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
  // SweetAlert 風格確認視窗：確定→true、取消或點擊遮罩→false
  $('#swal-ok').onclick = () => _swalClose(true);
  $('#swal-cancel').onclick = () => _swalClose(false);
  $('#swal-mask').onclick = (e) => { if (e.target.id === 'swal-mask') _swalClose(false); };
  tick(); setInterval(tick, 1000);
  goto('dashboard');
});
