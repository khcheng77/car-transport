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

/* 通用狀態徽章 */
function stBadge(s) {
  return ({
    submitted: '<span class="badge b-gray">待審核</span>',
    approved: '<span class="badge b-navy">已核准待排</span>',
    rejected: '<span class="badge b-red">已駁回</span>',
    matched: '<span class="badge b-navy">已排班待接受</span>',
    accepted: '<span class="badge b-amber">已接受待交貨</span>',
    delivered: '<span class="badge b-green">已交貨</span>',
    loaded: '<span class="badge b-green">已裝載</span>',
    coordinate: '<span class="badge b-amber">待人工協調</span>',
    manual: '<span class="badge b-navy">手動併車</span>',
    void: '<span class="badge b-red">逾期作廢</span>',
  })[s] || s;
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
    { id: 'a_review', ico: '🗂', label: 'A｜排班審核（業務）' },
  ] },
  { group: '模組 B · 南北幹線', items: [
    { id: 'b_apply', ico: '📝', label: 'B｜幹線託運申請（使用者）' },
    { id: 'b_review', ico: '🚚', label: 'B｜派車審核（業務）' },
  ] },
  { group: '模組 C · 差旅共乘', items: [
    { id: 'c_apply', ico: '📝', label: 'C｜出差用車申請（使用者）' },
    { id: 'c_review', ico: '🔀', label: 'C｜媒合審核（業務）' },
  ] },
];
const PAGE_META = {
  dashboard: { title: '系統儀表板', crumb: '車輛派遣系統整合 · 原型 v0.2' },
  engine: { title: '裝載判定引擎', crumb: '共用基礎層 · Phase 1 · G01–G05' },
  master: { title: '主檔資料', crumb: '共用基礎層 · Phase 0' },
  a_apply: { title: '區域內物流 · 收貨申請（使用者）', crumb: '模組 A · 申請端 · G13/G15/G19' },
  a_review: { title: '區域內物流 · 排班審核（業務單位）', crumb: '模組 A · 審核/調度端 · G10–G20' },
  b_apply: { title: '南北幹線 · 幹線託運申請（使用者）', crumb: '模組 B · 申請端 · G34/G38' },
  b_review: { title: '南北幹線 · 派車審核（業務單位）', crumb: '模組 B · 審核/調度端 · G30–G44' },
  c_apply: { title: '差旅共乘 · 出差用車申請（使用者）', crumb: '模組 C · 申請端 · G54/G55' },
  c_review: { title: '差旅共乘 · 媒合審核（業務單位）', crumb: '模組 C · 審核/調度端 · G50–G63' },
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
  const bLoaded = ModuleB.orders.filter(o => o.status === 'loaded').length;
  const cMatched = ModuleC.applications.filter(a => a.status === 'matched').length;
  const pendReview = ModuleA.applications.filter(a => a.status === 'submitted').length
    + ModuleB.orders.filter(o => o.status === 'submitted').length
    + ModuleC.applications.filter(a => a.status === 'submitted').length;
  p.innerHTML = `
    <div class="section-h">系統儀表板</div>
    <div class="section-sub">車輛派遣系統整合原型 — 純前端可動版。使用者「申請端」與業務單位「審核/調度端」分離，三模組各拆兩個單元，共 6 個業務單元。三模組資源池分開，互不搶用。</div>
    <div class="stat-row">
      <div class="stat"><div class="k">待業務審核（三模組）</div><div class="v accent">${pendReview}</div></div>
      <div class="stat"><div class="k">物流 · 已排班</div><div class="v">${aMatched}</div></div>
      <div class="stat"><div class="k">幹線 · 已裝載</div><div class="v">${bLoaded}</div></div>
      <div class="stat"><div class="k">共乘 · 已媒合</div><div class="v green">${cMatched}</div></div>
    </div>

    <div class="card-title" style="font-size:14px;margin:8px 0 12px;color:var(--ink-soft);">共用基礎層</div>
    <div class="grid-2">
      ${dashCard('⚙ 裝載判定引擎', 'Level 1 體積 + 地板面積 + Level 2 六方向 + 重量累計。可解釋、不做 3D 碰撞模擬。', 'engine', 'G01–G05')}
      ${dashCard('▦ 主檔資料', '據點/站點/車輛/司機/浪費係數/保修/請假等示範主檔。', 'master', 'Phase 0')}
    </div>

    <div class="card-title" style="font-size:14px;margin:22px 0 12px;color:var(--ink-soft);">六個業務單元（申請端 ｜ 審核端）</div>
    <div class="grid-3">
      ${unitCard('📝 A｜收貨申請', '使用者填收貨單、查看自己的申請狀態。送出後進入業務審核。', 'a_apply', '申請端')}
      ${unitCard('🗂 A｜排班審核', '主管准駁、執行時間軸媒合、路線班次、駕駛異常回報。', 'a_review', '審核端')}
      ${unitCard('📝 B｜幹線託運申請', '使用者建立幹線託運單（直達/非直達）、查看狀態。', 'b_apply', '申請端')}
      ${unitCard('🚚 B｜派車審核', '主管准駁、貪婪/直達派車決策、調度室模式顯示。', 'b_review', '審核端')}
      ${unitCard('📝 C｜出差用車申請', '使用者填來回/單程用車申請、查看狀態。', 'c_apply', '申請端')}
      ${unitCard('🔀 C｜媒合審核', '主管准駁、批次媒合、資源檢核、手動併車、逾期作廢。', 'c_review', '審核端')}
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
  const badge = side === '申請端' ? '<span class="badge b-navy">申請端</span>' : '<span class="badge b-amber">審核端</span>';
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
RENDER.a_apply = function () {
  const p = $('#page-a_apply');
  const stOpts = DB.stations.map(s => `<option value="${s.id}">${s.order}. ${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">收貨申請（使用者）</div>
    <div class="section-sub">一單一目的地、可多筆貨物。收貨時間二選一：指定期望 / 越快越好。送出後狀態為「待審核」，由業務單位審核與排班。</div>
    <div class="grid-2">
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
        <button class="btn btn-primary" id="aa-submit">▶ 送出申請（待業務審核）</button>
        <button class="btn btn-ghost" id="aa-demo">載入範例</button>
      </div>
      <div class="card">
        <div class="card-title">我的申請單</div>
        <div id="aa-list"></div>
      </div>
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
  $('#aa-submit').onclick = submitAa;
  $('#aa-demo').onclick = () => {
    [['S3', 'asap', 15, [{ name: '零件箱', l: 50, w: 40, h: 30, qty: 6, category: 'BOX', weight: 12 }]],
     ['S6', 'exact', 20, [{ name: '棧板', l: 110, w: 90, h: 120, qty: 1, category: 'PALLET', weight: 200 }]],
     ['S3', 'asap', 25, [{ name: '長料', l: 480, w: 25, h: 25, qty: 3, category: 'LONG', weight: 30 }]]
    ].forEach(([st, mode, h, items]) => ModuleA.createApp({
      applicant: '業務部-周雅婷', station: st, building: DB.stations.find(s => s.id === st).buildings[0],
      items, recvMode: mode, expectTime: '13:00', handleMin: h }));
    toast('已載入 3 筆收貨申請（待審核）', 'ok'); renderAaList();
  };
  renderAaList();
};
function renderAaItems() { renderItemEditor('#aa-items', aaItems, renderAaItems); }
function submitAa() {
  const mode = $('#page-a_apply input[name=aa-recv]:checked').value;
  const app = ModuleA.createApp({
    applicant: $('#aa-applicant').value, station: $('#aa-station').value, building: $('#aa-building').value,
    items: aaItems.map(x => ({ ...x })), recvMode: mode, expectTime: $('#aa-expect').value,
    handleMin: +$('#aa-handle').value || 0,
  });
  toast(`${app.id} 已送出，等待業務審核`, 'ok'); renderAaList();
}
function renderAaList() {
  const rows = ModuleA.applications;
  $('#aa-list').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">📝</div>尚無申請單</div>` : `
    <div class="card-desc" style="margin-bottom:10px;">排班後，接收人可在此確認接受排班、並於收到貨後確認交貨。</div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>目的地</th><th>班次/車輛/到站</th><th>狀態</th><th>接收人操作</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        const veh = sh ? DB.vehicles.find(v => v.id === sh.vehicle) : null;
        const schedule = sh ? `${sh.label}｜${veh.name}｜到站 ${a.arrival || '—'}` : '<span class="muted">尚未排班</span>';
        let action = '<span class="muted">—</span>';
        if (a.status === 'matched') action = `<button class="btn btn-primary btn-sm" data-accept="${a.id}">確認接受排班</button>`;
        else if (a.status === 'accepted') action = `<button class="btn btn-accent btn-sm" data-recv="${a.id}">確認已收到貨</button>`;
        else if (a.status === 'delivered') action = '<span class="badge b-green">✓ 已完成</span>';
        return `<tr><td>${a.id}</td><td>${st.name}/${a.building}</td>
          <td>${schedule}</td><td>${stBadge(a.status)}</td><td>${action}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $$('#aa-list [data-accept]').forEach(b => b.onclick = () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.accept);
    ModuleA.acceptSchedule(a); toast(`${a.id} 接收人已確認接受排班`, 'ok');
    renderAaList(); if ($('#ar-tab-review')) renderAr_review();
  });
  $$('#aa-list [data-recv]').forEach(b => b.onclick = () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.recv);
    ModuleA.confirmDelivery(a, a.applicant); toast(`${a.id} 接收人已確認收到貨`, 'ok');
    renderAaList(); if ($('#ar-tab-review')) renderAr_review();
  });
}

/* ============================================================
   模組 A · 審核/調度端（業務單位）
   ============================================================ */
RENDER.a_review = function () {
  const p = $('#page-a_review');
  p.innerHTML = `
    <div class="section-h">排班審核（業務單位）</div>
    <div class="section-sub">主管准駁 → 執行時間軸最近班次媒合 → 路線班次維護、駕駛異常回報。兩層審批（G63）。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="review">① 審核與排班</div>
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
  const submitted = ModuleA.applications.filter(a => a.status === 'submitted');
  const approved = ModuleA.applications.filter(a => a.status === 'approved');
  $('#ar-tab-review').innerHTML = `
    <div class="card">
      <div class="card-title">待審核（主管准駁）<span class="g-tag">G63</span></div>
      ${submitted.length === 0 ? `<div class="empty">目前無待審核申請單。</div>` : `
      <div style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="ar-approve-all">✓ 全部核准</button></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>模式</th><th>裝卸</th><th>操作</th></tr></thead><tbody>
        ${submitted.map(a => { const st = DB.stations.find(s => s.id === a.station);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}</td>
            <td>${a.recvMode === 'exact' ? '指定 ' + a.expectTime : '越快越好'}</td><td>${a.handleMin}分</td>
            <td><button class="btn btn-primary btn-sm" data-ap="${a.id}">核准</button>
                <button class="btn btn-ghost btn-sm" data-rj="${a.id}">駁回</button></td></tr>`; }).join('')}
      </tbody></table></div>`}
    </div>
    <div class="card">
      <div class="card-title">已核准 · 執行媒合 <span class="g-tag">G10–G12</span></div>
      <div class="card-desc">時間軸最近班次媒合、裝不下順延、當日末班仍不行提醒改期。同步回傳結果（G11）。</div>
      ${approved.length === 0 ? `<div class="empty">尚無已核准待排申請單。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>模式</th><th></th></tr></thead><tbody>
        ${approved.map(a => { const st = DB.stations.find(s => s.id === a.station);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}/${a.building}</td>
            <td>${a.recvMode === 'exact' ? '指定 ' + a.expectTime : '越快越好'}</td>
            <td><button class="btn btn-accent btn-sm" data-match="${a.id}">執行媒合</button></td></tr>`; }).join('')}
      </tbody></table></div>`}
      <div id="ar-match-result"></div>
    </div>
    ${renderAr_scheduled()}`;
  const all = $('#ar-approve-all');
  if (all) all.onclick = () => { submitted.forEach(a => ModuleA.approve(a)); toast(`已核准 ${submitted.length} 筆`, 'ok'); renderAr_review(); renderAaList(); };
  $$('#ar-tab-review [data-ap]').forEach(b => b.onclick = () => { ModuleA.approve(ModuleA.applications.find(a => a.id === b.dataset.ap)); toast(`${b.dataset.ap} 已核准`, 'ok'); renderAr_review(); });
  $$('#ar-tab-review [data-rj]').forEach(b => b.onclick = () => { ModuleA.reject(ModuleA.applications.find(a => a.id === b.dataset.rj)); toast(`${b.dataset.rj} 已駁回`, 'err'); renderAr_review(); });
  $$('#ar-tab-review [data-match]').forEach(b => b.onclick = () => {
    const app = ModuleA.applications.find(a => a.id === b.dataset.match);
    const r = ModuleA.match(app);
    const cls = r.ok ? 'ok' : 'warn';
    const head = r.ok ? `✓ 已排入 ${r.shift.label}` : '⚠ 無法排入';
    $('#ar-match-result').innerHTML = `
      <div class="result ${cls}" style="margin-top:14px;">
        <div class="r-head">${head}（${app.id}）</div>
        ${r.ok ? `<div>到站約 <b>${r.arrival}</b>｜車輛 ${r.shift.vehicle}</div>` : `<div><b>${r.msg}</b></div>`}
      </div>
      <div class="trace">${r.trace.join('\n')}</div>`;
    toast(r.ok ? `${app.id} 已排入 ${r.shift.label}` : r.msg, r.ok ? 'ok' : 'err');
    renderAr_review(); renderAaList();
  });
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
  const body = rows.length === 0 ? `<div class="empty">尚無已排定車次。核准後執行媒合即會出現在此。</div>` : `
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
RENDER.b_apply = function () {
  const p = $('#page-b_apply');
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">幹線託運申請（使用者）</div>
    <div class="section-sub">出發示意為台北據點（D10）南下。勾選直達 → 業務審核後，當天有直達即獨立派車。送出後狀態為「待審核」。</div>
    <div class="grid-2">
      <div class="card">
        <div class="card-title">建立幹線託運單 <span class="g-tag">G38</span></div>
        <div class="field"><label>申請人</label><input type="text" id="ba-applicant" value="研發部-吳承恩"></div>
        <div class="field"><label>目的地據點</label><select id="ba-dest">${siteOpts}</select></div>
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
        <button class="btn btn-primary" id="ba-submit">▶ 送出申請（待業務審核）</button>
        <button class="btn btn-ghost" id="ba-demo">載入範例批次</button>
      </div>
      <div class="card">
        <div class="card-title">我的託運單</div>
        <div id="ba-list"></div>
      </div>
    </div>`;
  const setDirect = () => {
    $('#ba-nd').classList.toggle('sel', $('#page-b_apply input[value="0"]').checked);
    $('#ba-d').classList.toggle('sel', $('#page-b_apply input[value="1"]').checked);
  };
  $$('#page-b_apply input[name=ba-direct]').forEach(r => r.onchange = setDirect);
  $('#ba-submit').onclick = () => {
    ModuleB.createOrder({
      applicant: $('#ba-applicant').value, origin: 'D10', dest: $('#ba-dest').value,
      direct: $('#page-b_apply input[value="1"]').checked,
      volume: +$('#ba-vol').value, weight: +$('#ba-wt').value, handleMin: +$('#ba-handle').value,
    });
    toast('已送出託運單，等待業務審核', 'ok'); renderBaList();
  };
  $('#ba-demo').onclick = () => {
    [['D3', false, 1500, 600, 25], ['D2', false, 1800, 700, 30], ['D6', false, 1200, 500, 20],
     ['D1', true, 2500, 900, 40], ['D5', false, 2200, 800, 30]].forEach(([dest, direct, v, w, h]) =>
      ModuleB.createOrder({ applicant: '研發部-吳承恩', origin: 'D10', dest, direct, volume: v, weight: w, handleMin: h }));
    toast('已載入 5 筆範例（含 1 直達，待審核）', 'ok'); renderBaList();
  };
  renderBaList();
};
function renderBaList() {
  const rows = ModuleB.orders;
  $('#ba-list').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">📝</div>尚無託運單</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>目的地</th><th>型態</th><th>貨量</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(o => `<tr><td>${o.id}</td><td>${ModuleB.siteById(o.dest).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${stBadge(o.status)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   模組 B · 審核/調度端（業務單位）
   ============================================================ */
RENDER.b_review = function () {
  const p = $('#page-b_review');
  p.innerHTML = `
    <div class="section-h">派車審核（業務單位）</div>
    <div class="section-sub">主管准駁 → 依核准時間排序派車。貪婪終點判斷 / 直達獨立派車、調度室顯示派遣模式與觸發原因。</div>
    <div class="card">
      <div class="card-title">待審核（主管准駁）<span class="g-tag">G63</span></div>
      <div id="br-review"></div>
    </div>
    <div class="card">
      <div class="card-title">派車決策（調度室）<span class="g-tag">G32/G44</span></div>
      <div class="card-desc">僅對已核准託運單派車，依核准時間排序逐張檢查。系統顯示每台車派遣模式與觸發原因。</div>
      <button class="btn btn-accent" id="br-dispatch-direct">派直達車</button>
      <button class="btn btn-primary" id="br-dispatch-greedy">派非直達車（貪婪）</button>
      <div id="br-approved" style="margin-top:14px;"></div>
      <div id="br-dispatch-result"></div>
    </div>`;
  $('#br-dispatch-direct').onclick = () => dispatchB('direct');
  $('#br-dispatch-greedy').onclick = () => dispatchB('greedy');
  renderBr_review(); renderBr_approved();
};
function renderBr_review() {
  const submitted = ModuleB.orders.filter(o => o.status === 'submitted');
  $('#br-review').innerHTML = submitted.length === 0 ? `<div class="empty">目前無待審核託運單。</div>` : `
    <div style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="br-approve-all">✓ 全部核准</button></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>型態</th><th>貨量</th><th>操作</th></tr></thead><tbody>
      ${submitted.map(o => `<tr><td>${o.id}</td><td>${o.applicant}</td><td>${ModuleB.siteById(o.dest).name}</td>
        <td>${o.direct ? '直達' : '非直達'}</td><td>${o.volume}L</td>
        <td><button class="btn btn-primary btn-sm" data-ap="${o.id}">核准</button>
            <button class="btn btn-ghost btn-sm" data-rj="${o.id}">駁回</button></td></tr>`).join('')}
    </tbody></table></div>`;
  const all = $('#br-approve-all');
  if (all) all.onclick = () => { submitted.forEach(o => ModuleB.approve(o)); toast(`已核准 ${submitted.length} 筆`, 'ok'); renderBr_review(); renderBr_approved(); renderBaList(); };
  $$('#br-review [data-ap]').forEach(b => b.onclick = () => { ModuleB.approve(ModuleB.orders.find(o => o.id === b.dataset.ap)); toast(`${b.dataset.ap} 已核准`, 'ok'); renderBr_review(); renderBr_approved(); });
  $$('#br-review [data-rj]').forEach(b => b.onclick = () => { ModuleB.reject(ModuleB.orders.find(o => o.id === b.dataset.rj)); toast(`${b.dataset.rj} 已駁回`, 'err'); renderBr_review(); });
}
function renderBr_approved() {
  const rows = ModuleB.orders.filter(o => o.status === 'approved');
  $('#br-approved').innerHTML = rows.length === 0 ? `<div class="muted">尚無已核准待派車託運單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>目的地</th><th>型態</th><th>貨量</th><th>裝卸</th></tr></thead><tbody>
      ${rows.map(o => `<tr><td>${o.id}</td><td>${ModuleB.siteById(o.dest).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${o.handleMin}分</td></tr>`).join('')}
    </tbody></table></div>`;
}
function dispatchB(mode) {
  const veh = mode === 'direct' ? 'V-T02' : 'V-T01';
  const r = ModuleB.dispatch(veh, mode);
  const endpoint = r.endpoint ? ModuleB.siteById(r.endpoint).name : '—';
  const modeBadge = r.modeLabel === '直達' ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達 · 貪婪</span>';
  let routeViz = '';
  if (r.mode === 'greedy' && r.stops) {
    routeViz = `<div class="route" style="margin-top:12px;">
      <div class="stop hit"><div class="s-name">台北據點</div><div class="s-meta">出發</div></div>
      ${r.stops.map(s => `<div class="stop ${s.site.id === r.endpoint ? 'end' : (s.count ? 'hit' : 'skip')}">
        <div class="s-name">${s.site.name}</div><div class="s-meta">${s.count ? '裝 ' + s.count + ' 單' : '無貨跳過'}｜${s.cumVol}L</div></div>`).join('')}
    </div>`;
  }
  $('#br-dispatch-result').innerHTML = `
    <div class="result ${r.carried && r.carried.length ? 'ok' : 'warn'}" style="margin-top:16px;">
      <div class="r-head">派車模式：${modeBadge}　終點：${endpoint}　出勤天數：${r.days} 天 <span class="g-tag">G37</span></div>
      <div>觸發原因：${r.reason || '—'}｜容量使用 <b>${r.capUsed || 0}L</b> / ${r.capTotal || 0}L${r.timeUsed != null ? `｜時間 <b>${r.timeUsed}分</b> / ${r.timeTotal}分` : ''}</div>
      ${r.carried ? `<div style="margin-top:6px;">載運：${r.carried.map(o => o.id).join(', ') || '（無）'}</div>` : ''}
      ${routeViz}
    </div>
    <div class="trace">${r.trace.join('\n')}</div>`;
  toast(`${r.modeLabel || ''}派車完成`, 'ok');
  renderBr_approved(); renderBaList();
}

/* ============================================================
   模組 C · 申請端（使用者）
   ============================================================ */
RENDER.c_apply = function () {
  const p = $('#page-c_apply');
  const oOpts = DB.bizOrigins.map(o => `<option>${o}</option>`).join('');
  const dOpts = DB.bizDests.map(d => `<option>${d}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">出差用車申請（使用者）</div>
    <div class="section-sub">來回單：司機車輛全程綁定同批人。單程單：限交通轉運點，出發前配對、4 小時窗。送出後由主管准駁、再進批次媒合。</div>
    <div class="grid-2">
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
        <div class="row">
          <div class="field"><label>出發日期</label><input type="date" id="ca-date" value="2026-08-27"></div>
          <div class="field"><label>最早上車（去程）</label><input type="time" id="ca-pickup" value="09:00"></div>
        </div>
        <div class="row">
          <div class="field" id="ca-return-wrap"><label>最早回程時間</label><input type="time" id="ca-return" value="16:00"></div>
          <div class="field"><label>人數</label><input type="number" id="ca-pax" value="2"></div>
        </div>
        <div class="callout info">最晚抵達時間為系統查車程表算出的參考值，<b>不參與媒合判斷</b>（G55）。</div>
        <button class="btn btn-primary" id="ca-submit">▶ 送出申請（待主管准駁）</button>
        <button class="btn btn-ghost" id="ca-demo">載入範例批次</button>
      </div>
      <div class="card">
        <div class="card-title">我的申請單</div>
        <div id="ca-list"></div>
      </div>
    </div>`;
  const setType = () => {
    const round = $('#page-c_apply input[value=round]').checked;
    $('#ca-round').classList.toggle('sel', round);
    $('#ca-oneway').classList.toggle('sel', !round);
    $('#ca-return-wrap').style.display = round ? 'block' : 'none';
  };
  $$('#page-c_apply input[name=ca-type]').forEach(r => r.onchange = setType);
  $('#ca-submit').onclick = () => {
    const type = $('#page-c_apply input[name=ca-type]:checked').value;
    const app = ModuleC.createApp({
      applicant: $('#ca-applicant').value, dept: $('#ca-dept').value, ext: $('#ca-ext').value,
      type, origin: $('#ca-origin').value, dest: $('#ca-dest').value,
      departDate: $('#ca-date').value, earliestPickup: $('#ca-pickup').value,
      earliestReturn: $('#ca-return').value, pax: +$('#ca-pax').value,
    });
    toast(`${app.id} 已送出，等待主管准駁`, 'ok'); renderCaList();
  };
  $('#ca-demo').onclick = loadCDemo;
  renderCaList();
};
function loadCDemo() {
  const D = '2026-08-27';
  const demos = [
    { type: 'round', origin: '台北總部', dest: '台中辦公室', earliestPickup: '09:00', earliestReturn: '16:00', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' },
    { type: 'round', origin: '台北總部', dest: '台中辦公室', earliestPickup: '09:00', earliestReturn: '16:00', pax: 2, applicant: '財務部-鄭安琪', dept: '財務部', ext: '3310' },
    { type: 'oneway', origin: '台北總部', dest: '桃園機場T1', earliestPickup: '08:00', earliestReturn: '', pax: 3, applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' },
    { type: 'oneway', origin: '桃園機場T1', dest: '台北總部', earliestPickup: '11:00', earliestReturn: '', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' },
    { type: 'round', origin: '台北總部', dest: '新竹分公司', earliestPickup: '07:30', earliestReturn: '19:30', pax: 4, applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' },
  ];
  demos.forEach(d => ModuleC.createApp({ ...d, departDate: D }));
  toast('已載入 5 筆共乘申請（待審核）', 'ok'); renderCaList();
}
function renderCaList() {
  const rows = ModuleC.applications;
  $('#ca-list').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">📝</div>尚無申請單，可「載入範例批次」</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>型態</th><th>路線</th><th>日期/上車</th><th>人</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(a => `<tr><td>${a.id}</td><td>${a.type === 'round' ? '來回' : '單程'}</td>
        <td>${a.origin}→${a.dest}</td><td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.pax}</td><td>${stBadge(a.status)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   模組 C · 審核/調度端（業務單位）
   ============================================================ */
RENDER.c_review = function () {
  const p = $('#page-c_review');
  p.innerHTML = `
    <div class="section-h">媒合審核（業務單位）</div>
    <div class="section-sub">主管准駁 → 批次媒合（未來 7 天）→ 資源檢核、手動併車、逾期作廢。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="review">① 主管准駁</div>
      <div class="pill-tab" data-tab="batch">② 批次媒合</div>
      <div class="pill-tab" data-tab="manual">③ 手動併車 / 作廢</div>
    </div>
    <div id="cr-tab-review"></div>
    <div id="cr-tab-batch" style="display:none;"></div>
    <div id="cr-tab-manual" style="display:none;"></div>`;
  $$('#page-c_review .pill-tab').forEach(t => t.onclick = () => {
    $$('#page-c_review .pill-tab').forEach(x => x.classList.toggle('active', x === t));
    ['review', 'batch', 'manual'].forEach(k => $('#cr-tab-' + k).style.display = k === t.dataset.tab ? 'block' : 'none');
    if (t.dataset.tab === 'batch') renderCr_batch();
    if (t.dataset.tab === 'manual') renderCr_manual();
  });
  renderCr_review(); renderCr_batch(); renderCr_manual();
};
function renderCr_review() {
  const submitted = ModuleC.applications.filter(a => a.status === 'submitted');
  $('#cr-tab-review').innerHTML = `
    <div class="card">
      <div class="card-title">待審核（主管准駁）<span class="g-tag">G63</span></div>
      <div class="card-desc">駁回保留紀錄但不進排班池。核准後才進入批次媒合範圍。</div>
      ${submitted.length === 0 ? `<div class="empty">目前無待審核申請單。</div>` : `
      <div style="margin-bottom:10px;"><button class="btn btn-ghost btn-sm" id="cr-approve-all">✓ 全部核准</button></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>日期/上車</th><th>操作</th></tr></thead><tbody>
        ${submitted.map(a => `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${a.type === 'round' ? '來回' : '單程'}</td>
          <td>${a.origin}→${a.dest}</td><td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
          <td><button class="btn btn-primary btn-sm" data-ap="${a.id}">核准</button>
              <button class="btn btn-ghost btn-sm" data-rj="${a.id}">駁回</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  const all = $('#cr-approve-all');
  if (all) all.onclick = () => { submitted.forEach(a => ModuleC.approve(a)); toast(`已核准 ${submitted.length} 筆`, 'ok'); renderCr_review(); renderCaList(); };
  $$('#cr-tab-review [data-ap]').forEach(b => b.onclick = () => { ModuleC.approve(ModuleC.applications.find(a => a.id === b.dataset.ap)); toast(`${b.dataset.ap} 已核准`, 'ok'); renderCr_review(); });
  $$('#cr-tab-review [data-rj]').forEach(b => b.onclick = () => { ModuleC.reject(ModuleC.applications.find(a => a.id === b.dataset.rj)); toast(`${b.dataset.rj} 已駁回`, 'err'); renderCr_review(); });
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
    toast(`批次 ${batch.id} 完成`, 'ok'); renderCaList();
  };
}
function renderCr_manual() {
  const active = ModuleC.applications.filter(a => ['approved', 'coordinate', 'manual'].includes(a.status));
  $('#cr-tab-manual').innerHTML = `
    <div class="card">
      <div class="card-title">手動併車 <span class="g-tag">G56</span></div>
      <div class="card-desc">向已確定有車的單搭便車。候選＝出發日期前後 1 天、已派車的單（不篩目的地、不比時間）。按「完成合併」即成立，免調度室確認。</div>
      ${active.length === 0 ? `<div class="empty">無待併車申請單。先核准並執行批次媒合。</div>` : `
      <div class="field" style="max-width:360px;"><label>選擇要搭便車的申請單</label>
        <select id="cr-manual-src">${active.map(a => `<option value="${a.id}">${a.id}｜${a.origin}→${a.dest}｜${statusText(a.status)}</option>`).join('')}</select></div>
      <button class="btn btn-primary btn-sm" id="cr-show-candidates">列出候選車輛</button>
      <div id="cr-candidates"></div>`}
    </div>
    <div class="card">
      <div class="card-title">逾期自動作廢 <span class="g-tag">G57</span></div>
      <div class="card-desc">到出發時間仍未成功 → 自動作廢、通知申請人、紀錄保留供統計、不轉待人工協調。（此處以按鈕模擬逾期）</div>
      ${active.length === 0 ? `<div class="empty">無可作廢單</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>路線</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        ${active.map(a => `<tr><td>${a.id}</td><td>${a.origin}→${a.dest}</td><td>${stBadge(a.status)}</td>
          <td><button class="btn btn-danger btn-sm" data-void="${a.id}">模擬逾期作廢</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  const showBtn = $('#cr-show-candidates');
  if (showBtn) showBtn.onclick = () => {
    const src = ModuleC.applications.find(a => a.id === $('#cr-manual-src').value);
    const cands = ModuleC.manualCandidates(src);
    if (cands.length === 0) { $('#cr-candidates').innerHTML = `<div class="callout">前後 1 天內查無已派車的候選單。</div>`; return; }
    $('#cr-candidates').innerHTML = `
      <div class="callout info" style="margin-top:12px;">為 <b>${src.id}</b>（${src.origin}→${src.dest}）尋找便車。不顯示私人手機。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>候選單</th><th>目的地</th><th>出發/最晚抵達</th><th>申請人 部門/分機</th><th>已載/剩餘</th><th></th></tr></thead><tbody>
        ${cands.map(c => `<tr><td>${c.app.id}</td><td>${c.dest}</td><td>${c.depart} / ${c.latest}</td>
          <td>${c.applicant}（${c.dept}/${c.ext}）</td><td>${c.loaded} / 剩 ${c.remain}</td>
          <td><button class="btn btn-primary btn-sm" data-merge="${c.app.id}" ${c.remain < src.pax ? 'disabled' : ''}>完成合併</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('#cr-candidates [data-merge]').forEach(b => b.onclick = () => {
      const target = ModuleC.applications.find(a => a.id === b.dataset.merge);
      ModuleC.doManualMerge(src, target);
      toast(`${src.id} 已搭 ${target.id} 便車，合併成立`, 'ok');
      renderCr_manual(); renderCaList();
    });
  };
  $$('#cr-tab-manual [data-void]').forEach(b => b.onclick = () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.void);
    const r = ModuleC.voidOverdue(a);
    openModal('逾期自動作廢（示意）', `
      <div class="result fail"><div class="r-head">✗ ${a.id} 已自動作廢</div>
        <div>系統已通知申請人：<b>${r.notified}</b></div></div>
      <div class="callout" style="margin-top:12px;">紀錄保留供媒合失敗率統計（G57），不轉待人工協調。作廢即最終結局。</div>`);
    toast(`${a.id} 逾期作廢並通知申請人`, 'err');
    renderCr_manual(); renderCaList();
  });
}
function statusText(s) {
  return ({ submitted: '待審核', approved: '已核准', rejected: '已駁回', matched: '已媒合', coordinate: '待人工協調', manual: '手動併車', void: '作廢' })[s] || s;
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
