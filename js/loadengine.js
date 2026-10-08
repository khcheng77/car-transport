/* ============================================================
   loadengine.js — 共用裝載判定引擎（VD.Core 對應）
   PLAN.md Phase 1 / Guardrails G01–G05
   G145 起改為「物品不堆疊、能夠裝入的最大量」：單件平放（只能水平轉向）＋
   有效地板面積（底面積×類別浪費係數）加總＋重量累計；A／B／申請引導共用。
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

/* ============================================================
   不堆疊裝載判定（G145：與業務單位確認，巡迴物品轉運、院區物品轉運、申請引導一致）
   條件＝「物品不堆疊、能夠裝入的最大量」：
   ① 每件貨平放於車廂地板、不堆疊，只能水平轉向（高度固定為申請填的「高」）：
      高 ≤ 車廂高，且底面（長×寬，可互換）放得進車廂地板（長×寬）
   ② 有效地板面積＝長×寬×件數×類別浪費係數（G03），加總（含車上既有）≤ 車廂地板面積（長×寬）
   ③ 重量（含既有）≤ 載重上限（G05）
   取代原 Level 1 體積加總／形狀懲罰／六方向旋轉（不堆疊時體積必然 ≤ 地板×高，不另檢查）。
   ============================================================ */
const floorCap = v => (v && v.dims ? v.dims.l * v.dims.w : 0);          // 車廂地板面積 cm²
const m2 = cm2 => Math.round(cm2 / 1000) / 10;                          // cm² → m²（一位小數）

/* ---- 單件放得進車廂：高度不超過、底面水平轉向放得進地板 ---- */
function itemFitsFloor(it, cap) {
  if (!cap) return true;
  return it.h <= cap.h && ((it.l <= cap.l && it.w <= cap.w) || (it.w <= cap.l && it.l <= cap.w));
}

/* ---- 單品有效值（共用：checkLoad 與逐站累計 effectiveLoad 一致口徑）---- */
function itemEffective(it) {
  const qty = it.qty || 1;
  const vol = (it.l * it.w * it.h) / 1000;              // 單件體積（公升，僅供顯示）
  const wf = WasteFactorProvider.get(it.category);      // 類別浪費係數（G03）
  const base = it.l * it.w;                             // 單件底面積 cm²
  return {
    qty, vol, wf, base,
    floor: base * qty * wf,                             // 有效地板面積 cm²
    weight: (it.weight || 0) * qty,
  };
}

/* ---- 一批貨物的有效地板面積／重量（供逐站淨值累計使用 G05／3.4）；volume 為原始體積僅供顯示 ---- */
function effectiveLoad(items) {
  return (items || []).reduce((a, it) => {
    const e = itemEffective(it);
    return { floor: a.floor + e.floor, weight: a.weight + e.weight, volume: a.volume + e.vol * e.qty };
  }, { floor: 0, weight: 0, volume: 0 });
}

/* ---- 主入口：LoadFeasibilityService.Check（T1-6）----
   items: [{name, l, w, h, qty, category, weight}]  單位 cm / kg
   vehicle: {dims:{l,w,h}, weight(kg)}
   startLoad: { floor(cm²), weight(kg) }  車上既有負載（逐站累計用）
   回傳 { ok, reasons[], trace[], metrics{} }；原因碼 L2_DIM（單件放不進）／FLOOR（地板不足）／WEIGHT
*/
function checkLoad(items, vehicle, startLoad) {
  startLoad = startLoad || {};
  const startFloor = startLoad.floor || 0, startWt = startLoad.weight || 0;
  const trace = [];
  const reasons = [];
  const cap = vehicle.dims;
  const capFloor = floorCap(vehicle);
  const capWt = vehicle.weight;

  // ① 單件放得進（不堆疊、只水平轉向）
  trace.push(`單件擺放（不堆疊、只能水平轉向；車廂 ${cap.l}×${cap.w}×高 ${cap.h}cm）`);
  for (const it of items) {
    if (!itemFitsFloor(it, cap)) {
      const why = it.h > cap.h ? `高 ${it.h}cm 超過車廂高 ${cap.h}cm` : `底面 ${it.l}×${it.w}cm 放不進車廂地板 ${cap.l}×${cap.w}cm`;
      reasons.push({ code: 'L2_DIM', msg: `「${it.name}」(${it.l}×${it.w}×${it.h}) ${why}` });
      trace.push(`  <span class="no">✗ ${it.name}：${why}</span>`);
    } else {
      trace.push(`  <span class="ok">✓ ${it.name} 可平放</span>`);
    }
  }

  // ② 有效地板面積加總（× 類別浪費係數）
  let addFloor = 0, rawVol = 0, addWeight = 0;
  trace.push(`有效地板面積（含既有 ${m2(startFloor)}m²）`);
  for (const it of items) {
    const e = itemEffective(it);
    addFloor += e.floor; rawVol += e.vol * e.qty; addWeight += e.weight;
    trace.push(`  · ${it.name}｜底面 ${it.l}×${it.w}cm × 係數 ${e.wf}${WasteFactorProvider.isDefault(it.category) ? '(保底)' : ''} × ${e.qty} = <span class="hl">${m2(e.floor)}m²</span>`);
  }
  const usedFloor = startFloor + addFloor;
  const floorUsePct = capFloor ? (usedFloor / capFloor) * 100 : 0;
  if (usedFloor > capFloor) {
    reasons.push({ code: 'FLOOR', msg: `有效地板面積 ${m2(usedFloor)}m² 超過車廂地板 ${m2(capFloor)}m²` });
    trace.push(`  <span class="no">✗ 累計 ${m2(usedFloor)}m² > 車廂地板 ${m2(capFloor)}m²（${floorUsePct.toFixed(0)}%）</span>`);
  } else {
    trace.push(`  <span class="ok">✓ 累計 ${m2(usedFloor)}m² ≤ 車廂地板 ${m2(capFloor)}m²（${floorUsePct.toFixed(0)}%）</span>`);
  }

  // ③ 重量累計（G05）
  const usedWt = startWt + addWeight;
  trace.push(`重量累計（含既有 ${startWt}kg）：${usedWt}kg / 上限 ${capWt}kg`);
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
    metrics: { addFloor, usedFloor, capFloor, floorUsePct, rawVol, addWeight, usedWt, capWt }
  };
}
