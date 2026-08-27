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
  createOrder(data) {
    const leg = data.leg || 'outbound';
    const o = {
      id: 'LB' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      leg,
      // 去程：origin=D10、dest=南下據點；回程：pickupSite=南部收貨據點、dest=D10
      origin: leg === 'return' ? data.site : 'D10',
      dest: leg === 'return' ? 'D10' : data.site,
      pickupSite: leg === 'return' ? data.site : null,
      direct: data.direct,
      volume: data.volume,
      category: data.category || 'BOX',   // 貨物類別（浪費係數查表 G03，A/B 共用）
      weight: data.weight,
      handleMin: data.handleMin,
      approvedAt: null,
      status: 'submitted',  // submitted → approved/rejected → loaded
      createdAt: new Date(),
    };
    this.orders.push(o);
    return o;
  },

  // 業務/調度端：核准時填入審核通過時間（G34 排序用）
  approve(o) { o.status = 'approved'; o.approvedAt = this.approveSeq++; },
  reject(o) { o.status = 'rejected'; o.approvedAt = null; },

  // 接收人確認接受（loaded → accepted）
  acceptDelivery(o) { if (o.status === 'loaded') { o.status = 'accepted'; o.acceptedAt = Date.now(); } },
  // 交貨確認（accepted → delivered）：接收人確認收到，或調度/駕駛回報送達
  confirmDelivery(o, by) { if (o.status === 'accepted') { o.status = 'delivered'; o.deliveredAt = Date.now(); o.deliveredBy = by || '調度室'; } },

  TIME_LIMIT: 8 * 60, // 總計時間上限（分鐘），示意 = 一日行車 8 小時
  siteById(id) { return DB.sites.find(s => s.id === id); },

  /* 有效體積＝申報貨量 × 類別浪費係數（沿用共用係數 Provider，G01/G03，A/B 共用）
     幹線單以整批貨量申報（非逐件尺寸），故套用 Level 1 係數修正，不做 Level 2 維度檢查 */
  effVolume(o) { return o.volume * WasteFactorProvider.get(o.category); },

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
      // 一台直達車只服務單一目的地（G38）→ 取最早核准的直達單目的地
      const targetDest = directs[0].dest;
      const sameDest = directs.filter(o => o.dest === targetDest);
      trace.push(`<span class="hl">直達車</span>：鎖定單一目的地 ${this.siteById(targetDest).name}（G38 不湊單、不論貨量）`);
      trace.push(`終點 = 申請單目的地｜純容量加總、不跑貪婪法（G39）`);
      // 預計來收時間：車輛自出發據點直達，抵達目的地據點的時間（示意，08:00 出發）
      const directEta = minToHHMM(8 * 60 + Math.abs(this.siteById(origin).order - this.siteById(targetDest).order) * DB.legMinutes);
      let load = 0, wt = 0; const carried = [];
      for (const o of sameDest) {
        const ev = this.effVolume(o);   // 有效體積（含類別浪費係數 G03）
        if (load + ev <= veh.volume && wt + o.weight <= veh.weight) {
          load += ev; wt += o.weight; carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '直達'; o.dispatchEndpoint = targetDest;
          o.pickupTime = directEta;     // 幾點來收（顯示給申請人）
          trace.push(`  <span class="ok">✓ 載入 ${o.id}（${o.volume}L × 係數 ${WasteFactorProvider.get(o.category)} = ${ev.toFixed(0)}L）累計 ${load.toFixed(0)}L</span>`);
        } else {
          trace.push(`  <span class="no">✗ ${o.id} 超出容量 → 留下一班直達車（G39）</span>`);
        }
      }
      const days = DB.dayCountDirect[targetDest] || '?';
      return { mode: 'direct', endpoint: targetDest, carried, trace,
        days, reason: '當天有直達申請單 → 獨立派車（G38）',
        modeLabel: '去程・直達', matrixRow: 2, capUsed: Math.round(load), capTotal: veh.volume };
    }

    // ---- 非直達貪婪終點判斷（G32/G33/G35）----
    const nonDirect = pending.filter(o => !o.direct);
    const seq = this.southboundFrom(origin);
    let netVol = 0, netWt = 0;       // 動態淨值（G33）
    let totalTime = 0;               // 累積行駛 + 裝卸（G35）
    let endpoint = origin;
    const carried = [], stops = [];
    trace.push(`<span class="hl">非直達車（貪婪法）</span>：容量以動態淨值為準（G33），時間 = 行駛+裝卸（G35）`);
    trace.push(`容量上限 ${veh.volume}L / 時間上限 ${this.TIME_LIMIT}分`);

    let prevOrder = this.siteById(origin).order;
    for (const site of seq) {
      // 行駛到本站
      const legs = Math.abs(prevOrder - site.order);
      totalTime += legs * DB.legMinutes;
      prevOrder = site.order;
      const arriveEta = minToHHMM(8 * 60 + totalTime); // 車輛抵達本站（來收）時間

      // 本站待裝載單（目的地 = 本站，示意收貨）
      const here = nonDirect.filter(o => o.dest === site.id && o.status === 'approved');
      let stopLoaded = 0, stopTime = 0;
      const stopCarried = [];
      for (const o of here) {
        // 部分裝載：整張表單為最小單位（G34）；容量以有效體積計（含浪費係數 G03）
        const ev = this.effVolume(o);
        if (netVol + ev <= veh.volume && netWt + o.weight <= veh.weight
            && totalTime + o.handleMin <= this.TIME_LIMIT) {
          netVol += ev; netWt += o.weight; totalTime += o.handleMin;
          stopLoaded += ev; stopTime += o.handleMin;
          carried.push(o); stopCarried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = site.id;
          o.pickupTime = arriveEta;     // 幾點來收（顯示給申請人）
        }
      }
      stops.push({ site, loaded: Math.round(stopLoaded), count: stopCarried.length,
        cumVol: Math.round(netVol), cumTime: totalTime, arrive: minToHHMM(8*60 + totalTime) });

      // 貪婪終點判斷：容量或時間任一觸頂 → 終點（G32）
      const volFull = netVol >= veh.volume * 0.95;
      const timeFull = totalTime >= this.TIME_LIMIT;
      trace.push(`  ${site.name}：到站累計 ${netVol.toFixed(0)}L / ${totalTime}分`
        + (stopCarried.length ? ` <span class="ok">裝 ${stopCarried.length} 單</span>` : ' <span class="dim">無貨</span>'));
      if (volFull || timeFull) {
        endpoint = site.id;
        trace.push(`  <span class="hl">▲ ${volFull ? '容量' : '時間'}觸頂 → 終點 = ${site.name}（G32）</span>`);
        break;
      }
      endpoint = site.id;
    }

    const days = DB.dayCountStopover[endpoint] || '?';
    return { mode: 'greedy', endpoint, carried, stops, trace, days,
      reason: '無直達單 → 沿線貪婪收送（G32）',
      modeLabel: '去程・非直達', matrixRow: 1, capUsed: Math.round(netVol), capTotal: veh.volume,
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

    // 矩陣第 3 列：回程・非直達且無撞期 → 動態淨值、沿路收送非直達貨
    trace.push(`  <span class="ok">無撞期直達單 → 比照停靠車邏輯，沿路收送非直達回程貨（G40）</span>`);
    let prevOrder = this.siteById(turnaroundId).order;
    let totalTime = 0;
    for (const site of path) {
      totalTime += Math.abs(site.order - prevOrder) * DB.legMinutes;
      prevOrder = site.order;
      const arriveEta = minToHHMM(8 * 60 + totalTime); // 車輛抵達本站（來收）時間
      const here = nonDirectReturn.filter(o => o.pickupSite === site.id && o.status === 'approved');
      let stopLoaded = 0;
      for (const o of here) {
        const ev = this.effVolume(o);
        if (net + ev <= veh.volume && wt + o.weight <= veh.weight
            && totalTime + o.handleMin <= this.TIME_LIMIT) {
          net += ev; wt += o.weight; totalTime += o.handleMin; stopLoaded += ev;
          carried.push(o); o.status = 'loaded';
          o.dispatchVehicle = veh.id; o.dispatchMode = '非直達'; o.dispatchEndpoint = 'D10';
          o.pickupTime = arriveEta;     // 幾點來收（顯示給申請人）
        } else {
          deferred.push(o);
        }
      }
      stops.push({ site, loaded: Math.round(stopLoaded), count: here.filter(o => o.status === 'loaded').length, cumVol: Math.round(net) });
      trace.push(`  ${site.name}：淨值 ${net.toFixed(0)}L / 時間 ${totalTime}分`
        + (stopLoaded ? ` <span class="ok">收 ${stopLoaded.toFixed(0)}L</span>` : ' <span class="dim">無回程貨</span>'));
    }
    trace.push(`  <span class="hl">回程終點＝${this.siteById('D10').name}（G36）</span>`);
    return { mode: 'return-greedy', matrixRow: 3, modeLabel: '回程・非直達且無撞期',
      endpoint, carried, deferred, stops, trace, days: '—',
      reason: '回程無撞期直達單 → 動態淨值沿路收送（G40）',
      capUsed: Math.round(net), capTotal: veh.volume, timeUsed: totalTime, timeTotal: this.TIME_LIMIT, locked: false };
  },
};
