# Physical confirmation runtime test

`physical_confirmation_test.c` is a host-style C runner for the pure state
machine. It does not access GPIO, Wi-Fi, SoftAP or the backend.

When a host C compiler is available, run from `firmware/esp32`:

```powershell
cc -std=c17 -Wall -Wextra -Werror -I main `
  main/physical_confirmation.c tests/physical_confirmation_test.c `
  -o tests/physical_confirmation_test.exe
tests/physical_confirmation_test.exe
```

The identity lifecycle and canonical backend payload checks are a separate
executable:

```powershell
cc -std=c17 -Wall -Wextra -Werror -I main `
  main/device_identity.c main/device_provisioning_payload.c `
  tests/device_identity_test.c -o tests/device_identity_test.exe
tests/device_identity_test.exe
```

The provider in this test is an in-memory test double only. It is not linked
into production firmware and does not represent secure private-key storage.

The ESP32 cross-compiler can syntax-check this runner, but executing an
Xtensa binary on the host is not runtime evidence. An ESP-IDF Unity target may
also execute equivalent tests on a board after a test component is added; that
requires a connected ESP32-S3 and is intentionally not part of the production
firmware build.
