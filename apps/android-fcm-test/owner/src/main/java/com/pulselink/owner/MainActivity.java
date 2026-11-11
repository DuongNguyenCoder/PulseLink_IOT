package com.pulselink.owner;

import android.app.Activity;
import android.Manifest;
import android.net.Network;
import android.net.ConnectivityManager;
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
    private EditText invitationEmail, invitationToken;
    private TextView invitations;
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
        root.addView(label("Store invitations (Owner creates; recipient pastes token)"));
        invitationEmail = input("Invitee email"); root.addView(invitationEmail);
        invitations = label("No invitations loaded"); root.addView(invitations);
        root.addView(button("Create STAFF invitation", v -> createInvitation()));
        root.addView(button("Refresh invitations", v -> loadInvitations()));
        invitationToken = input("Invitation token"); root.addView(invitationToken);
        root.addView(button("Inspect invitation", v -> inspectInvitation()));
        root.addView(button("Accept invitation", v -> acceptInvitation()));
        root.addView(label("Devices")); devices = label("No devices loaded"); root.addView(devices);
        deviceName = input("Device display name"); root.addView(deviceName);
        root.addView(button("Refresh Devices", v -> loadDevices()));
        deviceId = input("Public Device ID from QR (or enter it manually)"); root.addView(deviceId);
        root.addView(button("Scan Device QR", v -> scanDeviceQr()));
        root.addView(label("QR contains Device identity only. Backend Store authorization and enrollment are checked separately."));
        root.addView(label("GPIO4 sends a Device Event. GPIO5 opens commissioning without erasing identity or credentials: on a new/unprovisioned board, hold for 1.5 seconds then release within the confirmation window; on an already provisioned board, reboot and do the same within 30 seconds after the recovery gate starts (after Wi-Fi initialization) to request reconfiguration. SoftAP lasts up to 5 minutes after it opens."));
        root.addView(button("Claim Device and prepare Wi-Fi", v -> claimScannedDevice()));
        root.addView(button("Create provisioning session", v -> createProvisioningSession()));
        softApSsid = input("Device SoftAP (derived from linked Device ID)");
        softApSsid.setEnabled(false);
        root.addView(softApSsid);
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
    private void createInvitation() {
        String selectedStore = storeId.getText().toString().trim();
        String recipient = invitationEmail.getText().toString().trim();
        if (selectedStore.isBlank() || recipient.isBlank()) { status.setText("Store ID and invitee email are required"); return; }
        run("Creating STAFF invitation", () -> {
            JSONObject result = api().createInvitation(requireAccess(), selectedStore, recipient);
            JSONObject data = result.optJSONObject("data");
            String token = data == null ? "" : data.optString("token");
            if (!token.isBlank()) invitationToken.setText(token);
            return token.isBlank() ? "Invitation created. Share the one-time token from the issuance response." : "Invitation created. Copy the one-time token to the intended recipient.";
        });
    }
    private void loadInvitations() {
        String selectedStore = storeId.getText().toString().trim();
        if (selectedStore.isBlank()) { status.setText("Select a Store ID first"); return; }
        run("Loading invitations", () -> { JSONObject response = api().invitations(requireAccess(), selectedStore); return format(response.optJSONArray("data"), "id", "recipientEmailNormalized", "role", "status", "expiresAt"); });
    }
    private void inspectInvitation() {
        String token = invitationToken.getText().toString().trim();
        if (token.isBlank()) { status.setText("Enter an invitation token first"); return; }
        run("Inspecting invitation", () -> { JSONObject response = api().inspectInvitation(token); return "Invitation: " + response.optJSONObject("data"); });
    }
    private void acceptInvitation() {
        String token = invitationToken.getText().toString().trim();
        if (token.isBlank()) { status.setText("Sign in as the intended recipient and enter an invitation token"); return; }
        run("Accepting invitation", () -> { api().acceptInvitation(requireAccess(), token); return "Invitation accepted. Refresh Stores to verify STAFF membership."; });
    }
    private void loadDevices() { String id=storeId.getText().toString().trim(); if(id.isBlank()){devices.setText("Select a Store ID first");return;} run("Loading devices", () -> format(api().devices(requireAccess(),id),"id","name","status","provisioningState","enrollmentStatus")); }
    private void createProvisioningSession() {
        String selectedStore = storeId.getText().toString().trim();
        String selectedDevice = deviceId.getText().toString().trim();
        if (selectedStore.isBlank() || selectedDevice.isBlank()) {
            status.setText("Store ID and enrolled Device ID are required");
            return;
        }
        run("Creating provisioning session", () -> {
            provisioningData = fetchProvisioningData(selectedStore, selectedDevice);
            startCommissioningLifecycle();
            return "Provisioning session ready; confirm the device physically before continuing.";
        });
    }

    private JSONObject fetchProvisioningData(String selectedStore, String selectedDevice) throws Exception {
        String access = requireAccess();
        JSONObject response = api().createProvisioningSession(access, selectedStore, selectedDevice,
                UUID.randomUUID().toString());
        JSONObject data = response.optJSONObject("data");
        if (data == null || data.optJSONObject("session") == null
                || data.optString("deviceEnrollmentPublicKey").isBlank()) {
            throw new ApiClient.ApiError(502, "Device trust material is unavailable");
        }
        JSONArray registeredDevices = api().devices(access, selectedStore);
        JSONObject selected = null;
        for (int i = 0; i < registeredDevices.length(); i++) {
            JSONObject candidate = registeredDevices.optJSONObject(i);
            if (candidate != null && selectedDevice.equals(candidate.optString("id"))) { selected = candidate; break; }
        }
        if (selected == null || selected.optString("deviceKey").isBlank())
            throw new ApiClient.ApiError(502, "Device redemption context is unavailable");
        data.put("deviceKey", selected.optString("deviceKey"));
        data.put("deviceId", selectedDevice);
        data.put("storeId", selectedStore);
        return data;
    }

    private void startCommissioningLifecycle() throws ApiClient.ApiError {
        commissioningRun++;
        if (!commissioning.start(System.currentTimeMillis(), 30 * 60_000L)) {
            throw new ApiClient.ApiError(409, "A commissioning session is already active");
        }
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
        final String candidateId = DeviceQrIdentity.claimCandidate(
                pendingDeviceClaimId, deviceId.getText().toString().trim());
        final String selectedStore = storeId.getText().toString().trim();
        String wifiPermission = Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
        if (candidateId == null || selectedStore.isBlank()) {
            status.setText("Enter or scan an unassigned public Device ID and select a Store first");
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
            String stage = "api";
            try {
                JSONObject claimEnvelope = api().createDeviceClaimSession(requireAccess(), selectedStore, candidateId, displayName);
                ClaimStartResponse parsedClaim = ClaimStartResponse.parse(claimEnvelope, candidateId, selectedStore);
                JSONObject claimData = parsedClaim.data;
                if (parsedClaim.alreadyClaimed) {
                    JSONObject linked = claimData.getJSONObject("device");
                    pendingDeviceClaimId = null;
                    runOnUiThread(() -> {
                        deviceId.setText(candidateId);
                        devices.setText("Already linked in this Store: " + candidateId + " — " + linked.optString("status"));
                        status.setText("Backend confirmed this Device is already linked here. Create a provisioning session to configure Wi-Fi.");
                    });
                    return;
                }
                JSONObject claimSession = parsedClaim.session;
                String ssid = DeviceQrIdentity.softApSsid(candidateId);
                if (ssid == null) throw new IllegalStateException("Device QR identity is not supported by this firmware profile");
                runOnUiThread(() -> status.setText("Connect to the Device SoftAP to verify its first-claim proof…"));
                if (softApConnection != null) softApConnection.close();
                softApConnection = new SoftApConnection(this);
                stage = "softap";
                softApConnection.connect(ssid, new SoftApConnection.Listener() {
                    @Override public void onAvailable(Network network) {
                        executor.execute(() -> finishDeviceClaim(selectedStore, candidateId, claimData, claimSession, network));
                    }
                    @Override public void onUnavailable() {
                        pendingDeviceClaimId = candidateId;
                        runOnUiThread(() -> status.setText("Android did not complete the SoftAP connection. Keep the pairing window open, accept the Wi-Fi prompt, and retry."));
                    }
                    @Override public void onLost() {
                        pendingDeviceClaimId = candidateId;
                        runOnUiThread(() -> status.setText("Android lost the SoftAP connection before claim proof completed. Keep the pairing window open and retry."));
                    }
                });
            } catch (Exception failure) {
                pendingDeviceClaimId = candidateId;
                String userMessage = ClaimStartFailure.describe(stage, failure);
                postStatus(userMessage);
            }
        });
    }

    private void finishDeviceClaim(String selectedStore, String candidateId, JSONObject claimData, JSONObject claimSession, Network network) {
        String stage = "device_proof";
        try {
            CommissioningTransportClient proofClient = new CommissioningTransportClient();
            JSONObject proof = proofClient.requestEnrollmentProof("http://192.168.4.1", claimData, network);
            proofClient.close();
            stage = "internet_handoff";
            if (softApConnection == null || !softApConnection.releaseAndAwaitInternet(15_000L)) {
                throw new IllegalStateException("Internet network did not return after SoftAP release");
            }
            stage = "backend_claim_completion";
            JSONObject result = api().completeDeviceClaim(requireAccess(), selectedStore,
                    claimSession.getString("id"), proof);
            stage = "provisioning_session";
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
            String userMessage = CommissioningFailure.describeClaim(stage, failure);
            runOnUiThread(() -> status.setText(userMessage));
        }
    }
    private void provisionOverSoftAp() {
        JSONObject data = provisioningData;
        long run = commissioningRun;
        String deviceIdValue = data == null ? "" : data.optString("deviceId", "");
        String ssid = DeviceQrIdentity.softApSsid(deviceIdValue);
        String stationSsid = wifiSsid.getText().toString();
        String stationPassword = wifiPassword.getText().toString();
        if (ssid == null || stationSsid.isBlank() || stationPassword.length() < 8) {
            status.setText("A valid linked Device and venue Wi-Fi details are required"); return;
        }
        if (data == null) {
            String selectedStore = storeId.getText().toString().trim();
            String selectedDevice = deviceIdValue;
            if (selectedStore.isBlank() || selectedDevice.isBlank()) {
                status.setText("Select the Store and linked Device before connecting"); return;
            }
            status.setText("Refreshing a provisioning session for the linked Device…");
            executor.execute(() -> {
                try {
                    provisioningData = fetchProvisioningData(selectedStore, selectedDevice);
                    startCommissioningLifecycle();
                    runOnUiThread(() -> {
                        status.setText("Fresh provisioning session ready. Connecting to Device SoftAP…");
                        provisionOverSoftAp();
                    });
                } catch (Exception failure) {
                    postStatus("Could not prepare Wi-Fi setup. Confirm the Device is linked to this Store, then refresh Devices.");
                }
            });
            return;
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
                        boolean pollBackend = false;
                        try {
                            JSONObject session = data.getJSONObject("session");
                            client.handshake("http://192.168.4.1", session.getString("id"),
                                    data.getString("deviceEnrollmentPublicKey"), data.getString("challenge"),
                                    parseExpiry(session.optString("expiresAt")),
                                    "owner-android", network);
                            if (!commissioning.transition(CommissioningLifecycle.State.SENDING_CONFIGURATION, System.currentTimeMillis())) throw new IllegalStateException("Commissioning state expired");
                            runOnUiThread(() -> status.setText("Sending encrypted Wi-Fi configuration…"));
                            client.sendCredentials("http://192.168.4.1", stationSsid, stationPassword,
                                    data.getString("deviceId"), data.getString("deviceKey"), data.getString("bootstrapSecret"), network);
                            if (!commissioning.transition(CommissioningLifecycle.State.DEVICE_CONNECTING_WIFI, System.currentTimeMillis())) throw new IllegalStateException("Commissioning state expired");
                            accepted = true;
                            pollBackend = true;
                            runOnUiThread(() -> status.setText("Encrypted configuration accepted by the device; waiting for backend confirmation."));
                        } catch (Exception error) {
                            boolean credentialsMayHaveReachedDevice = error instanceof CommissioningRequestTimeout
                                    && "credentials".equals(((CommissioningRequestTimeout) error).stage);
                            if (credentialsMayHaveReachedDevice &&
                                    commissioning.transition(CommissioningLifecycle.State.DEVICE_CONNECTING_WIFI, System.currentTimeMillis())) {
                                pollBackend = true;
                                runOnUiThread(() -> status.setText(CommissioningFailure.describeProvisioning(error)));
                            } else {
                                commissioning.fail();
                                String failureMessage = CommissioningFailure.describeProvisioning(error);
                                runOnUiThread(() -> status.setText(failureMessage));
                            }
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
                        if (pollBackend && run == commissioningRun) {
                            executor.execute(() -> awaitBackendDeviceStatus(data, run));
                        }
                    });
                }
                @Override public void onUnavailable() {
                    boolean retryable = commissioning.retrySoftApConnection(System.currentTimeMillis());
                    runOnUiThread(() -> status.setText(retryable
                            ? "Android did not provide the Device Wi-Fi network within 30 seconds. Check whether a system Wi-Fi prompt appeared; if not, open Wi-Fi settings and confirm the matching PulseLink network is visible. Keep the board nearby and its 5-minute SoftAP window open, then retry."
                            : "The commissioning session expired. Create a fresh provisioning session and retry."));
                }
                @Override public void onLost() {
                    commissioning.fail();
                    runOnUiThread(() -> status.setText("Android lost the Device SoftAP connection before Wi-Fi setup. Reconnect while its commissioning window is open; if expired, reopen pairing with GPIO5 after reboot."));
                }
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
            ConnectivityManager connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            runOnUiThread(() -> status.setText("Device accepted Wi-Fi setup. Restoring phone Internet before checking backend status…"));
            if (connectivity == null || !InternetNetworkWaiter.awaitDefaultInternet(connectivity, 30_000L)) {
                if (run == commissioningRun) {
                    commissioning.fail();
                    runOnUiThread(() -> status.setText("Device accepted the local Wi-Fi handoff, but the phone did not regain validated Internet within 30 seconds. Check phone Wi-Fi/mobile data, then refresh Device status."));
                }
                return;
            }
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
