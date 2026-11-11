# PROJECT CONTEXT — BUILD THIẾT BỊ IoT

> **Tài liệu bắt buộc đọc trước khi thực hiện mọi công việc tiếp theo trong repository.**
>
> Mục đích: giữ thống nhất kiến trúc, nghiệp vụ, quyết định kỹ thuật và thứ tự triển khai giữa người phát triển và coding agent. Đây là tài liệu định hướng dự án, không thay thế việc kiểm tra source code, schema, migration, tests và cấu hình thực tế.

- **Ngôn ngữ dự án/tài liệu:** Tiếng Việt.
- **Mục tiêu hiện tại:** Hoàn thiện MVP IoT đủ an toàn, ổn định và dễ vận hành thực tế; ưu tiên hoàn thành các luồng cốt lõi, tránh over-engineering.
- **Ứng dụng production dự kiến:** React Native.
- **Device identity:** Tiếp tục dùng MAC-derived ID hiện tại làm `Device.id`, chỉ chuẩn hóa và gia cố tính toàn vẹn/nhất quán; không chuyển sang một hệ định danh phức tạp hơn ở giai đoạn MVP.

---

## 1. Quy tắc bắt buộc dành cho coding agent

Mỗi lần bắt đầu một task mới, agent phải:

1. Đọc toàn bộ file này trước khi phân tích hoặc sửa code.
2. Đọc các tài liệu kỹ thuật liên quan và kiểm tra source code hiện tại; **không coi mô tả trong tài liệu này là bằng chứng rằng code vẫn đúng như mô tả**.
3. Xác định rõ task đang nằm ở giai đoạn nào trong lộ trình tại mục 8.
4. Trước khi sửa, rà soát tác động đến database, API contract, firmware, mobile app, authentication/authorization, notification và dữ liệu production hiện hữu.
5. Ưu tiên thay đổi nhỏ, có thể kiểm thử, tương thích ngược. Không tự ý rewrite, đổi công nghệ, đổi identity strategy hoặc thêm kiến trúc mới nếu không được yêu cầu.
6. Không xóa bảng/model/field/code legacy chỉ vì không còn được dùng ở luồng chính. Phải chứng minh đã rà soát toàn bộ read/write path, job/worker, API, migration, test, firmware/client cũ và dữ liệu production; có kế hoạch backup/migration/rollback.
7. Không đánh dấu hoàn thành chỉ vì unit tests pass. Phải nêu rõ tests đã chạy, tests chưa chạy, phạm vi chưa xác minh và rủi ro còn lại.
8. Không đưa secret, token, mật khẩu Wi-Fi, private key hoặc credential vào log, response lỗi, tài liệu hoặc repository.
9. Khi phát hiện khác biệt giữa tài liệu và source code, ưu tiên hiện trạng source/schema đã xác minh; báo cáo sai khác và đề xuất cập nhật tài liệu. Không tự suy đoán.
10. Sau mỗi task, cập nhật tài liệu này nếu có quyết định kiến trúc/nghiệp vụ mới được chấp thuận.

### Definition of Done chung

- Có implementation hoàn chỉnh cho phạm vi task.
- Có migration an toàn nếu schema thay đổi; migration phải có khả năng triển khai có kiểm soát và phương án backup/rollback phù hợp.
- Có test cho happy path, validation, authorization, lỗi, retry/idempotency và các trường hợp biên liên quan.
- Không làm hỏng luồng đã hoạt động: signup/signin, tạo store, claim/link device, provisioning Wi-Fi, device event, notification.
- Typecheck/lint/test/build phù hợp với project đều được chạy và báo cáo kết quả trung thực.
- Có hướng dẫn cấu hình/vận hành nếu task tạo thêm biến môi trường, secret, cron, worker hoặc dịch vụ phụ thuộc.

---

## 2. Định hướng sản phẩm

Xây dựng một nền tảng IoT mở rộng lâu dài, trước mắt phục vụ mô hình quán cà phê/nhà hàng và các thiết bị gọi nhân viên/nút nhấn. Về sau có thể mở rộng sang nhiều loại thiết bị, nhiều cửa hàng và nhiều mô hình kinh doanh.

Nguyên tắc sản phẩm:

- Một tài khoản có thể tham gia nhiều Store.
- Một Store có thể có nhiều Account thành viên.
- Device được liên kết/claim vào Store và phát sinh event cho Store đó.
- Notification được phân phối đến Account có quyền hợp lệ trong Store, không phụ thuộc vào Staff legacy.
- MVP phải đủ an toàn, dễ maintain, có khả năng mở rộng hợp lý nhưng không triển khai trước những nhu cầu chưa cần thiết.

Tên thương hiệu từng được đề xuất là **Kết Nối / Kết Nối IoT**; đây mới là đề xuất định danh thương hiệu, không phải ràng buộc kỹ thuật nếu repository hiện tại dùng tên khác.

---

## 3. Luồng nghiệp vụ chuẩn (end-to-end)

Luồng onboarding và liên kết thiết bị đã được xác định như sau:

1. Người dùng cài ứng dụng.
2. Người dùng `signUp` tạo Account.
3. Người dùng `signIn`.
4. Người dùng tạo Store (hoặc tham gia Store theo lời mời trong giai đoạn hoàn thiện).
5. Người dùng liên kết/claim Device vào Store.
6. Người dùng đưa Device vào chế độ commissioning bằng thao tác phần cứng.
7. Ứng dụng cấu hình Wi-Fi cho Device.
8. Device kết nối Wi-Fi và backend; Device thuộc Store đã claim.
9. Account thực hiện tạo Store/claim Device là Owner/Admin của Store theo quyền đã được cấp.
10. Khi Device phát sinh event, backend lưu event và tạo notification; các Account đang có membership hợp lệ trong Store nhận thông báo theo chính sách notification.

### Luồng phần cứng đã được người dùng kiểm thử

- GPIO5: kích hoạt/chuyển sang chế độ commissioning.
- Device phát Wi-Fi SoftAP để nhận cấu hình Wi-Fi.
- Ứng dụng gửi thông tin Wi-Fi; Device kết nối mạng.
- GPIO4: nút nhấn tạo event.
- Event được gửi về backend và notification được chuyển đến điện thoại.

Người dùng đã báo cáo đã chạy thử luồng tổng thể này thành công. Tuy nhiên, một đợt audit code trước đó không chạy lại hardware E2E/FCM delivery trên thiết bị thật. Hai thông tin này khác phạm vi xác minh; agent không được tuyên bố hardware E2E vừa được kiểm chứng nếu chưa tự chạy lại.

---

## 4. Kiến trúc và thành phần đã được ghi nhận

> Đây là baseline được tổng hợp từ trao đổi và báo cáo audit trước đó. Agent cần xác minh lại tên file, schema và implementation trong repository trước khi thay đổi.

### Backend / dữ liệu

Các entity/model đã được audit ghi nhận:

- `Account`
- `Session`
- `AppInstallation`
- `Store`
- `StoreMembership`
- `Device`
- `DeviceEvent`
- `DeviceNotification`
- `ProvisioningSession`
- `DeviceClaimSession`
- `OperatorGrant`
- `AuditEvent`

`StoreMembership` đã tồn tại với:

- Role: `OWNER`, `STAFF`.
- Status: `ACTIVE`, `SUSPENDED`, `REVOKED`.
- Unique constraint theo `(accountId, storeId)`.
- Có ràng buộc partial unique cho Owner đang active theo báo cáo audit; cần kiểm tra lại migration/database provider thực tế.

Tạo Store hiện tạo membership Owner. Authorization Store đã dựa trên active membership. Các thao tác create/list Device và claim/provisioning được ghi nhận là Owner-only tại thời điểm audit; phải rà soát lại quyền thực tế trước khi thay đổi.

### Firmware / thiết bị

- MCU chính đã thảo luận: `ESP32-S3-WROOM-1 N16R8`.
- Firmware sử dụng ESP-IDF.
- GPIO5 dùng cho commissioning; GPIO4 dùng cho thao tác nút nhấn/event.
- Wi-Fi provisioning qua SoftAP.
- Identity proof được ghi nhận sử dụng ECDSA P-256.
- Credential vận hành được lưu trong NVS.
- Event queue bền vững, HTTPS submission, `eventId` ổn định, retry và phân loại event đã được ghi nhận trong audit.

### Giao tiếp

Luồng hiện tại được ghi nhận là HTTPS + SoftAP provisioning. Không thấy MQTT trong luồng hiện tại ở đợt audit. **Tiếp tục HTTPS cho MVP**; chỉ cân nhắc MQTT khi sản phẩm thực sự cần kết nối hai chiều liên tục, telemetry realtime hoặc điều khiển thiết bị thường xuyên.

### Notification

Luồng account-centric đã được ghi nhận:

`AppInstallation → Account → StoreMembership → DeviceNotification → FCM Worker`

Worker kiểm tra lại eligibility trước khi gửi. Account-centric notification là
kiến trúc chính thức; Staff/StaffPushToken schema đã được retire bằng migration
append-only sau khi runtime legacy bị loại bỏ.

### Mobile

Audit trước đó ghi nhận `apps/mobile/` chưa có production app và `apps/android-fcm-test/` là ứng dụng Android kiểm thử/diagnostic. Vì người dùng đã báo cáo kiểm thử được luồng app, agent phải kiểm tra lại repository và phân biệt rõ app/test harness hiện có với ứng dụng production; không mặc định xóa hoặc phủ nhận phần đã chạy được.

---

## 5. Quyết định kiến trúc đã chốt cho giai đoạn MVP

### 5.1 Account và Store là hai khái niệm riêng

- `Account` đại diện người dùng đăng nhập.
- `Store` đại diện cửa hàng/đơn vị vận hành.
- `StoreMembership` là quan hệ Account tham gia Store và mang role/status.
- Một Account có thể thuộc nhiều Store; một Store có nhiều Account.
- Không dùng `Staff` làm nguồn xác thực, phân quyền hoặc định tuyến notification trong kiến trúc đích.

### 5.2 Membership và Invitation tách biệt

- `StoreMembership`: quan hệ thành viên đã được chấp nhận/kích hoạt.
- `StoreInvitation`: lời mời đang chờ xử lý, có trạng thái và vòng đời riêng.
- Không tạo membership ACTIVE chỉ vì Owner gửi lời mời; chỉ tạo/kích hoạt membership khi lời mời được chấp nhận hợp lệ (trừ khi có nghiệp vụ được chấp thuận khác).

### 5.3 Device identity — giữ MAC-derived ID hiện tại

**Quyết định của người dùng:** tiếp tục dùng MAC-derived ID đang có làm `Device.id`; không chuyển sang backend-generated ID trong phạm vi MVP.

WP Device Identity Hardening xác nhận format canonical hiện tại là
`pl-` + 12 ký tự hex thường, lấy từ sáu byte theo thứ tự của
`esp_read_mac(..., ESP_MAC_WIFI_STA)`. Backend mới chỉ chấp nhận format này cho
Device registration/claim; các Device row legacy không bị rewrite hoặc xóa.

Lý do: mỗi board được người dùng cấu hình ở các thời điểm khác nhau; xác suất hai board tạo ra cùng ID tại cùng thời điểm được đánh giá là rất thấp. Mục tiêu là hoàn thiện tính toàn vẹn và nhất quán của phương án hiện tại, không xây dựng hệ identity quá cao cấp.

Agent cần đảm bảo:

- Một thuật toán tạo ID duy nhất, ổn định và dùng nhất quán ở firmware, claim/provisioning, backend, database, API và mobile.
- Chuẩn hóa định dạng MAC đầu vào (case, dấu phân cách, độ dài, byte order); validation chặt chẽ.
- Xác định rõ MAC nào là nguồn identity (ví dụ base MAC/eFuse MAC hay interface MAC) và không thay đổi tùy ngữ cảnh giữa các lần boot.
- ID phải ổn định qua reboot, đổi Wi-Fi, reset cấu hình mạng và cập nhật firmware.
- Không lấy MAC do client tùy ý gửi làm bằng chứng xác thực. MAC-derived ID là định danh/lookup key; quyền sở hữu thiết bị phải được bảo vệ bằng claim challenge, proof of possession, device credential/secret và authorization như flow hiện có.
- Database có unique constraint trên `Device.id`; xử lý collision/duplicate registration bằng lỗi rõ ràng, không âm thầm ghi đè hoặc claim nhầm thiết bị.
- Kiểm tra tính duy nhất ở tất cả luồng tạo/claim/reclaim và đảm bảo cùng một board không tạo hai Device record.
- Không log thông tin nhạy cảm; MAC/ID có thể xuất hiện trong log kỹ thuật ở mức cần thiết nhưng không được xem là secret.
- Có test vector chung giữa firmware/backend để chứng minh cùng một MAC luôn tạo cùng một ID.
- Nếu phát hiện legacy Device ID khác format, thiết kế compatibility/migration rõ ràng; không đổi ID hàng loạt hoặc phá claim đang hoạt động.

Không yêu cầu trong MVP: identity registry phức tạp, certificate PKI riêng cho từng thiết bị nếu hệ thống hiện tại chưa cần, hoặc thay toàn bộ Device primary key chỉ vì lý do kiến trúc.

### 5.4 Notification account-centric hoàn toàn

- Account + active StoreMembership là nguồn sự thật duy nhất để xác định người nhận notification.
- Không sử dụng `Staff`, `StaffPushToken` hoặc legacy Staff mode trong luồng gửi notification đích.
- Chỉ gửi đến Account hợp lệ có membership ACTIVE trong Store liên quan và AppInstallation/token hợp lệ.
- Worker phải kiểm tra lại quyền trước khi gửi để giảm nguy cơ gửi cho thành viên đã bị revoke/suspend/remove.
- Không gửi chéo Store.
- Có idempotency/deduplication phù hợp để retry job không tạo/gửi trùng ngoài ý muốn.
- Ghi nhận trạng thái gửi/thất bại và lỗi có thể xử lý; không đưa token/secret vào log.
- Xử lý token FCM hết hạn/không hợp lệ theo cơ chế hiện có và đánh dấu/deactivate installation/token phù hợp.
- Mục tiêu MVP: notification đến tất cả Account có membership ACTIVE trong Store theo chính sách mặc định. Preference cá nhân nâng cao có thể để giai đoạn sau nếu chưa cần.

WP Staff/StaffPushToken Retirement đã chuyển runtime notification sang
`Account → StoreMembership ACTIVE → AppInstallation`. `Staff` và
`StaffPushToken` không còn thuộc active Prisma schema/runtime; migration chỉ
loại bỏ legacy column/table, không xóa `DeviceNotification` history.

WP Legacy Staff / StaffPushToken Data Inventory đã kiểm tra static schema và
runtime references. Database live inventory trong workspace bị giới hạn:
PostgreSQL integration bị skip và read-only inventory probe trả về `P2010`.
Migration retirement đã được `prisma migrate deploy` apply thành công, nhưng
Prisma hiển thị Aiven host có tên production-like; cần owner xác nhận target
database classification trước khi coi đây là production-safe.

---

## 6. Mục tiêu triển khai tiếp theo — phạm vi ưu tiên cao nhất

Đây là các mục tiêu phải hoàn tất trước khi đầu tư hoàn chỉnh UI/UX production app.

### Mục tiêu A — Store Invitation (mời Account vào Store)

Xây dựng vòng đời invitation hoàn chỉnh, an toàn và dễ sử dụng.

Phạm vi nghiệp vụ tối thiểu:

1. Owner (hoặc role được cho phép rõ ràng) có thể mời một Account vào Store.
2. Xác định người được mời bằng email đã chuẩn hóa; không tin email chưa xác minh nếu quy trình xác minh email hiện có hỗ trợ.
3. Lời mời có trạng thái tối thiểu: `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED` (tên enum có thể điều chỉnh để phù hợp convention source).
4. Có thời hạn hết hạn cấu hình được; hết hạn phải được kiểm tra ở backend, không chỉ dựa vào UI.
5. Token mời phải đủ ngẫu nhiên, khó đoán; chỉ lưu hash của token nếu phù hợp với kiến trúc hiện tại; không lưu token plaintext lâu dài.
6. Token chỉ được chấp nhận một lần; acceptance phải atomic/transactional để tránh race condition và tạo membership trùng.
7. Người nhận phải đăng nhập đúng Account/email được mời trước khi accept; không cho phép chuyển lời mời sang Account khác chỉ bằng cách biết token.
8. Khi accept hợp lệ, tạo hoặc kích hoạt `StoreMembership` tương ứng; role phải được xác định bởi policy, không cho phép người nhận tự nâng quyền.
9. Owner có thể xem invitation pending, revoke invitation và gửi lại theo policy; không tạo nhiều invitation pending mâu thuẫn cho cùng một Store/Account nếu không có chủ đích.
10. Xử lý trường hợp Account đã là member, invitation đã accept/revoke/expire, email không khớp, token sai, token hết hạn, Store không tồn tại hoặc người gửi không đủ quyền.
11. Có audit event cho các thao tác quan trọng: create, resend, revoke, accept, expire (nếu hệ thống có cơ chế ghi nhận).
12. Có API contract rõ ràng và test đầy đủ.

Các điểm agent phải xác minh/đề xuất trước khi code:

- Gửi invitation bằng email/link hay cơ chế thông báo nội bộ; không giả định đã có email provider.
- Role mặc định cho người được mời: ưu tiên `STAFF` theo model hiện tại, trừ khi nghiệp vụ đã quy định khác. Không cho mời Owner thứ hai bằng luồng staff invitation.
- Quyền mời/revoke: mặc định Owner; chỉ mở cho role khác khi có quyết định rõ.
- Có thể hỗ trợ invite account đã tồn tại và account chưa đăng ký. Nếu chưa có email delivery, vẫn phải thiết kế API/lifecycle không phụ thuộc vào việc gửi email thành công; ghi rõ cách user nhận link trong MVP.

Acceptance criteria:

- Owner mời được Account và thấy invitation pending.
- Account đúng có thể accept một lần và trở thành StoreMembership ACTIVE với role chính xác.
- Account khác không thể accept lời mời.
- Token hết hạn/revoke/đã dùng không thể accept.
- User không có quyền không thể mời/revoke/list invitation của Store.
- Không tạo membership duplicate khi gọi lặp hoặc có request đồng thời.
- Có tests cho toàn bộ trường hợp chính và bảo mật.

### Mục tiêu B — Chuẩn hóa Device Identity theo MAC-derived ID

Không thay strategy; hoàn thiện implementation hiện tại theo mục 5.3.

Cần audit và xử lý:

- Nguồn MAC được lấy trên ESP32-S3 và thuật toán chuyển thành `Device.id`.
- Tất cả điểm tạo/đọc/claim/provision Device dùng đúng một format.
- Không nhầm `Device.id`, hardware identifier, serial number hoặc device credential. Nếu source hiện có field khác nhau, giữ nguyên semantics và chỉ chỉnh khi có migration an toàn.
- Rà soát flow `DeviceClaimSession`/`ProvisioningSession`: session.deviceId phải trỏ đến đúng Device record; không tạo record khác hoặc claim nhầm khi ID format khác.
- Unique constraint, duplicate handling, idempotency, ownership proof.
- Test giữa firmware và backend; test duplicate, reboot, provisioning lại, retry, claim lại và dữ liệu cũ.

Không tự thêm serial number bắt buộc, không tạo backend-generated Device ID thay thế, không thực hiện migration ID diện rộng nếu chưa chứng minh cần thiết.

### Mục tiêu C — Loại bỏ Staff và StaffPushToken triệt để, an toàn (đã triển khai)

**Đích đã đạt ở code/schema:** hệ thống chỉ dùng Account + StoreMembership cho membership/authorization/notification. `Staff` và `StaffPushToken` không còn là một phần của active source/runtime/schema; migration lịch sử vẫn được giữ nguyên.

Đây là thay đổi có rủi ro cao. Không được xóa trực tiếp trước khi audit.

Trình tự bắt buộc:

1. Lập inventory toàn bộ references đến `Staff` và `StaffPushToken`: Prisma/schema, migrations, API/routes/controllers/services, authorization helpers, notification recipient resolution, FCM worker/jobs, cron/background tasks, seed, fixtures, tests, admin scripts, logs/metrics, docs, mobile/test app và firmware nếu có.
2. Xác định dữ liệu legacy hiện có và mapping sang Account/StoreMembership/AppInstallation. Không suy đoán mapping từ tên hoặc email nếu không chắc chắn.
3. Xác định nguồn notification hiện đang chạy ở production: account-centric hay legacy Staff. Báo cáo bằng code/config/runtime evidence.
4. Kiểm tra mọi Staff recipient/token còn hoạt động có thể chuyển sang Account/AppInstallation hay không. Xử lý record orphan/ambiguous bằng báo cáo và quy trình thủ công; không tự gán nhầm người nhận.
5. Nếu còn dữ liệu cần giữ, tạo migration/backfill có kiểm đếm trước/sau, transaction/batch phù hợp và backup. Không drop dữ liệu trước khi đối soát.
6. Chuyển toàn bộ notification path sang Account-centric; loại bỏ legacy mode/default flag và mọi fallback Staff sau khi chứng minh account-centric hoạt động.
7. Chạy test để đảm bảo tất cả recipient được resolve từ Account + StoreMembership ACTIVE + AppInstallation/token hợp lệ.
8. Deploy theo giai đoạn nếu cần: deploy code tương thích, backfill, xác minh, chuyển traffic, theo dõi, sau đó mới drop model/table/field/index liên quan.
9. Xóa `Staff`/`StaffPushToken` khỏi schema và source chỉ khi không còn reference/runtime dependency. Tạo migration drop cuối cùng riêng biệt, có backup và rollback/restore plan.
10. Sau migration, xác minh không còn references trong source (ngoại trừ migration lịch sử/tài liệu giải thích nếu cần), không còn legacy env/config/feature flag và không còn job dùng Staff.

Acceptance criteria:

- Không còn đường code nào resolve notification recipient qua Staff/StaffPushToken.
- Không còn legacy notification mode hoặc fallback.
- Membership/authorization dựa trên StoreMembership.
- Account đang ACTIVE trong Store nhận notification theo policy; Account SUSPENDED/REVOKED hoặc đã rời Store không nhận notification mới.
- Không gửi chéo Store.
- Không mất token/installation hợp lệ khi migration.
- Database migration hoàn tất, dữ liệu được đối soát và ứng dụng chạy bình thường.
- `Staff` và `StaffPushToken` đã được loại bỏ khỏi schema/source/runtime an toàn, không chỉ ẩn khỏi API.

### Mục tiêu D — Notification hoàn toàn dựa trên Account

Sau khi loại bỏ legacy:

- Một nguồn recipient resolver duy nhất dựa trên `Account` + `StoreMembership` + `AppInstallation`.
- Kiểm tra trạng thái Account, membership, Store và installation/token trước khi enqueue và trước khi gửi.
- Thiết kế rõ behavior khi membership bị revoke sau khi job được enqueue nhưng trước khi worker gửi.
- Idempotency cho event và notification; retry có backoff/giới hạn; lỗi permanent không retry vô hạn.
- Notification gắn đúng Store, Device, DeviceEvent và Account recipient theo schema hiện tại.
- Không gửi notification cho Store khác hoặc Account không còn quyền.
- Kiểm thử event ingestion → durable event → notification job → FCM delivery path.
- Có thể để Notification Center/read-unread/preferences nâng cao ở backlog nếu không cần cho MVP đầu tiên; tuy nhiên luồng push notification cốt lõi phải đáng tin cậy.

### Mục tiêu E — Build UI/UX ứng dụng production bằng React Native

Chỉ bắt đầu sau khi A–D hoàn tất và API/domain contract ổn định.

- Công nghệ được chốt: **React Native** cho production mobile app.
- Không tự chuyển Flutter hoặc native Android/iOS nếu không có yêu cầu mới.
- Phân biệt production app với `apps/android-fcm-test` (nếu test harness này còn tồn tại); giữ test harness nếu còn giá trị diagnostic, không để nó trở thành app production mặc định.
- Tái sử dụng API/auth/session/provisioning/notification contract đã hoàn thiện; không nhúng business logic quan trọng chỉ ở client.

Các màn hình MVP dự kiến:

1. Authentication: Sign up, sign in, sign out, session handling.
2. Store: tạo Store, chọn/chuyển Store, thông tin/cài đặt cơ bản.
3. Device: danh sách thiết bị, thêm/liên kết/claim, commissioning và Wi-Fi provisioning, trạng thái cơ bản, chi tiết thiết bị.
4. Events: lịch sử event theo Store/Device ở mức tối thiểu.
5. Notifications: nhận push, điều hướng đến đúng Store/Device/Event; notification list cơ bản nếu API hỗ trợ.
6. Members: danh sách thành viên, mời Account, trạng thái invitation, revoke/resend, accept invitation.
7. Account: thông tin tài khoản và sign out.

Yêu cầu UI/UX:

- Luồng onboarding rõ ràng, dễ hiểu cho người không chuyên kỹ thuật.
- Loading, empty, success, validation error, network error và retry state đầy đủ.
- Trạng thái provisioning Wi-Fi phải hướng dẫn từng bước; không hiển thị credential nhạy cảm sau khi gửi.
- Kiểm soát quyền hiển thị theo membership/role nhưng backend vẫn là nơi enforce authorization.
- Deep link từ push notification đến đúng nội dung; xử lý khi user chưa đăng nhập hoặc không còn quyền.
- Bảo vệ token/session trên thiết bị bằng secure storage phù hợp; không lưu secret nhạy cảm trong plain storage.
- Có build/release configuration riêng cho development, staging, production; không hardcode API URL/secret.
- Có kiểm thử luồng end-to-end trên thiết bị thật trước khi phát hành.

---

## 7. Bảo mật và tiêu chuẩn tối thiểu để vận hành MVP

Các yêu cầu dưới đây là baseline, không phải mục tiêu xây dựng hệ thống enterprise quá mức.

### Authentication và session

- Password hashing dùng thuật toán phù hợp; không lưu plaintext.
- Session/token có expiry, revoke/logout và kiểm tra hợp lệ.
- Rate limit các endpoint nhạy cảm: signup/signin, claim, invitation, provisioning và event ingress tùy threat model.
- Không để lộ thông tin tài khoản/token trong error response hoặc log.

### Authorization

- Mọi API thao tác Store/Device phải kiểm tra active StoreMembership và role phù hợp ở backend.
- Không tin `storeId`, `accountId`, `deviceId`, role hoặc recipient do client gửi nếu chưa kiểm tra quyền.
- Owner-only action phải được enforce server-side.
- Kiểm tra quyền ở từng Store; không để IDOR/cross-store access.

### Device security

- MAC-derived ID không phải credential.
- Claim/provisioning phải yêu cầu challenge/proof/credential hiện có; kiểm tra expiry và one-time semantics.
- Device credential lưu an toàn; không gửi hoặc log plaintext secret.
- HTTPS cho communication với backend.
- Firmware retry/event queue phải chống mất event và duplicate bằng eventId/idempotency.

### Invitation security

- Token khó đoán, một lần, có expiry, revoke.
- Chỉ đúng Account được mời mới accept được.
- Transaction/locking phù hợp để chống race condition.
- Rate limit và audit các thao tác invitation.

### Notification security/reliability

- Recipient resolver dựa trên Account + StoreMembership ACTIVE + AppInstallation.
- Worker kiểm tra lại quyền trước send.
- Token FCM không xuất hiện trong log.
- Có dedupe/retry/backoff và xử lý invalid token.

### Vận hành và dữ liệu

- Có backup database và quy trình restore đã kiểm tra.
- Migration production có kế hoạch, kiểm tra trước/sau và rollback/restore strategy.
- Có logging/monitoring đủ để phát hiện lỗi event ingestion, queue, worker, FCM, provisioning và database.
- Không ghi log password, Wi-Fi password, device secret, invitation token hoặc access token.
- Có môi trường/config tách biệt; secret quản lý qua environment/secret manager phù hợp.

---

## 8. Lộ trình triển khai ưu tiên

Không đảo thứ tự nếu chưa có lý do kỹ thuật/nghiệp vụ rõ ràng.

| Thứ tự | Work package | Kết quả cần đạt |
|---|---|---|
| WP1 | Audit source/schema/runtime hiện tại | Xác nhận trạng thái thật, inventory references và gap so với tài liệu |
| WP2 | Store Invitation | Lifecycle/API/security/tests hoàn chỉnh |
| WP3 | Device Identity hardening | MAC-derived Device.id thống nhất, stable, unique, validated, backward-compatible |
| WP4 | Staff/StaffPushToken retirement | Migration/backfill/đối soát và xóa legacy an toàn |
| WP5 | Account-centric notification | Không còn Staff mode; recipient, worker, retry, idempotency và tests chuẩn |
| WP6 | Integration/E2E & release readiness backend/firmware | Kiểm chứng signup → store → claim → Wi-Fi → event → push và invitation/membership |
| WP7 | React Native production app UI/UX | Hoàn thiện các màn hình MVP và luồng production |
| WP8 | Production readiness & vận hành thực tế | Build/release, monitoring, backup/restore, runbook, pilot và xử lý lỗi thực tế |

### Gate trước khi chuyển sang React Native production UI

Chỉ chuyển sang WP7 khi:

- Invitation lifecycle đã hoàn chỉnh và test.
- Device identity đã thống nhất và có test vector.
- Staff/StaffPushToken đã được loại bỏ an toàn hoặc có bằng chứng cụ thể rằng phần còn lại chỉ là migration lịch sử không chạy runtime.
- Notification account-centric hoạt động end-to-end.
- API contract ổn định, có tài liệu cho app.
- Không còn lỗi P0/P1 liên quan đến authorization, data integrity, device claim hoặc notification.

---

## 9. Backlog — ghi nhận nhưng chưa làm trước MVP vận hành

Các nội dung sau cần được lưu lại để phát triển sau khi MVP đã vận hành thực tế, trừ khi phát hiện chúng là điều kiện bắt buộc cho an toàn/vận hành:

- Notification Center đầy đủ, read/unread, filter, archive và notification preferences chi tiết.
- MQTT hoặc realtime bidirectional messaging.
- OTA firmware update và firmware release management.
- Device Groups, automation/rules engine và scheduling.
- Quản lý kho/nhà máy thiết bị, factory provisioning và serial inventory nâng cao.
- Custom RBAC/permission builder; trước mắt dùng OWNER/STAFF và kiểm tra quyền rõ ràng.
- Nhiều tầng tổ chức/enterprise hierarchy.
- Analytics/dashboard nâng cao, export dữ liệu và báo cáo.
- Billing/subscription/payment.
- Heartbeat/telemetry nâng cao; cân nhắc theo loại thiết bị và mức tiêu thụ điện.
- Multi-region, high availability và scaling enterprise nếu tải thực tế yêu cầu.
- MFA/SSO và các tính năng enterprise khác khi có nhu cầu.

Không tự triển khai backlog này trong task MVP nếu người dùng chưa yêu cầu. Nếu một mục trở thành điều kiện cần thiết để bảo đảm an toàn hoặc vận hành, agent phải nêu lý do và xin xác nhận trước khi mở rộng phạm vi (trừ việc sửa lỗi bảo mật nghiêm trọng cần xử lý ngay).

---

## 10. Baseline audit trước đây — cần xác minh lại

Báo cáo audit trước đó ghi nhận:

- Baseline cũ có thêm các entity Staff/StaffPushToken; chúng đã được loại bỏ khỏi active Prisma schema bằng migration retirement.
- StoreMembership đã có OWNER/STAFF và ACTIVE/SUSPENDED/REVOKED.
- StoreInvitation chưa được triển khai tại thời điểm audit.
- Identity chưa nhất quán: backend registration có nơi dùng CUID cho `Device.id`, firmware dùng MAC-derived `deviceId` dạng `pl-...`, và claim path có nơi dùng session.deviceId làm Device.id. **Quyết định mới của người dùng trong tài liệu này là giữ MAC-derived ID làm Device.id và sửa toàn bộ luồng cho nhất quán.** Phải xác minh hiện trạng và thiết kế compatibility trước khi thay đổi.
- Account-centric notification path hiện là runtime duy nhất; nhận định legacy path là default chỉ là trạng thái lịch sử của audit trước.
- `apps/mobile/` được ghi nhận chưa tồn tại; `apps/android-fcm-test/` là app test/diagnostic. Phải kiểm tra lại.
- Test tại thời điểm audit: 146 tests passed, 35 test files, 45 skipped; typecheck và Prisma validate pass. Build, DB migration, physical hardware E2E và actual FCM delivery chưa được audit rerun.

Các con số trên là kết quả của lần audit trước, không phải trạng thái test hiện tại. Mỗi agent phải chạy lại các lệnh kiểm tra thích hợp và báo cáo kết quả mới.


---

## 13. PulseLink Architecture Overview — agreed architecture baseline

This section records the architecture overview explicitly supplied and approved by the project owner. It complements the detailed decisions and roadmap above. Historical implementation-status statements must be reconciled with the status notes below and verified against the current repository.

### Product

PulseLink is a service-call button system for cafes/restaurants. A physical ESP32 button produces an event; the backend stores it and sends best-effort push notifications to eligible Owner app installations.

### Current agreed stack

- **Firmware:** ESP32-S3-WROOM-1 N16R8, C/C++ with ESP-IDF, GPIO button, LED, Wi-Fi and NVS. WP08 adds a bounded persistent event retry queue. Queue-full and NVS failure cases remain explicit limitations; delivery is not guaranteed in those cases.
- **App:** the repository contains an Android Owner diagnostic harness for WP6 integration testing; the production React Native Owner app remains a later WP7 deliverable.
- **API:** Node.js ESM, TypeScript, Fastify 5, Zod and Fastify's Pino logger.
- **Database:** PostgreSQL, Prisma 7.10, `@prisma/adapter-pg` and `pg`.
- **Notifications:** Firebase Cloud Messaging (FCM).
- **Contracts:** Document HTTP payloads now; extract a shared, versioned contracts package when mobile/firmware integration stabilizes.
- **Local infrastructure:** Docker Compose. PostgreSQL host port may be `5433` if host port `5432` is unavailable.

### High-level flow

1. An authenticated Owner account may enter onboarding; only an authorized Owner scope may complete a device claim.
2. The ESP32 enters physical-button-gated SoftAP pairing and exchanges a one-time bootstrap secret.
3. After claim, the device authenticates to the API with its separate operational bearer token.
4. When Wi-Fi and HTTPS are available, the device submits a button event with stable `eventId` and UTC `occurredAt`.
5. API validates the request, authenticates the device, and stores the event idempotently in PostgreSQL.
6. Backend selects active app installations with valid FCM tokens for eligible Owner accounts in the device's Store and sends best-effort notifications through FCM.

### Repository boundaries

- `firmware/esp32/`: hardware and embedded behavior.
- `server/api/`: HTTP API, domain services, persistence and notification integration.
- `apps/mobile/`: reserved for the future React Native production Owner app; WP6 uses `apps/android-fcm-test/owner/` as a diagnostic harness.
- `packages/contracts/`: shared, versioned contracts (future).
- `infrastructure/docker/`: local service configuration.
- `docs/`: architecture, standards, ADRs, runbooks and feature specifications.

These are intended boundaries, not proof that every path currently exists. Confirm actual repository layout before creating or moving files.

### MVP non-goals

Do not add a distributed broker, Kubernetes, microservices, Redis or a multi-tenant authorization framework before a measured need exists. A PostgreSQL-backed durable event and notification record is the starting point.

### Reliability invariants

- Firmware generates an event ID once and reuses it for retries, including after reboot while its NVS queue record remains.
- Database uniqueness is the source of truth for event idempotency.
- An event is acknowledged only after durable storage succeeds.
- The bounded firmware queue preserves up to eight offline events; delivery is not guaranteed when the queue is full or storage fails.
- Notifications can be retried; duplicate sends must be considered possible.
- FCM registration tokens identify push destinations, not staff identity or authorization.
- One Owner account may have multiple app installations; each installation has its own session and FCM token lifecycle.
- Account/session, Store authorization and AppInstallation token-management runtime slices were reported as implemented and test-backed in the architecture snapshot.
- Device credentials, app-user credentials and bootstrap pairing secrets are separate trust artifacts.
- A user may have memberships in multiple Stores; the backend derives active Store scope from authorized membership rather than trusting client-supplied role or Store data.
- Owners manage device claim and transfer.
- MVP does not introduce a separate Staff login/account model. `StoreMembership` role `STAFF` may still represent an invited Account's membership; it is not the legacy `Staff` entity.
- Secrets are never stored in plaintext when a hash or secret manager is appropriate.
- Store timezone is for presentation/scheduling; event timestamps are UTC.

### Status reconciliation — do not misreport implementation state

The supplied overview also said: “provisioning, event ingestion and FCM delivery remain future phases.” This is a historical status statement that conflicts with the project owner's earlier report of a successful physical-device flow (GPIO5 commissioning → SoftAP/Wi-Fi configuration → GPIO4 event → backend event/phone notification), and with the earlier audit's narrower statement that hardware E2E and actual FCM delivery were not rerun during that audit.

Agents must distinguish:

1. **Implementation exists:** verified by inspecting current source and runtime configuration.
2. **Automated tests pass:** verified by running relevant tests and reporting exact results.
3. **Owner-reported hardware E2E:** the owner previously reported a successful physical-device flow; this is historical user-reported evidence, not a test run by the current agent.
4. **Current hardware/FCM E2E independently verified:** claim this only after executing and recording the test in the current task/session.

Do not repeat the “future phases” statement as current status without checking source. Do not claim production readiness solely from the earlier user-reported test. Audit and report gaps when status is unclear.

### Identity and authorization clarifications

- `Device.id` remains the existing MAC-derived ID strategy for MVP, as decided by the project owner. The identifier is not a credential.
- Device authentication uses a separate operational credential/proof; claim uses its own bootstrap/challenge flow. Do not merge these trust artifacts.
- Store scope and Owner authority are derived and enforced server-side through authenticated Account + active StoreMembership. Never trust client-supplied Store ID or role without authorization checks.
- The overview's Owner-focused notification wording describes the initial/Owner-facing product flow. The approved target is Account-centric routing to eligible active StoreMembership accounts and their AppInstallations, without Staff/StaffPushToken legacy mode. Do not silently restrict recipients to OWNER only if the approved notification policy includes eligible `STAFF`-role memberships.
- `StoreMembership` role `STAFF` is an Account membership role and remains valid after legacy schema retirement.

### Approved implementation order

The roadmap in section 8 remains authoritative:
1. Audit current source/schema/runtime.
2. Complete Store Invitation.
3. Harden and unify MAC-derived Device identity.
4. Safely retire legacy `Staff` and `StaffPushToken`.
5. Complete Account-centric notifications with no legacy Staff mode.
6. Run integration/E2E and backend/firmware release checks; hand physical-device and real-FCM gates to the project owner.
7. Build the React Native production Owner app.
8. Prepare pilot/production operation.

This architecture overview does not reorder or cancel those priorities.

---

## 11. Cách agent phải báo cáo sau mỗi work package

Báo cáo ngắn gọn theo cấu trúc:

1. **Phạm vi:** đã làm gì, không làm gì.
2. **Hiện trạng trước thay đổi:** source/schema/API liên quan.
3. **Thay đổi:** file/model/API/migration/worker/firmware/mobile được tác động.
4. **Data safety:** dữ liệu cũ được giữ/chuyển/xóa thế nào; backup/rollback.
5. **Security:** authorization, validation, token/secret, rate limit, cross-store isolation.
6. **Tests:** lệnh đã chạy và kết quả; skipped/unverified phải liệt kê.
7. **Manual/E2E:** thao tác cần kiểm thử trên thiết bị/app thật.
8. **Rủi ro còn lại:** chỉ nêu vấn đề có căn cứ.
9. **Bước tiếp theo:** work package kế tiếp theo roadmap.
10. **Tài liệu:** cập nhật file này khi quyết định hoặc trạng thái nền tảng thay đổi.

---

## 12. Chỉ thị cuối cùng về phạm vi và ưu tiên

Mục tiêu là **nhanh chóng hoàn thiện một MVP hoàn chỉnh nhất có thể để đưa vào vận hành thực tế**, nhưng vẫn bảo đảm các tiêu chuẩn cơ bản về bảo mật, toàn vẹn dữ liệu, phân quyền, độ tin cậy và khả năng bảo trì.

Ưu tiên tuyệt đối:

1. Store Invitation.
2. Device identity MAC-derived ID nhất quán và an toàn.
3. Loại bỏ Staff/StaffPushToken triệt để, có migration an toàn.
4. Notification chỉ dựa trên Account + StoreMembership + AppInstallation; không còn legacy Staff mode.
5. Kiểm thử tích hợp end-to-end.
6. Xây dựng production mobile app bằng React Native.
7. Đưa sản phẩm vào pilot/vận hành thực tế, theo dõi và sửa lỗi thực tế.

Không ưu tiên làm đẹp kiến trúc hoặc bổ sung tính năng lớn trước khi hoàn tất các mục tiêu trên. Sau khi sản phẩm vận hành ổn định, mới quay lại backlog để tối ưu và mở rộng theo nhu cầu thực tế.

**Mọi thay đổi kỹ thuật phải phục vụ luồng sản phẩm này, giữ tương thích và bảo vệ dữ liệu đang có.**
