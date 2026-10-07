/* ============================================================
   app.js — 前端控制器：導覽、渲染、互動
   純前端記憶體版原型（無資料庫、無後端）

   架構：使用者「申請端」與業務單位「審核/調度端」分離，
   四模組（A 巡迴物品轉運作業／B 院區物品轉運作業／C 差旅共乘作業／D 一般用車申請作業）各拆成
   申請／主管／調度／司機等軟體單元。
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
// opts.wide：寬版視窗（放含 grid 的區塊，如派車單明細）
function openModal(title, bodyHtml, opts) {
  $('#modal-mask .modal').classList.toggle('wide', !!(opts && opts.wide));
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-mask').classList.add('show');
  initMasonry($('#modal-body')); // 若含 .fgrid（資訊輸入欄位）則於顯示後排版
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

/* 狀態徽章：四模組對齊的顯示狀態（G122，js/flow.js 推導）*/
// 單位主管審核（二級審）清單的狀態篩選：待二級審／已同意（之後各狀態）／退回修編
const APPROVE_STATUS_OPTS = [['', '全部狀態'], ['review', '待二級審'], ['passed', '已同意（待調度以後）'], ['revise', '退回修編']];
const approveMatch = (r, st) => !st || (st === 'passed' ? !['draft', 'review', 'revise'].includes(Flow.of(r)) : Flow.of(r) === st);
const flowOpts = (cur, keys) => [['', '全部狀態']].concat(Flow.STATES.filter(x => !keys || keys.includes(x[0])).map(x => [x[0], x[1]]))
  .map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('');

/* ---------- 導覽（2 共用 + 6 業務單元）---------- */
const NAV = [
  { group: '總覽', items: [
    { id: 'dashboard', ico: '▤', label: '系統儀表板' },
    { id: 'guide', ico: '🧭', label: '申請引導' },
  ] },
  { group: '共用基礎', items: [
    { id: 'engine', ico: '⚙', label: '裝載判定引擎' },
    { id: 'master', ico: '▦', label: '主檔資料' },
  ] },
  { group: '模組 A · 巡迴物品轉運作業', items: [
    { id: 'a_apply', ico: '📝', label: 'A｜巡迴物品轉運申請（使用者）' },
    { id: 'a_dispatch', ico: '🗂', label: 'A｜車次追蹤／異動（業務）' },
    { id: 'a_usage', ico: '⛽', label: 'A｜車輛使用實登（業務）' },
    { id: 'a_route', ico: '🚌', label: 'A｜路線與班次（業務）' },
    { id: 'a_masonry', ico: '🧩', label: 'A｜資訊卡試做（Masonry）' },
    { id: 'a_driver', ico: '🧑‍✈️', label: 'A｜司機任務單（駕駛）' },
  ] },
  { group: '模組 B · 院區物品轉運作業', items: [
    { id: 'b_apply', ico: '📝', label: 'B｜院區物品轉運申請（使用者）' },
    { id: 'b_approve', ico: '✅', label: 'B｜單位主管審核（主管）' },
    { id: 'b_review', ico: '🚚', label: 'B｜派車調度（業務）' },
    { id: 'b_sign', ico: '🖋', label: 'B｜運輸主管簽審（運輸主管）' },
    { id: 'b_usage', ico: '⛽', label: 'B｜車輛使用實登（業務）' },
    { id: 'b_driver', ico: '🧑‍✈️', label: 'B｜司機任務單（駕駛）' },
  ] },
  { group: '模組 C · 差旅共乘作業', items: [
    { id: 'c_apply', ico: '📝', label: 'C｜差旅共乘申請（使用者）' },
    { id: 'c_approve', ico: '✅', label: 'C｜單位主管審核（主管）' },
    { id: 'c_review', ico: '🚐', label: 'C｜派車調度（業務）' },
    { id: 'c_sign', ico: '🖋', label: 'C｜運輸主管簽審（運輸主管）' },
    { id: 'c_usage', ico: '⛽', label: 'C｜車輛使用實登（業務）' },
    { id: 'c_driver', ico: '🧑‍✈️', label: 'C｜司機任務單（駕駛）' },
  ] },
  { group: '模組 D · 一般用車申請作業', items: [
    { id: 'd_apply', ico: '📝', label: 'D｜一般用車申請（使用者）' },
    { id: 'd_approve', ico: '✅', label: 'D｜單位主管審核（主管）' },
    { id: 'd_review', ico: '🚗', label: 'D｜派車調度（業務）' },
    { id: 'd_sign', ico: '🖋', label: 'D｜運輸主管簽審（運輸主管）' },
    { id: 'd_usage', ico: '⛽', label: 'D｜車輛使用實登（業務）' },
    { id: 'd_driver', ico: '🧑‍✈️', label: 'D｜司機任務單（駕駛）' },
  ] },
];
const PAGE_META = {
  a_usage: { title: '巡迴物品轉運作業 · 車輛使用實登（業務）', crumb: '模組 A · 業務端 · 依車次登打實際車輛／司機／里程與異常回報' },
  b_sign: { title: '院區物品轉運作業 · 運輸主管簽審（運輸主管）', crumb: '模組 B · 運輸主管端 · 派車結果覆核（通過才生效）' },
  b_usage: { title: '院區物品轉運作業 · 車輛使用實登（業務）', crumb: '模組 B · 業務端 · 依派車單登打實際車輛／駕駛／里程與貨品回報' },
  c_sign: { title: '差旅共乘作業 · 運輸主管簽審（運輸主管）', crumb: '模組 C · 運輸主管端 · 派車結果覆核（通過才生效）' },
  c_usage: { title: '差旅共乘作業 · 車輛使用實登（業務）', crumb: '模組 C · 業務端 · 依派車單登打實際車輛／駕駛／里程' },
  d_sign: { title: '一般用車申請作業 · 運輸主管簽審（運輸主管）', crumb: '模組 D · 運輸主管端 · 派車結果覆核（通過才生效）' },
  d_usage: { title: '一般用車申請作業 · 車輛使用實登（業務）', crumb: '模組 D · 業務端 · 依派車單登打實際車輛／駕駛／里程' },
  dashboard: { title: '系統儀表板', crumb: '車輛派遣系統整合 · 原型 v0.2' },
  guide: { title: '申請引導', crumb: '共用 · 查詢引導紀錄／新增引導（依填寫內容判定申請並帶入）' },
  engine: { title: '裝載判定引擎', crumb: '共用基礎層 · Phase 1 · G01–G05' },
  master: { title: '主檔資料', crumb: '共用基礎層 · Phase 0' },
  a_apply: { title: '巡迴物品轉運作業 · 巡迴物品轉運申請（使用者）', crumb: '模組 A · 申請端 · 送出即自動媒合 · G10–G19' },
  a_dispatch: { title: '巡迴物品轉運作業 · 車次追蹤／異動（業務單位）', crumb: '模組 A · 調度端 · 追蹤＋車次班次/車輛/司機調整 · G18/G20' },
  a_route: { title: '巡迴物品轉運作業 · 路線與班次（業務單位）', crumb: '模組 A · 調度端 · 固定路線 / 每小時班次（查詢）' },
  a_masonry: { title: '巡迴物品轉運作業 · 資訊卡試做（Masonry）', crumb: '模組 A · label+value 資訊區塊 · 自適應排版 POC' },
  a_driver: { title: '巡迴物品轉運作業 · 司機任務單（駕駛）', crumb: '模組 A · 駕駛端 · 沿線收送任務' },
  b_apply: { title: '院區物品轉運作業 · 院區物品轉運申請（使用者）', crumb: '模組 B · 申請端 · G34/G38' },
  b_approve: { title: '院區物品轉運作業 · 單位主管審核（直屬主管）', crumb: '模組 B · 主管端 · G63' },
  b_review: { title: '院區物品轉運作業 · 派車調度（業務單位）', crumb: '模組 B · 調度端 · 依派車日媒合派車產生派車單 · G117–G120 · G30–G44' },
  b_driver: { title: '院區物品轉運作業 · 司機任務單（駕駛）', crumb: '模組 B · 駕駛端 · 沿線取貨/卸貨' },
  c_apply: { title: '差旅共乘作業 · 差旅共乘申請（使用者）', crumb: '模組 C · 申請端 · G54/G55/G56' },
  c_approve: { title: '差旅共乘作業 · 單位主管審核（直屬主管）', crumb: '模組 C · 主管端 · G63' },
  c_review: { title: '差旅共乘作業 · 派車調度（業務單位）', crumb: '模組 C · 調度端 · 依出發日期批次媒合產生派車單 · G50–G63／G112–G115' },
  c_driver: { title: '差旅共乘作業 · 司機任務單（駕駛）', crumb: '模組 C · 駕駛端 · 今日行程與乘客' },
  d_apply: { title: '一般用車申請作業 · 一般用車申請（使用者）', crumb: '模組 D · 申請端 · G75/G79/G81/G83' },
  d_approve: { title: '一般用車申請作業 · 單位主管審核（直屬主管）', crumb: '模組 D · 主管端 · G74' },
  d_review: { title: '一般用車申請作業 · 派車調度（業務單位）', crumb: '模組 D · 調度端 · G71–G89' },
  d_driver: { title: '一般用車申請作業 · 司機任務單（駕駛）', crumb: '模組 D · 駕駛端 · 指派區間與使用人' },
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
  // 統計依四模組對齊的顯示狀態（G122）
  const all = [].concat(ModuleA.applications, ModuleB.orders, ModuleC.applications, ModuleD.applications);
  const cnt = keys => all.filter(r => keys.includes(Flow.of(r))).length;
  const aMatched = ModuleA.applications.filter(a => ['ready', 'departed', 'logged'].includes(Flow.of(a))).length;
  const bLoaded = ModuleB.orders.filter(o => ['ready', 'departed', 'logged'].includes(Flow.of(o))).length;
  const cMatched = ModuleC.applications.filter(a => ['ready', 'departed', 'logged'].includes(Flow.of(a))).length;
  const dDispatched = ModuleD.applications.filter(a => ['ready', 'departed', 'logged'].includes(Flow.of(a))).length;
  const pendReview = cnt(['review']);
  p.innerHTML = `
    <div class="section-h">系統儀表板</div>
    <div class="section-sub">車輛派遣系統整合原型 — 純前端可動版。依審批流程（G63）將「使用者申請」「單位主管審核」「業務審核/調度」「司機任務單」四種角色各自獨立，四模組各拆成申請／主管／調度／司機等業務單元。巡迴物品轉運作業（A）與院區物品轉運作業（B）的物流資源池獨立；差旅共乘作業（C）與一般用車申請作業（D）共用商務車輛／司機池，先佔先贏（G71/G72）。</div>
    <div class="stat-row">
      <div class="stat"><div class="k">待二級審（各模組）</div><div class="v accent">${pendReview}</div></div>
      <div class="stat"><div class="k">待調度／調度中／調度主管審</div><div class="v">${cnt(['todo'])} / ${cnt(['dispatching'])} / ${cnt(['signing'])}</div></div>
      <div class="stat"><div class="k">待出車～已回登 · A／B</div><div class="v">${aMatched} / ${bLoaded}</div></div>
      <div class="stat"><div class="k">待出車～已回登 · C／D</div><div class="v green">${cMatched} / ${dDispatched}</div></div>
    </div>

    <div class="card" data-go="guide" style="cursor:pointer;border:2px solid var(--navy);">
      <div class="card-title" style="justify-content:space-between;">🧭 不知道該用哪一種申請？ <span class="badge b-navy">申請引導</span></div>
      <div class="card-desc" style="margin-bottom:0;">照著填寫需求，系統依內容判定該用巡迴物品轉運申請、院區物品轉運申請、差旅共乘申請或一般用車申請，並把已填資料自動帶入該申請。</div>
    </div>
    <div class="card-title" style="font-size:14px;margin:8px 0 12px;color:var(--ink-soft);">共用基礎層</div>
    <div class="grid-2">
      ${dashCard('⚙ 裝載判定引擎', 'Level 1 體積 + 地板面積 + Level 2 六方向 + 重量累計。可解釋、不做 3D 碰撞模擬。', 'engine', 'G01–G05')}
      ${dashCard('▦ 主檔資料', '據點/站點/車輛/司機/浪費係數/保修/請假等示範主檔。', 'master', 'Phase 0')}
    </div>

    <div class="card-title" style="font-size:14px;margin:22px 0 12px;color:var(--ink-soft);">業務單元（申請端 ｜ 主管 ｜ 審核/調度端）</div>
    <div class="grid-3">
      ${unitCard('📝 A｜巡迴物品轉運申請', '使用者填收貨單，送出即自動媒合並告知班次時間與車號；查看狀態、接受排班與交貨確認。', 'a_apply', '申請端')}
      ${unitCard('🗂 A｜車次追蹤／異動', '追蹤已排定車次、未排入待改期與交貨狀態；並可調整車次的車輛／司機、加移單。', 'a_dispatch', '審核端')}
      ${unitCard('⛽ A｜車輛使用實登', '以車次為單位登打實際車輛／司機與起訖里程（實登人員自動帶入），並回報各單異常（不準時／沒出現）與貨品狀態；可修改並保留歷程。', 'a_usage', '審核端')}
      ${unitCard('🚌 A｜路線與班次', '獨立單元：各分公司固定 9 站路線與每小時班次／車輛對應查詢。', 'a_route', '審核端')}
      ${unitCard('🧑‍✈️ A｜司機任務單', '駕駛端：以班次（車輛）為單位，沿據點 9 站路線的收送任務、到站時間、接收人。', 'a_driver', '駕駛')}
      ${unitCard('📝 B｜院區物品轉運申請', '使用者建立院區物品轉運申請單（直達/非直達）、查看狀態。', 'b_apply', '申請端')}
      ${unitCard('✅ B｜單位主管審核', '直屬單位主管審核院區物品轉運申請；退回修編者由申請人修改後重新送出。', 'b_approve', '主管')}
      ${unitCard('🚚 B｜派車調度', '依派車日一鍵媒合派車（直達／貪婪／回程直達鎖定），同車產生派車單；異動車種類型、車號、駕駛人1／2 與是否送審；可退回託運單。', 'b_review', '審核端')}
      ${unitCard('🖋 B｜運輸主管簽審', '調度做出的派車結果送運輸主管覆核：同意才生效，不同意（意見必填）退回調度重新處理。', 'b_sign', '運輸主管')}
      ${unitCard('⛽ B｜車輛使用實登', '以派車單為單位：簽審通過後登打實際車種類型、車號、駕駛人1／駕駛人2 與起訖里程（實登人員自動帶入），並回報貨品狀態；可修改並保留歷程。', 'b_usage', '審核端')}
      ${unitCard('🧑‍✈️ B｜司機任務單', '駕駛端：以車輛為單位，這一趟停靠哪些據點、各站取貨／卸貨。', 'b_driver', '駕駛')}
      ${unitCard('📝 C｜差旅共乘申請', '使用者填來回/單程用車申請、查看狀態、手動併車找便車。', 'c_apply', '申請端')}
      ${unitCard('✅ C｜單位主管審核', '直屬單位主管審核差旅共乘申請；退回修編者由申請人修改後重新送出。', 'c_approve', '主管')}
      ${unitCard('🚐 C｜派車調度', '依出發日期批次媒合產生派車單（同車一張）；異動車種類型、車號、駕駛人1／2 與是否送審；可退回申請單、逾期作廢。', 'c_review', '審核端')}
      ${unitCard('🖋 C｜運輸主管簽審', '調度做出的派車結果送運輸主管覆核：同意才生效，不同意（意見必填）退回調度重新處理。', 'c_sign', '運輸主管')}
      ${unitCard('⛽ C｜車輛使用實登', '以派車單為單位：簽審通過後登打實際車種類型、車號、駕駛人1／駕駛人2 與起訖里程（實登人員自動帶入）；可修改並保留歷程。', 'c_usage', '審核端')}
      ${unitCard('🧑‍✈️ C｜司機任務單', '駕駛端：以駕駛為單位，今日整個行程要接誰、去哪裡。', 'c_driver', '駕駛')}
      ${unitCard('📝 D｜一般用車申請', '起訖時間（數小時～數個月）、人數、自駕／願意等待駕駛媒合、通行證與提示欄位、隨行貨物；例行用車類別限特定角色；派車後可提出提前歸還。', 'd_apply', '申請端')}
      ${unitCard('✅ D｜單位主管審核', '直屬單位主管審核首次申請（兩類別相同），通過才進調度；退回修編者由申請人修改後重新送出。', 'd_approve', '主管')}
      ${unitCard('🚗 D｜派車調度', '通行證交集篩選、例行用車優先、雙駕駛、剩餘加班工時；派車後換車／換司機／補派／展延、確認提前歸還；駕駛閒置時一鍵替補自駕駕駛。', 'd_review', '審核端')}
      ${unitCard('🖋 D｜運輸主管簽審', '調度做出的派車結果送運輸主管覆核：同意才生效，不同意（意見必填）退回調度重新處理。', 'd_sign', '運輸主管')}
      ${unitCard('⛽ D｜車輛使用實登', '以派車單為單位（一單一派車單）：簽審通過後登打實際車種類型、車號、駕駛人1／駕駛人2 與起訖里程（實登人員自動帶入）；可修改並保留歷程。', 'd_usage', '審核端')}
      ${unitCard('🧑‍✈️ D｜司機任務單', '駕駛端：依指派區間列出任務（雙駕駛標示搭檔）、使用人、隨行貨物（含危險品提示）。', 'd_driver', '駕駛')}
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

/* ---- 貨物編輯彈窗（新增/編輯共用）：送出 → onSave(新項目)，取消 → 關閉 ----
   opts.hazard：顯示「是否為危險品」（模組 D 隨行貨物 G75/G78；A/B 不帶則不顯示） */
function openCargoEditor(item, onSave, opts) {
  opts = opts || {};
  const it = Object.assign({ name: '', l: '', w: '', h: '', qty: 1, category: 'BOX', weight: '', hazardous: false, plan: '', workNo: '', pack: '' }, item || {});
  const nameLbl = opts.aCols ? '物品名稱' : '品名';
  const catOpts = DB.wasteFactors.map(f => `<option value="${f.code}" ${f.code === it.category ? 'selected' : ''}>${f.name}（係數 ${f.factor}）</option>`).join('');
  openModal(item ? '編輯貨物內容' : '新增貨物', `
    ${infoGrid('ce-fields', [
      opts.aCols ? fInput('計畫名稱', `<input type="text" id="ce-plan" value="${gEsc(it.plan)}">`) : '',
      opts.aCols ? fInput('工命號碼', `<input type="text" id="ce-workno" value="${gEsc(it.workNo)}">`) : '',
      fInput(nameLbl, `<input type="text" id="ce-name" value="${it.name}">`, { full: true }),
      fInput('長 (cm)', `<input type="number" id="ce-l" value="${it.l}">`),
      fInput('寬 (cm)', `<input type="number" id="ce-w" value="${it.w}">`),
      fInput('高 (cm)', `<input type="number" id="ce-h" value="${it.h}">`),
      fInput('類別 <span class="hint">浪費係數查表 G03</span>', `<select id="ce-cat">${catOpts}</select>`),
      fInput('數量', `<input type="number" id="ce-qty" value="${it.qty}">`),
      fInput('單件重 (kg)', `<input type="number" id="ce-wt" value="${it.weight}">`),
      opts.hazard ? fInput('是否為危險品 <span class="hint">僅供調度判斷，系統不自動限制（G78）</span>', `
        <div class="radio-group">
          <label class="radio-pill${it.hazardous ? '' : ' sel'}" id="ce-hz-no-pill"><input type="radio" name="ce-hz" value="no"${it.hazardous ? '' : ' checked'}>否</label>
          <label class="radio-pill${it.hazardous ? ' sel' : ''}" id="ce-hz-yes-pill"><input type="radio" name="ce-hz" value="yes"${it.hazardous ? ' checked' : ''}>是</label>
        </div>`, { stack: true, full: true }) : '',
      opts.aCols ? fInput('物品外包裝', `<input type="text" id="ce-pack" value="${gEsc(it.pack)}" placeholder="例：紙箱">`) : '',
    ].join(''))}
    <div style="text-align:center;margin-top:20px;">
      <button class="btn btn-primary" id="ce-ok">▶ 送出</button>
      <button class="btn btn-ghost" id="ce-cancel">取消</button>
    </div>`);
  $('#ce-cancel').onclick = closeModal;
  $$('#modal-body input[name=ce-hz]').forEach(r => r.onchange = () => {
    const yes = $('#modal-body input[name=ce-hz][value=yes]').checked;
    $('#ce-hz-yes-pill').classList.toggle('sel', yes); $('#ce-hz-no-pill').classList.toggle('sel', !yes);
  });
  $('#ce-ok').onclick = () => {
    const name = $('#ce-name').value.trim();
    const l = +$('#ce-l').value, w = +$('#ce-w').value, h = +$('#ce-h').value;
    const qty = +$('#ce-qty').value, weight = +$('#ce-wt').value;
    if (!name) { toast(`請填${nameLbl}`, 'err'); return; }
    if (!(l > 0 && w > 0 && h > 0)) { toast('長寬高需為正數', 'err'); return; }
    if (!(qty > 0)) { toast('數量需為正整數', 'err'); return; }
    const out = { name, l, w, h, qty, category: $('#ce-cat').value, weight: weight > 0 ? weight : 0 };
    if (opts.hazard) out.hazardous = $('#modal-body input[name=ce-hz][value=yes]').checked;
    if (opts.aCols) Object.assign(out, { plan: $('#ce-plan').value.trim(), workNo: $('#ce-workno').value.trim(), pack: $('#ce-pack').value.trim() });
    onSave(out);
    closeModal();
  };
}

/* ---- 貨物項目唯讀 grid；editable 時最左欄加「編輯／刪除」按鈕 ---- */
function renderCargoGrid(sel, items, editable, onChange, opts) {
  opts = opts || {};
  const box = $(sel);
  if (!box) return;
  const catName = (c) => (DB.wasteFactors.find(f => f.code === c) || {}).name || c;
  const hz = !!opts.hazard; // 模組 D：多一欄「危險品」
  const ac = !!opts.aCols; // 巡迴物品轉運（G138）：首兩欄計畫名稱、工命號碼，最後一欄物品外包裝
  const head = `${editable ? '<th></th>' : ''}${ac ? '<th>計畫名稱</th><th>工命號碼</th>' : ''}<th>${ac ? '物品名稱' : '品名'}</th><th>長×寬×高(cm)</th><th>類別</th><th>數量</th><th>單件重(kg)</th>${hz ? '<th>危險品</th>' : ''}${ac ? '<th>物品外包裝</th>' : ''}`;
  const cols = 5 + (editable ? 1 : 0) + (hz ? 1 : 0) + (ac ? 3 : 0);
  const body = items.length === 0
    ? `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:16px;">${opts.emptyText || `尚無貨物項目${editable ? '，請按右上角「新增」加入' : ''}。`}</td></tr>`
    : items.map((it, i) => `<tr>
        ${editable ? `<td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" data-cedit="${i}">編輯</button> <button class="btn btn-ghost btn-sm" data-cdel="${i}">刪除</button></td>` : ''}
        ${ac ? `<td>${gEsc(it.plan || '—')}</td><td>${gEsc(it.workNo || '—')}</td>` : ''}<td>${it.name}</td><td>${it.l}×${it.w}×${it.h}</td><td>${catName(it.category)}</td><td>${it.qty || 1}</td><td>${it.weight || 0}</td>${hz ? `<td>${it.hazardous ? '<span class="badge b-red">⚠ 是</span>' : '<span class="muted">否</span>'}</td>` : ''}${ac ? `<td>${gEsc(it.pack || '—')}</td>` : ''}</tr>`).join('');
  box.innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  if (editable) {
    $$(sel + ' [data-cedit]').forEach(b => b.onclick = () => openCargoEditor(items[+b.dataset.cedit], upd => { items[+b.dataset.cedit] = upd; onChange(); }, opts));
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
let aApply = { view: 'list', detailId: null, query: { applicant: '', branch: '', station: '', status: '', mode: '' }, resultIds: null };

// 區域內物流：分公司據點小工具
const brName = id => { const b = DB.branches.find(x => x.id === id); return b ? b.name : (id || '—'); };
// 某分公司的站點 <option>（value＝站點 id、顯示＝站點編號）
const branchStationOpts = (branchId, sel) => DB.stations.filter(s => s.branch === branchId)
  .map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${s.name}</option>`).join('');

/* ============================================================
   人員選取器（委運人／接收人／代理人）— A-specific
   姓名＝事業部→組別→組員 三段連動下拉；單位（事業部·組別）與分機自動由人事資料帶入；
   院區、館別為手動選填（院區沿用車屬院區清單、館別為 DB.halls）。
   人員物件：{ bu, group, name, ext, unit, campus, hall }
   ============================================================ */
const _buOpts = sel => DB.orgUnits.map(b => `<option value="${b.id}"${b.id === sel ? ' selected' : ''}>${b.name}</option>`).join('');
const _groupOpts = (buId, sel) => { const b = DB.orgUnits.find(x => x.id === buId); return (b ? b.groups : []).map(g => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.name}</option>`).join(''); };
const _memberOpts = (buId, groupId, sel) => { const b = DB.orgUnits.find(x => x.id === buId); const g = b && b.groups.find(x => x.id === groupId); return (g ? g.members : []).map(m => `<option value="${m.name}"${m.name === sel ? ' selected' : ''}>${m.name}</option>`).join(''); };
const _campusOpts = sel => ['<option value="">請選擇院區</option>'].concat(DB.branches.map(b => `<option value="${b.id}"${b.id === sel ? ' selected' : ''}>${b.name}</option>`)).join('');
const _hallOpts = sel => ['<option value="">請選擇館別</option>'].concat(DB.halls.map(h => `<option value="${h}"${h === sel ? ' selected' : ''}>${h}</option>`)).join('');

// 人員欄位（回傳 infoGrid 內用的 items 字串）；prefix＝欄位 id 前綴、role＝角色中文
// opts.noUnit：不顯示「單位」欄；opts.extLabel：分機改為可輸入（選姓名時預帶分機，可改填手機），以此為標籤（G138）
function personFieldItems(prefix, role, opts) {
  opts = opts || {};
  const b0 = DB.orgUnits[0].id, g0 = DB.orgUnits[0].groups[0].id;
  return [
    fInput(`${role}姓名 <span class="hint">事業部／組別／姓名</span>`,
      `<select id="${prefix}-bu" style="margin-bottom:4px;">${_buOpts(b0)}</select>
       <select id="${prefix}-group" style="margin-bottom:4px;">${_groupOpts(b0, g0)}</select>
       <select id="${prefix}-member">${_memberOpts(b0, g0)}</select>`, { stack: true, full: true }),
    opts.noUnit ? `<span id="${prefix}-unit" hidden></span>` : fItem(`${role}單位`, `<span id="${prefix}-unit" class="muted">—</span>`),
    opts.extLabel ? fInput(opts.extLabel, `<input type="text" id="${prefix}-ext" placeholder="分機或手機">`)
      : fItem(`${role}分機`, `<span id="${prefix}-ext" class="muted">—</span>`),
    fInput(`${role}院區`, `<select id="${prefix}-campus">${_campusOpts()}</select>`),
    fInput(`${role}館別`, `<select id="${prefix}-hall">${_hallOpts()}</select>`),
  ].join('');
}
// 掛連動：切事業部→重填組別→重填組員；選組員→自動帶單位/分機
function wirePerson(prefix, relayoutRoot) {
  const bu = $('#' + prefix + '-bu'), group = $('#' + prefix + '-group'), member = $('#' + prefix + '-member');
  if (!bu) return;
  const syncAuto = () => {
    const b = DB.orgUnits.find(x => x.id === bu.value);
    const g = b && b.groups.find(x => x.id === group.value);
    const m = g && g.members.find(x => x.name === member.value);
    $('#' + prefix + '-unit').textContent = (b && g) ? `${b.name}·${g.name}` : '—';
    const ex = $('#' + prefix + '-ext');
    if (ex.tagName === 'INPUT') ex.value = m ? m.ext : ''; else ex.textContent = m ? m.ext : '—';
    if (relayoutRoot) initMasonry(relayoutRoot);
  };
  const fillMembers = () => { member.innerHTML = _memberOpts(bu.value, group.value); syncAuto(); };
  const fillGroups = () => { group.innerHTML = _groupOpts(bu.value); fillMembers(); };
  bu.onchange = fillGroups; group.onchange = fillMembers; member.onchange = syncAuto;
  syncAuto();
}
// 讀取人員欄位值
function personVal(prefix) {
  const bu = $('#' + prefix + '-bu').value, group = $('#' + prefix + '-group').value, name = $('#' + prefix + '-member').value;
  const b = DB.orgUnits.find(x => x.id === bu);
  const g = b && b.groups.find(x => x.id === group);
  const m = g && g.members.find(x => x.name === name);
  const ex = $('#' + prefix + '-ext');
  return { bu, group, name, ext: ex && ex.tagName === 'INPUT' ? ex.value.trim() : (m ? m.ext : ''), unit: (b && g) ? `${b.name}·${g.name}` : '',
    campus: $('#' + prefix + '-campus').value, hall: $('#' + prefix + '-hall').value };
}
// 明細顯示：姓名·分機｜單位｜院區·館別
function personDisplay(pn) {
  if (!pn || !pn.name) return '<span class="muted">—</span>';
  const loc = [brName(pn.campus), pn.hall].filter(Boolean).join('·');
  return [pn.name + (pn.ext ? '（分機 ' + pn.ext + '）' : ''), pn.unit, loc].filter(Boolean).join('　·　');
}

// 巡迴物品轉運送貨站點顯示（G138 移除送貨建物；舊資料有建物時一併顯示）
function aDestText(a) { const st = DB.stations.find(s => s.id === a.station); return (st ? st.name : '—') + (a.building ? ' / ' + a.building : ''); }
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
  const brOpts = ['<option value="">全部分公司</option>'].concat(
    DB.branches.map(b => `<option value="${b.id}" ${q.branch === b.id ? 'selected' : ''}>${b.name}</option>`)).join('');
  const stOpts = ['<option value="">全部站點</option>'].concat(
    DB.stations.map(s => `<option value="${s.id}" ${q.station === s.id ? 'selected' : ''}>${brName(s.branch)}·${s.name}</option>`)).join('');
  const statusOpts = flowOpts(q.status, ['draft', 'todo', 'noCar', 'ready', 'departed', 'logged']);   // A 無二級審／調度主管關卡
  const modeOpts = [['', '全部模式'], ['asap', '越快越好'], ['exact', '指定期望時間']]
    .map(([v, t]) => `<option value="${v}" ${q.mode === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">巡迴物品轉運申請（使用者）</div>
    <div class="section-sub">先查詢歷史申請紀錄，點擊任一筆可檢視明細；或按「新增」建立新的巡迴物品轉運申請單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="aq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="aq-new">＋ 新增</button>
        </span>
      </div>
      ${infoGrid('aq-fields', [
        fInput('申請人（模糊）', `<input type="text" id="aq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('車屬院區', `<select id="aq-branch">${brOpts}</select>`),
        fInput('目的地站點', `<select id="aq-station">${stOpts}</select>`),
        fInput('物品運輸單狀態', `<select id="aq-status">${statusOpts}</select>`),
        fInput('收貨模式', `<select id="aq-mode">${modeOpts}</select>`),
      ].join(''))}
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
    // 由人事資料組出人員物件（示意）
    const P = (buId, gId, name, campus, hall) => { const b = DB.orgUnits.find(x => x.id === buId); const g = b.groups.find(x => x.id === gId); const m = g.members.find(x => x.name === name);
      return { bu: buId, group: gId, name, ext: m.ext, unit: `${b.name}·${g.name}`, campus, hall }; };
    // [院區, 收貨站(起), 送貨站(迄), 模式, 上貨分, 下貨分, 貨物, 委運人, 接收人, 接收代理人]
    [['D10', 'D10-200', 'D10-300', 'asap', 10, 5, [{ name: '零件箱', l: 50, w: 40, h: 30, qty: 6, category: 'BOX', weight: 12 }], P('BU1', 'BU1-G1', '林建志', 'D10', 'A 館'), P('BU2', 'BU2-G1', '吳承恩', 'D10', 'B 館'), P('BU3', 'BU3-G1', '鄭文彬', 'D10', '行政館')],
     ['D10', 'D10-200', 'D10-600', 'exact', 12, 8, [{ name: '棧板', l: 110, w: 90, h: 120, qty: 1, category: 'PALLET', weight: 200 }], P('BU1', 'BU1-G2', '黃美玲', 'D10', 'A 館'), P('BU2', 'BU2-G2', '張裕明', 'D10', 'C 館'), null],
     ['D6', 'D6-300', 'D6-900', 'asap', 15, 10, [{ name: '長料', l: 480, w: 25, h: 25, qty: 3, category: 'LONG', weight: 30 }], P('BU1', 'BU1-G1', '陳志明', 'D6', 'B 館'), P('BU3', 'BU3-G2', '許雅雯', 'D6', '門診館'), null]
    ].forEach(([branch, pick, s, mode, lm, um, items, consignor, recipient, recipientAgent]) => { const pSt = DB.stations.find(x => x.id === pick);
      ModuleA.submit({
        applicant: DB.currentUser.name, applyUnit: DB.currentUser.unit, applyExt: DB.currentUser.ext,
        branch, station: s, building: DB.stations.find(x => x.id === s).buildings[0],
        pickStation: pick, pickupLoc: pSt.name + ' / ' + pSt.buildings[0],
        deliverTime: mode === 'exact' ? '14:00' : '', consignor, recipient, recipientAgent,
        items, recvMode: mode, loadMin: lm, unloadMin: um }); });
    aApply.resultIds = null; renderAGrid(); toast('已載入 3 筆巡迴物品轉運申請（送出即自動媒合）', 'ok');
  };
  renderAGrid();
  initMasonry(p);
}
function runAQuery() {
  aApply.query = {
    applicant: $('#aq-applicant').value.trim(),
    branch: $('#aq-branch').value,
    station: $('#aq-station').value,
    status: $('#aq-status').value,
    mode: $('#aq-mode').value,
  };
  const q = aApply.query;
  const res = ModuleA.applications.filter(a =>
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.branch || a.branch === q.branch) &&
    (!q.station || a.station === q.station) &&
    (!q.status || Flow.of(a) === q.status) &&
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
      <th></th><th>物品運輸單號</th><th>申請人</th><th>目的地</th><th>日期</th><th>模式</th><th>班次</th><th>物品運輸單狀態</th><th>申請日期</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        return `<tr>
          <td><button class="btn btn-ghost btn-sm" data-detail="${a.id}">細節</button></td>
          <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
          <td>${brName(a.branch)}·${aDestText(a)}</td>
          <td>${a.serviceDate || '—'}</td>
          <td>${a.recvMode === 'exact' ? '指定期望時間' : '越快越好'}</td>
          <td>${sh ? sh.label : '—'}</td><td>${Flow.badge(a)}</td>
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
  const canEdit = ['draft', 'unscheduled'].includes(a.status); // 申請中／待調度（未排入）可編輯貨物
  p.innerHTML = `
    <div class="section-h">巡迴物品轉運申請明細 · ${a.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${Flow.badge(a)}</span></div>
      ${infoGrid('ad-basic', [
        fItem('物品運輸單狀態', a.transportStatus || '開單'),
        fItem('物品運輸單號', `<b style="color:var(--navy);">${a.id}</b>`),
        fItem('申請人', a.applicant),
        fItem('申請單位/委運單位', a.applyUnit || '<span class="muted">—</span>'),
        fItem('申請人分機', a.applyExt || '<span class="muted">—</span>'),
        fItem('申請日期', a.applyDate || ModuleA.rocDate(new Date(a.createdAt))),
        fItem('危險品運輸', a.hazardTransport === 'yes' ? '<span class="badge b-red">是</span>' : '否'),
        fItem('車屬院區', brName(a.branch)),
        fItem('收貨站點', a.pickupLoc || '<span class="muted">—</span>'),
        fItem('送貨站點', aDestText(a)),
        fItem('收貨模式', a.recvMode === 'exact' ? '指定期望時間' : '越快越好（離現在最近）'),
        fItem('排班日期', `<b>${a.serviceDate || '—'}</b>${a.serviceDate === ModuleA.todayStr() ? ' <span class="badge b-navy">今天</span>' : ''}`),
        fItem('期望收貨時間', a.deliverTime || '<span class="muted">—</span>'),
        fItem('裝貨 / 卸貨所需時間', `${a.loadMin || 0} 分 / ${a.unloadMin || 0} 分（合計 ${a.handleMin} 分）`),
        fItem('備註', gEsc(a.remark || '—')),
        fItem('建立時間', fmtTime(a.createdAt)),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">委運人資訊</div>
      ${infoGrid('ad-cons', fItem('委運人', personDisplay(a.consignor), { full: true, tall: true }))}
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      ${infoGrid('ad-recv', [
        fItem('接收人', personDisplay(a.recipient), { full: true, tall: true }),
        fItem('接收代理人', personDisplay(a.recipientAgent), { full: true, tall: true }),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目（總體積約 ${totalVol.toFixed(0)}L）</span>
        ${canEdit ? `<button class="btn btn-accent btn-sm" id="ad-add">＋ 新增</button>` : ''}</div>
      <div id="ad-items"></div>
      ${canEdit ? `<div class="muted" style="margin-top:6px;">${a.status === 'draft' ? '此單為申請中（暫存），可編輯貨物後按下方「送出申請」。' : '此單尚未排入班次，可編輯貨物；編輯後可按下方「重新媒合」再試一次。'}</div>` : ''}
    </div>
    ${a.status === 'draft' ? `<div class="card"><div class="card-title">申請中（暫存）</div>
      <div class="callout info" style="margin-bottom:12px;">此單尚未送出。送出後系統立即自動媒合班次。</div>
      <button class="btn btn-primary" id="ad-submitdraft">▶ 送出申請並自動媒合</button></div>` : ''}
    ${noCarCard(a)}
    <div class="card" ${a.status === 'draft' || a.status === 'noCar' ? 'style="display:none;"' : ''}>
      <div class="card-title">自動媒合結果</div>
      ${a.status === 'unscheduled'
        ? `<div class="callout warn"><b>待調度 — 尚未排入班次</b><br>${a.note || '當日各班次皆無法排入（不留候補、不排隔日 G12）。'}調度可於「車次追蹤／異動」改派班次或無車退回。</div>
           <div style="margin-top:12px;"><button class="btn btn-primary btn-sm" id="ad-rematch">↻ 重新媒合</button></div>`
        : infoGrid('ad-match', [
        fItem('排定班次', sh ? sh.label : '<span class="muted">尚未排班</span>'),
        fItem('車號', veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '—'),
        fItem('預計到站時間', a.arrival ? `<b style="color:var(--navy);">${a.arrival}</b>` : '—'),
        fItem('與期望時間差', a.expectDiffMin == null ? '<span class="muted">—（未指定期望）</span>'
          : a.expectDiffMin === 0 ? '準時'
          : `較期望時間${a.expectDiffMin > 0 ? '晚' : '早'} ${Math.abs(a.expectDiffMin)} 分（僅提示）`),
        fItem('異常回報', a.incident ? '<span class="badge b-red">' + a.incident + '</span>' : '無'),
      ].join(''))}
    </div>
    ${backBar('ad-back')}`;
  renderCargoGrid('#ad-items', a.items, canEdit, () => RENDER.a_apply(), A_CARGO_OPTS);
  if (canEdit) {
    const add = $('#ad-add');
    if (add) add.onclick = () => openCargoEditor(null, it => { a.items.push(it); RENDER.a_apply(); }, A_CARGO_OPTS);
    const rm = $('#ad-rematch');
    if (rm) rm.onclick = confirmThen({ title: '確認重新媒合？', text: '將依目前貨物內容重新執行自動媒合。' }, () => {
      const r = ModuleA.rematch(a);
      toast(r.ok ? `${a.id} 已媒合：${r.shift.label}／到站約 ${r.arrival}` : `${a.id}｜${r.msg}`, r.ok ? 'ok' : 'err');
      RENDER.a_apply();
    });
  }
  const sd = $('#ad-submitdraft');
  if (sd) sd.onclick = confirmThen({ title: '確認送出巡迴物品轉運申請？', text: '送出後系統將<b>立即自動媒合</b>並告知班次時間與車號。' }, () => {
    const { result } = ModuleA.submitDraft(a);
    guideSubmitted(null, a.id);   // 由引導帶入後暫存的單：回填引導紀錄
    toast(result.ok ? `${a.id} 已自動媒合：${result.shift.label}／到站約 ${result.arrival}` : `${a.id}｜${result.msg}`, result.ok ? 'ok' : 'err');
    RENDER.a_apply();
  });
  $('#ad-back').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  initMasonry(p);
}

/* ---------- 新增畫面 ---------- */
function renderAApplyNew(p) {
  const initBranch = DB.branches[0].id;
  const brOpts = DB.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const stOpts = branchStationOpts(initBranch);
  const req = '<span style="color:#c0392b;">＊</span>';
  p.innerHTML = `
    <div class="section-h">新增巡迴物品轉運申請單</div>
    <div class="card">
      <div class="card-title">填寫巡迴物品轉運申請單 <span class="g-tag">G13/G19/G138</span></div>
      ${infoGrid('aa-fields', [
        fItem('物品運輸單狀態', '開單'),
        fItem('物品運輸單號', `${ModuleA.nextNo()} <span class="hint">（儲存後產生）</span>`),
        fItem('申請人', DB.currentUser.name),
        fInput(`申請單位/委運單位${req}`, `<input type="text" id="aa-unit" value="${gEsc(DB.currentUser.unit)}">`),
        fItem('申請人分機', DB.currentUser.ext),
        fItem('申請日期', ModuleA.rocDate()),
        fInput('危險品運輸', `<div class="radio-group" id="aa-hz-wrap">
            <label class="radio-pill"><input type="radio" name="aa-hz" value="yes">是</label>
            <label class="radio-pill sel"><input type="radio" name="aa-hz" value="no" checked>否</label></div>`),
        fInput('車屬院區', `<select id="aa-branch">${brOpts}</select>`),
        fInput('收貨站點', `<select id="aa-pickuploc">${stOpts}</select>`),
        fInput('送貨站點', `<select id="aa-station">${stOpts}</select>`),
        fInput('收貨時間模式 <span class="hint">兩種皆不享班次內插隊優先權 G19</span>', `
          <div class="radio-group">
            <label class="radio-pill sel" id="aa-mode-asap"><input type="radio" name="aa-recv" value="asap" checked>越快越好（離現在最近）</label>
            <label class="radio-pill" id="aa-mode-exact"><input type="radio" name="aa-recv" value="exact">指定期望時間</label>
          </div>`, { stack: true, full: true }),
      ].join(''))}
      <div class="row" id="aa-deliver-wrap" style="display:none;">
        <div class="field"><label>期望日期 <span class="hint">今天或未來日期</span></label><input type="date" id="aa-date"></div>
        <div class="field"><label>期望收貨時間 <span class="hint">僅用於挑選最接近的班次，非硬性截止（4.1）</span></label><input type="time" id="aa-deliver" value="14:00"></div>
      </div>
      <div class="callout info" id="aa-today-hint" style="display:none;margin-bottom:10px;">選擇<b>今天</b>時，<b>已經出發的班次不會被媒合</b>；若今日班次都已過，請改選未來日期。</div>
      ${infoGrid('aa-fields2', [
        fInput('裝貨所需時間 <span class="hint">分</span>', `<input type="number" id="aa-load" value="10">`),
        fInput('卸貨所需時間 <span class="hint">分</span>', `<input type="number" id="aa-unload" value="5">`),
        fInput('備註', `<input type="text" id="aa-remark">`, { full: true }),
        fInput('是否送出', `<div class="radio-group" id="aa-send-wrap">
            <label class="radio-pill"><input type="radio" name="aa-send" value="yes">是</label>
            <label class="radio-pill sel"><input type="radio" name="aa-send" value="no" checked>否</label></div>`),
      ].join(''))}
      <div class="divider"></div>
      <div class="card-title">委運人資訊</div>
      ${infoGrid('aa-cons', personFieldItems('acon', '委運人', { noUnit: true, extLabel: `委運人分機${req}/手機` }))}
      <div class="divider"></div>
      <div class="card-title">接收人資訊</div>
      ${infoGrid('aa-recv', personFieldItems('arec', '接收人', { noUnit: true }))}
      <div class="card-title" style="font-size:14px;margin-top:6px;">接收代理人資訊 <span class="hint">選填</span></div>
      ${infoGrid('aa-rag', personFieldItems('arag', '接收代理人', { noUnit: true, extLabel: `接收代理人分機${req}/手機` }))}
      <div class="divider"></div>
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        <button class="btn btn-accent btn-sm" id="aa-add">＋ 新增</button></div>
      <div id="aa-items"></div>
      <div class="divider"></div>
      <div class="callout info" style="margin-bottom:10px;">「是否送出」選<b>是</b>：儲存後系統<b>立即自動媒合</b>（無需主管核准、無需業務按鈕），並直接告知媒合到的<b>班次時間與車號</b>；選<b>否</b>：暫存為「申請中」，之後可於明細頁送出。</div>
      <button class="btn btn-primary" id="aa-save">💾 儲存</button>
      <button class="btn btn-ghost" id="aa-cancel">取消</button>
    </div>
    ${backBar('an-back')}`;
  $('#an-back').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  // 切換院區：重填收/送貨站點選單（限該院區）
  $('#aa-branch').onchange = () => {
    const opts = branchStationOpts($('#aa-branch').value);
    $('#aa-pickuploc').innerHTML = opts; $('#aa-station').innerHTML = opts;
    initMasonry(p);
  };
  // 是／否單選膠囊樣式（危險品運輸、是否送出）
  ['aa-hz', 'aa-send'].forEach(n => $$(`#page-a_apply input[name=${n}]`).forEach(r => r.onchange = () =>
    $$(`#${n}-wrap .radio-pill`).forEach(l => l.classList.toggle('sel', $('input', l).checked))));
  $$('#page-a_apply input[name=aa-recv]').forEach(r => r.onchange = () => {
    const exact = $('#page-a_apply input[value=exact]').checked;
    $('#aa-mode-asap').classList.toggle('sel', !exact);
    $('#aa-mode-exact').classList.toggle('sel', exact);
    $('#aa-deliver-wrap').style.display = exact ? '' : 'none'; // 期望日期/時間僅指定期望時間需要
    $('#aa-today-hint').style.display = exact ? '' : 'none';
    initMasonry(p);
  });
  // 期望日期預設今天、不可早於今天
  const _today = ModuleA.todayStr();
  $('#aa-date').value = _today; $('#aa-date').min = _today;
  wirePerson('acon', p); // 委運人：姓名連動下拉＋自動帶單位/分機
  wirePerson('arec', p); // 接收人
  wirePerson('arag', p); // 接收代理人
  renderAaItems(); // 一開始顯示空白清單
  initMasonry(p);  // 表單資訊區塊自適應排版（與顯示頁一致）
  guideApply('A', aApply, p); // 申請引導帶入（若有）
  $('#aa-add').onclick = () => openCargoEditor(null, it => { aaItems.push(it); renderAaItems(); }, A_CARGO_OPTS);
  $('#aa-cancel').onclick = () => { aApply.view = 'list'; RENDER.a_apply(); };
  // 儲存：依「是否送出」— 是＝送出並自動媒合、否＝暫存為申請中（G138）
  $('#aa-save').onclick = () => ($('#page-a_apply input[name=aa-send]:checked').value === 'yes' ? aaSubmit() : aaDraft());
  const aaDraft = async () => {
    const data = aaFormData(); if (!data) return;
    if (!(await confirmDialog({ title: '確認暫存？', text: '「是否送出」為否：將儲存為「申請中」，尚未送出、不會媒合；之後可於明細頁送出。' }))) return;
    const app = ModuleA.saveDraft(data);
    guideDrafted(aApply, app.id);
    aaItems = [];
    toast(`${app.id} 已暫存（申請中）`, 'ok');
    aApply.resultIds = null; aApply.view = 'detail'; aApply.detailId = app.id; RENDER.a_apply();
  };
  const aaSubmit = async () => {
    const data = aaFormData(); if (!data) return;
    const ok = await confirmDialog({ title: '確認送出巡迴物品轉運申請？',
      text: '送出後系統將<b>立即自動媒合</b>並告知班次時間與車號。' });
    if (!ok) return;
    const { app, result } = ModuleA.submit(data);
    aaItems = [];
    guideSubmitted(aApply, app.id); // 申請引導紀錄回填單號
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
// 讀取新增表單（驗證不過回傳 null）：送出與暫存共用
function aaFormData() {
  if (aaItems.length === 0) { toast('請至少新增一項貨物', 'err'); return null; }
  const mode = $('#page-a_apply input[name=aa-recv]:checked').value;
  // 送出即自動媒合（G10–G12/G16/G19）
  const pickSt = DB.stations.find(s => s.id === $('#aa-pickuploc').value);
  const dropSt = DB.stations.find(s => s.id === $('#aa-station').value);
  if (pickSt && dropSt && pickSt.order >= dropSt.order) {
    toast('收貨站須在送貨站之前（路線行進方向）', 'err'); return null;
  }
  const applyUnit = $('#aa-unit').value.trim();
  if (!applyUnit) { toast('請填寫「申請單位/委運單位」', 'err'); return null; }
  const consignor = personVal('acon'), agent = personVal('arag');
  if (!consignor.ext) { toast('請填寫「委運人分機/手機」', 'err'); return null; }
  if (!agent.ext) { toast('請填寫「接收代理人分機/手機」', 'err'); return null; }
  if (mode === 'exact') {
    const d = $('#aa-date').value;
    if (!d) { toast('請選擇期望日期', 'err'); return null; }
    if (d < ModuleA.todayStr()) { toast('期望日期不可早於今天', 'err'); return null; }
  }
  return {
    applicant: DB.currentUser.name, applyUnit, applyExt: DB.currentUser.ext,
    hazardTransport: $('#page-a_apply input[name=aa-hz]:checked').value, remark: $('#aa-remark').value.trim(),
    branch: $('#aa-branch').value, station: $('#aa-station').value,
    building: '',
    pickStation: $('#aa-pickuploc').value,
    pickupLoc: pickSt ? pickSt.name : '',
    deliverTime: mode === 'exact' ? $('#aa-deliver').value : '', // 期望收貨時間（僅 exact 用於排序）
    serviceDate: mode === 'exact' ? $('#aa-date').value : ModuleA.todayStr(), // 排班日期（asap＝今天）
    consignor,                           // 委運人
    recipient: personVal('arec'),        // 接收人
    recipientAgent: agent,               // 接收代理人
    items: aaItems.map(x => ({ ...x })), recvMode: mode,
    loadMin: +$('#aa-load').value || 0, unloadMin: +$('#aa-unload').value || 0,
  };
}
// 巡迴物品轉運貨物 grid（G138）：首兩欄計畫名稱、工命號碼，最後一欄物品外包裝；品名改稱物品名稱
const A_CARGO_OPTS = { aCols: true };
function renderAaItems() { renderCargoGrid('#aa-items', aaItems, true, renderAaItems, A_CARGO_OPTS); }
// 相容：審核端動作呼叫此函式刷新申請端 grid（若目前正在查詢畫面）
function renderAaList() { if ($('#aq-grid')) renderAGrid(); }

/* ============================================================
   模組 A · 路線與班次（業務單位）— 獨立單元（查詢）
   自「車次追蹤」拆出：各分公司據點固定 9 站路線 + 每小時班次／車輛對應。
   ============================================================ */
RENDER.a_route = function () {
  const p = $('#page-a_route');
  // 每個分公司據點各有 9 站固定路線（100~900）與專屬 5 班班次（獨立路線）
  const perBranch = DB.branches.map(b => {
    const sts = DB.stations.filter(s => s.branch === b.id);
    const shs = DB.regionalShifts.filter(s => s.branch === b.id);
    return `
    <div class="card">
      <div class="card-title">${b.name} · 9 站固定路線 <span class="g-tag">G14</span></div>
      <div class="card-desc">固定地理順序（站點 100→900）、無貨跳過、不重排。同站先卸後裝、多單時間加總。</div>
      <div class="route">${sts.map(s => `<div class="stop"><div class="s-name">${s.name}</div><div class="s-meta">建物 ${s.buildings[0]}–${s.buildings[s.buildings.length - 1]}</div></div>`).join('')}</div>
      <div class="card-title" style="font-size:14px;margin-top:14px;">今日班次 · 車輛對應 <span class="g-tag">G18</span></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>班次</th><th>出發</th><th>車輛</th><th>容量</th><th>重量上限</th></tr></thead><tbody>
        ${shs.map(sh => { const v = DB.vehicles.find(x => x.id === sh.vehicle);
          return `<tr><td>${sh.label}</td><td>${sh.depart}</td><td>${v.name}</td><td>${v.volume.toFixed(0)}L</td><td>${v.weight}kg</td></tr>`; }).join('')}
      </tbody></table></div>
    </div>`;
  }).join('');
  p.innerHTML = `
    <div class="section-h">路線與班次（業務單位）</div>
    <div class="section-sub">各分公司據點的固定 9 站路線與每小時班次／車輛對應。本單元自「車次追蹤」獨立拆出（查詢）；站點順序、班次時間、對應車輛的<b>維護（編輯）</b>於後續版本開放。<b>個別車次</b>的車輛／司機覆寫，請至「已排定車次異動」。</div>
    ${perBranch}`;
};
// 異常回報選項（value → 顯示）；'' ＝正常運送（預設）。編輯於「車輛使用實登」明細頁的本車次申請單 grid（G123）
const INCIDENT_OPTS = ModuleA.INCIDENTS;
function incidentLabel(v) { const m = INCIDENT_OPTS.find(o => o[0] === (v || '')); return m ? m[1] : v; }

/* ============================================================
   模組 A · 已排定車次異動（業務單位）— 查詢頁 + 明細頁
   調整申請單所屬班次、修改車次的車輛/司機、於明細頁新增/移出班次的單。
   ============================================================ */
let aDispatch = { view: 'list', key: null, query: { date: '', vehicle: '', driver: '', shift: '' } };

// 以「收貨日期＋班次」聚合已排定的物流申請單為「車次」（含已出車／已回登，
// 交貨後仍可於此追蹤；未排入 unscheduled 另於清單上方追蹤，不聚合成車次）
function dispatchGroups() {
  const map = {};
  ModuleA.applications
    .filter(a => a.status === 'matched' && a.assignedShift && a.serviceDate)
    .forEach(a => { const k = a.serviceDate + '|' + a.assignedShift; (map[k] = map[k] || []).push(a); });
  return map;
}
const drvName = id => { const d = DB.drivers.find(x => x.id === id); return d ? d.name : (id || '—'); };
const vehName = id => { const v = DB.vehicles.find(x => x.id === id); return v ? v.name : (id || '—'); };

RENDER.a_dispatch = function () {
  if (aDispatch.view === 'detail') return renderADispatchDetail();
  return renderADispatchList();
};

function renderADispatchList() {
  const p = $('#page-a_dispatch');
  const q = aDispatch.query;
  const vehOpts = ['<option value="">全部車輛</option>'].concat(
    ModuleA.logiVehicles().map(v => `<option value="${v.id}" ${q.vehicle === v.id ? 'selected' : ''}>${v.id}（${v.name}）</option>`)).join('');
  const drvOpts = ['<option value="">全部司機</option>'].concat(
    ModuleA.logiDrivers().map(d => `<option value="${d.id}" ${q.driver === d.id ? 'selected' : ''}>${d.name}</option>`)).join('');
  const shOpts = ['<option value="">全部班次</option>'].concat(
    DB.regionalShifts.map(s => `<option value="${s.id}" ${q.shift === s.id ? 'selected' : ''}>${brName(s.branch)}·${s.label}</option>`)).join('');
  // 未排入·待改期（追蹤）：自動媒合失敗的單，不聚合成車次，於清單上方獨立追蹤
  const unsched = ModuleA.applications.filter(a => a.status === 'unscheduled');
  const unschedCard = unsched.length === 0 ? '' : `
    <div class="card">
      <div class="card-title">待調度（未排入班次） <span class="g-tag">G12/G17/G122</span></div>
      <div class="card-desc">自動媒合時當日各班次皆裝不下或時間額度已滿（不留候補、不排隔日 G12）。可於車次明細「新增」改派班次；確定無車可派者按<b>無車退回</b>（原因必填，結案）。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>物品運輸單號</th><th>申請人</th><th>目的地</th><th>原因</th><th>操作</th></tr></thead><tbody>
        ${unsched.map(a => { const st = DB.stations.find(s => s.id === a.station);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${brName(a.branch)}·${aDestText(a)}</td><td class="muted">${a.note || '—'}</td>
            <td><button class="btn btn-danger btn-sm" data-anocar="${a.id}">無車退回</button></td></tr>`; }).join('')}
      </tbody></table></div>
    </div>`;
  p.innerHTML = `
    <div class="section-h">車次追蹤／異動（業務單位）</div>
    <div class="section-sub">使用者送出巡迴物品轉運申請時系統即自動媒合，本單元不再執行媒合。<b>追蹤</b>已排定車次與待調度（未排入）的單；點「細節」進入明細頁調整所屬<b>班次</b>、修改車次的<b>車輛／司機</b>、<b>新增／移出</b>申請單。駕駛異常回報請至「車輛使用實登」明細頁。路線與班次查詢請至獨立單元「路線與班次」。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="ad-goto-driver">🧑‍✈️ 查看司機任務單</button>
      <button class="btn btn-ghost btn-sm" id="ad-goto-route">🚌 路線與班次</button></div>
    ${unschedCard}
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="ad-search">🔍 查詢</button></div>
      ${infoGrid('adq-fields', [
        fInput('收貨日期', `<input type="date" id="adq-date" value="${q.date || ''}">`),
        fInput('車輛', `<select id="adq-veh">${vehOpts}</select>`),
        fInput('司機', `<select id="adq-drv">${drvOpts}</select>`),
        fInput('班次', `<select id="adq-shift">${shOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>已排定車次</span><span class="muted" id="ad-count"></span></div>
      <div id="ad-grid"></div>
    </div>`;
  $('#ad-goto-driver').onclick = () => goto('a_driver');
  $('#ad-goto-route').onclick = () => goto('a_route');
  $$('#page-a_dispatch [data-anocar]').forEach(b => b.onclick = () => openNoCarDialog(ModuleA.applications.find(x => x.id === b.dataset.anocar),
    (a, note, by) => ModuleA.returnNoCar(a, note, by), () => { RENDER.a_dispatch(); renderAaList(); }));
  $('#ad-search').onclick = () => {
    aDispatch.query = { date: $('#adq-date').value, vehicle: $('#adq-veh').value, driver: $('#adq-drv').value, shift: $('#adq-shift').value };
    renderADispatchGrid();
  };
  renderADispatchGrid();
  initMasonry(p);
}

// 已排定車次（車次追蹤／異動、車輛使用實登共用）：q＝{date, vehicle, driver, shift}
function aTripRows(q) {
  q = q || {};
  const groups = dispatchGroups();
  return Object.keys(groups).map(k => {
    const [date, shiftId] = k.split('|');
    const plan = ModuleA.shiftPlan(date, shiftId);
    const sh = DB.regionalShifts.find(s => s.id === shiftId);
    const dep = groups[k].filter(a => ['departed', 'logged'].includes(Flow.of(a))).length;
    const logged = groups[k].filter(a => Flow.of(a) === 'logged').length;
    return { key: k, date, shiftId, sh, plan, apps: groups[k], n: groups[k].length, dep, logged };
  }).filter(r =>
    (!q.date || r.date === q.date) &&
    (!q.shift || r.shiftId === q.shift) &&
    (!q.vehicle || r.plan.vehicle === q.vehicle) &&
    (!q.driver || r.plan.driver === q.driver)
  ).sort((a, b) => a.date.localeCompare(b.date) ||
    DB.regionalShifts.findIndex(s => s.id === a.shiftId) - DB.regionalShifts.findIndex(s => s.id === b.shiftId));
}
// btn＝最左按鈕文字（車次追蹤「細節」、車輛使用實登「明細」），按鈕帶 data-key
function aTripTable(rows, btn) {
  return rows.length === 0 ? `<div class="empty"><div class="big">🔍</div>查無符合條件的已排定車次</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>收貨日期</th><th>車輛</th><th>司機</th><th>班次</th><th>單數</th><th>車次狀態</th></tr></thead><tbody>
      ${rows.map(r => {
        const badge = r.logged === r.n ? '<span class="badge b-green">已回登</span>'
          : r.dep ? '<span class="badge b-green">已出車</span>' : '<span class="badge b-navy">待出車</span>';
        return `<tr>
        <td><button class="btn btn-ghost btn-sm" data-key="${r.key}">${btn}</button></td>
        <td>${r.date}</td>
        <td><b style="color:var(--navy);">${r.plan.vehicle || '—'}</b>（${vehName(r.plan.vehicle)}）</td>
        <td>${drvName(r.plan.driver)}</td>
        <td>${r.sh ? brName(r.sh.branch) + '·' + r.sh.label : r.shiftId}</td>
        <td>${r.n}</td><td>${badge}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
function renderADispatchGrid() {
  const box = $('#ad-grid'); if (!box) return;
  const rows = aTripRows(aDispatch.query);
  $('#ad-count').textContent = `${rows.length} 個車次`;
  box.innerHTML = aTripTable(rows, '細節');
  $$('#ad-grid [data-key]').forEach(b => b.onclick = () => { aDispatch.key = b.dataset.key; aDispatch.view = 'detail'; RENDER.a_dispatch(); });
}

function renderADispatchDetail() {
  const p = $('#page-a_dispatch');
  const [date, shiftId] = (aDispatch.key || '').split('|');
  const sh = DB.regionalShifts.find(s => s.id === shiftId);
  if (!sh) { aDispatch.view = 'list'; return RENDER.a_dispatch(); }
  const plan = ModuleA.shiftPlan(date, shiftId);
  const orders = ModuleA.applications.filter(a => a.status === 'matched' && a.serviceDate === date && a.assignedShift === shiftId);
  const vehOpts = ModuleA.logiVehicles().map(v => `<option value="${v.id}" ${plan.vehicle === v.id ? 'selected' : ''}>${v.id}（${v.name}）</option>`).join('');
  const drvOpts = ModuleA.logiDrivers().map(d => `<option value="${d.id}" ${plan.driver === d.id ? 'selected' : ''}>${d.name}</option>`).join('');
  const body = orders.length === 0
    ? `<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">此車次目前沒有申請單，可按右上角「新增」加入。</td></tr>`
    : orders.map(a => { const st = DB.stations.find(s => s.id === a.station);
        // 已出車／已回登的單不可再移出，改顯示狀態徽章
        const act = ['departed', 'logged'].includes(Flow.of(a))
          ? Flow.badge(a)
          : `<button class="btn btn-ghost btn-sm" data-del="${a.id}">刪除</button>`;
        return `<tr>
          <td>${act}</td>
          <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
          <td>${a.pickupLoc || '—'}</td><td>${aDestText(a)}</td>
          <td>${itemsSummary(a.items)}</td></tr>`; }).join('');
  p.innerHTML = `
    <div class="section-h">車次明細 · ${brName(sh.branch)}｜${date}｜${sh.label}</div>
    <div class="card">
      <div class="card-title">班次車輛資訊</div>
      ${infoGrid('add-info', [
        fItem('車屬院區', brName(sh.branch)),
        fItem('班次', `<b>${sh.label}</b>`),
        fItem('收貨日期', date),
        fInput('車輛 <span class="hint">可修改</span>', `<select id="add-veh">${vehOpts}</select>`),
        fInput('司機 <span class="hint">可修改</span>', `<select id="add-drv">${drvOpts}</select>`),
      ].join(''))}
      <div style="margin-top:6px;"><button class="btn btn-primary btn-sm" id="add-save">💾 儲存車輛／司機</button>
        <span class="hint" style="margin-left:8px;">此調整為本車次（日期＋班次）覆寫，不影響班次主檔預設。</span></div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>本車次申請單（${orders.length} 筆）</span>
        <button class="btn btn-accent btn-sm" id="add-add">＋ 新增</button></div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th></th><th>物品運輸單號</th><th>申請人</th><th>收貨站點（起）</th><th>送貨站點（迄）</th><th>貨物</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="muted" style="margin-top:6px;">「刪除」＝將該單移出本班次（回未排入，待重新指定）；「新增」＝把同日其他班次或未排入的單改派到本班次。</div>
    </div>
    ${backBar('add-back')}`;
  $('#add-back').onclick = () => { aDispatch.view = 'list'; RENDER.a_dispatch(); };
  $('#add-save').onclick = () => {
    ModuleA.setShiftPlan(date, shiftId, { vehicle: $('#add-veh').value, driver: $('#add-drv').value });
    toast(`${date}｜${sh.label} 車輛／司機已更新`, 'ok');
    RENDER.a_dispatch();
  };
  $$('#page-a_dispatch [data-del]').forEach(b => b.onclick = confirmThen(
    { title: '確認移出本班次？', text: '此單將移出本車次、回到未排入狀態，待業務重新指定班次。' }, () => {
      const a = ModuleA.applications.find(x => x.id === b.dataset.del);
      if (a) { ModuleA.removeFromShift(a); toast(`${a.id} 已移出本班次`, 'ok'); RENDER.a_dispatch(); }
    }));
  const add = $('#add-add');
  if (add) add.onclick = () => openDispatchAdd(date, shiftId);
  initMasonry(p);
}

// 新增：把「同日、非本班次」的 matched/未排入單改派到本班次
function openDispatchAdd(date, shiftId) {
  const sh = DB.regionalShifts.find(s => s.id === shiftId);
  const cands = ModuleA.applications.filter(a =>
    a.serviceDate === date && a.branch === sh.branch && a.assignedShift !== shiftId && ['matched', 'unscheduled'].includes(a.status));
  const rows = cands.length === 0
    ? `<div class="callout" style="margin-top:6px;">同日沒有可加入的申請單（其他班次或未排入）。</div>`
    : `<div class="table-wrap"><table class="dt"><thead><tr><th></th><th>物品運輸單號</th><th>申請人</th><th>送貨站點</th><th>目前班次</th></tr></thead><tbody>
        ${cands.map(a => { const st = DB.stations.find(s => s.id === a.station);
          const cur = a.assignedShift ? (DB.regionalShifts.find(s => s.id === a.assignedShift) || {}).label : '未排入';
          return `<tr><td><button class="btn btn-accent btn-sm" data-pick="${a.id}">加入</button></td>
            <td>${a.id}</td><td>${a.applicant}</td><td>${aDestText(a)}</td><td>${cur || '—'}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  openModal(`新增單到 ${date}｜${sh.label}`, `
    <div class="card-desc">選取要改派到本班次的申請單（同一收貨日期）。加入後原班次即移除、改到本班次並重算到站時間。</div>
    ${rows}`);
  $$('#modal-body [data-pick]').forEach(b => b.onclick = () => {
    const a = ModuleA.applications.find(x => x.id === b.dataset.pick);
    if (a) { ModuleA.reassignShift(a, shiftId); closeModal(); toast(`${a.id} 已改派到 ${sh.label}`, 'ok'); RENDER.a_dispatch(); }
  });
}

/* ============================================================
   模組 A · 資訊卡試做（Masonry POC）
   把一張表單拆成多個獨立「資訊區塊（item）」，每塊 label + value。
   value 相容兩種模式：純文字（is-text）與 widget 掛載點（is-widget，示範用原生
   select/date/time；正式版於同一 DOM 節點掛 Kendo：kendoDropDownList / kendoDatePicker…）。
   欄寬用百分比（33.33%），交給 Masonry 依可用寬度自動排列、換行、變高不齊時打包。
   ============================================================ */
// grid-item 寬度修飾：w2＝2 欄寬、full＝滿版（供較長欄位或群組控件）
const _giCls = opts => 'grid-item' + (opts.full ? ' full' : (opts.w2 ? ' w2' : ''));

// 顯示型資訊區塊：label 藍字＋一個空格＋value（純文字或 widget 掛載點），同一行呈現。tall=多行值
function fItem(label, valueHtml, opts) {
  opts = opts || {};
  return `<div class="${_giCls(opts)}"><div class="fcard${opts.tall ? ' tall' : ''}"><span class="fcard-label">${label}</span> <span class="fcard-value ${opts.widget ? 'is-widget' : 'is-text'}"${opts.widget ? ` data-widget="${opts.widget}"` : ''}>${valueHtml}</span></div></div>`;
}
// 輸入型資訊區塊：label 藍字＋輸入控件（控件填滿區塊剩餘寬度），同一行；stack=控件另起一行（群組用）
function fInput(label, inputHtml, opts) {
  opts = opts || {};
  return `<div class="${_giCls(opts)}"><div class="fcard fcard-input${opts.stack ? ' stack' : ''}"><span class="fcard-label">${label}</span> <span class="fcard-value">${inputHtml}</span></div></div>`;
}
// 包一層 .fgrid（含 Masonry 需要的 grid-sizer）
function infoGrid(id, itemsHtml) {
  return `<div class="fgrid" id="${id}"><div class="grid-sizer"></div>${itemsHtml}</div>`;
}
// 初始化 root 內所有 .fgrid（實例存在 grid 元素上）；未載入 Masonry 時退回 float 排版
function initMasonry(root) {
  const grids = $$('.fgrid', root || document);
  if (!grids.length) return;
  const run = () => grids.forEach(grid => {
    if (grid._masonry && grid._masonry.destroy) grid._masonry.destroy();
    if (window.Masonry) {
      grid._masonry = new window.Masonry(grid, {
        itemSelector: '.grid-item', columnWidth: '.grid-sizer', percentPosition: true, gutter: 0, transitionDuration: '0.2s',
      });
    } else { grid.classList.add('no-masonry'); }
  });
  if (window.requestAnimationFrame) requestAnimationFrame(run); else run();
}
const fSelect = (id, options, sel) => `<select id="${id}">${options.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${t}</option>`).join('')}</select>`;

RENDER.a_masonry = function () {
  const p = $('#page-a_masonry');
  // 取一張示範申請單（無資料則用假資料），把每個欄位拆成 item
  const a = ModuleA.applications[0] || {
    id: 'LA001', applicant: '業務部-周雅婷', station: 'S3', building: '一號月台',
    pickupLoc: '五股廠 / 原料倉', recvMode: 'exact', serviceDate: ModuleA.todayStr(),
    deliverTime: '14:00', loadMin: 10, unloadMin: 5, handleMin: 15, assignedShift: 'R-A1',
    recipient: { unit: '生產部', name: '林建志', phone: '03-1234567#210', agentName: '陳怡君', agentPhone: '0912-345-678' },
    items: [{ name: '零件箱', qty: 6 }, { name: '棧板', qty: 1 }],
  };
  const st = DB.stations.find(s => s.id === a.station) || {};
  const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
  const stationOpts = DB.stations.map(s => [s.id, `${s.order}. ${s.name}`]);

  // 混合：純文字 item 與 widget item（下拉／日期／時間）——示範 value 兩種 render 模式
  const items = [
    fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
    fItem('申請人', a.applicant),
    fItem('收貨模式', fSelect('m-mode', [['asap', '越快越好'], ['exact', '指定期望時間']], a.recvMode), { widget: 'dropdown' }),
    fItem('目的地站點', fSelect('m-station', stationOpts, a.station), { widget: 'dropdown' }),
    fItem('送貨建物', a.building || '—'),
    fItem('收貨地點（起）', a.pickupLoc || '—'),
    fItem('排班日期', `<input type="date" id="m-date" value="${a.serviceDate || ''}">`, { widget: 'datepicker' }),
    fItem('期望收貨時間', `<input type="time" id="m-time" value="${a.deliverTime || '14:00'}">`, { widget: 'timepicker' }),
    fItem('上貨 / 下貨時間', `${a.loadMin || 0} 分 / ${a.unloadMin || 0} 分`),
    fItem('排定班次', sh ? sh.label : '尚未排班'),
    fItem('接收人', personDisplay(a.recipient), { tall: true }),
    fItem('貨物摘要', (a.items || []).map(it => `${it.name || '貨物'} × ${it.qty || 1}`).join('\n') || '—', { tall: true }),
  ].join('');

  p.innerHTML = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>巡迴物品轉運申請 · ${a.id}</span>
        <button class="btn btn-ghost btn-sm" id="m-relayout">↻ 重新排版</button></div>
      <div class="fgrid" id="m-grid">
        <div class="grid-sizer"></div>
        ${items}
      </div>
    </div>
    <div class="callout info">Masonry 以絕對定位排版；欄寬用百分比（<code>33.333%</code>、非寫死 px），故換行由可用寬度決定。value 區塊 <code>.fcard-value.is-widget</code> 即為 widget 掛載點——正式版在同一節點呼叫 <code>kendoDropDownList / kendoDatePicker</code> 即可，純文字則走 <code>.is-text</code>。</div>`;

  mountWidgets(p);          // Kendo 掛載 hook（原型：無 kendo 時保留原生控件）
  layoutMasonry();          // 初始化／重排 Masonry
  const rl = $('#m-relayout'); if (rl) rl.onclick = layoutMasonry;
};

// widget 掛載 hook：正式版於 [data-widget] 節點掛 Kendo；原型無 window.kendo 時保留原生控件
function mountWidgets(root) {
  $$('.fcard-value[data-widget]', root).forEach(el => {
    if (window.kendo && window.jQuery) {
      // 範例（正式版）：依 data-widget 掛對應 Kendo 元件
      // const $w = window.jQuery(el).children().first();
      // if (el.dataset.widget === 'dropdown') $w.kendoDropDownList();
      // else if (el.dataset.widget === 'datepicker') $w.kendoDatePicker();
    }
    el.dataset.mounted = '1'; // 標記已處理（原型：原生控件即為 value 呈現）
  });
}

// 初始化或重新排版 Masonry（POC 頁）；委派共用引擎 initMasonry
function layoutMasonry() { initMasonry($('#page-a_masonry')); }

/* ---- 無車退回（G122）：調度將「待調度」申請單退回（原因必填、結案），四模組共用對話框 ---- */
function openNoCarDialog(rec, doReturn, onDone) {
  if (!rec) return;
  openModal(`無車退回 · ${rec.id}`, `
    <div class="callout" style="margin-bottom:12px;">${rec.applicant}｜目前狀態 ${Flow.label(Flow.of(rec))}<br>
      無車退回後申請單<b>結案、不可再修改或重送</b>，申請人需另開新單。</div>
    ${infoGrid('nc-f', [
      fInput('退回原因 <span style="color:#c0392b;">*</span>', `<input type="text" id="nc-note" placeholder="例：當日車輛與駕駛皆已排滿">`, { full: true }),
      fInput('退回人', `<input type="text" id="nc-by" value="調度室-值班人員">`),
    ].join(''))}
    <div style="text-align:center;margin-top:18px;">
      <button class="btn btn-danger" id="nc-ok">↩ 無車退回</button>
      <button class="btn btn-ghost" id="nc-cancel">取消</button>
    </div>`);
  $('#nc-cancel').onclick = closeModal;
  $('#nc-ok').onclick = async () => {
    const note = $('#nc-note').value.trim();
    if (!note) { toast('無車退回時「退回原因」為必填', 'err'); $('#nc-note').focus(); return; }
    if (!(await confirmDialog({ title: '確認無車退回？', text: `${rec.id} 將無車退回（結案）：${note}` }))) return;
    const r = doReturn(rec, note, $('#nc-by').value.trim() || '調度室');
    if (!r.ok) { toast(r.error, 'err'); return; }
    closeModal(); toast(`${rec.id} 已無車退回`, 'err'); onDone();
  };
}
// 申請端明細：無車退回卡片
function noCarCard(rec) {
  if (Flow.of(rec) !== 'noCar') return '';
  return `<div class="card"><div class="card-title">無車退回</div>
    <div class="callout" style="margin-bottom:0;">${/^批次媒合/.test(rec.noCarBy || '') ? '系統媒合<b>無車可派</b>（不同意併車），已無車退回' : '調度已<b>無車退回</b>此申請'}（結案，不可再修改或重送）。退回原因：<b>${rec.noCarNote || rec.dispatchNote || '—'}</b>${rec.noCarBy ? `｜${rec.noCarBy}` : ''}${rec.noCarAt ? ` ${fmtTime(rec.noCarAt)}` : ''}</div></div>`;
}
/* ---- 退回修編（單位主管審核退回）：申請端明細卡片與編輯帶值小工具（B／C 共用）---- */
function returnedCard(rec, btnId) {
  if (rec.status === 'draft') return `<div class="card">
      <div class="card-title">申請中（暫存）</div>
      <div class="callout info" style="margin-bottom:12px;">此單尚未送出。可編輯內容後送出，送出後進入「待二級審」（單位主管審核）。</div>
      <button class="btn btn-primary" id="${btnId}">✎ 編輯並送出</button>
    </div>`;
  if (rec.status !== 'rejected') return '';
  const byDispatch = rec.returnedBy === 'dispatch';
  return `<div class="card">
      <div class="card-title">${byDispatch ? '派車調度' : '單位主管審核'} · 退回修編</div>
      <div class="callout" style="margin-bottom:12px;">${byDispatch ? '派車調度' : '單位主管'}已<b>退回修編</b>。${byDispatch ? '退回原因' : '審核備註'}：<b>${rec.reviewNote || '—'}</b><br>請依備註修改後重新送出，將重新經單位主管審核。${(rec.revisions || []).length ? `（已修改送出 ${rec.revisions.length} 次）` : ''}</div>
      <button class="btn btn-primary" id="${btnId}">✎ 修改後重新送出</button>
    </div>`;
}
// 編輯畫面上方說明：申請中（暫存）／退回修編
function editBanner(rec) {
  return rec.status === 'draft'
    ? `<div class="callout info" style="margin-bottom:14px;">此單為<b>申請中</b>（暫存）。可繼續暫存，或送出進入「待二級審」。</div>`
    : `<div class="callout info" style="margin-bottom:14px;">此單已<b>退回修編</b>（審核備註：${rec.reviewNote || '—'}）。修改後送出，將重新經單位主管審核（待二級審）。</div>`;
}
// 建物下拉帶值：選項中有就選，否則選「其他」並填入文字
function setBldgVal(selId, otherId, val) {
  const sel = $('#' + selId); if (!sel || !val) return;
  if ([...sel.options].some(o => o.value === val)) sel.value = val;
  else { sel.value = '其他'; $('#' + otherId).value = val; }
  if (sel.onchange) sel.onchange();
}

/* ============================================================
   模組 B · 申請端（使用者）
   ============================================================ */
let bApply = { view: 'list', detailId: null, editId: null, query: { applicant: '', leg: '', site: '', status: '', direct: '' }, resultIds: null };

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
  const statusOpts = flowOpts(q.status, Flow.STATES.map(x => x[0]).filter(k => k !== 'cancelled'));   // B 無申請人取消
  p.innerHTML = `
    <div class="section-h">院區物品轉運申請（使用者）</div>
    <div class="section-sub">先查詢歷史託運紀錄，點擊任一筆可檢視明細；或按「新增」建立新的院區物品轉運申請單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="bq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="bq-new">＋ 新增</button>
        </span>
      </div>
      ${infoGrid('bq-fields', [
        fInput('申請人（模糊）', `<input type="text" id="bq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('據點', `<select id="bq-site">${siteOpts}</select>`),
        fInput('派送型態', `<select id="bq-direct">${dirOpts}</select>`),
        fInput('狀態', `<select id="bq-status">${statusOpts}</select>`),
      ].join(''))}
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
        wantReceiveDate: bDayStr(3), wantReceiveTime: '09:00', loadMin: lm, unloadMin: handleMin - lm }); });
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
        wantReceiveDate: bDayStr(3), wantReceiveTime: '09:00', loadMin: lm, unloadMin: handleMin - lm }); });
    bApply.resultIds = null; renderBGrid(); toast('已載入 3 筆回程範例（含 1 直達）', 'ok');
  };
  renderBGrid();
  initMasonry(p);
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
    (!q.status || Flow.of(o) === q.status));
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
        <td>${Flow.badge(o)}${signBadge(o)}</td></tr>`).join('')}
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
  const bCanEdit = ['submitted', 'approved'].includes(o.status); // 調度中（併入派車單）後不可編輯貨物
  const action = '';
  p.innerHTML = `
    <div class="section-h">院區物品轉運申請明細 · ${o.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${Flow.badge(o)}${signBadge(o)}</span></div>
      ${infoGrid('bd-basic', [
        fItem('單號', `<b style="color:var(--navy);">${o.id}</b>`),
        fItem('申請人', o.applicant),
        fItem('收貨據點（起）', `${ModuleB.siteById(o.pickSite).name}<span class="hint" style="margin-left:6px;">幹線車到此收貨</span>`),
        fItem('送貨據點（迄）', `${ModuleB.siteById(o.dropSite).name}<span class="hint" style="margin-left:6px;">送達此據點</span>`),
        fItem('收貨地點（建物）', o.pickupLoc || '<span class="muted">—</span>'),
        fItem('送貨地點（建物）', o.deliverLoc || '<span class="muted">—</span>'),
        fItem('派送型態', o.direct ? '直達（單一目的地 G38）' : '非直達（沿線收送）'),
        fItem('希望收貨日期／時間 <span class="hint">＋4h 收貨時間窗（2.19）</span>', o.wantReceiveTime || o.wantReceiveDate ? `${o.wantReceiveDate || ''} ${o.wantReceiveTime || ''}${o.wantReceiveTime ? `<span class="hint" style="margin-left:6px;">～${minToHHMM(hhmmToMin(o.wantReceiveTime) + DB.receiveWindowMin)}</span>` : ''}` : '<span class="muted">—</span>'),
        fItem('貨量 / 重量', `${o.volume}L / ${o.weight}kg`),
        fItem('有效體積（容量計算用）', `<b>${ModuleB.effVolume(o).toFixed(0)}L</b>`),
        fItem('上貨 / 下貨時間', `${o.loadMin || 0} 分 / ${o.unloadMin || 0} 分（合計 ${o.handleMin} 分）`),
        fItem('建立時間', fmtTime(o.createdAt)),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      ${infoGrid('bd-recv', fItem('接收人', recipientDisplay(o.recipient), { full: true, tall: true }))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        ${bCanEdit ? `<button class="btn btn-accent btn-sm" id="bd-add">＋ 新增</button>` : ''}</div>
      <div id="bd-items"></div>
      ${bCanEdit ? `<div class="muted" style="margin-top:6px;">此單尚未派車，可新增／編輯／刪除貨物項目。</div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">派車資訊</div>
      ${infoGrid('bd-dispatch', [
        fItem('指派車號', veh ? `<b style="color:var(--navy);">${veh.id}</b>（${veh.name}）` : '<span class="muted">尚未派車</span>'),
        fItem('預計來收時間', o.pickupTime ? `<b style="color:var(--navy);">${o.pickupTime}</b>　<span class="hint">幹線車抵達「${ModuleB.siteById(o.pickSite).name}」收貨的時間</span>` : '<span class="muted">待派車</span>', { w2: true }),
      ].join(''))}
      ${action ? `<div class="divider"></div><div><b>接收人操作：</b> ${action}</div>` : ''}
    </div>
    ${returnedCard(o, 'bd-edit')}${noCarCard(o)}
    ${backBar('bd-back')}`;
  const bed = $('#bd-edit');
  if (bed) bed.onclick = () => { bApply.editId = o.id; bApply.view = 'new'; RENDER.b_apply(); };
  renderCargoGrid('#bd-items', o.items, bCanEdit, () => { ModuleB.recompute(o); RENDER.b_apply(); });
  if (bCanEdit) {
    const add = $('#bd-add');
    if (add) add.onclick = () => openCargoEditor(null, it => { o.items.push(it); ModuleB.recompute(o); RENDER.b_apply(); });
  }
  $('#bd-back').onclick = () => { bApply.view = 'list'; RENDER.b_apply(); };
  initMasonry(p);
}

/* ---------- 新增畫面 ---------- */
let baItems = []; // 幹線新增表單的貨物項目暫存（每筆含獨立尺寸與重量，比照 A）
function renderBaCargo() { renderCargoGrid('#ba-items', baItems, true, renderBaCargo); }
function renderBApplyNew(p) {
  const editing = bApply.editId ? ModuleB.orders.find(x => x.id === bApply.editId && ModuleB.canEdit(x)) : null;
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">${editing ? `修改院區物品轉運申請 · ${editing.id}` : '新增院區物品轉運申請單'}</div>
    ${editing ? editBanner(editing) : ''}
    <div class="card">
      <div class="card-title">建立院區物品轉運申請單 <span class="g-tag">G38/G40</span></div>
      ${infoGrid('ba-fields0', fInput('申請人', `<input type="text" id="ba-applicant" value="研發部-吳承恩">`))}
      <div class="callout info" style="margin-bottom:10px;">行程方向由系統依<b>收貨據點（起）／送貨據點（迄）</b>自動判斷（送貨據點較南＝南下、較北＝北上），無需自行勾選。起迄可為<b>同一據點</b>（院區內建物間轉運），但收貨建物與送貨建物不可相同。<br>
        目前基地為 <b>${ModuleB.siteById(DB.homeSite).name}</b>；現行車次模型為「自基地南下、折返北上回基地」，<b>基地以北據點尚未納入排班</b>（排班方式待業務確認）。</div>
      ${infoGrid('ba-fields', [
        fInput('收貨據點（起）', `<select id="ba-site">${siteOpts}</select>`),
        fInput('收貨建物', `<select id="ba-pickbldg"></select><input type="text" id="ba-pickother" placeholder="請輸入建物/位置" style="display:none;margin-top:6px;">`, { stack: true }),
        fInput('送貨據點（迄）', `<select id="ba-dest">${siteOpts}</select>`),
        fInput('送貨建物', `<select id="ba-dropbldg"></select><input type="text" id="ba-dropother" placeholder="請輸入建物/位置" style="display:none;margin-top:6px;">`, { stack: true }),
        fInput('派送型態 <span class="hint">直達不湊單、單一目的地 G38</span>', `
          <div class="radio-group">
            <label class="radio-pill sel" id="ba-nd"><input type="radio" name="ba-direct" value="0" checked>非直達（沿線收送）</label>
            <label class="radio-pill" id="ba-d"><input type="radio" name="ba-direct" value="1">直達</label>
          </div>`, { stack: true, full: true }),
      ].join(''))}
      ${infoGrid('ba-fields2', [
        fInput('希望收貨日期 <span style="color:#c0392b;">*</span> <span class="hint">對應派車日（G129）</span>', `<input type="date" id="ba-wantdate" min="${bDayStr(0)}" value="${bDayStr(0)}">`),
        fInput('希望收貨時間 <span class="hint">收貨時間窗起點，＋4h 為窗尾（2.19）</span>', `<input type="time" id="ba-want" value="10:00">`),
        fInput('上貨時間 (分，G35)', `<input type="number" id="ba-load" value="20">`),
        fInput('下貨時間 (分，G35)', `<input type="number" id="ba-unload" value="10">`),
      ].join(''))}
      <div class="divider"></div>
      <div class="card-title">接收人資訊</div>
      ${infoGrid('ba-recv', [
        fInput('單位', `<input type="text" id="ba-runit" placeholder="收貨單位／部門">`),
        fInput('姓名', `<input type="text" id="ba-rname" placeholder="接收人姓名">`),
        fInput('電話', `<input type="text" id="ba-rphone" placeholder="聯絡電話">`),
        fInput('代理人姓名 <span class="hint">選填</span>', `<input type="text" id="ba-aname" placeholder="代理人姓名">`),
        fInput('代理人電話 <span class="hint">選填</span>', `<input type="text" id="ba-aphone" placeholder="代理人電話">`),
      ].join(''))}
      <div class="divider"></div>
      <div class="card-title" style="justify-content:space-between;"><span>貨物項目</span>
        <button class="btn btn-accent btn-sm" id="ba-add">＋ 新增</button></div>
      <div id="ba-items"></div>
      <div class="divider"></div>
      <button class="btn btn-primary" id="ba-submit">▶ 送出申請（待二級審）</button>
      <button class="btn btn-ghost" id="ba-draft">💾 暫存（申請中）</button>
      <button class="btn btn-ghost" id="ba-cancel">取消</button>
    </div>
    ${backBar('bn-back')}`;
  const bBack = () => { if (editing) { bApply.view = 'detail'; bApply.detailId = editing.id; } else bApply.view = 'list'; bApply.editId = null; RENDER.b_apply(); };
  $('#bn-back').onclick = bBack;
  const setDirect = () => {
    $('#ba-nd').classList.toggle('sel', $('#page-b_apply input[value="0"]').checked);
    $('#ba-d').classList.toggle('sel', $('#page-b_apply input[value="1"]').checked);
  };
  $$('#page-b_apply input[name=ba-direct]').forEach(r => r.onchange = setDirect);
  wireBldg('ba-site', 'ba-pickbldg', 'ba-pickother', siteBuildings); // 收貨建物
  wireBldg('ba-dest', 'ba-dropbldg', 'ba-dropother', siteBuildings); // 送貨建物
  // 建物下拉切換「其他」會改變區塊高度 → 重排 Masonry
  ['ba-site', 'ba-pickbldg', 'ba-dest', 'ba-dropbldg'].forEach(id => {
    const el = $('#' + id); if (el) el.addEventListener('change', () => initMasonry(p));
  });
  // 預設：自基地北端收貨、送往南部（可自行改；方向由起迄自動判斷 B-2）
  $('#ba-site').value = 'D6'; $('#ba-dest').value = 'D3';
  $('#ba-site').onchange(); $('#ba-dest').onchange(); // 依預設據點重填建物選單
  renderBaCargo(); // 一開始顯示空白清單
  initMasonry(p);
  guideApply('B', bApply, p); // 申請引導帶入（若有）
  if (editing) { // 退回修編：帶入原單內容
    $('#ba-applicant').value = editing.applicant;
    $('#ba-site').value = editing.pickSite; $('#ba-site').onchange();
    $('#ba-dest').value = editing.dropSite; $('#ba-dest').onchange();
    setBldgVal('ba-pickbldg', 'ba-pickother', editing.pickupLoc);
    setBldgVal('ba-dropbldg', 'ba-dropother', editing.deliverLoc);
    const dr = $(`#page-b_apply input[name=ba-direct][value="${editing.direct ? 1 : 0}"]`); dr.checked = true; dr.onchange();
    $('#ba-want').value = editing.wantReceiveTime || '';
    $('#ba-wantdate').value = editing.wantReceiveDate || '';
    $('#ba-load').value = editing.loadMin || 0; $('#ba-unload').value = editing.unloadMin || 0;
    const r = editing.recipient || {};
    [['runit', r.unit], ['rname', r.name], ['rphone', r.phone], ['aname', r.agentName], ['aphone', r.agentPhone]]
      .forEach(([k, v]) => { $('#ba-' + k).value = v || ''; });
    baItems = editing.items.map(x => ({ ...x })); renderBaCargo();
    $('#ba-submit').textContent = '▶ 送出（待二級審）';
    if (editing.status !== 'draft') $('#ba-draft').style.display = 'none';   // 退回修編只能修改後送出
    initMasonry(p);
  }
  $('#ba-add').onclick = () => openCargoEditor(null, it => { baItems.push(it); renderBaCargo(); });
  $('#ba-cancel').onclick = bBack;
  const formData = () => {
    if (baItems.length === 0) { toast('請至少新增一項貨物', 'err'); return null; }
    const routeErr = ModuleB.routeError({ site: $('#ba-site').value, destSite: $('#ba-dest').value,
      pickupLoc: bldgVal('ba-pickbldg', 'ba-pickother'), deliverLoc: bldgVal('ba-dropbldg', 'ba-dropother') });
    if (routeErr) { toast(routeErr, 'err'); return null; }
    const wantDate = $('#ba-wantdate').value;
    if (!wantDate) { toast('請填寫「希望收貨日期」', 'err'); return null; }
    if (wantDate < bDayStr(0)) { toast('「希望收貨日期」不可早於今天', 'err'); return null; }
    return {
      applicant: $('#ba-applicant').value,
      site: $('#ba-site').value,
      destSite: $('#ba-dest').value,
      pickupLoc: bldgVal('ba-pickbldg', 'ba-pickother'),
      deliverLoc: bldgVal('ba-dropbldg', 'ba-dropother'),
      wantReceiveDate: wantDate,
      wantReceiveTime: $('#ba-want').value,
      recipient: recipientVal('ba'),
      direct: $('#page-b_apply input[value="1"]').checked,
      loadMin: +$('#ba-load').value || 0, unloadMin: +$('#ba-unload').value || 0,
      items: baItems.map(x => ({ ...x })),
    };
  };
  const done = (o, msg) => {
    baItems = []; toast(msg, 'ok');
    bApply.resultIds = null; bApply.editId = null; bApply.view = 'detail'; bApply.detailId = o.id;
    RENDER.b_apply();
  };
  $('#ba-draft').onclick = async () => {
    const data = formData(); if (!data) return;
    if (!(await confirmDialog({ title: '確認暫存？', text: '將儲存為「申請中」，尚未送出；之後可於明細頁編輯並送出。' }))) return;
    const o = editing ? ModuleB.saveDraft(editing, data) : ModuleB.createOrder(data, { draft: true });
    if (!editing) guideDrafted(bApply, o.id);
    done(o, `${o.id} 已暫存（申請中）`);
  };
  $('#ba-submit').onclick = async () => {
    const data = formData(); if (!data) return;
    const ok = await confirmDialog({ title: '確認送出院區物品轉運申請單？', text: '送出後進入「待二級審」（單位主管審核），通過後由調度派車。' });
    if (!ok) return;
    const o = editing ? ModuleB.resubmit(editing, data) : ModuleB.createOrder(data);
    guideSubmitted(editing ? null : bApply, o.id);
    done(o, `${o.id} 已送出，待二級審`);
  };
}
// 相容：審核端動作呼叫此函式刷新申請端 grid
function renderBaList() { if ($('#bq-grid')) renderBGrid(); }

/* ============================================================
   模組 B · 單位主管審核（直屬主管）— 查詢 / grid / 明細審核
   ============================================================ */
let bApprove = { view: 'list', detailId: null, query: { applicant: '', leg: '', status: '' } };

RENDER.b_approve = function () {
  const p = $('#page-b_approve');
  if (bApprove.view === 'detail') return renderBApproveDetail(p, bApprove.detailId);
  return renderBApproveList(p);
};
function bApproveRows() {
  const q = bApprove.query;
  return ModuleB.orders.filter(o => o.status !== 'draft' &&
    (!q.applicant || o.applicant.includes(q.applicant)) &&
    (!q.leg || (q.leg === 'return' ? !ModuleB.isSouthbound(o) : ModuleB.isSouthbound(o))) && // 方向由起迄推導（B-2）
    approveMatch(o, q.status));
}
function renderBApproveList(p) {
  const q = bApprove.query;
  const legOpts = [['', '全部方向'], ['outbound', '去程'], ['return', '回程']]
    .map(([v, t]) => `<option value="${v}" ${q.leg === v ? 'selected' : ''}>${t}</option>`).join('');
  const stOpts = APPROVE_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">單位主管審核（直屬主管）</div>
    <div class="section-sub">員工建立院區物品轉運申請單後由直屬單位主管審核。點「細節」進入單據檢視與審核；退回修編時申請人可修改後重新送出，未核准前不進派車池。（G63）</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="bap-search">🔍 查詢</button></div>
      ${infoGrid('bap-q-fields', [
        fInput('申請人（模糊）', `<input type="text" id="bap-q-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('行程方向', `<select id="bap-q-leg">${legOpts}</select>`),
        fInput('狀態', `<select id="bap-q-status">${stOpts}</select>`),
      ].join(''))}
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
    renderBApproveGrid(); renderBaList();
  });
  renderBApproveGrid();
  initMasonry(p);
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
        <td>${ModuleB.dirLabel(o)}</td>
        <td>${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}</td>
        <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${Flow.badge(o)}${signBadge(o)}</td></tr>`).join('')}
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
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${Flow.badge(o)}${signBadge(o)}</span></div>
      ${infoGrid('bap-basic', [
        fItem('單號', `<b style="color:var(--navy);">${o.id}</b>`),
        fItem('申請人', o.applicant),
        fItem('行程方向 <span class="hint">由起迄自動判斷</span>', ModuleB.isIntraSite(o) || ModuleB.isSouthbound(o) ? ModuleB.dirLabel(o) : `回程（北上回 ${ModuleB.siteById(DB.homeSite).name}）`),
        fItem('收貨據點（起）', ModuleB.siteById(o.pickSite).name),
        fItem('送貨據點（迄）', ModuleB.siteById(o.dropSite).name),
        fItem('收貨地點（建物）', o.pickupLoc || '<span class="muted">—</span>'),
        fItem('送貨地點（建物）', o.deliverLoc || '<span class="muted">—</span>'),
        fItem('派送型態', o.direct ? '直達（單一目的地 G38）' : '非直達（沿線收送）'),
        fItem('希望收貨日期／時間 <span class="hint">＋4h 收貨時間窗（2.19）</span>', o.wantReceiveTime || o.wantReceiveDate ? `${o.wantReceiveDate || ''} ${o.wantReceiveTime || ''}${o.wantReceiveTime ? `<span class="hint" style="margin-left:6px;">～${minToHHMM(hhmmToMin(o.wantReceiveTime) + DB.receiveWindowMin)}</span>` : ''}` : '<span class="muted">—</span>'),
        fItem('貨量 / 重量', `${o.volume}L / ${o.weight}kg`),
        fItem('有效體積（容量計算用）', `<b>${ModuleB.effVolume(o).toFixed(0)}L</b>`),
        fItem('上貨 / 下貨時間', `${o.loadMin || 0} 分 / ${o.unloadMin || 0} 分（合計 ${o.handleMin} 分）`),
        fItem('建立時間', fmtTime(o.createdAt)),
        o.reviewNote ? fItem('審核備註', o.reviewNote) : '',
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">接收人資訊</div>
      ${infoGrid('bap-recv', fItem('接收人', recipientDisplay(o.recipient), { full: true, tall: true }))}
    </div>
    <div class="card">
      <div class="card-title">貨物項目</div>
      <div id="bap-detail-items"></div>
    </div>
    ${pending ? `
    <div class="card">
      <div class="card-title">單位主管審核 <span class="g-tag">G63</span></div>
      ${infoGrid('bsv-fields', [
        fInput('是否同意', `
          <div class="radio-group">
            <label class="radio-pill sel" id="bsv-yes-pill"><input type="radio" name="bsv-agree" value="yes" checked>同意</label>
            <label class="radio-pill" id="bsv-no-pill"><input type="radio" name="bsv-agree" value="no">退回修編</label>
          </div>`, { stack: true, full: true }),
        fInput('審核備註 <span class="hint" id="bsv-req" style="display:none;color:#c0392b;">（退回修編時必填）</span>', `<input type="text" id="bsv-note" placeholder="請輸入審核意見（退回修編時必填）">`, { full: true }),
      ].join(''))}
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
      if (!agree && !note) { toast('退回修編時「審核備註」為必填', 'err'); $('#bsv-note').focus(); return; }
      if (agree) { ModuleB.approve(o, note); toast(`${o.id} 已核准`, 'ok'); }
      else { ModuleB.reject(o, note); toast(`${o.id} 已退回修編，申請人可修改後重新送出`, 'err'); }
      bApprove.view = 'list'; RENDER.b_approve(); renderBaList();
    };
    $('#bsv-cancel').onclick = () => { bApprove.view = 'list'; RENDER.b_approve(); };
  } else {
    $('#bsv-back').onclick = () => { bApprove.view = 'list'; RENDER.b_approve(); };
  }
  initMasonry(p);
}

/* ============================================================
   模組 B · 派車調度（業務單位）— index（依派車日）／明細（該派車日）
   明細：待調度託運單（可無車退回）→ 單一「媒合派車」按鈕（整合去程直達／去程非直達／直達車回程／回程非直達）
        → 依同一台車產生派車單，可異動車種類型／車號／駕駛人1／駕駛人2／是否送審（G117–G119）
   ============================================================ */
let bReview = { view: 'list', date: null, query: { from: '', to: '', status: '' }, matchResult: null };
// 派車日查詢預設：起＝系統當日、迄＝系統當日＋14 天（G127）
const bDayStr = offset => { const d = Flow.now(); d.setDate(d.getDate() + (offset || 0)); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const B_QUERY_MAX_DAYS = 62;
// 託運單數（G129）：已排入該日派車單者＋收貨日期為該日、尚未派車的申請單（待二級審、待調度）
function bDaySummary(date) {
  const ds = ModuleB.liveDispatches().filter(d => d.date === date);
  const os = ds.flatMap(d => ModuleB.dispatchOrders(d));
  const undispatched = ModuleB.orders.filter(o => !o.dispatchId && ['submitted', 'approved'].includes(o.status) && o.wantReceiveDate === date);
  return { date, orders: ds.length, total: os.length + undispatched.length,
    draft: ds.filter(d => !d.submitted).length,
    signing: ds.filter(d => d.submitted && ModuleB.dispatchOrders(d).some(o => Signoff.isPending(o))).length,
    effective: ds.filter(d => d.submitted && ModuleB.dispatchOrders(d).length && ModuleB.dispatchOrders(d).every(o => Signoff.effective(o))).length,
    delivered: os.filter(o => ['departed', 'logged'].includes(Flow.of(o))).length };
}
RENDER.b_review = function () {
  const p = $('#page-b_review');
  if (bReview.view === 'detail' && bReview.date) return renderBrDetail(p, bReview.date);
  const q = bReview.query, pend = ModuleB.orders.filter(o => o.status === 'approved').length;
  if (!q.from) q.from = bDayStr(0);
  if (!q.to) q.to = bDayStr(14);
  const stOpts = [['', '全部'], ['draft', '有調度中（未送審）派車單'], ['signing', '有調度主管審']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">派車調度（業務單位）</div>
    <div class="section-sub">依<b>派車日</b>查詢派車作業（預設系統當日起 14 天，每天一列）；點「明細」進入該派車日：按<b>媒合派車</b>一次完成去程直達、去程非直達（貪婪）、直達車回程與回程非直達（全域直達鎖定），媒合到<b>同一台車</b>的託運單產生一張<b>派車單</b>；調度確認車種類型／車號／駕駛人後<b>送審</b>（運輸主管簽審通過才生效）。不適合派車的託運單可<b>退回申請人</b>修編。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="br-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <span><button class="btn btn-primary btn-sm" id="brq-search">🔍 查詢</button></span></div>
      ${infoGrid('brq', [
        fInput('派車日（起）', `<input type="date" id="brq-from" value="${q.from}">`),
        fInput('派車日（迄）', `<input type="date" id="brq-to" value="${q.to}">`),
        fInput('派車單狀態', `<select id="brq-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車作業（依派車日）</span>
        <span>${pend ? `<span class="badge b-amber">待調度 ${pend} 筆</span> ` : ''}<span class="muted" id="brq-count"></span></span></div>
      <div id="brq-grid"></div>
    </div>`;
  $('#br-goto-driver').onclick = () => goto('b_driver');
  $('#brq-search').onclick = () => {
    const from = $('#brq-from').value, to = $('#brq-to').value;
    if (!from || !to) { toast('請輸入派車日（起）與派車日（迄）', 'err'); return; }
    if (to < from) { toast('派車日（迄）不可早於派車日（起）', 'err'); return; }
    if (bDayList(from, to).length > B_QUERY_MAX_DAYS) { toast(`派車日區間最多 ${B_QUERY_MAX_DAYS} 天`, 'err'); return; }
    bReview.query = { from, to, status: $('#brq-status').value };
    renderBrGrid(); toast('查詢完成', 'ok');
  };
  renderBrGrid();
  initMasonry(p);
};
function renderBrGrid() {
  const box = $('#brq-grid'); if (!box) return;
  const q = bReview.query;
  // 派車起訖日區間內每一天各一列（尚無派車單者數量為 0，可點「明細」進入該日媒合派車）
  const rows = bDayList(q.from, q.to).map(bDaySummary)
    .filter(r => !q.status || (q.status === 'draft' && r.draft) || (q.status === 'signing' && r.signing));
  $('#brq-count').textContent = `${rows.length} 筆`;
  const n = (v, cls) => v ? `<span class="badge ${cls}">${v}</span>` : '<span class="muted">0</span>';
  box.innerHTML = rows.length === 0 ? `<div class="empty">查無符合條件的派車日。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>派車日</th><th>派車單</th><th>託運單</th><th>調度中</th><th>調度主管審</th><th>待出車以後</th><th>已出車／已回登</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><button class="btn btn-ghost btn-sm" data-brday="${r.date}">明細</button></td>
        <td><b style="color:var(--navy);">${r.date}</b></td><td>${r.orders}</td><td>${r.total}</td>
        <td>${n(r.draft, 'b-gray')}</td><td>${n(r.signing, 'b-amber')}</td><td>${n(r.effective, 'b-green')}</td><td>${r.delivered}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">託運單＝收貨日期為該日的申請單（含待二級審、待調度）＋已排入該日派車單者。點擊左側「明細」進入該派車日：媒合派車、手動指派、派車單異動與送審、無車退回。</div>`;
  $$('#brq-grid [data-brday]').forEach(b => b.onclick = () => { Object.assign(bReview, { view: 'detail', date: b.dataset.brday, matchResult: null }); RENDER.b_review(); });
}
function bDayList(from, to) {
  const out = []; if (!from || !to || to < from) return out;
  const d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
  for (let i = 0; d <= end && i <= 366; i++) { out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`); d.setDate(d.getDate() + 1); }
  return out;
}
const bRoute = o => `${ModuleB.siteById(o.pickSite).name} → ${ModuleB.siteById(o.dropSite).name}`;
const bDirBadge = o => ModuleB.isIntraSite(o) ? '<span class="badge b-amber">院區內</span>' : ModuleB.isSouthbound(o) ? '<span class="badge b-navy">南下</span>' : '<span class="badge b-gray">北上</span>';
function bOrderBadge(d) {
  if (!d.submitted) return '<span class="badge b-gray">未送審</span>';
  const os = ModuleB.dispatchOrders(d);
  if (os.some(o => Signoff.isPending(o))) return '<span class="badge b-amber">已送審 · 待運輸主管簽審</span>';
  if (os.length && os.every(o => Signoff.effective(o))) return '<span class="badge b-green">已送審 · 已生效</span>';
  return '<span class="badge b-navy">已送審</span>';
}
// 派車調度明細（G127）：待調度申請單（媒合派車／手動指派／無車退回）＋派車單 grid（「明細」開視窗異動與送審）
const bOpt = (v, t, cur, dis) => `<option value="${v}" ${v === cur ? 'selected' : ''}${dis ? ' disabled' : ''}>${t}</option>`;
const bDrvOpts = (cur, blank) => bOpt('', blank, cur || '') + DB.drivers.filter(d => d.pool === 'LOGI').map(d => bOpt(d.id, `${d.name}（${d.id}）`, cur)).join('');
const bLoadOf = os => ({ vol: os.reduce((s, o) => s + ModuleB.effVolume(o), 0), wt: os.reduce((s, o) => s + (+o.weight || 0), 0) });
// 車號下拉（依車種類型）：容積／載重不足者停用
function bFillVehicles(typeSel, vehSel, cur, load) {
  const t = $(typeSel).value;
  $(vehSel).innerHTML = bOpt('', t ? '請選擇' : '請先選車種類型', cur) + (t ? Usage.vehiclesOf('LOGI', t).map(v => {
    const short = v.volume < load.vol || v.weight < load.wt;
    return bOpt(v.id, `${v.id}（${v.name}｜${Math.round(v.volume)}L／${v.weight}kg${short ? '・容量不足' : ''}）`, cur, short); }).join('') : '');
}
// 派車單區塊（原明細頁的派車單卡片）：表單＋申請單 grid＋異動紀錄；於視窗內顯示
// 送審前可異動車種類型／車號／駕駛人1／駕駛人2／是否送審與刪除申請單；送審後（或已出車）即鎖定（G129）
function bOrderCardHtml(d) {
  const os = ModuleB.dispatchOrders(d), started = ModuleB.started(d), locked = started || d.submitted, k = 'bro-' + d.id, ld = bLoadOf(os);
  return `
    <div style="text-align:right;margin:-4px 0 8px;">${bOrderBadge(d)}</div>
    ${infoGrid(k + '-f', [
      fItem('派車單號', `<b style="color:var(--navy);">${d.id}</b>${d.manual ? ' <span class="badge b-gray">手動指派</span>' : ''}`),
      fItem('派遣人', d.dispatcher),
      fItem('派遣時間', fmtTime(d.dispatchedAt)),
      fInput('車種類型', `<select id="${k}-type" ${locked ? 'disabled' : ''}>${Usage.types('LOGI').map(t => bOpt(t, t, d.vehicleType)).join('')}</select>`),
      fInput(`車號 <span class="hint">有效體積 ${Math.round(ld.vol)}L／${ld.wt}kg</span>`, `<select id="${k}-veh" ${locked ? 'disabled' : ''}></select>`),
      fInput('駕駛人1', `<select id="${k}-d1" ${locked ? 'disabled' : ''}>${bDrvOpts(d.driver1, '請選擇')}</select>`),
      fInput('駕駛人2', `<select id="${k}-d2" ${locked ? 'disabled' : ''}>${bDrvOpts(d.driver2, '（無）')}</select>`),
      fInput('是否送審', `<select id="${k}-sub" ${locked ? 'disabled' : ''}>${bOpt('no', '否（未送審）', d.submitted ? 'yes' : 'no')}${bOpt('yes', '是（送運輸主管簽審）', d.submitted ? 'yes' : 'no')}</select>`),
    ].join(''))}
    <div style="margin:6px 0 12px;">${started ? '<span class="hint">已有申請單出車，派車單不可再異動。</span>'
      : d.submitted ? '<span class="hint">派車單已送審，不可再異動（運輸主管退回後才可再修改）。</span>'
      : `<span class="hint">送審前可異動車種類型、車號、駕駛人、是否送審與刪除申請單；是否送審改為「是」並儲存即送運輸主管簽審，<b>送審後即不可再異動</b>。改車號不重算路線時間，請自行確認。</span>`}</div>
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>方向</th><th>路線</th><th>派遣模式</th><th>貨量</th><th>收貨</th><th>送達</th><th>狀態</th><th>操作</th></tr></thead><tbody>
      ${os.map(o => `<tr><td><b style="color:var(--navy);">${o.id}</b></td><td>${o.applicant}</td><td>${bDirBadge(o)}</td><td>${bRoute(o)}</td>
        <td>${o.dispatchMode === '直達' ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
        <td>${o.volume}L</td><td>${o.pickupTime || '—'}</td><td>${o.dispatchDropTime || '—'}</td>
        <td>${Flow.badge(o)}${signBadge(o)}</td>
        <td>${!locked ? `<button class="btn btn-danger btn-sm" data-brout="${o.id}">刪除</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    ${d.log.length ? `<details style="margin-top:10px;"><summary class="muted" style="cursor:pointer;">派車單異動紀錄（${d.log.length}）</summary>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>操作人</th><th>說明</th></tr></thead><tbody>
      ${d.log.map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td><td style="text-align:left;">${l.note || '—'}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}
    ${locked ? '' : `<div style="text-align:center;margin-top:16px;"><button class="btn btn-primary" data-brsave="${d.id}">💾 儲存</button>
      <button class="btn btn-ghost" id="bro-close">取消</button></div>`}`;
}
// 派車單明細視窗：送審前異動車輛／駕駛、是否送審、刪除申請單（回待調度）；送審後唯讀（G129）
// keep：重開視窗時保留尚未儲存的欄位值（刪除申請單後）
function openBOrderModal(d, by, rerender, keep) {
  openModal(`派車單明細 · ${d.id}`, bOrderCardHtml(d), { wide: true });
  const k = 'bro-' + d.id, ld = bLoadOf(ModuleB.dispatchOrders(d));
  if (keep) $(`#${k}-type`).value = keep.vehicleType;
  bFillVehicles(`#${k}-type`, `#${k}-veh`, keep ? keep.vehicle : d.vehicle, ld);
  $(`#${k}-type`).onchange = () => bFillVehicles(`#${k}-type`, `#${k}-veh`, '', ld);
  if (keep) { $(`#${k}-d1`).value = keep.driver1; $(`#${k}-d2`).value = keep.driver2; $(`#${k}-sub`).value = keep.submitted ? 'yes' : 'no'; }
  const cl = $('#bro-close'); if (cl) cl.onclick = closeModal;
  const formVal = () => ({ vehicleType: $(`#${k}-type`).value, vehicle: $(`#${k}-veh`).value, driver1: $(`#${k}-d1`).value,
    driver2: $(`#${k}-d2`).value, submitted: $(`#${k}-sub`).value === 'yes' });
  const done = msg => { toast(msg, 'ok'); closeModal(); rerender(); };
  const save = $(`#modal-body [data-brsave]`);
  if (save) save.onclick = async () => {
    const f = formVal();
    const pre = ModuleB.dispatchResourceError(d, f);
    if (pre) { toast(pre, 'err'); return; }
    const text = f.submitted ? '派車單將<b>送出運輸主管簽審</b>，簽審通過後才生效；<b>送審後即不可再異動</b>。' : '儲存派車單異動（尚未送審）。';
    if (!(await confirmDialog({ title: `確認儲存派車單 ${d.id}？`, text }))) return;
    const r = ModuleB.updateDispatch(d, f, by());
    if (!r.ok) { toast(r.error, 'err'); return; }
    done(`派車單 ${d.id} 已${f.submitted ? '儲存並送審' : '儲存'}`);
  };
  // 刪除：申請單移出派車單、回到「待調度申請單」；派車單仍有申請單則重開視窗（保留未儲存的欄位）
  $$('#modal-body [data-brout]').forEach(b => b.onclick = async () => {
    const o = ModuleB.orders.find(x => x.id === b.dataset.brout);
    if (!(await confirmDialog({ title: '確認刪除？', text: `${o.id} 將自派車單 ${d.id} 刪除，回到「待調度申請單」（已排定的路線時間不重算）。` }))) return;
    const keepVal = formVal();
    const r = ModuleB.unassign(o, by());
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${o.id} 已刪除，回到待調度申請單`, 'ok');
    rerender();
    if (d.cancelled) { closeModal(); toast(`派車單 ${d.id} 已無申請單，自動取消`, 'ok'); }
    else openBOrderModal(d, by, rerender, keepVal);
  });
}
// 手動指派視窗：新派車單（指定車種類型／車號／駕駛人1／駕駛人2，產生未送審派車單）或併入未送審派車單
function openBManualAssign(o, date, by, rerender) {
  const targets = ModuleB.manualTargets(date), ld = bLoadOf([o]);
  const tgtText = d => { const os = ModuleB.dispatchOrders(d), l = bLoadOf(os), v = DB.vehicles.find(x => x.id === d.vehicle);
    return `${d.id}｜${d.vehicle}（${d.vehicleType}）｜${[d.driver1, d.driver2].filter(Boolean).map(drvName).join('＋') || '未指定駕駛'}｜${os.length} 張｜剩餘 ${v ? Math.round(v.volume - l.vol) : '—'}L／${v ? v.weight - l.wt : '—'}kg`; };
  const veh0 = DB.vehicles.find(v => v.pool === 'LOGI' && v.sizeClass && v.volume >= ld.vol && v.weight >= ld.wt);
  openModal(`手動指派 · ${o.id}`, `
    <div class="card-desc">${o.applicant}｜${bRoute(o)}｜${o.direct ? '直達' : '非直達'}｜申報 ${o.volume}L（有效 ${Math.round(ld.vol)}L）／${o.weight || 0}kg｜希望收貨 ${[o.wantReceiveDate, o.wantReceiveTime].filter(Boolean).join(' ') || '—'}｜派車日 <b>${date}</b></div>
    ${infoGrid('bma-mode', [fInput('指派方式', gPills('bma-mode', 'new', [['new', '新派車單（暫存未送審）'], ['merge', `併入既有派車單（${targets.length} 張可併）`]]), { full: true, stack: true })].join(''))}
    <div id="bma-new">${infoGrid('bma-new-f', [
      fInput('車種類型 <span style="color:#c0392b;">*</span>', `<select id="bma-type">${bOpt('', '請選擇', veh0 ? veh0.type : '')}${Usage.types('LOGI').map(t => bOpt(t, t, veh0 ? veh0.type : '')).join('')}</select>`),
      fInput('車號 <span style="color:#c0392b;">*</span>', `<select id="bma-veh"></select>`),
      fInput('駕駛人1 <span style="color:#c0392b;">*</span>', `<select id="bma-d1">${bDrvOpts(ModuleB._freeLogiDriver(date), '請選擇')}</select>`),
      fInput('駕駛人2', `<select id="bma-d2">${bDrvOpts('', '（無）')}</select>`),
    ].join(''))}</div>
    <div id="bma-merge" style="display:none;">${targets.length ? infoGrid('bma-merge-f', [
      fInput('併入派車單 <span style="color:#c0392b;">*</span>', `<select id="bma-target">${targets.map(d => bOpt(d.id, tgtText(d), '')).join('')}</select>`, { full: true }),
    ].join('')) : '<div class="callout">本派車日沒有尚未送審、未出車的派車單可併入。</div>'}</div>
    <div class="hint" style="margin-top:8px;">手動指派不重算路線時間（收貨時間暫取希望收貨時間）；產生或併入的派車單為未送審，確認後於派車單明細送審。</div>
    <div style="text-align:center;margin-top:18px;">
      <button class="btn btn-primary" id="bma-ok">✓ 確認指派</button>
      <button class="btn btn-ghost" id="bma-cancel">取消</button>
    </div>`);
  bFillVehicles('#bma-type', '#bma-veh', veh0 ? veh0.id : '', ld);
  $('#bma-type').onchange = () => bFillVehicles('#bma-type', '#bma-veh', '', ld);
  const mode = () => ($('#modal-body input[name=bma-mode]:checked') || {}).value || 'new';
  $$('#modal-body input[name=bma-mode]').forEach(r => r.onchange = () => {
    $$('#bma-mode-wrap .radio-pill').forEach(l => l.classList.toggle('sel', l.querySelector('input').checked));
    $('#bma-new').style.display = mode() === 'new' ? '' : 'none';
    $('#bma-merge').style.display = mode() === 'merge' ? '' : 'none';
  });
  $('#bma-cancel').onclick = closeModal;
  $('#bma-ok').onclick = async () => {
    let pre, text, act;
    if (mode() === 'new') {
      const f = { vehicleType: $('#bma-type').value, vehicle: $('#bma-veh').value, driver1: $('#bma-d1').value, driver2: $('#bma-d2').value };
      pre = ModuleB.dispatchResourceError({ id: '(new)', date, apps: [o.id] }, f);
      text = `${o.id} 指派 <b>${f.vehicle}</b>（${f.vehicleType}）｜駕駛 ${[f.driver1, f.driver2].filter(Boolean).map(drvName).join('＋')}，產生一張<b>未送審</b>派車單（派車日 ${date}）。`;
      act = () => ModuleB.manualAssign(o, date, f, by());
    } else {
      const d = targets.find(x => x.id === ($('#bma-target') || {}).value);
      if (!d) { toast('請選擇要併入的派車單', 'err'); return; }
      pre = ModuleB.dispatchResourceError(Object.assign({}, d, { apps: d.apps.concat(o.id) }), d);
      text = `${o.id} 併入派車單 <b>${d.id}</b>（${d.vehicle}），派車單維持未送審。`;
      act = () => ModuleB.manualMerge(o, d, by());
    }
    if (pre) { toast(pre, 'err'); return; }
    if (!(await confirmDialog({ title: '確認手動指派？', text }))) return;
    const r = act();
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${o.id} 已${mode() === 'new' ? '指派，產生派車單 ' : '併入派車單 '}${r.dispatch.id}`, 'ok');
    closeModal(); rerender();
  };
}
function renderBrDetail(p, date) {
  // 待調度申請單：收貨日期＝本派車日者（舊單未填收貨日期者各日皆列，G129）
  const waiting = ModuleB.orders.filter(o => o.status === 'approved' && ModuleB.onDate(o, date)).sort((a, b) => a.approvedAt - b.approvedAt);
  const dsp = ModuleB.liveDispatches().filter(d => d.date === date);
  const mr = bReview.matchResult;
  const by = () => (($('#br-by') || {}).value || '').trim() || '調度室';
  p.innerHTML = `
    <div class="section-h">派車調度明細 · 派車日 ${date}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>待調度申請單（${waiting.length} 筆）</span>
        <span><input type="text" id="br-by" value="調度室-值班人員" style="width:150px;margin-right:6px;" title="派遣人">
        <button class="btn btn-accent btn-sm" id="br-match">▶ 媒合派車</button></span></div>
      <div class="card-desc">列出<b>希望收貨日期＝本派車日</b>的待調度申請單，依核准時間排序。按<b>媒合派車</b>一次執行：① 去程直達（G38）② 去程非直達（貪婪 G32）③ 直達車回程（矩陣第 5 列）④ 回程非直達（全域直達鎖定 G40）；車型依當日總貨量自動選（2.17），媒合截止（2.14／2.15）以本派車日計。媒合到同一台車的申請單產生一張派車單（未送審）。個別申請單可按<b>手動指派</b>：指定車輛／駕駛產生暫存派車單，或併入本日尚未送審的派車單。</div>
      ${waiting.length === 0 ? '<div class="empty">沒有待調度的申請單。</div>' : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>方向</th><th>路線</th><th>型態</th><th>貨量</th><th>希望收貨</th><th>媒合截止</th><th>操作</th></tr></thead><tbody>
        ${waiting.map(o => `<tr><td><b style="color:var(--navy);">${o.id}</b>${ModuleB.isServable(o) ? '' : ' <span class="badge b-red" title="' + ModuleB.unservableReason(o) + '">基地以北・待確認</span>'}</td>
          <td>${o.applicant}</td><td>${bDirBadge(o)}</td><td>${bRoute(o)}</td>
          <td>${o.direct ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
          <td>${o.volume}L</td><td>${[o.wantReceiveDate, o.wantReceiveTime].filter(Boolean).join(' ') || '—'}</td>
          <td>${!ModuleB.isSouthbound(o) || ModuleB.meetsCutoff(o, date) ? '<span class="badge b-green">趕得上</span>' : '<span class="badge b-amber">逾截止・順延</span>'}</td>
          <td style="white-space:nowrap;"><button class="btn btn-primary btn-sm" data-brmanual="${o.id}">手動指派</button>
            <button class="btn btn-danger btn-sm" data-brret="${o.id}">無車退回</button></td></tr>`).join('')}
      </tbody></table></div>`}
      ${mr ? `<div class="result ${mr.carried.length ? 'ok' : 'warn'}" style="margin-top:14px;"><div class="r-head">${mr.carried.length ? '✓' : '—'} 媒合派車完成（派遣人 ${mr.by}）</div>
        <div>執行 ${mr.steps.map(x => `${x.label}${x.r.carried && x.r.carried.length ? `（${x.r.carried.length} 張）` : ''}`).join('、') || '（無可派申請單）'}｜派車 ${mr.carried.length} 張｜派車單 ${mr.dispatches.map(d => d.id).join('、') || '—'}</div></div>
        <div class="trace">${mr.trace.join('\n')}</div>` : ''}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車單（${dsp.length} 張）</span>
        <span class="muted">點「明細」異動車輛／駕駛、送審或移出申請單</span></div>
      ${dsp.length === 0 ? '<div class="empty">本派車日尚無派車單。按上方「媒合派車」或「手動指派」產生。</div>' : `
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th></th><th>派車單號</th><th>派遣人</th><th>派遣時間</th><th>車種類型</th><th>車號</th><th>駕駛人1</th><th>駕駛人2</th><th>申請單數</th><th>狀態</th></tr></thead><tbody>
        ${dsp.map(d => `<tr><td><button class="btn btn-ghost btn-sm" data-brorder="${d.id}">明細</button></td>
          <td><b style="color:var(--navy);">${d.id}</b>${d.manual ? ' <span class="badge b-gray">手動</span>' : ''}</td><td>${d.dispatcher}</td><td>${fmtTime(d.dispatchedAt)}</td>
          <td>${d.vehicleType || '—'}</td><td>${usageVehText(d.vehicle)}</td><td>${d.driver1 ? drvName(d.driver1) : '—'}</td><td>${d.driver2 ? drvName(d.driver2) : '—'}</td>
          <td>${ModuleB.dispatchOrders(d).length}</td><td>${bOrderBadge(d)}</td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
    <div id="br-vehstatus">${renderB_vehicleStatus()}</div>
    <div id="br-matrix">${renderB_matrix(mr && mr.last ? mr.last.matrixRow : null)}</div>
    ${backBar('br-back')}`;
  const rerender = () => { RENDER.b_review(); renderBaList(); };
  $('#br-back').onclick = () => { Object.assign(bReview, { view: 'list', matchResult: null }); RENDER.b_review(); };
  $('#br-match').onclick = confirmThen({ title: '確認媒合派車？', text: `將以派車日 <b>${date}</b> 對已核准申請單依序執行去程直達、去程非直達、直達車回程與回程非直達派車，媒合到同一台車者產生一張派車單（未送審）。` }, () => {
    const r = ModuleB.runMatch(date, by()); r.by = by();
    bReview.matchResult = r;
    toast(`媒合派車完成：派車 ${r.carried.length} 張、派車單 ${r.dispatches.length} 張`, r.carried.length ? 'ok' : 'err');
    rerender();
  });
  $$('#page-b_review [data-brorder]').forEach(b => b.onclick = () => openBOrderModal(dsp.find(x => x.id === b.dataset.brorder), by, rerender));
  $$('#page-b_review [data-brmanual]').forEach(b => b.onclick = () => openBManualAssign(ModuleB.orders.find(x => x.id === b.dataset.brmanual), date, by, rerender));
  $$('#page-b_review [data-brret]').forEach(b => b.onclick = () => openNoCarDialog(ModuleB.orders.find(x => x.id === b.dataset.brret),
    (o, note, by) => ModuleB.returnOrder(o, note, by), rerender));
  initMasonry(p);
}
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
/* ============================================================
   模組 C · 申請端（使用者）
   ============================================================ */
let cApply = { view: 'list', detailId: null, editId: null, query: { applicant: '', type: '', origin: '', dest: '', status: '' }, resultIds: null };

RENDER.c_apply = function () {
  const p = $('#page-c_apply');
  if (cApply.view === 'new') return renderCApplyNew(p);
  if (cApply.view === 'detail') return renderCApplyDetail(p, cApply.detailId);
  return renderCApplyList(p);
};

/* ---------- 查詢畫面 ---------- */
function renderCApplyList(p) {
  const q = cApply.query;
  const oOpts = ['<option value="">全部起點</option>'].concat(
    C_PLACES().map(o => `<option ${q.origin === o ? 'selected' : ''}>${o}</option>`)).join('');
  const dOpts = ['<option value="">全部終點</option>'].concat(
    C_PLACES().map(d => `<option ${q.dest === d ? 'selected' : ''}>${d}</option>`)).join('');
  const typeOpts = [['', '全部'], ['round', '否（來回）'], ['oneway', '是（單程）']]
    .map(([v, t]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${t}</option>`).join('');
  const statusOpts = flowOpts(q.status);
  p.innerHTML = `
    <div class="section-h">差旅共乘申請（使用者）</div>
    <div class="section-sub">先查詢歷史用車申請，點擊任一筆可檢視明細；或按「新增」建立新的差旅共乘申請單。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="cq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="cq-new">＋ 新增</button>
        </span>
      </div>
      ${infoGrid('cq-fields', [
        fInput('申請人（模糊）', `<input type="text" id="cq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('是否單程運輸', `<select id="cq-type">${typeOpts}</select>`),
        fInput('起點', `<select id="cq-origin">${oOpts}</select>`),
        fInput('終點', `<select id="cq-dest">${dOpts}</select>`),
        fInput('狀態', `<select id="cq-status">${statusOpts}</select>`),
      ].join(''))}
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
  initMasonry(p);
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
    (!q.status || Flow.of(a) === q.status));
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
      <th></th><th>單號</th><th>申請人</th><th>單程</th><th>車輛起迄地點</th><th>報到</th><th>結束</th><th>乘客</th><th>狀態</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-detail="${a.id}">細節</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
        <td>${a.type === 'round' ? '否' : '是'}</td><td>${cRouteStr(a)}</td>
        <td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.type === 'round' ? a.returnDate.slice(5) + ' ' + a.earliestReturn : '<span class="muted">—</span>'}</td>
        <td>${a.pax}</td>
        <td>${Flow.badge(a)}${signBadge(a)}</td><td class="muted">${fmtTime(a.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可跳轉至申請單明細。</div>`;
  $$('#cq-grid [data-detail]').forEach(b => b.onclick = () => {
    cApply.detailId = b.dataset.detail; cApply.view = 'detail'; RENDER.c_apply();
  });
}

/* ---------- 明細畫面 ---------- */
// 申請單欄位（G133）：申請端明細、審核端共用
const cYN = b => (b ? '是' : '否');
const cRouteStr = a => (a.route && a.route.length ? a.route : [a.origin, a.dest]).join(' → ');
const cAtStr = s => (s ? s.replace('T', ' ') : '—');
function cAppItems(a) {
  return [
    fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
    fItem('申請人', `${a.applicant}（${a.dept || '—'}）`),
    fItem('申請人分機手機', a.applicantPhone || a.ext || '—'),
    fItem('申請事由', a.reason || '—'),
    fItem('計畫代號', a.projectCode || '—'),
    fItem('車長', a.captain || '—'),
    fItem('車長分機手機', a.captainPhone || '—'),
    fItem('車屬據點', a.homeBase || '—'),
    fItem('是否單程運輸', a.type === 'oneway' ? '是（終點須為交通轉運點）' : '否'),
    fItem('車輛報到日期時間', cAtStr(a.reportAt || `${a.departDate}T${a.earliestPickup}`)),
    fItem('報到地點', gEsc(a.reportPlace || '—')),
    fItem('用車結束日期時間', a.type === 'round' ? cAtStr(a.endAt || `${a.returnDate}T${a.earliestReturn}`) : '<span class="muted">單程不適用</span>'),
    fItem('乘客數', a.passengers != null ? a.passengers : a.pax),
    fItem('是否同意併車', a.agreeCarpool === false ? '<b>否</b>（單獨派車）' : '是'),
    fItem('據點接駁', cYN(a.baseShuttle)),
    fItem('特殊證p', cYN(a.permitP)),
    fItem('特殊證k', cYN(a.permitK)),
    fItem('是否跨院區', cYN(a.crossCampus)),
    fItem('是否進台北市', cYN(a.enterTaipei)),
    fItem('是否有載運品', cYN(a.hasCargo)),
  ].concat(a.hasCargo ? [fItem('三聯單表單編號', a.manifestNo || '—'), fItem('護運單號', a.escortNo || '—')] : [])
   .concat([fItem('備註', a.remark || '—', { full: true })]);
}
// 異動紀錄（修改／取消的異動事由）
function cChangeCard(a) {
  const log = a.changeLog || [];
  if (!log.length && a.status !== 'cancelled') return '';
  return `<div class="card"><div class="card-title">異動紀錄 <span class="g-tag">G133</span></div>
    ${a.status === 'cancelled' ? `<div class="callout" style="margin-bottom:10px;">此申請已<b>取消</b>（結案）｜${a.cancelledBy || '—'} ${a.cancelledAt ? fmtTime(a.cancelledAt) : ''}</div>` : ''}
    ${log.length ? `<div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>異動人</th><th>異動事由</th></tr></thead><tbody>
      ${log.map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by || '—'}</td><td style="text-align:left;">${l.reason}</td></tr>`).join('')}
    </tbody></table></div>` : ''}</div>`;
}
// 取消申請（G133）：異動事由必填
function openCCancelDialog(a) {
  openModal(`取消申請 · ${a.id}`, `
    <div class="callout" style="margin-bottom:12px;">取消後申請單<b>結案、不可再修改或重送</b>${a.dispatchId ? `；將自派車單 ${a.dispatchId} 移出` : ''}。</div>
    ${infoGrid('cc-f', fInput('異動事由 <span style="color:#c0392b;">*</span>', `<textarea id="cc-reason" rows="2" placeholder="請說明取消原因"></textarea>`, { stack: true, full: true }))}
    <div style="text-align:center;margin-top:18px;">
      <button class="btn btn-danger" id="cc-ok">✕ 取消申請</button>
      <button class="btn btn-ghost" id="cc-close">返回</button>
    </div>`);
  $('#cc-close').onclick = closeModal;
  $('#cc-ok').onclick = async () => {
    const reason = $('#cc-reason').value.trim();
    if (!reason) { toast('取消申請時「異動事由」為必填', 'err'); $('#cc-reason').focus(); return; }
    if (!(await confirmDialog({ title: '確認取消申請？', text: `${a.id} 將取消（結案）：${reason}` }))) return;
    const r = ModuleC.cancelApp(a, reason, a.applicant);
    if (!r.ok) { toast(r.error, 'err'); return; }
    closeModal(); toast(`${a.id} 已取消`, 'ok'); RENDER.c_apply();
  };
}
function renderCApplyDetail(p, id) {
  const a = ModuleC.applications.find(x => x.id === id);
  if (!a) { cApply.view = 'list'; return RENDER.c_apply(); }
  const veh = a.vehicle ? DB.vehicles.find(v => v.id === a.vehicle) : null;
  const action = '';
  p.innerHTML = `
    <div class="section-h">差旅共乘申請明細 · ${a.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${Flow.badge(a)}${signBadge(a)}</span></div>
      ${infoGrid('cd-basic', cAppItems(a).concat([
        fItem('最晚抵達（參考 G55）', `<span class="muted">${ModuleC.latestArrival(a)}</span>`),
        fItem('建立時間', fmtTime(a.createdAt)),
      ]).join(''))}
    </div>
    ${cRouteCard(a)}
    ${cCargoCard(a)}
    ${cChangeCard(a)}
    <div class="card">
      <div class="card-title">媒合與行程狀態</div>
      ${infoGrid('cd-match', [
        fItem('指派車輛', veh ? veh.name : '<span class="muted">尚未媒合</span>'),
        fItem('司機', ModuleC.driversOf(a).map(drvNm).join('＋') || '—'),
        fItem('派車單', a.dispatchId || '—'),
        fItem('併車群組', a.groupId || '—'),
        fItem('備註', a.note || '—'),
      ].join(''))}
      ${action ? `<div class="divider"></div><div><b>乘客操作：</b> ${action}</div>` : ''}
    </div>
    ${a.status === 'approved' && !ModuleC.noCarpool(a) ? `
    <div class="card">
      <div class="card-title">手動併車（找便車）<span class="g-tag">G56</span></div>
      <div class="card-desc">自動媒合未成時，您可自行向「已確定有車」的單搭便車。候選＝出發日期前後 1 天、已派車的單（不篩目的地、不比時間）。聯繫對方後按「完成合併」即成立，免調度室確認。</div>
      <button class="btn btn-primary btn-sm" id="cd-find">🔍 列出候選便車</button>
      <div id="cd-candidates"></div>
    </div>` : ''}
    ${returnedCard(a, 'cd-edit')}${noCarCard(a)}
    ${ModuleC.canCancel(a) ? `<div class="card">
      <div class="card-title">取消申請 <span class="g-tag">G133</span></div>
      <div class="card-desc">派車單送審前可取消；取消後結案，不可再修改或重送。已併入派車單者會自派車單移出。</div>
      <button class="btn btn-danger btn-sm" id="cd-cancel-app">✕ 取消申請</button>
    </div>` : ''}
    ${backBar('cd-back')}`;
  const cca = $('#cd-cancel-app');
  if (cca) cca.onclick = () => openCCancelDialog(a);
  const ced = $('#cd-edit');
  if (ced) ced.onclick = () => { cApply.editId = a.id; cApply.view = 'new'; RENDER.c_apply(); };
  $('#cd-back').onclick = () => { cApply.view = 'list'; RENDER.c_apply(); };
  initMasonry(p);
  const find = $('#cd-find');
  if (find) find.onclick = () => {
    const cands = ModuleC.manualCandidates(a);
    if (cands.length === 0) { $('#cd-candidates').innerHTML = `<div class="callout" style="margin-top:12px;">出發日期前後 1 天內查無已派車的候選單。</div>`; return; }
    $('#cd-candidates').innerHTML = `
      <div class="callout info" style="margin-top:12px;">為 <b>${a.id}</b>（${a.origin}→${a.dest}）尋找便車，需要 ${a.pax} 個空位。不顯示私人手機。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>候選單</th><th>起訖（出發地 → 目的地）</th><th>出發/最晚抵達</th><th>申請人 部門/分機</th><th>已載/剩餘</th><th></th></tr></thead><tbody>
        ${cands.map(c => `<tr><td>${c.app.id}</td><td>${c.origin} → <b>${c.dest}</b></td><td>${c.depart} / ${c.latest}</td>
          <td>${c.applicant}（${c.dept}/${c.ext}）</td><td>${c.loaded} / 剩 ${c.remain}</td>
          <td><button class="btn btn-primary btn-sm" data-merge="${c.app.id}" ${c.remain < a.pax ? 'disabled' : ''}>完成合併</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('#cd-candidates [data-merge]').forEach(b => b.onclick = confirmThen({ title: '確認完成合併？', text: '請先聯繫對方確認同意，確認後即向該已派車單搭便車、合併成立。' }, () => {
      const target = ModuleC.applications.find(x => x.id === b.dataset.merge);
      ModuleC.doManualMerge(a, target);
      toast(`${a.id} 已搭 ${target.id} 便車，合併成立`, 'ok');
      RENDER.c_apply();
    }));
  };
}

/* ---------- 新增畫面（G133 欄位改版）---------- */
// 車輛起迄地點：下拉選擇後加入，最多 8 點，依序；第一點＝起點、最後一點＝終點（媒合依起訖）
let caRoute = [];
const C_PLACES = () => [...new Set(DB.bizOrigins.concat(DB.bizDests))];
// 隨身貨物（G136）：可編輯 grid，7 欄＝物品名稱、數量、長、寬、高、重量(KG)、物品外包裝
let caCargo = [];
const C_CARGO_COLS = [['name', '物品名稱', 'text', '例：樣品箱'], ['qty', '數量', 'number', ''], ['l', '長(cm)', 'number', ''],
  ['w', '寬(cm)', 'number', ''], ['h', '高(cm)', 'number', ''], ['weight', '重量(KG)', 'number', ''], ['pack', '物品外包裝', 'text', '例：紙箱']];
function renderCaCargo() {
  const box = $('#ca-pcargo'); if (!box) return;
  const cell = (r, i, [k, , type, ph]) => `<td><input type="${type}" data-pc="${i}" data-k="${k}" value="${gEsc(r[k])}"${type === 'number' ? ` min="${k === 'qty' ? 1 : 0}" step="${k === 'qty' ? 1 : 'any'}" style="width:80px;"` : ''}${ph ? ` placeholder="${ph}"` : ''}${k === 'pack' ? ' list="ca-pack-list"' : ''}></td>`;
  box.innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr><th></th>${C_CARGO_COLS.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${caCargo.length ? caCargo.map((r, i) => `<tr><td><button class="btn btn-ghost btn-sm" type="button" data-pcdel="${i}">刪除</button></td>${C_CARGO_COLS.map(c => cell(r, i, c)).join('')}</tr>`).join('')
      : `<tr><td colspan="${C_CARGO_COLS.length + 1}" class="muted" style="text-align:center;padding:14px;">無隨身貨物（選填），需要時按右上角「＋ 新增」。</td></tr>`}
    </tbody></table></div>
    <datalist id="ca-pack-list">${ModuleC.CARGO_PACKS.map(x => `<option value="${x}">`).join('')}</datalist>`;
  $$('#ca-pcargo [data-pc]').forEach(inp => inp.oninput = () => { caCargo[+inp.dataset.pc][inp.dataset.k] = inp.value; });
  $$('#ca-pcargo [data-pcdel]').forEach(b => b.onclick = () => { caCargo.splice(+b.dataset.pcdel, 1); renderCaCargo(); initMasonry($('#page-c_apply')); });
}
// 明細／審核：隨身貨物唯讀 grid
function cCargoCard(a) {
  const rows = a.personalCargo || [];
  return `<div class="card"><div class="card-title">隨身貨物 <span class="g-tag">G136</span></div>
    ${rows.length ? `<div class="table-wrap"><table class="dt"><thead><tr>${C_CARGO_COLS.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${C_CARGO_COLS.map(([k]) => `<td>${gEsc(r[k] === '' || r[k] == null ? '—' : r[k])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>` : '<div class="muted">無隨身貨物。</div>'}</div>`;
}
// 是／否單選（radio-pill）
function cYesNo(name, val) {
  return `<div class="radio-group">${[['1', '是'], ['0', '否']].map(([v, t]) =>
    `<label class="radio-pill${(val ? '1' : '0') === v ? ' sel' : ''}"><input type="radio" name="${name}" value="${v}"${(val ? '1' : '0') === v ? ' checked' : ''}>${t}</label>`).join('')}</div>`;
}
const cYes = (name, p) => { const r = $(`input[name=${name}]:checked`, p); return !!r && r.value === '1'; };
// 車輛起迄地點 grid（G137）：功能（編輯／刪除）、地點（下拉）、順序（可改數字排序）；
// 編輯為 inline mode（同時只編輯一列），儲存與刪除皆跳確認視窗；右上「＋ 新增」新增一列並進入編輯。
let caRouteEdit = null;   // { idx, isNew }
function renderCaRoute() {
  const box = $('#ca-route-grid'); if (!box) return;
  const n = caRoute.length, ed = caRouteEdit;
  const tag = i => i === 0 ? '<span class="badge b-navy" style="margin-left:6px;">起點</span>'
    : i === n - 1 ? '<span class="badge b-navy" style="margin-left:6px;">終點</span>' : '';
  const row = (x, i) => ed && ed.idx === i
    ? `<tr><td style="white-space:nowrap;"><button class="btn btn-primary btn-sm" type="button" data-rsave="${i}">儲存</button> <button class="btn btn-ghost btn-sm" type="button" data-rcancel="${i}">取消</button></td>
        <td><select id="ca-rt-place">${C_PLACES().map(o => `<option${o === x ? ' selected' : ''}>${o}</option>`).join('')}</select></td>
        <td><input type="number" id="ca-rt-order" min="1" max="${n}" step="1" value="${i + 1}" style="width:80px;"></td></tr>`
    : `<tr><td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" type="button" data-redit="${i}">編輯</button> <button class="btn btn-ghost btn-sm" type="button" data-rdel="${i}">刪除</button></td>
        <td>${gEsc(x)}${tag(i)}</td><td>${i + 1}</td></tr>`;
  box.innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr><th>功能</th><th>地點</th><th>順序</th></tr></thead><tbody>
    ${n ? caRoute.map(row).join('') : '<tr><td colspan="3" class="muted" style="text-align:center;padding:14px;">尚未加入地點，請按右上角「＋ 新增」（至少起點、終點兩點）。</td></tr>'}
    </tbody></table></div>
    <div class="muted" style="font-size:12px;margin-top:6px;">依「順序」排列，最多 ${ModuleC.ROUTE_MAX} 個地點；順序 1 為起點、最後一個為終點（媒合依起點與終點）。目前 ${n} / ${ModuleC.ROUTE_MAX}。</div>`;
  const busy = () => { if (caRouteEdit) { toast('請先儲存或取消編輯中的地點', 'err'); return true; } return false; };
  const rerender = () => { renderCaRoute(); initMasonry($('#page-c_apply')); };
  $$('#ca-route-grid [data-redit]').forEach(b => b.onclick = () => { if (busy()) return; caRouteEdit = { idx: +b.dataset.redit, isNew: false }; rerender(); });
  $$('#ca-route-grid [data-rdel]').forEach(b => b.onclick = async () => {
    if (busy()) return;
    const i = +b.dataset.rdel;
    if (!(await confirmDialog({ title: '確認刪除地點？', text: `將刪除第 ${i + 1} 個地點「${caRoute[i]}」，其後地點順序往前遞補。` }))) return;
    caRoute.splice(i, 1); rerender();
  });
  $$('#ca-route-grid [data-rcancel]').forEach(b => b.onclick = () => {
    if (caRouteEdit && caRouteEdit.isNew) caRoute.splice(caRouteEdit.idx, 1);
    caRouteEdit = null; rerender();
  });
  $$('#ca-route-grid [data-rsave]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.rsave, place = $('#ca-rt-place').value, ord = Math.round(+$('#ca-rt-order').value);
    if (!(ord >= 1 && ord <= n)) return toast(`「順序」須為 1～${n}`, 'err');
    const isNew = caRouteEdit.isNew;
    if (!(await confirmDialog({ title: isNew ? '確認新增地點？' : '確認修改地點？', text: `地點「${place}」，順序 ${ord}。` }))) return;
    caRoute.splice(i, 1); caRoute.splice(ord - 1, 0, place);
    caRouteEdit = null; rerender();
  });
}
function caRouteAdd() {
  if (caRouteEdit) return toast('請先儲存或取消編輯中的地點', 'err');
  if (caRoute.length >= ModuleC.ROUTE_MAX) return toast(`最多 ${ModuleC.ROUTE_MAX} 個地點`, 'err');
  const last = caRoute[caRoute.length - 1];
  caRoute.push(C_PLACES().find(x => x !== last) || C_PLACES()[0]);
  caRouteEdit = { idx: caRoute.length - 1, isNew: true };
  renderCaRoute(); initMasonry($('#page-c_apply'));
}
// 明細／審核：車輛起迄地點唯讀 grid
function cRouteCard(a) {
  const r = a.route && a.route.length ? a.route : [a.origin, a.dest].filter(Boolean), n = r.length;
  return `<div class="card"><div class="card-title">車輛起迄地點 <span class="g-tag">G137</span></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>順序</th><th>地點</th></tr></thead><tbody>
    ${r.map((x, i) => `<tr><td>${i + 1}</td><td>${gEsc(x)}${i === 0 ? ' <span class="badge b-navy">起點</span>' : i === n - 1 ? ' <span class="badge b-navy">終點</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
function renderCApplyNew(p) {
  const editing = cApply.editId ? ModuleC.applications.find(x => x.id === cApply.editId && ModuleC.canEdit(x)) : null;
  const me = DB.currentUser;
  const src = editing || { applicant: `${me.unit}-${me.name}`, dept: me.unit, applicantPhone: me.ext, isOneway: false,
    route: [], reportAt: '2026-08-27T09:00', endAt: '2026-08-27T16:00', passengers: 2, agreeCarpool: true };
  caRoute = (src.route || []).slice(); caRouteEdit = null;
  caCargo = (src.personalCargo || []).map(r => Object.assign({}, r));
  // 車屬據點：選項待業務提供，暫用據點主檔
  const baseOpts = ['<option value="">（請選擇）</option>'].concat(DB.sites.map(s => `<option value="${s.name}"${src.homeBase === s.name ? ' selected' : ''}>${s.name}</option>`)).join('');
  const v = k => (src[k] == null ? '' : String(src[k]).replace(/"/g, '&quot;'));
  p.innerHTML = `
    <div class="section-h">${editing ? `修改差旅共乘申請 · ${editing.id}` : '新增差旅共乘申請單'}</div>
    ${editing ? editBanner(editing) : ''}
    <div class="card">
      <div class="card-title">基本資料 <span class="g-tag">G50/G54/G133</span></div>
      ${infoGrid('ca-fields', [
        fInput('申請人', `<input type="text" id="ca-applicant" value="${v('applicant')}" readonly title="由登入者帶入">`),
        fInput('部門', `<input type="text" id="ca-dept" value="${v('dept')}" readonly title="由登入者帶入">`),
        fInput('申請人分機手機', `<input type="text" id="ca-phone" value="${v('applicantPhone')}" placeholder="分機或手機">`),
        fInput('申請事由 <span style="color:#c0392b;">*</span>', `<input type="text" id="ca-reason" value="${v('reason')}" placeholder="出差／洽公事由">`),
        fInput('計畫代號', `<input type="text" id="ca-project" value="${v('projectCode')}">`),
        fInput('車長', `<input type="text" id="ca-captain" value="${v('captain')}">`),
        fInput('車長分機手機', `<input type="text" id="ca-captain-phone" value="${v('captainPhone')}" placeholder="分機或手機">`),
        fInput('車屬據點 <span class="hint" title="選項待業務提供，暫用據點主檔">暫</span>', `<select id="ca-base">${baseOpts}</select>`),
        fInput('是否單程運輸', cYesNo('ca-oneway', src.isOneway), { stack: true }),
        fInput('乘客數', `<input type="number" id="ca-pax" min="1" value="${v('passengers')}">`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>車輛起迄地點 <span style="color:#c0392b;">*</span> <span class="g-tag">G137</span></span>
        <button class="btn btn-accent btn-sm" type="button" id="ca-route-add">＋ 新增</button>
      </div>
      <div id="ca-route-grid"></div>
    </div>
    <div class="card">
      <div class="card-title">用車資料</div>
      <div style="font-size:12px;color:var(--ink-soft);font-weight:600;margin:6px 0 4px;">用車時間</div>
      ${infoGrid('ca-time', [
        fInput('車輛報到日期時間 <span style="color:#c0392b;">*</span>', `<input type="datetime-local" id="ca-report" value="${v('reportAt')}">`),
        fInput('報到地點 <span style="color:#c0392b;">*</span>', `<input type="text" id="ca-report-place" value="${v('reportPlace')}" placeholder="例：台北總部 B1 車道口">`),
        `<div id="ca-end-wrap">${fInput('用車結束日期時間 <span style="color:#c0392b;">*</span>', `<input type="datetime-local" id="ca-end" value="${v('endAt')}">`)}</div>`,
      ].join(''))}
      <div style="font-size:12px;color:var(--ink-soft);font-weight:600;margin:6px 0 4px;">用車條件</div>
      ${infoGrid('ca-flags', [
        fInput('是否同意併車', cYesNo('ca-carpool', src.agreeCarpool !== false), { stack: true }),
        fInput('據點接駁', cYesNo('ca-shuttle', src.baseShuttle), { stack: true }),
        fInput('特殊證p', cYesNo('ca-permitp', src.permitP), { stack: true }),
        fInput('特殊證k', cYesNo('ca-permitk', src.permitK), { stack: true }),
        fInput('是否跨院區', cYesNo('ca-cross', src.crossCampus), { stack: true }),
        fInput('是否進台北市', cYesNo('ca-taipei', src.enterTaipei), { stack: true }),
        fInput('是否有載運品', cYesNo('ca-cargo', src.hasCargo), { stack: true }),
      ].join(''))}
      <div id="ca-cargo-wrap">
        ${infoGrid('ca-cargo-grid', [
          fInput('三聯單表單編號 <span style="color:#c0392b;">*</span>', `<input type="text" id="ca-manifest" value="${v('manifestNo')}">`),
          fInput('護運單號 <span style="color:#c0392b;">*</span>', `<input type="text" id="ca-escort" value="${v('escortNo')}">`),
        ].join(''))}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink-soft);font-weight:600;margin:10px 0 4px;">
        <span>隨身貨物 <span class="muted" style="font-weight:400;">（選填；僅記錄，不影響媒合）</span></span>
        <button class="btn btn-accent btn-sm" type="button" id="ca-pcargo-add">＋ 新增</button>
      </div>
      <div id="ca-pcargo"></div>
      ${infoGrid('ca-remark-grid', fInput('備註', `<textarea id="ca-remark" rows="2">${v('remark')}</textarea>`, { stack: true, full: true }))}
      ${editing ? infoGrid('ca-change-grid', fInput('異動事由 <span style="color:#c0392b;">*</span>', `<textarea id="ca-change" rows="2" placeholder="請說明修改原因"></textarea>`, { stack: true, full: true })) : ''}
      <div class="callout info">起點、終點、報到與結束日期時間完全相同，且雙方都<b>同意併車</b>才會合併派車（G54）；經過地點不影響媒合。<b>不同意併車</b>：單獨派車，無車可派即直接無車退回。勾選特殊證 p／k 時，只會派有該通行證的車。單程運輸的終點須為交通轉運點。</div>
    </div>
    <div class="card">
      <div class="card-title">是否送審 <span class="g-tag">G139</span></div>
      <div class="radio-group" id="ca-send-wrap">
        <label class="radio-pill"><input type="radio" name="ca-send" value="1">是</label>
        <label class="radio-pill sel"><input type="radio" name="ca-send" value="0" checked>否</label>
      </div>
      <div class="muted" style="margin-top:8px;">否＝儲存為「申請中」（之後可再修改）；是＝儲存並送出，狀態改為「待二級審」（單位主管審核）。</div>
    </div>
    <div style="text-align:center;margin-top:28px;">
      <button class="btn btn-primary" id="ca-submit">▶ 送出</button>
      <button class="btn btn-ghost" id="cn-back">← 回上一頁</button>
    </div>`;
  const cBack = () => { if (editing) { cApply.view = 'detail'; cApply.detailId = editing.id; } else cApply.view = 'list'; cApply.editId = null; RENDER.c_apply(); };
  $('#cn-back').onclick = cBack;
  // radio-pill 選取樣式＋連動顯示
  const sync = () => {
    $$('#page-c_apply .radio-pill').forEach(l => l.classList.toggle('sel', $('input', l).checked));
    $('#ca-end-wrap').style.display = cYes('ca-oneway', p) ? 'none' : '';
    $('#ca-cargo-wrap').style.display = cYes('ca-cargo', p) ? '' : 'none';
    initMasonry(p);
  };
  $$('#page-c_apply input[type=radio]').forEach(r => r.addEventListener('change', sync));
  // 用車結束不可早於報到
  const syncEndMin = () => { $('#ca-end').min = $('#ca-report').value || ''; };
  $('#ca-report').onchange = syncEndMin; syncEndMin();
  $('#ca-route-add').onclick = caRouteAdd;
  renderCaRoute();
  renderCaCargo();
  $('#ca-pcargo-add').onclick = () => { caCargo.push({ name: '', qty: 1, l: '', w: '', h: '', weight: '', pack: '' }); renderCaCargo(); initMasonry(p); };
  sync();
  guideApply('C', cApply, p); // 申請引導帶入（若有）
  if (editing) {
  }
  const formData = () => {
    if (caRouteEdit) { toast('車輛起迄地點有編輯中的列，請先儲存或取消', 'err'); return null; }
    const data = {
      applicant: $('#ca-applicant').value, dept: $('#ca-dept').value, applicantPhone: $('#ca-phone').value.trim(),
      reason: $('#ca-reason').value.trim(), projectCode: $('#ca-project').value.trim(),
      captain: $('#ca-captain').value.trim(), captainPhone: $('#ca-captain-phone').value.trim(), homeBase: $('#ca-base').value,
      isOneway: cYes('ca-oneway', p), route: caRoute.slice(),
      reportAt: $('#ca-report').value, endAt: cYes('ca-oneway', p) ? '' : $('#ca-end').value,
      reportPlace: $('#ca-report-place').value.trim(), personalCargo: caCargo.map(r => Object.assign({}, r)),
      passengers: +$('#ca-pax').value,
      agreeCarpool: cYes('ca-carpool', p), baseShuttle: cYes('ca-shuttle', p),
      permitP: cYes('ca-permitp', p), permitK: cYes('ca-permitk', p),
      crossCampus: cYes('ca-cross', p), enterTaipei: cYes('ca-taipei', p), hasCargo: cYes('ca-cargo', p),
      manifestNo: $('#ca-manifest').value.trim(), escortNo: $('#ca-escort').value.trim(),
      remark: $('#ca-remark').value.trim(),
      changeReason: editing ? $('#ca-change').value.trim() : '',
    };
    const err = ModuleC.formError(data, { editing: !!editing });
    if (err) { toast(err, 'err'); return null; }
    return data;
  };
  const done = (app, msg) => {
    toast(msg, 'ok');
    cApply.resultIds = null; cApply.editId = null; cApply.view = 'detail'; cApply.detailId = app.id;
    RENDER.c_apply();
  };
  // 送出（G139）：依「是否送審」— 否＝儲存為申請中；是＝儲存並改為待二級審；皆先跳確認
  $('#ca-submit').onclick = async () => {
    const data = formData(); if (!data) return;
    const send = cYes('ca-send', p);
    const ok = await confirmDialog(send
      ? { title: '確認送出並送審？', text: '是否送審＝<b>是</b>：儲存後狀態改為「待二級審」（單位主管審核），通過後由調度批次媒合產生派車單。' }
      : { title: '確認送出（不送審）？', text: '是否送審＝<b>否</b>：儲存為「申請中」，尚未送審；之後可於明細頁編輯再送審。' });
    if (!ok) return;
    if (send) {
      const app = editing ? ModuleC.resubmit(editing, data) : ModuleC.createApp(data);
      guideSubmitted(editing ? null : cApply, app.id);
      done(app, `${app.id} 已送審，待二級審`);
    } else {
      const app = editing ? ModuleC.saveDraft(editing, data) : ModuleC.createApp(data, { draft: true });
      if (!editing) guideDrafted(cApply, app.id);
      done(app, `${app.id} 已儲存（申請中）`);
    }
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
  demos.forEach(d => ModuleC.createApp(Object.assign({ reason: '客戶拜訪（範例）', reportPlace: `${d.origin} 大門` }, d)));
  toast('已載入 5 筆共乘申請（待二級審）', 'ok');
}
// 相容：審核端動作呼叫此函式刷新申請端 grid
function renderCaList() { if ($('#cq-grid')) renderCGrid(); }

/* ============================================================
   模組 C · 單位主管審核（直屬主管）— 獨立單元
   ============================================================ */
let cApprove = { view: 'list', detailId: null, query: { applicant: '', type: '', status: '' } };

RENDER.c_approve = function () {
  const p = $('#page-c_approve');
  if (cApprove.view === 'detail') return renderCApproveDetail(p, cApprove.detailId);
  return renderCApproveList(p);
};
function cApproveRows() {
  const q = cApprove.query;
  return ModuleC.applications.filter(a => a.status !== 'draft' &&
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.type || a.type === q.type) &&
    approveMatch(a, q.status));
}
function renderCApproveList(p) {
  const q = cApprove.query;
  const typeOpts = [['', '全部型態'], ['round', '來回單'], ['oneway', '單程單']]
    .map(([v, t]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${t}</option>`).join('');
  const stOpts = APPROVE_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">單位主管審核（直屬主管）</div>
    <div class="section-sub">員工填單後由直屬單位主管審核差旅共乘申請。點「細節」進入單據檢視與審核；退回修編時申請人可修改後重新送出，未核准前不進排班池。（G63）</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="cap-search">🔍 查詢</button></div>
      ${infoGrid('cap-q-fields', [
        fInput('申請人（模糊）', `<input type="text" id="cap-q-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('任務型態', `<select id="cap-q-type">${typeOpts}</select>`),
        fInput('狀態', `<select id="cap-q-status">${stOpts}</select>`),
      ].join(''))}
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
  $('#cap-approve-all').onclick = confirmThen({ title: '確認全部核准？', text: '確認後將核准目前清單中所有「待准駁」差旅共乘申請。' }, () => {
    const subs = cApproveRows().filter(a => a.status === 'submitted');
    subs.forEach(a => ModuleC.approve(a));
    toast(`已核准 ${subs.length} 筆`, 'ok');
    renderCApproveGrid(); renderCaList();
  });
  renderCApproveGrid();
  initMasonry(p);
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
        <td>${a.type === 'round' ? '來回' : '單程'}</td><td>${cRouteStr(a)}</td>
        <td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.type === 'round' ? a.returnDate.slice(5) + ' ' + a.earliestReturn : '<span class="muted">—</span>'}</td>
        <td>${a.pax}</td><td>${Flow.badge(a)}${signBadge(a)}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('#cap-grid [data-cvdetail]').forEach(b => b.onclick = () => { cApprove.detailId = b.dataset.cvdetail; cApprove.view = 'detail'; RENDER.c_approve(); });
}
function renderCApproveDetail(p, id) {
  const a = ModuleC.applications.find(x => x.id === id);
  if (!a) { cApprove.view = 'list'; return RENDER.c_approve(); }
  const pending = a.status === 'submitted';
  p.innerHTML = `
    <div class="section-h">差旅共乘申請審核 · ${a.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${Flow.badge(a)}${signBadge(a)}</span></div>
      ${infoGrid('cap-basic', cAppItems(a).concat([
        fItem('最晚抵達（參考 G55）', `<span class="muted">${ModuleC.latestArrival(a)}</span>`),
        fItem('建立時間', fmtTime(a.createdAt)),
        a.reviewNote ? fItem('審核備註', a.reviewNote) : '',
      ]).join(''))}
    </div>
    ${cRouteCard(a)}
    ${cCargoCard(a)}
    ${pending ? `
    <div class="card">
      <div class="card-title">單位主管審核 <span class="g-tag">G63</span></div>
      ${infoGrid('csv-fields', [
        fInput('是否同意', `
          <div class="radio-group">
            <label class="radio-pill sel" id="csv-yes-pill"><input type="radio" name="csv-agree" value="yes" checked>同意</label>
            <label class="radio-pill" id="csv-no-pill"><input type="radio" name="csv-agree" value="no">退回修編</label>
          </div>`, { stack: true, full: true }),
        fInput('審核備註 <span class="hint" id="csv-req" style="display:none;color:#c0392b;">（退回修編時必填）</span>', `<input type="text" id="csv-note" placeholder="請輸入審核意見（退回修編時必填）">`, { full: true }),
      ].join(''))}
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
      if (!agree && !note) { toast('退回修編時「審核備註」為必填', 'err'); $('#csv-note').focus(); return; }
      if (agree) { ModuleC.approve(a, note); toast(`${a.id} 已核准`, 'ok'); }
      else { ModuleC.reject(a, note); toast(`${a.id} 已退回修編，申請人可修改後重新送出`, 'err'); }
      cApprove.view = 'list'; RENDER.c_approve(); renderCaList();
    };
    $('#csv-cancel').onclick = () => { cApprove.view = 'list'; RENDER.c_approve(); };
  } else {
    $('#csv-back').onclick = () => { cApprove.view = 'list'; RENDER.c_approve(); };
  }
  initMasonry(p);
}

/* ============================================================
   模組 C · 派車調度（業務單位）— index（依出發日期）／明細（該日）
   查詢：出發日期（起）預設當日、（迄）預設當日＋14 天（G128）
   明細：待調度申請單（批次媒合／手動指派：新派車單或併入未送審派車單／無車退回）
        → 派車單 grid（「明細」開視窗：異動車種類型／車號／駕駛人1／駕駛人2／是否送審、移出申請單）（G112–G115／G128）
   ============================================================ */
let cReview = { view: 'list', date: null, query: { from: '', to: '', status: '' }, batchResult: null };
const C_LIVE = ['approved', 'matched'];
// 依出發日期彙整：申請單、待媒合、派車單（未送審／待簽審／已生效）
function cDaySummary(date) {
  const apps = ModuleC.applications.filter(a => a.departDate === date);
  const live = apps.filter(a => C_LIVE.includes(a.status));
  const orders = ModuleC.liveDispatches().filter(o => o.date === date);
  const appsOf = o => ModuleC.dispatchApps(o);
  return {
    date, total: live.length,
    pending: live.filter(a => a.status === 'approved').length,
    orders: orders.length,
    draft: orders.filter(o => !o.submitted).length,
    signing: orders.filter(o => o.submitted && appsOf(o).some(a => Signoff.isPending(a))).length,
    effective: orders.filter(o => o.submitted && appsOf(o).length && appsOf(o).every(a => Signoff.effective(a))).length,
    returned: apps.filter(a => a.status === 'noCar').length,
    done: live.filter(a => ['departed', 'logged'].includes(Flow.of(a))).length,
  };
}
function cDayRows() {
  const q = cReview.query;
  const dates = [...new Set(ModuleC.applications.filter(a => C_LIVE.includes(a.status) || a.status === 'noCar')
    .map(a => a.departDate).concat(ModuleC.liveDispatches().map(o => o.date)))].sort();
  return dates.filter(d => (!q.from || d >= q.from) && (!q.to || d <= q.to)).map(cDaySummary)
    .filter(r => !q.status || (q.status === 'pending' && r.pending > 0) || (q.status === 'draft' && r.draft > 0)
      || (q.status === 'signing' && r.signing > 0));
}
RENDER.c_review = function () {
  const p = $('#page-c_review');
  if (cReview.view === 'detail' && cReview.date) return renderCrDetail(p, cReview.date);
  const q = cReview.query;
  if (!q.from) q.from = bDayStr(0);     // 預設：起＝系統當日、迄＝系統當日＋14 天（G128）
  if (!q.to) q.to = bDayStr(14);
  const stOpts = [['', '全部'], ['pending', '有待調度'], ['draft', '有調度中（未送審）派車單'], ['signing', '有調度主管審']]
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">派車調度（業務單位）</div>
    <div class="section-sub">依<b>出發日期</b>查詢派車作業；點「明細」進入該日：對已核准申請執行<b>批次媒合</b>產生<b>派車單</b>（媒合到同一台車的申請單為一張），調度確認車種類型／車號／駕駛人後<b>送審</b>（調度主管審，同意後待出車）。無車可派的「待調度」申請單可<b>無車退回</b>（結案）。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="cr-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="crq-search">🔍 查詢</button></div>
      ${infoGrid('crq', [
        fInput('出發日期（起）', `<input type="date" id="crq-from" value="${q.from}">`),
        fInput('出發日期（迄）', `<input type="date" id="crq-to" value="${q.to}">`),
        fInput('派車狀態', `<select id="crq-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車作業（依出發日期）</span><span class="muted" id="crq-count"></span></div>
      <div id="crq-grid"></div>
    </div>`;
  $('#cr-goto-driver').onclick = () => goto('c_driver');
  $('#crq-search').onclick = () => {
    if ($('#crq-from').value && $('#crq-to').value && $('#crq-to').value < $('#crq-from').value) { toast('出發日期（迄）不可早於出發日期（起）', 'err'); return; }
    cReview.query = { from: $('#crq-from').value, to: $('#crq-to').value, status: $('#crq-status').value };
    renderCrGrid(); toast('查詢完成', 'ok');
  };
  renderCrGrid();
  initMasonry(p);
};
function renderCrGrid() {
  const box = $('#crq-grid'); if (!box) return;
  const rows = cDayRows();
  $('#crq-count').textContent = `${rows.length} 筆`;
  const n = (v, cls) => v ? `<span class="badge ${cls}">${v}</span>` : '<span class="muted">0</span>';
  box.innerHTML = rows.length === 0 ? `<div class="empty">查無派車作業。申請單經單位主管審核核准後，會依出發日期出現在這裡。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>出發日期</th><th>申請單</th><th>待調度</th><th>派車單</th><th>調度中</th><th>調度主管審</th><th>待出車以後</th><th>無車退回</th><th>已出車／已回登</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-crday="${r.date}">明細</button></td>
        <td><b style="color:var(--navy);">${r.date}</b></td><td>${r.total}</td>
        <td>${n(r.pending, 'b-amber')}</td><td>${r.orders}</td>
        <td>${n(r.draft, 'b-gray')}</td><td>${n(r.signing, 'b-amber')}</td><td>${n(r.effective, 'b-green')}</td>
        <td>${n(r.returned, 'b-red')}</td><td>${r.done}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「明細」進入該出發日期：批次媒合、手動指派、派車單異動與送審、無車退回。</div>`;
  $$('#crq-grid [data-crday]').forEach(b => b.onclick = () => {
    Object.assign(cReview, { view: 'detail', date: b.dataset.crday, batchResult: null }); RENDER.c_review();
  });
}
const cRoute = a => `${a.origin} → ${a.dest}`;
const cTimeText = a => `${a.earliestPickup}${a.type === 'round' ? `<br><span class="hint">回 ${a.returnDate.slice(5)} ${a.earliestReturn}</span>` : ''}`;
function cOrderBadge(o) {
  if (!o.submitted) return '<span class="badge b-gray">未送審</span>';
  const apps = ModuleC.dispatchApps(o);
  if (apps.some(a => Signoff.isPending(a))) return '<span class="badge b-amber">已送審 · 待運輸主管簽審</span>';
  if (apps.length && apps.every(a => Signoff.effective(a))) return '<span class="badge b-green">已送審 · 已生效</span>';
  return '<span class="badge b-navy">已送審</span>';
}
// 派車調度明細（G128）：待調度申請單（批次媒合／手動指派／無車退回）＋派車單 grid（「明細」開視窗異動與送審）
const cDrvOpts = (cur, blank) => bOpt('', blank, cur || '') + DB.drivers.filter(d => d.pool === 'BIZ').map(d => bOpt(d.id, `${d.name}（${d.id}｜歸屬 ${d.homeSite}）`, cur)).join('');
const cPaxOf = apps => ModuleC.dispatchPax(apps);   // 同時在車人數（單程去回取較大者）
// 車號下拉（依車種類型）：座位不足者停用
function cFillVehicles(typeSel, vehSel, cur, pax) {
  const t = $(typeSel).value;
  $(vehSel).innerHTML = bOpt('', t ? '請選擇' : '請先選車種類型', cur) + (t ? Usage.vehiclesOf('BIZ', t)
    .map(v => bOpt(v.id, `${v.id}（${v.name}｜${v.seats} 座${v.seats < pax ? '・座位不足' : ''}）`, cur, v.seats < pax)).join('') : '');
}
// 派車單區塊（原明細頁的派車單卡片）：表單＋申請單 grid＋異動紀錄；於視窗內顯示
// 送審前可異動車種類型／車號／駕駛人1／駕駛人2／是否送審與刪除申請單；送審後（或已出車）即鎖定（G130）
function cOrderCardHtml(o) {
  const oa = ModuleC.dispatchApps(o), pax = cPaxOf(oa), started = ModuleC.started(o), locked = started || o.submitted, k = 'cro-' + o.id;
  return `
    <div style="text-align:right;margin:-4px 0 8px;">${cOrderBadge(o)}</div>
    ${infoGrid(k + '-f', [
      fItem('派車單號', `<b style="color:var(--navy);">${o.id}</b>${o.manual ? ' <span class="badge b-gray">手動指派</span>' : ''}`),
      fItem('派遣人', o.dispatcher),
      fItem('派遣時間', fmtTime(o.dispatchedAt)),
      fInput('車種類型', `<select id="${k}-type" ${locked ? 'disabled' : ''}>${Usage.types('BIZ').map(t => bOpt(t, t, o.vehicleType)).join('')}</select>`),
      fInput(`車號 <span class="hint">共 ${pax} 人</span>`, `<select id="${k}-veh" ${locked ? 'disabled' : ''}></select>`),
      fInput('駕駛人1', `<select id="${k}-d1" ${locked ? 'disabled' : ''}>${cDrvOpts(o.driver1, '請選擇')}</select>`),
      fInput('駕駛人2', `<select id="${k}-d2" ${locked ? 'disabled' : ''}>${cDrvOpts(o.driver2, '（無）')}</select>`),
      fInput('是否送審', `<select id="${k}-sub" ${locked ? 'disabled' : ''}>${bOpt('no', '否（未送審）', o.submitted ? 'yes' : 'no')}${bOpt('yes', '是（送運輸主管簽審）', o.submitted ? 'yes' : 'no')}</select>`),
    ].join(''))}
    <div style="margin:6px 0 12px;">${started ? '<span class="hint">派車單已出車，不可再異動。</span>'
      : o.submitted ? '<span class="hint">派車單已送審，不可再異動（運輸主管退回後才可再修改）。</span>'
      : '<span class="hint">送審前可異動車種類型、車號、駕駛人、是否送審與刪除申請單；是否送審改為「是」並儲存即送運輸主管簽審，<b>送審後即不可再異動</b>。</span>'}</div>
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>出發</th><th>人數</th><th>狀態</th><th>操作</th></tr></thead><tbody>
      ${oa.map(a => `<tr><td><b style="color:var(--navy);">${a.id}</b>${a.overridden ? ' <span class="badge b-amber">覆寫</span>' : ''}</td><td>${a.applicant}</td>
        <td>${a.type === 'round' ? '來回' : '單程'}</td><td>${cRoute(a)}</td><td>${cTimeText(a)}</td><td>${a.pax}</td>
        <td>${Flow.badge(a)}${signBadge(a)}</td>
        <td>${!locked ? `<button class="btn btn-danger btn-sm" data-crout="${a.id}">刪除</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    ${o.log.length ? `<details style="margin-top:10px;"><summary class="muted" style="cursor:pointer;">派車單異動紀錄（${o.log.length}）</summary>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>操作人</th><th>說明</th></tr></thead><tbody>
      ${o.log.map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td><td style="text-align:left;">${l.note || '—'}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}
    ${locked ? '' : `<div style="text-align:center;margin-top:16px;"><button class="btn btn-primary" data-crsave="${o.id}">💾 儲存</button>
      <button class="btn btn-ghost" id="cro-close">取消</button></div>`}`;
}
// 派車單明細視窗：送審前異動車輛／駕駛、是否送審、刪除申請單（回待調度）；送審後唯讀（G130）
// keep：重開視窗時保留尚未儲存的欄位值（刪除申請單後）
function openCOrderModal(o, by, rerender, keep) {
  openModal(`派車單明細 · ${o.id}`, cOrderCardHtml(o), { wide: true });
  const k = 'cro-' + o.id, pax = cPaxOf(ModuleC.dispatchApps(o));
  if (keep) $(`#${k}-type`).value = keep.vehicleType;
  cFillVehicles(`#${k}-type`, `#${k}-veh`, keep ? keep.vehicle : o.vehicle, pax);
  $(`#${k}-type`).onchange = () => cFillVehicles(`#${k}-type`, `#${k}-veh`, '', pax);
  if (keep) { $(`#${k}-d1`).value = keep.driver1; $(`#${k}-d2`).value = keep.driver2; $(`#${k}-sub`).value = keep.submitted ? 'yes' : 'no'; }
  const cl = $('#cro-close'); if (cl) cl.onclick = closeModal;
  const formVal = () => ({ vehicleType: $(`#${k}-type`).value, vehicle: $(`#${k}-veh`).value, driver1: $(`#${k}-d1`).value,
    driver2: $(`#${k}-d2`).value, submitted: $(`#${k}-sub`).value === 'yes' });
  const done = msg => { toast(msg, 'ok'); closeModal(); rerender(); };
  const save = $('#modal-body [data-crsave]');
  if (save) save.onclick = async () => {
    const f = formVal();
    const pre = ModuleC.dispatchResourceError(o, f);
    if (pre) { toast(pre, 'err'); return; }
    const text = f.submitted ? '派車單將<b>送出運輸主管簽審</b>，簽審通過後才生效；<b>送審後即不可再異動</b>。' : '儲存派車單異動（尚未送審）。';
    if (!(await confirmDialog({ title: `確認儲存派車單 ${o.id}？`, text }))) return;
    const r = ModuleC.updateDispatch(o, f, by());
    if (!r.ok) { toast(r.error, 'err'); return; }
    done(`派車單 ${o.id} 已${f.submitted ? '儲存並送審' : '儲存'}`);
  };
  // 刪除：申請單移出派車單、回到「待調度申請單」；派車單仍有申請單則重開視窗（保留未儲存的欄位）
  $$('#modal-body [data-crout]').forEach(b => b.onclick = async () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.crout);
    if (!(await confirmDialog({ title: '確認刪除？', text: `${a.id} 將自派車單 ${o.id} 刪除，回到「待調度申請單」。` }))) return;
    const keepVal = formVal();
    const r = ModuleC.unassign(a, by());
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${a.id} 已刪除，回到待調度申請單`, 'ok');
    rerender();
    if (o.cancelled) { closeModal(); toast(`派車單 ${o.id} 已無申請單，自動取消`, 'ok'); }
    else openCOrderModal(o, by, rerender, keepVal);
  });
}
// 手動指派視窗：新派車單（指定車種類型／車號／駕駛人1／駕駛人2，產生未送審派車單）或併入未送審派車單
function openCManualAssign(a, by, rerender) {
  const targets = ModuleC.manualTargets(a.departDate);
  const tgtText = o => { const oa = ModuleC.dispatchApps(o), v = DB.vehicles.find(x => x.id === o.vehicle);
    return `${o.id}｜${o.vehicle}（${o.vehicleType}）｜${[o.driver1, o.driver2].filter(Boolean).map(drvName).join('＋') || '未指定駕駛'}｜${oa.length} 張｜${cPaxOf(oa)}／${v ? v.seats : '—'} 人｜${[...new Set(oa.map(cRoute))].join('、')}`; };
  const veh0 = DB.vehicles.find(v => v.pool === 'BIZ' && v.seats >= a.pax);
  openModal(`手動指派 · ${a.id}`, `
    <div class="card-desc">${a.applicant}｜${cRoute(a)}｜${a.type === 'round' ? `來回（回 ${a.returnDate} ${a.earliestReturn}）` : '單程'}｜${a.pax} 人｜出發 <b>${a.departDate} ${a.earliestPickup}</b></div>
    ${infoGrid('cma-mode', [fInput('指派方式', gPills('cma-mode', 'new', [['new', '新派車單（暫存未送審）'], ['merge', `併入既有派車單（${targets.length} 張可併）`]]), { full: true, stack: true })].join(''))}
    <div id="cma-new">${infoGrid('cma-new-f', [
      fInput('車種類型 <span style="color:#c0392b;">*</span>', `<select id="cma-type">${bOpt('', '請選擇', veh0 ? veh0.type : '')}${Usage.types('BIZ').map(t => bOpt(t, t, veh0 ? veh0.type : '')).join('')}</select>`),
      fInput('車號 <span style="color:#c0392b;">*</span>', `<select id="cma-veh"></select>`),
      fInput('駕駛人1 <span style="color:#c0392b;">*</span>', `<select id="cma-d1">${cDrvOpts('', '請選擇')}</select>`),
      fInput('駕駛人2', `<select id="cma-d2">${cDrvOpts('', '（無）')}</select>`),
    ].join(''))}</div>
    <div id="cma-merge" style="display:none;">${targets.length ? infoGrid('cma-merge-f', [
      fInput('併入派車單 <span style="color:#c0392b;">*</span>', `<select id="cma-target">${targets.map(o => bOpt(o.id, tgtText(o), '')).join('')}</select>`, { full: true }),
    ].join('')) : '<div class="callout">本出發日期沒有尚未送審、未出車的派車單可併入。</div>'}</div>
    <div class="hint" style="margin-top:8px;">指派時檢核座位、保修、請假、其他派車單與一般用車佔用；產生或併入的派車單為未送審，確認後於派車單明細送審。手動指派會留下人工覆寫紀錄，此單不再被批次媒合重排。</div>
    <div style="text-align:center;margin-top:18px;">
      <button class="btn btn-primary" id="cma-ok">✓ 確認指派</button>
      <button class="btn btn-ghost" id="cma-cancel">取消</button>
    </div>`);
  cFillVehicles('#cma-type', '#cma-veh', veh0 ? veh0.id : '', a.pax);
  $('#cma-type').onchange = () => cFillVehicles('#cma-type', '#cma-veh', '', a.pax);
  const mode = () => ($('#modal-body input[name=cma-mode]:checked') || {}).value || 'new';
  $$('#modal-body input[name=cma-mode]').forEach(r => r.onchange = () => {
    $$('#cma-mode-wrap .radio-pill').forEach(l => l.classList.toggle('sel', l.querySelector('input').checked));
    $('#cma-new').style.display = mode() === 'new' ? '' : 'none';
    $('#cma-merge').style.display = mode() === 'merge' ? '' : 'none';
  });
  $('#cma-cancel').onclick = closeModal;
  $('#cma-ok').onclick = async () => {
    let pre, text, act;
    if (mode() === 'new') {
      const f = { vehicleType: $('#cma-type').value, vehicle: $('#cma-veh').value, driver1: $('#cma-d1').value, driver2: $('#cma-d2').value };
      pre = ModuleC.dispatchResourceError({ apps: [a.id] }, f);
      text = `${a.id} 指派 <b>${f.vehicle}</b>（${f.vehicleType}）｜駕駛 ${[f.driver1, f.driver2].filter(Boolean).map(drvName).join('＋')}，產生一張<b>未送審</b>派車單（出發日期 ${a.departDate}）。`;
      act = () => ModuleC.manualAssign(a, f, by());
    } else {
      const o = targets.find(x => x.id === ($('#cma-target') || {}).value);
      if (!o) { toast('請選擇要併入的派車單', 'err'); return; }
      pre = ModuleC.dispatchResourceError({ apps: o.apps.concat(a.id) }, o);
      text = `${a.id} 併入派車單 <b>${o.id}</b>（${o.vehicle}），派車單維持未送審。`;
      act = () => ModuleC.manualMerge(a, o, by());
    }
    if (pre) { toast(pre, 'err'); return; }
    if (!(await confirmDialog({ title: '確認手動指派？', text }))) return;
    const r = act();
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${a.id} 已${mode() === 'new' ? '指派，產生派車單 ' : '併入派車單 '}${r.dispatch.id}`, 'ok');
    closeModal(); rerender();
  };
}
function renderCrDetail(p, date) {
  const apps = ModuleC.applications.filter(a => a.departDate === date);
  const waiting = apps.filter(a => a.status === 'approved');
  const orders = ModuleC.liveDispatches().filter(o => o.date === date);
  const returned = apps.filter(a => a.status === 'noCar');
  const br = cReview.batchResult;
  const by = () => (($('#cr-by') || {}).value || '').trim() || '調度室';
  p.innerHTML = `
    <div class="section-h">派車調度明細 · 出發日期 ${date}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>待調度申請單（${waiting.length} 筆）</span>
        <span><input type="text" id="cr-by" value="調度室-值班人員" style="width:150px;margin-right:6px;" title="派遣人">
        <button class="btn btn-accent btn-sm" id="cr-run">▶ 批次媒合</button></span></div>
      <div class="card-desc">對<b>本出發日期</b>已核准的申請單執行批次媒合（已成功單不重排）：媒合到<b>同一台車</b>的申請單產生一張<b>派車單</b>（派車單號、派遣人、派遣時間自動給予，併入派車單即為「調度中」）。媒合不成者仍為待調度並註明原因，可按<b>手動指派</b>：指定車輛／駕駛產生暫存派車單，或併入本日尚未送審的派車單；確定無車可派者按<b>無車退回</b>（原因必填，結案）。</div>
      ${waiting.length === 0 ? '<div class="empty">本日沒有待調度的申請單。</div>' : `
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>單號</th><th>申請人</th><th>型態</th><th>路線</th><th>出發</th><th>人數</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        ${waiting.map(a => `<tr><td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
          <td>${a.type === 'round' ? '來回' : '單程'}</td><td>${cRoute(a)}</td><td>${cTimeText(a)}</td><td>${a.pax}</td>
          <td>${Flow.badge(a)}${a.note ? `<br><span class="hint">${a.note}</span>` : ''}</td>
          <td style="white-space:nowrap;"><button class="btn btn-primary btn-sm" data-crassign="${a.id}">手動指派</button>
            <button class="btn btn-danger btn-sm" data-crret="${a.id}">無車退回</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車單（${orders.length} 張）</span>
        <span class="muted">點「明細」異動車輛／駕駛、送審或移出申請單</span></div>
      ${orders.length === 0 ? '<div class="empty">本日尚無派車單。按上方「批次媒合」或「手動指派」產生。</div>' : `
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th></th><th>派車單號</th><th>派遣人</th><th>派遣時間</th><th>車種類型</th><th>車號</th><th>駕駛人1</th><th>駕駛人2</th><th>申請單數</th><th>狀態</th></tr></thead><tbody>
        ${orders.map(o => `<tr><td><button class="btn btn-ghost btn-sm" data-crorder="${o.id}">明細</button></td>
          <td><b style="color:var(--navy);">${o.id}</b>${o.manual ? ' <span class="badge b-gray">手動</span>' : ''}</td><td>${o.dispatcher}</td><td>${fmtTime(o.dispatchedAt)}</td>
          <td>${o.vehicleType || '—'}</td><td>${usageVehText(o.vehicle)}</td><td>${o.driver1 ? drvName(o.driver1) : '—'}</td><td>${o.driver2 ? drvName(o.driver2) : '—'}</td>
          <td>${ModuleC.dispatchApps(o).length}</td><td>${cOrderBadge(o)}</td></tr>`).join('')}
      </tbody></table></div>`}
    </div>
    ${returned.length ? `<div class="card"><div class="card-title">無車退回</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>路線</th><th>狀態</th><th>原因</th></tr></thead><tbody>
      ${returned.map(a => `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${cRoute(a)}</td><td>${Flow.badge(a)}</td>
        <td style="text-align:left;">${a.noCarNote || '—'}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${renderC_overrideLog() ? `<div class="card">${renderC_overrideLog().replace('<div class="divider"></div>', '')}</div>` : ''}
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
    </div>
    ${renderC_batchLog()}
    ${br ? `<div class="card" id="cr-result"><div class="card-title">批次媒合結果</div>
      <div class="result ok"><div class="r-head">✓ 批次 ${br.batch.id} 完成（派遣人 ${br.batch.triggeredBy}）</div>
        <div>處理 ${br.batch.processed} 筆｜成功 ${br.batch.matched} 筆｜未媒合（仍待調度）${br.batch.coordinate} 筆${br.batch.noCar ? `｜無車可派（不同意併車）${br.batch.noCar} 筆` : ''}｜產生派車單 ${br.dispatches.length} 張</div></div>
      <div class="trace">${br.trace.join('\n')}</div></div>` : ''}
    ${backBar('cr-back')}`;
  const rerender = () => { RENDER.c_review(); renderCaList(); };
  $('#cr-back').onclick = () => { Object.assign(cReview, { view: 'list', batchResult: null }); RENDER.c_review(); };
  $('#cr-run').onclick = confirmThen({ title: '確認執行批次媒合？', text: `將對出發日期 <b>${date}</b> 已核准的申請單執行批次媒合（已成功單不重排），媒合到同一台車者產生一張派車單（未送審）。` }, () => {
    cReview.batchResult = ModuleC.runBatch(date, by(), { days: 0 });
    toast(`批次 ${cReview.batchResult.batch.id} 完成，產生派車單 ${cReview.batchResult.dispatches.length} 張`, 'ok');
    rerender();
  });
  $$('#page-c_review [data-crorder]').forEach(b => b.onclick = () => openCOrderModal(orders.find(x => x.id === b.dataset.crorder), by, rerender));
  $$('#page-c_review [data-crassign]').forEach(b => b.onclick = () => openCManualAssign(ModuleC.applications.find(x => x.id === b.dataset.crassign), by, rerender));
  $$('#page-c_review [data-crret]').forEach(b => b.onclick = () => openNoCarDialog(ModuleC.applications.find(x => x.id === b.dataset.crret),
    (a, note, by) => ModuleC.returnApp(a, note, by), rerender));
  initMasonry(p);
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
        <th>批次</th><th>觸發時間</th><th>觸發人</th><th>處理範圍</th><th>處理單數</th><th>成功</th><th>未媒合</th><th>失敗率</th>
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
function statusText(s) {
  return ({ draft: '申請中', submitted: '待二級審', approved: '待調度', rejected: '退回修編', matched: '調度中', noCar: '無車退回' })[s] || s;
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
          <td>${v.pool === 'LOGI' ? '<span class="badge b-navy">物流</span>' : '<span class="badge b-green">商務（C/D 共用）</span>'}</td>
          <td>${v.homeSite}</td><td>${v.currentSite}${v.currentSite !== v.homeSite ? ' <span class="badge b-amber">外派中</span>' : ''}</td>
          <td>${v.pool === 'BIZ' ? v.seats + ' 座' : v.volume.toFixed(0) + 'L/' + v.weight + 'kg'}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-title">司機主檔（獨立資源）<span class="g-tag">C-2</span></div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>ID</th><th>姓名</th><th>資源池</th><th>歸屬據點</th><th>當前位置</th></tr></thead><tbody>
        ${DB.drivers.map(d => `<tr><td>${d.id}</td><td>${d.name}</td>
          <td>${d.pool === 'LOGI' ? '物流' : '商務（C/D 共用）'}</td><td>${d.homeSite}</td>
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
        <div class="card-desc">依車型 × 目的地查表；寬鬆估計、僅供排班參考顯示，不參與運算、不反向限制 13.5 小時精算。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>目的地據點</th><th>大車</th><th>小車</th></tr></thead><tbody>${dayBody}</tbody></table></div></div>

      <div class="card"><div class="card-title">2.12 司機休息／用餐門檻</div>
        <div class="card-desc">依純累積行駛時間觸發，共用不歸零時數線，每日歸零。</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>項目</th><th>觸發條件</th><th>耗時</th></tr></thead><tbody>${brkBody}</tbody></table></div></div>

      <div class="card"><div class="card-title">巡迴物品轉運作業班次（每日 5 班）<span class="g-tag">G18</span></div>
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
  const rows = ModuleA.applications.filter(a => a.status === 'matched' && a.assignedShift);
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
      const t = minToHHMM(ModuleA.shiftArrivalAtStation(sh, stp.order, date === '—' ? null : date));   // 含前面各站停站時間（G131）
      const dropLines = stp.drops.map(a => {
        const del = ['departed', 'logged'].includes(Flow.of(a)) ? ' ' + Flow.badge(a) : '';
        return `<div style="margin:2px 0;"><span class="badge b-amber">卸貨</span> ${a.id}｜${aDestText(a)}｜接收：${personDisplay(a.recipient)}${del}</div>`;
      }).join('');
      const pickLines = stp.picks.map(a =>
        `<div style="margin:2px 0;"><span class="badge b-navy">取貨</span> ${a.id}｜${a.pickupLoc || stp.name}｜${itemsSummary(a.items)}</div>`).join('');
      return `<tr><td>${i + 1}</td><td><b>${stp.name}</b></td>
        <td><b style="color:var(--navy);">${t}</b></td>
        <td style="text-align:left;">${dropLines}${pickLines}</td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚚 <b>${brName(sh.branch)}</b>｜<b>${date}</b>${date === ModuleA.todayStr() ? ' <span class="badge b-navy">今天</span>' : ''}｜${sh.label}｜車 <b style="color:var(--navy);">${veh.id}</b>（${veh.name}）</span>
        <span class="badge b-navy">駕駛：${logiDriverName(veh.id)}</span></div>
      <div class="card-desc">沿分公司固定 9 站路線<b>一次通過</b>，於 <b>${ordered.length}</b> 個停靠站依序<b>卸貨／取貨</b>；本班 <b>${list.length}</b> 筆、總貨量約 <b>${totalVol.toFixed(0)}L</b>。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>停靠站</th><th>抵達</th><th>作業（卸貨／取貨）</th>
      </tr></thead><tbody>${body}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已排定的班次任務。使用者送出巡迴物品轉運申請並自動媒合成功後，這裡會依班次（車輛）顯示司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">巡迴物品轉運作業 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「日期＋班次（車輛）」為單位，沿據點固定 9 站路線<b>一次通過</b>：每個停靠站依站序列出要<b>卸貨</b>與<b>取貨</b>的單、抵達時間、貨物與接收人（同一站的收貨自動彙整在一起）。</div>
    ${cards}`;
};

/* 模組 B · 司機任務單：以「車輛」為單位，這一趟停靠哪些據點、各站取貨／卸貨 */
RENDER.b_driver = function () {
  const p = $('#page-b_driver');
  const rows = ModuleB.orders.filter(o => o.status === 'loaded' && o.dispatchVehicle && Signoff.effective(o)); // 調度主管同意（待出車）才列入
  // 一張任務單＝一趟「車輛×方向」：去程（南下）與回程（北返）是兩段不同的實體行程，
  // 各有獨立時間軸，不可併在同一條路線上排序（否則同一車會「同時」出現在南北兩地）。
  const byTrip = {};
  rows.forEach(o => {
    const dir = o.dispatchDir || 'south';
    const key = o.dispatchVehicle + '\u0001' + dir;
    (byTrip[key] = byTrip[key] || { vid: o.dispatchVehicle, dir, list: [] }).list.push(o);
  });
  // 去程排前、回程排後；同方向依車號
  const tripKeys = Object.keys(byTrip).sort((ka, kb) => {
    const A = byTrip[ka], B = byTrip[kb];
    return ((A.dir === 'south' ? 0 : 1) - (B.dir === 'south' ? 0 : 1)) || (A.vid < B.vid ? -1 : A.vid > B.vid ? 1 : 0);
  });
  let cards = tripKeys.map(key => {
    const { vid, dir, list } = byTrip[key];
    const veh = DB.vehicles.find(v => v.id === vid);
    const south = dir === 'south';
    const events = [];
    list.forEach(o => {
      events.push({ siteId: o.pickSite, type: 'pick', time: o.pickupTime, day: o.dispatchDay || 1, o });
      events.push({ siteId: o.dropSite, type: 'drop', time: o.dispatchDropTime, day: o.dispatchDay || 1, o });
    });
    const bySite = {};
    events.forEach(e => { (bySite[e.siteId] = bySite[e.siteId] || []).push(e); });
    const minTime = sid => Math.min(...bySite[sid].map(e => e.time ? hhmmToMin(e.time) : 9999));
    const dayOf = sid => Math.min(...bySite[sid].map(e => e.day || 1));
    const siteIds = Object.keys(bySite).sort((a, b) => {
      // 先依趟次日、再依當日到站時間；同時間才以「路線行進方向」的據點順序打破平手。
      // 據點序北大南小（屏東1…台北10）：南下先北後南（序遞減）、北返先南後北（序遞增）。
      const geo = south ? (ModuleB.siteById(b).order - ModuleB.siteById(a).order)
                        : (ModuleB.siteById(a).order - ModuleB.siteById(b).order);
      return (dayOf(a) - dayOf(b)) || (minTime(a) - minTime(b)) || geo;
    });
    const multiDay = siteIds.some(sid => dayOf(sid) > 1);
    const stopRows = siteIds.map((sid, idx) => {
      const site = ModuleB.siteById(sid);
      const evs = bySite[sid];
      const arrive = evs.map(e => e.time).filter(Boolean).sort()[0] || '—';
      const dayTag = multiDay ? `<span class="hint">D${dayOf(sid)} </span>` : '';
      const detail = [
        ...evs.filter(e => e.type === 'pick').map(e => `<div style="margin:2px 0;"><span class="badge b-navy">取貨</span> ${e.time || ''} ${e.o.id}｜${e.o.pickupLoc || '—'}｜${itemsSummary(e.o.items)}</div>`),
        ...evs.filter(e => e.type === 'drop').map(e => `<div style="margin:2px 0;"><span class="badge b-amber">卸貨</span> ${e.time || ''} ${e.o.id}｜${e.o.deliverLoc || '—'}｜接收：${recipientDisplay(e.o.recipient)}</div>`),
      ].join('');
      return `<tr><td>${idx + 1}</td><td>${dayTag}<b>${site.name}</b></td><td>${arrive}</td><td style="text-align:left;">${detail}</td></tr>`;
    }).join('');
    const modeLabel = list.every(o => o.dispatchMode === '直達') ? '直達' : (list.every(o => o.dispatchMode === '非直達') ? '非直達（沿線收送）' : '混合');
    const legLabel = south ? '去程（南下）' : '回程（北返）';
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚛 車 <b style="color:var(--navy);">${veh.id}</b>（${veh.name}）<span class="badge ${south ? 'b-navy' : 'b-green'}" style="margin-left:6px;">${legLabel}</span><span class="hint" style="margin-left:6px;">${modeLabel}</span>${(() => { const ds = [...new Set(list.flatMap(o => ModuleB.driversOf(o)))]; return ds.length ? `<span class="hint" style="margin-left:6px;">駕駛 ${ds.map(drvNm).join('＋')}</span>` : ''; })()}</span>
        <span class="badge b-navy">駕駛：${logiDriverName(veh.id)}</span></div>
      <div class="card-desc">本趟共 <b>${list.length}</b> 張託運單、<b>${siteIds.length}</b> 個停靠據點；依派車決策沿線<b>取貨／卸貨</b>。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>停靠據點</th><th>抵達</th><th>作業（取貨／卸貨）</th>
      </tr></thead><tbody>${stopRows}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已派車的幹線任務。於「B｜派車調度」執行派車後，這裡會依車輛顯示沿線取貨／卸貨的司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">院區物品轉運作業 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「車輛×趟次（去程南下／回程北返）」為單位，各為一張任務單；同一趟沿線依<b>到站時間＋路線方向</b>排序停靠據點。去程與回程是兩段獨立行程、時間軸<b>不混疊</b>，避免同一車在南北兩地同時出現。</div>
    ${cards}`;
};

/* 模組 C · 司機任務單：以「駕駛」為單位，今日整個行程要接誰、去哪裡 */
RENDER.c_driver = function () {
  const p = $('#page-c_driver');
  const rows = ModuleC.applications.filter(a => a.status === 'matched' && a.driver && a.vehicle && Signoff.effective(a)); // 調度主管同意（待出車）才列入
  const byDriver = {};
  rows.forEach(a => ModuleC.driversOf(a).forEach(d => (byDriver[d] = byDriver[d] || []).push(a)));   // 駕駛人1／2 皆列任務
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
  if (!cards) cards = `<div class="card"><div class="empty">今日尚無已媒合的共乘任務。於「C｜派車調度」批次媒合並送審、經運輸主管簽審通過後，這裡會依駕駛顯示每趟要接誰、去哪裡的司機任務單。</div></div>`;
  p.innerHTML = `
    <div class="section-h">差旅共乘作業 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「駕駛」為單位，顯示今日整個行程：每趟出發時間、起訖地、車輛，以及要接送的乘客（單位/分機/人數）。</div>
    ${cards}`;
};

/* ============================================================
   模組 D · 一般用車（含例行用車類別，規格 v2）— 共用小工具
   ============================================================ */
const D_ROLES = ['一般員工', '總經理', '部長秘書']; // 原型示範身分（正式版由登入帶入）
function dPeriod(a) {
  return a.startDate === a.endDate ? `${a.startDate} ${a.startTime}～${a.endTime}`
    : `${a.startDate} ${a.startTime} ～ ${a.endDate} ${a.endTime}`;
}
function dPeriodShort(a) {
  return a.startDate === a.endDate ? `${a.startDate.slice(5)} ${a.startTime}～${a.endTime}`
    : `${a.startDate.slice(5)} ${a.startTime}～${a.endDate.slice(5)} ${a.endTime}`;
}
function dOutcomeBadge(a) {
  const m = { withDriver: ['派車＋派司機', 'b-green'], selfDrive: ['派車（自駕）', 'b-navy'], noVehicle: ['無車退回', 'b-red'] }[a.outcome];
  return m ? `<span class="badge ${m[1]}">${m[0]}</span>` : '<span class="muted">—</span>';
}
function dCatBadge(a) {
  return a.category === 'routine' ? '<span class="badge b-amber">★ 例行用車</span>' : '<span class="badge b-gray">一般用車</span>';
}
function dStatusCell(a) {
  return Flow.badge(a) + signBadge(a) + (a.pendingReturn ? ' <span class="badge b-amber">提前歸還待確認</span>' : '');
}
function dCargoSummary(a) {
  if (!a.items || !a.items.length) return '<span class="muted">無</span>';
  const n = a.items.reduce((s, i) => s + (i.qty || 1), 0);
  return `${a.items.length} 項／${n} 件${a.items.some(i => i.hazardous) ? ' <span class="badge b-red">⚠ 危險品</span>' : ''}`;
}
// 申請時勾選的派車需求／提示標記（通行證為硬篩選，其餘僅提示 G85–G87）
function dNeedTags(a, empty) {
  const t = [];
  if (a.waitDriver) t.push('<span class="badge b-navy">願意等待駕駛媒合</span>');
  a.permits.forEach(c => t.push(`<span class="badge b-red">🛂 ${ModuleD.permitName(c)}</span>`));
  if (a.enterTaipei) t.push('<span class="badge b-amber">進入台北市</span>');
  if (a.holidayOT) t.push('<span class="badge b-amber">假日加班</span>');
  if (a.nightOT) t.push('<span class="badge b-amber">夜間加班</span>');
  return t.length ? t.join(' ') : (empty == null ? '<span class="muted">—</span>' : empty);
}
const dVehName = id => { const v = DB.vehicles.find(x => x.id === id); return v ? `${v.id}（${v.name}）` : '—'; };
const dDrvName = id => { const d = DB.drivers.find(x => x.id === id); return d ? d.name : '—'; };
const dDrvList = ids => ids.map(dDrvName).join('＋');
// 目前指派的司機文字：雙駕駛標示、0 位＝使用者自駕
function dDriversText(a) {
  if (!a.vehicle) return '<span class="muted">—</span>';
  return a.drivers.length ? `${dDrvList(a.drivers)}${a.drivers.length === 2 ? ' <span class="badge b-navy">雙駕駛</span>' : ''}` : '使用者自行駕駛';
}
const dHazardCallout = a => a.items.some(i => i.hazardous)
  ? `<div class="callout" style="margin-bottom:14px;">⚠ 隨行貨物含<b>危險品</b>：此標記僅供調度判斷派車方式，系統不寫死任何自動限制，請依經驗與公司規定人工判斷（G78）。</div>` : '';
// 指派區間歷史（G88）：每次換車／換司機新增一段，不覆蓋；長度為 0 的區間＝生效前即被更換
function dSegTable(a) {
  if (!a.segs.length) return '<div class="muted">尚無指派區間。</div>';
  return `<div class="table-wrap"><table class="dt"><thead><tr><th>#</th><th>區間</th><th>車輛</th><th>司機</th><th>類型</th><th>原因</th><th>操作人</th></tr></thead><tbody>
    ${a.segs.map((s, i) => { const to = ModuleD.segEnd(a, i), empty = to <= s.from;
      return `<tr${empty ? ' style="opacity:.55;"' : ''}><td>${i + 1}</td>
        <td>${ModuleD.fmtAbs(s.from)} ～ ${ModuleD.fmtAbs(to)}${empty ? '<br><span class="hint">生效前即更換（不佔用）</span>' : ''}</td>
        <td>${dVehName(s.vehicle)}</td><td>${s.drivers.length ? dDrvList(s.drivers) : '使用者自駕'}</td>
        <td><span class="badge ${i === 0 ? 'b-gray' : 'b-navy'}">${s.kind}</span></td><td>${s.reason || '—'}</td><td>${s.by}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function dMailTable(a) {
  const ms = ModuleD.mailsOf(a);
  if (!ms.length) return '<div class="muted">尚無通知。</div>';
  return `<div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>收件人</th><th>類型</th><th>內容</th></tr></thead><tbody>
    ${ms.map(m => `<tr><td>${fmtTime(m.at)}</td><td>${m.to}</td><td>${m.kind}</td><td>${m.text}</td></tr>`).join('')}
  </tbody></table></div><div class="muted" style="font-size:12px;margin-top:6px;">✉ 沿用既有 Email 通知路由（雛形僅留存寄送紀錄 G80）。</div>`;
}
function dLogCard(a) {
  return a.log.length ? `<div class="card"><div class="card-title">異動紀錄</div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>操作人</th><th>說明</th></tr></thead><tbody>
    ${a.log.map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td><td>${l.note || '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';
}
// 目前時間（絕對分，與 ModuleD 同口徑）
function dNowAbs() { const n = new Date(); return ModuleD.absMin(Guide.todayStr(), `${pad2(n.getHours())}:${pad2(n.getMinutes())}`); }
// 多選膠囊（checkbox 版 radio-pill）；opts＝[[value, 文字], ...]
function dChecks(name, opts, selected) {
  return `<div class="radio-group" id="${name}-wrap">${opts.map(([v, t]) => { const on = selected.includes(v);
    return `<label class="radio-pill${on ? ' sel' : ''}"><input type="checkbox" name="${name}" value="${v}"${on ? ' checked' : ''}>${t}</label>`; }).join('')}</div>`;
}
function dWireChecks(root, name) {
  $$(`input[name=${name}]`, root).forEach(c => c.onchange = () => c.closest('.radio-pill').classList.toggle('sel', c.checked));
}
const dChecked = (root, name) => $$(`input[name=${name}]:checked`, root).map(c => c.value);
// 相容：他單元動作後刷新申請端 grid（若目前正在查詢畫面）
function renderDaList() { if ($('#dq-grid')) renderDGrid(); }

/* ============================================================
   模組 D · 一般用車申請（使用者）— 查詢 / 明細（提前歸還）/ 新增（撤回修改後重新送出共用新增畫面）
   ============================================================ */
let dApply = { view: 'list', detailId: null, editId: null, query: { applicant: '', date: '', status: '' }, resultIds: null };
let dDraftItems = []; // 新增／修改畫面的隨行貨物暫存

RENDER.d_apply = function () {
  const p = $('#page-d_apply');
  if (dApply.view === 'new') return renderDApplyNew(p);
  if (dApply.view === 'detail') return renderDApplyDetail(p, dApply.detailId);
  return renderDApplyList(p);
};

/* ---------- 查詢畫面 ---------- */
function renderDApplyList(p) {
  const q = dApply.query;
  const stOpts = flowOpts(q.status, ['draft', 'review', 'revise', 'todo', 'noCar', 'signing', 'ready', 'departed', 'logged']);   // D 一單一派車單、派車判斷即送審（無調度中）
  p.innerHTML = `
    <div class="section-h">一般用車申請（使用者）</div>
    <div class="section-sub">彈性時長用車（數小時～數個月，不分類別）。送出後先經<b>單位主管審核</b>，再由<b>調度人工確認</b>共用商務車輛／司機資源並派車，結果以 Email 通知。申請單另有「例行用車」類別，僅總經理／部長秘書等特定角色可選（G81）。車型由調度依人數與貨物指派，不需自選（G77）。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="dq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="dq-new">＋ 新增</button>
        </span>
      </div>
      ${infoGrid('dq-fields', [
        fInput('申請人（模糊）', `<input type="text" id="dq-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('用車日期 <span class="hint">落在起訖期間內</span>', `<input type="date" id="dq-date" value="${q.date || ''}">`),
        fInput('狀態', `<select id="dq-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史用車申請</span>
        <span><span class="muted" id="dq-count"></span>
          <button class="btn btn-ghost btn-sm" id="dq-demo" style="margin-left:10px;">載入範例</button></span>
      </div>
      <div id="dq-grid"></div>
    </div>`;
  $('#dq-search').onclick = () => runDQuery();
  $('#dq-new').onclick = () => { dApply.editId = null; dApply.view = 'new'; RENDER.d_apply(); };
  $('#dq-demo').onclick = () => { loadDDemo(); dApply.resultIds = null; renderDGrid(); };
  renderDGrid();
  initMasonry(p);
}
function runDQuery() {
  dApply.query = { applicant: $('#dq-applicant').value.trim(), date: $('#dq-date').value, status: $('#dq-status').value };
  const q = dApply.query;
  const res = ModuleD.applications.filter(a =>
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    (!q.date || (a.startDate <= q.date && q.date <= a.endDate)) &&
    (!q.status || Flow.of(a) === q.status));
  dApply.resultIds = res.map(a => a.id);
  renderDGrid();
  toast(`查詢完成，共 ${res.length} 筆`, 'ok');
}
function renderDGrid() {
  if (!$('#dq-grid')) return;
  const rows = dApply.resultIds == null ? ModuleD.applications
    : dApply.resultIds.map(id => ModuleD.applications.find(a => a.id === id)).filter(Boolean);
  $('#dq-count').textContent = `${rows.length} 筆`;
  $('#dq-grid').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">🔍</div>查無符合條件的申請紀錄</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>類別</th><th>申請人</th><th>用車時段</th><th>人</th><th>自駕</th><th>隨行貨物</th><th>狀態</th><th>派車結果</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-ddetail="${a.id}">細節</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${dCatBadge(a)}</td><td>${a.applicant}</td>
        <td>${dPeriodShort(a)}</td><td>${a.pax}</td><td>${a.selfDrive ? '是' : '否'}</td>
        <td>${dCargoSummary(a)}</td><td>${dStatusCell(a)}</td><td>${dOutcomeBadge(a)}</td>
        <td class="muted">${fmtTime(a.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可跳轉至申請單明細（調度確認前撤回修改／整單撤回；派車後提出提前歸還，於明細操作）。</div>`;
  $$('#dq-grid [data-ddetail]').forEach(b => b.onclick = () => {
    dApply.detailId = b.dataset.ddetail; dApply.view = 'detail'; RENDER.d_apply();
  });
}

/* ---------- 明細畫面 ---------- */
function renderDApplyDetail(p, id) {
  const a = ModuleD.applications.find(x => x.id === id);
  if (!a) { dApply.view = 'list'; return RENDER.d_apply(); }
  const acts = [];
  if (ModuleD.canWithdrawToEdit(a)) acts.push(`<button class="btn btn-ghost" id="dd-withdraw">↩ 撤回修改</button>`);
  if (ModuleD.canEdit(a)) acts.push(`<button class="btn btn-primary" id="dd-edit">✎ ${a.status === 'draft' ? '編輯並送出' : '修改後重新送出'}</button>`);
  const rule = a.status === 'draft' ? '此單為<b>申請中</b>（暫存或撤回修改），可編輯後送出，送出後進入「待二級審」。'
    : '調度確認前：可<b>撤回修改</b>（回到申請中，改完重新送出並<b>重新經二級審與調度</b>）。';
  const endNote = {
    rejected: '單位主管已<b>退回修編</b>：請依審核備註修改後重新送出，將重新經單位主管審核。',
    noVehicle: '調度已<b>無車退回</b>（結案，不可再修改或重送）；如仍需用車請另開新單。',
    dispatched: Signoff.isPending(a) ? '調度已做出派車判斷，<b>調度主管審</b>中；同意後才生效（待出車）並寄送派車結果通知。' : '調度已完成確認：不再撤回或修改。需要<b>換車、換司機、展延</b>請以電話等方式聯繫調度，由調度在系統處理（不需簽核）；<b>提前歸還</b>請於上方自行提出，經調度確認後生效（G83）。',
  }[a.status];
  const live = a.status === 'dispatched' && Signoff.effective(a); // 簽審通過才可提出提前歸還
  const pr = a.pendingReturn;
  const sp = ModuleD.span(a);
  const defRet = ModuleD.fromAbs(Math.max(sp.start, Math.min(dNowAbs(), sp.end - 60)));
  p.innerHTML = `
    <div class="section-h">一般用車申請明細 · ${a.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${dCatBadge(a)} ${dStatusCell(a)}</span></div>
      ${infoGrid('dd-basic', [
        fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
        fItem('申請人', `${a.applicant}${a.dept ? `（${a.dept}/${a.ext}）` : ''}`),
        fItem('用車類別', ModuleD.CATEGORY[a.category]),
        fItem('用車時段', dPeriod(a), { w2: true }),
        fItem('人數', `${a.pax} 人`),
        fItem('是否自駕', a.selfDrive ? `是（有車無司機時可自行駕駛）${a.waitDriver ? '｜願意等待駕駛媒合' : ''}` : '否', { w2: true }),
        fItem('建立時間', fmtTime(a.createdAt)),
        fItem('需求標記', dNeedTags(a), { full: true }),
        fItem('行程說明', a.purpose || '<span class="muted">—</span>', { full: true, tall: true }),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">隨行貨物 <span class="g-tag">G75</span></div>
      <div id="dd-items"></div>
    </div>
    <div class="card">
      <div class="card-title">簽核與派車結果</div>
      ${infoGrid('dd-result', [
        fItem('簽核主管', ModuleD.approverOf(a)),
        fItem('審核備註', a.reviewNote || '<span class="muted">—</span>'),
        fItem('派車結果', dOutcomeBadge(a)),
        fItem('目前車輛', a.vehicle ? dVehName(a.vehicle) : '<span class="muted">—</span>'),
        fItem('目前司機', dDriversText(a), { w2: true }),
        fItem('調度完成確認', a.dispatchedAt ? `${fmtTime(a.dispatchedAt)}（${a.dispatchedBy}）` : '<span class="muted">尚未確認</span>'),
        fItem('調度備註', a.dispatchNote || '<span class="muted">—</span>', { w2: true }),
      ].join(''))}
    </div>
    ${live ? `<div class="card">
      <div class="card-title">提前歸還 <span class="g-tag">G83</span></div>
      ${pr ? `<div class="callout info" style="margin-bottom:0;">已於 ${fmtTime(pr.at)} 提出：新的結束時間 <b>${pr.date} ${pr.time}</b>${pr.reason ? `（${pr.reason}）` : ''}，<b>等待調度確認</b>後才生效；確認前原時段仍保留。</div>`
        : `<div class="card-desc">提前歸還是唯一可由申請人在系統上發起的異動：填寫新的結束時間後送出，<b>需調度確認才生效</b>（不需單位主管審核）。新的結束時間須晚於用車起時。</div>
      ${infoGrid('dd-ret', [
        fInput('新的結束日期', `<input type="date" id="dd-ret-date" value="${defRet.date}" min="${a.startDate}" max="${a.endDate}">`),
        fInput('新的結束時間', `<input type="time" id="dd-ret-time" value="${defRet.time}">`),
        fInput('原因（選填）', `<input type="text" id="dd-ret-reason" placeholder="例：會議提早結束">`),
      ].join(''))}
      <div style="margin-top:10px;"><button class="btn btn-primary" id="dd-ret-ok">⏮ 提出提前歸還</button></div>`}
    </div>` : ''}
    ${a.segs.length ? `<div class="card"><div class="card-title">指派區間歷史 <span class="g-tag">G88</span></div>${dSegTable(a)}</div>` : ''}
    ${ModuleD.mailsOf(a).length ? `<div class="card"><div class="card-title">通知紀錄</div>${dMailTable(a)}</div>` : ''}
    ${dLogCard(a)}${noCarCard(a)}
    <div class="card">
      <div class="card-title">申請人操作 <span class="g-tag">G79/G83</span></div>
      ${acts.length ? `<div class="card-desc">${a.status === 'rejected' ? `單位主管已<b>退回修編</b>（審核備註：${a.reviewNote || '—'}）。請修改後重新送出，將重新經單位主管審核。` : rule}</div><div>${acts.join(' ')}</div>`
        : `<div class="card-desc" style="margin-bottom:0;">${endNote || '目前無可執行的操作。'}</div>`}
    </div>
    ${backBar('dd-back')}`;
  renderCargoGrid('#dd-items', a.items, false, null, { hazard: true, emptyText: '無隨行貨物（純載人）。' });
  $('#dd-back').onclick = () => { dApply.view = 'list'; RENDER.d_apply(); };
  const wd = $('#dd-withdraw');
  if (wd) wd.onclick = confirmThen({ title: '確認撤回修改？',
    text: '申請將撤回為<b>申請中</b>，修改後需重新送出，並<b>重新經二級審與調度</b>。' }, () => {
    ModuleD.withdrawToEdit(a, a.applicant);
    toast(`${a.id} 已撤回為申請中，可修改後重新送出`, 'ok'); RENDER.d_apply();
  });
  const ed = $('#dd-edit');
  if (ed) ed.onclick = () => { dApply.editId = a.id; dApply.view = 'new'; RENDER.d_apply(); };
  const ro = $('#dd-ret-ok');
  if (ro) ro.onclick = async () => {
    const o = { date: $('#dd-ret-date').value, time: $('#dd-ret-time').value, reason: $('#dd-ret-reason').value.trim() };
    const ok = await confirmDialog({ title: '確認提出提前歸還？',
      text: `新的結束時間 <b>${o.date} ${o.time}</b><br>送出後需<b>調度確認</b>才生效，確認前原時段仍保留。` });
    if (!ok) return;
    const r = ModuleD.requestEarlyReturn(a, o, a.applicant);
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${a.id} 已提出提前歸還，等待調度確認`, 'ok'); RENDER.d_apply();
  };
  initMasonry(p);
}

/* ---------- 新增畫面（編輯草稿時預帶原內容，送出＝重新送出 G79）---------- */
function dTomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function dCatOptions(cur) {
  const can = ModuleD.canChooseRoutine(DB.currentUser.role);
  return `<option value="general"${cur !== 'routine' ? ' selected' : ''}>一般用車</option>`
    + (can ? `<option value="routine"${cur === 'routine' ? ' selected' : ''}>例行用車</option>` : '');
}
function renderDApplyNew(p) {
  const editing = dApply.editId ? ModuleD.applications.find(x => x.id === dApply.editId && ModuleD.canEdit(x)) : null;
  const t = dTomorrow();
  const gpf = editing ? null : guideTake(dApply); // 申請引導帶入（只用一次）
  const src = editing || Object.assign({ applicant: `${DB.currentUser.unit}-${DB.currentUser.name}`, dept: DB.currentUser.unit, ext: DB.currentUser.ext,
    category: 'general', startDate: t, startTime: '09:00', endDate: t, endTime: '12:00', pax: 1, selfDrive: null, waitDriver: false,
    holidayOT: false, nightOT: false, permits: [], enterTaipei: false, purpose: '', items: [] }, gpf ? gpf.data : {});
  dDraftItems = (src.items || []).map(i => Object.assign({}, i));
  const v = s => String(s == null ? '' : s).replace(/"/g, '&quot;');
  const sd = src.selfDrive;
  const ot = [src.holidayOT ? 'holiday' : '', src.nightOT ? 'night' : ''].filter(Boolean);
  p.innerHTML = `
    <div class="section-h">${editing ? `修改一般用車申請 · ${editing.id}` : '新增一般用車申請單'}</div>
    ${editing ? `<div class="callout info" style="margin-bottom:14px;">${editing.status === 'rejected' ? `此單已<b>退回修編</b>（審核備註：${editing.reviewNote || '—'}）。` : '此單為<b>申請中</b>（暫存／撤回修改），可繼續暫存。'}送出後進入「待二級審」，將<b>重新經單位主管審核與調度</b>（G79）。</div>` : ''}
    <div class="card">
      <div class="card-title">用車申請 <span class="g-tag">G75/G81</span></div>
      ${infoGrid('da-fields', [
        fInput('申請人', `<input type="text" id="da-applicant" value="${v(src.applicant)}">`),
        fInput('部門', `<input type="text" id="da-dept" value="${v(src.dept)}">`),
        fInput('分機', `<input type="text" id="da-ext" value="${v(src.ext)}">`),
        fInput('申請人身分 <span class="hint" title="原型示範用；正式版由登入帶入">示範</span>', `<select id="da-role">${D_ROLES.map(r => `<option${r === DB.currentUser.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`),
        fInput('用車類別 <span class="hint" id="da-cat-hint"></span>', `<select id="da-cat">${dCatOptions(src.category)}</select>`, { w2: true }),
      ].join(''))}
      <div style="font-size:12px;color:var(--ink-soft);font-weight:600;margin:6px 0 4px;">用車起訖（必填；數小時～數個月皆可，不分類別）</div>
      ${infoGrid('da-period', [
        fInput('起 · 日期', `<input type="date" id="da-sdate" value="${v(src.startDate)}">`),
        fInput('起 · 時間', `<input type="time" id="da-stime" value="${v(src.startTime)}">`),
        fInput('迄 · 日期', `<input type="date" id="da-edate" value="${v(src.endDate)}">`),
        fInput('迄 · 時間', `<input type="time" id="da-etime" value="${v(src.endTime)}">`),
      ].join(''))}
      ${infoGrid('da-more', [
        fInput('人數 <span class="hint">至少 1 人</span>', `<input type="number" id="da-pax" min="1" step="1" value="${v(src.pax)}">`),
        fInput('是否自駕 <span class="hint">必填；若只有車沒有司機，選「是」可派車由您自行駕駛（系統不做駕駛資格檢核 G78）</span>', `
          <div class="radio-group">
            <label class="radio-pill${sd === true ? ' sel' : ''}" id="da-sd-yes-pill"><input type="radio" name="da-sd" value="yes"${sd === true ? ' checked' : ''}>是，可自駕</label>
            <label class="radio-pill${sd === false ? ' sel' : ''}" id="da-sd-no-pill"><input type="radio" name="da-sd" value="no"${sd === false ? ' checked' : ''}>否</label>
          </div>`, { stack: true, w2: true }),
        fInput('願意等待駕駛媒合 <span class="hint">選填；即使派車為自駕，出發前仍願意讓調度補派司機（G84）</span>',
          dChecks('da-wait', [['yes', '願意等待駕駛媒合']], src.waitDriver ? ['yes'] : []), { stack: true, full: true }),
        fInput('行程說明 <span class="hint">選填：上車地點／目的地／事由</span>', `<input type="text" id="da-purpose" value="${v(src.purpose)}" placeholder="例：新竹科學園區客戶拜訪（多點洽公）">`, { full: true }),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">派車需求與提示（選填）</div>
      <div class="card-desc"><b>管制區通行證</b>為硬性篩選：調度只會看到<b>同時持有</b>所勾選全部證件的車輛，沒有符合者即無車可派（G85）。其餘僅為提示，不影響派車判斷：進入台北市時提醒調度留意 ${DB.taipeiTonHint} 噸以上車輛（G86）；加班需求供調度排班參考（G87）。</div>
      ${infoGrid('da-needs', [
        fInput('所需管制區通行證 <span class="hint">可複選</span>', dChecks('da-permit', DB.permitTypes.map(x => [x.code, x.name]), src.permits || []), { stack: true }),
        fInput('是否會進入台北市', dChecks('da-tpe', [['yes', '會進入台北市']], src.enterTaipei ? ['yes'] : []), { stack: true }),
        fInput('加班需求', dChecks('da-ot', [['holiday', '假日加班需求'], ['night', '夜間加班需求']], ot), { stack: true }),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>隨行貨物（選填）</span>
        <button class="btn btn-accent btn-sm" id="da-add-item">＋ 新增</button></div>
      <div class="card-desc">有貨才填；欄位比照物流運輸申請（長寬高／重量／件數／品類），並標註<b>是否為危險品</b>（僅供調度判斷派車，系統不自動限制 G78）。人數與貨物各自獨立、不互斥。</div>
      <div id="da-items"></div>
    </div>
    <div style="text-align:center;margin-top:6px;">
      <button class="btn btn-primary" id="da-submit">▶ 送出申請（待二級審）</button>
      ${!editing || editing.status === 'draft' ? '<button class="btn btn-ghost" id="da-draft">💾 暫存（申請中）</button>' : ''}
      <button class="btn btn-ghost" id="da-cancel">取消</button>
    </div>
    ${backBar('dn-back')}`;
  if (gpf) guideBanner(p, gpf, dApply);
  const back = () => {
    if (editing) { dApply.view = 'detail'; dApply.detailId = editing.id; } else dApply.view = 'list';
    dApply.editId = null; RENDER.d_apply();
  };
  $('#dn-back').onclick = back; $('#da-cancel').onclick = back;
  // 類別：例行用車僅特定角色下拉可見（G81）
  const catHint = () => {
    $('#da-cat-hint').textContent = ModuleD.canChooseRoutine(DB.currentUser.role)
      ? '可選「例行用車」：資源尚未分配前享調度優先（G82）' : '「例行用車」僅總經理／部長秘書可見';
  };
  $('#da-role').onchange = () => { DB.currentUser.role = $('#da-role').value; $('#da-cat').innerHTML = dCatOptions($('#da-cat').value); catHint(); };
  catHint();
  // 願意等待駕駛媒合：僅勾選自駕時出現
  const waitItem = $('#da-wait-wrap').closest('.grid-item');
  const syncSd = () => {
    const yes = $('#page-d_apply input[name=da-sd][value=yes]').checked;
    $('#da-sd-yes-pill').classList.toggle('sel', yes);
    $('#da-sd-no-pill').classList.toggle('sel', $('#page-d_apply input[name=da-sd][value=no]').checked);
    waitItem.style.display = yes ? '' : 'none';
    initMasonry(p);
  };
  $$('#page-d_apply input[name=da-sd]').forEach(r => r.onchange = syncSd);
  waitItem.style.display = sd === true ? '' : 'none';
  ['da-wait', 'da-permit', 'da-tpe', 'da-ot'].forEach(n => dWireChecks(p, n));
  // 迄日期不可早於起日期
  const syncEMin = () => { $('#da-edate').min = $('#da-sdate').value || ''; };
  $('#da-sdate').onchange = () => { if ($('#da-edate').value < $('#da-sdate').value) $('#da-edate').value = $('#da-sdate').value; syncEMin(); };
  syncEMin();
  const drawItems = () => {
    renderCargoGrid('#da-items', dDraftItems, true, drawItems, { hazard: true, emptyText: '無隨行貨物（純載人可不填）；有貨請按右上角「新增」。' });
    initMasonry(p);
  };
  $('#da-add-item').onclick = () => openCargoEditor(null, it => { dDraftItems.push(it); drawItems(); }, { hazard: true });
  drawItems();
  const dFormData = () => {
    const sdEl = $('#page-d_apply input[name=da-sd]:checked');
    const ot2 = dChecked(p, 'da-ot');
    const data = {
      category: $('#da-cat').value, role: DB.currentUser.role,
      applicant: $('#da-applicant').value.trim(), dept: $('#da-dept').value.trim(), ext: $('#da-ext').value.trim(),
      startDate: $('#da-sdate').value, startTime: $('#da-stime').value, endDate: $('#da-edate').value, endTime: $('#da-etime').value,
      pax: +$('#da-pax').value, selfDrive: sdEl ? sdEl.value === 'yes' : null,
      waitDriver: dChecked(p, 'da-wait').length > 0, permits: dChecked(p, 'da-permit'), enterTaipei: dChecked(p, 'da-tpe').length > 0,
      holidayOT: ot2.includes('holiday'), nightOT: ot2.includes('night'),
      purpose: $('#da-purpose').value.trim(), items: dDraftItems.map(i => Object.assign({}, i)),
    };
    const errs = ModuleD.validate(data);
    if (errs.length) { toast(errs[0], 'err'); return null; }
    return data;
  };
  const dDraftBtn = $('#da-draft');
  if (dDraftBtn) dDraftBtn.onclick = async () => {
    const data = dFormData(); if (!data) return;
    if (!(await confirmDialog({ title: '確認暫存？', text: '將儲存為「申請中」，尚未送出；之後可於明細頁編輯並送出。' }))) return;
    let app;
    try { app = editing ? ModuleD.saveDraft(editing, data) : ModuleD.createApp(data, { draft: true }); }
    catch (e) { toast(e.message, 'err'); return; }
    if (!editing) guideDrafted(dApply, app.id);
    toast(`${app.id} 已暫存（申請中）`, 'ok');
    dApply.resultIds = null; dApply.editId = null; dApply.view = 'detail'; dApply.detailId = app.id;
    RENDER.d_apply();
  };
  $('#da-submit').onclick = async () => {
    const data = dFormData(); if (!data) return;
    const ok = await confirmDialog({ title: '確認送出用車申請？',
      text: `類別 <b>${ModuleD.CATEGORY[data.category]}</b>｜用車 <b>${dPeriod(data)}</b>｜${data.pax} 人｜自駕：${data.selfDrive ? '是' : '否'}`
        + `${data.permits.length ? `｜通行證 ${data.permits.map(c => ModuleD.permitName(c)).join('＋')}` : ''}`
        + `${data.items.some(i => i.hazardous) ? '｜<b style="color:var(--red);">含危險品</b>' : ''}<br>`
        + '送出後進入<b>待二級審</b>（單位主管審核），通過後由調度確認資源並派車，結果以 Email 通知。' });
    if (!ok) return;
    let app;
    try { app = editing ? ModuleD.resubmit(editing, data) : ModuleD.createApp(data); }
    catch (e) { toast(e.message, 'err'); return; }
    guideSubmitted(editing ? null : dApply, app.id);
    toast(`${app.id} 已送出，待二級審`, 'ok');
    dApply.resultIds = null; dApply.editId = null; dApply.view = 'detail'; dApply.detailId = app.id;
    RENDER.d_apply();
  };
  initMasonry(p);
}
function loadDDemo() {
  const D1 = '2026-08-27', D2 = '2026-08-28';
  const demos = [
    // 一般載人＋少量設備（人貨混合）
    { applicant: '業務部-周雅婷', dept: '業務部', ext: '2201', startDate: D1, startTime: '09:00', endDate: D1, endTime: '12:00', pax: 3, selfDrive: false,
      purpose: '新竹科學園區客戶拜訪（多點洽公）', enterTaipei: true,
      items: [{ name: '展示機台', l: 60, w: 40, h: 45, qty: 1, category: 'FRAG', weight: 18, hazardous: false }] },
    // 多天＋可自駕＋願意等待駕駛媒合＋危險品＋管制區 K
    { applicant: '研發部-吳承恩', dept: '研發部', ext: '4102', startDate: D1, startTime: '13:00', endDate: D2, endTime: '17:00', pax: 2, selfDrive: true,
      waitDriver: true, permits: ['K'], nightOT: true,
      purpose: '台中實驗室設備送修＋隔日會議（壓車人員隨行，需進管制區 K）',
      items: [{ name: '鋰電池模組', l: 40, w: 30, h: 20, qty: 2, category: 'BOX', weight: 12, hazardous: true }] },
    // 純載人
    { applicant: '財務部-鄭安琪', dept: '財務部', ext: '3310', startDate: D2, startTime: '10:00', endDate: D2, endTime: '11:30', pax: 1, selfDrive: false,
      purpose: '銀行送件', items: [] },
    // 例行用車類別（部長秘書申請，長期；與上列時段重疊 → 調度優先提示）
    { category: 'routine', role: '部長秘書', applicant: '總經理室-林秘書', dept: '總經理室', ext: '1001', startDate: D1, startTime: '08:00',
      endDate: '2026-11-30', endTime: '18:00', pax: 2, selfDrive: false, holidayOT: true, permits: ['K', 'P'],
      purpose: '部長公務用車（長期撥用，含假日行程）', items: [] },
  ];
  demos.forEach(d => ModuleD.createApp(d));
  toast('已載入 4 筆用車申請（含 1 筆例行用車，待二級審）', 'ok');
}

/* ============================================================
   模組 D · 單位主管審核（直屬主管）— 獨立單元（先簽核、通過才進調度 G74；兩類別相同）
   ============================================================ */
let dApprove = { view: 'list', detailId: null, query: { applicant: '', status: '' } };

RENDER.d_approve = function () {
  const p = $('#page-d_approve');
  if (dApprove.view === 'detail') return renderDApproveDetail(p, dApprove.detailId);
  return renderDApproveList(p);
};
function dApproveRows() {
  const q = dApprove.query;
  // 申請中（暫存／撤回修改）尚未送出，不列入主管清單
  return ModuleD.applications.filter(a => a.status !== 'draft' &&
    (!q.applicant || a.applicant.includes(q.applicant)) &&
    approveMatch(a, q.status));
}
function renderDApproveList(p) {
  const q = dApprove.query;
  const stOpts = APPROVE_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">單位主管審核（直屬主管）</div>
    <div class="section-sub">用車申請<b>先簽核、通過才進調度</b>（沿用核准者關係表，一般用車與例行用車類別相同，不另加簽）。僅首次申請需簽核；派車後的換車、換司機、展延、提前歸還皆不需簽核。（G74/G83）</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="dap-search">🔍 查詢</button></div>
      ${infoGrid('dap-q-fields', [
        fInput('申請人（模糊）', `<input type="text" id="dap-q-applicant" value="${q.applicant || ''}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('狀態', `<select id="dap-q-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>待簽核 / 已處理申請單</span>
        <button class="btn btn-accent btn-sm" id="dap-approve-all">✓ 全部核准</button>
      </div>
      <div id="dap-grid"></div>
    </div>`;
  $('#dap-search').onclick = () => {
    dApprove.query = { applicant: $('#dap-q-applicant').value.trim(), status: $('#dap-q-status').value };
    renderDApproveGrid(); toast('查詢完成', 'ok');
  };
  $('#dap-approve-all').onclick = confirmThen({ title: '確認全部核准？', text: '確認後將核准目前清單中所有「待簽核」用車申請，並進入調度。' }, () => {
    const subs = dApproveRows().filter(a => a.status === 'submitted');
    subs.forEach(a => ModuleD.approve(a));
    toast(`已核准 ${subs.length} 筆`, 'ok');
    renderDApproveGrid(); renderDaList();
  });
  renderDApproveGrid();
  initMasonry(p);
}
function renderDApproveGrid() {
  if (!$('#dap-grid')) return;
  const rows = dApproveRows();
  $('#dap-grid').innerHTML = rows.length === 0 ? `<div class="empty">查無符合條件的申請單。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>類別</th><th>申請人</th><th>簽核主管</th><th>用車時段</th><th>人</th><th>自駕</th><th>隨行貨物</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-dvdetail="${a.id}">細節</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${dCatBadge(a)}</td><td>${a.applicant}</td><td>${ModuleD.approverOf(a)}</td>
        <td>${dPeriodShort(a)}</td><td>${a.pax}</td><td>${a.selfDrive ? '是' : '否'}</td>
        <td>${dCargoSummary(a)}</td><td>${Flow.badge(a)}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('#dap-grid [data-dvdetail]').forEach(b => b.onclick = () => { dApprove.detailId = b.dataset.dvdetail; dApprove.view = 'detail'; RENDER.d_approve(); });
}
function renderDApproveDetail(p, id) {
  const a = ModuleD.applications.find(x => x.id === id);
  if (!a) { dApprove.view = 'list'; return RENDER.d_approve(); }
  const pending = a.status === 'submitted';
  p.innerHTML = `
    <div class="section-h">用車簽核 · ${a.id}</div>
    ${dHazardCallout(a)}
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span><span>${dCatBadge(a)} ${Flow.badge(a)}</span></div>
      ${infoGrid('dap-basic', [
        fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
        fItem('申請人', `${a.applicant}${a.dept ? `（${a.dept}/${a.ext}）` : ''}`),
        fItem('簽核主管', ModuleD.approverOf(a)),
        fItem('用車類別', ModuleD.CATEGORY[a.category]),
        fItem('用車時段', dPeriod(a), { w2: true }),
        fItem('人數', `${a.pax} 人`),
        fItem('是否自駕', a.selfDrive ? '是' : '否'),
        fItem('需求標記', dNeedTags(a), { w2: true }),
        fItem('行程說明', a.purpose || '<span class="muted">—</span>', { full: true, tall: true }),
        a.reviewNote ? fItem('審核備註', a.reviewNote, { full: true }) : '',
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">隨行貨物</div>
      <div id="dap-items"></div>
    </div>
    ${pending ? `
    <div class="card">
      <div class="card-title">單位主管審核 <span class="g-tag">G74</span></div>
      ${infoGrid('dsv-fields', [
        fInput('是否同意', `
          <div class="radio-group">
            <label class="radio-pill sel" id="dsv-yes-pill"><input type="radio" name="dsv-agree" value="yes" checked>同意</label>
            <label class="radio-pill" id="dsv-no-pill"><input type="radio" name="dsv-agree" value="no">退回修編</label>
          </div>`, { stack: true, full: true }),
        fInput('審核備註 <span class="hint" id="dsv-req" style="display:none;color:#c0392b;">（退回修編時必填）</span>', `<input type="text" id="dsv-note" placeholder="請輸入審核意見（退回修編時必填）">`, { full: true }),
      ].join(''))}
      <div style="text-align:center;margin-top:22px;">
        <button class="btn btn-primary" id="dsv-submit">▶ 送出</button>
        <button class="btn btn-ghost" id="dsv-cancel">取消</button>
      </div>
    </div>` : backBar('dsv-back')}`;
  renderCargoGrid('#dap-items', a.items, false, null, { hazard: true, emptyText: '無隨行貨物（純載人）。' });
  if (pending) {
    $$('#page-d_approve input[name=dsv-agree]').forEach(r => r.onchange = () => {
      const no = $('#page-d_approve input[name=dsv-agree][value=no]').checked;
      $('#dsv-yes-pill').classList.toggle('sel', !no);
      $('#dsv-no-pill').classList.toggle('sel', no);
      $('#dsv-req').style.display = no ? 'inline' : 'none';
    });
    $('#dsv-submit').onclick = async () => {
      const agree = $('#page-d_approve input[name=dsv-agree]:checked').value === 'yes';
      const note = $('#dsv-note').value.trim();
      if (!agree && !note) { toast('退回修編時「審核備註」為必填', 'err'); $('#dsv-note').focus(); return; }
      const ok = await confirmDialog({ title: agree ? '確認核准？' : '確認退回修編？',
        text: agree ? '核准後此申請將進入調度，由調度人工確認資源並派車。' : '申請人會看到「退回修編」，可修改後重新送出，並重新經單位主管審核。' });
      if (!ok) return;
      if (agree) { ModuleD.approve(a, note); toast(`${a.id} 已核准，進入調度`, 'ok'); }
      else { ModuleD.reject(a, note); toast(`${a.id} 已退回修編，申請人可修改後重新送出`, 'err'); }
      dApprove.view = 'list'; RENDER.d_approve(); renderDaList();
    };
    $('#dsv-cancel').onclick = () => { dApprove.view = 'list'; RENDER.d_approve(); };
  } else {
    $('#dsv-back').onclick = () => { dApprove.view = 'list'; RENDER.d_approve(); };
  }
  initMasonry(p);
}

/* ============================================================
   模組 D · 派車調度（業務單位）— 人工確認共用資源池＋派車判斷矩陣＋生命週期操作（G71–G89）
   ============================================================ */
let dReview = { view: 'list', detailId: null, query: { status: 'work', date: '' } };
// 調度清單：二級審通過後的單（待調度、無車退回、調度主管審、待出車、已出車、已回登）
const dInReviewPool = a => ['approved', 'dispatched', 'noVehicle'].includes(a.status);
const dTodo = a => a.status === 'approved' || !!a.pendingReturn;

RENDER.d_review = function () {
  const p = $('#page-d_review');
  if (dReview.view === 'detail') return renderDReviewDetail(p, dReview.detailId);
  return renderDReviewList(p);
};
function renderDReviewList(p) {
  const q = dReview.query;
  const stOpts = [['work', '待處理（待調度／提前歸還待確認）'], ['', '全部狀態']].concat(
    ['todo', 'noCar', 'signing', 'ready', 'departed', 'logged'].map(k => [k, Flow.label(k)]))
    .map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">派車調度（業務單位）</div>
    <div class="section-sub">單位主管審核通過的申請，由調度<b>人工確認</b>共用商務車輛／司機池是否可用（保修、請假、差旅共乘作業與其他用車佔用一併列出，先佔先贏），依<b>派車判斷矩陣</b>做出最終判斷，不進候補。<b>例行用車</b>類別在資源尚未分配前優先（排在清單最前），已生效的佔用不溯及。派車後的換車、換司機（含補派、雙駕駛）、展延由調度直接處理，提前歸還由使用者提出、調度確認後生效。其他申請單撤銷使駕駛閒置時，可按<b>「替補自駕駕駛」</b>替被迫自駕（願意等待駕駛媒合）的已派車單補派司機。</div>
    <div style="margin:-4px 0 14px;"><button class="btn btn-ghost btn-sm" id="dr-goto-driver">🧑‍✈️ 查看司機任務單</button></div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="drq-search">🔍 查詢</button></div>
      ${infoGrid('drq-fields', [
        fInput('狀態', `<select id="drq-status">${stOpts}</select>`, { w2: true }),
        fInput('用車日期 <span class="hint">落在起訖期間內</span>', `<input type="date" id="drq-date" value="${q.date || ''}">`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>調度清單</span>
        <span><span class="muted" id="drq-count"></span>
          <button class="btn btn-accent btn-sm" id="dr-backfill" style="margin-left:10px;" title="駕駛閒置時，替被迫自駕且願意等待駕駛媒合的已派車單補派司機（G116）">🔄 替補自駕駕駛${(() => { const n = ModuleD.selfDriveBackfillTargets().length; return n ? `（${n}）` : ''; })()}</button></span></div>
      <div id="drq-grid"></div>
    </div>`;
  $('#dr-goto-driver').onclick = () => goto('d_driver');
  // 替補自駕駕駛（G116）：其他申請單撤銷使駕駛閒置 → 替被迫自駕（願意等待駕駛媒合）的已派車單補派司機
  $('#dr-backfill').onclick = async () => {
    const targets = ModuleD.selfDriveBackfillTargets();
    if (!targets.length) { toast('目前沒有需要替補駕駛的自駕單（須已派車生效、被迫自駕且願意等待駕駛媒合）', 'err'); return; }
    const ok = await confirmDialog({ title: '確認替補自駕駕駛？',
      text: `將替 <b>${targets.length}</b> 筆被迫自駕的申請單（${targets.map(a => a.id).join('、')}）尋找剩餘用車時段內<b>閒置的駕駛</b>補派（<b>優先與車輛同一據點</b>的駕駛），立即生效並通知申請人（例行用車優先）。` });
    if (!ok) return;
    const r = ModuleD.backfillSelfDrive('調度室');
    openModal('替補自駕駕駛結果', `
      ${r.filled.length ? `<div class="result ok"><div class="r-head">✓ 已補派 ${r.filled.length} 筆</div>
        ${r.filled.map(x => `<div>${x.app.id}｜${x.app.applicant}｜${x.from} 起由 <b>${x.driver.name}</b> 駕駛（車 ${x.app.vehicle}）
          ${x.sameSite ? `<span class="badge b-green">同據點 ${siteNm(x.site)}</span>` : `<span class="badge b-amber">跨據點：駕駛在 ${siteNm(x.driverSite)}、車在 ${siteNm(x.site)}</span>`}</div>`).join('')}</div>` : ''}
      ${r.skipped.length ? `<div class="result fail" style="margin-top:10px;"><div class="r-head">✗ 未補派 ${r.skipped.length} 筆</div>
        ${r.skipped.map(x => `<div>${x.app.id}｜${x.app.applicant}｜${x.reason}</div>`).join('')}</div>` : ''}`);
    toast(r.filled.length ? `已替補 ${r.filled.length} 筆自駕單的駕駛` : '沒有閒置駕駛可替補', r.filled.length ? 'ok' : 'err');
    renderDReviewList(p); renderDaList();
  };
  $('#drq-search').onclick = () => {
    dReview.query = { status: $('#drq-status').value, date: $('#drq-date').value };
    renderDReviewGrid(); toast('查詢完成', 'ok');
  };
  renderDReviewGrid();
  initMasonry(p);
}
function renderDReviewGrid() {
  if (!$('#drq-grid')) return;
  const q = dReview.query;
  const rows = ModuleD.reviewOrder(ModuleD.applications.filter(a => dInReviewPool(a) &&
    (!q.status || (q.status === 'work' ? dTodo(a) : Flow.of(a) === q.status)) &&
    (!q.date || (a.startDate <= q.date && q.date <= a.endDate))));
  $('#drq-count').textContent = `${rows.length} 筆`;
  $('#drq-grid').innerHTML = rows.length === 0
    ? `<div class="empty"><div class="big">🔍</div>查無符合條件的申請。單位主管審核通過後即會出現在「待處理」。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>類別</th><th>申請人</th><th>用車時段</th><th>人</th><th>自駕</th><th>需求標記</th><th>狀態</th><th>派車結果</th><th>車輛</th><th>司機</th></tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-drdetail="${a.id}">${a.status === 'approved' ? '調度' : (a.pendingReturn ? '處理' : '細節')}</button></td>
        <td><b style="color:var(--navy);">${a.id}</b></td><td>${dCatBadge(a)}</td><td>${a.applicant}</td>
        <td>${dPeriodShort(a)}</td><td>${a.pax}</td><td>${a.selfDrive ? '是' : '否'}</td>
        <td style="text-align:left;">${dNeedTags(a)}</td><td>${dStatusCell(a)}</td><td>${dOutcomeBadge(a)}</td>
        <td>${a.vehicle || '<span class="muted">—</span>'}</td>
        <td>${a.vehicle ? (a.drivers.length ? dDrvList(a.drivers) : '自駕') : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('#drq-grid [data-drdetail]').forEach(b => b.onclick = () => { dReview.detailId = b.dataset.drdetail; dReview.view = 'detail'; RENDER.d_review(); });
}
// 派車判斷矩陣（G76）：標示本單所在儲存格（車輛狀態 × 是否自駕）
function renderDMatrix(state, selfDrive) {
  const rows = [['withDriver', '有車有司機'], ['vehicleOnly', '有車沒司機'], ['none', '沒車（含通行證交集為空）']];
  const cell = (st, sd) => {
    const o = ModuleD.matrixOutcome(st, sd);
    const txt = { withDriver: '派車＋派司機', selfDrive: '派車（使用者自行駕駛）', noVehicle: '告知無車可派' }[o];
    const hit = st === state && sd === selfDrive;
    return `<td style="font-weight:700;color:${o === 'noVehicle' ? 'var(--red)' : 'var(--green)'};`
      + `${hit ? 'outline:2px solid var(--accent);outline-offset:-2px;' : ''}">${txt}${hit ? ' <span class="badge b-amber">本單</span>' : ''}</td>`;
  };
  return `<div class="table-wrap"><table class="dt"><thead><tr><th>車輛狀態</th>
      <th>使用者勾選自駕${selfDrive ? ' ✓' : ''}</th><th>使用者未勾選自駕${selfDrive ? '' : ' ✓'}</th></tr></thead><tbody>
    ${rows.map(([st, label]) => `<tr><td><b>${label}</b>${st === state ? ' <span class="hint">← 目前資源狀態</span>' : ''}</td>${cell(st, true)}${cell(st, false)}</tr>`).join('')}
  </tbody></table></div>`;
}
const dBusyBadge = b => !b ? '<span class="badge b-green">可用</span>'
  : `<span class="badge ${['C', 'D'].includes(b.type) ? 'b-amber' : 'b-red'}">${b.text}</span>`;
// 資源表：車輛（座位／噸位／通行證）與司機（剩餘可加班工時，即時查詢加班系統 G87）
function dResourceTables(a, res) {
  const tonHot = v => a.enterTaipei && v.tons >= DB.taipeiTonHint;
  const otAt = new Date();
  return `
    ${res.excluded.length ? `<div class="callout" style="margin-bottom:10px;">🛂 已依管制區通行證（${a.permits.map(c => ModuleD.permitName(c)).join('＋')}）<b>交集篩選</b>：未同時持有的 ${res.excluded.map(v => v.id).join('、')} 不列入可選（G85）。</div>` : ''}
    <div class="grid-2" style="gap:16px;">
      <div class="table-wrap"><table class="dt"><thead><tr><th>車輛</th><th>座位</th><th>噸位</th><th>通行證</th><th>狀態</th></tr></thead><tbody>
        ${res.vehicles.length ? res.vehicles.map(({ v, busy }) => `<tr><td style="white-space:nowrap;"><b style="color:var(--navy);">${v.id}</b><br><span class="muted" style="font-size:12px;">${v.name}</span></td><td>${v.seats} 座</td>
          <td>${tonHot(v) ? `<span class="badge b-amber">${v.tons} 噸 ⚠</span>` : `${v.tons} 噸`}</td>
          <td>${(v.permits || []).length ? v.permits.join('、') : '<span class="muted">—</span>'}</td><td style="text-align:left;">${dBusyBadge(busy)}</td></tr>`).join('')
          : '<tr><td colspan="5" class="muted" style="text-align:center;">沒有同時持有所需通行證的車輛 → 無車可派</td></tr>'}
      </tbody></table></div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>司機</th><th>位置</th><th>剩餘可加班工時</th><th>狀態</th></tr></thead><tbody>
        ${res.drivers.map(({ d, busy }) => { const ot = ModuleD.queryOvertime(d.id);
          return `<tr><td><b>${d.name}</b>（${d.id}）</td><td>${d.currentSite}</td>
            <td>${ot.hours == null ? '<span class="muted">查無</span>' : `<b style="color:${ot.hours < 4 ? 'var(--red)' : 'var(--navy)'};">${ot.hours} 小時</b>`}</td>
            <td style="text-align:left;">${dBusyBadge(busy)}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="muted" style="font-size:12px;margin-top:6px;">剩餘可加班工時：${pad2(otAt.getHours())}:${pad2(otAt.getMinutes())}:${pad2(otAt.getSeconds())} 即時查詢加班系統（依勞基法計算，僅供參考，不據以擋派車）。</div></div>
    </div>`;
}
// 調度提示（不篩選 G82/G86/G87）
function dHintsHtml(a) {
  const out = [];
  if (a.category === 'routine') out.push('<div class="callout info" style="margin-bottom:10px;">★ <b>例行用車</b>：資源尚未確定分配前請<b>優先安排</b>；已被其他申請確定佔用的資源不溯及（G82）。</div>');
  const peers = ModuleD.priorityPeers(a);
  if (peers.length && a.status === 'approved') out.push(`<div class="callout" style="margin-bottom:10px;">★ 同時段有<b>例行用車</b> ${peers.map(x => x.id).join('、')} 尚待調度：資源請優先分配給例行用車，再處理本單（G82）。</div>`);
  if (a.enterTaipei) {
    const heavy = DB.vehicles.filter(v => v.pool === 'BIZ' && v.tons >= DB.taipeiTonHint).map(v => `${v.id}（${v.tons} 噸）`);
    out.push(`<div class="callout" style="margin-bottom:10px;">🏙 本趟會<b>進入台北市</b>：請留意 ${DB.taipeiTonHint} 噸以上車輛可能需要特殊通行證${heavy.length ? `（${heavy.join('、')}）` : ''}。僅提示、不篩選，請自行確認（G86）。</div>`);
  }
  if (a.holidayOT || a.nightOT) out.push(`<div class="callout" style="margin-bottom:10px;">🕘 申請人勾選${[a.holidayOT ? '<b>假日加班</b>' : '', a.nightOT ? '<b>夜間加班</b>' : ''].filter(Boolean).join('、')}需求：請參考下方司機剩餘可加班工時安排（僅提示 G87）。</div>`);
  if (a.waitDriver) out.push('<div class="callout info" style="margin-bottom:10px;">申請人勾選<b>願意等待駕駛媒合</b>：若本次判定為自駕出車，出發前空出司機時可由「補派司機」加入（G84）。</div>');
  return dHazardCallout(a) + out.join('');
}
function dDriverOpts(free, cur, emptyLabel) {
  return `<option value="">${emptyLabel}</option>` + free.map(({ d }) => `<option value="${d.id}"${d.id === cur ? ' selected' : ''}>${d.name}（${d.id}）</option>`).join('');
}
function renderDReviewDetail(p, id) {
  const a = ModuleD.applications.find(x => x.id === id);
  if (!a) { dReview.view = 'list'; return RENDER.d_review(); }
  const pending = a.status === 'approved', live = a.status === 'dispatched' && Signoff.effective(a); // 生命週期操作須簽審通過
  let body = '';
  if (pending) {
    const res = ModuleD.resources(a), state = ModuleD.resourceState(a);
    const freeV = res.vehicles.filter(x => !x.busy), freeD = res.drivers.filter(x => !x.busy);
    const vOpts = freeV.length
      ? ['<option value="">請選擇車輛</option>'].concat(freeV.map(({ v }) => `<option value="${v.id}">${v.id}（${v.name}｜${v.seats} 座｜${v.tons} 噸）</option>`)).join('')
      : '<option value="">（此時段無可用車輛）</option>';
    body = `
    <div class="card">
      <div class="card-title">資源可用性 · 共用商務池 <span class="g-tag">G71/G72/G85</span></div>
      <div class="card-desc">用車時段 <b>${dPeriod(a)}</b>。差旅共乘作業與一般用車申請作業共用同一批車輛／司機，<b>先佔先贏</b>：與差旅共乘以「日」為佔用單位，一般用車之間依指派區間的實際時段判斷；保修（G60）與請假（G61）同樣排除。</div>
      ${dResourceTables(a, res)}
    </div>
    <div class="card">
      <div class="card-title">派車判斷 <span class="g-tag">G76/G77/G84</span></div>
      <div class="card-desc">依「車輛狀態 × 是否自駕」判斷，<b>不進候補</b>：無車可派即告知申請人、不保留資源。車型由調度依人數（${a.pax} 人）與隨行貨物人工指派。預設單司機，可視需要<b>加派第二位司機（雙駕駛）</b>。</div>
      ${renderDMatrix(state, a.selfDrive)}
      <div style="margin-top:14px;"></div>
      ${infoGrid('dr-fields', [
        fInput('派車車輛', `<select id="dr-veh">${vOpts}</select>`),
        fInput('派車司機', `<select id="dr-drv">${dDriverOpts(freeD, '', freeD.length ? '請選擇司機' : `（此時段無可派司機${a.selfDrive ? '，使用者可自駕' : ''}）`)}</select>`),
        fInput('第二位司機 <span class="hint">選填・雙駕駛</span>', `<select id="dr-drv2">${dDriverOpts(freeD, '', '（不加派）')}</select>`),
        fInput('調度人員', `<input type="text" id="dr-by" value="調度室-值班人員">`),
        fInput('調度備註（選填）', `<input type="text" id="dr-note" placeholder="例：含危險品改派廂型車／無合適車型">`, { w2: true }),
      ].join(''))}
      <div id="dr-preview" class="callout info" style="margin-top:10px;"></div>
      <div style="text-align:center;margin-top:16px;">
        <button class="btn btn-primary" id="dr-ok">▶ 確認派車判斷</button>
        <button class="btn btn-ghost" id="dr-none" style="color:var(--red);">↩ 無車退回</button>
      </div>
    </div>`;
  } else {
    const pr = a.pendingReturn;
    const canSupplement = live && a.waitDriver && a.drivers.length === 0;
    body = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車結果</span>${dOutcomeBadge(a)}</div>
      ${infoGrid('dr-result', [
        fItem('派車單號', a.dispatchNo && a.outcome !== 'noVehicle' ? `<b style="color:var(--navy);">${a.dispatchNo}</b>` : '<span class="muted">—</span>'),
        fItem('目前車輛', a.vehicle ? dVehName(a.vehicle) : '<span class="muted">—</span>'),
        fItem('目前司機', dDriversText(a), { w2: true }),
        fItem('調度完成確認', a.dispatchedAt ? `${fmtTime(a.dispatchedAt)}（${a.dispatchedBy}）` : '<span class="muted">未確認（調度前已撤回）</span>'),
        fItem('調度備註', a.dispatchNote || '<span class="muted">—</span>', { w2: true }),
        a.releasedAt ? fItem('資源釋放', `${fmtTime(a.releasedAt)}（提前歸還確認）`) : '',
      ].join(''))}
    </div>
    ${a.status !== 'approved' && Signoff.isPending(a) ? `<div class="callout" style="margin-bottom:14px;">此派車判斷<b>調度主管審</b>中（D｜運輸主管簽審）：簽審通過才生效並寄送通知；被退回時會回到「已核准待調度」重新判斷。</div>` : ''}
    ${live && pr ? `<div class="card">
      <div class="card-title">提前歸還待確認 <span class="g-tag">G83</span></div>
      <div class="callout" style="margin-bottom:12px;">申請人於 ${fmtTime(pr.at)} 提出：結束時間 <b>${a.endDate} ${a.endTime}</b> → <b>${pr.date} ${pr.time}</b>${pr.reason ? `（${pr.reason}）` : ''}${ModuleD.absMin(pr.date, pr.time) === ModuleD.span(a).start ? '｜<b>整段不用車</b>' : ''}。確認後立即生效並釋放之後時段的車輛／司機。</div>
      ${infoGrid('dr-ret', [fInput('調度備註（退回時建議填寫）', `<input type="text" id="dr-ret-note" placeholder="例：車輛仍需於原時段使用">`, { full: true })].join(''))}
      <div style="margin-top:10px;"><button class="btn btn-primary" id="dr-ret-ok">✓ 確認提前歸還</button>
        <button class="btn btn-ghost" id="dr-ret-no">退回</button></div>
    </div>` : ''}
    ${live ? `<div class="card">
      <div class="card-title">生命週期操作（調度）<span class="g-tag">G83/G84</span></div>
      <div class="card-desc">使用者以電話等系統外管道聯繫後，由調度在系統<b>直接操作、立即生效、不需簽核</b>，並自動 Email 通知申請人。換車／換司機為<b>瞬間切換</b>（生效時點起新資源），每次新增一筆指派區間、保留完整歷史。</div>
      <div>
        <button class="btn btn-primary" id="dr-reassign">🔁 換車／換司機</button>
        ${canSupplement ? '<button class="btn btn-accent" id="dr-supplement">＋ 補派司機</button>' : ''}
        <button class="btn btn-ghost" id="dr-extend">⏩ 展延</button>
      </div>
      ${a.selfDrive && !a.waitDriver && a.drivers.length === 0 ? '<div class="muted" style="font-size:12px;margin-top:8px;">申請人未勾選「願意等待駕駛媒合」，自駕單不提供補派司機。</div>' : ''}
    </div>` : ''}
    ${a.segs.length ? `<div class="card"><div class="card-title">指派區間歷史 <span class="g-tag">G88</span></div>${dSegTable(a)}</div>` : ''}
    <div class="card"><div class="card-title">通知紀錄</div>${dMailTable(a)}</div>
    ${dLogCard(a)}`;
  }
  p.innerHTML = `
    <div class="section-h">${pending ? '派車調度' : '調度明細'} · ${a.id}</div>
    ${dHintsHtml(a)}
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>申請內容</span><span>${dCatBadge(a)} ${dStatusCell(a)}</span></div>
      ${infoGrid('dr-basic', [
        fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
        fItem('申請人', `${a.applicant}${a.dept ? `（${a.dept}/${a.ext}）` : ''}`),
        fItem('簽核', `${ModuleD.approverOf(a)} 核准${a.reviewNote ? '｜' + a.reviewNote : ''}`),
        fItem('用車時段', dPeriod(a), { w2: true }),
        fItem('人數', `${a.pax} 人`),
        fItem('是否自駕', a.selfDrive ? `是${a.waitDriver ? '（願意等待駕駛媒合）' : ''}` : '否'),
        fItem('需求標記', dNeedTags(a), { w2: true }),
        fItem('行程說明', a.purpose || '<span class="muted">—</span>', { full: true, tall: true }),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">隨行貨物</div>
      <div id="dr-items"></div>
    </div>
    ${body}
    ${backBar('dr-back')}`;
  renderCargoGrid('#dr-items', a.items, false, null, { hazard: true, emptyText: '無隨行貨物（純載人）。' });
  $('#dr-back').onclick = () => { dReview.view = 'list'; RENDER.d_review(); };
  const rerender = () => { RENDER.d_review(); renderDaList(); };
  if (pending) {
    const sel = () => ({ vehicle: $('#dr-veh').value, drivers: [$('#dr-drv').value, $('#dr-drv2').value].filter(Boolean) });
    const preview = () => {
      const box = $('#dr-preview');
      if (!ModuleD.resources(a).vehicles.some(x => !x.busy)) {
        box.className = 'callout'; $('#dr-ok').disabled = true;
        box.innerHTML = '此時段<b>沒車</b>（或無車同時持有所需通行證）→ 依判斷矩陣應<b>無車退回</b>，請按「無車退回」。';
        return;
      }
      if (!$('#dr-drv').value && $('#dr-drv2').value) { box.className = 'callout'; box.innerHTML = '⚠ 請先選第一位司機，再加派第二位。'; $('#dr-ok').disabled = true; return; }
      const r = ModuleD.decide(a, sel());
      if (r.error) { box.className = 'callout'; box.innerHTML = `⚠ ${r.error}`; $('#dr-ok').disabled = true; return; }
      $('#dr-ok').disabled = false;
      box.className = r.outcome === 'noVehicle' ? 'callout' : 'callout info';
      box.innerHTML = `判斷結果：<b>${ModuleD.OUTCOME_TEXT[r.outcome]}</b>` + (r.outcome === 'noVehicle'
        ? '（有車沒司機、使用者未勾自駕 → 告知無車可派，不進候補、不佔用資源）'
        : `｜車輛 ${dVehName(r.vehicle)}｜${r.drivers.length ? '司機 ' + dDrvList(r.drivers) + (r.drivers.length === 2 ? '（雙駕駛）' : '') : '使用者自行駕駛'}`);
    };
    ['dr-veh', 'dr-drv', 'dr-drv2'].forEach(x => { $('#' + x).onchange = preview; });
    preview();
    const finish = (out) => {
      if (!out.ok) { toast(out.error, 'err'); return; }
      toast(`${a.id}｜${ModuleD.OUTCOME_TEXT[out.outcome]}，已送運輸主管簽審（通過後才生效並通知申請人）`, 'ok');
      rerender();
    };
    $('#dr-ok').onclick = async () => {
      const r = ModuleD.decide(a, sel());
      if (r.error) { toast(r.error, 'err'); return; }
      const peers = ModuleD.priorityPeers(a);
      const ok = await confirmDialog({ title: '確認派車判斷？',
        text: `結果：<b>${ModuleD.OUTCOME_TEXT[r.outcome]}</b>${peers.length ? `<br>★ 同時段尚有例行用車 ${peers.map(x => x.id).join('、')} 待調度，請確認已優先分配。` : ''}<br>確認後送<b>運輸主管簽審</b>，簽審通過才生效並 Email 通知申請人；之後異動改用換車／換司機／展延／提前歸還（G83）。` });
      if (!ok) return;
      finish(ModuleD.dispatch(a, sel(), $('#dr-by').value.trim(), $('#dr-note').value.trim()));
    };
    $('#dr-none').onclick = async () => {
      const ok = await confirmDialog({ title: '確認無車退回？',
        text: '此申請將<b>無車退回</b>（結案，不進候補、不佔用資源、不送簽審），並立即 Email 通知申請人；調度備註即退回原因。' });
      if (!ok) return;
      finish(ModuleD.dispatch(a, { noVehicle: true }, $('#dr-by').value.trim(), $('#dr-note').value.trim()));
    };
  } else if (live) {
    const ro = $('#dr-ret-ok');
    if (ro) ro.onclick = confirmThen({ title: '確認提前歸還？', text: '確認後新的結束時間立即生效，之後時段的車輛／司機釋放回共用資源池，並 Email 通知申請人。' }, () => {
      const r = ModuleD.confirmEarlyReturn(a, '調度室', $('#dr-ret-note').value.trim());
      if (!r.ok) { toast(r.error, 'err'); return; }
      toast(`${a.id} 提前歸還已生效，之後時段資源已釋放`, 'ok'); rerender();
    });
    const rn = $('#dr-ret-no');
    if (rn) rn.onclick = confirmThen({ title: '退回提前歸還？', text: '維持原結束時間，並 Email 通知申請人。' }, () => {
      ModuleD.rejectEarlyReturn(a, '調度室', $('#dr-ret-note').value.trim()); toast(`${a.id} 已退回提前歸還申請`); rerender();
    });
    $('#dr-reassign').onclick = () => openDReassign(a, false, rerender);
    const sp2 = $('#dr-supplement');
    if (sp2) sp2.onclick = () => openDReassign(a, true, rerender);
    $('#dr-extend').onclick = () => openDExtend(a, rerender);
  }
  initMasonry(p);
}
// 換車／換司機（補派司機為其特例：0 位司機 → 有司機）彈窗：選生效時點後，依「生效～結束」重新檢查可用資源
function openDReassign(a, supplement, done) {
  const last = ModuleD.lastSeg(a), sp = ModuleD.span(a);
  const def = ModuleD.fromAbs(Math.min(Math.max(last.from, dNowAbs()), sp.end - 1));
  openModal(supplement ? `補派司機 · ${a.id}` : `換車／換司機 · ${a.id}`, `
    <div class="card-desc">${supplement
      ? '使用者勾選「願意等待駕駛媒合」：出發前空出司機時，可把司機加入這張自駕派車單（歸類為換司機，保留區間歷史 G84）。'
      : '生效時點起改用新的車輛／司機，前一刻止為原指派（瞬間切換、不設交接重疊）。雙駕駛可單獨更換其中一位，或加派／減派第二位。'}
      目前：<b>${dVehName(last.vehicle)}</b>｜${last.drivers.length ? dDrvList(last.drivers) : '使用者自駕'}（${ModuleD.fmtAbs(last.from)} 起）</div>
    ${infoGrid('rsg-fields', [
      fInput('生效日期', `<input type="date" id="rsg-date" value="${def.date}" min="${ModuleD.fromAbs(last.from).date}" max="${a.endDate}">`),
      fInput('生效時間', `<input type="time" id="rsg-time" value="${def.time}">`),
      fInput('車輛', `<select id="rsg-veh"></select>`, { full: true }),
      fInput('司機', `<select id="rsg-d1"></select>`),
      fInput('第二位司機 <span class="hint">雙駕駛</span>', `<select id="rsg-d2"></select>`),
      fInput('原因', `<input type="text" id="rsg-reason" placeholder="${supplement ? '例：出發前空出駕駛' : '例：車輛維護／司機請假'}">`, { full: true }),
      fInput('調度人員', `<input type="text" id="rsg-by" value="調度室-值班人員">`, { full: true }),
    ].join(''))}
    <div id="rsg-preview" class="callout info" style="margin-top:8px;"></div>
    <div style="text-align:center;margin-top:16px;">
      <button class="btn btn-primary" id="rsg-ok">▶ 確認${supplement ? '補派' : '變更'}</button>
      <button class="btn btn-ghost" id="rsg-cancel">取消</button>
    </div>`);
  const fill = () => {
    const d = $('#rsg-date').value, t = $('#rsg-time').value;
    if (!d || !t) return;
    const res = ModuleD.resources(a, { start: ModuleD.absMin(d, t), end: sp.end });
    const keepV = $('#rsg-veh').value || last.vehicle;
    $('#rsg-veh').innerHTML = res.vehicles.map(({ v, busy }) => { const cur = v.id === last.vehicle;
      return `<option value="${v.id}"${v.id === keepV ? ' selected' : ''}${busy && !cur ? ' disabled' : ''}>${v.id}（${v.name}｜${v.seats} 座）${cur ? '｜目前' : (busy ? `｜⚠ ${busy.text}` : '')}</option>`; }).join('');
    const free = res.drivers.filter(x => !x.busy || last.drivers.includes(x.d.id));
    const opt = (cur, empty) => `<option value="">${empty}</option>` + free.map(({ d: dr }) =>
      `<option value="${dr.id}"${dr.id === cur ? ' selected' : ''}>${dr.name}（${dr.id}）${last.drivers.includes(dr.id) ? '｜目前' : ''}</option>`).join('');
    const c1 = $('#rsg-d1').dataset.v != null ? $('#rsg-d1').value : (last.drivers[0] || '');
    const c2 = $('#rsg-d2').dataset.v != null ? $('#rsg-d2').value : (last.drivers[1] || '');
    $('#rsg-d1').innerHTML = opt(c1, a.selfDrive ? '（無，使用者自駕）' : '請選擇司機');
    $('#rsg-d2').innerHTML = opt(c2, '（不加派）');
    $('#rsg-d1').dataset.v = '1'; $('#rsg-d2').dataset.v = '1';
    preview();
  };
  const sel = () => ({ date: $('#rsg-date').value, time: $('#rsg-time').value, vehicle: $('#rsg-veh').value,
    drivers: [$('#rsg-d1').value, $('#rsg-d2').value].filter(Boolean), reason: $('#rsg-reason').value.trim(), by: $('#rsg-by').value.trim() });
  const preview = () => {
    const s = sel(), box = $('#rsg-preview');
    const chg = [];
    if (s.vehicle !== last.vehicle) chg.push(`車輛 ${last.vehicle} → <b>${s.vehicle}</b>`);
    const before = last.drivers.length ? dDrvList(last.drivers) : '自駕', after = s.drivers.length ? dDrvList(s.drivers) : '自駕';
    if (before !== after) chg.push(`司機 ${before} → <b>${after}</b>`);
    box.innerHTML = chg.length ? `${s.date} ${s.time} 起：${chg.join('；')}` : '尚未變更車輛或司機。';
  };
  $('#rsg-date').onchange = fill; $('#rsg-time').onchange = fill;
  $('#rsg-veh').onchange = preview; $('#rsg-d1').onchange = preview; $('#rsg-d2').onchange = preview;
  $('#rsg-cancel').onclick = closeModal;
  fill();
  $('#rsg-ok').onclick = async () => {
    const s = sel();
    if (supplement && !s.drivers.length) { toast('請選擇要補派的司機', 'err'); return; }
    const ok = await confirmDialog({ title: supplement ? '確認補派司機？' : '確認換車／換司機？',
      text: `${$('#rsg-preview').innerHTML}<br>調度直接生效、不需簽核，並 Email 通知申請人。` });
    if (!ok) return;
    const r = ModuleD.reassign(a, s);
    if (!r.ok) { toast(r.error, 'err'); return; }
    closeModal(); toast(`${a.id}｜${r.kind}已生效，已通知申請人`, 'ok'); done();
  };
}
// 展延彈窗：延後用車結束時間（僅調度、不需簽核；延長區段內目前資源須可用）
function openDExtend(a, done) {
  const sp = ModuleD.span(a), def = ModuleD.fromAbs(sp.end + 1440);
  openModal(`展延 · ${a.id}`, `
    <div class="card-desc">目前結束時間 <b>${a.endDate} ${a.endTime}</b>。展延由調度直接操作、<b>不需簽核</b>；延長區段內目前的車輛／司機須仍可用（先佔先贏），否則請先換車／換司機再展延。</div>
    ${infoGrid('ext-fields', [
      fInput('新的結束日期', `<input type="date" id="ext-date" value="${def.date}" min="${a.endDate}">`),
      fInput('新的結束時間', `<input type="time" id="ext-time" value="${def.time}">`),
      fInput('原因', `<input type="text" id="ext-reason" placeholder="例：專案延長">`, { full: true }),
      fInput('調度人員', `<input type="text" id="ext-by" value="調度室-值班人員">`, { full: true }),
    ].join(''))}
    <div style="text-align:center;margin-top:16px;">
      <button class="btn btn-primary" id="ext-ok">▶ 確認展延</button>
      <button class="btn btn-ghost" id="ext-cancel">取消</button>
    </div>`);
  $('#ext-cancel').onclick = closeModal;
  $('#ext-ok').onclick = async () => {
    const o = { date: $('#ext-date').value, time: $('#ext-time').value, reason: $('#ext-reason').value.trim(), by: $('#ext-by').value.trim() };
    const ok = await confirmDialog({ title: '確認展延？', text: `結束時間 ${a.endDate} ${a.endTime} → <b>${o.date} ${o.time}</b><br>立即生效並 Email 通知申請人。` });
    if (!ok) return;
    const r = ModuleD.extend(a, o);
    if (!r.ok) { toast(r.error, 'err'); return; }
    closeModal(); toast(`${a.id} 已展延至 ${o.date} ${o.time}`, 'ok'); done();
  };
}

/* ============================================================
   模組 D · 司機任務單（駕駛端）— 以「駕駛」為單位，依指派區間列出任務（雙駕駛兩位各自列出）
   ============================================================ */
function dDriverCargo(a) {
  if (!a.items.length) return '<span class="muted">無</span>';
  return a.items.map(i => `${i.hazardous ? '<span class="badge b-red">⚠ 危險品</span> ' : ''}${i.name}×${i.qty || 1}`
    + `<span class="hint">（${i.l}×${i.w}×${i.h}cm${i.weight ? '｜' + i.weight + 'kg' : ''}）</span>`).join('<br>');
}
RENDER.d_driver = function () {
  const p = $('#page-d_driver');
  const apps = ModuleD.applications.filter(a => a.status === 'dispatched' && Signoff.effective(a)); // 調度主管同意（待出車）才列入
  const byDriver = {}, selfRows = [];
  apps.forEach(a => ModuleD.liveSegs(a).forEach(s => {
    if (!s.drivers.length) { selfRows.push({ a, s }); return; }
    s.drivers.forEach(d => (byDriver[d] = byDriver[d] || []).push({ a, s, co: s.drivers.filter(x => x !== d) }));
  }));
  const range = s => `${ModuleD.fmtAbs(s.from)}<br><span class="hint">至 ${ModuleD.fmtAbs(s.to)}</span>`;
  let cards = Object.keys(byDriver).sort().map(did => {
    const list = byDriver[did].sort((x, y) => x.s.from - y.s.from);
    const trs = list.map(({ a, s, co }, i) => `<tr>
      <td>${i + 1}</td>
      <td>${range(s)}${s.kind !== '原始指派' ? `<br><span class="badge b-navy">${s.kind}</span>` : ''}</td>
      <td>${dVehName(s.vehicle)}${co.length ? `<br><span class="badge b-navy">雙駕駛・搭檔 ${dDrvList(co)}</span>` : ''}</td>
      <td style="text-align:left;">${dCatBadge(a)} ${a.applicant}${a.ext ? `（分機 ${a.ext}）` : ''}｜${a.pax} 人${a.purpose ? `<br><span class="hint">${a.purpose}</span>` : ''}</td>
      <td style="text-align:left;">${dDriverCargo(a)}</td>
      <td style="white-space:nowrap;">${Flow.badge(a)}</td></tr>`).join('');
    return `<div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>🚗 駕駛 <b style="color:var(--navy);">${dDrvName(did)}</b></span>
        <span class="badge b-green">共 ${list.length} 段</span></div>
      <div class="card-desc">該駕駛被指派的用車區間（依指派區間歷史，換車／換司機後自動切換）：車輛、<b>使用人</b>與<b>隨行貨物</b>（危險品特別標示）。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th>順序</th><th>指派區間</th><th>車輛</th><th>使用人／行程</th><th>隨行貨物</th><th>操作</th>
      </tr></thead><tbody>${trs}</tbody></table></div></div>`;
  }).join('');
  if (!cards) cards = `<div class="card"><div class="empty">目前尚無派司機的用車任務。於「D｜派車調度」做出「派車＋派司機」判斷後，這裡會依駕駛顯示任務單。</div></div>`;
  const selfCard = selfRows.length === 0 ? '' : `
    <div class="card">
      <div class="card-title">自駕用車（無派司機）· 車輛交接參考</div>
      <div class="card-desc">「有車沒司機＋使用者勾選自駕」派出的區間，由使用者自行駕駛（系統不做駕駛資格檢核 G78）；勾選「願意等待駕駛媒合」者，調度可於出發前補派司機。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>區間</th><th>車輛</th><th>使用人</th><th>隨行貨物</th><th>狀態</th></tr></thead><tbody>
        ${selfRows.map(({ a, s }) => `<tr><td>${a.id}</td><td>${range(s)}</td><td>${dVehName(s.vehicle)}</td>
          <td style="text-align:left;">${a.applicant}${a.ext ? `（分機 ${a.ext}）` : ''}｜${a.pax} 人${a.waitDriver ? ' <span class="badge b-navy">等待駕駛媒合</span>' : ''}</td>
          <td style="text-align:left;">${dDriverCargo(a)}</td><td>${Flow.badge(a)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  p.innerHTML = `
    <div class="section-h">一般用車申請作業 · 司機任務單（駕駛）</div>
    <div class="section-sub">以「駕駛」為單位，依指派區間列出每段任務：車輛、使用人（分機／人數）、行程說明與隨行貨物；雙駕駛兩位各自列出並標示搭檔。只列調度主管同意後（待出車以後）的任務；狀態欄顯示待出車／已出車／已回登。</div>
    ${cards}
    ${selfCard}`;
};

/* ============================================================
   共用：運輸主管簽審（A／B／C／D 各一個軟體單元，共用同一套畫面）
   index：上半查詢條件、下半簽審紀錄 grid（最左「明細」）；
   明細：申請內容、派車結果、簽審歷程；待簽審者才出現「主管同意」，已簽審者不再出現。
   簽審通過才生效；退回由各模組把單子放回調度待處理（signReject）。
   ============================================================ */
// 其他清單用：派車結果的簽審狀態小徽章（已同意不另顯示）
// G122：調度中／調度主管審已是主狀態（Flow），不再另加簽審小徽章；保留函式供既有呼叫
function signBadge(rec) { return ''; }
function signStateBadge(rec) {
  const st = Signoff.stateOf(rec);
  if (!st) return '<span class="muted">—</span>';
  const [t, c] = Signoff.STATUS[st];
  return `<span class="badge ${c}">${t}</span>`;
}
// 生效前的操作守門（調度主管同意前不可進行生命週期操作等）
function signGate(rec) {
  if (Signoff.effective(rec)) return true;
  toast('派車結果尚待運輸主管簽審，簽審通過後才可操作', 'err');
  return false;
}
const stnName = id => { const s = DB.stations.find(x => x.id === id); return s ? s.name : (id || '—'); };
const siteNm = id => { const s = DB.sites.find(x => x.id === id); return s ? s.name : (id || '—'); };
const drvNm = id => { const d = DB.drivers.find(x => x.id === id); return d ? d.name : (id || '—'); };

// 巡迴物品轉運：不經運輸主管簽審（排班即生效），派車資料欄位供「車輛使用實登」沿用
const A_DISPATCH_VIEW = {
  // itemReport：貨物清單逐項回報狀態（G121）；A 的實登頁以車次為單位（G123，見 RENDER.a_usage）
  mod: 'A', signed: false, itemReport: true, M: () => ModuleA, applyPage: 'a_apply', applyState: () => aApply,
  dispatchPage: 'a_dispatch', dispatchName: '車次追蹤／異動',
  what: r => `${r.serviceDate}｜${brName(r.branch)}｜${stnName(r.pickStation)} → ${stnName(r.station)}`,
  infoItems: r => [
    fItem('單號', `<b style="color:var(--navy);">${r.id}</b>`),
    fItem('申請人', `${r.applicant}${r.applyUnit ? `（${r.applyUnit}/${r.applyExt}）` : ''}`),
    fItem('收貨日期', r.serviceDate),
    fItem('車屬院區', brName(r.branch)),
    fItem('收貨站點 → 送貨站點', `${stnName(r.pickStation)} → ${stnName(r.station)}`, { w2: true }),
    fItem('收貨時間模式', r.recvMode === 'exact' ? `指定期望時間 ${r.deliverTime || ''}` : '越快越好'),
    fItem('申請狀態', Flow.badge(r)),
  ],
  items: r => r.items || [], hazard: false,
  resultItems: r => {
    if (r.status !== 'matched' || !r.assignedShift) return [fItem('目前排班', '<span class="muted">已移出班次（未排入）</span>', { w2: true })];
    const sh = DB.regionalShifts.find(s => s.id === r.assignedShift), plan = ModuleA.shiftPlan(r.serviceDate, r.assignedShift);
    return [fItem('班次', sh ? sh.label : r.assignedShift), fItem('車輛', plan.vehicle || '—'), fItem('司機', drvNm(plan.driver)), fItem('到站時間', r.arrival || '—')];
  },
  };
const SIGN_UNITS = {
  b_sign: {
    mod: 'B', title: '院區物品轉運作業 · 運輸主管簽審', M: () => ModuleB, applyPage: 'b_apply', applyState: () => bApply,
    dispatchPage: 'b_review', dispatchName: '派車調度',
    what: r => `${siteNm(r.pickSite)} → ${siteNm(r.dropSite)}${r.direct ? '｜直達' : ''}`,
    infoItems: r => [
      fItem('單號', `<b style="color:var(--navy);">${r.id}</b>`),
      fItem('申請人', r.applicant),
      fItem('收貨據點 → 送貨據點', `${siteNm(r.pickSite)} → ${siteNm(r.dropSite)}`, { w2: true }),
      fItem('派送型態', r.direct ? '直達' : '非直達（沿線收送）'),
      fItem('希望收貨日期／時間', [r.wantReceiveDate, r.wantReceiveTime].filter(Boolean).join(' ') || '—'),
      fItem('申請狀態', Flow.badge(r)),
    ],
    items: r => r.items || [], hazard: false, itemReport: true,   // itemReport：實登明細的貨物清單可逐項回報（G120）
    resultItems: r => r.dispatchVehicle ? [
      fItem('派車單', r.dispatchId || '—'), fItem('車輛', r.dispatchVehicle),
      fItem('駕駛', ModuleB.driversOf(r).map(drvNm).join('＋') || '—'), fItem('派遣模式', r.dispatchMode || '—'),
      fItem('方向', r.dispatchDir === 'north' ? '北返（回程）' : '南下（去程）'),
      fItem('收貨時間', r.pickupTime || '—'), fItem('送達時間', r.dispatchDropTime || '—'),
    ] : [fItem('目前派車', '<span class="muted">已移出派車單（回待調度）</span>', { w2: true })],
    effect: '同意後狀態為「待出車」，出現在司機任務單；到收貨時間即「已出車」。',
    rejectEffect: '退回後整張派車單回「調度中」（未送審），由調度在「派車調度」修改後重新送審。',
  },
  c_sign: {
    mod: 'C', title: '差旅共乘作業 · 運輸主管簽審', M: () => ModuleC, applyPage: 'c_apply', applyState: () => cApply,
    dispatchPage: 'c_review', dispatchName: '派車調度',
    what: r => `${r.departDate} ${r.earliestPickup}｜${r.origin} → ${r.dest}｜${r.type === 'round' ? '來回' : '單程'}`,
    infoItems: r => [
      fItem('單號', `<b style="color:var(--navy);">${r.id}</b>`),
      fItem('申請人', `${r.applicant}${r.dept ? `（${r.dept}/${r.ext}）` : ''}`),
      fItem('任務型態', r.type === 'round' ? '來回單' : '單程單'),
      fItem('出發地 → 目的地', `${r.origin} → ${r.dest}`, { w2: true }),
      fItem('去程', `${r.departDate} ${r.earliestPickup}`),
      fItem('回程', r.type === 'round' ? `${r.returnDate} ${r.earliestReturn}` : '—'),
      fItem('人數', `${r.pax} 人`),
      fItem('申請狀態', Flow.badge(r)),
    ],
    items: null,
    resultItems: r => r.vehicle ? [
      fItem('派車單', r.dispatchId || '—'), fItem('車輛', r.vehicle),
      fItem('駕駛', ModuleC.driversOf(r).map(drvNm).join('＋') || '—'), fItem('併車群組', r.groupId || '—'),
      r.overridden ? fItem('人工指派', '是') : '',
    ] : [fItem('目前派車', '<span class="muted">已移出派車單（回待調度）</span>', { w2: true })],
    effect: '同意後狀態為「待出車」，出現在司機任務單；到出發時間即「已出車」。',
    rejectEffect: '退回後整張派車單回「調度中」（未送審），由調度在「派車調度」修改後重新送審。',
  },
  d_sign: {
    mod: 'D', title: '一般用車申請作業 · 運輸主管簽審', M: () => ModuleD, applyPage: 'd_apply', applyState: () => dApply,
    dispatchPage: 'd_review', dispatchName: '派車調度',
    what: r => `${dPeriodShort(r)}｜${r.pax} 人｜自駕：${r.selfDrive ? '是' : '否'}`,
    infoItems: r => [
      fItem('單號', `<b style="color:var(--navy);">${r.id}</b>`),
      fItem('申請人', `${r.applicant}${r.dept ? `（${r.dept}/${r.ext}）` : ''}`),
      fItem('用車類別', dCatBadge(r)),
      fItem('用車時段', dPeriod(r), { w2: true }),
      fItem('人數', `${r.pax} 人`),
      fItem('是否自駕', r.selfDrive ? `是${r.waitDriver ? '（願意等待駕駛媒合）' : ''}` : '否'),
      fItem('需求標記', dNeedTags(r), { w2: true }),
      fItem('申請狀態', Flow.badge(r)),
    ],
    items: r => r.items || [], hazard: true,
    resultItems: r => r.outcome ? [
      fItem('派車判斷', dOutcomeBadge(r)),
      fItem('派車單號', r.dispatchNo && r.outcome !== 'noVehicle' ? `<b style="color:var(--navy);">${r.dispatchNo}</b>` : '<span class="muted">—</span>'),
      fItem('車輛', r.vehicle ? dVehName(r.vehicle) : '<span class="muted">—</span>'),
      fItem('司機', dDriversText(r), { w2: true }),
      fItem('調度人員', r.dispatchedBy || '—'),
      fItem('調度備註', r.dispatchNote || '<span class="muted">—</span>', { w2: true }),
    ] : [fItem('目前派車', '<span class="muted">已撤銷（回待調度）</span>', { w2: true })],
    effect: '同意後狀態為「待出車」，寄出派車結果通知、出現在司機任務單，並可進行換車／換司機／展延／提前歸還。',
    rejectEffect: '退回後撤銷派車判斷、資源釋放，此單回「待調度」，由調度重新判斷後再送簽審。',
  },
};
const signUi = {};
Object.keys(SIGN_UNITS).forEach(k => {
  signUi[k] = { view: 'list', detailId: null, query: { kw: '', status: '' } };
  RENDER[k] = () => {
    const p = $('#page-' + k), st = signUi[k];
    if (st.view === 'detail') return renderSignDetail(k, p, st.detailId);
    return renderSignList(k, p);
  };
});
const SIGN_STATUS_OPTS = [['', '全部'], ['pending', '待運輸主管簽審'], ['approved', '主管已同意'], ['rejected', '主管已退回']];

function signRows(k) {
  const cfg = SIGN_UNITS[k], q = signUi[k].query, kw = (q.kw || '').trim();
  const rank = r => Signoff.isPending(r) ? 0 : 1;
  const lastAt = r => { const l = (r.signLog || []).filter(x => x.action === '送簽審').pop(); return l ? +new Date(l.at) : 0; };
  return cfg.M().signRecords()
    .filter(r => (!kw || r.id.includes(kw) || (r.applicant || '').includes(kw)) && (!q.status || Signoff.stateOf(r) === q.status))
    .sort((x, y) => rank(x) - rank(y) || lastAt(y) - lastAt(x));
}
function renderSignList(k, p) {
  const cfg = SIGN_UNITS[k], q = signUi[k].query;
  const pend = cfg.M().signRecords().filter(r => Signoff.isPending(r)).length;
  const stOpts = SIGN_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">運輸主管簽審（運輸主管）</div>
    <div class="section-sub">調度做出的派車結果一律送運輸主管簽審，<b>簽審通過才生效</b>。${cfg.effect}不同意時須填意見；${cfg.rejectEffect}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="${k}-q-search">🔍 查詢</button>
      </div>
      ${infoGrid(`${k}-q`, [
        fInput('單號／申請人（模糊）', `<input type="text" id="${k}-q-kw" value="${gEsc(q.kw)}" placeholder="輸入單號或姓名/部門關鍵字">`),
        fInput('簽審狀態', `<select id="${k}-q-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史簽審紀錄</span>
        <span>${pend ? `<span class="badge b-amber">待簽審 ${pend} 筆</span> ` : ''}<span class="muted" id="${k}-count"></span>
          <button class="btn btn-accent btn-sm" id="${k}-batch" style="margin-left:10px;">✓ 批次審核</button></span>
      </div>
      <div id="${k}-grid"></div>
    </div>`;
  $(`#${k}-q-search`).onclick = () => {
    signUi[k].query = { kw: $(`#${k}-q-kw`).value.trim(), status: $(`#${k}-q-status`).value };
    renderSignGrid(k); toast('查詢完成', 'ok');
  };
  // 批次審核：grid 目前顯示的列中，尚未簽審（待簽審）者一律轉為同意
  $(`#${k}-batch`).onclick = async () => {
    const todo = signRows(k).filter(r => Signoff.isPending(r));
    if (!todo.length) { toast('目前清單中沒有待簽審的單', 'err'); return; }
    const ok = await confirmDialog({ title: '確認批次審核？',
      text: `將目前清單中 <b>${todo.length}</b> 筆待簽審的派車結果全部<b>同意</b>（${todo.map(r => r.id).join('、')}），同意後立即生效。${cfg.effect}` });
    if (!ok) return;
    let n = 0;
    todo.forEach(r => { if (cfg.M().signApprove(r, `${Signoff.SUPERVISOR}-值班主管`, '批次審核').ok) n++; });
    toast(`已批次同意 ${n} 筆，派車結果生效`, 'ok');
    RENDER[k]();
  };
  renderSignGrid(k);
  initMasonry(p);
}
function renderSignGrid(k) {
  const cfg = SIGN_UNITS[k], box = $(`#${k}-grid`);
  if (!box) return;
  const rows = signRows(k);
  $(`#${k}-count`).textContent = `${rows.length} 筆`;
  box.innerHTML = rows.length === 0
    ? `<div class="empty"><div class="big">🖋</div>查無簽審紀錄。調度在「${cfg.dispatchName}」做出派車結果後，會出現在這裡等待簽審。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>單號</th><th>申請人</th><th>申請內容</th><th>派車結果</th><th>送簽</th><th>簽審狀態</th><th>簽審人／時間</th></tr></thead><tbody>
      ${rows.map(r => { const s = r.sign, last = (r.signLog || []).filter(l => l.action === '送簽審').pop() || {};
        const dec = (r.signLog || []).filter(l => ['主管同意', '主管退回'].includes(l.action)).pop();
        return `<tr>
        <td><button class="btn btn-ghost btn-sm" data-sgdetail="${r.id}">明細</button></td>
        <td><b style="color:var(--navy);">${r.id}</b></td><td>${r.applicant}</td>
        <td style="text-align:left;">${cfg.what(r)}</td>
        <td style="text-align:left;">${s ? s.summary : (last.note || '—')}</td>
        <td class="muted">${last.at ? fmtTime(last.at) : '—'}<br>${last.by || ''}${s && s.round > 1 ? `｜第 ${s.round} 輪` : ''}</td>
        <td>${signStateBadge(r)}</td>
        <td class="muted">${dec && !(s && s.status === 'pending') ? `${dec.by}<br>${fmtTime(dec.at)}` : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「明細」查看申請內容與派車結果；待簽審者於明細頁進行主管同意。</div>`;
  $$(`#${k}-grid [data-sgdetail]`).forEach(b => b.onclick = () => {
    signUi[k].detailId = b.dataset.sgdetail; signUi[k].view = 'detail'; RENDER[k]();
  });
}
function renderSignDetail(k, p, id) {
  const cfg = SIGN_UNITS[k], r = cfg.M().signRecords().find(x => x.id === id);
  if (!r) { signUi[k].view = 'list'; return RENDER[k](); }
  const pending = Signoff.isPending(r), s = r.sign;
  const items = cfg.items ? cfg.items(r) : null;
  const dec = (r.signLog || []).filter(l => ['主管同意', '主管退回'].includes(l.action)).pop();
  const outcomeNote = pending
    ? `<div class="callout" style="margin-bottom:14px;">此派車結果<b>尚待簽審</b>，簽審通過前不生效（${cfg.effect.replace(/。$/, '')}）。</div>`
    : (Signoff.stateOf(r) === 'rejected'
      ? `<div class="callout" style="margin-bottom:14px;">主管已退回：${dec ? dec.note : ''}。${cfg.rejectEffect}</div>`
      : `<div class="callout info" style="margin-bottom:14px;">主管已同意，派車結果已生效。</div>`);
  p.innerHTML = `
    <div class="section-h">運輸主管簽審明細 · ${r.id}</div>
    ${outcomeNote}
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>申請內容</span>${signStateBadge(r)}</div>
      ${infoGrid(`${k}-d-info`, cfg.infoItems(r).join(''))}
    </div>
    ${items ? `<div class="card"><div class="card-title">貨物清單</div><div id="${k}-d-items"></div></div>` : ''}
    <div class="card">
      <div class="card-title">派車結果${s && s.round > 1 ? ` <span class="g-tag">第 ${s.round} 輪</span>` : ''}</div>
      ${infoGrid(`${k}-d-res`, [
        fItem('送簽內容', s ? s.summary : '—', { full: true }),
        fItem('送簽人', s ? s.submittedBy : '—'),
        fItem('送簽時間', s ? fmtTime(s.submittedAt) : '—'),
      ].concat(cfg.resultItems(r)).join(''))}
    </div>
    ${pending ? `
    <div class="card">
      <div class="card-title">主管同意</div>
      ${infoGrid(`${k}-sv`, [
        fInput('是否同意', `
          <div class="radio-group">
            <label class="radio-pill sel" id="${k}-yes-pill"><input type="radio" name="${k}-agree" value="yes" checked>同意（派車結果生效）</label>
            <label class="radio-pill" id="${k}-no-pill"><input type="radio" name="${k}-agree" value="no">不同意（退回調度重新處理）</label>
          </div>`, { stack: true, full: true }),
        fInput('簽審意見 <span class="hint" id="' + k + '-req" style="display:none;color:#c0392b;">（不同意時必填）</span>', `<input type="text" id="${k}-note" placeholder="請輸入簽審意見">`, { full: true }),
        fInput('簽審人', `<input type="text" id="${k}-by" value="${Signoff.SUPERVISOR}-值班主管">`),
      ].join(''))}
      <div style="text-align:center;margin-top:18px;">
        <button class="btn btn-primary" id="${k}-submit">▶ 送出</button>
        <button class="btn btn-ghost" id="${k}-cancel">取消</button>
      </div>
    </div>` : ''}
    <div class="card"><div class="card-title">簽審歷程</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>操作人</th><th>說明</th></tr></thead><tbody>
      ${(r.signLog || []).map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td><td>${l.note || '—'}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div style="text-align:center;"><button class="btn btn-ghost" id="${k}-goapply">📄 查看申請單</button>
      <button class="btn btn-ghost" id="${k}-godispatch">🚚 前往${cfg.dispatchName}</button></div>
    ${backBar(k + '-back')}`;
  if (items) renderCargoGrid(`#${k}-d-items`, items, false, null, { hazard: cfg.hazard, emptyText: '無貨物。' });
  const back = () => { signUi[k].view = 'list'; RENDER[k](); };
  $(`#${k}-back`).onclick = back;
  $(`#${k}-goapply`).onclick = () => { const st = cfg.applyState(); st.view = 'detail'; st.detailId = r.id; goto(cfg.applyPage); };
  $(`#${k}-godispatch`).onclick = () => goto(cfg.dispatchPage);
  if (pending) {
    $$(`#page-${k} input[name=${k}-agree]`).forEach(x => x.onchange = () => {
      const no = $(`#page-${k} input[name=${k}-agree][value=no]`).checked;
      $(`#${k}-yes-pill`).classList.toggle('sel', !no); $(`#${k}-no-pill`).classList.toggle('sel', no);
      $(`#${k}-req`).style.display = no ? 'inline' : 'none';
    });
    $(`#${k}-cancel`).onclick = back;
    $(`#${k}-submit`).onclick = async () => {
      const agree = $(`#page-${k} input[name=${k}-agree]:checked`).value === 'yes';
      const note = $(`#${k}-note`).value.trim(), by = $(`#${k}-by`).value.trim() || Signoff.SUPERVISOR;
      if (!agree && !note) { toast('不同意時「簽審意見」為必填', 'err'); $(`#${k}-note`).focus(); return; }
      const ok = await confirmDialog({ title: agree ? '確認同意？' : '確認退回？',
        text: agree ? `同意後派車結果立即生效。${cfg.effect}` : cfg.rejectEffect });
      if (!ok) return;
      const res = agree ? cfg.M().signApprove(r, by, note) : cfg.M().signReject(r, by, note);
      if (!res.ok) { toast(res.error, 'err'); return; }
      toast(`${r.id} ${agree ? '已同意，派車結果生效' : '已退回調度重新處理'}`, agree ? 'ok' : 'err');
      RENDER[k]();
    };
  }
  initMasonry(p);
}

/* ============================================================
   共用單元：車輛使用實登（A／B／C／D）
   A 以車次（G123）、B／C／D 以派車單（G124／G125／G126）為單位；各單元畫面見下方 RENDER.a_usage 與 DISP_USAGE。
   本段為共用狀態與工具：查詢條件、實登狀態選項、車號／里程顯示、貨物清單逐項回報（G120／G121）。
   資料邏輯在 usage.js（Usage.save／saveGroup／setItemReport）與各模組。
   ============================================================ */
// 貨物清單回報沿用的模組設定（renderItemReportGrid 取 M()）：A 沿用 A_DISPATCH_VIEW；B/C/D 沿用各自簽審單元設定
const USAGE_UNITS = { a_usage: A_DISPATCH_VIEW, b_usage: SIGN_UNITS.b_sign, c_usage: SIGN_UNITS.c_sign, d_usage: SIGN_UNITS.d_sign };
const usageUi = {};
Object.keys(USAGE_UNITS).forEach(k => { usageUi[k] = { view: 'list', editItem: null, query: { kw: '', status: '' } }; });
const usageCfg = k => USAGE_UNITS[k];
const USAGE_STATUS_OPTS = [['', '全部'], ['todo', '待實登'], ['done', '已實登']];
const usageVehText = id => { const v = DB.vehicles.find(x => x.id === id); return v ? `${v.id}（${v.name}）` : (id || '—'); };
const usageKm = n => (n == null || n === '') ? '—' : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 1 });
// 貨物清單＋回報狀態（G120）：最前欄「編輯」→ 該列回報狀態變下拉選單（正常運送／不運送／不接收）
function renderItemReportGrid(k, r) {
  const box = $(`#${k}-d-items`); if (!box) return;
  const M = usageCfg(k).M(), items = r.items || [], ed = usageUi[k].editItem;
  const catName = c => (DB.wasteFactors.find(f => f.code === c) || {}).name || c || '—';
  const badge = v => `<span class="badge ${v === '正常運送' ? 'b-green' : 'b-red'}">${v}</span>`;
  box.innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr>
    <th></th><th>品名</th><th>長×寬×高(cm)</th><th>類別</th><th>數量</th><th>單件重(kg)</th><th>回報狀態</th></tr></thead><tbody>
    ${items.length === 0 ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px;">無貨物。</td></tr>' : items.map((it, i) => `<tr>
      <td style="white-space:nowrap;">${ed === i
        ? `<button class="btn btn-primary btn-sm" data-irsave="${i}">儲存</button> <button class="btn btn-ghost btn-sm" data-ircancel="${i}">取消</button>`
        : `<button class="btn btn-ghost btn-sm" data-iredit="${i}">編輯</button>`}</td>
      <td>${it.name || '貨物'}</td><td>${it.l != null ? `${it.l}×${it.w}×${it.h}` : `<span class="muted">申報 ${it.volume || 0}L</span>`}</td>
      <td>${catName(it.category)}</td><td>${it.qty || 1}</td><td>${it.weight || 0}</td>
      <td>${ed === i ? `<select id="${k}-ir-sel">${M.ITEM_REPORTS.map(v => `<option ${M.itemReport(it) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>` : badge(M.itemReport(it))}</td></tr>`).join('')}
    </tbody></table></div>
    ${(r.itemReportLog || []).length ? `<div class="muted" style="margin-top:8px;">回報紀錄：${r.itemReportLog.map(l => `${fmtTime(l.at)} ${l.by} ${l.item}：${l.before} → ${l.after}`).join('；')}</div>` : ''}`;
  $$(`#${k}-d-items [data-iredit]`).forEach(b => b.onclick = () => { usageUi[k].editItem = +b.dataset.iredit; renderItemReportGrid(k, r); });
  $$(`#${k}-d-items [data-ircancel]`).forEach(b => b.onclick = () => { usageUi[k].editItem = null; renderItemReportGrid(k, r); });
  $$(`#${k}-d-items [data-irsave]`).forEach(b => b.onclick = async () => {
    const i = +b.dataset.irsave, it = items[i], val = $(`#${k}-ir-sel`).value;
    if (val === M.itemReport(it)) { usageUi[k].editItem = null; renderItemReportGrid(k, r); return; }
    if (!(await confirmDialog({ title: '確認修改回報狀態？', text: `${it.name || '貨物'}：${M.itemReport(it)} → <b>${val}</b>` }))) return;
    const res = M.setItemReport(r, i, val, '調度室');
    if (!res.ok) { toast(res.error, 'err'); return; }
    usageUi[k].editItem = null; toast(`${it.name || '貨物'} 回報狀態已改為「${val}」`, 'ok'); renderItemReportGrid(k, r);
  });
}
/* ============================================================
   模組 A · 車輛使用實登（G123）— 以「車次」為單位
   index：查詢條件＋「已排定車次」grid（同車次追蹤／異動，最左「明細」）；
   detail：班次車輛資訊（含起訖里程、行駛里程、實登人員，儲存即完成實登）＋本車次申請單
   （異常回報：正常運送／不準時／沒出現；「明細」開視窗顯示該單貨物清單與貨品回報狀態）。
   資料邏輯在 ModuleA.tripUsageSave／setIncident／setItemReport。
   ============================================================ */
Object.assign(usageUi.a_usage, { key: null, editInc: null });
const aUsageUser = () => DB.currentUser.name;   // 實登人員：系統自動帶入登入者
RENDER.a_usage = function () {
  const p = $('#page-a_usage');
  if (usageUi.a_usage.view === 'detail') return renderATripUsageDetail(p);
  return renderATripUsageList(p);
};
function aTripUsageRows() {
  const q = usageUi.a_usage.query, kw = (q.kw || '').trim();
  return aTripRows().filter(r => {
    const u = ModuleA.tripUsage(r.date, r.shiftId);
    return (!kw || r.apps.some(a => a.id.includes(kw) || (a.applicant || '').includes(kw))
        || (r.plan.vehicle || '').includes(kw) || (u && u.vehicle.includes(kw)))
      && (!q.status || (q.status === 'done') === !!u);
  });
}
function renderATripUsageList(p) {
  const q = usageUi.a_usage.query;
  const todo = aTripRows().filter(r => !ModuleA.tripUsage(r.date, r.shiftId)).length;
  const stOpts = USAGE_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">車輛使用實登（業務）</div>
    <div class="section-sub">巡迴物品轉運以<b>車次</b>（收貨日期＋班次）為單位實登：點「明細」於班次車輛資訊輸入起始／結束里程並儲存即完成實登，車次內每張申請單轉為「已回登」；並可回報各單的異常（不準時／沒出現）與貨品狀態。實登可修改，每次儲存都保留歷程。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="a_usage-q-search">🔍 查詢</button>
      </div>
      ${infoGrid('a_usage-q', [
        fInput('單號／申請人／車號（模糊）', `<input type="text" id="a_usage-q-kw" value="${gEsc(q.kw)}" placeholder="輸入車次內單號、姓名/部門或車號關鍵字">`),
        fInput('實登狀態', `<select id="a_usage-q-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>已排定車次</span>
        <span>${todo ? `<span class="badge b-amber">待實登 ${todo} 車次</span> ` : ''}<span class="muted" id="a_usage-count"></span></span></div>
      <div id="a_usage-grid"></div>
    </div>`;
  $('#a_usage-q-search').onclick = () => {
    usageUi.a_usage.query = { kw: $('#a_usage-q-kw').value.trim(), status: $('#a_usage-q-status').value };
    renderATripUsageGrid(); toast('查詢完成', 'ok');
  };
  renderATripUsageGrid();
  initMasonry(p);
}
function renderATripUsageGrid() {
  const box = $('#a_usage-grid'); if (!box) return;
  const rows = aTripUsageRows();
  $('#a_usage-count').textContent = `${rows.length} 個車次`;
  box.innerHTML = aTripTable(rows, '明細');
  $$('#a_usage-grid [data-key]').forEach(b => b.onclick = () => {
    Object.assign(usageUi.a_usage, { key: b.dataset.key, view: 'detail', editInc: null }); RENDER.a_usage();
  });
}
function renderATripUsageDetail(p) {
  const st = usageUi.a_usage, [date, shiftId] = (st.key || '').split('|');
  const sh = DB.regionalShifts.find(s => s.id === shiftId);
  const apps = sh ? ModuleA.tripApps(date, shiftId) : [];
  if (!sh || !apps.length) { st.view = 'list'; return RENDER.a_usage(); }
  const plan = ModuleA.shiftPlan(date, shiftId), u = ModuleA.tripUsage(date, shiftId), log = ModuleA.tripUsageLog(date, shiftId);
  const dv = u ? { vehicle: u.vehicle, driver: u.driver1, startKm: u.startKm, endKm: u.endKm }
    : { vehicle: plan.vehicle, driver: plan.driver, startKm: '', endKm: '' };
  const vehOpts = ModuleA.logiVehicles().map(v => `<option value="${v.id}" ${dv.vehicle === v.id ? 'selected' : ''}>${v.id}（${v.name}）</option>`).join('');
  const drvOpts = ModuleA.logiDrivers().map(d => `<option value="${d.id}" ${dv.driver === d.id ? 'selected' : ''}>${d.name}</option>`).join('');
  const diffs = u ? [u.vehicle !== plan.vehicle && '車輛', u.driver1 !== plan.driver && '司機'].filter(Boolean) : [];
  const incBadge = a => `<span class="badge ${a.incident ? 'b-red' : 'b-green'}">${incidentLabel(a.incident)}</span>`;
  const body = apps.map(a => { const ed = st.editInc === a.id;
    return `<tr>
      <td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" data-aitems="${a.id}">明細</button>
        ${ed ? `<button class="btn btn-primary btn-sm" data-incsave="${a.id}">儲存</button> <button class="btn btn-ghost btn-sm" data-inccancel="${a.id}">取消</button>`
          : `<button class="btn btn-ghost btn-sm" data-incedit="${a.id}">編輯</button>`}</td>
      <td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td>
      <td>${a.pickupLoc || stnName(a.pickStation)}</td><td>${stnName(a.station)}${a.building ? ' / ' + a.building : ''}</td>
      <td>${itemsSummary(a.items)}</td>
      <td>${ed ? `<select id="a_usage-inc-sel">${INCIDENT_OPTS.map(([v, t]) => `<option value="${v}" ${(a.incident || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : incBadge(a)}</td></tr>`; }).join('');
  p.innerHTML = `
    <div class="section-h">車輛使用實登明細 · ${brName(sh.branch)}｜${date}｜${sh.label}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>班次車輛資訊</span>
        <span class="badge ${u ? 'b-green' : 'b-amber'}">${u ? '已實登' : '待實登'}</span></div>
      ${diffs.length ? `<div class="callout" style="margin-bottom:12px;">實際使用的<b>${diffs.join('、')}</b>與本車次安排不同。</div>` : ''}
      ${infoGrid('aud-info', [
        fItem('車屬院區', brName(sh.branch)),
        fItem('班次', `<b>${sh.label}</b>`),
        fItem('收貨日期', date),
        fInput('車輛 <span class="hint">可修改</span>', `<select id="aud-veh">${vehOpts}</select>`),
        fInput('司機 <span class="hint">可修改</span>', `<select id="aud-drv">${drvOpts}</select>`),
        fInput('起始里程（km）<span style="color:#c0392b;">*</span>', `<input type="number" min="0" step="0.1" id="aud-start" value="${dv.startKm}" placeholder="出車時里程表讀數">`),
        fInput('結束里程（km）<span style="color:#c0392b;">*</span>', `<input type="number" min="0" step="0.1" id="aud-end" value="${dv.endKm}" placeholder="還車時里程表讀數">`),
        fItem('行駛里程', `<b id="aud-dist">—</b>`),
        fItem('實登人員 <span class="hint">系統自動帶入</span>', u ? `${u.by}<span class="muted">｜${fmtTime(u.at)}</span>` : aUsageUser()),
      ].join(''))}
      <div style="margin-top:6px;"><button class="btn btn-primary btn-sm" id="aud-save">💾 ${u ? '儲存修改' : '儲存實登'}</button>
        <span class="hint" style="margin-left:8px;">車輛／司機預設帶入本車次，實際使用不同請直接修改（只記錄實登，不改車次安排）；結束里程不可小於起始里程。</span></div>
    </div>
    <div class="card">
      <div class="card-title">本車次申請單（${apps.length} 筆）</div>
      <div class="card-desc">異常回報預設「正常運送」；點<b>編輯</b>可改為不準時或沒出現，存檔並自動寄信通知申請人＋直屬主管（一單一信 G20）。點<b>明細</b>開啟該單的貨物清單，可回報貨品狀態（G121）。</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th></th><th>物品運輸單號</th><th>申請人</th><th>收貨站點（起）</th><th>送貨站點（迄）</th><th>貨物</th><th>異常回報</th></tr></thead><tbody>${body}</tbody></table></div>
    </div>
    ${log.length ? `<div class="card"><div class="card-title">實登歷程</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>實登人員</th><th>車輛</th><th>司機</th><th>起訖里程</th><th>行駛里程</th></tr></thead><tbody>
      ${log.map(l => { const x = l.snapshot; return `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td>
        <td>${usageVehText(x.vehicle)}</td><td>${drvNm(x.driver1)}</td>
        <td>${usageKm(x.startKm)} → ${usageKm(x.endKm)}</td><td>${usageKm(x.distance)} km</td></tr>`; }).join('')}
      </tbody></table></div></div>` : ''}
    ${backBar('aud-back')}`;
  $('#aud-back').onclick = () => { Object.assign(st, { view: 'list', editInc: null }); RENDER.a_usage(); };
  const showDist = () => {
    const s = $('#aud-start').value, e = $('#aud-end').value, el = $('#aud-dist');
    if (s === '' || e === '') { el.textContent = '—'; el.style.color = ''; return; }
    const d = Number(e) - Number(s);
    el.textContent = d < 0 ? '結束里程小於起始里程' : `${usageKm(Math.round(d * 10) / 10)} km`;
    el.style.color = d < 0 ? '#c0392b' : '';
  };
  $('#aud-start').oninput = showDist; $('#aud-end').oninput = showDist; showDist();
  $('#aud-save').onclick = async () => {
    const data = { vehicle: $('#aud-veh').value, driver: $('#aud-drv').value, startKm: $('#aud-start').value, endKm: $('#aud-end').value };
    const by = aUsageUser();
    const chk = ModuleA.tripUsageSave(date, shiftId, data, by, { dryRun: true });
    if (!chk.ok) { toast(chk.error, 'err'); return; }
    const ok = await confirmDialog({ title: u ? '確認修改實登？' : '確認儲存實登？',
      text: `${usageVehText(data.vehicle)}｜司機 ${drvNm(data.driver)}｜里程 ${usageKm(data.startKm)} → ${usageKm(data.endKm)}，行駛 <b>${usageKm(chk.usage.distance)}</b> km。<br>本車次 ${apps.length} 張申請單將${u ? '同步更新實登' : '轉為「已回登」'}${u ? '，前次紀錄保留於實登歷程' : ''}。` });
    if (!ok) return;
    const res = ModuleA.tripUsageSave(date, shiftId, data, by);
    if (!res.ok) { toast(res.error, 'err'); return; }
    toast(`${date}｜${sh.label} ${u ? '實登已修改' : '已完成實登'}`, 'ok');
    RENDER.a_usage();
  };
  const find = id => apps.find(x => x.id === id);
  $$('#page-a_usage [data-incedit]').forEach(b => b.onclick = () => { st.editInc = b.dataset.incedit; RENDER.a_usage(); });
  $$('#page-a_usage [data-inccancel]').forEach(b => b.onclick = () => { st.editInc = null; RENDER.a_usage(); });
  $$('#page-a_usage [data-incsave]').forEach(b => b.onclick = async () => {
    const a = find(b.dataset.incsave), val = $('#a_usage-inc-sel').value;
    if (val === (a.incident || '')) { st.editInc = null; RENDER.a_usage(); return; }
    if (!(await confirmDialog({ title: '確認修改異常回報？',
      text: `${a.id}：${incidentLabel(a.incident)} → <b>${incidentLabel(val)}</b>${val ? '。存檔後將自動寄信通知申請人＋直屬主管。' : ''}` }))) return;
    const res = ModuleA.setIncident(a, val);
    if (!res.ok) { toast(res.error, 'err'); return; }
    st.editInc = null;
    toast(val ? `${a.id} 異常已回報（${incidentLabel(val)}）並寄信（示意）` : `${a.id} 已設為正常運送`, 'ok');
    RENDER.a_usage();
  });
  $$('#page-a_usage [data-aitems]').forEach(b => b.onclick = () => openUsageItems('a_usage', find(b.dataset.aitems),
    a => `${a.applicant}｜${stnName(a.pickStation)} → ${stnName(a.station)}${a.building ? ' / ' + a.building : ''}`));
  initMasonry(p);
}
// 「明細」視窗：顯示該單貨物清單＋貨品回報狀態（正常運送／不運送／不接收，G120／G121）；k＝實登單元、sub＝說明列
function openUsageItems(k, r, sub) {
  usageUi[k].editItem = null;
  openModal(`貨物清單 · ${r.id}`, `
    <div class="card-desc">${sub(r)}。每項貨品預設「正常運送」；點左側<b>編輯</b>可將回報狀態改為不運送或不接收。</div>
    <div id="${k}-d-items"></div>`);
  renderItemReportGrid(k, r);
}

/* ============================================================
   模組 B／C／D · 車輛使用實登（B G124／C G125／D G126）— 以「派車單」為單位
   index：查詢條件＋派車單 grid（運輸主管簽審通過者，最左「明細」）；
   detail：派車單資訊（實際車種類型／車號／駕駛人1／駕駛人2、起訖里程、行駛里程、實登人員，儲存即完成實登）
   ＋本派車單的單據 grid（B 託運單「明細」＝貨物清單與貨品回報 G120；C 申請單「明細」＝申請內容；D＝申請內容＋隨行貨物）。
   資料邏輯在 ModuleB／ModuleC／ModuleD.dispatchUsageSave（共用 Usage.saveGroup）。D 一單一派車單。
   ============================================================ */
const DISP_USAGE = {
  b_usage: {
    M: () => ModuleB, apps: d => ModuleB.dispatchOrders(d), appName: '託運單', dateLabel: '派車日',
    cols: ['單號', '申請人', '方向', '路線', '派遣模式', '貨量', '收貨', '送達', '狀態'],
    row: o => `<td><b style="color:var(--navy);">${o.id}</b></td><td>${o.applicant}</td><td>${bDirBadge(o)}</td><td>${bRoute(o)}</td>
      <td>${o.dispatchMode === '直達' ? '<span class="badge b-amber">直達</span>' : '<span class="badge b-navy">非直達</span>'}</td>
      <td>${o.volume}L</td><td>${o.pickupTime || '—'}</td><td>${o.dispatchDropTime || '—'}</td><td>${Flow.badge(o)}</td>`,
    detailDesc: '點<b>明細</b>開啟該託運單的貨物清單，可回報貨品狀態（正常運送／不運送／不接收，G120）。',
    openDetail: o => openUsageItems('b_usage', o, x => `${x.applicant}｜${bRoute(x)}`),
  },
  c_usage: {
    M: () => ModuleC, apps: d => ModuleC.dispatchApps(d), appName: '申請單', dateLabel: '出發日期',
    cols: ['單號', '申請人', '型態', '路線', '出發', '人數', '狀態'],
    row: a => `<td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td><td>${a.type === 'round' ? '來回' : '單程'}</td>
      <td>${cRoute(a)}</td><td>${a.departDate.slice(5)} ${cTimeText(a)}</td><td>${a.pax}</td><td>${Flow.badge(a)}</td>`,
    detailDesc: '點<b>明細</b>查看該申請單的申請內容（出發地／目的地、去回程時間、人數）。',
    openDetail: a => openModal(`申請內容 · ${a.id}`, infoGrid('c_usage-app', SIGN_UNITS.c_sign.infoItems(a).join(''))),
  },
  // 一般用車：一單一派車單（G126）；自駕單駕駛人1 可登「使用者自駕」
  d_usage: {
    M: () => ModuleD, apps: d => ModuleD.dispatchApps(d), appName: '申請單', dateLabel: '用車日期', allowSelf: d => !!d.selfDrive,
    cols: ['單號', '申請人', '類別', '用車時段', '人數', '自駕', '狀態'],
    row: a => `<td><b style="color:var(--navy);">${a.id}</b></td><td>${a.applicant}</td><td>${dCatBadge(a)}</td>
      <td>${dPeriodShort(a)}</td><td>${a.pax}</td><td>${a.selfDrive ? '是' : '否'}</td><td>${Flow.badge(a)}</td>`,
    detailDesc: '點<b>明細</b>查看該申請單的申請內容與隨行貨物。',
    openDetail: a => {
      openModal(`申請內容 · ${a.id}`, infoGrid('d_usage-app', SIGN_UNITS.d_sign.infoItems(a).join(''))
        + '<div class="card-title" style="margin-top:12px;">隨行貨物</div><div id="d_usage-app-items"></div>');
      renderCargoGrid('#d_usage-app-items', a.items || [], false, null, { hazard: true, emptyText: '無隨行貨物。' });
    },
  },
};
// 駕駛顯示：使用者自駕（SELF）顯示為「使用者自駕」
const duDrv = id => id === Usage.SELF ? '使用者自駕' : drvNm(id);
// 派車單狀態（依單據推導）：全數已回登＝已回登；有已出車＝已出車；否則待出車
function dispFlowBadge(k, d) {
  const ks = DISP_USAGE[k].apps(d).map(o => Flow.of(o));
  return ks.length && ks.every(x => x === 'logged') ? '<span class="badge b-green">已回登</span>'
    : ks.some(x => ['departed', 'logged'].includes(x)) ? '<span class="badge b-green">已出車</span>' : '<span class="badge b-navy">待出車</span>';
}
Object.keys(DISP_USAGE).forEach(k => {
  Object.assign(usageUi[k], { dispId: null });
  RENDER[k] = () => {
    const p = $('#page-' + k);
    if (usageUi[k].view === 'detail') return renderDispUsageDetail(k, p);
    return renderDispUsageList(k, p);
  };
});
function dispUsageRows(k) {
  const c = DISP_USAGE[k], q = usageUi[k].query, kw = (q.kw || '').trim();
  return c.M().usageDispatches().filter(d => {
    const os = c.apps(d);
    return (!kw || d.id.includes(kw) || (d.vehicle || '').includes(kw) || (d.usage && d.usage.vehicle.includes(kw))
        || os.some(o => o.id.includes(kw) || (o.applicant || '').includes(kw)))
      && (!q.status || (q.status === 'done') === !!d.usage);
  }).sort((x, y) => (x.usage ? 1 : 0) - (y.usage ? 1 : 0) || y.date.localeCompare(x.date) || x.id.localeCompare(y.id));
}
function renderDispUsageList(k, p) {
  const c = DISP_USAGE[k], q = usageUi[k].query;
  const todo = c.M().usageDispatches().filter(d => !d.usage).length;
  const stOpts = USAGE_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">車輛使用實登（業務）</div>
    <div class="section-sub">以<b>派車單</b>為單位實登：派車單經運輸主管簽審<b>通過（生效）</b>後出現在下方；點「明細」確認實際使用的車種類型、車號、駕駛人1／駕駛人2，輸入起始／結束里程並儲存即完成實登，派車單內每張${c.appName}轉為「已回登」。實登可修改，每次儲存都保留歷程。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <button class="btn btn-primary btn-sm" id="${k}-q-search">🔍 查詢</button>
      </div>
      ${infoGrid(`${k}-q`, [
        fInput(`派車單號／${c.appName}號／申請人／車號（模糊）`, `<input type="text" id="${k}-q-kw" value="${gEsc(q.kw)}" placeholder="輸入派車單號、${c.appName}號、姓名/部門或車號關鍵字">`),
        fInput('實登狀態', `<select id="${k}-q-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車單</span>
        <span>${todo ? `<span class="badge b-amber">待實登 ${todo} 張</span> ` : ''}<span class="muted" id="${k}-count"></span></span></div>
      <div id="${k}-grid"></div>
    </div>`;
  $(`#${k}-q-search`).onclick = () => {
    usageUi[k].query = { kw: $(`#${k}-q-kw`).value.trim(), status: $(`#${k}-q-status`).value };
    renderDispUsageGrid(k); toast('查詢完成', 'ok');
  };
  renderDispUsageGrid(k);
  initMasonry(p);
}
function renderDispUsageGrid(k) {
  const c = DISP_USAGE[k], box = $(`#${k}-grid`); if (!box) return;
  const rows = dispUsageRows(k);
  $(`#${k}-count`).textContent = `${rows.length} 張`;
  box.innerHTML = rows.length === 0
    ? `<div class="empty"><div class="big">⛽</div>查無派車單。派車單經運輸主管簽審通過後，會出現在這裡等待實登。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>派車單號</th><th>${c.dateLabel}</th><th>車種類型</th><th>車號</th><th>駕駛人1</th><th>駕駛人2</th><th>${c.appName}數</th><th>派車單狀態</th><th>實登狀態</th><th>行駛里程</th></tr></thead><tbody>
      ${rows.map(d => { const u = d.usage, v = u || { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: d.driver2 };
        return `<tr>
        <td><button class="btn btn-ghost btn-sm" data-key="${d.id}">明細</button></td>
        <td><b style="color:var(--navy);">${d.id}</b></td><td>${d.date}</td>
        <td>${v.vehicleType || '—'}</td><td>${usageVehText(v.vehicle)}</td>
        <td>${v.driver1 ? duDrv(v.driver1) : (d.selfDrive ? '使用者自駕' : '—')}</td><td>${v.driver2 ? duDrv(v.driver2) : '—'}</td>
        <td>${c.apps(d).length}</td><td>${dispFlowBadge(k, d)}</td>
        <td><span class="badge ${u ? 'b-green' : 'b-amber'}">${u ? '已實登' : '待實登'}</span></td>
        <td>${u ? `<b>${usageKm(u.distance)}</b> km` : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">已實登者顯示實登的車輛與駕駛；點擊左側「明細」登打（或修改）實登。</div>`;
  $$(`#${k}-grid [data-key]`).forEach(b => b.onclick = () => {
    Object.assign(usageUi[k], { dispId: b.dataset.key, view: 'detail' }); RENDER[k]();
  });
}
function renderDispUsageDetail(k, p) {
  const c = DISP_USAGE[k], M = c.M(), st = usageUi[k], d = M.usageDispatches().find(x => x.id === st.dispId);
  if (!d) { st.view = 'list'; return RENDER[k](); }
  const os = c.apps(d), u = d.usage, pool = M.USAGE_POOL, f = `${k}-du`, self = !!(c.allowSelf && c.allowSelf(d));
  const dv = u ? Object.assign({}, u) : { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1 || (self ? Usage.SELF : ''), driver2: d.driver2 || '', startKm: '', endKm: '' };
  const opt = (v, t, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`;
  const drvOpts = (cur, blank, withSelf) => opt('', blank, cur) + (withSelf ? opt(Usage.SELF, `使用者自駕（${os[0] ? os[0].applicant : ''}）`, cur) : '')
    + Usage.driversOf(pool).map(x => opt(x.id, `${x.name}（${x.id}）`, cur)).join('');
  const diffs = Usage.diffs(d, { vehicle: d.vehicle, drivers: [d.driver1, d.driver2].filter(Boolean) });
  p.innerHTML = `
    <div class="section-h">車輛使用實登明細 · 派車單 ${d.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>派車單資訊</span>
        <span>${dispFlowBadge(k, d)} <span class="badge ${u ? 'b-green' : 'b-amber'}">${u ? '已實登' : '待實登'}</span></span></div>
      ${diffs.length ? `<div class="callout" style="margin-bottom:12px;">實際使用的<b>${diffs.join('、')}</b>與派車單不同。</div>` : ''}
      ${infoGrid(`${f}-info`, [
        fItem('派車單號', `<b style="color:var(--navy);">${d.id}</b>`),
        fItem(c.dateLabel, d.date),
        fItem('派遣人', d.dispatcher),
        fItem('派遣時間', fmtTime(d.dispatchedAt)),
        fInput('車種類型 <span class="hint">可修改</span>', `<select id="${f}-type">${opt('', '請選擇', dv.vehicleType)}${Usage.types(pool).map(t => opt(t, t, dv.vehicleType)).join('')}</select>`),
        fInput('車號 <span class="hint">可修改</span>', `<select id="${f}-veh"></select>`),
        fInput('駕駛人1 <span class="hint">可修改</span>', `<select id="${f}-d1">${drvOpts(dv.driver1, '請選擇', self)}</select>`),
        fInput('駕駛人2', `<select id="${f}-d2">${drvOpts(dv.driver2, '（無）')}</select>`),
        fInput('起始里程（km）<span style="color:#c0392b;">*</span>', `<input type="number" min="0" step="0.1" id="${f}-start" value="${dv.startKm}" placeholder="出車時里程表讀數">`),
        fInput('結束里程（km）<span style="color:#c0392b;">*</span>', `<input type="number" min="0" step="0.1" id="${f}-end" value="${dv.endKm}" placeholder="還車時里程表讀數">`),
        fItem('行駛里程', `<b id="${f}-dist">—</b>`),
        fItem('實登人員 <span class="hint">系統自動帶入</span>', u ? `${u.by}<span class="muted">｜${fmtTime(u.at)}</span>` : aUsageUser()),
      ].join(''))}
      <div style="margin-top:6px;"><button class="btn btn-primary btn-sm" id="${f}-save">💾 ${u ? '儲存修改' : '儲存實登'}</button>
        <span class="hint" style="margin-left:8px;">車種類型／車號／駕駛人預設帶入派車單，實際使用不同請直接修改（只記錄實登，不改派車單）；結束里程不可小於起始里程。</span></div>
    </div>
    <div class="card">
      <div class="card-title">本派車單${c.appName}（${os.length} 筆）</div>
      <div class="card-desc">${c.detailDesc}</div>
      <div class="table-wrap"><table class="dt"><thead><tr>
        <th></th>${c.cols.map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>
        ${os.map(o => `<tr><td><button class="btn btn-ghost btn-sm" data-dudetail="${o.id}">明細</button></td>${c.row(o)}</tr>`).join('')}
      </tbody></table></div>
    </div>
    ${(d.usageLog || []).length ? `<div class="card"><div class="card-title">實登歷程</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>實登人員</th><th>車號</th><th>駕駛</th><th>起訖里程</th><th>行駛里程</th></tr></thead><tbody>
      ${d.usageLog.map(l => { const x = l.snapshot; return `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${l.by}</td>
        <td>${x.vehicle}（${x.vehicleType}）</td><td>${[x.driver1, x.driver2].filter(Boolean).map(duDrv).join('＋')}</td>
        <td>${usageKm(x.startKm)} → ${usageKm(x.endKm)}</td><td>${usageKm(x.distance)} km</td></tr>`; }).join('')}
      </tbody></table></div></div>` : ''}
    ${backBar(`${f}-back`)}`;
  $(`#${f}-back`).onclick = () => { st.view = 'list'; RENDER[k](); };
  const fillVeh = cur => {
    const t = $(`#${f}-type`).value;
    $(`#${f}-veh`).innerHTML = opt('', t ? '請選擇' : '請先選車種類型', cur)
      + (t ? Usage.vehiclesOf(pool, t).map(v => opt(v.id, `${v.id}（${v.name}）`, cur)).join('') : '');
  };
  fillVeh(dv.vehicle);
  $(`#${f}-type`).onchange = () => fillVeh('');
  const showDist = () => {
    const s = $(`#${f}-start`).value, e = $(`#${f}-end`).value, el = $(`#${f}-dist`);
    if (s === '' || e === '') { el.textContent = '—'; el.style.color = ''; return; }
    const n = Number(e) - Number(s);
    el.textContent = n < 0 ? '結束里程小於起始里程' : `${usageKm(Math.round(n * 10) / 10)} km`;
    el.style.color = n < 0 ? '#c0392b' : '';
  };
  $(`#${f}-start`).oninput = showDist; $(`#${f}-end`).oninput = showDist; showDist();
  $(`#${f}-save`).onclick = async () => {
    const data = { vehicleType: $(`#${f}-type`).value, vehicle: $(`#${f}-veh`).value, driver1: $(`#${f}-d1`).value, driver2: $(`#${f}-d2`).value,
      startKm: $(`#${f}-start`).value, endKm: $(`#${f}-end`).value };
    const by = aUsageUser();
    const chk = M.dispatchUsageSave(d, data, by, { dryRun: true });
    if (!chk.ok) { toast(chk.error, 'err'); return; }
    const ok = await confirmDialog({ title: u ? '確認修改實登？' : '確認儲存實登？',
      text: `${data.vehicle}（${data.vehicleType}）｜駕駛 ${[data.driver1, data.driver2].filter(Boolean).map(duDrv).join('＋')}｜里程 ${usageKm(data.startKm)} → ${usageKm(data.endKm)}，行駛 <b>${usageKm(chk.usage.distance)}</b> km。<br>本派車單 ${os.length} 張${c.appName}將${u ? '同步更新實登，前次紀錄保留於實登歷程' : '轉為「已回登」'}。` });
    if (!ok) return;
    const res = M.dispatchUsageSave(d, data, by);
    if (!res.ok) { toast(res.error, 'err'); return; }
    toast(`派車單 ${d.id} ${u ? '實登已修改' : '已完成實登'}`, 'ok');
    RENDER[k]();
  };
  $$(`#page-${k} [data-dudetail]`).forEach(b => b.onclick = () => c.openDetail(os.find(x => x.id === b.dataset.dudetail)));
  initMasonry(p);
}

/* ============================================================
   共用單元：申請引導（建議規格 v0.2）
   需求表單＋依填寫內容出現的卡片（K1～K7）；判定邏輯在 guide.js（Guide）。
   只分流、不送單：按「前往並帶入」後把資料放進目標單元的 prefill，於新增畫面帶入一次。
   ============================================================ */
// view：list（查詢＋引導紀錄 grid）／detail（紀錄歷史）／new（引導表單）；recId＝回到修改中的紀錄
let guideState = { view: 'list', detailId: null, query: { applicant: '', unit: '', status: '' }, resultIds: null, v: null, recId: null, shown: [] };
function guideDefaults() {
  return { applicant: `${DB.currentUser.unit}-${DB.currentUser.name}`, dept: DB.currentUser.unit, ext: DB.currentUser.ext,
    mode: '', fromSite: '', toSite: '', recvDate: Guide.todayStr(), recvTime: '', hazardTransport: '', items: [],
    startDate: '', endDate: '',
    origin: '', dest: '', otherPlace: '', tripType: 'round', departTime: '09:00', backTime: '17:00', pax: 1,
    hasCargo: '', personalItems: '', selfDrive: null };
}
const gEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// 單選膠囊：opts = [[value, 文字], ...]；cur 為目前值（布林以 'yes'/'no' 表示）
function gPills(name, cur, opts) {
  return `<div class="radio-group" id="${name}-wrap">${opts.map(([val, txt]) =>
    `<label class="radio-pill${cur === val ? ' sel' : ''}"><input type="radio" name="${name}" value="${val}"${cur === val ? ' checked' : ''}>${txt}</label>`).join('')}</div>`;
}
const gYN = b => b === true ? 'yes' : (b === false ? 'no' : '');

RENDER.guide = function () {
  const p = $('#page-guide');
  if (guideState.view === 'new') return renderGuideNew(p);
  if (guideState.view === 'detail') return renderGuideDetail(p, guideState.detailId);
  return renderGuideList(p);
};

/* ---------- 查詢畫面（index）---------- */
const G_STATUS_OPTS = [['', '全部'], ['handed', '已帶入待送出'], ['submitted', '已送出申請']];
function gStBadge(st) { const [t, c] = Guide.STATUS[st] || [st, 'b-gray']; return `<span class="badge ${c}">${t}</span>`; }
function gUnitTxt(k) { const u = Guide.UNITS[k]; return u ? `${u.module} · ${u.name}` : '—'; }
function renderGuideList(p) {
  const q = guideState.query;
  const stOpts = G_STATUS_OPTS.map(([v, t]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${t}</option>`).join('');
  const uOpts = `<option value="">全部</option>` + Object.entries(Guide.UNITS)
    .map(([k, u]) => `<option value="${k}" ${q.unit === k ? 'selected' : ''}>${u.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">申請引導</div>
    <div class="section-sub">不確定該用哪一種申請？按右上角「＋ 新增」開始引導：依填寫內容出現需要的卡片、判定適用的申請功能，並把已填資料帶入該功能的新增畫面（<b>送出一律在該功能完成</b>）。每次帶入都會留下引導紀錄，目標功能送出後自動回填申請單號。</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>查詢條件</span>
        <span>
          <button class="btn btn-primary btn-sm" id="gq-search">🔍 查詢</button>
          <button class="btn btn-accent btn-sm" id="gq-new">＋ 新增</button>
        </span>
      </div>
      ${infoGrid('gq-fields', [
        fInput('申請人（模糊）', `<input type="text" id="gq-applicant" value="${gEsc(q.applicant)}" placeholder="輸入姓名/部門關鍵字">`),
        fInput('判定功能', `<select id="gq-unit">${uOpts}</select>`),
        fInput('狀態', `<select id="gq-status">${stOpts}</select>`),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <span>歷史引導紀錄</span>
        <span><span class="muted" id="gq-count"></span>
          <button class="btn btn-ghost btn-sm" id="gq-demo" style="margin-left:10px;">載入範例</button></span>
      </div>
      <div id="gq-grid"></div>
    </div>`;
  $('#gq-search').onclick = () => runGuideQuery();
  $('#gq-new').onclick = () => { guideState.v = guideDefaults(); guideState.recId = null; guideState.view = 'new'; RENDER.guide(); };
  $('#gq-demo').onclick = () => { loadGuideDemo(); guideState.resultIds = null; renderGuideGrid(); };
  renderGuideGrid();
  initMasonry(p);
}
function runGuideQuery() {
  guideState.query = { applicant: $('#gq-applicant').value.trim(), unit: $('#gq-unit').value, status: $('#gq-status').value };
  const q = guideState.query;
  const res = Guide.records.filter(r =>
    (!q.applicant || (r.applicant || '').includes(q.applicant)) &&
    (!q.unit || r.unit === q.unit) && (!q.status || r.status === q.status));
  guideState.resultIds = res.map(r => r.id);
  renderGuideGrid();
  toast(`查詢完成，共 ${res.length} 筆`, 'ok');
}
function renderGuideGrid() {
  if (!$('#gq-grid')) return;
  const rows = guideState.resultIds == null ? Guide.records
    : guideState.resultIds.map(id => Guide.records.find(r => r.id === id)).filter(Boolean);
  $('#gq-count').textContent = `${rows.length} 筆`;
  $('#gq-grid').innerHTML = rows.length === 0
    ? `<div class="empty"><div class="big">🧭</div>尚無引導紀錄；按右上角「＋ 新增」開始引導，或按「載入範例」。</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr>
      <th></th><th>引導編號</th><th>申請人</th><th>需求摘要</th><th>判定功能</th><th>規則</th><th>狀態</th><th>申請單號</th><th>建立時間</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td><button class="btn btn-ghost btn-sm" data-gdetail="${r.id}">細節</button></td>
        <td><b style="color:var(--navy);">${r.id}</b></td><td>${gEsc(r.applicant)}</td><td>${gEsc(r.summary)}</td>
        <td>${gUnitTxt(r.unit)}</td><td><span class="g-tag">${r.rule}</span></td><td>${gStBadge(r.status)}</td>
        <td>${r.appId ? `<b>${r.appId}</b>` : r.draftAppId ? `<span class="muted">${r.draftAppId}（申請中）</span>` : '<span class="muted">—</span>'}</td>
        <td class="muted">${fmtTime(r.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:8px;">點擊左側「細節」可查看該次引導的填寫內容、判定結果與歷程（回到修改／查看申請單於明細操作）。</div>`;
  $$('#gq-grid [data-gdetail]').forEach(b => b.onclick = () => {
    guideState.detailId = b.dataset.gdetail; guideState.view = 'detail'; RENDER.guide();
  });
}
// 範例：巡迴物品轉運申請（待送出）、差旅共乘申請（已送出，實際建立申請單）、一般用車申請（待送出）
function loadGuideDemo() {
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
  const base = o => Object.assign(guideDefaults(), o);
  const box = { name: '文件箱', l: 40, w: 30, h: 30, qty: 2, category: 'BOX', weight: 5 };
  Guide.hand(base({ applicant: '研發部-吳承恩', dept: '研發部', ext: '4102', mode: 'goods', fromSite: 'D6', toSite: 'D6', items: [box] }));
  const c = Guide.hand(base({ applicant: '財務部-鄭安琪', dept: '財務部', ext: '3310', mode: 'people', startDate: d(3), endDate: d(3),
    origin: '台北總部', dest: '高鐵台北站', departTime: '08:30', backTime: '18:00', pax: 2, hasCargo: 'no' }));
  const app = ModuleC.createApp(c.pf.data);
  Guide.markSubmitted(c.rec.id, app.id);
  Guide.hand(base({ mode: 'people', startDate: d(7), endDate: d(8), origin: '台北總部', dest: Guide.OTHER, otherPlace: '新竹科學園區客戶（多點洽公）',
    pax: 3, hasCargo: 'no', selfDrive: true }));
  toast(`已載入 3 筆引導紀錄（其中 1 筆已送出 ${app.id}）`, 'ok');
}

/* ---------- 明細畫面（該次引導的歷史資料）---------- */
function renderGuideDetail(p, id) {
  const r = Guide.records.find(x => x.id === id);
  if (!r) { guideState.view = 'list'; return RENDER.guide(); }
  const v = r.v, cards = Guide.visibleCards(v), u = Guide.UNITS[r.unit];
  const yn = (b, y, n) => b === true ? y : (b === false ? n : '—');
  const dash = x => (x === '' || x == null) ? '<span class="muted">—</span>' : gEsc(x);
  const filled = [fItem('申請人', `${gEsc(v.applicant)}${v.dept ? `（${gEsc(v.dept)}/${gEsc(v.ext)}）` : ''}`),
    fItem('運送內容', v.mode === 'goods' ? '只寄送物品（無人隨行）' : '有人要搭車')];
  if (cards.includes('K2')) filled.push(fItem('寄件據點', Guide.siteName(v.fromSite)), fItem('收件據點', Guide.siteName(v.toSite)),
    fItem('希望收貨', `${dash(v.recvDate)} ${v.recvTime || '（越快越好）'}`),
    fItem('危險品運輸', v.hazardTransport === 'yes' ? '是' : v.hazardTransport === 'no' ? '否' : dash('')));
  if (cards.includes('K4')) filled.push(fItem('用車期間', `${v.startDate} ～ ${v.endDate}（${Guide.days(v.startDate, v.endDate)} 天）`, { w2: true }));
  if (cards.includes('K6')) {
    filled.push(fItem('地點', `${Guide.placeName(v.origin)} → ${Guide.placeName(v.dest)}`, { w2: true }));
    if (v.origin === Guide.OTHER || v.dest === Guide.OTHER) filled.push(fItem('其他地點說明', dash(v.otherPlace), { w2: true }));
    const share = r.unit === 'C';
    if (share) filled.push(fItem('行程型態', v.tripType === 'oneway' ? '單程（送到轉運點）' : '來回'));
    filled.push(fItem('出發時間', dash(v.departTime)));
    if (!(share && v.tripType === 'oneway')) filled.push(fItem(share ? '回程上車時間' : '結束時間', dash(v.backTime)));
    filled.push(fItem('人數', `${v.pax} 人`), fItem('隨行物品', v.hasCargo === 'yes'
      ? (v.personalItems === 'yes' ? '有（屬於隨身物品）' : v.personalItems === 'no' ? '有（不屬於隨身物品）' : '有') : '沒有'));
    if (r.unit === 'D') filled.push(fItem('可否自己開車', yn(v.selfDrive, '可以', '不行')));
  }
  const acts = [];
  if (r.status === 'handed') acts.push(`<button class="btn btn-primary" id="gd-edit">✎ 回到引導修改</button>`);
  if (r.appId || r.draftAppId) acts.push(`<button class="btn btn-primary" id="gd-app">📄 查看申請單 ${r.appId || r.draftAppId}${r.appId ? '' : '（申請中）'}</button>`);
  acts.push(`<button class="btn btn-ghost" id="gd-copy">⧉ 以此內容新增引導</button>`);
  p.innerHTML = `
    <div class="section-h">申請引導明細 · ${r.id}</div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${gStBadge(r.status)}</div>
      ${infoGrid('gd-basic', [
        fItem('引導編號', `<b style="color:var(--navy);">${r.id}</b>`),
        fItem('申請人', gEsc(r.applicant)),
        fItem('建立時間', fmtTime(r.createdAt)),
        fItem('判定功能', `<b>${gUnitTxt(r.unit)}</b> <span class="g-tag">${r.rule}</span>`, { w2: true }),
        fItem('申請單號', r.appId ? `<b>${r.appId}</b>（${fmtTime(r.submittedAt)} 送出）` : r.draftAppId ? `${r.draftAppId}（已暫存為申請中，送出後回填）` : '<span class="muted">尚未送出</span>'),
      ].join(''))}
    </div>
    <div class="card">
      <div class="card-title">填寫內容</div>
      ${infoGrid('gd-filled', filled.join(''))}
    </div>
    ${cards.includes('K3') ? `<div class="card"><div class="card-title">貨物清單</div><div id="gd-items"></div></div>` : ''}
    <div class="card">
      <div class="card-title">判定結果</div>
      ${infoGrid('gd-result', [
        fItem('判定理由', r.reason, { full: true }),
        fItem('帶入內容', r.labels.join('、'), { full: true }),
      ].join(''))}
      ${r.warnings.length ? `<div class="callout" style="margin-top:10px;">⚠ ${r.warnings.join('<br>')}</div>` : ''}
    </div>
    <div class="card"><div class="card-title">歷程紀錄</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>時間</th><th>動作</th><th>操作人</th><th>說明</th></tr></thead><tbody>
      ${r.log.map(l => `<tr><td>${fmtTime(l.at)}</td><td>${l.action}</td><td>${gEsc(l.by)}</td><td>${gEsc(l.note) || '—'}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card">
      <div class="card-title">操作</div>
      <div class="card-desc">${r.status === 'handed'
        ? `資料已帶入「${u.name}」但尚未送出：可回到引導修改內容後重新判定並帶入（同一筆紀錄）。`
        : `已於「${u.name}」送出申請，引導內容不可再修改；如需另提申請可「以此內容新增引導」。`}</div>
      <div>${acts.join(' ')}</div>
    </div>
    ${backBar('gd-back')}`;
  if (cards.includes('K3')) renderCargoGrid('#gd-items', v.items, false, null, { hazard: true });
  $('#gd-back').onclick = () => { guideState.view = 'list'; RENDER.guide(); };
  const ed = $('#gd-edit');
  if (ed) ed.onclick = () => guideEdit(r.id);
  const ap = $('#gd-app');
  if (ap) ap.onclick = () => { const st = guideUnitState(r.unit); st.view = 'detail'; st.detailId = r.appId || r.draftAppId; goto(u.page); };
  $('#gd-copy').onclick = () => {
    guideState.v = JSON.parse(JSON.stringify(r.v)); guideState.recId = null; guideState.view = 'new'; RENDER.guide();
    toast(`已複製 ${r.id} 的內容，可修改後重新判定`);
  };
  initMasonry(p);
}
// 回到引導修改（細節頁或目標功能提示條）：載入該紀錄的填寫內容，重新帶入時更新同一筆
function guideEdit(recId) {
  const v = Guide.reopen(recId);
  if (!v) { toast('此引導已送出申請，不可再修改', 'err'); guideState.view = 'list'; goto('guide'); return; }
  guideState.v = v; guideState.recId = recId; guideState.view = 'new';
  goto('guide');
}

/* ---------- 新增畫面（引導表單）---------- */
function renderGuideNew(p) {
  if (!guideState.v) guideState.v = guideDefaults();
  guideState.shown = [];
  const v = guideState.v;
  const siteOpts = sel => `<option value="">— 請選擇 —</option>` + DB.sites.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${s.name}</option>`).join('');
  const placeOpts = (list, sel, otherTxt) => `<option value="">— 請選擇 —</option>`
    + list.map(x => `<option${x === sel ? ' selected' : ''}>${x}</option>`).join('')
    + `<option value="${Guide.OTHER}"${sel === Guide.OTHER ? ' selected' : ''}>${otherTxt}</option>`;
  const card = (k, title, desc, body, extra) => `
    <div class="card" id="gk-${k}" style="display:none;">
      <div class="card-title"${extra ? ' style="justify-content:space-between;"' : ''}><span class="g-t">${title}</span>${extra || ''}</div>
      ${desc ? `<div class="card-desc">${desc}</div>` : ''}
      ${body}
    </div>`;
  const rid = guideState.recId;
  p.innerHTML = `
    <div class="section-h">${rid ? `修改申請引導 · ${rid}` : '新增申請引導'}</div>
    <div class="section-sub">由上往下填寫即可：系統會依您填的內容<b>出現需要的卡片</b>，並在最下方「判定結果」告訴您適用的申請功能；按「前往並帶入」後，已填資料會自動帶入該功能的新增畫面，<b>確認後在該功能送出</b>。</div>
    ${rid ? `<div class="callout info" style="margin-bottom:14px;">正在修改引導紀錄 <b>${rid}</b>：重新「前往並帶入」會更新同一筆紀錄，並在歷程記下改判結果。</div>` : ''}
    ${card('K1', '需求', '', infoGrid('gg-K1', [
      fInput('申請人', `<input type="text" id="gf-applicant" value="${gEsc(v.applicant)}">`),
      fInput('部門', `<input type="text" id="gf-dept" value="${gEsc(v.dept)}">`),
      fInput('分機', `<input type="text" id="gf-ext" value="${gEsc(v.ext)}">`),
      fInput('運送內容', gPills('gf-mode', v.mode, [['goods', '📦 只寄送物品（無人隨行）'], ['people', '🚗 有人要搭車（可附帶物品）']]), { stack: true, full: true }),
    ].join('')))}
    ${card('K2', '物品寄送', '寄件與收件據點相同、非危險品且貨物小於收貨日巡迴車上限＝巡迴物品轉運；危險品、超過巡迴車上限或不同據點＝院區物品轉運。', infoGrid('gg-K2', [
      fInput('寄件據點', `<select id="gf-fromSite">${siteOpts(v.fromSite)}</select>`),
      fInput('收件據點', `<select id="gf-toSite">${siteOpts(v.toSite)}</select>`),
      fInput('希望收貨日期', `<input type="date" id="gf-recvDate" min="${Guide.todayStr()}" value="${gEsc(v.recvDate)}">`),
      fInput('希望收貨時間 <span class="hint">選填；不填＝越快越好</span>', `<input type="time" id="gf-recvTime" value="${gEsc(v.recvTime)}">`),
      fInput('危險品運輸', gPills('gf-hazardTransport', v.hazardTransport, [['yes', '是'], ['no', '否']]), { stack: true }),
    ].join('')))}
    ${card('K4', '用車期間', '起訖含當日計算；多天用車請填實際起訖日。', infoGrid('gg-K4', [
      fInput('起日', `<input type="date" id="gf-startDate" value="${gEsc(v.startDate)}">`),
      fInput('迄日', `<input type="date" id="gf-endDate" value="${gEsc(v.endDate)}">`),
      fItem('天數', `<span id="gf-days">—</span>`),
    ].join('')))}
    ${card('K6', '行程', '出發地／目的地都在共乘清單，且沒有隨行物品或只有隨身物品時可自動併車共乘；其他地點選「其他」。', infoGrid('gg-K6', [
      fInput('出發地', `<select id="gf-origin">${placeOpts(DB.bizOrigins, v.origin, '其他地點')}</select>`),
      fInput('目的地', `<select id="gf-dest">${placeOpts(DB.bizDests, v.dest, '其他地點／多點')}</select>`),
      fInput('其他地點說明', `<input type="text" id="gf-otherPlace" value="${gEsc(v.otherPlace)}" placeholder="例：新竹科學園區客戶（多點洽公）">`, { w2: true }),
      fInput('行程型態 <span class="hint">單程限目的地為交通轉運點</span>', gPills('gf-tripType', v.tripType, [['round', '來回'], ['oneway', '單程（送到轉運點）']]), { stack: true, w2: true }),
      fInput('出發時間', `<input type="time" id="gf-departTime" value="${gEsc(v.departTime)}">`),
      fInput(`<span id="gf-backLabel">結束時間</span>`, `<input type="time" id="gf-backTime" value="${gEsc(v.backTime)}">`),
      fInput('人數', `<input type="number" id="gf-pax" min="1" step="1" value="${gEsc(v.pax)}">`),
      fInput('隨行物品', gPills('gf-hasCargo', v.hasCargo, [['no', '沒有'], ['yes', '有']]), { stack: true }),
      fInput('屬於隨身物品 <span class="hint">隨身物品仍可共乘</span>', gPills('gf-personalItems', v.personalItems, [['yes', '是'], ['no', '否']]), { stack: true }),
      fInput('沒有司機時可否自己開車', gPills('gf-selfDrive', gYN(v.selfDrive), [['yes', '可以'], ['no', '不行']]), { stack: true, w2: true }),
    ].join('')))}
    ${card('K3', '貨物清單', '欄位比照物流申請（長寬高／類別／件數／重量），並標註是否為危險品。', `<div id="gf-items"></div>`,
      `<button class="btn btn-accent btn-sm" id="gf-add-item">＋ 新增</button>`)}
    ${card('K7', '判定結果', '', `<div id="gr-body"></div>`)}
    <div style="text-align:center;margin-top:6px;"><button class="btn btn-ghost" id="gf-reset">↺ 全部清除重填</button></div>
    ${backBar('gn-back')}`;
  $('#gn-back').onclick = () => { guideState.view = 'list'; guideState.recId = null; RENDER.guide(); };
  guideWire(p);
  guideRefresh(p, true);
}

function guideWire(p) {
  const v = guideState.v;
  const text = ['applicant', 'dept', 'ext', 'recvDate', 'recvTime', 'startDate', 'endDate', 'otherPlace', 'departTime', 'backTime', 'pax'];
  text.forEach(k => {
    const inp = $('#gf-' + k, p);
    const upd = () => { v[k] = k === 'pax' ? (inp.value === '' ? '' : +inp.value) : inp.value; guideRefresh(p); };
    inp.addEventListener('input', upd); inp.addEventListener('change', upd);
  });
  ['fromSite', 'toSite', 'origin', 'dest'].forEach(k => {
    $('#gf-' + k, p).onchange = e => { v[k] = e.target.value; guideRefresh(p); };
  });
  const bools = { selfDrive: 1 };
  ['mode', 'hazardTransport', 'tripType', 'hasCargo', 'personalItems', 'selfDrive'].forEach(k => {
    $$(`input[name=gf-${k}]`, p).forEach(r => r.onchange = () => {
      v[k] = bools[k] ? r.value === 'yes' : r.value;
      $$(`#gf-${k}-wrap .radio-pill`, p).forEach(l => l.classList.toggle('sel', $('input', l).checked));
      guideRefresh(p);
    });
  });
  $('#gf-add-item', p).onclick = () => openCargoEditor(null, it => { v.items.push(it); guideRefresh(p); }, { hazard: true });
  $('#gf-reset', p).onclick = confirmThen({ title: '全部清除重填？', text: '引導中已填寫的內容將清空。' }, () => {
    guideState.v = null; RENDER.guide(); toast('已清除，請重新填寫');
  });
}

function guideRefresh(p, initial) {
  const v = guideState.v;
  const cards = Guide.visibleCards(v);
  // 單程只在目的地為交通轉運點時可選；不符時退回來回
  const canOne = Guide.canOneway(v);
  const oneInp = $('input[name=gf-tripType][value=oneway]', p);
  oneInp.disabled = !canOne; oneInp.closest('.radio-pill').style.opacity = canOne ? '' : '.45';
  if (!canOne && v.tripType === 'oneway') {
    v.tripType = 'round';
    $('input[name=gf-tripType][value=round]', p).checked = true;
    $$('#gf-tripType-wrap .radio-pill', p).forEach(l => l.classList.toggle('sel', $('input', l).checked));
  }
  const r = Guide.route(v);
  // K6 內依條件出現的欄位
  const showItem = (id, on) => { const gi = $('#' + id, p).closest('.grid-item'); gi.style.display = on ? '' : 'none'; };
  const other = v.origin === Guide.OTHER || v.dest === Guide.OTHER;
  showItem('gf-otherPlace', other);
  showItem('gf-personalItems-wrap', v.hasCargo === 'yes');   // 有隨行物品才問是否屬於隨身物品（G134）
  const share = Guide.inBizList(v) && !Guide.bulkCargo(v); // 可能走出差共乘：顯示行程型態、回程上車時間
  showItem('gf-tripType-wrap', share);
  showItem('gf-backTime', !(share && v.tripType === 'oneway'));
  showItem('gf-selfDrive-wrap', r.unit === 'D');
  $('#gf-backLabel', p).textContent = share ? '回程上車時間' : '結束時間';
  const n = Guide.days(v.startDate, v.endDate);
  $('#gf-days', p).innerHTML = n == null ? (v.startDate && v.endDate ? '<span style="color:var(--red);">迄日不可早於起日</span>' : '—')
    : `${n} 天`;
  if (v.startDate) $('#gf-endDate', p).min = v.startDate;
  // 卡片顯示；新出現的卡片加「新」標記並捲到可視範圍
  const fresh = [];
  ['K1', 'K2', 'K3', 'K4', 'K6', 'K7'].forEach(k => {
    const c = $('#gk-' + k, p), on = cards.includes(k);
    c.style.display = on ? '' : 'none';
    const badge = $('.g-new', c);
    if (badge) badge.remove();
    if (on && !initial && !guideState.shown.includes(k) && k !== 'K7') {
      fresh.push(k);
      $('.card-title .g-t', c).insertAdjacentHTML('afterend', ' <span class="badge b-amber g-new">新</span>');
    }
  });
  guideState.shown = cards;
  renderCargoGrid('#gf-items', v.items, true, () => guideRefresh(p), { hazard: true, emptyText: '尚無貨物，請按右上角「新增」加入。' });
  guideResult(p, r);
  initMasonry(p);
  if (fresh.length) {
    const c = $('#gk-' + fresh[0], p);
    setTimeout(() => c.scrollIntoView && c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }
}

function guideResult(p, r) {
  const v = guideState.v, box = $('#gr-body', p);
  const selfBtns = `<div style="margin-top:14px;font-size:12.5px;color:var(--ink-soft);">或我想自己選：
    ${Object.entries(Guide.UNITS).map(([k, u]) => `<button class="btn btn-ghost btn-sm" data-gself="${k}">${u.name}</button>`).join(' ')}</div>`;
  if (!r.unit) {
    box.innerHTML = `<div class="callout info">🧭 ${r.hint}</div>${selfBtns}`;
  } else {
    const u = Guide.UNITS[r.unit], miss = Guide.missing(v), pf = miss.length ? null : Guide.prefill(v);
    box.innerHTML = `
      ${infoGrid('gg-K7', [
        fItem('將使用', `<b>${u.module} · ${u.name}</b> <span class="g-tag">${r.rule}</span>`, { full: true }),
        fItem('判定理由', r.reason, { full: true }),
        miss.length
          ? fItem('仍缺少', `<span style="color:var(--red);font-weight:600;">${miss.join('、')}</span>`, { full: true })
          : fItem('將帶入', pf.labels.join('、'), { full: true }),
      ].join(''))}
      ${pf && pf.warnings.length ? `<div class="callout" style="margin-top:10px;">⚠ ${pf.warnings.join('<br>')}</div>` : ''}
      <div style="text-align:center;margin-top:12px;">
        <button class="btn btn-primary" id="gr-go"${miss.length ? ' disabled title="請先補齊缺少的欄位"' : ''}>前往「${u.name}」並帶入 →</button>
      </div>
      ${selfBtns}`;
    $('#gr-go', box).onclick = () => guideGo();
  }
  $$('[data-gself]', box).forEach(b => b.onclick = () => {
    const st = guideUnitState(b.dataset.gself);
    st.view = 'new'; if ('editId' in st) st.editId = null; st.prefill = null;
    goto(Guide.UNITS[b.dataset.gself].page);
  });
}

function guideUnitState(k) { return { A: aApply, B: bApply, C: cApply, D: dApply }[k]; }
// 前往並帶入：建立（或更新）引導紀錄，把帶入資料交給目標單元後跳轉
function guideGo() {
  let res;
  try { res = Guide.hand(guideState.v, guideState.recId); } catch (e) { toast(e.message, 'err'); return; }
  const pf = res.pf, st = guideUnitState(pf.unit);
  st.view = 'new'; if ('editId' in st) st.editId = null;
  st.prefill = pf;
  guideState.v = null; guideState.recId = null; guideState.view = 'list';
  toast(`${res.rec.id}：已帶入 ${pf.labels.length} 項資料，請確認後於「${Guide.UNITS[pf.unit].name}」送出`, 'ok');
  goto(pf.page);
}
// 目標新增畫面取出帶入資料（只用一次，避免之後再進新增畫面重複帶入）；記住來源引導紀錄供送出後回填
function guideTake(state) { const pf = state.prefill || null; state.prefill = null; state.guideRec = pf ? pf.recId : null; return pf; }
// 目標功能送出成功：回填申請單號到引導紀錄（由引導帶入後直接送出，或先暫存、之後再送出）
function guideSubmitted(state, appId) {
  if (state && state.guideRec) { Guide.markSubmitted(state.guideRec, appId); state.guideRec = null; return; }
  Guide.draftSubmitted(appId);
}
// 目標功能按「暫存」：引導紀錄記下暫存的申請單號，待該單送出時回填
function guideDrafted(state, appId) {
  if (!state.guideRec) return;
  Guide.linkDraft(state.guideRec, appId);
  state.guideRec = null;
}
// 新增畫面上方的帶入提示條（含「回到引導修改」）
function guideBanner(p, pf, state) {
  const html = `<div class="callout info" id="guide-banner" style="margin-bottom:14px;">
    🧭 已由<b>申請引導 ${pf.recId}</b> 帶入：${pf.labels.join('、')}。其餘欄位請補齊並確認後送出。
    ${pf.warnings.length ? `<div style="margin-top:6px;color:var(--red);font-weight:600;">⚠ ${pf.warnings.join('<br>')}</div>` : ''}
    <div style="margin-top:8px;"><button class="btn btn-ghost btn-sm" id="guide-back">← 回到引導修改</button></div></div>`;
  const h = $('.section-h', p);
  if (h) h.insertAdjacentHTML('afterend', html); else p.insertAdjacentHTML('afterbegin', html);
  $('#guide-back', p).onclick = () => { state.view = 'list'; state.guideRec = null; guideEdit(pf.recId); };
}
// A/B/C 新增畫面由 DOM 建立後再填值（D 於組 src 時直接帶入）
function guideApply(unit, state, p) {
  const pf = guideTake(state);
  if (!pf) return;
  const d = pf.data;
  const set = (id, val) => { const e = $('#' + id, p); if (e && val != null && val !== '') e.value = val; };
  const pick = (name, val) => {
    const r = $(`input[name=${name}][value="${val}"]`, p);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
  };
  if (unit === 'A') {
    set('aa-branch', d.branch); $('#aa-branch', p).onchange();
    pick('aa-recv', d.recvMode);
    if (d.recvMode === 'exact') { set('aa-date', d.serviceDate); set('aa-deliver', d.deliverTime); }
    aaItems = d.items.map(i => Object.assign({}, i)); renderAaItems();
  } else if (unit === 'B') {
    set('ba-applicant', d.applicant);
    set('ba-site', d.site); $('#ba-site', p).onchange();
    set('ba-dest', d.destSite); $('#ba-dest', p).onchange();
    set('ba-want', d.wantReceiveTime);
    if (d.wantReceiveDate) set('ba-wantdate', d.wantReceiveDate);
    baItems = d.items.map(i => Object.assign({}, i)); renderBaCargo();
  } else if (unit === 'C') {
    set('ca-applicant', d.applicant); set('ca-dept', d.dept); set('ca-phone', d.ext);
    pick('ca-oneway', d.type === 'oneway' ? '1' : '0');
    caRoute = [d.origin, d.dest].filter(Boolean); caRouteEdit = null; renderCaRoute();
    if (d.departDate) { set('ca-report', `${d.departDate}T${d.earliestPickup || '09:00'}`); $('#ca-report', p).onchange(); }
    if (d.type !== 'oneway' && d.returnDate) set('ca-end', `${d.returnDate}T${d.earliestReturn || '18:00'}`);
    set('ca-pax', d.pax);
  }
  guideBanner(p, pf, state);
  initMasonry(p);
}

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
  const mt = $('#menu-toggle'); // 漢堡鈕：收合／展開左側功能選單
  if (mt) mt.onclick = () => document.body.classList.toggle('nav-collapsed');
  goto('dashboard');
});
