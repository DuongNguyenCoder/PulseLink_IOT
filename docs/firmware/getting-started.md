# PulseLink ESP32-S3 firmware — bắt đầu

Firmware project tại `firmware/esp32/` dùng ESP-IDF target `esp32s3`, tương
thích mục tiêu ESP-IDF `v5.5.5`. Repository chưa có schematic/carrier-board
identification, vì vậy GPIO nút và LED mặc định là `-1` và chưa được sử dụng.

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

Từ root repository, build firmware bằng ESP-IDF `v5.5.5`:

```powershell
.\scripts\Invoke-FirmwareBuild.ps1
```

Lệnh này chỉ chạy `idf.py --version` và `idf.py build`. Nếu `idf.py` không
được tìm thấy, shell chưa được khởi tạo đúng. Nếu version khác `v5.5.5`, dừng
và sửa môi trường trước khi kết luận về source.

## Cấu hình event API

Trong `idf.py menuconfig`, mục **PulseLink firmware** cần cấu hình:

- `PULSELINK_EVENT_ENDPOINT_URL`: URL đầy đủ dạng HTTPS kết thúc bằng
  `/v1/device-events`.
- `PULSELINK_DEVICE_TOKEN`: operational bearer token riêng của từng thiết bị.
- Wi-Fi SSID/password và GPIO button/LED theo carrier board thực tế.

Không commit `sdkconfig` chứa credential. TLS dùng ESP-IDF certificate bundle;
không bật insecure mode và không dùng HTTP cho event endpoint.

## Flash và hardware test

Từ root repository:

```powershell
cd firmware/esp32
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py -p COM7 flash monitor
```

Thay `COM7` bằng port thực tế. `menuconfig` nằm trong menu **PulseLink
firmware**; cấu hình Wi-Fi chỉ được lưu trong `sdkconfig` local, không commit.

Serial monitor mặc định dùng baud rate của project ESP-IDF; nếu cần chỉ định
rõ ràng, dùng `idf.py -p COM7 monitor -B 115200`.

Firmware không tự động ghi eFuse, bật Secure Boot hoặc flash encryption.

Hardware verification cần xác nhận: debounce một lần nhấn, mất Wi-Fi rồi gửi
lại cùng `eventId`, reboot khi NVS còn event, queue đầy, TLS certificate và
response `200`/`201`/`401`/`409`.

## Quy tắc ghi nhận kết quả

- `BUILD_PASS`: chỉ được ghi sau khi `idf.py build` thực sự chạy.
- `FLASH_NOT_RUN`: chưa có bằng chứng board đã được flash trong môi trường này.
- `HARDWARE_TEST_PENDING`: chưa xác minh carrier board, LED, button hoặc COM.
