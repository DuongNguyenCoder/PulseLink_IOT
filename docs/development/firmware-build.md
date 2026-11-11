# PulseLink firmware build baseline

## Verified baseline

- Target: `esp32s3` (ESP32-S3-WROOM-1 N16R8 target configuration).
- ESP-IDF: **5.5.5**, evidenced by the project `sdkconfig`/generated build
  configuration and the installed framework path.
- Python: the configured ESP-IDF 5.5 Python 3.11 environment
  (`idf5.5_py3.11_env`). The installed export script currently points at a
  non-existent Python 3.14 environment on this machine, so the verified
  build uses the installed Python 3.11 interpreter directly.
- Generator/build: CMake 3.30.2 and Ninja 1.12.1.
- Compiler: Xtensa ESP32-S3 GCC 14.2.0.

The project uses `sdkconfig.defaults` for safe empty defaults. Local
`sdkconfig` values are machine-specific and must remain uncommitted; do not
copy Wi-Fi credentials or device tokens into source, documentation or logs.

## Reproducible Windows setup

Use the ESP-IDF installation selected by the local Espressif installer. The
following values are examples of the verified installation layout and should
be replaced by the developer's managed installation if it differs:

```powershell
$env:IDF_PATH = 'C:\Espressif\frameworks\esp-idf-v5.5.5'
$env:IDF_TOOLS_PATH = 'C:\Espressif'
$env:IDF_PYTHON_ENV_PATH = 'C:\Espressif\python_env\idf5.5_py3.11_env'
```

The ESP-IDF export script should be used when its configured Python
environment is available. On the verified installation, this explicit setup
is a reproducible fallback and does not install, flash or provision anything:

```powershell
$idfRoot = 'C:\Espressif\frameworks\esp-idf-v5.5.5'
$idfPython = 'C:\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe'
$env:IDF_PATH = $idfRoot
$env:IDF_PYTHON_ENV_PATH = 'C:\Espressif\python_env\idf5.5_py3.11_env'
$env:NINJAFLAGS = '-j1'
& $idfPython "$idfRoot\tools\idf.py" --version
```

From `firmware/esp32`:

```powershell
& $idfPython "$idfRoot\tools\idf.py" set-target esp32s3
& $idfPython "$idfRoot\tools\idf.py" build
```

For constrained Windows environments, a single Ninja job can avoid a
toolchain compiler crash caused by parallel resource pressure:

```powershell
$env:NINJAFLAGS = '-j1'
& $idfPython "$idfRoot\tools\idf.py" build
```

This is a workaround for the observed environment, not a firmware semantic
requirement. Do not flash a board as part of a normal build check; flashing is
a separate, explicitly approved hardware operation.

## Baseline result

On 2026-10-28, ESP-IDF 5.5.5 configured the project for `esp32s3` and a
fresh single-job build from the current dirty source completed, producing
`build/pulselink_firmware.bin`. The verified toolchain reported CMake 3.30.2,
Ninja 1.12.1 and ESP32-S3 GCC 14.2.0. The build emitted an `ESP_ROM_ELF_DIR`
environment warning but completed successfully.
The application partition reported approximately 3% free space. A parallel
build attempt hit an internal compiler error while compiling an ESP-IDF
`esp_lcd` source file; the single-job retry completed successfully.

This baseline proves compilation of the current Wi-Fi/event firmware only. It
does not prove SoftAP commissioning, key protection, physical confirmation,
Wi-Fi provisioning or hardware behavior.

## Physical-confirmation component check

The pure state-machine source is compiled as part of the firmware component.
The companion test vector is `firmware/esp32/tests/physical_confirmation_test.c`.
It covers short press rejection, debounce, long-press acceptance, timeout,
cancel and consume-once behavior. The current environment has no host C test
runner configured, so the vector was syntax-checked with the ESP32-S3 compiler.
The vector was also executed in the pinned `gcc:13.2.0-bookworm` Docker host
runner; host state-machine execution passed, while GPIO electrical behavior
remains unverified.

The identity preparation sources are compiled into the firmware component:
`device_identity.c` provides a provider boundary and
`device_provisioning_payload.c` reproduces the backend's versioned canonical
payload format. `esp_device_identity_provider.c` implements an opt-in ESP-IDF
adapter using NVS and mbedTLS. The MVP profile stores identity private keys in
ordinary NVS, where they are extractable from raw flash; this is a documented
TOFU limitation, not protected-at-rest storage.

### Identity-provider compile-only profile

`sdkconfig.identity-provider.defaults` is a legacy isolated compile profile.
It must be used with a separate build directory and SDKCONFIG output, never by
overwriting the local operational `sdkconfig`. It does **not** create NVS
security keys, provision Flash Encryption/Secure Boot, prove persistence, or
authorize flashing the resulting image.

### Commissioning MVP compile profile

`sdkconfig.commissioning-mvp.defaults` opts in to first-boot P-256 identity
generation and operational-token persistence in ordinary NVS. It explicitly
leaves NVS Encryption disabled and provides reboot-oriented persistence only,
not confidentiality against raw flash access. Keep it in a separate build
directory:

```powershell
& $idfPython "$idfRoot\tools\idf.py" -B build/commissioning-mvp `
  -D 'SDKCONFIG=build/commissioning-mvp/sdkconfig' `
  -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.commissioning-mvp.defaults' build
```

This profile is compile evidence only. Verify actual board identity, GPIO,
Wi-Fi persistence and recovery before any flash or runtime test.

## Staging commissioning profile

`sdkconfig.staging.defaults` selects the approved staging HTTPS origin and
16 MiB flash header for the N16R8 firmware target. The staging profile assigns
GPIO4 to the operational Event button and GPIO5 to commissioning. Source/config
separate the two inputs; this does not verify the external carrier-board wiring.
Do not flash or wire the board based on this mapping until its schematic or
revision-specific pinout confirms GPIO5 is available and connected as intended.
The Owner app's `google-services.json` is local Firebase project configuration;
never copy it into reports or print its contents. Firmware defaults contain no
Wi-Fi password, device token or per-device key.

Build into an isolated directory so the machine-local `sdkconfig` is not
overwritten:

```powershell
& $idfPython "$idfRoot\tools\idf.py" -B build/staging-gpio-split `
  -D 'SDKCONFIG=build/staging-gpio-split/sdkconfig' `
  -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.commissioning-mvp.defaults;sdkconfig.staging.defaults' `
  set-target esp32s3 build
```

This profile enables the existing ordinary-NVS identity and operational-token
providers. It does not encrypt NVS, attest genuine hardware, or prove runtime
recovery; flash extraction can disclose those values. The build is not flash
authorization. Owner push delivery is Account-centric: the backend resolves
active Store memberships to active AppInstallations.

For first claim, hold the separate commissioning input (GPIO5 in the staging
profile) active-low for at least 1.5 seconds, then release it. The 30-second
physical-confirmation window starts when `commissioning_gate_task` begins after
Wi-Fi initialization; it is not measured from chip boot. The gesture must be
accepted before that deadline. After the gesture and successful SoftAP/server
startup, a separate five-minute SoftAP lifecycle begins. This bounded timer
allows the Owner to complete claim proof and send Wi-Fi configuration without
losing time spent before the AP opened. GPIO4 remains the independent Event
button. The SoftAP SSID is `PulseLink-XXXX`, where `XXXX` is the uppercase final
four characters of the public Device ID. On Android, select the Store, enter or
scan the public Device ID, tap **Claim Device and prepare Wi-Fi**, and accept
Android's Wi-Fi connection prompt. After the backend confirms the claim, enter
the venue's 2.4-GHz Wi-Fi credentials in the app and send them over the
authenticated encrypted commissioning session. A Device already claimed by
the selected Store should use **Create provisioning session** while its
SoftAP is active; a Device claimed by another Store cannot be transferred by
QR or a repeated claim request.
