package com.pulselink.owner;

import android.app.Activity;
import android.Manifest;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import android.content.pm.PackageManager;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final CommissioningLifecycle commissioning = new CommissioningLifecycle();
    private SecureSession session;
    private EditText api, email, password, storeName, storeSlug, storeId, deviceName;
    private EditText deviceId;
    private EditText softApSsid, wifiSsid, wifiPassword;
    private TextView status, stores, devices;
    private SoftApConnection softApConnection;
    private CommissioningTransportClient transportClient;
    private JSONObject provisioningData;
    private String pendingDeviceClaimId;
    private volatile long commissioningRun;

    @Override public void onCreate(Bundle state) { super.onCreate(state); session = new SecureSession(this); setContentView(view()); restoreSession(); }
    @Override protected void onDestroy() {
        commissioningRun++;
        if (softApConnection != null) softApConnection.close();
        if (transportClient != null) transportClient.close();
        executor.shutdownNow(); super.onDestroy();
    }

    private View view() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(28, 24, 28, 24);
        ScrollView scroll = new ScrollView(this); scroll.addView(root);
        root.addView(label("PulseLink Owner"));
        api = input("HTTPS API base URL"); root.addView(api);
        email = input("Email"); email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS); root.addView(email);
        password = input("Password"); password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); root.addView(password);
        root.addView(button("Sign up", v -> signup())); root.addView(button("Sign in", v -> login()));
        root.addView(button("Sign out", v -> signout()));
        status = label("Signed out"); root.addView(status);
        root.addView(label("Stores")); stores = label("No stores loaded"); root.addView(stores);
        storeName = input("New Store name"); root.addView(storeName); storeSlug = input("New Store slug"); root.addView(storeSlug);
        root.addView(button("Create Store", v -> createStore())); root.addView(button("Refresh Stores", v -> loadStores()));
        storeId = input("Selected Store ID"); root.addView(storeId);
        root.addView(label("Devices")); devices = label("No devices loaded"); root.addView(devices);
        deviceName = input("Device display name"); root.addView(deviceName);
        root.addView(button("Refresh Devices", v -> loadDevices()));
        deviceId = input("Enrolled Device ID"); root.addView(deviceId);
        root.addView(button("Scan Device QR", v -> scanDeviceQr()));
        root.addView(label("QR contains Device identity only. Backend Store authorization and enrollment are checked separately."));
        root.addView(button("Claim scanned Device and prepare Wi-Fi", v -> claimScannedDevice()));
        root.addView(button("Create provisioning session", v -> createProvisioningSession()));
        softApSsid = input("Device SoftAP SSID (for example PulseLink-XXXX)"); root.addView(softApSsid);
        wifiSsid = input("Test Wi-Fi SSID"); root.addView(wifiSsid);
        wifiPassword = input("Test Wi-Fi password"); wifiPassword.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); root.addView(wifiPassword);
        root.addView(button("Connect and send encrypted Wi-Fi configuration", v -> provisionOverSoftAp()));
        root.addView(button("Cancel commissioning", v -> cancelCommissioning()));
        root.addView(label("Online is shown only after a backend status check; this screen never treats SoftAP HTTP success as online."));
        return scroll;
    }
    private void signup() { String e=email.getText().toString().trim(), p=password.getText().toString(); if(e.indexOf('@')<1||p.length()<8){status.setText("Enter a valid email and password (8+ characters)");return;} run("Signing up", () -> { api().signup(e,p); return "Account created. Verify email before signing in."; }); }
    private void login() { String e=email.getText().toString().trim(), p=password.getText().toString(); if(e.indexOf('@')<1||p.length()<8){status.setText("Enter valid credentials");return;} run("Signing in", () -> { String installation = installationId(); JSONObject data=api().login(e,p,installation); JSONObject tokens=data.getJSONObject("data"); String base=api.getText().toString().trim(); session.save(tokens.getString("accessToken"),tokens.getString("refreshToken"),base,installation); syncPushToken(); return "Signed in. Push registration is being verified."; }); }
    private void signout() { String refresh=session.refreshToken(), access=session.accessToken(), base=session.apiBase(), installation=session.installationId(); session.clear(); status.setText("Signed out"); if(refresh!=null) executor.execute(() -> { try { if(base!=null && access!=null && installation!=null) new ApiClient(base).revokeInstallation(access,installation); if(base!=null) new ApiClient(base).logout(refresh); } catch(Exception ignored){} }); }
    private void restoreSession() { if (session.accessToken() != null) { if(session.apiBase()!=null) api.setText(session.apiBase()); status.setText("Session restored. Refresh stores to verify access."); syncPushToken(); } }
    private void syncPushToken() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4110);
            }
        });
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            session.saveFcmToken(token);
            executor.execute(() -> {
                if (session.accessToken() == null) return;
                try { OwnerPushRegistration.sync(session, token); }
                catch (Exception ignored) { runOnUiThread(() -> postStatus("Signed in, but push registration failed. Check staging notification configuration and sign in again.")); }
            });
        }).addOnFailureListener(error -> postStatus("Signed in, but FCM token is unavailable. Check Firebase app configuration."));
    }
    private void loadStores() { run("Loading stores", () -> { JSONArray a=api().stores(requireAccess()); return format(a,"id","name"); }); }
    private void createStore() { run("Creating store", () -> { api().createStore(requireAccess(),storeName.getText().toString().trim(),storeSlug.getText().toString().trim(),""); return "Store created as OWNER. Refresh stores."; }); }
    private void loadDevices() { String id=storeId.getText().toString().trim(); if(id.isBlank()){devices.setText("Select a Store ID first");return;} run("Loading devices", () -> format(api().devices(requireAccess(),id),"id","name","status","provisioningState","enrollmentStatus")); }
    private void createProvisioningSession() {
        String selectedStore = storeId.getText().toString().trim();
        String selectedDevice = deviceId.getText().toString().trim();
        if (selectedStore.isBlank() || selectedDevice.isBlank()) {
            status.setText("Store ID and enrolled Device ID are required");
            return;
        }
        run("Creating provisioning session", () -> {
            JSONObject response = api().createProvisioningSession(
                    requireAccess(), selectedStore, selectedDevice, UUID.randomUUID().toString());
            JSONObject data = response.optJSONObject("data");
            if (data == null || data.optJSONObject("session") == null
                    || data.optString("deviceEnrollmentPublicKey").isBlank()) {
                throw new ApiClient.ApiError(502, "Device trust material is unavailable");
            }
            JSONArray registeredDevices = api().devices(requireAccess(), selectedStore);
            JSONObject selected = null;
            for (int i = 0; i < registeredDevices.length(); i++) {
                JSONObject candidate = registeredDevices.optJSONObject(i);
                if (candidate != null && selectedDevice.equals(candidate.optString("id"))) { selected = candidate; break; }
            }
            if (selected == null || selected.optString("deviceKey").isBlank()) throw new ApiClient.ApiError(502, "Device redemption context is unavailable");
            data.put("deviceKey", selected.optString("deviceKey"));
            data.put("deviceId", selectedDevice);
            data.put("storeId", selectedStore);
            provisioningData = data;
            commissioningRun++;
            if (!commissioning.start(System.currentTimeMillis(), 30 * 60_000L)) {
                throw new ApiClient.ApiError(409, "A commissioning session is already active");
            }
            return "Provisioning session ready; confirm the device physically before continuing.";
        });
    }

    private void scanDeviceQr() {
        if (storeId.getText().toString().trim().isBlank()) {
            status.setText("Select a Store before scanning a Device");
            return;
        }
        status.setText("Opening QR scanner…");
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAutoZoom()
                .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        scanner.startScan()
                .addOnSuccessListener(barcode -> verifyScannedDevice(barcode == null ? null : barcode.getRawValue()))
                .addOnCanceledListener(() -> status.setText("Device scan cancelled"))
                .addOnFailureListener(error -> status.setText("QR scanner unavailable. Check Google Play services and camera access."));
    }

    private void verifyScannedDevice(String qrValue) {
        String scannedId = DeviceQrIdentity.parse(qrValue);
        String selectedStore = storeId.getText().toString().trim();
        if (scannedId == null) {
            status.setText("QR must contain only a valid PulseLink Device ID");
            return;
        }
        status.setText("Checking Device enrollment and Store access…");
        executor.execute(() -> {
            try {
                JSONArray ownedDevices = api().devices(requireAccess(), selectedStore);
                JSONObject match = null;
                if (ownedDevices != null) {
                    for (int i = 0; i < ownedDevices.length(); i++) {
                        JSONObject candidate = ownedDevices.optJSONObject(i);
                        if (candidate != null && scannedId.equals(candidate.optString("id"))) {
                            match = candidate;
                            break;
                        }
                    }
                }
                if (match == null || !"ENROLLED".equals(match.optString("enrollmentStatus"))) {
                    if (match != null) {
                        pendingDeviceClaimId = null;
                        postStatus("A Device record with this ID is not enrolled. It cannot be claimed using QR identity alone.");
                        return;
                    }
                    pendingDeviceClaimId = scannedId;
                    runOnUiThread(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            deviceId.setText(scannedId);
                            devices.setText("Scanned public Device ID: " + scannedId);
                            status.setText("Device is not in this Store. Review the Device ID, then claim it with live Device proof.");
                        }
                    });
                    return;
                }
                pendingDeviceClaimId = null;
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        deviceId.setText(scannedId);
                        devices.setText("Scanned Device is enrolled in the selected Store: " + scannedId);
                        status.setText("Device is enrolled and visible in the selected Store. Continue with a provisioning session.");
                    }
                });
            } catch (Exception failure) {
                postStatus("Could not verify Device access. Check sign-in and selected Store.");
            }
        });
    }

    private void claimScannedDevice() {
        final String candidateId = pendingDeviceClaimId;
        final String selectedStore = storeId.getText().toString().trim();
        String wifiPermission = Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
        if (candidateId == null || selectedStore.isBlank()) {
            status.setText("Scan an unassigned Device QR and select a Store first");
            return;
        }
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(wifiPermission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { wifiPermission }, 4107);
            status.setText("Allow nearby Wi-Fi access, then retry the Device claim.");
            return;
        }
        String name = deviceName.getText().toString().trim();
        if (name.isBlank()) name = "PulseLink button";
        final String displayName = name;
        status.setText("Requesting Store-authorized Device claim…");
        executor.execute(() -> {
            try {
                JSONObject claimData = api().createDeviceClaimSession(requireAccess(), selectedStore, candidateId, displayName).getJSONObject("data");
                if (claimData.optBoolean("alreadyClaimed")) {
                    JSONObject linked = claimData.getJSONObject("device");
                    pendingDeviceClaimId = null;
                    runOnUiThread(() -> {
                        deviceId.setText(candidateId);
                        devices.setText("Already linked in this Store: " + candidateId + " — " + linked.optString("status"));
                        status.setText("Backend confirmed this Device is already linked here. Create a provisioning session to configure Wi-Fi.");
                    });
                    return;
                }
                JSONObject claimSession = claimData.getJSONObject("session");
                String ssid = DeviceQrIdentity.softApSsid(candidateId);
                if (ssid == null) throw new IllegalStateException("Device QR identity is not supported by this firmware profile");
                runOnUiThread(() -> status.setText("Connect to the Device SoftAP to verify its first-claim proof…"));
                if (softApConnection != null) softApConnection.close();
                softApConnection = new SoftApConnection(this);
                softApConnection.connect(ssid, new SoftApConnection.Listener() {
                    @Override public void onAvailable(Network network) {
                        executor.execute(() -> finishDeviceClaim(selectedStore, candidateId, claimData, claimSession));
                    }
                    @Override public void onUnavailable() {
                        pendingDeviceClaimId = candidateId;
                        runOnUiThread(() -> status.setText("Device SoftAP unavailable. Verify the board is in pairing mode and retry."));
                    }
                    @Override public void onLost() {
                        pendingDeviceClaimId = candidateId;
                        runOnUiThread(() -> status.setText("Device SoftAP connection lost. Claim was not confirmed."));
                    }
                });
            } catch (Exception failure) {
                pendingDeviceClaimId = candidateId;
                postStatus("Device claim could not start. Check Store authorization, Device state and network, then retry.");
            }
        });
    }

    private void finishDeviceClaim(String selectedStore, String candidateId, JSONObject claimData, JSONObject claimSession) {
        try {
            CommissioningTransportClient proofClient = new CommissioningTransportClient();
            JSONObject proof = proofClient.requestEnrollmentProof("http://192.168.4.1", claimData);
            proofClient.close();
            if (softApConnection != null) softApConnection.close();
            JSONObject result = api().completeDeviceClaim(requireAccess(), selectedStore,
                    claimSession.getString("id"), proof);
            JSONObject claimedDevice = result.getJSONObject("data");
            JSONObject provisioning = api().createProvisioningSession(requireAccess(), selectedStore,
                    candidateId, UUID.randomUUID().toString()).getJSONObject("data");
            JSONObject sessionInfo = provisioning.getJSONObject("session");
            JSONArray ownedDevices = api().devices(requireAccess(), selectedStore);
            JSONObject listed = null;
            if (ownedDevices != null) for (int i = 0; i < ownedDevices.length(); i++) {
                JSONObject candidate = ownedDevices.optJSONObject(i);
                if (candidate != null && candidateId.equals(candidate.optString("id"))) { listed = candidate; break; }
            }
            if (listed == null || listed.optString("deviceKey").isBlank() ||
                    !"ENROLLED".equals(claimedDevice.optString("enrollmentStatus"))) {
                throw new IllegalStateException("Backend did not confirm enrolled Device state");
            }
            provisioning.put("deviceKey", listed.getString("deviceKey"));
            provisioning.put("deviceId", candidateId);
            provisioning.put("storeId", selectedStore);
            provisioningData = provisioning;
            pendingDeviceClaimId = null;
            commissioningRun++;
            if (!commissioning.start(System.currentTimeMillis(), 30 * 60_000L)) {
                throw new IllegalStateException("Commissioning session is already active");
            }
            runOnUiThread(() -> {
                deviceId.setText(candidateId);
                softApSsid.setText(DeviceQrIdentity.softApSsid(candidateId));
                devices.setText("Enrolled and linked: " + candidateId + " — PENDING provisioning");
                status.setText("Device claim confirmed. Next connect to send Wi-Fi; claim alone does not mean online.");
            });
        } catch (Exception failure) {
            if (softApConnection != null) softApConnection.close();
            pendingDeviceClaimId = candidateId;
            runOnUiThread(() -> status.setText("Device proof or claim failed. Device was not confirmed in this Store; scan and retry."));
        }
    }
    private void provisionOverSoftAp() {
        JSONObject data = provisioningData;
        long run = commissioningRun;
        String ssid = softApSsid.getText().toString().trim();
        String stationSsid = wifiSsid.getText().toString();
        String stationPassword = wifiPassword.getText().toString();
        if (data == null || ssid.isBlank() || stationSsid.isBlank() || stationPassword.length() < 8) {
            status.setText("Create a provisioning session and enter valid SoftAP/Wi-Fi details first"); return;
        }
        String wifiPermission = Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(wifiPermission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { wifiPermission }, 4107);
            status.setText("Allow nearby Wi-Fi access, then tap connect again.");
            return;
        }
        if (softApConnection != null) softApConnection.close();
        if (transportClient != null) transportClient.close();
        softApConnection = new SoftApConnection(this);
        if (!commissioning.transition(CommissioningLifecycle.State.CONNECTING_TO_DEVICE, System.currentTimeMillis())) {
            status.setText("Commissioning session is no longer active"); return;
        }
        status.setText("Connecting to device SoftAP…");
        try {
            softApConnection.connect(ssid, new SoftApConnection.Listener() {
                @Override public void onAvailable(Network network) {
                    if (!commissioning.transition(CommissioningLifecycle.State.AUTHENTICATING_DEVICE, System.currentTimeMillis())) {
                        runOnUiThread(() -> status.setText("Commissioning session expired")); return;
                    }
                    runOnUiThread(() -> status.setText("Authenticating device…"));
                    executor.execute(() -> {
                        CommissioningTransportClient client = new CommissioningTransportClient();
                        transportClient = client;
                        boolean accepted = false;
                        try {
                            JSONObject session = data.getJSONObject("session");
                            client.handshake("http://192.168.4.1", session.getString("id"),
                                    data.getString("deviceEnrollmentPublicKey"), data.getString("challenge"),
                                    parseExpiry(session.optString("expiresAt")),
                                    "owner-android");
                            if (!commissioning.transition(CommissioningLifecycle.State.SENDING_CONFIGURATION, System.currentTimeMillis())) throw new IllegalStateException("Commissioning state expired");
                            runOnUiThread(() -> status.setText("Sending encrypted Wi-Fi configuration…"));
                            client.sendCredentials("http://192.168.4.1", stationSsid, stationPassword,
                                    data.getString("deviceId"), data.getString("deviceKey"), data.getString("bootstrapSecret"));
                            if (!commissioning.transition(CommissioningLifecycle.State.DEVICE_CONNECTING_WIFI, System.currentTimeMillis())) throw new IllegalStateException("Commissioning state expired");
                            accepted = true;
                            runOnUiThread(() -> status.setText("Encrypted configuration accepted by the device; waiting for backend confirmation."));
                        } catch (Exception error) {
                            commissioning.fail();
                            runOnUiThread(() -> status.setText(error.getMessage() == null ? "Commissioning failed" : error.getMessage()));
                            client.close();
                        } finally {
                            provisioningData = null;
                            data.remove("bootstrapSecret");
                            data.remove("challenge");
                            data.remove("session");
                            data.remove("deviceEnrollmentPublicKey");
                            client.close();
                            if (transportClient == client) transportClient = null;
                            runOnUiThread(() -> wifiPassword.setText(""));
                            if (softApConnection != null) softApConnection.close();
                        }
                        if (accepted && run == commissioningRun) {
                            executor.execute(() -> awaitBackendDeviceStatus(data, run));
                        }
                    });
                }
                @Override public void onUnavailable() { commissioning.fail(); runOnUiThread(() -> status.setText("Device SoftAP unavailable")); }
                @Override public void onLost() { commissioning.fail(); runOnUiThread(() -> status.setText("Device SoftAP connection lost")); }
            });
        } catch (Exception error) { status.setText(error.getMessage() == null ? "SoftAP connection failed" : error.getMessage()); }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 4107) {
            status.setText(grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
                    ? "Wi-Fi permission granted. Tap connect to continue."
                    : "Wi-Fi permission denied. Allow it in system settings to provision this Device.");
        }
    }

    private void awaitBackendDeviceStatus(JSONObject data, long run) {
        try {
            String selectedStore = data.getString("storeId");
            String selectedDevice = data.getString("deviceId");
            String access = requireAccess();
            long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
            boolean redemptionReported = false;
            while (run == commissioningRun && System.nanoTime() < deadline && !isFinishing() && !isDestroyed()) {
                CommissioningDeviceStatus.Stage observed = CommissioningDeviceStatus.fromDevices(
                        api().devices(access, selectedStore), selectedDevice);
                if (observed == CommissioningDeviceStatus.Stage.FAILED) {
                    commissioning.fail();
                    runOnUiThread(() -> status.setText("Backend could not confirm this Device. Refresh the Store devices or start a new session."));
                    return;
                }
                if (observed == CommissioningDeviceStatus.Stage.WAITING_FOR_EVENT && !redemptionReported) {
                    if (!commissioning.transition(CommissioningLifecycle.State.REDEEMING, System.currentTimeMillis())) return;
                    redemptionReported = true;
                    runOnUiThread(() -> status.setText("Provisioning redeemed; waiting for the first authenticated Device Event."));
                }
                if (observed == CommissioningDeviceStatus.Stage.ONLINE) {
                    if (!redemptionReported) commissioning.transition(CommissioningLifecycle.State.REDEEMING, System.currentTimeMillis());
                    if (commissioning.transition(CommissioningLifecycle.State.ONLINE, System.currentTimeMillis())) {
                        runOnUiThread(() -> status.setText("Device is ONLINE; backend has accepted an authenticated event."));
                    }
                    return;
                }
                Thread.sleep(4_000L);
            }
            if (run == commissioningRun && commissioning.fail()) {
                runOnUiThread(() -> status.setText("No backend ONLINE confirmation within five minutes. Device setup may need retry."));
            }
        } catch (Exception error) {
            if (run == commissioningRun && commissioning.fail()) {
                runOnUiThread(() -> status.setText("Unable to confirm Device status. Check Owner API connectivity and retry."));
            }
        }
    }

    private void cancelCommissioning() {
        commissioningRun++;
        commissioning.cancel();
        provisioningData = null;
        if (softApConnection != null) softApConnection.close();
        if (transportClient != null) transportClient.close();
        if (wifiPassword != null) wifiPassword.setText("");
        status.setText("Commissioning cancelled");
    }
    private long parseExpiry(String value) throws Exception {
        if (value == null || value.isBlank()) return 0L;
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
        return format.parse(value).getTime() / 1000L;
    }
    private String requireAccess() throws Exception { String token=session.accessToken(); if(token==null) throw new ApiClient.ApiError(401,"Sign in first"); return token; }
    private ApiClient api(){return new ApiClient(api.getText().toString().trim());}
    private String installationId(){return "android-owner-"+UUID.nameUUIDFromBytes(android.provider.Settings.Secure.getString(getContentResolver(),android.provider.Settings.Secure.ANDROID_ID).getBytes());}
    private void run(String working, java.util.concurrent.Callable<String> action){status.setText(working+"…"); executor.execute(()->{try{String result=action.call();postStatus(result);}catch(Exception e){postStatus(e.getMessage()==null?"Request failed":e.getMessage());}});}
    private void postStatus(String message){runOnUiThread(()->{if(isFinishing()||isDestroyed())return;status.setText(message);if(message.contains("Store")||message.contains("stores"))stores.setText(message);if(message.contains("device")||message.contains("Registered"))devices.setText(message);});}
    private String format(JSONArray a,String... fields){if(a==null||a.length()==0)return "No records";StringBuilder b=new StringBuilder();for(int i=0;i<a.length();i++){JSONObject o=a.optJSONObject(i);if(o==null)continue;for(String f:fields){if(b.length()>0)b.append(' ');b.append(f).append('=').append(o.optString(f));}b.append('\n');}return b.toString().trim();}
    private EditText input(String hint){EditText e=new EditText(this);e.setHint(hint);e.setSingleLine(true);return e;}
    private TextView label(String text){TextView t=new TextView(this);t.setText(text);t.setPadding(0,10,0,10);return t;}
    private Button button(String text,View.OnClickListener l){Button b=new Button(this);b.setText(text);b.setOnClickListener(l);return b;}
}
