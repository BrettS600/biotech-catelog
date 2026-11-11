//  What is kept of a code, of a frame and of a test - and small helpers.
//  Numbers go into the files as whole numbers in small units (ms, microseconds, per mille, mm), so the files stay small
//  and exact; the field lists in the files say the unit of each.
import AVFoundation
import CoreVideo
import Foundation
import Vision

func ji(_ v: Double) -> Any {
    if !v.isFinite || abs(v) > 1e15 { return NSNull() }
    return Int(v.rounded())
}

func medianOf(_ a: [Double]) -> Double {
    if a.isEmpty { return .nan }
    let s = a.sorted()
    return s[s.count / 2]
}

func quantile(_ a: [Double], _ q: Double) -> Double {
    if a.isEmpty { return .nan }
    let s = a.sorted()
    let i = min(s.count - 1, max(0, Int(Double(s.count) * q)))
    return s[i]
}

func fourcc(_ v: FourCharCode) -> String {
    let b: [UInt8] = [UInt8((v >> 24) & 255), UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255)]
    return String(bytes: b, encoding: .ascii) ?? String(v)
}

func machineName() -> String {
    var u = utsname()
    uname(&u)
    return withUnsafePointer(to: &u.machine) { p in
        p.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
}

func kindName(_ s: VNBarcodeSymbology) -> String {
    if s == .code128 { return "Code 128" }
    if s == .i2of5 { return "ITF" }
    if s == .qr { return "QR" }
    if s == .code39 { return "Code 39" }
    return s.rawValue
}

/// A slab's cert number by its look: PSA = Code 128 of 8 or 9 digits, or ITF of exactly 8; CGC = Code 128 of 10 digits,
/// or 13 starting 1401 (the rules of the website's readers). Anything else that is read (a QR link, a part of a number)
/// is written down but never counted.
func slabCert(kind: String, text: String) -> Bool {
    if text.isEmpty { return false }
    for u in text.unicodeScalars { if u.value < 48 || u.value > 57 { return false } }
    let n = text.count
    if kind == "ITF" { return n == 8 }
    if kind == "Code 128" || kind == "Code 39" { return n == 8 || n == 9 || n == 10 || (n == 13 && text.hasPrefix("1401")) }
    return false
}

struct CodeRow: Identifiable {
    let id: String
    let kind: String
    let text: String
    let counted: Bool
    let sightings: Int
}

struct Box {
    let rect: CGRect            // 0-1, from the top-left of the picture as the camera gives it (lying on its side)
    let counted: Bool
}

struct Found {
    let kind: String
    let text: String
    let conf: Float
    let box: CGRect             // 0-1 of the whole picture, from the bottom-left (Vision's way)
}

final class CodeInfo {
    let kind: String
    let text: String
    let index: Int
    var frames = 0
    var firstMs = 0.0
    var countedMs: Double? = nil
    var minPx = Int.max
    var maxPx = 0
    var by: [String: Int] = [:]
    var firstBy = ""
    var conf: Float = 0
    var slab = false
    var need = 2
    var weak = 0                // reads Apple's reader was less than half sure of: written down, never counted

    init(kind: String, text: String, index: Int) {
        self.kind = kind
        self.text = text
        self.index = index
    }
}

final class FrameRec {
    var n = 0
    var t = 0.0                 // ms since the record tap
    var exp = 0.0               // seconds
    var iso = 0.0
    var lensPos = 0.0
    var af = false
    var ae = false
    var off = 0.0               // EV
    var mean = 0
    var p1 = 0
    var p99 = 0
    var blown = 0               // per mille
    var sharp = 0
    var capDen = 0
    var sweep = -1
    var depthMm = -1
    var job = ""
    var jobMs = 0.0
    var doneT = 0.0
    var found: [[Any]] = []
    var kept = 0
    var sizeMm = -1             // the distance by the size of the codes in this frame
    var speed = -1              // the picture's movement against the frame before, dots a second (-1: not known)
    var bias = 0.0              // the exposure bias in force, EV (the glare help's darker frames)
    var torch = false
    var fstate = 0              // the focus helper: 0 the camera's own, 1 asked to refocus, 2 trying positions, 3 held
    var light = 0.0             // the light: ISO x seconds the camera needs for the exposure it wants
    var readers = 0             // frames being read when this one came
}

final class Recording {
    let step: Int
    let plan: TestStep
    let t0: Double
    let startedAt = Date()
    let dir: URL
    let name: String
    var note = ""
    var settings: [String: Any] = [:]
    var camera: [String: Any] = [:]
    var frames: [FrameRec] = []
    var motion: [Double] = []
    var depth: [[Any]] = []
    var events: [[Any]] = []
    var snaps: [[String: Any]] = []
    var kept: [[String: Any]] = []
    var errors: [String] = []
    var lastKeptT = -10.0
    var writer: AVAssetWriter?
    var writerInput: AVAssetWriterInput?
    var writerFailed = false
    var videoFrames = 0
    var videoSkipped = 0
    var wantVideo = true
    var heatStart = 0
    var batteryStart: Float = 0
    var delivered = 0
    var cameraDropped = 0
    var jobs = 0
    var stopping = false
    var sweepIdx = -1
    var didLock = false
    var snapsAsked = 0

    init(step: Int, plan: TestStep, t0: Double, dir: URL, name: String) {
        self.step = step
        self.plan = plan
        self.t0 = t0
        self.dir = dir
        self.name = name
    }
}

struct FrameStats {
    var mean = 0
    var p1 = 0
    var p99 = 0
    var blown = 0
    var sharp = 0
    var cols: [Float] = []      // the picture summed down its columns, one value every 8 dots across
    var rows: [Float] = []      // ...and along its rows, one value every 8 dots down
}

/// How far profile `b` is shifted against `a`, in samples (b[i + d] ~ a[i]), or nil when no shift fits clearly.
/// Both are first freed of their slow light (each value less the mean of its 17 neighbours), then the shift with
/// the smallest mean difference within +-maxD wins, refined between samples by a parabola.
func shiftOf(_ a: [Float], _ b: [Float], maxD: Int) -> Double? {
    let n = a.count
    if n != b.count || n < 4 * maxD + 40 { return nil }
    func flat(_ p: [Float]) -> [Float] {
        var pre = [Float](repeating: 0, count: n + 1)
        for i in 0..<n { pre[i + 1] = pre[i] + p[i] }
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let lo = max(0, i - 8)
            let hi = min(n, i + 9)
            out[i] = p[i] - (pre[hi] - pre[lo]) / Float(hi - lo)
        }
        return out
    }
    let x = flat(a)
    let y = flat(b)
    var energy: Float = 0
    for i in maxD..<(n - maxD) { energy += abs(x[i]) }
    energy /= Float(n - 2 * maxD)
    if energy < 0.3 { return nil }              // nothing to hold on to (a blank or very dark picture)
    var sad = [Float](repeating: 0, count: 2 * maxD + 1)
    var best = 0
    var total: Float = 0
    for d in -maxD...maxD {
        var s: Float = 0
        var i = maxD
        while i < n - maxD {
            s += abs(x[i] - y[i + d])
            i += 1
        }
        sad[d + maxD] = s
        total += s
        if s < sad[best] { best = d + maxD }
    }
    let mean = total / Float(2 * maxD + 1)
    if sad[best] > 0.7 * mean { return nil }    // no shift is clearly better than the others
    var frac = 0.0
    if best > 0 && best < 2 * maxD {
        let l = Double(sad[best - 1])
        let c = Double(sad[best])
        let r = Double(sad[best + 1])
        let den = l - 2 * c + r
        if den > 1e-6 { frac = 0.5 * (l - r) / den }
    }
    return Double(best - maxD) + frac
}

/// Brightness and sharpness of a frame from its grey plane, every 8th dot each way (well under a millisecond).
/// Sharpness = the mean squared difference between dots two apart, in the middle three fifths of the picture.
/// n3: also the picture summed along its columns and rows - two frames' sums, slid over each other, tell how far
/// the picture moved between them (shiftOf).
func frameStats(_ pb: CVPixelBuffer) -> FrameStats {
    var out = FrameStats()
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return out }
    let w = CVPixelBufferGetWidthOfPlane(pb, 0)
    let h = CVPixelBufferGetHeightOfPlane(pb, 0)
    let rb = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
    if w < 64 || h < 64 { return out }
    let p = base.assumingMemoryBound(to: UInt8.self)
    var hist = [Int](repeating: 0, count: 256)
    var n = 0
    var sum = 0
    var grad = 0
    var gn = 0
    let x0 = w / 5
    let x1 = w - w / 5
    let y0 = h / 5
    let y1 = h - h / 5
    let nx = (w - 8 + 7) / 8
    let ny = (h - 8 + 7) / 8
    var colSum = [Int](repeating: 0, count: nx)
    var rowSum = [Int](repeating: 0, count: ny)
    var y = 4
    var iy = 0
    while y < h - 4 {
        let row = p + y * rb
        let inY = y >= y0 && y < y1
        var x = 4
        var ix = 0
        var rs = 0
        while x < w - 4 {
            let v = Int(row[x])
            hist[v] += 1
            rs += v
            colSum[ix] += v
            n += 1
            if inY && x >= x0 && x < x1 {
                let dx = Int(row[x + 2]) - v
                let dy = Int(row[x + 2 * rb]) - v
                grad += dx * dx + dy * dy
                gn += 1
            }
            x += 8
            ix += 1
        }
        sum += rs
        rowSum[iy] = rs
        y += 8
        iy += 1
    }
    if n == 0 { return out }
    out.cols = colSum.map { Float($0) / Float(max(1, ny)) }
    out.rows = rowSum.map { Float($0) / Float(max(1, nx)) }
    out.mean = sum / n
    var acc = 0
    var gotP1 = false
    for i in 0..<256 {
        acc += hist[i]
        if !gotP1 && acc * 100 >= n { out.p1 = i; gotP1 = true }
        if acc * 100 >= n * 99 { out.p99 = i; break }
    }
    var hi = 0
    for i in 250..<256 { hi += hist[i] }
    out.blown = hi * 1000 / n
    out.sharp = gn > 0 ? grad / gn : 0
    return out
}

/// The grey plane of a frame, row by row without the padding: exactly the dots the reader saw.
func copyLuma(_ pb: CVPixelBuffer) -> (Data, Int, Int)? {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return nil }
    let w = CVPixelBufferGetWidthOfPlane(pb, 0)
    let h = CVPixelBufferGetHeightOfPlane(pb, 0)
    let rb = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
    var d = Data(count: w * h)
    d.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) in
        guard let dp = dst.baseAddress else { return }
        for y in 0..<h {
            memcpy(dp + y * w, base + y * rb, w)
        }
    }
    return (d, w, h)
}
