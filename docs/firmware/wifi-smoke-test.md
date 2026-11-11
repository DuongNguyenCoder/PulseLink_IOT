# Wi-Fi smoke test

Mục tiêu của test này là kiểm tra board, firmware và Wi-Fi độc lập với
backend/provisioning.

## Cấu hình an toàn

Mở `menuconfig` cho profile `default` một cách tường minh (từ `firmware/esp32`):

```powershell
idf.py -B build/profiles/default `
  -D "SDKCONFIG=$((Join-Path (Get-Location) 'build/profiles/default/sdkconfig'))" `
  -D "SDKCONFIG_DEFAULTS=$((Join-Path (Get-Location) 'sdkconfig.defaults'))" menuconfig
```

Trong **PulseLink firmware**, nhập SSID/password chỉ vào
`build/profiles/default/sdkconfig`:

- `Wi-Fi SSID`
- `Wi-Fi password`

Không đưa password vào source, `sdkconfig.defaults`, log hoặc issue. File
`sdkconfig` local đã được `.gitignore`.

Board mục tiêu là ESP32-S3, chỉ dùng mạng Wi-Fi 2,4 GHz cho smoke test.

## Chạy test

```powershell
cd firmware/esp32
..\..\scripts\Build-FirmwareProfile.ps1 -Profile default
```

Flash là bước riêng, hiển thị hash và yêu cầu xác nhận:

```powershell
..\..\scripts\Flash-FirmwareProfile.ps1 -Profile default -Port COM7
```

Thay `COM7` bằng port đã xác minh. Chỉ sau khi xác nhận đúng board mới mở
monitor bằng `idf.py -B build/profiles/default -p COM7 monitor -B 115200`.
Không dùng plain `idf.py build` hoặc `idf.py flash`.

Log mong đợi:

- Firmware version và chip/model.
- `wifi starting 2.4 GHz station`.
- `wifi got ip ...`.
- SSID, RSSI và channel; password không bao giờ được in.

Nếu SSID trống hoặc sai, firmware ghi lỗi và không reboot liên tục. Khi mất
mạng, firmware retry với backoff tối đa 30 giây.

## Checklist người dùng

1. Flash firmware.
2. Mở serial monitor.
3. Xác nhận chip/version và trạng thái Wi-Fi.
4. Xác nhận có IP và RSSI.
5. Tắt/bật access point hoặc router.
6. Quan sát disconnect và reconnect.
7. Reboot board và xác nhận hành vi tương tự.

Sau khi Wi-Fi nhận IP, firmware có thể chạy thêm HTTP LAN smoke test nếu đã
cấu hình `Backend health URL`. Test này không phải provisioning; chưa có
SoftAP, NVS credential, device token hoặc business API call.
