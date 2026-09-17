import UIKit
import WebKit

/// 游戏宿主：一个全屏 WKWebView + 一条原生存档桥。
///
/// 为什么需要原生桥：
///   WKWebView 在 file:// 源下 localStorage 不保证跨启动持久化，正常表现是
///   每次冷启动都回到初始存档。因此这里把存档改由 App 沙盒（UserDefaults）承担：
///   - 文档启动前注入 `window.__ZAOCAN_SAVE__`
///   - 网页调用 save() 时通过 messageHandler 回写
///   - 导出时弹系统分享面板（WKWebView 不支持 blob 下载）
final class GameViewController: UIViewController {

    private static let bridgeName = "zaocan"
    /// 与 index.html 中的 SAVE_KEY 保持一致
    private static let saveKey = "xiangkou_zaocan_save_v1"

    private var webView: WKWebView!
    private let background = UIColor(red: 0.984, green: 0.965, blue: 0.925, alpha: 1.0)

    // MARK: - 存档落盘

    /// 「文件」App 里可见的那份存档（Info.plist 开了 UIFileSharingEnabled）。
    /// 存在的意义：存档是可手改的——在「文件」里编辑后重启 App 即生效。
    private static var documentsSaveURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("xiangkou-zaocan-save.json")
    }

    private static func isValidSave(_ text: String) -> Bool {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) else { return false }
        return obj is [String: Any]
    }

    /// 缩进格式化，方便用户直接手改
    private static func prettyPrinted(_ text: String) -> String {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(
                withJSONObject: obj, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
              let out = String(data: pretty, encoding: .utf8) else { return text }
        return out
    }

    /// 决定注入哪份存档。
    /// 顺序：Documents 里用户可编辑的那份 → UserDefaults → 无（首次启动）。
    /// 用户把 JSON 改坏了也不会卡死：校验不过就退回 UserDefaults。
    private static func resolveSaveLiteral() -> String {
        if let url = documentsSaveURL,
           let text = try? String(contentsOf: url, encoding: .utf8),
           isValidSave(text) {
            UserDefaults.standard.set(text, forKey: saveKey)
            return text
        }
        return UserDefaults.standard.string(forKey: saveKey) ?? "null"
    }

    /// 双写：UserDefaults（权威）+ Documents（用户可见可改）
    private static func persist(_ text: String) {
        UserDefaults.standard.set(text, forKey: saveKey)
        if let url = documentsSaveURL {
            try? prettyPrinted(text).write(to: url, atomically: true, encoding: .utf8)
        }
    }

    /// 首次启动时把默认存档也落一份到 Documents，让用户能找到这个文件
    private static func ensureDocumentsSaveExists() {
        guard let url = documentsSaveURL, !FileManager.default.fileExists(atPath: url.path) else { return }
        let text = UserDefaults.standard.string(forKey: saveKey) ?? "{}"
        try? prettyPrinted(text).write(to: url, atomically: true, encoding: .utf8)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = background

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        let controller = config.userContentController
        controller.add(self, name: Self.bridgeName)
        controller.addUserScript(WKUserScript(
            source: Self.saveInjectionScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        // 页面自身已按一屏布局排好，宿主的滚动/回弹只会添乱
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        self.webView = webView

        loadGame()
    }

    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { [.portrait, .landscape] }

    // MARK: - 载入

    private func loadGame() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") else {
            showFatal("打包错误：Bundle 里找不到 www/index.html。\n请确认 project.yml 中 www 是以 folder 引用的。")
            return
        }
        // 只允许读 www 目录，避免 WebView 访问沙盒其他位置
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private static func saveInjectionScript() -> String {
        Self.ensureDocumentsSaveExists()
        // 值本身就是 JSON 文本，直接作为 JS 字面量注入；无存档时注入 null
        let literal = Self.resolveSaveLiteral()
        return "window.__ZAOCAN_SAVE__ = \(literal);"
    }

    private func showFatal(_ message: String) {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 15)
        label.textColor = UIColor(red: 0.35, green: 0.28, blue: 0.18, alpha: 1)
        label.text = message
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28)
        ])
    }

    // MARK: - 存档导出

    private func shareSave(text: String, filename: String) {
        // 兜底：先进剪贴板，即使用户取消分享也能粘贴出去改
        UIPasteboard.general.string = text

        let safeName = filename.isEmpty ? "xiangkou-zaocan-save.json" : filename
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try text.write(to: tmp, atomically: true, encoding: .utf8)
        } catch {
            return
        }

        let sheet = UIActivityViewController(activityItems: [tmp], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        present(sheet, animated: true)
    }
}

// MARK: - 原生桥

extension GameViewController: WKScriptMessageHandler {

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.bridgeName,
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else { return }

        switch cmd {
        case "save":
            guard let data = body["data"] as? String else { return }
            Self.persist(data)

        case "export":
            let text = body["data"] as? String ?? ""
            let name = body["name"] as? String ?? "xiangkou-zaocan-save.json"
            shareSave(text: text, filename: name)

        default:
            break
        }
    }
}

// MARK: - 导航策略

extension GameViewController: WKNavigationDelegate {

    /// 游戏完全本地运行。任何外部跳转都在系统浏览器打开，WebView 自身不留外链。
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        if url.isFileURL || url.scheme == "about" || url.scheme == "data" {
            decisionHandler(.allow); return
        }
        if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFatal("游戏载入失败：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFatal("游戏载入失败：\(error.localizedDescription)")
    }
}
