import Capacitor
import Foundation
import UserMessagingPlatform

@objc(ConsentSignalsPlugin)
public class ConsentSignalsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ConsentSignalsPlugin"
    public let jsName = "ConsentSignals"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showConsentForm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showPrivacyOptionsForm", returnType: CAPPluginReturnPromise)
    ]

    // UMP must be presentable before either advertising SDK is initialized.
    // AdMob 8.1.0 only attaches its consent presenter during ads initialization.
    @objc func showConsentForm(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let controller = self.bridge?.viewController else {
                call.reject("No consent ViewController")
                return
            }
            do {
                try await ConsentForm.loadAndPresentIfRequired(from: controller)
                let info = ConsentInformation.shared
                call.resolve([
                    "canRequestAds": info.canRequestAds,
                    "privacyOptionsRequirementStatus": info.privacyOptionsRequirementStatus == .required
                        ? "REQUIRED" : "NOT_REQUIRED"
                ])
            } catch {
                call.reject("Consent form failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func showPrivacyOptionsForm(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let controller = self.bridge?.viewController else {
                call.reject("No consent ViewController")
                return
            }
            do {
                try await ConsentForm.presentPrivacyOptionsForm(from: controller)
                call.resolve()
            } catch {
                call.reject("Privacy options failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        let prefs = UserDefaults.standard
        var result: [String: Any] = [
            "additionalConsent": prefs.string(forKey: "IABTCF_AddtlConsent") ?? "",
            "purposeConsents": prefs.string(forKey: "IABTCF_PurposeConsents") ?? ""
        ]
        if let applies = prefs.object(forKey: "IABTCF_gdprApplies") as? NSNumber,
           applies.intValue == 0 || applies.intValue == 1 {
            result["gdprApplies"] = applies.intValue == 1
        }
        call.resolve(result)
    }
}

class GameBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ConsentSignalsPlugin())
    }
}
