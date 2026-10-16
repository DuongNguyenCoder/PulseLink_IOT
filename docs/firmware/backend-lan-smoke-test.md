# ESP32 → PulseLink API LAN smoke test

Smoke test này xác nhận ESP32-S3 đã:

1. Kết nối Wi-Fi 2,4 GHz.
2. Nhận địa chỉ IP.
3. Kết nối được tới Fastify qua mạng LAN.
4. Nhận HTTP response từ `GET /health/live`.

Đây là test prototype nội bộ qua HTTP. Không dùng flow này để truyền
operational token hoặc bootstrap secret. Provisioning production vẫn phải dùng
HTTPS và certificate validation.

## 1. Chạy backend trên LAN

Trong `server/api/.env` dùng cấu hình local tương ứng:

```env
HOST=0.0.0.0
PORT=3000
```

Không commit `.env`. Khởi động backend theo quy trình hiện tại. Từ máy tính
kiểm tra:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/health/live
Invoke-WebRequest http://192.168.1.171:3000/health/live
```

Nếu Windows Firewall hỏi quyền truy cập mạng, chỉ cho phép đúng profile/network
cần thiết. Không đổi port nếu không cần.

## 2. Cấu hình firmware

Trong ESP-IDF PowerShell:

```powershell
cd D:\project-PulseLink\firmware\esp32
idf.py menuconfig
```

Đặt:

- `PulseLink firmware → Wi-Fi SSID`
- `PulseLink firmware → Wi-Fi password`
- `PulseLink firmware → Backend health URL`

Ví dụ local:

```text
http://192.168.1.171:3000/health/live
```

Địa chỉ phải là IP LAN của máy chạy backend, không phải `127.0.0.1` và không
phải IP Docker-only. URL được lưu trong `sdkconfig` local, không đưa vào
`sdkconfig.defaults` hoặc source.

## 3. Build, flash, monitor

```powershell
idf.py build
idf.py -p COM7 flash
idf.py -p COM7 monitor -B 115200
```

Thay `COM7` bằng COM port thực tế.

Log thành công cần có:

```text
wifi got ip ...
http smoke start url=http://192.168.1.171:3000/health/live
http smoke status=200 ... body={"status":"ok",...}
```

Firmware chỉ đọc tối đa 512 bytes response body, timeout request là 5 giây và
không retry HTTP vô hạn. Khi nhận IP mới sau reconnect, smoke test được kích
hoạt lại một lần.

## 4. Phân loại lỗi

- Có `wifi got ip` nhưng không có `http smoke start`: URL chưa cấu hình.
- `http smoke request failed`: kiểm tra IP máy tính, port, firewall và cùng
  subnet Wi-Fi/LAN.
- Có status `404`: URL/path sai; dùng `/health/live`.
- Có status `500`/`503`: backend đã nhận request nhưng dependency/application
  có lỗi; xem log backend.
- Không có `wifi got ip`: xử lý Wi-Fi trước, chưa điều tra backend.
- Máy tính gọi được bằng `127.0.0.1` nhưng ESP32 không gọi được: backend đang
  bind loopback, firewall chặn, hoặc URL dùng sai địa chỉ.

Smoke test này không xác nhận TLS, authentication, Device ownership,
PostgreSQL, FCM hoặc event ingestion.
