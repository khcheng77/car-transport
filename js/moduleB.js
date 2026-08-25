/* ============================================================
   moduleB.js — 模組 B：跨據點南北幹線物流
   PLAN.md Phase 4 / Guardrails G30–G44
   貪婪終點判斷、直達/非直達分流、動態淨值容量、天數對照表
   ============================================================ */

const ModuleB = {
  orders: [],  // 幹線申請單
  seq: 1,

  // origin/dest 用 site id；direct: true/false；volume 公升；weight kg；handleMin 裝卸分鐘
  createOrder(data) {
    const o = {
      id: 'LB' + String(this.seq++).padStart(3, '0'),
      applicant: data.applicant,
      origin: data.origin,
      dest: data.dest,
      direct: data.direct,
      volume: data.volume,
      weight: data.weight,
      handleMin: data.handleMin,
      approvedAt: Date.now() + this.seq,
      status: 'pending',
    };
    this.orders.push(o);
    return o;
  },

  TIME_LIMIT: 8 * 60, // 總計時間上限（分鐘），示意 = 一日行車 8 小時
  siteById(id) { return DB.sites.find(s => s.id === id); },

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
      .filter(o => o.status === 'pending')
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
      let load = 0, wt = 0; const carried = [];
      for (const o of sameDest) {
        if (load + o.volume <= veh.volume && wt + o.weight <= veh.weight) {
          load += o.volume; wt += o.weight; carried.push(o); o.status = 'loaded';
          trace.push(`  <span class="ok">✓ 載入 ${o.id}（${o.volume}L）累計 ${load}L</span>`);
        } else {
          trace.push(`  <span class="no">✗ ${o.id} 超出容量 → 留下一班直達車（G39）</span>`);
        }
      }
      const days = DB.dayCountDirect[targetDest] || '?';
      return { mode: 'direct', endpoint: targetDest, carried, trace,
        days, reason: '當天有直達申請單 → 獨立派車（G38）',
        modeLabel: '直達', capUsed: load, capTotal: veh.volume };
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

      // 本站待裝載單（目的地 = 本站，示意收貨）
      const here = nonDirect.filter(o => o.dest === site.id && o.status === 'pending');
      let stopLoaded = 0, stopTime = 0;
      const stopCarried = [];
      for (const o of here) {
        // 部分裝載：整張表單為最小單位（G34）
        if (netVol + o.volume <= veh.volume && netWt + o.weight <= veh.weight
            && totalTime + o.handleMin <= this.TIME_LIMIT) {
          netVol += o.volume; netWt += o.weight; totalTime += o.handleMin;
          stopLoaded += o.volume; stopTime += o.handleMin;
          carried.push(o); stopCarried.push(o); o.status = 'loaded';
        }
      }
      stops.push({ site, loaded: stopLoaded, count: stopCarried.length,
        cumVol: netVol, cumTime: totalTime, arrive: minToHHMM(8*60 + totalTime) });

      // 貪婪終點判斷：容量或時間任一觸頂 → 終點（G32）
      const volFull = netVol >= veh.volume * 0.95;
      const timeFull = totalTime >= this.TIME_LIMIT;
      trace.push(`  ${site.name}：到站累計 ${netVol}L / ${totalTime}分`
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
      modeLabel: '非直達', capUsed: netVol, capTotal: veh.volume,
      timeUsed: totalTime, timeTotal: this.TIME_LIMIT };
  },

  /* 回程全域直達鎖定檢查（G40/G41）簡化示意 */
  checkReturnLock() {
    const activeDirect = this.orders.some(o => o.direct && o.status !== 'void');
    return activeDirect;
  },
};
