/* ============================================================
   moduleB.js — 模組 B：跨據點南北幹線物流
   PLAN.md Phase 4 / Guardrails G30–G44
   貪婪終點判斷、直達/非直達分流、動態淨值容量、天數對照表
   ============================================================ */

const ModuleB = {
  orders: [],  // 幹線申請單
  seq: 1,
  approveSeq: 1,

  // origin/dest 用 site id；direct: true/false；volume 公升；weight kg；handleMin 裝卸分鐘
  // leg: 'outbound' 去程（D10→南下據點）| 'return' 回程（南部據點→D10 出發據點）
  // 申請端只負責建立，狀態為「待審核」
  // 幹線貨物多筆項目，每筆填獨立尺寸與重量（品名/長寬高/類別/數量/單件重），比照模組 A（G13）
  // 整張表單為裝載最小單位（G34）；相容：若帶 volume 而無尺寸則以整批貨量計（demo/測試）
  createOrder(data) {
    const leg = data.leg || 'outbound';
    const items = (data.items && data.items.length)
      ? data.items.map(x => ({ ...x, name: x.name || '貨物', qty: x.qty || 1, category: x.category || 'BOX', weight: +x.weight || 0 }))
      : [{ name: '貨物', volume: +data.volume || 0, weight: +data.weight || 0, category: data.category || 'BOX' }];
    // 上貨時間＋下貨時間（分），加總為裝卸時間 handleMin（G35）；相容：只給 handleMin 亦可
    const split = (data.loadMin != null || data.unloadMin != null);
    const loadMin = +(data.loadMin || 0);
    const unloadMin = +(data.unloadMin || 0);
    const handleMin = split ? (loadMin + unloadMin) : (+data.handleMin || 0);
    // 起迄兩點：pickSite＝收貨據點（起）、dropSite＝送貨據點（迄）
    const pickSite = data.site;
    const dropSite = data.destSite || (leg === 'return' ? 'D10' : data.site);
    const o = {
      id: 'LB' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      leg,
      // 去程：origin=D10、dest=南下據點；回程：pickupSite=南部收貨據點、dest=D10（沿用既有派車欄位）
      origin: leg === 'return' ? data.site : 'D10',
      dest: leg === 'return' ? 'D10' : data.site,
      pickupSite: leg === 'return' ? data.site : null,
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
      status: 'submitted',  // submitted → approved/rejected → loaded
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

  // 接收人確認接受（loaded → accepted）
  acceptDelivery(o) { if (o.status === 'loaded') { o.status = 'accepted'; o.acceptedAt = Date.now(); } },
  // 交貨確認（accepted → delivered）：接收人確認收到，或調度/駕駛回報送達
  confirmDelivery(o, by) { if (o.status === 'accepted') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.deliveredBy = by || '調度室'; } },

  TIME_LIMIT: 3 * 8 * 60, // 總計時間上限（分鐘），示意涵蓋最長約 3 天行程（天數另查對照表 G37）
  siteById(id) { return DB.sites.find(s => s.id === id); },

  /* 有效體積＝各項貨量 × 該項類別浪費係數 加總（沿用共用係數 Provider，G01/G03，A/B 共用）
     幹線單以整批貨量申報（非逐件尺寸），故套用 Level 1 係數修正，不做 Level 2 維度檢查 */
  effVolume(o) { return o.effVol != null ? o.effVol : o.volume * WasteFactorProvider.get(o.category); },

  /* 依出發據點南下方向排序（order 大→小；台北D10→屏東D1）*/
  southboundFrom(originId) {
    const start = this.siteById(originId).order;
    return DB.sites.filter(s => s.order < start).sort((a, b) => b.order - a.order);
  },

  /* 派車：對某台車 + 一批待處理單跑貪婪 / 直達邏輯，回傳決策 */
  dispatch(vehicleId, mode) {
    const veh = DB.vehicles.find(v => v.id === vehicleId);
    const trace = [];
    const origin = 'D10'; // 示意出發：台北據點
    const pending = this.orders
      .filter(o => o.status === 'approved' && o.leg === 'outbound')
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
      const directEta = minToHHMM(8 * 60 + Math.abs(this.siteById(origin).order - this.siteById(targetDest).order) * DB.legMinutes);
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
      const days = DB.dayCountDirect[targetDest] || '?';
      return { mode: 'direct', endpoint: targetDest, carried, trace,
        days, reason: '當天有直達申請單 → 獨立派車（G38）',
        modeLabel: '去程・直達', matrixRow: 2, capUsed: Math.round(load), capTotal: veh.volume };
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
    trace.push(`容量上限 ${veh.volume}L`);

    let prevOrder = this.siteById(origin).order;
    for (const site of seq) {
      totalTime += Math.abs(prevOrder - site.order) * DB.legMinutes; // 行駛到本站
      prevOrder = site.order;
      if (totalTime > this.TIME_LIMIT) { // 時間觸頂 → 終點不再延伸（G32）
        trace.push(`  <span class="hl">▲ 時間觸頂（${totalTime}分）→ 終點不再延伸</span>`);
        break;
      }
      const arriveEta = minToHHMM(8 * 60 + totalTime);
      let unloaded = 0, loaded = 0, nLoad = 0, activity = false;

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
      const here = nonDirect.filter(o => o.pickSite === site.id && o.status === 'approved')
        .sort((a, b) => a.approvedAt - b.approvedAt);
      for (const o of here) {
        const ev = this.effVolume(o);
        const lt = (o.loadMin != null ? o.loadMin : o.handleMin) || 0;
        // 交貨時間檢核：估算抵達送貨據點(迄)時間，晚於交貨時間 → 留下一班（G34）
        if (o.deliverTime) {
          const estDrop = 8 * 60 + totalTime + lt + Math.abs(site.order - this.siteById(o.dropSite).order) * DB.legMinutes;
          if (estDrop > hhmmToMin(o.deliverTime)) {
            trace.push(`  <span class="no">✗ ${o.id} 預計 ${minToHHMM(estDrop)} 送達晚於交貨時間 ${o.deliverTime} → 留下一班（交貨時間檢核）</span>`);
            continue;
          }
        }
        if (netVol + ev <= veh.volume && netWt + o.weight <= veh.weight
            && totalTime + lt <= this.TIME_LIMIT) {
          netVol += ev; netWt += o.weight; totalTime += lt;
          loaded += ev; nLoad++; carried.push(o); onboard.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = o.dropSite;
          o.pickupTime = arriveEta;
          activity = true;
        }
        // 放不下整張 → 跳過留下一班（G34）
      }
      peakVol = Math.max(peakVol, netVol);
      if (activity) {
        endpoint = site.id;
        stops.push({ site, loaded: Math.round(loaded), unloaded: Math.round(unloaded), count: nLoad, cumVol: Math.round(netVol), cumTime: totalTime, arrive: arriveEta });
        trace.push(`  ${site.name}：`
          + (unloaded ? `<span class="b-amber">卸 ${unloaded.toFixed(0)}L</span> ` : '')
          + (loaded ? `<span class="ok">裝 ${nLoad} 單 ${loaded.toFixed(0)}L</span> ` : (unloaded ? '' : '<span class="dim">無貨</span> '))
          + `→ 車上淨值 ${netVol.toFixed(0)}L / ${totalTime}分`);
      }
    }
    // 終點須涵蓋所有已載單的送貨據點（迄）——取最南者
    let endOrder = this.siteById(endpoint).order;
    carried.forEach(o => { endOrder = Math.min(endOrder, this.siteById(o.dropSite).order); });
    endpoint = DB.sites.find(s => s.order === endOrder).id;

    const days = DB.dayCountStopover[endpoint] || '?';
    trace.push(`<span class="hl">終點 = ${this.siteById(endpoint).name}｜峰值淨值 ${peakVol.toFixed(0)}L（G32/G33）</span>`);
    return { mode: 'greedy', endpoint, carried, delivered: deliveredHere, stops, trace, days,
      reason: '無直達單 → 沿線貪婪收送、到迄點卸貨釋出容量（G32/G33）',
      modeLabel: '去程・非直達', matrixRow: 1, capUsed: Math.round(peakVol), capTotal: veh.volume,
      timeUsed: totalTime, timeTotal: this.TIME_LIMIT };
  },

  /* 回程北上路徑：從折返據點沿南北順序北上到 D10 前（收貨據點）*/
  returnPath(turnaroundId) {
    const startOrder = this.siteById(turnaroundId).order;
    const d10 = this.siteById('D10').order;
    return DB.sites.filter(s => s.order >= startOrder && s.order < d10).sort((a, b) => a.order - b.order);
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
    const endpoint = 'D10'; // 回程固定回原出發據點（G36）
    const returnOrders = this.orders
      .filter(o => o.status === 'approved' && o.leg === 'return')
      .sort((a, b) => a.approvedAt - b.approvedAt);

    // 矩陣第 5 列：回程・原本就是直達車 → 純容量加總、不停靠（3.3）
    if (originallyDirect) {
      trace.push(`<span class="hl">回程・原本就是直達車</span>：純容量加總、全程不停靠、終點＝出發據點（矩陣第 5 列）`);
      trace.push(`  <span class="dim">直達車回程不沿途收送，直接返回 ${this.siteById('D10').name}</span>`);
      return { mode: 'return-direct', matrixRow: 5, modeLabel: '回程・原本就是直達車',
        endpoint, carried: [], deferred: [], trace, days: '—',
        reason: '去程即為直達車，回程延續直達承諾（3.3）',
        capUsed: startNet, capTotal: veh.volume, locked: true };
    }

    // 非直達回程車：先做全域直達檢查（G40）
    const onPath = (o) => path.some(s => s.id === o.pickupSite);
    const collidingDirect = returnOrders.filter(o => o.direct && onPath(o));
    const nonDirectReturn = returnOrders.filter(o => !o.direct && onPath(o));

    let net = startNet, wt = 0;
    const carried = [], deferred = [], stops = [];
    trace.push(`回程全域直達檢查（G40）：掃描回程路段 ${path.map(s => s.name).join('→')}→${this.siteById('D10').name}`);

    if (collidingDirect.length > 0) {
      // 矩陣第 4 列：回程・被迫鎖定直達
      trace.push(`  <span class="hl">▲ 發現撞期直達單 ${collidingDirect.map(o => o.id).join(', ')} → 路段鎖定直達（G40）</span>`);
      trace.push(`  容量延續動態淨值（G41，不切換 3.3），不收新的非直達貨，仍依序經過沿線據點`);
      for (const o of collidingDirect) {
        const ev = this.effVolume(o);
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight) {
          net += ev; wt += o.weight; carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = 'D10';
          // 幾點來收：自折返據點沿回程路線抵達本單上車據點的時間（示意，08:00 起）
          o.pickupTime = minToHHMM(8 * 60 + Math.abs(this.siteById(turnaroundId).order - this.siteById(o.pickupSite).order) * DB.legMinutes);
          trace.push(`  <span class="ok">✓ 載直達回程單 ${o.id}（${this.siteById(o.pickupSite).name} 上車，有效 ${ev.toFixed(0)}L）淨值 ${net.toFixed(0)}L</span>`);
        }
      }
      // 被排擠的非直達回程單 → 自動順延（G42）
      nonDirectReturn.forEach(o => { deferred.push(o); trace.push(`  <span class="no">✗ 非直達回程單 ${o.id} 被鎖定排擠 → 自動順延下一趟（G42）</span>`); });
      return { mode: 'return-locked', matrixRow: 4, modeLabel: '回程・被迫鎖定直達',
        endpoint, carried, deferred, stops, trace, days: '—',
        reason: `回程路段存在撞期直達單 ${collidingDirect.map(o => o.id).join(', ')}（G40）`,
        capUsed: Math.round(net), capTotal: veh.volume, locked: true };
    }

    // 矩陣第 3 列：回程・非直達且無撞期 → 動態淨值、沿路收送＋到迄點卸貨釋出容量
    trace.push(`  <span class="ok">無撞期直達單 → 沿路收送回程貨、到送貨據點卸貨釋出容量（G33/G40）</span>`);
    let prevOrder = this.siteById(turnaroundId).order;
    let totalTime = 0, peakVol = startNet;
    const onboard = [];
    for (const site of path) {
      totalTime += Math.abs(site.order - prevOrder) * DB.legMinutes;
      prevOrder = site.order;
      const arriveEta = minToHHMM(8 * 60 + totalTime);
      let unloaded = 0, stopLoaded = 0, nLoad = 0;
      // 卸貨：車上以本站為送貨據點（迄）者 → 釋出容量（回程 dropSite 多為 D10，於終點卸）
      for (let i = onboard.length - 1; i >= 0; i--) {
        const o = onboard[i];
        if (o.dropSite === site.id) {
          const ev = this.effVolume(o);
          net -= ev; wt -= o.weight; totalTime += (o.unloadMin || 0);
          unloaded += ev; onboard.splice(i, 1); o.dispatchDropTime = arriveEta;
        }
      }
      // 裝貨：本站為收貨據點（起）者
      const here = nonDirectReturn.filter(o => o.pickupSite === site.id && o.status === 'approved');
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
            && totalTime + lt <= this.TIME_LIMIT) {
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
    trace.push(`  <span class="hl">回程終點＝${this.siteById('D10').name}（G36），峰值淨值 ${peakVol.toFixed(0)}L</span>`);
    return { mode: 'return-greedy', matrixRow: 3, modeLabel: '回程・非直達且無撞期',
      endpoint, carried, deferred, stops, trace, days: '—',
      reason: '回程無撞期直達單 → 動態淨值沿路收送、到迄點卸貨（G33/G40）',
      capUsed: Math.round(peakVol), capTotal: veh.volume, timeUsed: totalTime, timeTotal: this.TIME_LIMIT, locked: false };
  },
};
