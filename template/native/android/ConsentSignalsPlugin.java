package YOUR_APPLICATION_PACKAGE;

import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ConsentSignals")
public class ConsentSignalsPlugin extends Plugin {
    @PluginMethod
    public void read(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
            getContext().getPackageName() + "_preferences", android.content.Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        if (prefs.contains("IABTCF_gdprApplies")) {
            int applies = prefs.getInt("IABTCF_gdprApplies", -1);
            if (applies == 0 || applies == 1) result.put("gdprApplies", applies == 1);
        }
        result.put("additionalConsent", prefs.getString("IABTCF_AddtlConsent", ""));
        result.put("purposeConsents", prefs.getString("IABTCF_PurposeConsents", ""));
        call.resolve(result);
    }
}
