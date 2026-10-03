/* ============================================================
   signoff.js — 共用：運輸主管簽審（派車結果覆核）
   B 院區物品轉運／C 差旅共乘／D 一般用車申請 共用（A 巡迴物品轉運不經運輸主管簽審，排班即生效）。
   調度做出的派車／排班結果一律送運輸主管簽審，「簽審通過才生效」：
     · 待簽審期間仍保留車輛／司機（避免被重複指派），但不出現在司機任務單、
       不可交貨／上車／完成行程，一般用車也不寄出派車結果通知；
     · 主管同意 → 生效；不同意（意見必填）→ 退回調度重新處理（各模組自行把單子放回待處理）。
   本檔只處理簽審紀錄本身（rec.sign 與 rec.signLog），不碰各模組的業務欄位。
   ============================================================ */

const Signoff = {
  STATUS: { pending: ['待運輸主管簽審', 'b-amber'], approved: ['主管已同意', 'b-green'], rejected: ['主管已退回', 'b-red'] },
  SUPERVISOR: '運輸主管',

  _log(rec, action, by, note) {
    (rec.signLog = rec.signLog || []).push({ at: new Date(), action, by: by || this.SUPERVISOR, note: note || '' });
  },

  /* 調度產生（或異動）派車結果 → 送簽審；同一單可多輪（退回後重新派車再送）*/
  mark(rec, summary, by) {
    const round = (rec.signLog || []).filter(l => l.action === '送簽審').length + 1;
    rec.sign = { status: 'pending', summary: summary || '', submittedBy: by || '調度室', submittedAt: new Date(),
      round, decidedBy: '', decidedAt: null, note: '' };
    this._log(rec, '送簽審', by || '調度室', summary);
    return rec.sign;
  },

  /* 派車結果被調度撤銷（例如移出班次）：待簽審的紀錄一併撤回，歷程保留 */
  release(rec, reason, by) {
    if (!rec.sign) return;
    if (rec.sign.status === 'pending') this._log(rec, '撤回簽審', by || '調度室', reason);
    else if (rec.sign.status === 'approved') this._log(rec, '派車結果撤銷', by || '調度室', reason);
    rec.sign = null;
  },

  isPending(rec) { return !!rec.sign && rec.sign.status === 'pending'; },
  isApproved(rec) { return !!rec.sign && rec.sign.status === 'approved'; },
  // 派車結果是否已生效（簽審通過）
  effective(rec) { return this.isApproved(rec); },

  /* 主管簽審：agree=true 同意；false 不同意（意見必填）。只改簽審紀錄，退回後續由模組處理 */
  decide(rec, agree, by, note) {
    if (!this.isPending(rec)) return { ok: false, error: '此單目前沒有待簽審的派車結果' };
    note = (note || '').trim();
    if (!agree && !note) return { ok: false, error: '退回時「簽審意見」為必填' };
    Object.assign(rec.sign, { status: agree ? 'approved' : 'rejected', decidedBy: by || this.SUPERVISOR, decidedAt: new Date(), note });
    this._log(rec, agree ? '主管同意' : '主管退回', by, note);
    return { ok: true };
  },

  /* 簽審清單用：曾送過簽審的單（含目前待簽審、已同意、已退回）*/
  inScope(rec) { return !!rec.sign || (rec.signLog || []).length > 0; },
  // 顯示用狀態：目前簽審狀態；已退回且調度已撤回者顯示「已退回」
  stateOf(rec) {
    if (rec.sign) return rec.sign.status;
    const dec = (rec.signLog || []).filter(l => ['主管同意', '主管退回'].includes(l.action)).pop();
    return dec ? (dec.action === '主管同意' ? 'approved' : 'rejected') : null;
  },
};
