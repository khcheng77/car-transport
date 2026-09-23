/* ============================================================
   moduleE.js — 模組 E：例行用車（第五模組，長期撥用）
   PLAN.md Phase 8 / Guardrails G90–G99；規格 docs/例行用車模組_v1.html
   申請 → 主管簽核 → 調度人工確認資源 → 派車（借用中）
   → 換車/換司機（指派區間歷史）→ 展延（重新簽核）／歸還（免簽核、立即釋放）
   與差旅共乘（C）、一般用車（D）共用商務車輛/司機池，先佔先贏（G91）
   ============================================================ */

const ModuleE = {
  applications: [],
  mailLog: [],   // 通知紀錄：派車結果＋換車換司機（雛形：寄信服務為空 function G99）
  seq: 1,
  approveSeq: 1,

  /* ---- 日期工具：借用以「日」為單位；UTC 純算術避免時區影響 ---- */
  _t(d) { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); },
  _s(t) { const dt = new Date(t); return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`; },
  addDays(d, n) { return this._s(this._t(d) + n * 86400000); },
  datesBetween(a, b) {
    const out = [];
    if (!a || !b || b < a) return out;
    for (let t = this._t(a), e = this._t(b); t <= e; t += 86400000) out.push(this._s(t));
    return out;
  },

  /* ---- 申請單欄位驗證（G92）：比一般用車精簡，不含人數與隨行貨物 ---- */
  validate(data) {
    const errs = [];
    if (!data.applicant) errs.push('請填寫申請人');
    if (!data.purpose || !String(data.purpose).trim()) errs.push('請填寫借用單位／用途說明');
    if (!data.startDate || !data.endDate) errs.push('請填寫借用起日與預計歸還日（不可只填起日）');
    else if (data.endDate < data.startDate) errs.push('預計歸還日不可早於借用起日');
    if (typeof data.needDriver !== 'boolean') errs.push('請選擇是否需要配司機');
    return errs;
  },
  _fields(data) {
    return {
      applicant: data.applicant, dept: data.dept || '', ext: data.ext || '',
      purpose: String(data.purpose).trim(),       // 借用單位／用途說明（車型特殊需求亦寫於此，不設車型欄位 G92）
      startDate: data.startDate,                  // 借用起日
      endDate: data.endDate,                      // 預計歸還日（含當日；展延核准後更新）
      needDriver: data.needDriver,                // 是否需要配司機
    };
  },

  createApp(data) {
    const errs = this.validate(data);
    if (errs.length) throw new Error(errs.join('；'));
    const app = Object.assign({ id: 'RT' + String(this.seq++).padStart(3, '0') }, this._fields(data), {
      status: 'submitted',   // submitted|approved|rejected|draft|active|noVehicle|cancelled|returned
      outcome: null,         // withDriver|noDriver|noVehicle（G94）
      vehicle: null, driver: null,   // 目前指派（＝最後一筆指派區間）
      segments: [],          // 指派區間歷史：{ vehicle, driver, from, to(不含，null＝至借用結束), reason, at, by }（G95）
      pendingExt: null,      // 待簽核展延：{ from, to, reason, by, requestedAt, status }
      extensions: [],        // 展延紀錄（approved/rejected/withdrawn）
      returnedOn: null,      // 歸還日（自該日起釋放 G97）
      approvedAt: null, reviewNote: '',
      dispatchedAt: null, dispatchedBy: '', dispatchNote: '', notifiedAt: null,
      log: [],
      createdAt: new Date(),
    });
    this.applications.push(app);
    return app;
  },
  _log(app, action, by, note) { app.log.push({ at: new Date(), action, by: by || app.applicant, note: note || '' }); },
  _drvName(id) { const d = DB.drivers.find(x => x.id === id); return d ? d.name : (id || '無'); },

  /* ---- 主管簽核：沿用一般用車同一套（核准者關係表，不另加簽 G93）---- */
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

  /* ---- 調度確認前的撤回（同一般用車 G93）：撤回修改回草稿重送（重新簽核）或整單撤回；
     調度確認後改以「歸還／提前歸還」結束借用（G97）---- */
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
  canCancel(app) { return ['submitted', 'approved', 'draft'].includes(app.status); },
  cancel(app, by) {
    if (!this.canCancel(app)) return false;
    this._log(app, '整單撤回', by);
    app.status = 'cancelled';
    return true;
  },

  /* ---- 佔用區間（G91/G95）：借用中與已歸還的借用單，依指派區間歷史逐段佔用 ---- */
  HOLD: ['active', 'returned'],
  lastDay(app) { return app.returnedOn ? this.addDays(app.returnedOn, -1) : app.endDate; },  // 最後佔用日
  segEnd(app, seg) {
    const last = this.lastDay(app);
    const end = seg.to ? this.addDays(seg.to, -1) : last;
    return end < last ? end : last;
  },
  segDates(app, seg) { return this.datesBetween(seg.from, this.segEnd(app, seg)); },
  currentSeg(app) { return app.segments[app.segments.length - 1] || null; },
  /* 借用單在 dates 內佔用 kind（vehicle/driver）＝id 的第一筆 { app, seg } */
  holder(kind, id, dates, excludeId) {
    const set = new Set(dates);
    for (const a of this.applications) {
      if (a.id === excludeId || !this.HOLD.includes(a.status)) continue;
      for (const s of a.segments) if (s[kind] === id && this.segDates(a, s).some(d => set.has(d))) return { app: a, seg: s };
    }
    return null;
  },
  /* 供差旅共乘批次媒合／人工改派讀取（以日為單位），元素為 "id|yyyy-mm-dd" → 借用單號 */
  dayOccupancy() {
    const veh = new Map(), drv = new Map();
    this.applications.filter(a => this.HOLD.includes(a.status)).forEach(a => a.segments.forEach(s =>
      this.segDates(a, s).forEach(d => {
        if (s.vehicle) veh.set(s.vehicle + '|' + d, a.id);
        if (s.driver) drv.set(s.driver + '|' + d, a.id);
      })));
    return { veh, drv };
  },

  /* 他模組／其他借用單的硬佔用（先佔先贏 G91）：差旅共乘、一般用車、例行用車 */
  _conflict(kind, id, dates, excludeId) {
    const set = new Set(dates);
    if (typeof ModuleC !== 'undefined') {
      const c = ModuleC.applications.find(x => ['matched', 'boarded', 'completed'].includes(x.status) && x[kind] === id
        && ModuleC.tripDates(x).some(d => set.has(d)));
      if (c) return { type: 'C', ref: c.id, text: `差旅共乘 ${c.id} 佔用（${c.departDate}）` };
    }
    if (typeof ModuleD !== 'undefined') {
      const d = ModuleD.applications.find(x => x.status === 'dispatched' && x[kind] === id
        && ModuleD.datesOf(x).some(dt => set.has(dt)));
      if (d) return { type: 'D', ref: d.id, text: `一般用車 ${d.id} 佔用（${d.startDate}${d.endDate !== d.startDate ? '~' + d.endDate : ''}）` };
    }
    const e = this.holder(kind, id, dates, excludeId);
    if (e) return { type: 'E', ref: e.app.id, text: `例行用車 ${e.app.id} 借用中（${e.seg.from}~${this.segEnd(e.app, e.seg)}）` };
    return null;
  },

  /* 資源檢核（G98）：自 from 起至 to（含）。他人佔用為硬衝突；
     保修／請假若落在起日（交車當天）不可派，借用期間中途者僅提示——屆時由調度換車／換司機（規格 §7）。 */
  check(kind, id, from, to, excludeId) {
    const hard = this._conflict(kind, id, this.datesBetween(from, to), excludeId);
    if (hard) return { busy: hard, warn: null };
    if (kind === 'vehicle') {
      const ms = DB.maintenance.filter(m => m.vehicle === id && m.to >= from && m.from <= to);
      const atStart = ms.find(m => m.from <= from && m.to >= from);
      if (atStart) return { busy: { type: 'maint', text: `${from} 保修中（${atStart.from}~${atStart.to}）` }, warn: null };
      return { busy: null, warn: ms.length ? ms.map(m => `期間內保修 ${m.from}~${m.to}，屆時需換車`).join('；') : null };
    }
    const ls = DB.driverLeaves.filter(l => l.driver === id && l.date >= from && l.date <= to);
    const atStart = ls.find(l => l.date === from);
    if (atStart) return { busy: { type: 'leave', text: `${from} 請假（${atStart.from}~${atStart.to}）` }, warn: null };
    return { busy: null, warn: ls.length ? ls.map(l => `期間內請假 ${l.date} ${l.from}~${l.to}，屆時需換司機`).join('；') : null };
  },
  resources(app, from, to) {
    from = from || app.startDate; to = to || this.lastDay(app);
    return {
      vehicles: DB.vehicles.filter(v => v.pool === 'BIZ').map(v => Object.assign({ v }, this.check('vehicle', v.id, from, to, app.id))),
      drivers: DB.drivers.filter(d => d.pool === 'BIZ').map(d => Object.assign({ d }, this.check('driver', d.id, from, to, app.id))),
    };
  },

  /* ---- 派車判斷矩陣（G94）：沿用一般用車，欄位為「是否需要配司機」；不進候補 ---- */
  resourceState(app) {
    const r = this.resources(app);
    const freeV = r.vehicles.filter(x => !x.busy).length, freeD = r.drivers.filter(x => !x.busy).length;
    return freeV === 0 ? 'none' : (freeD === 0 ? 'vehicleOnly' : 'withDriver');
  },
  matrixOutcome(state, needDriver) {
    if (state === 'withDriver') return 'withDriver';
    if (state === 'vehicleOnly') return needDriver ? 'noVehicle' : 'noDriver';
    return 'noVehicle';
  },
  decide(app, sel) {
    sel = sel || {};
    if (sel.noVehicle) return { outcome: 'noVehicle' };
    if (!sel.vehicle) return { error: '請選擇車輛，或判定無車可派' };
    const r = this.resources(app);
    const vr = r.vehicles.find(x => x.v.id === sel.vehicle);
    if (!vr) return { error: `車輛 ${sel.vehicle} 不在商務資源池` };
    if (vr.busy) return { error: `車輛 ${sel.vehicle} 不可用：${vr.busy.text}（先佔先贏 G91）` };
    if (sel.driver) {
      const dr = r.drivers.find(x => x.d.id === sel.driver);
      if (!dr) return { error: `司機 ${sel.driver} 不在商務資源池` };
      if (dr.busy) return { error: `司機 ${dr.d.name} 不可用：${dr.busy.text}（先佔先贏 G91）` };
      return { outcome: 'withDriver', vehicle: sel.vehicle, driver: sel.driver };
    }
    if (r.drivers.some(x => !x.busy)) return { error: '尚有可派司機：依判斷矩陣「有車有司機」應派車＋派司機（G94）' };
    const outcome = this.matrixOutcome('vehicleOnly', app.needDriver);
    return outcome === 'noDriver' ? { outcome, vehicle: sel.vehicle, driver: null } : { outcome };
  },
  /* 調度完成確認：派車即建立第一筆指派區間（原始指派），並寄送派車結果通知（G99）*/
  dispatch(app, sel, by, note) {
    if (app.status !== 'approved') return { ok: false, error: '僅主管簽核通過（已核准）的借用單可調度（G93）' };
    const r = this.decide(app, sel);
    if (r.error) return { ok: false, error: r.error };
    const at = new Date();
    app.outcome = r.outcome;
    if (r.outcome === 'noVehicle') {
      app.status = 'noVehicle'; app.vehicle = null; app.driver = null;
    } else {
      app.status = 'active'; app.vehicle = r.vehicle; app.driver = r.driver || null;
      app.segments = [{ vehicle: r.vehicle, driver: app.driver, from: app.startDate, to: null, reason: '原始指派', at, by: by || '調度室' }];
    }
    app.dispatchedAt = at; app.dispatchedBy = by || '調度室'; app.dispatchNote = note || '';
    this.sendMail(app, 'result');
    return { ok: true, outcome: r.outcome };
  },

  /* ---- 換車／換司機（G95）：僅調度發起；新增指派區間、不覆蓋舊資料；
     生效日起換新資源、前一日止舊資源（同一時點瞬間切換，不設重疊）；並通知借用單位 ----
     opts：{ vehicle, driver（undefined＝維持，null＝不派司機）, effective, reason, by } */
  reassign(app, opts) {
    if (app.status !== 'active') return { ok: false, error: '僅借用中的借用單可換車／換司機' };
    const cur = this.currentSeg(app), last = this.lastDay(app), eff = opts.effective;
    if (!eff || eff < cur.from || eff > last) return { ok: false, error: `生效日須介於 ${cur.from} ~ ${last}` };
    const vehicle = opts.vehicle === undefined ? cur.vehicle : opts.vehicle;
    const driver = opts.driver === undefined ? cur.driver : (opts.driver || null);
    if (!vehicle) return { ok: false, error: '車輛不可為空' };
    if (vehicle === cur.vehicle && driver === cur.driver) return { ok: false, error: '車輛與司機皆未變更' };
    if (app.needDriver && !driver) return { ok: false, error: '此借用單需要配司機，不可改為不派司機（G94）' };
    if (!opts.reason) return { ok: false, error: '請填寫換車／換司機原因' };
    if (vehicle !== cur.vehicle) {
      const c = this.check('vehicle', vehicle, eff, last, app.id);
      if (c.busy) return { ok: false, error: `車輛 ${vehicle} 不可用：${c.busy.text}（先佔先贏 G91）` };
    }
    if (driver && driver !== cur.driver) {
      const c = this.check('driver', driver, eff, last, app.id);
      if (c.busy) return { ok: false, error: `司機 ${this._drvName(driver)} 不可用：${c.busy.text}（先佔先贏 G91）` };
    }
    const by = opts.by || '調度室';
    cur.to = eff;
    const seg = { vehicle, driver, from: eff, to: null, reason: opts.reason, at: new Date(), by };
    app.segments.push(seg);
    app.vehicle = vehicle; app.driver = driver;
    const what = [vehicle !== cur.vehicle ? `車輛 ${cur.vehicle}→${vehicle}` : '',
      driver !== cur.driver ? `司機 ${this._drvName(cur.driver)}→${this._drvName(driver)}` : ''].filter(Boolean).join('、');
    this._log(app, '換車／換司機', by, `${eff} 起 ${what}（${opts.reason}）`);
    this.sendMail(app, 'reassign', `${eff} 起 ${what}（原因：${opts.reason}）`);
    return { ok: true, seg };
  },

  /* ---- 展延（G96）：延長預計歸還日，需重新簽核；展延期間目前的車輛／司機須無他人佔用 ---- */
  extensionConflict(app, newEnd) {
    const cur = this.currentSeg(app);
    const dates = this.datesBetween(this.addDays(app.endDate, 1), newEnd);
    const v = this._conflict('vehicle', cur.vehicle, dates, app.id);
    if (v) return `車輛 ${cur.vehicle} 於展延期間已被佔用：${v.text}`;
    if (cur.driver) {
      const d = this._conflict('driver', cur.driver, dates, app.id);
      if (d) return `司機 ${this._drvName(cur.driver)} 於展延期間已被佔用：${d.text}`;
    }
    return null;
  },
  requestExtension(app, newEnd, reason, by) {
    if (app.status !== 'active') return { ok: false, error: '僅借用中的借用單可申請展延' };
    if (app.pendingExt) return { ok: false, error: '已有一筆展延待主管簽核' };
    if (!newEnd || newEnd <= app.endDate) return { ok: false, error: `新的預計歸還日須晚於目前的 ${app.endDate}` };
    if (!reason) return { ok: false, error: '請填寫展延原因' };
    const c = this.extensionConflict(app, newEnd);
    if (c) return { ok: false, error: `${c}（先佔先贏）；請洽調度換車或縮短展延` };
    app.pendingExt = { from: app.endDate, to: newEnd, reason, by: by || app.applicant, requestedAt: new Date(), status: 'pending' };
    this._log(app, '申請展延', by, `${app.endDate} → ${newEnd}（${reason}）`);
    return { ok: true };
  },
  approveExtension(app, note) {
    const x = app.pendingExt;
    if (!x || app.status !== 'active') return { ok: false, error: '無待簽核的展延' };
    const c = this.extensionConflict(app, x.to); // 核准當下再確認一次（期間內他人可能已先佔）
    if (c) return { ok: false, error: `${c}，無法核准展延（先佔先贏）` };
    app.endDate = x.to;
    Object.assign(x, { status: 'approved', note: note || '', decidedAt: new Date() });
    app.extensions.push(x); app.pendingExt = null;
    this._log(app, '展延核准', this.approverOf(app), `預計歸還日改為 ${x.to}`);
    return { ok: true };
  },
  rejectExtension(app, note) {
    const x = app.pendingExt;
    if (!x) return { ok: false, error: '無待簽核的展延' };
    Object.assign(x, { status: 'rejected', note: note || '', decidedAt: new Date() });
    app.extensions.push(x); app.pendingExt = null;
    this._log(app, '展延駁回', this.approverOf(app), note || '');
    return { ok: true };
  },

  /* ---- 歸還／提前歸還（G97）：不需簽核，使用者或調度可直接觸發；自歸還日起立即釋放 ---- */
  returnLoan(app, date, by) {
    if (app.status !== 'active') return { ok: false, error: '僅借用中的借用單可歸還' };
    if (!date || date < app.startDate || date > app.endDate) return { ok: false, error: `歸還日須介於 ${app.startDate} ~ ${app.endDate}` };
    const early = date < app.endDate;
    app.returnedOn = date; app.status = 'returned'; app.returnedBy = by || app.applicant; app.earlyReturn = early;
    if (app.pendingExt) { app.pendingExt.status = 'withdrawn'; app.extensions.push(app.pendingExt); app.pendingExt = null; }
    this._log(app, early ? '提前歸還' : '歸還', by, `${date} 起釋放 ${app.vehicle}${app.driver ? '／' + this._drvName(app.driver) : ''}`);
    return { ok: true, early };
  },

  /* 寄信服務（雛形：空 function，實際寄信待實作 G99）——沿用既有 email 通知路由（核准者關係表基礎設施）；
     觸發點：派車結果、換車／換司機。雛形僅留存寄送紀錄供畫面顯示。 */
  OUTCOME_TEXT: { withDriver: '派車＋派司機', noDriver: '派車（借用單位自行安排駕駛）', noVehicle: '無車可派' },
  sendMail(app, kind, detail) {
    /* TODO: 串接寄信服務。收件人＝申請人（借用單位）；依 DB.approvalMap 既有路由 */
    const text = kind === 'result' ? `派車結果：${this.OUTCOME_TEXT[app.outcome]}` : `換車／換司機：${detail}`;
    const rec = { app: app.id, to: app.applicant, kind, text, at: new Date() };
    this.mailLog.push(rec);
    app.notifiedAt = rec.at;
    return rec;
  },
  mailsOf(app) { return this.mailLog.filter(m => m.app === app.id); },
};
