/* ============================================================
   moduleB.js — 模組 B：跨據點南北幹線物流
   PLAN.md Phase 4 / Guardrails G30–G44
   貪婪終點判斷、直達/非直達分流、動態淨值容量、天數對照表
   B-1：出發據點走主檔 DB.homeSite（2.22 起可指定任一據點為出發點）；
   B-2：無 leg 欄位（方向由起迄推導）、無 accepted 狀態；
   B-3：時間上限依天數對照表動態決定；
   B-4：五列決策矩陣單一決策表；B-5：回程撞期三條件判定；
   B-6：vehicleStatus 記錄每車派遣模式與觸發原因

   ── 本版（南北幹線最新討論後規格）新增/修正 ──
   2.13：每日在勤上限 12.5→13.5 小時（DB.dailyDutyMin，數字更正）
   2.18：站內建物間移動時間 =（拜訪棟數−1）×30 分，另計入當日額度
   2.19：收貨時間窗——每張申請單填「希望收貨時間」，車輛抵達收貨建物須落在
         〔希望時間 ～ ＋4h〕內才能收貨；早到須等待（等待計入在勤）、晚到窗內仍可、
         超窗＝媒合不到（取代原 2.11「交貨時間」硬門檻）
   2.20/2.21：站內外攤平成同一條時間軸；先跑「不含候選單」基準路線，再檢查候選單
         是否排擠既定行程或卡不進時間窗；排線維持貪婪法單純順序，不回頭重排
   2.22：媒合不到之急件循 3.2 由當地據點另行派車，出發據點不限龍潭（dispatch 可帶 originId）
   ============================================================ */

const ModuleB = {
  orders: [],  // 幹線申請單
  dispatches: [],   // 派車單（G117）：{ id, date, vehicleType, vehicle, driver1, driver2, dispatcher, dispatchedAt, submitted, apps[], cancelled, log[] }
  dispatchSeq: 1,
  seq: 1,
  approveSeq: 1,
  vehicleStatus: {}, // B-6：每台車最近一次派遣決策 { matrixRow, modeLabel, reason, endpoint, endpointBasis, at }

  /* ---- B-4 五列決策矩陣（3.7）：單一決策表，派車模式判定與 B-6 顯示皆以此為準 ---- */
  DECISION_MATRIX: [
    { row: 1, mode: '去程・非直達',         capacity: '動態淨值（2.4）',        endpoint: '貪婪法自動判斷（2.3）', stops: '逐站收送非直達貨' },
    { row: 2, mode: '去程・直達',           capacity: '純容量加總（3.3）',      endpoint: '申請單目的地',         stops: '不停靠' },
    { row: 3, mode: '回程・非直達且無撞期', capacity: '動態淨值',              endpoint: '出發據點（2.7）',       stops: '逐站收送非直達貨' },
    { row: 4, mode: '回程・被迫鎖定直達',   capacity: '動態淨值（延續，3.6）',  endpoint: '出發據點（3.6）',       stops: '不收新非直達貨，仍依序經過' },
    { row: 5, mode: '回程・原本就是直達車', capacity: '純容量加總',            endpoint: '出發據點',             stops: '不停靠' },
  ],
  matrixRowInfo(row) { return this.DECISION_MATRIX.find(m => m.row === row); },

  siteById(id) { return DB.sites.find(s => s.id === id); },
  homeOrder() { return this.siteById(DB.homeSite).order; },

  /* B-2：方向由起迄推導（非申請人勾選）——送貨據點較南（order 較小）＝南下貨、較北＝北上貨
     G111：起迄同一據點（不同建物）＝院區內建物間轉運，排入去程車次、於該據點收貨後即送達 */
  isIntraSite(o) { return o.pickSite === o.dropSite; },
  isSouthbound(o) { return this.isIntraSite(o) || this.siteById(o.dropSite).order < this.siteById(o.pickSite).order; },
  dirLabel(o) { return this.isIntraSite(o) ? '院區內（同據點建物間）' : (this.isSouthbound(o) ? '去程（南下）' : '回程（北上）'); },

  /* G111：起迄可為同一據點，但收貨建物與送貨建物不可相同（同據點時兩者皆須指定）*/
  routeError(data) {
    const pick = data.site, drop = data.destSite || DB.homeSite;
    if (!pick || !drop || pick !== drop) return null;
    const norm = x => String(x || '').trim();
    if (!norm(data.pickupLoc) || !norm(data.deliverLoc)) return '收貨據點與送貨據點相同時，須指定收貨建物與送貨建物';
    if (norm(data.pickupLoc) === norm(data.deliverLoc)) return '收貨據點與送貨據點相同時，收貨建物與送貨建物不可相同';
    return null;
  },

  /* ---- 可服務範圍：出發據點（origin）及其以南 ----
     現行車次模型為「自出發據點南下、折返北上回出發據點」，故出發據點以北據點不在該趟路線上。
     2.22：出發據點可為任一據點；未指定時走主檔 homeSite。 */
  isServable(o, originId) {
    const home = this.siteById(originId || DB.homeSite).order;
    return this.siteById(o.pickSite).order <= home && this.siteById(o.dropSite).order <= home;
  },
  unservableReason(o, originId) {
    const home = this.siteById(originId || DB.homeSite);
    const bad = [];
    if (this.siteById(o.pickSite).order > home.order) bad.push(`收貨據點 ${this.siteById(o.pickSite).name}`);
    if (this.siteById(o.dropSite).order > home.order) bad.push(`送貨據點 ${this.siteById(o.dropSite).name}`);
    return `${bad.join('、')} 位於出發據點 ${home.name} 以北，現行「自出發據點南下折返」車次模型未涵蓋`;
  },

  // site＝收貨據點（起）、destSite＝送貨據點（迄）；申請端只負責建立：送出＝待二級審；opts.draft＝暫存（申請中）
  // 幹線貨物多筆項目，每筆填獨立尺寸與重量（品名/長寬高/類別/數量/單件重），比照模組 A（G13）
  // 整張表單為裝載最小單位（G34）；相容：若帶 volume 而無尺寸則以整批貨量計（demo/測試）
  createOrder(data, opts) {
    const err = this.routeError(data);
    if (err) throw new Error(err);
    const o = Object.assign({ id: 'LB' + String(this.seq++).padStart(3, '0') }, this._fields(data), {
      approvedAt: null,
      status: opts && opts.draft ? 'draft' : 'submitted',  // draft（申請中）→ submitted（待二級審）→ approved（待調度）/rejected（退回修編）/noCar（無車退回）→（媒合派車）loaded；顯示狀態由 Flow 推導
      createdAt: new Date(),
    });
    this.recompute(o);      // 由 items 加總 volume/weight/有效體積
    this.orders.push(o);
    return o;
  },
  // 退回修編 → 申請人修改後重新送出：沿用原單號，回到待單位主管審核
  resubmit(o, data) {
    if (!['rejected', 'draft'].includes(o.status)) throw new Error('僅「申請中」或「退回修編」的申請可修改後送出');
    const err = this.routeError(data);
    if (err) throw new Error(err);
    (o.revisions = o.revisions || []).push({ at: new Date(), returnNote: o.reviewNote || '' });
    Object.assign(o, this._fields(data), { status: 'submitted', approvedAt: null, reviewNote: '', returnedBy: null });
    this.recompute(o);
    return o;
  },
  /* 暫存（申請中）：修改後仍維持申請中 */
  saveDraft(o, data) {
    if (o.status !== 'draft') throw new Error('僅「申請中」的申請可暫存修改');
    Object.assign(o, this._fields(data));
    this.recompute(o);
    return o;
  },
  canEdit(o) { return ['draft', 'rejected'].includes(o.status); },
  _fields(data) {
    const items = (data.items && data.items.length)
      ? data.items.map(x => ({ ...x, name: x.name || '貨物', qty: x.qty || 1, category: x.category || 'BOX', weight: +x.weight || 0 }))
      : [{ name: '貨物', volume: +data.volume || 0, weight: +data.weight || 0, category: data.category || 'BOX' }];
    // 上貨時間＋下貨時間（分），加總為裝卸時間 handleMin（G35）；相容：只給 handleMin 亦可
    const split = (data.loadMin != null || data.unloadMin != null);
    const loadMin = +(data.loadMin || 0);
    const unloadMin = +(data.unloadMin || 0);
    const handleMin = split ? (loadMin + unloadMin) : (+data.handleMin || 0);
    const pickSite = data.site;
    const dropSite = data.destSite || DB.homeSite; // 未指定迄點 → 預設送回出發據點（相容）
    return {
      applicant: data.applicant,
      pickSite,                            // 收貨據點（起）
      dropSite,                            // 送貨據點（迄）
      pickupLoc: data.pickupLoc || '',     // 收貨地點（收貨據點內建物/位置）
      deliverLoc: data.deliverLoc || '',   // 送貨地點（送貨據點內建物/位置）
      // 2.19 收貨時間窗：希望收貨時間 HH:MM——車輛抵達收貨建物須落在〔希望時間 ～ ＋DB.receiveWindowMin〕內
      // （相容：舊欄位 deliverTime 若存在則沿用為希望收貨時間，語意已由「交貨門檻」改為「收貨窗起點」2.19）
      wantReceiveTime: data.wantReceiveTime || data.deliverTime || '',
      recipient: data.recipient || {},     // 接收人資訊：{ unit, name, phone, agentName, agentPhone }
      direct: !!data.direct,   // 3.2 急件直達（申請人指定）＝派車輸入條件，觸發獨立派車與回程鎖定
      items,                 // 貨物項目清單
      loadMin, unloadMin,    // 上貨/下貨時間（分）
      handleMin,             // 裝卸時間＝上貨＋下貨（G35）
    };
  },

  // 由貨物項目清單重算整單彙總值（新增或編輯後呼叫）
  recompute(o) {
    let raw = 0, eff = 0, wt = 0;
    for (const it of o.items) {
      if (it.l != null && it.w != null && it.h != null) {
        const e = itemEffective(it);           // { vol(單件L), eff(含qty), weight(含qty), qty }
        raw += e.vol * e.qty; eff += e.eff; wt += e.weight;
      } else {
        raw += (+it.volume || 0);
        eff += (+it.volume || 0) * WasteFactorProvider.get(it.category);
        wt += (+it.weight || 0);
      }
    }
    o.volume = Math.round(raw);  // 申報總貨量（L）
    o.weight = wt;               // 總重量（kg）
    o.effVol = eff;              // 有效體積（容量計算用）
    o.category = o.items.length === 1 ? o.items[0].category : null; // 單項時保留類別供顯示
  },

  // 主管准駁：核准時填入審核通過時間（G34 排序用）；note＝審核備註（選填/駁回必填）
  approve(o, note) { o.status = 'approved'; o.approvedAt = this.approveSeq++; if (note != null) o.reviewNote = note; },
  reject(o, note) { o.status = 'rejected'; o.approvedAt = null; if (note != null) o.reviewNote = note; },

  /* ---- 2.15 媒合截止：派車日前兩天中午 12:00 ---- */
  now() { return new Date(); },
  matchCutoffFor(dispatchDate) {
    const d = new Date(dispatchDate + 'T00:00:00');
    d.setDate(d.getDate() - DB.matchCutoffDaysBefore);
    const [h, m] = DB.matchCutoffTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  },
  meetsCutoff(o, dispatchDate) {
    return new Date(o.createdAt) <= this.matchCutoffFor(dispatchDate);
  },
  nextDispatchDate(o) {
    const submitted = new Date(o.createdAt);
    const d = new Date(submitted); d.setHours(0, 0, 0, 0);
    for (let i = 0; i <= 30; i++) {
      const cand = new Date(d); cand.setDate(cand.getDate() + i);
      const ds = `${cand.getFullYear()}-${pad2(cand.getMonth() + 1)}-${pad2(cand.getDate())}`;
      if (submitted <= this.matchCutoffFor(ds)) return ds;
    }
    return null;
  },

  /* 狀態推導（Flow）：已出車＝派車日＋收貨時間已到 */
  departAt(o) {
    const d = this.dispatchOf(o);
    return d ? Flow.at(d.date, o.pickupTime || '00:00') : null;
  },

  /* ---- 運輸主管簽審（派車結果覆核，簽審通過才生效）---- */
  signSummary(o) {
    const nm = id => (this.siteById(id) || {}).name || id;
    return `${o.dispatchId ? '派車單 ' + o.dispatchId + '｜' : ''}${o.dispatchVehicle}｜${o.dispatchMode || ''}｜${o.dispatchDir === 'north' ? '北返' : '南下'}｜${nm(o.pickSite)} → ${nm(o.dropSite)}`;
  },
  /* ---- 車輛使用實登（派車結果生效後登打實際車輛／駕駛／里程；B 派車只指定車輛）---- */
  USAGE_POOL: 'LOGI',
  usagePlan(o) { return { vehicle: o.dispatchVehicle || null, drivers: this.driversOf(o) }; },
  usageRecords() { return this.orders.filter(o => Usage.inScope(o)); },
  usageSave(o, data, by) { return Usage.save(o, data, by, { pool: this.USAGE_POOL }); },
  /* 派車單實登（G124）：院區物品轉運以「派車單」為單位實登。派車單送審且運輸主管簽審通過（各託運單皆生效）後才可實登；
     實際車種類型／車號／駕駛人1／駕駛人2 預設帶入派車單（可改為實際使用，不改派車單），輸入起訖里程儲存即完成，
     派車單內每張託運單轉「已回登」；實登存於派車單 d.usage／d.usageLog（歷程不覆蓋）。 */
  dispatchEffective(d) { const os = this.dispatchOrders(d); return !d.cancelled && d.submitted && os.length > 0 && os.every(o => Signoff.effective(o)); },
  usageDispatches() { return this.dispatches.filter(d => d.usage || this.dispatchEffective(d)); },
  dispatchUsageSave(d, data, by, opts) {
    if (!d.usage && !this.dispatchEffective(d)) return { ok: false, error: '派車單尚未經運輸主管簽審通過，不可實登' };
    return Usage.saveGroup(d, this.dispatchOrders(d), data, by, Object.assign({ pool: this.USAGE_POOL }, opts));
  },
  /* 貨品回報狀態（G120）：車輛使用實登的貨物清單逐項回報；共用 Usage，生效依運輸主管簽審 */
  ITEM_REPORTS: Usage.ITEM_REPORTS,
  itemReport(it) { return Usage.itemReport(it); },
  setItemReport(o, idx, status, by) { return Usage.setItemReport(o, idx, status, by); },
  signRecords() { return this.orders.filter(o => Signoff.inScope(o)); },
  signApprove(o, by, note) { return Signoff.decide(o, true, by, note); },
  // 退回：卸下派車結果、回到「已核准待派車」，由調度重新派車後再送簽審
  signReject(o, by, note) {
    const r = Signoff.decide(o, false, by, note);
    if (!r.ok) return r;
    // 退回調度：整張派車單回「調度中」（未送審），同單其他託運單的簽審一併撤回，由調度修改後重新送審
    o.signReturnNote = o.sign.note;
    const d = this.dispatchOf(o);
    if (d) {
      d.submitted = false;
      this._dlog(d, '調度主管退回', by, `${o.id}：${note}`);
      this.dispatchOrders(d).filter(x => x !== o).forEach(x => Signoff.release(x, `同派車單 ${o.id} 被退回`, by));
    }
    o.sign = null;
    return r;
  },

  /* ---- 2.9 據點相互路程表查表（分大車／小車，同車型內對稱）---- */
  travelMin(fromId, toId, sizeClass) {
    if (fromId === toId) return 0;
    const tbl = DB.siteTravel[sizeClass === 'big' ? 'big' : 'small'] || {};
    const t = tbl[fromId + '|' + toId];
    return t != null ? t : (tbl[toId + '|' + fromId] || 0);
  },
  returnToRestMin(siteId, sizeClass) {
    return DB.restHouses.reduce((m, r) => Math.min(m, this.travelMin(siteId, r.id, sizeClass)), Infinity) || 0;
  },

  lateArrivalBlocked(siteId, arriveMin) {
    const s = this.siteById(siteId);
    return !!(s && s.lateRestricted) && arriveMin > hhmmToMin(DB.noArrivalAfter);
  },
  returnLoadDeadlineOk(siteId, loadDoneMin) {
    const s = this.siteById(siteId);
    if (!s || !s.returnLoadBy) return true;
    return loadDoneMin <= hhmmToMin(s.returnLoadBy);
  },

  /* ---- 幹線車輛主檔查表：依 sizeClass 取代表車（LOGI 池）---- */
  trunkVehicle(sizeClass) {
    return DB.vehicles.find(v => v.pool === 'LOGI' && v.sizeClass === sizeClass);
  },

  /* ---- 2.17 車型（大車／小車）決定（業務單位暫定）----
     依「目標日當天該路線的總貨量」自動判斷：統計當天待載貨量（依 2.16 車輛主檔容量參數），
     總貨量超過小車容量上限 → 派大車，否則派小車。單純門檻判斷，不做填載率精算最佳化。
     leg：'south'（去程南下貨）／'north'（回程北上貨）；mode：'direct' 只計急件直達、否則計非直達貨。 */
  decideSizeClass(mode, dispatchDate, originId, leg) {
    const origin = originId || DB.homeSite;
    const small = this.trunkVehicle('small');
    const big = this.trunkVehicle('big');
    let pool = this.orders.filter(o => o.status === 'approved'
      && (leg === 'north' ? !this.isSouthbound(o) : this.isSouthbound(o))
      && this.isServable(o, leg === 'north' ? DB.homeSite : origin));
    if (dispatchDate) pool = pool.filter(o => this.meetsCutoff(o, dispatchDate));
    pool = pool.filter(o => (mode === 'direct' ? o.direct : !o.direct));
    const totalVol = pool.reduce((s, o) => s + this.effVolume(o), 0);
    const totalWt = pool.reduce((s, o) => s + (+o.weight || 0), 0);
    // 依 2.16 以小車「這台車」的容量參數為門檻（容積與載重上限任一超過即需大車）
    const needBig = totalVol > small.volume || totalWt > small.weight;
    const veh = needBig ? big : small;
    return {
      sizeClass: needBig ? 'big' : 'small',
      vehicle: veh.id, vehicleName: veh.name,
      totalVol: Math.round(totalVol), totalWt: Math.round(totalWt), count: pool.length,
      threshVol: Math.round(small.volume), threshWt: small.weight,
      reason: needBig
        ? `當日該路線待載總貨量 ${Math.round(totalVol)}L／${Math.round(totalWt)}kg 超過小車容量上限（${Math.round(small.volume)}L／${small.weight}kg）→ 派大車（2.17）`
        : `當日該路線待載總貨量 ${Math.round(totalVol)}L／${Math.round(totalWt)}kg 未超過小車容量上限（${Math.round(small.volume)}L／${small.weight}kg）→ 派小車（2.17）`,
    };
  },

  /* ---- 3.1 最短天數表：依 車型 × 目的地 查表（寬鬆估計值，僅供顯示，不參與運算） ---- */
  minTripDaysFor(vehicle, endpointId) {
    const cls = (vehicle && vehicle.sizeClass) || 'small';
    const table = DB.minTripDays[cls] || {};
    return table[endpointId] || null;
  },

  /* ---- 2.19 收貨時間窗：回傳 {start,end}（分）或 null（未指定＝不設限）---- */
  receiveWindow(o) {
    if (!o.wantReceiveTime) return null;
    const start = hhmmToMin(o.wantReceiveTime);
    return { start, end: start + DB.receiveWindowMin };
  },
  /* 車輛於 arriveMin 抵達收貨建物時，對某單的收貨窗判定：
     { ok, wait, reason }——wait＝早到須等待的分鐘（計入在勤 2.19），reason＝媒合不到原因 */
  receiveCheck(o, arriveMin) {
    const w = this.receiveWindow(o);
    if (!w) return { ok: true, wait: 0 };
    if (arriveMin > w.end) {
      return { ok: false, wait: 0, reason: `抵達 ${minToHHMM(arriveMin)} 晚於收貨窗 ${o.wantReceiveTime}＋${DB.receiveWindowMin} 分（${minToHHMM(w.end)}）` };
    }
    return { ok: true, wait: Math.max(0, w.start - arriveMin) };
  },

  /* ---- 2.18 站內建物間移動時間 =（拜訪棟數−1）×每棟增量；獨立於裝卸另計 ---- */
  intraSiteMoveMin(buildingCount) {
    return buildingCount > 1 ? (buildingCount - 1) * DB.intraSiteMovePerBuildingMin : 0;
  },

  /* ---- 2.13 每日在勤時數模型（DB.dailyDutyMin，自到班起算）---- */
  newDutyClock(sizeClass) {
    const self = this;
    const hrs = (DB.dailyDutyMin / 60);
    return {
      sizeClass,
      day: 1,
      dayElapsed: DB.prepMin,   // 出勤前緩衝（車輛檢查＋前往報到）
      driveMin: 0,              // 當日純累積行駛（2.12 觸發基準）
      breaksTaken: [],
      log: [],
      hrsLabel: (Number.isInteger(hrs) ? hrs : hrs.toFixed(1)) + 'h',
      remaining(atSite) {
        return DB.dailyDutyMin - this.dayElapsed - DB.closeMin - self.returnToRestMin(atSite, this.sizeClass);
      },
      rollover(atSite) {
        if (this.day >= DB.maxTripDays) return false;
        this.day++; this.dayElapsed = DB.prepMin; this.driveMin = 0; this.breaksTaken = [];
        this.log.push(`  <span class="hl">🌙 於 ${self.siteById(atSite) ? self.siteById(atSite).name : atSite} 過夜 → 第 ${this.day} 天（在勤與行駛時數線歸零 2.12）</span>`);
        return true;
      },
      addDrive(min) {
        const before = this.driveMin;
        this.driveMin += min; this.dayElapsed += min;
        let extra = 0;
        DB.driverBreaks.forEach(b => {
          if (before < b.afterDriveMin && this.driveMin >= b.afterDriveMin) {
            extra += b.costMin; this.breaksTaken.push(b.kind);
            this.log.push(`  <span class="dim">☕ 累積行駛 ${this.driveMin} 分 → 觸發${b.kind} ${b.costMin} 分（計入 ${this.hrsLabel} 上限 2.12）</span>`);
          }
        });
        this.dayElapsed += extra;
        return min + extra;
      },
      addWork(min) { this.dayElapsed += min; }, // 裝卸／站內移動／收貨等待
      closeOut(atSite) { return this.dayElapsed + DB.closeMin + self.returnToRestMin(atSite, this.sizeClass); },
    };
  },

  effVolume(o) { return o.effVol != null ? o.effVol : o.volume * WasteFactorProvider.get(o.category); },

  /* 依出發據點南下方向排序（order 大→小） */
  southboundFrom(originId) {
    const start = this.siteById(originId).order;
    return DB.sites.filter(s => s.order < start).sort((a, b) => b.order - a.order);
  },

  recordVehicleStatus(vehId, matrixRow, reason, endpointId, endpointBasis) {
    const m = this.matrixRowInfo(matrixRow);
    this.vehicleStatus[vehId] = {
      matrixRow, modeLabel: m ? m.mode : '—', capacity: m ? m.capacity : '—',
      reason, endpoint: endpointId, endpointBasis, at: new Date(),
    };
  },

  /* ============================================================
     南下路線模擬器（2.3/2.4/2.13/2.18/2.19 一條時間軸）
     以固定的 orderSet 跑一次貪婪南下：逐據點卸貨→裝貨（含收貨時間窗、站內移動），
     回傳哪些單成功媒合、沿線各站服務、終點與在勤時數。純函式、不改動 order 狀態；
     供 dispatch 以「基準路線 vs 納入候選單」比對是否排擠（2.20/2.21）。
     ── 站內外攤平成同一條時間軸：站間移動查路程表（2.9）、站內棟間移動（2.18）
        皆計入同一 clock；收貨時間窗（2.19）以「抵達該站的在勤時點」判定。 ============ */
  simulateSouthbound(orderSet, veh, originId, opts) {
    opts = opts || {};
    const T = opts.trace || null;
    const push = s => { if (T) T.push(s); };
    const clock = this.newDutyClock(veh.sizeClass);
    const start = hhmmToMin(DB.shiftStartDefault);
    const seq = this.southboundFrom(originId);
    let netVol = 0, netWt = 0, peakVol = 0;
    const onboard = [], served = new Set(), delivered = new Set(), info = new Map(), stops = [];
    let stopReason = null;

    // 建物集合鍵（收貨用 pickupLoc、送貨用 deliverLoc；空值歸為據點預設一棟）
    const bkey = (loc) => 'B:' + (loc || '·');

    // 處理單一據點：卸貨→裝貨（核准序）→站內移動；回傳本站是否有活動
    const processSite = (siteId) => {
      const arriveMin = start + clock.dayElapsed;   // 抵達本站的在勤時點（同一條時間軸）
      const arriveEta = minToHHMM(arriveMin);
      const bldgs = new Set();
      let unloaded = 0, loaded = 0, nLoad = 0, waitMax = 0, activity = false;

      // 1) 卸貨：車上以本站為送貨據點（迄）者 → 釋出容量（2.4 動態淨值）
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === siteId) {
          const ev = this.effVolume(o);
          netVol -= ev; netWt -= o.weight; clock.addWork(o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); delivered.add(o.id);
          const inf = info.get(o.id); if (inf) { inf.dropTime = arriveEta; inf.dropDay = clock.day; }
          bldgs.add(bkey(o.deliverLoc)); activity = true;
        }
      }

      // 2) 裝貨：以本站為收貨據點（起）者，依核准序逐張試收（2.5 整張表單為最小單位）
      const here = [...orderSet].filter(o => o.pickSite === siteId && !served.has(o.id))
        .sort((a, b) => a.approvedAt - b.approvedAt);
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 2.19 收貨時間窗：以抵達本站在勤時點判定（早到等待、晚到窗內仍可、超窗＝媒合不到）
        const rc = this.receiveCheck(o, arriveMin);
        if (!rc.ok) {
          push(`  <span class="no">✗ ${o.id} ${rc.reason} → 媒合不到（2.19，急件走 2.22）</span>`);
          continue;
        }
        // 容量（2.4 動態淨值）與重量；卡不進即跳過該張（2.5），車輛仍續行（2.3）
        if (netVol + ev <= veh.volume && netWt + o.weight <= veh.weight) {
          netVol += ev; netWt += o.weight; clock.addWork(lt);
          loaded += ev; nLoad++; served.add(o.id); onboard.push(o);
          bldgs.add(bkey(o.pickupLoc));
          waitMax = Math.max(waitMax, rc.wait);
          info.set(o.id, { pickSite: siteId, pickupTime: minToHHMM(Math.max(arriveMin, this.receiveWindow(o) ? this.receiveWindow(o).start : arriveMin)), day: clock.day });
          activity = true;
        }
        // 放不下整張 → 跳過留下一班（2.5），不停止延伸（2.3）
      }

      peakVol = Math.max(peakVol, netVol);   // 院區內貨卸下前的載量也計入峰值
      // 3) 院區內轉運（G111）：本站收貨且送貨據點即本站者，於站內送達另一棟建物後卸貨釋出容量
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.pickSite === siteId && o.dropSite === siteId) {
          netVol -= this.effVolume(o); netWt -= o.weight; clock.addWork(o.unloadMin || 0);
          unloaded += this.effVolume(o); onboard.splice(i, 1); delivered.add(o.id);
          const inf = info.get(o.id); if (inf) { inf.dropTime = inf.pickupTime; inf.dropDay = clock.day; }
          bldgs.add(bkey(o.deliverLoc));
        }
      }

      // 收貨等待（2.19，早到等待一次至最晚窗口）＋站內建物間移動（2.18）皆計入在勤
      const moveMin = this.intraSiteMoveMin(bldgs.size);
      if (waitMax) clock.addWork(waitMax);
      if (moveMin) clock.addWork(moveMin);

      if (activity) {
        peakVol = Math.max(peakVol, netVol);
        stops.push({ site: this.siteById(siteId), loaded: Math.round(loaded), unloaded: Math.round(unloaded),
          count: nLoad, cumVol: Math.round(netVol), arrive: arriveEta, day: clock.day,
          wait: waitMax, move: moveMin, buildings: bldgs.size });
      }
      return activity;
    };

    // 出發據點本身即可上貨
    processSite(originId);

    let prevSite = originId;
    for (const site of seq) {
      const drive = this.travelMin(prevSite, site.id, veh.sizeClass);
      // 2.13：本段行駛（含休息用餐）＋抵達後收工保留量須放得進當日額度，否則跨夜
      if (drive > clock.remaining(site.id)) {
        if (!clock.rollover(prevSite)) {
          stopReason = `當日在勤時數已達 ${clock.hrsLabel} 上限且已達最大出勤 ${DB.maxTripDays} 天（2.13）`;
          push(`  <span class="hl">▲ 時間觸頂：${stopReason} → 終點不再延伸（2.3）</span>`);
          break;
        }
        clock.log.forEach(l => push(l)); clock.log.length = 0;
        if (drive > clock.remaining(site.id)) {
          stopReason = '單段行駛已超出單日在勤額度（2.13）';
          push(`  <span class="hl">▲ 時間觸頂：${stopReason} → 終點不再延伸</span>`);
          break;
        }
      }
      // 限制條件 2：指定時刻後不前往受限據點
      if (this.lateArrivalBlocked(site.id, start + clock.dayElapsed + drive)) {
        if (!clock.rollover(prevSite)) {
          stopReason = `${site.name} 抵達晚於 ${DB.noArrivalAfter} 不前往，且已達最大出勤天數`;
          push(`  <span class="hl">▲ ${stopReason} → 終點不再延伸</span>`);
          break;
        }
        clock.log.forEach(l => push(l)); clock.log.length = 0;
        if (this.lateArrivalBlocked(site.id, start + clock.dayElapsed + drive)) {
          stopReason = `${site.name} 即使隔日仍晚於 ${DB.noArrivalAfter}，不前往`;
          push(`  <span class="hl">▲ ${stopReason} → 終點不再延伸</span>`);
          break;
        }
      }
      clock.addDrive(drive);
      clock.log.forEach(l => push(l)); clock.log.length = 0;
      prevSite = site.id;
      processSite(site.id);
    }

    // 終點＝所有已載單送貨據點中最南者（2.3）；無載貨則為出發據點
    let endOrder = this.siteById(originId).order;
    const carried = [...served].map(id => this.orders.find(o => o.id === id)).filter(Boolean);
    carried.forEach(o => { endOrder = Math.min(endOrder, this.siteById(o.dropSite).order); });
    const endpoint = DB.sites.find(s => s.order === endOrder).id;

    return { served, delivered, info, stops, endpoint, clock, peakVol, stopReason, carried, onboard };
  },

  /* 派車：對某台車 + 一批待處理單跑貪婪 / 直達邏輯，回傳決策
     只處理已核准的南下貨；originId 可指定出發據點（2.22，預設主檔 homeSite） */
  dispatch(vehicleId, mode, dispatchDate, originId, by) {
    const r = this._dispatch(vehicleId, mode, dispatchDate, originId);
    r.dispatches = this._toDispatches(dispatchDate, by);
    return r;
  },
  _dispatch(vehicleId, mode, dispatchDate, originId) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    const origin = originId || DB.homeSite; // 2.22：出發據點可為任一據點
    const all = this.orders.filter(o => o.status === 'approved' && this.isSouthbound(o));
    const unservable = all.filter(o => !this.isServable(o, origin));
    unservable.forEach(o => trace.push(`<span class="no">✗ ${o.id} 不排入：${this.unservableReason(o, origin)}</span>`));
    let servable = all.filter(o => this.isServable(o, origin));
    // 2.15 媒合截止：派車日前兩天 12:00；逾時者自動順延至下一個可媒合車次
    const lateOrders = [];
    if (dispatchDate) {
      const cut = this.matchCutoffFor(dispatchDate);
      trace.push(`<span class="dim">媒合截止（2.15）：派車日 ${dispatchDate} 前 ${DB.matchCutoffDaysBefore} 天 ${DB.matchCutoffTime}（${cut.toLocaleString('zh-TW')}）</span>`);
      servable.filter(o => !this.meetsCutoff(o, dispatchDate)).forEach(o => {
        lateOrders.push(o); o.deferredToDate = this.nextDispatchDate(o);
        trace.push(`  <span class="no">✗ ${o.id} 逾媒合截止 → 自動排入下一可媒合車次（${o.deferredToDate || '待排'}），不接受插單</span>`);
      });
      servable = servable.filter(o => this.meetsCutoff(o, dispatchDate));
    }
    const pending = servable.sort((a, b) => a.approvedAt - b.approvedAt); // 核准時間排序（G34）

    // ---- 直達分流（G38/G39）----
    if (mode === 'direct') {
      const directs = pending.filter(o => o.direct);
      if (directs.length === 0) return { trace: ['<span class="dim">目前無直達單。</span>'], mode };
      const targetDest = directs[0].dropSite;         // 一台直達車只服務單一送貨據點（G38）
      const sameDest = directs.filter(o => o.dropSite === targetDest);
      trace.push(`<span class="hl">直達車</span>：鎖定單一目的地 ${this.siteById(targetDest).name}（G38 不湊單、不論貨量），出發據點 ${this.siteById(origin).name}`);
      trace.push(`終點 = 申請單目的地｜純容量加總、不跑貪婪法（G39）`);
      const start = hhmmToMin(DB.shiftStartDefault);
      const directDrive = this.travelMin(origin, targetDest, veh.sizeClass);
      const refDays = this.minTripDaysFor(veh, targetDest);
      const loadOf = o => (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
      // ① 純容量加總決定可載清單（G39：超量整張留下一班；依核准序 G34）
      let load = 0, wt = 0; const cand = [];
      for (const o of sameDest) {
        const ev = this.effVolume(o);
        if (load + ev <= veh.volume && wt + o.weight <= veh.weight) { load += ev; wt += o.weight; cand.push(o); }
        else trace.push(`  <span class="no">✗ ${o.id} 超出容量 → 留下一班直達車（G39）</span>`);
      }
      // ② 抵達迄點時間＝表定出發＋前置＋直達行駛＋本趟各取貨據點上貨總和
      const totalLoadMin = cand.reduce((s, o) => s + loadOf(o), 0);
      const directEta = minToHHMM(start + DB.prepMin + directDrive + totalLoadMin);
      trace.push(`<span class="dim">行駛時間查路程表（2.9）：${this.siteById(origin).name}→${this.siteById(targetDest).name} ${directDrive} 分｜出發 ${DB.shiftStartDefault}＋前置 ${DB.prepMin} 分＋沿途上貨 ${totalLoadMin} 分 → 抵達迄點 ${directEta}`);
      trace.push(`最短天數表（3.1 參考值，不參與運算）：${veh.sizeClass === 'big' ? '大車' : '小車'} → ${this.siteById(targetDest).name} ${refDays != null ? refDays + ' 天' : '（表中無值）'}</span>`);
      // ③ 2.19 收貨時間窗（以行經取貨據點的時間判定，取代舊交貨門檻）＋落實載入
      const carried = [];
      for (const o of cand) {
        const passEta = start + DB.prepMin + this.travelMin(origin, o.pickSite, veh.sizeClass);
        const rc = this.receiveCheck(o, passEta);
        if (!rc.ok) {
          trace.push(`  <span class="no">✗ ${o.id} 行經 ${this.siteById(o.pickSite).name} ${minToHHMM(passEta)}：${rc.reason} → 媒合不到（2.19，急件另派 2.22）</span>`);
          continue;
        }
        o.status = 'loaded'; o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = targetDest;
        o.dispatchOrigin = origin; o.dispatchDir = 'south';
        carried.push(o);
        trace.push(`  <span class="ok">✓ 載入 ${o.id}（申報 ${o.volume}L → 有效 ${this.effVolume(o).toFixed(0)}L${rc.wait ? `，早到等待 ${rc.wait} 分至 ${o.wantReceiveTime}` : ''}）</span>`);
      }
      load = carried.reduce((s, o) => s + this.effVolume(o), 0);
      // ④ 各單「幾點來收」＝車輛南下經過其取貨據點的時間
      let elapsedLoad = 0;
      carried.slice()
        .sort((a, b) => this.siteById(b.pickSite).order - this.siteById(a.pickSite).order || a.approvedAt - b.approvedAt)
        .forEach(o => {
          const pass = start + DB.prepMin + this.travelMin(origin, o.pickSite, veh.sizeClass) + elapsedLoad;
          const w = this.receiveWindow(o);
          o.pickupTime = minToHHMM(w ? Math.max(pass, w.start) : pass);
          elapsedLoad += loadOf(o);
        });
      const reason = `當天有<b>急件直達</b>申請單（最早核准 ${directs[0].id}）→ 獨立派車（3.2/G38）`;
      this.recordVehicleStatus(veh.id, 2, reason, targetDest, '申請單指定目的地');
      return { mode: 'direct', endpoint: targetDest, carried, trace, lateOrders, dispatchDate, origin,
        days: refDays, refDays, urgentDirect: true, reason, modeLabel: this.matrixRowInfo(2).mode, matrixRow: 2,
        capUsed: Math.round(load), capTotal: veh.volume };
    }

    // ---- 非直達貪婪：2.20/2.21 統一媒合（基準路線 → 逐張候選檢查是否排擠）----
    const nonDirect = pending.filter(o => !o.direct);
    trace.push(`<span class="hl">非直達車（貪婪法）</span>：動態淨值＋到送貨據點卸貨釋出容量（G33）；站內外攤平為同一條時間軸（2.20）`);
    trace.push(`出發據點 ${this.siteById(origin).name}（2.22 可為任一據點）｜容量上限 ${veh.volume}L`);
    trace.push(`<span class="dim">時間模型（2.13）：每日在勤上限 ${DB.dailyDutyMin} 分（${DB.dailyDutyMin / 60}h），自表定 ${DB.shiftStartDefault} 起算；`
      + `含前置 ${DB.prepMin} 分、收工 ${DB.closeMin} 分與返回休息地；行駛查路程表（2.9）；站內建物間移動（棟數−1）×${DB.intraSiteMovePerBuildingMin} 分（2.18）；收貨時間窗 ${DB.receiveWindowMin} 分（2.19）；休息用餐依累積行駛觸發（2.12）</span>`);

    // 2.21：先以「不含候選單」為基準，逐張（核准序）納入候選並檢查是否排擠既定行程或卡不進時間窗
    const committed = [];
    const unmatched = [];
    for (const o of nonDirect) {
      const trial = committed.concat(o);
      const sim = this.simulateSouthbound(trial, veh, origin);
      // 2.21：候選單須「不排擠既定行程」——既定行程與候選單皆須完整服務（收得到＋當趟送得到，
      // 送不到終點即屬排擠），且候選單自身卡進 2.19 收貨時間窗。以「已送達 delivered」為準，
      // 避免只上車卻因終點縮短而送不到卻誤判媒合成功。
      const allDelivered = trial.every(x => sim.delivered.has(x.id));
      if (allDelivered) {
        committed.push(o); // 正式媒合
      } else {
        unmatched.push(o); // 排擠既定行程／卡不進時間窗／當趟送不到 → 媒合不到（2.21）
      }
    }

    // 以最終 committed 集合跑一次「有 trace」的正式模擬
    const sim = this.simulateSouthbound(committed, veh, origin, { trace });
    const carried = sim.carried.slice().sort((a, b) => a.approvedAt - b.approvedAt);
    const deliveredHere = [];
    // 落實狀態與時間（依 sim.info）
    for (const o of carried) {
      const inf = sim.info.get(o.id) || {};
      o.status = 'loaded'; o.dispatchVehicle = veh.id; o.dispatchMode = '非直達';
      o.dispatchEndpoint = o.dropSite; o.dispatchOrigin = origin; o.dispatchDir = 'south';
      o.pickupTime = inf.pickupTime; o.dispatchDay = inf.day;
      if (inf.dropTime) { o.dispatchDropTime = inf.dropTime; deliveredHere.push(o); }
    }
    // 媒合不到（2.21）：急件循 2.22 由當地據點另行派車
    unmatched.forEach(o => {
      o.unmatchedReason = o.direct
        ? '既定路線排擠／卡不進收貨時間窗 → 急件由當地據點另行派車（2.21/2.22）'
        : '既定路線排擠／卡不進收貨時間窗 → 媒合不到，順延下一車次（2.21）';
      trace.push(`  <span class="no">✗ ${o.id} ${o.unmatchedReason}</span>`);
    });

    const endpoint = sim.endpoint;
    const peakVol = sim.peakVol;
    const clock = sim.clock;
    const estDays = clock.day;
    const refDays = this.minTripDaysFor(veh, endpoint);
    const daysOver = (refDays != null && estDays > refDays);
    // 3.2 自然直達：非急件、但沿途未停靠任何「中間站」（出發據點與終點以外皆無收送）
    const intermediateStops = sim.stops.filter(st =>
      st.site.id !== origin && st.site.id !== endpoint && (st.count > 0 || st.unloaded > 0));
    const naturalDirect = carried.length > 0 && intermediateStops.length === 0;

    trace.push(`<span class="hl">終點 = ${this.siteById(endpoint).name}｜峰值淨值 ${peakVol.toFixed(0)}L（G32/G33）</span>`);
    trace.push(`<span class="dim">精算出勤 ${estDays} 天（收工含返回休息地 ${clock.closeOut(endpoint)} 分）｜`
      + `最短天數表參考（3.1，不參與運算）：${veh.sizeClass === 'big' ? '大車' : '小車'} → ${refDays != null ? refDays + ' 天' : '（表中無值）'}</span>`);
    if (daysOver) trace.push(`  <span class="b-amber">▲ 本趟預估天數 ${estDays} 天超出表定 ${refDays} 天 → 以精算為準照常派車，僅提醒調度員（3.1）</span>`);
    if (naturalDirect) trace.push(`  <span class="dim">本趟為「自然直達」：時間額度不足以順路停靠，屬排程結果，不觸發獨立派車或回程鎖定（3.2）</span>`);

    const reason = naturalDirect
      ? '無急件直達單；時間額度不足以順路停靠 → 自然直達（3.2，不觸發分流）'
      : '無急件直達單 → 沿線貪婪收送、到迄點卸貨釋出容量（G32/G33）';
    this.recordVehicleStatus(veh.id, 1, reason, endpoint, '已載單最南送貨據點');
    return { mode: 'greedy', endpoint, carried, delivered: deliveredHere, stops: sim.stops, trace,
      days: estDays, refDays, daysOver, naturalDirect, stopReason: sim.stopReason, lateOrders, dispatchDate, origin,
      unmatched, reason, modeLabel: this.matrixRowInfo(1).mode, matrixRow: 1,
      capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: clock.dayElapsed, timeTotal: DB.dailyDutyMin, dutyDays: estDays,
      breaks: clock.breaksTaken };
  },

  /* 回程北上路徑：從折返據點沿南北順序北上到出發據點前（B-1 homeSite）*/
  returnPath(turnaroundId) {
    const startOrder = this.siteById(turnaroundId).order;
    const home = this.homeOrder();
    return DB.sites.filter(s => s.order >= startOrder && s.order < home).sort((a, b) => a.order - b.order);
  },

  /* ---- B-5 回程全域直達「撞期」判定（3.4/G40）：三條件 ----
     ① 路線重疊 ② 已核准未載 ③ 時間：行經上車據點時間落在該單收貨時間窗內（2.19，取代舊交貨門檻） */
  collidesReturnDirect(o, turnaroundId) {
    const turnOrder = this.siteById(turnaroundId).order;
    const home = this.homeOrder();
    const po = this.siteById(o.pickSite).order, dr = this.siteById(o.dropSite).order;
    const oMin = Math.min(po, dr), oMax = Math.max(po, dr);
    if (!(oMin < home && oMax > turnOrder)) return { hit: false, why: '路線區間不重疊' };
    const passEta = hhmmToMin(DB.shiftStartDefault) + DB.prepMin + this.travelMin(turnaroundId, o.pickSite, null);
    const rc = this.receiveCheck(o, passEta);
    if (!rc.ok) return { hit: false, why: rc.reason };
    return { hit: true, passEta: minToHHMM(rc.wait ? hhmmToMin(o.wantReceiveTime) : passEta) };
  },

  /* ---- 回程派車：全域直達鎖定 + 五列決策矩陣（G36/G40/G41/G42/G43）---- */
  dispatchReturn(vehicleId, turnaroundId, originallyDirect, startNet, dispatchDate, by) {
    const r = this._dispatchReturn(vehicleId, turnaroundId, originallyDirect, startNet);
    r.dispatches = this._toDispatches(dispatchDate, by);
    return r;
  },

  /* ================= 派車調度：單一媒合按鈕（G117）=================
     依序執行原四種派車：① 去程直達（逐一目的地）② 去程非直達（貪婪）③ 直達車回程（矩陣第 5 列，僅記錄狀態）
     ④ 回程非直達（含全域直達鎖定檢查）；車型依 2.17 當日總貨量自動選。新裝載的單依「同一台車」併入派車單。 */
  runMatch(dispatchDate, by) {
    const steps = [], trace = [];
    const pending = (leg, direct) => this.orders.filter(o => o.status === 'approved' && (direct == null || !!o.direct === direct)
      && (leg === 'north' ? !this.isSouthbound(o) : this.isSouthbound(o)) && this.isServable(o)
      && (leg === 'north' || !dispatchDate || this.meetsCutoff(o, dispatchDate)));
    const run = (label, fn) => { const r = fn(); steps.push({ label, r }); trace.push(`<span class="hl">【${label}】</span>`, ...r.trace, ''); return r; };
    const directVeh = new Set();
    // 去程各趟不可同時用同一台車：當日已排去程（含先前媒合的派車單）的車輛改派另一台幹線車；無車可派即停止並註明
    const southUsed = new Set(this.liveDispatches().filter(d => d.date === dispatchDate)
      .filter(d => this.dispatchOrders(d).some(o => o.dispatchDir === 'south')).map(d => d.vehicle));
    const pickSouth = (mode, label) => {
      const dec = this.decideSizeClass(mode, dispatchDate, null, 'south');
      if (!southUsed.has(dec.vehicle)) return dec;
      const alt = DB.vehicles.filter(v => v.pool === 'LOGI' && v.sizeClass && !southUsed.has(v.id))
        .sort((a, b) => (a.sizeClass === dec.sizeClass ? 0 : 1) - (b.sizeClass === dec.sizeClass ? 0 : 1))[0];
      if (!alt) { trace.push(`<span class="no">✗ ${label}：當日幹線車皆已排去程，其餘待派託運單留待其他派車日</span>`, ''); return null; }
      return Object.assign({}, dec, { vehicle: alt.id, sizeClass: alt.sizeClass, reason: `${dec.reason}；${dec.vehicle} 已排去程 → 改派 ${alt.id}` });
    };
    for (let i = 0; i < 10 && pending('south', true).length; i++) {
      const dec = pickSouth('direct', '去程直達'); if (!dec) break;
      const r = run('去程直達', () => this._dispatch(dec.vehicle, 'direct', dispatchDate));
      r.sizeDecision = dec;
      if (!(r.carried || []).length) break;
      directVeh.add(dec.vehicle); southUsed.add(dec.vehicle);
    }
    for (let i = 0; i < 10 && pending('south', false).length; i++) {
      const dec = pickSouth('greedy', '去程非直達'); if (!dec) break;
      const r = run('去程非直達（貪婪）', () => this._dispatch(dec.vehicle, 'greedy', dispatchDate));
      r.sizeDecision = dec;
      if (!(r.carried || []).length) break;
      southUsed.add(dec.vehicle);
    }
    directVeh.forEach(v => run('直達車回程', () => this._dispatchReturn(v, DB.homeSite, true, 0)));
    for (let i = 0; i < 10 && pending('north').length; i++) {
      const rets = pending('north');
      const turnaround = rets.reduce((min, o) => this.siteById(o.pickSite).order < this.siteById(min).order ? o.pickSite : min, rets[0].pickSite);
      let dec = this.decideSizeClass('greedy', null, null, 'north');
      if (directVeh.has(dec.vehicle)) {   // 直達車回程不停靠（矩陣第 5 列），回程收送改用其他幹線車
        const alt = DB.vehicles.find(v => v.pool === 'LOGI' && v.sizeClass && !directVeh.has(v.id));
        if (!alt) { trace.push('<span class="no">✗ 回程非直達：幹線車皆為直達車（回程不停靠），北上託運單留待其他派車日</span>', ''); break; }
        dec = Object.assign({}, dec, { vehicle: alt.id, sizeClass: alt.sizeClass, reason: `${dec.reason}；${dec.vehicle} 為直達車回程不停靠 → 改派 ${alt.id}` });
      }
      const r = run('回程非直達', () => this._dispatchReturn(dec.vehicle, turnaround, false, 0));
      r.sizeDecision = dec;
      if (!(r.carried || []).length) break;
    }
    const dispatches = this._toDispatches(dispatchDate, by);
    const carried = steps.flatMap(x => x.r.carried || []);
    trace.push(`媒合完成：派車 ${carried.length} 張｜產生／併入派車單 ${dispatches.map(d => d.id).join('、') || '（無）'}（未送審；調度確認後送出運輸主管簽審）`);
    return { steps, trace, carried, dispatches, last: steps.length ? steps[steps.length - 1].r : null };
  },

  /* ================= 派車單（G117–G119）================= */
  dispatchOf(o) { return o.dispatchId ? this.dispatches.find(d => d.id === o.dispatchId && !d.cancelled) || null : null; },
  dispatchOrders(d) { return d.apps.map(id => this.orders.find(o => o.id === id)).filter(Boolean); },
  liveDispatches() { return this.dispatches.filter(d => !d.cancelled); },
  driversOf(o) { return [o.dispatchDriver, o.dispatchDriver2].filter(Boolean); },
  _dlog(d, action, by, note) { d.log.push({ at: new Date(), action, by: by || '調度室', note: note || '' }); },
  _todayStr() { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; },
  _applyToOrders(d) {
    this.dispatchOrders(d).forEach(o => { o.dispatchVehicle = d.vehicle; o.dispatchDriver = d.driver1 || null; o.dispatchDriver2 = d.driver2 || null; o.dispatchId = d.id; });
  },
  // 預設駕駛人1：當日尚未被其他派車單使用的物流池駕駛
  _freeLogiDriver(date, exceptId) {
    const used = new Set(this.liveDispatches().filter(d => d.date === date && d.id !== exceptId).flatMap(d => [d.driver1, d.driver2]));
    const lv = id => DB.driverLeaves.some(l => l.driver === id && l.date === date);
    const d = DB.drivers.find(x => x.pool === 'LOGI' && !used.has(x.id) && !lv(x.id));
    return d ? d.id : '';
  },
  // 新裝載（尚無派車單）的單依車輛併入當日派車單；同車已有派車單（未出車）則併入，已送審者新單一併送簽
  _toDispatches(date, by) {
    date = date || this._todayStr();
    const groups = {};
    this.orders.filter(o => o.status === 'loaded' && !o.dispatchId && o.dispatchVehicle)
      .forEach(o => (groups[o.dispatchVehicle] = groups[o.dispatchVehicle] || []).push(o));
    return Object.entries(groups).map(([vid, list]) => {
      let d = this.liveDispatches().find(x => x.date === date && x.vehicle === vid && !this.started(x));
      if (d) {
        list.forEach(o => d.apps.push(o.id));
        this._dlog(d, '媒合併入', by, list.map(o => o.id).join('、'));
      } else {
        const v = DB.vehicles.find(x => x.id === vid);
        d = { id: 'TD' + String(this.dispatchSeq++).padStart(3, '0'), date, vehicleType: v ? v.type : '', vehicle: vid,
          driver1: this._freeLogiDriver(date), driver2: '', dispatcher: by || '調度室', dispatchedAt: new Date(),
          submitted: false, apps: list.map(o => o.id), cancelled: false, log: [] };
        this.dispatches.push(d);
        this._dlog(d, '媒合產生', by, list.map(o => o.id).join('、'));
      }
      this._applyToOrders(d);
      if (d.submitted) list.forEach(o => Signoff.mark(o, this.signSummary(o), by || '調度室'));
      return d;
    });
  },
  started(d) { return this.dispatchOrders(d).some(o => Flow.departed(o, this)); },   // 已出車即不可異動
  /* 資源檢核：車種與車號相符、容積／載重足夠（有效體積）、駕駛不同人、請假、當日其他派車單撞車撞人 */
  dispatchResourceError(d, f) {
    const list = this.dispatchOrders(d);
    const v = DB.vehicles.find(x => x.id === f.vehicle && x.pool === 'LOGI');
    if (!f.vehicleType) return '請選擇「車種類型」';
    if (!v) return '請選擇物流池的「車號」';
    if (v.type !== f.vehicleType) return '車號與車種類型不符';
    const vol = list.reduce((s, o) => s + this.effVolume(o), 0), wt = list.reduce((s, o) => s + (+o.weight || 0), 0);
    if (vol > v.volume) return `${v.id} 容積 ${Math.round(v.volume)}L 不足本派車單有效體積 ${Math.round(vol)}L`;
    if (wt > v.weight) return `${v.id} 載重 ${v.weight}kg 不足本派車單 ${wt}kg`;
    if (!f.driver1) return '請選擇「駕駛人1」';
    if (f.driver2 && f.driver2 === f.driver1) return '駕駛人1 與駕駛人2 不可為同一人';
    const ds = [f.driver1, f.driver2].filter(Boolean);
    for (const id of ds) if (!DB.drivers.some(x => x.id === id && x.pool === 'LOGI')) return `駕駛 ${id} 不在物流池`;
    const others = this.liveDispatches().filter(x => x.id !== d.id && x.date === d.date);
    const vHit = others.find(x => x.vehicle === v.id);
    if (vHit) return `${v.id} 已由派車單 ${vHit.id}（${d.date}）使用`;
    const nm = id => (DB.drivers.find(x => x.id === id) || {}).name || id;
    for (const id of ds) {
      const dHit = others.find(x => [x.driver1, x.driver2].includes(id));
      if (dHit) return `${nm(id)} 已有派車單 ${dHit.id}（${d.date}）任務`;
      const lv = DB.driverLeaves.find(l => l.driver === id && l.date === d.date);
      if (lv) return `${nm(id)} 請假 ${lv.date} ${lv.from}~${lv.to}`;
    }
    return null;
  },
  /* 調度異動派車單：f = { vehicleType, vehicle, driver1, driver2, submitted }（G118）
     否 → 是＝送運輸主管簽審；是 → 否＝撤回簽審；已送審者異動車輛／駕駛重新送簽；已有單交貨者不可異動 */
  updateDispatch(d, f, by) {
    if (d.cancelled) return { ok: false, error: '派車單已取消' };
    if (this.started(d)) return { ok: false, error: '派車單已出車，不可再異動' };
    const v = DB.vehicles.find(x => x.id === f.vehicle);
    const next = { vehicleType: f.vehicleType || (v ? v.type : ''), vehicle: f.vehicle, driver1: f.driver1, driver2: f.driver2 || '',
      submitted: f.submitted == null ? d.submitted : !!f.submitted };
    const err = this.dispatchResourceError(d, next);
    if (err) return { ok: false, error: err };
    const changed = ['vehicleType', 'vehicle', 'driver1', 'driver2'].filter(k => (d[k] || '') !== (next[k] || ''));
    const wasSub = d.submitted;
    if (!changed.length && wasSub === next.submitted) return { ok: true, changed: [] };
    const before = `${d.vehicle}／${[d.driver1, d.driver2].filter(Boolean).join('＋') || '—'}`;
    Object.assign(d, next);
    this._applyToOrders(d);
    const list = this.dispatchOrders(d);
    if (changed.length) this._dlog(d, '異動', by, `${before} → ${d.vehicle}／${[d.driver1, d.driver2].filter(Boolean).join('＋')}`);
    if (!wasSub && next.submitted) { list.forEach(o => Signoff.mark(o, this.signSummary(o), by || '調度室')); this._dlog(d, '送審', by, '送出運輸主管簽審'); }
    else if (wasSub && !next.submitted) { list.forEach(o => Signoff.release(o, `派車單 ${d.id} 撤回送審`, by || '調度室')); this._dlog(d, '撤回送審', by, ''); }
    else if (wasSub && changed.length) list.forEach(o => Signoff.mark(o, this.signSummary(o) + '（派車單異動）', by || '調度室'));
    return { ok: true, changed };
  },
  submitDispatch(d, by) {
    return this.updateDispatch(d, { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: d.driver2, submitted: true }, by);
  },
  DISPATCH_FIELDS: ['dispatchVehicle', 'dispatchMode', 'dispatchEndpoint', 'dispatchOrigin', 'dispatchDir', 'pickupTime', 'dispatchDay', 'dispatchDropTime', 'dispatchDriver', 'dispatchDriver2', 'manualAssigned'],
  _detach(o, reason, by) {
    const d = this.dispatchOf(o);
    if (d) {
      d.apps = d.apps.filter(id => id !== o.id);
      this._dlog(d, '移出託運單', by, `${o.id}${reason ? '：' + reason : ''}`);
      if (!d.apps.length) { d.cancelled = true; this._dlog(d, '取消', by, '派車單已無託運單'); }
    }
    o.dispatchId = null;
    this.DISPATCH_FIELDS.forEach(k => { o[k] = null; });
  },
  /* ---- 手動指派（G127）：調度於派車調度明細頁對「待調度」申請單手動派車 ----
     · manualAssign：指定車種類型／車號／駕駛人1／駕駛人2，產生一張未送審（暫存）的派車單；
     · manualMerge：併入同一派車日、尚未送審且未出車的派車單（沿用該派車單的車輛與駕駛）。
     兩者皆做資源檢核（容積／載重、車號與車種、駕駛不同人、請假、當日其他派車單撞車撞人）。
     手動指派不重算路線時間：收貨時間暫取申請人希望收貨時間，派遣模式依申請單（急件＝直達）。 */
  manualTargets(date) { return this.liveDispatches().filter(d => d.date === date && !d.submitted && !this.started(d)); },
  _applyManual(o) {
    o.status = 'loaded'; o.dispatchMode = o.direct ? '直達' : '非直達';
    o.dispatchDir = this.isSouthbound(o) ? 'south' : 'north'; o.dispatchOrigin = o.pickSite; o.dispatchEndpoint = o.dropSite;
    o.pickupTime = o.wantReceiveTime || null; o.dispatchDay = 1; o.dispatchDropTime = null; o.manualAssigned = true;
  },
  manualAssign(o, date, f, by) {
    if (o.status !== 'approved') return { ok: false, error: '僅「待調度」的申請單可手動指派' };
    if (!date) return { ok: false, error: '請指定派車日' };
    const v = DB.vehicles.find(x => x.id === f.vehicle);
    const d = { id: 'TD' + String(this.dispatchSeq).padStart(3, '0'), date, vehicleType: f.vehicleType || (v ? v.type : ''), vehicle: f.vehicle,
      driver1: f.driver1 || '', driver2: f.driver2 || '', dispatcher: by || '調度室', dispatchedAt: new Date(),
      submitted: false, apps: [o.id], cancelled: false, manual: true, log: [] };
    const err = this.dispatchResourceError(d, d);
    if (err) return { ok: false, error: err };
    this.dispatchSeq++;
    this.dispatches.push(d);
    this._applyManual(o); this._applyToOrders(d);
    this._dlog(d, '手動指派產生', by, o.id);
    return { ok: true, dispatch: d };
  },
  manualMerge(o, d, by) {
    if (o.status !== 'approved') return { ok: false, error: '僅「待調度」的申請單可手動指派' };
    if (!d || !this.manualTargets(d.date).includes(d)) return { ok: false, error: '只能併入尚未送審、未出車的派車單' };
    const err = this.dispatchResourceError(Object.assign({}, d, { apps: d.apps.concat(o.id) }), d);
    if (err) return { ok: false, error: err };
    d.apps.push(o.id);
    this._applyManual(o); this._applyToOrders(d);
    this._dlog(d, '手動併入', by, o.id);
    return { ok: true, dispatch: d };
  },
  /* 無車退回（G122）：僅「待調度」的託運單；原因必填，結案不可再動 */
  canReturn(o) { return o.status === 'approved'; },
  returnOrder(o, note, by) {
    note = (note || '').trim();
    if (!this.canReturn(o)) return { ok: false, error: '僅「待調度」的託運單可無車退回' };
    if (!note) return { ok: false, error: '無車退回時「退回原因」為必填' };
    o.status = 'noCar'; o.approvedAt = null; o.noCarNote = note; o.noCarBy = by || '調度室'; o.noCarAt = new Date();
    return { ok: true };
  },
  /* 移出派車單（調度中、未送審）：回「待調度」 */
  unassign(o, by) {
    const d = this.dispatchOf(o);
    if (!d || o.status !== 'loaded') return { ok: false, error: '此託運單不在派車單內' };
    if (d.submitted) return { ok: false, error: '派車單已送審，請先將是否送審改為「否」' };
    this._detach(o, '移出派車單', by);
    o.status = 'approved';
    return { ok: true };
  },
  _dispatchReturn(vehicleId, turnaroundId, originallyDirect, startNet) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    startNet = startNet || 0;
    const path = this.returnPath(turnaroundId);
    const endpoint = DB.homeSite; // 回程固定回出發據點（G36/B-1）
    const allReturn = this.orders.filter(o => o.status === 'approved' && !this.isSouthbound(o));
    allReturn.filter(o => !this.isServable(o))
      .forEach(o => trace.push(`<span class="no">✗ ${o.id} 不排入：${this.unservableReason(o)}</span>`));
    const returnOrders = allReturn.filter(o => this.isServable(o)).sort((a, b) => a.approvedAt - b.approvedAt);

    // 矩陣第 5 列：回程・原本就是直達車 → 純容量加總、不停靠（3.3）
    if (originallyDirect) {
      trace.push(`<span class="hl">回程・原本就是直達車</span>：純容量加總、全程不停靠、終點＝出發據點（矩陣第 5 列）`);
      trace.push(`  <span class="dim">直達車回程不沿途收送，直接返回 ${this.siteById(endpoint).name}</span>`);
      const reason5 = '去程即為直達車，回程延續直達承諾（3.3）';
      this.recordVehicleStatus(veh.id, 5, reason5, endpoint, '出發據點');
      return { mode: 'return-direct', matrixRow: 5, modeLabel: this.matrixRowInfo(5).mode,
        endpoint, carried: [], deferred: [], trace, days: '—',
        reason: reason5, capUsed: startNet, capTotal: veh.volume, locked: true };
    }

    // 非直達回程車：先做全域直達檢查（G40/B-5 三條件）
    trace.push(`回程全域直達檢查（G40/B-5）：路段 ${path.map(s => s.name).join('→')}→${this.siteById(endpoint).name}｜條件＝路線重疊＋已核准未載＋收貨時間窗（2.19）`);
    const collide = [], collideInfo = {};
    returnOrders.filter(o => o.direct).forEach(o => {
      const c = this.collidesReturnDirect(o, turnaroundId);
      if (c.hit) { collide.push(o); collideInfo[o.id] = c; }
      else trace.push(`  <span class="dim">直達單 ${o.id} 不構成撞期：${c.why}</span>`);
    });
    const nonDirectReturn = returnOrders.filter(o => !o.direct && path.some(s => s.id === o.pickSite));

    let net = startNet, wt = 0;
    const carried = [], deferred = [], stops = [];

    if (collide.length > 0) {
      // 矩陣第 4 列：回程・被迫鎖定直達
      trace.push(`  <span class="hl">▲ 發現撞期直達單 ${collide.map(o => o.id).join(', ')}（路線重疊＋收貨時間窗成立）→ 路段鎖定直達（G40）</span>`);
      trace.push(`  容量延續動態淨值（G41，不切換 3.3），不收新的非直達貨，仍依序經過沿線據點`);
      for (const o of collide) {
        const ev = this.effVolume(o);
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight) {
          net += ev; wt += o.weight; carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = endpoint;
          o.dispatchDir = 'north';
          o.pickupTime = collideInfo[o.id].passEta;
          trace.push(`  <span class="ok">✓ 載直達回程單 ${o.id}（${this.siteById(o.pickSite).name} 上車 ${o.pickupTime}，有效 ${ev.toFixed(0)}L）淨值 ${net.toFixed(0)}L</span>`);
        }
      }
      nonDirectReturn.forEach(o => { deferred.push(o); trace.push(`  <span class="no">✗ 非直達回程單 ${o.id} 被鎖定排擠 → 自動順延下一趟（G42）</span>`); });
      const reason4 = `回程路段存在撞期直達單 ${collide.map(o => o.id).join(', ')}（路線重疊＋收貨時間窗成立 G40/B-5）`;
      this.recordVehicleStatus(veh.id, 4, reason4, endpoint, '出發據點');
      return { mode: 'return-locked', matrixRow: 4, modeLabel: this.matrixRowInfo(4).mode,
        endpoint, carried, deferred, stops, trace, days: '—',
        reason: reason4, capUsed: Math.round(net), capTotal: veh.volume, locked: true };
    }

    // 矩陣第 3 列：回程・非直達且無撞期 → 動態淨值、沿路收送＋到迄點卸貨釋出容量
    trace.push(`  <span class="ok">無撞期直達單 → 沿路收送回程貨、到送貨據點卸貨釋出容量（G33/G40）；站內外同一條時間軸（2.20）</span>`);
    let prevSite = turnaroundId;
    let peakVol = startNet;
    const onboard = [];
    const clock = this.newDutyClock(veh.sizeClass);   // 2.13 回程亦以在勤模型計算
    const start = hhmmToMin(DB.shiftStartDefault);
    const bkey = (loc) => 'B:' + (loc || '·');
    const etaAt = () => minToHHMM(start + clock.dayElapsed);
    for (const site of path) {
      const drive = this.travelMin(prevSite, site.id, veh.sizeClass);
      if (drive > clock.remaining(site.id) && !clock.rollover(prevSite)) {
        trace.push(`  <span class="hl">▲ 回程當日在勤時數觸頂且已達最大出勤天數（2.13）→ 不再沿途收送</span>`);
        break;
      }
      clock.addDrive(drive);
      clock.log.forEach(l => trace.push(l)); clock.log.length = 0;
      prevSite = site.id;
      const arriveMin = start + clock.dayElapsed;
      const arriveEta = minToHHMM(arriveMin);
      const bldgs = new Set();
      let unloaded = 0, stopLoaded = 0, nLoad = 0, waitMax = 0;
      // 卸貨：車上以本站為送貨據點（迄）者 → 釋出容量
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          net -= ev; wt -= o.weight; clock.addWork(o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = arriveEta;
          bldgs.add(bkey(o.deliverLoc));
        }
      }
      // 裝貨：本站為收貨據點（起）者
      const here = nonDirectReturn.filter(o => o.pickSite === site.id && o.status === 'approved');
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 2.19 收貨時間窗（取代舊交貨門檻）：早到等待、晚到窗內仍可、超窗＝順延
        const rc = this.receiveCheck(o, arriveMin);
        if (!rc.ok) {
          trace.push(`  <span class="no">✗ ${o.id} ${rc.reason} → 順延下一趟（2.19）</span>`);
          deferred.push(o); continue;
        }
        // 限制條件 3：受限據點之回程媒合，裝貨須於指定時間前完成
        if (!this.returnLoadDeadlineOk(site.id, arriveMin + rc.wait + lt)) {
          trace.push(`  <span class="no">✗ ${o.id} 於 ${site.name} 裝貨無法於 ${this.siteById(site.id).returnLoadBy} 前完成 → 順延下一趟（限制條件 3）</span>`);
          deferred.push(o); continue;
        }
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight) {
          net += ev; wt += o.weight; clock.addWork(lt); stopLoaded += ev; nLoad++;
          carried.push(o); onboard.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = o.dropSite;
          o.dispatchDir = 'north';
          const w = this.receiveWindow(o);
          o.pickupTime = minToHHMM(w ? Math.max(arriveMin, w.start) : arriveMin);
          waitMax = Math.max(waitMax, rc.wait);
          bldgs.add(bkey(o.pickupLoc));
        } else {
          deferred.push(o);
        }
      }
      // 收貨等待（2.19）＋站內移動（2.18）計入在勤
      if (waitMax) clock.addWork(waitMax);
      const moveMin = this.intraSiteMoveMin(bldgs.size);
      if (moveMin) clock.addWork(moveMin);
      peakVol = Math.max(peakVol, net);
      stops.push({ site, loaded: Math.round(stopLoaded), unloaded: Math.round(unloaded), count: nLoad, cumVol: Math.round(net) });
      trace.push(`  ${site.name}：`
        + (unloaded ? `<span class="b-amber">卸 ${unloaded.toFixed(0)}L</span> ` : '')
        + (stopLoaded ? `<span class="ok">收 ${stopLoaded.toFixed(0)}L</span> ` : (unloaded ? '' : '<span class="dim">無回程貨</span> '))
        + `→ 淨值 ${net.toFixed(0)}L／當日在勤 ${clock.dayElapsed} 分`);
    }
    // 抵達終點（出發據點）：卸下以基地為送貨據點者
    clock.addDrive(this.travelMin(prevSite, endpoint, veh.sizeClass));
    clock.log.forEach(l => trace.push(l)); clock.log.length = 0;
    const homeEta = etaAt();
    let homeUnloaded = 0;
    for (let i = onboard.length - 1; i >= 0; i--) {
      const o = onboard[i];
      if (o.dropSite === endpoint) {
        const ev = this.effVolume(o);
        net -= ev; wt -= o.weight; clock.addWork(o.unloadMin || 0);
        homeUnloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = homeEta;
      }
    }
    if (homeUnloaded) trace.push(`  ${this.siteById(endpoint).name}（終點）：<span class="b-amber">卸 ${homeUnloaded.toFixed(0)}L</span> → 淨值 ${net.toFixed(0)}L／當日在勤 ${clock.dayElapsed} 分`);
    trace.push(`  <span class="hl">回程終點＝${this.siteById(endpoint).name}（G36），峰值淨值 ${peakVol.toFixed(0)}L</span>`);
    const reason3 = '回程無撞期直達單 → 動態淨值沿路收送、到迄點卸貨（G33/G40）';
    this.recordVehicleStatus(veh.id, 3, reason3, endpoint, '出發據點');
    return { mode: 'return-greedy', matrixRow: 3, modeLabel: this.matrixRowInfo(3).mode,
      endpoint, carried, deferred, stops, trace, days: '—',
      reason: reason3, capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: clock.dayElapsed, timeTotal: DB.dailyDutyMin, dutyDays: clock.day,
      breaks: clock.breaksTaken, locked: false };
  },
};
