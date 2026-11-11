//  The one screen: the camera's picture on top, the test and the switches under it.
import SwiftUI

struct ContentView: View {
    @StateObject private var engine = Engine()

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
                }
                .frame(width: geo.size.width, height: geo.size.height * 0.52)
                .background(Color.black)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        counter
                        planBlock
                        buttons
                        resultBlock
                        switches
                        codeList
                    }
                    .padding(12)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
        .onAppear { engine.start() }
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

    private var planBlock: some View {
        HStack(alignment: .top, spacing: 8) {
            Button {
                engine.stepBy(-1)
            } label: {
                Image(systemName: "chevron.left").frame(width: 30, height: 40)
            }
            .buttonStyle(.bordered)
            .disabled(engine.recording || engine.saving)
            VStack(alignment: .leading, spacing: 2) {
                Text("Next: test \(engine.step + 1) of \(TestPlan.steps.count)")
                    .font(.subheadline.bold())
                Text(TestPlan.steps[engine.step].what)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                engine.stepBy(1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 30, height: 40)
            }
            .buttonStyle(.bordered)
            .disabled(engine.recording || engine.saving)
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
                } else {
                    Button {
                        engine.record()
                    } label: {
                        Text(engine.saving ? "Saving…" : "Record test").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(engine.saving)
                }
                Button {
                    engine.snap()
                } label: {
                    Text("Snap").frame(width: 70)
                }
                .buttonStyle(.bordered)
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
                .disabled(engine.recording)
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
                        Label("Save test data (" + engine.shareSize + ")", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .controlSize(.large)
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
                .frame(width: 130)
                Spacer()
                Toggle("Depth", isOn: $engine.depthOn)
                    .font(.caption)
                    .fixedSize()
            }
            HStack(spacing: 14) {
                Toggle("Video", isOn: $engine.videoOn)
                    .font(.caption)
                    .fixedSize()
                Toggle("Light", isOn: $engine.lightOn)
                    .font(.caption)
                    .fixedSize()
                Spacer()
            }
            Toggle("Scan without recording", isOn: $engine.live)
                .font(.caption)
            Text("A test stops by itself. Then Save test data hands over one file: the video, the lossless frames, what the camera did for every frame, the depth sensor, the phone's movement and every code. Green box: counted. Yellow: read, not counted yet.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .disabled(engine.recording || engine.saving)
        .onChange(of: engine.lens) { engine.apply() }
        .onChange(of: engine.size) { engine.apply() }
        .onChange(of: engine.shutter) { engine.apply() }
        .onChange(of: engine.focus) { engine.apply() }
        .onChange(of: engine.depthOn) { engine.apply() }
        .onChange(of: engine.lightOn) { engine.apply() }
        .onChange(of: engine.live) { engine.setLive(engine.live) }
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
