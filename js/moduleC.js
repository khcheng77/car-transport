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
  // 行程完成（boarded → completed）；多天任務結束後車輛/司機當前位置回復歸屬據點（C-2/C-3）
  completeTrip(app, by) {
    if (app.status === 'boarded') {
      app.status = 'completed'; app.completedAt = Date.now(); app.completedBy = by || '調度室';
      this._returnResourcesHome(app);
    }
  },

  /* 車程表查詢 + 緩衝（G62）；車程表為對稱，查無正向則查反向（回程/強制回歸屬據點用 C-3）*/
  travelMin(origin, dest) {
    if (origin === dest) return DB.bizBuffer;
    const m = DB.bizTravel[origin + '|' + dest];
    if (m != null) return m + DB.bizBuffer;
    const r = DB.bizTravel[dest + '|' + origin];
    return r != null ? r + DB.bizBuffer : null;
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

  /* ---- C-1 空車移動最小化（規格最高優化目標）----
     空駛＝資源「當前位置」開到「出發地對應據點」的車程（分）。
     無法量測（查無據點）視為 0。據點間車程與幹線共用主檔路程表（2.9 siteTravel）。 */
  deadheadMin(resource, app) {
    const originSite = DB.bizOriginSite[app.origin];
    if (!originSite || !resource.currentSite) return 0;
    // 商務車無大小車之分，一律取小車路程（2.9 分車型表）
    const t = DB.siteTravel.small[resource.currentSite + '|' + originSite];
    return t != null ? t : 0;
  },

  /* 可用車＋司機候選清單（商務池），依「空駛時間總和」升冪排序（C-1）
     車次數為次要排序鍵：由呼叫端取第一個可行者即達成「空駛最小優先」。
     occupied：{ veh:Set, drv:Set }，元素為 "id|yyyy-mm-dd"，避免同一車/司機同日重複指派 */
  findResourceCandidates(app, estStart, estEnd, occupied) {
    const dates = this.tripDates(app);
    // G59：以「當前位置」而非「歸屬據點」判斷可用性
    // 預設要求當前位置與出發地相符；DB.allowCrossSiteDeadhead=true 時改為允許調度、以空駛最小者優先（待業務確認）
    const originSite = DB.bizOriginSite[app.origin] || null;
    const usable = r => DB.allowCrossSiteDeadhead || !originSite || r.currentSite === originSite;

    const vehs = DB.vehicles.filter(v => v.pool === 'BIZ' && v.seats >= app.pax && usable(v))
      .filter(v => !dates.some(dt => this.isVehicleUnderMaintenance(v.id, dt)))            // G60
      .filter(v => !(occupied && dates.some(dt => occupied.veh.has(v.id + '|' + dt))))
      .sort((a, b) => this.deadheadMin(a, app) - this.deadheadMin(b, app) || a.seats - b.seats);
    const drvs = DB.drivers.filter(d => d.pool === 'BIZ' && usable(d))
      .filter(d => !dates.some(dt => this.driverLeaveOverlap(d.id, dt, estStart, estEnd)))  // G61
      .filter(d => !(occupied && dates.some(dt => occupied.drv.has(d.id + '|' + dt))))
      .sort((a, b) => this.deadheadMin(a, app) - this.deadheadMin(b, app));

    const out = [];
    for (const v of vehs) for (const d of drvs) {
      out.push({ vehicle: v, driver: d, deadhead: this.deadheadMin(v, app) + this.deadheadMin(d, app) });
    }
    return out.sort((x, y) => x.deadhead - y.deadhead); // 空駛總和最小優先（C-1）
  },

  /* 相容入口：取空駛最小的第一個可行資源 */
  findResource(app, estStart, estEnd, occupied) {
    const c = this.findResourceCandidates(app, estStart, estEnd, occupied);
    return c.length ? { vehicle: c[0].vehicle, driver: c[0].driver, deadhead: c[0].deadhead } : null;
  },

  /* ---- C-3 多天任務最後一天強制回歸屬據點 ----
     回程終點鎖定為該車 homeSite 對應地點；查無對應則回原出發地。
     該回程仍正常參與合併比對（終點相同即可合併）。 */
  returnTerminalFor(app, vehicle) {
    return (vehicle && DB.bizSiteOrigin[vehicle.homeSite]) || app.origin;
  },

  /* 將指派結果登記進 occupied（整趟日期範圍都佔用）*/
  occupy(occupied, app, vId, dId) {
    this.tripDates(app).forEach(dt => { occupied.veh.add(vId + '|' + dt); occupied.drv.add(dId + '|' + dt); });
  },

  /* ---- 批次媒合引擎（按鈕觸發 G53/G54）---- */
  runBatch(fromDate, triggeredBy) {
    const trace = [];
    // 7 天範圍（以出發日期為準 G53）
    const start = new Date(fromDate);
    const end = new Date(fromDate); end.setDate(end.getDate() + 7);
    // C-5 稽核紀錄：批次編號、觸發時間戳記、觸發人、處理範圍、處理單數與結果統計
    const batch = { id: 'MB' + String(this.batchSeq++).padStart(3, '0'),
      at: new Date().toLocaleString('zh-TW'), triggeredAt: new Date(), triggeredBy: triggeredBy || '調度室',
      from: fromDate, to: end.toISOString().slice(0, 10), items: [] };
    const inRange = a => {
      const d = new Date(a.departDate);
      return d >= start && d <= end;
    };
    // 只處理已核准單；已成功單不重排、已人工覆寫者不重排（G53 / C-4；防禦：覆寫旗標即使狀態仍為 approved 也排除）
    const targets = this.applications.filter(a => a.status === 'approved' && !a.overridden && inRange(a));
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
      // 工時檢核（G52）：去程當天完成時間不得晚於 20:30
      const outEnd = hhmmToMin(a.earliestPickup) + travel;
      if (outEnd > this.WORK_END) {
        group.forEach(b => { this._coordinate(b, batch, trace, '去程預估完成超過工時 20:30'); usedR.add(b.id); });
        continue;
      }
      // 逐一檢視候選資源（空駛最小優先 C-1），並驗證 C-3 強制回歸屬據點之回程工時
      const cands = this.findResourceCandidates({ ...a, pax: totalPax }, hhmmToMin(a.earliestPickup), outEnd, occupied);
      let res = null, term = null, retEnd = null, workFail = false;
      for (const c of cands) {
        const t = this.returnTerminalFor(a, c.vehicle);                       // C-3 最後一天回歸屬據點
        const rt = this.travelMin(a.dest, t);
        if (rt == null) continue;                                             // 查無回程車程 → 換下一個候選
        const re = hhmmToMin(a.earliestReturn) + rt;
        if (re > this.WORK_END) { workFail = true; continue; }                // 含強制回程仍須符合工時
        res = c; term = t; retEnd = re; break;
      }
      if (!res) {
        const why = workFail ? '回程（強制回歸屬據點）預估完成超過工時 20:30'
                             : '無可用車輛/司機（保修/請假/已被指派/查無回程車程）';
        group.forEach(b => { this._coordinate(b, batch, trace, why); usedR.add(b.id); });
        continue;
      }
      this.occupy(occupied, a, res.vehicle.id, res.driver.id); // 登記佔用，後續群組不得重用
      const gid = 'G' + a.id;
      const multiDay = this.tripDates(a).length > 1;
      group.forEach(b => {
        b.status = 'matched'; b.vehicle = res.vehicle.id; b.driver = res.driver.id; b.groupId = gid;
        b.returnTerminal = term;               // C-3 回程終點（最後一天強制回歸屬據點）
        b.forcedReturn = multiDay;             // 是否為多天任務之強制回歸
        b.deadheadMin = res.deadhead;          // C-1 本次指派空駛時間（分）
        b.lastBatch = batch.id; b.lastBatchResult = 'matched'; // C-5
        usedR.add(b.id);
        batch.items.push({ app: b.id, result: 'matched', group: gid });
      });
      const period = `${a.departDate} ${a.earliestPickup} ~ ${a.returnDate} ${a.earliestReturn}`;
      trace.push(`  <span class="ok">✓ 合併 ${group.map(g=>g.id).join('+')}｜${totalPax}人｜車 ${res.vehicle.id}/司機 ${res.driver.name}｜空駛 ${res.deadhead} 分（C-1 最小優先）</span>`
        + (group.length>1 ? ` <span class="dim">(${a.origin}→${a.dest}｜${period} 六項完全相同 G54)</span>` : ''));
      if (multiDay) trace.push(`      <span class="dim">多天任務：最後一天回程終點強制＝${term}（車 ${res.vehicle.id} 歸屬據點 ${res.vehicle.homeSite}，C-3）｜回程完成 ${minToHHMM(retEnd)}</span>`);
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
      // 找回程：同一天、同轉運點出發、回司機出發地、回程最早上車在去程送達後 4 小時內（G51 / Q35）
      const arrMin = hhmmToMin(a.earliestPickup) + (this.travelMin(a.origin, a.dest) || 0);
      const back = oneways.find(b => !usedO.has(b.id) && b.id !== a.id && b.status === 'approved' &&
        b.departDate === a.departDate &&          // 同一天（一趟完整行程；出發前配對）
        b.origin === a.dest && DB.transferPoints.includes(b.origin) &&
        b.dest === a.origin &&                     // Q35：回程須「從該轉運點回司機出發地」
        hhmmToMin(b.earliestPickup) >= arrMin &&
        hhmmToMin(b.earliestPickup) <= arrMin + 240);
      const estStart = hhmmToMin(a.earliestPickup);
      const estEnd = back ? hhmmToMin(back.earliestPickup) + (this.travelMin(back.origin, back.dest) || 0)
                          : arrMin;
      if (estEnd > this.WORK_END) {
        this._coordinate(a, batch, trace, '含等待後超過工時 20:30'); usedO.add(a.id); continue;
      }
      const res = this.findResource(a, estStart, estEnd, occupied); // 空駛最小優先（C-1）
      if (!res) { this._coordinate(a, batch, trace, '無可用車輛/司機（已被指派）'); usedO.add(a.id); continue; }
      this.occupy(occupied, a, res.vehicle.id, res.driver.id);
      if (back) this.occupy(occupied, back, res.vehicle.id, res.driver.id);
      const gid = 'O' + a.id;
      a.status = 'matched'; a.vehicle = res.vehicle.id; a.driver = res.driver.id; a.groupId = gid;
      a.deadheadMin = res.deadhead; a.lastBatch = batch.id; a.lastBatchResult = 'matched'; // C-1/C-5
      usedO.add(a.id); batch.items.push({ app: a.id, result: 'matched', group: gid });
      if (back) {
        back.status = 'matched'; back.vehicle = res.vehicle.id; back.driver = res.driver.id; back.groupId = gid;
        back.deadheadMin = 0; back.lastBatch = batch.id; back.lastBatchResult = 'matched';
        usedO.add(back.id); batch.items.push({ app: back.id, result: 'matched', group: gid });
        const wait = hhmmToMin(back.earliestPickup) - arrMin;
        trace.push(`  <span class="ok">✓ 配對 ${a.id}(去)+${back.id}(回)｜等待 ${wait}分計工時（G51）｜車 ${res.vehicle.id}｜空駛 ${res.deadhead} 分</span>`);
      } else {
        trace.push(`  <span class="b-amber">✓ ${a.id} 純去程單程單（4 小時內無回程可配 G51）｜車 ${res.vehicle.id}｜空駛 ${res.deadhead} 分</span>`);
      }
    }

    // C-5 統計並存檔（媒合失敗率統計基礎；依 Q45 不做保底偵測／自動補跑）
    batch.processed = targets.length;
    batch.matched = batch.items.filter(i => i.result === 'matched').length;
    batch.coordinate = batch.items.filter(i => i.result === 'coordinate').length;
    this.batches.push(batch);
    trace.push(`\n批次 ${batch.id} 完成（觸發人 ${batch.triggeredBy}）：處理 ${batch.processed} 筆｜成功 ${batch.matched} / 待人工協調 ${batch.coordinate}`);
    return { batch, trace };
  },

  _coordinate(app, batch, trace, reason) {
    app.status = 'coordinate'; app.note = reason;
    app.lastBatch = batch.id; app.lastBatchResult = 'coordinate'; // C-5：單上記錄最後處理批次與結果
    batch.items.push({ app: app.id, result: 'coordinate', reason });
    trace.push(`  <span class="no">✗ ${app.id} → 待人工協調：${reason}（G52/G58）</span>`);
  },

  /* ---- C-4 人工覆寫：調度室手動改派車輛/司機，記錄調整人、時間、調整前後內容 ----
     覆寫過的排班不得被下一次批次重排（與「已媒合成功不重排」同原則 G53）。 */
  overrideAssign(app, next, by) {
    const before = { vehicle: app.vehicle, driver: app.driver, status: app.status };
    if (next.vehicle) app.vehicle = next.vehicle;
    if (next.driver) app.driver = next.driver;
    if (app.status === 'coordinate') app.status = 'matched'; // 調度室直接手動指派，不退回員工重新申請
    app.overridden = true;
    app.overrides = app.overrides || [];
    app.overrides.push({
      by: by || '調度室', at: new Date(),
      before, after: { vehicle: app.vehicle, driver: app.driver, status: app.status },
      note: next.note || '',
    });
    return app.overrides[app.overrides.length - 1];
  },

  /* 行程完成後車輛/司機回歸屬據點（C-2/C-3：currentSite 回復 homeSite）*/
  _returnResourcesHome(app) {
    const v = DB.vehicles.find(x => x.id === app.vehicle);
    const d = DB.drivers.find(x => x.id === app.driver);
    if (v && v.homeSite) v.currentSite = v.homeSite;
    if (d && d.homeSite) d.currentSite = d.homeSite;
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
        app: b, origin: b.origin, dest: b.dest, depart: b.earliestPickup, latest: this.latestArrival(b),
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
