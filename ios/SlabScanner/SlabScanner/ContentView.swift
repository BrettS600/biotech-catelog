//  The test screen (opened by Test mode in the website's app): the camera's picture on top, the test and the switches under it.
import SwiftUI

struct ContentView: View {
    @ObservedObject var engine: Engine
    var close: () -> Void = {}
    @State private var askDelete = false
    @State private var countdown = 0            // v1: three seconds to get into place before a test records
    @State private var countGen = 0
    @State private var showSwitches = false     // the plan sets every switch; they are folded away

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                ZStack(alignment: .top) {
                    PreviewView(engine: engine)
                    Text(engine.status)
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.black.opacity(0.55))
                        .clipShape(Capsule())
                        .padding(.top, 4)
                    if countdown > 0 {
                        Text("\(countdown)")
                            .font(.system(size: 110, weight: .bold))
                            .foregroundColor(.white)
                            .shadow(color: .black, radius: 8)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    VStack(spacing: 6) {
                        Spacer()
                        if !engine.hint.isEmpty {
                            Text(engine.hint)
                                .font(.footnote.bold())
                                .foregroundColor(.black)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Color.yellow.opacity(0.9))
                                .clipShape(Capsule())
                        }
                        pacer
                    }
                    .padding(.bottom, 6)
                    .allowsHitTesting(false)
                }
                .frame(width: geo.size.width, height: geo.size.height * 0.52)
                .background(Color.black)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Scanner test").font(.headline)
                            Spacer()
                            Button("Close") { close() }
                                .buttonStyle(.bordered)
                                .disabled(engine.recording || engine.saving || countdown > 0)
                        }
                        counter
                        planBlock
                        buttons
                        resultBlock
                        testFiles
                        DisclosureGroup("Switches (the plan sets them for every test)", isExpanded: $showSwitches) {
                            switches
                        }
                        .font(.caption)
                        codeList
                    }
                    .padding(12)
                    .onAppear { engine.refreshTests() }
                    .onChange(of: engine.lens) { engine.apply() }
                    .onChange(of: engine.size) { engine.apply() }
                    .onChange(of: engine.shutter) { engine.apply() }
                    .onChange(of: engine.focus) { engine.apply() }
                    .onChange(of: engine.depthOn) { engine.apply() }
                    .onChange(of: engine.light) { engine.apply() }
                    .onChange(of: engine.live) { engine.setLive(engine.live) }
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    private var counter: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("\(engine.countedN)")
                .font(.system(size: 34, weight: .bold).monospacedDigit())
            Text(engine.countedN == 1 ? "code" : "codes")
                .font(.headline)
            Spacer()
            if engine.recording {
                Text(String(format: "%.1f s", engine.elapsed))
                    .font(.title3.monospacedDigit())
                    .foregroundColor(.red)
            }
        }
    }

    // v1: three seconds to get into place, then the test records by itself
    private func startTest() {
        if engine.recording || engine.saving || countdown > 0 { return }
        countGen += 1
        countdown = 3
        countStep(countGen)
    }

    private func countStep(_ gen: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            if gen != countGen || countdown <= 0 { return }
            countdown -= 1
            if countdown == 0 {
                engine.record()
            } else {
                countStep(gen)
            }
        }
    }

    private func cancelCount() {
        countGen += 1
        countdown = 0
    }

    private func lensName(_ l: Lens) -> String {
        switch l {
        case .wide: return "1x lens"
        case .wide2: return "2x lens"
        case .tele: return "Zoom lens"
        case .tele2: return "Zoom lens at 2x"
        }
    }

    private func doLine(_ p: TestStep) -> String {
        if p.line > 0 { return "Stand on line \(p.line). " + p.what }
        return p.what
    }

    /// What the plan has set for the test on the screen (the switches themselves are folded away).
    private func setLine(_ p: TestStep) -> String {
        var s = "Set for you: " + lensName(engine.lens)
        s += " · " + engine.size.rawValue
        s += " · shutter " + engine.shutter.rawValue
        s += " · focus " + engine.focus.rawValue
        s += " · lamp " + engine.light.rawValue.lowercased()
        s += " · \(Int(p.seconds)) seconds"
        return s
    }

    /// A PASS (v1): the four sheets as four boxes, the one to aim at green - from sheet 1 to sheet 4 in the test's pace
    /// and back, so every round glides along the sheets at the same speed.
    @ViewBuilder
    private var pacer: some View {
        let p = TestPlan.steps[engine.step]
        if engine.recording && p.pace > 0 {
            let t = max(0, engine.elapsed)
            let leg = Int(t / p.pace)
            let frac = (t - Double(leg) * p.pace) / p.pace
            let forward = leg % 2 == 0
            let pos = forward ? frac : 1 - frac
            let sheet = min(3, max(0, Int(pos * 4)))
            VStack(spacing: 4) {
                Text(forward ? "Glide right  →" : "←  Glide left")
                    .font(.subheadline.bold())
                    .foregroundColor(.white)
                HStack(spacing: 6) {
                    ForEach(0..<4, id: \.self) { i in
                        Text("\(i + 1)")
                            .font(.title3.bold())
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background(i == sheet ? Color.green : Color.white.opacity(0.25))
                            .foregroundColor(i == sheet ? .black : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
                Text("Aim at the green sheet")
                    .font(.caption2)
                    .foregroundColor(.white)
            }
            .padding(8)
            .background(Color.black.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 12)
        }
    }

    private var planBlock: some View {
        let p = TestPlan.steps[engine.step]
        let busy = engine.recording || engine.saving || countdown > 0
        return HStack(alignment: .top, spacing: 8) {
            Button {
                engine.stepBy(-1)
            } label: {
                Image(systemName: "chevron.left").frame(width: 30, height: 40)
            }
            .buttonStyle(.bordered)
            .disabled(busy)
            VStack(alignment: .leading, spacing: 3) {
                Text("Test \(engine.step + 1) of \(TestPlan.steps.count)")
                    .font(.subheadline.bold())
                if !p.room.isEmpty {
                    Text(p.room)
                        .font(.caption.bold())
                        .foregroundColor(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(doLine(p))
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(setLine(p))
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !engine.lensNote.isEmpty {
                    Text(engine.lensNote)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                engine.stepBy(1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 30, height: 40)
            }
            .buttonStyle(.bordered)
            .disabled(busy)
        }
    }

    private var buttons: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if engine.recording {
                    Button {
                        engine.stop()
                    } label: {
                        Text("Stop").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                } else if countdown > 0 {
                    Button {
                        cancelCount()
                    } label: {
                        Text("Starting in \(countdown) - tap to cancel").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button {
                        startTest()
                    } label: {
                        Text(engine.saving ? "Saving…" : "Start test \(engine.step + 1)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(engine.saving)
                }
            }
            .controlSize(.large)
            if !engine.snapNote.isEmpty {
                Text(engine.snapNote).font(.footnote)
            }
            if !engine.problem.isEmpty {
                Text(engine.problem).font(.footnote).foregroundColor(.red)
            }
            TextField("Note for this test (optional)", text: $engine.note)
                .textFieldStyle(.roundedBorder)
                .font(.subheadline)
                .disabled(engine.recording || countdown > 0)
        }
    }

    @ViewBuilder
    private var resultBlock: some View {
        if !engine.result.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(engine.result)
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                if let url = engine.shareURL {
                    ShareLink(item: url) {
                        Label("Send only this test (" + engine.shareSize + ")", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var switches: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Lens").font(.caption).frame(width: 52, alignment: .leading)
                Picker("Lens", selection: $engine.lens) {
                    ForEach(Lens.allCases, id: \.self) { v in
                        Text(v.rawValue).tag(v)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Size", selection: $engine.size) {
                    ForEach(SizeMode.allCases, id: \.self) { v in
                        Text(v.rawValue).tag(v)
                    }
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: 8) {
                Text("Shutter").font(.caption).frame(width: 52, alignment: .leading)
                Picker("Shutter", selection: $engine.shutter) {
                    ForEach(ShutterMode.allCases, id: \.self) { v in
                        Text(v.rawValue).tag(v)
                    }
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: 8) {
                Text("Focus").font(.caption).frame(width: 52, alignment: .leading)
                Picker("Focus", selection: $engine.focus) {
                    ForEach(FocusMode.allCases, id: \.self) { v in
                        Text(v.rawValue).tag(v)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Lamp", selection: $engine.light) {
                    ForEach(LightMode.allCases, id: \.self) { v in
                        Text(v == .off ? "Lamp off" : v.rawValue).tag(v)
                    }
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: 14) {
                Toggle("Video", isOn: $engine.videoOn)
                    .font(.caption)
                    .fixedSize()
                Toggle("Depth", isOn: $engine.depthOn)
                    .font(.caption)
                    .fixedSize()
                Spacer()
            }
            Toggle("Scan without recording", isOn: $engine.live)
                .font(.caption)
            Text("Every test sets these itself, and the next test sets them again. A change made here by hand lasts for the test on the screen only.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 6)
        .disabled(engine.recording || engine.saving || countdown > 0)
    }

    // the test files on this phone: their size, and one button that deletes them all (2026-11-23, for a borrowed phone)
    private var testFiles: some View {
        let size = ByteCountFormatter.string(fromByteCount: engine.testsBytes, countStyle: .file)
        let n = engine.testsCount
        return VStack(alignment: .leading, spacing: 6) {
            Text("A test starts after a count of three, stops by itself and moves on to the next; to do one again, tap ‹ first. Green box: counted. Yellow: read, not counted yet.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !engine.testZips.isEmpty {
                ShareLink(items: engine.testZips) {
                    Label("Send all \(engine.testZips.count) test file\(engine.testZips.count == 1 ? "" : "s") (\(size))", systemImage: "square.and.arrow.up.on.square")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.large)
                .disabled(engine.recording || engine.saving || countdown > 0)
            }
            Text(n == 0 ? "No test files on this phone." : "On this phone: \(n) test file\(n == 1 ? "" : "s"), \(size). They stay until you delete them; none go into iCloud backups.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(role: .destructive) {
                askDelete = true
            } label: {
                Label("Delete all test files", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(n == 0 || engine.recording || engine.saving)
        }
        .confirmationDialog("Delete all \(n) test file\(n == 1 ? "" : "s") (\(size)) from this phone?", isPresented: $askDelete, titleVisibility: .visible) {
            Button("Delete all", role: .destructive) { engine.deleteTests() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Send them to the Mac first (Send all test files). This cannot be undone.")
        }
    }

    private var codeList: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(engine.rows) { row in
                HStack {
                    Text(row.kind == "ITF" ? "ITF" : "128")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .frame(width: 28, alignment: .leading)
                    Text(row.text)
                        .font(.footnote.monospacedDigit())
                    Spacer()
                    Text(row.counted ? "counted" : "read \(row.sightings)x")
                        .font(.caption2)
                        .foregroundColor(row.counted ? .green : .orange)
                }
            }
        }
    }
}
