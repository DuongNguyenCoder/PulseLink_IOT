# Store, Device, and Wi-Fi commissioning (staging)

This guide uses the Owner app and the staging firmware profile. A public Device
ID identifies a board; it is not an ownership credential. The backend verifies
the signed first-claim proof and the signed-in account's OWNER access to the
selected Store.

## Button wiring and behavior

- **GPIO4 to GND: Event button.** Press and release once to request one Device
  Event. The firmware debounce state machine suppresses repeats during one
  continuous hold.
- **GPIO5 to GND: Commissioning button.** For an unclaimed board, hold it LOW
  for at least 1.5 seconds, then release it. For a provisioned board, reboot
  first and perform the same gesture within the first 30 seconds to request
  bounded reconfiguration. This input does not enqueue a Device Event.
- The staging firmware configures both as active-low inputs with internal
  pull-ups. Use a momentary switch to GND; never connect a GPIO to 5 V.
- The GPIO mapping is verified in the staging firmware source/config and in the
  flashed image. The carrier-board schematic and external switch wiring are not
  available in the repository; confirm the actual board pads/wiring before
  connecting switches. Software evidence does not prove electrical behavior.

The physical-confirmation timer begins when the commissioning gate task starts
after Wi-Fi initialization. A fresh GPIO5 press/release must be accepted within
30 seconds of that point. A GPIO5 input already LOW when the gate starts is
ignored until released and pressed again. After the SoftAP and local server
start successfully, a separate five-minute bounded lifecycle begins. Pressing
GPIO5 does not restart that deadline. The current path provides no documented LED cue, so use the app's
SoftAP connection result as the observation. Do not use GPIO4 to start
commissioning.

For a Device that already has a valid operational credential, startup first
attempts authenticated backend recovery. GPIO5 is sampled during the first 30
seconds after the reconfiguration gate starts. A valid hold/release cancels
recovery and opens the same five-minute SoftAP window. This request does not
erase Wi-Fi settings, operational credential, identity, pending Events, or
Store ownership. The Owner must sign in and create a fresh provisioning session
for the already-linked Device; the existing encrypted handshake and single-use
redemption then rotate its operational credential. If GPIO5 is not accepted in
the startup window, backend recovery continues and the button is ignored until
the next reboot. This flow has source/host/build evidence only and still needs
physical verification.

If the operational credential record is structurally invalid, startup selects a
GPIO5-gated credential-repair path while preserving Device identity. A storage
provider I/O failure remains blocked; do not erase NVS. A missing credential
uses the initial commissioning path. Operational credential and identity
remain in ordinary NVS; no hardware-protected storage claim is made.

## Prepare the phone and Store

1. Use the installed Owner debug app on Android 10 or newer. Sign in to the
   staging API origin `https://pulselink.chuanxinstore.com`.
2. Grant Nearby Wi-Fi access when Android requests it. On Android 12 and later,
   also grant notification permission if you want to observe FCM delivery.
3. Create a Store or select the existing Store. The account that created it has
   OWNER access. Refresh Stores and Devices before proceeding; copy the
   selected Store ID into the app's **Selected Store ID** field.
4. Use the public Device ID from the board label/QR, or enter it manually. For
   the board identified on COM4 in RUN-044, the current public ID is
   `pl-98c377b427f4` and the matching SoftAP SSID is `PulseLink-27F4`. This ID
   comes from the ESP32 station MAC and is public; it grants no access by
   itself. Re-identify the board if it has been changed.

## First link and Wi-Fi setup

1. Power the board and allow firmware startup to reach the commissioning gate.
   Within the confirmation window, hold **GPIO5 to GND** for at least 1.5
   seconds, then release it. Do not press GPIO4 for this step.
2. In the app, select the target Store, enter/scan the Device ID and tap
   **Claim Device and prepare Wi-Fi**. The app asks Android to connect to the
   corresponding `PulseLink-XXXX` SoftAP, obtains the board's signed claim
   proof, and asks the backend to link the Device. Accept Android's network
   prompt; the SoftAP has no Internet access.
3. Continue only after the app says the backend confirmed the claim. The first
   claim flow also creates the provisioning session. If the Device is already
   linked to this same Store and its SoftAP commissioning window is currently
   active, tap **Create provisioning session** instead. A Device linked to
   another Store cannot be transferred by repeating claim.
4. Enter the device SoftAP SSID shown by the app, the venue's 2.4-GHz Wi-Fi
   SSID, and its password. Tap **Connect and send encrypted Wi-Fi
   configuration** and accept the Android Wi-Fi prompt. The phone's local
   commissioning channel uses the existing authenticated encrypted handshake.
   The Wi-Fi password is cleared from the app field after the send attempt.
5. The app should report that encrypted configuration was accepted and then
   wait for backend status. That message is **not** proof of Wi-Fi association,
   redemption, or ONLINE. The board redeems the session, persists its
   operational credential in ordinary NVS, and performs authenticated backend
   status confirmation.
6. When the app reports it is waiting for the first authenticated Device
   Event, press and release **GPIO4 to GND once**. This is the button action
   that creates the Event. Do not repeatedly press it while waiting. After the
   backend commits the Event, the app should show ONLINE and the backend may
   queue an account-recipient notification.
7. If Android remains attached to a no-Internet SoftAP after transfer, use
   Android's Wi-Fi settings to return to the venue network. The app releases
   its process network binding after the local transfer; phone network
   selection can still be controlled by Android.
8. Refresh Devices in the selected Store. Confirm the Device is ONLINE. Check
   Android notification permission, account FCM registration and staging
   `NOTIFICATION_RECIPIENT_MODE=account` if the push is not received. Do not
   send a second button Event just to retry notification delivery.

## Retry and failure handling

- **Claim could not start:** note whether the app says Store authorization,
  Device state, SoftAP connection, or backend response failed. The app first
  creates a short-lived claim challenge; a `DeviceClaimSession` row alone does
  not mean the Device was linked. Board proof is fetched only after Android
  connects to `PulseLink-XXXX`, and backend linking completes only after that
  proof is accepted. If the SoftAP window elapsed, restart the commissioning
  gesture and retry; do not reuse an expired claim session.
- **SoftAP disappears while claim is in progress:** firmware bounds the active
  SoftAP window to five minutes from successful SoftAP and HTTP server startup.
  Station reconnect requests are deferred while commissioning owns Wi-Fi mode.
  If the app reports the SoftAP unavailable, check that it is still within
  that window and retry from the Owner app. Do not switch GPIO4/GPIO5 roles or
  erase NVS.
- **SoftAP not found:** confirm the board is powered and GPIO5 gesture was
  performed in the gate window. A held-at-start button must be released and
  pressed again. Restarting power restarts the commissioning window; it does
  not erase identity or NVS.
- **Board already has saved station configuration and operational credential:**
  startup attempts backend recovery and samples GPIO5 only during the first
  30-second startup window. Reboot without erasing NVS, hold GPIO5 to GND for
  at least 1.5 seconds, then release within that window to request the bounded
  reconfiguration SoftAP. If the window expires, recovery continues until the
  next reboot. Create a fresh provisioning session from the currently linked
  Store; do not repeat first-claim or transfer ownership.
- **Backend status/Event returns HTTP 401:** firmware sends the operational
  credential loaded from NVS as a Bearer header. Backend authentication
  requires its hash to match an enabled, ENROLLED, PROVISIONED Device. GPIO5
  reconfiguration is available only during its bounded startup window; after
  that, do not repeatedly press it or erase NVS. For an Event 401, firmware
  preserves the event as blocked rather than retrying the rejected credential
  indefinitely. A signed-in Owner can request a fresh session for the already
  linked Device while its SoftAP window is active; redemption rotates the
  credential only after backend proof checks and firmware persistence. An
  already blocked Event remains blocked and is not automatically replayed.
  Capture the redacted status/request ID and have an authorized operator verify
  Device state before following the approved recovery procedure.
- **HTTP smoke request error:** this optional unauthenticated GET runs only
  when `PULSELINK_BACKEND_URL` is configured and the station gets an IP. It is
  independent of Device Event and authenticated status. The staging profile
  leaves this URL empty, so its smoke task is disabled. The updated diagnostic
  reports a safe failure category, HTTP status, ESP error and socket errno;
  it never logs headers or response body.
- **Claim rejected:** refresh the selected Store and check signed-in OWNER
  access. A QR/Device ID alone cannot claim a board; a cross-Store assignment
  is not transferable through this flow.
- **Wi-Fi send rejected or timeout:** verify 2.4-GHz network details and
  proximity. Start a new provisioning session from the same Store and retry;
  do not reuse an expired session.
- **No ONLINE status:** refresh Devices and check the backend/phone Internet
  path. Wi-Fi association alone is insufficient; the first accepted Event is
  also needed to move the app's observed status to ONLINE.
- **No notification:** verify the account owns the Store, OS notification
  permission is granted, the Owner app has registered its FCM token, and the
  deployed staging worker uses account recipient mode. Event commit and push
  delivery are separate observations.

## Security and evidence limits

The staging build stores identity private material and operational credential
in ordinary NVS. They can be extracted from raw flash; this build does not claim
at-rest confidentiality. No NVS encryption, Secure Boot, Flash Encryption or
eFuse changes were made. Claim uses first-use proof-of-possession (TOFU), not
manufacturer attestation.

RUN-044 verified the ESP32-S3 on COM4 and read back the flashed bootloader,
partition table and application against the build artifacts. No Android phone
was listed by ADB during that run. The GPIO buttons, SoftAP join, Wi-Fi
association, backend redemption/status, Event/ACK, FCM delivery and reboot
recovery have not yet been exercised physically. Treat them as pending until
observed on the phone/board.
