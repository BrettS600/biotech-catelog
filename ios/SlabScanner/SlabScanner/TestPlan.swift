//  The switches and the plan of tests. A step of the plan sets the switches by itself (the lens, the size, the shutter,
//  the focus, the depth sensor), so a test is always made the same way; they can still be changed by hand.
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

enum FocusMode: String, CaseIterable { case auto = "Auto", locked = "Lock" }

struct TestStep {
    let what: String
    var lens: Lens = .wide
    var size: SizeMode = .mp12
    var shutter: ShutterMode = .smart
    var focus: FocusMode = .auto
    var depth: Bool = true
    var special: String = ""        // "" | "sweep" | "lockfocus" | "snap"
    var seconds: Double = 15        // the test stops by itself after this long
}

enum TestPlan {
    static let version = "n1"
    // the shutter sweep: 3 seconds at each of these (0 = the camera's own choice), 1/x of a second
    static let sweep: [Int] = [0, 60, 125, 250, 500, 1000, 2000]
    static let sweepSeconds = 3.0

    static let steps: [TestStep] = [
        TestStep(what: "Sheet flat, room light, about 9 inches, 1x, hold still"),
        TestStep(what: "About 14 inches, 1x, hold still"),
        TestStep(what: "As test 2 with the depth sensor off: about 14 inches, 1x, hold still", depth: false),
        TestStep(what: "About 2 feet, still 1x, hold still"),
        TestStep(what: "About 2 feet, 3x, hold still", lens: .tele),
        TestStep(what: "About 3 feet, 3x, hold still", lens: .tele),
        TestStep(what: "Shutter sweep: about 2 feet, 3x, hold still - the app steps through the shutter speeds and stops by itself (21 seconds)", lens: .tele, special: "sweep", seconds: 21.2),
        TestStep(what: "Shutter sweep at 1x: about 14 inches, hold still (21 seconds)", special: "sweep", seconds: 21.2),
        TestStep(what: "Focus locked: as test 5 - about 2 feet, 3x, hold still (the app locks the focus after 2 seconds)", lens: .tele, special: "lockfocus"),
        TestStep(what: "Moving: glide slowly over the sheet at 8 to 10 inches, a short pause on each part (20 seconds)", seconds: 20),
        TestStep(what: "Moving again with the fast camera mode (4K, 60 pictures a second): as test 10 (20 seconds)", size: .k4, depth: false, seconds: 20),
        TestStep(what: "Dim room, about a foot, 1x, hold still"),
        TestStep(what: "Dim room, about 2 feet, 3x, hold still", lens: .tele),
        TestStep(what: "Snap: about 2 feet, 1x, hold still - tap Snap three times, a second or two apart", special: "snap", seconds: 20),
        TestStep(what: "Your choice: real slabs, a case, under glass (30 seconds at most)", seconds: 30)
    ]
}
