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
    var glareHelp: Bool = true
    var special: String = ""        // "" | "sweep"
    var seconds: Double = 15        // the test stops by itself after this long
}

enum TestPlan {
    static let version = "n3"
    // the shutter sweep: 3 seconds at each of these (0 = the camera's own choice), 1/x of a second
    static let sweep: [Int] = [0, 60, 125, 250, 500, 1000, 2000]
    static let sweepSeconds = 3.0

    static let steps: [TestStep] = [
        TestStep(what: "Sheet flat, room light, about 9 inches, 1x, hold still"),
        TestStep(what: "About 14 inches, 1x, hold still"),
        TestStep(what: "About 18 inches, 1x, hold still"),
        TestStep(what: "About 2 feet, 3x, hold still", lens: .tele),
        TestStep(what: "About 3 feet, 3x, hold still", lens: .tele),
        TestStep(what: "About 4 feet, 3x, hold still", lens: .tele),
        TestStep(what: "Moving: glide slowly over the sheet at 8 to 10 inches, a short pause on each part (20 seconds)", seconds: 20),
        TestStep(what: "Moving fast: sweep over the sheet at 8 to 10 inches without stopping, back and forth"),
        TestStep(what: "Moving with 3x: from about 2 feet, pan slowly over the sheet (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Dim room, about a foot, 1x, hold still (the lamp stays off)"),
        TestStep(what: "Dim room, moving: glide slowly at 8 to 10 inches (the lamp comes on by itself)", light: .auto, seconds: 20),
        TestStep(what: "Dim room, about 2 feet, 3x, hold still (the lamp comes on by itself)", lens: .tele, light: .auto),
        TestStep(what: "Glare: your room as in the last test 15, about 18 inches, 1x, hold still"),
        TestStep(what: "Glare again, the same way, with the glare help off", glareHelp: false),
        TestStep(what: "Glare, moving: tilt and move the phone slowly so the glare wanders over the sheet", seconds: 20),
        TestStep(what: "Your choice: real slabs, a case, under glass (30 seconds at most)", light: .auto, seconds: 30)
    ]
}
