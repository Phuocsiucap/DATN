# Lên lịch đăng có ngữ cảnh

`common/planning/publishing_schedule.py` được dùng chung cho duyệt và lên lịch,
đưa video đã duyệt vào queue, và auto queue sau khi render. Không tự sửa lịch các
bài cũ khi triển khai thay đổi này.

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
Worker render giữ video trong queue chờ duyệt với `scheduled_at = null`, không đánh
dấu render thất bại. Lịch thủ công vẫn là lựa chọn chủ động của người dùng và không
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
