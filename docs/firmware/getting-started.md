# PulseLink ESP32-S3 firmware — bắt đầu

Firmware project tại `firmware/esp32/` dùng ESP-IDF target `esp32s3`, tương
thích mục tiêu ESP-IDF `v5.5.5`. Profile mặc định chọn GPIO4 cho Event, GPIO5
cho commissioning; kiểm tra wiring trên carrier board trước khi thao tác.

Firmware hiện có persistent NVS event queue tối đa 8 sự kiện. Mỗi lần nhấn
hợp lệ tạo một UUID v4 và lưu queue trước khi sender task gửi HTTPS. Retry giữ
nguyên UUID; response `200` hoặc `201` mới xóa record. Response `400`, `401`,
`403` hoặc `409` chuyển record sang trạng thái blocked để không retry vô hạn và
không xóa âm thầm dữ liệu.

## Chuẩn bị trên Windows

1. Cài ESP-IDF theo hướng dẫn chính thức của Espressif và mở **ESP-IDF
   PowerShell**.
2. Mở đúng ESP-IDF PowerShell và kiểm tra:

```powershell
idf.py --version
# Kỳ vọng: ESP-IDF v5.5.5
```

3. Cắm board bằng cáp USB truyền dữ liệu, không chỉ cáp sạc.
4. Xác định COM port bằng Device Manager hoặc:

```powershell
Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Description
# Nếu USB Serial/JTAG không hiện ở lệnh trên:
Get-PnpDevice -Class Ports | Where-Object Status -eq 'OK' | Format-Table -AutoSize
```

## Build không thao tác board

Từ root repository, chọn profile một cách tường minh:

```powershell
# Profile mặc định:
.\scripts\Build-FirmwareProfile.ps1 -Profile default
# Staging:
.\scripts\Build-FirmwareProfile.ps1 -Profile staging
```

Script legacy `Invoke-FirmwareBuild.ps1` giờ yêu cầu tham số `-Profile` và
chuyển tiếp sang profile builder. Mỗi profile có `sdkconfig`, CMake cache và
build directory riêng dưới `firmware/esp32/build/profiles/<profile>`. Script
truyền đường dẫn tuyệt đối, reconfigure, kiểm tra effective Kconfig và build.
Không dùng plain `idf.py build` để tạo image phát hành.

## Cấu hình event API

Nếu cần thay đổi cấu hình cục bộ, mở menuconfig với cùng profile và đường dẫn
rõ ràng (ví dụ từ `firmware/esp32`):

```powershell
idf.py -B build/profiles/default `
  -D "SDKCONFIG=$((Join-Path (Get-Location) 'build/profiles/default/sdkconfig'))" `
  -D "SDKCONFIG_DEFAULTS=$((Join-Path (Get-Location) 'sdkconfig.defaults'))" menuconfig
```

Sau menuconfig, build lại bằng `Build-FirmwareProfile.ps1 -Profile default`;
script dừng nếu cấu hình hiệu lực sai profile hoặc có build-time device token.
Wi-Fi credentials commissioning không được đưa vào firmware defaults.

Trong menu **PulseLink firmware** cần cấu hình:

  `/v1/device-events`.
- `PULSELINK_EVENT_ENDPOINT_URL`: chỉ cấu hình trong profile phù hợp; staging
  defaults giữ endpoint HTTPS hiện có.
- Không cấu hình `PULSELINK_DEVICE_TOKEN` cho commissioning; credential được
  cấp trong provisioning. Build script từ chối token build-time.
- Wi-Fi credentials của commissioning được gửi qua Owner App, không đưa vào
  defaults.

Không commit `sdkconfig` chứa credential. TLS dùng ESP-IDF certificate bundle;
không bật insecure mode và không dùng HTTP cho event endpoint.

## Flash và hardware test

Flash yêu cầu profile tường minh, hiển thị image/hash và chờ nhập chuỗi xác
nhận trước khi ghi:

```powershell
.\scripts\Flash-FirmwareProfile.ps1 -Profile default -Port COM7
# Chọn staging riêng khi đã xác minh board, image và môi trường:
.\scripts\Flash-FirmwareProfile.ps1 -Profile staging -Port COM7
```

Thay `COM7` bằng port đã xác minh. Flash script build và kiểm tra artifact
trước khi hỏi xác nhận; build script không tự flash. Không dùng lệnh erase.

Serial monitor mặc định dùng baud rate của project ESP-IDF; nếu cần chỉ định
rõ ràng, dùng `idf.py -p COM7 monitor -B 115200`.

Firmware không tự động ghi eFuse, bật Secure Boot hoặc flash encryption.
Startup log ghi build profile, fingerprint của các trường cấu hình không nhạy
cảm, ESP-IDF version, target, GPIO và trạng thái commissioning/providers. Không
hash toàn bộ `sdkconfig`, vì file local có thể chứa secret.

Hardware verification cần xác nhận: debounce 50 ms và cooldown 5 giây cho một
lần nhấn, mất Wi-Fi rồi gửi lại cùng `eventId`, reboot khi NVS còn event, queue
đầy, TLS certificate và response `200`/`201`/`401`/`409`.

## Quy tắc ghi nhận kết quả

- `BUILD_PASS`: chỉ được ghi sau khi `idf.py build` thực sự chạy.
- `FLASH_NOT_RUN`: chưa có bằng chứng board đã được flash trong môi trường này.
- `HARDWARE_TEST_PENDING`: chưa xác minh carrier board, LED, button hoặc COM.

## WP09 validation record

Automated checks completed on 2026-10-18:

- `idf.py --version`: `PASS` — ESP-IDF `v5.5.5`.
- `idf.py build`: `PASS` — target `esp32s3`, firmware binary generated, no
  compiler warning after GPIO guard hardening.
- TLS configuration review: `PASS` — event endpoint requires `https://` and
  uses the ESP-IDF certificate bundle; no insecure fallback is present.
- NVS queue/error-path review: `PASS` — failed queue cleanup or `BLOCKED`
  persistence restores the in-memory record and retries.

Hardware checks are not evidence-complete in this environment:

- `NOT RUN — HARDWARE REQUIRED`: flash/serial boot, one-press and 5-second
  cooldown, long press, contact bounce, queue-full LED, NVS reboot/power-loss,
  Wi-Fi recovery, HTTPS/TLS handshake, and end-to-end event delivery.
- Board carrier, button wiring, LED type, and COM port remain unverified. Do
  not treat a locally configured GPIO as proof of the physical wiring.

The build also reports the app partition is nearly full, with approximately
3% free space remaining. This is a capacity risk for future firmware growth,
not a hardware validation pass.
