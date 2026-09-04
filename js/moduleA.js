/* ============================================================
   moduleA.js — 模組 A：區域內物流貨運
   PLAN.md Phase 2 / Guardrails G10–G20
   固定 10 站、時間軸最近班次媒合、站內時間額度、順延
   容量採「站區間淨值」：收貨站上貨佔用 → 送貨站卸貨釋放（先卸後裝 3.4/3.5）
   排班日期：serviceDate（exact 可選今天或未來日期；asap 即當天）；
   同一班次的容量與站內額度僅與「同日期」的單互相競用；
   當天已過的班次不可媒合（以現在時間為界，now() 可注入以利測試）
   ============================================================ */

const ModuleA = {
  applications: [], // 申請單
  seq: 1,
  approveSeq: 1,    // 審核通過時間序（G16 排序用）

  /* ---- 現在時間（可於測試注入固定值）與日期工具 ---- */
  now() { return new Date(); },
  todayStr() { const d = this.now(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; },
  nowMin() { const d = this.now(); return d.getHours() * 60 + d.getMinutes(); },

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
      station: data.station,            // 送貨站（迄）
      building: data.building,
      pickStation: data.pickStation || null, // 收貨站（起）站 id；未帶＝自路線起點載運（相容）
      pickupLoc: data.pickupLoc || '',  // 收貨地點顯示字串
      deliverTime: data.deliverTime || '', // 期望收貨時間 HH:MM（exact 模式僅用於挑班次，非硬性截止 4.1）
      serviceDate: data.serviceDate || this.todayStr(), // 排班日期（exact 可指定今天或未來；asap＝當天）
      recipient: data.recipient || {},  // 接收人資訊：{ unit, name, phone, agentName, agentPhone }
      items: data.items,
      recvMode: data.recvMode,       // 'exact'（依期望收貨時間挑最近班次）| 'asap'（越快越好）
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
    app.assignedShift = null; app.arrival = null; app.expectDiffMin = null;
    const r = this.match(app);   // 成功時 match 內已設 status='matched'
    app.matchTrace = r.trace;
    app.status = r.ok ? 'matched' : 'unscheduled';
    app.note = r.ok ? '' : r.msg;
    return r;
  },

  // 媒合成功即完成排班，不需接收人「確認接受」；交貨確認可由 matched 直接進入
  // 交貨確認（matched → delivered）；可由接收人確認收到、或調度/駕駛回報已送達
  confirmDelivery(app, by) { if (app.status === 'matched') { app.status = 'delivered'; app.deliveredAt = Date.now(); app.deliveredBy = by || '調度室'; } },

  /* ---- 駕駛異常回報（G20）----
     incident＝''／null 代表「正常運送」（預設）；否則為異常原因字串（使用者不準時／使用者沒出現）。
     設為異常時寄信通知（一單一信：申請人＋直屬主管）；設回正常則僅存檔不寄信。 */
  reportIncident(app, reason) {
    app.incident = reason || '';               // 空字串＝正常運送
    if (app.incident) this.sendIncidentMail(app, app.incident);
    return app.incident;
  },
  /* 寄信服務（雛形：空 function，實際寄信待實作）——一單一信給申請人＋直屬主管（沿用審批對應） */
  sendIncidentMail(app, reason) {
    /* TODO: 串接寄信服務。收件人＝申請人＋ DB.approvalMap[app.applicant]；內容含單號/站點/原因/日期 */
  },

  /* ============================================================
     已排定車次異動（業務單位手動調整）
     - shiftPlans：以「收貨日期＋班次」為鍵，覆寫該車次的車輛/司機（不動全域班次主檔）。
     - reassignShift：將申請單改派到指定班次（同日），重算到站時間。
     - removeFromShift：把申請單移出班次（回未排入，待重新指定）。
     ============================================================ */
  shiftPlans: {}, // key `${date}|${shiftId}` -> { vehicle, driver(id) }
  logiVehicles() { return DB.vehicles.filter(v => v.pool === 'LOGI' && v.homeSite && v.homeSite[0] === 'S'); },
  logiDrivers() { return DB.drivers.filter(d => d.pool === 'LOGI'); },
  defaultVehicleFor(shiftId) { const sh = DB.regionalShifts.find(s => s.id === shiftId); return sh ? sh.vehicle : null; },
  // 預設司機：物流車與物流司機依序對應（與司機任務單 logiDriverName 一致）
  defaultDriverFor(vehId) {
    const vs = this.logiVehicles(), ds = this.logiDrivers();
    const i = vs.findIndex(v => v.id === vehId);
    return (i >= 0 && ds.length) ? ds[i % ds.length].id : (ds[0] ? ds[0].id : null);
  },
  // 取某車次（日期＋班次）目前的車輛/司機（有覆寫取覆寫，否則取預設）
  shiftPlan(date, shiftId) {
    const p = this.shiftPlans[date + '|' + shiftId];
    if (p) return { vehicle: p.vehicle, driver: p.driver };
    const vehicle = this.defaultVehicleFor(shiftId);
    return { vehicle, driver: this.defaultDriverFor(vehicle) };
  },
  setShiftPlan(date, shiftId, plan) {
    this.shiftPlans[date + '|' + shiftId] = { vehicle: plan.vehicle, driver: plan.driver };
    return this.shiftPlans[date + '|' + shiftId];
  },
  // 改派班次（同日）：更新 assignedShift 並依新班次重算到站時間；狀態回 matched
  reassignShift(app, shiftId) {
    const sh = DB.regionalShifts.find(s => s.id === shiftId);
    if (!sh) return app;
    app.assignedShift = shiftId;
    app.status = 'matched';
    const st = DB.stations.find(s => s.id === app.station);
    app.arrival = st ? minToHHMM(this.shiftArrivalAtStation(sh, st.order)) : null;
    return app;
  },
  // 移出班次：回未排入、清空班次與到站，待業務重新指定
  removeFromShift(app) {
    app.assignedShift = null; app.arrival = null; app.status = 'unscheduled';
    app.note = '已由「已排定車次異動」移出班次，待重新指定。';
    return app;
  },

  /* 各班次到達某站的時間（示意）：出發時間 + 站序×固定行駛 */
  shiftArrivalAtStation(shift, stationOrder) {
    return hhmmToMin(shift.depart) + stationOrder * 12; // 每站 12 分鐘遞增（示意）
  },

  /* 站內時間額度（分鐘）：每站每班次固定額度，示意 */
  STATION_QUOTA: 40,

  /* 貨物在路線上的佔用站區間 [from, to)：收貨站序上貨 → 送貨站序抵達即卸（先卸後裝）
     未帶收貨站或順序不合（收貨站不在送貨站之前）→ 自路線起點(0)載運，抵送貨站卸（相容） */
  segmentOf(a) {
    const drop = DB.stations.find(s => s.id === a.station).order;
    const pickSt = a.pickStation ? DB.stations.find(s => s.id === a.pickStation) : null;
    const pick = pickSt ? pickSt.order : 0;
    return (pick < drop) ? { from: pick, to: drop } : { from: 0, to: drop };
  },

  /* 某班次於站序 s（駛離該站時）的車上淨負載：有效體積／重量／地板投影
     只累計「佔用區間涵蓋 s」的已排入單 → 卸貨後容量、重量、地板同步釋放（3.4/3.5） */
  netLoadAt(shiftId, s, date) {
    return this.applications
      .filter(a => a.assignedShift === shiftId && ['matched', 'delivered'].includes(a.status)
        && (date == null || a.serviceDate === date)) // 僅同日期的單互相競用容量
      .reduce((acc, a) => {
        const seg = this.segmentOf(a);
        if (s >= seg.from && s < seg.to) {
          const e = effectiveLoad(a.items);
          acc.volume += e.volume; acc.weight += e.weight; acc.floor += e.floor;
        }
        return acc;
      }, { volume: 0, weight: 0, floor: 0 });
  },

  /* 某班次於某站的時間額度已用量：卸貨（送貨站）與上貨（收貨站）的 handleMin 都計入該站佔用 */
  quotaUsedAt(shiftId, stationId, date) {
    return this.applications
      .filter(a => a.assignedShift === shiftId && ['matched', 'delivered'].includes(a.status)
        && (date == null || a.serviceDate === date)) // 僅同日期的單互相佔用站內額度
      .reduce((sum, a) => {
        const split = (a.loadMin || a.unloadMin) > 0;
        let t = 0;
        if (a.station === stationId) t += split ? a.unloadMin : a.handleMin; // 卸貨佔用
        if (a.pickStation === stationId) t += a.loadMin || 0;               // 上貨佔用
        return sum + t;
      }, 0);
  },

  /* 媒合迴圈（G10/G11/G12/G19）— 回傳 trace 與結果
     A-1：期望收貨時間只影響班次排序（|到站−期望| 最小優先，早晚都比），非硬性截止；
          失敗原因只分 toobig（空車都放不下）與 full（容量或站內額度皆滿）。
     A-2：容量採站區間淨值——先卸後裝，體積/重量/地板到送貨站即釋放。
     日期：僅同 serviceDate 的單互相競用容量與額度；當天已過的班次不可媒合。 */
  match(app) {
    const trace = [];
    const station = DB.stations.find(s => s.id === app.station); // 送貨站（迄）

    // --- 排班日期與「現在」---
    const today = this.todayStr();
    const date = app.serviceDate || today;
    if (date < today) {
      trace.push(`<span class="no">✗ 排班日期 ${date} 已過（今天 ${today}）</span>`);
      return { ok: false, reason: 'past', trace, msg: `日期已過：${date} 早於今天，請選擇今天或未來日期。` };
    }
    const isToday = (date === today);
    const cutoff = isToday ? this.nowMin() : -1; // 未來日期不受今日時間限制
    trace.push(`<span class="dim">排班日期：${date}${isToday ? `（今天，現在 ${minToHHMM(cutoff)}；已發車班次不採計）` : '（未來日期，全日班次皆可）'}</span>`);
    const vehiclePool = {}; // 各班次車輛容量
    DB.regionalShifts.forEach(sh => {
      vehiclePool[sh.id] = DB.vehicles.find(v => v.id === sh.vehicle);
    });

    // 期望收貨時間：exact 模式的排序目標（不作硬性限制 4.1）
    const expect = (app.recvMode === 'exact' && app.deliverTime) ? hhmmToMin(app.deliverTime) : null;

    // 依收貨模式決定嘗試班次順序（G19）
    let shifts = [...DB.regionalShifts];
    if (expect != null) {
      shifts.sort((a, b) => {
        const da = Math.abs(this.shiftArrivalAtStation(a, station.order) - expect);
        const db = Math.abs(this.shiftArrivalAtStation(b, station.order) - expect);
        return da - db;
      });
      trace.push(`<span class="dim">收貨模式：指定期望 ${app.deliverTime}｜依到站時間差最小排序班次（早晚都比，非硬性截止）</span>`);
    } else {
      // 越快越好：離現在最近、最早排得進去的班次（依出發時間 G19）
      shifts.sort((a, b) => hhmmToMin(a.depart) - hhmmToMin(b.depart));
      trace.push(`<span class="dim">收貨模式：越快越好｜依最早（離現在最近）班次排序</span>`);
    }

    const seg = this.segmentOf(app);
    const segFrom = DB.stations.find(s => s.order === seg.from);
    trace.push(`<span class="dim">佔用站區間：${segFrom ? segFrom.name + ' 上貨' : '路線起點載運'} → ${station.name} 卸貨（先卸後裝，體積/重量/地板到站釋放）</span>`);

    // 逐班次嘗試（時間軸最近的下一班 G10）
    let fitsSomeEmpty = false; // 是否存在「空車放得下」的班次（用來區分太大 vs 今天已滿）
    let anyUsable = false;     // 是否存在「時間上還來得及」的班次（用來區分已過 vs 已滿）
    for (let i = 0; i < shifts.length; i++) {
      const sh = shifts[i];
      const veh = vehiclePool[sh.id];
      const arr = this.shiftArrivalAtStation(sh, station.order);
      const departMin = hhmmToMin(sh.depart); // 發車時間（車輛離開基地）
      trace.push(`\n▶ 嘗試班次 <span class="hl">${sh.label}</span>（車 ${veh.id}）發車 ${sh.depart}｜到站約 ${minToHHMM(arr)}`);

      // --- 已發車班次不可媒合：司機出發後無法得知中途新單，故僅「尚未發車」的班次可排（G10/G19）---
      if (departMin <= cutoff) {
        trace.push(`  <span class="no">✗ 本班已於 ${sh.depart} 發車（現在 ${minToHHMM(cutoff)}）→ 車已離開基地、無法插入新單</span>`);
        continue;
      }
      anyUsable = true;

      // --- 尺寸/容量可行性：空車是否根本放不下（與其他訂單無關 → 判斷「太大」）---
      const emptyRes = checkLoad(app.items, veh, { volume: 0, weight: 0 });
      if (emptyRes.ok) fitsSomeEmpty = true;
      else trace.push(`  <span class="no">✗ 本班車即使空車也放不下（尺寸／容量太大）</span>`);

      // --- 站內時間額度（G16）：上貨站與卸貨站各自累計（卸與裝都計入該站佔用）---
      const split = (app.loadMin || app.unloadMin) > 0;
      const dropDemand = split ? app.unloadMin : app.handleMin;
      const dropUsed = this.quotaUsedAt(sh.id, app.station, date);
      let quotaFail = null;
      if (dropDemand > this.STATION_QUOTA - dropUsed) {
        quotaFail = `送貨站 ${station.name} 額度不足：已用 ${dropUsed} 分、剩 ${this.STATION_QUOTA - dropUsed} 分 < 本單卸貨 ${dropDemand} 分`;
      }
      if (!quotaFail && app.pickStation && (app.loadMin || 0) > 0) {
        const pickUsed = this.quotaUsedAt(sh.id, app.pickStation, date);
        if (app.loadMin > this.STATION_QUOTA - pickUsed) {
          const ps = DB.stations.find(s => s.id === app.pickStation);
          quotaFail = `收貨站 ${ps ? ps.name : app.pickStation} 額度不足：已用 ${pickUsed} 分、剩 ${this.STATION_QUOTA - pickUsed} 分 < 本單上貨 ${app.loadMin} 分`;
        }
      }
      if (quotaFail) {
        trace.push(`  <span class="no">✗ 站內時間額度：${quotaFail} → 跳過此班（G16/G17）</span>`);
        continue; // 順延下一班（G17）
      }

      // --- 裝載判定（LoadFeasibilityService）：站區間逐站淨值檢查（A-2）---
      // 貨物佔用區間 [seg.from, seg.to) 內每一站，車上淨負載（僅涵蓋該站的單）＋本單須通過 checkLoad
      let res = null, failStation = null, peak = { volume: -1 };
      for (let s = seg.from; s < seg.to; s++) {
        const base = this.netLoadAt(sh.id, s, date);
        const r = checkLoad(app.items, veh, base);
        if (base.volume > peak.volume) { peak = base; peak.at = s; res = r; }
        if (!r.ok) { res = r; failStation = s; break; }
      }
      if (res == null) { // 退化區間（理論上不會發生）：以空車判定
        res = emptyRes;
      }
      trace.push(`  <span class="dim">區間內峰值淨負載 ${Math.max(peak.volume, 0).toFixed(0)}L / ${(peak.weight || 0).toFixed(0)}kg（站序 ${peak.at != null ? peak.at : '—'}，卸貨後即釋放）</span>`);
      res.trace.forEach(t => trace.push('  ' + t));

      if (res.ok) {
        const diff = expect != null ? (arr - expect) : null;
        if (diff != null && diff !== 0) {
          trace.push(`  <span class="dim">到站較期望時間${diff > 0 ? '晚' : '早'} ${Math.abs(diff)} 分（僅提示，不影響排班）</span>`);
        }
        trace.push(`\n<span class="ok">✓ 裝得下 → 排入 ${sh.label}（媒合完成，免確認接受 G11）</span>`);
        app.status = 'matched';
        app.assignedShift = sh.id;
        app.arrival = minToHHMM(arr);
        app.expectDiffMin = diff; // 與期望收貨時間的差（分，正=晚、負=早、null=未指定）
        return { ok: true, shift: sh, trace, arrival: minToHHMM(arr), expectDiffMin: diff };
      }
      const fs = failStation != null ? DB.stations.find(x => x.order === failStation) : null;
      trace.push(`  <span class="no">✗ 裝不下${fs ? `（於 ${fs.name} 前區段容量不足）` : ''} → pass 下一班（G11）</span>`);
    }

    // 全部班次皆無法排入（G12 不留候補、不排隔日）
    if (!anyUsable) {
      trace.push(`\n<span class="no">✗ 今日班次皆已發車（現在 ${minToHHMM(cutoff)}）</span>`);
      return { ok: false, reason: 'past', trace,
        msg: `今日班次已過：目前時間 ${minToHHMM(cutoff)}，今天各班次皆已發車、無法再插入新單，請改指定未來日期。` };
    }
    if (!fitsSomeEmpty) {
      trace.push(`\n<span class="no">✗ 任何一班車空車都放不下 → 貨物太大</span>`);
      return { ok: false, reason: 'toobig', trace, msg: '貨物太大：超過任何一班車輛的尺寸或容量，無法承運。' };
    }
    trace.push(`\n<span class="no">✗ 今日各班次容量／時間額度皆已滿</span>`);
    return { ok: false, reason: 'full', trace, msg: '今天已滿：各班次容量或時間額度皆不足，請改期。' };
  },
};
