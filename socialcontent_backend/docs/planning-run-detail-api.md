# Planning run detail — compact response v3

`GET /api/v1/planning-runs/{id}` mặc định trả **tổng quan gọn**, không trả log kỹ thuật
của tất cả ứng viên. API danh sách không thay đổi. Không sửa dữ liệu lịch sử,
schema database hay thuật toán AUTO, và không gọi AI để viết lại lý do.

## Phân tách tải dữ liệu

- Mặc định `schema_version: 3`: thông tin run, summary, trạng thái workflow hiện
  tại và **đủ tất cả ứng viên**. Mỗi ứng viên chỉ có `id`, `content_id`, `title`,
  `rank`, `status`, `reason`, `reason_code`, `similarity`, `workflow_id`, `review`
  khi có dữ liệu. Không còn summary bài, bảng điểm topic, matching, decision,
  token log hay review rỗng. Không trả field null; vẫn giữ số 0 và boolean false.
- `GET /api/v1/planning-runs/{run_id}/candidates/{candidate_id}/diagnostics`:
  tải đúng một bài khi bấm **Xem chi tiết quyết định**. Trả `schema_version: 3`,
  `run_id`, `candidate` chi tiết, `topics` của bài đó và `workflow` liên kết.
  Candidate phải thuộc run; run và workflow vẫn kiểm tra owner/profile.
- `GET /api/v1/planning-runs/{id}?view=diagnostic`: giữ dạng đầy đủ v2 để điều tra
  khi cần. Frontend bình thường **không** gọi chế độ này.
- Toàn văn nguồn vẫn tải riêng qua `/source`. Mở overview không tải toàn văn,
  draft timeline, bảng điểm hoặc gọi từng endpoint diagnostics (không N+1 HTTP).
- UI cache diagnostics trong card; đóng/mở lại không gọi lại nếu trạng thái
  không đổi. Quyết định duyệt/workflow thay đổi làm cache hết hiệu lực; tải lại
  khi người dùng yêu cầu, không tải tất cả diagnostics trong mỗi vòng polling.

Lý do trong overview tối đa 400 ký tự; bản đầy đủ giữ trong diagnostics. Bài bị
lọc có lý do cụ thể từ dữ liệu đã lưu (cosine dưới ngưỡng, chủ đề tránh, thiếu
video), không suy diễn thêm nguyên nhân khi log thiếu dữ liệu. Quyết định
planning và trạng thái workflow hiện tại vẫn là hai loại dữ liệu khác nhau.

### Kết quả đo trên mẫu run `1be7c650-0259-4304-b857-682cab439dd5`

So cùng JSON compact UTF-8, chưa gzip: **68.593 → 11.351 byte (-83,45%)**.
Giữ nguyên 26 ứng viên, summary 9 qua lọc/17 bị lọc và 4 workflow. Đây là phép
đo offline bằng serializer trên payload được cung cấp, không phải đo latency
hoặc response từ dịch vụ đang chạy. File JSON có thụt dòng lớn hơn wire JSON.

Cập nhật/restart API và frontend để dùng v3; **không cần restart worker** cho
riêng thay đổi read API này. Frontend vẫn đọc v2 khi API cũ chưa được cập nhật.

## Duyệt ứng viên chưa có draft (bổ sung 2026-08-31)

Trong Chi tiết plan, ứng viên có production `REVIEW_REQUIRED`, còn nguồn, đã qua
bộ lọc và chưa có workflow được hiện **Xem bài nguồn**, **Cho phép sinh draft**,
**Không sản xuất**. Đây là duyệt quyết định sản xuất, không phải duyệt draft/video.

- `GET /api/v1/planning-runs/{run_id}/candidates/{candidate_id}/source`: tải toàn văn
  khi mở nguồn; không đưa toàn văn vào response chi tiết plan và không gọi AI.
- `POST /api/v1/planning-runs/{run_id}/candidates/{candidate_id}/review`:
  `{ "action": "APPROVE|REJECT|RETRY", "reason": "ghi chú tùy chọn, tối đa 1000 ký tự" }`.
- Response POST trả `candidate_id`, `workflow_id`, `review`; chi tiết plan cũng có
  `candidates[].review` với `can_approve`, `can_reject`, `can_retry`, người/thời điểm/
  lý do duyệt, `task_id`, lỗi và quyết định sản xuất ban đầu sau khi đã duyệt.
- APPROVE ghi `production_review.status=QUEUED` và job `PLANNING_REVIEW_DRAFT`
  trong `kafka_tasks` **cùng transaction**. Bấm APPROVE lặp không tạo thêm job.
- Worker planning đọc DB mỗi 2 giây, khóa job `FOR UPDATE SKIP LOCKED` trong lúc
  sinh/lưu draft. Không cần Kafka để nhận yêu cầu duyệt. Cần restart API và
  ai-media-engine/planning-orchestrator với `ENABLE_WORKERS=true`.
- Worker kiểm tra lại quyền nguồn và hard gate hiện tại. Human approval giải quyết
  Fit Judge/nguồn ít dữ kiện; không vượt qua nguồn bị xóa, private của người khác,
  topic tránh, nguồn thiếu video bắt buộc hoặc dưới ngưỡng chủ đề hiện tại.
- Không gọi lại Fit Judge; vẫn dùng compact draft + tối đa một repair và quality
  gate. Draft chưa đạt vẫn vào `DRAFT_REVIEW_REQUIRED`; không duyệt luôn video.
- Lưu draft và liên kết candidate/workflow trước; bước tiếp tục voice/render
  là continuation `DRAFT_SAVED` bền vững, không cần sinh lại draft sau restart.
- Lỗi được xử lý: review `FAILED`, hiện lý do, chỉ chạy lại khi người dùng bấm
  RETRY; tái sử dụng job cũ. REJECT kết thúc chờ duyệt, không tạo workflow/AI call.
- Worker crash trước commit: transaction rollback, job về PENDING và có thể chạy
  lại sau restart; provider có thể đã tính phí call trước crash. Không tuyên bố
  exactly-once cho API AI bên ngoài.
- Giữ snapshot AI gốc trong reason/metadata; lưu kết quả mới ở `review_decision`.
  `diagnostics.candidate.decision` là kết quả mới nhất sau duyệt; lịch sử AI nằm trong
  `review.original_production`. Không thêm bảng hay migration.

## Cấu trúc diagnostics đầy đủ (v2 opt-in / candidate diagnostics)

- `schema_version: 2` chỉ áp dụng cho `?view=diagnostic` cấp run.
- Thông tin run: `id`, `profile`, `crawl_job`, `planning_mode`, `status`,
  `trigger`, `algorithm`, `similarity_threshold`, các timestamp và lỗi run.
- `summary`: số ứng viên, qua lọc, bị lọc, được chọn, workflow hiện còn tồn tại;
  phân bố quyết định `production` và kết quả `draft_quality`.
- `topics`: danh mục chủ đề dùng chung. Mỗi mục có `id`, `kind`, `name`, `key`,
  `description`. ID chỉ có ý nghĩa trong response hiện tại, không phải DB ID.
- `candidates`: mỗi bài giữ một `matching`, một `decision`, một `workflow_id`.
  Điểm từng chủ đề tham chiếu `topics` bằng `topic_id`.
- `workflows`: trạng thái workflow hiện tại, series đang gắn, cờ
  `pending_series`, lỗi áp dụng series và thời gian cập nhật; tải bằng một query batch.

`candidate.decision` gồm `production`, `draft`, `series`, provider/model,
token usage và lỗi. `draft.quality` giữ điểm, lỗi từng cảnh và retry count.
`scene_indexes` giữ quy ước **zero-based**; UI hiển thị số cảnh bằng index + 1.

## Thay thế field cũ

| Cũ | Mới |
|---|---|
| `output.ai_decision`, `output.ai_decisions`, candidate reason/metadata AI copies | `candidates[].decision` |
| `metadata.score_breakdown` và các bản sao điểm | `candidates[].matching` |
| Mô tả topic lặp trong từng ứng viên | `topics[]` dùng chung |
| `workflow` đầu tiên ở cấp run | `workflows[]`, tham chiếu bằng candidate `workflow_id` |
| `workflow_id` + `media_workflow_id` | Chỉ `workflow_id` |
| `input`/`output` đếm lặp | `summary` tổng hợp từ ứng viên |
| `crawl_job_id` + `crawl_job_name` | `crawl_job: {id, name}` |

## Ngữ nghĩa và tương thích dữ liệu cũ

- `selected` nghĩa là được chọn để lưu workflow, **không phải** draft đạt kiểm tra.
- Quyết định planning là snapshot lịch sử; `workflows` là trạng thái hiện tại.
  Duyệt/sửa workflow sau này không ghi đè điểm draft trong snapshot.
- Series được đề xuất không đồng nghĩa đã tạo/gắn. Đọc `workflows[].pending_series`
  và `workflows[].series` để biết trạng thái thực tế.
- `null` hoặc field bị lược bỏ nghĩa là chưa có dữ liệu, không chuyển thành confidence/token/điểm bằng 0.
- Legacy fallback: decision trong candidate reason → candidate metadata →
  output khớp đúng candidate/content → metadata của workflow được liên kết.
  Không lấy quyết định của bài đầu tiên làm đại diện cho toàn run.
- Không tự sửa timestamp lịch sử đã ghi sai; UI cảnh báo khi không thể tính thời lượng.
- Run không thuộc người dùng trả 404; lookup workflow giới hạn theo owner/profile của run.

## Kiểm thử

Backend: `python -m unittest discover -s services/api-service/tests -p test_planning_run_detail.py -v`
(đặt `PYTHONPATH` gồm thư mục backend và `services/api-service`).

Frontend: `npm run test:planning-detail` và `npm run build` tại thư mục frontend.
Test frontend render component thật với fixture, không gọi API hoặc chạy production.
