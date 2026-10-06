/* ============================================================
   moduleC.js — 模組 C：差旅派車自動媒合（共乘）
   PLAN.md Phase 5 / Guardrails G50–G63
   來回單/單程單、批次媒合按鈕、資源可用性檢核、手動併車、逾期作廢
   派車單（G112–G115）：批次媒合以「同一台車」為群組產生派車單，調度可異動車種類型／車號／駕駛人1／2，
   決定是否送審（送出運輸主管簽審）；調度亦可退回申請單給申請人（退回修編）。
   ============================================================ */

const ModuleC = {
  applications: [],
  batches: [],
  dispatches: [],   // 派車單：{ id, date, vehicleType, vehicle, driver1, driver2, dispatcher, dispatchedAt, submitted, apps[], batchId, manual, cancelled, log[] }
  seq: 1,
  batchSeq: 1,
  dispatchSeq: 1,
  approveSeq: 1,

  // 申請端只負責建立，狀態為「待審核」（G63 員工填單 → 主管准駁）
  createApp(data, opts) {
    const app = Object.assign({ id: 'BZ' + String(this.seq++).padStart(3, '0') }, this._fields(data), {
      approvedAt: null,
      status: opts && opts.draft ? 'draft' : 'submitted',   // draft（申請中）|submitted（待二級審）|approved（待調度）|rejected（退回修編）|noCar（無車退回）|matched（併入派車單）|cancelled（已取消 G133）；顯示狀態由 Flow 推導
      vehicle: null, driver: null, driver2: null,
      groupId: null, dispatchId: null,
      note: '',
      createdAt: new Date(),
    });
    this.applications.push(app);
    return app;
  },
  // 暫存（申請中）修改
  saveDraft(app, data) {
    if (app.status !== 'draft') throw new Error('僅「申請中」的申請可暫存修改');
    Object.assign(app, this._fields(data));
    this._change(app, '修改', data.changeReason, data.applicant);
    return app;
  },
  // 異動事由（G133）：修改／取消時必填，留存最新一筆於 changeReason，並累積 changeLog
  _change(app, action, reason, by) {
    reason = (reason || '').trim();
    if (!reason) return;
    app.changeReason = reason;
    (app.changeLog = app.changeLog || []).push({ at: new Date(), action, reason, by: by || app.applicant });
  },
  /* 取消申請（G133）：申請人於派車單送審前可取消，異動事由必填；已併入未送審派車單者自派車單移出
     （派車單空了即取消）。派車單已送審、已出車、無車退回、已取消者不可取消。 */
  canCancel(app) {
    if (['draft', 'submitted', 'approved', 'rejected'].includes(app.status)) return true;
    if (app.status !== 'matched') return false;
    const order = this.dispatchOf(app);
    return !Signoff.isPending(app) && !Signoff.effective(app) && !Flow.departed(app, this) && !(order && order.submitted);
  },
  cancelApp(app, reason, by) {
    reason = (reason || '').trim();
    if (!this.canCancel(app)) return { ok: false, error: app.status === 'matched'
      ? '派車單已送審或已出車，不可取消；請聯繫調度處理' : '此申請單目前狀態不可取消' };
    if (!reason) return { ok: false, error: '取消申請時「異動事由」為必填' };
    if (app.status === 'matched') this._detach(app, '申請人取消申請', by || app.applicant);
    this._change(app, '取消', reason, by);
    app.status = 'cancelled'; app.cancelledAt = new Date(); app.cancelledBy = by || app.applicant; app.approvedAt = null;
    return { ok: true };
  },
  canEdit(app) { return ['draft', 'rejected'].includes(app.status); },
  // 申請中／退回修編 → 申請人修改後送出：沿用原單號，進入待二級審（單位主管審核）
  resubmit(app, data) {
    if (!this.canEdit(app)) throw new Error('僅「申請中」或「退回修編」的申請可修改後送出');
    (app.revisions = app.revisions || []).push({ at: new Date(), returnNote: app.reviewNote || '' });
    Object.assign(app, this._fields(data), { status: 'submitted', approvedAt: null, reviewNote: '', returnedBy: null });
    this._change(app, '修改', data.changeReason, data.applicant);
    return app;
  },
  /* 申請表單欄位（G133）：表單存檔欄位為 applicant／applicantPhone／isOneway／route／reportAt／endAt／passengers 及新增欄位；
     媒合引擎沿用的內部欄位（type／origin／dest／departDate／earliestPickup／returnDate／earliestReturn／pax／ext）由表單欄位推導：
     · route＝車輛起迄地點（最多 8 點，依序），起點＝route[0]→origin、終點＝route 最後一點→dest；中間地點僅記錄、不參與媒合；
     · reportAt（車輛報到日期時間）→ departDate＋earliestPickup；endAt（用車結束日期時間）→ returnDate＋earliestReturn（單程不適用）。
     亦接受舊欄位（origin／dest／departDate…，供範例與測試），會反推表單欄位。 */
  ROUTE_MAX: 8,
  YESNO: ['baseShuttle', 'permitP', 'permitK', 'crossCampus', 'enterTaipei', 'hasCargo'],
  _fields(data) {
    const isOneway = data.isOneway != null ? !!data.isOneway : data.type === 'oneway';
    const route = (Array.isArray(data.route) && data.route.length ? data.route : [data.origin, data.dest])
      .filter(Boolean).slice(0, this.ROUTE_MAX);
    const reportAt = data.reportAt || (data.departDate ? `${data.departDate}T${data.earliestPickup || ''}` : '');
    const endAt = isOneway ? '' : (data.endAt || (data.returnDate ? `${data.returnDate}T${data.earliestReturn || ''}` : ''));
    const [departDate, earliestPickup] = reportAt.split('T');
    const [returnDate, earliestReturn] = endAt ? endAt.split('T') : [departDate, ''];
    const passengers = +(data.passengers != null ? data.passengers : data.pax) || 0;
    const applicantPhone = data.applicantPhone != null ? data.applicantPhone : (data.ext || '');
    const hasCargo = !!data.hasCargo;
    const f = {
      applicant: data.applicant, dept: data.dept, applicantPhone,
      reason: data.reason || '', projectCode: data.projectCode || '',
      captain: data.captain || '', captainPhone: data.captainPhone || '', homeBase: data.homeBase || '',
      isOneway, route, reportAt, endAt, passengers,
      agreeCarpool: data.agreeCarpool !== false,   // 未指定＝同意併車
      manifestNo: hasCargo ? (data.manifestNo || '') : '', escortNo: hasCargo ? (data.escortNo || '') : '',
      remark: data.remark || '',
      // 媒合引擎內部欄位（推導）
      ext: applicantPhone,
      type: isOneway ? 'oneway' : 'round',
      origin: route[0], dest: route[route.length - 1],
      departDate: departDate || '', earliestPickup: earliestPickup || '',
      returnDate: returnDate || departDate || '', earliestReturn: earliestReturn || '',
      pax: passengers,
    };
    this.YESNO.forEach(k => { f[k] = !!data[k]; });
    return f;
  },
  /* 表單檢核（G133）：回傳錯誤字串或 null；opts.editing＝修改既有申請單（異動事由必填） */
  formError(data, opts) {
    const route = (data.route || []).filter(Boolean);
    if (!(data.reason || '').trim()) return '請填寫「申請事由」';
    if (route.length < 2) return '「車輛起迄地點」至少要有起點與終點兩個地點';
    if (route.length > this.ROUTE_MAX) return `「車輛起迄地點」最多 ${this.ROUTE_MAX} 個地點`;
    if (route.some((x, i) => i && x === route[i - 1])) return '「車輛起迄地點」相鄰地點不可重複';
    if (route[0] === route[route.length - 1]) return '「車輛起迄地點」起點與終點不可相同';
    if (!data.reportAt || !/T\d\d:\d\d/.test(data.reportAt)) return '請填寫「車輛報到日期時間」';
    if (!data.isOneway) {
      if (!data.endAt || !/T\d\d:\d\d/.test(data.endAt)) return '請填寫「用車結束日期時間」';
      if (data.endAt < data.reportAt) return '「用車結束日期時間」不可早於「車輛報到日期時間」';
    }
    if (!(+data.passengers >= 1)) return '「乘客數」至少 1 人';
    if (data.hasCargo) {
      if (!(data.manifestNo || '').trim()) return '有載運品時「三聯單表單編號」為必填';
      if (!(data.escortNo || '').trim()) return '有載運品時「護運單號」為必填';
    }
    if (opts && opts.editing && !(data.changeReason || '').trim()) return '修改申請單時「異動事由」為必填';
    return null;
  },
  noCarpool(app) { return app.agreeCarpool === false; },
  // 特殊證（G133）：申請單勾選 P／K → 只能派有該通行證的車（車輛主檔 permits）
  needPermits(apps) { return ['P', 'K'].filter(p => apps.some(a => a['permit' + p])); },
  vehicleHasPermits(v, need) { return need.every(p => (v.permits || []).includes(p)); },

  // 主管准駁；駁回保留紀錄不進排班池（G63）；note＝審核備註（選填/駁回必填）
  approve(app, note) { app.status = 'approved'; app.approvedAt = this.approveSeq++; if (note != null) app.reviewNote = note; },
  reject(app, note) { app.status = 'rejected'; app.approvedAt = null; if (note != null) app.reviewNote = note; },

  /* 狀態推導（Flow）：已出車＝出發日期＋去程上車時間已到；已回登＝車輛使用實登 */
  departAt(app) { return Flow.at(app.departDate, app.earliestPickup); },

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
     空駛＝資源「當前位置」開到「出發地對應據點」的車程（分）。據點間車程與幹線共用主檔路程表（2.9 siteTravel）。
     出發地不屬任何據點 → 0（無空駛可言）；資源當前位置不明或查無路程 → null（無法量測，不得當成空駛最小，
     候選清單直接排除；修正：原本視為 0 而被優先選中）。 */
  deadheadMin(resource, app) {
    const originSite = DB.bizOriginSite[app.origin];
    if (!originSite) return 0;
    if (!resource.currentSite) return null;
    if (resource.currentSite === originSite) return 0;
    // 商務車無大小車之分，一律取小車路程（2.9 分車型表）
    const t = DB.siteTravel.small[resource.currentSite + '|' + originSite];
    return t != null ? t : null;
  },

  /* 可用車＋司機候選清單（商務池），依「空駛時間總和」升冪排序（C-1）
     車次數為次要排序鍵：由呼叫端取第一個可行者即達成「空駛最小優先」。
     occupied：{ veh:Set, drv:Set }，元素為 "id|yyyy-mm-dd"，避免同一車/司機同日重複指派 */
  findResourceCandidates(app, estStart, estEnd, occupied) {
    const dates = this.tripDates(app);
    // G59：以「當前位置」而非「歸屬據點」判斷可用性
    // 預設要求當前位置與出發地相符；DB.allowCrossSiteDeadhead=true 時改為允許調度、以空駛最小者優先（待業務確認）
    const originSite = DB.bizOriginSite[app.origin] || null;
    // 位置不明／查無空駛路程者（deadheadMin＝null）一律不可用（G59 以當前位置判斷可用性）
    const usable = r => (DB.allowCrossSiteDeadhead || !originSite || r.currentSite === originSite) && this.deadheadMin(r, app) != null;

    const need = this.needPermits([app]);   // 特殊證 P／K（G133）
    const vehs = DB.vehicles.filter(v => v.pool === 'BIZ' && v.seats >= app.pax && usable(v) && this.vehicleHasPermits(v, need))
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

  /* 將指派結果登記進 occupied（整趟日期範圍都佔用）；dId 可為單一司機或陣列（駕駛人1／2）*/
  occupy(occupied, app, vId, dId) {
    const ds = [].concat(dId || []).filter(Boolean);
    this.tripDates(app).forEach(dt => { occupied.veh.add(vId + '|' + dt); ds.forEach(d => occupied.drv.add(d + '|' + dt)); });
  },
  driversOf(app) { return [app.driver, app.driver2].filter(Boolean); },

  /* ---- 批次媒合引擎（按鈕觸發 G53/G54）---- */
  /* opts.days：處理範圍天數（預設 7 天 G53；派車調度明細頁以單一出發日期執行 → days: 0）
     媒合成功者以「同一台車」為群組產生派車單（G112），派車單預設未送審（G114）。 */
  runBatch(fromDate, triggeredBy, opts) {
    const r = this._runBatch(fromDate, triggeredBy, opts);
    const groups = {};
    this.applications.filter(a => a.status === 'matched' && a.lastBatch === r.batch.id && !a.dispatchId)
      .forEach(a => (groups[a.groupId] = groups[a.groupId] || []).push(a));
    r.dispatches = Object.values(groups).map(g => this.createDispatch(g,
      { vehicle: g[0].vehicle, driver1: g[0].driver, driver2: '' }, triggeredBy, { batchId: r.batch.id }));
    if (r.dispatches.length) r.trace.push(`產生派車單 ${r.dispatches.map(d => d.id).join('、')}（未送審；調度確認後送出運輸主管簽審）`);
    return r;
  },
  _runBatch(fromDate, triggeredBy, opts) {
    const trace = [];
    // 處理範圍（以出發日期為準 G53）：預設 7 天
    const days = opts && opts.days != null ? opts.days : 7;
    const start = new Date(fromDate);
    const end = new Date(fromDate); end.setDate(end.getDate() + days);
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
    trace.push(`批次 ${batch.id}｜範圍 ${days ? `${fromDate} 起 ${days} 天內` : `出發日期 ${fromDate}`}、待處理單 ${targets.length} 筆`);

    // 資源佔用表：先納入既有已媒合任務（含前次批次），避免跨批次/跨群組重複指派同一車/司機
    const occupied = { veh: new Set(), drv: new Set() };
    this.applications
      .filter(a => a.status === 'matched' && a.vehicle && a.driver)
      .forEach(a => this.occupy(occupied, a, a.vehicle, this.driversOf(a)));
    // 共用資源池（G71/G72 先佔先贏）：一般用車（D）已派出的車輛/司機，於其用車日期同樣視為已佔用
    [typeof ModuleD !== 'undefined' ? ['一般用車', ModuleD] : null]
      .filter(Boolean).forEach(([label, M]) => {
        const occ = M.dayOccupancy();
        occ.veh.forEach((_, k) => occupied.veh.add(k));
        occ.drv.forEach((_, k) => occupied.drv.add(k));
        const held = [...new Set([...occ.veh.values(), ...occ.drv.values()])];
        if (held.length) trace.push(`<span class="dim">共用資源池：${label} ${held.join('、')} 佔用之車輛/司機（先佔先贏）不重複指派</span>`);
      });

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
    // 單程單：先處理「送往轉運點」的去程，再處理其餘（回程），配對結果不受申請建立順序影響（修正 C-S1）
    const isOut = a => DB.transferPoints.includes(a.dest) ? 0 : 1;
    const oneways = targets.filter(a => a.type === 'oneway')
      .map((a, i) => ({ a, i })).sort((x, y) => isOut(x.a) - isOut(y.a) || x.i - y.i).map(x => x.a);

    // === 來回單：地點（出發地/目的地）、起始日期、結束日期、上車時間（去程/回程）
    //     全部完全相同才可合併（G54）===
    trace.push(`\n<span class="hl">【來回單分支】</span> ${rounds.length} 筆`);
    const usedR = new Set();
    for (const a of rounds) {
      if (usedR.has(a.id) || a.status !== 'approved') continue;
      // 找六項完全相同者合併：出發地、目的地、起始日期、結束日期、去程上車時間、回程上車時間
      // 不同意併車（G133）：一單一車，不與其他申請單合併
      const group = this.noCarpool(a) ? [a] : rounds.filter(b => !usedR.has(b.id) && b.status === 'approved' && !this.noCarpool(b) &&
        b.origin === a.origin && b.dest === a.dest &&
        b.departDate === a.departDate && b.returnDate === a.returnDate &&
        b.earliestPickup === a.earliestPickup && b.earliestReturn === a.earliestReturn);
      const totalPax = group.reduce((s, b) => s + b.pax, 0);
      const travel = this.travelMin(a.origin, a.dest);
      if (travel == null) {
        this._fail(a, batch, trace, '查無車程資料'); usedR.add(a.id); continue;
      }
      // 工時檢核（G52）：去程當天完成時間不得晚於 20:30
      const outEnd = hhmmToMin(a.earliestPickup) + travel;
      if (outEnd > this.WORK_END) {
        group.forEach(b => { this._fail(b, batch, trace, '去程預估完成超過工時 20:30'); usedR.add(b.id); });
        continue;
      }
      // 逐一檢視候選資源（空駛最小優先 C-1），並驗證 C-3 強制回歸屬據點之回程工時
      const cands = this.findResourceCandidates({ ...a, pax: totalPax,
        permitP: group.some(b => b.permitP), permitK: group.some(b => b.permitK) }, hhmmToMin(a.earliestPickup), outEnd, occupied);
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
                             : '無可用車輛/司機（保修/請假/已被指派/特殊證不符/查無回程車程）';
        group.forEach(b => { this._fail(b, batch, trace, why); usedR.add(b.id); });
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
        this._fail(a, batch, trace, '單程單目的地非交通轉運點'); usedO.add(a.id); continue;
      }
      // 找回程：同一天、同轉運點出發、回司機出發地、回程最早上車在去程送達後 4 小時內（G51 / Q35）
      const arrMin = hhmmToMin(a.earliestPickup) + (this.travelMin(a.origin, a.dest) || 0);
      // 不同意併車（G133）：不與其他申請單配對去回程
      const back = this.noCarpool(a) ? null : oneways.find(b => !usedO.has(b.id) && b.id !== a.id && b.status === 'approved' && !this.noCarpool(b) &&
        b.departDate === a.departDate &&          // 同一天（一趟完整行程；出發前配對）
        b.origin === a.dest && DB.transferPoints.includes(b.origin) &&
        b.dest === a.origin &&                     // Q35：回程須「從該轉運點回司機出發地」
        hhmmToMin(b.earliestPickup) >= arrMin &&
        hhmmToMin(b.earliestPickup) <= arrMin + 240);
      const estStart = hhmmToMin(a.earliestPickup);
      const estEnd = back ? hhmmToMin(back.earliestPickup) + (this.travelMin(back.origin, back.dest) || 0)
                          : arrMin;
      if (estEnd > this.WORK_END) {
        this._fail(a, batch, trace, '含等待後超過工時 20:30'); usedO.add(a.id); continue;
      }
      // 座位須同時容納去程與回程人數（修正 C-S2：原本只看去程人數）
      const res = this.findResource({ ...a, pax: Math.max(a.pax, back ? back.pax : 0),
        permitP: a.permitP || !!(back && back.permitP), permitK: a.permitK || !!(back && back.permitK) }, estStart, estEnd, occupied); // 空駛最小優先（C-1）
      if (!res) { this._fail(a, batch, trace, '無可用車輛/司機（已被指派/特殊證不符）'); usedO.add(a.id); continue; }
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
    batch.noCar = batch.items.filter(i => i.result === 'noCar').length;
    this.batches.push(batch);
    trace.push(`\n批次 ${batch.id} 完成（觸發人 ${batch.triggeredBy}）：處理 ${batch.processed} 筆｜成功 ${batch.matched} / 未媒合（仍待調度）${batch.coordinate}`
      + (batch.noCar ? ` / 無車可派（不同意併車）${batch.noCar}` : ''));
    return { batch, trace };
  },

  // 媒合不成：同意併車者維持「待調度」；不同意併車者（G133）直接告知無車可派（無車退回）
  _fail(app, batch, trace, reason) {
    return this.noCarpool(app) ? this._noCarAuto(app, batch, trace, reason) : this._coordinate(app, batch, trace, reason);
  },
  _noCarAuto(app, batch, trace, reason) {
    const note = `無車可派（不同意併車，無可單獨派遣之車輛）：${reason}`;
    app.status = 'noCar'; app.approvedAt = null; app.noCarNote = note; app.noCarBy = `批次媒合 ${batch.id}`; app.noCarAt = new Date();
    app.note = note; app.lastBatch = batch.id; app.lastBatchResult = 'noCar';
    batch.items.push({ app: app.id, result: 'noCar', reason });
    trace.push(`  <span class="no">✗ ${app.id} → 無車可派（不同意併車，已通知申請人）：${reason}（G133）</span>`);
  },
  // 媒合不成：維持「待調度」並註明原因，由調度手動指派或無車退回（G122 刪除「待人工協調」狀態）
  _coordinate(app, batch, trace, reason) {
    app.note = reason;
    app.lastBatch = batch.id; app.lastBatchResult = 'coordinate'; // C-5：單上記錄最後處理批次與結果
    batch.items.push({ app: app.id, result: 'coordinate', reason });
    trace.push(`  <span class="no">✗ ${app.id} → 未媒合（仍待調度）：${reason}（G52/G58）</span>`);
  },

  /* ---- C-4 人工覆寫：調度室手動改派車輛/司機，記錄調整人、時間、調整前後內容 ----
     覆寫過的排班不得被下一次批次重排（與「已媒合成功不重排」同原則 G53）。 */
  overrideAssign(app, next, by) {
    const before = { vehicle: app.vehicle, driver: app.driver, status: app.status };
    const order = this.dispatchOf(app);
    if (order) {
      // 已在派車單：改派即異動整張派車單（同車群組一起改）；派車單已送審者不可改派（G130）
      const r = this.updateDispatch(order, { vehicle: next.vehicle || order.vehicle,
        driver1: next.driver || order.driver1, driver2: order.driver2 }, by, next.note);
      if (!r.ok) throw new Error(r.error);
    } else {
      if (next.vehicle) app.vehicle = next.vehicle;
      if (next.driver) app.driver = next.driver;
      if (app.status === 'approved') {   // 待調度單由調度室直接手動指派 → 建立派車單（調度中）
        const v = DB.vehicles.find(x => x.id === app.vehicle);
        const err = this.dispatchResourceError({ apps: [app.id] },
          { vehicleType: v ? v.type : '', vehicle: app.vehicle, driver1: app.driver, driver2: '' });
        if (err) { app.vehicle = before.vehicle; app.driver = before.driver; throw new Error(err); }
        app.status = 'matched'; app.groupId = 'M' + app.id;
        this.createDispatch([app], { vehicle: app.vehicle, driver1: app.driver, driver2: '' }, by, { manual: true });
      }
    }
    app.overridden = true;
    app.overrides = app.overrides || [];
    app.overrides.push({
      by: by || '調度室', at: new Date(),
      before, after: { vehicle: app.vehicle, driver: app.driver, status: app.status },
      note: next.note || '',
    });
    return app.overrides[app.overrides.length - 1];
  },

  /* ---- 手動指派（G128）：調度於派車調度明細頁對「待調度」申請單手動派車 ----
     · manualAssign：指定車種類型／車號／駕駛人1／駕駛人2，產生一張未送審（暫存）派車單；
     · manualMerge：併入同一出發日期、尚未送審且未出車的派車單（沿用該派車單的車輛與駕駛，座位須足夠）。
     皆做資源檢核（dispatchResourceError：座位、保修、請假、其他派車單與一般用車佔用），並留人工覆寫紀錄、不再被批次重排。 */
  manualTargets(date) { return this.liveDispatches().filter(d => d.date === date && !d.submitted && !this.started(d)); },
  _overrideLog(app, before, by, note) {
    app.overridden = true;
    (app.overrides = app.overrides || []).push({ by: by || '調度室', at: new Date(), before,
      after: { vehicle: app.vehicle, driver: app.driver, status: app.status }, note: note || '' });
  },
  manualAssign(app, f, by) {
    if (app.status !== 'approved') return { ok: false, error: '僅「待調度」的申請單可手動指派' };
    const err = this.dispatchResourceError({ apps: [app.id] }, f);
    if (err) return { ok: false, error: err };
    const before = { vehicle: app.vehicle, driver: app.driver, status: app.status };
    app.status = 'matched'; app.groupId = 'M' + app.id;
    const order = this.createDispatch([app], f, by, { manual: true });
    this._overrideLog(app, before, by, `手動指派產生派車單 ${order.id}`);
    return { ok: true, dispatch: order };
  },
  manualMerge(app, order, by) {
    if (app.status !== 'approved') return { ok: false, error: '僅「待調度」的申請單可手動指派' };
    if (!order || !this.manualTargets(app.departDate).includes(order)) return { ok: false, error: '只能併入同一出發日期、尚未送審且未出車的派車單' };
    const err = this.dispatchResourceError({ apps: order.apps.concat(app.id) }, order);
    if (err) return { ok: false, error: err };
    const before = { vehicle: app.vehicle, driver: app.driver, status: app.status };
    const first = this.dispatchApps(order)[0];
    order.apps.push(app.id);
    app.status = 'matched'; app.groupId = first ? first.groupId : 'M' + app.id;
    this._applyToApps(order);
    this._dlog(order, '手動併入', by, app.id);
    this._overrideLog(app, before, by, `手動併入派車單 ${order.id}`);
    return { ok: true, dispatch: order };
  },

  /* ================= 派車單（G112–G115）================= */
  dispatchOf(app) { return app.dispatchId ? this.dispatches.find(d => d.id === app.dispatchId && !d.cancelled) || null : null; },
  dispatchApps(order) { return order.apps.map(id => this.applications.find(a => a.id === id)).filter(Boolean); },
  liveDispatches() { return this.dispatches.filter(d => !d.cancelled); },
  _dlog(order, action, by, note) { order.log.push({ at: new Date(), action, by: by || '調度室', note: note || '' }); },
  _applyToApps(order) {
    this.dispatchApps(order).forEach(a => { a.vehicle = order.vehicle; a.driver = order.driver1; a.driver2 = order.driver2 || null; a.dispatchId = order.id; });
  },
  // 派車單號、派遣人、派遣時間由系統自動給予
  createDispatch(apps, f, by, opts) {
    const v = DB.vehicles.find(x => x.id === f.vehicle);
    const order = { id: 'DP' + String(this.dispatchSeq++).padStart(3, '0'), date: apps[0].departDate,
      vehicleType: v ? v.type : '', vehicle: f.vehicle, driver1: f.driver1, driver2: f.driver2 || '',
      dispatcher: by || '調度室', dispatchedAt: new Date(), submitted: false,
      apps: apps.map(a => a.id), batchId: (opts && opts.batchId) || null, manual: !!(opts && opts.manual), cancelled: false, log: [] };
    this.dispatches.push(order);
    this._applyToApps(order);
    this._dlog(order, order.manual ? '手動建立' : '批次產生', by, apps.map(a => a.id).join('、'));
    return order;
  },
  started(order) { return this.dispatchApps(order).some(a => Flow.departed(a, this)); },   // 已出車即不可異動
  // 派車單整趟日期（各申請單日期聯集）
  dispatchDates(order, apps) {
    return [...new Set((apps || this.dispatchApps(order)).flatMap(a => this.tripDates(a)))];
  },
  /* 可派資源檢核（G60/G61/G71/G72）：保修、請假、其他派車單、一般用車佔用；回傳錯誤字串或 null */
  /* 派車單同時在車人數（G132）：依「時段」而非路線計算——每張單的每一段行程（單程＝去程；來回＝去程＋回程）
     佔用車上座位 [上車時間, 上車時間＋車程)（同一天），取任一時刻在車人數的最大值。
     單程去程與配對回程時段不重疊 → 取較大者；同時出發的單（來回＋單程、不同轉運點的單程）→ 相加。
     （修正：G131 依路線分組取最大值，同時出發的不同路線被誤判可併入；查無車程以 60 分計） */
  dispatchPax(apps) {
    const legs = [];
    const add = (date, hhmm, from, to, pax) => {
      if (!date || !hhmm) return;
      const s = hhmmToMin(hhmm), t = this.travelMin(from, to);
      legs.push({ date, s, e: s + (t != null ? t : 60), pax: +pax || 0 });
    };
    apps.forEach(a => {
      add(a.departDate, a.earliestPickup, a.origin, a.dest, a.pax);
      if (a.type === 'round') add(a.returnDate, a.earliestReturn, a.dest, a.origin, a.pax);
    });
    // 在車人數的最大值必出現在某段行程的上車時刻：逐一以上車時刻統計涵蓋該時刻的各段人數
    return legs.reduce((max, l) => Math.max(max,
      legs.filter(x => x.date === l.date && x.s <= l.s && l.s < x.e).reduce((n, x) => n + x.pax, 0)), 0);
  },
  dispatchResourceError(order, f) {
    const apps = this.dispatchApps(order), dates = this.dispatchDates(order, apps);
    const pax = this.dispatchPax(apps);
    const v = DB.vehicles.find(x => x.id === f.vehicle && x.pool === 'BIZ');
    if (!f.vehicleType) return '請選擇「車種類型」';
    if (!v) return '請選擇商務池的「車號」';
    if (v.type !== f.vehicleType) return '車號與車種類型不符';
    if (v.seats < pax) return `${v.id} 座位 ${v.seats} 不足本派車單 ${pax} 人`;
    const lack = this.needPermits(apps).filter(p => !(v.permits || []).includes(p));
    if (lack.length) return `${v.id} 無特殊證 ${lack.join('、')}（申請單需要）`;
    const solo = apps.length > 1 && apps.find(a => this.noCarpool(a));
    if (solo) return `申請單 ${solo.id} 不同意併車，不可與其他申請單同一張派車單`;
    const mt = DB.maintenance.find(m => m.vehicle === v.id && dates.some(dt => dt >= m.from && dt <= m.to));
    if (mt) return `${v.id} 保修 ${mt.from}~${mt.to}（${mt.reason}）`;
    if (!f.driver1) return '請選擇「駕駛人1」';
    const ds = [f.driver1, f.driver2].filter(Boolean);
    if (f.driver2 && f.driver2 === f.driver1) return '駕駛人1 與駕駛人2 不可為同一人';
    for (const id of ds) if (!DB.drivers.some(d => d.id === id && d.pool === 'BIZ')) return `駕駛 ${id} 不在商務池`;
    const others = this.applications.filter(x => x.status === 'matched'
      && !order.apps.includes(x.id) && this.tripDates(x).some(dt => dates.includes(dt)));
    const vHit = others.find(x => x.vehicle === v.id);
    if (vHit) return `${v.id} 已由差旅共乘 ${vHit.id}（${vHit.departDate}）使用`;
    for (const id of ds) {
      const dHit = others.find(x => this.driversOf(x).includes(id));
      if (dHit) return `${(DB.drivers.find(d => d.id === id) || {}).name || id} 已有差旅共乘 ${dHit.id}（${dHit.departDate}）任務`;
      const lv = DB.driverLeaves.find(l => l.driver === id && dates.includes(l.date));
      if (lv) return `${(DB.drivers.find(d => d.id === id) || {}).name || id} 請假 ${lv.date} ${lv.from}~${lv.to}`;
    }
    if (typeof ModuleD !== 'undefined') {
      const occ = ModuleD.dayOccupancy();
      const dv = dates.find(dt => occ.veh.has(v.id + '|' + dt));
      if (dv) return `${v.id} 已由一般用車 ${occ.veh.get(v.id + '|' + dv)} 佔用（${dv}）`;
      for (const id of ds) { const dd = dates.find(dt => occ.drv.has(id + '|' + dt));
        if (dd) return `${(DB.drivers.find(d => d.id === id) || {}).name || id} 已有一般用車 ${occ.drv.get(id + '|' + dd)} 任務（${dd}）`; }
    }
    return null;
  },
  /* 調度異動派車單：f = { vehicleType, vehicle, driver1, driver2, submitted }
     · 已出車者不可再異動；
     · 送審前可異動車種類型／車號／駕駛人1／駕駛人2，是否送審 否 → 是＝送出運輸主管簽審（各申請單送簽）；
     · 送審後即不可再異動（G130 取代原「撤回送審／送審後異動重新送簽 G103」），運輸主管退回後回未送審才可再改。 */
  updateDispatch(order, f, by, note) {
    if (order.cancelled) return { ok: false, error: '派車單已取消' };
    if (this.started(order)) return { ok: false, error: '派車單已出車，不可再異動' };
    // G130：送審後即不可再異動（含撤回送審）；運輸主管退回後派車單回未送審，才可再修改
    if (order.submitted) return { ok: false, error: '派車單已送審，不可再異動' };
    const v = DB.vehicles.find(x => x.id === f.vehicle);
    const next = { vehicleType: f.vehicleType || (v ? v.type : ''), vehicle: f.vehicle, driver1: f.driver1, driver2: f.driver2 || '',
      submitted: f.submitted == null ? order.submitted : !!f.submitted };
    const err = this.dispatchResourceError(order, next);
    if (err) return { ok: false, error: err };
    const changed = ['vehicleType', 'vehicle', 'driver1', 'driver2'].filter(k => (order[k] || '') !== (next[k] || ''));
    const wasSub = order.submitted;
    if (!changed.length && wasSub === next.submitted) return { ok: true, changed: [] };
    const before = `${order.vehicle}／${[order.driver1, order.driver2].filter(Boolean).join('＋')}`;
    Object.assign(order, next);
    this._applyToApps(order);
    const apps = this.dispatchApps(order);
    if (changed.length) this._dlog(order, '異動', by, `${before} → ${order.vehicle}／${[order.driver1, order.driver2].filter(Boolean).join('＋')}${note ? '（' + note + '）' : ''}`);
    if (!wasSub && next.submitted) {   // 送審（送審後即鎖定，G130）
      apps.forEach(a => Signoff.mark(a, this.signSummary(a), by || '調度室'));
      this._dlog(order, '送審', by, '送出運輸主管簽審');
    }
    return { ok: true, changed };
  },
  // 送審捷徑：不改車輛／駕駛，只把是否送審設為「是」
  submitDispatch(order, by) {
    return this.updateDispatch(order, { vehicleType: order.vehicleType, vehicle: order.vehicle,
      driver1: order.driver1, driver2: order.driver2, submitted: true }, by);
  },
  // 把申請單自派車單移出（派車單空了即取消）
  _detach(app, reason, by) {
    const order = this.dispatchOf(app);
    if (order) {
      order.apps = order.apps.filter(id => id !== app.id);
      this._dlog(order, '移出申請單', by, `${app.id}${reason ? '：' + reason : ''}`);
      if (!order.apps.length) { order.cancelled = true; this._dlog(order, '取消', by, '派車單已無申請單'); }
    }
    app.dispatchId = null; app.vehicle = null; app.driver = null; app.driver2 = null; app.groupId = null;
  },
  /* 無車退回（G122）：僅「待調度」的申請單；原因必填，結案不可再動 */
  canReturn(app) { return app.status === 'approved'; },
  returnApp(app, note, by) {
    note = (note || '').trim();
    if (!this.canReturn(app)) return { ok: false, error: '僅「待調度」的申請單可無車退回' };
    if (!note) return { ok: false, error: '無車退回時「退回原因」為必填' };
    app.status = 'noCar'; app.approvedAt = null; app.noCarNote = note; app.noCarBy = by || '調度室'; app.noCarAt = new Date();
    app.note = `無車退回：${note}`;
    return { ok: true };
  },
  /* 移出派車單（調度中、未送審）：回「待調度」 */
  unassign(app, by) {
    const order = this.dispatchOf(app);
    if (!order || app.status !== 'matched') return { ok: false, error: '此申請單不在派車單內' };
    if (order.submitted) return { ok: false, error: '派車單已送審，不可刪除申請單（送審後即不可再異動）' };
    this._detach(app, '移出派車單', by);
    app.status = 'approved'; app.overridden = false;
    return { ok: true };
  },

  /* 已回登（實登里程）後車輛/司機回歸屬據點（C-2/C-3：currentSite 回復 homeSite）*/
  _returnResourcesHome(app) {
    const v = DB.vehicles.find(x => x.id === app.vehicle);
    if (v && v.homeSite) v.currentSite = v.homeSite;
    this.driversOf(app).forEach(id => { const d = DB.drivers.find(x => x.id === id); if (d && d.homeSite) d.currentSite = d.homeSite; });
  },

  /* ---- 手動併車：候選 = 前後 1 天已派車單（不篩目的地不比時間 G56）---- */
  manualCandidates(app) {
    const d0 = new Date(app.departDate);
    return this.applications.filter(b => {
      if (b.status !== 'matched' || b.id === app.id) return false;
      if (this.noCarpool(app) || this.applications.some(x => x.groupId === b.groupId && this.noCarpool(x))) return false; // 不同意併車（G133）
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
    app.vehicle = targetApp.vehicle; app.driver = targetApp.driver; app.driver2 = targetApp.driver2 || null; app.groupId = targetApp.groupId;
    app.note = '手動併車：搭 ' + targetApp.id;
    // 加入對方的派車單；該派車單已送審者一併送簽（未送審者待調度送審）
    const order = this.dispatchOf(targetApp);
    if (order) {
      order.apps.push(app.id); app.dispatchId = order.id;
      this._dlog(order, '手動併車加入', app.applicant, `${app.id} 搭 ${targetApp.id}`);
      if (order.submitted) Signoff.mark(app, this.signSummary(app) + `（手動併車：搭 ${targetApp.id}）`, app.applicant);
    } else {
      Signoff.mark(app, this.signSummary(app) + `（手動併車：搭 ${targetApp.id}）`, app.applicant);
    }
  },

  /* ---- 運輸主管簽審（派車結果覆核，簽審通過才生效）---- */
  signSummary(a) {
    const nm = id => (DB.drivers.find(x => x.id === id) || {}).name;
    const ds = this.driversOf(a).map(nm).filter(Boolean).join('＋');
    return `${a.dispatchId ? '派車單 ' + a.dispatchId + '｜' : ''}${a.departDate} ${a.earliestPickup}｜${a.origin} → ${a.dest}｜車 ${a.vehicle || '—'}／司機 ${ds || '—'}`;
  },
  /* ---- 車輛使用實登（派車結果生效後登打實際車輛／駕駛／里程）---- */
  USAGE_POOL: 'BIZ',
  usagePlan(a) { return { vehicle: a.vehicle || null, drivers: this.driversOf(a) }; },
  usageRecords() { return this.applications.filter(a => Usage.inScope(a)); },
  usageSave(a, data, by) {
    const r = Usage.save(a, data, by, { pool: this.USAGE_POOL });
    if (r.ok) this._returnResourcesHome(a);   // 已回登：資源回歸屬據點（取代原「行程完成」C-2）
    return r;
  },
  /* 派車單實登（G125）：差旅共乘以「派車單」為單位實登，規則同院區物品轉運（G124）。派車單送審且運輸主管簽審通過
     （單內申請單皆生效）後才可實登；儲存即完成，派車單內每張申請單轉「已回登」，車輛／司機回歸屬據點（C-2）。 */
  dispatchEffective(d) { const as = this.dispatchApps(d); return !d.cancelled && d.submitted && as.length > 0 && as.every(a => Signoff.effective(a)); },
  usageDispatches() { return this.dispatches.filter(d => d.usage || this.dispatchEffective(d)); },
  dispatchUsageSave(d, data, by, opts) {
    if (!d.usage && !this.dispatchEffective(d)) return { ok: false, error: '派車單尚未經運輸主管簽審通過，不可實登' };
    const r = Usage.saveGroup(d, this.dispatchApps(d), data, by, Object.assign({ pool: this.USAGE_POOL }, opts));
    if (r.ok && !(opts && opts.dryRun)) this.dispatchApps(d).forEach(a => this._returnResourcesHome(a));
    return r;
  },
  signRecords() { return this.applications.filter(a => Signoff.inScope(a)); },
  signApprove(a, by, note) { return Signoff.decide(a, true, by, note); },
  // 退回調度：整張派車單回「調度中」（未送審），同單其他申請單簽審一併撤回，由調度修改後重新送審
  signReject(a, by, note) {
    const r = Signoff.decide(a, false, by, note);
    if (!r.ok) return r;
    a.note = `調度主管退回：${a.sign.note}；待調度修改派車單後重新送審。`;
    const order = this.dispatchOf(a);
    if (order) {
      order.submitted = false;
      this._dlog(order, '調度主管退回', by, `${a.id}：${note}`);
      this.dispatchApps(order).filter(x => x !== a).forEach(x => Signoff.release(x, `同派車單 ${a.id} 被退回`, by));
    }
    a.sign = null;
    return r;
  },

};
