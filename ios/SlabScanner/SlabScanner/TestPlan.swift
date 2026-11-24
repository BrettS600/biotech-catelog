//  The switches and the plan of tests. A step of the plan sets the switches by itself (the lens, the size, the shutter,
//  the focus, the depth sensor, the light, the glare help), so a test is always made the same way; they can still be
//  changed by hand.
import Foundation

enum Lens: String, CaseIterable { case wide = "1x", tele = "3x" }

enum SizeMode: String, CaseIterable { case mp12 = "12MP", k4 = "4K60" }

enum ShutterMode: String, CaseIterable {
    case smart = "Smart", auto = "Auto", s125 = "1/125", s250 = "1/250", s500 = "1/500", s1000 = "1/1000"
    var den: Int? {
        switch self {
        case .smart, .auto: return nil
        case .s125: return 125
        case .s250: return 250
        case .s500: return 500
        case .s1000: return 1000
        }
    }
}

/// Auto: the camera's own focus with the app's help when nothing is read (asks it to refocus, then tries the lens
/// positions itself). Plain: the camera's own focus alone (what n2 had). Lock: where it is.
enum FocusMode: String, CaseIterable { case auto = "Auto", plain = "Plain", locked = "Lock" }

/// Auto: the lamp comes on by itself when the light is too poor for a fast shutter and the phone is in a hand.
enum LightMode: String, CaseIterable { case off = "Off", auto = "Auto", on = "On" }

struct TestStep {
    let what: String
    var lens: Lens = .wide
    var size: SizeMode = .mp12
    var shutter: ShutterMode = .smart
    var focus: FocusMode = .auto
    var depth: Bool = false         // n2: with the depth sensor on the camera dropped a fifth to a third of its frames, and its distances were wrong
    var light: LightMode = .off
    var special: String = ""        // "" | "sweep"
    var seconds: Double = 15        // the test stops by itself after this long
}

enum TestPlan {
    static let version = "b1"
    // the shutter sweep: 3 seconds at each of these (0 = the camera's own choice), 1/x of a second
    static let sweep: [Int] = [0, 60, 125, 250, 500, 1000, 2000]
    static let sweepSeconds = 3.0

    // b1 = BUILD 1 of 3 on Sarthak's iPhone 18 Pro Max (2026-11-23). Brett: "we are going to a vendor show in different
    // light conditions, different depths, and different angles, and different motions. i plan on doing 3 builds in
    // total ... an exp test with bar code scanners that we printed at staples, show the results, and do it 3 times".
    // ONE FIXED ROUND, the same in all three builds so the results line up: 9 tests of 20 seconds, one Staples sheet
    // (sheet 1) standing upright like a showcase, the zoom lens (the "3x" button picks the phone's telephoto, which on
    // the 18 Pro Max is a longer lens than the 13's 3x), the lamp off (he will not use a light at a show).
    static let steps: [TestStep] = [
        TestStep(what: "Bright room. Sheet 1 upright. 2 feet away, straight on, zoom lens. Hold still (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Bright room. 2 feet away at a 45 degree angle, zoom lens. Hold still (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Bright room. 3 feet away at 45 degrees, zoom lens. Hold still (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Bright room. 3 feet at 45 degrees, zoom lens. Sweep slowly back and forth across the sheet, as along a showcase (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Bright room. 2 to 3 feet at 45 degrees, zoom lens. Sweep back and forth at your natural speed (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Normal room light (ceiling light only). 3 feet at 45 degrees, zoom lens. Sweep slowly (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Dim: one lamp across the room. 2 feet at 45 degrees, zoom lens. Sweep slowly (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Glare: the sheet behind glass or a clear sleeve, a light reflecting on it. 3 feet at 45 degrees, zoom lens. Sweep slowly (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Bright room. 4 feet away at 45 degrees, zoom lens. Hold still (20 seconds)", lens: .tele, seconds: 20)
    ]
}
