# USB commissioning prototype

USB commissioning CLI và serial wire protocol chưa được triển khai trong
repository. J.4.0/J.4.1 chỉ cung cấp firmware skeleton và Wi-Fi smoke test.

Luồng dự kiến cho J.4.5:

1. CLI liệt kê COM port và mở serial với timeout.
2. CLI đọc Device identity và public P-256 key; không đọc private key.
3. CLI gọi enrollment endpoint J.3 qua HTTPS bằng commissioning authorizer
   được inject/configure an toàn.
4. Owner app tạo provisioning session.
5. ESP32 nhận session/challenge/bootstrap data qua commissioning transport.

Không dùng localhost, biết Device ID hoặc kết nối USB làm authorization. Không
đưa operator credential thật vào CLI hoặc repository. Vì backend hiện chưa có
production operator credential provider, CLI không được giả lập enrollment
thành công.
