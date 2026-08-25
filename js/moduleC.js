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
      departDate: data.departDate, // yyyy-mm-dd
      earliestPickup: data.earliestPickup, // 去程最早上車 HH:MM
      earliestReturn: data.earliestReturn, // 回程最早（來回單）
      pax: data.pax,
      approvedAt: null,
      status: 'submitted',         // submitted|approved|rejected|matched|manual|coordinate|void
      vehicle: null, driver: null,
      groupId: null,
      note: '',
    };
    this.applications.push(app);
    return app;
  },

  // 業務/調度端：主管准駁；駁回保留紀錄不進排班池（G63）
  approve(app) { app.status = 'approved'; app.approvedAt = this.approveSeq++; },
  reject(app) { app.status = 'rejected'; app.approvedAt = null; },

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
  /* 找一台可用車 + 司機（商務池）*/
  findResource(app, estStart, estEnd) {
    const bizV = DB.vehicles.filter(v => v.pool === 'BIZ' && v.seats >= app.pax);
    for (const v of bizV) {
      if (this.isVehicleUnderMaintenance(v.id, app.departDate)) continue; // G60
      for (const d of DB.drivers.filter(x => x.pool === 'BIZ')) {
        if (this.driverLeaveOverlap(d.id, app.departDate, estStart, estEnd)) continue; // G61
        return { vehicle: v, driver: d };
      }
    }
    return null;
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

    // 分兩型態，不互相混合（G50）
    const rounds = targets.filter(a => a.type === 'round');
    const oneways = targets.filter(a => a.type === 'oneway');

    // === 來回單：出發地/目的地/最早上車時間完全相同（G54）===
    trace.push(`\n<span class="hl">【來回單分支】</span> ${rounds.length} 筆`);
    const usedR = new Set();
    for (const a of rounds) {
      if (usedR.has(a.id) || a.status !== 'approved') continue;
      // 找完全相同者合併
      const group = rounds.filter(b => !usedR.has(b.id) && b.status === 'approved' &&
        b.origin === a.origin && b.dest === a.dest &&
        b.earliestPickup === a.earliestPickup);
      const totalPax = group.reduce((s, b) => s + b.pax, 0);
      const travel = this.travelMin(a.origin, a.dest);
      if (travel == null) {
        this._coordinate(a, batch, trace, '查無車程資料'); usedR.add(a.id); continue;
      }
      // 預估完成（去+回，示意）+ 工時檢核（G52）
      const estStart = hhmmToMin(a.earliestPickup);
      const estEnd = estStart + travel * 2 + 30;
      if (estEnd > this.WORK_END) {
        group.forEach(b => { this._coordinate(b, batch, trace, '預估完成超過工時 20:30'); usedR.add(b.id); });
        continue;
      }
      const res = this.findResource({ ...a, pax: totalPax }, estStart, estEnd);
      if (!res) {
        group.forEach(b => { this._coordinate(b, batch, trace, '無可用車輛/司機（保修或請假）'); usedR.add(b.id); });
        continue;
      }
      const gid = 'G' + a.id;
      group.forEach(b => {
        b.status = 'matched'; b.vehicle = res.vehicle.id; b.driver = res.driver.id; b.groupId = gid;
        usedR.add(b.id);
        batch.items.push({ app: b.id, result: 'matched', group: gid });
      });
      trace.push(`  <span class="ok">✓ 合併 ${group.map(g=>g.id).join('+')}｜${totalPax}人｜車 ${res.vehicle.id}/司機 ${res.driver.name}</span>`
        + (group.length>1 ? ` <span class="dim">(${a.origin}→${a.dest} ${a.earliestPickup} 完全相同 G54)</span>` : ''));
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
      const res = this.findResource(a, estStart, estEnd);
      if (!res) { this._coordinate(a, batch, trace, '無可用車輛/司機'); usedO.add(a.id); continue; }
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
