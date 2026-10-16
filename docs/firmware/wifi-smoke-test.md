# Wi-Fi smoke test

Mục tiêu của test này là kiểm tra board, firmware và Wi-Fi độc lập với
backend/provisioning.

## Cấu hình an toàn

Trong `idf.py menuconfig` chọn **PulseLink firmware** và nhập:

- `Wi-Fi SSID`
- `Wi-Fi password`

Không đưa password vào source, `sdkconfig.defaults`, log hoặc issue. File
`sdkconfig` local đã được `.gitignore`.

Board mục tiêu là ESP32-S3, chỉ dùng mạng Wi-Fi 2,4 GHz cho smoke test.

## Chạy test

```powershell
cd firmware/esp32
idf.py build
idf.py -p COM7 flash monitor
```

Thay `COM7` bằng port thực tế. Có thể tách riêng các bước:

```powershell
idf.py -p COM7 flash
idf.py -p COM7 monitor -B 115200
```

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
