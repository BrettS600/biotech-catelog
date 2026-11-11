//  The camera, its controls, the reader and the live state of the screen.
//
//  WHAT A WEB PAGE CANNOT DO AND THIS CAN (the reason for the trial; Brett's 16 web test files, 2026-11-10: the page
//  read 5-9 of the camera's 25 frames a second, a quarter to two thirds of the frames were blurred, and Safari offered
//  no shutter, exposure or focus control):
//  - THE SHUTTER: the camera keeps choosing its exposure, but may not use a shutter slower than a cap
//    (activeMaxExposureDuration) - so it raises the sensitivity instead of blurring. "Smart" = 1/250 with 1x, 1/500 with
//    3x, one step slower at a time when the picture is more than 1 EV too dark at the highest sensitivity, back when the
//    light returns. "Auto" = the camera's own choice (what the web page got). Fixed caps for trying.
//  - THE SIZE: 4032 x 3024 at 30 a second (1.4 times the dots across of the page's 4K), or 4K at 60.
//  - THE FOCUS: continuous (not the slow "smooth" kind), or locked where it is.
//  - THE FRAMES READ by Apple's barcode reader (Vision), three at a time, as overlapping tiles: four (Q), nine (N),
//    sixteen (S), thirty-six (T) in turn - the reader reduces whatever region it gets, and found nothing in the whole
//    12 MP picture (see `cycle` below).
//    A code counts as a slab when it looks like a cert (slabCert) and was read in 2 frames (ITF, which has no check
//    digit: 3 frames).
//  - THE DEPTH SENSOR (LiDAR; with the 1x lens only - the sensor is paired with that lens): the distance at the centre
//    and on a 5 x 5 grid, about 15 times a second. n1: it said 2 m with the sheet at 9 and 13 inches - not to be
//    trusted this close (or through a glossy sleeve); THE DISTANCE BY THE CODES' SIZE (a slab's barcode is 17.5 or
//    18.4 mm wide) agreed with the picture's geometry and is what the screen and the report show.
//  - WHAT THE CAMERA DID for every frame: shutter, sensitivity, focus position, whether focus / exposure were moving.
//  - MOVEMENT 100 times a second on the camera's own clock.
import AVFoundation
import CoreMotion
import ImageIO
import SwiftUI
import UIKit
import Vision

struct CamCfg: Equatable {
    var lens = Lens.wide
    var size = SizeMode.mp12
    var depth = true
}

final class Engine: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureDepthDataOutputDelegate, AVCapturePhotoCaptureDelegate {

    // what the screen shows
    @Published var rows: [CodeRow] = []
    @Published var countedN = 0
    @Published var boxes: [Box] = []
    @Published var status = "Starting the camera…"
    @Published var recording = false
    @Published var elapsed = 0.0
    @Published var result = ""
    @Published var shareURL: URL? = nil
    @Published var shareSize = ""
    @Published var saving = false
    @Published var problem = ""
    @Published var snapNote = ""

    // the switches
    @Published var lens: Lens = .wide
    @Published var size: SizeMode = .mp12
    @Published var shutter: ShutterMode = .smart
    @Published var focus: FocusMode = .auto
    @Published var depthOn = true
    @Published var videoOn = true
    @Published var lightOn = false
    @Published var live = false
    @Published var step = 0
    @Published var note = ""

    let session = AVCaptureSession()
    weak var preview: PreviewUIView?

    let sessionQ = DispatchQueue(label: "slab.session")
    let captureQ = DispatchQueue(label: "slab.capture", qos: .userInitiated)
    let depthQ = DispatchQueue(label: "slab.depth")
    let readers = DispatchQueue(label: "slab.readers", qos: .userInitiated, attributes: .concurrent)
    let io = DispatchQueue(label: "slab.io", qos: .utility)
    let videoOut = AVCaptureVideoDataOutput()
    let depthOut = AVCaptureDepthDataOutput()
    let photoOut = AVCapturePhotoOutput()
    let motion = CMMotionManager()
    let motionQ = OperationQueue()
    let lock = NSLock()
    let maxReaders = 3

    var device: AVCaptureDevice?
    var cur = CamCfg()
    var configured = false
    var usingLidar = false
    var camInfo: [String: Any] = [:]
    var started = false
    var timer: Timer?

    // under the lock
    var codes: [String: CodeInfo] = [:]
    var order: [CodeInfo] = []
    var counted = 0
    var inFlight = 0
    var jobSeq = 0
    var visionMs: [String: [Double]] = [:]
    var lastBoxes: [Box] = []
    var lastBoxesAt = 0.0
    var rec: Recording?
    var reading = false
    var liveT0 = 0.0
    var frameNo = 0
    var capDen = 0
    var shutterMode = ShutterMode.smart
    var lensNow = Lens.wide
    var sweepStep = -1
    var lastDepthMm = -1
    var lastDepthAt = 0.0
    var lastExp = 0.0
    var lastISO = 0.0
    var lastLensPos = 0.0
    var lastW = 0
    var lastH = 0
    var readTimes: [Double] = []
    var snapAskedAt = 0.0
    var focalPx = 3000.0            // the lens' focal length in dots of the picture (from its field of view)
    var lastSizeMm = -1
    var lastSizeAt = 0.0

    // the capture thread's own
    var lastSmart = 0.0
    var depthCount = 0

    // n1's first two tests (2026-11-10): the whole picture (W) found NOTHING at 9 and at 14 inches - Apple's reader
    // reduces whatever region it is given to its own working size (a region took ~15 ms whatever its size: Q 62 ms
    // for four, N 123 ms for nine, W 91 ms) - while the four tiles found every code at 9 inches and the nine tiles
    // read the fine CGC codes at 14 inches twice as often as the four. So: tiles only, and finer ones in turn
    // (S sixteen, T thirty-six - if a small region is enlarged to the working size, they reach further).
    static let cycle = ["Q", "N", "S", "Q", "N", "T"]
    static let snapKinds = ["W", "Q", "N", "S", "T"]
    static let rois: [String: [CGRect]] = [
        "W": [CGRect(x: 0, y: 0, width: 1, height: 1)],
        "Q": Engine.tiles(2, 0.12),
        "N": Engine.tiles(3, 0.10),
        "S": Engine.tiles(4, 0.08),
        "T": Engine.tiles(6, 0.06)
    ]

    /// n x n tiles over the picture, neighbours overlapping by `overlap` of the picture.
    static func tiles(_ n: Int, _ overlap: CGFloat) -> [CGRect] {
        var out: [CGRect] = []
        let s = (1 + overlap * CGFloat(n - 1)) / CGFloat(n)
        let step = n > 1 ? (1 - s) / CGFloat(n - 1) : 0
        for y in 0..<n {
            for x in 0..<n {
                out.append(CGRect(x: CGFloat(x) * step, y: CGFloat(y) * step, width: s, height: s))
            }
        }
        return out
    }

    // MARK: - starting

    func start() {
        if started { return }
        started = true
        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        motionQ.maxConcurrentOperationCount = 1
        loadPlan()
        videoOut.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        videoOut.alwaysDiscardsLateVideoFrames = true
        videoOut.automaticallyConfiguresOutputBufferDimensions = false
        videoOut.deliversPreviewSizedOutputBuffers = false
        videoOut.setSampleBufferDelegate(self, queue: captureQ)
        depthOut.isFilteringEnabled = false     // n2: the sensor's own numbers (n1's smoothed ones said 2 m at 9 inches)
        depthOut.alwaysDiscardsLateDepthData = true
        depthOut.setDelegate(self, callbackQueue: depthQ)
        photoOut.maxPhotoQualityPrioritization = .quality
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                if ok {
                    self.apply(startSession: true)
                } else {
                    self.problem = "The camera is switched off for this app: Settings > Apps > Slab Scanner > Camera."
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            self?.tick()
        }
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { [weak self] _ in
            self?.event("heat", String(ProcessInfo.processInfo.thermalState.rawValue))
        }
    }

    // MARK: - the plan and the switches (main thread)

    func loadPlan() {
        let p = TestPlan.steps[step]
        lens = p.lens
        size = p.size
        shutter = p.shutter
        focus = p.focus
        depthOn = p.depth
    }

    func stepBy(_ d: Int) {
        if recording || saving { return }
        step = min(TestPlan.steps.count - 1, max(0, step + d))
        note = ""
        loadPlan()
        apply()
    }

    func apply(startSession: Bool = false) {
        let c = CamCfg(lens: lens, size: size, depth: depthOn)
        let sh = shutter
        let fo = focus
        let li = lightOn
        sessionQ.async {
            if !self.configured || c != self.cur { self.configure(c) }
            self.lock.lock()
            self.shutterMode = sh
            self.lensNow = c.lens
            self.lock.unlock()
            switch sh {
            case .auto: self.setCap(nil)
            case .smart: self.setCap(c.lens == .tele ? 500 : 250)
            default: self.setCap(sh.den)
            }
            self.setFocus(fo)
            self.setTorch(li)
            if startSession && !self.session.isRunning { self.session.startRunning() }
        }
    }

    func setLive(_ on: Bool) {
        lock.lock()
        if on && rec == nil {
            codes = [:]
            order = []
            counted = 0
            liveT0 = CACurrentMediaTime()
        }
        reading = on || rec != nil
        lock.unlock()
    }

    func event(_ what: String, _ detail: String) {
        lock.lock()
        if let r = rec {
            r.events.append([Int((CACurrentMediaTime() - r.t0) * 1000), what, detail])
        }
        lock.unlock()
    }

    func logError(_ r: Recording, _ s: String) {
        lock.lock()
        r.errors.append(s)
        lock.unlock()
    }

    // MARK: - the camera (session thread)

    func pickFormat(_ d: AVCaptureDevice, _ size: SizeMode, needDepth: Bool) -> AVCaptureDevice.Format? {
        let wantW: Int32 = size == .k4 ? 3840 : 4032
        let wantH: Int32 = size == .k4 ? 2160 : 3024
        let wantFps: Double = size == .k4 ? 60 : 30
        var best: AVCaptureDevice.Format? = nil
        var bestScore = -1.0
        for f in d.formats {
            let desc = f.formatDescription
            if CMFormatDescriptionGetMediaSubType(desc) != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange { continue }
            if needDepth && f.supportedDepthDataFormats.isEmpty { continue }
            let dim = CMVideoFormatDescriptionGetDimensions(desc)
            var maxFps = 0.0
            for r in f.videoSupportedFrameRateRanges { maxFps = max(maxFps, r.maxFrameRate) }
            var score = Double(dim.width) * Double(dim.height) / 1e6
            if dim.width == wantW && dim.height == wantH { score += 1000 }
            if maxFps >= wantFps { score += 100 }
            if !f.isVideoBinned { score += 10 }
            if score > bestScore {
                bestScore = score
                best = f
            }
        }
        return best
    }

    func pickDepth(_ fmt: AVCaptureDevice.Format) -> AVCaptureDevice.Format? {
        var best: AVCaptureDevice.Format? = nil
        var bestW: Int32 = 0
        for f in fmt.supportedDepthDataFormats {
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            if sub != kCVPixelFormatType_DepthFloat32 && sub != kCVPixelFormatType_DepthFloat16 { continue }
            let w = CMVideoFormatDescriptionGetDimensions(f.formatDescription).width
            if w > bestW || (w == bestW && sub == kCVPixelFormatType_DepthFloat32) {
                best = f
                bestW = w
            }
        }
        return best ?? fmt.supportedDepthDataFormats.last
    }

    func fail(_ s: String) {
        DispatchQueue.main.async { self.problem = s }
    }

    func configure(_ c: CamCfg) {
        var dev: AVCaptureDevice? = nil
        var lidar = false
        if c.depth && c.lens == .wide {
            if let d = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back), pickFormat(d, c.size, needDepth: true) != nil {
                dev = d
                lidar = true
            }
        }
        if dev == nil {
            let type: AVCaptureDevice.DeviceType = c.lens == .tele ? .builtInTelephotoCamera : .builtInWideAngleCamera
            dev = AVCaptureDevice.default(type, for: .video, position: .back)
        }
        if dev == nil {
            dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        }
        guard let d = dev else {
            fail("No back camera was found.")
            return
        }
        guard let fmt = pickFormat(d, c.size, needDepth: lidar) else {
            fail("The camera offers no picture format this app can use.")
            return
        }
        session.beginConfiguration()
        for i in session.inputs { session.removeInput(i) }
        do {
            let input = try AVCaptureDeviceInput(device: d)
            if session.canAddInput(input) { session.addInput(input) }
        } catch {
            fail("The camera could not be opened: \(error.localizedDescription)")
        }
        if !session.outputs.contains(videoOut) && session.canAddOutput(videoOut) { session.addOutput(videoOut) }
        if !session.outputs.contains(photoOut) && session.canAddOutput(photoOut) { session.addOutput(photoOut) }
        if lidar {
            if !session.outputs.contains(depthOut) && session.canAddOutput(depthOut) { session.addOutput(depthOut) }
        } else if session.outputs.contains(depthOut) {
            session.removeOutput(depthOut)
        }
        var fps = 30.0
        var depthName = ""
        do {
            try d.lockForConfiguration()
            d.activeFormat = fmt
            var maxFps = 0.0
            for r in fmt.videoSupportedFrameRateRanges { maxFps = max(maxFps, r.maxFrameRate) }
            fps = min(c.size == .k4 ? 60.0 : 30.0, maxFps)
            if fps >= 1 {
                let dur = CMTime(value: 1, timescale: CMTimeScale(fps.rounded()))
                d.activeVideoMinFrameDuration = dur
                d.activeVideoMaxFrameDuration = dur
            }
            if lidar, let df = pickDepth(fmt) {
                d.activeDepthDataFormat = df
                let dd = CMVideoFormatDescriptionGetDimensions(df.formatDescription)
                depthName = "\(dd.width)x\(dd.height) " + fourcc(CMFormatDescriptionGetMediaSubType(df.formatDescription))
            }
            if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
            if d.isSmoothAutoFocusSupported { d.isSmoothAutoFocusEnabled = false }
            if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
            if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
            d.automaticallyAdjustsVideoHDREnabled = false
            d.unlockForConfiguration()
        } catch {
            fail("The camera could not be set: \(error.localizedDescription)")
        }
        session.commitConfiguration()
        if let conn = videoOut.connection(with: .video), conn.isVideoStabilizationSupported {
            conn.preferredVideoStabilizationMode = .off
        }
        var best = CMVideoDimensions(width: 0, height: 0)
        for pd in d.activeFormat.supportedMaxPhotoDimensions {
            if Int(pd.width) * Int(pd.height) > Int(best.width) * Int(best.height) { best = pd }
        }
        if best.width > 0 && session.outputs.contains(photoOut) { photoOut.maxPhotoDimensions = best }

        let dim = CMVideoFormatDescriptionGetDimensions(fmt.formatDescription)
        var info: [String: Any] = [:]
        info["device"] = d.localizedName
        info["type"] = d.deviceType.rawValue
        info["width"] = Int(dim.width)
        info["height"] = Int(dim.height)
        info["framesPerSecond"] = Int(fps.rounded())
        info["pixelFormat"] = fourcc(CMFormatDescriptionGetMediaSubType(fmt.formatDescription))
        info["binned"] = fmt.isVideoBinned
        info["fieldOfViewDegreesX10"] = Int(fmt.videoFieldOfView * 10)
        info["minISO"] = Int(fmt.minISO)
        info["maxISO"] = Int(fmt.maxISO)
        info["shortestShutterMicroseconds"] = ji(fmt.minExposureDuration.seconds * 1e6)
        info["longestShutterMicroseconds"] = ji(fmt.maxExposureDuration.seconds * 1e6)
        info["depthSensor"] = lidar
        info["depthFormat"] = depthName
        info["closestFocusMm"] = d.minimumFocusDistance
        info["photoWidth"] = Int(best.width)
        info["photoHeight"] = Int(best.height)
        info["lensAperture"] = Int(d.lensAperture * 100)
        device = d
        cur = c
        configured = true
        usingLidar = lidar
        let half = Double(fmt.videoFieldOfView) * Double.pi / 360
        let fpx = half > 0.01 ? Double(dim.width) / 2 / tan(half) : 3000
        info["focalLengthDots"] = Int(fpx.rounded())
        lock.lock()
        camInfo = info
        focalPx = fpx
        lastDepthMm = -1
        lastSizeMm = -1
        lock.unlock()
        DispatchQueue.main.async {
            self.preview?.upright()
        }
        event("camera", "\(d.localizedName) \(dim.width)x\(dim.height) at \(Int(fps.rounded()))" + (lidar ? " with the depth sensor" : ""))
    }

    /// The slowest shutter the camera may choose, 1/den of a second (nil: its own choice).
    func setCap(_ den: Int?) {
        guard let d = device else { return }
        do {
            try d.lockForConfiguration()
            if let den = den {
                var t = CMTime(value: 1, timescale: CMTimeScale(den))
                let lo = d.activeFormat.minExposureDuration
                let hi = d.activeFormat.maxExposureDuration
                if CMTimeCompare(t, lo) < 0 { t = lo }
                if CMTimeCompare(t, hi) > 0 { t = hi }
                d.activeMaxExposureDuration = t
            } else {
                d.activeMaxExposureDuration = CMTime.invalid
            }
            if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
            d.unlockForConfiguration()
            lock.lock()
            capDen = den ?? 0
            lock.unlock()
        } catch {
        }
    }

    func setFocus(_ m: FocusMode) {
        guard let d = device else { return }
        do {
            try d.lockForConfiguration()
            if m == .locked {
                if d.isLockingFocusWithCustomLensPositionSupported {
                    d.setFocusModeLocked(lensPosition: AVCaptureDevice.currentLensPosition, completionHandler: nil)
                } else if d.isFocusModeSupported(.locked) {
                    d.focusMode = .locked
                }
            } else if d.isFocusModeSupported(.continuousAutoFocus) {
                d.focusMode = .continuousAutoFocus
            }
            d.unlockForConfiguration()
        } catch {
        }
    }

    func setTorch(_ on: Bool) {
        guard let d = device, d.hasTorch, d.isTorchAvailable else { return }
        do {
            try d.lockForConfiguration()
            if on {
                try d.setTorchModeOn(level: 1.0)
            } else {
                d.torchMode = .off
            }
            d.unlockForConfiguration()
        } catch {
        }
    }

    // MARK: - every frame (capture thread)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        let dev = device
        var expS = 0.0
        var iso = 0.0
        if let ex = CMGetAttachment(sampleBuffer, key: "{Exif}" as CFString, attachmentModeOut: nil) as? [String: Any] {
            if let v = ex["ExposureTime"] as? Double { expS = v }
            if let a = ex["ISOSpeedRatings"] as? [Any], let n = a.first as? NSNumber { iso = n.doubleValue }
        }
        var lensPos = 0.0
        var off = 0.0
        var af = false
        var ae = false
        if let d = dev {
            if expS <= 0 { expS = d.exposureDuration.seconds }
            if iso <= 0 { iso = Double(d.iso) }
            lensPos = Double(d.lensPosition)
            off = Double(d.exposureTargetOffset)
            af = d.isAdjustingFocus
            ae = d.isAdjustingExposure
        }
        let st = frameStats(pb)
        let pw = CVPixelBufferGetWidth(pb)
        let ph = CVPixelBufferGetHeight(pb)

        lock.lock()
        frameNo += 1
        let no = frameNo
        lastExp = expS
        lastISO = iso
        lastLensPos = lensPos
        lastW = pw
        lastH = ph
        var r: Recording? = nil
        if let x = rec, !x.stopping, pts >= x.t0 { r = x }
        let mode = shutterMode
        let cap = capDen
        let tele = lensNow == .tele
        let depthMm = (pts - lastDepthAt) < 0.5 ? lastDepthMm : -1
        var fr: FrameRec? = nil
        var tRel = 0.0
        if let r = r {
            tRel = pts - r.t0
            let f = FrameRec()
            f.n = no
            f.t = tRel * 1000
            f.exp = expS
            f.iso = iso
            f.lensPos = lensPos
            f.af = af
            f.ae = ae
            f.off = off
            f.mean = st.mean
            f.p1 = st.p1
            f.p99 = st.p99
            f.blown = st.blown
            f.sharp = st.sharp
            f.capDen = cap
            f.sweep = sweepStep
            f.depthMm = depthMm
            r.frames.append(f)
            r.delivered += 1
            fr = f
        }
        let canRead = reading && inFlight < maxReaders && (rec == nil || r != nil)   // not the frames from before the tap (n1 counted them)
        var seq = 0
        if canRead {
            inFlight += 1
            jobSeq += 1
            seq = jobSeq
            r?.jobs += 1
        }
        lock.unlock()

        if let r = r {
            if r.wantVideo && !r.writerFailed { appendVideo(r, sampleBuffer, pw, ph) }
            // a lossless frame every two seconds (six at most): exactly what the reader saw, for reading again later
            if r.kept.count < 6 && tRel >= 0.5 && tRel - r.lastKeptT >= 2.0 {
                r.lastKeptT = tRel
                if let (data, w, h) = copyLuma(pb) {
                    let k = r.kept.count + 1
                    let name = String(format: "frame-%02d-%dx%d.y8", k, w, h)
                    r.kept.append(["file": name, "frame": no, "ms": Int(tRel * 1000), "width": w, "height": h])
                    lock.lock()
                    fr?.kept = k
                    lock.unlock()
                    let url = r.dir.appendingPathComponent(name)
                    io.async {
                        try? data.write(to: url)
                    }
                }
            }
            if r.plan.special == "sweep" {
                let i = Int(tRel / TestPlan.sweepSeconds)
                if i != r.sweepIdx && i < TestPlan.sweep.count {
                    r.sweepIdx = i
                    let den = TestPlan.sweep[i]
                    lock.lock()
                    sweepStep = i
                    lock.unlock()
                    sessionQ.async { self.setCap(den == 0 ? nil : den) }
                    event("shutter", den == 0 ? "the camera's own choice" : "1/\(den)")
                }
            } else if r.plan.special == "lockfocus" && !r.didLock && tRel >= 2.0 {
                r.didLock = true
                sessionQ.async { self.setFocus(.locked) }
                event("focus", "locked at \(Int(lensPos * 1000)) per mille")
            } else if mode == .smart {
                smart(dev, pts, off: off, iso: iso, cap: cap, tele: tele)
            }
        } else if mode == .smart {
            smart(dev, pts, off: off, iso: iso, cap: cap, tele: tele)
        }

        if canRead {
            let kind = Engine.cycle[seq % Engine.cycle.count]
            let rois = Engine.rois[kind] ?? []
            readers.async {
                let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up, options: [:])
                let res = self.detect(handler, rois: rois)
                self.merge(res.0, ms: res.1, kind: kind, pts: pts, fr: fr, r: r, pw: pw, ph: ph)
            }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        lock.lock()
        if let r = rec, !r.stopping { r.cameraDropped += 1 }
        lock.unlock()
    }

    /// "Smart" shutter: the fastest cap the light allows (see the top of this file).
    func smart(_ dev: AVCaptureDevice?, _ pts: Double, off: Double, iso: Double, cap: Int, tele: Bool) {
        guard let d = dev, cap > 0, pts - lastSmart > 0.4 else { return }
        lastSmart = pts
        let maxISO = Double(d.activeFormat.maxISO)
        let target = tele ? 500 : 250
        var den = cap
        if off < -1.0 && iso > 0.85 * maxISO && den > 30 {
            den = max(30, den / 2)
        } else if off > -0.3 && iso < 0.4 * maxISO && den < target {
            den = min(target, den * 2)
        }
        if den != cap {
            sessionQ.async { self.setCap(den) }
            event("shutter", "1/\(den) (smart)")
        }
    }

    func appendVideo(_ r: Recording, _ sb: CMSampleBuffer, _ pw: Int, _ ph: Int) {
        if r.writer == nil {
            do {
                let url = r.dir.appendingPathComponent("video.mov")
                let w = try AVAssetWriter(outputURL: url, fileType: .mov)
                let comp: [String: Any] = [AVVideoAverageBitRateKey: 24_000_000]
                let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: pw, AVVideoHeightKey: ph, AVVideoCompressionPropertiesKey: comp]
                if !w.canApply(outputSettings: settings, forMediaType: .video) {
                    r.writerFailed = true
                    logError(r, "video: these settings are not accepted (\(pw)x\(ph) HEVC)")
                    return
                }
                let i = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
                i.expectsMediaDataInRealTime = true
                i.transform = CGAffineTransform(rotationAngle: .pi / 2)
                if !w.canAdd(i) {
                    r.writerFailed = true
                    logError(r, "video: the writer would not take the picture input")
                    return
                }
                w.add(i)
                if !w.startWriting() {
                    r.writerFailed = true
                    logError(r, "video: " + (w.error?.localizedDescription ?? "did not start"))
                    return
                }
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sb))
                r.writer = w
                r.writerInput = i
            } catch {
                r.writerFailed = true
                logError(r, "video: \(error.localizedDescription)")
                return
            }
        }
        guard let w = r.writer, let i = r.writerInput else { return }
        if w.status != .writing {
            r.writerFailed = true
            logError(r, "video: stopped (" + (w.error?.localizedDescription ?? "status \(w.status.rawValue)") + ")")
            return
        }
        if i.isReadyForMoreMediaData {
            if i.append(sb) { r.videoFrames += 1 } else { r.videoSkipped += 1 }
        } else {
            r.videoSkipped += 1
        }
    }

    // MARK: - reading (reader threads)

    /// Apple's barcode reader over each region of the picture. Returns what was found and the milliseconds it took.
    func detect(_ handler: VNImageRequestHandler, rois: [CGRect]) -> ([Found], Double) {
        let t = CACurrentMediaTime()
        var reqs: [VNDetectBarcodesRequest] = []
        for roi in rois {
            let q = VNDetectBarcodesRequest()
            q.symbologies = [.code128, .i2of5, .qr, .code39]
            q.regionOfInterest = roi
            reqs.append(q)
        }
        var out: [Found] = []
        do {
            try handler.perform(reqs)
            for (i, q) in reqs.enumerated() {
                let roi = rois[i]
                for o in q.results ?? [] {
                    guard let s = o.payloadStringValue else { continue }
                    let b = o.boundingBox       // relative to the region
                    let box = CGRect(x: roi.minX + b.minX * roi.width, y: roi.minY + b.minY * roi.height, width: b.width * roi.width, height: b.height * roi.height)
                    out.append(Found(kind: kindName(o.symbology), text: s, conf: o.confidence, box: box))
                }
            }
        } catch {
        }
        return (out, (CACurrentMediaTime() - t) * 1000)
    }

    func merge(_ found: [Found], ms: Double, kind: String, pts: Double, fr: FrameRec?, r: Recording?, pw: Int, ph: Int) {
        let now = CACurrentMediaTime()
        lock.lock()
        inFlight -= 1
        r?.jobs -= 1
        readTimes.append(now)
        if r != nil {
            var a = visionMs[kind] ?? []
            a.append(ms)
            visionMs[kind] = a
        }
        let t0 = r?.t0 ?? liveT0
        var seen = Set<String>()
        var bx: [Box] = []
        var sizes: [Double] = []
        for f in found {
            let key = f.kind + "|" + f.text
            let firstHere = seen.insert(key).inserted
            var c = codes[key]
            if c == nil {
                let n = CodeInfo(kind: f.kind, text: f.text, index: order.count)
                n.firstMs = (pts - t0) * 1000
                n.firstBy = kind
                n.slab = slabCert(kind: f.kind, text: f.text)
                n.need = f.kind == "ITF" ? 3 : 2
                codes[key] = n
                order.append(n)
                c = n
            }
            guard let info = c else { continue }
            let px = Int(max(f.box.width * CGFloat(pw), f.box.height * CGFloat(ph)).rounded())
            if firstHere {
                if f.conf >= 0.5 {
                    info.frames += 1
                    info.by[kind] = (info.by[kind] ?? 0) + 1
                } else {
                    info.weak += 1          // n1: the one misread ("18562322") came with confidence 0.40, every right code 0.67+
                }
            }
            if info.slab && px > 20 && f.conf >= 0.5 {
                // a slab's barcode is 17.5 mm wide (PSA) or 18.4 mm (CGC: 10 or 13 digits): its size in dots gives the distance
                let mm = (info.text.count == 10 || info.text.count == 13) ? 18.4 : 17.5
                sizes.append(focalPx * mm / Double(px))
            }
            if px > 0 {
                info.minPx = min(info.minPx, px)
                info.maxPx = max(info.maxPx, px)
            }
            info.conf = max(info.conf, f.conf)
            if info.countedMs == nil && info.slab && info.frames >= info.need {
                info.countedMs = (now - t0) * 1000
                counted += 1
            }
            bx.append(Box(rect: CGRect(x: f.box.minX, y: 1 - f.box.maxY, width: f.box.width, height: f.box.height), counted: info.countedMs != nil))
            if let fr = fr {
                fr.found.append([info.index, Int(f.box.minX * 1000), Int(f.box.minY * 1000), Int(f.box.width * 1000), Int(f.box.height * 1000), Int(f.conf * 100)])
            }
        }
        var sizeMm = -1
        if sizes.count >= 2 {
            sizes.sort()
            sizeMm = Int(sizes[sizes.count / 2].rounded())
            lastSizeMm = sizeMm
            lastSizeAt = now
        }
        if let fr = fr {
            fr.job = kind
            fr.jobMs = ms
            fr.doneT = (now - t0) * 1000
            fr.sizeMm = sizeMm
        }
        lastBoxes = bx
        lastBoxesAt = now
        lock.unlock()
    }

    // MARK: - the depth sensor (depth thread)

    func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        depthCount += 1
        if depthCount % 2 != 0 { return }
        let d = depthData.depthDataType == kCVPixelFormatType_DepthFloat32 ? depthData : depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let map = d.depthDataMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return }
        let w = CVPixelBufferGetWidth(map)
        let h = CVPixelBufferGetHeight(map)
        let rb = CVPixelBufferGetBytesPerRow(map)
        if w < 16 || h < 16 { return }
        var grid: [Any] = []
        var centre = -1
        for gy in 0..<5 {
            for gx in 0..<5 {
                let cx = Int((Double(gx) + 0.5) / 5.0 * Double(w))
                let cy = Int((Double(gy) + 0.5) / 5.0 * Double(h))
                var vals: [Float] = []
                var dy = -4
                while dy <= 4 {
                    var dx = -4
                    while dx <= 4 {
                        let x = min(max(cx + dx, 0), w - 1)
                        let y = min(max(cy + dy, 0), h - 1)
                        let v = (base + y * rb).assumingMemoryBound(to: Float32.self)[x]
                        if v.isFinite && v > 0 { vals.append(v) }
                        dx += 2
                    }
                    dy += 2
                }
                if vals.isEmpty {
                    grid.append(NSNull())
                } else {
                    vals.sort()
                    let mm = Int((vals[vals.count / 2] * 1000).rounded())
                    grid.append(mm)
                    if gy == 2 && gx == 2 { centre = mm }
                }
            }
        }
        let ts = timestamp.seconds
        let quality = depthData.depthDataQuality == .high ? 1 : 0
        let absolute = depthData.depthDataAccuracy == .absolute ? 1 : 0
        let filtered = depthData.isDepthDataFiltered ? 1 : 0
        lock.lock()
        lastDepthMm = centre
        lastDepthAt = ts
        if let r = rec, !r.stopping, ts >= r.t0 {
            r.depth.append([Int((ts - r.t0) * 1000), centre, grid, quality, absolute, filtered])
        }
        lock.unlock()
    }

    // MARK: - the snap (a full photograph, read once)

    func snap() {
        lock.lock()
        snapAskedAt = CACurrentMediaTime()
        rec?.snapsAsked += 1
        lock.unlock()
        sessionQ.async {
            if !self.session.outputs.contains(self.photoOut) {
                self.fail("The photo output is not ready.")
                return
            }
            let s = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            s.photoQualityPrioritization = .quality
            s.maxPhotoDimensions = self.photoOut.maxPhotoDimensions
            self.photoOut.capturePhoto(with: s, delegate: self)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let got = CACurrentMediaTime()
        lock.lock()
        let r = rec
        let asked = snapAskedAt
        lock.unlock()
        if let e = error {
            fail("The snap failed: \(e.localizedDescription)")
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            fail("The snap gave no picture.")
            return
        }
        readers.async {
            guard let src = CGImageSourceCreateWithData(data as CFData, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
                self.fail("The snap could not be opened.")
                return
            }
            var texts: [String] = []
            var seen = Set<String>()
            var rowsOut: [[Any]] = []
            var times: [Any] = []
            for kind in Engine.snapKinds {
                let handler = VNImageRequestHandler(cgImage: img, orientation: .up, options: [:])
                let res = self.detect(handler, rois: Engine.rois[kind] ?? [])
                times.append(Int(res.1))
                for f in res.0 {
                    let key = f.kind + "|" + f.text
                    let px = Int(max(f.box.width * CGFloat(img.width), f.box.height * CGFloat(img.height)).rounded())
                    rowsOut.append([f.kind, f.text, kind, px, Int(f.conf * 100), slabCert(kind: f.kind, text: f.text)])
                    if seen.insert(key).inserted && slabCert(kind: f.kind, text: f.text) { texts.append(f.text) }
                }
            }
            var n = 1
            if let r = r {
                self.lock.lock()
                n = r.snaps.count + 1
                let name = String(format: "snap-%02d.jpg", n)
                var d: [String: Any] = [:]
                d["file"] = name
                d["askedMs"] = Int((asked - r.t0) * 1000)
                d["gotMs"] = Int((got - r.t0) * 1000)
                d["width"] = img.width
                d["height"] = img.height
                d["bytes"] = data.count
                d["slabCodes"] = texts.count
                d["readingMs W, Q, N, S, T"] = times
                d["found: kind, text, by, long side in dots, confidence x100, a slab cert"] = rowsOut
                r.snaps.append(d)
                self.lock.unlock()
                let url = r.dir.appendingPathComponent(name)
                self.io.async {
                    try? data.write(to: url)
                }
            }
            let line = "Snap \(n): \(texts.count) codes (\(img.width) x \(img.height), \(Int((got - asked) * 1000)) ms to take)"
            DispatchQueue.main.async {
                self.snapNote = line
            }
        }
    }

    // MARK: - the screen's clock (main thread, about 7 times a second)

    func tick() {
        let now = CACurrentMediaTime()
        lock.lock()
        var list: [CodeRow] = []
        var i = order.count - 1
        while i >= 0 && list.count < 80 {
            let c = order[i]
            if c.slab {
                list.append(CodeRow(id: c.kind + "|" + c.text, kind: c.kind, text: c.text, counted: c.countedMs != nil, sightings: c.frames))
            }
            i -= 1
        }
        let n = counted
        let bx = (now - lastBoxesAt) < 0.5 ? lastBoxes : []
        let r = rec
        let e = lastExp
        let iso = lastISO
        let lp = lastLensPos
        let dmm = (now - lastDepthAt) < 0.6 ? lastDepthMm : -1
        let smm = (now - lastSizeAt) < 1.0 ? lastSizeMm : -1
        readTimes.removeAll { now - $0 > 1.0 }
        let rps = readTimes.count
        let cap = capDen
        let w = lastW
        let h = lastH
        let t0 = r?.t0 ?? 0
        let isStopping = r?.stopping ?? false
        let limit = r?.plan.seconds ?? 0
        lock.unlock()

        rows = list
        countedN = n
        boxes = bx
        var s = ""
        if e > 0 { s += "1/\(Int((1 / e).rounded())) s" }
        if cap > 0 { s += " (cap 1/\(cap))" }
        s += " · ISO \(Int(iso)) · focus \(Int(lp * 100))"
        if smm > 0 { s += String(format: " · %.1f in", Double(smm) / 25.4) }
        if dmm > 0 { s += String(format: " · sensor %.1f in", Double(dmm) / 25.4) }
        s += " · \(rps) reads/s · \(w)x\(h)"
        status = s
        if recording && r != nil && !isStopping {
            elapsed = now - t0
            if elapsed >= limit { stop() }
        }
    }
}
