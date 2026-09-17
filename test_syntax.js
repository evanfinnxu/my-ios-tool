/* 语法与结构校验：抽取 <script> 交给 node --check，并核对关键定义是否齐全 */
const fs = require('fs'), cp = require('child_process');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('未找到 <script> 块'); process.exit(1); }
fs.writeFileSync(__dirname + '/_check.js', m[1], 'utf8');

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fail++;
}

console.log('[1] 脚本块规模');
check('HTML 字符数 > 20000', html.length > 20000, html.length);
check('脚本字符数 > 8000', m[1].length > 8000, m[1].length);

console.log('\n[2] node --check 语法');
try {
  cp.execFileSync(process.execPath, ['--check', __dirname + '/_check.js'], { stdio: 'pipe' });
  check('脚本语法通过', true);
} catch (e) {
  check('脚本语法通过', false, String(e.stderr || e).slice(0, 600));
}

console.log('\n[3] 关键定义齐全（防止改名后漏改）');
const need = ['BALANCE', 'expectedItems', 'refPrice', 'capacityOf', 'targetFor', 'levelPlan',
  'awardCoins', 'endLevel', 'starsFor', 'spawnCustomer', 'settleCustomer', 'remainingOf',
  'openShop', 'openSavePanel', 'startLevel', 'buildMenu', 'renderSeat', 'renderTray', 'step'];
need.forEach(n => {
  const re = new RegExp('function\\s+' + n + '\\s*\\(|const\\s+' + n + '\\s*=');
  check('已定义 ' + n, re.test(m[1]));
});

console.log('\n[4] 无遗留的旧平衡参数');
['targetBase', 'targetStep'].forEach(k => check('已移除旧参数 ' + k, !m[1].includes(k)));
check('无 levelCapacity 死代码（测试改用 capacityOf）', !/function\s+levelCapacity/.test(m[1]));

console.log('\n[5] 调参区字段可解析');
const bal = m[1].match(/const BALANCE = \{([\s\S]*?)\n\};/);
check('BALANCE 字面量存在', !!bal);
if (bal) {
  const keys = [...bal[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map(x => x[1]);
  check('调参字段数 ≥ 20', keys.length >= 20, keys.length);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  check('调参字段无重复', dup.length === 0, dup);
  console.log('    字段：' + keys.join(', '));
}

console.log('\n[6] PWA 资源');
const fsx = fs, pathx = require('path');
const root = __dirname;
function readSafe(p) { try { return fsx.readFileSync(p, 'utf8'); } catch (e) { return null; } }

const mfRaw = readSafe(pathx.join(root, 'manifest.webmanifest'));
check('manifest.webmanifest 存在', mfRaw !== null);
let mf = null;
try { mf = JSON.parse(mfRaw); check('manifest 是合法 JSON', true); }
catch (e) { check('manifest 是合法 JSON', false, String(e).slice(0, 160)); }
if (mf) {
  check('name / short_name 已设置', !!mf.name && !!mf.short_name, [mf.name, mf.short_name]);
  check('display 为 standalone（主屏全屏）', mf.display === 'standalone', mf.display);
  check('start_url 指向 index.html', /index\.html/.test(mf.start_url), mf.start_url);
  check('含 180x180 图标（iOS 主屏必需）', (mf.icons || []).some(i => i.sizes === '180x180'));
  (mf.icons || []).forEach(i => {
    check('图标文件存在 ' + i.src, fsx.existsSync(pathx.join(root, i.src)), i.src);
  });
}

const swRaw = readSafe(pathx.join(root, 'sw.js'));
check('sw.js 存在', swRaw !== null);
if (swRaw) {
  fsx.writeFileSync(pathx.join(root, '_sw_check.js'), swRaw, 'utf8');
  try {
    cp.execFileSync(process.execPath, ['--check', pathx.join(root, '_sw_check.js')], { stdio: 'pipe' });
    check('sw.js 语法通过', true);
  } catch (e) { check('sw.js 语法通过', false, String(e.stderr || e).slice(0, 400)); }
  check('sw.js 声明了 install / activate / fetch', ['install', 'activate', 'fetch']
    .every(ev => swRaw.includes("addEventListener('" + ev + "'")));
  const shell = (swRaw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const urls = [...shell.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  check('预缓存清单非空', urls.length > 0, urls.length);
  urls.forEach(u => check('预缓存文件存在 ' + u, fsx.existsSync(pathx.join(root, u)), u));
}

console.log('\n[7] index.html 的 PWA 声明');
['manifest.webmanifest', 'apple-touch-icon', 'apple-mobile-web-app-capable',
  'apple-mobile-web-app-status-bar-style', 'theme-color', 'viewport-fit=cover', 'env(safe-area-inset']
  .forEach(k => check('已声明 ' + k, html.includes(k)));
check('脚本块内无外链资源', !/<script\s+src=|<link[^>]+href="https?:/i.test(html));
check('样式内无外链字体/图片', !/url\(\s*['"]?https?:/i.test(html));

console.log('\n========================================');
console.log(fail ? ('失败 ' + fail + ' 项') : '全部通过');
console.log('========================================');
process.exit(fail ? 1 : 0);
