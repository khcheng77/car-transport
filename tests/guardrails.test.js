/* ============================================================
   tests/guardrails.test.js — Guardrails 回歸測試（純 Node，零相依）
   對應 docs/PLAN.md 第 3 節 Guardrails（G01–G63）與各 Phase 驗收條件。
   執行：node tests/guardrails.test.js
   目的：把稽核過的行為（含四項前次修正）固化成可重複執行的測試，
        任何未來改動一旦違反 Guardrails 即會失敗。
   ============================================================ */
const { fresh } = require('./loader');

/* ---- 極簡測試框架（無外部相依，符合隔離內網約束）---- */
let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('  \x1b[32m✓\x1b[0m ' + name + '\n'); }
  catch (e) { failed++; fails.push({ name, msg: e.message });
    process.stdout.write('  \x1b[31m✗\x1b[0m ' + name + '\n    → ' + e.message + '\n'); }
}
function group(title, fn) { process.stdout.write('\n\x1b[1m' + title + '\x1b[0m\n'); fn(); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'eq') + ': 預期 ' + JSON.stringify(b) + '，實得 ' + JSON.stringify(a)); }
function ok(c, m) { if (!c) throw new Error(m || '預期為真'); }
function approx(a, b, tol, m) { if (Math.abs(a - b) > (tol || 1e-6)) throw new Error((m || 'approx') + ': ' + a + ' vs ' + b); }

/* helper：建立區域物流貨物項目 */
function item(o) { return Object.assign({ name: '件', l: 100, w: 100, h: 100, qty: 1, category: 'BOX', weight: 100 }, o); }

/* =================================================================
   共用裝載引擎（loadengine）— G01/G02/G03/G04/G05
   ================================================================= */
group('共用裝載判定引擎（G01–G05 / T1-2〜T1-6）', () => {
  test('G03 查無類別回傳保底值、不擲例外', () => {
    const H = fresh();
    eq(H.WasteFactorProvider.get('BOX'), 1.10, 'BOX 係數');
    eq(H.WasteFactorProvider.get('__NOPE__'), H.DB.wasteDefault, '未知類別→保底');
    ok(H.WasteFactorProvider.isDefault('__NOPE__'), '未知類別 isDefault 應為真');
  });

  test('G04 static 單例快取：多次查詢僅一次 DB 讀取', () => {
    const H = fresh();
    H.WasteFactorProvider.get('BOX'); H.WasteFactorProvider.get('PALLET'); H.WasteFactorProvider.get('LONG');
    eq(H.WasteFactorProvider.dbHitCount(), 1, '快取命中不應重複查 DB');
    H.WasteFactorProvider.refresh();
    eq(H.WasteFactorProvider.dbHitCount(), 2, '手動刷新應再讀一次');
  });

  test('G01 Level 2：體積夠但單品維度不過 → 失敗（六方向皆放不進）', () => {
    const H = fresh();
    const veh = { dims: { l: 200, w: 200, h: 200 }, volume: 100000, weight: 9999 };
    const res = H.checkLoad([item({ name: '超長桿', l: 300, w: 10, h: 10, category: 'LONG' })], veh, null);
    ok(!res.ok, '應失敗');
    ok(res.reasons.some(r => r.code === 'L2_DIM'), '需含 L2_DIM 原因碼');
  });

  test('G01 Level 2：旋轉後才放得下 → 通過', () => {
    const H = fresh();
    const veh = { dims: { l: 300, w: 50, h: 50 }, volume: 1e9, weight: 1e9 };
    // 件為 40×40×250：需旋轉讓 250 對到車廂長 300
    const res = H.checkLoad([item({ l: 40, w: 40, h: 250, category: 'BOX' })], veh, null);
    ok(res.ok, '六方向旋轉後應可放入：' + JSON.stringify(res.reasons));
  });

  test('G05 重量為第二維度：含既有負載累計超限 → WEIGHT 失敗', () => {
    const H = fresh();
    const veh = { dims: { l: 500, w: 500, h: 500 }, volume: 1e9, weight: 1000 };
    const res = H.checkLoad([item({ weight: 300, l: 50, w: 50, h: 50 })], veh, { volume: 0, weight: 800 });
    ok(!res.ok && res.reasons.some(r => r.code === 'WEIGHT'), '800+300>1000 應觸發 WEIGHT');
  });

  test('G01/G05 既有負載（startLoad）確實計入體積累計', () => {
    const H = fresh();
    const veh = { dims: { l: 500, w: 500, h: 500 }, volume: 1000 /*L*/, weight: 1e9 };
    // 單件有效體積 ~ 1000L 上下；先塞 900L 既有，再加一件應超容
    const res = H.checkLoad([item({ l: 100, w: 100, h: 200, category: 'BOX' })], veh, { volume: 900, weight: 0 });
    ok(res.metrics.usedVol > res.metrics.effVol, 'usedVol 應含既有負載 900L');
    ok(!res.ok && res.reasons.some(r => r.code === 'L1_VOLUME'), '累計後應超容');
  });
});

/* =================================================================
   模組 A：區域內物流（G10–G20）
   ================================================================= */
group('模組 A 區域內物流（G10–G19 / 送出即自動媒合）', () => {
  const FIX_Y = 2026, FIX_M = 8, FIX_D = 2; // 2026-09-02
  const FIX_DATE = '2026-09-02';
  // 媒合會讀取「現在時間」，測試一律注入固定時點（06:00，早於當日所有班次）以確保可重現
  function fixNow(H, h, m) { H.ModuleA.now = () => new Date(FIX_Y, FIX_M, FIX_D, h == null ? 6 : h, m || 0); return H; }
  function submit(H, over) {
    if (!H.ModuleA.__fixed) { fixNow(H); H.ModuleA.__fixed = true; }
    return H.ModuleA.submit(Object.assign({
      applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15,
    }, over));
  }

  test('送出即自動媒合：無需 approve/match 手動步驟，直接回傳班次與車號', () => {
    const H = fresh();
    ok(typeof H.ModuleA.approve === 'undefined', '不應再有主管核准方法');
    const { app, result } = submit(H);
    ok(result.ok, '送出後應自動媒合成功');
    eq(app.status, 'matched', '狀態應為已排班');
    ok(app.assignedShift && result.shift.vehicle, '應告知班次與車號');
    ok(/^\d{2}:\d{2}$/.test(result.arrival), '應告知到站時間');
  });

  test('G16 每班次上下貨合計上限＝班距 60 分，累計超額者順延下一班', () => {
    const H = fresh();
    // 每單 handleMin 30；本班預算 60：a1(30)、a2(60) 同班，a3 累計 90>60 應順延
    const a1 = submit(H, { handleMin: 30 }).app, a2 = submit(H, { handleMin: 30 }).app, a3 = submit(H, { handleMin: 30 }).app;
    eq([a1.submitSeq, a2.submitSeq, a3.submitSeq].join(','), '1,2,3', '送出序應遞增');
    eq(a1.assignedShift, 'D1-R1'); eq(a2.assignedShift, 'D1-R1');
    eq(a3.assignedShift, 'D1-R2', '第三單累計 90>60 應順延下一班（G16/G17）');
  });

  test('太大：超過任何一班車尺寸/容量 → reason=toobig、回覆太大', () => {
    const H = fresh();
    const { app, result } = submit(H, { items: [item({ name: '巨件', l: 999, w: 999, h: 999 })] });
    ok(!result.ok, '應媒合失敗');
    eq(result.reason, 'toobig', '空車都放不下 → toobig');
    ok(/太大/.test(result.msg), '訊息需回覆「太大」');
    eq(app.assignedShift, null, '失敗不得寫入班次（不留候補 G12）');
    eq(app.status, 'unscheduled');
  });

  test('今天已滿：貨物本身放得下但各班次皆已滿 → reason=full、回覆今天已滿', () => {
    const H = fresh();
    // 先用大量佔滿三個班次車輛的容量（每件可放入空車，但累積後無空間）
    // V-L01(≈14364L)/V-L02(≈11655L)；用多張大單填滿
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 }); // ≈8078L×1.1
    for (let i = 0; i < 14; i++) submit(H, { items: [big()], handleMin: 1 });
    const { app, result } = submit(H, { items: [big()], handleMin: 1 });
    ok(!result.ok, '此時應已滿');
    eq(result.reason, 'full', '放得下空車但各班次已滿 → full');
    ok(/今天已滿|已滿/.test(result.msg), '訊息需回覆「今天已滿」');
    eq(app.status, 'unscheduled');
  });

  test('未媒合單可編輯貨物後重新媒合成功（rematch）', () => {
    const H = fresh();
    const { app, result } = submit(H, { items: [item({ name: '長料', l: 999, w: 999, h: 999 })] });
    ok(!result.ok && app.status === 'unscheduled', '應先失敗為未排入');
    app.items = [item({ name: '小箱', l: 40, w: 30, h: 30, qty: 1, category: 'BOX', weight: 5 })]; // 編輯縮小
    const r = H.ModuleA.rematch(app);
    ok(r.ok, '縮小後重新媒合應成功');
    eq(app.status, 'matched'); ok(app.assignedShift, '應寫入班次');
  });

  test('G122 媒合成功即「待出車」；到班次時間「已出車」；實登後「已回登」（無已交貨）', () => {
    const H = fresh();
    const { app } = submit(H);
    eq(app.status, 'matched', '媒合成功即已排班');
    ok(typeof H.ModuleA.acceptSchedule === 'undefined', '不應再有確認接受排班步驟');
    ok(typeof H.ModuleA.confirmDelivery === 'undefined', 'G122 刪除已交貨');
    ok(!app.sign, '巡迴物品轉運不送運輸主管簽審（排班即生效）');
    eq(H.Flow.of(app), 'ready');
    H.Flow._now = new Date(H.ModuleA.departAt(app).getTime() + 60000); eq(H.Flow.of(app), 'departed');
    const pl = H.ModuleA.usagePlan(app), v = H.DB.vehicles.find(x => x.id === pl.vehicle);
    ok(H.ModuleA.usageSave(app, { vehicleType: v.type, vehicle: v.id, driver1: pl.drivers[0], startKm: 1, endKm: 9 }).ok);
    eq(H.Flow.of(app), 'logged', '登錄里程後已回登');
  });

  test('上貨＋下貨時間加總為站內佔用時間 handleMin（G15），並用於額度判定', () => {
    const H = fresh();
    const { app } = submit(H, { loadMin: 18, unloadMin: 12, handleMin: undefined }); // 合計 30 ≤ 40
    eq(app.handleMin, 30, 'handleMin 應為上貨＋下貨加總');
    eq(app.assignedShift, 'D1-R1', '30 分在額度內應排首班');
    // 幹線同樣加總
    const o = H.ModuleB.createOrder({ applicant: 'X', site: 'D3', destSite: 'D1', direct: false,
      loadMin: 20, unloadMin: 15, items: [{ name: 'a', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }] });
    eq(o.handleMin, 35, '幹線 handleMin 應為上貨＋下貨加總（G35）');
  });

  test('G19 越快越好：選最早出發班次', () => {
    const H = fresh();
    const { result } = submit(H, { recvMode: 'asap' });
    ok(result.ok, '應排入'); eq(result.shift.id, 'D1-R1', 'asap 應排最早班次 R-A1（08:30）');
  });

  test('G19 指定期望時間：以交貨時間為目標，選到站時間差最小的班次（早晚都比）', () => {
    const H = fresh();
    const { result } = submit(H, { recvMode: 'exact', deliverTime: '20:00' });
    ok(result.ok); eq(result.shift.id, 'D1-R11', '期望 20:00 應選最接近的末班（每小時一班、末班 18:00）');
  });

  test('指定期望時間不再需要期望到站時間欄位（expectTime 已移除）', () => {
    const H = fresh();
    const { app } = submit(H, { recvMode: 'exact', deliverTime: '20:00' });
    eq(app.expectTime, undefined, '不應再保存 expectTime 欄位');
  });

  test('越快越好不使用交貨時間：空 deliverTime 不設限、選最早班次', () => {
    const H = fresh();
    // 越快越好模式即使貨物很小，仍應忽略交貨時間、直接排最早班次
    const { app, result } = submit(H, { recvMode: 'asap', deliverTime: '' });
    ok(result.ok, '應媒合成功'); eq(app.deliverTime, '', '越快越好不帶交貨時間');
    eq(result.shift.id, 'D1-R1', '無截止 → 排最早班次 R-A1');
  });

  test('A-1 期望時間非硬性截止：期望早於首班到站仍排入首班並回報時間差', () => {
    const H = fresh();
    // 300 站到站：08:00 班＝08:00+3×3＝08:09；期望 08:00 早於任何班次 → 仍應排入最接近的首班，不得退件
    const { app, result } = submit(H, { recvMode: 'exact', deliverTime: '08:00' });
    ok(result.ok, '不得因期望時間過早而失敗（無 late 退件）');
    eq(result.shift.id, 'D1-R1', '應選到站時間差最小的 R-A1');
    ok(result.expectDiffMin > 0, '應回報較期望時間晚的分鐘數，實得 ' + result.expectDiffMin);
    eq(app.expectDiffMin, result.expectDiffMin, '差值應存於申請單供顯示');
  });

  test('A-1 失敗原因只剩 toobig 與 full（無 late 原因碼）', () => {
    const H = fresh();
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    for (let i = 0; i < 14; i++) submit(H, { items: [big()], handleMin: 1 });
    const r1 = submit(H, { items: [big()], handleMin: 1, recvMode: 'exact', deliverTime: '08:00' }).result;
    ok(!r1.ok && r1.reason === 'full', '排滿後即使期望極早也應回 full 而非 late，實得 ' + r1.reason);
  });

  test('期望時間空值：asap 排最早班；asap 不受期望時間影響', () => {
    const H = fresh();
    eq(submit(H, { deliverTime: '' }).result.shift.id, 'D1-R1', '空值應排最早班');
    eq(submit(fresh(), { recvMode: 'asap', deliverTime: '23:59' }).result.shift.id, 'D1-R1', 'asap 模式不用期望時間');
  });

  test('A-2 先卸後裝：站區間不重疊的兩張大單可同班次（卸貨釋放容量）', () => {
    const H = fresh();
    // 每張有效體積 ≈8886L（V-L01 容量 ≈14364L 的 62%）：舊邏輯兩張累計必爆
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    const a1 = submit(H, { pickStation: 'D1-100', station: 'D1-300', items: [big()], handleMin: 1 }).app; // 佔 [1,3)
    const a2 = submit(H, { pickStation: 'D1-500', station: 'D1-800', items: [big()], handleMin: 1 }).app; // 佔 [5,8)
    eq(a1.assignedShift, 'D1-R1', '第一張排首班');
    eq(a2.assignedShift, 'D1-R1', '區間不重疊 → 第二張也應排同一班（容量已於 S3 釋放）');
  });

  test('A-2 區間重疊仍受容量限制：跨越整段的大單須順延', () => {
    const H = fresh();
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    submit(H, { pickStation: 'D1-100', station: 'D1-300', items: [big()], handleMin: 1 });
    submit(H, { pickStation: 'D1-500', station: 'D1-800', items: [big()], handleMin: 1 });
    const a3 = submit(H, { pickStation: 'D1-100', station: 'D1-900', items: [big()], handleMin: 1 }).app; // 佔 [1,9) 與兩張皆重疊
    ok(a3.assignedShift !== 'D1-R1', '與既有單重疊區間容量不足 → 不得排首班，實得 ' + a3.assignedShift);
  });

  test('G16 上下貨合計計入班次預算：兩單合計超過 60 分，第二張順延', () => {
    const H = fresh();
    // 兩張各 上貨30+下貨5＝handleMin 35：第一張 35≤60；第二張累計 70>60 → 順延
    const a1 = submit(H, { pickStation: 'D1-400', station: 'D1-700', loadMin: 30, unloadMin: 5, handleMin: undefined }).app;
    const a2 = submit(H, { pickStation: 'D1-400', station: 'D1-800', loadMin: 30, unloadMin: 5, handleMin: undefined }).app;
    eq(a1.assignedShift, 'D1-R1', '第一張排首班（35≤60）');
    ok(a2.assignedShift !== 'D1-R1', '累計 70>60 分 → 第二張應順延，實得 ' + a2.assignedShift);
  });

  test('班次主檔為每據點每小時一班（早到晚）', () => {
    const H = fresh();
    const br1Shifts = H.DB.regionalShifts.filter(s => s.branch === 'D1');
    eq(br1Shifts.length, 11, '每據點應有 11 個班次（08:00~18:00 每小時一班）');
    const deps = br1Shifts.map(s => s.depart);
    eq(deps.join(','), '08:00,09:00,10:00,11:00,12:00,13:00,14:00,15:00,16:00,17:00,18:00', '班次時間應由早到晚每小時一班');
    for (let i = 1; i < deps.length; i++) {
      ok(H.hhmmToMin(deps[i]) > H.hhmmToMin(deps[i - 1]), '班次須遞增');
    }
  });

  test('日期：預設為今天；exact 可指定未來日期', () => {
    const H = fresh(); fixNow(H); H.ModuleA.__fixed = true;
    eq(submit(H).app.serviceDate, FIX_DATE, 'asap 應為今天');
    const future = '2026-09-10';
    eq(submit(H, { recvMode: 'exact', deliverTime: '14:00', serviceDate: future }).app.serviceDate, future,
      'exact 應保存指定日期');
  });

  test('日期：已過的日期不可媒合 → reason=past', () => {
    const H = fresh(); fixNow(H); H.ModuleA.__fixed = true;
    const { app, result } = submit(H, { recvMode: 'exact', deliverTime: '14:00', serviceDate: '2026-09-01' });
    ok(!result.ok, '過去日期應失敗');
    eq(result.reason, 'past');
    ok(/日期已過|早於今天/.test(result.msg), '訊息需說明日期已過');
    eq(app.status, 'unscheduled');
  });

  test('今天過去的時間不可媒合：已出發班次不採計，只排之後的班次', () => {
    const H = fresh(); fixNow(H, 11, 0); H.ModuleA.__fixed = true; // 現在 11:00
    // 每小時一班：08~11:00 皆已發車 → 應排 12:00 的 R5
    const { app, result } = submit(H, { pickStation: 'D1-100', station: 'D1-300' });
    ok(result.ok, '仍應媒合到之後的班次');
    eq(result.shift.id, 'D1-R5', '11:00 時 08~11:00 班皆已發車 → 應排 12:00 的 R5');
    eq(app.serviceDate, FIX_DATE);
  });

  test('卡發車時間：已發車的班次不可媒合（司機出發後不知新單）', () => {
    const H = fresh(); fixNow(H, 10, 40); H.ModuleA.__fixed = true; // 現在 10:40
    // 10:00 班已於 10:00 發車（雖未抵收貨站）→ 不可再排 → 應排 11:00 的 R4
    const { result } = submit(H, { pickStation: 'D1-300', station: 'D1-600' });
    ok(result.ok, '應媒合到尚未發車的班次');
    eq(result.shift.id, 'D1-R4', '10:00 班已發車雖未到收貨站仍不可排 → 應排未發車的 11:00 R4');
  });

  test('今天班次全數過後 → reason=past，提示改指定未來日期', () => {
    const H = fresh(); fixNow(H, 23, 0); H.ModuleA.__fixed = true; // 現在 23:00，全部班次已過
    const { app, result } = submit(H);
    ok(!result.ok, '應媒合失敗');
    eq(result.reason, 'past', '今日班次皆已過 → past');
    ok(/未來日期/.test(result.msg), '訊息需建議改指定未來日期');
    eq(app.status, 'unscheduled');
  });

  test('車次異動：改派班次更新 assignedShift 並重算到站時間', () => {
    const H = fresh();
    const { app } = submit(H, { pickStation: 'D1-100', station: 'D1-300' });
    ok(app.status === 'matched' && app.assignedShift, '先媒合成功');
    const target = H.DB.regionalShifts.find(s => s.branch === app.branch && s.id !== app.assignedShift);
    const st = H.DB.stations.find(s => s.id === app.station);
    H.ModuleA.reassignShift(app, target.id);
    eq(app.assignedShift, target.id, '班次應改為目標班次');
    eq(app.arrival, H.minToHHMM(H.ModuleA.shiftArrivalAtStation(target, st.order)), '到站時間應依新班次重算');
  });

  test('車次異動：移出班次 → 回未排入、清空班次與到站', () => {
    const H = fresh();
    const { app } = submit(H, { pickStation: 'D1-100', station: 'D1-300' });
    H.ModuleA.removeFromShift(app);
    eq(app.status, 'unscheduled', '移出後回未排入');
    eq(app.assignedShift, null, '班次應清空');
    eq(app.arrival, null, '到站應清空');
  });

  test('車次異動：shiftPlan 預設取班次主檔車輛，覆寫後以覆寫為準', () => {
    const H = fresh();
    const sh = H.DB.regionalShifts[0];
    const def = H.ModuleA.shiftPlan('2026-09-10', sh.id);
    eq(def.vehicle, sh.vehicle, '預設車輛＝班次主檔車輛');
    ok(def.driver, '預設應有司機');
    H.ModuleA.setShiftPlan('2026-09-10', sh.id, { vehicle: 'V-L02', driver: 'DR2' });
    const ov = H.ModuleA.shiftPlan('2026-09-10', sh.id);
    eq(ov.vehicle, 'V-L02', '覆寫車輛生效'); eq(ov.driver, 'DR2', '覆寫司機生效');
    // 覆寫僅限該日該班次，不影響其他日期
    eq(H.ModuleA.shiftPlan('2026-09-11', sh.id).vehicle, sh.vehicle, '他日不受影響');
  });

  test('未來日期不受今日時間限制：深夜下單仍可排隔日全部班次', () => {
    const H = fresh(); fixNow(H, 23, 0); H.ModuleA.__fixed = true;
    const { result } = submit(H, { recvMode: 'exact', deliverTime: '09:00', serviceDate: '2026-09-03' });
    ok(result.ok, '未來日期應可媒合');
    eq(result.shift.id, 'D1-R2', '期望 09:00 應選到站最接近的 09:00 班（每小時一班）');
  });

  test('不同日期互不佔用同一班次的容量與站內額度', () => {
    const H = fresh(); fixNow(H); H.ModuleA.__fixed = true;
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    // 今天把 R-A1 佔到滿（同站區間、額度 1 分避免額度先擋）
    const d1 = [];
    for (let i = 0; i < 3; i++) d1.push(submit(H, { items: [big()], handleMin: 1 }).app);
    ok(d1.some(a => a.assignedShift === 'D1-R1'), '今天應有單佔用 R-A1');
    // 未來日期同樣條件 → 應可再次排入 R-A1（容量獨立計算）
    const fut = submit(H, { items: [big()], handleMin: 1, recvMode: 'exact', deliverTime: '08:30', serviceDate: '2026-09-20' }).app;
    eq(fut.assignedShift, 'D1-R1', '不同日期不應共用容量，未來日期仍可排 R-A1');
    // 額度亦然：同站上貨 30 分，今天與未來各自計算
    const q1 = submit(H, { pickStation: 'D1-400', station: 'D1-700', loadMin: 30, unloadMin: 5, handleMin: undefined }).app;
    const q2 = submit(H, { pickStation: 'D1-400', station: 'D1-700', loadMin: 30, unloadMin: 5, handleMin: undefined,
      recvMode: 'exact', deliverTime: '08:30', serviceDate: '2026-09-21' }).app;
    eq(q1.assignedShift, 'D1-R1'); eq(q2.assignedShift, 'D1-R1', '不同日期額度獨立，皆可排首班');
  });

  test('接收人資訊（單位/姓名/電話/代理人）隨申請單保存', () => {
    const H = fresh();
    const r = { unit: '生產部', name: '林建志', phone: '03-1234567', agentName: '陳怡君', agentPhone: '0912-345-678' };
    const { app } = submit(H, { recipient: r });
    eq(app.recipient.unit, '生產部'); eq(app.recipient.name, '林建志');
    eq(app.recipient.phone, '03-1234567'); eq(app.recipient.agentName, '陳怡君');
    eq(app.recipient.agentPhone, '0912-345-678');
  });

  test('未帶接收人資訊時 recipient 為空物件（不擲例外）', () => {
    const H = fresh();
    const { app } = submit(H);
    eq(typeof app.recipient, 'object'); eq(Object.keys(app.recipient).length, 0);
  });
});

/* =================================================================
   模組 B：南北幹線（G30–G44）
   ================================================================= */
group('模組 B 南北幹線（G30–G44 / T4-2〜T4-5）', () => {
  function mkOrder(H, over) {
    return H.ModuleB.createOrder(Object.assign({
      applicant: 'X', site: 'D3', destSite: 'D1', direct: false,
      volume: 3000, category: 'BOX', weight: 300, handleMin: 30,
    }, over));
  }

  test('G01/G03 幹線容量套用共用浪費係數（A/B 共用，非繞過）', () => {
    const H = fresh();
    const o = mkOrder(H, { volume: 1000, category: 'IRREG' }); // 1.65
    approx(H.ModuleB.effVolume(o), 1650, 1, '1000L × 1.65 = 1650L');
  });

  test('多筆貨物項目（各填獨立尺寸/重量）：raw 體積與有效體積逐項加總（G13/G34）', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'X', site: 'D3', destSite: 'D1', direct: false, handleMin: 20,
      items: [ { name: 'a', l: 100, w: 100, h: 100, qty: 1, category: 'BOX', weight: 100 },    // 1000L×1.10=1100
               { name: 'b', l: 200, w: 100, h: 100, qty: 1, category: 'IRREG', weight: 300 } ] }); // 2000L×1.65=3300
    eq(o.volume, 3000, 'raw 體積應為各項尺寸加總');
    eq(o.weight, 400, 'weight 應為各項加總');
    approx(H.ModuleB.effVolume(o), 1100 + 3300, 1, '有效體積＝逐項（體積×類別係數×形狀）加總');
    // 編輯：改成單件小箱後 recompute
    o.items = [{ name: 'a', l: 50, w: 50, h: 40, qty: 1, category: 'BOX', weight: 20 }]; // 100L×1.10=110
    H.ModuleB.recompute(o);
    eq(o.volume, 100, '編輯後 recompute 應更新加總'); approx(H.ModuleB.effVolume(o), 110, 1);
  });

  test('起迄兩點：pickSite（起）/dropSite（迄）皆記錄；直達以送貨據點分流（G38）', () => {
    const H = fresh();
    // 去程 D9→D3
    const o = H.ModuleB.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false, handleMin: 20,
      items: [{ name: 'a', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }] });
    eq(o.pickSite, 'D9', '收貨據點（起）'); eq(o.dropSite, 'D3', '送貨據點（迄）');
    // 兩張直達：送貨據點不同 → 一台直達車只服務單一送貨據點
    const d1 = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D2', direct: true, handleMin: 20, items: [{ name: 'x', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }] });
    const d2 = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D1', direct: true, handleMin: 20, items: [{ name: 'y', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }] });
    [d1, d2].forEach(x => H.ModuleB.approve(x));
    const r = H.ModuleB.dispatch('V-T01', 'direct');
    eq(r.endpoint, 'D2', '直達終點＝最早核准直達單的送貨據點（G38）');
    ok(r.carried.some(o => o.id === d1.id) && !r.carried.some(o => o.id === d2.id), '不同送貨據點不得同車（G38）');
  });

  test('G32/G33 非直達貪婪：容量或時間先觸頂即終點，動態淨值計容量', () => {
    const H = fresh();
    // 三張沿線單，體積足以在中途觸容量頂
    const o1 = mkOrder(H, { site: 'D9', volume: 9000, weight: 500 });
    const o2 = mkOrder(H, { site: 'D6', volume: 9000, weight: 500 });
    const o3 = mkOrder(H, { site: 'D3', volume: 9000, weight: 500 });
    [o1, o2, o3].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatch('V-T02', 'greedy'); // 容量 20160L
    eq(r.mode, 'greedy');
    ok(r.capUsed <= r.capTotal, '動態淨值不得超過容量');
    ok(r.carried.length >= 1 && r.carried.length < 3, '應部分裝載後觸頂，非全載');
  });

  test('G33 到送貨據點卸貨釋出容量：接力兩單皆可載（否則會爆容量）', () => {
    const H = fresh();
    // V-T02 容量 20160L。兩單各 ≈13200L 有效，同時在車上會爆（26400>20160）
    const big = () => [{ name: '大箱', l: 200, w: 200, h: 300, qty: 1, category: 'BOX', weight: 100 }]; // 12000L×1.1=13200
    const o1 = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D6', direct: false, handleMin: 20, items: big() });
    const o2 = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', destSite: 'D3', direct: false, handleMin: 20, items: big() });
    [o1, o2].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.some(o => o.id === o1.id) && r.carried.some(o => o.id === o2.id),
      'o1 於 D6 卸貨後釋出容量 → o2 於 D6 才裝得下（G33）');
    ok(r.capUsed <= r.capTotal, '峰值淨值不得超過容量');
    ok(r.delivered && r.delivered.some(o => o.id === o1.id), 'o1 應已於 D6 卸貨（delivered）');
    eq(r.endpoint, 'D3', '終點須涵蓋最南送貨據點 D3');
  });

  test('G34 部分裝載以整張表單為最小單位（放不下整張跳過）', () => {
    const H = fresh();
    const small = mkOrder(H, { site: 'D9', volume: 1000, weight: 100 }); // 先核准
    const huge = mkOrder(H, { site: 'D9', volume: 100000, weight: 100 }); // 單張爆量
    H.ModuleB.approve(small); H.ModuleB.approve(huge);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.some(o => o.id === small.id), '小單應載入');
    ok(!r.carried.some(o => o.id === huge.id), '爆量單應整張跳過（不拆線項 G34）');
  });

  test('G38/G39 直達：獨立派車、單一目的地、純容量加總、超量留下一班', () => {
    const H = fresh();
    const d1 = mkOrder(H, { site: 'D9', destSite: 'D2', direct: true, volume: 15000, weight: 1000 });
    const d2 = mkOrder(H, { site: 'D9', destSite: 'D2', direct: true, volume: 15000, weight: 1000 }); // V-T01 容量 34560L，兩張=33000 尚可
    const d3 = mkOrder(H, { site: 'D9', destSite: 'D2', direct: true, volume: 15000, weight: 1000 }); // 第三張超量
    const other = mkOrder(H, { site: 'D9', destSite: 'D3', direct: true, volume: 1000 }); // 不同目的地，不同車
    [d1, d2, d3, other].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatch('V-T01', 'direct');
    eq(r.mode, 'direct');
    eq(r.endpoint, 'D2', '直達終點＝申請單目的地（單一目的地 G38）');
    ok(!r.carried.some(o => o.id === other.id), '不同目的地不得同車（G38）');
    ok(!r.carried.some(o => o.id === d3.id), '超量第三張應留下一班直達車（G39）');
    eq(r.days, H.ModuleB.minTripDaysFor(H.DB.vehicles.find(v => v.id === 'V-T01'), 'D2'),
      '天數查「車型×目的地」最短天數表（3.1，僅參考值）');
  });

  test('直達(a)：2.19 收貨時間窗以「行經取貨據點時間」判定，超窗媒合不到', () => {
    const H = fresh();
    const veh = H.DB.vehicles.find(v => v.id === 'V-T01'); // 大車
    const base = H.hhmmToMin(H.DB.shiftStartDefault) + H.DB.prepMin;
    const passD6 = base + H.ModuleB.travelMin('D9', 'D6', veh.sizeClass); // 行經取貨據點 D6 的時間
    // 希望收貨時間設得夠早，使行經時間超出〔希望時間＋4h〕→ 媒合不到（急件另派 2.22）
    const want = H.minToHHMM(passD6 - H.DB.receiveWindowMin - 30);
    const item = [{ name: 'x', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }];
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D1', direct: true,
      loadMin: 20, unloadMin: 0, wantReceiveTime: want, items: item });
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T01', 'direct');
    ok(!r.carried.some(x => x.id === o.id), '行經取貨據點時間超出收貨窗 → 應媒合不到');
    eq(o.status, 'approved', '未排入者狀態不應改為 loaded');
  });

  test('直達(b)：來收時間＝經過取貨據點時間，非抵達迄點時間', () => {
    const H = fresh();
    const veh = H.DB.vehicles.find(v => v.id === 'V-T01'); // 大車
    const item = [{ name: 'x', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }];
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D1', direct: true,
      loadMin: 20, unloadMin: 0, items: item });
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T01', 'direct');
    ok(r.carried.some(x => x.id === o.id), '無交貨時間限制 → 應載入');
    const base = H.hhmmToMin(H.DB.shiftStartDefault) + H.DB.prepMin;
    const expectPass = H.minToHHMM(base + H.ModuleB.travelMin('D9', 'D6', veh.sizeClass));
    eq(o.pickupTime, expectPass, '來收時間＝基地→取貨據點 D6 的經過時間');
    const arriveDest = base + H.ModuleB.travelMin('D9', 'D1', veh.sizeClass);
    ok(H.hhmmToMin(o.pickupTime) < arriveDest, 'D6 來收應早於 D1 抵達（不再等於迄點時間）');
  });

  test('G40/G41/G42 回程撞期直達 → 鎖定直達、延續動態淨值、排擠非直達順延', () => {
    const H = fresh();
    const rd = H.ModuleB.createOrder({ applicant: 'A', site: 'D3', direct: true, volume: 2000, weight: 200, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', direct: false, volume: 2000, weight: 200, handleMin: 20 });
    [rd, rn].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 500);
    eq(r.matrixRow, 4, '應為矩陣第 4 列（回程・被迫鎖定直達）');
    eq(r.endpoint, H.DB.homeSite, '回程終點仍為出發據點（G41/G36）');
    ok(r.carried.some(o => o.id === rd.id), '撞期直達回程單應載入');
    ok(r.deferred.some(o => o.id === rn.id), '被排擠非直達單應自動順延（G42）');
  });

  test('G40 回程無撞期直達 → 動態淨值沿路收送（矩陣第 3 列）', () => {
    const H = fresh();
    const rn = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', direct: false, volume: 2000, weight: 200, handleMin: 20 });
    H.ModuleB.approve(rn);
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 0);
    eq(r.matrixRow, 3, '無撞期直達 → 第 3 列');
    ok(r.carried.some(o => o.id === rn.id), '應沿路收非直達回程貨');
  });

  test('G41(3.3) 去程原為直達車的回程 → 矩陣第 5 列、純不停靠', () => {
    const H = fresh();
    const r = H.ModuleB.dispatchReturn('V-T01', 'D2', true, 1000);
    eq(r.matrixRow, 5); eq(r.endpoint, H.DB.homeSite); ok(r.locked, '應鎖定'); eq(r.carried.length, 0);
  });

  test('派車後每張已載單標記「幾點來收」（車號＋來收時間，顯示給申請人）', () => {
    const H = fresh();
    // 去程非直達 + 直達各一，及一張回程單
    const g = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false, volume: 2000, category: 'BOX', weight: 300, handleMin: 30 });
    const d = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D3', direct: true, volume: 2000, category: 'BOX', weight: 300, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'C', site: 'D6', direct: false, volume: 1000, category: 'BOX', weight: 200, handleMin: 20 }); // 北上（→ homeSite）
    [g, d, rn].forEach(o => H.ModuleB.approve(o));
    H.ModuleB.dispatch('V-T02', 'greedy');
    H.ModuleB.dispatch('V-T01', 'direct');
    H.ModuleB.dispatchReturn('V-T02', 'D6', false, 0);
    ok(/^\d{2}:\d{2}$/.test(g.pickupTime || ''), '去程非直達單應有來收時間，實得 ' + g.pickupTime);
    ok(/^\d{2}:\d{2}$/.test(d.pickupTime || ''), '去程直達單應有來收時間，實得 ' + d.pickupTime);
    ok(/^\d{2}:\d{2}$/.test(rn.pickupTime || ''), '回程單應有來收時間，實得 ' + rn.pickupTime);
    ok(g.dispatchVehicle && d.dispatchVehicle && rn.dispatchVehicle, '每張已載單應有車號');
  });

  test('派車方向標記 dispatchDir：去程=south、回程=north（司機任務單依此分趟，不混疊時間軸）', () => {
    const H = fresh();
    const g = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false, volume: 2000, category: 'BOX', weight: 300, handleMin: 30 });
    const d = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D2', direct: true, volume: 2000, category: 'BOX', weight: 300, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'C', site: 'D6', direct: false, volume: 1000, category: 'BOX', weight: 200, handleMin: 20 }); // 北上（→ homeSite）
    [g, d, rn].forEach(o => H.ModuleB.approve(o));
    H.ModuleB.dispatch('V-T02', 'greedy');      // 去程非直達
    H.ModuleB.dispatch('V-T01', 'direct');      // 去程直達（急件）
    H.ModuleB.dispatchReturn('V-T02', 'D6', false, 0); // 回程（沿線收送）
    eq(g.dispatchDir, 'south', '去程非直達單應標記 south，實得 ' + g.dispatchDir);
    eq(d.dispatchDir, 'south', '去程直達單應標記 south，實得 ' + d.dispatchDir);
    eq(rn.dispatchDir, 'north', '回程單應標記 north，實得 ' + rn.dispatchDir);
  });

  test('來收時間依收貨據點：同據點同車相同、不同據點不同（沿線現場收）', () => {
    const H = fresh();
    // 同一收貨據點 D6 兩張 + 另一據點 D3 一張，皆非直達、同車貪婪
    const a = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D1', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    const b = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', destSite: 'D1', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    const c = H.ModuleB.createOrder({ applicant: 'C', site: 'D3', destSite: 'D1', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    [a, b, c].forEach(o => H.ModuleB.approve(o));
    H.ModuleB.dispatch('V-T02', 'greedy');
    eq(a.pickupTime, b.pickupTime, '同一收貨據點、同車 → 來收時間應相同');
    ok(c.pickupTime !== a.pickupTime, '較南邊的據點 → 來收時間應較晚（不同）');
    ok(H.hhmmToMin(c.pickupTime) > H.hhmmToMin(a.pickupTime), 'D3 比 D6 南 → 來收時間應更晚');
  });

  test('2.19 收貨時間窗：抵達晚於〔希望收貨時間＋4h〕→ 媒合不到（留下一班）', () => {
    const H = fresh();
    // V-T02 自 D9 08:30 出發，抵 D6 為 11:00；希望收貨 06:00 → 窗口 06:00–10:00，11:00 已超窗
    const late = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20, wantReceiveTime: '06:00' });
    H.ModuleB.approve(late);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(!r.carried.includes(late), '抵達 11:00 晚於收貨窗 06:00＋4h（10:00）→ 不應排入');
    eq(late.status, 'approved', '媒合不到者狀態不應改為 loaded');
    ok(r.unmatched && r.unmatched.includes(late), '應列入媒合不到清單（2.21）');
  });

  test('2.19 收貨時間窗：抵達落在窗內 → 正常收貨排入', () => {
    const H = fresh();
    // 抵 D6 為 11:00；希望收貨 08:00 → 窗口 08:00–12:00，11:00 在窗內
    const good = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20, wantReceiveTime: '08:00' });
    H.ModuleB.approve(good);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(good), '11:00 落在 08:00–12:00 窗內 → 應排入');
    eq(good.status, 'loaded', '排入後狀態為 loaded');
  });

  test('2.19 收貨時間窗：早到須等待至希望收貨時間，等待計入在勤', () => {
    const H = fresh();
    // 抵 D6 為 11:00；希望收貨 12:00 → 早到 60 分，須等待至 12:00 才收貨
    const early = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20, wantReceiveTime: '12:00' });
    H.ModuleB.approve(early);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(early), '早到窗前仍可收（等待即可）→ 應排入');
    eq(early.pickupTime, '12:00', '來收時間＝希望收貨時間（早到須等待，不得提前收貨）');
  });

  test('2.19 收貨時間窗空值＝不設限：派車行為與既有相容', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20 }); // 無 wantReceiveTime
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(o), '未設收貨時間窗應照常排入');
  });

  test('2.18 站內建物間移動時間 =（拜訪棟數−1）×每棟增量', () => {
    const H = fresh();
    eq(H.ModuleB.intraSiteMoveMin(1), 0, '僅一棟不移動');
    eq(H.ModuleB.intraSiteMoveMin(2), H.DB.intraSiteMovePerBuildingMin, '兩棟移動一段');
    eq(H.ModuleB.intraSiteMoveMin(3), 2 * H.DB.intraSiteMovePerBuildingMin, '三棟移動兩段');
  });

  test('2.18 站內移動時間計入當日在勤：同站多棟較單棟多耗（棟數−1）×增量', () => {
    const perBldg = fresh().DB.intraSiteMovePerBuildingMin;
    // 兩單同站 D9 取貨、同送 D1；不同收貨建物 → D9 需 2 棟移動一段；相同建物 → 不移動
    const two = (pb1, pb2) => {
      const H = fresh();
      const mk = pb => H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D1', direct: false,
        volume: 500, category: 'BOX', weight: 50, handleMin: 10, pickupLoc: pb, deliverLoc: 'A 棟倉庫' });
      const a = mk(pb1), b = mk(pb2); [a, b].forEach(o => H.ModuleB.approve(o));
      return H.ModuleB.dispatch('V-T02', 'greedy');
    };
    const diff = two('北棟月台', '南棟倉');   // 兩棟
    const same = two('北棟月台', '北棟月台'); // 一棟
    eq(diff.timeUsed - same.timeUsed, perBldg,
      '不同建物較同建物多一段站內移動時間（2.18）');
  });

  test('2.22 出發據點不限龍潭：可指定任一據點為出發點', () => {
    const H = fresh();
    // 自 D6 出發：D6→D3 可服務；D9→D3（收貨據點 D6 以北）不可服務
    const okOrder = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    const northOrder = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    [okOrder, northOrder].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatch('V-T02', 'greedy', null, 'D6'); // 出發據點 = D6
    eq(r.origin, 'D6', '出發據點應為指定的 D6');
    ok(r.carried.includes(okOrder), 'D6→D3 自 D6 出發可服務');
    ok(!r.carried.includes(northOrder), 'D9（D6 以北）之貨不排入自 D6 出發之車次');
  });

  test('2.22 未指定出發據點時預設主檔 homeSite', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    eq(r.origin, H.DB.homeSite, '未指定出發據點 → 預設主檔 homeSite');
  });

  test('2.17 車型決定：總貨量未超過小車容量上限 → 派小車', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    H.ModuleB.approve(o);
    const dec = H.ModuleB.decideSizeClass('greedy', null, null, 'south');
    eq(dec.sizeClass, 'small', '小量 → 小車');
    eq(dec.vehicle, H.ModuleB.trunkVehicle('small').id, '代表車＝主檔小車');
  });

  test('2.17 車型決定：總貨量超過小車容量上限 → 派大車（單純門檻，不做填載率最佳化）', () => {
    const H = fresh();
    const small = H.ModuleB.trunkVehicle('small');
    // 單張有效體積即超過小車容積上限
    const bigOrder = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false,
      volume: Math.ceil(small.volume), category: 'BOX', weight: 50, handleMin: 10 }); // ×1.1 必超過
    H.ModuleB.approve(bigOrder);
    const dec = H.ModuleB.decideSizeClass('greedy', null, null, 'south');
    eq(dec.sizeClass, 'big', '總貨量超過小車容量上限 → 大車');
    eq(dec.vehicle, H.ModuleB.trunkVehicle('big').id, '代表車＝主檔大車');
    ok(dec.totalVol > dec.threshVol, 'totalVol 應大於小車門檻');
  });

  test('2.17 車型決定：重量超過小車載重上限亦派大車', () => {
    const H = fresh();
    const small = H.ModuleB.trunkVehicle('small');
    const heavy = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: small.weight + 100, handleMin: 10 });
    H.ModuleB.approve(heavy);
    const dec = H.ModuleB.decideSizeClass('greedy', null, null, 'south');
    eq(dec.sizeClass, 'big', '總重量超過小車載重上限 → 大車');
  });

  test('2.20/2.21 統一媒合：候選單若排擠既定行程收貨時間窗 → 媒合不到，既定行程不受影響', () => {
    const H = fresh();
    // 既定行程 A（先核准）：D6 取貨、窗 11:00–15:00，車無 B 時 11:00 抵 D6 → 收得到
    const A = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, loadMin: 10, unloadMin: 10, wantReceiveTime: '11:00' });
    // 候選 B（後核准）：D9 取貨、上貨 250 分，會把抵 D6 時間拖到 15:10（超出 A 的窗）
    const B = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D1', direct: false,
      volume: 500, category: 'BOX', weight: 50, loadMin: 250, unloadMin: 10, wantReceiveTime: '08:30' });
    H.ModuleB.approve(A); H.ModuleB.approve(B);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(A), '既定行程 A 不受候選單排擠，仍應收到（2.21）');
    ok(!r.carried.includes(B), '候選 B 會排擠 A 的收貨時間窗 → 媒合不到，不上車（2.21）');
    ok(r.unmatched.includes(B), 'B 應列於媒合不到清單');
  });

  test('2.21 媒合以「當趟送得到」為準：simulateSouthbound 同時回傳 served 與 delivered', () => {
    const H = fresh();
    const big = () => [{ name: '大箱', l: 200, w: 200, h: 300, qty: 1, category: 'BOX', weight: 100 }];
    const o1 = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D6', direct: false, handleMin: 20, items: big() });
    const o2 = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', destSite: 'D3', direct: false, handleMin: 20, items: big() });
    [o1, o2].forEach(o => H.ModuleB.approve(o));
    const veh = H.DB.vehicles.find(v => v.id === 'V-T02');
    const sim = H.ModuleB.simulateSouthbound([o1, o2], veh, 'D9');
    ok(sim.served.has(o1.id) && sim.served.has(o2.id), 'served 應含兩者（已收）');
    ok(sim.delivered.has(o1.id) && sim.delivered.has(o2.id), '兩單皆於沿線卸貨 → delivered 應含兩者（媒合以送達為準）');
  });

  test('2.20/2.21 候選單不排擠既定行程時正常納入', () => {
    const H = fresh();
    const A = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, loadMin: 10, unloadMin: 10, wantReceiveTime: '11:00' });
    const B = H.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D1', direct: false,
      volume: 500, category: 'BOX', weight: 50, loadMin: 10, unloadMin: 10 }); // 上貨短，不拖累 A
    H.ModuleB.approve(A); H.ModuleB.approve(B);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(A) && r.carried.includes(B), '不排擠 → 兩張皆媒合');
  });

  test('B-1 出發據點走主檔 homeSite，不寫死 D10（改中段基地仍正確）', () => {
    const H = fresh();
    H.DB.homeSite = 'D8'; // 基地移到中段
    // D6→D3 南下單：基地 D8 以南，應被 D8 出發的貪婪車收到
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(o), '中段基地 D8 出發仍應收到 D6→D3 的南下單');
    // 回程終點應為 homeSite 而非硬編 D10
    const rn = H.ModuleB.createOrder({ applicant: 'B', site: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    eq(rn.dropSite, 'D8', '未指定迄點應預設回主檔 homeSite');
    H.ModuleB.approve(rn);
    eq(H.ModuleB.dispatchReturn('V-T01', 'D3', false, 0).endpoint, 'D8', '回程終點＝homeSite');
  });

  test('B-1 基地預設為 D9 龍潭（中段），南下路線不含基地以北據點', () => {
    const H = fresh();
    eq(H.DB.homeSite, 'D9', '主檔基地應為龍潭 D9');
    const seq = H.ModuleB.southboundFrom(H.DB.homeSite).map(s => s.id);
    ok(!seq.includes('D10'), '南下序列不應含基地以北的 D10');
    eq(seq[0], 'D8', '自 D9 南下第一站為 D8');
  });

  test('B-1 基地以北據點不靜默載走：明確不排入並說明原因（待業務確認）', () => {
    const H = fresh();
    // 送到 D10（基地 D9 以北）
    const north = H.ModuleB.createOrder({ applicant: 'A', site: 'D3', destSite: 'D10', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    H.ModuleB.approve(north);
    ok(!H.ModuleB.isServable(north), '涉及基地以北據點應判為不可服務');
    ok(/以北/.test(H.ModuleB.unservableReason(north)), '原因需說明位於基地以北');
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 0);
    ok(!r.carried.includes(north), '不得載走無法卸貨的北側單');
    eq(north.status, 'approved', '應留在待派車而非 loaded');
    ok(r.trace.some(t => t.includes(north.id)), 'trace 需明確說明未排入原因');
    // 自 D10 出發南下者亦同
    const fromNorth = H.ModuleB.createOrder({ applicant: 'B', site: 'D10', destSite: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 });
    H.ModuleB.approve(fromNorth);
    const r2 = H.ModuleB.dispatch('V-T01', 'greedy');
    ok(!r2.carried.includes(fromNorth), '自基地以北出發者不排入');
    ok(r2.trace.some(t => t.includes(fromNorth.id)), 'trace 需說明原因');
  });

  test('B-1 回程於終點（基地）卸貨：送回基地的單有卸貨時間', () => {
    const H = fresh();
    const back = H.ModuleB.createOrder({ applicant: 'A', site: 'D3', direct: false,
      volume: 500, category: 'BOX', weight: 50, handleMin: 10 }); // 未指定迄點 → 預設回基地
    eq(back.dropSite, H.DB.homeSite, '預設迄點＝基地');
    H.ModuleB.approve(back);
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 0);
    ok(r.carried.includes(back), '應載回基地');
    ok(/^\d{2}:\d{2}$/.test(back.dispatchDropTime || ''), '抵達基地應記錄卸貨時間，實得 ' + back.dispatchDropTime);
  });

  test('G122 狀態流：待二級審→待調度→調度中→調度主管審→待出車→已出車（無已派車／已交貨）', () => {
    const H = fresh(), F = H.Flow;
    ok(typeof H.ModuleB.acceptDelivery === 'undefined' && typeof H.ModuleB.confirmDelivery === 'undefined', '刪除已交貨');
    const o = mkOrder(H, { site: 'D9', destSite: 'D3' });
    eq(F.of(o), 'review');
    H.ModuleB.approve(o); eq(F.of(o), 'todo');
    H.ModuleB.dispatch('V-T02', 'greedy', '2026-12-31');
    eq(o.status, 'loaded'); eq(F.of(o), 'dispatching', '併入派車單＝調度中');
    H.ModuleB.submitDispatch(H.ModuleB.dispatchOf(o)); eq(F.of(o), 'signing', '送審＝調度主管審');
    ok(H.ModuleB.signApprove(o, '運輸主管').ok); eq(F.of(o), 'ready', '同意＝待出車');
    F._now = new Date(2026, 11, 31, 23, 0); eq(F.of(o), 'departed', '收貨時間到＝已出車');
  });

  test('B-2 無 leg 欄位：方向由 pickSite/dropSite 相對順序推導', () => {
    const H = fresh();
    const south = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false, volume: 100, handleMin: 5 });
    const north = H.ModuleB.createOrder({ applicant: 'B', site: 'D3', destSite: 'D9', direct: false, volume: 100, handleMin: 5 });
    eq(south.leg, undefined, '不應保存 leg 欄位');
    ok(H.ModuleB.isSouthbound(south), '迄點較南 → 南下');
    ok(!H.ModuleB.isSouthbound(north), '迄點較北 → 北上');
  });

  test('3.1 天數表改「車型×目的地」單表，且不參與運算（僅參考值）', () => {
    const H = fresh();
    ok(typeof H.ModuleB.timeLimitFor === 'undefined', '天數表不得再用於推算時間上限');
    ok(H.DB.dayCountDirect === undefined && H.DB.dayCountStopover === undefined,
      '不應再有「直達／有停靠」兩張表');
    const big = H.DB.vehicles.find(v => v.id === 'V-T01');   // 大車
    const small = H.DB.vehicles.find(v => v.id === 'V-T02'); // 小車
    eq(H.ModuleB.minTripDaysFor(big, 'D3'), H.DB.minTripDays.big.D3, '大車查大車列');
    eq(H.ModuleB.minTripDaysFor(small, 'D3'), H.DB.minTripDays.small.D3, '小車查小車列');
    eq(H.ModuleB.minTripDaysFor(big, 'D9'), null, '表中無值 → null，不代入預設');
    // 停靠與否不影響天數：同車同目的地只有一個值
    eq(H.ModuleB.minTripDaysFor(small, 'D1'), H.DB.minTripDays.small.D1, '停靠與否不影響查表結果');
  });

  test('2.13 時間上限每日 13.5 小時在勤模型（本版修正 12.5→13.5，非天數×工時）', () => {
    const H = fresh();
    eq(H.DB.dailyDutyMin, 13.5 * 60, '每日在勤上限 13.5 小時（2.13 本版修正）');
    const c = H.ModuleB.newDutyClock();
    eq(c.day, 1); eq(c.dayElapsed, H.DB.prepMin, '起始即含出勤前緩衝');
    // 剩餘量須扣掉收工緩衝與返回休息地
    const rem = c.remaining('D1');
    eq(rem, H.DB.dailyDutyMin - H.DB.prepMin - H.DB.closeMin - H.ModuleB.returnToRestMin('D1'),
      '剩餘＝13.5h −已用 −收工緩衝 −返回休息地');
  });

  test('2.9 行駛時間改查據點相互路程表（非單一常數×段數）', () => {
    const H = fresh();
    ok(H.DB.legMinutes === undefined, '不應再有單一常數 legMinutes');
    ok(H.DB.siteTravel.big && H.DB.siteTravel.small, '路程表應分大車／小車兩組（實表結構）');
    ok(Object.keys(H.DB.siteTravel.small).length > 50, '應有完整查表矩陣');
    eq(H.ModuleB.travelMin('D9', 'D9', 'small'), 0, '同點為 0');
    eq(H.ModuleB.travelMin('D9', 'D8', 'small'), H.DB.siteTravel.small['D9|D8'], '查表取值');
    eq(H.ModuleB.travelMin('D8', 'D9', 'small'), H.ModuleB.travelMin('D9', 'D8', 'small'), '同車型內對稱');
    // 非等距：D9→D8 與 D8→D7 不應相同（若為常數×段數則會相同）
    ok(H.ModuleB.travelMin('D9', 'D8', 'small') !== H.ModuleB.travelMin('D8', 'D7', 'small'), '各段距離不等，非固定常數');
    // 大車較小車慢（實表亦為此關係）
    ok(H.ModuleB.travelMin('D9', 'D1', 'big') > H.ModuleB.travelMin('D9', 'D1', 'small'), '同路段大車耗時較長');
    // 返回休息地取最近會館
    ok(H.ModuleB.returnToRestMin('D1', 'small') < H.ModuleB.returnToRestMin('D6', 'small'), '屏東較接近休息會館');
  });

  test('2.12 司機休息用餐：依純累積行駛觸發，計入在勤但不推進行駛時數線', () => {
    const H = fresh();
    const c = H.ModuleB.newDutyClock();
    const base = c.dayElapsed;
    c.addDrive(170);                       // 未達 3 小時門檻
    eq(c.breaksTaken.length, 0, '未達門檻不觸發');
    eq(c.dayElapsed, base + 170, '僅累加行駛');
    c.addDrive(20);                        // 累積 190 分 > 180 → 第一次休息 30 分
    eq(c.breaksTaken.length, 1, '跨越 3 小時門檻應觸發一次');
    eq(c.driveMin, 190, '休息不得推進純行駛時數線');
    eq(c.dayElapsed, base + 190 + 30, '休息時間計入在勤');
    c.addDrive(60);                        // 累積 250 > 240 → 第一次用餐 60 分
    eq(c.breaksTaken.length, 2, '共用同一條不歸零時數線，依序觸發');
    // 跨夜歸零
    c.rollover('D6');
    eq(c.day, 2); eq(c.driveMin, 0, '每日出勤行駛時數線重新歸零');
    eq(c.breaksTaken.length, 0, '休息紀錄亦歸零');
  });

  test('限制條件 2：指定時刻後不前往受限據點（lateRestricted）', () => {
    const H = fresh();
    const cut = H.hhmmToMin(H.DB.noArrivalAfter);
    // D1 於示範資料標記為受限地區
    ok(H.DB.sites.find(s => s.id === 'D1').lateRestricted, 'D1 應標記為受限地區');
    ok(!H.ModuleB.lateArrivalBlocked('D1', cut - 30), '1700 前抵達可前往');
    ok(H.ModuleB.lateArrivalBlocked('D1', cut + 30), '1700 後抵達不得前往');
    ok(!H.ModuleB.lateArrivalBlocked('D6', cut + 120), '未標記之據點不受此限');
  });

  test('限制條件 3：受限據點回程媒合裝貨須於 returnLoadBy 前完成', () => {
    const H = fresh();
    const by = H.hhmmToMin(H.DB.sites.find(s => s.id === 'D1').returnLoadBy);
    ok(H.ModuleB.returnLoadDeadlineOk('D1', by - 30), '1400 前完成裝貨可媒合');
    ok(!H.ModuleB.returnLoadDeadlineOk('D1', by + 30), '晚於 1400 完成裝貨不得媒合');
    ok(H.ModuleB.returnLoadDeadlineOk('D6', by + 300), '未設限之據點不受此限');
  });

  test('2.14 媒合截止：派車日前兩天 12:00，逾時自動排入下一可媒合車次', () => {
    const H = fresh();
    const cut = H.ModuleB.matchCutoffFor('2026-09-10');
    eq(cut.getFullYear(), 2026); eq(cut.getMonth(), 8); eq(cut.getDate(), 8);
    eq(cut.getHours(), 12, '截止為中午 12:00');
    const onTime = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D3', direct: false,
      volume: 500, handleMin: 10 });
    onTime.createdAt = new Date(2026, 8, 8, 11, 0);   // 截止前
    const late = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', destSite: 'D3', direct: false,
      volume: 500, handleMin: 10 });
    late.createdAt = new Date(2026, 8, 8, 13, 0);     // 截止後
    ok(H.ModuleB.meetsCutoff(onTime, '2026-09-10'), '截止前應可媒合');
    ok(!H.ModuleB.meetsCutoff(late, '2026-09-10'), '截止後不得插單');
    [onTime, late].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatch('V-T02', 'greedy', '2026-09-10');
    ok(r.carried.includes(onTime), '準時單應排入');
    ok(!r.carried.includes(late), '逾時單不得排入');
    ok(r.lateOrders.includes(late), '應列於逾時清單');
    ok(late.deferredToDate > '2026-09-10', '應標記順延至更後面的可媒合車次，實得 ' + late.deferredToDate);
    eq(late.status, 'approved', '順延者留在待派車，不另立狀態（同 3.5）');
  });

  test('3.2 自然直達（時間不足未停靠）不觸發分流；急件直達才觸發', () => {
    const H = fresh();
    // 急件直達：申請人指定
    const urgent = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: true,
      volume: 500, handleMin: 10 });
    eq(urgent.direct, true, '急件直達為申請人指定之輸入條件');
    H.ModuleB.approve(urgent);
    const rd = H.ModuleB.dispatch('V-T01', 'direct');
    eq(rd.matrixRow, 2, '急件直達 → 獨立派車（矩陣第 2 列）');
    ok(rd.urgentDirect, '應標記為急件直達');
    // 自然直達：非急件、僅一張基地出發直送最遠點，中途無貨可收
    const H2 = fresh();
    const o = H2.ModuleB.createOrder({ applicant: 'B', site: 'D9', destSite: 'D1', direct: false,
      volume: 500, handleMin: 10 });
    H2.ModuleB.approve(o);
    const rg = H2.ModuleB.dispatch('V-T02', 'greedy');
    eq(rg.matrixRow, 1, '自然直達仍走非直達列（不獨立派車）');
    ok(rg.naturalDirect, '應標記為自然直達（排程結果）');
    ok(/自然直達/.test(rg.reason), '原因需說明為自然直達且不觸發分流');
  });

  test('B-4 五列決策矩陣為單一決策表，去程兩列齊備', () => {
    const H = fresh();
    eq(H.ModuleB.DECISION_MATRIX.length, 5, '應為完整五列');
    eq(H.ModuleB.matrixRowInfo(1).mode, '去程・非直達');
    eq(H.ModuleB.matrixRowInfo(2).mode, '去程・直達');
    // 派車結果的 modeLabel 應取自決策表
    const o = mkOrder(H, { site: 'D9', destSite: 'D3' });
    H.ModuleB.approve(o);
    eq(H.ModuleB.dispatch('V-T02', 'greedy').modeLabel, H.ModuleB.matrixRowInfo(1).mode, '去程非直達＝第 1 列');
  });

  test('B-5 撞期判定三條件：路線重疊＋已核准未載＋時間窗', () => {
    const H = fresh();
    // ① 路線不重疊：直達單在回程路徑之外（D2→D1 皆南於折返點 D3）
    const off = H.ModuleB.createOrder({ applicant: 'A', site: 'D2', destSite: 'D1', direct: true, volume: 100, handleMin: 5 });
    eq(H.ModuleB.collidesReturnDirect(off, 'D3').hit, false, '路線區間不重疊 → 不撞期');
    // ③ 時間窗外：交貨時間極早，行經時間遠超窗寬
    const late = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', direct: true, volume: 100, handleMin: 5, deliverTime: '00:10' });
    eq(H.ModuleB.collidesReturnDirect(late, 'D1').hit, false, '超出時間窗 → 不撞期');
    // 三條件成立
    const hit = H.ModuleB.createOrder({ applicant: 'C', site: 'D6', direct: true, volume: 100, handleMin: 5 });
    ok(H.ModuleB.collidesReturnDirect(hit, 'D3').hit, '路線重疊且無時間限制 → 撞期成立');
    // 未核准者不進入判定（呼叫端以 approved 過濾）
    H.ModuleB.approve(hit);
    eq(H.ModuleB.dispatchReturn('V-T02', 'D3', false, 0).matrixRow, 4, '撞期 → 鎖定直達第 4 列');
  });

  test('B-6 派車後記錄每車派遣模式、觸發原因與終點判定依據', () => {
    const H = fresh();
    const o = mkOrder(H, { site: 'D9', destSite: 'D3' });
    H.ModuleB.approve(o);
    H.ModuleB.dispatch('V-T02', 'greedy');
    const s = H.ModuleB.vehicleStatus['V-T02'];
    ok(s, '應記錄車輛派遣狀態');
    eq(s.matrixRow, 1); eq(s.modeLabel, '去程・非直達');
    ok(s.reason && s.reason.length > 0, '應有觸發原因');
    eq(s.endpointBasis, '已載單最南送貨據點', '應說明終點判定依據');
    // 直達車的原因需點名觸發的單號
    const d = mkOrder(H, { site: 'D9', destSite: 'D2', direct: true });
    H.ModuleB.approve(d); H.ModuleB.dispatch('V-T01', 'direct');
    const sd = H.ModuleB.vehicleStatus['V-T01'];
    eq(sd.matrixRow, 2);
    ok(sd.reason.includes(d.id), '直達觸發原因應點名申請單號，實得 ' + sd.reason);
    eq(sd.endpointBasis, '申請單指定目的地');
  });

  test('接收人資訊（單位/姓名/電話/代理人）隨幹線託運單保存', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'X', site: 'D3', destSite: 'D1', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20,
      recipient: { unit: '台南營業所', name: '鄭文彬', phone: '06-2223344', agentName: '周雅琳', agentPhone: '0933-556-677' } });
    eq(o.recipient.name, '鄭文彬'); eq(o.recipient.unit, '台南營業所');
    eq(o.recipient.agentName, '周雅琳'); eq(o.recipient.agentPhone, '0933-556-677');
    const o2 = H.ModuleB.createOrder({ applicant: 'X', site: 'D3', destSite: 'D1', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    eq(Object.keys(o2.recipient).length, 0, '未帶接收人 → 空物件');
  });

  test('G111 起迄可同一據點但不可同一建物；同據點須指定兩建物，重送同樣檢核', () => {
    const H = fresh(), B = H.ModuleB;
    const base = { applicant: 'X', site: 'D3', destSite: 'D3', direct: false, volume: 500, category: 'BOX', weight: 50, handleMin: 10 };
    let err = ''; try { B.createOrder(Object.assign({}, base, { pickupLoc: '主倉', deliverLoc: '主倉' })); } catch (e) { err = e.message; }
    ok(err.includes('不可相同'), '同據點同建物不可送出');
    err = ''; try { B.createOrder(Object.assign({}, base, { pickupLoc: '主倉' })); } catch (e) { err = e.message; }
    ok(err.includes('須指定'), '同據點須指定兩建物');
    eq(B.routeError({ site: 'D3', destSite: 'D1', pickupLoc: '主倉', deliverLoc: '主倉' }), null, '不同據點不限建物');
    const o = B.createOrder(Object.assign({}, base, { pickupLoc: '主倉', deliverLoc: '南棟月台' }));
    ok(B.isIntraSite(o) && B.isSouthbound(o), '同據點＝院區內，排入去程車次');
    B.reject(o, '補資料');
    err = ''; try { B.resubmit(o, Object.assign({}, base, { pickupLoc: '南棟月台', deliverLoc: '南棟月台' })); } catch (e) { err = e.message; }
    ok(err.includes('不可相同'), '修改重送同樣檢核');
  });

  test('G111 院區內轉運：派車行經該據點時收貨即送達另一棟建物（站內移動計 2 棟）', () => {
    const H = fresh(), B = H.ModuleB;
    const o = B.createOrder({ applicant: 'X', site: 'D3', destSite: 'D3', pickupLoc: '主倉', deliverLoc: '南棟月台',
      direct: false, volume: 500, category: 'BOX', weight: 50, handleMin: 10, wantReceiveTime: '' });
    B.approve(o);
    const r = B.dispatch('V-T02', 'greedy');
    eq(o.status, 'loaded', '院區內單可被派車');
    eq(o.dispatchDropTime, o.pickupTime, '收貨後於同站送達');
    const st = r.stops.find(x => x.site.id === 'D3');
    ok(st && st.buildings === 2 && st.unloaded > 0, '站內兩棟建物、當站卸貨釋出容量');
  });
});

/* =================================================================
   模組 C：差旅共乘（G50–G63）
   ================================================================= */
group('模組 C 差旅共乘（G50–G63 / T5-2〜T5-6）', () => {
  const D = '2026-08-27', D2 = '2026-08-28';
  function round(H, over) {
    return H.ModuleC.createApp(Object.assign({
      type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: D,
      earliestPickup: '09:00', returnDate: D2, earliestReturn: '16:00', pax: 2,
      applicant: '業務部-周雅婷', dept: '業務部', ext: '2201',
    }, over));
  }

  test('G54 來回單六項完全相同才合併；任一不同不合併', () => {
    const H = fresh();
    const a = round(H, { applicant: '業務部-周雅婷' });
    const b = round(H, { applicant: '財務部-鄭安琪', pax: 2 });          // 六項相同 → 合併
    const c = round(H, { applicant: '研發部-吳承恩', returnDate: D });   // 回程日期不同 → 不合併
    [a, b, c].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    eq(a.groupId, b.groupId, 'a、b 六項相同應同群');
    ok(c.groupId !== a.groupId, 'c 回程日期不同不得併入（G54）');
  });

  test('G59/G60/G61 資源檢核：保修車、請假司機被排除，跨群不重用車/司機', () => {
    const H = fresh();
    const a = round(H, { applicant: '業務部-周雅婷' });
    const b = round(H, { applicant: '研發部-吳承恩', returnDate: D, earliestReturn: '16:00' }); // 另一群
    [a, b].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    ok(a.vehicle && b.vehicle, '兩群皆應派到車');
    ok(a.vehicle !== b.vehicle, '同日不同群不得重用同車（佔用表 dedup）');
    ok(a.vehicle !== 'V-B02', '保修中的 V-B02 不得指派（G60）');
    ok(a.driver !== 'DR4' && b.driver !== 'DR4', '請假司機 DR4 不得指派（G61）');
  });

  test('G59 當前位置：出發地對應據點須與車/司機 currentSite 相符', () => {
    const H = fresh();
    // 台中辦公室 出發 → 對應 D6，只有 V-B03/DR5 在 D6
    const a = H.ModuleC.createApp({ type: 'round', origin: '台中辦公室', dest: '桃園機場T1',
      departDate: D, earliestPickup: '09:00', returnDate: D, earliestReturn: '15:00', pax: 2,
      applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    if (a.status === 'matched') { eq(a.vehicle, 'V-B03', '台中出發只能用當前位置在 D6 的車（G59）'); }
    else { ok(a.status === 'coordinate', '若無車程資料則待人工協調亦可接受'); }
  });

  test('G51 單程單：同轉運點、4 小時內回程 → 配成一趟，等待計工時', () => {
    const H = fresh();
    const go = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '桃園機場T1',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 3,
      applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' });
    const back = H.ModuleC.createApp({ type: 'oneway', origin: '桃園機場T1', dest: '台北總部',
      departDate: D, earliestPickup: '11:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    [go, back].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    eq(go.groupId, back.groupId, '4 小時內同轉運點應配對成一趟（G51）');
  });

  test('G51 修正①：跨日回程不得配對（須同一天，一趟完整行程）', () => {
    const H = fresh();
    const go = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '桃園機場T1',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 3,
      applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' });
    // 回程時刻落在 4 小時窗內，但日期是隔天 → 不得配對
    const back = H.ModuleC.createApp({ type: 'oneway', origin: '桃園機場T1', dest: '台北總部',
      departDate: D2, earliestPickup: '11:00', returnDate: D2, earliestReturn: '', pax: 2,
      applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    [go, back].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    eq(go.status, 'matched', '去程應以純去程單程單媒合');
    ok(go.groupId !== back.groupId, '跨日回程不得與去程配成同一趟（修正①：同日檢核）');
  });

  test('G51 修正②：回程目的地非原出發地不得配對（Q35：回司機出發地）', () => {
    const H = fresh();
    const go = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '桃園機場T1',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 3,
      applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' });
    // 同日、同轉運點出發、時刻在窗內，但目的地是台中（非原出發地台北）→ 不得配對
    const back = H.ModuleC.createApp({ type: 'oneway', origin: '桃園機場T1', dest: '台中辦公室',
      departDate: D, earliestPickup: '11:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    [go, back].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    eq(go.status, 'matched', '去程應以純去程單程單媒合');
    ok(go.groupId !== back.groupId, '回程目的地非原出發地不得配對（修正②：回司機出發地）');
  });

  test('C-4 防禦：待調度單手動指派後（建立派車單）不被下一次批次重排', () => {
    const H = fresh();
    const a = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '09:00', returnDate: D, earliestReturn: '16:00', pax: 1,
      applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' });
    H.ModuleC.approve(a);
    H.ModuleC.overrideAssign(a, { vehicle: 'V-B03', driver: 'DR5' }, '測試調度室');
    ok(a.overridden === true, '覆寫後應標記 overridden'); ok(H.ModuleC.dispatchOf(a), '建立派車單');
    H.ModuleC.runBatch(D);
    eq(a.vehicle, 'V-B03', '覆寫指派不應被批次重排覆蓋');
    eq(H.ModuleC.dispatches.filter(d => !d.cancelled).length, 1, '批次不另產生派車單');
  });

  test('G50 來回單與單程單不互相混合比對', () => {
    const H = fresh();
    const r = round(H, { dest: '桃園機場T1' });
    const o = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '桃園機場T1',
      departDate: D, earliestPickup: '09:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: '研發部-吳承恩', dept: '研發部', ext: '4102' });
    [r, o].forEach(x => H.ModuleC.approve(x));
    H.ModuleC.runBatch(D);
    ok(r.groupId !== o.groupId || (r.groupId === null && o.groupId === null), '兩型態不得併同群（G50）');
  });

  test('G52 預估完成超過工時 20:30 → 不強派，仍待調度並註明原因', () => {
    const H = fresh();
    // 台北→台中 車程 130+15 緩衝=145 分；回程上車 18:30 → 完成 20:55 > 20:30
    const a = round(H, { earliestReturn: '18:30' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'approved', '超工時不派車，仍待調度（G52／G122 無待人工協調）');
    ok(/工時/.test(a.note || ''), '原因需標示工時');
  });

  test('G53 已媒合單不被下一次批次重排', () => {
    const H = fresh();
    const a = round(H); H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    const g1 = a.groupId, v1 = a.vehicle; ok(a.status === 'matched', '首批應媒合');
    H.ModuleC.runBatch(D); // 再按一次
    eq(a.groupId, g1, '已成功單不得被重排（G53）'); eq(a.vehicle, v1);
  });

  test('G122 刪除逾期作廢、待人工協調、已上車、行程完成：改由無車退回／已出車／已回登表達', () => {
    const H = fresh(), C = H.ModuleC;
    ['voidOverdue', 'confirmBoard', 'completeTrip'].forEach(f => eq(typeof C[f], 'undefined', '已刪除 ' + f));
    const a = round(H); C.approve(a);
    ok(C.returnApp(a, '當日無車', '調度室').ok); eq(a.status, 'noCar'); eq(H.Flow.of(a), 'noCar');
    let err = ''; try { C.resubmit(a, a); } catch (e) { err = e.message; }
    ok(err, '無車退回結案不可再動');
  });

  test('G55 最晚抵達時間為唯讀參考（車程＋緩衝），不影響媒合', () => {
    const H = fresh();
    const a = round(H, { origin: '台北總部', dest: '高鐵台北站', earliestPickup: '09:00' });
    // 車程 20 + 緩衝 15 = 35 分 → 09:35
    eq(H.ModuleC.latestArrival(a), '09:35', '最晚抵達＝上車＋車程＋緩衝（G55/G62）');
  });

  test('G56 手動併車候選：前後 1 天已派車單，不篩目的地/不比時間', () => {
    const H = fresh();
    const carried = round(H); H.ModuleC.approve(carried); H.ModuleC.runBatch(D);
    ok(carried.status === 'matched', '需先有已派車單');
    const need = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '新竹分公司',
      departDate: D, earliestPickup: '10:00', returnDate: D, earliestReturn: '15:00', pax: 1,
      applicant: '財務部-鄭安琪', dept: '財務部', ext: '3310' });
    const cands = H.ModuleC.manualCandidates(need);
    ok(cands.some(c => c.app.id === carried.id), '不同目的地的已派車單仍應列入候選（G56）');
    const c0 = cands.find(c => c.app.id === carried.id);
    ok('loaded' in c0 && 'remain' in c0, '候選需顯示已載/剩餘容量');
  });

  test('C-1 空車移動最小化：候選車依空駛時間升冪，優先取空駛最小者', () => {
    const H = fresh();
    H.DB.allowCrossSiteDeadhead = true; // 允許跨據點調度時，排序才有意義
    // 出發地台中辦公室(D6)：V-B03 當前位置 D6（空駛 0）、其餘在 D10（空駛 4×55=220）
    const a = H.ModuleC.createApp({ type: 'round', origin: '台中辦公室', dest: '桃園機場T1',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '15:00', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    const cands = H.ModuleC.findResourceCandidates(a, 480, 600, null);
    ok(cands.length > 1, '應有多個候選');
    eq(cands[0].deadhead, 0, '第一個候選空駛應為 0（車與司機都已在出發地）');
    eq(cands[0].vehicle.id, 'V-B03', '空駛 0 的 V-B03 應排最前');
    for (let i = 1; i < cands.length; i++) ok(cands[i].deadhead >= cands[i - 1].deadhead, '候選須依空駛升冪');
  });

  test('C-1 空駛量測：以當前位置到出發地對應據點的車程計算', () => {
    const H = fresh();
    const a = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '09:00', returnDate: D, earliestReturn: '16:00', pax: 1,
      applicant: 'X', dept: 'D', ext: '1' });
    const atHome = H.DB.vehicles.find(v => v.id === 'V-B01');   // currentSite D10 ＝出發地
    const away = H.DB.vehicles.find(v => v.id === 'V-B03');     // currentSite D6
    eq(H.ModuleC.deadheadMin(atHome, a), 0, '同據點空駛 0');
    eq(H.ModuleC.deadheadMin(away, a), H.DB.siteTravel.small['D6|D10'], 'D6→D10 查同一張路程表（2.9 小車列）');
  });

  test('C-2 歸屬據點 homeSite 與當前位置分離；已回登後回歸屬據點', () => {
    const H = fresh();
    H.DB.vehicles.filter(v => v.pool === 'BIZ').forEach(v => ok(v.homeSite, '車輛應有 homeSite'));
    H.DB.drivers.filter(d => d.pool === 'BIZ').forEach(d => ok(d.homeSite, '司機應有 homeSite'));
    const a = round(H); H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'matched');
    const v = H.DB.vehicles.find(x => x.id === a.vehicle);
    v.currentSite = 'D1'; // 模擬外派中
    H.ModuleC.submitDispatch(H.ModuleC.dispatchOf(a));
    H.ModuleC.signApprove(a, '運輸主管');
    ok(H.ModuleC.usageSave(a, { vehicleType: v.type, vehicle: v.id, driver1: a.driver, startKm: 0, endKm: 300 }).ok);
    eq(v.currentSite, v.homeSite, '已回登（實登里程）後當前位置應回復歸屬據點');
  });

  test('C-3 多天任務最後一天回程終點強制為該車歸屬據點', () => {
    const H = fresh();
    const D2 = new Date(new Date(D).getTime() + 86400000).toISOString().slice(0, 10);
    const a = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '16:00', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'matched', '應媒合成功');
    const v = H.DB.vehicles.find(x => x.id === a.vehicle);
    eq(a.returnTerminal, H.DB.bizSiteOrigin[v.homeSite], '回程終點＝該車歸屬據點對應地點');
    eq(a.forcedReturn, true, '多天任務應標記強制回歸');
  });

  test('C-3 強制回程仍納入工時檢核（超時不派車、仍待調度）', () => {
    const H = fresh();
    const D2 = new Date(new Date(D).getTime() + 86400000).toISOString().slice(0, 10);
    // 回程 19:30 出發 + 台中→台北 130+15 分 → 遠超 20:30
    const a = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '19:30', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'approved', '含強制回程超過工時不派車，仍待調度');
    ok(/工時/.test(a.note), '原因需標示工時，實得 ' + a.note);
  });

  test('C-4 人工覆寫：記錄調整人/時間/前後內容，且不被下批次重排', () => {
    const H = fresh();
    const a = round(H); H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    const before = a.vehicle;
    const other = H.DB.vehicles.find(v => v.pool === 'BIZ' && v.id !== before);
    const rec = H.ModuleC.overrideAssign(a, { vehicle: other.id, note: '原車故障' }, '調度室-王小明');
    eq(a.vehicle, other.id, '應改派為新車');
    eq(a.overridden, true, '應標記人工覆寫');
    eq(rec.by, '調度室-王小明'); eq(rec.before.vehicle, before); eq(rec.after.vehicle, other.id);
    eq(rec.note, '原車故障'); ok(rec.at, '應記錄調整時間');
    // 下一次批次不得重排（狀態已 matched，不在 approved 池）
    H.ModuleC.runBatch(D);
    eq(a.vehicle, other.id, '覆寫後不得被批次改回');
  });

  test('C-4 媒合不成的待調度單可由調度室直接手動指派（不退回員工重申請）', () => {
    const H = fresh();
    const a = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'approved', '目的地非轉運點 → 不派車，仍待調度'); ok(a.note.includes('轉運點'));
    H.ModuleC.overrideAssign(a, { vehicle: 'V-B01', driver: 'DR3' }, '調度室');
    eq(a.status, 'matched', '手動指派後併入派車單'); eq(H.Flow.of(a), 'dispatching');
    eq(a.overridden, true);
  });

  test('C-5 批次稽核紀錄：觸發時間/觸發人/範圍/統計，單上記錄批次與結果', () => {
    const H = fresh();
    const a = round(H); H.ModuleC.approve(a);
    const { batch } = H.ModuleC.runBatch(D, '調度室-李四');
    eq(batch.triggeredBy, '調度室-李四', '應記錄觸發人');
    ok(batch.triggeredAt, '應記錄觸發時間戳記');
    eq(batch.from, D, '應記錄處理範圍起'); ok(batch.to, '應記錄處理範圍迄');
    eq(batch.processed, 1, '應記錄處理單數');
    eq(batch.matched, 1); eq(batch.coordinate, 0);
    eq(a.lastBatch, batch.id, '申請單應記錄最後處理批次');
    eq(a.lastBatchResult, 'matched', '申請單應記錄該批次結果');
    eq(H.ModuleC.batches.length, 1, '批次應存檔');
  });

  test('C-5 待人工協調單同樣記錄批次與結果（供失敗率統計）', () => {
    const H = fresh();
    const a = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a);
    const { batch } = H.ModuleC.runBatch(D, '調度室');
    eq(a.lastBatch, batch.id); eq(a.lastBatchResult, 'coordinate');
    eq(batch.coordinate, 1, '統計應計入待人工協調數');
  });
});

/* =================================================================
   模組 C：派車調度 · 派車單（G112–G115）
   ================================================================= */
group('差旅共乘 · 派車單（G112–G115 批次產生／異動／送審／退回申請單）', () => {
  test('G128 手動指派：指定車種類型／車號／駕駛產生未送審派車單；可併入未送審派車單；留覆寫紀錄', () => {
    const H = fresh(), C = H.ModuleC;
    const mk = o => { const a = C.createApp(Object.assign({ type: 'oneway', origin: '台北總部', dest: '桃園機場', departDate: '2026-12-20', earliestPickup: '09:00',
      pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' }, o || {})); C.approve(a); return a; };
    const a1 = mk(), a2 = mk({ pax: 3 }), a3 = mk({ pax: 6 });
    ok(C.manualAssign(a1, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: '' }, '調度室').error.includes('駕駛人1'));
    const r = C.manualAssign(a1, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR3', driver2: 'DR4' }, '調度室-王');
    ok(r.ok); const o = r.dispatch;
    ok(/^DP\d{3}$/.test(o.id) && !o.submitted && o.manual, '產生未送審（暫存）派車單');
    eq(o.dispatcher, '調度室-王'); eq(a1.status, 'matched'); eq(a1.driver2, 'DR4'); eq(H.Flow.of(a1), 'dispatching', '調度中');
    ok(a1.overridden && a1.overrides.length === 1, '留人工覆寫紀錄');
    ok(C.manualAssign(a2, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR5' }, 'x').error.includes('已由差旅共乘'), '同車同日不可重複');
    eq(C.manualTargets('2026-12-20').map(x => x.id).join(), o.id);
    const seats = H.DB.vehicles.find(v => v.id === 'V-B01').seats;
    if (2 + 6 > seats) ok(C.manualMerge(a3, o, 'x').error.includes('座位'), '併入超出座位不可');
    ok(C.manualMerge(a2, o, '調度室').ok); eq(o.apps.join(), [a1.id, a2.id].join()); eq(a2.vehicle, 'V-B01'); eq(a2.driver, 'DR3');
    C.submitDispatch(o);
    ok(!C.manualTargets('2026-12-20').includes(o)); ok(C.manualMerge(a3, o, 'x').error.includes('尚未送審'), '已送審派車單不可併入');
    ok(!C.manualMerge(mk({ departDate: '2026-12-21' }), o, 'x').ok, '不同出發日期不可併入');
  });

  const D = '2026-08-27', D2 = '2026-08-28';
  const round = (H, over) => H.ModuleC.createApp(Object.assign({ type: 'round', origin: '台北總部', dest: '台中辦公室',
    departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '16:00', pax: 2,
    applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' }, over));

  test('G112 單一出發日期批次媒合：同車申請單合為一張派車單，單號／派遣人／派遣時間自動給予、預設未送審', () => {
    const H = fresh(), C = H.ModuleC;
    const a = round(H), b = round(H, { applicant: '財務部-鄭安琪' });
    const c = round(H, { departDate: D2, returnDate: D2, earliestReturn: '17:00', applicant: '研發部-吳承恩' });
    [a, b, c].forEach(x => C.approve(x));
    const r = C.runBatch(D, '調度室-王', { days: 0 });
    eq(c.status, 'approved', '只處理該出發日期');
    eq(r.dispatches.length, 1); const o = r.dispatches[0];
    eq(o.apps.join(), [a.id, b.id].join(), '同車兩張單同一派車單');
    ok(/^DP\d{3}$/.test(o.id)); eq(o.dispatcher, '調度室-王'); ok(o.dispatchedAt); eq(o.submitted, false);
    eq(o.vehicleType, H.DB.vehicles.find(v => v.id === o.vehicle).type, '車種類型帶入');
    eq(a.dispatchId, o.id); ok(!a.sign, '未送審不送簽');
  });

  test('G113 派車單異動：車種／車號相符、座位足夠、駕駛不可重複且不可撞單；駕駛人2 套用至各申請單', () => {
    const H = fresh(), C = H.ModuleC;
    const a = round(H), b = round(H, { departDate: D, returnDate: D, earliestReturn: '18:00', applicant: '研發部-吳承恩', pax: 1 });
    [a, b].forEach(x => C.approve(x));
    C.runBatch(D, '調度室', { days: 0 });
    const oa = C.dispatchOf(a), ob = C.dispatchOf(b);
    ok(oa && ob && oa.id !== ob.id, '不同車各一張派車單');
    const base = { vehicleType: oa.vehicleType, vehicle: oa.vehicle, driver1: oa.driver1, driver2: '' };
    ok(C.updateDispatch(oa, Object.assign({}, base, { vehicleType: '商務轎車' })).error.includes('不符'));
    ok(C.updateDispatch(oa, Object.assign({}, base, { driver2: oa.driver1 })).error.includes('同一人'));
    ok(C.updateDispatch(oa, Object.assign({}, base, { driver2: ob.driver1 })).error.includes(b.id), '駕駛已有其他派車單任務');
    ok(C.updateDispatch(oa, Object.assign({}, base, { vehicle: ob.vehicle, vehicleType: ob.vehicleType })).error, '車輛已被其他派車單使用');
    const free = H.DB.drivers.find(d => d.pool === 'BIZ' && ![oa.driver1, ob.driver1].includes(d.id) && !H.DB.driverLeaves.some(l => l.driver === d.id));
    ok(C.updateDispatch(oa, Object.assign({}, base, { driver2: free.id }), '調度室').ok);
    eq(a.driver2, free.id, '駕駛人2 套用到申請單'); ok(H.ModuleD.driverBusy(free.id, H.ModuleD.createApp({ applicant: 'X', startDate: D, startTime: '10:00', endDate: D, endTime: '11:00', pax: 1, selfDrive: false, items: [] })), '一般用車視駕駛人2 為佔用');
    ok(oa.log.some(l => l.action === '異動'));
  });

  test('G114 是否送審：否→是 送運輸主管簽審；送審後異動重新送簽；是→否 撤回簽審；已出車不可異動', () => {
    const H = fresh(), C = H.ModuleC;
    const a = round(H); C.approve(a); C.runBatch(D, '調度室', { days: 0 });
    const o = C.dispatchOf(a);
    const f = { vehicleType: o.vehicleType, vehicle: o.vehicle, driver1: o.driver1, driver2: '' };
    ok(C.updateDispatch(o, Object.assign({}, f, { submitted: true })).ok); eq(a.sign.status, 'pending');
    const other = H.DB.drivers.find(d => d.pool === 'BIZ' && d.id !== o.driver1 && !H.DB.driverLeaves.some(l => l.driver === d.id));
    ok(C.updateDispatch(o, Object.assign({}, f, { driver1: other.id, submitted: true })).ok);
    eq(a.sign.round, 2, '送審中異動重新送簽'); ok(a.sign.summary.includes(o.id), '簽審摘要含派車單號');
    ok(C.updateDispatch(o, Object.assign({}, f, { driver1: other.id, submitted: false })).ok);
    eq(a.sign, null, '撤回送審'); eq(Signoff_state(a), '撤回簽審');
    C.submitDispatch(o); C.signApprove(a, '運輸主管');
    H.Flow._now = new Date(2026, 7, 27, 9, 30);   // 到出發時間＝已出車
    ok(C.updateDispatch(o, Object.assign({}, f, { driver1: other.id })).error.includes('出車'), '已出車不可異動');
    function Signoff_state(x) { return x.signLog[x.signLog.length - 1].action; }
  });

  test('媒合不成的待調度單手動指派：建立派車單；車輛／駕駛與當日其他派車單衝突時不可指派', () => {
    const H = fresh(), C = H.ModuleC;
    const a = round(H);
    const x = C.createApp({ type: 'oneway', origin: '台北總部', dest: '台中辦公室', departDate: D, earliestPickup: '08:00', pax: 1,
      applicant: '總務部-林', dept: '總務部', ext: '1' });
    [a, x].forEach(z => C.approve(z)); C.runBatch(D, '調度室', { days: 0 });
    eq(x.status, 'approved');
    const free = H.DB.vehicles.find(v => v.pool === 'BIZ' && v.id !== a.vehicle && !H.DB.maintenance.some(m => m.vehicle === v.id));
    let err = ''; try { C.overrideAssign(x, { vehicle: free.id, driver: a.driver }, '調度室'); } catch (e) { err = e.message; }
    ok(err.includes(a.id), '駕駛已有當日派車單任務不可指派'); eq(x.status, 'approved'); eq(x.vehicle, null);
    const d = H.DB.drivers.find(z => z.pool === 'BIZ' && z.id !== a.driver && !H.DB.driverLeaves.some(l => l.driver === z.id));
    C.overrideAssign(x, { vehicle: free.id, driver: d.id }, '調度室');
    eq(x.status, 'matched'); ok(C.dispatchOf(x).manual, '建立手動派車單');
  });

  test('G122 無車退回：僅待調度單、原因必填、結案不可再動；調度中單可移出派車單回待調度（空了即取消）', () => {
    const H = fresh(), C = H.ModuleC;
    const a = round(H), b = round(H, { applicant: '財務部-鄭安琪' }), p = round(H, { applicant: '總務部-林', departDate: D2, returnDate: D2 });
    [a, b, p].forEach(x => C.approve(x));
    C.runBatch(D, '調度室', { days: 0 });
    const o = C.dispatchOf(a);
    ok(C.returnApp(a, '無車', '調度室').error.includes('待調度'), '調度中不可無車退回');
    ok(C.returnApp(p, '  ', '調度室').error.includes('必填'));
    ok(C.returnApp(p, '當日無車', '調度室').ok); eq(p.status, 'noCar'); eq(H.Flow.of(p), 'noCar');
    let err = ''; try { C.resubmit(p, p); } catch (e) { err = e.message; } ok(err, '無車退回不可修改重送');
    C.submitDispatch(o); ok(C.unassign(a, '調度室').error.includes('送審'), '已送審需先撤回送審');
    C.updateDispatch(o, { vehicleType: o.vehicleType, vehicle: o.vehicle, driver1: o.driver1, driver2: '', submitted: false });
    ok(C.unassign(a, '調度室').ok); eq(a.status, 'approved'); eq(H.Flow.of(a), 'todo'); eq(o.apps.join(), b.id);
    ok(C.unassign(b, '調度室').ok); eq(o.cancelled, true, '派車單無申請單即取消');
  });
});

/* =================================================================
   模組 D 一般用車 — G70–G80
   ================================================================= */
group('模組 D 一般用車（G70–G89，規格 v2）', () => {
  const DAY = '2026-10-01'; // 無保修／無請假的乾淨日期
  function dApp(H, o) {
    return H.ModuleD.createApp(Object.assign({ applicant: '業務部-周雅婷', startDate: DAY, startTime: '09:00',
      endDate: DAY, endTime: '12:00', pax: 2, selfDrive: false, items: [] }, o || {}));
  }
  const BIZ_DRIVERS = ['DR3', 'DR4', 'DR5', 'DR6'];
  // 派車＋運輸主管同意（生命週期操作與行程完成須簽審通過後才可進行）
  const go = (H, a, sel) => { const r = H.ModuleD.dispatch(a, sel); if (r.ok) H.ModuleD.signApprove(a, '運輸主管'); return r; };
  const allDriversOnLeave = (H, date) => BIZ_DRIVERS.forEach(d =>
    H.DB.driverLeaves.push({ driver: d, date: date || DAY, from: '07:00', to: '20:00', type: '全天' }));

  test('G75 欄位驗證：起訖必填且迄晚於起、人數 ≥1 整數、是否自駕須明確選擇', () => {
    const H = fresh(), D = H.ModuleD;
    const good = { applicant: 'A', startDate: DAY, startTime: '09:00', endDate: DAY, endTime: '10:00', pax: 1, selfDrive: true };
    eq(D.validate(good).length, 0, '合法資料應通過');
    ok(D.validate(Object.assign({}, good, { endTime: '' })).some(e => e.includes('起訖')), '缺迄時間應擋');
    ok(D.validate(Object.assign({}, good, { endTime: '09:00' })).some(e => e.includes('晚於')), '迄＝起應擋');
    ok(D.validate(Object.assign({}, good, { pax: 0 })).some(e => e.includes('至少 1 人')), '0 人應擋（不存在純載貨）');
    ok(D.validate(Object.assign({}, good, { pax: 1.5 })).some(e => e.includes('至少 1 人')), '人數須為整數');
    ok(D.validate(Object.assign({}, good, { selfDrive: null })).some(e => e.includes('自駕')), '未選是否自駕應擋');
    let threw = false; try { D.createApp(Object.assign({}, good, { pax: 0 })); } catch (e) { threw = true; }
    ok(threw, 'createApp 對不合法資料應拋錯');
  });

  test('G75 隨行貨物選填、人貨不互斥；危險品旗標預設 false', () => {
    const H = fresh();
    const a = dApp(H, { items: [{ name: '箱', l: 10, w: 10, h: 10, qty: 1, category: 'BOX' }] });
    eq(a.pax, 2); eq(a.items.length, 1); eq(a.items[0].hazardous, false, '未標示時預設非危險品');
    eq(dApp(H).items.length, 0, '純載人可不填貨物');
  });

  test('G74 先簽核後調度：未核准不可派車；駁回單不可派車', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H);
    ok(!D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }).ok, '待簽核不可派車');
    D.reject(a, '非必要');
    ok(!D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }).ok, '駁回不可派車');
    ok(!D.approve(a), '駁回後不可再核准');
    eq(D.approverOf(a), H.DB.approvalMap['業務部-周雅婷'], '簽核主管沿用核准者關係表');
  });

  test('G76 派車判斷矩陣：3 種車輛狀態 × 是否自駕，共 6 格', () => {
    const D = fresh().ModuleD;
    eq(D.matrixOutcome('withDriver', true), 'withDriver');
    eq(D.matrixOutcome('withDriver', false), 'withDriver');
    eq(D.matrixOutcome('vehicleOnly', true), 'selfDrive');
    eq(D.matrixOutcome('vehicleOnly', false), 'noVehicle');
    eq(D.matrixOutcome('none', true), 'noVehicle');
    eq(D.matrixOutcome('none', false), 'noVehicle');
  });

  test('G76 有車有司機 → 派車＋派司機（勾自駕亦同，不可只派車）', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H, { selfDrive: true }); D.approve(a);
    eq(D.resourceState(a), 'withDriver');
    ok(D.decide(a, { vehicle: 'V-B01' }).error, '有可派司機時不可省略司機');
    const r = D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' });
    ok(r.ok); eq(r.outcome, 'withDriver'); eq(a.status, 'dispatched'); eq(a.vehicle, 'V-B01'); eq(a.driver, 'DR3');
  });

  test('G76 有車沒司機＋勾自駕 → 派車（使用者自行駕駛，不派司機）', () => {
    const H = fresh(), D = H.ModuleD;
    allDriversOnLeave(H);
    const a = dApp(H, { selfDrive: true }); D.approve(a);
    eq(D.resourceState(a), 'vehicleOnly');
    const r = D.dispatch(a, { vehicle: 'V-B01' });
    ok(r.ok); eq(r.outcome, 'selfDrive'); eq(a.status, 'dispatched'); eq(a.driver, null);
  });

  test('G76 有車沒司機＋未勾自駕 → 無車可派，不進候補、不佔用資源', () => {
    const H = fresh(), D = H.ModuleD;
    allDriversOnLeave(H);
    const a = dApp(H, { selfDrive: false }); D.approve(a);
    const r = D.dispatch(a, { vehicle: 'V-B01' });
    ok(r.ok); eq(r.outcome, 'noVehicle'); eq(a.status, 'noVehicle'); eq(a.vehicle, null, '不保留車輛');
    const b = dApp(H, { selfDrive: true }); D.approve(b);
    eq(D.vehicleBusy('V-B01', b), null, '無車可派的單不佔用 V-B01');
    ok(!D.approve(a) && a.status === 'noVehicle', '無候補：狀態為終局，不自動回到待調度');
  });

  test('G76 沒車 → 無車可派（保修＋座位不足皆排除）', () => {
    const H = fresh(), D = H.ModuleD;
    ['V-B01', 'V-B03', 'V-B04'].forEach(v => H.DB.maintenance.push({ vehicle: v, from: DAY, to: DAY, reason: '測試' }));
    const a = dApp(H, { pax: 5, selfDrive: true }); D.approve(a); // V-B02 僅 4 座 < 5 人
    eq(D.resourceState(a), 'none');
    ok(D.resources(a).vehicles.find(x => x.v.id === 'V-B02').busy.type === 'seats', '座位不足應列為不可用');
    ok(D.decide(a, {}).error, '未選車不可確認派車');
    const r = D.dispatch(a, { noVehicle: true });
    ok(r.ok); eq(a.status, 'noVehicle');
  });

  test('G72 一般用車之間：時段重疊不可重複指派；首尾相接可', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' });
    const b = dApp(H, { startTime: '11:00', endTime: '13:00' }); D.approve(b);
    ok(D.vehicleBusy('V-B01', b), '重疊時段 V-B01 應被佔用'); ok(D.driverBusy('DR3', b), '重疊時段 DR3 應被佔用');
    ok(!D.dispatch(b, { vehicle: 'V-B01', driver: 'DR4' }).ok, '先佔先贏：不可重複指派');
    const c = dApp(H, { startTime: '12:00', endTime: '14:00' }); D.approve(c);
    eq(D.vehicleBusy('V-B01', c), null, '12:00 起接續 09~12 不算重疊');
  });

  test('G71/G72 共用池：差旅共乘已媒合的車/司機，一般用車同日不可用（以日為單位）', () => {
    const H = fresh(), C = H.ModuleC, D = H.ModuleD;
    const c = C.createApp({ type: 'oneway', origin: '台北總部', dest: '桃園機場T1', departDate: DAY, earliestPickup: '08:00',
      returnDate: DAY, earliestReturn: '', pax: 1, applicant: 'X', dept: 'D', ext: '1' });
    c.status = 'matched'; c.vehicle = 'V-B01'; c.driver = 'DR3';
    const a = dApp(H, { startTime: '18:00', endTime: '20:00' }); D.approve(a);
    eq(D.vehicleBusy('V-B01', a).type, 'C', '同日即視為差旅共乘佔用（沿用 C 的日粒度）');
    eq(D.driverBusy('DR3', a).type, 'C');
    const b = dApp(H, { startDate: '2026-10-02', endDate: '2026-10-02' }); D.approve(b);
    eq(D.vehicleBusy('V-B01', b), null, '隔日不受影響');
    c.status = 'void';
    eq(D.vehicleBusy('V-B01', a), null, '作廢的差旅單不佔用');
  });

  test('G72 共用池反向：差旅共乘批次媒合不指派一般用車已派出的車/司機', () => {
    const H = fresh(), C = H.ModuleC, D = H.ModuleD;
    const g = dApp(H, { startDate: '2026-08-28', endDate: '2026-08-28', startTime: '13:00', endTime: '15:00', pax: 1 });
    D.approve(g); D.dispatch(g, { vehicle: 'V-B01', driver: 'DR3' });
    const c = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-29', earliestReturn: '16:00', pax: 2, applicant: 'Y', dept: 'D', ext: '1' });
    C.approve(c); C.runBatch('2026-08-26', 'test');
    eq(c.status, 'matched');
    ok(c.vehicle !== 'V-B01' && c.driver !== 'DR3', `不可指派 D 已佔用資源，實得 ${c.vehicle}/${c.driver}`);
  });

  test('G73 釋放即時生效：提前歸還經調度確認後，之後時段車輛立即回到共用池（C 批次可再指派）', () => {
    const H = fresh(), C = H.ModuleC, D = H.ModuleD;
    // 6 人僅 V-B01（7 座）可載：D 佔用期間 C 媒合失敗，撤回後即可媒合到 V-B01
    const g = dApp(H, { startDate: '2026-08-27', endDate: '2026-08-29', startTime: '08:00', endTime: '18:00', pax: 1 });
    D.approve(g); go(H, g, { vehicle: 'V-B01', driver: 'DR6' });
    const mk = () => { const c = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27',
      earliestPickup: '09:00', returnDate: '2026-08-29', earliestReturn: '16:00', pax: 6, applicant: 'Y', dept: 'D', ext: '1' });
      C.approve(c); return c; };
    const c1 = mk(); C.runBatch('2026-08-26', 't1');
    eq(c1.status, 'approved', 'D 佔用中：C 無可用 7 座車（仍待調度）');
    eq(typeof D.cancel, 'undefined', 'G122：刪除整單撤回（已撤回狀態）');
    ok(D.requestEarlyReturn(g, { date: '2026-08-27', time: '08:00' }, '申請人').error, 'G122：提前歸還須晚於用車起（刪除已歸還未出車）');
    ok(D.requestEarlyReturn(g, { date: '2026-08-27', time: '12:00' }, '申請人').ok);
    ok(D.vehicleBusy('V-B01', dApp(H, { startDate: '2026-08-28', endDate: '2026-08-28' })), '調度確認前提前歸還尚未生效');
    ok(D.confirmEarlyReturn(g, '調度室').ok); eq(g.status, 'dispatched'); ok(g.releasedAt, '應記錄釋放時間');
    const c2 = mk(); C.runBatch('2026-08-28', 't2', { days: 0 });
    C.unassign(c1); C.returnApp(c1, '改用新單', 't');
    const c3 = mk(); c3.departDate = '2026-08-28'; c3.returnDate = '2026-08-29'; C.runBatch('2026-08-28', 't3', { days: 0 });
    eq(c3.vehicle, 'V-B01', '提前歸還後釋放的時段 V-B01 立即可再指派');
  });

  test('G79 調度確認前：可撤回修改→草稿→重新送出須重新簽核', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a);
    ok(D.canWithdrawToEdit(a), '已核准但未調度 → 可撤回修改');
    ok(D.withdrawToEdit(a, '申請人')); eq(a.status, 'draft'); eq(a.approvedAt, null, '撤回後核准失效');
    ok(!D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }).ok, '草稿不可派車');
    D.resubmit(a, Object.assign({}, a, { pax: 3 }));
    eq(a.status, 'submitted', '重新送出回到待簽核'); eq(a.pax, 3);
    ok(!D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }).ok, '須重新簽核才可調度');
    eq(a.log.map(l => l.action).join('/'), '撤回修改/修改後重新送出');
  });

  test('G79/G83 調度確認後（含無車退回）：不可撤回修改，改用生命週期操作', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' });
    ok(D.isConfirmed(a)); ok(!D.canWithdrawToEdit(a), '派車後不可撤回修改'); ok(!D.withdrawToEdit(a));
    eq(typeof D.cancel, 'undefined', 'G122：刪除整單撤回');
    let threw = false; try { D.resubmit(a, a); } catch (e) { threw = true; } ok(threw, '非草稿不可重送（不支援就地修改）');
    const b = dApp(H); D.approve(b); D.dispatch(b, { noVehicle: true });
    ok(D.isConfirmed(b), '無車可派亦算調度完成確認'); ok(!D.canWithdrawToEdit(b));
  });

  test('G80 派車結果經調度主管同意後才寄送通知（收件人＝申請人）；無車退回不送簽、立即通知', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' });
    const b = dApp(H, { startDate: '2026-10-05', endDate: '2026-10-05' }); D.approve(b); D.dispatch(b, { noVehicle: true }, '調度室', '當日無車');
    eq(D.mailLog.length, 1, '派車待簽審不寄送；無車退回立即通知'); eq(a.sign.status, 'pending'); ok(!b.sign, '無車退回不送簽');
    eq(b.status, 'noVehicle'); eq(H.Flow.of(b), 'noCar'); eq(D.mailLog[0].outcome, 'noVehicle');
    ok(D.signApprove(a, '運輸主管').ok);
    eq(D.mailLog.length, 2); ok(a.notifiedAt && b.notifiedAt);
    eq(D.mailLog[1].to, '業務部-周雅婷');
    ok(!D.dispatch(a, { noVehicle: true }).ok, '已確認的單不可再次判斷'); eq(D.mailLog.length, 2, '不重複寄送');
    ok(!D.signApprove(a, '運輸主管').ok, '已簽審的單不再出現主管同意');
  });

  test('G61 請假重疊（多天用車跨日亦檢查）；提前歸還後之後時段釋放', () => {
    const H = fresh(), D = H.ModuleD;
    H.DB.driverLeaves.push({ driver: 'DR5', date: '2026-10-02', from: '10:00', to: '12:00', type: '半天假' });
    const a = dApp(H, { startDate: DAY, startTime: '09:00', endDate: '2026-10-03', endTime: '18:00' });
    eq(D.datesOf(a).join(','), '2026-10-01,2026-10-02,2026-10-03');
    eq(D.driverBusy('DR5', a).type, 'leave', '中間日請假應排除');
    D.approve(a); go(H, a, { vehicle: 'V-B03', driver: 'DR6' });
    const b = dApp(H, { startDate: '2026-10-02', endDate: '2026-10-02' }); D.approve(b);
    ok(D.vehicleBusy('V-B03', b), '多天用車期間中間日亦佔用');
    eq(typeof D.completeTrip, 'undefined', 'G122：刪除行程完成，改以已出車／已回登表達');
    ok(D.requestEarlyReturn(a, { date: '2026-10-01', time: '18:00' }, a.applicant).ok); ok(D.confirmEarlyReturn(a, '調度室').ok);
    eq(D.vehicleBusy('V-B03', b), null, '提前歸還後之後時段釋放');
  });

  test('G70 獨立模組：一般用車與差旅共乘申請單分開、批次媒合不處理一般用車單', () => {
    const H = fresh();
    const a = dApp(H); H.ModuleD.approve(a);
    eq(H.ModuleC.applications.length, 0);
    H.ModuleC.runBatch(DAY, 'test');
    eq(a.status, 'approved', '差旅共乘批次不應改動一般用車單');
    ok(/^GU\d{3}$/.test(a.id), '單號前綴 GU');
  });

  test('G81 用車類別：例行用車僅總經理／部長秘書可選；預設一般用車；時長不分類別（數小時～數個月）', () => {
    const H = fresh(), D = H.ModuleD;
    eq(dApp(H).category, 'general', '未指定即一般用車');
    ok(D.validate({ applicant: 'A', category: 'routine', role: '一般員工', startDate: DAY, startTime: '09:00', endDate: DAY, endTime: '10:00', pax: 1, selfDrive: false })
      .some(e => e.includes('特定角色')), '一般員工不可選例行用車');
    const r = dApp(H, { category: 'routine', role: '部長秘書' });
    eq(r.category, 'routine');
    ok(D.canChooseRoutine('總經理') && !D.canChooseRoutine('一般員工'));
    const long = dApp(H, { startDate: '2026-10-01', endDate: '2026-12-31', endTime: '18:00' });
    eq(D.datesOf(long).length, 92, '一般用車類別也可申請數個月');
  });

  test('G82 例行用車優先權：待調度時重疊的例行用車優先排序與提示；已生效佔用不溯及', () => {
    const H = fresh(), D = H.ModuleD;
    const g = dApp(H, { startTime: '10:00', endTime: '11:00' }); D.approve(g);
    const r = dApp(H, { category: 'routine', role: '總經理', startTime: '09:00', endTime: '18:00' }); D.approve(r);
    eq(D.priorityPeers(g).map(x => x.id).join(), r.id, '一般用車調度時提示有重疊的例行用車待分配');
    eq(D.priorityPeers(r).length, 0);
    eq(D.reviewOrder([g, r])[0], r, '調度清單例行用車排前');
    const early = dApp(H, { startTime: '12:00', endTime: '13:00' }); D.approve(early);
    D.dispatch(early, { vehicle: 'V-B01', driver: 'DR3' });
    ok(!D.dispatch(r, { vehicle: 'V-B01', driver: 'DR4' }).ok, '已生效佔用不被例行用車搶走（先佔先贏）');
    ok(D.dispatch(r, { vehicle: 'V-B03', driver: 'DR4' }).ok);
  });

  test('G84 雙駕駛：同一筆紀錄掛 1～2 位司機，兩位皆佔用；超過 2 位或重複不可', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a);
    ok(D.decide(a, { vehicle: 'V-B01', drivers: ['DR3', 'DR4', 'DR5'] }).error, '最多 2 位');
    ok(D.decide(a, { vehicle: 'V-B01', drivers: ['DR3', 'DR3'] }).error, '不可重複');
    ok(D.dispatch(a, { vehicle: 'V-B01', drivers: ['DR3', 'DR4'] }).ok);
    eq(a.drivers.join(), 'DR3,DR4'); eq(a.segs.length, 1, '仍是同一筆派車紀錄');
    const b = dApp(H, { startTime: '11:00', endTime: '13:00' }); D.approve(b);
    ok(D.driverBusy('DR3', b) && D.driverBusy('DR4', b), '兩位司機都被佔用');
    eq([...D.dayOccupancy().drv.keys()].sort().join(), 'DR3|2026-10-01,DR4|2026-10-01');
  });

  test('G84 補派司機：自駕出車且勾「願意等待駕駛媒合」才可補派（歸類換司機，保留區間歷史）', () => {
    const H = fresh(), D = H.ModuleD;
    allDriversOnLeave(H);
    const a = dApp(H, { selfDrive: true, waitDriver: true }); D.approve(a);
    const b = dApp(H, { selfDrive: true, waitDriver: false, startDate: DAY, startTime: '13:00', endTime: '14:00' }); D.approve(b);
    eq(dApp(H, { selfDrive: false, waitDriver: true }).waitDriver, false, '未勾自駕時願意等待無意義');
    go(H, a, { vehicle: 'V-B01' }); go(H, b, { vehicle: 'V-B03' });
    eq(a.outcome, 'selfDrive');
    H.DB.driverLeaves = H.DB.driverLeaves.filter(l => l.driver !== 'DR5');   // 出發前空出駕駛
    ok(D.reassign(b, { date: DAY, time: '13:00', drivers: ['DR5'] }).error.includes('願意等待'), '未勾願意等待不可補派');
    const r = D.reassign(a, { date: DAY, time: '09:00', drivers: ['DR5'], reason: '出發前空出駕駛' });
    ok(r.ok); eq(r.kind, '補派司機'); eq(a.outcome, 'withDriver'); eq(a.driver, 'DR5');
    eq(D.liveSegs(a).length, 1, '出發前補派：原自駕區間長度為 0 不佔用'); eq(a.segs.length, 2, '歷史仍保留');
  });

  test('G85 管制區通行證：綁車輛、交集篩選；交集為空＝無車可派', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H, { permits: ['K', 'P'] }); D.approve(a);
    const r = D.resources(a);
    eq(r.vehicles.map(x => x.v.id).join(), 'V-B03', '只列同時持有 K 與 P 的車');
    eq(r.excluded.length, 3, '其餘車輛完全不列入');
    ok(D.decide(a, { vehicle: 'V-B01', driver: 'DR3' }).error.includes('交集'), '不可選未持證的車');
    const k = dApp(H, { permits: ['K'] }); eq(D.resources(k).vehicles.map(x => x.v.id).join(), 'V-B01,V-B03');
    const none = dApp(H, { permits: ['K', 'P'], pax: 10 }); D.approve(none);
    eq(D.resourceState(none), 'none', '交集為空（或皆不可用）→ 沒車 → 無車可派');
    ok(D.validate(Object.assign({}, a, { permits: ['X'] })).some(e => e.includes('未知')));
  });

  test('G86/G87 台北市噸位、假日／夜間加班僅為提示，不影響可派資源；剩餘加班工時即時查詢', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H, { enterTaipei: true, holidayOT: true, nightOT: true }); D.approve(a);
    ok(a.enterTaipei && a.holidayOT && a.nightOT);
    eq(D.resources(a).vehicles.length, 4, '不因進入台北市而篩除 7.2 噸車');
    eq(D.resourceState(a), 'withDriver');
    eq(D.queryOvertime('DR4').hours, 6.5); eq(D.queryOvertime('DR1').hours, null, '查無資料回 null');
  });

  test('G83/G88 換車：調度直接生效、新增指派區間、瞬間切換；舊車於生效時點起釋放', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H, { startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-03', endTime: '18:00' });
    D.approve(a); go(H, a, { vehicle: 'V-B01', driver: 'DR3' });
    ok(D.reassign(a, { date: '2026-10-01', time: '08:00', vehicle: 'V-B03' }).error, '生效時點不可早於目前區間起點');
    ok(D.reassign(a, { date: '2026-10-02', time: '12:00' }).error.includes('未變更'));
    const r = D.reassign(a, { date: '2026-10-02', time: '12:00', vehicle: 'V-B03', reason: '車輛維護' });
    ok(r.ok); eq(r.kind, '換車'); eq(a.vehicle, 'V-B03'); eq(a.status, 'dispatched', '不需簽核、立即生效');
    eq(D.liveSegs(a).map(s => `${s.vehicle}:${D.fmtAbs(s.from)}~${D.fmtAbs(s.to)}`).join(' | '),
      'V-B01:2026-10-01 09:00~2026-10-02 12:00 | V-B03:2026-10-02 12:00~2026-10-03 18:00');
    const later = dApp(H, { startDate: '2026-10-02', startTime: '13:00', endDate: '2026-10-02', endTime: '15:00' }); D.approve(later);
    eq(D.vehicleBusy('V-B01', later), null, '換車生效後舊車釋放');
    ok(D.vehicleBusy('V-B03', later), '新車自生效時點起佔用');
    const before = dApp(H, { startDate: '2026-10-02', startTime: '10:00', endDate: '2026-10-02', endTime: '11:00' }); D.approve(before);
    ok(D.vehicleBusy('V-B01', before), '生效前仍由舊車佔用');
    eq(D.mailsOf(a).map(m => m.kind).join(), '派車結果,換車', '異動以 Email 通知');
  });

  test('G83 雙駕駛單獨換其一、加派第二位；換人不可指派已被佔用的司機', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a); go(H, a, { vehicle: 'V-B01', driver: 'DR3' });
    eq(D.reassign(a, { date: DAY, time: '10:00', drivers: ['DR3', 'DR4'] }).kind, '加派司機');
    const o = dApp(H, { startTime: '11:00', endTime: '12:00' }); D.approve(o); go(H, o, { vehicle: 'V-B03', driver: 'DR5' });
    ok(D.reassign(a, { date: DAY, time: '10:30', drivers: ['DR3', 'DR5'] }).error, 'DR5 已被佔用');
    eq(D.reassign(a, { date: DAY, time: '10:30', drivers: ['DR3', 'DR6'] }).kind, '換司機');
    eq(a.drivers.join(), 'DR3,DR6'); eq(a.segs.length, 3);
    ok(D.reassign(a, { date: DAY, time: '11:00', drivers: [] }).error.includes('自駕'), '未勾自駕不可拿掉所有司機');
  });

  test('G83 展延：僅調度、不需簽核；延長區段目前車輛／司機須可用（先佔先贏）', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H); D.approve(a); go(H, a, { vehicle: 'V-B01', driver: 'DR3' });
    const o = dApp(H, { startTime: '14:00', endTime: '16:00' }); D.approve(o); go(H, o, { vehicle: 'V-B01', driver: 'DR4' });
    ok(D.extend(a, { date: DAY, time: '11:00' }).error, '新結束須晚於目前結束');
    ok(D.extend(a, { date: DAY, time: '15:00' }).error.includes('V-B01'), '延長區段撞到他單的車');
    ok(D.extend(a, { date: DAY, time: '14:00' }).ok, '首尾相接可展延');
    eq(a.endTime, '14:00'); eq(a.status, 'dispatched', '不需重新簽核');
    eq(a.log[a.log.length - 1].action, '展延');
  });

  test('G83 提前歸還：唯一由使用者發起，調度確認後才生效；退回則維持原結束時間', () => {
    const H = fresh(), D = H.ModuleD;
    const a = dApp(H, { startTime: '09:00', endTime: '17:00' }); D.approve(a); go(H, a, { vehicle: 'V-B01', driver: 'DR3' });
    ok(D.requestEarlyReturn(a, { date: DAY, time: '18:00' }).error, '不可晚於目前結束');
    ok(D.requestEarlyReturn(a, { date: DAY, time: '12:00', reason: '會議提早結束' }, '申請人').ok);
    ok(D.requestEarlyReturn(a, { date: DAY, time: '11:00' }).error, '已有待確認申請');
    const b = dApp(H, { startTime: '13:00', endTime: '15:00' }); D.approve(b);
    ok(D.vehicleBusy('V-B01', b), '調度確認前尚未生效');
    ok(D.rejectEarlyReturn(a, '調度室', '車輛仍需使用').ok); eq(a.endTime, '17:00', '退回維持原結束時間');
    D.requestEarlyReturn(a, { date: DAY, time: '12:00' }, '申請人');
    const r = D.confirmEarlyReturn(a, '調度室');
    ok(r.ok && !r.whole); eq(a.endTime, '12:00'); eq(a.status, 'dispatched', '部分歸還仍為派車中');
    eq(D.vehicleBusy('V-B01', b), null, '確認後 12:00 起釋放');
    eq(D.mailsOf(a).map(m => m.kind).join(), '派車結果,提前歸還未同意,提前歸還');
  });
});

/* =================================================================
   模組 B：派車調度 · 派車單（G117–G120）
   ================================================================= */
group('院區物品轉運 · 派車單（G117–G120 單一媒合／異動／送審／退回／貨品回報）', () => {
  const DD = '2026-12-31';
  const mk = (H, o) => { const x = H.ModuleB.createOrder(Object.assign({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false,
    volume: 1000, category: 'BOX', weight: 100, handleMin: 20 }, o)); H.ModuleB.approve(x); return x; };

  test('G127 手動指派：指定車輛／駕駛產生未送審派車單；可併入未送審派車單；資源與容量檢核', () => {
    const H = fresh(), B = H.ModuleB;
    const o1 = mk(H, { applicant: 'A', wantReceiveTime: '10:00' }), o2 = mk(H, { applicant: 'B' }), o3 = mk(H, { applicant: 'C', volume: 900000 });
    ok(B.manualAssign(o1, DD, { vehicleType: '幹線貨車', vehicle: 'V-T02', driver1: '' }, '調度室').error.includes('駕駛人1'));
    const r = B.manualAssign(o1, DD, { vehicleType: '幹線貨車', vehicle: 'V-T02', driver1: 'DR1' }, '調度室-王');
    ok(r.ok); const d = r.dispatch;
    ok(/^TD\d{3}$/.test(d.id) && !d.submitted && d.manual, '產生未送審（暫存）派車單');
    eq(d.dispatcher, '調度室-王'); eq(o1.status, 'loaded'); eq(o1.dispatchId, d.id); eq(o1.pickupTime, '10:00', '收貨時間暫取希望收貨時間');
    eq(H.Flow.of(o1), 'dispatching', '調度中');
    ok(B.manualAssign(o2, DD, { vehicleType: '幹線貨車', vehicle: 'V-T02', driver1: 'DR2' }, 'x').error.includes('已由派車單'), '同日同車不可重複');
    ok(B.manualAssign(o2, DD, { vehicleType: '幹線聯結車', vehicle: 'V-T01', driver1: 'DR1' }, 'x').error.includes('已有派車單'), '同日同駕駛不可重複');
    eq(B.manualTargets(DD).map(x => x.id).join(), d.id);
    ok(B.manualMerge(o3, d, 'x').error.includes('容積'), '併入超出容積不可');
    ok(B.manualMerge(o2, d, '調度室').ok); eq(d.apps.join(), [o1.id, o2.id].join()); eq(o2.dispatchVehicle, 'V-T02');
    ok(!B.manualAssign(o2, DD, { vehicleType: '幹線聯結車', vehicle: 'V-T01', driver1: 'DR2' }, 'x').ok, '已指派者不可再指派');
    B.submitDispatch(d);
    ok(!B.manualTargets(DD).includes(d)); ok(B.manualMerge(o3, d, 'x').error.includes('尚未送審'), '已送審派車單不可併入');
    B.updateDispatch(d, Object.assign({}, d, { submitted: false }));
    ok(B.unassign(o2, 'x').ok); eq(o2.status, 'approved'); ok(!o2.manualAssigned, '移出後清除手動指派欄位');
  });

  test('G117 單一媒合按鈕：依序完成去程直達、去程非直達、回程，並依同一台車產生派車單（未送審、號碼／派遣人／時間自動）', () => {
    const H = fresh(), B = H.ModuleB;
    const dr = mk(H, { direct: true, destSite: 'D3', applicant: '急件' });
    const g1 = mk(H, { destSite: 'D5', applicant: 'A' }), g2 = mk(H, { destSite: 'D4', applicant: 'B' });
    const nb = mk(H, { site: 'D3', destSite: 'D6', applicant: '北上' });
    const r = B.runMatch(DD, '調度室-王');
    ok(r.steps.some(x => x.label === '去程直達') && r.steps.some(x => x.label.startsWith('去程非直達')) && r.steps.some(x => x.label === '回程非直達'), '四種派車整合執行');
    [dr, g1, g2, nb].forEach(o => eq(o.status, 'loaded', o.id + ' 已派車'));
    const ds = B.liveDispatches();
    ok(ds.length >= 1); ds.forEach(d => { ok(/^TD\d{3}$/.test(d.id)); eq(d.dispatcher, '調度室-王'); ok(d.dispatchedAt); eq(d.submitted, false); eq(d.date, DD); });
    ds.forEach(d => { const vs = new Set(B.dispatchOrders(d).map(o => o.dispatchVehicle)); eq(vs.size, 1, '一張派車單一台車'); });
    eq(new Set(ds.map(d => d.vehicle)).size, ds.length, '同一台車只有一張派車單');
    ok(dr.dispatchVehicle !== g1.dispatchVehicle, '去程直達與去程非直達不可同時用同一台車');
    ok(nb.dispatchVehicle !== dr.dispatchVehicle, '直達車回程不停靠，回程收送改用其他車');
    ok(new Set(ds.map(d => d.driver1)).size === ds.length, '各派車單預設不同駕駛');
    ok([dr, g1, g2, nb].every(o => !o.sign), '未送審不送簽');
    ok(B.dispatchOf(g1).driver1, '預設帶入駕駛人1');
  });

  test('G118 派車單異動：車種／車號相符、容量足夠、駕駛不可重複與撞單；送審／撤回送審／送審後異動重新送簽', () => {
    const H = fresh(), B = H.ModuleB;
    const o = mk(H, { volume: 3000, weight: 300 });
    B.runMatch(DD, '調度室');
    const d = B.dispatchOf(o), f = { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: '' };
    ok(B.updateDispatch(d, Object.assign({}, f, { vehicleType: '物流貨車' })).error.includes('不符'));
    ok(B.updateDispatch(d, Object.assign({}, f, { driver2: d.driver1 })).error.includes('同一人'));
    const other = H.DB.drivers.find(x => x.pool === 'LOGI' && x.id !== d.driver1);
    ok(B.updateDispatch(d, Object.assign({}, f, { driver2: other.id })).ok); eq(o.dispatchDriver2, other.id, '駕駛人2 套用至託運單');
    ok(B.updateDispatch(d, Object.assign({}, f, { driver2: other.id, submitted: true })).ok); eq(o.sign.status, 'pending');
    ok(B.updateDispatch(d, Object.assign({}, f, { driver1: other.id, driver2: d.driver1, submitted: true })).ok); eq(o.sign.round, 2, '送審後異動重新送簽');
    ok(B.updateDispatch(d, Object.assign({}, f, { driver1: other.id, driver2: '', submitted: false })).ok); eq(o.sign, null, '撤回送審');
    // 容量：大單改小車不足
    const big = mk(H, { volume: 30000, weight: 2000, applicant: '大單' });
    B.runMatch('2027-01-02', '調度室'); const db = B.dispatchOf(big);
    if (db && db.vehicle === 'V-T01') ok(B.updateDispatch(db, { vehicleType: '幹線貨車', vehicle: 'V-T02', driver1: db.driver1 }).error.includes('不足'), '容量不足不可改小車');
    B.submitDispatch(d); B.signApprove(o, '運輸主管'); H.Flow._now = new Date(2027, 0, 1);   // 已出車
    ok(B.updateDispatch(d, Object.assign({}, f, { driver1: d.driver1 === other.id ? f.driver1 : other.id })).error.includes('出車'), '已出車不可異動');
  });

  test('G119／G122 無車退回：僅待調度、原因必填、結案；調度中託運單可移出派車單回待調度（空了即取消）', () => {
    const H = fresh(), B = H.ModuleB;
    const a = mk(H, { destSite: 'D5' }), b = mk(H, { destSite: 'D4', applicant: 'B' });
    B.runMatch(DD, '調度室');
    const d = B.dispatchOf(a);
    ok(B.returnOrder(a, '無車', '調度室').error.includes('待調度'), '調度中不可無車退回');
    const w = mk(H, { applicant: '待派' });
    ok(B.returnOrder(w, ' ', '調度室').error.includes('必填'));
    ok(B.returnOrder(w, '當日無車', '調度室').ok); eq(w.status, 'noCar'); eq(H.Flow.of(w), 'noCar');
    let err = ''; try { B.resubmit(w, { applicant: 'X', site: 'D9', destSite: 'D3', volume: 100, weight: 10, handleMin: 5 }); } catch (e) { err = e.message; }
    ok(err, '無車退回不可修改重送');
    B.submitDispatch(d); ok(B.unassign(a).error.includes('送審'));
    B.updateDispatch(d, { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: '', submitted: false });
    B.dispatchOrders(d).forEach(x => ok(B.unassign(x, '調度室').ok));
    eq(a.status, 'approved'); eq(H.Flow.of(a), 'todo'); eq(a.dispatchVehicle, null); eq(d.cancelled, true);
  });

  test('G120 車輛使用實登貨品回報：預設正常運送，可改為不運送／不接收並留紀錄；未生效不可回報', () => {
    const H = fresh(), B = H.ModuleB;
    const o = B.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false, handleMin: 20,
      items: [{ name: '紙箱', l: 50, w: 40, h: 30, qty: 2, weight: 5, category: 'BOX' }, { name: '儀器', l: 80, w: 60, h: 60, qty: 1, weight: 30, category: 'FRAGILE' }] });
    B.approve(o); B.runMatch(DD, '調度室');
    eq(B.itemReport(o.items[0]), '正常運送');
    ok(B.setItemReport(o, 0, '不運送').error.includes('生效'), '派車未生效不可回報');
    B.submitDispatch(B.dispatchOf(o)); B.signApprove(o, '運輸主管');
    ok(B.setItemReport(o, 1, '遺失').error, '僅限三種狀態');
    ok(B.setItemReport(o, 1, '不接收', '調度室-王').ok);
    eq(o.items[1].report, '不接收'); eq(B.itemReport(o.items[0]), '正常運送');
    eq(o.itemReportLog[0].before, '正常運送'); eq(o.itemReportLog[0].after, '不接收'); eq(o.itemReportLog[0].by, '調度室-王');
  });

  test('G121 巡迴物品轉運實登貨品回報：排入班次即可回報；移出班次（未生效）不可回報', () => {
    const H = fresh(), A = H.ModuleA;
    A.now = () => new Date(2026, 8, 2, 6, 0);
    const app = A.submit({ applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ name: '文件箱', l: 40, w: 30, h: 30 }), item({ name: '樣品', l: 50, w: 40, h: 40 })], recvMode: 'asap', handleMin: 15 }).app;
    eq(A.itemReport(app.items[0]), '正常運送');
    ok(A.setItemReport(app, 0, '不運送', '調度室').ok, 'A 不經簽審，排班即可回報');
    eq(app.items[0].report, '不運送'); eq(app.itemReportLog.length, 1);
    const other = A.submit({ applicant: 'X', station: 'D1-300', building: '一號月台', items: [item({ l: 40, w: 30, h: 30 })], recvMode: 'asap', handleMin: 15 }).app;
    A.removeFromShift(other);
    ok(A.setItemReport(other, 0, '不接收').error.includes('生效'), '未排入班次不可回報');
  });
});

/* =================================================================
   模組 D：派車調度 · 替補自駕駕駛（G116）
   ================================================================= */
group('一般用車 · 替補自駕駕駛（G116）', () => {
  const T = '2026-10-05';
  function setup() {
    const H = fresh(), D = H.ModuleD;
    const mk = o => { const a = D.createApp(Object.assign({ applicant: '業務部-周雅婷', startDate: T, startTime: '09:00',
      endDate: T, endTime: '17:00', pax: 2, selfDrive: false, items: [] }, o)); D.approve(a); return a; };
    const go = (a, sel) => { ok(D.dispatch(a, sel).ok); D.signApprove(a, '運輸主管'); };
    const x1 = mk(), x2 = mk({ applicant: '財務部-鄭安琪' });
    go(x1, { vehicle: 'V-B01', drivers: ['DR3', 'DR4'] }); go(x2, { vehicle: 'V-B03', drivers: ['DR5', 'DR6'] });
    const s1 = mk({ applicant: '研發部-吳承恩', selfDrive: true, waitDriver: true, startTime: '10:00' });
    const s2 = mk({ applicant: '總務部-林', selfDrive: true, waitDriver: false });
    D.dispatch(s1, { vehicle: 'V-B04' }); D.dispatch(s2, { vehicle: 'V-B02' });
    return { H, D, x1, x2, s1, s2 };
  }
  const now = new Date(2026, 9, 1, 8, 0);

  test('只替補已生效、被迫自駕且願意等待駕駛媒合的單；沒有閒置駕駛時略過並說明', () => {
    const { D, s1, s2 } = setup();
    eq(s1.outcome, 'selfDrive', '駕駛全被佔用 → 被迫自駕');
    eq(D.selfDriveBackfillTargets().length, 0, '派車結果待簽審者不列入');
    D.signApprove(s1, '運輸主管'); D.signApprove(s2, '運輸主管');
    eq(D.selfDriveBackfillTargets().map(a => a.id).join(), s1.id, '未勾願意等待者不替補（G84）');
    const r = D.backfillSelfDrive('調度室', { now });
    eq(r.filled.length, 0); ok(r.skipped[0].reason.includes('閒置'));
  });

  test('其他申請單提前歸還使駕駛閒置 → 替補補派司機、立即生效並留紀錄', () => {
    const { D, x2, s1, s2 } = setup();
    D.signApprove(s1, '運輸主管'); D.signApprove(s2, '運輸主管');
    ok(D.requestEarlyReturn(x2, { date: T, time: '09:30' }, x2.applicant).ok); ok(D.confirmEarlyReturn(x2, '調度室').ok);
    const r = D.backfillSelfDrive('調度室-王', { now });
    eq(r.filled.length, 1); eq(r.filled[0].app.id, s1.id);
    eq(s1.outcome, 'withDriver');
    eq(s1.drivers[0], 'DR6', '閒置 DR5（D6）與 DR6（D10）→ 優先與車輛 V-B04（D10）同據點的 DR6'); eq(r.filled[0].sameSite, true);
    eq(D.lastSeg(s1).kind, '補派司機'); eq(D.lastSeg(s1).from, D.span(s1).start, '尚未出車 → 自用車起始即補派');
    eq(s2.drivers.length, 0, '未勾願意等待者維持自駕');
    eq(D.backfillSelfDrive('調度室', { now }).filled.length, 0, '已替補者不重複');
  });

  test('同據點沒有閒置駕駛時，改派其他據點的閒置駕駛並標示跨據點', () => {
    const { H, D, x2, s1 } = setup();
    D.signApprove(s1, '運輸主管');
    H.DB.drivers.find(d => d.id === 'DR6').currentSite = 'D6';   // 閒置駕駛都不在車輛所在據點 D10
    D.requestEarlyReturn(x2, { date: T, time: '09:30' }, x2.applicant); D.confirmEarlyReturn(x2, '調度室');
    const r = D.backfillSelfDrive('調度室', { now });
    eq(r.filled.length, 1); eq(r.filled[0].sameSite, false); eq(r.filled[0].site, 'D10'); eq(r.filled[0].driverSite, 'D6');
  });

  test('用車中途才閒置：自現在時刻起補派；用車已結束者略過', () => {
    const { D, x2, s1 } = setup();
    D.signApprove(s1, '運輸主管');
    D.requestEarlyReturn(x2, { date: T, time: '09:30' }, x2.applicant); D.confirmEarlyReturn(x2, '調度室');
    const r = D.backfillSelfDrive('調度室', { now: new Date(2026, 9, 5, 13, 30) });
    eq(r.filled[0].from, `${T} 13:30`); eq(D.lastSeg(s1).from, D.absMin(T, '13:30'));
    const late = setup(); late.D.signApprove(late.s1, '運輸主管');
    eq(late.D.backfillSelfDrive('調度室', { now: new Date(2026, 9, 6, 9, 0) }).skipped[0].reason, '用車時段已結束');
  });
});

/* =================================================================
   單位主管審核：退回修編 → 申請人修改後重新送出（B／C／D）
   ================================================================= */
group('單位主管審核（退回修編與重新送出）', () => {
  test('B：退回修編後沿用原單號修改重送，回到待審核並保留退回紀錄；非退回修編不可重送', () => {
    const H = fresh(), B = H.ModuleB;
    const o = B.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', items: [{ name: '箱', l: 50, w: 40, h: 30, qty: 1, category: 'BOX', weight: 5 }] });
    let threw = false; try { B.resubmit(o, {}); } catch (e) { threw = true; } ok(threw, '待審核不可重送');
    B.reject(o, '請補送貨建物'); eq(o.status, 'rejected');
    const id = o.id;
    B.resubmit(o, { applicant: 'X', site: 'D9', destSite: 'D2', deliverLoc: '物流中心', items: [{ name: '箱', l: 50, w: 40, h: 30, qty: 2, category: 'BOX', weight: 5 }] });
    eq(o.id, id, '沿用原單號'); eq(o.status, 'submitted'); eq(o.dropSite, 'D2'); eq(o.deliverLoc, '物流中心');
    eq(o.items[0].qty, 2); ok(o.volume > 0, '重新計算貨量'); eq(o.revisions[0].returnNote, '請補送貨建物'); eq(o.reviewNote, '');
    eq(B.orders.length, 1, '不新增單據');
  });

  test('C：退回修編後修改重送回到待審核；核准後才進入批次媒合', () => {
    const H = fresh(), C = H.ModuleC;
    const a = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-28', earliestReturn: '16:00', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    C.reject(a, '人數請確認');
    C.resubmit(a, Object.assign({}, a, { pax: 3 }));
    eq(a.status, 'submitted'); eq(a.pax, 3); eq(a.revisions.length, 1);
    C.runBatch('2026-08-26', 't'); eq(a.status, 'submitted', '未核准不進媒合');
  });

  test('D：退回修編可修改重送；重送須重新經單位主管審核', () => {
    const H = fresh(), D = H.ModuleD;
    const a = D.createApp({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-01', endTime: '12:00', pax: 2, selfDrive: false, items: [] });
    D.reject(a, '時段請改下午');
    ok(D.canEdit(a), '退回修編可修改');
    D.resubmit(a, Object.assign({}, a, { startTime: '13:00', endTime: '16:00' }));
    eq(a.status, 'submitted'); eq(a.startTime, '13:00');
    ok(a.log[a.log.length - 1].note.includes('時段請改下午'), '異動紀錄保留退回意見');
    ok(!D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }).ok, '須重新審核才可調度');
  });
});

/* =================================================================
   共用：運輸主管簽審（派車結果覆核，簽審通過才生效；退回調度重新處理）
   ================================================================= */
group('運輸主管簽審（B/C/D 派車結果覆核；A 不經簽審）', () => {
  function aSubmit(H) {
    H.ModuleA.now = () => new Date(2026, 8, 2, 6, 0);
    return H.ModuleA.submit({ applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15 }).app;
  }

  test('共用規則：退回意見必填；已簽審者不再出現主管同意；歷程保留每一輪', () => {
    const H = fresh(), S = H.Signoff, rec = {};
    S.mark(rec, '派車 A', '調度室');
    ok(S.isPending(rec) && !S.effective(rec), '送簽後為待簽審、尚未生效');
    ok(!S.decide(rec, false, '運輸主管', '  ').ok, '退回須填意見');
    ok(S.decide(rec, true, '運輸主管', '').ok); ok(S.effective(rec));
    ok(!S.decide(rec, true, '運輸主管').ok, '已同意不可再簽');
    S.mark(rec, '派車 B（異動）', '調度室');
    eq(rec.sign.round, 2, '異動後重新送簽為第 2 輪'); ok(!S.effective(rec), '異動後重新待簽審');
    eq(rec.signLog.map(l => l.action).join('/'), '送簽審/主管同意/送簽審');
  });

  test('A 巡迴物品轉運不經調度主管簽審：排班、改派班次、車次異動皆不送簽，排班即待出車', () => {
    const H = fresh(), A = H.ModuleA;
    const app = aSubmit(H);
    eq(app.status, 'matched'); eq(app.sign, undefined, '自動排班不送簽');
    eq(typeof A.signRecords, 'undefined', '無 A 簽審清單');
    A.setShiftPlan(app.serviceDate, app.assignedShift, { vehicle: 'V-L02', driver: 'DR2' });
    const sh = H.DB.regionalShifts.filter(s => s.branch === app.branch).find(s => s.id !== app.assignedShift);
    A.reassignShift(app, sh.id);
    eq(app.sign, undefined, '車次異動、改派班次皆不送簽');
    eq(H.Flow.of(app), 'ready', '排班即生效（待出車）');
    const un = aSubmit(H); A.removeFromShift(un); eq(H.Flow.of(un), 'todo', '移出班次＝待調度');
    ok(A.returnNoCar(un, '  ').error.includes('必填')); ok(A.returnNoCar(un, '當日班次已滿').ok); eq(H.Flow.of(un), 'noCar');
    ok(A.returnNoCar(app, 'x').error.includes('待調度'), '已排班不可無車退回');
  });

  test('B：派車單送審才送簽；調度主管退回 → 派車單回調度中，修改後重新送審', () => {
    const H = fresh(), B = H.ModuleB;
    const o = B.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false, volume: 3000, category: 'BOX', weight: 300, handleMin: 30 });
    B.approve(o); B.dispatch('V-T02', 'greedy');
    eq(o.status, 'loaded'); ok(!o.sign, '未送審不送簽');
    const d1 = B.dispatchOf(o); ok(B.submitDispatch(d1).ok);
    eq(o.sign.status, 'pending'); ok(o.sign.summary.includes('V-T02') && o.sign.summary.includes(d1.id));
    ok(B.signReject(o, '運輸主管', '改派大車').ok);
    eq(o.status, 'loaded'); eq(d1.submitted, false, '派車單回未送審'); eq(H.Flow.of(o), 'dispatching', '退回＝調度中');
    ok(B.updateDispatch(d1, { vehicleType: '幹線聯結車', vehicle: 'V-T01', driver1: d1.driver1, driver2: '', submitted: true }).ok);
    eq(o.sign.round, 2); eq(H.Flow.of(o), 'signing');
  });

  test('C：派車單送審才送簽；調度主管退回 → 派車單回調度中，修改後重新送審', () => {
    const H = fresh(), C = H.ModuleC;
    const a = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-28', earliestReturn: '16:00', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    C.approve(a); C.runBatch('2026-08-26', 't1');
    eq(a.status, 'matched'); ok(!a.sign, '批次媒合只產生派車單，未送審不送簽');
    const o1 = C.dispatchOf(a); ok(C.submitDispatch(o1).ok); eq(a.sign.status, 'pending');
    ok(C.signReject(a, '運輸主管', '改派 9 人座').ok);
    eq(a.status, 'matched'); eq(o1.submitted, false); eq(H.Flow.of(a), 'dispatching', '退回＝調度中');
    C.submitDispatch(o1); eq(a.sign.round, 2);
    const v = a.vehicle; C.signApprove(a, '運輸主管');
    C.overrideAssign(a, { vehicle: v === 'V-B03' ? 'V-B01' : 'V-B03', note: '調度改派' }, '調度室');
    eq(a.sign.status, 'pending', '人工改派須重新簽審');
  });

  test('D：派車判斷即送簽審（資源先保留）；退回 → 回已核准待調度並釋放資源', () => {
    const H = fresh(), D = H.ModuleD;
    const mk = o => D.createApp(Object.assign({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00',
      endDate: '2026-10-01', endTime: '12:00', pax: 2, selfDrive: false, items: [] }, o || {}));
    const a = mk(); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' });
    const b = mk({ startTime: '10:00', endTime: '11:00' }); D.approve(b);
    ok(D.vehicleBusy('V-B01', b), '待簽審期間資源仍保留，避免重複指派');
    ok(D.reassign(a, { date: '2026-10-01', time: '10:00', vehicle: 'V-B03' }).error.includes('簽審'), '未簽審前不可做生命週期操作');
    eq(H.Flow.of(a), 'signing', '派車判斷即調度主管審（D 無派車單、無調度中）');
    ok(D.signReject(a, '運輸主管', '請改派 9 人座').ok);
    eq(a.status, 'approved'); eq(a.outcome, null); eq(a.vehicle, null); eq(D.isConfirmed(a), false);
    eq(D.vehicleBusy('V-B01', b), null, '退回後資源釋放');
    eq(D.mailLog.length, 0, '退回不寄派車結果通知');
    ok(D.dispatch(a, { vehicle: 'V-B03', driver: 'DR3' }).ok, '調度可重新判斷');
    eq(a.sign.round, 2);
  });
});

group('車輛使用實登（A/B/C/D 派車生效後登打實際車輛／駕駛／里程）', () => {
  const U = { vehicleType: '物流貨車', vehicle: 'V-L01', driver1: 'DR1', driver2: '', startKm: '12000', endKm: '12035.5' };

  test('共用規則：未生效不可實登；必填、車種與車號相符、駕駛不可重複、結束里程 ≥ 起始', () => {
    const H = fresh(), S = H.Signoff, Us = H.Usage, rec = {}, opts = { pool: 'LOGI' };
    S.mark(rec, '派車', '調度室');
    ok(Us.save(rec, U, '調度室', opts).error.includes('生效'), '待簽審不可實登');
    eq(Us.inScope(rec), false, '未生效不列入實登清單');
    S.decide(rec, true, '運輸主管');
    eq(Us.stateOf(rec), 'todo');
    ok(Us.save(rec, Object.assign({}, U, { vehicleType: '' }), '', opts).error.includes('車種類型'));
    ok(Us.save(rec, Object.assign({}, U, { vehicleType: '幹線貨車' }), '', opts).error.includes('不符'), '車號須屬於所選車種');
    ok(Us.save(rec, Object.assign({}, U, { vehicleType: '商務廂車', vehicle: 'V-B01' }), '', opts).error.includes('資源池'), '不可登其他資源池的車');
    ok(Us.save(rec, Object.assign({}, U, { driver1: '' }), '', opts).error.includes('駕駛人1'));
    ok(Us.save(rec, Object.assign({}, U, { driver2: 'DR1' }), '', opts).error.includes('同一人'));
    ok(Us.save(rec, Object.assign({}, U, { driver1: 'DR3' }), '', opts).error.includes('駕駛名單'), '商務池司機不可登物流單');
    ok(Us.save(rec, Object.assign({}, U, { endKm: '11999' }), '', opts).error.includes('不可小於'));
    ok(Us.save(rec, Object.assign({}, U, { startKm: '' }), '', opts).error.includes('起始里程'));
    ok(Us.save(rec, U, '調度室', opts).ok);
    eq(rec.usage.distance, 35.5, '行駛里程＝結束－起始'); eq(Us.stateOf(rec), 'done');
  });

  test('修改實登保留歷程；派車異動重新送簽後仍保留已實登紀錄', () => {
    const H = fresh(), S = H.Signoff, Us = H.Usage, rec = {}, opts = { pool: 'LOGI' };
    S.mark(rec, '派車', '調度室'); S.decide(rec, true, '運輸主管');
    Us.save(rec, U, '調度室', opts);
    ok(Us.save(rec, Object.assign({}, U, { vehicle: 'V-L02', driver2: 'DR2', endKm: '12050' }), '調度室-王', opts).ok);
    eq(rec.usageLog.map(l => l.action).join('/'), '實登/修改實登');
    eq(rec.usageLog[0].snapshot.vehicle, 'V-L01', '前次紀錄不被覆蓋'); eq(rec.usage.distance, 50);
    S.mark(rec, '派車異動', '調度室');
    ok(Us.inScope(rec), '已實登者派車異動後仍列在清單'); eq(Us.diffs(rec, { vehicle: 'V-L01', drivers: ['DR1'] }).join('/'), '車號/駕駛人');
  });

  test('A：排入班次即可實登（不經簽審），帶出班次車輛／司機；移出班次後不列入', () => {
    const H = fresh(), A = H.ModuleA;
    A.now = () => new Date(2026, 8, 2, 6, 0);
    const app = A.submit({ applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15 }).app;
    const other = A.submit({ applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15 }).app;
    A.removeFromShift(other);
    ok(!A.usageRecords().includes(other), '未排入班次不列入');
    ok(!A.usageSave(other, { vehicleType: '物流貨車', vehicle: 'V-L01', driver1: 'DR1', startKm: 1, endKm: 2 }).ok, '未排入班次不可實登');
    const pl = A.usagePlan(app);
    ok(pl.vehicle && pl.drivers.length === 1, '派車規劃含班次車輛與司機');
    eq(A.usageRecords().map(a => a.id).join(), app.id);
    const v = H.DB.vehicles.find(x => x.id === pl.vehicle);
    ok(A.usageSave(app, { vehicleType: v.type, vehicle: v.id, driver1: pl.drivers[0], startKm: 100, endKm: 142 }, '調度室').ok);
    eq(app.usage.distance, 42);
  });

  test('G123 A 以車次實登：儲存起訖里程即完成，車次內各單已回登；異常回報三選一', () => {
    const H = fresh(), A = H.ModuleA;
    A.now = () => new Date(2026, 8, 2, 6, 0);
    const mk = () => A.submit({ applicant: '業務部-周雅婷', station: 'D1-300', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15 }).app;
    const a1 = mk(), a2 = mk();
    eq(a1.assignedShift, a2.assignedShift, '兩單同車次');
    const date = a1.serviceDate, sh = a1.assignedShift, plan = A.shiftPlan(date, sh);
    eq(A.tripApps(date, sh).length, 2);
    ok(A.tripUsageSave(date, sh, { vehicle: plan.vehicle, driver: plan.driver, startKm: 50, endKm: 10 }, '周雅婷').error.includes('結束里程'));
    ok(A.tripUsageSave(date, sh, { vehicle: plan.vehicle, driver: '', startKm: 1, endKm: 2 }, '周雅婷').error.includes('司機'));
    ok(A.tripUsageSave(date, sh, { vehicle: plan.vehicle, driver: plan.driver, startKm: 1, endKm: 2 }, '周雅婷', { dryRun: true }).ok);
    ok(!A.tripUsage(date, sh) && !a1.usage, 'dryRun 不寫入');
    ok(A.tripUsageSave(date, sh, { vehicle: plan.vehicle, driver: plan.driver, startKm: 1000, endKm: 1036.5 }, '周雅婷').ok);
    eq(A.tripUsage(date, sh).distance, 36.5); eq(A.tripUsage(date, sh).by, '周雅婷', '實登人員系統帶入');
    eq(H.Flow.of(a1), 'logged'); eq(H.Flow.of(a2), 'logged', '車次內每張單皆已回登');
    ok(A.tripUsageSave(date, sh, { vehicle: plan.vehicle, driver: plan.driver, startKm: 1000, endKm: 1040 }, '周雅婷').ok);
    eq(A.tripUsageLog(date, sh).map(l => l.action).join('/'), '實登/修改實登');
    eq(A.shiftPlan(date, sh).vehicle, plan.vehicle, '實登不改車次安排');
    eq(A.INCIDENTS.map(o => o[1]).join('/'), '正常運送/不準時/沒出現');
    ok(A.setIncident(a1, '使用者沒出現').ok); eq(a1.incident, '使用者沒出現');
    ok(!A.setIncident(a1, '亂填').ok); ok(A.setIncident(a1, '').ok); eq(a1.incident, '', '可改回正常運送');
  });

  test('G124 B 以派車單實登：簽審通過才列入；儲存即完成，派車單內各託運單已回登', () => {
    const H = fresh(), B = H.ModuleB;
    const mk = () => { const o = B.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 30 }); B.approve(o); return o; };
    const o1 = mk(), o2 = mk();
    B.dispatch('V-T02', 'greedy');
    const d = B.dispatchOf(o1);
    ok(d && B.dispatchOf(o2) === d, '同車兩單同一派車單');
    const U = { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: '', startKm: 100, endKm: 180 };
    ok(!B.usageDispatches().includes(d), '未送審不列入');
    ok(B.dispatchUsageSave(d, U, '周雅婷').error.includes('簽審'), '未簽審不可實登');
    B.submitDispatch(d); B.signApprove(o1, '運輸主管');
    ok(!B.usageDispatches().includes(d), '部分託運單簽審通過仍不列入');
    B.signApprove(o2, '運輸主管');
    ok(B.usageDispatches().includes(d));
    ok(B.dispatchUsageSave(d, Object.assign({}, U, { driver1: '' }), '周雅婷').error.includes('駕駛人1'));
    ok(B.dispatchUsageSave(d, U, '周雅婷', { dryRun: true }).ok); ok(!d.usage && !o1.usage, 'dryRun 不寫入');
    ok(B.dispatchUsageSave(d, U, '周雅婷').ok);
    eq(d.usage.distance, 80); eq(d.usage.by, '周雅婷');
    eq(H.Flow.of(o1), 'logged'); eq(H.Flow.of(o2), 'logged', '派車單內每張託運單皆已回登');
    ok(B.dispatchUsageSave(d, Object.assign({}, U, { vehicleType: '幹線聯結車', vehicle: 'V-T01', endKm: 190 }), '周雅婷').ok, '可改登實際車輛');
    eq(d.usageLog.map(l => l.action).join('/'), '實登/修改實登'); eq(o2.usage.vehicle, 'V-T01');
    eq(d.vehicle, 'V-T02', '實登不改派車單');
  });

  test('G125 C 以派車單實登：簽審通過才列入；儲存即完成、各申請單已回登、資源回歸屬據點', () => {
    const H = fresh(), C = H.ModuleC;
    const mk = () => { const a = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-28', earliestReturn: '16:00', pax: 1, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' }); C.approve(a); return a; };
    const a1 = mk(), a2 = mk();
    C.runBatch('2026-08-26', 't1');
    const d = C.dispatchOf(a1);
    ok(d && C.dispatchOf(a2) === d, '同車兩單同一派車單');
    const U = { vehicleType: d.vehicleType, vehicle: d.vehicle, driver1: d.driver1, driver2: '', startKm: 30000, endKm: 30320 };
    ok(!C.usageDispatches().includes(d), '未送審不列入');
    ok(C.dispatchUsageSave(d, U, '周雅婷').error.includes('簽審'));
    C.submitDispatch(d); C.signApprove(a1, '運輸主管'); C.signApprove(a2, '運輸主管');
    ok(C.usageDispatches().includes(d));
    const v = H.DB.vehicles.find(x => x.id === d.vehicle); v.currentSite = '台中辦公室';
    ok(C.dispatchUsageSave(d, U, '周雅婷', { dryRun: true }).ok); ok(!d.usage && v.currentSite === '台中辦公室', 'dryRun 不寫入');
    ok(C.dispatchUsageSave(d, U, '周雅婷').ok);
    eq(d.usage.distance, 320); eq(H.Flow.of(a1), 'logged'); eq(H.Flow.of(a2), 'logged', '派車單內每張申請單皆已回登');
    eq(v.currentSite, v.homeSite, '已回登後車輛回歸屬據點');
    ok(C.dispatchUsageSave(d, Object.assign({}, U, { endKm: 30330 }), '周雅婷').ok);
    eq(d.usageLog.map(l => l.action).join('/'), '實登/修改實登');
  });

  test('G126 D 一單一派車單：派車即給單號；簽審通過才可實登；自駕可登使用者自駕；無車退回無派車單', () => {
    const H = fresh(), D = H.ModuleD, Us = H.Usage;
    const mk = o => D.createApp(Object.assign({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00',
      endDate: '2026-10-01', endTime: '12:00', pax: 2, selfDrive: false, items: [] }, o || {}));
    const a = mk(); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', drivers: ['DR3', 'DR4'] }, '調度室-王');
    ok(/^GD\d{3}$/.test(a.dispatchNo), '派車即給派車單號');
    const d = D.dispatchOrderOf(a);
    eq(d.vehicle, 'V-B01'); eq(d.driver1, 'DR3'); eq(d.driver2, 'DR4'); eq(d.dispatcher, '調度室-王'); eq(d.vehicleType, '商務廂車');
    eq(H.Flow.of(a), 'signing', '一般用車仍無「調度中」');
    ok(!D.usageDispatches().includes(d)); ok(D.dispatchUsageSave(d, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR3', startKm: 1, endKm: 2 }, '周雅婷').error.includes('簽審'));
    D.signApprove(a, '運輸主管');
    ok(D.usageDispatches().includes(d));
    ok(D.dispatchUsageSave(d, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: Us.SELF, startKm: 1, endKm: 2 }, '周雅婷').error.includes('駕駛名單'), '非自駕單不可登使用者自駕');
    ok(D.dispatchUsageSave(d, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR3', driver2: 'DR4', startKm: 30210, endKm: 30288 }, '周雅婷').ok);
    eq(d.usage.distance, 78); eq(H.Flow.of(a), 'logged');
    const b = mk({ selfDrive: true, startTime: '13:00', endTime: '15:00' }); D.approve(b);
    ok(D.dispatch(b, { vehicle: 'V-B04', driver: 'DR5' }).ok); D.signApprove(b, '運輸主管');
    const db = D.dispatchOrderOf(b); ok(db && db.id !== d.id, '每張申請單各一張派車單'); ok(db.selfDrive, '可自駕單');
    ok(D.dispatchUsageSave(db, { vehicleType: '商務廂車', vehicle: 'V-B04', driver1: Us.SELF, startKm: 800, endKm: 845 }, '周雅婷').ok);
    const c = mk({ startTime: '16:00', endTime: '17:00' }); D.approve(c); D.dispatch(c, { noVehicle: true });
    ok(!c.dispatchNo && !D.dispatchOrderOf(c), '無車退回不產生派車單');
    const e = mk({ startTime: '18:00', endTime: '19:00' }); D.approve(e); D.dispatch(e, { vehicle: 'V-B02', drivers: ['DR5'] });
    const no = e.dispatchNo; D.signReject(e, '運輸主管', '換車');
    ok(!D.dispatchOrderOf(e), '退回後派車單失效'); D.dispatch(e, { vehicle: 'V-B03', drivers: ['DR5'] });
    eq(e.dispatchNo, no, '重新派車沿用同一派車單號'); eq(D.dispatchOrderOf(e).vehicle, 'V-B03');
  });

  test('B：沿用派車單車輛／駕駛，駕駛人1 必填；C：沿用派車車輛／司機', () => {
    const H = fresh(), B = H.ModuleB, C = H.ModuleC;
    const o = B.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', direct: false, volume: 3000, category: 'BOX', weight: 300, handleMin: 30 });
    B.approve(o); B.dispatch('V-T02', 'greedy'); B.submitDispatch(B.dispatchOf(o)); B.signApprove(o, '運輸主管');
    eq(B.usagePlan(o).vehicle, 'V-T02'); eq(B.usagePlan(o).drivers.join(), B.dispatchOf(o).driver1, '帶入派車單駕駛人1');
    ok(B.usageSave(o, { vehicleType: '幹線貨車', vehicle: 'V-T02', driver1: '', startKm: 1, endKm: 2 }).error.includes('駕駛人1'));
    ok(B.usageSave(o, { vehicleType: '幹線聯結車', vehicle: 'V-T01', driver1: 'DR1', driver2: 'DR2', startKm: 5000, endKm: 5320 }).ok, '實際改用聯結車＋雙駕駛');
    const a = C.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-28', earliestReturn: '16:00', pax: 2, applicant: '業務部-周雅婷', dept: '業務部', ext: '2201' });
    C.approve(a); C.runBatch('2026-08-26', 't1'); C.submitDispatch(C.dispatchOf(a)); C.signApprove(a, '運輸主管');
    const pl = C.usagePlan(a); eq(pl.vehicle, a.vehicle); eq(pl.drivers[0], a.driver);
    const v = H.DB.vehicles.find(x => x.id === a.vehicle);
    ok(C.usageSave(a, { vehicleType: v.type, vehicle: v.id, driver1: a.driver, startKm: 0, endKm: 260 }).ok);
  });

  test('D：無車可派不需實登；自駕單駕駛人1 可登「使用者自駕」，一般單不可', () => {
    const H = fresh(), D = H.ModuleD, Us = H.Usage;
    const mk = o => D.createApp(Object.assign({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00',
      endDate: '2026-10-01', endTime: '12:00', pax: 2, selfDrive: false, items: [] }, o || {}));
    const a = mk(); D.approve(a); D.dispatch(a, { vehicle: 'V-B01', drivers: ['DR3', 'DR4'] }); D.signApprove(a, '運輸主管');
    eq(D.usagePlan(a).drivers.join(), 'DR3,DR4', '雙駕駛帶入駕駛人1／2');
    ok(D.usageSave(a, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: Us.SELF, startKm: 1, endKm: 2 }).error.includes('駕駛名單'));
    ok(D.usageSave(a, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR3', driver2: 'DR4', startKm: 30210, endKm: 30288 }).ok);
    const b = mk({ selfDrive: true, startTime: '13:00', endTime: '15:00' }); D.approve(b);
    ok(D.dispatch(b, { vehicle: 'V-B04', driver: 'DR5' }).ok); D.signApprove(b, '運輸主管');
    ok(D.usageSave(b, { vehicleType: '商務廂車', vehicle: 'V-B04', driver1: Us.SELF, startKm: 800, endKm: 845 }).ok, '申請可自駕者，實際由使用者自駕可登「使用者自駕」');
    const c = mk({ startTime: '16:00', endTime: '17:00' }); D.approve(c);
    D.dispatch(c, { noVehicle: true }); D.signApprove(c, '運輸主管');
    ok(!D.usageRecords().includes(c), '無車可派不列入實登清單');
  });
});

/* =================================================================
   共用：狀態名稱對齊（G122，四模組只顯示 10 種狀態）
   ================================================================= */
group('狀態名稱對齊（G122：申請中～已回登）', () => {
  test('狀態清單只有 10 種，名稱對齊', () => {
    const H = fresh();
    eq(H.Flow.STATES.map(x => x[1]).join(','), '申請中,待二級審,退回修編,待調度,無車退回,調度中,調度主管審,待出車,已出車,已回登');
  });

  test('四模組皆可暫存為「申請中」，送出後才進入下一關（A 直接排班；B/C/D 待二級審）', () => {
    const H = fresh(), F = H.Flow;
    H.ModuleA.now = () => new Date(2026, 8, 2, 6, 0);
    const a = H.ModuleA.saveDraft({ applicant: 'X', station: 'D1-300', building: '一號月台', items: [item({ l: 40, w: 30, h: 30 })], recvMode: 'asap', handleMin: 10 });
    eq(F.of(a), 'draft'); eq(a.assignedShift, null, '暫存不媒合');
    H.ModuleA.submitDraft(a); eq(F.of(a), 'ready', 'A 送出即排班＝待出車');
    const b = H.ModuleB.createOrder({ applicant: 'X', site: 'D9', destSite: 'D3', volume: 100, weight: 10, handleMin: 5 }, { draft: true });
    eq(F.of(b), 'draft');
    H.ModuleB.saveDraft(b, { applicant: 'X', site: 'D9', destSite: 'D4', volume: 100, weight: 10, handleMin: 5 }); eq(b.dropSite, 'D4'); eq(F.of(b), 'draft');
    H.ModuleB.resubmit(b, { applicant: 'X', site: 'D9', destSite: 'D4', volume: 100, weight: 10, handleMin: 5 }); eq(F.of(b), 'review');
    const c = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室', departDate: '2026-08-27', earliestPickup: '09:00',
      returnDate: '2026-08-27', earliestReturn: '16:00', pax: 1, applicant: 'Y', dept: 'D', ext: '1' }, { draft: true });
    eq(F.of(c), 'draft'); H.ModuleC.resubmit(c, c); eq(F.of(c), 'review');
    const d = H.ModuleD.createApp({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-01', endTime: '12:00', pax: 1, selfDrive: false, items: [] }, { draft: true });
    eq(F.of(d), 'draft'); H.ModuleD.resubmit(d, d); eq(F.of(d), 'review');
    H.ModuleD.reject(d, '請補說明'); eq(F.of(d), 'revise', '單位主管退回＝退回修編');
  });

  test('D 流程：待調度 → 派車判斷即調度主管審 → 待出車 → 已出車 → 已回登；無車退回結案', () => {
    const H = fresh(), D = H.ModuleD, F = H.Flow;
    const a = D.createApp({ applicant: '業務部-周雅婷', startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-01', endTime: '12:00', pax: 1, selfDrive: false, items: [] });
    D.approve(a); eq(F.of(a), 'todo');
    D.dispatch(a, { vehicle: 'V-B01', driver: 'DR3' }); eq(F.of(a), 'signing');
    D.signApprove(a, '運輸主管'); eq(F.of(a), 'ready');
    F._now = new Date(2026, 9, 1, 9, 0); eq(F.of(a), 'departed', '用車起時間到＝已出車');
    ok(D.usageSave(a, { vehicleType: '商務廂車', vehicle: 'V-B01', driver1: 'DR3', startKm: 1, endKm: 30 }).ok); eq(F.of(a), 'logged');
    const b = D.createApp({ applicant: '業務部-周雅婷', startDate: '2026-10-02', startTime: '09:00', endDate: '2026-10-02', endTime: '12:00', pax: 1, selfDrive: false, items: [] });
    D.approve(b); D.dispatch(b, { noVehicle: true }, '調度室', '當日無車'); eq(F.of(b), 'noCar'); ok(!D.canEdit(b), '無車退回不可修改重送');
  });
});

/* =================================================================
   共用單元：申請引導（建議規格 v0.2 卡片出現規則 5.2／判定決策表 R1/R2/R4/R5；R3 隨例行用車移除）
   ================================================================= */
group('申請引導（卡片出現規則／判定決策表 R1/R2/R4/R5／帶入）', () => {
  const FUT = '2099-03-01';
  const base = (o) => Object.assign({ applicant: '業務部-周雅婷', dept: '業務部', ext: '2201', mode: '', fromSite: '', toSite: '',
    recvDate: FUT, recvTime: '', items: [], startDate: '', endDate: '',
    origin: '', dest: '', otherPlace: '', tripType: 'round', departTime: '09:00', backTime: '17:00', pax: 2, hasCargo: '', selfDrive: null }, o);
  const box = { name: '文件箱', l: 40, w: 30, h: 30, qty: 2, category: 'BOX', weight: 5 };

  test('卡片：一開始只有需求與判定結果；選物品出現物品寄送，兩據點選好才出現貨物清單', () => {
    const G = fresh().Guide;
    eq(G.visibleCards(base()).join(), 'K1,K7');
    eq(G.visibleCards(base({ mode: 'goods' })).join(), 'K1,K2,K7');
    eq(G.visibleCards(base({ mode: 'goods', fromSite: 'D6', toSite: 'D6' })).join(), 'K1,K2,K3,K7');
  });

  test('卡片：有人搭車出現用車期間；起訖有效才出現行程（不論天數）；有物品再出現貨物清單', () => {
    const G = fresh().Guide;
    eq(G.visibleCards(base({ mode: 'people' })).join(), 'K1,K4,K7');
    eq(G.visibleCards(base({ mode: 'people', startDate: '2099-03-01', endDate: '2099-05-30' })).join(), 'K1,K4,K6,K7', '長天數也走行程');
    eq(G.visibleCards(base({ mode: 'people', startDate: '2099-03-05', endDate: '2099-03-01' })).join(), 'K1,K4,K7', '迄日早於起日');
    eq(G.visibleCards(base({ mode: 'people', startDate: FUT, endDate: FUT, hasCargo: 'yes' })).join(), 'K1,K4,K6,K3,K7');
  });

  test('R1／R2：寄件與收件據點相同 → 收貨申請，不同 → 幹線託運', () => {
    const G = fresh().Guide;
    eq(G.route(base({ mode: 'goods', fromSite: 'D6', toSite: 'D6' })).unit, 'A');
    eq(G.route(base({ mode: 'goods', fromSite: 'D9', toSite: 'D3' })).unit, 'B');
    ok(!G.route(base({ mode: 'goods', fromSite: 'D9' })).unit, '缺收件據點未判定');
  });

  test('例行用車已移除：長天數不再另走例行用車，依地點／物品判定；迄日早於起日未判定', () => {
    const G = fresh().Guide;
    ok(!('E' in G.UNITS), '判定功能不含例行用車');
    const long = base({ mode: 'people', startDate: '2099-03-01', endDate: '2099-05-31', origin: '台北總部', dest: '台中辦公室', hasCargo: 'no' });
    eq(G.route(long).unit, 'C', '92 天、共乘清單、無物品 → 出差用車');
    eq(G.route(Object.assign(long, { dest: G.OTHER })).unit, 'D', '92 天、其他地點 → 一般用車');
    ok(!G.route(base({ mode: 'people', startDate: '2099-03-05', endDate: '2099-03-01' })).unit, '迄日早於起日未判定');
  });

  test('R4／R5：地點在共乘清單且無物品 → 出差用車；其他地點或有物品 → 一般用車', () => {
    const G = fresh().Guide;
    const p = o => base(Object.assign({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: '桃園機場T1' }, o));
    eq(G.route(p({ hasCargo: 'no' })).unit, 'C');
    eq(G.route(p({ hasCargo: 'yes' })).unit, 'D');
    eq(G.route(p({ dest: G.OTHER })).unit, 'D', '其他地點不必等隨行物品即判定');
    ok(!G.route(p({ hasCargo: '' })).unit, '清單內地點需先選是否有物品');
  });

  test('帶入：出差用車／一般用車的帶入資料可直接通過該功能驗證', () => {
    const H = fresh(), G = H.Guide;
    const c = G.prefill(base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: '高鐵台北站', hasCargo: 'no' }));
    eq(c.unit, 'C'); eq(c.data.type, 'round'); eq(c.data.pax, 2);
    ok(H.ModuleC.createApp(c.data).id, '出差用車可建立');
    const dv = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: G.OTHER, otherPlace: '新竹科學園區三家客戶',
      hasCargo: 'yes', items: [Object.assign({ hazardous: true }, box)], selfDrive: true });
    eq(G.missing(dv).length, 0, '欄位齊全：' + G.missing(dv).join('、'));
    const d = G.prefill(dv);
    eq(d.unit, 'D'); eq(H.ModuleD.validate(d.data).length, 0, 'D 驗證：' + H.ModuleD.validate(d.data).join('、'));
    ok(d.data.purpose.includes('新竹科學園區'), '其他地點寫入行程說明'); eq(d.data.items[0].hazardous, true);
    const mv = base({ mode: 'people', startDate: '2099-03-01', endDate: '2099-03-03', origin: '台中辦公室', dest: G.OTHER, otherPlace: '彰化客戶',
      hasCargo: 'no', selfDrive: false });
    const m = G.prefill(mv);
    eq(m.unit, 'D'); eq(m.data.endDate, '2099-03-03', '多天用車帶入起訖');
    eq(H.ModuleD.validate(m.data).length, 0, '多天一般用車驗證：' + H.ModuleD.validate(m.data).join('、'));
  });

  test('帶入：只帶判定路徑用得到的欄位；物品含危險品導向收貨／幹線時提示', () => {
    const G = fresh().Guide;
    const v = base({ mode: 'goods', fromSite: 'D9', toSite: 'D3', recvTime: '10:30', items: [Object.assign({ hazardous: true }, box)],
      origin: '台北總部', purpose: '不應帶入', pax: 5 });
    const b = G.prefill(v);
    eq(b.unit, 'B'); eq(b.data.site, 'D9'); eq(b.data.destSite, 'D3'); eq(b.data.wantReceiveTime, '10:30');
    ok(!('pax' in b.data) && !('purpose' in b.data), '隱藏卡片（行程）的資料不帶入');
    ok(b.warnings.length === 1, '危險品提示');
    const a = G.prefill(base({ mode: 'goods', fromSite: 'D6', toSite: 'D6', recvDate: G.todayStr(), items: [box] }));
    eq(a.unit, 'A'); eq(a.data.branch, 'D6'); eq(a.data.recvMode, 'asap', '今天且未填時間 → 越快越好');
  });

  test('缺漏欄位：未填齊不可前往（例：一般用車未選自駕、單程目的地非轉運點）', () => {
    const G = fresh().Guide;
    const d = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: G.OTHER, dest: '桃園機場T1', otherPlace: 'x', hasCargo: 'no' });
    ok(G.missing(d).some(m => m.includes('自己開車')));
    const c = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: '新竹分公司', hasCargo: 'no', tripType: 'oneway' });
    ok(G.missing(c).some(m => m.includes('單程')), '新竹分公司非轉運點不可單程');
    ok(G.missing(base({ mode: 'goods', fromSite: 'D6', toSite: 'D6' })).some(m => m.includes('貨物')), '物品至少 1 項');
  });

  test('引導紀錄：前往並帶入建立紀錄；回到引導修改後重新帶入更新同一筆並記錄改判', () => {
    const G = fresh().Guide;
    const cv = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: '高鐵台北站', hasCargo: 'no' });
    const { rec, pf } = G.hand(cv);
    eq(rec.id, 'GD-0001'); eq(rec.status, 'handed'); eq(rec.unit, 'C'); eq(pf.recId, 'GD-0001');
    eq(rec.log.map(l => l.action).join(), '建立引導,判定並帶入');
    const again = G.reopen(rec.id);
    again.hasCargo = 'yes'; again.items = [box]; again.selfDrive = false;
    const r2 = G.hand(again, rec.id).rec;
    eq(r2, rec, '同一筆紀錄'); eq(G.records.length, 1); eq(rec.unit, 'D');
    ok(rec.log[rec.log.length - 1].note.includes('差旅共乘申請 → 一般用車申請'), '歷程記錄改判');
    eq(rec.v.hasCargo, 'yes', '保存最新填寫內容');
    let err = ''; try { G.hand(base({ mode: 'goods' })); } catch (e) { err = e.message; }
    ok(err, '未判定不可帶入');
  });

  test('引導紀錄：目標功能送出後回填申請單號；已送出者不可再修改，重新帶入另建新紀錄', () => {
    const G = fresh().Guide;
    const ev = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: G.OTHER, otherPlace: '新竹客戶',
      hasCargo: 'no', selfDrive: true });
    const { rec } = G.hand(ev);
    eq(G.markSubmitted(rec.id, 'GU001'), rec);
    eq(rec.status, 'submitted'); eq(rec.appId, 'GU001');
    ok(rec.log[rec.log.length - 1].note.includes('GU001'));
    eq(G.markSubmitted(rec.id, 'GU002'), null, '已送出不重複回填');
    eq(G.reopen(rec.id), null, '已送出不可回到修改');
    const n = G.hand(ev, rec.id).rec;
    eq(n.id, 'GD-0002', '指向已送出紀錄時另建新紀錄'); eq(G.records[0], n, '新紀錄排最前');
  });

  test('引導紀錄：目標功能先暫存（申請中），之後送出時回填申請單號', () => {
    const H = fresh(), G = H.Guide;
    const ev = base({ mode: 'people', startDate: FUT, endDate: FUT, origin: '台北總部', dest: G.OTHER, otherPlace: '新竹客戶',
      hasCargo: 'no', selfDrive: true });
    const { rec } = G.hand(ev);
    const d = H.ModuleD.createApp(Object.assign({}, G.prefill(ev).data, { role: '一般員工' }), { draft: true });
    eq(G.linkDraft(rec.id, d.id), rec); eq(rec.status, 'handed', '暫存仍為已帶入待送出'); eq(rec.draftAppId, d.id);
    eq(G.draftSubmitted('GU999'), null, '其他單號不影響');
    H.ModuleD.resubmit(d, d);
    eq(G.draftSubmitted(d.id), rec); eq(rec.status, 'submitted'); eq(rec.appId, d.id);
    eq(rec.log.map(l => l.action).slice(-2).join('/'), '暫存申請單/送出申請');
  });
});

/* ---- 總結 ---- */
process.stdout.write('\n' + '─'.repeat(48) + '\n');
process.stdout.write((failed === 0 ? '\x1b[32m' : '\x1b[31m')
  + '通過 ' + passed + ' / 失敗 ' + failed + '\x1b[0m\n');
if (failed > 0) {
  process.stdout.write('\n失敗清單：\n');
  fails.forEach(f => process.stdout.write('  · ' + f.name + '：' + f.msg + '\n'));
  process.exit(1);
}
process.exit(0);
