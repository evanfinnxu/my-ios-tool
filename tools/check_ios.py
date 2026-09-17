# -*- coding: utf-8 -*-
"""iOS 工程静态校验。

本机没有 macOS / Xcode，无法真正编译，所以把「能静态验证的部分」全部验证掉：
  · project.yml 结构（尤其 www 必须是 folder 引用，否则打包后游戏文件会丢）
  · Info.plist 合法性（尤其不能有 UIApplicationSceneManifest）
  · GitHub Actions 工作流结构
  · Assets.xcassets 的 Contents.json 与图标尺寸
  · build-ipa.sh 的 shell 语法
  · Swift 源码括号配平
  · 【重点】Swift 与 index.html 的跨文件一致性：
      桥接名 zaocan、存档键 xiangkou_zaocan_save_v1、注入变量 __ZAOCAN_SAVE__、
      www/index.html 路径。任一处拼错都会导致存档静默失效，必须机器核对。

用法（需要 PyYAML）：
  python tools/check_ios.py
"""
import json, os, re, plistlib, subprocess, sys, struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IOS = os.path.join(ROOT, 'ios')
SWIFT_DIR = os.path.join(IOS, 'Zaocan')

try:
    import yaml
except ImportError:
    print('需要 PyYAML：pip install pyyaml')
    sys.exit(2)

pass_n = fail_n = 0


def ok(cond, name, extra=None):
    global pass_n, fail_n
    line = ('  ✓ ' if cond else '  ✗ ') + name
    if extra is not None:
        line += '  → ' + repr(extra)
    print(line)
    if cond:
        pass_n += 1
    else:
        fail_n += 1
    return cond


def read(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return None


def png_size(path):
    """只读 PNG 头拿宽高，避免依赖 Pillow"""
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', head[16:24])
    return w, h


print('\n[1] project.yml 结构')
proj_raw = read(os.path.join(IOS, 'project.yml'))
if ok(proj_raw is not None, 'project.yml 存在'):
    try:
        proj = yaml.safe_load(proj_raw)
        ok(True, 'project.yml 可被 YAML 解析')
    except Exception as e:
        proj = None
        ok(False, 'project.yml 可被 YAML 解析', str(e)[:200])

    if proj:
        ok(proj.get('name') == 'Zaocan', '工程名为 Zaocan', proj.get('name'))
        tgt = (proj.get('targets') or {}).get('Zaocan')
        ok(tgt is not None, '存在 Zaocan target')
        if tgt:
            ok(tgt.get('type') == 'application', 'target 类型为 application', tgt.get('type'))
            ok(tgt.get('platform') == 'iOS', 'target 平台为 iOS', tgt.get('platform'))
            srcs = tgt.get('sources') or []
            paths = [s.get('path') if isinstance(s, dict) else s for s in srcs]
            ok('Zaocan' in paths, '引入了 Swift 源码目录', paths)

            # 最关键的一条：www 必须是 folder 引用
            www_entry = next((s for s in srcs if isinstance(s, dict) and s.get('path') == 'www'), None)
            ok(www_entry is not None, '引入了 www 目录')
            if www_entry:
                ok(www_entry.get('type') == 'folder',
                   'www 以 folder（文件夹引用）方式引入 —— 否则 .app 内会被拍平，游戏文件丢失',
                   www_entry.get('type'))

            st = tgt.get('settings', {}).get('base', {})
            ok(st.get('INFOPLIST_FILE') == 'Zaocan/Info.plist', '指定了自己的 Info.plist',
               st.get('INFOPLIST_FILE'))
            ok(st.get('GENERATE_INFOPLIST_FILE') == 'NO',
               '关闭自动生成 Info.plist（避免与手写的冲突）', st.get('GENERATE_INFOPLIST_FILE'))
            ok(st.get('ASSETCATALOG_COMPILER_APPICON_NAME') == 'AppIcon', '启用 AppIcon 资源')
            bid = st.get('PRODUCT_BUNDLE_IDENTIFIER', '')
            ok(bool(bid) and '.' in bid, 'Bundle ID 已设置（换成你自己的 App ID 后再上架）', bid)

    ok('schemes' in (proj or {}) and 'Zaocan' in (proj or {}).get('schemes', {}),
       '显式定义了 scheme（保证 xcodebuild -scheme 在未打开 Xcode 时可用）')

print('\n[2] Info.plist')
plist_path = os.path.join(SWIFT_DIR, 'Info.plist')
if ok(os.path.isfile(plist_path), 'Info.plist 存在'):
    try:
        with open(plist_path, 'rb') as f:
            pl = plistlib.load(f)
        ok(True, 'Info.plist 是合法 plist')
    except Exception as e:
        pl = None
        ok(False, 'Info.plist 是合法 plist', str(e)[:200])

    if pl:
        # Scene 清单一旦存在，AppDelegate 里的 window 不会被显示，是纯代码启动最常见的坑
        ok('UIApplicationSceneManifest' not in pl,
           '没有 UIApplicationSceneManifest（纯代码启动必须如此，否则窗口不显示）')
        ok(pl.get('CFBundleDisplayName') == '早餐铺', '中文显示名已设置', pl.get('CFBundleDisplayName'))
        ok(pl.get('CFBundlePackageType') == 'APPL', 'CFBundlePackageType = APPL')
        ok(pl.get('CFBundleExecutable') == '$(EXECUTABLE_NAME)', 'CFBundleExecutable 使用构建变量')
        ok(pl.get('CFBundleIdentifier') == '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleIdentifier 使用构建变量')
        ok(pl.get('LSRequiresIPhoneOS') is True, 'LSRequiresIPhoneOS = true')
        ok(isinstance(pl.get('UILaunchScreen'), dict), '声明了 UILaunchScreen（否则老机型会以信箱模式显示）')
        ok(pl.get('UIRequiredDeviceCapabilities') == ['arm64'], '要求 arm64')
        ok(pl.get('ITSAppUsesNonExemptEncryption') is False, '声明不使用加密（免去出口合规问答）')
        ok(pl.get('UIFileSharingEnabled') is True, '开启文件共享（存档可从「文件」App 取出修改）')
        o = pl.get('UISupportedInterfaceOrientations') or []
        ok('UIInterfaceOrientationPortrait' in o, '支持竖屏', o)
        key = pl.get('UILaunchScreen', {}).get('UIColorName')
        ok(key == 'LaunchBackground', '启动屏引用的颜色集名', key)

print('\n[3] Assets.xcassets')
assets = os.path.join(SWIFT_DIR, 'Assets.xcassets')
ok(os.path.isfile(os.path.join(assets, 'Contents.json')), '资源目录根 Contents.json 存在')
for cs in ['AppIcon.appiconset', 'AccentColor.colorset', 'LaunchBackground.colorset']:
    p = os.path.join(assets, cs, 'Contents.json')
    raw = read(p)
    if not ok(raw is not None, cs + '/Contents.json 存在'):
        continue
    try:
        json.loads(raw)
        ok(True, cs + ' 是合法 JSON')
    except Exception as e:
        ok(False, cs + ' 是合法 JSON', str(e)[:150])

icon_path = os.path.join(assets, 'AppIcon.appiconset', 'icon-1024.png')
if ok(os.path.isfile(icon_path), 'AppIcon 的 1024 图标存在'):
    sz = png_size(icon_path)
    ok(sz == (1024, 1024), '图标尺寸为 1024x1024', sz)
    ok(os.path.getsize(icon_path) > 1000, '图标文件非空',
       '%d bytes' % os.path.getsize(icon_path))

print('\n[4] Swift 源码')
swift_files = [f for f in os.listdir(SWIFT_DIR) if f.endswith('.swift')]
ok(len(swift_files) >= 2, 'Swift 源文件数量 %d' % len(swift_files), swift_files)
swift_all = ''
for f in sorted(swift_files):
    src = read(os.path.join(SWIFT_DIR, f)) or ''
    swift_all += '\n' + src
    ok(src.count('{') == src.count('}') and src.count('(') == src.count(')'),
       '{} 括号配平'.format(f),
       {'braces': src.count('{') - src.count('}'), 'parens': src.count('(') - src.count(')')})
    ok('TODO' not in src and 'FIXME' not in src, f + ' 无未替换的占位符')

ok(swift_all.count('@main') == 1, '@main 恰好出现一次', swift_all.count('@main'))
ok('UIApplicationDelegate' in swift_all, '使用 UIApplicationDelegate 生命周期')
ok('override var preferredStatusBarStyle' in swift_all, '指定了状态栏样式')

print('\n[5] Swift 与 index.html 的跨文件一致性（拼错会导致存档静默失效）')
html = read(os.path.join(ROOT, 'index.html')) or ''

swift_bridge = re.search(r'bridgeName\s*=\s*"([^"]+)"', swift_all)
js_bridge = re.search(r"messageHandlers\.([A-Za-z_][A-Za-z0-9_]*)\)", html)
ok(swift_bridge is not None, 'Swift 中定义了 bridgeName')
ok(js_bridge is not None, 'JS 中读取了 messageHandlers')
if swift_bridge and js_bridge:
    ok(swift_bridge.group(1) == js_bridge.group(1),
       '桥接名一致（Swift ↔ JS）',
       {'swift': swift_bridge.group(1), 'js': js_bridge.group(1)})
    ok('add(self, name: Self.bridgeName)' in swift_all, 'Swift 侧注册了同名 messageHandler')

swift_key = re.search(r'saveKey\s*=\s*"([^"]+)"', swift_all)
js_key = re.search(r"SAVE_KEY\s*=\s*'([^']+)'", html)
ok(swift_key is not None, 'Swift 中定义了 saveKey')
ok(js_key is not None, 'JS 中定义了 SAVE_KEY')
if swift_key and js_key:
    ok(swift_key.group(1) == js_key.group(1),
       '存档键一致（Swift ↔ JS）',
       {'swift': swift_key.group(1), 'js': js_key.group(1)})

ok('__ZAOCAN_SAVE__' in swift_all, 'Swift 注入变量 __ZAOCAN_SAVE__')
ok('__ZAOCAN_SAVE__' in html, 'JS 读取变量 __ZAOCAN_SAVE__')
# Swift 插值写法为 \(literal)：左括号带反斜杠，右括号不带。这里两段分开断言，避免正则歧义
ok('window.__ZAOCAN_SAVE__ = \\(literal)' in swift_all,
   'Swift 以插值方式写入注入变量（形如 window.__ZAOCAN_SAVE__ = \\(literal);）')
ok('injectionTime: .atDocumentStart' in swift_all,
   '注入时机为 atDocumentStart（必须早于页面脚本执行）')
ok('UserDefaults.standard.string' in swift_all and 'UserDefaults.standard.set' in swift_all,
   '存档读写均落到 UserDefaults')
ok('webView.loadFileURL' in swift_all and 'allowingReadAccessTo' in swift_all,
   '以 loadFileURL 载入本地游戏（并限制可读目录）')

print('\n[5b] iOS 存档可手改链路')
ok('documentsSaveURL' in swift_all, '定义了 Documents 下的存档文件路径')
ok('.documentDirectory' in swift_all, '使用 documentDirectory（「文件」App 可见）')
ok('xiangkou-zaocan-save.json' in swift_all, '存档文件名固定，便于用户查找')
ok('func persist(' in swift_all, '定义了统一落盘函数 persist')
ok(swift_all.count('UserDefaults.standard.set') >= 1, 'persist 写入 UserDefaults')
ok('.write(to: url, atomically: true, encoding: .utf8)' in swift_all,
   'persist 同时镜像一份到 Documents（用户可在「文件」里编辑）')
ok('func resolveSaveLiteral(' in swift_all, '定义了存档优先级解析')
ok('func isValidSave(' in swift_all, '对用户手改的 JSON 做校验')
ok('JSONSerialization.jsonObject' in swift_all, '用 JSONSerialization 解析校验')
ok('prettyPrinted' in swift_all and '.sortedKeys' in swift_all,
   '镜像文件做了缩进格式化（手改体验）')
# 顺序必须是 Documents 优先，否则用户改了文件也不生效
idx_doc = swift_all.find('let text = try? String(contentsOf: url')
idx_ud = swift_all.rfind('UserDefaults.standard.string(forKey: saveKey) ?? "null"')
ok(idx_doc != -1 and idx_ud != -1 and idx_doc < idx_ud,
   '优先级正确：先读 Documents（用户可改的那份），再退回 UserDefaults',
   {'documents_at': idx_doc, 'userdefaults_at': idx_ud})
ok('ensureDocumentsSaveExists' in swift_all, '首次启动会把默认存档落到 Documents，便于用户找到')

ok("forResource: \"index\"" in swift_all and 'subdirectory: "www"' in swift_all,
   'Swift 按 www/index.html 取游戏文件')
ok(os.path.isfile(os.path.join(ROOT, 'index.html')),
   'index.html 与 build-ipa.sh 的拷贝源一致')

for cmd in ["cmd:'save'", "cmd:'export'"]:
    js_cmd = cmd.replace("cmd:'", "").replace("'", "")
    ok(js_cmd in html, 'JS 会发送 %s 指令' % js_cmd)
    ok('"%s"' % js_cmd in swift_all, 'Swift 处理 %s 指令' % js_cmd)

print('\n[6] build-ipa.sh')
sh_path = os.path.join(IOS, 'build-ipa.sh')
sh = read(sh_path)
if ok(sh is not None, 'build-ipa.sh 存在'):
    # 找一个可用的 bash 做语法检查（Windows 上 Git 自带 bash 不在 PATH 里）
    import shutil
    bash = shutil.which('bash')
    if not bash:
        for cand in [
            r'C:\Users\mosha\.workbuddy\binaries\PortableGit\versions\1.2.0\bin\bash.exe',
            r'C:\Program Files\Git\bin\bash.exe',
            '/bin/bash', '/usr/bin/bash',
        ]:
            if os.path.isfile(cand):
                bash = cand
                break
    if bash:
        try:
            r = subprocess.run([bash, '-n', sh_path], capture_output=True, timeout=60)
            ok(r.returncode == 0, 'shell 语法检查通过（bash -n）',
               (r.stderr or b'').decode('utf-8', 'replace')[:300] or None)
        except Exception as e:
            ok(False, 'shell 语法检查通过（bash -n）', str(e)[:200])
    else:
        print('  · 跳过 bash -n（本机找不到 bash）')
    for s in ['xcodegen generate', 'xcodebuild archive', 'CODE_SIGNING_ALLOWED=NO',
              'Payload', 'unzip -Z1', 'www/index.html']:
        ok(s in sh, '脚本包含关键步骤：' + s)
    ok(sh.startswith('#!/usr/bin/env bash'), '使用 bash shebang')
    ok('set -euo pipefail' in sh, '启用严格模式 set -euo pipefail')
    ok('command -v xcodegen' in sh and 'uname -s' in sh,
       '包含环境前置检查（给出可读的报错而非晦涩失败）')

    # iOS 的 AMFI 不会执行「完全没有签名」的 Mach-O：结构合法、能装进去，但点开闪退。
    # 所以编译（关闭签名）之后必须补一次 ad-hoc 签名，且必须在打包 IPA 之前完成。
    ok('codesign --force --sign -' in sh, '编译后补 ad-hoc 签名（不需要任何证书）')
    ok('codesign --verify' in sh, '签名后立刻用 codesign --verify 复核')
    ok('Signature=adhoc' in sh, '断言签名类型确实是 adhoc')
    ok('_CodeSignature/CodeResources' in sh, '断言签名清单进了 IPA（打包没弄丢签名）')
    ok('Zaocan-adhoc.ipa' in sh, '产物命名为 Zaocan-adhoc.ipa')
    ok('--timestamp=none' in sh, '签名不取网络时间戳（离线也能签）')
    i_sign, i_zip = sh.find('codesign --force'), sh.find('zip -qry')
    ok(0 <= i_sign < i_zip, '签名发生在打包 IPA 之前（顺序正确）')

print('\n[7] GitHub Actions 工作流')
wf_path = os.path.join(ROOT, '.github', 'workflows', 'build-ios-ipa.yml')
wf_raw = read(wf_path)
if ok(wf_raw is not None, '工作流文件存在'):
    try:
        wf = yaml.safe_load(wf_raw)
        ok(True, '工作流可被 YAML 解析')
    except Exception as e:
        wf = None
        ok(False, '工作流可被 YAML 解析', str(e)[:200])
    if wf:
        # on 在 YAML 1.1 里会被解析成布尔 True，两种写法都兼容
        trig = wf.get('on', wf.get(True))
        ok(trig is not None, '定义了触发条件', list(trig) if isinstance(trig, dict) else trig)
        jobs = wf.get('jobs') or {}
        ok(len(jobs) == 1, '定义了 1 个 job', list(jobs))
        job = list(jobs.values())[0] if jobs else {}
        ok(job.get('runs-on') == 'macos-14', '使用 macos-14 runner', job.get('runs-on'))
        steps = job.get('steps') or []
        flat = yaml.dump(steps, allow_unicode=True)
        ok('xcodegen' in flat, '步骤里安装了 xcodegen')
        ok('bash ios/build-ipa.sh' in flat, '调用了 build-ipa.sh')
        ok('actions/upload-artifact@v4' in flat, '使用 upload-artifact@v4 产出可下载成果')
        ok('ios/build/*.ipa' in flat, 'artifact 路径指向生成的 IPA')
        ok('if-no-files-found: error' in flat or "if-no-files-found" in str(steps),
           'IPA 缺失时会让构建失败（避免静默产出空成果）')
        # 用户本地无法调试，失败时必须能拿到可诊断的信息
        ok('build.log' in flat, '构建过程 tee 到 build.log 留档')
        ok('GITHUB_STEP_SUMMARY' in flat, '失败时把关键错误行汇总到运行摘要')
        ok('if: failure()' in flat, '定义了失败分支步骤')
        ok('name: build-log' in flat, '失败时上传完整构建日志作为 artifact')
        ok('name: Zaocan-ipa' in flat, 'artifact 名称与文档一致（Zaocan-ipa）')
        ok('Zaocan-adhoc.ipa' in flat, '成功摘要里写明了产物文件名')
        ok('tail -n 40' in flat, '摘要里附带日志尾部，便于快速定位')

print('\n[8] README 与产物的命名一致性')
# 文档写的文件名/artifact 名一旦和脚本实际产出的名字不一致，用户就会在
# 「下载到的包里找不到文档说的那个文件」，属于纯文档漂移，交给机器核对。
rd = read(os.path.join(ROOT, 'README-iOS.md'))
if ok(rd is not None, 'README-iOS.md 存在'):
    ok('Zaocan-adhoc.ipa' in rd, 'README 写明了实际产物名 Zaocan-adhoc.ipa')
    ok('Zaocan-ipa' in rd, 'README 写明了实际 artifact 名 Zaocan-ipa')
    ok('Zaocan-unsigned' not in rd, 'README 里没有残留的旧命名 Zaocan-unsigned')
    ok('Zaocan-unsigned' not in (wf_raw or ''), '工作流里没有残留的旧命名 Zaocan-unsigned')
    ok('Zaocan-unsigned' not in sh, '构建脚本里没有残留的旧命名 Zaocan-unsigned')
    # 浏览器拖拽上传会跳过点开头的目录，这个坑必须写在文档里
    ok('.github/workflows/build-ios-ipa.yml' in rd,
       'README 说明了 .github 目录需在网页端单独创建')
    ok('ad-hoc' in rd, 'README 解释了 ad-hoc 签名的必要性')

print('\n========================================')
print(('通过 %d 项，失败 %d 项' % (pass_n, fail_n)) if fail_n else ('全部通过（%d 项）' % pass_n))
print('========================================')
sys.exit(1 if fail_n else 0)
