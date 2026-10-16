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

## Board chưa xác định

Nếu chưa có schematic/carrier-board model, không gán GPIO LED/button. Giữ
`PULSELINK_BUTTON_GPIO=-1` và `PULSELINK_STATUS_LED_GPIO=-1`.
