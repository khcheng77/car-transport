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
group('模組 A 區域內物流（G10–G20 / T2-3〜T2-5）', () => {
  function mkApp(H, over) {
    return H.ModuleA.createApp(Object.assign({
      applicant: '業務部-周雅婷', station: 'S3', building: '一號月台',
      items: [item({ l: 60, w: 60, h: 60 })], recvMode: 'asap', handleMin: 15,
    }, over));
  }

  test('G16 同站多單依審核通過時間累計時間額度，超額者跳過並順延下一班', () => {
    const H = fresh();
    const a1 = mkApp(H), a2 = mkApp(H), a3 = mkApp(H); // 各 15 分，額度 40
    [a1, a2, a3].forEach(a => H.ModuleA.approve(a));
    eq([a1.approvedAt, a2.approvedAt, a3.approvedAt].join(','), '1,2,3', 'approvedAt 應遞增');
    H.ModuleA.match(a1); H.ModuleA.match(a2); H.ModuleA.match(a3);
    eq(a1.assignedShift, 'R-A1'); eq(a2.assignedShift, 'R-A1');
    eq(a3.assignedShift, 'R-A2', '第三單 45>40 應順延下一班（G16/G17）');
  });

  test('G11/G12 當日最後一班仍裝不下 → 不留候補、提示改期', () => {
    const H = fresh();
    // 造一件維度大到任何班次車輛皆放不下（六方向皆不過）
    const big = mkApp(H, { items: [item({ name: '巨件', l: 999, w: 999, h: 999 })] });
    H.ModuleA.approve(big);
    const r = H.ModuleA.match(big);
    ok(!r.ok, '應失敗');
    eq(r.reason, 'full', '最後一班仍裝不下 → full');
    ok(/請明天請早再試|改期/.test(r.msg), '訊息需提示改期，不寫候補');
    eq(big.assignedShift, null, '失敗不得寫入班次（不留候補 G12）');
  });

  test('G19 越快越好：選最早出發班次', () => {
    const H = fresh();
    const a = mkApp(H, { recvMode: 'asap' });
    H.ModuleA.approve(a);
    const r = H.ModuleA.match(a);
    ok(r.ok, '應排入'); eq(r.shift.id, 'R-A1', 'asap 應排最早班次 R-A1（08:30）');
  });

  test('G19 指定期望時間：選到站時間差最小的班次（早晚都比）', () => {
    const H = fresh();
    // 期望非常晚 → 應偏好最末班 R-A3（16:30 出發，到站最晚）
    const a = mkApp(H, { recvMode: 'exact', expectTime: '20:00' });
    H.ModuleA.approve(a);
    const r = H.ModuleA.match(a);
    ok(r.ok); eq(r.shift.id, 'R-A3', '期望 20:00 應選最接近的末班');
  });
});

/* =================================================================
   模組 B：南北幹線（G30–G44）
   ================================================================= */
group('模組 B 南北幹線（G30–G44 / T4-2〜T4-5）', () => {
  function mkOrder(H, over) {
    return H.ModuleB.createOrder(Object.assign({
      applicant: 'X', leg: 'outbound', site: 'D3', direct: false,
      volume: 3000, category: 'BOX', weight: 300, handleMin: 30,
    }, over));
  }

  test('G01/G03 幹線容量套用共用浪費係數（A/B 共用，非繞過）', () => {
    const H = fresh();
    const o = mkOrder(H, { volume: 1000, category: 'IRREG' }); // 1.65
    approx(H.ModuleB.effVolume(o), 1650, 1, '1000L × 1.65 = 1650L');
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
    const d1 = mkOrder(H, { site: 'D2', direct: true, volume: 15000, weight: 1000 });
    const d2 = mkOrder(H, { site: 'D2', direct: true, volume: 15000, weight: 1000 }); // V-T01 容量 34560L，兩張=33000 尚可
    const d3 = mkOrder(H, { site: 'D2', direct: true, volume: 15000, weight: 1000 }); // 第三張超量
    const other = mkOrder(H, { site: 'D3', direct: true, volume: 1000 }); // 不同目的地，不同車
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
    const rd = H.ModuleB.createOrder({ applicant: 'A', leg: 'return', site: 'D3', direct: true, volume: 2000, weight: 200, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'B', leg: 'return', site: 'D6', direct: false, volume: 2000, weight: 200, handleMin: 20 });
    [rd, rn].forEach(o => H.ModuleB.approve(o));
    const r = H.ModuleB.dispatchReturn('V-T02', 'D3', false, 500);
    eq(r.matrixRow, 4, '應為矩陣第 4 列（回程・被迫鎖定直達）');
    eq(r.endpoint, 'D10', '回程終點仍為出發據點（G41/G36）');
    ok(r.carried.some(o => o.id === rd.id), '撞期直達回程單應載入');
    ok(r.deferred.some(o => o.id === rn.id), '被排擠非直達單應自動順延（G42）');
  });

  test('G40 回程無撞期直達 → 動態淨值沿路收送（矩陣第 3 列）', () => {
    const H = fresh();
    const rn = H.ModuleB.createOrder({ applicant: 'B', leg: 'return', site: 'D6', direct: false, volume: 2000, weight: 200, handleMin: 20 });
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
    const g = H.ModuleB.createOrder({ applicant: 'A', leg: 'outbound', site: 'D6', direct: false, volume: 2000, category: 'BOX', weight: 300, handleMin: 30 });
    const d = H.ModuleB.createOrder({ applicant: 'B', leg: 'outbound', site: 'D3', direct: true, volume: 2000, category: 'BOX', weight: 300, handleMin: 20 });
    const rn = H.ModuleB.createOrder({ applicant: 'C', leg: 'return', site: 'D6', direct: false, volume: 1000, category: 'BOX', weight: 200, handleMin: 20 });
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
    const a = H.ModuleB.createOrder({ applicant: 'A', leg: 'outbound', site: 'D6', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    const b = H.ModuleB.createOrder({ applicant: 'B', leg: 'outbound', site: 'D6', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    const c = H.ModuleB.createOrder({ applicant: 'C', leg: 'outbound', site: 'D3', direct: false, volume: 1000, category: 'BOX', weight: 100, handleMin: 20 });
    [a, b, c].forEach(o => H.ModuleB.approve(o));
    H.ModuleB.dispatch('V-T02', 'greedy');
    eq(a.pickupTime, b.pickupTime, '同一收貨據點、同車 → 來收時間應相同');
    ok(c.pickupTime !== a.pickupTime, '較南邊的據點 → 來收時間應較晚（不同）');
    ok(H.hhmmToMin(c.pickupTime) > H.hhmmToMin(a.pickupTime), 'D3 比 D6 南 → 來收時間應更晚');
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
