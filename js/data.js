/* ============================================================
   data.js — 主檔與示範資料（記憶體版，無資料庫）
   對應 PLAN.md Phase 0 主檔：據點/站點/建物/車程表/係數表/車輛/司機
   注意：類別清單、天數對照表數值均為示意資料（待業務盤點，不可上線）
   ============================================================ */
const DB = {
  /* ---- 貨物類別浪費係數（G03/G04）示意值 ---- */
  wasteFactors: [
    { code: 'BOX',   name: '標準紙箱',   factor: 1.10, active: true },
    { code: 'PALLET',name: '棧板貨',     factor: 1.20, active: true },
    { code: 'LONG',  name: '長條/管材',  factor: 1.45, active: true },
    { code: 'IRREG', name: '不規則件',   factor: 1.65, active: true },
    { code: 'DRUM',  name: '桶裝/圓形',  factor: 1.35, active: true },
    { code: 'FRAG',  name: '易碎/需空隙',factor: 1.55, active: true },
  ],
  wasteDefault: 1.30, // 保底值：查無類別使用（不中斷流程）

  /* ---- 區域內物流 10 站固定路線（G14）依固定地理順序 ---- */
  stations: [
    { id: 'S1', name: '總部倉', order: 1, buildings: ['A棟收發', 'B棟倉庫'] },
    { id: 'S2', name: '五股廠', order: 2, buildings: ['原料倉', '成品倉'] },
    { id: 'S3', name: '林口物流中心', order: 3, buildings: ['一號月台', '二號月台'] },
    { id: 'S4', name: '龜山營業所', order: 4, buildings: ['門市', '後倉'] },
    { id: 'S5', name: '桃園配送站', order: 5, buildings: ['主倉'] },
    { id: 'S6', name: '中壢據點', order: 6, buildings: ['北棟', '南棟'] },
    { id: 'S7', name: '楊梅倉', order: 7, buildings: ['冷藏區', '常溫區'] },
    { id: 'S8', name: '新豐廠', order: 8, buildings: ['生產線倉'] },
    { id: 'S9', name: '竹北營業所', order: 9, buildings: ['門市倉'] },
    { id: 'S10',name: '新竹科園站', order: 10,buildings: ['收貨區'] },
  ],

  /* ---- 區域內物流班次（人工每日排定 G18）：每日 5 班，兩台車輪替 ---- */
  regionalShifts: [
    { id: 'R-A1', label: '第一班 08:00', depart: '08:00', vehicle: 'V-L01' },
    { id: 'R-A2', label: '第二班 10:30', depart: '10:30', vehicle: 'V-L02' },
    { id: 'R-A3', label: '第三班 13:00', depart: '13:00', vehicle: 'V-L01' },
    { id: 'R-A4', label: '第四班 15:00', depart: '15:00', vehicle: 'V-L02' },
    { id: 'R-A5', label: '末班 17:00',   depart: '17:00', vehicle: 'V-L01' },
  ],

  /* ---- 南北幹線 10 據點（G30）南→北一直線固定順序 ---- */
  // 據點內建物清單（G31：系統只給清單，順序由司機自行決定）示意
  sites: [
    // lateRestricted：1700 後不前往；returnLoadBy：回程媒合裝貨須於此時間前完成
    { id: 'D1', name: '屏東據點', order: 1,  buildings: ['A 棟倉庫', '月台區'],
      lateRestricted: true, returnLoadBy: '14:00' },
    { id: 'D2', name: '高雄左營', order: 2,  buildings: ['物流中心', '冷鏈倉'] },
    { id: 'D3', name: '台南據點', order: 3,  buildings: ['主倉', '南棟月台'] },
    { id: 'D4', name: '嘉義據點', order: 4,  buildings: ['收發室', '倉儲區'] },
    { id: 'D5', name: '雲林據點', order: 5,  buildings: ['一號倉', '二號倉'] },
    { id: 'D6', name: '台中據點', order: 6,  buildings: ['A 棟月台', 'B 棟倉庫'] },
    { id: 'D7', name: '苗栗據點', order: 7,  buildings: ['主廠倉'] },
    { id: 'D8', name: '新竹據點', order: 8,  buildings: ['科園倉', '收貨區'] },
    { id: 'D9', name: '桃園龍潭', order: 9,  buildings: ['北棟月台', '南棟倉'] },
    { id: 'D10',name: '台北據點', order: 10, buildings: ['總部收發', '中央倉'] },
  ],

  /* ---- 2.9 據點相互路程表（分鐘）----
     實表為「單一矩陣同時承載兩種車型」：對角線右上＝大車、左下＝小車，同車型內對稱。
     本檔採同一結構，但**數值為依實表特徵產生之虛構測試資料**（規則見 docs/SPEC-DATA.md）：
       ① 最小計算單位 30 分鐘；② 路程具次可加性（長程 < 各段相加）；
       ③ 大車＝小車＋30 分（小車 ≤ 一個計算單位之短程則相同）。
     實表到位後直接以真實矩陣覆寫 siteTravel 即可，無須改動任何演算法。 */
  // 各節點於南北主軸之位置（小時，南→北遞增）；僅用於產生測試矩陣
  siteTravelPos: {
    D1: 0, D2: 0.5, D3: 1.25, D4: 2.0, D5: 2.5, D6: 3.25, D7: 4.3, D8: 5.4, D9: 5.9, D10: 6.7,
  },
  /* 休息會館（2.13「返回休息地」用）：南、中、北各一 */
  restHouses: [
    { id: 'RH-S', name: '南區休息會館', pos: 0.15 },
    { id: 'RH-M', name: '中區休息會館', pos: 0.6 },
    { id: 'RH-N', name: '北區休息會館', pos: 6.0 },
  ],
  siteTravel: { big: {}, small: {} }, // 由 siteTravelPos／restHouses 展開（見檔尾 buildSiteTravel）
  travelUnitMin: 30,        // 最小計算單位（分）
  travelConcavity: 0.04,    // 次可加性係數：每小時折減 4%，折減上限對應 5 小時
  bigExtraMin: 30,          // 大車較小車多耗之時間

  /* ---- 2.12 司機休息與用餐（依「純累積行駛時間」觸發，共用不歸零時數線，每日歸零）---- */
  driverBreaks: [
    { afterDriveMin: 180, kind: '第一次休息', costMin: 30 },
    { afterDriveMin: 240, kind: '第一次用餐', costMin: 60 },
    { afterDriveMin: 360, kind: '第二次休息', costMin: 30 },
    { afterDriveMin: 480, kind: '第二次用餐', costMin: 30 },
    { afterDriveMin: 600, kind: '第三次休息', costMin: 30 },
  ],

  /* ---- 幹線出發（基地）據點：主檔參數，不寫死於程式（B-1）----
     依規格背景設為桃園龍潭（中間位置）。基地以北據點（D10 台北）不在現行
     「自基地南下、折返北上回基地」車次模型的路線上，排班方式待業務確認（TODO B-2）；
     在政策確定前，涉及北側據點的託運單不排入並於派車 trace 明確說明。 */
  homeSite: 'D9',

  /* ---- 2.13 每日總在勤時間上限與其組成（自司機實際到班起算）---- */
  dailyDutyMin: 12.5 * 60,  // 12.5 小時：涵蓋待勤/前後緩衝/裝卸/行駛/休息用餐
  shiftStartDefault: '08:00', // 2.14 排班一律以表定上班時間為基準（實際到班 07:30–08:30 屬事後例外）
  prepMin: 30,              // 出勤前緩衝：車輛檢查＋前往報到 ★示意，待業務提供（Q2）
  closeMin: 20,             // 收工後緩衝：車輛檢整 ★示意，待業務提供（Q2）；「返回休息地」另查路程表
  maxTripDays: 3,           // 目前已知最大出勤天數（跨夜則當日時數線歸零）

  /* ---- 限制條件（業務單位公式頁；詳 docs/SPEC-DATA.md 第 1 節）---- */
  // 1. 出車前 2 日 1200 時停止媒合
  matchCutoffDaysBefore: 2,
  matchCutoffTime: '12:00',
  // 2. 正常狀況：每日 1700 後不前往受限據點（身分由據點旗標 lateRestricted 決定）
  noArrivalAfter: '17:00',
  // 3. 受限據點之回程媒合，裝貨須於該點 returnLoadBy 前完成
  //    測試資料以最南端據點 D1 代表一個受限據點。
  /* ---- 回程全域直達鎖定：撞期判定時間窗寬（分，示意；窗寬待業務確認 B-5）---- */
  directLockWindowMin: 240,

  /* ---- 3.1 各據點出差「最短天數表」：依 車型（大車/小車）× 目的地 查表 ----
     ★ 停靠與否不影響天數；此表為寬鬆估計值，僅供排班參考顯示，
       不參與運算、不反過來限制 12.5 小時精算結果。★示意值待業務提供（Q1）。 */
  minTripDays: {
    big:   { D8: 1, D7: 1, D6: 2, D5: 2, D4: 2, D3: 2, D2: 3, D1: 3 },
    small: { D8: 1, D7: 1, D6: 2, D5: 2, D4: 2, D3: 3, D2: 3, D1: 3 },
  },

  /* ---- 車輛主檔（含資源池別 G05/G60）----
     homeSite＝歸屬據點：行政與資產管理上固定隸屬（保養、常駐、鑰匙管理），不因單次出差改變（C-2）
     currentSite＝當前位置：排班可用性判斷依據（G59）；無進行中多天任務時兩者相同 */
  vehicles: [
    // 物流池（模組 A/B）
    { id: 'V-L01', name: '物流貨車 01', pool: 'LOGI', homeSite: 'S1', currentSite: 'S1',
      dims: { l: 420, w: 180, h: 190 }, volume: 420*180*190/1000, weight: 3000 },
    { id: 'V-L02', name: '物流貨車 02', pool: 'LOGI', homeSite: 'S1', currentSite: 'S1',
      dims: { l: 360, w: 175, h: 185 }, volume: 360*175*185/1000, weight: 2500 },
    // sizeClass：3.1 天數表查表維度（大車 big／小車 small）；決定方式待業務確認（Q3）
    { id: 'V-T01', name: '幹線聯結車 01', pool: 'LOGI', homeSite: 'D9', currentSite: 'D9', sizeClass: 'big',
      dims: { l: 600, w: 240, h: 240 }, volume: 600*240*240/1000, weight: 8000 },
    { id: 'V-T02', name: '幹線貨車 02', pool: 'LOGI', homeSite: 'D9', currentSite: 'D9', sizeClass: 'small',
      dims: { l: 480, w: 200, h: 210 }, volume: 480*200*210/1000, weight: 5000 },
    // 商務共乘池（模組 C）— 完全分開（資源池原則）
    { id: 'V-B01', name: '商務廂車 01', pool: 'BIZ', homeSite: 'D10', currentSite: 'D10', seats: 7 },
    { id: 'V-B02', name: '商務轎車 02', pool: 'BIZ', homeSite: 'D10', currentSite: 'D10', seats: 4 },
    { id: 'V-B03', name: '商務廂車 03', pool: 'BIZ', homeSite: 'D6',  currentSite: 'D6',  seats: 9 },
    { id: 'V-B04', name: '商務廂車 04', pool: 'BIZ', homeSite: 'D10', currentSite: 'D10', seats: 5 },
  ],

  /* ---- 司機主檔（獨立資源 G61）---- */
  // homeSite＝歸屬據點（C-2）；currentSite＝當前位置（G59）
  drivers: [
    { id: 'DR1', name: '陳大文', pool: 'LOGI', homeSite: 'S1',  currentSite: 'S1' },
    { id: 'DR2', name: '林志明', pool: 'LOGI', homeSite: 'D10', currentSite: 'D10' },
    { id: 'DR3', name: '王建國', pool: 'BIZ',  homeSite: 'D10', currentSite: 'D10' },
    { id: 'DR4', name: '張美華', pool: 'BIZ',  homeSite: 'D10', currentSite: 'D10' },
    { id: 'DR5', name: '李俊宏', pool: 'BIZ',  homeSite: 'D6',  currentSite: 'D6' },
    { id: 'DR6', name: '許雅雯', pool: 'BIZ',  homeSite: 'D10', currentSite: 'D10' },
  ],

  /* ---- 車輛保修排程（G60）示意 ---- */
  // 期間涵蓋範例任務日（08-27~08-29），排班時應自動排除 V-B02
  maintenance: [
    { vehicle: 'V-B02', from: '2026-08-27', to: '2026-08-29', reason: '定期保養' },
  ],

  /* ---- 司機請假（模擬內網 API 回傳 G61）精確起訖 ---- */
  driverLeaves: [
    { driver: 'DR4', date: '2026-08-27', from: '09:00', to: '13:00', type: '半天假' },
  ],

  /* ---- 商務共乘車程表（分鐘，公司自建 G62）出發地|目的地 ---- */
  bizTravel: {
    '台北總部|桃園機場T1': 50,
    '台北總部|桃園機場T2': 55,
    '台北總部|高鐵台北站': 20,
    '台北總部|台中辦公室': 130,
    '台中辦公室|桃園機場T1': 120,
    '台北總部|新竹分公司': 75,
  },
  bizBuffer: 15, // 系統內建緩衝分鐘

  /* ---- 共乘出發地對應據點（供當前位置比對 G59）---- */
  bizOriginSite: { '台北總部': 'D10', '台中辦公室': 'D6' },
  /* ---- 據點對應共乘地點名（供多天任務強制回歸屬據點 C-3）---- */
  bizSiteOrigin: { 'D10': '台北總部', 'D6': '台中辦公室' },
  /* ---- 是否允許跨據點空車調度（C-1 待業務確認）----
     false＝維持 G59「當前位置須與出發地相符」；true＝允許調度，改以空駛時間最小者優先 */
  allowCrossSiteDeadhead: false,

  /* ---- 共乘出發地 / 目的地選單（無地址 G62）---- */
  bizOrigins: ['台北總部', '台中辦公室'],
  bizDests: ['桃園機場T1', '桃園機場T2', '高鐵台北站', '台中辦公室', '新竹分公司'],
  transferPoints: ['桃園機場T1', '桃園機場T2', '高鐵台北站'], // 交通轉運點（單程單限定 G50）

  /* ---- 審批對應（申請人 -> 直屬主管，沿用不另建表 G20）---- */
  approvalMap: {
    '業務部-周雅婷': '業務部-主管 黃經理',
    '研發部-吳承恩': '研發部-主管 劉協理',
    '財務部-鄭安琪': '財務部-主管 蔡副理',
  },
};

/* 展開 2.9 據點相互路程表：由南北位置刻度產生完整查表矩陣（含休息會館）
   實際數值到位後可直接改寫 DB.siteTravel，程式一律走查表 */
(function buildSiteTravel() {
  const pos = Object.assign({}, DB.siteTravelPos);
  DB.restHouses.forEach(r => { pos[r.id] = r.pos; });
  const U = DB.travelUnitMin;
  const roundUnit = m => Math.round(m / U) * U;
  const ids = Object.keys(pos);
  ids.forEach(a => ids.forEach(b => {
    const key = a + '|' + b;
    if (a === b) { DB.siteTravel.small[key] = 0; DB.siteTravel.big[key] = 0; return; }
    const raw = Math.abs(pos[a] - pos[b]);                          // naive 相加距離（小時）
    const adj = raw * (1 - DB.travelConcavity * Math.min(raw, 5));  // 次可加性折減
    const small = Math.max(U, roundUnit(adj * 60));                 // 相異節點至少一個計算單位
    DB.siteTravel.small[key] = small;
    DB.siteTravel.big[key] = small <= U ? small : small + DB.bigExtraMin;
  }));
})();

/* 工具：格式化體積（公升） */
function fmtVol(cm3) { return (cm3 / 1000).toFixed(0); }
function pad2(n) { return String(n).padStart(2, '0'); }
function minToHHMM(min) { return pad2(Math.floor(min/60)) + ':' + pad2(min%60); }
function hhmmToMin(s) { const [h,m] = s.split(':').map(Number); return h*60 + m; }
