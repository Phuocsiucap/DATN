# Lên lịch đăng có ngữ cảnh

`common/planning/publishing_schedule.py` được dùng chung cho duyệt và lên lịch,
đưa video đã duyệt vào queue, và auto queue sau khi render. Không tự sửa lịch các
bài cũ khi triển khai thay đổi này.

## Công tắc tự động đăng

Trang tạo video có bốn cột sản xuất: Draft kịch bản, Biên tập & Voice, Render MP4,
Video hoàn tất. Các bước duyệt video thành phẩm và chọn lịch nằm ở Approvals.
Video lỗi/trạng thái lạ được hiển thị trong khu vực Cần xử lý, không bị mất khỏi UI.

- **Duyệt** gọi `POST /social-profiles/queue/items/{id}/approve`: duyệt video,
  đồng bộ workflow, đặt `scheduled_at = null` kể cả bài cũ đã có giờ tự gán.
  Không gọi AI chọn lịch, không upload TikTok, không phụ thuộc `auto_queue_enabled`.
- **Duyệt & lên lịch / Lên lịch đăng** mở bước chọn lịch, mặc định thủ công.
  Người dùng nhập giờ tương lai và xác nhận; frontend gửi timestamp UTC cùng múi
  giờ thiết bị. API giữ đúng thời điểm này, không gọi AI hoặc fallback sang giờ khác.
- **AI chọn giờ** là lựa chọn chủ động, cần xác nhận riêng trước khi gọi planner.
  API `approve-schedule` mặc định `schedule_mode=manual`; thiếu giờ trả lỗi.
- Khi mở Approvals, video đã duyệt được giữ `approved`, không phải duyệt lần hai.
  Việc đưa video hoàn tất vào danh sách duyệt không tự gán lịch đăng.
- Bài đang upload hoặc đã kết thúc không thể duyệt/lên lịch lại.

Approvals chỉ có ba tab, phân loại theo trạng thái **và** `scheduled_at`:

| Tab | Điều kiện / thao tác |
| --- | --- |
| Chờ duyệt | `needs_approval`; Duyệt riêng hoặc Duyệt & lên lịch |
| Đã duyệt | `approved` / `queued`, chưa có giờ; nút Lên lịch ngay trên từng bài |
| Cần xử lý | Từ chối, cần chỉnh sửa, đăng thất bại |

Bài `approved` / `queued` đã có giờ và bài đang `publishing` được quản lý ở trang
Lịch đăng; `published` ở trang Bài đã đăng. Không tạo hai tab trùng chức năng trong
Approvals, cũng không gom các bài này vào tab Tất cả. Sau khi lên lịch thành công,
bài tự rời danh sách Approvals; nút Xem lịch đăng mở trang quản lý lịch.

Strategy vẫn giữ các bước độc lập: duyệt thủ công → Chờ duyệt; tự duyệt nhưng
`auto_queue_enabled=false` → Đã duyệt, không gọi planner; tự duyệt và bật tự lên
lịch → chọn giờ, chuyển sang trang Lịch đăng. Nút Duyệt thủ công ở Approvals luôn chỉ
duyệt, không tự đặt lịch dù strategy bật tự động. Lên lịch cho bài đã tự duyệt giữ
nguyên thông tin người/chế độ/thời điểm duyệt ban đầu. Chi tiết bài hiển thị cấu
hình strategy hiện tại, không suy diễn nguồn duyệt từ cấu hình đó.

Profile chỉ dùng `auto_publish_enabled` (mặc định `false`), tương ứng công tắc
**Tự động đăng theo lịch**. Khi tắt, lịch vẫn được lưu/đề xuất và người dùng vẫn có
thể đăng thủ công; scheduler không tự gửi bài mới lên TikTok. Điều kiện duyệt bài,
profile active, token và quyền TikTok vẫn được kiểm tra như trước. Việc theo dõi
trạng thái bài đã gửi lên TikTok vẫn tiếp tục khi tắt công tắc.

`schedule_enabled` của profile đã bị bỏ khỏi model và API; request cũ chứa trường
này trả lỗi validation, yêu cầu tải lại frontend và dùng `auto_publish_enabled`.
`source.configuration.schedule_enabled` của lịch crawl không thay đổi.

Khi triển khai, dừng API/worker cũ, chạy `alembic upgrade head` từ backend root,
rồi khởi động API và worker với code mới. Migration `e64f0a7c2b93` gộp dữ liệu bằng
`auto_publish_enabled = auto_publish_enabled AND schedule_enabled` trước khi bỏ
cột cũ, nên không tự bật đăng cho profile đang tắt một trong hai công tắc. Ngày,
giờ, múi giờ và lịch bài đã lưu không thay đổi. Downgrade tạo lại cờ lịch bằng
`true`, giữ nguyên trạng thái tự đăng đã gộp; không khôi phục hai giá trị cũ riêng lẻ.

## Thời gian và hàng đợi

- Lấy giờ UTC thực tế trên máy chủ tại thời điểm xử lý; đổi sang
  `strategy.schedule_timezone` để tính ngày trong tuần và ngày đăng. Máy chủ cần
  được đồng bộ đồng hồ. Khi request không truyền timezone, dùng timezone tài khoản;
  chỉ fallback `Asia/Bangkok` nếu không có hoặc cấu hình không hợp lệ.
- Sắp xếp, loại trùng và kiểm tra `schedule_times`; tuân thủ `schedule_days` và
  `post_frequency_per_day`. Lưu `scheduled_at` dạng UTC có offset.
- Xét toàn bộ reservation của cùng profile: `needs_approval`, `queued`, `approved`,
  `publishing`; tính cả bài đã đăng trong ngày theo `published_at`. Không tính bài
  `skipped`, `failed`, `changes_requested`. Bài chờ duyệt chưa có giờ không giữ chỗ.
- Các bài executable đã quá giờ được tính vào sức chứa hôm nay vì worker có thể
  xử lý chúng ở lượt kế tiếp. Bài đang chọn lại lịch được loại khỏi tập giữ chỗ.
- Chỉ đề xuất giờ cách hiện tại hơn 5 phút, cách bài khác ít nhất 30 phút. Tìm tối
  đa 90 ngày và đưa tối đa 20 lựa chọn hợp lệ cho AI. Nếu chưa có giờ cấu hình,
  fallback các mốc giờ tròn sau ít nhất một giờ, vẫn xét ngày đăng và sức chứa.
- Khóa row profile trong transaction chọn lịch và lưu queue để các bộ chọn lịch
  tự động không cùng lấy một chỗ trống. Refresh các queue row sau khi đợi khóa.
- Luồng đồng bộ video chờ duyệt không gán giờ giả định `now + 2h` nữa.

## DeepSeek

Chỉ gọi DeepSeek (`deepseek-v4-flash`) qua cấu hình hiện có:
`ACD_DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY` và
`ACD_DEEPSEEK_BASE_URL` / `DEEPSEEK_BASE_URL`. Không chuyển sang OpenAI.

Prompt bao gồm giờ UTC/local, timezone, ngày trong tuần, chiến lược, tiêu đề/caption
bài hiện tại, các bài đã trong queue (ID, tiêu đề, trạng thái, giờ đăng), số bài theo
ngày và tập giờ còn trống. Phần chi tiết queue giới hạn 100 bài và đánh dấu nếu bị
cắt; việc kiểm tra trùng lịch và giới hạn bài/ngày luôn dùng đầy đủ dữ liệu.

DeepSeek chỉ trả `slot_id` trong danh sách đã kiểm tra. Timeout API là 20 giây;
frontend dành 60 giây cho các request có thể chọn lịch. Thiếu key, lỗi API, JSON sai
hoặc ID ngoài danh sách đều fallback theo quy tắc, không nhận giờ AI tự bịa.
Kiểm tra lại đồng hồ sau khi nhận kết quả. `ai_reason` lưu cách chọn, giờ kiểm tra,
múi giờ, lịch chọn và số bài đã xét; lượt gọi thành công được ghi vào `PromptRun`.

Nếu không còn chỗ trong 90 ngày, API trả lỗi rõ ràng thay vì chọn ngoài chiến lược.
Worker render giữ video ở trạng thái đã duyệt với `scheduled_at = null`, không bắt
duyệt lại hoặc đánh dấu render thất bại. Lịch thủ công là lựa chọn chủ động và không
gọi AI. Các lịch đã lưu vẫn được giữ khi đưa lại cùng video vào queue; chỉ lịch đã
quá hạn/chưa có mới được chọn lại tự động.

## Kiểm thử

Từ workspace root, với Python trong `.venv` và `PYTHONPATH` gồm backend root:

```powershell
$env:PYTHONPATH='D:\DATN\socialcontent_backend'
& .venv/Scripts/python.exe -m unittest discover -s socialcontent_backend/tests
$env:PYTHONPATH='D:\DATN\socialcontent_backend;D:\DATN\socialcontent_backend\services\api-service'
& .venv/Scripts/python.exe -m unittest discover -s socialcontent_backend/services/api-service/tests
$env:PYTHONPATH='D:\DATN\socialcontent_backend;D:\DATN\socialcontent_backend\services\ai-media-engine'
& .venv/Scripts/python.exe -m unittest discover -s socialcontent_backend/services/ai-media-engine/tests
```

Các bài test mock DeepSeek và DB, không gọi API trả phí, không ghi dữ liệu thật.
