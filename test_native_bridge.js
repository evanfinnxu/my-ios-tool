/* 原生桥接测试：在 Node 里模拟 iOS 宿主的 WKScriptMessageHandler，
   验证游戏在「有原生通道」与「无原生通道」两种环境下的存档行为。
   这是没有真机时唯一能验证 iOS 存档路径的手段。
   用法：node test_native_bridge.js                                              */
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(__dirname + '/index.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  cond ? pass++ : fail++;
}

/* 构建一个沙箱。native=true 时注入 window.webkit.messageHandlers.zaocan */
function boot({ native, injectedSave, storedSave }) {
  const posted = [];
  const store = {};
  if (storedSave !== undefined) store['xiangkou_zaocan_save_v1'] = storedSave;

  function makeEl() {
    const el = {
      className: '', innerHTML: '', textContent: '', value: '', dataset: {}, children: [], style: {},
      classList: { add() { }, remove() { }, contains() { return false; } },
      addEventListener() { }, appendChild() { }, remove() { },
      setAttribute() { }, getAttribute() { return null; }, closest() { return null; }
    };
    return el;
  }
  const nodes = {};
  const sb = {};
  sb.document = {
    getElementById: id => nodes[id] || (nodes[id] = makeEl()),
    createElement: makeEl, querySelectorAll: () => [],
    addEventListener() { }, hidden: false
  };
  sb.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  sb.performance = { now: () => Date.now() };
  sb.requestAnimationFrame = () => 0;
  sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout; sb.console = console;
  sb.Blob = function () { }; sb.URL = { createObjectURL: () => '', revokeObjectURL: () => { } };
  sb.globalThis = sb;
  sb.location = { protocol: 'file:' };
  if (native) {
    sb.navigator = { serviceWorker: undefined };
    sb.window = sb;
    sb.__ZAOCAN_SAVE__ = injectedSave;
    sb.webkit = { messageHandlers: { zaocan: { postMessage: m => posted.push(m) } } };
  }
  vm.createContext(sb);
  vm.runInContext(code + '\n;globalThis.__API={getS:()=>S,setS:v=>{S=v;},save,load,resetSave,storageWrite,storageRead,BRIDGE};', sb, { filename: 'game.js' });
  return { sb, api: sb.__API, posted, store };
}

/* ---------- 1. 无原生通道：走 localStorage ---------- */
console.log('\n[1] 浏览器环境（无原生通道）');
{
  const { api, store } = boot({ native: false });
  ok(api.BRIDGE === null, 'BRIDGE 为空，判定为浏览器环境');
  api.setS(Object.assign({}, api.getS(), { coins: 777, level: 5 }));
  api.save();
  const raw = store['xiangkou_zaocan_save_v1'];
  ok(!!raw, '存档已写入 localStorage');
  ok(raw && JSON.parse(raw).coins === 777, 'localStorage 内容正确', raw && JSON.parse(raw).coins);
  ok(raw && raw.indexOf('\n') === -1, 'localStorage 存的是紧凑 JSON（不含换行）');
}
{
  const { api } = boot({ native: false, storedSave: JSON.stringify({ coins: 321, level: 9 }) });
  ok(api.getS().coins === 321, '能从 localStorage 恢复存档', api.getS().coins);
  ok(api.getS().level === 9, '关卡号一并恢复', api.getS().level);
  ok(api.getS().stations === 2, '旧存档缺失字段由 DEFAULT_SAVE 补齐', api.getS().stations);
}

/* ---------- 2. 有原生通道：走宿主 App ---------- */
console.log('\n[2] iOS 环境（有原生通道）');
{
  const { api, posted, store } = boot({
    native: true,
    injectedSave: JSON.stringify({ coins: 1234, level: 12, stars: { 1: 3 }, unlocked: ['dj', 'cd', 'yt', 'xl'] })
  });
  ok(api.BRIDGE !== null, 'BRIDGE 已接管存储');
  ok(api.getS().coins === 1234, '从宿主注入的 __ZAOCAN_SAVE__ 恢复存档', api.getS().coins);
  ok(api.getS().level === 12, '关卡号一并恢复', api.getS().level);
  ok(api.getS().unlocked.length === 4, '菜单解锁状态一并恢复', api.getS().unlocked.length);

  api.setS(Object.assign({}, api.getS(), { coins: 5555 }));
  api.save();
  ok(posted.length === 1, '保存动作投递到原生通道', posted.length);
  ok(posted[0] && posted[0].cmd === 'save', '消息类型为 save', posted[0] && posted[0].cmd);
  ok(posted[0] && JSON.parse(posted[0].data).coins === 5555, '投递的数据正确', posted[0] && JSON.parse(posted[0].data).coins);
  ok(Object.keys(store).length === 0, '原生模式下不写 localStorage（避免双份真相）', Object.keys(store));
}

/* ---------- 3. 无存档注入：应使用默认存档 ---------- */
console.log('\n[3] 首次启动（宿主无存档）');
{
  const { api } = boot({ native: true, injectedSave: null });
  ok(api.getS().coins === 0, '金币从 0 开始', api.getS().coins);
  ok(api.getS().level === 1, '从第 1 关开始', api.getS().level);
  ok(api.getS().stations === 2 && api.getS().trayMax === 3 && api.getS().speedLv === 1,
    '初始设备配置正确', [api.getS().stations, api.getS().trayMax, api.getS().speedLv]);
  ok(api.getS().unlocked.join(',') === 'dj,cd,yt', '初始只解锁 3 道菜', api.getS().unlocked);
}

/* ---------- 4. 损坏存档不应崩溃 ---------- */
console.log('\n[4] 存档损坏时的健壮性');
{
  const { api } = boot({ native: true, injectedSave: '{这不是合法 JSON' });
  ok(api.getS().coins === 0 && api.getS().level === 1, '损坏存档回退为默认值而非崩溃',
    { coins: api.getS().coins, level: api.getS().level });
}
{
  const { api } = boot({ native: false, storedSave: 'null' });
  ok(typeof api.getS().level === 'number', 'localStorage 存 "null" 时不崩溃', api.getS().level);
}

/* ---------- 5. 重置 ---------- */
console.log('\n[5] 清空存档');
{
  const { api, posted } = boot({ native: true, injectedSave: JSON.stringify({ coins: 999, level: 20 }) });
  api.resetSave();
  ok(api.getS().coins === 0 && api.getS().level === 1, '重置为默认值', { coins: api.getS().coins, level: api.getS().level });
  ok(posted.length === 1 && JSON.parse(posted[0].data).coins === 0, '重置结果已持久化', posted.length);
}

/* ---------- 6. 两条路径一致性 ---------- */
console.log('\n[6] 双路径行为一致性');
{
  const payload = { coins: 4321, level: 7, stars: { 1: 3, 2: 2 }, unlocked: ['dj', 'cd', 'yt', 'xl', 'jb'],
    stations: 3, trayMax: 4, speedLv: 2, earnedTotal: 100, servedTotal: 20, lostTotal: 1 };
  const a = boot({ native: false, storedSave: JSON.stringify(payload) });
  const b = boot({ native: true, injectedSave: JSON.stringify(payload) });
  const ka = JSON.stringify(a.api.getS());
  const kb = JSON.stringify(b.api.getS());
  ok(ka === kb, '同一份存档在两种环境下解析结果完全一致');
  a.api.setS(Object.assign({}, a.api.getS(), { coins: 1 }));
  b.api.setS(Object.assign({}, b.api.getS(), { coins: 1 }));
  ok(JSON.stringify(a.api.getS()) === JSON.stringify(b.api.getS()), '两侧状态迁移后仍一致');
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
