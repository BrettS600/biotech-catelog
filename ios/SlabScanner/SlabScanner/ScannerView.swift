//  The camera screen of the website's app (n5): a table being filmed. It looks like the page's own viewfinder - the table's
//  name, the REC badge with the time and the slabs read, the note when the phone moves too fast or there is glare, the
//  lens and the light, the slabs as the page looks them up - and Stop sends the slabs to the table, as on the page.
import SwiftUI

struct ScannerView: View {
    @ObservedObject var app: WebApp
    @ObservedObject var engine: Engine

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(app.title.isEmpty ? "Recording" : app.title)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer()
                TimelineView(.periodic(from: app.scanStarted, by: 1)) { ctx in
                    let s = max(0, Int(ctx.date.timeIntervalSince(app.scanStarted)))
                    HStack(spacing: 6) {
                        Circle().fill(Color.red).frame(width: 8, height: 8)
                        Text(String(format: "REC %d:%02d · %d read", s / 60, s % 60, app.feedN))
                            .font(.footnote.weight(.semibold).monospacedDigit())
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.6))
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            ZStack(alignment: .top) {
                PreviewView(engine: engine)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                Text(engine.status)
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.white.opacity(0.85))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Capsule())
                    .padding(.top, 6)
                VStack {
                    Spacer()
                    if !engine.hint.isEmpty {
                        Text(engine.hint)
                            .font(.subheadline.bold())
                            .foregroundColor(.black)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.yellow.opacity(0.92))
                            .clipShape(Capsule())
                    }
                    if !engine.problem.isEmpty {
                        Text(engine.problem)
                            .font(.footnote)
                            .foregroundColor(.white)
                            .padding(8)
                            .background(Color.red.opacity(0.8))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(.bottom, 10)
            }
            .padding(.horizontal, 10)

            HStack(spacing: 10) {
                Picker("Lens", selection: Binding(get: { app.scanLens }, set: { app.setLens($0) })) {
                    Text("1x").tag(Lens.wide)
                    Text("3x").tag(Lens.tele)
                }
                .pickerStyle(.segmented)
                .frame(width: 120)
                Picker("Light", selection: Binding(get: { engine.scanLight }, set: { app.setLight($0) })) {
                    Text("Light auto").tag(LightMode.auto)
                    Text("On").tag(LightMode.on)
                    Text("Off").tag(LightMode.off)
                }
                .pickerStyle(.segmented)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            VStack(alignment: .leading, spacing: 4) {
                if !app.dup.isEmpty {
                    Text(app.dup).font(.footnote).foregroundColor(.orange)
                }
                ForEach(Array(app.feed.prefix(4).enumerated()), id: \.offset) { _, item in
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                        Text(item.first ?? "").font(.footnote.weight(.semibold)).foregroundColor(.white).lineLimit(1)
                        Spacer()
                        Text(item.count > 1 ? item[1] : "").font(.caption.weight(.bold)).foregroundColor(.white.opacity(0.75))
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            VStack(spacing: 4) {
                Button {
                    app.endScan()
                } label: {
                    ZStack {
                        Circle().stroke(Color.white, lineWidth: 4).frame(width: 74, height: 74)
                        RoundedRectangle(cornerRadius: 6).fill(Color.red).frame(width: 30, height: 30)
                    }
                }
                .accessibilityLabel("Stop recording")
                Text("Tap to stop - the slabs go to this table")
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.7))
            }
            .padding(.vertical, 10)
        }
        .background(Color(red: 0x0D / 255.0, green: 0x11 / 255.0, blue: 0x17 / 255.0).ignoresSafeArea())
    }
}
