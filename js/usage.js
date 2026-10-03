/* ============================================================
   usage.js — 共用：車輛使用實登
   四模組（A 巡迴物品轉運／B 院區物品轉運／C 差旅共乘／D 一般用車申請）共用。
   派車結果生效後（B/C/D 經運輸主管簽審通過；A 不經簽審，排入班次即生效），由業務登打車輛實際使用狀況：
     · 實際使用的「車種類型、車號、駕駛人1、駕駛人2（選填）」；
     · 起始里程、結束里程（結束 ≥ 起始，行駛里程＝結束－起始）。
   實登可修改，每次儲存都留歷程（rec.usageLog），不覆蓋前一次紀錄。
   本檔只處理實登紀錄本身（rec.usage），派車規劃值由各模組的 usagePlan() 提供。
   ============================================================ */

const Usage = {
  STATUS: { todo: ['待實登', 'b-amber'], done: ['已實登', 'b-green'] },
  SELF: 'SELF',   // 駕駛人代碼：使用者自駕（一般用車）

  // 車種類型（依資源池；A/B 物流池、C/D 商務池）
  types(pool) {
    return [...new Set(DB.vehicles.filter(v => v.pool === pool).map(v => v.type))];
  },
  vehiclesOf(pool, type) {
    return DB.vehicles.filter(v => v.pool === pool && (!type || v.type === type));
  },
  driversOf(pool) { return DB.drivers.filter(d => d.pool === pool); },

  // 派車結果已生效才可實登；已實登者即使之後派車結果異動仍保留紀錄
  // eff：模組自行判定的「已生效」（巡迴物品轉運不經簽審，排入班次即生效）；未給則以運輸主管簽審通過為準
  eligible(rec, eff) { return eff != null ? !!eff : Signoff.effective(rec); },
  inScope(rec, eff) { return this.eligible(rec, eff) || !!rec.usage; },
  stateOf(rec) { return rec.usage ? 'done' : 'todo'; },

  /* 儲存實登：data = { vehicleType, vehicle, driver1, driver2, startKm, endKm }
     opts.pool＝資源池；opts.allowSelf＝駕駛人可選「使用者自駕」 */
  save(rec, data, by, opts) {
    opts = opts || {};
    if (!rec.usage && !this.eligible(rec, opts.effective)) return { ok: false, error: '派車結果尚未生效，不可實登' };
    const d = Object.assign({}, data);
    if (!d.vehicleType) return { ok: false, error: '請選擇「車種類型」' };
    if (!d.vehicle) return { ok: false, error: '請選擇「車號」' };
    const v = DB.vehicles.find(x => x.id === d.vehicle);
    if (!v || (opts.pool && v.pool !== opts.pool)) return { ok: false, error: '車號不在本模組的資源池' };
    if (v.type !== d.vehicleType) return { ok: false, error: '車號與車種類型不符' };
    if (!d.driver1) return { ok: false, error: '請選擇「駕駛人1」' };
    const drvOk = id => (id === this.SELF && opts.allowSelf) || DB.drivers.some(x => x.id === id && (!opts.pool || x.pool === opts.pool));
    if (!drvOk(d.driver1)) return { ok: false, error: '「駕駛人1」不在本模組的駕駛名單' };
    if (d.driver2) {
      if (d.driver2 === this.SELF || !drvOk(d.driver2)) return { ok: false, error: '「駕駛人2」不在本模組的駕駛名單' };
      if (d.driver2 === d.driver1) return { ok: false, error: '駕駛人1 與駕駛人2 不可為同一人' };
    }
    const num = x => (x === '' || x == null) ? NaN : Number(x);
    const s = num(d.startKm), e = num(d.endKm);
    if (!Number.isFinite(s) || s < 0) return { ok: false, error: '「起始里程」須為 0 以上的數字' };
    if (!Number.isFinite(e) || e < 0) return { ok: false, error: '「結束里程」須為 0 以上的數字' };
    if (e < s) return { ok: false, error: '「結束里程」不可小於「起始里程」' };
    const first = !rec.usage;
    rec.usage = { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: d.driver2 || '',
      startKm: s, endKm: e, distance: Math.round((e - s) * 10) / 10, by: by || '調度室', at: new Date() };
    (rec.usageLog = rec.usageLog || []).push({ at: rec.usage.at, action: first ? '實登' : '修改實登', by: rec.usage.by,
      snapshot: Object.assign({}, rec.usage) });
    return { ok: true, usage: rec.usage };
  },

  // 實際與派車規劃不同的項目（提示用）：plan = { vehicle, drivers[] }
  diffs(rec, plan) {
    const u = rec.usage;
    if (!u || !plan) return [];
    const out = [];
    if (plan.vehicle && u.vehicle !== plan.vehicle) out.push('車號');
    const pd = (plan.drivers || []).filter(Boolean), ud = [u.driver1, u.driver2].filter(x => x && x !== this.SELF);
    if (pd.length && (pd.length !== ud.length || pd.some(x => !ud.includes(x)))) out.push('駕駛人');
    return out;
  },
};
