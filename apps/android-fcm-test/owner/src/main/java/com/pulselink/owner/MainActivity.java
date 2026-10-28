package com.pulselink.owner;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SecureSession session;
    private EditText api, email, password, storeName, storeSlug, storeId, deviceName;
    private TextView status, stores, devices;

    @Override public void onCreate(Bundle state) { super.onCreate(state); session = new SecureSession(this); setContentView(view()); }
    @Override protected void onDestroy() { executor.shutdownNow(); super.onDestroy(); }

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
        root.addView(label("Commissioning is unavailable until the authenticated SoftAP protocol is implemented and verified."));
        return scroll;
    }
    private void signup() { String e=email.getText().toString().trim(), p=password.getText().toString(); if(e.indexOf('@')<1||p.length()<8){status.setText("Enter a valid email and password (8+ characters)");return;} run("Signing up", () -> { api().signup(e,p); return "Account created. Verify email before signing in."; }); }
    private void login() { String e=email.getText().toString().trim(), p=password.getText().toString(); if(e.indexOf('@')<1||p.length()<8){status.setText("Enter valid credentials");return;} run("Signing in", () -> { JSONObject data=api().login(e,p,installationId()); JSONObject tokens=data.getJSONObject("data"); session.save(tokens.getString("accessToken"),tokens.getString("refreshToken"),api.getText().toString().trim()); return "Signed in securely."; }); }
    private void signout() { String refresh=session.refreshToken(); session.clear(); status.setText("Signed out"); if(refresh!=null) executor.execute(() -> { try { if(session.apiBase()!=null) new ApiClient(session.apiBase()).logout(refresh); } catch(Exception ignored){} }); }
    private void loadStores() { run("Loading stores", () -> { JSONArray a=api().stores(requireAccess()); return format(a,"id","name"); }); }
    private void createStore() { run("Creating store", () -> { api().createStore(requireAccess(),storeName.getText().toString().trim(),storeSlug.getText().toString().trim(),""); return "Store created as OWNER. Refresh stores."; }); }
    private void loadDevices() { String id=storeId.getText().toString().trim(); if(id.isBlank()){devices.setText("Select a Store ID first");return;} run("Loading devices", () -> format(api().devices(requireAccess(),id),"id","name","status","provisioningState","enrollmentStatus")); }
    private void createDevice() { String id=storeId.getText().toString().trim(), name=deviceName.getText().toString().trim(); if(id.isBlank()||name.isBlank()){devices.setText("Store ID and Device name are required");return;} run("Registering device", () -> { JSONObject d=api().createDevice(requireAccess(),id,name).getJSONObject("data"); return "Registered: "+d.optString("id")+" / "+d.optString("status")+" / "+d.optString("provisioningState"); }); }
    private String requireAccess() throws Exception { String token=session.accessToken(); if(token==null) throw new ApiClient.ApiError(401,"Sign in first"); return token; }
    private ApiClient api(){return new ApiClient(api.getText().toString().trim());}
    private String installationId(){return "android-owner-"+UUID.nameUUIDFromBytes(android.provider.Settings.Secure.getString(getContentResolver(),android.provider.Settings.Secure.ANDROID_ID).getBytes());}
    private void run(String working, java.util.concurrent.Callable<String> action){status.setText(working+"…"); executor.execute(()->{try{String result=action.call();runOnUiThread(()->{status.setText(result); if(result.contains("Store")||result.contains("stores"))stores.setText(result); if(result.contains("device")||result.contains("Registered"))devices.setText(result);});}catch(Exception e){runOnUiThread(()->status.setText(e.getMessage()==null?"Request failed":e.getMessage()));}});}
    private String format(JSONArray a,String... fields){if(a==null||a.length()==0)return "No records";StringBuilder b=new StringBuilder();for(int i=0;i<a.length();i++){JSONObject o=a.optJSONObject(i);if(o==null)continue;for(String f:fields){if(b.length()>0)b.append(' ');b.append(f).append('=').append(o.optString(f));}b.append('\n');}return b.toString().trim();}
    private EditText input(String hint){EditText e=new EditText(this);e.setHint(hint);e.setSingleLine(true);return e;}
    private TextView label(String text){TextView t=new TextView(this);t.setText(text);t.setPadding(0,10,0,10);return t;}
    private Button button(String text,View.OnClickListener l){Button b=new Button(this);b.setText(text);b.setOnClickListener(l);return b;}
}
