/* ============================================================
   moduleB.js — 模組 B：跨據點南北幹線物流
   PLAN.md Phase 4 / Guardrails G30–G44
   貪婪終點判斷、直達/非直達分流、動態淨值容量、天數對照表
   B-1：出發據點走主檔 DB.homeSite；B-2：無 leg 欄位（方向由起迄推導）、
   無 accepted 狀態；B-3：時間上限依天數對照表動態決定；
   B-4：五列決策矩陣單一決策表；B-5：回程撞期三條件判定；
   B-6：vehicleStatus 記錄每車派遣模式與觸發原因
   ============================================================ */

const ModuleB = {
  orders: [],  // 幹線申請單
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

  /* B-2：方向由起迄推導（非申請人勾選）——送貨據點較南（order 較小）＝南下貨、較北＝北上貨 */
  isSouthbound(o) { return this.siteById(o.dropSite).order < this.siteById(o.pickSite).order; },

  /* ---- 可服務範圍：基地（homeSite）及其以南 ----
     現行車次模型為「自基地南下、折返北上回基地」，故基地以北據點不在任何一趟路線上。
     基地若設於中段（如 D9 龍潭），北側據點（D10）的排班方式為 TODO B-2「待業務確認」項目，
     在政策確定前一律不排入，並於 trace 明確說明，避免靜默載走卻無法卸貨。 */
  isServable(o) {
    const home = this.homeOrder();
    return this.siteById(o.pickSite).order <= home && this.siteById(o.dropSite).order <= home;
  },
  unservableReason(o) {
    const home = this.siteById(DB.homeSite);
    const bad = [];
    if (this.siteById(o.pickSite).order > home.order) bad.push(`收貨據點 ${this.siteById(o.pickSite).name}`);
    if (this.siteById(o.dropSite).order > home.order) bad.push(`送貨據點 ${this.siteById(o.dropSite).name}`);
    return `${bad.join('、')} 位於基地 ${home.name} 以北，現行「自基地南下折返」車次模型未涵蓋（北側排班方式待業務確認）`;
  },

  // site＝收貨據點（起）、destSite＝送貨據點（迄）；申請端只負責建立，狀態為「待審核」
  // 幹線貨物多筆項目，每筆填獨立尺寸與重量（品名/長寬高/類別/數量/單件重），比照模組 A（G13）
  // 整張表單為裝載最小單位（G34）；相容：若帶 volume 而無尺寸則以整批貨量計（demo/測試）
  createOrder(data) {
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
    const o = {
      id: 'LB' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      pickSite,                            // 收貨據點（起）
      dropSite,                            // 送貨據點（迄）
      pickupLoc: data.pickupLoc || '',     // 收貨地點（收貨據點內建物/位置）
      deliverLoc: data.deliverLoc || '',   // 送貨地點（送貨據點內建物/位置）
      deliverTime: data.deliverTime || '', // 交貨時間 幾點交貨 HH:MM（接進派車：抵達迄點須不晚於此）
      recipient: data.recipient || {},     // 接收人資訊：{ unit, name, phone, agentName, agentPhone }
      direct: !!data.direct,   // 3.2 急件直達（申請人指定）＝派車輸入條件，觸發獨立派車與回程鎖定
      items,                 // 貨物項目清單
      loadMin, unloadMin,    // 上貨/下貨時間（分）
      handleMin,             // 裝卸時間＝上貨＋下貨（G35）
      approvedAt: null,
      status: 'submitted',  // submitted → approved/rejected →（派車）loaded →（確認收到）delivered（B-2 無 accepted）
      createdAt: new Date(),
    };
    this.recompute(o);      // 由 items 加總 volume/weight/有效體積
    this.orders.push(o);
    return o;
  },

  // 由貨物項目清單重算整單彙總值（新增或編輯後呼叫）
  // 有尺寸的項目沿用共用引擎 itemEffective（體積×類別係數×形狀懲罰，比照 A）；
  // 僅帶整批貨量者以 volume×類別係數計（相容 demo/測試）
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

  /* ---- 2.14 媒合截止：派車日前兩天中午 12:00 ----
     截止後送出之申請單不接受插單，自動排入「下一個可媒合車次」。
     now() 可注入以利測試。 */
  now() { return new Date(); },
  /* 回傳指定派車日的媒合截止時點（Date） */
  matchCutoffFor(dispatchDate) {
    const d = new Date(dispatchDate + 'T00:00:00');
    d.setDate(d.getDate() - DB.matchCutoffDaysBefore);
    const [h, m] = DB.matchCutoffTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  },
  /* 此單能否趕上該派車日的媒合（以送出時間 createdAt 判定）*/
  meetsCutoff(o, dispatchDate) {
    return new Date(o.createdAt) <= this.matchCutoffFor(dispatchDate);
  },
  /* 逾時者的下一個可媒合派車日：自送出時間起，找第一個截止時點仍在其後的日期 */
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

  // 交貨確認（loaded → delivered）：接收人確認收到，或調度/駕駛回報送達（B-2 移除 accepted 中間步驟）
  confirmDelivery(o, by) { if (o.status === 'loaded') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.deliveredBy = by || '調度室'; } },

  /* ---- 2.9 據點相互路程表查表（取代單一常數×段數）---- */
  travelMin(fromId, toId) {
    if (fromId === toId) return 0;
    const t = DB.siteTravel[fromId + '|' + toId];
    return t != null ? t : DB.siteTravel[toId + '|' + fromId] || 0;
  },
  /* 2.13 收工後「返回休息地」：自目前位置至最近休息會館之行駛時間 */
  returnToRestMin(siteId) {
    return DB.restHouses.reduce((m, r) => Math.min(m, this.travelMin(siteId, r.id)), Infinity) || 0;
  },

  /* ---- 3.1 最短天數表：依 車型 × 目的地 查表 ----
     ★ 寬鬆估計值，僅供排班參考顯示；不參與運算、不限制 12.5 小時精算結果。 */
  minTripDaysFor(vehicle, endpointId) {
    const cls = (vehicle && vehicle.sizeClass) || 'small';
    const table = DB.minTripDays[cls] || {};
    return table[endpointId] || null; // 查無 → 不顯示參考值（不代入預設，避免假裝有資料）
  },

  /* ---- 2.13 每日在勤時數模型（12.5 小時，自到班起算）----
     建立一個逐段累計器：行駛／裝卸推進當日在勤時數；行駛另計「純行駛時數線」以觸發 2.12 休息用餐；
     當日額度（含收工緩衝與返回休息地保留量）不足即跨夜 → 隔日在勤與行駛時數線同時歸零。 */
  newDutyClock() {
    const self = this;
    return {
      day: 1,
      dayElapsed: DB.prepMin,   // 出勤前緩衝（車輛檢查＋前往報到）
      driveMin: 0,              // 當日純累積行駛（2.12 觸發基準，不含休息/用餐/裝卸）
      breaksTaken: [],          // 當日已觸發之休息/用餐
      log: [],
      /* 當日剩餘可用時數＝12.5h − 已用 − 收工緩衝 − 自 atSite 返回休息地 */
      remaining(atSite) {
        return DB.dailyDutyMin - this.dayElapsed - DB.closeMin - self.returnToRestMin(atSite);
      },
      /* 跨夜：隔日在勤與行駛時數線歸零（2.12 每日重新歸零）*/
      rollover(atSite) {
        if (this.day >= DB.maxTripDays) return false;
        this.day++; this.dayElapsed = DB.prepMin; this.driveMin = 0; this.breaksTaken = [];
        this.log.push(`  <span class="hl">🌙 於 ${self.siteById(atSite) ? self.siteById(atSite).name : atSite} 過夜 → 第 ${this.day} 天（在勤與行駛時數線歸零 2.12）</span>`);
        return true;
      },
      /* 加一段行駛，並依 2.12 觸發休息/用餐（純行駛時數線，共用不歸零） */
      addDrive(min) {
        const before = this.driveMin;
        this.driveMin += min; this.dayElapsed += min;
        let extra = 0;
        DB.driverBreaks.forEach(b => {
          if (before < b.afterDriveMin && this.driveMin >= b.afterDriveMin) {
            extra += b.costMin; this.breaksTaken.push(b.kind);
            this.log.push(`  <span class="dim">☕ 累積行駛 ${this.driveMin} 分 → 觸發${b.kind} ${b.costMin} 分（計入 12.5h 上限 2.12）</span>`);
          }
        });
        this.dayElapsed += extra;   // 休息/用餐計入在勤，但不計入純行駛時數線
        return min + extra;
      },
      addWork(min) { this.dayElapsed += min; }, // 裝卸貨
      /* 收工總時數（含收工緩衝與返回休息地） */
      closeOut(atSite) { return this.dayElapsed + DB.closeMin + self.returnToRestMin(atSite); },
    };
  },

  /* 有效體積＝各項貨量 × 該項類別浪費係數 加總（沿用共用係數 Provider，G01/G03，A/B 共用）
     幹線容量僅做 Level 1 係數修正＋重量，不做 Level 2 維度檢查（已回填規格 2.10） */
  effVolume(o) { return o.effVol != null ? o.effVol : o.volume * WasteFactorProvider.get(o.category); },

  /* 依出發據點南下方向排序（order 大→小）；出發據點走主檔 homeSite（B-1） */
  southboundFrom(originId) {
    const start = this.siteById(originId).order;
    return DB.sites.filter(s => s.order < start).sort((a, b) => b.order - a.order);
  },

  /* B-6：記錄每台車最近一次派遣決策（調度室顯示用） */
  recordVehicleStatus(vehId, matrixRow, reason, endpointId, endpointBasis) {
    const m = this.matrixRowInfo(matrixRow);
    this.vehicleStatus[vehId] = {
      matrixRow, modeLabel: m ? m.mode : '—', capacity: m ? m.capacity : '—',
      reason, endpoint: endpointId, endpointBasis, at: new Date(),
    };
  },

  /* 派車：對某台車 + 一批待處理單跑貪婪 / 直達邏輯，回傳決策
     只處理已核准的南下貨（dropSite 較 pickSite 南，B-2 方向由起迄推導） */
  dispatch(vehicleId, mode, dispatchDate) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    const origin = DB.homeSite; // 出發據點走主檔（B-1）
    const all = this.orders.filter(o => o.status === 'approved' && this.isSouthbound(o));
    const unservable = all.filter(o => !this.isServable(o));
    unservable.forEach(o => trace.push(`<span class="no">✗ ${o.id} 不排入：${this.unservableReason(o)}</span>`));
    let servable = all.filter(o => this.isServable(o));
    // 2.14 媒合截止：派車日前兩天 12:00；逾時者自動順延至下一個可媒合車次，不接受插單
    const lateOrders = [];
    if (dispatchDate) {
      const cut = this.matchCutoffFor(dispatchDate);
      trace.push(`<span class="dim">媒合截止（2.14）：派車日 ${dispatchDate} 前 ${DB.matchCutoffDaysBefore} 天 ${DB.matchCutoffTime}（${cut.toLocaleString('zh-TW')}）</span>`);
      servable.filter(o => !this.meetsCutoff(o, dispatchDate)).forEach(o => {
        lateOrders.push(o); o.deferredToDate = this.nextDispatchDate(o);
        trace.push(`  <span class="no">✗ ${o.id} 逾媒合截止 → 自動排入下一可媒合車次（${o.deferredToDate || '待排'}），不接受插單</span>`);
      });
      servable = servable.filter(o => this.meetsCutoff(o, dispatchDate));
    }
    const pending = servable
      .sort((a, b) => a.approvedAt - b.approvedAt); // 核准時間排序（G34）

    // ---- 直達分流（G38/G39）----
    if (mode === 'direct') {
      const directs = pending.filter(o => o.direct);
      if (directs.length === 0) return { trace: ['<span class="dim">目前無直達單。</span>'], mode };
      // 一台直達車只服務單一送貨據點（G38）→ 取最早核准的直達單送貨據點（迄）
      const targetDest = directs[0].dropSite;
      const sameDest = directs.filter(o => o.dropSite === targetDest);
      trace.push(`<span class="hl">直達車</span>：鎖定單一目的地 ${this.siteById(targetDest).name}（G38 不湊單、不論貨量）`);
      trace.push(`終點 = 申請單目的地｜純容量加總、不跑貪婪法（G39）`);
      // 預計來收時間：車輛自出發據點直達，抵達目的地據點的時間（示意，08:00 出發）
      const start = hhmmToMin(DB.shiftStartDefault);          // 2.14 排班以表定上班時間為基準
      const directTravel = this.travelMin(origin, targetDest); // 2.9 查路程表
      const directEta = minToHHMM(start + DB.prepMin + directTravel);
      const refDays = this.minTripDaysFor(veh, targetDest);    // 3.1 僅供參考，不參與運算
      trace.push(`<span class="dim">行駛時間查路程表（2.9）：${this.siteById(origin).name}→${this.siteById(targetDest).name} ${directTravel} 分｜出發 ${DB.shiftStartDefault}＋前置 ${DB.prepMin} 分`);
      trace.push(`最短天數表（3.1 參考值，不參與運算）：${veh.sizeClass === 'big' ? '大車' : '小車'} → ${this.siteById(targetDest).name} ${refDays != null ? refDays + ' 天' : '（表中無值）'}</span>`);
      let load = 0, wt = 0; const carried = [];
      for (const o of sameDest) {
        const ev = this.effVolume(o);   // 有效體積（含類別浪費係數 G03）
        // 交貨時間檢核：直達抵達迄點時間晚於交貨時間 → 留下一班直達車
        if (o.deliverTime && hhmmToMin(directEta) > hhmmToMin(o.deliverTime)) {
          trace.push(`  <span class="no">✗ ${o.id} 直達 ${directEta} 送達晚於交貨時間 ${o.deliverTime} → 留下一班直達車（交貨時間檢核）</span>`);
          continue;
        }
        if (load + ev <= veh.volume && wt + o.weight <= veh.weight) {
          load += ev; wt += o.weight; carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = targetDest;
          o.pickupTime = directEta;     // 幾點來收（顯示給申請人）
          trace.push(`  <span class="ok">✓ 載入 ${o.id}（申報 ${o.volume}L → 有效 ${ev.toFixed(0)}L）累計 ${load.toFixed(0)}L</span>`);
        } else {
          trace.push(`  <span class="no">✗ ${o.id} 超出容量 → 留下一班直達車（G39）</span>`);
        }
      }
      const days = refDays;
      const reason = `當天有<b>急件直達</b>申請單（最早核准 ${directs[0].id}）→ 獨立派車（3.2/G38）`;
      this.recordVehicleStatus(veh.id, 2, reason, targetDest, '申請單指定目的地'); // B-6
      return { mode: 'direct', endpoint: targetDest, carried, trace, lateOrders, dispatchDate,
        days, refDays, urgentDirect: true, reason, modeLabel: this.matrixRowInfo(2).mode, matrixRow: 2,
        capUsed: Math.round(load), capTotal: veh.volume };
    }

    // ---- 非直達貪婪：動態淨值＋到迄點卸貨釋出容量（G32/G33/G34/G35）----
    // 2.3：容量觸頂只跳過該張表單、車輛續行；只有「當日在勤時數觸頂且無法再跨夜」才停止延伸。
    const nonDirect = pending.filter(o => !o.direct);
    const seq = this.southboundFrom(origin);
    let netVol = 0, netWt = 0, peakVol = 0;  // 動態淨值（G33）與峰值
    let endpoint = origin;
    const carried = [], deliveredHere = [], stops = [];
    const onboard = [];                       // 目前車上（尚未卸貨）
    const clock = this.newDutyClock();        // 2.13 在勤時數模型（12.5h/日，自到班起算）
    const start = hhmmToMin(DB.shiftStartDefault); // 2.14 排班以表定 08:00 為基準
    const etaAt = () => minToHHMM(start + clock.dayElapsed);
    trace.push(`<span class="hl">非直達車（貪婪法）</span>：動態淨值＋<b>到送貨據點卸貨釋出容量</b>（G33）`);
    trace.push(`出發據點 ${this.siteById(origin).name}（主檔 homeSite）｜容量上限 ${veh.volume}L`);
    trace.push(`<span class="dim">時間模型（2.13）：每日在勤上限 ${DB.dailyDutyMin} 分（12.5h），自表定 ${DB.shiftStartDefault} 起算；`
      + `含前置 ${DB.prepMin} 分、收工 ${DB.closeMin} 分與返回休息地；行駛查路程表（2.9）；休息用餐依累積行駛觸發（2.12）</span>`);

    // 某站裝貨（整張表單為最小單位 G34；容量不足只跳過該單，不停止延伸 2.3）
    const loadAt = (siteId) => {
      let loaded = 0, n = 0;
      const here = nonDirect.filter(o => o.pickSite === siteId && o.status === 'approved')
        .sort((a, b) => a.approvedAt - b.approvedAt);
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 2.11 交貨時間門檻：估算抵達送貨據點(迄)時間，晚於交貨時間 → 留下一班
        if (o.deliverTime) {
          const estDrop = start + clock.dayElapsed + lt + this.travelMin(siteId, o.dropSite);
          if (estDrop > hhmmToMin(o.deliverTime)) {
            trace.push(`  <span class="no">✗ ${o.id} 預計 ${minToHHMM(estDrop)} 送達晚於交貨時間 ${o.deliverTime} → 留下一班（2.11）</span>`);
            continue;
          }
        }
        // 容量（2.4 動態淨值）與當日在勤時數（2.13）
        if (netVol + ev <= veh.volume && netWt + o.weight <= veh.weight && lt <= clock.remaining(siteId)) {
          netVol += ev; netWt += o.weight; clock.addWork(lt);
          loaded += ev; n++; carried.push(o); onboard.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = o.dropSite;
          o.pickupTime = etaAt(); o.dispatchDay = clock.day;
        }
        // 放不下整張 → 跳過留下一班（G34），車輛仍續行（2.3）
      }
      return { loaded, n };
    };

    // 出發據點本身即可上貨（收貨據點＝基地者，於出發前裝車）
    const homeLoad = loadAt(origin);
    if (homeLoad.n) trace.push(`  ${this.siteById(origin).name}（出發）：<span class="ok">裝 ${homeLoad.n} 單 ${homeLoad.loaded.toFixed(0)}L</span> → 車上淨值 ${netVol.toFixed(0)}L`);
    peakVol = Math.max(peakVol, netVol);

    let prevSite = origin;
    let stopReason = null;
    for (const site of seq) {
      const drive = this.travelMin(prevSite, site.id); // 2.9 查路程表
      // 2.13：本段行駛（含可能觸發之休息用餐）與抵達後的收工保留量須放得進當日額度，否則跨夜
      if (drive > clock.remaining(site.id)) {
        if (!clock.rollover(prevSite)) {
          stopReason = `當日在勤時數已達 12.5 小時上限且已達最大出勤 ${DB.maxTripDays} 天（2.13）`;
          trace.push(`  <span class="hl">▲ 時間觸頂：${stopReason} → 終點不再延伸（2.3）</span>`);
          break;
        }
        clock.log.forEach(l => trace.push(l)); clock.log.length = 0;
        if (drive > clock.remaining(site.id)) { // 隔日仍放不下這一段
          stopReason = '單段行駛已超出單日在勤額度（2.13）';
          trace.push(`  <span class="hl">▲ 時間觸頂：${stopReason} → 終點不再延伸</span>`);
          break;
        }
      }
      clock.addDrive(drive);
      clock.log.forEach(l => trace.push(l)); clock.log.length = 0;
      prevSite = site.id;
      const arriveEta = etaAt();
      let unloaded = 0, activity = false;

      // 1) 先卸貨：車上以本站為送貨據點（迄）者 → 釋出容量（G33）
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          netVol -= ev; netWt -= o.weight; clock.addWork(o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); deliveredHere.push(o);
          o.dispatchDropTime = arriveEta; activity = true;
        }
      }
      // 2) 再裝貨：以本站為收貨據點（起）者
      const got = loadAt(site.id);
      if (got.n) activity = true;
      peakVol = Math.max(peakVol, netVol);
      if (activity) {
        endpoint = site.id;
        stops.push({ site, loaded: Math.round(got.loaded), unloaded: Math.round(unloaded), count: got.n,
          cumVol: Math.round(netVol), cumTime: clock.dayElapsed, arrive: arriveEta, day: clock.day });
        trace.push(`  ${site.name}（第 ${clock.day} 天 ${arriveEta}）：`
          + (unloaded ? `<span class="b-amber">卸 ${unloaded.toFixed(0)}L</span> ` : '')
          + (got.loaded ? `<span class="ok">裝 ${got.n} 單 ${got.loaded.toFixed(0)}L</span> ` : (unloaded ? '' : '<span class="dim">無貨</span> '))
          + `→ 車上淨值 ${netVol.toFixed(0)}L／當日在勤 ${clock.dayElapsed} 分`);
      }
    }
    // 終點須涵蓋所有已載單的送貨據點（迄）——取最南者（2.3）
    let endOrder = this.siteById(endpoint).order;
    carried.forEach(o => { endOrder = Math.min(endOrder, this.siteById(o.dropSite).order); });
    endpoint = DB.sites.find(s => s.order === endOrder).id;

    // 3.2 自然直達：非急件、但沿途未停靠任何中間站（屬排程結果，不觸發任何分流）
    const naturalDirect = carried.length > 0 && stops.filter(st => st.count > 0).length === 0;
    // 3.1 天數：精算天數 vs 最短天數表（參考值）——精算為準，超出僅提醒
    const estDays = clock.day;
    const refDays = this.minTripDaysFor(veh, endpoint);
    const daysOver = (refDays != null && estDays > refDays);
    trace.push(`<span class="hl">終點 = ${this.siteById(endpoint).name}｜峰值淨值 ${peakVol.toFixed(0)}L（G32/G33）</span>`);
    trace.push(`<span class="dim">精算出勤 ${estDays} 天（收工含返回休息地 ${clock.closeOut(endpoint)} 分）｜`
      + `最短天數表參考（3.1，不參與運算）：${veh.sizeClass === 'big' ? '大車' : '小車'} → ${refDays != null ? refDays + ' 天' : '（表中無值）'}</span>`);
    if (daysOver) trace.push(`  <span class="b-amber">▲ 本趟預估天數 ${estDays} 天超出表定 ${refDays} 天 → 以精算為準照常派車，僅提醒調度員（3.1）</span>`);
    if (naturalDirect) trace.push(`  <span class="dim">本趟為「自然直達」：時間額度不足以順路停靠，屬排程結果，不觸發獨立派車或回程鎖定（3.2）</span>`);

    const reason = naturalDirect
      ? '無急件直達單；時間額度不足以順路停靠 → 自然直達（3.2，不觸發分流）'
      : '無急件直達單 → 沿線貪婪收送、到迄點卸貨釋出容量（G32/G33）';
    this.recordVehicleStatus(veh.id, 1, reason, endpoint, '已載單最南送貨據點'); // B-6
    return { mode: 'greedy', endpoint, carried, delivered: deliveredHere, stops, trace,
      days: estDays, refDays, daysOver, naturalDirect, stopReason, lateOrders, dispatchDate,
      reason, modeLabel: this.matrixRowInfo(1).mode, matrixRow: 1,
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
     ① 路線：直達單起訖區間與回程車實際行經區間重疊
     ② 狀態：已核准、尚未被任何車次載走（呼叫端以 status==='approved' 過濾）
     ③ 時間：回程車行經該單上車據點的預估時間，落在該單可派時間窗內
        （有交貨時間者：行經時間 ≤ 交貨時間＋窗寬；未指定＝整日可派。窗寬走主檔 directLockWindowMin，待業務確認） */
  collidesReturnDirect(o, turnaroundId) {
    const turnOrder = this.siteById(turnaroundId).order;
    const home = this.homeOrder();
    const po = this.siteById(o.pickSite).order, dr = this.siteById(o.dropSite).order;
    const oMin = Math.min(po, dr), oMax = Math.max(po, dr);
    // ① 路線區間重疊：[oMin,oMax] 與回程行經 [turnOrder, home]
    if (!(oMin < home && oMax > turnOrder)) return { hit: false, why: '路線區間不重疊' };
    // ③ 時間窗
    const passEta = hhmmToMin(DB.shiftStartDefault) + DB.prepMin
      + this.travelMin(turnaroundId, o.pickSite); // 行經上車據點預估時間（2.9 查路程表、2.14 表定出發）
    if (o.deliverTime) {
      const dl = hhmmToMin(o.deliverTime);
      if (passEta > dl + DB.directLockWindowMin) {
        return { hit: false, why: `行經 ${minToHHMM(passEta)} 已超出交貨時間 ${o.deliverTime}＋窗寬 ${DB.directLockWindowMin} 分` };
      }
    }
    return { hit: true, passEta: minToHHMM(passEta) };
  },

  /* ---- 回程派車：全域直達鎖定 + 五列決策矩陣（G36/G40/G41/G42/G43）----
     originallyDirect：這台車去程是否原本就是直達車（矩陣第 5 列）
     startNet：回程起始動態淨值（延續去程殘量，示意可傳 0）
  */
  dispatchReturn(vehicleId, turnaroundId, originallyDirect, startNet) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    startNet = startNet || 0;
    const path = this.returnPath(turnaroundId);
    const endpoint = DB.homeSite; // 回程固定回出發據點（G36/B-1）
    const allReturn = this.orders
      .filter(o => o.status === 'approved' && !this.isSouthbound(o)); // 北上貨（B-2 由起迄推導）
    allReturn.filter(o => !this.isServable(o))
      .forEach(o => trace.push(`<span class="no">✗ ${o.id} 不排入：${this.unservableReason(o)}</span>`));
    const returnOrders = allReturn.filter(o => this.isServable(o))
      .sort((a, b) => a.approvedAt - b.approvedAt);

    // 矩陣第 5 列：回程・原本就是直達車 → 純容量加總、不停靠（3.3）
    if (originallyDirect) {
      trace.push(`<span class="hl">回程・原本就是直達車</span>：純容量加總、全程不停靠、終點＝出發據點（矩陣第 5 列）`);
      trace.push(`  <span class="dim">直達車回程不沿途收送，直接返回 ${this.siteById(endpoint).name}</span>`);
      const reason5 = '去程即為直達車，回程延續直達承諾（3.3）';
      this.recordVehicleStatus(veh.id, 5, reason5, endpoint, '出發據點'); // B-6
      return { mode: 'return-direct', matrixRow: 5, modeLabel: this.matrixRowInfo(5).mode,
        endpoint, carried: [], deferred: [], trace, days: '—',
        reason: reason5, capUsed: startNet, capTotal: veh.volume, locked: true };
    }

    // 非直達回程車：先做全域直達檢查（G40/B-5 三條件）
    trace.push(`回程全域直達檢查（G40/B-5）：路段 ${path.map(s => s.name).join('→')}→${this.siteById(endpoint).name}｜條件＝路線重疊＋已核准未載＋時間窗（窗寬 ${DB.directLockWindowMin} 分，主檔）`);
    const collide = [], collideInfo = {};
    returnOrders.filter(o => o.direct).forEach(o => {
      const c = this.collidesReturnDirect(o, turnaroundId);
      if (c.hit) { collide.push(o); collideInfo[o.id] = c; }
      else trace.push(`  <span class="dim">直達單 ${o.id} 不構成撞期：${c.why}</span>`);
    });
    const nonDirectReturn = returnOrders.filter(o => !o.direct
      && path.some(s => s.id === o.pickSite));

    let net = startNet, wt = 0;
    const carried = [], deferred = [], stops = [];

    if (collide.length > 0) {
      // 矩陣第 4 列：回程・被迫鎖定直達
      trace.push(`  <span class="hl">▲ 發現撞期直達單 ${collide.map(o => o.id).join(', ')}（路線重疊＋時間窗成立）→ 路段鎖定直達（G40）</span>`);
      trace.push(`  容量延續動態淨值（G41，不切換 3.3），不收新的非直達貨，仍依序經過沿線據點`);
      for (const o of collide) {
        const ev = this.effVolume(o);
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight) {
          net += ev; wt += o.weight; carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = endpoint;
          o.pickupTime = collideInfo[o.id].passEta; // 幾點來收＝行經上車據點時間
          trace.push(`  <span class="ok">✓ 載直達回程單 ${o.id}（${this.siteById(o.pickSite).name} 上車 ${o.pickupTime}，有效 ${ev.toFixed(0)}L）淨值 ${net.toFixed(0)}L</span>`);
        }
      }
      // 被排擠的非直達回程單 → 自動順延（G42）
      nonDirectReturn.forEach(o => { deferred.push(o); trace.push(`  <span class="no">✗ 非直達回程單 ${o.id} 被鎖定排擠 → 自動順延下一趟（G42）</span>`); });
      const reason4 = `回程路段存在撞期直達單 ${collide.map(o => o.id).join(', ')}（路線重疊＋時間窗成立 G40/B-5）`;
      this.recordVehicleStatus(veh.id, 4, reason4, endpoint, '出發據點'); // B-6
      return { mode: 'return-locked', matrixRow: 4, modeLabel: this.matrixRowInfo(4).mode,
        endpoint, carried, deferred, stops, trace, days: '—',
        reason: reason4, capUsed: Math.round(net), capTotal: veh.volume, locked: true };
    }

    // 矩陣第 3 列：回程・非直達且無撞期 → 動態淨值、沿路收送＋到迄點卸貨釋出容量
    trace.push(`  <span class="ok">無撞期直達單 → 沿路收送回程貨、到送貨據點卸貨釋出容量（G33/G40）</span>`);
    let prevSite = turnaroundId;
    let peakVol = startNet;
    const onboard = [];
    const clock = this.newDutyClock();               // 2.13 回程亦以 12.5h 在勤模型計算
    const start = hhmmToMin(DB.shiftStartDefault);
    const etaAt = () => minToHHMM(start + clock.dayElapsed);
    for (const site of path) {
      const drive = this.travelMin(prevSite, site.id); // 2.9 查路程表
      if (drive > clock.remaining(site.id) && !clock.rollover(prevSite)) {
        trace.push(`  <span class="hl">▲ 回程當日在勤時數觸頂且已達最大出勤天數（2.13）→ 不再沿途收送</span>`);
        break;
      }
      clock.addDrive(drive);
      clock.log.forEach(l => trace.push(l)); clock.log.length = 0;
      prevSite = site.id;
      const arriveEta = etaAt();
      let unloaded = 0, stopLoaded = 0, nLoad = 0;
      // 卸貨：車上以本站為送貨據點（迄）者 → 釋出容量
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          net -= ev; wt -= o.weight; clock.addWork(o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = arriveEta;
        }
      }
      // 裝貨：本站為收貨據點（起）者
      const here = nonDirectReturn.filter(o => o.pickSite === site.id && o.status === 'approved');
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 2.11 交貨時間門檻：估算抵達送貨據點(迄)時間，晚於交貨時間 → 順延下一趟
        if (o.deliverTime) {
          const estDrop = start + clock.dayElapsed + lt + this.travelMin(site.id, o.dropSite);
          if (estDrop > hhmmToMin(o.deliverTime)) {
            trace.push(`  <span class="no">✗ ${o.id} 預計 ${minToHHMM(estDrop)} 送達晚於交貨時間 ${o.deliverTime} → 順延下一趟</span>`);
            deferred.push(o); continue;
          }
        }
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight
            && lt <= clock.remaining(site.id)) {
          net += ev; wt += o.weight; clock.addWork(lt); stopLoaded += ev; nLoad++;
          carried.push(o); onboard.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = o.dropSite;
          o.pickupTime = arriveEta;
        } else {
          deferred.push(o);
        }
      }
      peakVol = Math.max(peakVol, net);
      stops.push({ site, loaded: Math.round(stopLoaded), unloaded: Math.round(unloaded), count: nLoad, cumVol: Math.round(net) });
      trace.push(`  ${site.name}：`
        + (unloaded ? `<span class="b-amber">卸 ${unloaded.toFixed(0)}L</span> ` : '')
        + (stopLoaded ? `<span class="ok">收 ${stopLoaded.toFixed(0)}L</span> ` : (unloaded ? '' : '<span class="dim">無回程貨</span> '))
        + `→ 淨值 ${net.toFixed(0)}L／當日在勤 ${clock.dayElapsed} 分`);
    }
    // 抵達終點（出發據點）：卸下以基地為送貨據點者（回程路徑不含基地本身，故於此結算）
    clock.addDrive(this.travelMin(prevSite, endpoint));
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
    this.recordVehicleStatus(veh.id, 3, reason3, endpoint, '出發據點'); // B-6
    return { mode: 'return-greedy', matrixRow: 3, modeLabel: this.matrixRowInfo(3).mode,
      endpoint, carried, deferred, stops, trace, days: '—',
      reason: reason3, capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: clock.dayElapsed, timeTotal: DB.dailyDutyMin, dutyDays: clock.day,
      breaks: clock.breaksTaken, locked: false };
  },
};
