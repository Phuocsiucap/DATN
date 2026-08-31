# Luồng AUTO compact draft

## Thứ tự xử lý

Nhánh `REVIEW_REQUIRED` trước draft hiện có thao tác duyệt/từ chối trong Chi tiết
plan. Duyệt ghi job DB và tiếp tục từ bước chọn series/sinh draft; không gọi lại
Fit Judge và không bỏ quality gate. Lỗi sinh draft có retry chủ động, không tự
retry vô hạn. Xem contract và quy tắc idempotency tại
[planning-run-detail-api.md](planning-run-detail-api.md#duyệt-ứng-viên-chưa-có-draft-bổ-sung-2026-08-31).

1. Trích source facts và quyết định có nên sản xuất. Rule gate loại bài không phù hợp/thiếu nguồn; trường hợp borderline, nguồn nhạy cảm hoặc profile thận trọng chạy Fit Judge ngắn. `SKIP`/`REVIEW_REQUIRED` dừng trước bước series và sinh draft.
2. Xếp hạng các series active còn chỗ. Vector đại diện được tính trong memory bằng trung bình tối đa 5 ContentEmbedding của các bài gần nhất, cùng model embedding với bài đang xét. Không có vector dùng title/description matching; cần ít nhất 3 vector độc lập mới được tự chốt một match rõ ràng. Không thêm bảng vector hay migration.
3. Đưa Top 3 series, toàn văn và catalog media (index/type/mô tả) vào compact call; kết quả `compact-v2` gồm lựa chọn series, plan, hai track media/text độc lập và risk flags. Không yêu cầu evidence IDs, start/end hoặc thời lượng cố định. Code dựng timeline kỹ thuật.
4. Quality gate kiểm tra ID/liên kết, loại media, số liệu/entity với toàn nguồn và rủi ro. Chỉ retry một lần khi có lỗi có thể sửa; lỗi chỉ cần người duyệt không tiêu thêm một creative call. Cờ rủi ro quan trọng không được mất sau retry.
5. Draft PASS được gắn series sau khi khóa/kiểm tra capacity. Draft cần review giữ đề xuất series ở `pending_series_decision`, chưa chiếm part; người dùng duyệt đúng phiên bản thì mới áp dụng đề xuất. Series đã đầy/không khả dụng trả cảnh báo và không tạo bản trùng.
6. Voice/render chỉ chạy khi policy cho phép; sau khi duyệt draft, profile auto tiếp tục voice hoặc render. API, worker và hàng đợi đăng bài đều kiểm tra lại điều kiện liên quan.

Số call cho bước này: thông thường 1 compact call; tối đa 1 repair call bổ sung; Fit Judge là một call riêng chỉ khi production gate yêu cầu. Không tính các call ở crawl, embedding hoặc các module sản xuất khác.

## Prompt và kiểm tra đầu ra draft — `auto-draft-compact-2.0`

### Code nằm ở đâu?

- `services/ai-media-engine/app/planning/services/auto_draft_prompts.py`: `compact_draft_output_contract()` và `compact_draft_rules()` là cấu trúc đầu ra/hướng dẫn chung cho cả tạo và sửa draft.
- `services/ai-media-engine/app/planning/services/auto_workflow_planner.py`: `compact_prompt_payload()` / `repair_prompt_payload()` gắn dữ liệu bài, profile và series vào prompt; `decide_and_build_draft()` điều phối các call và quyết định retry.
- `services/ai-media-engine/app/planning/services/auto_draft_compact.py`: chuẩn hóa/quality, phân biệt `compact-v1` cũ và `compact-v2` mới. Giới hạn thời lượng/evidence cũ chỉ còn áp dụng cho v1.
- `services/ai-media-engine/app/planning/services/auto_draft_links.py`: catalog ảnh/video, validator liên kết và dựng timing từ lời thoại.

`required_output` là mô tả cấu trúc trong prompt, không phải JSON Schema được provider cưỡng chế. JSON hợp lệ vẫn phải qua normalize và quality gate; các phép kiểm tra tên riêng/số liệu/lặp cảnh là heuristic, không xác minh toàn bộ ý nghĩa của lời thoại.

### Đầu vào toàn văn, không phải bản tóm tắt AI

`ContentItem.summary` lấy từ `normalized.description` của dữ liệu crawl (`canonical_writer.py`), không phải kết quả một call tóm tắt AI. `normalized.content` trong MongoDB mới là nguồn toàn văn. Loader riêng cho AUTO không dùng description thay thế rồi gắn nhãn là full text; các caller cũ vẫn giữ hành vi fallback mặc định.

Khi có toàn văn, `build_draft_source_document()` chuyển bài thành `source_document`:

```json
{
  "coverage": "FULL_TEXT",
  "sections": [
    {"id": "F1", "kind": "TITLE", "text": "Tiêu đề bài"},
    {"id": "F2", "kind": "BODY", "text": "Đoạn đầu của toàn văn"},
    {"id": "F3", "kind": "BODY", "text": "Đoạn tiếp theo, giữ đúng thứ tự bài gốc"}
  ]
}
```

Ví dụ trên chỉ minh họa cấu trúc; trong request thật gửi **tất cả đoạn**, không giới hạn 10 đoạn / 3.500 ký tự / 600 ký tự mỗi đoạn. Giữ thứ tự heading, đoạn văn và list item; làm sạch HTML/khoảng trắng, bỏ script/style, không tóm tắt, chọn lại hay loại đoạn body trùng nhau. Description có sẵn được ghi là `LEAD` nếu chưa nằm trong body, không bị coi là tóm tắt AI.

- Call tạo nhận `content.source_document`; bỏ `content.summary` và bản sao `content.source_facts` để không gửi lặp toàn văn.
- Call sửa nhận cùng `source_document`, cộng draft hiện tại và lỗi. Không cắt phần cuối hay chỉ gửi các đoạn đã được dẫn.
- Validator nhận chính `source_document.sections` để kiểm tra tên/số trong toàn nguồn; v2 không yêu cầu AI khai báo `evidence_ids`. Metadata `source_facts` vẫn giữ các đoạn này để recheck sau chỉnh sửa; `source_coverage` phân biệt mức đầy đủ của nguồn.
- Nếu không đọc được body, `coverage=EXCERPT_ONLY`, dùng trích đoạn có sẵn theo hành vi cũ; **không giả vờ đó là toàn văn**, không sinh tóm tắt bằng một call mới. Rule gate thiếu nguồn vẫn có thể dừng bài trước bước này. Không thêm nhánh duyệt mới chỉ vì thiếu body.
- Production gate / Fit Judge vẫn dùng trích đoạn gọn như trước; thay đổi toàn văn áp dụng cho bước viết/sửa draft, không tự mở rộng ngân sách các call khác.

Toàn văn làm tăng input token theo độ dài bài. Mỗi call chỉ gửi một bản tài liệu nguồn; không bổ sung call tóm tắt hay call trích fact. Không âm thầm cắt bài nếu quá dài: giới hạn context của model/provider vẫn áp dụng, lỗi request được xử lý theo luồng lỗi hiện có. Giới hạn output token và tối đa một lần sửa vẫn giữ nguyên. Chưa có đánh giá LLM thật để kết luận tổng token hoặc tỉ lệ retry giảm.

### Hai track độc lập của compact-v2

Ví dụ rút gọn phần timeline AI trả về, chưa có thời gian hay URL:

```json
{
  "video": [
    {"id": "v1", "type": "image", "source_media_index": 0, "text_ids": ["t1", "t2"]},
    {"id": "v2", "type": "image", "source_media_index": 1, "text_ids": ["t3"]},
    {"id": "v3", "type": "video", "source_media_index": 2, "text_ids": ["t3"]}
  ],
  "text": [
    {"id": "t1", "role": "CONTEXT", "text": "Đoạn đầu."},
    {"id": "t2", "role": "ACTION", "text": "Đoạn tiếp theo trên cùng ảnh."},
    {"id": "t3", "role": "RESULT", "text": "Một đoạn lời chạy qua ảnh rồi video."}
  ]
}
```

- Model chỉ cần ghi `video[].text_ids`; code sinh `text[].video_ids` và các singular alias cho caller cũ. Nếu nhận cả hai phía thì phải nhất quán. `voice_text` tùy chọn, chỉ dùng khi khác `text`.
- Một visual có nhiều text liên tiếp hoặc một text đi qua nhiều visual liên tiếp; không nhân đôi lời thoại. Cùng URL được dùng lại ở đoạn khác cần clip ID mới.
- Liên kết phải theo thứ tự phát, không chéo/quay lại clip cũ. Ví dụ `v1=[t1,t2]`, `v2=[t2,t3]` hợp lệ; `v1=[t1,t2]`, `v2=[t1,t2]` không thể là hai clip liên tục theo thứ tự đó, phải chia clip.
- `type=video` cần index nguồn video thật; không dùng thumbnail làm video. AI không nhận lại URL dài và không được tự bịa URL. Không có media phù hợp: image placeholder + hướng dẫn hình ảnh, vẫn dùng fallback ảnh cũ; không thêm call tìm/generate ảnh.
- Dựng text timing theo khoảng `word_count/2.5` giây, tối thiểu 1 giây/text và đủ frame cho các media liên kết, 30 fps. Đây là ước lượng, không ép tổng thời lượng. Mỗi text được chia thời gian cho các media của nó; các phần liền nhau thuộc cùng media được gộp. `text_weights` lưu tỷ lệ để normalize nhiều lần hoặc căn voice không làm trôi liên kết.
- Voice đọc từng text một lần; Whisper căn lời thoại thực tế, sau đó fit lại media. Đã bổ sung ba import helper thiếu và sửa phép làm tròn mốc 0 ở backend/frontend.
- Editor mở/lưu theo ID, không zip hai mảng theo index; deduplicate text khi save, giữ video nguồn và cả hai hướng liên kết.

### Prompt hiện tại

- Cả tạo và repair nhận cùng contract v2, toàn văn và catalog media. LLM trả lại kiểu `scenes` v1 bị coi là thiếu track và cần repair; đường tương thích v1 chỉ dùng đọc draft đã lưu. Retry nhận nguyên đồ thị ID/liên kết và lỗi cụ thể, không gửi thêm bản sao `scenes` của v2.
- Không ép số cảnh/từ, không cắt ở 18 text hay 700 ký tự/text, không chọn target 25/40/60. Không đổi giới hạn output token của provider (3200), model, temperature hoặc số retry.
- Không yêu cầu F1/F2 trong draft; vẫn giữ đúng sự kiện, tên, số, thời gian và ngữ cảnh trong nguồn. Đây là kiểm tra heuristic, không phải xác minh ngữ nghĩa toàn bộ.
- Format là lựa chọn cấu trúc tổng thể; role linh hoạt, không phải checklist cần điền đủ. Risk/confidence không được sửa để né duyệt.

### Quy tắc cũ — chỉ áp dụng cho compact-v1

- Cả hai call nhận cùng cấu trúc JSON, giới hạn số cảnh/số từ, quy tắc role, dẫn chứng và rủi ro. Prompt sửa vẫn có đầy đủ cấu trúc đầu ra khi bản đầu tiên là JSON rỗng/hỏng.
- Mỗi nhận định thực tế, kể cả hook/kết luận, phải có fact hỗ trợ đúng nhận định, tên riêng và số liệu; một ID tồn tại không tự chứng minh nhận định đúng. Không coi mô tả profile/series là nguồn bằng chứng, không biến mục tiêu/dự kiến thành kết quả đã đạt.
- Sửa dẫn chứng phải xét toàn bộ `source_document` ban đầu, không chỉ các đoạn mà draft đang dẫn. Giữ phần hợp lệ, sửa đúng cảnh lỗi; rút gọn lời thoại quá dài thay vì tăng thời lượng để che lỗi.
- Lỗi `UNSUPPORTED_ENTITY` / `UNSUPPORTED_NUMBER` cung cấp thêm tên/số cụ thể, ID đang dẫn và scene index để call sửa biết cần đối chiếu gì. Scene index trong lỗi bắt đầu từ 0; giao diện có thể hiển thị cảnh bắt đầu từ 1.
- Không thêm thông tin để đủ số cảnh/từ, không lặp lại cảnh trước làm kết luận, không hạ rủi ro hay nâng confidence chỉ để vượt kiểm tra. Nguồn, mô tả profile/series và draft cũ được xác định là dữ liệu, không phải chỉ dẫn để làm theo.

Phần trên mô tả prompt v1 trước đây (`auto-draft-compact-1.2`), giữ làm tài liệu đọc dữ liệu lịch sử. Planning mới dùng prompt 2.0; không tự viết lại run/draft cũ, không cần migration database.

### Điều kiện validator legacy v1

Số “từ” là tổng đơn vị tách bởi khoảng trắng trong `scenes[].voice_text`, không tính title/angle/visual query; tiếng Việt nhiều âm tiết được đếm thành nhiều đơn vị.

| Thời lượng | Số cảnh cho phép | Số từ cho phép |
|---|---:|---:|
| 25 giây | 4–8 | 38–80 |
| 40 giây | 6–11 | 60–128 |
| 60 giây | 8–15 | 90–192 |

| Kiểm tra | Mã lỗi / ảnh hưởng |
|---|---|
| Thiếu title, format ngoài catalog, duration không thuộc 25/40/60, không có cảnh, role không thuộc format | `MISSING_TITLE`, `INVALID_FORMAT`, `INVALID_DURATION`, `MISSING_SCENES`, `INVALID_SCENE_ROLE`: CRITICAL |
| Thiếu/thừa cảnh, lời thoại ngắn/dài hơn bảng trên | `TOO_FEW_SCENES`, `TOO_MANY_SCENES`, `NARRATION_TOO_SHORT`, `NARRATION_TOO_LONG`: trừ điểm |
| Độ trùng từ giữa hai cảnh ≥ 0.72 | `SCENE_REPETITION`: trừ điểm; không phải kiểm tra ngữ nghĩa bằng AI |
| ID không tồn tại hoặc role thực tế không có evidence | `INVALID_EVIDENCE_ID`, `MISSING_EVIDENCE`: CRITICAL |
| Tên riêng/số liệu không tìm thấy trong fact đang dẫn | `UNSUPPORTED_ENTITY`, `UNSUPPORTED_NUMBER`: CRITICAL |
| Mở cảnh bằng các cụm sáo rỗng trong danh sách | `GENERIC_FILLER`: trừ điểm |
| Confidence draft < 60 | `LOW_MODEL_CONFIDENCE`: CRITICAL; khác ngưỡng 65 của Fit Judge |
| Risk HIGH/CRITICAL, hoặc MEDIUM khi profile LOW | `HIGH_RISK_FLAG`, `RISK_EXCEEDS_PROFILE_TOLERANCE`: CRITICAL |

Validator miễn kiểm tra **thiếu ID** theo role cho `HOOK`, `SUMMARY`, `CONCLUSION`, `QUESTION`, `CTA`, `TAKEAWAY`; vẫn kiểm tra tên/số ở các role này. Nếu không có ID, phép kiểm tra tên/số đối chiếu toàn bộ tập facts. Vì code chưa nhận biết mọi nhận định thực tế theo ngữ nghĩa, prompt yêu cầu chặt hơn: các role này chỉ được bỏ ID khi thực sự không đưa ra nhận định thực tế.

### Quality và retry của v2

V2 bỏ kiểm tra duration, giới hạn scene/word, role bắt buộc và evidence ID của bảng v1. Vẫn kiểm tra title/format, confidence/risk, lặp lời, filler, tên/số với toàn nguồn. Mỗi lỗi ID/liên kết/media là CRITICAL, trừ 20 điểm/lỗi, tối đa 50 điểm cho nhóm cấu trúc. Mã lỗi gồm `DUPLICATE_CLIP_ID`, `UNKNOWN_LINK_ID`, `UNLINKED_TEXT`, `UNLINKED_MEDIA`, `CONFLICTING_MEDIA_LINKS`, `NON_SEQUENTIAL_MEDIA_LINKS`, `INVALID_SOURCE_MEDIA_INDEX`, `SOURCE_MEDIA_TYPE_MISMATCH`, `MISSING_VIDEO_SOURCE` và lỗi track/text rỗng/sai kiểu.

Đầu ra `evaluate_compact_draft()` là `DraftQuality`, gồm `status`, `score`, `issues`, `word_count`, `scene_count` (đếm text, không đếm media hay số liên kết). Bắt đầu 100 điểm; **PASS khi score ≥ 85 và không có CRITICAL**, còn lại `REPAIR`. Một lỗi trừ điểm nhẹ không nhất thiết khiến retry. Planner quyết định:

1. PASS: dùng draft, không gọi sửa.
2. Không PASS và có lỗi ngoài ba mã confidence/risk: gọi sửa tối đa một lần rồi kiểm tra lại bằng cùng hàm; chỉ lấy bản sửa khi PASS hoặc điểm không thấp hơn bản cũ.
3. Chỉ có lỗi confidence/risk: không gọi sửa để tìm cách xóa yêu cầu duyệt. Sau retry vẫn chưa PASS nhưng có timeline dựng được: lưu `DRAFT_REVIEW_REQUIRED`, chặn voice/render. Không có text hoặc đồ thị ID/media vẫn sai: `AI_ERROR`, không tạo workflow, không âm thầm sửa thành 1–1.

Không đổi ngưỡng để làm đẹp tỉ lệ PASS. Tests offline xác nhận ràng buộc và luồng retry; không chứng minh model sẽ luôn tuân thủ prompt hay rằng tỉ lệ retry thực tế đã giảm. Cần đánh giá bằng các run mới trên môi trường test trước khi kết luận hiệu quả token.

Tham khảo [OpenAI Structured Outputs / JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs): JSON mode không đảm bảo schema; luồng hiện tại giữ validator và retry riêng, không chuyển endpoint/model.

## Duyệt và chỉnh sửa

- Duyệt draft là thao tác người dùng riêng, không đồng nghĩa AI review và không đổi kết quả quality tự động thành PASS.
- Approval gắn với chữ ký lời thoại/caption hiện tại. Thay đổi nội dung hủy approval; timing, style và voice tags không tự làm mất approval.
- V1: evidence bám theo ID text clip và được đánh dấu khi sửa lời. V2: recheck đọc timeline đang chỉnh, không đọc bản sao compact cũ hay áp ngược gate citation/thời lượng v1. AI Edit/Review dùng cùng nguyên tắc giữ liên kết theo ID; thiếu field được khôi phục từ ID cũ, liên kết mâu thuẫn bị từ chối trước khi ghi draft.
- Voice/video từ script cũ bị gỡ khỏi draft hoặc đánh dấu STALE; không xóa file vật lý.
- Workflow có task đang chạy không được sửa/duyệt/từ chối qua các API này. Workflow REJECTED phải mở lại trước; lúc mở lại kiểm tra sức chứa series lần nữa. FAILED vẫn giữ part để retry.
- Queue cũ phải vượt lại draft gate và trỏ đúng video hiện tại trước khi được duyệt, lên lịch hoặc bắt đầu upload.
- AUTO cũ thiếu `quality_script_signature` cần người dùng duyệt lại một lần. Luồng MANUAL không bị áp quality gate AUTO.

Các kiểm tra evidence/entity hiện là heuristic, không phải xác minh ngữ nghĩa đầy đủ hay bảo đảm thông tin đúng tuyệt đối.

## Kiểm thử local

Chạy từ root repo bằng PowerShell:

```powershell
$env:PYTHONPATH="$PWD\socialcontent_backend;$PWD\socialcontent_backend\services\ai-media-engine"
& .\.venv\Scripts\python.exe -m unittest discover -s socialcontent_backend/services/ai-media-engine/tests -q

$env:PYTHONPATH="$PWD\socialcontent_backend;$PWD\socialcontent_backend\services\api-service"
& .\.venv\Scripts\python.exe -m unittest discover -s socialcontent_backend/services/api-service/tests -q
```

Frontend: chạy `npm run test:draft-links`, `npm run test:planning-detail` và `npm run build` trong `frontend`.

Tests dùng mock cho DB, LLM, Kafka và upload; không xác nhận tích hợp thực tế hoặc row locking trên PostgreSQL. Trước khi đưa lên production, smoke test với hạ tầng test: bài PASS; bài bị loại trước series; repair thành công/thất bại; duyệt rồi sửa lời thoại; hai workflow tranh part cuối; series pending bị đầy trước khi duyệt; queue cũ sau khi sửa draft. Không dùng tài khoản đăng bài production cho smoke test.
