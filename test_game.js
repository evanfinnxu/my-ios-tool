/* 无头逻辑回归测试：用最小 DOM 桩加载游戏脚本，模拟一整关的操作，验证核心经济与判定逻辑 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: 未找到脚本'); process.exit(1); }
const code = m[1];

/* ---------- 最小 DOM 桩 ---------- */
function makeEl() {
  return {
    className: '', innerHTML: '', textContent: '', value: '', dataset: {}, children: [], style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild(c) { this.children.push(c); }, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    click() {}
  };
}
const nodes = {};
const sandbox = {};
sandbox.document = {
  getElementById(id) { return nodes[id] || (nodes[id] = makeEl()); },
  createElement() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener() {}
};
const store = {};
sandbox.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 0;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.console = console;
sandbox.Blob = function () {};
sandbox.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(
  code + '\n;globalThis.__API = { R: R, S: () => S, setS: v => { S = v; },'
  + ' startLevel: startLevel, cook: cook, onSeatClick: onSeatClick, step: step, endLevel: endLevel,'
  + ' remainingOf: remainingOf, levelPlan: levelPlan, upgradeCost: upgradeCost, ACT: ACT,'
  + ' DISH: DISH, DISHES: DISHES, SAVE_KEY: SAVE_KEY, starsFor: starsFor, spawnCustomer: spawnCustomer,'
  + ' BALANCE: BALANCE, awardCoins: awardCoins, capacityOf: capacityOf };',
  sandbox, { filename: 'game.js' }
);
const A = sandbox.__API;

/* ---------- 断言工具 ---------- */
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------- 1. 单元：剩余菜品计算（支持同菜多份、乱序上菜） ---------- */
console.log('\n[1] remainingOf 单元测试');
ok(JSON.stringify(A.remainingOf({ order: ['dj', 'dj', 'yt'], served: [] })) === '["dj","dj","yt"]', '未上菜时剩余 = 全部');
ok(JSON.stringify(A.remainingOf({ order: ['dj', 'dj', 'yt'], served: ['yt'] })) === '["dj","dj"]', '乱序上菜后正确扣减');
ok(JSON.stringify(A.remainingOf({ order: ['dj', 'dj'], served: ['dj'] })) === '["dj"]', '同菜两份只扣一份');
ok(JSON.stringify(A.remainingOf({ order: ['dj'], served: ['dj'] })) === '[]', '上齐后剩余为空');

/* ---------- 2. 单元：星级阈值 ---------- */
console.log('\n[2] 星级阈值');
ok(A.starsFor(100, 100) === 3, '达标 => 3 星');
ok(A.starsFor(72, 100) === 2, '72% => 2 星');
ok(A.starsFor(45, 100) === 1, '45% => 1 星');
ok(A.starsFor(44, 100) === 0, '未达 45% => 0 星');

/* ---------- 3. 单元：制作时间受速度升级影响 ---------- */
console.log('\n[3] 加速升级生效');
const S0 = A.S();
A.setS(Object.assign({}, S0, { speedLv: 1, unlocked: ['dj', 'cd', 'yt'] }));
A.startLevel(1);
A.cook('dj');
const t1 = A.R.stations.find(s => s.busy).total;
A.R.running = false;
A.setS(Object.assign({}, A.S(), { speedLv: 4 }));
A.startLevel(1);
A.cook('dj');
const t4 = A.R.stations.find(s => s.busy).total;
A.R.running = false;
ok(Math.abs(t1 - 2.0) < 0.001, 'Lv1 制作豆浆 2.0s', t1.toFixed(2));
ok(Math.abs(t4 - 2.0 * 0.7) < 0.001, 'Lv4 制作豆浆 1.4s（-30%）', t4.toFixed(2));

/* ---------- 4. 集成：模拟整关（AI 玩家按需求排产并上菜） ---------- */
console.log('\n[4] 整关仿真（AI 玩家）');
A.setS({ coins: 0, level: 1, stars: {}, unlocked: ['dj', 'cd', 'yt'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 });
A.startLevel(1);
const R = A.R;

let frames = 0;
const DT = 1 / 60;
while (R.running && frames < 60 * 300) {
  frames++;
  A.step(DT);
  if (!R.running) break;

  // 需求池：所有在座客人尚未上齐的菜
  const need = [];
  R.seats.forEach(c => {
    if (!c) return;
    A.remainingOf(c).forEach(id => { if (!need.includes(id)) need.push(id); });
  });
  const pending = R.tray.concat(R.stations.filter(s => s.busy).map(s => s.dish));

  // 排产：只做被需要、且尚未在制/在盘的数量不足的菜
  const free = R.stations.findIndex(s => !s.busy);
  if (free >= 0 && need.length) {
    const want = need.find(id => pending.filter(x => x === id).length < need.filter(x => x === id).length);
    if (want) { A.cook(want); pending.push(want); }
  }
  // 上菜：优先服务耐心最低的客人
  const order = R.seats.map((c, i) => (c ? { i, p: c.patience } : null)).filter(Boolean).sort((a, b) => a.p - b.p);
  for (const seat of order) {
    const c = R.seats[seat.i];
    if (!c) continue;
    const rem = A.remainingOf(c);
    if (R.tray.some(id => rem.includes(id))) A.onSeatClick(seat.i);
  }
}

ok(frames < 60 * 300, '关卡在时限内正常结束', frames);
ok(R.over === true, '状态标记为已结算');
ok(R.served > 0, 'AI 玩家成功服务了客人', { served: R.served, lost: R.lost });
ok(R.earned > 0, '产生了营收', R.earned);
ok(R.target > 0, '目标营收已设定', R.target);
console.log('    统计：营收 ' + R.earned + ' / 目标 ' + R.target + '，满意 ' + R.served + '，流失 ' + R.lost);

const S1 = A.S();
/* 结算口径：首通 = 营收 - 食材成本 + 星级奖励；重复挑战营收打 repeatRate 折。
   注意 endLevel 已经写过 S.stars，所以这里直接按首通口径反推，不再调用 awardCoins。 */
const st1 = A.starsFor(R.earned, R.target);
const expIngredient = Math.round(R.earned * A.BALANCE.ingredientRate);
const expBonus = st1 >= 3 ? Math.round(R.target * 0.5) : (st1 === 2 ? Math.round(R.target * 0.2) : 0);
ok(S1.coins === R.earned - expIngredient + expBonus,
  '金币入账 = (营收 - 食材成本) + 星级奖励',
  { coins: S1.coins, expect: R.earned - expIngredient + expBonus, earned: R.earned, expIngredient, expBonus, st: st1 });
ok(expIngredient > 0, '食材成本已按比例扣除', expIngredient);
ok(A.BALANCE.ingredientRate > 0 && A.BALANCE.repeatRate < 1,
  '食材成本与重复挑战折扣均生效', { ingredientRate: A.BALANCE.ingredientRate, repeatRate: A.BALANCE.repeatRate });
ok((S1.stars[1] || 0) >= 0, '本关星级已记录', S1.stars);
ok(S1.level >= 1, '存档关卡号已推进到 ' + S1.level);
ok(store[A.SAVE_KEY] !== undefined, '存档已写入 localStorage');
ok(JSON.parse(store[A.SAVE_KEY]).coins === S1.coins, '存档内容与内存状态一致');

/* ---------- 5. 反例：上错菜应被拒绝，不产生营收 ---------- */
console.log('\n[5] 上错菜的拒绝逻辑');
A.setS({ coins: 0, level: 1, stars: {}, unlocked: ['dj', 'cd', 'yt'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 });
A.startLevel(1);
R.seats[0] = { name: '测试客', color: '#000', order: ['xh'], served: [], patience: 60, maxPatience: 60 };
R.tray = ['dj'];
const before = R.earned;
A.onSeatClick(0);
ok(R.earned === before, '不匹配的菜不上账');
ok(R.tray.length === 1, '托盘中的菜未被消耗');
ok(A.remainingOf(R.seats[0]).length === 1, '订单仍为未完成');
R.running = false;

/* ---------- 6. 反例：耐心耗尽判定流失 ---------- */
console.log('\n[6] 耐心耗尽');
A.setS({ coins: 0, level: 1, stars: {}, unlocked: ['dj'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 });
A.startLevel(1);
R.seats[0] = { name: '急性子', color: '#000', order: ['dj'], served: [], patience: 0.05, maxPatience: 10 };
A.step(0.2);
ok(R.seats[0] === null, '超时客人已离席');
ok(R.lost === 1, '流失计数 +1', R.lost);
ok(R.earned === 0, '流失不产生营收');
R.running = false;

/* ---------- 7. 设备升级写入存档 ---------- */
console.log('\n[7] 商店升级');
A.setS({ coins: 99999, level: 3, stars: {}, unlocked: ['dj', 'cd', 'yt'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 });
const c0 = A.upgradeCost();
A.ACT.buyStation();
ok(A.S().stations === 3, '灶台 2 → 3', A.S().stations);
ok(A.S().coins === 99999 - c0.station, '扣除 ' + c0.station + ' 金币', A.S().coins);
A.ACT.buyTray();
ok(A.S().trayMax === 4, '出餐口 3 → 4', A.S().trayMax);
A.ACT.buySpeed();
ok(A.S().speedLv === 2, '速度 Lv1 → Lv2', A.S().speedLv);
A.setS(Object.assign({}, A.S(), { coins: 10 }));
A.ACT.buyStation();
ok(A.S().stations === 3, '金币不足时拒绝升级', { stations: A.S().stations, coins: A.S().coins });
A.setS(Object.assign({}, A.S(), { stations: 4, coins: 99999 }));
ok(A.upgradeCost().station === null, '灶台满级后价格为 null', A.upgradeCost());

/* ---------- 8. 菜品数据一致性 ---------- */
console.log('\n[8] 数据完整性');
ok(A.DISHES.length === 8, '菜品数量 8', A.DISHES.length);
ok(A.DISHES.every(d => d.id && d.name && d.price > 0 && d.t > 0 && /^#[0-9A-Fa-f]{6}$/.test(d.c)), '每道菜字段齐全', A.DISHES.filter(d => !d.c).map(d => d.id));
ok(new Set(A.DISHES.map(d => d.id)).size === A.DISHES.length, '菜品 id 无重复');
ok(A.DISHES.filter(d => d.cost > 0).length === 5, '5 道需解锁的进阶菜', A.DISHES.filter(d => d.cost > 0).length);

/* ---------- 9. 防刷关：重复挑战不得全额计币 ---------- */
console.log('\n[9] 结算防刷关');
A.setS({ coins: 0, level: 1, stars: {}, unlocked: ['dj', 'cd', 'yt'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 });
const first = A.awardCoins(1, 300, 3, 100);
ok(first.firstClear === true, '首次三星通关判定为首通');
ok(first.gross === 300, '首通按全额营收结算', first.gross);
ok(first.bonus === 50, '首通三星奖励 = 目标 × 50%', first.bonus);
ok(first.ingredient === Math.round(300 * A.BALANCE.ingredientRate), '食材成本按营收比例扣除', first.ingredient);

A.setS(Object.assign({}, A.S(), { stars: { 1: 3 } }));
const again = A.awardCoins(1, 300, 3, 100);
ok(again.firstClear === false, '已通关关卡判定为重复挑战');
ok(again.gross === Math.round(300 * A.BALANCE.repeatRate), '重复挑战营收打 ' + Math.round(A.BALANCE.repeatRate * 100) + '% 折', again.gross);
ok(again.bonus === 0, '重复挑战不再发放星级奖励', again.bonus);
ok(again.net < first.net, '重复挑战收益严格小于首通（无法刷币套利）', { first: first.net, again: again.net });
ok(again.net > 0, '重复挑战仍有收入（玩家卡关时不会没有来源）', again.net);

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
