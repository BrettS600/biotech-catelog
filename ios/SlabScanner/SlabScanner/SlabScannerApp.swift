//  Slab Scanner - the native app (n5: the website's app inside, the camera and the reading native, the test screen kept).
//  See biotech-catelog CLAUDE.md, "THE NATIVE TRIAL APP", and WebApp.swift.
import SwiftUI

@main
struct SlabScannerApp: App {
    var body: some Scene {
        WindowGroup {
            MainView()
        }
    }
}

struct MainView: View {
    @StateObject private var app = WebApp()

    var body: some View {
        ZStack {
            WebAppView(app: app)
                .ignoresSafeArea()
            if !app.loadProblem.isEmpty {
                Button {
                    app.reloadApp()
                } label: {
                    Text(app.loadProblem)
                        .font(.footnote)
                        .foregroundColor(.white)
                        .padding(14)
                        .background(Color.red.opacity(0.85))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .padding(24)
                }
            }
            // (the camera and test screens lie over the page rather than being presented: the page and our reader's web
            // views must stay in the window while the camera runs)
            if app.scanning {
                ScannerView(app: app, engine: app.engine)
                    .transition(.opacity)
                    .zIndex(1)
            }
            if app.testing {
                ContentView(engine: app.engine, close: { app.closeTest() })
                    .background(Color(UIColor.systemBackground).ignoresSafeArea())
                    .transition(.move(edge: .bottom))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.2), value: app.scanning)
        .animation(.easeOut(duration: 0.25), value: app.testing)
        .sheet(item: $app.review) { t in
            ReviewSheet(app: app, target: t)
        }
    }
}
