//  OUR OWN READER INSIDE THE APP (n4): a web view nobody sees runs the website's scanner - reader_page.html with
//  page/app's finder.js (the stripe finder and the grey-line reader) and zxing - on frames the app hands it.
//
//  WHY (Brett's saved frames of n2 and n3, read with both readers, 2026-11-11): where the codes are small or soft our
//  reader found 2 to 3 times as many as Apple's in the same frame - 23 against 5-12 at 18 inches, 7-11 against 2-5 at
//  3 feet with 3x, 28 against 3-18 in the dim room, 45 against 27-32 at 2 feet with 3x - and neither read a wrong one.
//  His real use is 2 to 3 feet at 45 degrees: small, soft codes.
//
//  HOW. The page lives in the app's bundle and is served under slab://app/ (reader_page.html, finder_js.txt,
//  zxing_js.txt, zxing_wasm.dat - text and data names, so Xcode copies them and compiles nothing). The page asks
//  slab://app/frame and the app answers when it has a frame to be read: 16 bytes (frame number, width, height, 0)
//  and the grey plane. Its readings come back as a message ("slab"). Should the page fail to start, the app reads on
//  with Apple's reader alone and the test file says why.
import Foundation
import UIKit
import WebKit

struct WebRead {
    let text: String
    let kind: String
    let cls: Int                // 1 sure (A), 2 strong (B), 3 weak (C)
    let left: Double            // in dots of the frame, from its top-left
    let top: Double
    let right: Double
    let bottom: Double
}

final class WebReader: NSObject, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate {
    let id: Int
    weak var engine: Engine?
    private var webView: WKWebView?
    private var pending: WKURLSchemeTask?                   // main thread only: the page's open request for a frame
    private var live = Set<ObjectIdentifier>()              // main thread only: requests not yet answered or stopped
    private let lock = NSLock()
    private var waiting = false                             // the page has asked for a frame and has none yet
    private var isReady = false
    private var note = ""

    private static let files: [String: (String, String, String)] = [
        "/index.html": ("reader_page", "html", "text/html"),
        "/finder.js": ("finder_js", "txt", "application/javascript"),
        "/zxing.js": ("zxing_js", "txt", "application/javascript"),
        "/zxing_reader.wasm": ("zxing_wasm", "dat", "application/wasm")
    ]

    init(id: Int, engine: Engine) {
        self.id = id
        self.engine = engine
        super.init()
    }

    /// (main thread) The web view, put into `host` - a page outside every window is slowed down as a background page.
    func start(in host: UIView) {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(self, forURLScheme: "slab")
        cfg.userContentController.add(self, name: "slab")
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: cfg)
        wv.isUserInteractionEnabled = false
        wv.alpha = 0.02
        wv.isOpaque = false
        wv.navigationDelegate = self
        host.addSubview(wv)
        webView = wv
        if let url = URL(string: "slab://app/index.html?id=\(id)") {
            wv.load(URLRequest(url: url))
        }
    }

    /// (any thread) Is the page waiting for a frame?
    var wants: Bool {
        lock.lock()
        defer { lock.unlock() }
        return waiting && isReady
    }

    var ready: Bool {
        lock.lock()
        defer { lock.unlock() }
        return isReady
    }

    var state: String {
        lock.lock()
        defer { lock.unlock() }
        return isReady ? (note.isEmpty ? "ready" : "ready; " + note) : (note.isEmpty ? "not started" : note)
    }

    /// (any thread) Hands the waiting page a frame (lumaPacket). False when the page was not waiting after all.
    func give(_ packet: Data) -> Bool {
        lock.lock()
        let w = waiting
        waiting = false
        lock.unlock()
        if !w { return false }
        DispatchQueue.main.async {
            guard let t = self.pending, self.live.contains(ObjectIdentifier(t as AnyObject)) else { return }
            self.pending = nil
            self.live.remove(ObjectIdentifier(t as AnyObject))
            self.answer(t, packet, mime: "application/octet-stream")
        }
        return true
    }

    private func answer(_ task: WKURLSchemeTask, _ data: Data, mime: String) {
        guard let url = task.request.url else { return }
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-store"]
        if let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(r)
            task.didReceive(data)
            task.didFinish()
        }
    }

    private func remember(_ s: String) {
        lock.lock()
        note = s
        lock.unlock()
        engine?.webNote(id, s)
    }

    // MARK: - the page's requests (main thread)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let path = url.path
        if path == "/frame" {
            live.insert(ObjectIdentifier(urlSchemeTask as AnyObject))
            pending = urlSchemeTask
            lock.lock()
            waiting = true
            lock.unlock()
            return
        }
        if let m = WebReader.files[path], let f = Bundle.main.url(forResource: m.0, withExtension: m.1), let data = try? Data(contentsOf: f) {
            answer(urlSchemeTask, data, mime: m.2)
            return
        }
        remember("missing in the app: " + path)
        if let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"]) {
            urlSchemeTask.didReceive(r)
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        live.remove(ObjectIdentifier(urlSchemeTask as AnyObject))
        if let p = pending, (p as AnyObject) === (urlSchemeTask as AnyObject) {
            pending = nil
            lock.lock()
            waiting = false
            lock.unlock()
        }
    }

    // MARK: - the page itself (main thread)

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // the system ended the page's process (memory): every open request died with it - start the page again
        pending = nil
        live.removeAll()
        lock.lock()
        waiting = false
        isReady = false
        lock.unlock()
        remember("the page's process ended; started again")
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        remember("page: " + error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        remember("page did not load: " + error.localizedDescription)
    }

    // MARK: - the page's messages (main thread)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any] else { return }
        if d["ready"] != nil {
            lock.lock()
            isReady = true
            note = ""
            lock.unlock()
            engine?.webNote(id, "ready")
            return
        }
        let seq = (d["seq"] as? NSNumber)?.intValue ?? -1
        if let e = d["err"] as? String {
            remember(e)
            if seq >= 0 { engine?.webResult(reader: id, seq: seq, ms: 0, fill: 0, patches: 0, w: 0, h: 0, reads: [], failed: true) }
            return
        }
        if seq < 0 { return }
        var out: [WebRead] = []
        if let reads = d["reads"] as? [[Any]] {
            for r in reads where r.count >= 7 {
                guard let text = r[0] as? String, let kind = r[1] as? String, let c = r[2] as? String else { continue }
                guard let l = r[3] as? NSNumber, let t = r[4] as? NSNumber, let rr = r[5] as? NSNumber, let b = r[6] as? NSNumber else { continue }
                let cls = c == "A" ? 1 : (c == "B" ? 2 : 3)
                out.append(WebRead(text: text, kind: kind, cls: cls, left: l.doubleValue, top: t.doubleValue, right: rr.doubleValue, bottom: b.doubleValue))
            }
        }
        let ms = (d["ms"] as? NSNumber)?.doubleValue ?? 0
        let fill = (d["fill"] as? NSNumber)?.doubleValue ?? 0
        let patches = (d["boxes"] as? NSNumber)?.intValue ?? 0
        let w = (d["w"] as? NSNumber)?.intValue ?? 0
        let h = (d["h"] as? NSNumber)?.intValue ?? 0
        engine?.webResult(reader: id, seq: seq, ms: ms, fill: fill, patches: patches, w: w, h: h, reads: out, failed: false)
    }
}
