/* ============================================================
   moduleA.js — 模組 A：區域內物流貨運
   PLAN.md Phase 2 / Guardrails G10–G20
   固定 10 站、時間軸最近班次媒合、站內時間額度、順延
   ============================================================ */

const ModuleA = {
  applications: [], // 申請單
  seq: 1,
  approveSeq: 1,    // 審核通過時間序（G16 排序用）

  // 收貨時間模式 G19：exact=指定期望時間 / asap=越快越好
  // 區域內物流：不經主管核准、不需業務按鈕；送出後由 submit() 立即自動媒合
  createApp(data) {
    // 上貨時間＋下貨時間（分），加總為站內佔用時間 handleMin（G15）；相容：只給 handleMin 亦可
    const split = (data.loadMin != null || data.unloadMin != null);
    const loadMin = +(data.loadMin || 0);
    const unloadMin = +(data.unloadMin || 0);
    const handleMin = split ? (loadMin + unloadMin) : (+data.handleMin || 0);
    const app = {
      id: 'LA' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      station: data.station,
      building: data.building,
      pickupLoc: data.pickupLoc || '',  // 收貨地點（示意）
      deliverTime: data.deliverTime || '', // 交貨時間 幾點交貨（示意）HH:MM
      items: data.items,
      recvMode: data.recvMode,       // 'exact' | 'asap'
      expectTime: data.expectTime,   // exact 模式的期望到站時間
      loadMin, unloadMin,            // 上貨/下貨時間（分）
      handleMin,                     // 站內佔用時間＝上貨＋下貨（G15）
      submitSeq: this.approveSeq++,  // 送出序（同站處理順序＝送出先後，取代原審核通過時間 G16）
      status: 'submitted',           // submitted →（自動媒合）→ matched / unscheduled
      assignedShift: null,
      note: '',
      matchTrace: null,              // 自動媒合過程（供明細顯示）
      createdAt: new Date(),         // 建立時間（查詢/列表用）
    };
    this.applications.push(app);
    return app;
  },

  // 送出即自動媒合（無主管核准、無業務按鈕）：建立後立即跑時間軸最近班次媒合
  // 成功 → status='matched'、assignedShift/arrival 填入；失敗 → status='unscheduled'、note 記原因
  submit(data) {
    const app = this.createApp(data);
    const r = this.match(app);
    app.matchTrace = r.trace;
    if (!r.ok) { app.status = 'unscheduled'; app.note = r.msg; }
    return { app, result: r };
  },

  // 重新媒合（僅限尚未媒合成功者，例如編輯貨物後再試）：清掉舊排班再跑一次
  rematch(app) {
    app.assignedShift = null; app.arrival = null;
    const r = this.match(app);   // 成功時 match 內已設 status='matched'
    app.matchTrace = r.trace;
    app.status = r.ok ? 'matched' : 'unscheduled';
    app.note = r.ok ? '' : r.msg;
    return r;
  },

  // 媒合成功即完成排班，不需接收人「確認接受」；交貨確認可由 matched 直接進入
  // 交貨確認（matched → delivered）；可由接收人確認收到、或調度/駕駛回報已送達
  confirmDelivery(app, by) { if (app.status === 'matched') { app.status = 'delivered'; app.deliveredAt = Date.now(); app.deliveredBy = by || '調度室'; } },

  /* 各班次到達某站的時間（示意）：出發時間 + 站序×固定行駛 */
  shiftArrivalAtStation(shift, stationOrder) {
    return hhmmToMin(shift.depart) + stationOrder * 12; // 每站 12 分鐘遞增（示意）
  },

  /* 站內時間額度（分鐘）：每站每班次固定額度，示意 */
  STATION_QUOTA: 40,

  /* 媒合迴圈（G10/G11/G12/G19）— 回傳 trace 與結果 */
  match(app) {
    const trace = [];
    const station = DB.stations.find(s => s.id === app.station);
    const vehiclePool = {}; // 各班次車輛容量
    DB.regionalShifts.forEach(sh => {
      vehiclePool[sh.id] = DB.vehicles.find(v => v.id === sh.vehicle);
    });

    // 依收貨模式決定嘗試班次順序（G19）
    let shifts = [...DB.regionalShifts];
    if (app.recvMode === 'exact' && app.expectTime) {
      const exp = hhmmToMin(app.expectTime);
      // 到站時間差最小（早晚都比 G19）
      shifts.sort((a, b) => {
        const da = Math.abs(this.shiftArrivalAtStation(a, station.order) - exp);
        const db = Math.abs(this.shiftArrivalAtStation(b, station.order) - exp);
        return da - db;
      });
      trace.push(`<span class="dim">收貨模式：指定期望 ${app.expectTime}｜依到站時間差最小排序班次</span>`);
    } else {
      // 越快越好：最早排得進去（依出發時間 G19）
      shifts.sort((a, b) => hhmmToMin(a.depart) - hhmmToMin(b.depart));
      trace.push(`<span class="dim">收貨模式：越快越好｜依最早班次排序</span>`);
    }

    // 逐班次嘗試（時間軸最近的下一班 G10）
    let fitsSomeEmpty = false; // 是否存在「空車放得下」的班次（用來區分太大 vs 今天已滿）
    for (let i = 0; i < shifts.length; i++) {
      const sh = shifts[i];
      const veh = vehiclePool[sh.id];
      const arr = this.shiftArrivalAtStation(sh, station.order);
      trace.push(`\n▶ 嘗試班次 <span class="hl">${sh.label}</span>（車 ${veh.id}）到站約 ${minToHHMM(arr)}`);

      // --- 尺寸/容量可行性：空車是否根本放不下（與其他訂單無關 → 判斷「太大」）---
      const emptyRes = checkLoad(app.items, veh, { volume: 0, weight: 0 });
      if (emptyRes.ok) fitsSomeEmpty = true;
      else trace.push(`  <span class="no">✗ 本班車即使空車也放不下（尺寸／容量太大）</span>`);

      // --- 站內時間額度（G16）：同站已排入單 + 本單 handleMin 是否超額 ---
      const sameStation = this.applications.filter(a =>
        a.assignedShift === sh.id && a.station === app.station
      );
      const usedQuota = sameStation.reduce((s, a) => s + a.handleMin, 0);
      const remainQuota = this.STATION_QUOTA - usedQuota;
      if (app.handleMin > remainQuota) {
        trace.push(`  <span class="no">✗ 站內時間額度不足：已用 ${usedQuota} 分、剩 ${remainQuota} 分 < 本單 ${app.handleMin} 分 → 跳過此班（G16/G17）</span>`);
        continue; // 順延下一班（G17）
      }

      // --- 裝載判定（LoadFeasibilityService）---
      // 既有負載：該班次車上已排入的所有申請單，逐張累計有效體積與重量（G01/G05）
      const onBoard = this.applications.filter(a =>
        a.assignedShift === sh.id && ['matched', 'delivered'].includes(a.status));
      const startLoad = onBoard.reduce((acc, a) => {
        const e = effectiveLoad(a.items);
        return { volume: acc.volume + e.volume, weight: acc.weight + e.weight };
      }, { volume: 0, weight: 0 });
      trace.push(`  <span class="dim">本班次已排入 ${onBoard.length} 單，車上既有 ${startLoad.volume.toFixed(0)}L / ${startLoad.weight.toFixed(0)}kg</span>`);
      const res = checkLoad(app.items, veh, startLoad);
      res.trace.forEach(t => trace.push('  ' + t));

      if (res.ok) {
        trace.push(`\n<span class="ok">✓ 裝得下 → 排入 ${sh.label}（媒合完成，免確認接受 G11）</span>`);
        app.status = 'matched';
        app.assignedShift = sh.id;
        app.arrival = minToHHMM(arr);
        return { ok: true, shift: sh, trace, arrival: minToHHMM(arr) };
      }
      trace.push(`  <span class="no">✗ 裝不下 → pass 下一班（G11）</span>`);
    }

    // 全部班次皆無法排入：區分「太大」與「今天已滿」（G12 不留候補、不排隔日）
    if (!fitsSomeEmpty) {
      trace.push(`\n<span class="no">✗ 任何一班車空車都放不下 → 貨物太大</span>`);
      return { ok: false, reason: 'toobig', trace, msg: '貨物太大：超過任何一班車輛的尺寸或容量，無法承運。' };
    }
    trace.push(`\n<span class="no">✗ 今日各班次容量／時間額度皆已滿</span>`);
    return { ok: false, reason: 'full', trace, msg: '今天已滿：各班次容量或時間額度皆不足，請改期。' };
  },
};
