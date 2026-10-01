/* ============================================================
   moduleD.js — 模組 D：一般用車（第四模組）
   PLAN.md Phase 7 / Guardrails G70–G80；規格 docs/一般用車模組_v1.html
   申請 → 主管簽核 → 調度人工確認資源 → 派車結果 → Email 通知
   與差旅共乘（模組 C）共用商務車輛/司機資源池（暫定 G71），先佔先贏（G72）
   ============================================================ */

const ModuleD = {
  applications: [],
  mailLog: [],   // 派車結果通知紀錄（雛形：寄信服務為空 function，僅留存紀錄 G80）
  seq: 1,
  approveSeq: 1,

  /* ---- 時間工具：以 UTC 純算術換算，避免時區/日光節約影響比較 ---- */
  absMin(date, time) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 60000 + hhmmToMin(time);
  },
  span(app) {
    return { start: this.absMin(app.startDate, app.startTime), end: this.absMin(app.endDate, app.endTime) };
  },
  /* 用車期間涵蓋的日期（含起訖兩端），供與差旅共乘「以日為單位」的佔用比對 */
  datesOf(app) {
    const out = [];
    const [y1, m1, d1] = app.startDate.split('-').map(Number);
    const [y2, m2, d2] = app.endDate.split('-').map(Number);
    for (let t = Date.UTC(y1, m1 - 1, d1), end = Date.UTC(y2, m2 - 1, d2); t <= end; t += 86400000) {
      const dt = new Date(t);
      out.push(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
    }
    return out;
  },

  /* ---- 申請單欄位驗證（G75）：回傳錯誤訊息陣列，空陣列＝通過 ---- */
  validate(data) {
    const errs = [];
    if (!data.applicant) errs.push('請填寫申請人');
    if (!data.startDate || !data.startTime || !data.endDate || !data.endTime) {
      errs.push('請填寫用車起訖日期與時間');
    } else if (this.absMin(data.endDate, data.endTime) <= this.absMin(data.startDate, data.startTime)) {
      errs.push('用車迄時必須晚於起時');
    }
    if (!(Number.isInteger(+data.pax) && +data.pax >= 1)) errs.push('人數至少 1 人（一般用車必有人隨行，純載貨請走運輸申請）');
    if (typeof data.selfDrive !== 'boolean') errs.push('請選擇是否自駕');
    (data.items || []).forEach((it, i) => {
      if (!it.name) errs.push(`隨行貨物第 ${i + 1} 項未填品名`);
      if (!(it.l > 0 && it.w > 0 && it.h > 0)) errs.push(`隨行貨物第 ${i + 1} 項長寬高需為正數`);
      if (!(it.qty > 0)) errs.push(`隨行貨物第 ${i + 1} 項件數需為正整數`);
    });
    return errs;
  },

  _fields(data) {
    return {
      applicant: data.applicant,
      dept: data.dept || '',
      ext: data.ext || '',
      startDate: data.startDate, startTime: data.startTime,  // 用車起（G75 必填）
      endDate: data.endDate, endTime: data.endTime,          // 用車迄（G75 必填）
      pax: +data.pax,                                        // 人數 ≥ 1（人貨不互斥 G75）
      selfDrive: data.selfDrive,                             // 是否自駕（不做資格檢核 G78）
      purpose: data.purpose || '',                           // 行程說明（選填：上車地點／目的地／事由）
      items: (data.items || []).map(it => Object.assign({ hazardous: false }, it)), // 隨行貨物（選填）
    };
  },

  // 申請端只負責建立，狀態為「待主管簽核」（G74 先簽核、通過才進調度）
  createApp(data) {
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    const app = Object.assign({ id: 'GU' + String(this.seq++).padStart(3, '0') }, this._fields(data), {
      status: 'submitted',   // submitted|approved|rejected|draft|dispatched|noVehicle|cancelled|completed
      outcome: null,         // 派車判斷結果：withDriver|selfDrive|noVehicle（G76）
      vehicle: null, driver: null,
      approvedAt: null, reviewNote: '',
      dispatchedAt: null,    // 調度完成確認時間（任一最終判斷即算，G79）
      dispatchedBy: '', dispatchNote: '',
      notifiedAt: null,
      log: [],               // 撤回／重送／撤銷等異動紀錄
      createdAt: new Date(),
    });
    this.applications.push(app);
    return app;
  },

  _log(app, action, by, note) { app.log.push({ at: new Date(), action, by: by || app.applicant, note: note || '' }); },

  /* ---- 主管簽核（沿用核准者關係表 DB.approvalMap；駁回保留紀錄不進調度 G74）---- */
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

  /* ---- 撤回與異動（G79）：異動一律＝撤回＋重新申請，不支援就地修改已核准單 ----
     調度完成確認前：可「撤回修改」拿回草稿，改完重新送出（重新走簽核與調度）；
     調度完成確認後：只能「整單撤回」。調度完成確認＝做出任一最終判斷（含無車可派）。 */
  isConfirmed(app) { return app.dispatchedAt != null; },
  canWithdrawToEdit(app) { return ['submitted', 'approved'].includes(app.status) && !this.isConfirmed(app); },
  withdrawToEdit(app, by) {
    if (!this.canWithdrawToEdit(app)) return false;
    this._log(app, '撤回修改', by, `原狀態 ${app.status}`);
    app.status = 'draft'; app.approvedAt = null; app.reviewNote = '';
    return true;
  },
  resubmit(app, data) {
    if (app.status !== 'draft') throw new Error('僅草稿（已撤回修改）可重新送出');
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    Object.assign(app, this._fields(data));
    app.status = 'submitted';
    this._log(app, '修改後重新送出', data.applicant);
    return app;
  },
  canCancel(app) { return ['submitted', 'approved', 'draft', 'dispatched'].includes(app.status); },
  // 整單撤回：佔用的車輛/司機時段立刻釋放（佔用僅以 dispatched 狀態計算 G73）
  cancel(app, by) {
    if (!this.canCancel(app)) return false;
    const held = app.status === 'dispatched';
    this._log(app, '整單撤回', by, held ? `釋放 ${app.vehicle}${app.driver ? '／' + app.driver : ''}` : '');
    app.status = 'cancelled';
    if (held) app.releasedAt = new Date();
    return true;
  },

  /* ---- 共用資源池佔用判斷（G71/G72）----
     與差旅共乘：以「日」為單位，沿用模組 C 自己排班時的佔用口徑（matched/boarded/completed 的整趟日期）；
     一般用車彼此：以實際起訖時段重疊判斷。保修（G60）與請假（G61）同樣適用。 */
  C_HOLD: ['matched', 'boarded', 'completed'],
  _cApps() { return (typeof ModuleC !== 'undefined') ? ModuleC.applications : []; },
  _overlap(a, b) { return a.start < b.end && b.start < a.end; },

  vehicleBusy(vId, app) {
    const dates = this.datesOf(app), sp = this.span(app);
    const m = DB.maintenance.find(x => x.vehicle === vId && dates.some(dt => dt >= x.from && dt <= x.to));
    if (m) return { type: 'maint', text: `保修 ${m.from}~${m.to}（${m.reason}）` };
    const c = this._cApps().find(x => this.C_HOLD.includes(x.status) && x.vehicle === vId
      && ModuleC.tripDates(x).some(dt => dates.includes(dt)));
    if (c) return { type: 'C', ref: c.id, text: `差旅共乘 ${c.id} 佔用（${c.departDate}）` };
    const d = this.applications.find(x => x.id !== app.id && x.status === 'dispatched' && x.vehicle === vId
      && this._overlap(sp, this.span(x)));
    if (d) return { type: 'D', ref: d.id, text: `一般用車 ${d.id} 佔用（${d.startDate} ${d.startTime}~${d.endDate} ${d.endTime}）` };
    return null;
  },
  driverBusy(dId, app) {
    const sp = this.span(app), dates = this.datesOf(app);
    const lv = DB.driverLeaves.find(l => l.driver === dId
      && this._overlap(sp, { start: this.absMin(l.date, l.from), end: this.absMin(l.date, l.to) }));
    if (lv) return { type: 'leave', text: `請假 ${lv.date} ${lv.from}~${lv.to}` };
    const c = this._cApps().find(x => this.C_HOLD.includes(x.status) && x.driver === dId
      && ModuleC.tripDates(x).some(dt => dates.includes(dt)));
    if (c) return { type: 'C', ref: c.id, text: `差旅共乘 ${c.id} 任務（${c.departDate}）` };
    const d = this.applications.find(x => x.id !== app.id && x.status === 'dispatched' && x.driver === dId
      && this._overlap(sp, this.span(x)));
    if (d) return { type: 'D', ref: d.id, text: `一般用車 ${d.id} 任務（${d.startDate} ${d.startTime}~${d.endDate} ${d.endTime}）` };
    return null;
  },

  /* 候選資源（商務池）與各自佔用原因；座位數不足者列為不可用（車型由調度人工判斷 G77）*/
  resources(app) {
    const vehicles = DB.vehicles.filter(v => v.pool === 'BIZ').map(v => ({
      v, busy: v.seats < app.pax ? { type: 'seats', text: `座位 ${v.seats} < ${app.pax} 人` } : this.vehicleBusy(v.id, app),
    }));
    const drivers = DB.drivers.filter(d => d.pool === 'BIZ').map(d => ({ d, busy: this.driverBusy(d.id, app) }));
    return { vehicles, drivers };
  },

  /* 車輛狀態（矩陣列 G76）：withDriver＝有車有司機｜vehicleOnly＝有車沒司機｜none＝沒車 */
  resourceState(app) {
    const r = this.resources(app);
    const freeV = r.vehicles.filter(x => !x.busy).length, freeD = r.drivers.filter(x => !x.busy).length;
    return freeV === 0 ? 'none' : (freeD === 0 ? 'vehicleOnly' : 'withDriver');
  },
  /* 派車判斷矩陣（G76）：車輛狀態 × 是否自駕 → 結果；不進候補 */
  matrixOutcome(state, selfDrive) {
    if (state === 'withDriver') return 'withDriver';
    if (state === 'vehicleOnly') return selfDrive ? 'selfDrive' : 'noVehicle';
    return 'noVehicle';
  },

  /* 依調度選擇判定結果（不改資料）。sel：{ vehicle, driver, noVehicle }
     noVehicle＝調度人工判定無車可派（如車型不符、危險品考量 G77/G78），任何時候皆可。 */
  decide(app, sel) {
    sel = sel || {};
    if (sel.noVehicle) return { outcome: 'noVehicle' };
    if (!sel.vehicle) return { error: '請選擇車輛，或判定無車可派' };
    const r = this.resources(app);
    const vr = r.vehicles.find(x => x.v.id === sel.vehicle);
    if (!vr) return { error: `車輛 ${sel.vehicle} 不在商務資源池` };
    if (vr.busy) return { error: `車輛 ${sel.vehicle} 不可用：${vr.busy.text}（先佔先贏 G72）` };
    const freeDrivers = r.drivers.filter(x => !x.busy);
    if (sel.driver) {
      const dr = r.drivers.find(x => x.d.id === sel.driver);
      if (!dr) return { error: `司機 ${sel.driver} 不在商務資源池` };
      if (dr.busy) return { error: `司機 ${dr.d.name} 不可用：${dr.busy.text}（先佔先贏 G72）` };
      return { outcome: 'withDriver', vehicle: sel.vehicle, driver: sel.driver };
    }
    if (freeDrivers.length) return { error: '尚有可派司機：依判斷矩陣「有車有司機」應派車＋派司機（G76）' };
    const outcome = this.matrixOutcome('vehicleOnly', app.selfDrive);
    return outcome === 'selfDrive' ? { outcome, vehicle: sel.vehicle, driver: null } : { outcome };
  },

  /* 調度完成確認（G76/G79）：先簽核才可調度；做出任一最終判斷即寄送結果通知（G80）
     無車可派不佔用任何資源（資源立即釋放、不進候補）。 */
  dispatch(app, sel, by, note) {
    if (app.status !== 'approved') return { ok: false, error: '僅主管簽核通過（已核准）的申請可調度（G74）' };
    const r = this.decide(app, sel);
    if (r.error) return { ok: false, error: r.error };
    app.outcome = r.outcome;
    if (r.outcome === 'noVehicle') {
      app.status = 'noVehicle'; app.vehicle = null; app.driver = null;
    } else {
      app.status = 'dispatched'; app.vehicle = r.vehicle; app.driver = r.driver || null;
    }
    app.dispatchedAt = new Date(); app.dispatchedBy = by || '調度室'; app.dispatchNote = note || '';
    this.sendResultMail(app);
    return { ok: true, outcome: r.outcome };
  },

  /* 行程完成（dispatched → completed）：司機回報或調度確認；完成後即不再佔用資源 */
  completeTrip(app, by) {
    if (app.status !== 'dispatched') return false;
    app.status = 'completed'; app.completedAt = new Date(); app.completedBy = by || '調度室';
    return true;
  },

  /* 寄信服務（雛形：空 function，實際寄信待實作 G80）——沿用既有 email 通知路由
     （核准者關係表基礎設施），通知申請人派車結果；雛形僅留存寄送紀錄供畫面顯示。 */
  OUTCOME_TEXT: { withDriver: '派車＋派司機', selfDrive: '派車（使用者自行駕駛）', noVehicle: '無車可派' },
  sendResultMail(app) {
    /* TODO: 串接寄信服務。收件人＝申請人（依 DB.approvalMap 既有路由）；內容含單號/用車時段/派車結果/車輛/司機 */
    const rec = { app: app.id, to: app.applicant, outcome: app.outcome, text: this.OUTCOME_TEXT[app.outcome], at: new Date() };
    this.mailLog.push(rec);
    app.notifiedAt = rec.at;
    return rec;
  },

  /* 供差旅共乘批次媒合讀取：一般用車目前佔用（以日為單位），元素為 "id|yyyy-mm-dd" */
  dayOccupancy() {
    const veh = new Map(), drv = new Map();
    this.applications.filter(a => a.status === 'dispatched').forEach(a => this.datesOf(a).forEach(dt => {
      if (a.vehicle) veh.set(a.vehicle + '|' + dt, a.id);
      if (a.driver) drv.set(a.driver + '|' + dt, a.id);
    }));
    return { veh, drv };
  },
};
