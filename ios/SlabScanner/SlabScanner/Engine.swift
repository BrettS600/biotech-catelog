//  The camera, its controls, the reader and the live state of the screen.
//
//  WHAT A WEB PAGE CANNOT DO AND THIS CAN (the reason for the trial; Brett's 16 web test files, 2026-11-10: the page
//  read 5-9 of the camera's 25 frames a second, a quarter to two thirds of the frames were blurred, and Safari offered
//  no shutter, exposure or focus control):
//  - THE SHUTTER: the camera keeps choosing its exposure, but may not use a shutter slower than a cap
//    (activeMaxExposureDuration). "Smart" (n3, from Brett's 15 n2 tests, 2026-11-10) sets the cap BY THE LIGHT AND
//    THE MOVEMENT - see smart(). n2 held 1/250 (1x) whatever the light: in his dim room that meant ISO 5000 and not
//    one code; his shutter sweep at 14 inches found 54 codes a frame at 1/60 (ISO 250), 52 at 1/120 (ISO 500), 42 at
//    1/250 (ISO 1250), 17 at 1/500 (ISO 2500), 4 at 1/1000 (ISO 5000): the grain of a high sensitivity (and the
//    camera's smoothing of it) costs far more than a slower shutter in a still hand.
//    "Auto" = the camera's own choice (what the web page got). Fixed caps for trying.
//  - THE SIZE: 4032 x 3024 at 30 a second (1.4 times the dots across of the page's 4K), or 4K at 60.
//  - THE FOCUS: the camera's own, continuous (not the slow "smooth" kind) - and, n3, THE FOCUS HELPER: n2's 3x lens
//    sat out of focus through whole tests (3 feet, the focus-lock test, the first seconds of the sweep: the saved
//    frames show plain defocus, the lens position never moved). When nothing is read the app asks for a refocus,
//    and if that does not help it tries the lens positions itself and holds the sharpest - see focusHelper().
//  - THE FRAMES READ BY TWO READERS (n4): Apple's barcode reader (Vision), up to two frames at a time, as overlapping
//    tiles - it reduces whatever region it gets, and found nothing in the whole 12 MP picture (see `rois` below) - and
//    OUR OWN (WebReader.swift: the website's finder + zxing in two web views), which found 2 to 3 times as many codes
//    in the same frames where the codes are small or soft.
//    A code counts as a slab when it looks like a cert (slabCert) and was read often enough (CodeInfo.enough: Apple's
//    reader in 2 frames - ITF 3 -, ours surely in 2, or both once each) AND IS NOT OUTREAD AT ITS OWN PLACE: n3's
//    glare test counted the first wrong number of 33 native tests - 02361231, Apple's reader misreading the small
//    washed-out code 4054449650 the same way in 6 frames of a still phone, while it read the right number there in
//    20. One place holds one code: numbers read at the same place are rivals, and the one read less does not count
//    (absorb()).
//  - GLARE: n3's darker frames in turn (-1.5 EV every other half second) found nothing more (30 codes against 29
//    without, 10.9 codes a frame against 10.2; the reflection stayed blown out) - gone in n4. What helps is moving
//    the reflection off the codes: held still 30 of 50, tilting and moving 44. A note on the picture says so.
//  - TOO FAST (n4): Brett's real use is 2 to 3 feet at 45 degrees with 3x, the phone moving. In his own test of it
//    the picture moved ~2,650 dots a second and 498 of 661 frames read found nothing; with 3x reads happen below
//    ~600. A note on the picture says when the picture moves too fast to be read, and such frames are not read.
//  - THE LAMP (n3): "Auto" switches it on when the light is too poor for a fast shutter and the phone is in a hand
//    (lightHelper).
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

/// A frame our own reader is at.
struct WebJob {
    let pts: Double
    let at: Double
    let fr: FrameRec?
    let r: Recording?
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
    @Published var hint = ""

    // the switches
    @Published var lens: Lens = .wide
    @Published var size: SizeMode = .mp12
    @Published var shutter: ShutterMode = .smart
    @Published var focus: FocusMode = .auto
    @Published var depthOn = false
    @Published var videoOn = true
    @Published var light: LightMode = .off
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
    let maxReaders = 2              // Apple's reader, frames at once (n4: two, beside our own reader's two web views)

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
    var lastSlabPts = 0.0           // the newest frame (its own time) a slab's code was read in
    var lastCodePx = 0              // the long side of the codes in the newest frame that held some, dots
    var lastCodePxAt = 0.0
    var lightMode = LightMode.off
    var torchIsOn = false
    var helperOn = true
    var rotEma = 0.0                // the phone's turning, rad/s, smoothed over about a tenth of a second
    var heatNow = 0
    var glareNow = false
    var fStateNow = 0
    var speedNow = 0.0
    var resetHelpers = false
    var tooFastNow = false
    var webReaders: [WebReader] = []
    var webJobs: [Int: WebJob] = [:]    // frames our own reader is at: by the number the frame went out under
    var webSeq = 0
    var webNotes: [String] = []
    var webFill: [Double] = []

    // the capture thread's own
    var lastSmart = 0.0
    var lastCapChange = 0.0
    var depthCount = 0
    var prevCols: [Float] = []
    var prevRows: [Float] = []
    var prevPts = 0.0
    var speedEma = 0.0              // the picture's movement, dots a second (quick to rise, slow to fall)
    var kEma = 0.0                  // the light: ISO x seconds the camera needs
    var denWantIdx = -1
    var denWantSince = 0.0
    var fState = 0                  // the focus helper: 0 the camera's own, 1 asked to refocus, 2 trying positions, 3 held, 4 after the refocus
    var fSince = 0.0
    var fNextKick = 0.0
    var fBackoff = 1.5
    var fSawMoving = false
    var fStill = 0
    var fList: [Double] = []
    var fIdx = 0
    var fStepAt = 0.0
    var fFine = false
    var fBestPos = 0.0
    var fBestSharp = -1.0
    var fHeldSharp = 0.0
    var fTrace = ""
    var blownSince = -1.0
    var biasWant: Float = 0
    var dimSince = -1.0
    var restSince = -1.0
    var readingSince = 0.0
    var wasReading = false
    var fastSince = -1.0

    // n1's first two tests (2026-11-10): the whole picture (W) found NOTHING at 9 and at 14 inches - Apple's reader
    // reduces whatever region it is given to its own working size - while the four tiles (Q) found every code at
    // 9 inches and the nine tiles (N) read the fine CGC codes at 14 inches twice as often as the four.
    // n2's 15 tests (codes found per frame read, and the reading time with three frames under way at once):
    //   codes 223 dots long (9 in):  Q 44, N 45, S 45, T 34      Q ~200 ms, N ~220 ms, S ~400 ms, T ~650 ms
    //   151 dots (14 in):            Q 24, N 33, S 36, T 36
    //   124 dots (16 in, glare):     Q  3, N 16, S 19, T 19
    //   275 dots (3x at 2 ft):       Q 28, N 30, S 29, T 28
    // So the nine tiles are as good as any at every size but the smallest, at half the time of the sixteen; the
    // thirty-six never earned their time. n3 reads N, with S every third frame while the codes are small or none
    // has been read yet, and Q now and then while none has been read (a code filling a third of the picture).
    static let snapKinds = ["W", "Q", "N", "S", "T"]
    static let ladder = [30, 40, 50, 60, 80, 100, 120, 160, 200, 250, 320, 400, 500]

    static func kindFor(_ seq: Int, px: Int) -> String {
        if px >= 150 { return "N" }
        if px > 0 { return seq % 3 == 1 ? "S" : "N" }
        switch seq % 4 {
        case 1: return "S"
        case 3: return "Q"
        default: return "N"
        }
    }
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
        heatNow = ProcessInfo.processInfo.thermalState.rawValue
        NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { [weak self] _ in
            guard let self = self else { return }
            let h = ProcessInfo.processInfo.thermalState.rawValue
            self.lock.lock()
            self.heatNow = h
            self.lock.unlock()
            self.event("heat", String(h))
        }
        // the phone's movement, always (the lamp's "in a hand" test needs it outside tests too); a test keeps every reading
        motion.deviceMotionUpdateInterval = 0.01
        if motion.isDeviceMotionAvailable {
            motion.startDeviceMotionUpdates(to: motionQ) { [weak self] m, _ in
                guard let self = self, let m = m else { return }
                let w = (m.rotationRate.x * m.rotationRate.x + m.rotationRate.y * m.rotationRate.y + m.rotationRate.z * m.rotationRate.z).squareRoot()
                self.lock.lock()
                self.rotEma = 0.9 * self.rotEma + 0.1 * w
                if let x = self.rec, !x.stopping {
                    x.motion.append((m.timestamp - x.t0) * 1000)
                    x.motion.append(m.rotationRate.x * 1000)
                    x.motion.append(m.rotationRate.y * 1000)
                    x.motion.append(m.rotationRate.z * 1000)
                    x.motion.append(m.userAcceleration.x * 1000)
                    x.motion.append(m.userAcceleration.y * 1000)
                    x.motion.append(m.userAcceleration.z * 1000)
                    x.motion.append(m.gravity.x * 1000)
                    x.motion.append(m.gravity.y * 1000)
                    x.motion.append(m.gravity.z * 1000)
                }
                self.lock.unlock()
            }
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
        light = p.light
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
        let li = light
        sessionQ.async {
            if !self.configured || c != self.cur { self.configure(c) }
            self.lock.lock()
            self.shutterMode = sh
            self.lensNow = c.lens
            self.lightMode = li
            self.helperOn = fo == .auto
            self.resetHelpers = true
            self.lock.unlock()
            switch sh {
            case .auto: self.setCap(nil)
            case .smart: self.setCap(120)       // where room light puts both lenses; smart() takes it from there
            default: self.setCap(sh.den)
            }
            self.setBias(0)
            self.setFocus(fo)
            self.setTorch(li == .on)
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
        let idle = !reading
        let li = lightMode
        lock.unlock()
        if idle && li == .auto {                // the lamp that came on by itself goes off with the reading
            sessionQ.async { self.setTorch(false) }
        }
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
            if c.lens == .tele && d.isAutoFocusRangeRestrictionSupported { d.autoFocusRangeRestriction = .near }   // slabs are near; n2's 3x lens did not find its focus
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
        info["focusRangeNear"] = c.lens == .tele && d.isAutoFocusRangeRestrictionSupported
        info["torch"] = d.hasTorch
        info["exposureBiasLowestX100"] = Int(d.minExposureTargetBias * 100)
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
        lastCodePx = 0
        torchIsOn = false           // the lamp went out with the camera it belonged to
        resetHelpers = true
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

    /// One fresh focus run on the middle of the picture (the camera's own search, from scratch).
    func kickFocus() {
        guard let d = device else { return }
        do {
            try d.lockForConfiguration()
            if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5) }
            if d.isFocusModeSupported(.autoFocus) { d.focusMode = .autoFocus }
            d.unlockForConfiguration()
        } catch {
        }
    }

    /// The lens to a position of its travel (0 nearest - 1 farthest) and held there.
    func lockFocus(at p: Double) {
        guard let d = device, d.isLockingFocusWithCustomLensPositionSupported else { return }
        do {
            try d.lockForConfiguration()
            d.setFocusModeLocked(lensPosition: Float(min(1.0, max(0.0, p))), completionHandler: nil)
            d.unlockForConfiguration()
        } catch {
        }
    }

    /// The exposure the camera aims for, in EV against its own choice (the glare help's darker frames).
    func setBias(_ ev: Float) {
        guard let d = device else { return }
        do {
            try d.lockForConfiguration()
            let v = min(d.maxExposureTargetBias, max(d.minExposureTargetBias, ev))
            d.setExposureTargetBias(v, completionHandler: nil)
            d.unlockForConfiguration()
        } catch {
        }
    }

    func setTorch(_ on: Bool) {
        guard let d = device, d.hasTorch else { return }
        var isOn = false
        do {
            try d.lockForConfiguration()
            if on && d.isTorchAvailable {
                // half power with 1x (8 to 14 inches away: plenty, less heat, a smaller reflection); full with 3x (2 feet and more)
                let level: Float = d.deviceType == .builtInTelephotoCamera ? 1.0 : 0.5
                try d.setTorchModeOn(level: min(level, AVCaptureDevice.maxAvailableTorchLevel))
                isOn = true
            } else {
                d.torchMode = .off
            }
            d.unlockForConfiguration()
        } catch {
        }
        lock.lock()
        let was = torchIsOn
        torchIsOn = isOn
        lock.unlock()
        if was != isOn { event("light", isOn ? "on" : "off") }
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
        var bias = 0.0
        var af = false
        var ae = false
        if let d = dev {
            if expS <= 0 { expS = d.exposureDuration.seconds }
            if iso <= 0 { iso = Double(d.iso) }
            lensPos = Double(d.lensPosition)
            off = Double(d.exposureTargetOffset)
            bias = Double(d.exposureTargetBias)
            af = d.isAdjustingFocus
            ae = d.isAdjustingExposure
        }
        let st = frameStats(pb)
        let pw = CVPixelBufferGetWidth(pb)
        let ph = CVPixelBufferGetHeight(pb)

        // how far the picture moved since the frame before (dots a second), from the two frames' column and row sums
        var speed = -1.0
        let dt = pts - prevPts
        if dt > 0.001 && dt < 0.2 && !st.cols.isEmpty && prevCols.count == st.cols.count && prevRows.count == st.rows.count {
            if let dx = shiftOf(prevCols, st.cols, maxD: 30), let dy = shiftOf(prevRows, st.rows, maxD: 30) {
                speed = (dx * dx + dy * dy).squareRoot() * 8 / dt
            }
        }
        prevCols = st.cols
        prevRows = st.rows
        prevPts = pts
        if speed >= 0 {
            // (checked on n2's videos before n3 went out: this estimate agrees with the codes' own tracks - correlation
            // 0.96, 79 dots a second apart on average - and, smoothed like this, a still hand is above 400 in 3% of
            // its frames, a gliding one in 83%)
            speedEma = speed > speedEma ? 0.65 * speedEma + 0.35 * speed : 0.8 * speedEma + 0.2 * speed
        } else {
            speedEma *= 0.9
        }
        // the light: ISO x seconds for the exposure the camera aims at (its bias and what it still lacks taken out)
        if expS > 0 && iso > 0 && abs(off) < 2.0 {
            let k = iso * expS * pow(2.0, -(off + bias))
            kEma = kEma <= 0 ? k : 0.8 * kEma + 0.2 * k
        }

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
        let lastSlab = lastSlabPts
        let codePx = (pts - lastCodePxAt) < 2.0 ? lastCodePx : 0
        let lmode = lightMode
        let torch = torchIsOn
        let helper = helperOn
        let rot = rotEma
        let heat = heatNow
        let active = reading
        let doReset = resetHelpers
        resetHelpers = false
        speedNow = speedEma
        fStateNow = fState
        glareNow = blownSince >= 0 && pts - blownSince > 0.5
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
            f.speed = speed >= 0 ? Int(speed.rounded()) : -1
            f.bias = bias
            f.torch = torch
            f.fstate = fState
            f.light = kEma
            f.readers = inFlight
            r.frames.append(f)
            r.delivered += 1
            fr = f
        }
        // THE BLUR of this frame in dots: how far the picture moved while the shutter was open. Over 2 bars of a
        // code for 0.4 s: the note "too fast" (a bar = a hundredth of the codes' length; 1.8 dots while none is read).
        // Over 7 dots the frame is not read at all (n3: such frames found nothing - 498 of 661 in Brett's own test).
        let blurPx = speedEma * expS
        let bar = codePx > 0 ? max(1.0, Double(codePx) / 100) : 1.8
        if blurPx > 2.0 * bar {
            if fastSince < 0 { fastSince = pts }
        } else {
            fastSince = -1
        }
        tooFastNow = fastSince >= 0 && pts - fastSince > 0.4
        let tooFast = blurPx > 7.0
        // a hot phone reads fewer frames at once (n2 and n3: "serious" heat within ten tests, with the video being kept)
        let limit = heat >= 3 ? 0 : (heat >= 2 ? 1 : maxReaders)
        let mayRead = reading && !tooFast && (rec == nil || r != nil)   // not the frames from before the tap (n1 counted them)
        let canRead = mayRead && inFlight < limit
        var seq = 0
        if canRead {
            inFlight += 1
            jobSeq += 1
            seq = jobSeq
            r?.jobs += 1
        }
        let webs = mayRead ? webReaders : []
        let webRoom = webJobs.count < (heat >= 3 ? 1 : 2)
        lock.unlock()

        if doReset || (active && !wasReading) {
            fState = 0
            fNextKick = pts + 0.5
            fBackoff = 1.5
            denWantIdx = -1
            blownSince = -1
            biasWant = 0
            dimSince = -1
            restSince = -1
            readingSince = pts
            if doReset { kEma = 0 }
        }
        wasReading = active
        let sinceCode = pts - max(lastSlab, readingSince)

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
        }
        var sweeping = false
        if let r = r, r.plan.special == "sweep" {
            sweeping = true
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
        } else if mode == .smart && fState != 1 && fState != 2 {
            smart(pts, cap: cap, tele: tele, codePx: codePx)      // (not while the lens is being moved: a change of exposure sent n2's 3x lens hunting)
        }
        if dev != nil {
            // (a much underexposed frame says nothing about the focus: its sharpness is lower by itself)
            let dark = off < -0.7
            if !(dark && (fState == 0 || fState == 3)) {
                focusHelper(pts, sharp: st.sharp, lensPos: lensPos, af: af, tele: tele, sinceCode: sinceCode, lastSlab: lastSlab, speed: speedEma, on: helper && active && !sweeping)
            }
            if st.blown >= 5 {                  // glare: only a note on the picture (see the top of this file)
                if blownSince < 0 { blownSince = pts }
            } else if st.blown < 3 {
                blownSince = -1
            }
            lightHelper(pts, mode: lmode, isOn: torch, tele: tele, rot: rot, active: active)
        }

        // our own reader: a web view that is waiting gets this frame (one a frame - the other takes the next)
        if webRoom {
            for wr in webs where wr.wants {
                lock.lock()
                webSeq += 1
                let ws = webSeq
                lock.unlock()
                if let packet = lumaPacket(pb, seq: ws) {
                    lock.lock()
                    webJobs[ws] = WebJob(pts: pts, at: CACurrentMediaTime(), fr: fr, r: r)
                    r?.jobs += 1
                    lock.unlock()
                    if !wr.give(packet) {
                        lock.lock()
                        if webJobs.removeValue(forKey: ws) != nil { r?.jobs -= 1 }
                        lock.unlock()
                    }
                }
                break
            }
        }

        if canRead {
            let kind = Engine.kindFor(seq, px: codePx)
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

    /// "Smart" shutter (n3): the cap by the light and the movement.
    /// THE LIGHT is kEma = ISO x seconds the camera needs (Brett's room 4 with 1x and 13 with 3x, his dim room 20
    /// and 83), so a shutter of 1/den needs ISO kEma x den.
    /// STILL: the shutter that keeps the sensitivity at ISO 500 with 1x (his room: 1/120), 1600 with 3x (1/120 -
    /// the step that found 54 codes a frame in his 3x sweep).
    /// MOVING (the picture shifts more than 400 dots a second, smoothed; a still hand measures 100-300): the shutter
    /// that holds the blur to one bar (a code is ~100 bars long), as far as ISO 1600 (1x) / 2200 (3x) allows. n2's
    /// moving tests at 1/250, codes 250 dots long: 34 codes a frame at rest, 32 at 400-600 dots a second (blur 0.8
    /// of a bar), 26 at 600-800 (1.1), 22 at 800-1000 (1.5), 8 above 1000 (1.8).
    /// Never slower than 1/60 (1/30 with 1x when even that needs more than ISO 2000), never faster than 1/500
    /// (1x) or 1/250 (3x). Faster at once; slower, and by a single step, only after 0.6 s; the 3x lens every 1.5 s
    /// at most.
    func smart(_ pts: Double, cap: Int, tele: Bool, codePx: Int) {
        guard kEma > 0, pts - lastSmart > 0.25 else { return }
        lastSmart = pts
        let isoStill = tele ? 1600.0 : 500.0
        let isoMove = tele ? 2200.0 : 1600.0
        var lo = 60.0
        if !tele && kEma * 60 > 2000 { lo = 30 }
        var hi = tele ? 250.0 : 500.0
        var den = isoStill / kEma
        if speedEma > 400 {
            let bar = codePx > 0 ? max(1.0, Double(codePx) / 100) : 1.8
            let want = speedEma / bar
            // 3x WHILE MOVING (n4). n3's pan at 2 feet ran at 1/60-1/80 - the light rule would not pass ISO 2200 - and
            // its frames above 600 dots a second read next to nothing (13 codes a frame under 300, 9 at 300-600, 2 at
            // 600-900). Rather a darker picture than a smeared one: up to one stop under, never slower than 1/120,
            // as fast as 1/400.
            let room = tele ? 2.0 * isoMove / kEma : isoMove / kEma
            den = max(den, min(want, room))
            if tele {
                den = max(den, 120)
                hi = 400
            }
        }
        den = min(hi, max(lo, den))
        var idx = 0
        var bestD = Double.infinity
        for (i, v) in Engine.ladder.enumerated() {
            let dd = abs(log(Double(v) / den))
            if dd < bestD {
                bestD = dd
                idx = i
            }
        }
        let curIdx = Engine.ladder.firstIndex(of: cap) ?? -1
        if curIdx >= 0 {
            if idx == curIdx {
                denWantIdx = idx
                return
            }
            if idx != denWantIdx {
                denWantIdx = idx
                denWantSince = pts
            }
            let faster = idx > curIdx && idx - curIdx >= 2
            let hold = tele ? 1.5 : (faster ? 0.0 : 0.6)
            if pts - denWantSince < hold || pts - lastCapChange < (tele ? 1.5 : 0.3) { return }
        }
        lastCapChange = pts
        denWantIdx = idx
        let v = Engine.ladder[idx]
        sessionQ.async { self.setCap(v) }
        event("shutter", "1/\(v) (light \(Int((kEma * 100).rounded())), moving \(Int(speedEma.rounded())))")
    }

    /// THE FOCUS HELPER (n3). n2: the 3x lens stood out of focus through whole tests - its position never moved
    /// (3 feet: 0 codes; the focus-lock test: 0; the first three seconds of the sweep: 0, then a change of shutter
    /// made it search and it read all 50). The 1x lens never failed.
    ///   0  the camera's own continuous focus. No slab code for 0.8 s with 3x - or for 1.5 s with 1x AND a plainly
    ///      blurred picture (sharpness under 50; n2: sharp pictures 115-380, blurred 16-45) -> 1.
    ///   1  one fresh focus run on the middle of the picture; done when the lens has moved and stood for 3 frames
    ///      (1.5 s at most) -> 4.
    ///   4  0.7 s for a code to be read in a frame taken after that run: 3x holds where it is (-> 3), 1x goes back to
    ///      the camera's own (-> 0). None read: a picture still plainly blurred, and still, has the positions tried
    ///      (-> 2); a sharp one with no read is no focus problem (3x holds -> 3, 1x -> 0).
    ///   Nothing is asked or tried while the picture moves (n4): a moving picture is blurred whatever the lens does.
    ///   2  the lens to each position in turn, 0.13 s each (the last frame's sharpness stands for the position),
    ///      then 0.03 either side of the sharpest; the lens goes to the sharpest of all and is held -> 3.
    ///   3  held. No code for 2 s and the picture no longer sharp (under 0.6 of what it was) - or none for 6 s -> 0.
    /// After each refocus that did not end in a read the next one waits twice as long (1.5 s ... 8 s); a read resets it.
    func focusHelper(_ pts: Double, sharp: Int, lensPos: Double, af: Bool, tele: Bool, sinceCode: Double, lastSlab: Double, speed: Double, on: Bool) {
        if !on {
            if fState != 0 {
                fState = 0
                sessionQ.async { self.setFocus(.auto) }
            }
            return
        }
        if sinceCode < 0.5 { fBackoff = 1.5 }
        switch fState {
        case 0:
            let wait = tele ? 0.8 : 1.5
            // (n4: not while the picture moves - a moving picture is blurred whatever the lens does; n3's helper
            // hunted through Brett's whole moving test, its sharpness curves flat)
            if sinceCode > wait && pts >= fNextKick && !af && speed < 500 && (tele || sharp < 50) {
                fState = 1
                fSince = pts
                fSawMoving = false
                fStill = 0
                fNextKick = pts + fBackoff
                fBackoff = min(8.0, fBackoff * 2)
                sessionQ.async { self.kickFocus() }
                event("focus", "asked to refocus (sharpness \(sharp), lens at \(Int(lensPos * 1000)))")
            }
        case 1:
            if af {
                fSawMoving = true
                fStill = 0
            } else {
                fStill += 1
            }
            if (fSawMoving && fStill >= 3) || pts - fSince > 1.5 {
                fState = 4
                fSince = pts
            }
        case 4:
            if lastSlab >= fSince {
                if tele {
                    fState = 3
                    fHeldSharp = Double(sharp)
                    event("focus", "reading after the refocus: held at \(Int(lensPos * 1000)), sharpness \(sharp)")
                } else {
                    fState = 0
                    sessionQ.async { self.setFocus(.auto) }
                    event("focus", "reading after the refocus (lens at \(Int(lensPos * 1000)), sharpness \(sharp))")
                }
                fSince = pts
            } else if pts - fSince > 0.7 {
                // (n4: the positions are tried only when the picture is plainly blurred and still. n3: after the
                // refocus at 4 feet the lens stood right - the try found the same place - and nothing was read
                // because the codes were too small; a sharp picture with no read is not a focus problem.)
                if sharp < 50 && speed < 300 {
                    var list: [Double] = []
                    var p = tele ? 0.0 : 0.30       // n2, sharp at: 3x 0.20-0.23 at 2 feet (0 = nearest, 60 cm); 1x 0.47-0.50 at 9 in, 0.59 at 14 in, 0.67 at 2 ft
                    let end = tele ? 0.84 : 0.90
                    while p <= end + 0.001 {
                        list.append(p)
                        p += 0.06
                    }
                    fList = list
                    fIdx = 0
                    fStepAt = pts
                    fFine = false
                    fBestSharp = -1
                    fBestPos = list[0]
                    fTrace = ""
                    fState = 2
                    fSince = pts
                    let q = list[0]
                    sessionQ.async { self.lockFocus(at: q) }
                    event("focus", "no read after the refocus (sharpness \(sharp), lens at \(Int(lensPos * 1000))): trying the positions")
                } else if tele {
                    fState = 3
                    fSince = pts
                    fHeldSharp = Double(sharp)
                } else {
                    fState = 0
                    sessionQ.async { self.setFocus(.auto) }
                }
            }
        case 2:
            if speed > 800 {                        // the phone started moving: the try says nothing now
                fState = 0
                fNextKick = pts + 1.0
                sessionQ.async { self.setFocus(.auto) }
                event("focus", "the try was dropped: the picture is moving")
            } else if pts - fStepAt >= 0.13 {              // (four frames at 30 a second: the lens has arrived and this frame was taken there)
                let p = fList[fIdx]
                fTrace += "\(Int((p * 1000).rounded())):\(sharp) "
                if Double(sharp) > fBestSharp {
                    fBestSharp = Double(sharp)
                    fBestPos = p
                }
                fIdx += 1
                fStepAt = pts
                if fIdx < fList.count {
                    let q = fList[fIdx]
                    sessionQ.async { self.lockFocus(at: q) }
                } else if !fFine {
                    fFine = true
                    fList = [max(0.0, fBestPos - 0.03), min(1.0, fBestPos + 0.03)]
                    fIdx = 0
                    let q = fList[0]
                    sessionQ.async { self.lockFocus(at: q) }
                } else {
                    let q = fBestPos
                    sessionQ.async { self.lockFocus(at: q) }
                    fState = 3
                    fSince = pts
                    fHeldSharp = fBestSharp
                    event("focus", "held at \(Int((q * 1000).rounded())), sharpness \(Int(fBestSharp)) - position:sharpness tried: \(fTrace)")
                }
            }
        case 3:
            if speed < 500 && pts - fSince > 2.0 && sinceCode > 2.0 && (Double(sharp) < 0.6 * fHeldSharp || sinceCode > 6.0) {
                fState = 0
                fNextKick = pts + 0.3
                sessionQ.async { self.setFocus(.auto) }
                event("focus", "let go (sharpness \(sharp), was \(Int(fHeldSharp)); no code for \(Int(sinceCode * 10)) tenths of a second)")
            }
        default:
            fState = 0
        }
    }

    /// THE LAMP on "Auto" (n3): on when the light is too poor for 1/120 (that shutter would need more than ISO 1440
    /// with 1x - n2's dim room: 2400 - or 4800 with 3x) for 0.6 s while codes are being read for and the phone is in
    /// a hand (it turns more than 0.012 rad/s; lying on a table it does not, and a covered lens is not a dark room).
    /// Off when the reading stops, or when the phone has lain still for 3 s.
    func lightHelper(_ pts: Double, mode: LightMode, isOn: Bool, tele: Bool, rot: Double, active: Bool) {
        if mode != .auto { return }
        if !isOn {
            let dim = kEma > (tele ? 40.0 : 12.0)
            if active && dim && rot > 0.012 {
                if dimSince < 0 { dimSince = pts }
                if pts - dimSince > 0.6 {
                    dimSince = -1
                    restSince = -1
                    sessionQ.async { self.setTorch(true) }
                }
            } else {
                dimSince = -1
            }
        } else if !active || rot < 0.006 {
            if restSince < 0 { restSince = pts }
            if pts - restSince > (active ? 3.0 : 0.3) {
                restSince = -1
                sessionQ.async { self.setTorch(false) }
            }
        } else {
            restSince = -1
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

    /// (reader threads) What Apple's reader found in a frame.
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
        let rows = absorb(found, by: kind, pts: pts, now: now, t0: r?.t0 ?? liveT0, pw: pw, ph: ph, fr: fr)
        if let fr = fr {
            fr.found = rows
            fr.job = kind
            fr.jobMs = ms
            fr.doneT = (now - (r?.t0 ?? liveT0)) * 1000
        }
        lock.unlock()
    }

    /// (main thread) What our own reader found in a frame it was handed (WebReader).
    func webResult(reader: Int, seq: Int, ms: Double, fill: Double, patches: Int, w: Int, h: Int, reads: [WebRead], failed: Bool) {
        let now = CACurrentMediaTime()
        lock.lock()
        guard let job = webJobs.removeValue(forKey: seq) else {
            lock.unlock()
            return
        }
        job.r?.jobs -= 1
        let same = (job.r == nil && rec == nil) || (job.r != nil && job.r === rec)
        if failed || !same || w < 64 || h < 64 {        // (a frame of a test that is over is not read into the next one)
            lock.unlock()
            return
        }
        readTimes.append(now)
        if job.r != nil {
            var a = visionMs["F"] ?? []
            a.append(ms)
            visionMs["F"] = a
            webFill.append(fill)
        }
        var found: [Found] = []
        for x in reads {
            // the page's dots count from the frame's top-left; a Found's box is 0-1 from the bottom-left, as Apple's
            let bw = max(1.0, x.right - x.left)
            let bh = max(1.0, x.bottom - x.top)
            let box = CGRect(x: x.left / Double(w), y: 1.0 - x.bottom / Double(h), width: bw / Double(w), height: bh / Double(h))
            found.append(Found(kind: x.kind, text: x.text, conf: x.cls == 3 ? 0.6 : 1.0, box: box, cls: x.cls))
        }
        let t0 = job.r?.t0 ?? liveT0
        let rows = absorb(found, by: "F", pts: job.pts, now: now, t0: t0, pw: w, ph: h, fr: job.fr)
        if let fr = job.fr {
            fr.webFound = rows
            fr.webMs = ms
            fr.webBoxes = patches
            fr.webDone = (now - t0) * 1000
        }
        lock.unlock()
    }

    /// (main thread) Our own reader's state: "ready", or why it is not.
    func webNote(_ id: Int, _ s: String) {
        lock.lock()
        if webNotes.count < 40 { webNotes.append("reader \(id): " + s) }
        lock.unlock()
        event("our reader", "\(id): " + s)
    }

    /// (main thread) Starts our own reader's web views, once, inside `host`.
    func startWebReaders(host: UIView) {
        lock.lock()
        let have = !webReaders.isEmpty
        lock.unlock()
        if have { return }
        var made: [WebReader] = []
        for i in 0..<2 {
            let w = WebReader(id: i + 1, engine: self)
            w.start(in: host)
            made.append(w)
        }
        lock.lock()
        webReaders = made
        lock.unlock()
    }

    /// (under the lock) One frame's readings by one reader into the table of codes. Returns the frame's rows for
    /// the test file: [number in the list, x, y, width, height per mille, confidence x100 or our reader's class].
    ///
    /// ONE PLACE HOLDS ONE CODE (n4). Two different slab numbers read within 0.35 s at the same place of a picture
    /// that is not moving (their middles closer than 0.35 of a code's length) are rivals. A number counts when it
    /// was read often enough (CodeInfo.enough) and no rival of it was read as often; a counted number whose rival
    /// has since been read more than twice as often is taken back (n3: the wrong 02361231 in 6 frames, the right
    /// 4054449650 at the same place in 20).
    func absorb(_ found: [Found], by: String, pts: Double, now: Double, t0: Double, pw: Int, ph: Int, fr: FrameRec?) -> [[Any]] {
        var rows: [[Any]] = []
        var seen = Set<String>()
        var bx: [Box] = []
        var sizes: [Double] = []
        var slabPx: [Int] = []
        var touched: [CodeInfo] = []
        let still = speedNow < 400
        for f in found {
            let key = f.kind + "|" + f.text
            let firstHere = seen.insert(key).inserted
            var c = codes[key]
            if c == nil {
                let n = CodeInfo(kind: f.kind, text: f.text, index: order.count)
                n.firstMs = (pts - t0) * 1000
                n.firstBy = by
                n.slab = slabCert(kind: f.kind, text: f.text)
                n.need = f.kind == "ITF" ? 3 : 2
                codes[key] = n
                order.append(n)
                c = n
            }
            guard let info = c else { continue }
            let wpx = Double(f.box.width) * Double(pw)
            let hpx = Double(f.box.height) * Double(ph)
            let px = Int(max(wpx, hpx).rounded())
            let good = f.cls == 0 ? f.conf >= 0.5 : true
            if firstHere {
                if f.cls == 0 {
                    if good {
                        info.frames += 1
                    } else {
                        info.weak += 1          // n1: the one misread ("18562322") came with confidence 0.40, every right code 0.67+
                    }
                } else if f.cls == 3 {
                    info.framesWC += 1
                } else {
                    info.framesW += 1
                }
                if good { info.by[by] = (info.by[by] ?? 0) + 1 }
                touched.append(info)
            }
            if info.slab && px > 20 && good {
                // a slab's barcode is 17.5 mm wide (PSA) or 18.4 mm (CGC: 10 or 13 digits): its size in dots gives the distance
                let mm = (info.text.count == 10 || info.text.count == 13) ? 18.4 : 17.5
                sizes.append(focalPx * mm / Double(px))
                slabPx.append(px)
            }
            if px > 0 {
                info.minPx = min(info.minPx, px)
                info.maxPx = max(info.maxPx, px)
            }
            info.conf = max(info.conf, f.conf)
            if info.slab && good && px > 20 {
                let cx = (Double(f.box.minX) + Double(f.box.width) / 2) * Double(pw)
                let cy = (Double(f.box.minY) + Double(f.box.height) / 2) * Double(ph)
                if still {
                    for o in order where o.slab && o !== info && abs(o.lastPts - pts) < 0.35 && o.len > 20 {
                        let reach = 0.35 * max(o.len, Double(px))
                        if abs(o.cx - cx) < reach && abs(o.cy - cy) < reach {
                            info.rivals.insert(o.kind + "|" + o.text)
                            o.rivals.insert(key)
                        }
                    }
                }
                info.cx = cx
                info.cy = cy
                info.len = Double(px)
                info.lastPts = pts
            }
            bx.append(Box(rect: CGRect(x: f.box.minX, y: 1 - f.box.maxY, width: f.box.width, height: f.box.height), counted: info.countedMs != nil))
            rows.append([info.index, Int(f.box.minX * 1000), Int(f.box.minY * 1000), Int(f.box.width * 1000), Int(f.box.height * 1000), f.cls == 0 ? Int(f.conf * 100) : f.cls])
        }
        // who counts now
        for info in touched {
            var best = 0
            for k in info.rivals {
                if let o = codes[k] {
                    best = max(best, o.score)
                    if o.countedMs != nil && info.score > 2 * o.score {       // the rival was counted and is now far outread: taken back
                        o.countedMs = nil
                        o.lost = true
                        counted -= 1
                    }
                }
            }
            if info.countedMs == nil && info.enough && info.score > best && !(info.lost && info.score <= 2 * best) {
                info.countedMs = (now - t0) * 1000
                counted += 1
            }
        }
        var sizeMm = -1
        if sizes.count >= 2 {
            sizes.sort()
            sizeMm = Int(sizes[sizes.count / 2].rounded())
            lastSizeMm = sizeMm
            lastSizeAt = now
        }
        if !slabPx.isEmpty {                    // for the helpers: when a slab's code was last read, and how long the codes are
            slabPx.sort()
            if pts > lastSlabPts { lastSlabPts = pts }
            if pts >= lastCodePxAt {
                lastCodePx = slabPx[slabPx.count / 2]
                lastCodePxAt = pts
            }
        }
        if let fr = fr, sizeMm > 0 { fr.sizeMm = sizeMm }
        if !bx.isEmpty || now - lastBoxesAt > 0.25 {
            lastBoxes = bx
            lastBoxesAt = now
        }
        return rows
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
                list.append(CodeRow(id: c.kind + "|" + c.text, kind: c.kind, text: c.text, counted: c.countedMs != nil, sightings: c.score))
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
        let fs = fStateNow
        let glare = glareNow && reading
        let fast = tooFastNow && reading
        let ours = webReaders
        let lampAuto = torchIsOn && lightMode == .auto
        let heat = heatNow
        let sp = speedNow
        // a frame our reader never answered for (its page failed, or was stopped) is given up after 4 s
        for (k, j) in webJobs where now - j.at > 4.0 {
            webJobs.removeValue(forKey: k)
            j.r?.jobs -= 1
        }
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
        s += " · \(rps) reads/s"
        if !ours.isEmpty { s += " · ours \(ours.filter { $0.ready }.count)/\(ours.count)" }
        if sp > 400 { s += " · moving \(Int(sp))" }
        if w > 0 && w != 4032 { s += " · \(w)x\(h)" }
        status = s
        var hi = ""
        if fast {
            hi = "Too fast to read: move slower"
        } else if fs == 1 || fs == 2 || fs == 4 {
            hi = "Finding the focus…"
        } else if glare {
            hi = "Glare: tilt or move the phone a little"
        } else if lampAuto {
            hi = "Dim light: the lamp is on"
        }
        if heat >= 2 && hi.isEmpty { hi = "The phone is hot: reading fewer frames" }
        if hint != hi { hint = hi }
        if recording && r != nil && !isStopping {
            elapsed = now - t0
            if elapsed >= limit { stop() }
        }
    }
}
