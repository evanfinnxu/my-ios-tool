# 打包成 IPA · 三种路径

## 先讲清楚两条硬约束

**一、Windows 上无法直接编译出能装进 iPhone 的 IPA。** 原因不是工具缺失，而是：

一个可安装的 IPA，其 `Payload/*.app/` 里必须有一个 **arm64 架构的 Mach-O 可执行文件**。
生成它需要 Apple 的编译工具链（clang + iOS SDK），而 iOS SDK 只随 Xcode 分发、只授权在 macOS 上使用。

所以本目录提供的是**工程与流水线**，真正的编译交给有 Apple 工具链的机器。下面三条路任选。

**二、IPA 里的可执行文件不能是「裸的」（完全没有签名）。** iOS 的 AMFI 校验会拒绝执行这种二进制——
这样打出来的包结构完全合法、能装进去，但**点开就闪退**，而且报错信息很少，很难定位。

所以流水线在编译之后会自动补一次 **ad-hoc 签名**（`codesign --sign -`）。它是一份空壳签名：

- 不需要证书、不需要 Apple ID、不需要描述文件
- **TrollStore 走 CoreTrust 漏洞，ad-hoc 签名可以直接安装**，不用你再签一次
- 用 Sideloadly / AltStore / 开发者证书时，它们会用你的证书覆盖重签，同样没问题

一句话：**产出的 IPA 拿来就能装，签名这一步不必你操心。** 你只需要一台能跑 Xcode 的机器。

| 路径 | 前提 | 拿到 IPA 的方式 |
|---|---|---|
| **A** Xcode 本机构建 | 有 Mac | `bash ios/build-ipa.sh` 一条命令 |
| **B** 云端构建 | 只有 Windows，但有 GitHub 账号 | 拖文件 → Actions 跑 → 下载 artifact |
| **C** 不装 App（PWA） | 什么都不用 | Safari 打开 → 添加到主屏幕，全屏离线运行 |

---

## 路径 A：有 Mac

```bash
brew install xcodegen          # 只需装一次
cd breakfast-shop
bash ios/build-ipa.sh
```

产物：`ios/build/Zaocan-adhoc.ipa`

脚本会依次做六件事，任一步失败都会明确报错并中止：

1. 把上一层的游戏文件（`index.html` / `manifest.webmanifest` / `sw.js` / `icons/`）同步到 `ios/www`
2. `xcodegen generate` 生成 `Zaocan.xcodeproj`
3. `xcodebuild archive` 以 Release 配置编译（**编译阶段关闭签名**，跳过证书与描述文件）
4. **补 ad-hoc 签名**，随即用 `codesign --verify` 复核，并断言签名类型确实是 `adhoc`
5. 打包成标准 `Payload/Zaocan.app` 结构的 IPA
6. **校验 IPA 内容**——逐项断言主二进制、Info.plist、`www/index.html` 都在，确认主二进制是 arm64 Mach-O，
   并确认签名清单 `_CodeSignature/CodeResources` 没有在打包时丢掉

第 4、6 步是有意加的，因为这两个环节最容易静默出错：
`www` 被拍平会让游戏文件没进包；漏了签名会让 App 装上后闪退。两种情况都不会当场报错，
只能靠断言拦住——不校验的话，你会装上一个打不开的 App 却不知道原因。

### 想让 Xcode 直接装机（免手动签名）

```bash
open ios/Zaocan.xcodeproj
```

在 **Signing & Capabilities** 里选上你的 Team，然后直接 Run。这条路径不需要 IPA，也不需要 XcodeGen——
工程已经生成好了。

---

## 路径 B：只有 Windows（云端构建）

不需要本机装任何东西，也不需要 git 命令行，全程浏览器操作：

1. **建仓库**：GitHub 右上角 `+` → New repository，名字随意（如 `zaocan-ios`），可见性选 **Public**
   （公开仓库的 macOS runner 免费额度不限；私有仓库也能跑，但有额度上限）
2. **传文件**：进入空仓库页面 → 点 **uploading an existing file** → 把 `zaocan-ios-project.zip`
   解压后的**全部内容**拖进去 → Commit changes
   > ⚠️ 浏览器拖拽上传会**跳过以点开头的目录**，也就是 `.github/` 传不上去。这一步先不管它，下一步单独补。
3. **补工作流**：点 **Add file → Create new file**，在文件名框里粘贴这个完整路径（GitHub 会自动建好目录）：
   ```
   .github/workflows/build-ios-ipa.yml
   ```
   然后把本地 `breakfast-shop/.github/workflows/build-ios-ipa.yml` 的内容整个复制进去 → Commit changes
   > 内容也可以从 `zaocan-ios-project.zip` 里直接取。
4. **等构建**：提交这个文件会自动触发一次构建（工作流的 `paths` 里包含它自己）。
   约 3~5 分钟，进入 **Actions** 页面可看实时日志。
   没自动跑的话，左侧选「构建 iOS IPA」→ **Run workflow** 手动触发。
5. **取产物**：在该次运行页面下方 **Artifacts** 区下载 `Zaocan-ipa`，解压得到 `Zaocan-adhoc.ipa`。

同一份 artifact 里还会附带 `Zaocan-web`（纯静态 Web 版，可直接丢到任意服务器）。

**如果构建失败**：这次运行会额外产出 `build-log` artifact，并把关键错误行自动汇总到运行页面顶部摘要。
把那段摘要贴给我就能定位——本机的 Swift 代码没有 Xcode 无法编译验证，所以第一次跑出现编译错误是正常可能，
日志里会写清楚是哪一行。

GitHub 对公开仓库的 macOS runner 免费；私有仓库也有每月免费额度。工作流同时支持 `push` 触发，
但只在改动游戏文件或 iOS 工程时才跑，避免无谓消耗。

---

## 路径 C：不想装 App，只想赶紧在 iPhone 上玩

这条路径**今天就能用**，不需要任何证书：

1. 把 `breakfast-shop/` 里的文件（`index.html`、`manifest.webmanifest`、`sw.js`、`icons/`）放到任意 HTTPS 静态站点
2. iPhone 用 **Safari** 打开该网址
3. 点「分享」→「**添加到主屏幕**」

之后从主屏幕图标进入即为**全屏运行**（无 Safari 地址栏），并且因为有 Service Worker 缓存，
**断网也能玩**。存档走 localStorage，正常持久化。

> 注意：Service Worker 只在 HTTPS 或 localhost 下生效，`file://` 打开时不会注册
> （代码里已做静默跳过，不影响游戏本身运行）。

---

## 安装：TrollStore

**TrollStore 走 CoreTrust 漏洞安装，不校验签名的可信来源。** 带来的直接结论：

- 本脚本产出的 **ad-hoc 签名 IPA 可以直接装**，不需要你再签一次
- 不需要 Apple ID、不需要开发者账号、不需要描述文件（provisioning profile）
- 没有 7 天过期问题（TrollStore 是永久签名），重启也不会失效
- App 容器持久保留 → **存档不会因为重装而丢**

操作：把 `Zaocan-adhoc.ipa` 传到手机上，用 TrollStore 打开 → Install。或者先传到「文件」App，
在 TrollStore 里选 `Install IPA File`。

> 支持的 iOS 版本取决于你所用的那个 CoreTrust 漏洞，具体以 TrollStore 官方说明为准。

### 为什么包里仍然带着一份签名

容易混淆的一点，说清楚：**「不需要签名」指不需要你的开发者证书，不等于二进制可以是裸的。**

iOS 的 AMFI 在执行任何 Mach-O 之前都会先查签名。一份**完全没有签名**的二进制会被直接拒绝执行，
症状是 App 装得上、点开闪退。所以流水线必须补一个签名，而 ad-hoc 签名正好满足要求且不需要证书——
它是一份空壳签名，恰好能被 CoreTrust 漏洞放过。

脚本第 4 步做的就是这件事，并会断言签名类型确实是 `adhoc`、`codesign --verify` 通过；
打包后再断言签名清单 `_CodeSignature/CodeResources` 确实进了 IPA。三道校验都过了才输出产物。

> 如果你习惯用非 TrollStore 的方式（Sideloadly / AltStore / 免费 Apple ID），
> 这份 IPA 同样适用——它们会在安装时用你的证书覆盖掉 ad-hoc 签名，只是会额外受
> 7 天过期、最多 3 个 App 等限制。

### 仅需注意的一点：Bundle ID 决定存档容器

TrollStore 不看签名，所以 Bundle ID 唯一的作用就是决定 App 的数据容器。
**换 Bundle ID = 换新容器 = 旧存档读不到。** 同一个游戏想保留进度，就固定用同一个 Bundle ID。

当前是 `com.example.xiangkouzaocan`。要改就改 `ios/project.yml` 里的 `PRODUCT_BUNDLE_IDENTIFIER`
（也可以改成你自己的反域名），然后重新执行构建脚本。

### 仍然需要一个 macOS 编译环境

这一点 TrollStore 帮不上忙：**IPA 里的可执行文件必须是 arm64 的 Mach-O**，
而生成它需要 Apple 的工具链（clang + iOS SDK），iOS SDK 只随 Xcode 分发、只授权在 macOS 上使用。
所以「编译」这一步必须用 Mac —— 自有的、借的、或路径 B 的云端 macOS runner 都行。

ad-hoc 签名不需要 Mac 之外的任何东西（`codesign` 是 macOS 自带工具），所以整条流水线在一台
干净安装的 Mac 上就能跑通，不需要你有开发者账号。

---

## 存档在哪、怎么手改

游戏本体（浏览器版）的存档是 `localStorage` 里的明文 JSON。

**iOS 版走的是原生沙盒**，原因：WKWebView 在 `file://` 源下 `localStorage` 不保证跨启动持久化
（典型症状是每次冷启动都回到初始存档）。所以 iOS 版由 App 接管存储，并且**落两份**：

| 位置 | 用途 |
|---|---|
| `UserDefaults` | 权威存储，App 自动读写 |
| `Documents/xiangkou-zaocan-save.json` | **用户可见可改的那份**，缩进格式化过 |

因为 Info.plist 开了 `UIFileSharingEnabled`，你可以在 iPhone 的
**「文件」App → 我的 iPhone → 早餐铺** 里看到并编辑那个 JSON。改完**重启 App 即生效**——
启动时的优先级是「先读 Documents 里这份可编辑的，读不到或 JSON 非法才退回 UserDefaults」。

App 内也留了入口：游戏里点「暂停 → 存档」，面板里可以直接改 JSON、导入导出，
另有「给 9999 金币 / 解锁全部菜品 / 设备全满级」三个调试按钮。

---

## 已经做过的 iOS 适配

不是把网页塞进 WebView 就完事，以下都是针对 iPhone 实际会踩的坑处理的：

| 问题 | 处理方式 |
|---|---|
| **实时游戏不能滚动屏幕** | 手机端改为 grid 固定分区：4 个座位恒为单行（客人必须全部可见），出餐口与灶台并排，仅菜单横向滚动；`overflow:hidden` 锁死页面滚动 |
| 刘海 / 灵动岛 / 底部指示条遮挡 | 全面使用 `env(safe-area-inset-*)`；`viewport-fit=cover` |
| iOS 地址栏收缩导致高度跳变 | 用 `100dvh`（保留 `100vh` 回退） |
| 软键盘盖住存档面板输入框 | 监听 `visualViewport` 算出键盘高度写入 `--kb` 变量，弹窗与遮罩据此抬升并压缩最大高度 |
| 双击/双指缩放打乱布局 | 禁掉 `gesturestart` 系列事件 + 双击节流；`touch-action:manipulation` |
| 长按弹出选择气泡 | `-webkit-touch-callout:none`（但输入框放行，否则无法编辑存档） |
| 触屏粘滞 hover | `@media (hover:none)` 下重写 hover 样式，改用 `:active` 反馈 |
| 切后台后关卡被白白耗掉 | `visibilitychange` 时自动暂停 |
| blob 下载在 WKWebView 里失效 | 「导出存档」改走原生分享面板，并额外写一份到剪贴板兜底 |
| 触屏按钮偏小 | 手机端加大按钮内边距至可点范围 |

---

## 目录结构

```
breakfast-shop/
├── index.html                    游戏本体（单文件，零外部依赖）
├── manifest.webmanifest          PWA 清单
├── sw.js                         Service Worker（离线缓存）
├── icons/                        主屏图标 180/192/512/1024
├── tools/
│   ├── make_icons.py             生成图标（纯标准库，不需要 Pillow）
│   └── check_ios.py              iOS 工程静态校验（结构 / 跨文件一致性 / 签名链路）
├── ios/
│   ├── project.yml               XcodeGen 工程描述
│   ├── build-ipa.sh              一键产出带 ad-hoc 签名的 IPA
│   ├── www/                      构建时从上一层同步（不入版本库）
│   └── Zaocan/
│       ├── AppDelegate.swift
│       ├── GameViewController.swift    宿主 + 原生存档桥
│       ├── Info.plist
│       └── Assets.xcassets/
├── test_game.js                  核心逻辑回归（47 项）
├── test_render.js                DOM 渲染断言（31 项）
├── test_curve.js                 难度曲线四组对照
├── test_native_bridge.js         原生桥接与存档路径（25 项）
├── test_syntax.js                语法 / PWA 资源 / 调参区校验
└── .github/workflows/build-ios-ipa.yml   云端构建
```

---

## 本地校验

本机（Windows）没有 Xcode，无法编译，所以把**所有能静态验证的部分**都验证掉了：

```bash
node test_syntax.js            # 语法、PWA 资源、调参区完整性
node test_game.js              # 核心玩法逻辑
node test_render.js            # 渲染产物无 undefined/NaN、商店价格与 BALANCE 一致
node test_native_bridge.js     # iOS 原生桥接：存档读写、损坏存档容错、双路径一致性
node test_curve.js             # 难度曲线
python tools/check_ios.py      # iOS 工程：project.yml / Info.plist / 工作流 / 跨文件一致性（需 pyyaml）
```

`check_ios.py` 里最值得说的是两类检查：

- **跨文件一致性**：核对 Swift 与 `index.html` 之间的桥接名（`zaocan`）、存档键
  （`xiangkou_zaocan_save_v1`）、注入变量（`__ZAOCAN_SAVE__`）、以及 `www/index.html` 的路径。
  这几处任一处拼错，表现都是「存档静默失效」——不报错、就是存不上，在没有真机的情况下极难排查。
- **签名链路完整性**：断言 ad-hoc 签名这一步存在、签名类型校验存在、签名顺序在打包之前、
  以及打包后会检查 `_CodeSignature/CodeResources`。这几项是「装了但闪退」的唯一防线。

---

## 仍需真机确认的事项

诚实说明我无法在本机验证的部分：

1. **实际编译是否通过**——Swift 代码没有 Xcode 就无法编译验证，本机只做了结构与跨文件一致性检查。
2. **真机安装与启动**——ad-hoc 签名能否被你所用的 TrollStore 版本接受、启动后能否正常进游戏。
3. **手机端布局的实际观感**——一屏布局是按网格尺寸推算的，实际在具体机型上的密度需要目测微调。
   `index.html` 里 `@media(max-width:700px)` 那一段就是调参位置。
4. **WebView 存档跨冷启动**——原生存档链路在 Node 里模拟验证过（25 项），但真实的
   WKWebView + UserDefaults 行为需真机确认。

如果编译报错或装上后闪退，把日志贴给我，我来定位。
