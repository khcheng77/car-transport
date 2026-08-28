/* ============================================================
   moduleC.js — 模組 C：差旅派車自動媒合（共乘）
   PLAN.md Phase 5 / Guardrails G50–G63
   來回單/單程單、批次媒合按鈕、資源可用性檢核、手動併車、逾期作廢
   ============================================================ */

const ModuleC = {
  applications: [],
  batches: [],
  seq: 1,
  batchSeq: 1,
  approveSeq: 1,

  // 申請端只負責建立，狀態為「待審核」（G63 員工填單 → 主管准駁）
  createApp(data) {
    const app = {
      id: 'BZ' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      dept: data.dept,
      ext: data.ext,
      type: data.type,             // 'round' 來回單 | 'oneway' 單程單
      origin: data.origin,
      dest: data.dest,
      departDate: data.departDate,   // 起始日期（去程當天）yyyy-mm-dd
      earliestPickup: data.earliestPickup, // 去程最早上車 HH:MM
      returnDate: data.returnDate || data.departDate, // 結束日期（回程當天）；單程單不適用
      earliestReturn: data.earliestReturn, // 回程上車時間（來回單）HH:MM
      pax: data.pax,
      approvedAt: null,
      status: 'submitted',         // submitted|approved|rejected|matched|manual|coordinate|void
      vehicle: null, driver: null,
      groupId: null,
      note: '',
      createdAt: new Date(),
    };
    this.applications.push(app);
    return app;
  },

  // 主管准駁；駁回保留紀錄不進排班池（G63）；note＝審核備註（選填/駁回必填）
  approve(app, note) { app.status = 'approved'; app.approvedAt = this.approveSeq++; if (note != null) app.reviewNote = note; },
  reject(app, note) { app.status = 'rejected'; app.approvedAt = null; if (note != null) app.reviewNote = note; },

  // 乘客確認上車（matched → boarded）
  confirmBoard(app) { if (app.status === 'matched') { app.status = 'boarded'; app.boardedAt = Date.now(); } },
  // 行程完成確認（boarded → completed）：乘客抵達確認，或調度回報完成
  completeTrip(app, by) { if (app.status === 'boarded') { app.status = 'completed'; app.completedAt = Date.now(); app.completedBy = by || '調度室'; } },

  /* 車程表查詢 + 緩衝（G62）*/
  travelMin(origin, dest) {
    const m = DB.bizTravel[origin + '|' + dest];
    return m != null ? m + DB.bizBuffer : null;
  },

  /* 最晚抵達時間（唯讀參考，不參與媒合 G55）*/
  latestArrival(app) {
    const t = this.travelMin(app.origin, app.dest);
    if (t == null) return '—';
    return minToHHMM(hhmmToMin(app.earliestPickup) + t);
  },

  /* ---- 資源可用性檢核（G52/G59/G60/G61）---- */
  WORK_END: hhmmToMin('20:30'),  // 工時上限（G52）

  isVehicleUnderMaintenance(vId, date) {
    return DB.maintenance.some(m => m.vehicle === vId && date >= m.from && date <= m.to);
  },
  driverLeaveOverlap(dId, date, startMin, endMin) {
    return DB.driverLeaves.some(l => l.driver === dId && l.date === date &&
      startMin < hhmmToMin(l.to) && endMin > hhmmToMin(l.from)); // 時段重疊即不可（G61）
  },
  /* 任務佔用的日期範圍（來回單 = 出發日～回程日；單程單 = 出發日）*/
  tripDates(app) {
    const out = [];
    const a = new Date(app.departDate);
    const b = new Date(app.type === 'round' ? (app.returnDate || app.departDate) : app.departDate);
    for (let t = new Date(a); t <= b; t.setDate(t.getDate() + 1)) out.push(t.toISOString().slice(0, 10));
    return out.length ? out : [app.departDate];
  },

  /* 找一台可用車 + 司機（商務池）
     occupied：{ veh:Set, drv:Set }，元素為 "id|yyyy-mm-dd"，避免同一車/司機同日重複指派 */
  findResource(app, estStart, estEnd, occupied) {
    const dates = this.tripDates(app);
    // G59：以「當前位置」而非「歸屬據點」判斷可用性；出發地須對應到車輛/司機目前所在據點
    const originSite = DB.bizOriginSite[app.origin] || null;
    const atOrigin = r => !originSite || r.currentSite === originSite;

    const bizV = DB.vehicles.filter(v => v.pool === 'BIZ' && v.seats >= app.pax);
    for (const v of bizV) {
      if (!atOrigin(v)) continue;                                                          // G59 當前位置不符
      if (dates.some(dt => this.isVehicleUnderMaintenance(v.id, dt))) continue;            // G60
      if (occupied && dates.some(dt => occupied.veh.has(v.id + '|' + dt))) continue;        // 已被本批/既有任務佔用
      for (const d of DB.drivers.filter(x => x.pool === 'BIZ')) {
        if (!atOrigin(d)) continue;                                                        // G59
        if (dates.some(dt => this.driverLeaveOverlap(d.id, dt, estStart, estEnd))) continue; // G61
        if (occupied && dates.some(dt => occupied.drv.has(d.id + '|' + dt))) continue;
        return { vehicle: v, driver: d };
      }
    }
    return null;
  },

  /* 將指派結果登記進 occupied（整趟日期範圍都佔用）*/
  occupy(occupied, app, vId, dId) {
    this.tripDates(app).forEach(dt => { occupied.veh.add(vId + '|' + dt); occupied.drv.add(dId + '|' + dt); });
  },

  /* ---- 批次媒合引擎（按鈕觸發 G53/G54）---- */
  runBatch(fromDate) {
    const trace = [];
    const batch = { id: 'MB' + String(this.batchSeq++).padStart(3, '0'),
      at: new Date().toLocaleString('zh-TW'), from: fromDate, items: [] };
    // 7 天範圍（以出發日期為準 G53）
    const start = new Date(fromDate);
    const end = new Date(fromDate); end.setDate(end.getDate() + 7);
    const inRange = a => {
      const d = new Date(a.departDate);
      return d >= start && d <= end;
    };
    // 只處理已核准單；已成功單不重排（G53）
    const targets = this.applications.filter(a => a.status === 'approved' && inRange(a));
    trace.push(`批次 ${batch.id}｜範圍 ${fromDate} 起 7 天內、待處理單 ${targets.length} 筆`);

    // 資源佔用表：先納入既有已媒合任務（含前次批次），避免跨批次/跨群組重複指派同一車/司機
    const occupied = { veh: new Set(), drv: new Set() };
    this.applications
      .filter(a => ['matched', 'boarded', 'completed'].includes(a.status) && a.vehicle && a.driver)
      .forEach(a => this.occupy(occupied, a, a.vehicle, a.driver));

    // 資源檢核透明化：列出本批次範圍內受影響的保修車輛與請假司機（G60/G61）
    const fromStr = fromDate, toStr = end.toISOString().slice(0, 10);
    const maintInWin = DB.maintenance.filter(m => m.from <= toStr && m.to >= fromStr);
    const leaveInWin = DB.driverLeaves.filter(l => l.date >= fromStr && l.date <= toStr);
    if (maintInWin.length || leaveInWin.length) {
      trace.push(`<span class="dim">資源檢核（本批次範圍內排除）：</span>`);
      maintInWin.forEach(m => trace.push(`  <span class="no">🔧 車輛 ${m.vehicle} 保修 ${m.from}~${m.to}（${m.reason}）→ 該期間不可派</span>`));
      leaveInWin.forEach(l => { const d = DB.drivers.find(x => x.id === l.driver);
        trace.push(`  <span class="no">🌴 司機 ${d ? d.name : l.driver} 請假 ${l.date} ${l.from}~${l.to} → 重疊任務不可指派</span>`); });
    }

    // 分兩型態，不互相混合（G50）
    const rounds = targets.filter(a => a.type === 'round');
    const oneways = targets.filter(a => a.type === 'oneway');

    // === 來回單：地點（出發地/目的地）、起始日期、結束日期、上車時間（去程/回程）
    //     全部完全相同才可合併（G54）===
    trace.push(`\n<span class="hl">【來回單分支】</span> ${rounds.length} 筆`);
    const usedR = new Set();
    for (const a of rounds) {
      if (usedR.has(a.id) || a.status !== 'approved') continue;
      // 找六項完全相同者合併：出發地、目的地、起始日期、結束日期、去程上車時間、回程上車時間
      const group = rounds.filter(b => !usedR.has(b.id) && b.status === 'approved' &&
        b.origin === a.origin && b.dest === a.dest &&
        b.departDate === a.departDate && b.returnDate === a.returnDate &&
        b.earliestPickup === a.earliestPickup && b.earliestReturn === a.earliestReturn);
      const totalPax = group.reduce((s, b) => s + b.pax, 0);
      const travel = this.travelMin(a.origin, a.dest);
      if (travel == null) {
        this._coordinate(a, batch, trace, '查無車程資料'); usedR.add(a.id); continue;
      }
      // 工時檢核（G52）：去程當天、回程當天各自完成時間都不得晚於 20:30
      const outEnd = hhmmToMin(a.earliestPickup) + travel;
      const retEnd = hhmmToMin(a.earliestReturn) + travel;
      if (outEnd > this.WORK_END || retEnd > this.WORK_END) {
        group.forEach(b => { this._coordinate(b, batch, trace, '去程或回程預估完成超過工時 20:30'); usedR.add(b.id); });
        continue;
      }
      // 資源可用性以去程當天時段檢核（示意），並排除已佔用車/司機
      const res = this.findResource({ ...a, pax: totalPax }, hhmmToMin(a.earliestPickup), outEnd, occupied);
      if (!res) {
        group.forEach(b => { this._coordinate(b, batch, trace, '無可用車輛/司機（保修/請假/已被指派）'); usedR.add(b.id); });
        continue;
      }
      this.occupy(occupied, a, res.vehicle.id, res.driver.id); // 登記佔用，後續群組不得重用
      const gid = 'G' + a.id;
      group.forEach(b => {
        b.status = 'matched'; b.vehicle = res.vehicle.id; b.driver = res.driver.id; b.groupId = gid;
        usedR.add(b.id);
        batch.items.push({ app: b.id, result: 'matched', group: gid });
      });
      const period = `${a.departDate} ${a.earliestPickup} ~ ${a.returnDate} ${a.earliestReturn}`;
      trace.push(`  <span class="ok">✓ 合併 ${group.map(g=>g.id).join('+')}｜${totalPax}人｜車 ${res.vehicle.id}/司機 ${res.driver.name}</span>`
        + (group.length>1 ? ` <span class="dim">(${a.origin}→${a.dest}｜${period} 六項完全相同 G54)</span>` : ''));
    }

    // === 單程單：出發前配對、同轉運點、4 小時窗（G51）===
    trace.push(`\n<span class="hl">【單程單分支】</span> ${oneways.length} 筆`);
    const usedO = new Set();
    for (const a of oneways) {
      if (usedO.has(a.id) || a.status !== 'approved') continue;
      // 目的地須為轉運點（G50）
      if (!DB.transferPoints.includes(a.dest)) {
        this._coordinate(a, batch, trace, '單程單目的地非交通轉運點'); usedO.add(a.id); continue;
      }
      // 找回程：同轉運點出發、回程最早上車在去程送達後 4 小時內（G51）
      const arrMin = hhmmToMin(a.earliestPickup) + (this.travelMin(a.origin, a.dest) || 0);
      const back = oneways.find(b => !usedO.has(b.id) && b.id !== a.id && b.status === 'approved' &&
        b.origin === a.dest && DB.transferPoints.includes(b.origin) &&
        hhmmToMin(b.earliestPickup) >= arrMin &&
        hhmmToMin(b.earliestPickup) <= arrMin + 240);
      const estStart = hhmmToMin(a.earliestPickup);
      const estEnd = back ? hhmmToMin(back.earliestPickup) + (this.travelMin(back.origin, back.dest) || 0)
                          : arrMin;
      if (estEnd > this.WORK_END) {
        this._coordinate(a, batch, trace, '含等待後超過工時 20:30'); usedO.add(a.id); continue;
      }
      const res = this.findResource(a, estStart, estEnd, occupied);
      if (!res) { this._coordinate(a, batch, trace, '無可用車輛/司機（已被指派）'); usedO.add(a.id); continue; }
      this.occupy(occupied, a, res.vehicle.id, res.driver.id);
      if (back) this.occupy(occupied, back, res.vehicle.id, res.driver.id);
      const gid = 'O' + a.id;
      a.status = 'matched'; a.vehicle = res.vehicle.id; a.driver = res.driver.id; a.groupId = gid;
      usedO.add(a.id); batch.items.push({ app: a.id, result: 'matched', group: gid });
      if (back) {
        back.status = 'matched'; back.vehicle = res.vehicle.id; back.driver = res.driver.id; back.groupId = gid;
        usedO.add(back.id); batch.items.push({ app: back.id, result: 'matched', group: gid });
        const wait = hhmmToMin(back.earliestPickup) - arrMin;
        trace.push(`  <span class="ok">✓ 配對 ${a.id}(去)+${back.id}(回)｜等待 ${wait}分計工時（G51）｜車 ${res.vehicle.id}</span>`);
      } else {
        trace.push(`  <span class="b-amber">✓ ${a.id} 純去程單程單（4 小時內無回程可配 G51）｜車 ${res.vehicle.id}</span>`);
      }
    }

    this.batches.push(batch);
    trace.push(`\n批次完成：成功 ${batch.items.filter(i=>i.result==='matched').length} / 待人工協調 ${batch.items.filter(i=>i.result==='coordinate').length}`);
    return { batch, trace };
  },

  _coordinate(app, batch, trace, reason) {
    app.status = 'coordinate'; app.note = reason;
    batch.items.push({ app: app.id, result: 'coordinate', reason });
    trace.push(`  <span class="no">✗ ${app.id} → 待人工協調：${reason}（G52/G58）</span>`);
  },

  /* ---- 手動併車：候選 = 前後 1 天已派車單（不篩目的地不比時間 G56）---- */
  manualCandidates(app) {
    const d0 = new Date(app.departDate);
    return this.applications.filter(b => {
      if (b.status !== 'matched' || b.id === app.id) return false;
      const d = new Date(b.departDate);
      const diff = Math.abs((d - d0) / 86400000);
      return diff <= 1; // 前後 1 天
    }).map(b => {
      const veh = DB.vehicles.find(v => v.id === b.vehicle);
      const groupPax = this.applications.filter(x => x.groupId === b.groupId)
        .reduce((s, x) => s + x.pax, 0);
      return {
        app: b, dest: b.dest, depart: b.earliestPickup, latest: this.latestArrival(b),
        applicant: b.applicant, dept: b.dept, ext: b.ext,
        loaded: groupPax, remain: (veh.seats - groupPax),
      };
    });
  },

  doManualMerge(app, targetApp) {
    // 向已有車者搭便車，按「完成合併」即成立、免調度室確認（G56）
    app.status = 'matched';
    app.vehicle = targetApp.vehicle; app.driver = targetApp.driver; app.groupId = targetApp.groupId;
    app.note = '手動併車：搭 ' + targetApp.id;
  },

  /* ---- 逾期自動作廢（G57）：以「現在時刻」模擬到出發時間仍未成 ---- */
  voidOverdue(app) {
    app.status = 'void';
    app.note = '逾期自動作廢（到出發時間未媒合成功 G57）';
    // 系統通知申請人（示意）— 紀錄保留供統計、不轉待人工協調
    return { notified: app.applicant, kept: true };
  },
};
