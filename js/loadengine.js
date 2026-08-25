/* ============================================================
   loadengine.js — 共用裝載判定引擎（VD.Core 對應）
   PLAN.md Phase 1 / Guardrails G01–G05
   僅 Level 1（體積加總）+ 地板面積瓶頸 + 長寬比懲罰
   + Level 2（單品六方向旋轉維度檢查）+ 重量累計
   不做 Level 3 碰撞模擬。回傳含失敗原因碼。
   ============================================================ */

/* ---- WasteFactorProvider：static 單例 + 快取 + 保底值（G03/G04）---- */
const WasteFactorProvider = (function () {
  let cache = null;
  let dbHits = 0; // 計數：驗證快取命中不重複查 DB（PLAN T1-2 驗收）
  function load() {
    dbHits++; // 模擬一次 DB 讀取
    cache = {};
    DB.wasteFactors.filter(f => f.active).forEach(f => cache[f.code] = f.factor);
  }
  return {
    get(code) {
      if (!cache) load();
      // 查無類別 → 回傳保底值，不擲例外（G03）
      return (code && cache[code] != null) ? cache[code] : DB.wasteDefault;
    },
    isDefault(code) { if (!cache) load(); return !(code && cache[code] != null); },
    refresh() { load(); },        // 手動刷新（T1-2）
    dbHitCount() { return dbHits; }
  };
})();

/* ---- Level 2：單品六方向旋轉，能否放入車輛可用空間維度（G01 第二段）---- */
function fitsSixOrient(item, cap) {
  const dims = [item.l, item.w, item.h];
  const box = [cap.l, cap.w, cap.h];
  const perms = [
    [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
  ];
  return perms.some(p =>
    dims[p[0]] <= box[0] && dims[p[1]] <= box[1] && dims[p[2]] <= box[2]
  );
}

/* ---- 主入口：LoadFeasibilityService.Check（T1-6）----
   items: [{name, l, w, h, qty, category, weight}]  單位 cm / kg
   vehicle: {dims:{l,w,h}, volume(公升), weight(kg)}
   startLoad: { volume(公升), weight(kg) }  車上既有負載（逐站累計用）
   回傳 { ok, reasons[], trace[], metrics{} }
*/
function checkLoad(items, vehicle, startLoad) {
  startLoad = startLoad || { volume: 0, weight: 0 };
  const trace = [];
  const reasons = [];
  const cap = vehicle.dims;
  const capVol = vehicle.volume;      // 公升
  const capWt = vehicle.weight;       // kg

  // --- Level 1：有效體積加總（乘浪費係數 G02）---
  let effVol = 0, rawVol = 0, addWeight = 0;
  let floorArea = 0;                  // 地板面積瓶頸法累計（cm²）
  const capFloor = cap.l * cap.w;     // 車廂地板面積
  for (const it of items) {
    const qty = it.qty || 1;
    const vol = (it.l * it.w * it.h) / 1000; // 公升
    const wf = WasteFactorProvider.get(it.category);
    // 長寬比形狀懲罰：長寬比越大額外加成（G02）
    const sorted = [it.l, it.w, it.h].sort((a,b) => b-a);
    const aspect = sorted[0] / sorted[2];
    const shapePenalty = aspect > 3 ? 1.10 : (aspect > 2 ? 1.05 : 1.0);
    const itemEff = vol * wf * shapePenalty * qty;
    effVol += itemEff;
    rawVol += vol * qty;
    addWeight += (it.weight || 0) * qty;
    // 地板面積：物件貼地最小面（長×寬中較小的水平投影）
    floorArea += (sorted[1] * sorted[2]) * qty;
    trace.push(`  · ${it.name}｜體積 ${vol.toFixed(0)}L × 係數 ${wf}${WasteFactorProvider.isDefault(it.category)?'(保底)':''} × 形狀 ${shapePenalty} × ${qty} = <span class="hl">${itemEff.toFixed(0)}L</span>`);
  }

  const usedVol = startLoad.volume + effVol;
  trace.unshift(`Level 1 有效體積加總（含既有負載 ${startLoad.volume.toFixed(0)}L）`);
  if (usedVol > capVol) {
    reasons.push({ code: 'L1_VOLUME', msg: `有效體積 ${usedVol.toFixed(0)}L 超過車輛容量 ${capVol.toFixed(0)}L` });
    trace.push(`  <span class="no">✗ 累計有效體積 ${usedVol.toFixed(0)}L > 容量 ${capVol.toFixed(0)}L</span>`);
  } else {
    trace.push(`  <span class="ok">✓ 累計有效體積 ${usedVol.toFixed(0)}L ≤ 容量 ${capVol.toFixed(0)}L</span>`);
  }

  // --- 地板面積瓶頸法（G02）---
  const floorUsePct = (floorArea / capFloor) * 100;
  trace.push(`地板面積瓶頸：占用 ${floorArea.toFixed(0)}cm² / ${capFloor.toFixed(0)}cm²（${floorUsePct.toFixed(0)}%）`);
  if (floorArea > capFloor) {
    reasons.push({ code: 'FLOOR', msg: `地板投影面積 ${floorArea.toFixed(0)}cm² 超過車廂地板 ${capFloor.toFixed(0)}cm²` });
    trace.push(`  <span class="no">✗ 地板面積不足（易造成堆疊失敗）</span>`);
  } else {
    trace.push(`  <span class="ok">✓ 地板面積足夠</span>`);
  }

  // --- Level 2：單品六方向旋轉維度檢查（G01）---
  trace.push(`Level 2 單品維度檢查（六方向旋轉）`);
  let l2fail = false;
  for (const it of items) {
    const ok = fitsSixOrient(it, cap);
    if (!ok) {
      l2fail = true;
      reasons.push({ code: 'L2_DIM', msg: `「${it.name}」(${it.l}×${it.w}×${it.h}) 任何方向皆無法放入車廂 (${cap.l}×${cap.w}×${cap.h})` });
      trace.push(`  <span class="no">✗ ${it.name} 六方向皆放不進</span>`);
    } else {
      trace.push(`  <span class="ok">✓ ${it.name} 可放入</span>`);
    }
  }

  // --- 重量累計（G05）---
  const usedWt = startLoad.weight + addWeight;
  trace.push(`重量累計（含既有 ${startLoad.weight}kg）：${usedWt}kg / 上限 ${capWt}kg`);
  if (usedWt > capWt) {
    reasons.push({ code: 'WEIGHT', msg: `累計重量 ${usedWt}kg 超過上限 ${capWt}kg` });
    trace.push(`  <span class="no">✗ 超過總重量上限</span>`);
  } else {
    trace.push(`  <span class="ok">✓ 重量未超限</span>`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    trace,
    metrics: { effVol, rawVol, usedVol, capVol, floorUsePct, addWeight, usedWt, capWt }
  };
}
