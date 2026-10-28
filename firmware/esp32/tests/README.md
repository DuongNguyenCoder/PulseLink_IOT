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

The commissioning controller is a transport-independent state machine. It
does not open SoftAP, handle Wi-Fi credentials or redeem a backend session:

```powershell
cc -std=c17 -Wall -Wextra -Werror -I main `
  main/commissioning_state.c tests/commissioning_state_test.c `
  -o tests/commissioning_state_test.exe
tests/commissioning_state_test.exe
```

The controller's tests cover invalid transitions, physical-acceptance gating,
deadline expiry including a 32-bit clock wrap, cancellation, terminal states
and consume-once session handling. Passing these host tests is not evidence of
SoftAP, encrypted NVS or board runtime behavior.

The commissioning transcript builder is also host-testable. It only encodes
public handshake context; it does not derive keys, encrypt Wi-Fi credentials or
open a network listener:

```powershell
cc -std=c17 -Wall -Wextra -Werror -I main `
  main/commissioning_protocol.c tests/commissioning_protocol_test.c `
  -o tests/commissioning_protocol_test.exe
tests/commissioning_protocol_test.exe
```

The provider in this test is an in-memory test double only. It is not linked
into production firmware and does not represent secure private-key storage.

The ESP32 cross-compiler can syntax-check this runner, but executing an
Xtensa binary on the host is not runtime evidence. An ESP-IDF Unity target may
also execute equivalent tests on a board after a test component is added; that
requires a connected ESP32-S3 and is intentionally not part of the production
firmware build.

## Cross-runtime crypto fixture

`commissioning_crypto_v1.txt` contains test-only deterministic P-256 keys and
derived values. It must never be copied into firmware configuration. The C host
adapter uses OpenSSL EVP only to compare the same values used by the Android JVM
tests; it is not a replacement for the ESP-IDF mbedTLS implementation.

Run it in the isolated GCC container with:

```powershell
docker run --rm --network none --read-only `
  --tmpfs /tmp:rw,exec,nosuid,size=64m `
  --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly `
  --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh -lc `
  "cc -std=c17 -Wall -Wextra -Werror -I main tests/commissioning_crypto_host_test.c -lcrypto -o /tmp/crypto && /tmp/crypto"
```

The Android side is run with `:owner:testDebugUnitTest`; both tests read the
same repository fixture. This proves host C/Java value compatibility, not board
runtime, secure storage or SoftAP transport behavior.
