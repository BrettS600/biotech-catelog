//  A test: Record, Stop, and the file that is handed over (AirDrop).
//
//  THE FILE (a zip of one folder, slab-native-<version>-t<test>-<date>-<time>):
//    report.json   the test, the phone, the camera as it was set, the counts and times, every code, the events
//    frames.json   one row per frame the camera delivered: what the camera did, the picture's light and sharpness,
//                  how it was read and what was found in it
//    motion.json   the phone's movement 100 times a second, on the camera's clock
//    depth.json    the depth sensor: distance at the centre and on a 5 x 5 grid
//    camera.json   every picture format every back camera of the phone offers
//    video.mov     every frame the camera delivered (HEVC)
//    frame-NN-WxH.y8   up to six frames exactly as the reader saw them: the grey plane, W x H bytes, row by row
//    snap-NN.jpg   the photographs of the Snap button
import AVFoundation
import CoreMotion
import Foundation
import UIKit

extension Engine {

    // MARK: - record (main thread)

    func record() {
        if recording || saving { return }
        let plan = TestPlan.steps[step]
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("tests", isDirectory: true)
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyyMMdd-HHmmss"
        let name = "slab-native-" + TestPlan.version + String(format: "-t%02d-", step + 1) + df.string(from: Date())
        let dir = docs.appendingPathComponent(name, isDirectory: true)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            problem = "The test's folder could not be made: \(error.localizedDescription)"
            return
        }
        prune(docs)
        let r = Recording(step: step, plan: plan, t0: CACurrentMediaTime(), dir: dir, name: name)
        r.note = note
        r.wantVideo = videoOn
        r.heatStart = ProcessInfo.processInfo.thermalState.rawValue
        r.batteryStart = UIDevice.current.batteryLevel
        var st: [String: Any] = [:]
        st["lens"] = lens.rawValue
        st["size"] = size.rawValue
        st["shutter"] = shutter.rawValue
        st["focus"] = focus.rawValue
        st["depthSensor"] = depthOn
        st["video"] = videoOn
        st["light"] = light.rawValue
        st["focusHelper"] = focus == .auto
        st["special"] = plan.special
        st["stopsAfterSeconds"] = Int(plan.seconds)
        r.settings = st
        lock.lock()
        codes = [:]
        order = []
        counted = 0
        visionMs = [:]
        lastBoxes = []
        sweepStep = -1
        r.camera = camInfo
        rec = r
        reading = true
        lock.unlock()
        shareURL = nil
        shareSize = ""
        result = ""
        snapNote = ""
        problem = ""
        elapsed = 0
        recording = true
        event("start", "test \(step + 1)")
    }

    // MARK: - stop (main thread), then the file (io thread)

    func stop() {
        if !recording { return }
        recording = false
        saving = true
        let endHeat = ProcessInfo.processInfo.thermalState.rawValue
        let endBattery = UIDevice.current.batteryLevel
        let keepReading = live
        lock.lock()
        guard let r = rec else {
            lock.unlock()
            saving = false
            return
        }
        r.events.append([Int((CACurrentMediaTime() - r.t0) * 1000), "stop", "\(r.delivered) frames"])
        r.stopping = true
        reading = keepReading
        let seconds = CACurrentMediaTime() - r.t0
        let lampAuto = lightMode == .auto
        lock.unlock()
        if !keepReading && lampAuto {           // the lamp that came on by itself goes off with the test
            sessionQ.async { self.setTorch(false) }
        }
        let special = r.plan.special
        captureQ.async {
            let group = DispatchGroup()
            if let w = r.writer, let i = r.writerInput, w.status == .writing {
                group.enter()
                i.markAsFinished()
                w.finishWriting {
                    group.leave()
                }
            }
            self.io.async {
                group.wait()
                var tries = 0
                while tries < 60 {              // the reads of this test still under way (3 seconds at most)
                    self.lock.lock()
                    let n = r.jobs
                    self.lock.unlock()
                    if n <= 0 { break }
                    Thread.sleep(forTimeInterval: 0.05)
                    tries += 1
                }
                let out = self.writeFiles(r, seconds: seconds, endHeat: endHeat, endBattery: endBattery)
                self.lock.lock()
                self.rec = nil
                self.lock.unlock()
                DispatchQueue.main.async {
                    self.saving = false
                    self.shareURL = out.0
                    self.shareSize = out.2
                    self.result = out.1
                    if out.0 == nil { self.problem = "The test's file could not be zipped; its folder is in Files > On My iPhone > Slab Scanner > tests." }
                    if self.step < TestPlan.steps.count - 1 { self.step += 1 }
                    self.note = ""
                    self.loadPlan()
                    self.apply()
                    if special == "lockfocus" || special == "sweep" { self.apply() }
                }
            }
        }
    }

    func prune(_ docs: URL) {       // the ten newest files stay on the phone
        let fm = FileManager.default
        guard let all = try? fm.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil) else { return }
        let zips = all.filter { $0.pathExtension == "zip" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        if zips.count > 10 {
            for u in zips[10...] { try? fm.removeItem(at: u) }
        }
    }

    func writeJSON(_ obj: Any, _ url: URL, _ r: Recording) {
        if !JSONSerialization.isValidJSONObject(obj) {
            logError(r, "file: " + url.lastPathComponent + " held something that cannot be written")
            return
        }
        do {
            let d = try JSONSerialization.data(withJSONObject: obj, options: [])
            try d.write(to: url)
        } catch {
            logError(r, "file: " + url.lastPathComponent + ": \(error.localizedDescription)")
        }
    }

    /// Every picture format of every back camera - what the phone's cameras can do.
    func cameraDump() -> [[String: Any]] {
        var out: [[String: Any]] = []
        let types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .builtInTelephotoCamera, .builtInUltraWideCamera, .builtInLiDARDepthCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices
        for d in found {
            var dev: [String: Any] = [:]
            dev["name"] = d.localizedName
            dev["type"] = d.deviceType.rawValue
            dev["closestFocusMm"] = d.minimumFocusDistance
            dev["torch"] = d.hasTorch
            var fmts: [[Any]] = []
            for f in d.formats {
                let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
                var maxFps = 0.0
                for r in f.videoSupportedFrameRateRanges { maxFps = max(maxFps, r.maxFrameRate) }
                var photo = 0
                for pd in f.supportedMaxPhotoDimensions { photo = max(photo, Int(pd.width) * Int(pd.height)) }
                var depth = ""
                for df in f.supportedDepthDataFormats {
                    let dd = CMVideoFormatDescriptionGetDimensions(df.formatDescription)
                    depth += "\(dd.width)x\(dd.height)" + fourcc(CMFormatDescriptionGetMediaSubType(df.formatDescription)) + " "
                }
                var row: [Any] = []
                row.append(Int(dim.width))
                row.append(Int(dim.height))
                row.append(fourcc(CMFormatDescriptionGetMediaSubType(f.formatDescription)))
                row.append(Int(maxFps))
                row.append(f.isVideoBinned)
                row.append(Int(f.videoFieldOfView * 10))
                row.append(Int(f.minISO))
                row.append(Int(f.maxISO))
                row.append(ji(f.minExposureDuration.seconds * 1e6))
                row.append(ji(f.maxExposureDuration.seconds * 1e6))
                row.append(f.isVideoHDRSupported)
                row.append(photo)
                row.append(depth)
                fmts.append(row)
            }
            dev["formatFields"] = ["width", "height", "pixel format", "most frames a second", "binned", "field of view, degrees x10", "lowest ISO", "highest ISO", "shortest shutter, microseconds", "longest shutter, microseconds", "HDR", "largest photo, dots", "depth formats"]
            dev["formats"] = fmts
            out.append(dev)
        }
        return out
    }

    func writeFiles(_ r: Recording, seconds: Double, endHeat: Int, endBattery: Float) -> (URL?, String, String) {
        let fm = FileManager.default
        lock.lock()
        let frames = r.frames
        let motionFlat = r.motion
        let depthRows = r.depth
        let events = r.events
        let snaps = r.snaps
        let list = order
        let vms = visionMs
        let webs = webReaders
        let notes = webNotes
        let fills = webFill
        lock.unlock()

        // the codes
        var codeRows: [[Any]] = []
        var countedTimes: [Double] = []
        var sightedOnly = 0
        var other = 0
        var takenBack = 0
        for c in list {
            var row: [Any] = []
            row.append(c.kind)
            row.append(c.text)
            row.append(c.countedMs != nil)
            row.append(c.frames)
            row.append(ji(c.firstMs))
            if let t = c.countedMs {
                row.append(ji(t))
                countedTimes.append(t)
            } else {
                row.append(NSNull())
                if c.slab { sightedOnly += 1 } else { other += 1 }
            }
            row.append(c.minPx == Int.max ? 0 : c.minPx)
            row.append(c.maxPx)
            row.append(c.firstBy)
            row.append(c.by["Q"] ?? 0)
            row.append(c.by["N"] ?? 0)
            row.append(c.by["S"] ?? 0)
            row.append(c.by["T"] ?? 0)
            row.append(Int(c.conf * 100))
            row.append(c.slab)
            row.append(c.weak)
            row.append(c.framesW)
            row.append(c.framesWC)
            row.append(c.rivals.sorted().map { String($0.split(separator: "|").last ?? "") }.joined(separator: " "))
            row.append(c.lost)
            if c.lost && c.countedMs == nil { takenBack += 1 }
            codeRows.append(row)
        }
        countedTimes.sort()

        // the frames
        var frameRows: [[Any]] = []
        var exps: [Double] = []
        var isos: [Double] = []
        var sharps: [Double] = []
        var means: [Double] = []
        var lensPs: [Double] = []
        var depths: [Double] = []
        var afN = 0
        var readN = 0
        var bySize: [Double] = []
        var speeds: [Double] = []
        var lights: [Double] = []
        var darkN = 0
        var lampN = 0
        var helpN = 0
        var webN = 0
        for f in frames {
            var row: [Any] = []
            row.append(f.n)
            row.append(ji(f.t))
            row.append(ji(f.exp * 1e6))
            row.append(ji(f.iso))
            row.append(ji(f.lensPos * 1000))
            row.append(f.af ? 1 : 0)
            row.append(f.ae ? 1 : 0)
            row.append(ji(f.off * 100))
            row.append(f.mean)
            row.append(f.p1)
            row.append(f.p99)
            row.append(f.blown)
            row.append(f.sharp)
            row.append(f.capDen)
            row.append(f.sweep)
            row.append(f.depthMm)
            row.append(f.job)
            row.append(ji(f.jobMs))
            if f.job.isEmpty { row.append(NSNull()) } else { row.append(ji(f.doneT)) }
            row.append(f.found)
            row.append(f.kept)
            row.append(f.sizeMm)
            row.append(f.speed)
            row.append(ji(f.bias * 100))
            row.append(f.torch ? 1 : 0)
            row.append(f.fstate)
            row.append(ji(f.light * 100))
            row.append(f.readers)
            row.append(ji(f.webMs))
            if f.webMs < 0 { row.append(NSNull()) } else { row.append(ji(f.webDone)) }
            row.append(f.webBoxes)
            row.append(f.webFound)
            if f.webMs >= 0 { webN += 1 }
            frameRows.append(row)
            if f.speed >= 0 { speeds.append(Double(f.speed)) }
            if f.light > 0 { lights.append(f.light) }
            if f.bias < -0.3 { darkN += 1 }
            if f.torch { lampN += 1 }
            if f.fstate != 0 { helpN += 1 }
            if f.sizeMm > 0 { bySize.append(Double(f.sizeMm)) }
            if f.exp > 0 { exps.append(f.exp) }
            if f.iso > 0 { isos.append(f.iso) }
            sharps.append(Double(f.sharp))
            means.append(Double(f.mean))
            lensPs.append(f.lensPos)
            if f.depthMm > 0 { depths.append(Double(f.depthMm)) }
            if f.af { afN += 1 }
            if !f.job.isEmpty { readN += 1 }
        }
        let frameFields: [String] = ["frame number", "ms since the record tap", "shutter, microseconds", "ISO", "focus position, per mille", "focus moving", "exposure moving", "exposure offset, EV x100 (below 0: darker than the camera wants)", "brightness: mean", "darkest 1%", "brightest 1%", "blown out, per mille", "sharpness", "shutter cap, 1/x s (0: the camera's own)", "sweep step (-1: none)", "distance by the depth sensor, mm (-1: none)", "Apple's reader: read as (Q four tiles, N nine, S sixteen; empty: not read by it)", "reading ms", "result known: ms since the record tap", "codes in this frame: [number in the list, x, y, width, height in per mille of the picture as the camera gives it (from its bottom-left), confidence x100]", "kept lossless (the file's number; 0: not kept)", "distance by the size of the codes read in this frame, mm (-1: none)", "the picture's movement against the frame before, dots a second (-1: not known)", "exposure bias in force, EV x100 (the glare help's darker frames: -150)", "lamp on", "focus helper (0 the camera's own focus, 1 asked to refocus, 2 trying positions, 3 held, 4 waiting for a read after the refocus)", "the light: ISO x seconds the camera needs, x100", "frames being read by Apple's reader when this one came", "our own reader: reading ms for this frame (-1: not given to it)", "our own reader: result known, ms since the record tap", "our own reader: striped patches found", "our own reader: codes in this frame [number in the list, x, y, width, height in per mille (from the bottom-left), class: 1 sure, 2 strong, 3 weak]"]
        var framesDoc: [String: Any] = [:]
        framesDoc["fields"] = frameFields
        framesDoc["rows"] = frameRows
        writeJSON(framesDoc, r.dir.appendingPathComponent("frames.json"), r)

        // the movement
        var motionRows: [[Any]] = []
        var k = 0
        while k + 9 < motionFlat.count {
            var row: [Any] = []
            for j in 0..<10 { row.append(ji(motionFlat[k + j])) }
            motionRows.append(row)
            k += 10
        }
        var motionDoc: [String: Any] = [:]
        motionDoc["fields"] = ["ms since the record tap", "turning x, mrad/s", "turning y", "turning z", "acceleration x, thousandths of g (gravity taken out)", "acceleration y", "acceleration z", "gravity x, thousandths", "gravity y", "gravity z"]
        motionDoc["rows"] = motionRows
        writeJSON(motionDoc, r.dir.appendingPathComponent("motion.json"), r)

        // the depth sensor
        var depthDoc: [String: Any] = [:]
        depthDoc["fields"] = ["ms since the record tap", "distance at the centre, mm (-1: none)", "5 x 5 grid of distances, mm, row by row from the top-left of the depth picture (null: no reading)", "quality (1 high, 0 low)", "absolute distances (1) or only relative (0)", "smoothed (1) or the sensor's own (0)"]
        depthDoc["rows"] = depthRows
        writeJSON(depthDoc, r.dir.appendingPathComponent("depth.json"), r)

        writeJSON(cameraDump(), r.dir.appendingPathComponent("camera.json"), r)

        // the report
        var rep: [String: Any] = [:]
        rep["report"] = "Slab Scanner native test"
        rep["version"] = TestPlan.version
        var test: [String: Any] = [:]
        test["number"] = r.step + 1
        test["of"] = TestPlan.steps.count
        test["what"] = r.plan.what
        rep["test"] = test
        rep["at"] = ISO8601DateFormatter().string(from: r.startedAt)
        rep["phone"] = machineName()
        rep["system"] = UIDevice.current.systemVersion
        rep["settings"] = r.settings
        rep["camera"] = r.camera
        rep["note"] = r.note
        rep["milliseconds"] = ji(seconds * 1000)
        rep["framesDelivered"] = frames.count
        rep["framesRead"] = readN
        rep["framesReadByOurReader"] = webN
        var our: [String: Any] = [:]
        our["readers"] = webs.map { $0.state }
        our["notes"] = notes
        our["msToFillTheFrameMedian"] = ji(medianOf(fills))
        our["framesRead"] = webN
        rep["ourReader"] = our
        rep["numbersTakenBack"] = takenBack
        rep["framesTheCameraDropped"] = r.cameraDropped
        if seconds > 0 { rep["framesReadPerSecond"] = ji(Double(readN) / seconds) }
        var vdoc: [String: Any] = [:]
        for (kind, a) in vms {
            var one: [String: Any] = [:]
            one["reads"] = a.count
            one["medianMs"] = ji(medianOf(a))
            one["slowestTenthMs"] = ji(quantile(a, 0.9))
            vdoc[kind] = one
        }
        rep["readingMs"] = vdoc
        rep["slabCodesCounted"] = countedTimes.count
        rep["slabCodesSightedButNotCounted"] = sightedOnly
        rep["otherThingsRead"] = other
        if !countedTimes.isEmpty {
            rep["halfCountedByMs"] = ji(countedTimes[countedTimes.count / 2])
            rep["allCountedByMs"] = ji(countedTimes[countedTimes.count - 1])
        }
        rep["listFields"] = ["kind", "text", "counted", "frames it was read in", "first read: ms since the record tap (the frame's own time)", "counted: ms since the record tap (when the app knew; null: never)", "smallest long side, dots", "largest long side, dots", "first read by (Q / N / S: Apple's reader; F: our own)", "frames by Q", "by N", "by S", "by T", "confidence x100", "looks like a slab cert", "weak reads (confidence under 0.5: not counted)", "frames by our own reader, sure or strong", "frames by our own reader, weak", "other numbers read at the same place (rivals)", "counted, then taken back (a rival at its place was read far more often)"]
        rep["list"] = codeRows
        var cam: [String: Any] = [:]
        cam["shutterMedianMicroseconds"] = ji(medianOf(exps) * 1e6)
        cam["shutterShortestMicroseconds"] = ji((exps.min() ?? .nan) * 1e6)
        cam["shutterLongestMicroseconds"] = ji((exps.max() ?? .nan) * 1e6)
        cam["isoMedian"] = ji(medianOf(isos))
        cam["isoHighest"] = ji(isos.max() ?? .nan)
        cam["focusLowestPerMille"] = ji((lensPs.min() ?? .nan) * 1000)
        cam["focusHighestPerMille"] = ji((lensPs.max() ?? .nan) * 1000)
        cam["framesWithFocusMoving"] = afN
        cam["brightnessMedian"] = ji(medianOf(means))
        cam["sharpnessMedian"] = ji(medianOf(sharps))
        cam["sharpnessLowestTenth"] = ji(quantile(sharps, 0.1))
        cam["distanceByTheDepthSensorMedianMm"] = ji(medianOf(depths))
        cam["distanceByTheDepthSensorReadings"] = depths.count
        cam["distanceByTheCodesSizeMedianMm"] = ji(medianOf(bySize))
        cam["distanceByTheCodesSizeReadings"] = bySize.count
        cam["movementMedianDotsASecond"] = ji(medianOf(speeds))
        cam["movementHighestTenthDotsASecond"] = ji(quantile(speeds, 0.9))
        cam["lightMedianIsoSecondsX100"] = ji(medianOf(lights) * 100)
        cam["framesTakenDarkerForGlare"] = darkN
        cam["framesWithTheLampOn"] = lampN
        cam["framesWithTheFocusHelperAtWork"] = helpN
        rep["whatTheCameraDid"] = cam
        var heat: [String: Any] = [:]
        heat["start"] = r.heatStart
        heat["end"] = endHeat
        heat["scale"] = "0 normal, 1 fair, 2 serious, 3 critical"
        rep["heat"] = heat
        var bat: [String: Any] = [:]
        bat["startPercent"] = ji(Double(r.batteryStart) * 100)
        bat["endPercent"] = ji(Double(endBattery) * 100)
        rep["battery"] = bat
        var vid: [String: Any] = [:]
        vid["wanted"] = r.wantVideo
        vid["frames"] = r.videoFrames
        vid["framesTheWriterWasNotReadyFor"] = r.videoSkipped
        vid["file"] = r.videoFrames > 0 ? "video.mov" : ""
        rep["video"] = vid
        rep["losslessFrames"] = r.kept
        rep["snaps"] = snaps
        rep["snapsAsked"] = r.snapsAsked
        rep["eventFields"] = ["ms since the record tap", "what", "detail"]
        rep["events"] = events
        rep["depthReadings"] = depthRows.count
        rep["movementReadings"] = motionRows.count
        rep["sweep"] = r.plan.special == "sweep" ? TestPlan.sweep : []
        rep["sweepSecondsEach"] = ji(TestPlan.sweepSeconds)
        lock.lock()
        let errs = r.errors
        lock.unlock()
        rep["errors"] = errs
        writeJSON(rep, r.dir.appendingPathComponent("report.json"), r)

        // one file
        let zipURL = r.dir.deletingLastPathComponent().appendingPathComponent(r.name + ".zip")
        var coordErr: NSError? = nil
        var copied = false
        NSFileCoordinator().coordinate(readingItemAt: r.dir, options: [.forUploading], error: &coordErr) { tmp in
            do {
                if fm.fileExists(atPath: zipURL.path) { try fm.removeItem(at: zipURL) }
                try fm.copyItem(at: tmp, to: zipURL)
                copied = true
            } catch {
            }
        }
        var line = "Test \(r.step + 1): \(countedTimes.count) codes in \(Int(seconds.rounded())) s"
        if !countedTimes.isEmpty {
            line += String(format: " (half by %.1f s, all by %.1f s)", countedTimes[countedTimes.count / 2] / 1000, countedTimes[countedTimes.count - 1] / 1000)
        }
        line += " · frames read: Apple's \(readN), ours \(webN) of \(frames.count)"
        if !exps.isEmpty { line += " · shutter 1/\(Int((1 / medianOf(exps)).rounded()))" }
        if !bySize.isEmpty { line += String(format: " · %.1f in", medianOf(bySize) / 25.4) }
        if !snaps.isEmpty { line += " · \(snaps.count) snaps" }
        if !errs.isEmpty { line += " · \(errs.count) problem(s) noted in the file" }
        if copied && coordErr == nil {
            try? fm.removeItem(at: r.dir)
            var size = ""
            if let a = try? fm.attributesOfItem(atPath: zipURL.path), let n = a[.size] as? NSNumber {
                size = "\(Int((n.doubleValue / 1e6).rounded())) MB"
            }
            return (zipURL, line, size)
        }
        return (nil, line, "")
    }
}
