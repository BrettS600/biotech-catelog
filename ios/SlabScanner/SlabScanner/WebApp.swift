//  THE WEBSITE'S APP INSIDE THE NATIVE APP (n5, 2026-11-11). Brett: "I intend to use the native app rather than the browser
//  app ... make the native app look identical to the browser app, but with a few exceptions. Keep the testing part for the
//  barcode scanner ... remove that part ["Review: is it the right card?"] and replace it with the review button that we
//  have on the site."
//
//  So the native app SHOWS THE WEBSITE'S APP ITSELF (page/app, live from the website - the same app by construction, and
//  every change to it arrives without a reinstall) in a web view, and does natively only what a browser cannot:
//  - a recording: the page asks (scanStart) and the camera screen opens (ScannerView): this app's camera, shutter, focus
//    and lamp, Apple's reader and our own on every frame; each slab number counted goes back to the page
//    (sscNativeIn.read), which looks it up and files it at the table exactly as its own scanner would;
//  - Test mode: the page's button opens this app's test screen (ContentView), unchanged;
//  - Review: on a slab's sheet the page shows the website's own blue Review button; it opens THE WEBSITE'S Review of that
//    card and grade in a sheet (the website itself, in a second web view kept for the next time: #review/<card>/<grader>/<grade>).
//  The pages keep their own storage in this app (the site password typed once on the Show tab, the PSA token pasted once;
//  the website asks for its password once - tick "Remember me").
import SwiftUI
import UIKit
import WebKit

struct ReviewTarget: Identifiable {
    let id = UUID()
    let key: String             // card|grader|grade, as the website's graded view keys its rows
    let name: String
}

final class WebApp: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    static let appURL = URL(string: "https://bretts600.github.io/biotech-catelog/app/")!
    static let siteBase = "https://bretts600.github.io/biotech-catelog/"

    let engine = Engine()
    let container = UIView()
    private(set) var web: WKWebView!
    private(set) var reviewWeb: WKWebView?

    @Published var scanning = false
    @Published var testing = false
    @Published var review: ReviewTarget?
    @Published var reviewLoading = false
    @Published var title = ""
    @Published var feed: [[String]] = []
    @Published var feedN = 0
    @Published var dup = ""
    @Published var loadProblem = ""
    @Published var scanLens: Lens = .wide
    var scanStarted = Date()

    override init() {
        super.init()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "sscNative")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0x0D / 255.0, green: 0x11 / 255.0, blue: 0x17 / 255.0, alpha: 1)
        wv.scrollView.contentInsetAdjustmentBehavior = .never     // the page lays itself out round the notch (viewport-fit=cover)
        wv.allowsBackForwardNavigationGestures = false
        web = wv
        container.backgroundColor = wv.backgroundColor
        // our own reader's two web views live here, in the window for good (a web view out of the window is slowed down)
        engine.startWebReaders(host: container)
        wv.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            wv.topAnchor.constraint(equalTo: container.topAnchor),
            wv.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        wv.load(URLRequest(url: WebApp.appURL))
        engine.onCode = { [weak self] kind, text, added in self?.codeCounted(kind: kind, text: text, added: added) }
    }

    // MARK: - the page's requests

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], let cmd = d["cmd"] as? String else { return }
        if message.name == "sscReview" {
            if cmd == "closed" { review = nil }
            return
        }
        switch cmd {
        case "scanStart":
            title = (d["title"] as? String) ?? ""
            scanLens = (d["lens"] as? String) == "tele" ? .tele : .wide
            feed = []
            feedN = 0
            dup = ""
            startScan()
        case "scanStop":
            if scanning { endScan(tellPage: false) }
        case "feed":
            feedN = (d["n"] as? NSNumber)?.intValue ?? feedN
            feed = ((d["items"] as? [[Any]]) ?? []).map { $0.map { "\($0)" } }
            dup = (d["dup"] as? String) ?? ""
        case "test":
            if scanning { return }
            engine.openCamera(scan: nil)
            testing = true
        case "review":
            let cid = (d["cid"] as? String) ?? ""
            let gk = (d["gk"] as? String) ?? ""
            if cid.isEmpty || gk.isEmpty { return }
            openReview(ReviewTarget(key: cid + "|" + gk, name: (d["name"] as? String) ?? ""))
        default:
            break
        }
    }

    // MARK: - the camera screen

    private func startScan() {
        engine.openCamera(scan: scanLens)
        engine.lock.lock()
        engine.forward = true
        engine.outbox.removeAll()
        engine.lock.unlock()
        engine.setLive(false)
        engine.setLive(true)                    // (a fresh count for this table)
        scanStarted = Date()
        scanning = true
    }

    /// Stop on the camera screen: the page ends the recording (its table opens), the camera goes off.
    func endScan(tellPage: Bool = true) {
        scanning = false
        engine.closeCamera()
        if tellPage { call("window.sscNativeIn && sscNativeIn.stop()") }
    }

    func setLens(_ l: Lens) {
        scanLens = l
        engine.lens = l
        engine.apply()
        call("window.sscNativeIn && sscNativeIn.lens(" + js(l == .tele ? "tele" : "main") + ")")
    }

    func setLight(_ m: LightMode) {
        engine.scanLight = m
        engine.light = m
        engine.apply()
    }

    private func codeCounted(kind: String, text: String, added: Bool) {
        if !scanning { return }
        if added { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        call("window.sscNativeIn && sscNativeIn." + (added ? "read(" : "unread(") + js(text) + "," + js(kind) + ")")
    }

    func closeTest() {
        if engine.recording || engine.saving { return }
        testing = false
        engine.closeCamera()
    }

    // MARK: - the website's Review

    private func openReview(_ t: ReviewTarget) {
        review = t
        let p = t.key.split(separator: "|").map(String.init)
        if p.count < 3 { return }
        let hash = "#review/" + p[0] + "/" + p[1] + "/" + p[2]
        if let rw = reviewWeb, rw.url != nil {
            // the website is open already: its Review straight away (or, while it still asks for its password, after that)
            rw.evaluateJavaScript("(typeof grReviewOpen === 'function') ? (grReviewOpen(" + js(t.key) + "), 1) : (location.hash = " + js(hash) + ", 0)") { _, err in
                if err != nil { rw.load(URLRequest(url: URL(string: WebApp.siteBase + hash)!)) }
            }
            return
        }
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "sscReview")
        let rw = WKWebView(frame: .zero, configuration: cfg)
        rw.navigationDelegate = self
        rw.uiDelegate = self
        rw.backgroundColor = .systemBackground
        reviewWeb = rw
        reviewLoading = true
        if let u = URL(string: WebApp.siteBase + hash) { rw.load(URLRequest(url: u)) }
    }

    // MARK: - navigation: the app's pages stay here, every other link opens in Safari

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = navigationAction.request.url else { return decisionHandler(.cancel) }
        let mine = u.host == "bretts600.github.io" && u.path.hasPrefix("/biotech-catelog")
        if !(navigationAction.targetFrame?.isMainFrame ?? false) && navigationAction.targetFrame != nil { return decisionHandler(.allow) }   // (frames inside a page)
        if mine || u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" { return decisionHandler(.allow) }
        if u.scheme == "http" || u.scheme == "https" || u.scheme == "mailto" || u.scheme == "tel" { UIApplication.shared.open(u) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { UIApplication.shared.open(u) }   // a link that opens a new tab: Safari
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === web { loadProblem = "" }
        if webView === reviewWeb { reviewLoading = false }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === web { loadProblem = "The app's page did not load (" + error.localizedDescription + "). It needs signal to open; tap to try again." }
        if webView === reviewWeb { reviewLoading = false }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()                        // (the system ended the page's process: start it again; the page keeps its tables)
    }

    func reloadApp() {
        loadProblem = ""
        web.load(URLRequest(url: WebApp.appURL))
    }

    // MARK: - helpers

    private func call(_ script: String) {
        web.evaluateJavaScript(script, completionHandler: nil)
    }

    private func js(_ s: String) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: [s]), let t = String(data: d, encoding: .utf8) {
            return String(t.dropFirst().dropLast())         // a JSON string: safe to put into a script
        }
        return "\"\""
    }
}

/// The website's app, filling the screen.
struct WebAppView: UIViewRepresentable {
    let app: WebApp
    func makeUIView(context: Context) -> UIView { app.container }
    func updateUIView(_ v: UIView, context: Context) {}
}

/// The website's own Review of a card, in a sheet over the app.
struct ReviewSheet: View {
    @ObservedObject var app: WebApp
    let target: ReviewTarget

    var body: some View {
        NavigationStack {
            ZStack {
                if let rw = app.reviewWeb {
                    ReviewWebView(web: rw)
                }
                if app.reviewLoading {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Opening the website’s Review… The first time, the website asks for its password (tick Remember me).")
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 30)
                    }
                }
            }
            .navigationTitle(target.name.isEmpty ? "Review" : target.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { app.review = nil }
                }
            }
        }
    }
}

struct ReviewWebView: UIViewRepresentable {
    let web: WKWebView
    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ v: WKWebView, context: Context) {}
}
