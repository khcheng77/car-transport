/* ============================================================
   moduleD.js — 模組 D：一般用車（第四模組，含「例行用車」類別）
   PLAN.md Phase 7 / Guardrails G70–G89；規格 docs/一般用車模組_v2.html
   申請 → 主管簽核 → 調度人工確認資源 → 派車結果 → Email 通知
   調度確認後的異動改用四種生命週期操作：換車／換司機（含補派、雙駕駛）／展延／提前歸還（G83）
   與差旅共乘（模組 C）共用商務車輛/司機資源池（暫定 G71），先佔先贏（G72）
   ============================================================ */

const ModuleD = {
  applications: [],
  mailLog: [],   // 通知紀錄（雛形：寄信服務為空 function，僅留存紀錄 G80）
  seq: 1,
  approveSeq: 1,

  CATEGORY: { general: '一般用車', routine: '例行用車' },
  TRANSPORT_TYPES: ['一般', '自駕', '演訓', '演訓自駕', '院區接駁'],
  showExercisePlan(data) { return (data.category || 'general') === 'general' && data.transportType === '演訓'; },
  MAX_DRIVERS: 2,   // 雙駕駛：同一筆派車紀錄掛 1～2 位司機（G84）

  /* ---- 時間工具：以 UTC 純算術換算，避免時區/日光節約影響比較 ---- */
  absMin(date, time) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 60000 + hhmmToMin(time);
  },
  fromAbs(min) {
    const dt = new Date(min * 60000);
    return { date: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
      time: `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}` };
  },
  fmtAbs(min) { const x = this.fromAbs(min); return `${x.date} ${x.time}`; },
  span(app) {
    return { start: this.absMin(app.startDate, app.startTime), end: this.absMin(app.endDate, app.endTime) };
  },
  /* 時段 [start, end) 涵蓋的日期，供與差旅共乘「以日為單位」的佔用比對 */
  datesBetween(start, end) {
    const out = [];
    const day = m => Math.floor(m / 1440);
    for (let d = day(start), last = day(Math.max(start, end - 1)); d <= last; d++) out.push(this.fromAbs(d * 1440).date);
    return out;
  },
  datesOf(app) { const sp = this.span(app); return this.datesBetween(sp.start, sp.end); },

  /* ---- 用車類別（G81）：例行用車僅特定角色可見可選；兩類別流程規則相同 ---- */
  canChooseRoutine(role) { return DB.routineRoles.includes(role); },

  /* ---- 申請單欄位驗證（G75/G81/G85）：回傳錯誤訊息陣列，空陣列＝通過 ---- */
  validate(data, opts = {}) {
    const errs = [];
    const cat = data.category || 'general';
    if (!this.CATEGORY[cat]) errs.push('用車類別不正確');
    if (data.transportType && !this.TRANSPORT_TYPES.includes(data.transportType)) errs.push('運輸類別請選擇清單中的類別');
    if ((data.selfDrivers || []).length > 8) errs.push('自駕人最多 8 筆');
    if (cat === 'routine' && !this.canChooseRoutine(data.role)) errs.push('「例行用車」類別僅限總經理／部長秘書等特定角色申請');
    if (!data.applicant) errs.push('請填寫申請人');
    if (!data.startDate || !data.startTime || !data.endDate || !data.endTime) {
      errs.push('請填寫用車起訖日期與時間');
    } else if (this.absMin(data.endDate, data.endTime) <= this.absMin(data.startDate, data.startTime)) {
      errs.push('用車迄時必須晚於起時');
    }
    if (!(Number.isInteger(+data.pax) && +data.pax >= 1)) errs.push('人數至少 1 人（一般用車必有人隨行，純載貨請走運輸申請）');
    if (typeof data.selfDrive !== 'boolean') errs.push('請選擇是否自駕');
    if (data.campus && !DB.sites.some(site => site.id === data.campus)) errs.push('車屬院區請選擇清單中的院區');
    const prefs = data.vehiclePreferences || [];
    if ((opts.requireFirstPreference || prefs.some(Boolean)) && !prefs[0]) errs.push('請選擇車種順位 1');
    if (prefs.length > 3 || new Set(prefs.filter(Boolean)).size !== prefs.filter(Boolean).length) errs.push('車種順位最多 3 種，且不可重複');
    if (prefs.some(type => type && !DB.vehicles.some(vehicle => vehicle.pool === 'BIZ' && vehicle.type === type))) errs.push('車種順位請選擇清單中的車種');
    (data.locations || []).forEach((loc, i) => {
      if (!String(loc.name || '').trim()) errs.push(`行程第 ${i + 1} 筆請填地點名稱，或刪除空白列`);
    });
    const codes = DB.permitTypes.map(p => p.code);
    (data.permits || []).forEach(c => { if (!codes.includes(c)) errs.push(`未知的管制區通行證：${c}`); });
    (data.items || []).forEach((it, i) => {
      if (!it.name) errs.push(`隨行貨物第 ${i + 1} 項未填品名`);
      if (!(it.l > 0 && it.w > 0 && it.h > 0)) errs.push(`隨行貨物第 ${i + 1} 項長寬高需為正數`);
      if (!(it.qty > 0)) errs.push(`隨行貨物第 ${i + 1} 項件數需為正整數`);
    });
    return errs;
  },

  _fields(data) {
    // 新表單的 K／P 選項沿用 G85 通行證交集篩選，並相容舊 permits 欄位。
    const permits = new Set(data.permits || []);
    const needZuoyingPermit = data.needZuoyingPermit == null ? permits.has('K') : !!data.needZuoyingPermit;
    const needMndPermit = data.needMndPermit == null ? permits.has('P') : !!data.needMndPermit;
    if (needZuoyingPermit) permits.add('K'); else permits.delete('K');
    if (needMndPermit) permits.add('P'); else permits.delete('P');
    return {
      category: data.category || 'general',                  // 用車類別（G81）
      transportType: data.transportType || '一般',
      exercisePlanName: this.showExercisePlan(data) ? String(data.exercisePlanName || '').trim() : '',
      oneWay: !!data.oneWay,
      allowMerge: !!data.allowMerge,
      continueMatching: !!(data.continueMatching == null ? data.waitDriver : data.continueMatching),
      willingSelfDrive: !!data.willingSelfDrive,
      qualifiedLicense: !!data.qualifiedLicense,
      triplicateFormNo: String(data.triplicateFormNo || '').trim(),
      escortOrderNo: String(data.escortOrderNo || '').trim(),
      requestReview: data.requestReview !== false,
      crossCampus: !!data.crossCampus,
      hasCargo: !!data.hasCargo,
      hazardousCargo: !!data.hazardousCargo,
      pyrotechnicCargo: !!data.pyrotechnicCargo,
      needsHoisting: !!data.needsHoisting,
      selfDrivers: (data.selfDrivers || []).map(person => ({ name: String(person.name || '').trim(), ext: String(person.ext || '').trim(), phone: String(person.phone || '').trim() })),
      applicant: data.applicant,
      dept: data.dept || '',
      ext: data.ext || '',
      planCode: String(data.planCode || '').trim(),
      vehiclePreferences: (data.vehiclePreferences || []).map(type => String(type || '').trim()).slice(0, 3),
      needZuoyingPermit,
      needMndPermit,
      changeReason: String(data.changeReason || '').trim(),
      remarks: String(data.remarks || '').trim(),
      campus: String(data.campus || '').trim(),
      pickupLocation: String(data.pickupLocation || '').trim(),
      leader: String(data.leader || '').trim(),
      leaderExt: String(data.leaderExt || '').trim(),
      leaderPhone: String(data.leaderPhone || '').trim(),
      locations: (data.locations || []).map((loc, i) => ({ name: String(loc.name || '').trim(), order: i + 1 })),
      startDate: data.startDate, startTime: data.startTime,  // 用車起（必填；時長不分類別，數小時～數個月 G81）
      endDate: data.endDate, endTime: data.endTime,          // 用車迄
      pax: +data.pax,                                        // 人數 ≥ 1（人貨不互斥 G75）
      selfDrive: data.selfDrive,                             // 是否自駕（不做資格檢核 G78）
      waitDriver: data.selfDrive === true && !!(data.continueMatching == null ? data.waitDriver : data.continueMatching), // 願意等待駕駛媒合（須同時勾自駕；補派司機前提 G84）
      holidayOT: !!data.holidayOT,                           // 假日加班需求（僅提示 G87）
      nightOT: !!data.nightOT,                               // 夜間加班需求（僅提示 G87）
      permits: [...permits],                                // 所需管制區通行證（交集篩選 G85）
      enterTaipei: !!data.enterTaipei,                       // 是否會進入台北市（噸位提示 G86）
      purpose: data.purpose || '',                           // 用車事由（舊版行程說明保留於此欄位）
      items: (data.items || []).map(it => Object.assign({ hazardous: false }, it)), // 隨行貨物（選填）
    };
  },

  // 申請端只負責建立，狀態為「待主管簽核」（G74 先簽核、通過才進調度）
  createApp(data, opts) {
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    const app = Object.assign({ id: 'GU' + String(this.seq++).padStart(3, '0') }, this._fields(data), {
      status: opts && opts.draft ? 'draft' : 'submitted',   // draft（申請中）|submitted（待二級審）|approved（待調度）|rejected（退回修編）|noVehicle（無車退回）|dispatched；顯示狀態由 Flow 推導
      outcome: null,         // 派車判斷結果：withDriver|selfDrive|noVehicle（G76）
      segs: [],              // 指派區間歷史：{ from(絕對分), vehicle, drivers[], kind, reason, by, at }（G88）
      vehicle: null, driver: null, drivers: [],   // 目前（最新一段）指派，供畫面與相容用
      pendingReturn: null,   // 使用者提出、待調度確認的提前歸還（G83）
      approvedAt: null, reviewNote: '',
      dispatchedAt: null,    // 調度完成確認時間（任一最終判斷即算）
      dispatchedBy: '', dispatchNote: '',
      notifiedAt: null,
      log: [],               // 撤回／重送／生命週期操作等異動紀錄
      createdAt: new Date(),
    });
    this.applications.push(app);
    return app;
  },

  _log(app, action, by, note) { app.log.push({ at: new Date(), action, by: by || app.applicant, note: note || '' }); },

  /* ---- 主管簽核（沿用核准者關係表 DB.approvalMap；駁回保留紀錄不進調度 G74；兩類別相同）---- */
  approverOf(app) { return DB.approvalMap[app.applicant] || '直屬主管'; },
  approve(app, note) {
    if (app.status !== 'submitted') return false;
    app.status = 'approved'; app.approvedAt = this.approveSeq++;
    if (note != null) app.reviewNote = note;
    return true;
  },
  reject(app, note) {
    if (app.status !== 'submitted') return false;
    app.status = 'rejected'; app.approvedAt = null;
    if (note != null) app.reviewNote = note;
    return true;
  },

  /* ---- 調度確認前的撤回（G79）：可撤回修改拿回草稿（重送須重新簽核），或整單撤回 ----
     調度完成確認＝做出任一最終判斷（含無車可派）；確認後不再撤回，改用生命週期操作（G83）。 */
  isConfirmed(app) { return app.dispatchedAt != null; },
  canWithdrawToEdit(app) { return ['submitted', 'approved'].includes(app.status) && !this.isConfirmed(app); },
  withdrawToEdit(app, by) {
    if (!this.canWithdrawToEdit(app)) return false;
    this._log(app, '撤回修改', by, `原狀態 ${app.status}`);
    app.status = 'draft'; app.approvedAt = null; app.reviewNote = '';
    return true;
  },
  // 暫存（申請中）修改
  saveDraft(app, data) {
    if (app.status !== 'draft') throw new Error('僅「申請中」的申請可暫存修改');
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    Object.assign(app, this._fields(data));
    this._log(app, '暫存修改', data.applicant, '');
    return app;
  },
  // 申請中（暫存／撤回修改）或「退回修編」（單位主管退回）可修改後送出，進入待二級審
  canEdit(app) { return ['draft', 'rejected'].includes(app.status); },
  resubmit(app, data) {
    if (!this.canEdit(app)) throw new Error('僅草稿或「退回修編」的申請可修改後重新送出');
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    const wasReturned = app.status === 'rejected';
    Object.assign(app, this._fields(data));
    app.status = 'submitted';
    this._log(app, '修改後重新送出', data.applicant, [wasReturned ? `退回修編意見：${app.reviewNote || '—'}` : '', app.changeReason ? `異動事由：${app.changeReason}` : ''].filter(Boolean).join('；'));
    app.reviewNote = '';
    return app;
  },
  /* ---- 指派區間（G88）：每次換車／換司機新增一段，不覆蓋；瞬間切換、不設重疊 ---- */
  segEnd(app, i) { const nx = app.segs[i + 1]; return nx ? nx.from : this.span(app).end; },
  liveSegs(app) {   // 實際生效（長度 > 0）的區間
    return app.segs.map((s, i) => Object.assign({}, s, { to: this.segEnd(app, i) })).filter(s => s.to > s.from);
  },
  lastSeg(app) { return app.segs[app.segs.length - 1] || null; },
  _sync(app) {
    const s = this.lastSeg(app);
    app.vehicle = s ? s.vehicle : null;
    app.drivers = s ? s.drivers.slice() : [];
    app.driver = app.drivers[0] || null;
  },

  /* ---- 共用資源池佔用判斷（G71/G72）----
     與差旅共乘：以「日」為單位，沿用模組 C 自己排班時的佔用口徑（matched/boarded/completed 的整趟日期）；
     一般用車彼此：依指派區間的實際時段重疊判斷（雙駕駛兩位都算）。保修（G60）與請假（G61）同樣適用。 */
  C_HOLD: ['matched'],
  _cApps() { return (typeof ModuleC !== 'undefined') ? ModuleC.applications : []; },
  _overlap(a, b) { return a.start < b.end && b.start < a.end; },
  _dHolder(kind, id, rng, exceptId) {
    for (const x of this.applications) {
      if (x.id === exceptId || x.status !== 'dispatched') continue;
      for (const s of this.liveSegs(x)) {
        const has = kind === 'vehicle' ? s.vehicle === id : s.drivers.includes(id);
        if (has && this._overlap(rng, { start: s.from, end: s.to })) return { app: x, seg: s };
      }
    }
    return null;
  },
  vehicleBusyIn(vId, rng, exceptId) {
    const dates = this.datesBetween(rng.start, rng.end);
    const m = DB.maintenance.find(x => x.vehicle === vId && dates.some(dt => dt >= x.from && dt <= x.to));
    if (m) return { type: 'maint', text: `保修 ${m.from}~${m.to}（${m.reason}）` };
    const c = this._cApps().find(x => this.C_HOLD.includes(x.status) && x.vehicle === vId
      && ModuleC.tripDates(x).some(dt => dates.includes(dt)));
    if (c) return { type: 'C', ref: c.id, text: `差旅共乘 ${c.id} 佔用（${c.departDate}）` };
    const h = this._dHolder('vehicle', vId, rng, exceptId);
    if (h) return { type: 'D', ref: h.app.id, text: `一般用車 ${h.app.id} 佔用（${this.fmtAbs(h.seg.from)}~${this.fmtAbs(h.seg.to)}）` };
    return null;
  },
  driverBusyIn(dId, rng, exceptId) {
    const dates = this.datesBetween(rng.start, rng.end);
    const lv = DB.driverLeaves.find(l => l.driver === dId
      && this._overlap(rng, { start: this.absMin(l.date, l.from), end: this.absMin(l.date, l.to) }));
    if (lv) return { type: 'leave', text: `請假 ${lv.date} ${lv.from}~${lv.to}` };
    const c = this._cApps().find(x => this.C_HOLD.includes(x.status) && ModuleC.driversOf(x).includes(dId)
      && ModuleC.tripDates(x).some(dt => dates.includes(dt)));
    if (c) return { type: 'C', ref: c.id, text: `差旅共乘 ${c.id} 任務（${c.departDate}）` };
    const h = this._dHolder('driver', dId, rng, exceptId);
    if (h) return { type: 'D', ref: h.app.id, text: `一般用車 ${h.app.id} 任務（${this.fmtAbs(h.seg.from)}~${this.fmtAbs(h.seg.to)}）` };
    return null;
  },
  vehicleBusy(vId, app) { return this.vehicleBusyIn(vId, this.span(app), app.id); },
  driverBusy(dId, app) { return this.driverBusyIn(dId, this.span(app), app.id); },

  /* ---- 管制區通行證（G85）：綁車輛、可多證；申請勾選者採「交集」——須同時持有全部證件 ---- */
  permitOk(v, permits) { return (permits || []).every(c => (v.permits || []).includes(c)); },
  permitName(code) { const p = DB.permitTypes.find(x => x.code === code); return p ? p.name : code; },

  /* 候選資源（商務池）：缺通行證的車完全不列入（excluded 僅供說明）；座位不足列為不可用（車型由調度人工判斷 G77）
     rng 預設為整段用車時段；換車／換司機時傳入「生效時點～結束」。 */
  resources(app, rng) {
    rng = rng || this.span(app);
    const biz = DB.vehicles.filter(v => v.pool === 'BIZ');
    const excluded = biz.filter(v => !this.permitOk(v, app.permits));
    const vehicles = biz.filter(v => this.permitOk(v, app.permits)).map(v => ({
      v, busy: v.seats < app.pax ? { type: 'seats', text: `座位 ${v.seats} < ${app.pax} 人` } : this.vehicleBusyIn(v.id, rng, app.id),
    }));
    const drivers = DB.drivers.filter(d => d.pool === 'BIZ').map(d => ({ d, busy: this.driverBusyIn(d.id, rng, app.id) }));
    return { vehicles, drivers, excluded };
  },

  /* 車輛狀態（矩陣列 G76）：withDriver＝有車有司機｜vehicleOnly＝有車沒司機｜none＝沒車（含通行證交集為空 G85）*/
  resourceState(app) {
    const r = this.resources(app);
    const freeV = r.vehicles.filter(x => !x.busy).length, freeD = r.drivers.filter(x => !x.busy).length;
    return freeV === 0 ? 'none' : (freeD === 0 ? 'vehicleOnly' : 'withDriver');
  },
  /* 派車判斷矩陣（G76）：車輛狀態 × 是否自駕 → 結果；不進候補；兩類別共用 */
  matrixOutcome(state, selfDrive) {
    if (state === 'withDriver') return 'withDriver';
    if (state === 'vehicleOnly') return selfDrive ? 'selfDrive' : 'noVehicle';
    return 'noVehicle';
  },

  /* ---- 例行用車調度優先權（G82）：資源尚未確定分配前優先；已生效的佔用不溯及 ----
     回傳與本單時段重疊、仍待調度（approved）的例行用車申請，供調度判斷時優先分配。 */
  priorityPeers(app) {
    if (app.category === 'routine') return [];
    const sp = this.span(app);
    return this.applications.filter(x => x.id !== app.id && x.category === 'routine' && x.status === 'approved'
      && this._overlap(sp, this.span(x)));
  },
  /* 調度清單排序：待調度者例行用車優先，其餘依用車起時 */
  reviewOrder(list) {
    const rank = a => (a.status === 'approved' && a.category === 'routine') ? 0 : 1;
    return list.slice().sort((x, y) => rank(x) - rank(y) || this.span(x).start - this.span(y).start);
  },

  _checkDrivers(drivers, rng, exceptId) {
    if (new Set(drivers).size !== drivers.length) return '同一位司機不可重複指派';
    if (drivers.length > this.MAX_DRIVERS) return `同一筆派車最多 ${this.MAX_DRIVERS} 位司機（雙駕駛）`;
    for (const id of drivers) {
      const d = DB.drivers.find(x => x.id === id && x.pool === 'BIZ');
      if (!d) return `司機 ${id} 不在商務資源池`;
      const b = this.driverBusyIn(id, rng, exceptId);
      if (b) return `司機 ${d.name} 不可用：${b.text}（先佔先贏 G72）`;
    }
    return null;
  },
  _checkVehicle(app, vId, rng) {
    const v = DB.vehicles.find(x => x.id === vId && x.pool === 'BIZ');
    if (!v) return `車輛 ${vId} 不在商務資源池`;
    if (!this.permitOk(v, app.permits)) return `車輛 ${vId} 未同時持有 ${app.permits.map(c => this.permitName(c)).join('＋')}（通行證交集篩選 G85）`;
    if (v.seats < app.pax) return `車輛 ${vId} 座位 ${v.seats} < ${app.pax} 人`;
    const b = this.vehicleBusyIn(vId, rng, app.id);
    if (b) return `車輛 ${vId} 不可用：${b.text}（先佔先贏 G72）`;
    return null;
  },

  /* 依調度選擇判定結果（不改資料）。sel：{ vehicle, drivers[]（或 driver）, noVehicle }
     noVehicle＝調度人工判定無車可派（如車型不符、危險品考量 G77/G78），任何時候皆可。 */
  decide(app, sel) {
    sel = sel || {};
    if (sel.noVehicle) return { outcome: 'noVehicle' };
    if (!sel.vehicle) return { error: '請選擇車輛，或判定無車可派' };
    const rng = this.span(app);
    const ve = this._checkVehicle(app, sel.vehicle, rng);
    if (ve) return { error: ve };
    const drivers = (sel.drivers || (sel.driver ? [sel.driver] : [])).filter(Boolean);
    if (drivers.length) {
      const de = this._checkDrivers(drivers, rng, app.id);
      if (de) return { error: de };
      return { outcome: 'withDriver', vehicle: sel.vehicle, drivers };
    }
    if (this.resources(app).drivers.some(x => !x.busy)) return { error: '尚有可派司機：依判斷矩陣「有車有司機」應派車＋派司機（G76）' };
    const outcome = this.matrixOutcome('vehicleOnly', app.selfDrive);
    return outcome === 'selfDrive' ? { outcome, vehicle: sel.vehicle, drivers: [] } : { outcome };
  },

  /* 調度完成確認（G76）：先簽核才可調度；做出任一最終判斷即寄送結果通知（G80）
     派車即建立第一筆指派區間；無車可派不佔用任何資源（資源立即釋放、不進候補）。 */
  dispatch(app, sel, by, note) {
    if (app.status !== 'approved') return { ok: false, error: '僅主管簽核通過（已核准）的申請可調度（G74）' };
    const r = this.decide(app, sel);
    if (r.error) return { ok: false, error: r.error };
    app.outcome = r.outcome;
    by = by || '調度室';
    if (r.outcome === 'noVehicle') {
      // 無車退回（G122）：結案不可再動，不送調度主管簽審，立即通知申請人
      app.status = 'noVehicle'; app.segs = []; this._sync(app);
      app.dispatchedAt = new Date(); app.dispatchedBy = by; app.dispatchNote = note || '';
      app.noCarNote = note || '判定無車可派';
      this.sendResultMail(app);
      return { ok: true, outcome: r.outcome };
    } else {
      app.status = 'dispatched';
      app.segs = [{ from: this.span(app).start, vehicle: r.vehicle, drivers: r.drivers, kind: '原始指派', reason: '', by, at: new Date() }];
    }
    this._sync(app);
    app.dispatchedAt = new Date(); app.dispatchedBy = by; app.dispatchNote = note || '';
    this._ensureDispatch(app);
    // 派車結果送運輸主管簽審；簽審通過才生效並寄送結果通知
    Signoff.mark(app, this.signSummary(app), by);
    return { ok: true, outcome: r.outcome };
  },

  /* ---- 運輸主管簽審（派車結果覆核，簽審通過才生效）---- */
  signSummary(app) {
    if (app.outcome === 'noVehicle') return '判定無車可派';
    const dn = id => (DB.drivers.find(d => d.id === id) || {}).name || id;
    return `${this.OUTCOME_TEXT[app.outcome]}｜車 ${app.vehicle}｜${app.drivers.length ? '司機 ' + app.drivers.map(dn).join('＋') : '使用者自駕'}`;
  },
  /* ---- 派車單（G126）：一般用車一單一派車單。派車判斷（無車退回除外）時系統自動給派車單號（GD###），
     派遣人／派遣時間＝調度人員／調度確認時間；車種類型、車號、駕駛人1／2 隨申請單目前指派（換車／換司機後同步）。
     運輸主管退回後重新派車沿用同一派車單號。 ---- */
  dispatches: [], dispatchSeq: 1,   // { id, apps:[appId], usage, usageLog }（其餘欄位由 _refreshDispatch 自申請單帶入）
  _ensureDispatch(app) {
    if (!app.dispatchNo) app.dispatchNo = 'GD' + String(this.dispatchSeq++).padStart(3, '0');
    let d = this.dispatches.find(x => x.id === app.dispatchNo);
    if (!d) { d = { id: app.dispatchNo, apps: [app.id], usage: null, usageLog: [] }; this.dispatches.push(d); }
    return this._refreshDispatch(d);
  },
  _refreshDispatch(d) {
    const a = this.applications.find(x => x.id === d.apps[0]);
    if (!a) return d;
    const v = DB.vehicles.find(x => x.id === a.vehicle), ds = a.drivers || [];
    return Object.assign(d, { date: a.startDate, vehicleType: v ? v.type : '', vehicle: a.vehicle || '', driver1: ds[0] || '', driver2: ds[1] || '',
      dispatcher: a.dispatchedBy, dispatchedAt: a.dispatchedAt, selfDrive: !!a.selfDrive, cancelled: a.status !== 'dispatched' && !d.usage });
  },
  dispatchOrderOf(app) { return app.dispatchNo && app.status === 'dispatched' ? this._refreshDispatch(this.dispatches.find(x => x.id === app.dispatchNo)) : null; },
  dispatchApps(d) { return d.apps.map(id => this.applications.find(a => a.id === id)).filter(Boolean); },
  dispatchEffective(d) { const a = this.dispatchApps(d)[0]; return !!a && a.status === 'dispatched' && Signoff.effective(a); },
  usageDispatches() { return this.dispatches.map(d => this._refreshDispatch(d)).filter(d => d.usage || this.dispatchEffective(d)); },
  // 派車單實登：自駕單駕駛人1 可登「使用者自駕」；儲存即完成，申請單轉「已回登」
  dispatchUsageSave(d, data, by, opts) {
    if (!d.usage && !this.dispatchEffective(d)) return { ok: false, error: '派車單尚未經運輸主管簽審通過，不可實登' };
    const apps = this.dispatchApps(d);
    return Usage.saveGroup(d, apps, data, by, Object.assign({ pool: this.USAGE_POOL, allowSelf: apps.some(a => a.selfDrive) }, opts));
  },

  /* ---- 車輛使用實登（派車結果生效後登打；無車可派者不需實登；自駕者駕駛人1 可登「使用者自駕」）---- */
  USAGE_POOL: 'BIZ',
  usagePlan(app) { return { vehicle: app.vehicle || null, drivers: (app.drivers || []).slice() }; },
  usageRecords() { return this.applications.filter(a => a.outcome !== 'noVehicle' && Usage.inScope(a)); },
  usageSave(app, data, by) {
    if (app.outcome === 'noVehicle') return { ok: false, error: '判定無車可派的申請不需實登' };
    return Usage.save(app, data, by, { pool: this.USAGE_POOL, allowSelf: !!app.selfDrive });
  },
  signRecords() { return this.applications.filter(a => Signoff.inScope(a)); },
  // 同意：派車結果生效，寄送結果通知（G80）
  signApprove(app, by, note) {
    const r = Signoff.decide(app, true, by, note);
    if (r.ok) this.sendResultMail(app);
    return r;
  },
  // 退回：撤銷派車判斷、回到「已核准待調度」（資源釋放），由調度重新判斷後再送簽審
  signReject(app, by, note) {
    const r = Signoff.decide(app, false, by, note);
    if (!r.ok) return r;
    app.status = 'approved'; app.outcome = null; app.segs = []; this._sync(app);
    app.dispatchedAt = null; app.dispatchedBy = ''; app.dispatchNote = '';
    this._log(app, '運輸主管退回', by || Signoff.SUPERVISOR, app.sign.note);
    return r;
  },
  _live(app, what) {
    if (app.status !== 'dispatched') return `僅已派車的申請可${what}`;
    if (!Signoff.effective(app)) return `派車結果尚待運輸主管簽審，簽審通過後才可${what}`;
    return null;
  },

  /* ================= 調度確認後的生命週期操作（G83，兩類別通用）=================
     換車／換司機／展延：僅調度在系統操作、立即生效、不需簽核（使用者以電話等系統外管道聯繫）；
     提前歸還：唯一由使用者在系統發起，須調度確認後才生效。 */

  /* 換車／換司機（含補派司機、加派第二位、雙駕駛單獨更換其一 G84/G88）
     o：{ date, time（生效時點）, vehicle?, drivers?, reason, by }；生效時點起新資源、前一刻止舊資源 */
  reassign(app, o) {
    const ng = this._live(app, '換車／換司機'); if (ng) return { ok: false, error: ng };
    const last = this.lastSeg(app), sp = this.span(app);
    if (!o.date || !o.time) return { ok: false, error: '請填寫生效日期與時間' };
    const eff = this.absMin(o.date, o.time);
    if (eff < last.from || eff >= sp.end) {
      return { ok: false, error: `生效時點須介於 ${this.fmtAbs(last.from)}（目前區間起點）與用車結束 ${this.fmtAbs(sp.end)} 之間` };
    }
    const vehicle = o.vehicle || last.vehicle;
    const drivers = o.drivers ? o.drivers.filter(Boolean) : last.drivers.slice();
    const sameDrivers = drivers.length === last.drivers.length && drivers.every(d => last.drivers.includes(d));
    if (vehicle === last.vehicle && sameDrivers) return { ok: false, error: '車輛與司機皆未變更' };
    if (!drivers.length && !app.selfDrive) return { ok: false, error: '使用者未勾選自駕，至少需 1 位司機' };
    const supplement = last.drivers.length === 0 && drivers.length > 0;
    if (supplement && !app.waitDriver) return { ok: false, error: '使用者未勾選「願意等待駕駛媒合」，不可補派司機（G84）' };
    const rng = { start: eff, end: sp.end };
    if (vehicle !== last.vehicle) {
      const ve = this._checkVehicle(app, vehicle, rng);
      if (ve) return { ok: false, error: ve };
    }
    const de = this._checkDrivers(drivers, rng, app.id);
    if (de) return { ok: false, error: de };
    const kinds = [];
    if (vehicle !== last.vehicle) kinds.push('換車');
    if (supplement) kinds.push('補派司機');
    else if (!sameDrivers) kinds.push(drivers.length > last.drivers.length && last.drivers.every(d => drivers.includes(d)) ? '加派司機' : '換司機');
    const kind = kinds.join('＋');
    const by = o.by || '調度室';
    app.segs.push({ from: eff, vehicle, drivers, kind, reason: o.reason || '', by, at: new Date() });
    app.outcome = drivers.length ? 'withDriver' : 'selfDrive';
    this._sync(app);
    const note = `${this.fmtAbs(eff)} 起：${vehicle}／${drivers.length ? drivers.join('、') : '使用者自駕'}${o.reason ? '（' + o.reason + '）' : ''}`;
    this._log(app, kind, by, note);
    this.sendMail(app, kind, note);
    return { ok: true, kind };
  },

  /* 替補自駕駕駛（G116）：其他申請單撤銷等原因使駕駛閒置時，替「被迫自駕」的已派車單補派司機。
     對象：已派車且派車結果已生效、目前區間無司機（使用者自駕）且勾選「願意等待駕駛媒合」者（G84）；
     依調度順序（例行用車優先、再依用車起始）逐單找整段剩餘時間皆空閒的司機，以補派司機（reassign）立即生效。
     生效時點＝max（目前自駕區間起點, 現在）；已結束者略過。opts.now 供測試指定現在時刻。
     駕駛挑選：優先與該車同一據點（駕駛當前位置＝車輛當前位置，G59），沒有才找其他據點的閒置駕駛。 */
  selfDriveBackfillTargets() {
    const rank = a => a.category === 'routine' ? 0 : 1;   // 例行用車優先（G82），再依用車起始
    return this.applications.filter(a => a.status === 'dispatched' && Signoff.effective(a)
      && a.waitDriver && this.lastSeg(a) && this.lastSeg(a).drivers.length === 0)
      .sort((x, y) => rank(x) - rank(y) || this.span(x).start - this.span(y).start);
  },
  backfillSelfDrive(by, opts) {
    const now = (opts && opts.now) || new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowAbs = this.absMin(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
    const filled = [], skipped = [];
    for (const app of this.selfDriveBackfillTargets()) {
      const last = this.lastSeg(app), end = this.span(app).end;
      const eff = Math.max(last.from, nowAbs);
      if (eff >= end) { skipped.push({ app, reason: '用車時段已結束' }); continue; }
      const rng = { start: eff, end };
      const veh = DB.vehicles.find(v => v.id === last.vehicle);
      const site = veh ? (veh.currentSite || veh.homeSite) : null;
      const at = x => x.currentSite || x.homeSite;
      const idle = DB.drivers.filter(x => x.pool === 'BIZ' && !this.driverBusyIn(x.id, rng, app.id));
      const d = idle.find(x => site && at(x) === site) || idle[0];
      if (!d) { skipped.push({ app, reason: '剩餘用車時段內沒有閒置駕駛' }); continue; }
      const t = this.fromAbs(eff);
      const r = this.reassign(app, { date: t.date, time: t.time, drivers: [d.id], reason: '替補自駕駕駛（駕駛閒置）', by: by || '調度室' });
      if (r.ok) filled.push({ app, driver: d, from: this.fmtAbs(eff), site, driverSite: at(d), sameSite: !!site && at(d) === site });
      else skipped.push({ app, reason: r.error });
    }
    return { filled, skipped };
  },

  /* 展延（G83）：延後用車結束時間；僅調度、不需簽核；延長區段內目前的車輛／司機須仍可用（先佔先贏） */
  extend(app, o) {
    const ng = this._live(app, '展延'); if (ng) return { ok: false, error: ng };
    if (!o.date || !o.time) return { ok: false, error: '請填寫新的用車結束日期與時間' };
    const sp = this.span(app), ne = this.absMin(o.date, o.time);
    if (ne <= sp.end) return { ok: false, error: `新的結束時間須晚於目前結束 ${this.fmtAbs(sp.end)}` };
    const last = this.lastSeg(app), rng = { start: sp.end, end: ne };
    const vb = this.vehicleBusyIn(last.vehicle, rng, app.id);
    if (vb) return { ok: false, error: `展延期間車輛 ${last.vehicle} 不可用：${vb.text}；請先換車再展延` };
    for (const d of last.drivers) {
      const b = this.driverBusyIn(d, rng, app.id);
      if (b) return { ok: false, error: `展延期間司機 ${d} 不可用：${b.text}；請先換司機再展延` };
    }
    const by = o.by || '調度室', old = this.fmtAbs(sp.end);
    app.endDate = o.date; app.endTime = o.time;
    if (app.pendingReturn) { this._log(app, '撤銷提前歸還申請', by, '因展延一併撤銷'); app.pendingReturn = null; }
    const note = `結束時間 ${old} → ${o.date} ${o.time}${o.reason ? '（' + o.reason + '）' : ''}`;
    this._log(app, '展延', by, note);
    this.sendMail(app, '展延', note);
    return { ok: true };
  },

  /* 提前歸還（G83）：使用者在系統發起（填新的結束時間），待調度確認才生效；
     新結束時間＝用車起時代表整段不用車（確認後狀態為「已歸還（未出車）」）。 */
  requestEarlyReturn(app, o, by) {
    const ng = this._live(app, '提出提前歸還'); if (ng) return { ok: false, error: ng };
    if (app.pendingReturn) return { ok: false, error: '已有待調度確認的提前歸還申請' };
    if (!o.date || !o.time) return { ok: false, error: '請填寫提前歸還的日期與時間' };
    const sp = this.span(app), ne = this.absMin(o.date, o.time);
    if (ne <= sp.start || ne >= sp.end) return { ok: false, error: `提前歸還時間須晚於用車起 ${this.fmtAbs(sp.start)}、早於目前結束 ${this.fmtAbs(sp.end)}` };
    app.pendingReturn = { date: o.date, time: o.time, reason: o.reason || '', by: by || app.applicant, at: new Date() };
    this._log(app, '提出提前歸還', by || app.applicant, `新結束 ${o.date} ${o.time}${o.reason ? '（' + o.reason + '）' : ''}，待調度確認`);
    return { ok: true };
  },
  confirmEarlyReturn(app, by, note) {
    const pr = app.pendingReturn;
    if (app.status !== 'dispatched' || !pr) return { ok: false, error: '沒有待確認的提前歸還申請' };
    const sp = this.span(app), ne = this.absMin(pr.date, pr.time), old = this.fmtAbs(sp.end);
    app.endDate = pr.date; app.endTime = pr.time;
    // 新結束時間之後才開始的指派區間不會生效（保留第一段作為原始紀錄）
    app.segs = app.segs.filter((s, i) => i === 0 || s.from < ne);
    this._sync(app);
    app.pendingReturn = null; app.releasedAt = new Date();
    const whole = false;   // G122：刪除「已歸還（未出車）」狀態，提前歸還須晚於用車起
    const text = `結束時間 ${old} → ${pr.date} ${pr.time}，之後時段釋放`;
    this._log(app, '確認提前歸還', by || '調度室', text + (note ? `｜${note}` : ''));
    this.sendMail(app, '提前歸還', text);
    return { ok: true, whole };
  },
  rejectEarlyReturn(app, by, note) {
    if (app.status !== 'dispatched' || !app.pendingReturn) return { ok: false, error: '沒有待確認的提前歸還申請' };
    app.pendingReturn = null;
    this._log(app, '退回提前歸還', by || '調度室', note || '');
    this.sendMail(app, '提前歸還未同意', note || '維持原結束時間');
    return { ok: true };
  },

  /* 狀態推導（Flow）：已出車＝用車起時間已到；已回登＝車輛使用實登 */
  departAt(app) { return Flow.at(app.startDate, app.startTime); },


  /* ---- 加班系統介接（G87）：即時查詢司機剩餘可加班工時（雛形以 DB.overtimeRemaining 模擬）。
     僅供調度參考，系統不計算工時、不據以擋派車。 */
  queryOvertime(dId) {
    /* TODO: 串接加班系統 API（即時查詢，非定期快照）；逾時／異常處理待與加班系統負責單位確認 */
    const h = DB.overtimeRemaining[dId];
    return { hours: h == null ? null : h, at: new Date() };
  },

  /* 寄信服務（雛形：空 function，實際寄信待實作 G80）——沿用既有 email 通知路由
     （核准者關係表基礎設施），通知申請人派車結果與生命週期異動；雛形僅留存寄送紀錄供畫面顯示。 */
  OUTCOME_TEXT: { withDriver: '派車＋派司機', selfDrive: '派車（使用者自行駕駛）', noVehicle: '無車可派' },
  sendResultMail(app) {
    return this.sendMail(app, '派車結果', this.OUTCOME_TEXT[app.outcome], app.outcome);
  },
  sendMail(app, kind, text, outcome) {
    /* TODO: 串接寄信服務。收件人＝申請人（依 DB.approvalMap 既有路由） */
    const rec = { app: app.id, to: app.applicant, kind, text, outcome: outcome || null, at: new Date() };
    this.mailLog.push(rec);
    app.notifiedAt = rec.at;
    return rec;
  },
  mailsOf(app) { return this.mailLog.filter(m => m.app === app.id); },

  /* 供差旅共乘批次媒合／人工改派讀取：一般用車目前佔用（以日為單位，依指派區間），鍵為 "id|yyyy-mm-dd" */
  dayOccupancy() {
    const veh = new Map(), drv = new Map();
    this.applications.filter(a => a.status === 'dispatched').forEach(a => this.liveSegs(a).forEach(s =>
      this.datesBetween(s.from, s.to).forEach(dt => {
        if (s.vehicle) veh.set(s.vehicle + '|' + dt, a.id);
        s.drivers.forEach(d => drv.set(d + '|' + dt, a.id));
      })));
    return { veh, drv };
  },
};
