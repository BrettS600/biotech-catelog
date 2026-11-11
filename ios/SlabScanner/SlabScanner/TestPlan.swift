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
    static let version = "n4"
    // the shutter sweep: 3 seconds at each of these (0 = the camera's own choice), 1/x of a second
    static let sweep: [Int] = [0, 60, 125, 250, 500, 1000, 2000]
    static let sweepSeconds = 3.0

    // n4: BRETT'S REAL USE ONLY (2026-11-11: "2 to 3 feet away at a 45 degree angle in well lit conditions ... move the
    // camera back and forth, like slightly"; a showcase the height of a nightstand, glare likely) - and short: n2's and
    // n3's rounds of 15 and 16 tests "take forever". Close range, 2 feet square on, the dim room with the lamp and
    // moving at close range are settled (n3: 50, 50, 48-50, 50 of 50).
    static let steps: [TestStep] = [
        TestStep(what: "Brightest room you have. About 2 feet away at 45 degrees, 3x, hold still", lens: .tele),
        TestStep(what: "The same from about 3 feet at 45 degrees, 3x, hold still", lens: .tele),
        TestStep(what: "2 to 3 feet at 45 degrees, 3x: move slightly back and forth, as you would at a show - slow down when the yellow note says too fast (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "The same with glare on the sheet: 2 to 3 feet, 45 degrees, 3x, moving slightly (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Real slabs if you have some (flat on a table, under glass if you can): 2 to 3 feet, 45 degrees, 3x, moving slightly (20 seconds)", lens: .tele, seconds: 20),
        TestStep(what: "Your choice (30 seconds at most)", lens: .tele, seconds: 30)
    ]
}
