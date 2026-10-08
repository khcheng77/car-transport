/* ============================================================
   tests/loader.js — 無相依測試載入器（純 Node，隔離內網可執行）
   將 js/ 下的模組（data / loadengine / moduleA/B/C/D / guide）載入乾淨的
   VM context，讓每個測試群組取得互不污染的全新單例狀態。
   對應 PLAN.md §4「核心演算法必須有測試」與 CLAUDE.md 回應語言。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');
const FILES = ['data.js', 'loadengine.js', 'signoff.js', 'flow.js', 'usage.js', 'moduleA.js', 'moduleB.js', 'moduleC.js', 'moduleD.js', 'guide.js'];

/* 回傳一個全新載入的 context（含 DB / 引擎 / 五模組單例）*/
function fresh() {
  let src = FILES.map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');
  // 匯出頂層 const（VM 中 const 不會掛到 global，串接後由尾段一次取出）
  src += '\n; ({ DB, WasteFactorProvider, checkLoad, effectiveLoad, itemEffective, itemFitsFloor, floorCap,'
       + ' ModuleA, ModuleB, ModuleC, ModuleD, Guide, Signoff, Usage, Flow, fmtVol, minToHHMM, hhmmToMin });';
  const ctx = { console, Date, Math, Set, Map, String, Number, Array, JSON, isNaN, parseInt, parseFloat };
  vm.createContext(ctx);
  const H = vm.runInContext(src, ctx, { filename: 'bundle.js' });
  // 固定「系統時間」於所有範例日期之前，讓「已出車」只在測試明確設定 Flow._now 時發生（測試不受實際日期影響）
  H.Flow._now = new Date(2026, 0, 1, 0, 0);
  return H;
}

module.exports = { fresh };
