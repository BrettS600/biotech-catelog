//  The camera's picture on the screen, with a box around every code just read (green: counted, yellow: sighted).
import AVFoundation
import SwiftUI
import UIKit

final class PreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    private let sure = CAShapeLayer()
    private let seen = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        sure.strokeColor = UIColor.systemGreen.cgColor
        seen.strokeColor = UIColor.systemYellow.cgColor
        for l in [sure, seen] {
            l.fillColor = UIColor.clear.cgColor
            l.lineWidth = 2
            layer.addSublayer(l)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        sure.frame = bounds
        seen.frame = bounds
    }

    func upright() {                // the phone is held upright: the camera's picture is turned a quarter
        if let c = previewLayer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    }

    func show(_ boxes: [Box]) {
        let a = UIBezierPath()
        let b = UIBezierPath()
        for x in boxes {
            let r = previewLayer.layerRectConverted(fromMetadataOutputRect: x.rect).insetBy(dx: -2, dy: -2)
            if r.width.isFinite && r.height.isFinite && r.width < 4000 && r.height < 4000 {
                if x.counted { a.append(UIBezierPath(rect: r)) } else { b.append(UIBezierPath(rect: r)) }
            }
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        sure.path = a.cgPath
        seen.path = b.cgPath
        CATransaction.commit()
    }
}

struct PreviewView: UIViewRepresentable {
    @ObservedObject var engine: Engine

    func makeUIView(context: Context) -> PreviewUIView {
        let v = PreviewUIView()
        v.backgroundColor = .black
        v.previewLayer.session = engine.session
        v.previewLayer.videoGravity = .resizeAspect
        engine.preview = v
        return v
    }

    func updateUIView(_ v: PreviewUIView, context: Context) {
        v.show(engine.boxes)
    }
}
