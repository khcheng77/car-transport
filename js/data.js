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

  /* ---- 區域內物流班次（人工每日排定 G18）---- */
  regionalShifts: [
    { id: 'R-A1', label: '早班 08:30', depart: '08:30', vehicle: 'V-L01' },
    { id: 'R-A2', label: '午班 13:00', depart: '13:00', vehicle: 'V-L02' },
    { id: 'R-A3', label: '末班 16:30', depart: '16:30', vehicle: 'V-L01' },
  ],

  /* ---- 南北幹線 10 據點（G30）南→北一直線固定順序 ---- */
  sites: [
    { id: 'D1', name: '屏東據點', order: 1 },
    { id: 'D2', name: '高雄左營', order: 2 },
    { id: 'D3', name: '台南據點', order: 3 },
    { id: 'D4', name: '嘉義據點', order: 4 },
    { id: 'D5', name: '雲林據點', order: 5 },
    { id: 'D6', name: '台中據點', order: 6 },
    { id: 'D7', name: '苗栗據點', order: 7 },
    { id: 'D8', name: '新竹據點', order: 8 },
    { id: 'D9', name: '桃園龍潭', order: 9 },
    { id: 'D10',name: '台北據點', order: 10 },
  ],

  /* ---- 據點間行駛分鐘數（相鄰站，示意）---- */
  legMinutes: 55, // 相鄰兩據點固定行駛時間（示意，不分尖離峰 G62）

  /* ---- 天數對照表（示意，P1 待業務確認）---- */
  //  key = 出發據點 -> 終點據點；此處以「出發台北D10、南下」示意
  dayCountDirect:   { 'D9': 1, 'D6': 1, 'D3': 2, 'D2': 2, 'D1': 2 }, // 直達
  dayCountStopover: { 'D9': 1, 'D6': 2, 'D3': 3, 'D2': 3, 'D1': 3 }, // 有停靠

  /* ---- 車輛主檔（含資源池別 G05/G60）---- */
  vehicles: [
    // 物流池（模組 A/B）
    { id: 'V-L01', name: '物流貨車 01', pool: 'LOGI', home: 'S1',
      dims: { l: 420, w: 180, h: 190 }, volume: 420*180*190/1000, weight: 3000 },
    { id: 'V-L02', name: '物流貨車 02', pool: 'LOGI', home: 'S1',
      dims: { l: 360, w: 175, h: 185 }, volume: 360*175*185/1000, weight: 2500 },
    { id: 'V-T01', name: '幹線聯結車 01', pool: 'LOGI', home: 'D10',
      dims: { l: 600, w: 240, h: 240 }, volume: 600*240*240/1000, weight: 8000 },
    { id: 'V-T02', name: '幹線貨車 02', pool: 'LOGI', home: 'D10',
      dims: { l: 480, w: 200, h: 210 }, volume: 480*200*210/1000, weight: 5000 },
    // 商務共乘池（模組 C）— 完全分開（資源池原則）
    { id: 'V-B01', name: '商務廂車 01', pool: 'BIZ', home: 'D10', seats: 7 },
    { id: 'V-B02', name: '商務轎車 02', pool: 'BIZ', home: 'D10', seats: 4 },
    { id: 'V-B03', name: '商務廂車 03', pool: 'BIZ', home: 'D6',  seats: 9 },
  ],

  /* ---- 司機主檔（獨立資源 G61）---- */
  drivers: [
    { id: 'DR1', name: '陳大文', pool: 'LOGI', home: 'S1' },
    { id: 'DR2', name: '林志明', pool: 'LOGI', home: 'D10' },
    { id: 'DR3', name: '王建國', pool: 'BIZ',  home: 'D10' },
    { id: 'DR4', name: '張美華', pool: 'BIZ',  home: 'D10' },
    { id: 'DR5', name: '李俊宏', pool: 'BIZ',  home: 'D6' },
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

/* 工具：格式化體積（公升） */
function fmtVol(cm3) { return (cm3 / 1000).toFixed(0); }
function pad2(n) { return String(n).padStart(2, '0'); }
function minToHHMM(min) { return pad2(Math.floor(min/60)) + ':' + pad2(min%60); }
function hhmmToMin(s) { const [h,m] = s.split(':').map(Number); return h*60 + m; }
