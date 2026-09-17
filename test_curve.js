/* 难度曲线检查。
   用法：node test_curve.js
   四组对照：
     A 不升级     —— 检验纯操作能推多远（应当在中期崩掉，证明商店必需）
     B 满配置     —— 检验后期上限（应当仍有 ★★★ 空间，但不再碾压）
     C 真实结算   —— 走游戏内 awardCoins 结算，检验星级分布与经济闭合
     D 拟人 AI    —— 决策节流 + 漏操作，这才是人类玩家的真实难度读数 */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

function makeEl() {
  return {
    className: '', innerHTML: '', textContent: '', value: '', dataset: {}, children: [], style: {},
    classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; }
  };
}
const nodes = {};
const sandbox = {};
sandbox.document = {
  getElementById: id => nodes[id] || (nodes[id] = makeEl()),
  createElement: makeEl, querySelectorAll: () => [], addEventListener() {}
};
const store = {};
sandbox.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] };
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 0;
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout; sandbox.console = console;
sandbox.Blob = function () {}; sandbox.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__API={R:R,getS:()=>S,setS:v=>{S=v;},BALANCE,DISHES,startLevel,cook,onSeatClick,step,remainingOf,levelPlan,levelCapacity:(lv)=>{const p=levelPlan(lv);return capacityOf(lv,p.duration,p.spawnGap,p.maxItems);},upgradeCost,starsFor,awardCoins};', sandbox, { filename: 'game.js' });
const A = sandbox.__API;

function freshSave(over) {
  return Object.assign({
    coins: 0, level: 1, stars: {}, unlocked: ['dj', 'cd', 'yt'],
    stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0
  }, over || {});
}

/* 完美 AI：每帧决策，优先补最缺的菜，按耐心升序上菜 */
function playPerfect() {
  const R = A.R;
  let f = 0;
  while (R.running && f < 60 * 300) {
    f++;
    A.step(1 / 60);
    if (!R.running) break;
    const need = [];
    R.seats.forEach(c => { if (c) A.remainingOf(c).forEach(id => { if (!need.includes(id)) need.push(id); }); });
    const pending = R.tray.concat(R.stations.filter(s => s.busy).map(s => s.dish));
    if (need.length) {
      const free = R.stations.findIndex(s => !s.busy);
      if (free >= 0) {
        const want = need.find(id => pending.filter(x => x === id).length < need.filter(x => x === id).length);
        if (want) { A.cook(want); pending.push(want); }
      }
    }
    R.seats.map((c, i) => (c ? { i, p: c.patience } : null)).filter(Boolean).sort((a, b) => a.p - b.p)
      .forEach(s => {
        const c = R.seats[s.i];
        if (c && R.tray.some(id => A.remainingOf(c).includes(id))) A.onSeatClick(s.i);
      });
  }
  return f / 60;
}

/* 拟人 AI：每 interval 秒才决策一次（模拟反应时间），且每次决策有 miss 概率漏掉动作 */
function playHuman(interval, miss) {
  const R = A.R;
  let f = 0, sinceDecision = 999;
  while (R.running && f < 60 * 300) {
    f++;
    A.step(1 / 60);
    if (!R.running) break;
    sinceDecision += 1 / 60;
    if (sinceDecision < interval) continue;
    sinceDecision = 0;

    // 上菜：反应最快，但可能看漏一位客人
    R.seats.map((c, i) => (c ? { i, p: c.patience } : null)).filter(Boolean).sort((a, b) => a.p - b.p)
      .forEach((s, k) => {
        if (k === 0 && Math.random() < miss * 0.6) return;   // 最急的那位偶尔被忽略
        const c = R.seats[s.i];
        if (c && R.tray.some(id => A.remainingOf(c).includes(id))) A.onSeatClick(s.i);
      });

    // 下锅：偶尔忘记补菜
    if (Math.random() < miss) continue;
    const need = [];
    R.seats.forEach(c => { if (c) A.remainingOf(c).forEach(id => { if (!need.includes(id)) need.push(id); }); });
    if (!need.length) continue;
    const pending = R.tray.concat(R.stations.filter(s => s.busy).map(s => s.dish));
    const free = R.stations.findIndex(s => !s.busy);
    if (free < 0) continue;
    const want = need.find(id => pending.filter(x => x === id).length < need.filter(x => x === id).length);
    if (want) A.cook(want);
  }
  return f / 60;
}

function measure(lv, play) {
  A.startLevel(lv);
  play();
  const R = A.R;
  const b = A.BALANCE;
  const st = A.starsFor(R.earned, R.target);
  const cap = Math.round(A.levelCapacity(lv));
  return { lv, earned: R.earned, target: R.target, cap, eff: cap ? R.earned / cap : 0, served: R.served, lost: R.lost, stars: st };
}

function row(r) {
  return String(r.lv).padStart(4)
    + '  ' + String(r.earned + '/' + r.target).padEnd(12)
    + String(Math.round(r.eff * 100) + '%').padStart(5)
    + String(r.cap).padStart(7)
    + String(r.served).padStart(6) + String(r.lost).padStart(5)
    + '   ' + '★'.repeat(r.stars) + '·'.repeat(3 - r.stars);
}
const HEAD = '  关   营收/目标    效率   天花板  满意 流失  星级';
function section(t) { console.log('\n' + t); console.log(HEAD); }

/* ---- A 不升级 ---- */
section('【A 不升级 · 完美操作】3 道菜 / 2 灶台 / 3 托盘 / 速度 Lv1');
A.setS(freshSave());
for (let lv = 1; lv <= 10; lv++) console.log(row(measure(lv, playPerfect)));

/* ---- B 满配置 ---- */
section('【B 满配置 · 完美操作】8 道菜 / 4 灶台 / 4 托盘 / 速度 Lv4');
for (let lv = 1; lv <= 20; lv += 2) {
  A.setS(freshSave({ stations: 4, trayMax: 4, speedLv: 4, unlocked: A.DISHES.map(d => d.id) }));
  console.log(row(measure(lv, playPerfect)));
}

/* ---- C 拟人 AI（真实难度读数）---- */
section('【C 拟人玩家】完美操作 → 0.4s 反应 + 20% 漏操作');
A.setS(freshSave());
for (let lv = 1; lv <= 10; lv++) console.log(row(measure(lv, () => playHuman(0.4, 0.20))));

/* ---- D 真实结算路径：边赚边买 ----
   注意：金币由游戏内 endLevel → awardCoins 结算，测试不要重复发放。 */
section('【D 边赚边买 · 真实结算】0.3s 反应 + 12% 漏操作，每关按性价比采购');
A.setS(freshSave());
let spent = 0, income = 0;
for (let lv = 1; lv <= 20; lv++) {
  const before = A.getS().coins;
  const r = measure(lv, () => playHuman(0.3, 0.12));
  const S = A.getS();
  const net = S.coins - before;          // 由 endLevel 实际入账
  income += net;
  const c = A.upgradeCost();
  const dish = A.DISHES.filter(d => !S.unlocked.includes(d.id) && d.unlockLv <= lv + 1)
    .sort((x, y) => x.cost - y.cost).find(d => d.cost <= S.coins);
  if (dish) { S.coins -= dish.cost; spent += dish.cost; S.unlocked.push(dish.id); }
  else if (c.station !== null && c.station <= S.coins) { S.coins -= c.station; spent += c.station; S.stations++; }
  else if (c.tray !== null && c.tray <= S.coins) { S.coins -= c.tray; spent += c.tray; S.trayMax++; }
  else if (c.speed !== null && c.speed <= S.coins) { S.coins -= c.speed; spent += c.speed; S.speedLv++; }
  console.log(row(r) + '   入账 +' + net + ' / 结余 ' + S.coins);
}
const F = A.getS();
console.log('\n累计入账 ' + income + ' 元，采购支出 ' + spent + ' 元，终局结余 ' + F.coins + ' 元');
console.log('终局配置：' + F.unlocked.length + ' 道菜 / ' + F.stations + ' 灶台 / ' + F.trayMax + ' 托盘 / 速度 Lv' + F.speedLv);
console.log('全部升级满配所需总价 ' + (A.DISHES.reduce((a, d) => a + d.cost, 0) + A.BALANCE.stationCost[0] + A.BALANCE.stationCost[1] + A.BALANCE.trayCost + A.BALANCE.speedCost.reduce((a, x) => a + x, 0)) + ' 元');
