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
  function submit(H, over) {
    return H.ModuleA.submit(Object.assign({
      applicant: '業務部-周雅婷', station: 'S3', building: '一號月台',
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

  test('G16 同站多單依「送出先後」累計時間額度，超額者順延下一班', () => {
    const H = fresh();
    const a1 = submit(H).app, a2 = submit(H).app, a3 = submit(H).app; // 各 15 分，額度 40
    eq([a1.submitSeq, a2.submitSeq, a3.submitSeq].join(','), '1,2,3', '送出序應遞增');
    eq(a1.assignedShift, 'R-A1'); eq(a2.assignedShift, 'R-A1');
    eq(a3.assignedShift, 'R-A2', '第三單 45>40 應順延下一班（G16/G17）');
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
    for (let i = 0; i < 8; i++) submit(H, { items: [big()], handleMin: 1 });
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

  test('媒合成功後狀態為 matched，且可直接交貨（不需先接受）', () => {
    const H = fresh();
    const { app } = submit(H);
    eq(app.status, 'matched', '媒合成功即已排班');
    ok(typeof H.ModuleA.acceptSchedule === 'undefined', '不應再有確認接受排班步驟');
    H.ModuleA.confirmDelivery(app, '接收人');
    eq(app.status, 'delivered', 'matched 應可直接進入已交貨');
  });

  test('上貨＋下貨時間加總為站內佔用時間 handleMin（G15），並用於額度判定', () => {
    const H = fresh();
    const { app } = submit(H, { loadMin: 18, unloadMin: 12, handleMin: undefined }); // 合計 30 ≤ 40
    eq(app.handleMin, 30, 'handleMin 應為上貨＋下貨加總');
    eq(app.assignedShift, 'R-A1', '30 分在額度內應排首班');
    // 幹線同樣加總
    const o = H.ModuleB.createOrder({ applicant: 'X', site: 'D3', destSite: 'D1', direct: false,
      loadMin: 20, unloadMin: 15, items: [{ name: 'a', l: 50, w: 50, h: 50, qty: 1, category: 'BOX', weight: 10 }] });
    eq(o.handleMin, 35, '幹線 handleMin 應為上貨＋下貨加總（G35）');
  });

  test('G19 越快越好：選最早出發班次', () => {
    const H = fresh();
    const { result } = submit(H, { recvMode: 'asap' });
    ok(result.ok, '應排入'); eq(result.shift.id, 'R-A1', 'asap 應排最早班次 R-A1（08:30）');
  });

  test('G19 指定期望時間：以交貨時間為目標，選到站時間差最小的班次（早晚都比）', () => {
    const H = fresh();
    const { result } = submit(H, { recvMode: 'exact', deliverTime: '20:00' });
    ok(result.ok); eq(result.shift.id, 'R-A3', '交貨時間 20:00 應選最接近的末班');
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
    eq(result.shift.id, 'R-A1', '無截止 → 排最早班次 R-A1');
  });

  test('A-1 期望時間非硬性截止：期望早於首班到站仍排入首班並回報時間差', () => {
    const H = fresh();
    // S3 到站：R-A1≈09:06；期望 08:00 早於任何班次 → 仍應排入最接近的 R-A1，不得退件
    const { app, result } = submit(H, { recvMode: 'exact', deliverTime: '08:00' });
    ok(result.ok, '不得因期望時間過早而失敗（無 late 退件）');
    eq(result.shift.id, 'R-A1', '應選到站時間差最小的 R-A1');
    ok(result.expectDiffMin > 0, '應回報較期望時間晚的分鐘數，實得 ' + result.expectDiffMin);
    eq(app.expectDiffMin, result.expectDiffMin, '差值應存於申請單供顯示');
  });

  test('A-1 失敗原因只剩 toobig 與 full（無 late 原因碼）', () => {
    const H = fresh();
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    for (let i = 0; i < 8; i++) submit(H, { items: [big()], handleMin: 1 });
    const r1 = submit(H, { items: [big()], handleMin: 1, recvMode: 'exact', deliverTime: '08:00' }).result;
    ok(!r1.ok && r1.reason === 'full', '排滿後即使期望極早也應回 full 而非 late，實得 ' + r1.reason);
  });

  test('期望時間空值：asap 排最早班；asap 不受期望時間影響', () => {
    const H = fresh();
    eq(submit(H, { deliverTime: '' }).result.shift.id, 'R-A1', '空值應排最早班');
    eq(submit(fresh(), { recvMode: 'asap', deliverTime: '23:59' }).result.shift.id, 'R-A1', 'asap 模式不用期望時間');
  });

  test('A-2 先卸後裝：站區間不重疊的兩張大單可同班次（卸貨釋放容量）', () => {
    const H = fresh();
    // 每張有效體積 ≈8886L（V-L01 容量 ≈14364L 的 62%）：舊邏輯兩張累計必爆
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    const a1 = submit(H, { pickStation: 'S1', station: 'S3', items: [big()], handleMin: 1 }).app; // 佔 [1,3)
    const a2 = submit(H, { pickStation: 'S5', station: 'S8', items: [big()], handleMin: 1 }).app; // 佔 [5,8)
    eq(a1.assignedShift, 'R-A1', '第一張排首班');
    eq(a2.assignedShift, 'R-A1', '區間不重疊 → 第二張也應排同一班（容量已於 S3 釋放）');
  });

  test('A-2 區間重疊仍受容量限制：跨越整段的大單須順延', () => {
    const H = fresh();
    const big = () => item({ name: '大箱', l: 240, w: 170, h: 180, qty: 1, category: 'BOX', weight: 50 });
    submit(H, { pickStation: 'S1', station: 'S3', items: [big()], handleMin: 1 });
    submit(H, { pickStation: 'S5', station: 'S8', items: [big()], handleMin: 1 });
    const a3 = submit(H, { pickStation: 'S1', station: 'S9', items: [big()], handleMin: 1 }).app; // 佔 [1,9) 與兩張皆重疊
    ok(a3.assignedShift !== 'R-A1', '與既有單重疊區間容量不足 → 不得排首班，實得 ' + a3.assignedShift);
  });

  test('A-2 額度計於各自站點：上貨計收貨站、卸貨計送貨站', () => {
    const H = fresh();
    // 兩張同收貨站 S4、上貨各 30 分：S4 上貨額度 30+30>40 → 第二張順延班次
    const a1 = submit(H, { pickStation: 'S4', station: 'S7', loadMin: 30, unloadMin: 5, handleMin: undefined }).app;
    const a2 = submit(H, { pickStation: 'S4', station: 'S8', loadMin: 30, unloadMin: 5, handleMin: undefined }).app;
    eq(a1.assignedShift, 'R-A1', '第一張排首班');
    ok(a2.assignedShift !== 'R-A1', '收貨站 S4 上貨額度不足 → 第二張應順延，實得 ' + a2.assignedShift);
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
    eq(r.days, H.DB.dayCountDirect['D2'], '天數查直達對照表（G37）');
  });

  test('G40/G41/G42 回程撞期直達 → 鎖定直達、延續動態淨值、排擠非直達順延', () => {
    const H = fresh();
    const rd = H.ModuleB.createOrder({ applicant: 'A', site: 'D3', direct: true, volume: 2000, weight: 200, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'B', site: 'D6', direct: false, volume: 2000, weight: 200, handleMin: 20 });
    [rd, rn].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 500);
    eq(r.matrixRow, 4, '應為矩陣第 4 列（回程・被迫鎖定直達）');
    eq(r.endpoint, 'D10', '回程終點仍為出發據點（G41/G36）');
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
    eq(r.matrixRow, 5); eq(r.endpoint, 'D10'); ok(r.locked, '應鎖定'); eq(r.carried.length, 0);
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

  test('交貨時間接進派車：估算送達晚於交貨時間 → 該單不排（留下一班）', () => {
    const H = fresh();
    // D6 上車（≈11:40 到）、送 D2；D6→D2 再走 220 分 → 送達 ≈15:40，晚於 12:00
    const late = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20, deliverTime: '12:00' });
    H.ModuleB.approve(late);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(!r.carried.includes(late), '預計送達晚於 12:00 → 不應排入');
    eq(late.status, 'approved', '未排入者狀態不應改為 loaded');
  });

  test('交貨時間寬鬆：估算可於交貨時間前送達 → 正常排入', () => {
    const H = fresh();
    const good = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20, deliverTime: '17:00' });
    H.ModuleB.approve(good);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(good), '17:00 前可送達 → 應排入');
    eq(good.status, 'loaded', '排入後狀態為 loaded');
  });

  test('交貨時間空值＝不設限：派車行為與既有相容', () => {
    const H = fresh();
    const o = H.ModuleB.createOrder({ applicant: 'A', site: 'D6', destSite: 'D2', direct: false,
      volume: 1000, category: 'BOX', weight: 100, handleMin: 20 }); // 無 deliverTime
    H.ModuleB.approve(o);
    const r = H.ModuleB.dispatch('V-T02', 'greedy');
    ok(r.carried.includes(o), '未設交貨時間應照常排入');
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

  test('B-2 狀態機無 accepted：loaded 直接可 delivered，且無 acceptDelivery', () => {
    const H = fresh();
    ok(typeof H.ModuleB.acceptDelivery === 'undefined', '不應再有接收人確認接受方法');
    const o = mkOrder(H, { site: 'D9', destSite: 'D3' });
    H.ModuleB.approve(o); H.ModuleB.dispatch('V-T02', 'greedy');
    eq(o.status, 'loaded', '派車後為 loaded');
    H.ModuleB.confirmDelivery(o, '調度室');
    eq(o.status, 'delivered', 'loaded 應可直接進入 delivered');
  });

  test('B-2 無 leg 欄位：方向由 pickSite/dropSite 相對順序推導', () => {
    const H = fresh();
    const south = H.ModuleB.createOrder({ applicant: 'A', site: 'D9', destSite: 'D3', direct: false, volume: 100, handleMin: 5 });
    const north = H.ModuleB.createOrder({ applicant: 'B', site: 'D3', destSite: 'D9', direct: false, volume: 100, handleMin: 5 });
    eq(south.leg, undefined, '不應保存 leg 欄位');
    ok(H.ModuleB.isSouthbound(south), '迄點較南 → 南下');
    ok(!H.ModuleB.isSouthbound(north), '迄點較北 → 北上');
  });

  test('B-3 時間上限依天數對照表動態決定（非固定 3 天）', () => {
    const H = fresh();
    // D9 停靠 1 天 → 1×480；D3 停靠 3 天 → 3×480
    eq(H.ModuleB.timeLimitFor('D9', false), 1 * H.DB.workdayMin, 'D9 非直達 1 天');
    eq(H.ModuleB.timeLimitFor('D3', false), 3 * H.DB.workdayMin, 'D3 非直達 3 天');
    eq(H.ModuleB.timeLimitFor('D3', true), 2 * H.DB.workdayMin, 'D3 直達查直達表 2 天');
    // 查無終點 → 全域最大天數保險
    eq(H.ModuleB.timeLimitFor('D7', false), H.DB.maxTripDays * H.DB.workdayMin, '查無 → 全域上限');
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

  test('G52 預估完成超過工時 20:30 → 待人工協調（不強派超時）', () => {
    const H = fresh();
    // 台北→台中 車程 130+15 緩衝=145 分；回程上車 18:30 → 完成 20:55 > 20:30
    const a = round(H, { earliestReturn: '18:30' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'coordinate', '超工時應待人工協調（G52）');
    ok(/工時/.test(a.note || ''), '原因需標示工時');
  });

  test('G53 已媒合單不被下一次批次重排', () => {
    const H = fresh();
    const a = round(H); H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    const g1 = a.groupId, v1 = a.vehicle; ok(a.status === 'matched', '首批應媒合');
    H.ModuleC.runBatch(D); // 再按一次
    eq(a.groupId, g1, '已成功單不得被重排（G53）'); eq(a.vehicle, v1);
  });

  test('G57 逾期作廢：作廢並保留紀錄、不轉待人工協調', () => {
    const H = fresh();
    const a = round(H); H.ModuleC.approve(a);
    const res = H.ModuleC.voidOverdue(a);
    eq(a.status, 'void'); ok(res.kept, '紀錄需保留供統計'); ok(res.notified, '需通知申請人');
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
    eq(H.ModuleC.deadheadMin(away, a), 4 * H.DB.legMinutes, 'D6→D10 相隔 4 段');
  });

  test('C-2 歸屬據點 homeSite 與當前位置分離；行程完成後回歸屬據點', () => {
    const H = fresh();
    H.DB.vehicles.filter(v => v.pool === 'BIZ').forEach(v => ok(v.homeSite, '車輛應有 homeSite'));
    H.DB.drivers.filter(d => d.pool === 'BIZ').forEach(d => ok(d.homeSite, '司機應有 homeSite'));
    const a = round(H); H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'matched');
    const v = H.DB.vehicles.find(x => x.id === a.vehicle);
    v.currentSite = 'D1'; // 模擬外派中
    H.ModuleC.confirmBoard(a); H.ModuleC.completeTrip(a, '調度室');
    eq(v.currentSite, v.homeSite, '行程完成後當前位置應回復歸屬據點');
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

  test('C-3 強制回程仍納入工時檢核（超時轉待人工協調）', () => {
    const H = fresh();
    const D2 = new Date(new Date(D).getTime() + 86400000).toISOString().slice(0, 10);
    // 回程 19:30 出發 + 台中→台北 130+15 分 → 遠超 20:30
    const a = H.ModuleC.createApp({ type: 'round', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '09:00', returnDate: D2, earliestReturn: '19:30', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'coordinate', '含強制回程超過工時應轉待人工協調');
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

  test('C-4 待人工協調單可由調度室直接手動指派（不退回員工重申請）', () => {
    const H = fresh();
    const a = H.ModuleC.createApp({ type: 'oneway', origin: '台北總部', dest: '台中辦公室',
      departDate: D, earliestPickup: '08:00', returnDate: D, earliestReturn: '', pax: 2,
      applicant: 'X', dept: 'D', ext: '1' });
    H.ModuleC.approve(a); H.ModuleC.runBatch(D);
    eq(a.status, 'coordinate', '目的地非轉運點 → 待人工協調');
    H.ModuleC.overrideAssign(a, { vehicle: 'V-B01', driver: 'DR3' }, '調度室');
    eq(a.status, 'matched', '手動指派後應成為已媒合');
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
