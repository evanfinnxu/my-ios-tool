import UIKit

/// 应用入口。
/// 刻意不使用 Storyboard / SwiftUI：单 WebView 宿主用纯代码启动，
/// 依赖最少、构建期不确定性最低（Info.plist 里也不能有 UIApplicationSceneManifest，
/// 否则窗口生命周期会被 Scene 接管，导致 window 不显示）。
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
