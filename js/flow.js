/* ============================================================
   flow.js — 共用：申請單狀態（四模組對齊，G122）
   A 巡迴財物轉運／B 院區財物轉運／C 差旅共乘／D 一般用車申請 一律只顯示下列狀態：
     申請中 → 待二級審 →（退回修編）→ 待調度 →（無車退回）→ 調度中 → 調度主管審 → 待出車 → 已出車 → 已回登
   沒有的關卡就跳過：A 不經二級審與調度主管（送出即排班：成功＝待出車、未排入＝待調度）；
   D 一單一派車單（派車判斷即產生並送調度主管審，無「調度中」，G126）。
   各模組內部 status 維持實作用值，本檔依 status＋派車單＋簽審＋時間＋實登推導出顯示狀態：
     · 調度中：已併入派車單、派車單尚未送審；調度主管審：簽審待審；待出車：簽審通過（A 排入班次）；
     · 已出車：系統時間到達收貨／出發時間（Flow.now 可覆寫供測試）；已回登：車輛異動實登已登錄里程。
     · 已刪除：申請人取消申請（C 差旅共乘，派車單送審前，G133；G140 顯示名稱由「已取消」改為「已刪除」）。
   ============================================================ */

const Flow = {
  STATES: [
    ['draft', '申請中', 'b-gray'],
    ['review', '待二級審', 'b-gray'],
    ['revise', '退回修編', 'b-red'],
    ['todo', '待調度', 'b-amber'],
    ['noCar', '無車退回', 'b-red'],
    ['dispatching', '調度中', 'b-navy'],
    ['signing', '調度主管審', 'b-amber'],
    ['ready', '待出車', 'b-navy'],
    ['departed', '已出車', 'b-green'],
    ['logged', '已回登', 'b-green'],
    ['cancelled', '已刪除', 'b-gray'],   // 申請人撤單（G133／G140；G147 起四模組皆可，期限＝車輛出發日前一天）
  ],
  _now: null,                          // 測試／示範可覆寫「系統時間」
  now() { return this._now ? new Date(this._now) : new Date(); },
  todayStr() { const d = this.now(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; },
  /* 撤單（G147，四模組共用規則）：車輛出發日前一天（含）以前皆可撤單——系統日期早於出發日期；
     已派車、已送簽審或簽審通過者亦可撤（模組自派車單移出、釋放車輛與司機）；已刪除、無車退回、已實登者不可撤。 */
  CANCEL_CLOSED: ['cancelled', 'noCar', 'noVehicle'],
  canCancel(rec, departDate) { return !this.CANCEL_CLOSED.includes(rec.status) && !rec.usage && (!departDate || this.todayStr() < departDate); },
  cancelError(rec, departDate) {
    if (this.CANCEL_CLOSED.includes(rec.status)) return '此申請單已結案，不可撤單';
    if (rec.usage) return '已完成車輛異動實登，不可撤單';
    return `已過撤單期限：車輛出發日 ${departDate} 前一天（含）以前才可撤單`;
  },
  _cancelled(rec, reason, by) {
    Object.assign(rec, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: by || rec.applicant, cancelReason: reason, approvedAt: null });
    (rec.changeLog = rec.changeLog || []).push({ at: rec.cancelledAt, action: '撤單', reason, by: rec.cancelledBy });
  },
  /* 調度室退回使用者修改（G147，B／C／D 派車調度共用）：M.canReturnEdit／M.returnToEdit 由模組提供；
     退回原因必填 → 退回修編（returnedBy＝'dispatch'），申請人修改後重新送出需再經單位主管審核。批次：全部可退才執行。 */
  returnEditBatch(M, list, note, by) {
    note = (note || '').trim();
    if (!list.length) return { ok: false, error: '請先勾選要退回的申請單' };
    if (!note) return { ok: false, error: '退回修改時「退回原因」為必填' };
    const bad = list.find(r => !M.canReturnEdit(r));
    if (bad) return { ok: false, error: `${bad.id} 目前狀態不可退回修改（僅待調度，或所在派車單尚未送審）` };
    list.forEach(r => M.returnToEdit(r, note, by));
    return { ok: true, count: list.length };
  },
  _returned(rec, note, by) {
    Object.assign(rec, { status: 'rejected', approvedAt: null, reviewNote: note, returnedBy: 'dispatch', returnedByName: by || '調度室', returnedAt: new Date() });
  },
  label(k) { const s = this.STATES.find(x => x[0] === k); return s ? s[1] : k; },
  color(k) { const s = this.STATES.find(x => x[0] === k); return s ? s[2] : 'b-gray'; },

  // 由單號前綴判斷模組：car（財物運輸單號，G138；舊 LA）＝A、LB＝B、BZ＝C、GU＝D
  moduleOf(rec) {
    const p = String(rec.id || '').slice(0, 2);
    return { ca: typeof ModuleA !== 'undefined' && ModuleA, LA: typeof ModuleA !== 'undefined' && ModuleA, LB: typeof ModuleB !== 'undefined' && ModuleB,
      BZ: typeof ModuleC !== 'undefined' && ModuleC, GU: typeof ModuleD !== 'undefined' && ModuleD }[p] || null;
  },
  // "yyyy-mm-dd" + "HH:MM" → Date（本地時間）
  at(date, time) {
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number), [hh, mm] = (time || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0);
  },
  departed(rec, M) {
    M = M || this.moduleOf(rec);
    const t = M && M.departAt ? M.departAt(rec) : null;
    return !!t && this.now() >= t;
  },

  /* 推導顯示狀態鍵 */
  of(rec) {
    const s = rec.status, M = this.moduleOf(rec);
    if (s === 'draft') return 'draft';
    if (s === 'submitted') return 'review';
    if (s === 'rejected') return 'revise';
    if (s === 'noCar' || s === 'noVehicle') return 'noCar';
    if (s === 'cancelled') return 'cancelled';
    if (['approved', 'unscheduled'].includes(s)) return 'todo';
    // 已派車（A matched／B loaded／C matched／D dispatched）
    const signed = !M || M.signed !== false;
    if (signed) {
      const order = M && M.dispatchOf ? M.dispatchOf(rec) : null;
      if (Signoff.isPending(rec)) return 'signing';
      if (!Signoff.effective(rec)) return order || (M && M.dispatchOf) ? 'dispatching' : 'signing';
    }
    if (rec.usage) return 'logged';
    return this.departed(rec, M) ? 'departed' : 'ready';
  },
  badge(rec) { const k = this.of(rec); return `<span class="badge ${this.color(k)}">${this.label(k)}</span>`; },
};
