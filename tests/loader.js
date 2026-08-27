/* ============================================================
   tests/loader.js — 無相依測試載入器（純 Node，隔離內網可執行）
   將 js/ 下的模組（data / loadengine / moduleA/B/C）載入乾淨的
   VM context，讓每個測試群組取得互不污染的全新單例狀態。
   對應 PLAN.md §4「核心演算法必須有測試」與 CLAUDE.md 回應語言。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');
const FILES = ['data.js', 'loadengine.js', 'moduleA.js', 'moduleB.js', 'moduleC.js'];

/* 回傳一個全新載入的 context（含 DB / 引擎 / 三模組單例）*/
function fresh() {
  let src = FILES.map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');
  // 匯出頂層 const（VM 中 const 不會掛到 global，串接後由尾段一次取出）
  src += '\n; ({ DB, WasteFactorProvider, checkLoad, effectiveLoad, itemEffective,'
       + ' ModuleA, ModuleB, ModuleC, fmtVol, minToHHMM, hhmmToMin });';
  const ctx = { console, Date, Math, Set, Map, String, Number, Array, JSON, isNaN, parseInt, parseFloat };
  vm.createContext(ctx);
  return vm.runInContext(src, ctx, { filename: 'bundle.js' });
}

module.exports = { fresh };
