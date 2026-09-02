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
      direct: data.direct,
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

  // 交貨確認（loaded → delivered）：接收人確認收到，或調度/駕駛回報送達（B-2 移除 accepted 中間步驟）
  confirmDelivery(o, by) { if (o.status === 'loaded') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.deliveredBy = by || '調度室'; } },

  /* ---- B-3 動態時間上限：天數為整台車屬性，依終點據點查表（3.1）----
     直達查 dayCountDirect、非直達（有停靠）查 dayCountStopover；
     查無終點 → 全域最大天數（保險）；上限＝天數 × 每日工時。數值走主檔。 */
  timeLimitFor(endpointId, direct) {
    const table = direct ? DB.dayCountDirect : DB.dayCountStopover;
    const days = Math.min(table[endpointId] || DB.maxTripDays, DB.maxTripDays);
    return days * DB.workdayMin;
  },
  maxTimeLimit() { return DB.maxTripDays * DB.workdayMin; },

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
  dispatch(vehicleId, mode) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    const origin = DB.homeSite; // 出發據點走主檔（B-1）
    const all = this.orders.filter(o => o.status === 'approved' && this.isSouthbound(o));
    const unservable = all.filter(o => !this.isServable(o));
    unservable.forEach(o => trace.push(`<span class="no">✗ ${o.id} 不排入：${this.unservableReason(o)}</span>`));
    const pending = all.filter(o => this.isServable(o))
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
      const directTravel = Math.abs(this.siteById(origin).order - this.siteById(targetDest).order) * DB.legMinutes;
      const directEta = minToHHMM(8 * 60 + directTravel);
      const limit = this.timeLimitFor(targetDest, true); // B-3 直達上限查直達天數表
      trace.push(`<span class="dim">時間上限（B-3 查表）：直達 ${this.siteById(targetDest).name} ${DB.dayCountDirect[targetDest] || DB.maxTripDays} 天 → ${limit} 分；本趟行駛 ${directTravel} 分</span>`);
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
      const days = DB.dayCountDirect[targetDest] || DB.maxTripDays;
      const reason = `當天有直達申請單（最早核准 ${directs[0].id}）→ 獨立派車（G38）`;
      this.recordVehicleStatus(veh.id, 2, reason, targetDest, '申請單指定目的地'); // B-6
      return { mode: 'direct', endpoint: targetDest, carried, trace,
        days, reason, modeLabel: this.matrixRowInfo(2).mode, matrixRow: 2,
        capUsed: Math.round(load), capTotal: veh.volume };
    }

    // ---- 非直達貪婪：動態淨值＋到迄點卸貨釋出容量（G32/G33/G34/G35）----
    const nonDirect = pending.filter(o => !o.direct);
    const seq = this.southboundFrom(origin);
    let netVol = 0, netWt = 0, peakVol = 0;  // 動態淨值（G33）與峰值
    let totalTime = 0;                        // 累積行駛 + 裝卸（G35）
    let endpoint = origin;
    const carried = [], deliveredHere = [], stops = [];
    const onboard = [];                       // 目前車上（尚未卸貨）
    trace.push(`<span class="hl">非直達車（貪婪法）</span>：動態淨值＋<b>到送貨據點卸貨釋出容量</b>（G33），時間 = 行駛+裝卸（G35）`);
    trace.push(`出發據點 ${this.siteById(origin).name}（主檔 homeSite）｜容量上限 ${veh.volume}L｜時間上限依終點查天數表（B-3）`);

    // 出發據點本身即可上貨（收貨據點＝基地者，於出發前裝車）
    const dynLimit = (endId) => this.timeLimitFor(endId, false); // B-3
    const loadAt = (siteId, arriveEta, curLimit) => {
      let loaded = 0, n = 0;
      const here = nonDirect.filter(o => o.pickSite === siteId && o.status === 'approved')
        .sort((a, b) => a.approvedAt - b.approvedAt);
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 交貨時間檢核：估算抵達送貨據點(迄)時間，晚於交貨時間 → 留下一班（G34）
        if (o.deliverTime) {
          const estDrop = 8 * 60 + totalTime + lt + Math.abs(this.siteById(siteId).order - this.siteById(o.dropSite).order) * DB.legMinutes;
          if (estDrop > hhmmToMin(o.deliverTime)) {
            trace.push(`  <span class="no">✗ ${o.id} 預計 ${minToHHMM(estDrop)} 送達晚於交貨時間 ${o.deliverTime} → 留下一班（交貨時間檢核）</span>`);
            continue;
          }
        }
        if (netVol + ev <= veh.volume && netWt + o.weight <= veh.weight
            && totalTime + lt <= curLimit) {
          netVol += ev; netWt += o.weight; totalTime += lt;
          loaded += ev; n++; carried.push(o); onboard.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = o.dropSite;
          o.pickupTime = arriveEta;
        }
        // 放不下整張 → 跳過留下一班（G34）
      }
      return { loaded, n };
    };
    // 出發據點上貨
    const homeLoad = loadAt(origin, minToHHMM(8 * 60), this.maxTimeLimit());
    if (homeLoad.n) trace.push(`  ${this.siteById(origin).name}（出發）：<span class="ok">裝 ${homeLoad.n} 單 ${homeLoad.loaded.toFixed(0)}L</span> → 車上淨值 ${netVol.toFixed(0)}L`);
    peakVol = Math.max(peakVol, netVol);

    let prevOrder = this.siteById(origin).order;
    for (const site of seq) {
      const curLimit = dynLimit(site.id); // 延伸到本站的動態上限（依本站為終點查表 B-3）
      totalTime += Math.abs(prevOrder - site.order) * DB.legMinutes; // 行駛到本站
      prevOrder = site.order;
      if (totalTime > curLimit) { // 時間觸頂 → 終點不再延伸（G32/B-3）
        trace.push(`  <span class="hl">▲ 時間觸頂（${totalTime}分 > 上限 ${curLimit}分，終點 ${site.name} 查表 ${DB.dayCountStopover[site.id] || DB.maxTripDays} 天）→ 終點不再延伸</span>`);
        break;
      }
      const arriveEta = minToHHMM(8 * 60 + totalTime);
      let unloaded = 0, activity = false;

      // 1) 先卸貨：車上以本站為送貨據點（迄）者 → 釋出容量（G33）
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          netVol -= ev; netWt -= o.weight; totalTime += (o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); deliveredHere.push(o);
          o.dispatchDropTime = arriveEta; activity = true;
        }
      }
      // 2) 再裝貨：以本站為收貨據點（起）者，依核准時間、整張表單為最小單位（G34）
      const got = loadAt(site.id, arriveEta, curLimit);
      if (got.n) activity = true;
      peakVol = Math.max(peakVol, netVol);
      if (activity) {
        endpoint = site.id;
        stops.push({ site, loaded: Math.round(got.loaded), unloaded: Math.round(unloaded), count: got.n, cumVol: Math.round(netVol), cumTime: totalTime, arrive: arriveEta });
        trace.push(`  ${site.name}：`
          + (unloaded ? `<span class="b-amber">卸 ${unloaded.toFixed(0)}L</span> ` : '')
          + (got.loaded ? `<span class="ok">裝 ${got.n} 單 ${got.loaded.toFixed(0)}L</span> ` : (unloaded ? '' : '<span class="dim">無貨</span> '))
          + `→ 車上淨值 ${netVol.toFixed(0)}L / ${totalTime}分`);
      }
    }
    // 終點須涵蓋所有已載單的送貨據點（迄）——取最南者
    let endOrder = this.siteById(endpoint).order;
    carried.forEach(o => { endOrder = Math.min(endOrder, this.siteById(o.dropSite).order); });
    endpoint = DB.sites.find(s => s.order === endOrder).id;

    const days = DB.dayCountStopover[endpoint] || DB.maxTripDays;
    const finalLimit = this.timeLimitFor(endpoint, false);
    trace.push(`<span class="hl">終點 = ${this.siteById(endpoint).name}｜峰值淨值 ${peakVol.toFixed(0)}L（G32/G33）｜出勤 ${days} 天（B-3 查表）</span>`);
    const reason = '無直達單需求 → 沿線貪婪收送、到迄點卸貨釋出容量（G32/G33）';
    this.recordVehicleStatus(veh.id, 1, reason, endpoint, '已載單最南送貨據點'); // B-6
    return { mode: 'greedy', endpoint, carried, delivered: deliveredHere, stops, trace, days,
      reason, modeLabel: this.matrixRowInfo(1).mode, matrixRow: 1,
      capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: totalTime, timeTotal: finalLimit };
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
    const passEta = 8 * 60 + Math.abs(turnOrder - po) * DB.legMinutes; // 行經上車據點預估時間（示意 08:00 起）
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
    let prevOrder = this.siteById(turnaroundId).order;
    let totalTime = 0, peakVol = startNet;
    const onboard = [];
    const limit = this.maxTimeLimit(); // 回程終點＝出發據點（不在停靠表）→ 全域上限（B-3 保險值）
    for (const site of path) {
      totalTime += Math.abs(site.order - prevOrder) * DB.legMinutes;
      prevOrder = site.order;
      const arriveEta = minToHHMM(8 * 60 + totalTime);
      let unloaded = 0, stopLoaded = 0, nLoad = 0;
      // 卸貨：車上以本站為送貨據點（迄）者 → 釋出容量
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          net -= ev; wt -= o.weight; totalTime += (o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = arriveEta;
        }
      }
      // 裝貨：本站為收貨據點（起）者
      const here = nonDirectReturn.filter(o => o.pickSite === site.id && o.status === 'approved');
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 交貨時間檢核：估算抵達送貨據點(迄)時間，晚於交貨時間 → 順延下一趟
        if (o.deliverTime) {
          const estDrop = 8 * 60 + totalTime + lt + Math.abs(site.order - this.siteById(o.dropSite).order) * DB.legMinutes;
          if (estDrop > hhmmToMin(o.deliverTime)) {
            trace.push(`  <span class="no">✗ ${o.id} 預計 ${minToHHMM(estDrop)} 送達晚於交貨時間 ${o.deliverTime} → 順延下一趟</span>`);
            deferred.push(o); continue;
          }
        }
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight
            && totalTime + lt <= limit) {
          net += ev; wt += o.weight; totalTime += lt; stopLoaded += ev; nLoad++;
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
        + `→ 淨值 ${net.toFixed(0)}L / ${totalTime}分`);
    }
    // 抵達終點（出發據點）：卸下以基地為送貨據點者（回程路徑不含基地本身，故於此結算）
    totalTime += Math.abs(this.homeOrder() - prevOrder) * DB.legMinutes;
    const homeEta = minToHHMM(8 * 60 + totalTime);
    let homeUnloaded = 0;
    for (let i = onboard.length - 1; i >= 0; i--) {
      const o = onboard[i];
      if (o.dropSite === endpoint) {
        const ev = this.effVolume(o);
        net -= ev; wt -= o.weight; totalTime += (o.unloadMin || 0);
        homeUnloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = homeEta;
      }
    }
    if (homeUnloaded) trace.push(`  ${this.siteById(endpoint).name}（終點）：<span class="b-amber">卸 ${homeUnloaded.toFixed(0)}L</span> → 淨值 ${net.toFixed(0)}L / ${totalTime}分`);
    trace.push(`  <span class="hl">回程終點＝${this.siteById(endpoint).name}（G36），峰值淨值 ${peakVol.toFixed(0)}L</span>`);
    const reason3 = '回程無撞期直達單 → 動態淨值沿路收送、到迄點卸貨（G33/G40）';
    this.recordVehicleStatus(veh.id, 3, reason3, endpoint, '出發據點'); // B-6
    return { mode: 'return-greedy', matrixRow: 3, modeLabel: this.matrixRowInfo(3).mode,
      endpoint, carried, deferred, stops, trace, days: '—',
      reason: reason3, capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: totalTime, timeTotal: limit, locked: false };
  },
};
