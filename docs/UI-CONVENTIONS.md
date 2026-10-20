# UI 規範（生成新軟體單元用）

> 把這份文件貼到新對話，並說「請依此規範新增一個 XXX 軟體單元」，即可產出與現有單元一致的頁面。
> 專案：純前端可動原型（無框架、無 build）。檔案：`index.html` + `css/styles.css` + `js/data.js` `js/moduleX.js` `js/app.js`。以 `<script>` 直接載入，全域物件 `DB`（資料）、`ModuleX`（邏輯）、`RENDER`（畫面）。

---

## 0. 一個「軟體單元」的組成

每個單元 = 側邊選單一個項目 + 一個 `page-<id>` 容器 + 一個 `RENDER.<id>()` 函式。
單元內通常是「三畫面」子流程，用一個狀態物件切換（不換路由、只換 innerHTML）：

- **index（查詢/清單頁）**：上半「查詢條件」卡片 + 下半歷史紀錄表格；「🔍 查詢」「＋ 新增」放在**查詢條件卡片標題列（橘色區塊）的右上角**，不要放在查詢欄位下方。所有查詢頁一致（申請、單位主管審核、派車調度、簽審、實登、申請引導…）。
- **detail（明細頁）**：點清單「細節」進入；唯讀資訊卡 + 動作按鈕；最下方「← 回上一頁」。
- **new（新增頁）**：點「＋ 新增」進入；輸入表單；送出後回 detail 看結果。
- **送出模式（人員運輸起，2026-10-07）**：狀態變更不用多顆動作按鈕，改為「是否 XX」單選卡片（是／否，**預設否**）＋頁面底部單一「▶ 送出」，按下一律先跳確認視窗。新增頁底部為「送出」「取消」（不顯示回上一頁）；從明細頁進入的修改頁為「送出」「← 回上一頁」。明細頁的狀態異動（如取消申請）同樣用單選卡片＋回上一頁旁的「送出」。
- **grid 動作欄**：放在最左欄，欄名「功能」；狀態欄緊接在第二欄。
- **駕駛任務單（G141／G142）**：四模組共用 `renderDriverSheet(cfg)`——查詢頁（日期起迄預設今天～＋14、駕駛；grid＝細節、日期、出發時間、駕駛名稱）→ 細節頁（`cfg.detail(t)`）＋回上一頁。各模組只提供 `trips()`（一列一趟：`key, date, time, driver, driverName`）、駕駛選項與細節內容；元件 id 前綴 `ad`／`bd`／`cd`／`dd`（`<pfx>q-from`、`<pfx>q-grid`、`<pfx>d-back`…）。
- **是／否欄位**：表單的是非題一律用單選膠囊（是／否，預設否），不用文字框（G144）；用緊湊樣式 `.radio-group.yn`，選項與欄位名稱同列，同類是非題集中在同一列 infoGrid，一列可放三題（G146）。
- **長表單分段**：同一張申請單用一張卡片、以分隔線＋小標題分段；清單類（貨物項目 grid）與送出決定（是否送審）各自獨立卡片。人員區塊（接收人／代理人等）欄位順序一致（姓名、分機/手機、院區、館別），各自一個 infoGrid 以對齊換行（G146）。
- **批次操作（G147）**：清單第一欄放勾選框（表頭全選），批次按鈕放在該卡片標題列右上（例：「↩ 批次退回修改」）；按下開視窗填必填原因、確認後才執行，任一筆不符條件則整批不執行並提示是哪一筆。
- **撤單卡（G147）**：申請明細頁「撤單」卡＝是否撤單（是／否，預設否）＋撤單原因（是才出現、必填），回上一頁左側「送出」；超過期限（出發日前一天）不顯示。
- **用語**：一律用「財物」（不用「物品」）；實登單元名稱為「車輛異動實登」。

### 骨架範例
```js
// 1) 註冊選單（NAV 陣列）＋ 頁面容器 <div class="page" id="page-x_foo"></div>（放在 index.html）
// 2) 標題/麵包屑
const PAGE_META = { x_foo: { title: '模組X · 功能名', crumb: '模組 X · 角色 · 條文' } };
// 3) 子畫面狀態
let xFoo = { view: 'list', detailId: null, query: { kw: '', status: '' }, resultIds: null };
// 4) 分派
RENDER.x_foo = function () {
  const p = $('#page-x_foo');
  if (xFoo.view === 'new')    return renderXFooNew(p);
  if (xFoo.view === 'detail') return renderXFooDetail(p, xFoo.detailId);
  return renderXFooList(p);
};
// 切畫面：改 xFoo.view 後呼叫 RENDER.x_foo()；跨單元用 goto('x_foo')
```
`$ = (sel,root=document)=>root.querySelector(sel)`、`$$` 同義回傳陣列。

---

## 1. 版面與導覽

- **左側欄** `.sidebar`：固定 `position:fixed`、寬 232px、深藍 `--navy-deep`；分組選單（`.nav-group-label` + `.nav-item`，`.active` 有橘色左框）。
- **左上角漢堡鈕** `#menu-toggle`（白底深藍 ☰，固定左上）：點擊 `document.body.classList.toggle('nav-collapsed')` 收合/展開側欄（`.main` margin 補滿、頂列讓位）。
- **主內容** `.main`（`margin-left:232px`）＝頂列 `.topbar` + `.content`。
- **頂列標題/麵包屑**：`goto(pageId)` 會把 `PAGE_META[id].title` 寫進 `#topbar-title`、`.crumb` 目前隱藏。
- 每個頁面內容第一列通常是 `.section-h`（頁標題）＋（可選）`.section-sub`（說明）。

---

## 2. 配色（CSS tokens，定義於 `:root`）

| token | 值 | 用途 |
|---|---|---|
| `--navy` | `#1F3864` | 主色（標題、重點字） |
| `--navy-deep` | `#14284A` | 側欄底 |
| `--accent` | `#C97A3D` | 橘色重點（漸層、按鈕、tag） |
| `--ink` / `--ink-soft` | `#22262B` / `#565C64` | 內文 / 次要文字 |
| `--line` | `#DCE1E6` | 分隔線、輸入底線 |
| `--paper` / `--card` | `#F4F5F7` / `#FFFFFF` | 背景 / 卡片 |
| 綠 `--green`、琥珀 `--amber-*`、紅（徽章 `b-red`） | — | 狀態色 |
| **資訊欄位 label 藍** | `#2563EB` | 所有欄位名稱固定用此亮藍色 |

---

## 3. 麵包屑漸層（頂列）

頂列 `.topbar` 為**橘色橫條漸層**（左最橘→右漸淡）、白字、四周留白＋圓角：
```css
.topbar {
  background: linear-gradient(90deg, var(--accent) 0%, #DBA271 48%, #F5E7D8 100%);
  padding: 16px 32px; margin: 10px 16px; border-radius: 10px;
  position: sticky; top: 10px; display:flex; justify-content:space-between; align-items:center;
}
.topbar h1 { color:#fff; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
.topbar .crumb { display:none; }   /* 麵包屑小字隱藏 */
```

---

## 4. 卡片與「卡片標題」漸層列

- 卡片：`.card`（白底、`border-radius:10px`、`padding:22px 24px`、`margin-bottom:20px`）。
- **每張卡片的第一個標題** `.card > .card-title:first-child` 自動變成**橘色漸層列＋左側白色 `^`**，貼齊卡片上緣左右緣：
```css
.card > .card-title:first-child {
  position:relative; color:#fff; margin:-22px -24px 16px;      /* 貼齊卡片內緣 */
  border-radius:10px 10px 0 0; padding:12px 16px 12px 26px;
  text-shadow:0 1px 2px rgba(0,0,0,.25);
  background:linear-gradient(90deg,var(--accent) 0%,#DBA271 48%,#F5E7D8 100%);
}
.card > .card-title:first-child::before {           /* 左側白色 ^ */
  content:'^'; position:absolute; left:9px; top:50%; transform:translateY(-58%);
  color:#fff; font-weight:800; font-size:20px;
}
/* 例外：儀表板可點擊導覽卡 .card[data-go] 不套漸層；卡內次級小標題（非 first-child）維持一般樣式 */
```
- 標題右側可放狀態徽章或按鈕：`<div class="card-title" style="justify-content:space-between;"><span>基本資料</span>${stBadge(...)}</div>`

---

## 5. 資訊欄位＝Masonry「label + value」自適應區塊

**所有資訊顯示與查詢/表單欄位都用這套**，不要用舊的 `.field/.row/.grid-2`。

- **顏色/排版**：無外框；`label` 亮藍字 `#2563EB` + 一個空格 + value 同一行；1280 寬一列 3 塊，窄螢幕自動降 2／1 欄（Masonry 以百分比欄寬絕對定位排版）。
- **helper（已存在於 app.js，直接用）**：
  - `fItem(label, valueHtml, opts)`：**顯示型**（純文字/HTML）。
  - `fInput(label, inputHtml, opts)`：**輸入型**（控件填滿剩餘寬度）。`opts.stack:true` 讓控件另起一行（群組如「下拉＋其他文字框」「單選膠囊」用）。
  - `infoGrid(id, itemsHtml)`：包一層 `.fgrid`（含 Masonry 需要的 `grid-sizer`）。
  - `initMasonry(root)`：對 root 內所有 `.fgrid` 排版。**每次 render 後、以及會改變區塊高度的操作（切換下拉/單選）後都要呼叫一次**。
  - `opts` 寬度修飾：`{ full:true }` 整列、`{ w2:true }` 兩欄寬、`{ tall:true }` 多行值。
- **範例**：
```js
p.innerHTML = `
  <div class="card">
    <div class="card-title">基本資料</div>
    ${infoGrid('foo-basic', [
      fItem('單號', `<b style="color:var(--navy);">${a.id}</b>`),
      fItem('申請人', a.applicant),
      fItem('備註', a.note || '<span class="muted">—</span>', { full:true, tall:true }),
    ].join(''))}
  </div>
  <div class="card">
    <div class="card-title" style="justify-content:space-between;"><span>查詢條件</span>
      <span><button class="btn btn-primary btn-sm" id="q-search">🔍 查詢</button>
        <button class="btn btn-accent btn-sm" id="q-new">＋ 新增</button></span></div>   <!-- 按鈕在標題列右上角 -->
    ${infoGrid('foo-q', [
      fInput('關鍵字', `<input type="text" id="q-kw">`),
      fInput('狀態', `<select id="q-status">${opts}</select>`),
      fInput('是否同意', `<div class="radio-group">…</div>`, { stack:true, full:true }),
    ].join(''))}
  </div>`;
initMasonry(p);
```

---

## 6. 輸入樣式：只留下方一條底線

`input/select/textarea` 全域只有下底線、無外框、背景透明、聚焦時底線變深藍（已在 styles.css 設定）——新單元直接沿用即可，不需另寫。

---

## 7. 執行動作前一律跳「SweetAlert 風格」確認視窗

任何會改變資料/送出的動作，**先確認再執行**：
```js
// 方式 A：包裝 onclick
btn.onclick = confirmThen(
  { title: '確認送出？', text: '送出後將…（可含 <b>HTML</b>）' },
  () => { /* 真正動作 */ }
);
// 方式 B：await
btn.onclick = async () => {
  const ok = await confirmDialog({ title:'確認刪除？', text:'此動作無法復原。' });
  if (!ok) return;
  /* 真正動作 */
};
```
- API：`confirmDialog({title, text, okText='確定', cancelText='取消'}) → Promise<boolean>`。
- 動作完成後用 **toast** 回饋：`toast('已送出', 'ok' | 'err')`。
- 需要輸入細節（車輛/原因等）的動作，用 `openModal(title, bodyHtml)` 彈窗；**彈窗內欄位一樣用 `infoGrid + fInput/fItem`**（`openModal` 顯示後會自動 `initMasonry`）。

---

## 8. 狀態徽章與其他小元件

- 狀態徽章：`stBadge(status, mod?)`；底層 class `badge` + 顏色 `b-navy / b-green / b-amber / b-red / b-gray`。
- 表格：`<div class="table-wrap"><table class="dt">…</table></div>`（表頭深藍）。純表格型頁面（清單、任務單、對照表）維持表格，不套資訊區塊。
- 按鈕：`btn`＋`btn-primary`（深藍）/`btn-accent`（橘）/`btn-ghost`（白框）；小尺寸加 `btn-sm`。
- 空狀態：`<div class="empty"><div class="big">🔍</div>查無資料</div>`。
- 頁尾返回：`backBar('xxx-back')`，並 `$('#xxx-back').onclick = () => { state.view='list'; RENDER.x_foo(); }`。

---

## 9. 命名慣例

- 頁面 id：`模組_功能`（如 `a_apply`）；容器 `page-<id>`。
- 欄位 id 前綴：查詢 `xq-*`、明細 `xd-*`、新增 `xa-*`、審核 `xsv-*`（x＝模組字母）。
- 邏輯放 `ModuleX`（資料操作、驗證）；畫面放 `RENDER.<id>` 與 `renderXFooList/Detail/New`。

---

## 10. 驗收

- 開 `index.html` 應無 console error；`node tests/guardrails.test.js` 應全過（若該單元有邏輯測試）。
- 三畫面（清單→明細/新增）切換正常；每次 render 後有 `initMasonry`；動作前有確認視窗。
- **表單分列（G152／G153）**：需求指定「同一列」的欄位，各列自成一個 `infoGridRow`（Masonry `horizontalOrder`，依欄位順序左→右），列與列之間自然換行；只有一個是／否且只需「是」的欄位用單一勾選項（未勾＝否）。
- **人員欄位（G152／G153）**：委運人、接收人、接收代理人同一排版，欄位名稱前加角色名稱——院區（下拉）＋館別（院區財物轉運另含收貨／送貨站點）一列、姓名（事業部→組別→姓名三段下拉）一列、手機一列（選姓名預帶分機，可改填）。
- **編輯視窗（G152）**：欄位名稱在上、一列三欄依序排列，中寬視窗（`openModal(..., { mid: true })`），下拉文字需完整顯示。
- **固定值欄位（G155）**：業務上只有單一值的欄位（如巡迴財物轉運危險品運輸＝否）以 `fItem` 文字顯示，不放單一選項的 radio／勾選。
- **條件鎖定選項（G154）**：另一欄位決定某選項不可選時，該 radio 設 `disabled` 並淡化，已選者自動改回允許值，並在下方以 `callout warn` 說明原因與後果（例：院區財物轉運來回運輸鎖定是否送審＝否）。
- **簽審清單的列單位（G156）**：簽審對象若以派車單為單位送審／退回（院區財物轉運），歷史簽審紀錄一列＝一張派車單（欄內逐行列出單內申請單），明細頁顯示派車單資訊＋申請單 grid（「明細」開視窗），主管同意作用於整張；人員運輸、一般用車仍一列一張申請單。
- **順位排序與預選（G159）**：申請人填有偏好順位時（例：一般用車車種順位），調度候選清單依順位排序、表格加「順位」欄，下拉選項前標【順位 n】，並預選最高順位且可用的項目；調度仍可改選。
- **例外：一般用車申請表單（G158）**：合併 PR #2 的表單沿用 masonry 整卡排版，未依「表單分列」逐列排版（左右順序可能跳動）；是否改為分列待決定。
- **空白人員帶入（G154）**：修改畫面帶入的人員姓名為空白時，姓名下拉加「請選擇」並選取，不預設第一位組員。
