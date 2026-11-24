//  The switches and the plan of tests. A step of the plan sets the switches by itself (the lens, the size, the shutter,
//  the focus, the depth sensor, the light, the glare help), so a test is always made the same way; they can still be
//  changed by hand.
import Foundation

/// wide: the main camera. tele: the phone's telephoto (3x on the 13 Pro Max, 4x on the 18 Pro Max). wide2 / tele2 (v1):
/// the same camera at twice the size, where the phone takes that from the middle of a finer sensor at full detail (the
/// 18 Pro Max's 48 MP cameras: its "optical-quality" 2x and 8x).
enum Lens: String, CaseIterable {
    case wide = "1x", wide2 = "2x", tele = "Zoom", tele2 = "Zoom 2x"
    var isTele: Bool { self == .tele || self == .tele2 }
    var doubled: Bool { self == .wide2 || self == .tele2 }
}

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
    var special: String = ""        // "" | "sweep" (the shutter steps by itself) | "snaps" (three photographs by themselves)
    var seconds: Double = 15        // the test stops by itself after this long
    var room: String = ""           // the block of the round: the room's light and what lies on the sheets
    var line: Int = 0               // the tape line on the floor to stand on (0: none named)
    var pace: Double = 0            // a pass: seconds from sheet 1 to sheet 4, the screen showing where to aim (0: hold still)
}

enum TestPlan {
    static let version = "v1"
    // the shutter sweep: 3 seconds at each of these (0 = the camera's own choice), 1/x of a second
    static let sweep: [Int] = [0, 60, 125, 250, 500, 1000, 2000]
    static let sweepSeconds = 3.0
    // the photographs of a "snaps" test: the first after snapFirst seconds, then one every snapEvery
    static let snapCount = 2
    static let snapFirst = 1.5
    static let snapEvery = 7.0

    // v1 = ROUND 1 OF 3 on Sarthak's iPhone 18 Pro Max (2026-11-23). Brett: "we are going to a vendor show in different
    // light conditions, different depths, and different angles, and different motions. i plan on doing 3 builds in
    // total"; then, after the first plan (nine tests with the same switches): "they're not automatically changed when
    // I switch from test to test ... if you may have any better ideas to design the experiment. This has to be
    // executed flawlessly".
    // WHAT THIS PHONE'S CAMERAS ARE (its own list, in a 10-second file he sent before this plan was written): the main
    // camera focuses from 0.2 m, 70.7 degrees wide (2,840 dots of focal length, 5,680 with its 2x at full detail); THE
    // TELEPHOTO FOCUSES FROM 1.16 m (3.8 ft) ONLY, 18.9 degrees (12,100 dots; 24,200 with its 2x); the largest video
    // picture is 12 MP, photographs 48 MP. A PSA code's thin bar (0.173 mm) is 1.5 dots with the main 2x at 2 ft, 1.3 at
    // 2.5 ft, 1.0 at 3.3 ft; with the telephoto 1.7 at 4 ft, 1.4 at 5 ft (twice that with its 2x). A read needs 1.2-1.5
    // dots a bar: BETWEEN ABOUT 2.7 AND 3.8 FT THIS PHONE HAS NO CAMERA THAT CAN READ A SLAB - the main is too coarse,
    // the telephoto cannot focus.
    // THE SET-UP stands in for a showcase and stays the same for all three rounds: sheets 1-4 flat on a table in a
    // row, tops away from him, their near edges 6 in from the table's edge; tape lines on the floor - line 1 at the
    // table, line 2 one foot back, line 3 44 in back, line 4 56 in back; the phone at chest height. Standing further
    // back is both further away and a flatter look (about 2 ft at 75 degrees, 2.5 ft at 55, 4.4 ft at 27, 5.4 ft at 22
    // - the files say what it really was: the codes' size and the phone's tilt). A PASS glides along the four sheets
    // with the screen showing which sheet to aim at, so every round moves at the same speed (slow: 2 in a second;
    // quicker: 4).
    // WHAT ROUND 1 ASKS: which camera reads at which distance (the main 2x near, the telephoto and its 2x from behind
    // its closest focus), how deep the sharp band is on a tilted case (which rows of a sheet are read), how fast a
    // shutter each light allows (the sweeps), how fast a pass may be, glare - and whether one 48 MP photograph reads a
    // whole stretch of the case (the snaps, last: a large photograph is the newest code here). Tests 1 and 2 are the
    // pilot: sent and checked before the rest is run.
    static let lightA = "LIGHT A: every light on"
    static let lightB = "LIGHT B: the main light only"
    static let lightC = "LIGHT C: dim - one lamp across the room"
    static let lightG = "GLARE: every light on, the glass or clear sleeve over sheets 2 and 3, a light reflecting in it"
    static let lightP = "PHOTOS: every light on, the glass taken off"
    static let still = "Hold still, aimed at the middle of sheet 2."
    static let slowBack = "Slow pass along the sheets, there and back: follow the green box."
    static let slow = "Slow pass along the sheets, once: follow the green box."
    static let quick = "Quicker pass, there and back: follow the green box."
    static let sweepText = "Hold still, aimed at the middle of sheet 2. The shutter changes by itself every 3 seconds."
    static let steps: [TestStep] = [
        // the pilot: one still test with each camera
        TestStep(what: still, lens: .wide2, seconds: 10, room: lightA, line: 1),
        TestStep(what: still, lens: .tele, seconds: 10, room: lightA, line: 3),
        // light A: the main camera's 2x, near
        TestStep(what: slowBack, lens: .wide2, seconds: 32, room: lightA, line: 1, pace: 16),
        TestStep(what: quick, lens: .wide2, seconds: 16, room: lightA, line: 1, pace: 8),
        TestStep(what: "Hold the phone LOWER, at belt height. " + slow, lens: .wide2, seconds: 16, room: lightA, line: 1, pace: 16),
        TestStep(what: slow, lens: .wide2, seconds: 16, room: lightA, line: 2, pace: 16),
        // light A: the telephoto, from behind its closest focus
        TestStep(what: slowBack, lens: .tele, seconds: 32, room: lightA, line: 3, pace: 16),
        TestStep(what: quick, lens: .tele, seconds: 16, room: lightA, line: 3, pace: 8),
        // light A: the telephoto's 2x
        TestStep(what: still, lens: .tele2, seconds: 10, room: lightA, line: 3),
        TestStep(what: slow, lens: .tele2, seconds: 16, room: lightA, line: 3, pace: 16),
        TestStep(what: slow, lens: .tele2, seconds: 16, room: lightA, line: 4, pace: 16),
        // light B: a pass with each camera, then the shutter stepping by itself
        TestStep(what: slow, lens: .wide2, seconds: 16, room: lightB, line: 1, pace: 16),
        TestStep(what: slow, lens: .tele, seconds: 16, room: lightB, line: 3, pace: 16),
        TestStep(what: sweepText, lens: .wide2, special: "sweep", seconds: 21, room: lightB, line: 1),
        TestStep(what: sweepText, lens: .tele, special: "sweep", seconds: 21, room: lightB, line: 3),
        // light C: a pass with each camera
        TestStep(what: slow, lens: .wide2, seconds: 16, room: lightC, line: 1, pace: 16),
        TestStep(what: slow, lens: .tele, seconds: 16, room: lightC, line: 3, pace: 16),
        // glare
        TestStep(what: slow, lens: .wide2, seconds: 16, room: lightG, line: 1, pace: 16),
        TestStep(what: slow, lens: .tele, seconds: 16, room: lightG, line: 3, pace: 16),
        // photographs, last
        TestStep(what: "Hold still, aimed where sheets 2 and 3 meet. The phone takes two photographs by itself.", lens: .wide, special: "snaps", seconds: 20, room: lightP, line: 1),
        TestStep(what: "Hold still, aimed at the middle of sheet 2. The phone takes two photographs by itself.", lens: .tele, special: "snaps", seconds: 20, room: lightP, line: 3)
    ]
}
