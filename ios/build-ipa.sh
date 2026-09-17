#!/usr/bin/env bash
#
# 一键产出可直接安装的 IPA —— 自带 ad-hoc 签名，不需要任何证书。
#
#   用法：  bash ios/build-ipa.sh
#   产物：  ios/build/Zaocan-adhoc.ipa
#
# 【关于签名，先讲清楚】
#   脚本最后会给 App 补一个「ad-hoc 签名」（codesign --sign -），它是一份空壳签名：
#   不需要证书、不需要 Apple ID、不需要描述文件（provisioning profile）。
#
#   为什么必须补：iOS 的 AMFI 校验不会执行「完全没有签名」的 Mach-O 可执行文件。
#   直接用 xcodebuild 关掉签名出来的包，里面主二进制是裸的，装上会起不来。
#   ad-hoc 签名正好补上这一环：
#     · TrollStore  → 走 CoreTrust 漏洞，ad-hoc 签名即可直接安装
#     · Sideloadly / AltStore / 开发者证书 → 安装时会用你自己的证书覆盖重签，同样没问题
#
# 依赖：macOS + Xcode（含 xcodebuild、codesign）、xcodegen、unzip
#       xcodegen 安装：brew install xcodegen
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PROJ_NAME="Zaocan"
WWW_DIR="$SCRIPT_DIR/www"
IPA_NAME="$PROJ_NAME-adhoc.ipa"

say()  { printf '\033[1;33m==>\033[0m %s\n' "$1"; }
good() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31m错误：\033[0m %s\n' "$1" >&2; exit 1; }

# ---------- 0. 环境检查 ----------
say "检查构建环境"
[ "$(uname -s)" = "Darwin" ] || die "iOS 构建只能在 macOS 上进行。若你只有 Windows/Linux，请改用 .github/workflows/build-ios-ipa.yml 的云端构建。"
command -v xcodebuild >/dev/null 2>&1 || die "找不到 xcodebuild。请安装完整版 Xcode（不是仅 Command Line Tools），并执行 sudo xcode-select -s /Applications/Xcode.app"
command -v codesign   >/dev/null 2>&1 || die "找不到 codesign（macOS 自带，出现此错通常说明 Xcode 不完整）"
command -v xcodegen   >/dev/null 2>&1 || die "找不到 xcodegen。执行：brew install xcodegen"
command -v unzip      >/dev/null 2>&1 || die "找不到 unzip（macOS 自带，异常情况请检查 PATH）"
good "macOS / $(xcodebuild -version | head -1) / xcodegen $(xcodegen --version 2>/dev/null | head -1)"

# ---------- 1. 同步游戏本体 ----------
# 单一事实来源：ios/www 只是构建期副本，正文始终是上一层的 breakfast-shop/。
say "同步游戏文件到 ios/www"
rm -rf "$WWW_DIR"
mkdir -p "$WWW_DIR/icons"
for f in index.html manifest.webmanifest sw.js; do
  [ -f "$GAME_DIR/$f" ] || die "缺少游戏文件 $GAME_DIR/$f"
  cp "$GAME_DIR/$f" "$WWW_DIR/"
  good "$f"
done
if compgen -G "$GAME_DIR/icons/*.png" > /dev/null; then
  cp "$GAME_DIR"/icons/*.png "$WWW_DIR/icons/"
  good "icons/ ($(ls "$GAME_DIR"/icons/*.png | wc -l | tr -d ' ') 个图标)"
else
  die "缺少图标。请先运行：python tools/make_icons.py"
fi

# ---------- 2. 生成 Xcode 工程 ----------
say "生成 Xcode 工程（xcodegen）"
cd "$SCRIPT_DIR"
xcodegen generate --quiet || die "xcodegen 生成工程失败"
[ -d "$PROJ_NAME.xcodeproj" ] || die "未生成 $PROJ_NAME.xcodeproj"
good "$PROJ_NAME.xcodeproj"

# ---------- 3. 归档 ----------
# 这一步关掉签名：跳过证书与描述文件，让编译在任何 Mac 上都能跑通。
# 真正的签名在下一步用 ad-hoc 补上。
say "编译并归档（Release / 暂不签名）"
rm -rf "$BUILD_DIR"
xcodebuild archive \
  -project "$PROJ_NAME.xcodeproj" \
  -scheme "$PROJ_NAME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$BUILD_DIR/$PROJ_NAME.xcarchive" \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  ONLY_ACTIVE_ARCH=NO \
  || die "xcodebuild archive 失败（上方日志里搜 'error:'）"

APP_PATH="$BUILD_DIR/$PROJ_NAME.xcarchive/Products/Applications/$PROJ_NAME.app"
[ -d "$APP_PATH" ] || die "归档目录里找不到 $PROJ_NAME.app：$APP_PATH"
good "$PROJ_NAME.app"

# ---------- 4. 补 ad-hoc 签名 ----------
# iOS 不会执行完全没有签名的 Mach-O，所以这里必须签一次。
# ad-hoc（--sign -）不需要任何证书，正是为了在没有开发者账号的机器上也能产出可安装包。
say "补 ad-hoc 签名（不需要证书）"
codesign --force --sign - --timestamp=none "$APP_PATH" || die "ad-hoc 签名失败"

# 签完立刻验一次：不验的话，签名失败可能以「打包成功但装不上」的形式延迟暴露。
codesign --verify --verbose=1 "$APP_PATH" 2>&1 | sed 's/^/  /' || die "签名校验未通过，产物不可用"
SIGINFO="$(codesign -dv "$APP_PATH" 2>&1 || true)"
printf '%s\n' "$SIGINFO" | grep -qi "Signature=adhoc" \
  || die "签名类型不是 adhoc。实际信息：$(printf '%s' "$SIGINFO" | grep -i 'signature' || echo 未知)"
good "签名类型：adhoc（无需证书，TrollStore 可直接安装）"

# 校验主二进制确实是 arm64 Mach-O —— 这一步同时在确认「签名没有把二进制写坏」
TMP_BIN="$(mktemp)"
if [ -f "$APP_PATH/$PROJ_NAME" ] && cp "$APP_PATH/$PROJ_NAME" "$TMP_BIN"; then
  MAGIC="$(od -An -tx1 -N4 "$TMP_BIN" | tr -d ' \n')"
  case "$MAGIC" in
    cffaedfe) good "主二进制为 arm64 Mach-O（魔数 $MAGIC）" ;;
    *) die "主二进制魔数异常：${MAGIC:-空}（预期 cffaedfe）—— 产物架构不对，装不上真机" ;;
  esac
else
  die "读不到主二进制：$APP_PATH/$PROJ_NAME"
fi
rm -f "$TMP_BIN"

# ---------- 5. 打包成 IPA ----------
# 注意：签名之后再不动 App 包内任何文件，否则签名会失效，只能重新签。
say "打包 IPA"
mkdir -p "$BUILD_DIR/Payload"
cp -R "$APP_PATH" "$BUILD_DIR/Payload/"
# -y 保留符号链接，-r 递归
( cd "$BUILD_DIR" && zip -qry "$IPA_NAME" Payload ) || die "zip 打包失败"
IPA="$BUILD_DIR/$IPA_NAME"
[ -f "$IPA" ] || die "未生成 IPA"
good "$(basename "$IPA")  $(du -h "$IPA" | cut -f1)"

# ---------- 6. 校验 IPA 内容 ----------
# 打包这一步最容易静默出错（比如 www 被拍平导致游戏文件没进去），所以逐项断言。
say "校验 IPA 内容"
LIST="$(unzip -Z1 "$IPA")"
check_member() {
  if printf '%s\n' "$LIST" | grep -qx "$1"; then
    good "$1"
  else
    die "IPA 里缺少 $1 —— 打包不完整，装上去也跑不起来"
  fi
}
check_member "Payload/$PROJ_NAME.app/$PROJ_NAME"
check_member "Payload/$PROJ_NAME.app/Info.plist"
check_member "Payload/$PROJ_NAME.app/www/index.html"
check_member "Payload/$PROJ_NAME.app/www/sw.js"
check_member "Payload/$PROJ_NAME.app/www/icons/icon-180.png"
# 签名清单必须也在包里，否则签名在打包环节丢了
check_member "Payload/$PROJ_NAME.app/_CodeSignature/CodeResources"

echo
say "完成"
cat <<EOF
  IPA 路径：$IPA
  IPA 文件名：$IPA_NAME

  安装方式：
    · TrollStore：把 IPA 传到手机 → TrollStore 打开 → Install。
      ad-hoc 签名即可安装，不需要再签一次，不会 7 天过期。
    · Sideloadly / AltStore / 开发者证书：直接选这个 IPA，它们会用你的证书覆盖重签。

  注意：Bundle ID 决定 App 的数据容器（也就是存档位置）。
    当前：com.example.xiangkouzaocan
    要改就改 ios/project.yml 里的 PRODUCT_BUNDLE_IDENTIFIER。
    换了 Bundle ID 就等于换新容器，旧存档读不到。
EOF
