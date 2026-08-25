/* ============================================================
   app.js — 前端控制器：導覽、渲染、互動
   純前端記憶體版原型（無資料庫、無後端）
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

/* ---------- 導覽 ---------- */
const NAV = [
  { group: '總覽', items: [{ id: 'dashboard', ico: '▤', label: '系統儀表板' }] },
  { group: '共用基礎', items: [{ id: 'engine', ico: '⚙', label: '裝載判定引擎' }, { id: 'master', ico: '▦', label: '主檔資料' }] },
  { group: '模組 A', items: [{ id: 'moduleA', ico: '⇄', label: '區域內物流' }] },
  { group: '模組 B', items: [{ id: 'moduleB', ico: '⇅', label: '南北幹線物流' }] },
  { group: '模組 C', items: [{ id: 'moduleC', ico: '⇆', label: '差旅共乘媒合' }] },
];
const PAGE_META = {
  dashboard: { title: '系統儀表板', crumb: '車輛派遣系統整合 · 原型 v0.1' },
  engine: { title: '裝載判定引擎', crumb: '共用基礎層 · Phase 1 · G01–G05' },
  master: { title: '主檔資料', crumb: '共用基礎層 · Phase 0' },
  moduleA: { title: '區域內物流貨運', crumb: '模組 A · Phase 2–3 · G10–G20' },
  moduleB: { title: '跨據點南北幹線物流', crumb: '模組 B · Phase 4 · G30–G44' },
  moduleC: { title: '差旅派車自動媒合', crumb: '模組 C · Phase 5 · G50–G63' },
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
  const aMatched = ModuleA.applications.filter(a => a.status === 'matched').length;
  const bLoaded = ModuleB.orders.filter(o => o.status === 'loaded').length;
  const cMatched = ModuleC.applications.filter(a => a.status === 'matched').length;
  const cVoid = ModuleC.applications.filter(a => a.status === 'void').length;
  p.innerHTML = `
    <div class="section-h">系統儀表板</div>
    <div class="section-sub">車輛派遣系統整合原型 — 純前端可動版，資料存於記憶體，重新整理即重置。三模組資源池分開，互不搶用。</div>
    <div class="stat-row">
      <div class="stat"><div class="k">區域內物流 · 已排班</div><div class="v">${aMatched}</div></div>
      <div class="stat"><div class="k">南北幹線 · 已裝載單</div><div class="v accent">${bLoaded}</div></div>
      <div class="stat"><div class="k">差旅共乘 · 已媒合</div><div class="v green">${cMatched}</div></div>
      <div class="stat"><div class="k">共乘 · 逾期作廢</div><div class="v red">${cVoid}</div></div>
    </div>
    <div class="grid-3">
      ${dashCard('⚙ 裝載判定引擎', 'Level 1 體積 + 地板面積 + Level 2 六方向 + 重量累計。貪婪規則、可解釋、不做 3D 碰撞模擬。', 'engine', 'G01–G05')}
      ${dashCard('⇄ 模組 A 區域內物流', '10 站固定路線、時間軸最近班次媒合、站內時間額度與順延、駕駛異常回報。', 'moduleA', 'G10–G20')}
      ${dashCard('⇅ 模組 B 南北幹線', '貪婪終點判斷、直達/非直達分流、動態淨值容量、天數對照表。', 'moduleB', 'G30–G44')}
      ${dashCard('⇆ 模組 C 差旅共乘', '來回單/單程單、批次媒合按鈕、資源可用性檢核、手動併車、逾期作廢。', 'moduleC', 'G50–G63')}
      ${dashCard('▦ 主檔資料', '據點/站點/車輛/司機/浪費係數/保修/請假等示範主檔。', 'master', 'Phase 0')}
    </div>
    <div class="callout info" style="margin-top:20px;">
      本原型依 <b>docs/PLAN.md</b> 第一階段雛形建置：以 HTML + JavaScript 展示三模組核心業務邏輯（Guardrails）。
      正式版技術棧為 .NET Framework 4.8 / MVC，本原型僅供互動驗證流程與規則，不含資料庫與後端。
    </div>`;
  $$('#page-dashboard .dash-card').forEach(c => c.onclick = () => goto(c.dataset.go));
};
function dashCard(title, desc, go, gtag) {
  return `<div class="card dash-card" data-go="${go}" style="cursor:pointer;">
    <div class="card-title">${title} <span class="g-tag">${gtag}</span></div>
    <div class="card-desc" style="margin-bottom:0;">${desc}</div>
  </div>`;
}

/* ============================================================
   裝載判定引擎 Demo
   ============================================================ */
let engineItems = [];
RENDER.engine = function () {
  const p = $('#page-engine');
  const vehOpts = DB.vehicles.filter(v => v.pool === 'LOGI')
    .map(v => `<option value="${v.id}">${v.name}（${v.dims.l}×${v.dims.w}×${v.dims.h}cm｜${v.volume.toFixed(0)}L｜${v.weight}kg）</option>`).join('');
  const catOpts = DB.wasteFactors.map(f => `<option value="${f.code}">${f.name}（係數 ${f.factor}）</option>`).join('');
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

/* ============================================================
   模組 A：區域內物流
   ============================================================ */
let aItems = [];
RENDER.moduleA = function () {
  const p = $('#page-moduleA');
  const stOpts = DB.stations.map(s => `<option value="${s.id}">${s.order}. ${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">區域內物流貨運</div>
    <div class="section-sub">10 站固定路線 · 時間軸最近班次媒合 · 站內時間額度逐張判定 · 裝不下順延下一班 · 當日末班仍不行提醒改期。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="apply">① 填單 / 媒合</div>
      <div class="pill-tab" data-tab="route">② 路線與班次</div>
      <div class="pill-tab" data-tab="list">③ 申請單清單</div>
      <div class="pill-tab" data-tab="incident">④ 駕駛異常回報</div>
    </div>
    <div id="a-tab-apply"></div>
    <div id="a-tab-route" style="display:none;"></div>
    <div id="a-tab-list" style="display:none;"></div>
    <div id="a-tab-incident" style="display:none;"></div>`;
  $$('#page-moduleA .pill-tab').forEach(t => t.onclick = () => {
    $$('#page-moduleA .pill-tab').forEach(x => x.classList.toggle('active', x === t));
    ['apply', 'route', 'list', 'incident'].forEach(k => $('#a-tab-' + k).style.display = k === t.dataset.tab ? 'block' : 'none');
  });
  renderA_apply(stOpts); renderA_route(); renderA_list(); renderA_incident();
};
function renderA_apply(stOpts) {
  $('#a-tab-apply').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">填寫收貨申請單 <span class="g-tag">G13/G19</span></div>
        <div class="card-desc">一單一目的地、可多筆貨物。收貨時間二選一：指定期望 / 越快越好。</div>
        <div class="field"><label>申請人</label><input type="text" id="a-applicant" value="業務部-周雅婷"></div>
        <div class="row">
          <div class="field"><label>目的地站點</label><select id="a-station">${stOpts}</select></div>
          <div class="field"><label>建物</label><select id="a-building"></select></div>
        </div>
        <div class="field"><label>收貨時間模式 <span class="hint">兩種皆不享班次內插隊優先權 G19</span></label>
          <div class="radio-group">
            <label class="radio-pill sel" id="a-mode-asap"><input type="radio" name="a-recv" value="asap" checked>越快越好</label>
            <label class="radio-pill" id="a-mode-exact"><input type="radio" name="a-recv" value="exact">指定期望時間</label>
          </div>
        </div>
        <div class="field" id="a-exact-wrap" style="display:none;"><label>期望到站時間</label><input type="time" id="a-expect" value="13:00"></div>
        <div class="field"><label>上下貨時間（分鐘，自填 G15）</label><input type="number" id="a-handle" value="15"></div>
        <div class="divider"></div>
        <div class="card-title">貨物項目</div>
        <div id="a-items"></div>
        <button class="btn btn-ghost btn-sm" id="a-add">＋ 新增貨物</button>
        <div class="divider"></div>
        <button class="btn btn-primary" id="a-submit">▶ 送出並媒合（同步回傳 G11）</button>
      </div>
      <div class="card">
        <div class="card-title">媒合結果</div>
        <div id="a-result"><div class="empty"><div class="big">⇄</div>填單後執行媒合</div></div>
      </div>
    </div>`;
  const fillBuildings = () => {
    const st = DB.stations.find(s => s.id === $('#a-station').value);
    $('#a-building').innerHTML = st.buildings.map(b => `<option>${b}</option>`).join('');
  };
  $('#a-station').onchange = fillBuildings; fillBuildings();
  $$('#a-tab-apply input[name=a-recv]').forEach(r => r.onchange = () => {
    $('#a-mode-asap').classList.toggle('sel', $('#a-tab-apply input[value=asap]').checked);
    $('#a-mode-exact').classList.toggle('sel', $('#a-tab-apply input[value=exact]').checked);
    $('#a-exact-wrap').style.display = $('#a-tab-apply input[value=exact]').checked ? 'block' : 'none';
  });
  if (aItems.length === 0) aItems = [{ name: '文件箱', l: 40, w: 30, h: 30, qty: 5, category: 'BOX', weight: 10 }];
  renderAItems();
  $('#a-add').onclick = () => { aItems.push({ name: '貨物', l: 50, w: 40, h: 30, qty: 1, category: 'BOX', weight: 12 }); renderAItems(); };
  $('#a-submit').onclick = submitA;
}
function renderAItems() {
  const box = $('#a-items');
  const catOpts = (sel) => DB.wasteFactors.map(f => `<option value="${f.code}" ${f.code === sel ? 'selected' : ''}>${f.name}</option>`).join('');
  box.innerHTML = aItems.map((it, i) => `
    <div class="item-row">
      <div><div class="mini-label">品名</div><input type="text" value="${it.name}" data-i="${i}" data-k="name"></div>
      <div><div class="mini-label">長</div><input type="number" value="${it.l}" data-i="${i}" data-k="l"></div>
      <div><div class="mini-label">寬</div><input type="number" value="${it.w}" data-i="${i}" data-k="w"></div>
      <div><div class="mini-label">高</div><input type="number" value="${it.h}" data-i="${i}" data-k="h"></div>
      <div><div class="mini-label">類別</div><select data-i="${i}" data-k="category">${catOpts(it.category)}</select></div>
      <div><div class="mini-label">數量</div><input type="number" value="${it.qty}" data-i="${i}" data-k="qty"></div>
      <button class="x-btn" data-del="${i}">✕</button>
    </div>`).join('');
  $$('#a-items input, #a-items select').forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.i, k = inp.dataset.k;
    aItems[i][k] = (k === 'name' || k === 'category') ? inp.value : +inp.value;
  });
  $$('#a-items .x-btn').forEach(b => b.onclick = () => { aItems.splice(+b.dataset.del, 1); renderAItems(); });
}
function submitA() {
  const mode = $('#a-tab-apply input[name=a-recv]:checked').value;
  const app = ModuleA.createApp({
    applicant: $('#a-applicant').value,
    station: $('#a-station').value,
    building: $('#a-building').value,
    items: aItems.map(x => ({ ...x })),
    recvMode: mode,
    expectTime: $('#a-expect').value,
    handleMin: +$('#a-handle').value || 0,
  });
  const r = ModuleA.match(app);
  const cls = r.ok ? 'ok' : (r.reason === 'full' || r.reason === 'quota' ? 'warn' : 'fail');
  const head = r.ok ? `✓ 已排入 ${r.shift.label}` : '⚠ 無法排入';
  $('#a-result').innerHTML = `
    <div class="result ${cls}">
      <div class="r-head">${head}</div>
      ${r.ok ? `<div>申請單 <b>${app.id}</b>｜到站約 <b>${r.arrival}</b>｜車輛 ${r.shift.vehicle}</div>`
             : `<div><b>${r.msg}</b></div>`}
    </div>
    <div class="trace">${r.trace.join('\n')}</div>`;
  if (r.ok) toast(`${app.id} 已排入 ${r.shift.label}`, 'ok');
  else toast(r.msg, 'err');
  renderA_list();
}
function renderA_route() {
  $('#a-tab-route').innerHTML = `
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
function renderA_list() {
  const rows = ModuleA.applications;
  const body = rows.length === 0 ? `<div class="empty"><div class="big">▦</div>尚無申請單</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>模式</th><th>裝卸分</th><th>班次</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(a => { const st = DB.stations.find(s => s.id === a.station);
        const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
        const badge = a.status === 'matched' ? '<span class="badge b-green">已排班</span>' : '<span class="badge b-amber">未排入</span>';
        return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}/${a.building}</td>
          <td>${a.recvMode === 'exact' ? '指定 ' + a.expectTime : '越快越好'}</td><td>${a.handleMin}</td>
          <td>${sh ? sh.label : '—'}</td><td>${badge}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $('#a-tab-list').innerHTML = `<div class="card"><div class="card-title">申請單清單</div>${body}</div>`;
}
function renderA_incident() {
  const matched = ModuleA.applications.filter(a => a.status === 'matched');
  $('#a-tab-incident').innerHTML = `
    <div class="card">
      <div class="card-title">駕駛異常回報 <span class="g-tag">G20</span></div>
      <div class="card-desc">跑完整趟回總部後回報，只標異常站點，記錄到申請單層級，存檔＋立即自動寄信給申請人＋直屬主管（沿用審批對應）。一單一信。</div>
      ${matched.length === 0 ? `<div class="empty">尚無已排班申請單可回報。先到「填單/媒合」建立並排入班次。</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>申請人</th><th>目的地</th><th>班次</th><th>異常回報</th></tr></thead><tbody>
        ${matched.map(a => { const st = DB.stations.find(s => s.id === a.station);
          const sh = DB.regionalShifts.find(s => s.id === a.assignedShift);
          return `<tr><td>${a.id}</td><td>${a.applicant}</td><td>${st.name}</td><td>${sh.label}</td>
            <td><button class="btn btn-ghost btn-sm" data-inc="${a.id}" data-t="late">標記不準時</button>
                <button class="btn btn-ghost btn-sm" data-inc="${a.id}" data-t="noshow">標記沒出現</button></td></tr>`; }).join('')}
      </tbody></table></div>`}
    </div>`;
  $$('#a-tab-incident [data-inc]').forEach(b => b.onclick = () => {
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
        <span class="muted">※ 信件格式為「待後續設計」項，此為簡潔版 TODO。</span>
      </div>`);
    toast(`${a.id} 異常已回報並寄信`, 'ok');
  });
}

/* ============================================================
   模組 B：南北幹線
   ============================================================ */
RENDER.moduleB = function () {
  const p = $('#page-moduleB');
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">跨據點南北幹線物流</div>
    <div class="section-sub">10 據點南北一直線固定順序 · 貪婪終點判斷（容量/時間先觸頂）· 直達獨立派車 · 動態淨值容量 · 天數對照表。</div>
    <div class="grid-2">
      <div class="card">
        <div class="card-title">建立幹線申請單 <span class="g-tag">G38</span></div>
        <div class="card-desc">出發示意為台北據點（D10）南下。勾選直達 → 當天有直達即獨立派車。</div>
        <div class="field"><label>申請人</label><input type="text" id="b-applicant" value="研發部-吳承恩"></div>
        <div class="field"><label>目的地據點</label><select id="b-dest">${siteOpts}</select></div>
        <div class="field"><label>派送型態 <span class="hint">直達不湊單、單一目的地 G38</span></label>
          <div class="radio-group">
            <label class="radio-pill sel" id="b-nd"><input type="radio" name="b-direct" value="0" checked>非直達（沿線收送）</label>
            <label class="radio-pill" id="b-d"><input type="radio" name="b-direct" value="1">直達</label>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>貨量 (L)</label><input type="number" id="b-vol" value="2000"></div>
          <div class="field"><label>重量 (kg)</label><input type="number" id="b-wt" value="800"></div>
          <div class="field"><label>裝卸(分)</label><input type="number" id="b-handle" value="30"></div>
        </div>
        <button class="btn btn-primary" id="b-submit">＋ 建立申請單</button>
        <button class="btn btn-ghost" id="b-demo">載入範例批次</button>
      </div>
      <div class="card">
        <div class="card-title">待處理申請單</div>
        <div id="b-pending"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">派車決策（調度室）<span class="g-tag">G32/G44</span></div>
      <div class="card-desc">依核准時間排序逐張檢查。系統顯示每台車派遣模式與觸發原因。</div>
      <button class="btn btn-accent" id="b-dispatch-direct">派直達車</button>
      <button class="btn btn-primary" id="b-dispatch-greedy">派非直達車（貪婪）</button>
      <div id="b-dispatch-result"></div>
    </div>`;
  const setDirect = () => {
    $('#b-nd').classList.toggle('sel', $('#page-moduleB input[value="0"]').checked);
    $('#b-d').classList.toggle('sel', $('#page-moduleB input[value="1"]').checked);
  };
  $$('#page-moduleB input[name=b-direct]').forEach(r => r.onchange = setDirect);
  $('#b-submit').onclick = () => {
    ModuleB.createOrder({
      applicant: $('#b-applicant').value, origin: 'D10', dest: $('#b-dest').value,
      direct: $('#page-moduleB input[value="1"]').checked,
      volume: +$('#b-vol').value, weight: +$('#b-wt').value, handleMin: +$('#b-handle').value,
    });
    toast('已建立幹線申請單', 'ok'); renderB_pending();
  };
  $('#b-demo').onclick = () => {
    [['D3', false, 1500, 600, 25], ['D2', false, 1800, 700, 30], ['D6', false, 1200, 500, 20],
     ['D1', true, 2500, 900, 40], ['D5', false, 2200, 800, 30]].forEach(([dest, direct, v, w, h]) =>
      ModuleB.createOrder({ applicant: '研發部-吳承恩', origin: 'D10', dest, direct, volume: v, weight: w, handleMin: h }));
    toast('已載入 5 筆範例（含 1 直達）', 'ok'); renderB_pending();
  };
  $('#b-dispatch-direct').onclick = () => dispatchB('direct');
  $('#b-dispatch-greedy').onclick = () => dispatchB('greedy');
  renderB_pending();
};
function renderB_pending() {
  const rows = ModuleB.orders.filter(o => o.status === 'pending');
  const box = $('#b-pending');
  if (!box) return;
  box.innerHTML = rows.length === 0 ? `<div class="empty">尚無待處理單</div>` : `
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
  $('#b-dispatch-result').innerHTML = `
    <div class="result ${r.carried && r.carried.length ? 'ok' : 'warn'}" style="margin-top:16px;">
      <div class="r-head">派車模式：${modeBadge}　終點：${endpoint}　出勤天數：${r.days} 天 <span class="g-tag">G37</span></div>
      <div>觸發原因：${r.reason || '—'}｜容量使用 <b>${r.capUsed || 0}L</b> / ${r.capTotal || 0}L${r.timeUsed != null ? `｜時間 <b>${r.timeUsed}分</b> / ${r.timeTotal}分` : ''}</div>
      ${r.carried ? `<div style="margin-top:6px;">載運：${r.carried.map(o => o.id).join(', ') || '（無）'}</div>` : ''}
      ${routeViz}
    </div>
    <div class="trace">${r.trace.join('\n')}</div>`;
  toast(`${r.modeLabel || ''}派車完成`, 'ok');
  renderB_pending();
}

/* ============================================================
   模組 C：差旅共乘
   ============================================================ */
RENDER.moduleC = function () {
  const p = $('#page-moduleC');
  const oOpts = DB.bizOrigins.map(o => `<option>${o}</option>`).join('');
  const dOpts = DB.bizDests.map(d => `<option>${d}</option>`).join('');
  p.innerHTML = `
    <div class="section-h">差旅派車自動媒合（共乘）</div>
    <div class="section-sub">來回單/單程單分兩條分支 · 批次媒合按鈕（未來 7 天）· 資源可用性檢核（保修/請假 API/工時）· 手動併車 · 逾期作廢。</div>
    <div class="pill-tabs">
      <div class="pill-tab active" data-tab="apply">① 申請單</div>
      <div class="pill-tab" data-tab="batch">② 批次媒合</div>
      <div class="pill-tab" data-tab="manual">③ 手動併車 / 作廢</div>
    </div>
    <div id="c-tab-apply"></div>
    <div id="c-tab-batch" style="display:none;"></div>
    <div id="c-tab-manual" style="display:none;"></div>`;
  $$('#page-moduleC .pill-tab').forEach(t => t.onclick = () => {
    $$('#page-moduleC .pill-tab').forEach(x => x.classList.toggle('active', x === t));
    ['apply', 'batch', 'manual'].forEach(k => $('#c-tab-' + k).style.display = k === t.dataset.tab ? 'block' : 'none');
    if (t.dataset.tab === 'manual') renderC_manual();
    if (t.dataset.tab === 'batch') renderC_batch();
  });
  renderC_apply(oOpts, dOpts); renderC_batch(); renderC_manual();
};
function renderC_apply(oOpts, dOpts) {
  $('#c-tab-apply').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">出差用車申請 <span class="g-tag">G50/G54</span></div>
        <div class="card-desc">來回單：司機車輛全程綁定同批人。單程單：限交通轉運點，出發前配對、4 小時窗。</div>
        <div class="row">
          <div class="field"><label>申請人</label><input type="text" id="c-applicant" value="業務部-周雅婷"></div>
          <div class="field"><label>部門</label><input type="text" id="c-dept" value="業務部"></div>
          <div class="field"><label>分機</label><input type="text" id="c-ext" value="2201"></div>
        </div>
        <div class="field"><label>任務型態</label>
          <div class="radio-group">
            <label class="radio-pill sel" id="c-round"><input type="radio" name="c-type" value="round" checked>來回單</label>
            <label class="radio-pill" id="c-oneway"><input type="radio" name="c-type" value="oneway">單程單（轉運點）</label>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>出發地</label><select id="c-origin">${oOpts}</select></div>
          <div class="field"><label>目的地</label><select id="c-dest">${dOpts}</select></div>
        </div>
        <div class="row">
          <div class="field"><label>出發日期</label><input type="date" id="c-date" value="2026-08-27"></div>
          <div class="field"><label>最早上車（去程）</label><input type="time" id="c-pickup" value="09:00"></div>
        </div>
        <div class="row">
          <div class="field" id="c-return-wrap"><label>最早回程時間</label><input type="time" id="c-return" value="16:00"></div>
          <div class="field"><label>人數</label><input type="number" id="c-pax" value="2"></div>
        </div>
        <div class="callout info">最晚抵達時間為系統查車程表算出的參考值，<b>不參與媒合判斷</b>（G55）。</div>
        <button class="btn btn-primary" id="c-submit">＋ 送出申請（主管已核准示意）</button>
        <button class="btn btn-ghost" id="c-demo">載入範例批次</button>
      </div>
      <div class="card">
        <div class="card-title">申請單清單</div>
        <div id="c-list"></div>
      </div>
    </div>`;
  const setType = () => {
    const round = $('#page-moduleC input[value=round]').checked;
    $('#c-round').classList.toggle('sel', round);
    $('#c-oneway').classList.toggle('sel', !round);
    $('#c-return-wrap').style.display = round ? 'block' : 'none';
  };
  $$('#page-moduleC input[name=c-type]').forEach(r => r.onchange = setType);
  $('#c-submit').onclick = () => {
    const type = $('#page-moduleC input[name=c-type]:checked').value;
    const app = ModuleC.createApp({
      applicant: $('#c-applicant').value, dept: $('#c-dept').value, ext: $('#c-ext').value,
      type, origin: $('#c-origin').value, dest: $('#c-dest').value,
      departDate: $('#c-date').value, earliestPickup: $('#c-pickup').value,
      earliestReturn: $('#c-return').value, pax: +$('#c-pax').value,
    });
    toast(`${app.id} 已送出（待批次媒合）`, 'ok'); renderC_list();
  };
  $('#c-demo').onclick = loadCDemo;
  renderC_list();
}
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
  toast('已載入 5 筆共乘範例', 'ok'); renderC_list();
}
function statusBadge(s) {
  return ({ pending: '<span class="badge b-gray">待處理</span>', matched: '<span class="badge b-green">已媒合</span>',
    coordinate: '<span class="badge b-amber">待人工協調</span>', manual: '<span class="badge b-navy">手動併車</span>',
    void: '<span class="badge b-red">逾期作廢</span>' })[s] || s;
}
function renderC_list() {
  const rows = ModuleC.applications;
  $('#c-list').innerHTML = rows.length === 0 ? `<div class="empty"><div class="big">⇆</div>尚無申請單，可「載入範例批次」</div>` : `
    <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>型態</th><th>路線</th><th>日期/上車</th><th>人</th><th>最晚抵達</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(a => `<tr><td>${a.id}</td>
        <td>${a.type === 'round' ? '來回' : '單程'}</td>
        <td>${a.origin}→${a.dest}</td>
        <td>${a.departDate.slice(5)} ${a.earliestPickup}</td>
        <td>${a.pax}</td>
        <td class="muted">${ModuleC.latestArrival(a)}</td>
        <td>${statusBadge(a.status)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function renderC_batch() {
  const pending = ModuleC.applications.filter(a => a.status === 'pending').length;
  $('#c-tab-batch').innerHTML = `
    <div class="card">
      <div class="card-title">批次媒合引擎 <span class="g-tag">G53/G61</span></div>
      <div class="card-desc">手動觸發，處理未來 7 天內（以出發日期為準）申請單。已成功單不重排。按下當下即時呼叫請假 API（示意）。</div>
      <div class="row" style="max-width:420px;align-items:end;">
        <div class="field"><label>批次起算日期</label><input type="date" id="c-batch-date" value="2026-08-25"></div>
        <div class="field" style="flex:0 0 auto;"><button class="btn btn-accent" id="c-run-batch">▶ 執行批次媒合</button></div>
      </div>
      <div class="muted">目前待處理：${pending} 筆</div>
      <div id="c-batch-result"></div>
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
  $('#c-run-batch').onclick = () => {
    const { batch, trace } = ModuleC.runBatch($('#c-batch-date').value);
    $('#c-batch-result').innerHTML = `
      <div class="result ok" style="margin-top:14px;">
        <div class="r-head">✓ 批次 ${batch.id} 完成</div>
        <div>成功 ${batch.items.filter(i => i.result === 'matched').length} 筆｜待人工協調 ${batch.items.filter(i => i.result === 'coordinate').length} 筆</div>
      </div>
      <div class="trace">${trace.join('\n')}</div>`;
    toast(`批次 ${batch.id} 完成`, 'ok'); renderC_list();
  };
}
function renderC_manual() {
  const coordinate = ModuleC.applications.filter(a => a.status === 'coordinate');
  const active = ModuleC.applications.filter(a => ['pending', 'coordinate', 'manual'].includes(a.status));
  $('#c-tab-manual').innerHTML = `
    <div class="card">
      <div class="card-title">手動併車 <span class="g-tag">G56</span></div>
      <div class="card-desc">向已確定有車的單搭便車。候選＝出發日期前後 1 天、已派車的單（不篩目的地、不比時間）。按「完成合併」即成立，免調度室確認。</div>
      ${active.length === 0 ? `<div class="empty">無待併車申請單。先建立申請並執行批次媒合。</div>` : `
      <div class="field" style="max-width:360px;"><label>選擇要搭便車的申請單</label>
        <select id="c-manual-src">${active.map(a => `<option value="${a.id}">${a.id}｜${a.origin}→${a.dest}｜${statusText(a.status)}</option>`).join('')}</select></div>
      <button class="btn btn-primary btn-sm" id="c-show-candidates">列出候選車輛</button>
      <div id="c-candidates"></div>`}
    </div>
    <div class="card">
      <div class="card-title">逾期自動作廢 <span class="g-tag">G57</span></div>
      <div class="card-desc">到出發時間仍未成功 → 自動作廢、通知申請人、紀錄保留供統計、不轉待人工協調。（此處以按鈕模擬逾期）</div>
      ${active.length === 0 ? `<div class="empty">無可作廢單</div>` : `
      <div class="table-wrap"><table class="dt"><thead><tr><th>單號</th><th>路線</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        ${active.map(a => `<tr><td>${a.id}</td><td>${a.origin}→${a.dest}</td><td>${statusBadge(a.status)}</td>
          <td><button class="btn btn-danger btn-sm" data-void="${a.id}">模擬逾期作廢</button></td></tr>`).join('')}
      </tbody></table></div>`}
    </div>`;
  const showBtn = $('#c-show-candidates');
  if (showBtn) showBtn.onclick = () => {
    const src = ModuleC.applications.find(a => a.id === $('#c-manual-src').value);
    const cands = ModuleC.manualCandidates(src);
    if (cands.length === 0) { $('#c-candidates').innerHTML = `<div class="callout">前後 1 天內查無已派車的候選單。</div>`; return; }
    $('#c-candidates').innerHTML = `
      <div class="callout info" style="margin-top:12px;">為 <b>${src.id}</b>（${src.origin}→${src.dest}）尋找便車。不顯示私人手機。</div>
      <div class="table-wrap"><table class="dt"><thead><tr><th>候選單</th><th>目的地</th><th>出發/最晚抵達</th><th>申請人 部門/分機</th><th>已載/剩餘</th><th></th></tr></thead><tbody>
        ${cands.map(c => `<tr><td>${c.app.id}</td><td>${c.dest}</td><td>${c.depart} / ${c.latest}</td>
          <td>${c.applicant}（${c.dept}/${c.ext}）</td><td>${c.loaded} / 剩 ${c.remain}</td>
          <td><button class="btn btn-primary btn-sm" data-merge="${c.app.id}" ${c.remain < src.pax ? 'disabled' : ''}>完成合併</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('#c-candidates [data-merge]').forEach(b => b.onclick = () => {
      const target = ModuleC.applications.find(a => a.id === b.dataset.merge);
      ModuleC.doManualMerge(src, target);
      toast(`${src.id} 已搭 ${target.id} 便車，合併成立`, 'ok');
      renderC_manual(); renderC_list();
    });
  };
  $$('#c-tab-manual [data-void]').forEach(b => b.onclick = () => {
    const a = ModuleC.applications.find(x => x.id === b.dataset.void);
    const r = ModuleC.voidOverdue(a);
    openModal('逾期自動作廢（示意）', `
      <div class="result fail"><div class="r-head">✗ ${a.id} 已自動作廢</div>
        <div>系統已通知申請人：<b>${r.notified}</b></div></div>
      <div class="callout" style="margin-top:12px;">紀錄保留供媒合失敗率統計（G57），不轉待人工協調。作廢即最終結局。</div>`);
    toast(`${a.id} 逾期作廢並通知申請人`, 'err');
    renderC_manual(); renderC_list();
  });
}
function statusText(s) {
  return ({ pending: '待處理', matched: '已媒合', coordinate: '待人工協調', manual: '手動併車', void: '作廢' })[s] || s;
}

/* ============================================================
   主檔資料
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
