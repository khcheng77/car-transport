/* ============================================================
   guide.js — 共用單元：申請引導（依填寫內容判定申請並帶入）
   建議規格 v0.2：需求表單＋依條件出現的卡片（K1～K7，K5 借用資料已隨例行用車移除）、判定決策表 R1/R2/R4/R5/R6/R7（G135 危險品運輸、巡迴車上限）
   只分流、不送單：產生目標功能的帶入資料，送出一律在目標功能完成。
   本檔為純邏輯（不碰畫面），畫面在 app.js 的 RENDER.guide。
   ============================================================ */

const Guide = {
  OTHER: '__other',     // 出發地／目的地選「其他地點」

  UNITS: {
    A: { page: 'a_apply', name: '巡迴物品轉運申請', module: '巡迴物品轉運作業' },
    B: { page: 'b_apply', name: '院區物品轉運申請', module: '院區物品轉運作業' },
    C: { page: 'c_apply', name: '差旅共乘申請', module: '差旅共乘作業' },
    D: { page: 'd_apply', name: '一般用車申請', module: '一般用車申請作業' },
  },

  todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; },
  days(a, b) {
    if (!a || !b || b < a) return null;
    const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000) + 1;
  },
  siteName(id) { const s = DB.sites.find(x => x.id === id); return s ? s.name : id; },
  placeName(x) { return x === this.OTHER ? '其他地點' : x; },
  inBizList(v) {
    return !!v.origin && !!v.dest && v.origin !== this.OTHER && v.dest !== this.OTHER
      && DB.bizOrigins.includes(v.origin) && DB.bizDests.includes(v.dest);
  },
  canOneway(v) { return DB.transferPoints.includes(v.dest); },   // 單程限目的地為交通轉運點（出差用車 G50）
  /* 隨行物品（G134）：有隨行物品時再問「屬於隨身物品」（是／否）。
     bulkCargo＝有物品且非隨身物品（需填貨物清單、走一般用車）；noCargoForShare＝沒有物品或只有隨身物品（可走差旅共乘）。 */
  /* 收貨日巡迴車上限（G135）：寄件據點當天各班次（含車次覆寫）使用的巡迴車；
     貨物清單合計＝體積 Σ長×寬×高×件數（公升，不含浪費係數）、重量 Σ單件重×件數。 */
  cargoTotals(items) {
    return (items || []).reduce((a, it) => {
      const q = +it.qty || 1;
      return { volume: a.volume + it.l * it.w * it.h / 1000 * q, weight: a.weight + (+it.weight || 0) * q };
    }, { volume: 0, weight: 0 });
  },
  patrolVehicles(site, date) {
    if (typeof ModuleA === 'undefined') return [];
    const ids = [...new Set(DB.regionalShifts.filter(s => s.branch === site).map(s => ModuleA.shiftPlan(date || '', s.id).vehicle))];
    return ids.map(id => DB.vehicles.find(x => x.id === id)).filter(Boolean);
  },
  /* 貨物是否放得進收貨日的巡迴車：合計體積、合計重量皆小於某一台巡迴車上限（單件超過上限者合計必然超過）。
     回傳 { fits, total, vehicle（最大的一台，供說明）, overItem（單件超過上限的物品） } */
  patrolFit(v) {
    const vs = this.patrolVehicles(v.fromSite, v.recvDate), total = this.cargoTotals(v.items);
    if (!vs.length) return { fits: false, total, vehicle: null, overItem: null };
    const big = vs.slice().sort((a, b) => b.volume - a.volume || b.weight - a.weight)[0];
    const overItem = (v.items || []).find(it => !vs.some(x => it.l * it.w * it.h / 1000 < x.volume && (+it.weight || 0) < x.weight)) || null;
    const fits = vs.some(x => total.volume < x.volume && total.weight < x.weight);
    return { fits, total, vehicle: big, overItem };
  },
  bulkCargo(v) { return v.hasCargo === 'yes' && v.personalItems === 'no'; },
  noCargoForShare(v) { return v.hasCargo === 'no' || (v.hasCargo === 'yes' && v.personalItems === 'yes'); },

  /* ---- 卡片出現規則（規格 5.2）---- */
  visibleCards(v) {
    const out = ['K1'];
    if (v.mode === 'goods') {
      out.push('K2');
      if (v.fromSite && v.toSite) out.push('K3');
    }
    if (v.mode === 'people') {
      out.push('K4');
      if (this.days(v.startDate, v.endDate) != null) {
        out.push('K6');
        if (this.bulkCargo(v)) out.push('K3');   // 非隨身物品才需貨物清單（G134）
      }
    }
    out.push('K7');
    return out;
  },

  /* ---- 判定決策表（規格 6）：依序比對，第一條符合者為結果；未判定時回傳下一步提示
     （R3 期間 ≥30 天 → 例行用車，已隨例行用車功能移除；多天用車依地點／物品走 R4/R5）---- */
  route(v) {
    if (!v.mode) return { unit: null, hint: '請先在「需求」卡片選擇運送內容。' };
    if (v.mode === 'goods') {
      if (!v.fromSite || !v.toSite) return { unit: null, hint: '請選擇寄件據點與收件據點。' };
      if (v.fromSite !== v.toSite) {
        return { unit: 'B', rule: 'R2', reason: `寄件「${this.siteName(v.fromSite)}」與收件「${this.siteName(v.toSite)}」在不同據點，由院區物品轉運車沿線收送，需經二級審（單位主管審核）後由調度派車。` };
      }
      // 同據點（G135）：危險品運輸 → 院區物品轉運；貨物超過收貨日巡迴車上限 → 院區物品轉運；否則巡迴物品轉運
      if (v.hazardTransport !== 'yes' && v.hazardTransport !== 'no') return { unit: null, hint: '寄件與收件在同一據點。請選擇是否為危險品運輸。' };
      if (v.hazardTransport === 'yes') {
        return { unit: 'B', rule: 'R6', reason: `危險品運輸，不走院區內巡迴班次，改由院區物品轉運派車，需經二級審（單位主管審核）後由調度派車。` };
      }
      const f = this.patrolFit(v), t = f.total, fmt = n => Math.round(n * 10) / 10;
      const cap = f.vehicle ? `收貨日 ${v.recvDate || '—'} 巡迴車上限 ${fmt(f.vehicle.volume)}L／${fmt(f.vehicle.weight)}kg` : '收貨日無巡迴車';
      if (!f.fits) {
        const why = f.overItem ? `「${f.overItem.name}」單件體積或重量超過巡迴車上限（${cap}）` : `貨物合計 ${fmt(t.volume)}L／${fmt(t.weight)}kg 未小於${cap}`;
        return { unit: 'B', rule: 'R7', reason: `寄件與收件都在「${this.siteName(v.fromSite)}」，但${why}，改由院區物品轉運派車，需經二級審（單位主管審核）後由調度派車。` };
      }
      return { unit: 'A', rule: 'R1', reason: `寄件與收件都在「${this.siteName(v.fromSite)}」、非危險品，貨物合計 ${fmt(t.volume)}L／${fmt(t.weight)}kg 小於${cap}，由院區內固定班次巡迴收送，送出即自動排入最近班次。` };
    }
    if (!v.startDate || !v.endDate) return { unit: null, hint: '請填寫用車起日與迄日。' };
    const n = this.days(v.startDate, v.endDate);
    if (n == null) return { unit: null, hint: '迄日不可早於起日。' };
    if (!v.origin || !v.dest) return { unit: null, hint: `用車期間 ${n} 天。請選擇出發地與目的地。` };
    if (!this.inBizList(v)) {
      return { unit: 'D', rule: 'R5', days: n, reason: `用車期間 ${n} 天；地點不在共乘清單（${this.placeName(v.origin)} → ${this.placeName(v.dest)}），由調度人工確認資源後派車，可自駕。` };
    }
    if (v.hasCargo !== 'no' && v.hasCargo !== 'yes') return { unit: null, hint: `用車期間 ${n} 天，地點都在共乘清單內。請選擇是否有隨行物品。` };
    if (v.hasCargo === 'yes' && v.personalItems !== 'yes' && v.personalItems !== 'no') {
      return { unit: null, hint: `用車期間 ${n} 天，地點都在共乘清單內且有隨行物品。請選擇隨行物品是否屬於隨身物品。` };
    }
    if (this.bulkCargo(v)) {
      return { unit: 'D', rule: 'R5', days: n, reason: `用車期間 ${n} 天；隨行物品不屬於隨身物品，出差共乘不處理貨物，改由一般用車派車，可自駕。` };
    }
    return { unit: 'C', rule: 'R4', days: n, reason: `用車期間 ${n} 天；往返共乘清單內的地點（${v.origin} → ${v.dest}）且${v.hasCargo === 'yes' ? '隨行物品屬於隨身物品' : '未攜帶物品'}，由系統自動併車共乘。` };
  },

  /* ---- 判定後仍缺少的欄位（全部填齊才可「前往並帶入」）---- */
  missing(v) {
    const r = this.route(v), out = [];
    if (!r.unit) return out;
    if (!v.applicant) out.push('申請人');
    const u = r.unit;
    if (u === 'A' || u === 'B') {
      if (!v.recvDate) out.push('希望收貨日期');
      else if (v.recvDate < this.todayStr()) out.push('希望收貨日期（不可早於今天）');
      if (!v.items || !v.items.length) out.push('貨物清單（至少 1 項）');
      if (v.hazardTransport === 'no' && (v.items || []).some(it => it.hazardous)) out.push('危險品運輸（貨物清單含危險品，請選「是」）');
    }
    if (u === 'C' || u === 'D') {
      if (!v.departTime) out.push('出發時間');
      const needBack = !(u === 'C' && v.tripType === 'oneway');
      if (needBack && !v.backTime) out.push(u === 'C' ? '回程上車時間' : '結束時間');
      if (!(Number.isInteger(+v.pax) && +v.pax >= 1)) out.push('人數（至少 1 人）');
      if (!v.hasCargo) out.push('隨行物品');
      else if (v.hasCargo === 'yes' && !v.personalItems) out.push('屬於隨身物品');
    }
    if (u === 'C' && v.tripType === 'oneway' && !this.canOneway(v)) out.push('行程型態（單程限目的地為交通轉運點）');
    if (u === 'D') {
      if ((v.origin === this.OTHER || v.dest === this.OTHER) && !(v.otherPlace || '').trim()) out.push('其他地點說明');
      if (this.bulkCargo(v) && (!v.items || !v.items.length)) out.push('貨物清單（至少 1 項）');
      if (typeof v.selfDrive !== 'boolean') out.push('沒有司機時可否自己開車');
      if (v.startDate === v.endDate && v.departTime && v.backTime && v.backTime <= v.departTime) out.push('結束時間（須晚於出發時間）');
    }
    return out;
  },

  /* ---- 帶入資料（規格 8）：只取目前判定路徑用得到的欄位（隱藏卡片的資料不帶入）---- */
  prefill(v) {
    const r = this.route(v);
    if (!r.unit) return null;
    const items = (v.items || []).map(it => Object.assign({}, it));
    const who = { applicant: v.applicant, dept: v.dept, ext: v.ext };
    const labels = [], warnings = [];
    let data;
    switch (r.unit) {
      case 'A': {
        const today = this.todayStr();
        const recvMode = (!v.recvTime && v.recvDate === today) ? 'asap' : 'exact';
        data = { branch: v.fromSite, recvMode, serviceDate: v.recvDate, deliverTime: v.recvTime || '', items };
        labels.push(`車屬院區 ${this.siteName(v.fromSite)}`,
          recvMode === 'asap' ? '收貨時間：越快越好（今天）' : `期望 ${v.recvDate} ${v.recvTime || '（時間請確認）'}`,
          `貨物 ${items.length} 項`);
        break;
      }
      case 'B':
        data = { applicant: v.applicant, site: v.fromSite, destSite: v.toSite, wantReceiveDate: v.recvDate || '', wantReceiveTime: v.recvTime || '', items };
        labels.push(`收貨據點 ${this.siteName(v.fromSite)}`, `送貨據點 ${this.siteName(v.toSite)}`);
        if (v.recvDate) labels.push(`希望收貨日期 ${v.recvDate}`);
        if (v.recvTime) labels.push(`希望收貨時間 ${v.recvTime}`);
        labels.push(`貨物 ${items.length} 項`);
        break;
      case 'C': {
        const round = v.tripType !== 'oneway';
        data = Object.assign({}, who, { type: round ? 'round' : 'oneway', origin: v.origin, dest: v.dest,
          departDate: v.startDate, earliestPickup: v.departTime,
          returnDate: round ? v.endDate : v.startDate, earliestReturn: round ? v.backTime : '', pax: +v.pax });
        labels.push('申請人', round ? '來回單' : '單程單', `${v.origin} → ${v.dest}`, `去程 ${v.startDate} ${v.departTime}`);
        if (round) labels.push(`回程 ${v.endDate} ${v.backTime}`);
        labels.push(`${v.pax} 人`);
        break;
      }
      case 'D': {
        const place = `${this.placeName(v.origin)} → ${this.placeName(v.dest)}${(v.otherPlace || '').trim() ? '：' + v.otherPlace.trim() : ''}`;
        data = Object.assign({}, who, { startDate: v.startDate, startTime: v.departTime, endDate: v.endDate, endTime: v.backTime,
          pax: +v.pax, selfDrive: v.selfDrive, purpose: place, items: this.bulkCargo(v) ? items : [] });
        labels.push('申請人', `用車 ${v.startDate} ${v.departTime} ～ ${v.endDate} ${v.backTime}`, `${v.pax} 人`,
          `自駕：${v.selfDrive ? '可以' : '不行'}`, '行程說明');
        if (this.bulkCargo(v)) labels.push(`隨行貨物 ${items.length} 項`);
        else if (v.hasCargo === 'yes') labels.push('隨行物品屬隨身物品（不帶貨物清單）');
        break;
      }
    }
    if ((r.unit === 'A' || r.unit === 'B') && (items.some(it => it.hazardous) || v.hazardTransport === 'yes')) {
      warnings.push(`${this.UNITS[r.unit].name}目前沒有危險品欄位，請於備註說明並聯絡調度。`);
    }
    return { unit: r.unit, page: this.UNITS[r.unit].page, data, labels, warnings };
  },

  /* ---- 引導紀錄（index 頁 grid／細節頁歷程）----
     每按一次「前往並帶入」即建立紀錄（或更新同一筆待送出紀錄）；目標功能送出後回填申請單號。 */
  records: [],
  _seq: 0,
  STATUS: { handed: ['已帶入待送出', 'b-amber'], submitted: ['已送出申請', 'b-green'] },
  _log(rec, action, by, note) { rec.log.push({ at: new Date(), action, by: by || '—', note: note || '' }); },
  summary(v) {
    if (v.mode === 'goods') {
      return `物品 ${this.siteName(v.fromSite)} → ${this.siteName(v.toSite)}｜貨物 ${(v.items || []).length} 項`;
    }
    if (v.mode === 'people') {
      const n = this.days(v.startDate, v.endDate);
      const place = (v.origin && v.dest && n != null) ? `｜${this.placeName(v.origin)} → ${this.placeName(v.dest)}` : '';
      return `用車 ${v.startDate} ～ ${v.endDate}（${n} 天）${place}`;
    }
    return '—';
  },
  /* 前往並帶入：未判定或缺欄位時丟錯；recId 指向「已帶入待送出」紀錄時為回到引導修改後重新帶入 */
  hand(v, recId) {
    const r = this.route(v);
    if (!r.unit) throw new Error(r.hint || '尚未判定適用的申請功能');
    const miss = this.missing(v);
    if (miss.length) throw new Error('仍缺少：' + miss.join('、'));
    const pf = this.prefill(v);
    const snap = JSON.parse(JSON.stringify(v));
    const name = this.UNITS[r.unit].name;
    let rec = recId ? this.records.find(x => x.id === recId && x.status === 'handed') : null;
    const fields = { applicant: v.applicant, v: snap, unit: r.unit, rule: r.rule, reason: r.reason,
      labels: pf.labels, warnings: pf.warnings, summary: this.summary(v) };
    if (rec) {
      const prev = rec.unit;
      Object.assign(rec, fields);
      this._log(rec, '重新判定並帶入', v.applicant, prev === r.unit ? `${r.rule} → ${name}` : `改判：${this.UNITS[prev].name} → ${name}（${r.rule}）`);
    } else {
      rec = Object.assign({ id: `GD-${String(++this._seq).padStart(4, '0')}`, createdAt: new Date(), status: 'handed', appId: null, submittedAt: null, log: [] }, fields);
      this.records.unshift(rec);
      this._log(rec, '建立引導', v.applicant, rec.summary);
      this._log(rec, '判定並帶入', v.applicant, `${r.rule} → ${name}`);
    }
    pf.recId = rec.id;
    return { rec, pf };
  },
  /* 目標功能送出成功：回填申請單號（只對待送出紀錄有效）*/
  /* 目標功能按「暫存」：申請單成立為「申請中」，紀錄記下暫存單號（仍為已帶入待送出）；
     之後該單從明細／編輯畫面送出時，以 draftSubmitted 回填申請單號 */
  linkDraft(recId, appId) {
    const rec = this.records.find(x => x.id === recId && x.status === 'handed');
    if (!rec) return null;
    rec.draftAppId = appId;
    this._log(rec, '暫存申請單', rec.applicant, `${this.UNITS[rec.unit].name} 單號 ${appId}（申請中）`);
    return rec;
  },
  draftSubmitted(appId) {
    const rec = this.records.find(x => x.status === 'handed' && x.draftAppId === appId);
    return rec ? this.markSubmitted(rec.id, appId) : null;
  },
  markSubmitted(recId, appId) {
    const rec = this.records.find(x => x.id === recId && x.status === 'handed');
    if (!rec) return null;
    rec.status = 'submitted'; rec.appId = appId; rec.submittedAt = new Date();
    this._log(rec, '送出申請', rec.applicant, `${this.UNITS[rec.unit].name} 單號 ${appId}`);
    return rec;
  },
  /* 從目標功能「回到引導修改」或細節頁「修改」：回傳可編輯的填寫內容副本 */
  reopen(recId) {
    const rec = this.records.find(x => x.id === recId && x.status === 'handed');
    if (!rec) return null;
    this._log(rec, '回到引導修改', rec.applicant, '');
    return JSON.parse(JSON.stringify(rec.v));
  },
};
