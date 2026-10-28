package com.pulselink.owner;

import android.app.Activity;
import android.Manifest;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.*;
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
        deviceName = input("New Device name"); root.addView(deviceName);
        root.addView(button("Register Device", v -> createDevice())); root.addView(button("Refresh Devices", v -> loadDevices()));
        deviceId = input("Enrolled Device ID"); root.addView(deviceId);
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
    private void login() { String e=email.getText().toString().trim(), p=password.getText().toString(); if(e.indexOf('@')<1||p.length()<8){status.setText("Enter valid credentials");return;} run("Signing in", () -> { JSONObject data=api().login(e,p,installationId()); JSONObject tokens=data.getJSONObject("data"); session.save(tokens.getString("accessToken"),tokens.getString("refreshToken"),api.getText().toString().trim()); return "Signed in securely."; }); }
    private void signout() { String refresh=session.refreshToken(); session.clear(); status.setText("Signed out"); if(refresh!=null) executor.execute(() -> { try { if(session.apiBase()!=null) new ApiClient(session.apiBase()).logout(refresh); } catch(Exception ignored){} }); }
    private void restoreSession() { if (session.accessToken() != null) status.setText("Session restored. Refresh stores to verify access."); }
    private void loadStores() { run("Loading stores", () -> { JSONArray a=api().stores(requireAccess()); return format(a,"id","name"); }); }
    private void createStore() { run("Creating store", () -> { api().createStore(requireAccess(),storeName.getText().toString().trim(),storeSlug.getText().toString().trim(),""); return "Store created as OWNER. Refresh stores."; }); }
    private void loadDevices() { String id=storeId.getText().toString().trim(); if(id.isBlank()){devices.setText("Select a Store ID first");return;} run("Loading devices", () -> format(api().devices(requireAccess(),id),"id","name","status","provisioningState","enrollmentStatus")); }
    private void createDevice() { String id=storeId.getText().toString().trim(), name=deviceName.getText().toString().trim(); if(id.isBlank()||name.isBlank()){devices.setText("Store ID and Device name are required");return;} run("Registering device", () -> { JSONObject d=api().createDevice(requireAccess(),id,name).getJSONObject("data"); return "Registered: "+d.optString("id")+" / "+d.optString("status")+" / "+d.optString("provisioningState"); }); }
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
