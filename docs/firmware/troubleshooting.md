# Firmware troubleshooting

## Không thấy COM port

- Kiểm tra cáp USB có truyền dữ liệu.
- Thử cổng USB khác và kiểm tra Device Manager.
- Cài đúng driver cho USB-UART hoặc USB Serial/JTAG của carrier board.
- Xác nhận không có terminal khác đang giữ COM.

## Flash thất bại hoặc không vào bootloader

- Đóng serial monitor trước khi flash.
- Giữ BOOT, nhấn RESET, thả BOOT theo hướng dẫn của carrier board.
- Dùng đúng `COMx` và baud mặc định của ESP-IDF.
- Không tự đoán nút/GPIO; cần schematic board.

## Không kết nối Wi-Fi

- Đảm bảo access point phát 2,4 GHz; firmware smoke test không dùng 5 GHz.
- Kiểm tra SSID/password trong `idf.py menuconfig`.
- Không đọc password từ log; cấu hình lại local nếu nghi ngờ sai.
- Kiểm tra RSSI và khoảng cách tới access point.

## NVS hoặc boot lỗi

- Firmware không tự erase NVS để tránh mất dữ liệu.
- Ghi nhận log lỗi và chỉ thực hiện quy trình erase được phê duyệt riêng.

## Backend/certificate

Wi-Fi smoke test không cần backend. Lỗi certificate hoặc API chỉ được điều tra
sau khi board đã có IP; không hạ HTTPS xuống HTTP để làm test pass.

## GPIO4 chỉ hoạt động khi mở monitor

Firmware hiện đọc GPIO4 bằng `button_task` polling mỗi 10 ms; không có GPIO ISR
cho nút Event. `gpio_interrupt_count=0` trong diagnostic summary vì vậy là
đúng theo thiết kế hiện tại, không phải bằng chứng ISR bị lỗi.

Firmware ghi một summary thưa khoảng 30 giây với các mốc:

```text
gpio_presses queue_push queue_drop queue_pop worker_process network_ready
send_attempt send_success send_fail last_error last_http_status
sender_stack_min_words button_stack_min_words
```

Diễn giải nhanh:

- `gpio_presses=0`: polling task không thấy một lần nhấn hợp lệ, hoặc task/GPIO
  wiring/configuration chưa hoạt động.
- `queue_push` tăng nhưng `worker_process=0`: event đã bền vững trong NVS nhưng
  sender đang chờ Wi-Fi hoặc `COMMISSIONING_ONLINE`.
- `network_ready` tăng nhưng sender vẫn dừng: cần kiểm tra backend status probe,
  operational credential và commissioning state; có IP không đồng nghĩa đã
  authenticated.
- `send_attempt` tăng và `last_http_status=0`: lỗi transport/DNS/TLS/timeout.
- `button task could not be started` hoặc stack watermark rất thấp: kiểm tra
  heap/task stack trước khi điều tra GPIO.

Mở serial monitor trên một số carrier board có thể gây reset thông qua DTR/RTS.
Vì vậy phải ghi nhận boot log và diagnostic summary sau một chu kỳ cấp nguồn
độc lập; không coi việc monitor đang mở là điều kiện vận hành của thiết bị.

## Board chưa xác định

Nếu chưa có schematic/carrier-board model, không gán GPIO LED/button. Giữ
`PULSELINK_BUTTON_GPIO=-1` và `PULSELINK_STATUS_LED_GPIO=-1`.
