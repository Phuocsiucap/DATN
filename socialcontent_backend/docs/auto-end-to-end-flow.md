# Bản đồ dữ liệu AUTO: crawl → chọn bài → draft → video → TikTok

Đối chiếu working tree ngày **30/08/2026**. Đây là mô tả code hiện tại, bao gồm cả các nhánh chưa hoàn thiện; không phải cam kết luồng đã chạy end-to-end thành công. Lượt lập sơ đồ này không sửa code nghiệp vụ, không gọi LLM/TTS/TikTok và không đọc token tài khoản.

Cập nhật phần F/H ngày **31/08/2026**: prompt `auto-draft-compact-2.0`, output `compact-v2` đọc toàn văn, sinh media/text độc lập, không citation IDs hay thời lượng cố định; đã sửa import alignment và mốc 0. Các phần còn lại giữ phạm vi đối chiếu ban đầu, chưa xác nhận end-to-end với dịch vụ thật.

**Cách đọc:** `VÀO` = dữ liệu nhận; `LÀM` = công dụng; `ĐK` = điều kiện; `RA` = dữ liệu/trạng thái tạo ra. Các cụm A–J là các phần phóng to của cùng một flow. Mũi tên liền là đường đi chính; mũi tên đứt là nhánh phụ, thao tác tay hoặc cảnh báo. `!` là điểm cần chú ý trong code hiện tại.

**Con số:** `[C]` cố định trong code; `[MĐ]` mặc định, có thể cấu hình; `[P]` lấy từ profile. Chưa truy vấn profile trong DB hay môi trường deploy, vì vậy không gọi giá trị mặc định là cấu hình đang bật trên tài khoản của bạn.

## 0. Toàn cảnh

```mermaid
flowchart TD
    A["A · TẠO CRAWL<br/>VÀO: URL/RSS/từ khóa + lịch nguồn<br/>LÀM: tạo job và chia task theo nguồn<br/>RA: CrawlJob + KafkaTask CRAWL_URL"]
    B["B · CRAWL, CHUẨN HÓA, CHỐNG TRÙNG<br/>VÀO: task nguồn<br/>LÀM: lấy bài, chấm chất lượng, lưu canonical<br/>RA: Mongo processed_documents + ContentItem"]
    C["C · MATCH BÀI VỚI PROFILE<br/>VÀO: tối đa 500 bài/job + strategy<br/>LÀM: embedding topic/avoid và kiểm tra video nguồn<br/>RA: điểm + eligible + PlanningCandidate"]
    D["D · QUYẾT ĐỊNH CÓ SẢN XUẤT<br/>VÀO: bài + source_facts + điểm match<br/>LÀM: rule gate; Fit Judge nếu borderline<br/>RA: PRODUCE / SKIP / REVIEW_REQUIRED"]
    E["E · SHORTLIST SERIES<br/>VÀO: bài được PRODUCE + series active<br/>LÀM: centroid ContentEmbedding trong memory<br/>RA: Top 3 hoặc một series được chốt rõ ràng"]
    F["F · COMPACT DRAFT + QUALITY<br/>VÀO: toàn văn có ID đoạn + style + shortlist series<br/>LÀM: 1 creative call; repair tối đa 1 lần<br/>RA: scenes/evidence + timeline + quality"]
    G["G · LƯU WORKFLOW / DUYỆT DRAFT<br/>VÀO: draft + đề xuất series<br/>LÀM: gắn series nếu được phép; ký phiên bản<br/>RA: DRAFT_READY hoặc DRAFT_REVIEW_REQUIRED"]
    H["H · VOICE + RENDER<br/>VÀO: draft được phép sản xuất<br/>LÀM: Edge TTS → thử Whisper alignment → Remotion<br/>RA: MP3 + timeline + FINAL_VIDEO MP4"]
    I["I · DUYỆT VIDEO / QUEUE / ĐẾN GIỜ<br/>VÀO: MP4 + strategy<br/>LÀM: duyệt, tạo queue và kiểm tra lịch<br/>RA: PublishingQueueItem đủ điều kiện upload"]
    J["J · UPLOAD TIKTOK + XÁC NHẬN<br/>VÀO: MP4 + caption + quyền tài khoản<br/>LÀM: init → upload chunk → poll status<br/>RA: SocialPost + published / publishing / failed"]
    S["DỪNG TRƯỚC KHI CÓ WORKFLOW<br/>RA: lý do ở candidate/profile link<br/>Không chọn series, không tạo voice/render"]
    R["CHỜ NGƯỜI DÙNG<br/>VÀO: draft chưa đạt hoặc vừa sửa<br/>RA sau duyệt đúng chữ ký: được tiếp tục"]
    A --> B --> C
    C -->|eligible| D
    C -->|không eligible| S
    D -->|PRODUCE| E --> F --> G
    D -->|SKIP hoặc REVIEW_REQUIRED| S
    F -->|API lỗi hoặc không còn scene dùng được| S
    G -->|PASS hoặc đã duyệt đúng phiên bản| H --> I --> J
    G -->|cần duyệt draft| R --> G
    H -.->|lời thoại/caption thay đổi| R
    I -.->|draft hoặc render cũ không còn hợp lệ| R
```

### AUTO là các công tắc độc lập

| Công tắc / cấu hình | Mặc định trong model | Tác dụng thực sự |
|---|---:|---|
| `enable_scheduler` | `true` | Cho phép vòng lịch nguồn và lịch đăng chạy; không tự bật hết các công tắc profile. |
| `source.configuration.schedule_enabled` | Không có thì coi là tắt | Cho nguồn `SOURCE_CONFIG` tạo crawl theo lịch. |
| `receive_system_content` | `true` | Một điều kiện để profile được xét ở bước AUTO. |
| `auto_project_queue_enabled` | `false` | Bật tự xét bài → tạo **MediaWorkflow**, không phải queue đăng bài. |
| `video_render_mode` | `manual` | `auto` mới tự nối draft → voice → render. |
| `approval_mode` | `manual` | `auto` cho phép tự duyệt video sau render; không vượt draft safety gate. |
| `auto_queue_enabled` | `true` | Tự tạo queue ngay sau duyệt video. Có nhánh đồng bộ khi mở trang queue, xem I7. |
| `schedule_enabled` của profile | `true` | Scheduler đăng bài yêu cầu bật. |
| `auto_publish_enabled` | `false` | Scheduler chỉ tự upload khi bật. |
| `min_similarity` / `avoid_similarity_threshold` | `0.62` / `0.72` | Ngưỡng match chủ đề / chủ đề cần tránh. |
| `require_video` | `false` | Yêu cầu **nguồn** có tín hiệu video, không bắt buộc dùng video nguồn trong render. |
| `risk_level` | `medium` | `low` = thận trọng hơn: luôn qua Fit Judge và không tự chấp nhận risk MEDIUM. |
| `schedule_days` / `schedule_times` | `0,1,2,3,4,5,6` / `08:30,20:30` | `0` = thứ Hai; lưu ý timezone tại I4. |
| `schedule_timezone` | `Asia/Bangkok` | Nhánh chọn lịch trên trang queue dùng; nhánh auto sau render hiện chưa dùng. |
| `max_system_recommendations` / `post_frequency_per_day` | `20` / `2` | **Không được áp làm quota** trong consumer AUTO và scheduler đang trace. |

## A. Tạo crawl, lên lịch và chia task

```mermaid
flowchart TD
    A1["A1 · REQUEST TẠO CRAWL<br/>VÀO: name, crawl_mode, sources, priority<br/>ĐK: sources có ít nhất 1 phần tử<br/>MĐ: ONE_TIME; priority = 5<br/>RA: request hợp lệ hoặc HTTP validation error"]
    A2["A2 · LƯU JOB VÀ NGUỒN<br/>VÀO: request + user<br/>LÀM: chuẩn hóa feed VNExpress, lưu DB<br/>ĐK: user thường bị ép PRIVATE / USER<br/>RA: CrawlJob PENDING + CrawlJobSource + AuditLog"]
    A3["A3 · LỊCH NGUỒN<br/>VÀO: job SOURCE_CONFIG + source ACTIVE<br/>ĐK: enable_scheduler và schedule_enabled<br/>Chu kỳ kiểm tra MĐ 60 giây, tối thiểu 5 giây<br/>RA: nguồn đến hạn hoặc tiếp tục chờ"]
    A4{"A4 · ĐÃ ĐẾN HẠN?<br/>VÀO: last_triggered_at + interval_minutes<br/>ĐK: chưa từng chạy / timestamp lỗi / đã qua interval<br/>Interval MĐ 60 phút; tối thiểu 1 phút"}
    A5["A5 · SINH LƯỢT CRAWL THEO LỊCH<br/>VÀO: source đến hạn<br/>LÀM: copy source và config sang SCHEDULED_RUN<br/>RA: job PENDING + cập nhật last_triggered_at<br/>! Không copy scope/created_by_type; xem cảnh báo W6"]
    A6["A6 · EVENT crawl.job.created<br/>VÀO: job_id + source_count hoặc nguồn lịch<br/>LÀM: truyền yêu cầu qua Kafka<br/>RA: envelope có event_id, correlation_id, job_id"]
    A7{"A7 · ORCHESTRATOR GUARD<br/>VÀO: event + job<br/>ĐK: event chưa claim; job tồn tại, chưa CANCELLED<br/>ĐK: chưa có CRAWL_URL task của job"}
    A8["A8 · CHIA TASK THEO NGUỒN<br/>VÀO: N CrawlJobSource<br/>LÀM: mỗi nguồn tạo 1 task CRAWL_URL<br/>MĐ max_attempts = 4; tối thiểu 1<br/>RA: N task QUEUED + N crawl.task.requested<br/>Job QUEUED; progress = 10%"]
    A9["A9 · BỎ QUA / DỪNG<br/>VÀO: event trùng, job hủy hoặc đã có task<br/>RA: không tạo task mới<br/>Không có nguồn: job FAILED, progress 100%"]
    A10["A10 · HỦY / RETRY TAY<br/>Hủy: job và task đang chờ/chạy → CANCELLED<br/>Retry: reset counter, bỏ task crawl cũ, phát event mới<br/>RA: lượt orchestration mới; không xóa canonical cũ"]
    A1 --> A2 --> A6 --> A7
    A2 -.->|nguồn cấu hình lịch| A3 --> A4
    A4 -->|đến hạn| A5 --> A6
    A4 -->|chưa| A3
    A7 -->|đủ điều kiện và có nguồn| A8
    A7 -->|không| A9
    A8 -->|task_id + source_type + URL/keywords + config| B0["SANG B · CRAWLER"]
    A10 -.-> A6
```

Nguồn: [CrawlJobService](/D:/DATN/socialcontent_backend/services/api-service/app/services/crawl_jobs.py), [scheduler nguồn](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/orchestrator/scheduler/periodic_sources.py), [orchestrator](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/orchestrator/services/orchestrator.py).

## B. Crawl → chuẩn hóa → canonical → hoàn tất job

```mermaid
flowchart TD
    B1["B1 · CHẠY TASK NGUỒN<br/>VÀO: crawl.task.requested<br/>ĐK: task/job tồn tại; job chưa CANCELLED<br/>LÀM: RUNNING, attempt_count + 1, chọn crawler<br/>RA: danh sách document hoặc lỗi task"]
    B2["B2 · VNEXPRESS<br/>VÀO: URL bài / RSS / feed + từ khóa<br/>LÀM: discover rồi fetch HTML, lọc keyword/exclude<br/>MĐ 10 bài; clamp 1–30; discover tối đa 5 × limit<br/>HTTP timeout MĐ 20 giây<br/>RA: normalized article + quality; lỗi từng bài bị bỏ qua"]
    B3["B3 · BILIBILI<br/>VÀO: URL hoặc queries/keywords<br/>LÀM: metadata/API search, mở rộng series nguồn<br/>MĐ 10 item; clamp 1–50<br/>Search duration MĐ tối đa 7200 giây; timeout 20 giây<br/>RA: raw metadata/media/episode; chưa tự transcribe nguồn"]
    B4["B4 · NORMALIZE + SOURCE QUALITY<br/>VÀO: raw document; VNExpress đã normalize thì giữ<br/>LÀM: clean text, metadata/media, hash; chấm 0–100<br/>ĐK: ≥80 READY; 60–79 USABLE_WITH_WARNING; dưới 60 NEEDS_REVIEW<br/>RA: Mongo processed_documents; phát content.normalized<br/>Task SUCCEEDED; job progress tối thiểu 60%"]
    B5{"B5 · CHỐNG TRÙNG CANONICAL<br/>VÀO: processed_document_id → normalized + quality<br/>LÀM: khóa identity nguồn; tìm cùng URL → content_hash → transcript_hash<br/>ĐK: GLOBAL chỉ so GLOBAL; PRIVATE so GLOBAL hoặc cùng owner"}
    B6["B6 · BÀI MỚI<br/>VÀO: normalized chưa trùng<br/>LÀM: tạo ContentItem với crawl_job_id/scope/owner<br/>RA: id, title, summary, score/status, mongo_id, sources, media<br/>GLOBAL: tạo link RECOMMENDED score 0 cho profile nhận nguồn<br/>Bilibili: có thể gắn Story/episode nguồn; khác ContentSeries đầu ra"]
    B7["B7 · BÀI TRÙNG<br/>VÀO: ContentItem đã có<br/>LÀM: thêm source/media, duplicate_count + 1<br/>RA: dùng lại content_id; tăng total_duplicates<br/>! Giữ crawl_job_id cũ, không tạo ContentItem mới cho job này"]
    B8["B8 · GHI KẾT QUẢ CANONICAL<br/>VÀO: content_id mới hoặc được dùng lại<br/>LÀM: KafkaTask NORMALIZE COMPLETED<br/>RA: output_reference = content_id; progress ≥85%<br/>Phát content.canonical.saved và story.grouped nếu có"]
    B9{"B9 · JOB ĐÃ XỬ LÝ HẾT?<br/>VÀO: CRAWL_URL tasks + counters<br/>ĐK: không task PENDING/QUEUED/RUNNING/RETRYING<br/>ĐK: canonical_saved_count + total_failed ≥ total_crawled<br/>LÀM: chỉ đóng job khi các điều kiện đạt"}
    B10["B10 · ĐÓNG JOB<br/>Mọi crawl task thất bại và 0 bài: FAILED<br/>Có lỗi khác: PARTIAL_SUCCESS; còn lại SUCCEEDED<br/>RA: progress 100%, completed_at<br/>Canonical path phát content.embedding.requested rồi crawl.job.completed"]
    B11{"B11 · LỖI TOÀN TASK / RETRY<br/>VÀO: exception + attempt_count<br/>ĐK: attempt_count dưới max_attempts?"}
    B12["B12 · ĐỢI VÀ PHÁT LẠI<br/>VÀO: task RETRYING<br/>MĐ backoff = min(2 × 2^(attempt−1), 30) giây<br/>Với 4 lần thử: nghỉ 2, 4, 8 giây<br/>Config retry_backoff_seconds clamp 0–300<br/>RA: crawl.task.requested mới"]
    B13["B13 · LỖI CUỐI / DEAD LETTER<br/>VÀO: hết lần thử<br/>RA: task FAILED, total_failed + 1<br/>Phát crawl.task.failed + dead-letter.content<br/>Canonical save lỗi: NORMALIZE FAILED + total_failed; không cùng vòng retry crawler"]
    B1 -->|VNEXPRESS hoặc source khác không phải Bilibili| B2 --> B4
    B1 -->|BILIBILI| B3 --> B4
    B4 --> B5
    B5 -->|chưa trùng| B6 --> B8
    B5 -->|trùng| B7 --> B8
    B8 --> B9
    B9 -->|chưa| BW["CHỜ DOCUMENT/TASK CÒN LẠI"]
    B9 -->|đủ| B10 --> C0["SANG C · EMBEDDING VÀ MATCH"]
    B1 -->|exception toàn task| B11
    B11 -->|còn lượt| B12 --> B1
    B11 -->|hết lượt| B13 --> B9
```

### Điểm chất lượng nguồn — không phải điểm chất lượng kịch bản

| Tín hiệu nguồn | Điểm cộng |
|---|---:|
| Có title | +15 |
| Có content hoặc transcript | +25 |
| Có source_url | +10 |
| Có published_at | +10 |
| Có author | +5 |
| Có media | +10 |
| Content/transcript dài ít nhất 60 ký tự | +15 |
| Có cả source_external_id và language | +10 |

`total_crawled` và `total_normalized` tăng ngay khi crawler lưu processed document; `NORMALIZE COMPLETED` mới là bằng chứng canonical đã ghi xong. Task crawl thành công nhưng không có document vẫn có thể kết thúc job SUCCEEDED với 0 candidate. Nếu crawler đóng job ở nhánh 0 document, nó chỉ phát `crawl.job.completed`, không phát yêu cầu embedding riêng.

Nguồn: [crawler runner](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/crawler/services/crawler_runner.py), [quality nguồn](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/normalization/validators/quality.py), [canonical writer](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/story_processing/services/canonical_writer.py), [điều kiện đóng job](/D:/DATN/socialcontent_backend/common/db/crawl_status.py).

## C. Embedding → match topic/avoid → candidate theo profile

```mermaid
flowchart TD
    C1["C1 · HAI ĐƯỜNG KÍCH HOẠT EMBEDDING<br/>VÀO: content.embedding.requested hoặc matcher ensure qua HTTP<br/>LÀM: kiểm tra embedding thiếu/cũ, không đợi event hoàn tất mới planning<br/>RA: ContentEmbedding dùng chung; không phải LLM quyết định sản xuất"]
    C2["C2 · SOẠN TEXT ĐỂ EMBED<br/>VÀO: ContentItem + full text ở Mongo<br/>LÀM: title + summary + category + tags + 4 câu mở đầu<br/>Giới hạn opening 1800 ký tự; tổng 4000 ký tự<br/>RA: embedding_text"]
    C3["C3 · CACHE / BATCH EMBEDDING<br/>VÀO: embedding_text + model<br/>ĐK: vector đúng model và text chưa đổi → dùng lại<br/>MĐ text-embedding-3-small; 512 chiều<br/>Batch MĐ ≤64 item và ≤240000 ký tự<br/>RA: upsert ContentEmbedding theo content_id + model"]
    C4{"C4 · AUTO CONSUMER ĐƯỢC CHẠY?<br/>VÀO: crawl.job.completed + job_id/status<br/>ĐK: Kafka bật; status SUCCEEDED hoặc PARTIAL_SUCCESS<br/>ĐK profile: active + receive_system_content + auto_project_queue_enabled"}
    C5["C5 · LẤY BÀI CỦA JOB<br/>VÀO: crawl_job_id<br/>ĐK: ContentItem cùng job; READY hoặc USABLE_WITH_WARNING<br/>Sắp updated_at giảm dần rồi quality; giới hạn 500 bài<br/>RA: items dùng để xét cho từng profile<br/>! Đoạn query này chưa lọc scope/owner theo profile"]
    C6["C6 · VECTOR CHỦ ĐỀ VÀ TOPIC SCORE<br/>VÀO: content vector + content_topics/avoid_topics<br/>LÀM: Topic + Description → TopicEmbedding, có cache<br/>Từng topic tính cosine; score = clamp(max cosine ×100)<br/>RA: topic_matches, avoid_matches, similarity S"]
    C7{"C7 · ĐỦ ĐIỀU KIỆN CANDIDATE?<br/>VÀO: S + status + strategy + metadata nguồn<br/>ĐK: ít nhất 1 content topic cosine ≥ T; MĐ T=0.62<br/>Không khớp avoid bằng keyword hoặc cosine ≥ A; MĐ A=0.72<br/>Nếu require_video: content_type VIDEO hoặc duration hoặc video media"}
    C8["C8 · KHÔNG ĐỦ ĐIỀU KIỆN<br/>VÀO: thiếu vector/topics, dưới T, avoid match hoặc thiếu video<br/>RA: eligible=false, lý do; LOW_MATCH hoặc AVOID_TOPIC_MATCH<br/>Keyword khớp topic không thay thế được cosine gate<br/>Không gọi creative LLM cho candidate này"]
    C9["C9 · LƯU XẾP HẠNG<br/>VÀO: mọi điểm candidate của profile<br/>Sort: eligible → similarity → score → quality → thời gian<br/>RA: ProfileContentLink + PlanningRun + PlanningCandidate<br/>Xét tất cả eligible, không cắt ở max_system_recommendations=20"]
    C10{"C10 · WORKFLOW AUTO ĐÃ CÓ?<br/>VÀO: profile_id + content_id + crawl_job_id<br/>Tìm trong 20 workflow gần nhất của profile/content<br/>ĐK: selection_mode AUTO và cùng crawl_job_id"}
    C11["C11 · DÙNG LẠI WORKFLOW<br/>VÀO: workflow đã tồn tại<br/>RA: candidate.selected=true, workflow_id, cập nhật link<br/>Không sinh lại draft và không enqueue lại ở nhánh này"]
    C1 --> C2 --> C3
    C4 -->|đúng| C5 --> C1
    C4 -->|sai| CS["DỪNG AUTO / GHI NHẬN 0 CANDIDATE NẾU KHÔNG CÓ BÀI"]
    C3 --> C6 --> C7
    C7 -->|không| C8 --> C9
    C7 -->|có| C9
    C9 -->|mỗi eligible| C10
    C10 -->|có| C11
    C10 -->|chưa| D0["SANG D · QUYẾT ĐỊNH SẢN XUẤT"]
```

Embedding service lỗi không có fallback “keyword đủ thì sản xuất”: nếu vector không có, cosine gate không qua. Bài trùng dùng content cũ ở B7 thường không nằm trong query `crawl_job_id` mới ở C5. Một bài có thể được xét cho nhiều profile; đây không phải chọn duy nhất một profile cho bài.

Nguồn: [AUTO consumer](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/consumers/crawl_job_completed.py), [matcher](/D:/DATN/socialcontent_backend/common/planning/embedding_matcher.py), [embedding service](/D:/DATN/socialcontent_backend/services/embedding-service/app/service.py).

## D. Quyết định CÓ SẢN XUẤT — chạy trước chọn series

```mermaid
flowchart TD
    D1["D1 · TRÍCH SOURCE FACTS BẰNG CODE<br/>VÀO: title + summary + full text Mongo<br/>LÀM: tách câu, clean, bỏ trùng chuẩn hóa và đoạn dưới 12 ký tự<br/>Giới hạn 10 facts, ngân sách 3500 ký tự, mỗi fact cắt 600<br/>RA: F1…F10 với text; đây là trích đoạn, chưa fact-check độc lập"]
    D2{"D2 · HARD GATE<br/>VÀO: content + candidate signals + facts<br/>ĐK: READY/USABLE_WITH_WARNING; không avoid<br/>passed_similarity_gate không false; có video nếu bắt buộc<br/>ĐK đủ nguồn: có ít nhất 3 facts"}
    D3["D3 · DỪNG TRƯỚC SERIES<br/>Sai status/avoid/topic/video → SKIP<br/>Dưới 3 facts → REVIEW_REQUIRED<br/>RA: should_create_workflow=false + reason_code<br/>Chưa có MediaWorkflow để bấm approve-draft"]
    D4{"D4 · MATCH RÕ ĐỂ BỎ QUA FIT JUDGE?<br/>VÀO: S, T, source quality Q và risk profile<br/>ĐK: S ≥ T+0.08; Q ≥65; status READY<br/>Profile risk khác LOW; nguồn không chứa từ nhạy cảm<br/>Ví dụ T=0.62 thì S ≥0.70"}
    D5["D5 · PRODUCE BẰNG RULE<br/>VÀO: tất cả điều kiện D4 đúng<br/>RA: HIGH_CONFIDENCE_MATCH<br/>Confidence = min(99, 82 +100×max(0,S−T))<br/>Không tốn Fit Judge call"]
    D6["D6 · FIT JUDGE CHO BORDERLINE<br/>VÀO: profile/style/risk + title/summary + 5 facts đầu + signals<br/>LÀM: hỏi phù hợp/rủi ro, không viết script<br/>1 call; temperature 0.1; output cap 300; timeout 60 giây<br/>RA: decision, confidence_score, reason_code, risk"]
    D7{"D7 · CHUẨN HÓA FIT RESULT<br/>PRODUCE nhưng confidence dưới 65 → REVIEW_REQUIRED<br/>risk khác LOW/MEDIUM → REVIEW_REQUIRED<br/>risk MEDIUM và profile LOW → REVIEW_REQUIRED<br/>Decision lạ / parse hoặc API lỗi → REVIEW_REQUIRED"}
    D8["D8 · KEY / PROVIDER<br/>VÀO: cấu hình server, không đưa key vào prompt<br/>Có OpenAI key: dùng OpenAI model cấu hình<br/>Nếu không: có DeepSeek key thì dùng deepseek-v4-flash<br/>Không key: SKIPPED_NO_API_KEY, không tạo workflow"]
    D1 --> D2
    D2 -->|không đạt hoặc thiếu facts| D3
    D2 -->|qua hard gate| D4
    D4 -->|đúng| D5 --> D8
    D4 -->|sai: BORDERLINE| D8
    D8 -->|có key và BORDERLINE| D6 --> D7
    D8 -->|có key và rule PRODUCE| E0["SANG E · SHORTLIST SERIES"]
    D7 -->|PRODUCE hợp lệ| E0
    D7 -->|SKIP / REVIEW_REQUIRED| D3
```

Nguồn nhạy cảm được nhận diện bằng substring trong title, summary và facts: sức khỏe, y tế, thuốc, điều trị, pháp luật, luật, đầu tư, chứng khoán, tiền điện tử, tự tử, bạo lực, tình dục, trẻ em và một số từ tiếng Anh tương ứng. Đây là heuristic, không phải bộ phân loại đầy đủ.

Lưu ý: `Q ≥65` là hằng số của D4, nhưng D4 còn yêu cầu `READY`; với nguồn được chấm theo B4 thì READY thường đã có Q ≥80. `USABLE_WITH_WARNING` và profile risk LOW đều phải qua Fit Judge dù cosine cao.

Nguồn: [production gate và Fit Judge](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/services/auto_workflow_planner.py:411), [source facts](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/services/auto_draft_compact.py:100).

## E. Chọn Top 3 series, không thêm bảng vector series

```mermaid
flowchart TD
    E1["E1 · LẤY SERIES CÒN CHỖ<br/>VÀO: profile_id của bài được PRODUCE<br/>ĐK: ContentSeries cùng profile và ACTIVE<br/>Số part thực = count workflow không REJECTED; FAILED vẫn chiếm chỗ<br/>total_parts=0: không giới hạn; còn lại count phải nhỏ hơn total_parts<br/>RA: tất cả series đủ điều kiện; không cắt 20 series"]
    E2["E2 · LẤY BÀI ĐẠI DIỆN<br/>VÀO: series_ids + candidate ContentEmbedding<br/>LÀM: mỗi series lấy tối đa 5 workflow gần nhất theo updated_at<br/>Loại FAILED/REJECTED; cần primary_content_id<br/>Lấy embedding cùng model, đúng số chiều; khử trùng content_id<br/>RA: 0–5 vector dùng được + 2 recent_items gửi prompt"]
    E3{"E3 · CÓ VECTOR ĐẠI DIỆN?<br/>VÀO: candidate vector và vector bài trong series<br/>ĐK: ít nhất 1 vector tương thích"}
    E4["E4 · CENTROID TRONG MEMORY<br/>VÀO: N vector, 1 ≤ N ≤5<br/>LÀM: vector đại diện = tổng vector / N; cosine với bài mới<br/>Điểm = 0.85×cosine + 0.15×lexical<br/>RA: semantic_score + final_score; không ghi vector series xuống DB"]
    E5["E5 · FALLBACK KHÔNG VECTOR<br/>VÀO: title/summary/topics bài và title/description/theme/angles series<br/>LÀM: lexical Jaccard của token chuẩn hóa<br/>Điểm = min(0.54, 0.7×lexical)<br/>RA: series vẫn có thể vào shortlist, nhưng không tự chốt"]
    E6["E6 · TOP 3<br/>VÀO: điểm mọi series đủ điều kiện<br/>LÀM: sort score giảm dần, rồi recent_vector_count<br/>RA: tối đa 3 series; mỗi series có id/context/count/2 bài gần nhất"]
    E7{"E7 · CHỐT MATCH RÕ RÀNG?<br/>VÀO: Top 1 và Top 2; không Top 2 thì điểm thứ hai=0<br/>ĐK: score1 ≥0.75<br/>ĐK: score1−score2 ≥0.08 và có ít nhất 3 vector khác content_id"}
    E8["E8 · FIXED SERIES<br/>VÀO: E7 đạt<br/>RA: fixed_series_decision USE_EXISTING + exact id + context<br/>Creative call phải giữ id; không cần gửi cả Top 3"]
    E9["E9 · ĐỂ COMPACT CALL CHỌN<br/>VÀO: E7 không đạt hoặc chưa có series<br/>RA: Top 3, có thể rỗng<br/>LLM chọn USE_EXISTING / CREATE_NEW / NONE trong bước F"]
    E1 --> E2 --> E3
    E3 -->|có| E4 --> E6
    E3 -->|không| E5 --> E6
    E6 --> E7
    E7 -->|đạt| E8 --> F0["SANG F · COMPACT CALL"]
    E7 -->|không| E9 --> F0
```

Với series mới có 1–2 vector, code vẫn tính centroid để xếp hạng, nhưng không được tự chốt E8. Nếu 5 workflow gần nhất có bài trùng, N có thể dưới 5; code không tìm tiếp xa hơn để bù đủ 5 bài khác nhau. `Story` được gom từ Bilibili ở B6 là series **nguồn**; `ContentSeries` ở đây là chuỗi nội dung **sản xuất cho profile**, không phải một bảng.

Nguồn: [rank/centroid/fixed match](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/services/auto_workflow_planner.py:674), [count và lock series](/D:/DATN/socialcontent_backend/common/db/content_series.py).

## F. Compact call → quality gate → một lần repair → timeline

```mermaid
flowchart TD
    F1["F1 · COMPACT CALL<br/>VÀO: toàn văn, style/risk, catalog index/type media, fixed hoặc Top 3 series<br/>Thiếu body: EXCERPT_ONLY; không coi description là toàn văn<br/>LÀM: chọn format/angle, text và media độc lập; không citation/timing<br/>1 call; temperature 0.55; output cap 3200; timeout 60 giây<br/>RA: plan + timeline.video/text có ID/liên kết + risk + series_decision"]
    F2["F2 · NORMALIZE OUTPUT<br/>VÀO: JSON LLM; JSON sai được coi như draft rỗng để xét repair<br/>V2 không cắt ở 18 text/700 ký tự; giữ đồ thị ID để kiểm tra<br/>V1 cũ vẫn có đường đọc tương thích<br/>RA: compact draft chuẩn hóa, version v1 hoặc v2"]
    F3["F3 · QUALITY BẰNG CODE<br/>VÀO: compact + toàn nguồn + profile risk + catalog media<br/>LÀM: bắt đầu 100 điểm rồi trừ lỗi<br/>Kiểm tra ID, links, thứ tự phát, source type, title/format/confidence/risk<br/>Kiểm tra số, entity, lặp câu, filler; đếm mỗi text một lần<br/>RA: score + issues + text indexes + PASS hoặc REPAIR"]
    F4{"F4 · PASS?<br/>VÀO: quality result<br/>ĐK: score ≥85 VÀ không có lỗi CRITICAL"}
    F5{"F5 · CÓ LỖI CÓ THỂ REPAIR?<br/>VÀO: issues khi chưa PASS<br/>Chỉ HIGH_RISK_FLAG / RISK_EXCEEDS_PROFILE_TOLERANCE / LOW_MODEL_CONFIDENCE<br/>→ đi thẳng review, không tiêu creative call nữa<br/>Có lỗi khác → được repair tối đa 1 lần"}
    F6["F6 · REPAIR CALL MỘT LẦN<br/>VÀO: current_draft cả ID/links + issues + nguyên source_document + series/media<br/>Cùng contract v2; giữ ID/liên kết hợp lệ, không gửi bản sao scenes<br/>Temperature 0.3; output cap 3200; timeout 60 giây<br/>RA: repaired compact hoặc retry_error"]
    F7["F7 · CHỌN BẢN SAU REPAIR<br/>VÀO: bản đầu và bản sửa, quality của cả hai<br/>Giữ cờ HIGH/CRITICAL; profile LOW giữ cả MEDIUM<br/>ĐK: nhận bản sửa nếu PASS hoặc score sửa ≥ score đầu<br/>RA: một draft; không có lần repair thứ hai"]
    F8{"F8 · CÒN SCENE DÙNG ĐƯỢC?<br/>VÀO: draft cuối<br/>ĐK: scenes không rỗng"}
    F9["F9 · VALIDATE SERIES DECISION<br/>VÀO: fixed/raw decision + Top 3 + title bài<br/>Fixed có thì giữ; USE_EXISTING phải có exact id trong Top 3<br/>CREATE_NEW: title không rỗng, khác title bài, đủ 3 follow-up angles<br/>Sai điều kiện → NONE; total_parts ≥0, 0=ongoing<br/>RA: decision đã kiểm tra; chưa chắc đã ghi series"]
    F10["F10 · DỰNG TIMELINE BẰNG CODE<br/>VÀO: media/text + ID/links + catalog ảnh/video nguồn<br/>V2: text ước lượng word_count/2.5 giây, tối thiểu 1 giây và đủ frame<br/>Chia mỗi text cho media liên kết, gộp phần liền nhau của cùng media<br/>1080×1920, 30 fps; không target 25/40/60; lưu text_weights<br/>RA: timeline có timing + story_data/compact_scenes dẫn xuất"]
    F11["F11 · REVIEW HOẶC READY<br/>VÀO: quality cuối + timeline<br/>PASS → AI_APPROVED; không PASS → DRAFT_REVIEW_REQUIRED<br/>RA: should_create_workflow=true, token_usage, retry_count<br/>Có draft không đồng nghĩa được chạy voice/render"]
    FX["F! · KHÔNG TẠO WORKFLOW<br/>VÀO: call đầu lỗi/API exception hoặc sau repair không có scene<br/>RA: AI_ERROR + error_message ở candidate/profile link<br/>Không tự fallback sang script bịa hoặc retry vô hạn"]
    F1 --> F2 --> F3 --> F4
    F1 -->|call đầu lỗi| FX
    F4 -->|PASS| F8
    F4 -->|chưa PASS| F5
    F5 -->|chỉ lỗi cần người duyệt| F8
    F5 -->|có lỗi repair được| F6 --> F7 --> F8
    F6 -->|retry lỗi: giữ bản đầu| F8
    F8 -->|không| FX
    F8 -->|có| F9 --> F10 --> F11 --> G0["SANG G · LƯU WORKFLOW / DUYỆT"]
    F10 -->|ID/liên kết/media vẫn lỗi sau retry| FX
```

### Quality v2 và tương thích v1

V2 giữ ngưỡng PASS ≥85, không CRITICAL, confidence/risk, title/format, số/entity, lặp lời và filler như bảng dưới. **Không áp dụng** các hàng duration/role/scene count/word count/evidence ID cho v2. Bổ sung lỗi cấu trúc ID/track/media/link: mỗi lỗi CRITICAL trừ 20, tổng nhóm tối đa 50; đồ thị vẫn lỗi sau retry thì không tạo workflow. Tên/số của v2 đối chiếu toàn nguồn, không đối chiếu đoạn được cite. Chi tiết: [contract v2](auto-compact-draft-flow.md).

Bảng lịch sử dưới đây áp dụng đầy đủ chỉ cho **compact-v1**:

| Kiểm tra | Điều kiện / mức trừ | Có tự chặn dù tổng điểm cao? |
|---|---|---|
| Confidence draft | Dưới 60: −20 | Có, CRITICAL |
| Risk HIGH/CRITICAL | −30 | Có |
| Risk MEDIUM khi profile LOW | −20, nếu không có HIGH | Có |
| Thiếu title / format không trong catalog | Mỗi loại −25 | Có |
| Duration không là 25/40/60 | −20 | Có |
| Không scene | −50 | Có; cuối cùng không tạo workflow |
| Role không thuộc format đã chọn | −20 | Có; không bắt buộc thứ tự role cố định |
| Scene quá ít / quá nhiều | −12 / −8 | Không, chỉ trừ điểm |
| Lời thoại quá ngắn / quá dài | −15 / −12 | Không, chỉ trừ điểm |
| Lặp lời thoại giữa scene | Lexical Jaccard ≥0.72; trừ min(30,12+5×số cặp lặp) | Không, chỉ trừ điểm |
| Evidence ID không có trong facts | −25 | Có |
| Scene factual thiếu evidence | Trừ min(30,15+5×số scene thiếu) | Có |
| Entity không có trong facts được cite | Trừ min(35,20+5×số scene lỗi) | Có |
| Số liệu không có trong facts được cite | −25 | Có |
| Filler thuộc danh sách prefix | Trừ min(18,6×số scene lỗi) | Không, chỉ trừ điểm |

| Target | Biên scene trong prompt | Biên scene dùng chấm điểm | Biên từ dùng chung |
|---:|---:|---:|---:|
| 25 giây | 4–8 | 4–8 | 38–80 |
| 40 giây | 6–11 | 6–11 | 60–128 |
| 60 giây | 8–15 | 8–15 | 90–192 |

Biên từ = `round(duration×1.5)` đến `round(duration×3.2)`. “Từ” là cách đếm token từ/ngăn cách trong code, không phải token LLM. Vì PASS là **≥85 và không CRITICAL**, chỉ lỗi “quá ngắn” (−15) vẫn có thể PASS 85. Không diễn giải các biên mềm trên là luật chặn tuyệt đối.

Catalog 8 format: NEWS_BRIEF, EXPLAINER, LISTICLE, MYTH_VS_FACT, STORY_ARC, QA, CONTRARIAN, CASE_STUDY. Role HOOK/QUESTION/CTA/TAKEAWAY/CONCLUSION/SUMMARY được miễn kiểm tra bắt buộc có evidence ID; kiểm tra entity và số vẫn chạy trên mọi scene. Nếu scene không cite ID thì đối chiếu entity/số với toàn bộ facts. Các kiểm tra này không xác minh được mọi diễn giải sai ngữ nghĩa.

Media cho F10 v2: dùng `source_media_index` trỏ đúng loại image/video trong catalog; index sai phải repair. Video thiếu nguồn thật không được đổi ngầm thành ảnh. Image không chọn index thì xoay vòng ảnh nguồn hoặc ảnh demo trong `DEFAULT_IMAGES`. `visual_query` được lưu làm hướng dẫn, **không thêm bước tự tìm/generate ảnh**. Một media có thể giữ qua nhiều text; một text đi qua nhiều media vẫn chỉ đọc một lần.

**Chi phí call của D–F:** 1 compact; có thể +1 Fit Judge và +1 repair. Output cap cộng tối đa `300+3200+3200=6700`, là trần cấu hình của ba call, không phải số token thực tế. Không tính embedding, TTS, Whisper và thao tác AI sửa/regenerate do người dùng bấm. API lỗi retry có thể chỉ nằm ở `retry_error`, nên `retry_count` đếm response creative nhận được không nhất thiết bằng số HTTP attempt đã thử.

Nguồn: [compact và quality](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/services/auto_draft_compact.py), [orchestration compact/repair](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/services/auto_workflow_planner.py:150).

## G. Ghi workflow, áp series và duyệt đúng phiên bản draft

```mermaid
flowchart TD
    G1["G1 · TẠO MediaWorkflow<br/>VÀO: story + quality + candidate + đề xuất series<br/>RA: selection_mode=AUTO; status=EDITING<br/>PASS → stage DRAFT_READY, progress 100%<br/>Chưa PASS → DRAFT_REVIEW_REQUIRED, progress 80%<br/>Lưu source_facts, compact_scenes, risk_flags, quality, token_usage"]
    G2{"G2 · ĐÃ ĐƯỢC PHÉP ÁP SERIES?<br/>VÀO: quality và action USE_EXISTING/CREATE_NEW<br/>PASS: áp ngay<br/>Chưa PASS: chỉ lưu pending_series_decision, chưa chiếm part"}
    G3["G3 · KHÓA / CHECK CAPACITY / CHỐNG TRÙNG<br/>VÀO: decision + profile_id<br/>USE_EXISTING: khóa row; ACTIVE, cùng profile, còn chỗ<br/>CREATE_NEW: khóa profile; chuẩn hóa title để tìm series đã có<br/>RA: dùng lại/tạo series rồi gắn workflow; sync current_part theo count"]
    G4["G4 · KHÔNG CÓ SERIES HỢP LỆ<br/>VÀO: NONE hoặc series đầy/mất/không active<br/>RA: workflow SINGLE nếu chưa có series<br/>Series đầy/mất: SERIES_UNAVAILABLE_OR_FULL<br/>Không tự tạo series bản sao; draft vẫn có thể được sản xuất độc lập"]
    G5["G5 · CHỜ DUYỆT DRAFT<br/>VÀO: workflow DRAFT_REVIEW_REQUIRED<br/>LÀM: UI hiển thị quality/issue/risk; người dùng xem hoặc sửa<br/>RA: draft đã lưu + script_signature để gửi approve-draft"]
    G6{"G6 · APPROVE-DRAFT API<br/>VÀO: workflow_id + script_signature + user<br/>ĐK: đúng owner/admin; AUTO; có script; không REJECTED<br/>Không task PENDING/RUNNING/PROCESSING đang chạy<br/>Chữ ký gửi lên phải bằng phiên bản đang lưu"}
    G7["G7 · DUYỆT TAY THÀNH CÔNG<br/>VÀO: G6 hợp lệ<br/>LÀM: thử áp pending series qua G3; đầy thì trả warning<br/>RA: draft_review_approved=true, approved_script_signature<br/>Lưu reviewer/time; không sửa quality tự động thành PASS<br/>Stage DRAFT_READY; profile auto thì nối voice/render"]
    G8{"G8 · POLICY CHUNG ĐƯỢC SẢN XUẤT?<br/>VÀO: metadata + script thực ở timeline.text<br/>AUTO phải có script<br/>Đạt nếu human approval đúng chữ ký<br/>Hoặc: quality PASS + không review_required/high risk + quality_signature khớp"}
    G9["G9 · SỬA SCRIPT SAU DUYỆT<br/>VÀO: lời thoại/caption mới qua save/edit/review/regenerate<br/>LÀM: hủy approval, gỡ voice cũ, FINAL_VIDEO → STALE<br/>Giữ evidence theo text_id; đổi lời thoại thì evidence_needs_review<br/>RA: DRAFT_REVIEW_REQUIRED; không xóa file vật lý"]
    G10["G10 · REJECT / MỞ LẠI WORKFLOW<br/>Reject: không đang chạy; hủy draft approval; không tính part nữa<br/>Mở lại: kiểm tra series ACTIVE và còn chỗ trước khi phục hồi part<br/>Series đầy: HTTP 409, cần đổi/bỏ series<br/>RA: mở lại plan không đồng nghĩa đã duyệt draft"]
    G1 --> G2
    G2 -->|PASS và có đề xuất| G3
    G2 -->|NONE| G4 --> G8
    G2 -->|chưa PASS| G5 --> G6
    G3 -->|gắn được| G8
    G3 -->|không gắn được| G4
    G6 -->|sai version/task active/rejected| GX["HTTP 409 · KHÔNG DUYỆT / KHÔNG ENQUEUE"]
    G6 -->|đạt| G7 --> G8
    G7 -.->|có pending series| G3
    G8 -->|được| H0["SANG H · VOICE / RENDER"]
    G8 -->|không| G5
    G9 --> G5
    G10 -.-> G5
```

Chữ ký ưu tiên nội dung thực ở `timeline.text`, không tin bản `compact_scenes` cũ. Timing/style/audio và voice tags không làm đổi chữ ký; nội dung lời thoại/caption có đổi thì phải duyệt lại. AI review không thay thế thao tác người dùng duyệt draft. AUTO cũ thiếu `quality_script_signature` cũng không tự chạy qua policy.

Nguồn: [tạo workflow AUTO](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/planning/consumers/crawl_job_completed.py:315), [policy chung](/D:/DATN/socialcontent_backend/common/planning/auto_draft_policy.py), [approve-draft](/D:/DATN/socialcontent_backend/services/api-service/app/api/routes/generate_video.py:556), [reject/mở lại](/D:/DATN/socialcontent_backend/services/api-service/app/api/routes/media_workflows.py:382).

## H. Voice → thử căn thời gian → render MP4

```mermaid
flowchart TD
    H1{"H1 · TỰ TẠO VIDEO ĐƯỢC BẬT?<br/>VÀO: workflow + strategy + policy G8<br/>ĐK auto enqueue: video_render_mode=auto và policy cho phép<br/>Có voice rồi → render; chưa voice → TTS<br/>Task cùng loại đang PENDING/RUNNING/PROCESSING → không tạo trùng"}
    H2["H2 · ENQUEUE VOICE<br/>VÀO: workflow chưa voice<br/>RA: KafkaTask GENERATE_VIDEO_VOICE PENDING<br/>Event generate-video.voice.requested với task_id/workflow_id<br/>AUTO chọn Edge NamMinh; speed MĐ 1.2<br/>Stage QUEUED_VOICE, progress 0%"]
    H3["H3 · TTS WORKER<br/>VÀO: task PENDING/FAILED + draft hiện tại<br/>LÀM: kiểm tra policy lần nữa; đọc timeline.text<br/>AUTO: vi-VN-NamMinhNeural; rate +20%, pitch −2Hz<br/>Speed clamp 0.7–1.2; Edge thử tối đa 3 lần, nghỉ 2 giây<br/>RA: MP3 + audio.voice + timeline.audio voice-main"]
    H4["H4 · WHISPER ALIGNMENT<br/>VÀO: MP3 + script text + OpenAI key<br/>LÀM: whisper-1 → segment/word timestamps rồi khớp scene<br/>HTTP timeout 180 giây; không có key → lỗi alignment<br/>Nếu nhiều scene mà khớp ≤1 hoặc transcript_score dưới 0.35 → lỗi<br/>RA kỳ vọng: timings theo voice; ! code hiện có lỗi thiếu 3 helper"]
    H5["H5 · LƯU VOICE / KIỂM TRA LẠI<br/>VÀO: story sau TTS và alignment<br/>Alignment exception: lưu fit_frame_error, vẫn tiếp tục<br/>RA: task COMPLETED; policy đạt → VOICE_READY, 100%<br/>Script thay đổi → DRAFT_REVIEW_REQUIRED, 80%<br/>V2 căn thời lượng theo voice, không ép target cố định"]
    H6["H6 · ENQUEUE RENDER<br/>VÀO: draft/voice được phép + video_render_mode auto<br/>RA: task GENERATE_VIDEO_RENDER PENDING<br/>Event generate-video.render.requested<br/>Workflow RENDERING / QUEUED_RENDER, progress 0%"]
    H7{"H7 · RENDER WORKER GUARD<br/>VÀO: task PENDING/FAILED + workflow<br/>ĐK: policy còn hợp lệ<br/>Còn script/edit/review/voice task active?<br/>Có → QUEUED_RENDER_AFTER_DRAFT/VOICE, chưa render"}
    H8["H8 · REMOTION RENDER<br/>VÀO: story timeline + ảnh/video/audio + subtitles<br/>LÀM: normalize → Node render-story.mjs → Remotion<br/>1080×1920, 30 fps từ draft; codec h264<br/>MĐ concurrency 4, CRF 23, preset ultrafast<br/>Timeout render MĐ 1800 giây; thiếu dependency có npm install timeout 300 giây<br/>RA: out/final-workflow-renderKey.mp4"]
    H9["H9 · LƯU FINAL VIDEO<br/>VÀO: artifact_path + story sau render<br/>RA: artifacts_jsonb FINAL_VIDEO READY, URI + task_id<br/>draft.video_artifacts.final; task COMPLETED, stage RENDERED, 100%<br/>Chuyển sang policy duyệt video ở I"]
    H10["H10 · FAILED / BLOCKED<br/>Policy sai: task CANCELLED; draft về review<br/>TTS hết 3 lần hoặc render exception: task/workflow FAILED<br/>RA: error_message; chưa tự có vòng retry vô hạn<br/>Task chạy quá 10 phút có thể được DB sweep đưa về PENDING"]
    HM["NHÁNH TAY<br/>VÀO: video_render_mode=manual<br/>RA: dừng ở workspace để người dùng bấm voice/render<br/>API vẫn áp policy AUTO; không bỏ qua review"]
    H1 -->|auto, chưa voice| H2 --> H3 --> H4 --> H5
    H1 -->|auto, đã voice| H6
    H1 -->|manual| HM
    H3 -->|TTS lỗi hết lượt| H10
    H4 -->|alignment lỗi: tiếp tục kèm fit_frame_error| H5
    H5 -->|policy đạt và auto| H6 --> H7
    H5 -->|policy không đạt| G0["QUAY G · DUYỆT DRAFT"]
    H7 -->|không task chặn, policy đạt| H8 --> H9 --> I0["SANG I · DUYỆT VIDEO / QUEUE"]
    H7 -->|policy không đạt| H10
    H8 -->|exception| H10
```

Progress voice: `PREPARING_VOICE 10% → GENERATING_VOICE 30% → ALIGNING_VOICE 76% → SAVING_VOICE 95% → 100%`. Progress render: `PREPARING_RENDER 10% → RENDERING_VIDEO 30% → SAVING_VIDEO 95% → 100%`. Đây là mốc đặt trong code, không phải phần trăm thời gian thực hay mức chất lượng.

AUTO dùng Edge TTS nên không chạy DeepSeek emotion tagging. Nếu người dùng đổi sang ElevenLabs thì có nhánh tag giọng bằng DeepSeek trước TTS; đó là call bổ sung ngoài compact flow. Nếu có nhạc, bước voice đặt musicVolume=0.08; draft tự tạo ban đầu musicVolume=0 và không tự chọn nhạc.

**Cập nhật H4 ngày 31/08:** đã bổ sung ba import `prevent_timeline_text_overlap`, `fit_video_clips_to_text`, `normalize_audio_clips`; sửa mốc 0 không cộng một frame và căn theo `voice_text` nếu khác subtitle. Test mock transcript đã đi qua đường này và giữ liên kết media/text. Chưa gọi Whisper thật; lỗi API/audio vẫn có thể tạo `fit_frame_error` như trước.

Nguồn: [voice/render jobs](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/services/generate_video_jobs.py:726), [TTS](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/services/generate_video_voice.py:38), [alignment](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/services/generate_video_alignment.py:25), [renderer](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/services/generate_video_rendering.py:54), [Remotion settings](/D:/DATN/socialcontent_backend/data_demo/video_gen_demo/scripts/render-story.mjs).

## I. Duyệt video → tạo queue → scheduler đến giờ

```mermaid
flowchart TD
    I1{"I1 · MODULE 4 SAU RENDER<br/>VÀO: MP4 + story + strategy<br/>ĐK: draft policy vẫn đạt<br/>approval_mode=auto?"}
    I2["I2 · TỰ DUYỆT VIDEO<br/>VÀO: policy đạt và approval_mode auto<br/>LÀM: set video_approved=true, module4_review approved<br/>RA: video được duyệt; chưa đồng nghĩa đã upload<br/>Basic check là metadata render hoàn tất, không AI review MP4 riêng"]
    I3["I3 · CHỜ DUYỆT VIDEO TAY<br/>VÀO: approval_mode manual<br/>RA: RENDERED / WAITING_HUMAN_REVIEW<br/>Người dùng approve-video: phải có MP4 hiện hành, policy đạt, không active task<br/>Approve → video_approved=true; yêu cầu sửa → EDITING"]
    I4["I4 · CHỌN LỊCH AUTO SAU RENDER<br/>VÀO: schedule_days/times và thời gian UTC hiện tại<br/>LÀM: tìm slot đầu tiên trong hôm nay + 7 ngày tới<br/>Không lịch hoặc schedule tắt → fallback +1 giờ<br/>! Hàm này chưa đọc schedule_timezone<br/>RA: scheduled_at; không phân bổ quota/giãn slot giữa nhiều video"]
    I5{"I5 · TỰ ĐƯA VÀO QUEUE?<br/>VÀO: video approved + auto_queue_enabled<br/>true → tạo/cập nhật queue<br/>false → dừng VIDEO_APPROVED / AUTO_APPROVED"}
    I6["I6 · PUBLISHING QUEUE<br/>VÀO: workflow, MP4 URI, title/caption, profile, scheduled_at<br/>LÀM: tạo hoặc dùng queued_post_id đang có<br/>RA: PublishingQueueItem status=approved<br/>Workflow QUEUED_FOR_PUBLISHING; caption MĐ là title<br/>article_link ở đây là đường dẫn MP4, không phải URL bài nguồn"]
    I7["I7 · NHÁNH KHI MỞ TRANG QUEUE<br/>VÀO: list_user_queue → scan workflow RENDERED/VIDEO_APPROVED/QUEUED_FOR_PUBLISHING<br/>ĐK: policy đạt, có final video, chưa có queue hợp lệ<br/>RA: queue needs_approval, lịch hiện tại +2 giờ<br/>! Không kiểm auto_queue_enabled ở nhánh đồng bộ này"]
    I8["I8 · REVIEWER CHỌN LỊCH / ĐĂNG NGAY<br/>VÀO: queue item + lựa chọn người dùng<br/>Đăng ngay: approved, scheduled_at=now → gọi publish<br/>Chọn lịch AI: rule-based, không LLM; dùng schedule_timezone<br/>Slot phải sau now+5 phút; tìm 0–7 ngày; fallback +1 giờ<br/>Lịch tay phải ở tương lai; RA queue approved"]
    I9["I9 · PUBLISH SCHEDULER TICK<br/>VÀO: enable_scheduler + SystemSetting<br/>Chu kỳ MĐ 5 phút, cấu hình clamp 1–1440 phút<br/>Mỗi tick: poll tối đa 10 bài đang publishing trước<br/>Sau đó chọn tối đa 5 queue item đến giờ trên toàn hệ thống"]
    I10{"I10 · ELIGIBLE ĐỂ TỰ ĐĂNG?<br/>VÀO: queue + profile + strategy<br/>ĐK: platform=tiktok; queued/approved; scheduled_at ≤ now<br/>Profile active và access_token khác NULL<br/>schedule_enabled và auto_publish_enabled=true<br/>Nếu status=queued thì approval_mode phải auto"}
    I11["I11 · KIỂM TRA LẠI TRƯỚC UPLOAD<br/>VÀO: queue + workflow liên kết qua queued_post_id<br/>AUTO: chưa REJECTED; draft policy đạt<br/>Có FINAL_VIDEO hiện hành không STALE; article_link trùng URI này<br/>RA: được upload hoặc HTTP 409; không đăng bản render cũ"]
    IW["CHỜ / KHÔNG CHỌN TRONG TICK<br/>VÀO: chưa đến giờ, thiếu token, tắt auto_publish hoặc sai trạng thái<br/>RA: queue vẫn còn; không tự bị xóa"]
    I1 -->|policy không đạt| G0["QUAY G · REVIEW DRAFT"]
    I1 -->|auto| I2 --> I5
    I1 -->|manual| I3 -->|người dùng duyệt| I5
    I5 -->|true| I4 --> I6
    I5 -->|false| IS["VIDEO_APPROVED · CHƯA TẠO QUEUE Ở NHÁNH NÀY"]
    IS -.->|người dùng mở trang queue| I7
    I3 -.->|mở trang queue| I7 --> I8
    I6 --> I9 --> I10
    I8 -->|lên lịch| I9
    I8 -->|đăng ngay| I11
    I10 -->|đạt| I11 -->|hợp lệ| J0["SANG J · TIKTOK DIRECT POST"]
    I10 -->|không| IW
    I11 -->|draft/video cũ| G0
```

`5 item/tick` không phải 5 bài/profile và cũng không phải quota ngày. Query lấy 5 item trước rồi mới xét một số công tắc strategy: item bị bỏ qua không được tự bù bằng item thứ 6 trong cùng lượt. `max_system_recommendations=20` và `post_frequency_per_day=2` không hạn chế số workflow/video ở đường AUTO này. Nhiều video có thể nhận cùng slot `08:30` hoặc `20:30`.

Nhánh auto schedule hiện dùng `datetime.utcnow()` để ghép `schedule_times`; nhánh “AI chọn lịch” trên queue dùng `ZoneInfo(schedule_timezone)`. Do đó chưa thể hiểu cùng chuỗi `08:30` là cùng giờ địa phương ở cả hai nhánh. Scheduler có thể đợi lâu hơn chu kỳ danh nghĩa vì mỗi lượt xử lý upload tuần tự rồi mới sleep.

Nguồn: [policy sau render và lịch auto](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/services/generate_video_jobs.py:1077), [approve-video/queue API](/D:/DATN/socialcontent_backend/services/api-service/app/api/routes/generate_video.py:619), [queue sync và lựa chọn lịch](/D:/DATN/socialcontent_backend/services/api-service/app/services/social_profiles.py:613), [publish scheduler](/D:/DATN/socialcontent_backend/services/api-service/app/services/publish_scheduler.py:132).

## J. Push video lên TikTok và phân biệt upload với publish

Các số dưới đây mô tả **client code trong repo**, không khẳng định giới hạn hiện hành của nền tảng TikTok. Scheduler này chỉ tự đăng TikTok; không có nhánh auto Facebook/YouTube/Instagram tương đương trong đường đang trace.

```mermaid
flowchart TD
    J1["J1 · PUBLISH ENTRY<br/>VÀO: queue_id + user + mode + caption/MP4<br/>Scheduler gọi source=scheduler, mode=direct<br/>ĐK: đúng user; profile TikTok; queue ở trạng thái cho phép<br/>Đã publishing và có publish_id → poll, không upload lại"]
    J2{"J2 · QUYỀN VÀ FILE<br/>VÀO: profile scopes + đường dẫn MP4<br/>Direct cần video.publish; inbox cần video.upload<br/>ĐK: file tồn tại, là file và size lớn hơn 0<br/>Thiếu quyền không tự fallback direct sang inbox"}
    J3["J3 · TOKEN<br/>VÀO: access_token + expires_at + refresh_token<br/>ĐK: thiếu token hoặc hết hạn trong ≤5 phút → refresh<br/>Refresh cần refresh_token; HTTP timeout 20 giây<br/>RA: token/scopes/expiry cập nhật hoặc lỗi yêu cầu kết nối lại"]
    J4["J4 · INIT DIRECT POST<br/>VÀO: token + creator_info + caption + size<br/>Creator info timeout 20 giây; caption cắt 2200 ký tự<br/>Privacy MĐ SELF_ONLY; nếu không có trong options thì fallback option hợp lệ<br/>is_aigc MĐ true; init timeout 30 giây<br/>RA: upload_url + publish_id"]
    J5["J5 · INIT INBOX — NHÁNH TAY<br/>VÀO: token + file size; scope video.upload<br/>LÀM: tạo upload gửi vào inbox creator<br/>RA: upload_url + publish_id<br/>Không phải lệnh xuất bản công khai lên trang"]
    J6["J6 · UPLOAD CHUNKS<br/>VÀO: MP4 bytes + upload_url<br/>chunk_size=min(file_size,64 MiB); số chunk=ceil(size/chunk_size)<br/>PUT tuần tự Content-Range; timeout 120 giây/chunk request<br/>ĐK thành công HTTP 200/201/206<br/>RA: video đã gửi; chưa khẳng định publish thành công"]
    J7["J7 · FETCH / POLL STATUS<br/>VÀO: token + publish_id<br/>Sau upload fetch 1 lần; Direct chưa terminal thì poll thêm tối đa 3 lần<br/>Nghỉ 5 giây giữa các lần; mỗi status request timeout 20 giây<br/>RA: PUBLISH_COMPLETE / FAILED / PUBLISH_FAILED / đang xử lý"]
    J8["J8 · DIRECT HOÀN TẤT<br/>VÀO: PUBLISH_COMPLETE<br/>RA: queue published + published_at<br/>Upsert SocialPost status published_to_tiktok<br/>Lưu publish_id, post_id nếu có; có username/id thì dựng URL TikTok<br/>Chưa post_id: vẫn lưu theo publish_id, bổ sung sau"]
    J9["J9 · DIRECT CÒN XỬ LÝ<br/>VÀO: trạng thái chưa terminal<br/>RA: queue publishing, published_at=NULL<br/>Tick scheduler sau poll tối đa 10 item publishing/lượt<br/>Không có trần tổng số lần poll trong nhánh này"]
    J10["J10 · LỖI PUBLISH<br/>VÀO: lỗi upload/API trong nhánh gửi hoặc terminal FAILED/PUBLISH_FAILED<br/>RA: queue failed + error; không tạo SocialPost thành công<br/>Scheduler chỉ lấy queued/approved nên không tự retry failed<br/>Có thể retry tay sau khi xử lý nguyên nhân"]
    J11["J11 · INBOX ĐÃ NHẬN<br/>VÀO: upload inbox trả thành công<br/>RA hiện tại: queue published nhưng SocialPost=sent_to_tiktok_inbox<br/>Người dùng còn phải hoàn tất đăng trong TikTok<br/>Không đồng nghĩa video đã xuất hiện công khai"]
    J1 -->|lượt gửi mới| J2 --> J3
    J1 -->|đã có publish_id đang xử lý| J7
    J2 -->|thiếu scope/file| JE["HTTP ERROR · DỪNG TRƯỚC GỬI"]
    J3 -->|direct| J4 --> J6
    J3 -->|inbox| J5 --> J6
    J3 -->|refresh thất bại| J10
    J6 -->|upload lỗi| J10
    J6 -->|đã gửi| J7
    J7 -->|direct COMPLETE| J8
    J7 -->|direct chưa xong| J9 -->|tick sau| J7
    J7 -->|direct FAILED| J10
    J7 -->|inbox response thành công| J11
```

Luồng AUTO không truyền `privacy_level`, nên client chọn mặc định `SELF_ONLY` nếu option này được hỗ trợ. Vì vậy **“Direct Post thành công” không có nghĩa “video công khai cho mọi người”**. Phải xem privacy được chọn và trạng thái TikTok trả về.

`publish_id` là mã tác vụ upload/publish; `post_id` là mã video trên nền tảng. Hai giá trị khác nhau. Hàm complete đang trace cập nhật `PublishingQueueItem` và `SocialPost`, không trực tiếp chuyển `MediaWorkflow.status` sang `PUBLISHED`. Vì thế không chỉ nhìn trạng thái workflow để kết luận video đã đăng.

Các lỗi guard trước khi item được set `publishing` — chẳng hạn draft cũ, thiếu scope hoặc đường dẫn không resolve được — có thể trả HTTP lỗi mà giữ nguyên trạng thái queue. Đây khác lỗi upload/API trong `try`, nơi code ghi `failed`. Bộ đếm `published` của scheduler tăng khi hàm publish trả về; nó không phải bằng chứng từng video đã có `PUBLISH_COMPLETE`.

Nguồn: [publish orchestration](/D:/DATN/socialcontent_backend/services/api-service/app/services/social_profiles.py:1310), [TikTok request/chunk/token/privacy](/D:/DATN/socialcontent_backend/services/api-service/app/services/tiktok_posting.py:146), [complete và poller](/D:/DATN/socialcontent_backend/services/api-service/app/services/social_profiles.py:1103).

## K. Nhánh hạ tầng, retry và sự kiện bị lặp/mất

```mermaid
flowchart TD
    K1{"K1 · KAFKA CÓ BẬT?<br/>VÀO: disable_kafka<br/>false → publish/consume sự kiện<br/>true → từng service có hành vi fallback riêng"}
    K2["K2 · ĐƯỜNG KAFKA<br/>VÀO: event envelope; key=job_id hoặc correlation_id<br/>LÀM: consumer commit offset sau xử lý<br/>Idempotency lưu KafkaTask với key consumer:event_id<br/>RA: bỏ event đã claim; không bảo đảm end-to-end exactly-once"]
    K3["K3 · DB POLLING KHI TẮT KAFKA<br/>Orchestrator: PENDING job, mỗi 2 giây<br/>Crawler: QUEUED task, mỗi 2 giây<br/>Canonical: Mongo document chưa NORMALIZE, mỗi 2 giây<br/>Voice/render: PENDING task, mỗi 5 giây<br/>Embedding consumer và AUTO planning consumer: IDLE"]
    K4["K4 · PHỤC HỒI VIDEO TASK<br/>VÀO: task RUNNING/PROCESSING, started_at quá 10 phút<br/>LÀM: DB sweep → PENDING / QUEUED_RETRY, progress 0<br/>Chạy sweep khi startup, trước Kafka record; polling khi fallback<br/>RA: task được thử lại, không phải giới hạn repair compact"]
    K5["K5 · PUBLISH EVENT LỖI<br/>VÀO: Kafka timeout/connection error<br/>Producer block/request timeout 1000 ms; flush timeout 1 giây<br/>Code publish bắt lỗi và chỉ in warning<br/>RA: DB có thể đã commit nhưng event không đến; chưa có outbox replay bảo đảm"]
    K6["K6 · CẦN PHÂN BIỆT CÁC RETRY<br/>Crawler: MĐ tổng 4 attempts, có backoff<br/>Compact: tối đa 1 repair, chỉ khi có lỗi sửa được<br/>Edge TTS: tổng 3 attempts, nghỉ 2 giây<br/>Video task: stale recovery sau 10 phút<br/>TikTok poll: hỏi trạng thái, không phải upload lại"]
    K1 -->|bật| K2
    K1 -->|tắt| K3
    K2 -->|publish thất bại| K5
    K2 -.-> K4
    K3 -.-> K4
    K6 -.-> K4
```

! Fallback crawler DB polling hiện đọc `source_type/source_url/keywords/configuration` từ task payload, trong khi orchestrator đang lưu chủ yếu `job_source_id/external_reference` ở payload đó. Vì vậy không thể coi chế độ tắt Kafka là đường AUTO đầy đủ tương đương Kafka. Hơn nữa AUTO planning consumer sẽ idle khi `disable_kafka=true`.

! Ngưỡng stale task **10 phút** nhỏ hơn timeout render mặc định **30 phút**. Với nhiều worker/sweep, một render còn hợp lệ nhưng lâu có thể bị coi là stale; đây là khác biệt cần kiểm chứng bằng integration test, không phải timeout render chỉ 10 phút.

Nguồn: [Kafka adapter](/D:/DATN/socialcontent_backend/common/events/kafka.py), [event claim](/D:/DATN/socialcontent_backend/common/db/idempotency.py), [video DB sweep](/D:/DATN/socialcontent_backend/services/ai-media-engine/app/video/consumers/generate_video_requested.py:47), [crawler polling](/D:/DATN/socialcontent_backend/services/data-ingestion-engine/app/crawler/consumers/task_requested.py).

## 1. Dữ liệu được lưu ở đâu và ai dùng tiếp?

| Dữ liệu | Nội dung chính | Bên ghi → bên đọc tiếp |
|---|---|---|
| `CrawlJob` + `CrawlJobSource` | Nguồn, scope/owner, mode, lịch, status và counter | API/scheduler → orchestrator/crawler/canonical |
| `KafkaTask` CRAWL_URL | reference job, payload nguồn, attempt/status/error | Orchestrator → crawler |
| Mongo `processed_documents` | normalized text/transcript, media, quality, source metadata | Crawler/normalizer → canonical; full text → embedding/planner |
| `ContentItem` | Canonical id/title/summary/quality/status/hash, sources/media, mongo id, crawl_job_id | Canonical → matcher/planner |
| `Story` + content episode order | Nhóm/episode của nguồn Bilibili | Canonical grouping → giao diện/luồng nguồn; không phải output series |
| `ContentEmbedding` | content_id, model, vector, embedding_text, dimension | Embedding service → matcher và centroid series |
| `TopicEmbedding` | Vector topic+description, model/cache hash | Matcher → so topic/avoid cho nhiều bài |
| `ProfileContentLink` | Candidate score/status/reasons/AI decision theo profile/content | Canonical khởi tạo; AUTO matcher cập nhật → giao diện Content |
| `PlanningRun` / `PlanningCandidate` | Một lần xét theo profile/job; rank, eligible, selected, decisions, workflow_id | AUTO consumer → lịch sử quyết định |
| `ContentSeries` | Title/theme, ACTIVE, total_parts, current_part | Khi PASS/duyệt + chọn series → workflow kế tiếp dùng làm context |
| `MediaWorkflow.draft_json` | `meta`, `source`, `timeline`, `story_data`, `compact_scenes`, `audio`, `video_artifacts` | Planner/API/worker → editor, TTS, renderer |
| `MediaWorkflow.metadata_json` | production gate, draft quality/risk, signatures, pending series, approvals, queued_post_id | Planner/reviewer/worker → policy ở API/worker/publish |
| `KafkaTask` GENERATE_VIDEO_* | workflow reference, task parameters, progress, result/error | API/planner → video worker |
| `PromptRun` | Prompt/result/usage của những bước có logging | LLM/embedding/TTS wrapper → theo dõi chi phí và debug |
| `assets/audio/*.mp3` | Voice vật lý; draft lưu URI tương đối | TTS → Whisper/Remotion |
| `out/final-*.mp4` + `artifacts_jsonb` | File MP4; artifact URI/status/task_id | Renderer → preview/queue/TikTok upload |
| `PublishingQueueItem` | Profile, MP4 URI, caption, schedule, publish_id/status/error | Module 4/reviewer → publish scheduler/service |
| `SocialPost` | publish_id, post_id/URL nếu có, caption, published time/status | TikTok complete/inbox → trang bài đăng và analytics |

File media nằm dưới `socialcontent_backend/data_demo/video_gen_demo/public/assets/audio` và `socialcontent_backend/data_demo/video_gen_demo/out`. Kafka chủ yếu mang **ID để worker tải dữ liệu từ DB/Mongo**, không chở toàn bộ MP3/MP4. Dữ liệu video chỉ được gửi thành bytes ở bước upload TikTok.

## 2. Các trạng thái trông giống nhau nhưng khác ý nghĩa

| Trạng thái | Nghĩa đúng |
|---|---|
| `ContentItem.READY` | Nguồn đủ điểm cấu trúc/dữ liệu; chưa chắc phù hợp profile hoặc đáng sản xuất. |
| Candidate `eligible=true` | Qua topic/avoid/video-source gate; chưa qua production decision. |
| Production `PRODUCE` | Được phép sinh draft; chưa có kết quả quality draft. |
| Production `REVIEW_REQUIRED` | Dừng trước workflow; không có draft để approve-draft. |
| `DRAFT_REVIEW_REQUIRED` | Đã có workflow/draft nhưng chặn voice/render. |
| `DRAFT_READY` | Draft được phép tiếp tục; `video_render_mode=manual` vẫn dừng chờ. |
| `VOICE_READY` | Có voice; alignment có thể có lỗi được lưu, không chắc khớp hoàn hảo. |
| `RENDERED` | Có render result; chưa đồng nghĩa đã duyệt/queue/publish. |
| `VIDEO_APPROVED` | Đã duyệt video; chưa chắc có queue. |
| `QUEUED_FOR_PUBLISHING` | Đã có item hàng đợi, không chắc đã đến giờ hay auto_publish bật. |
| Queue `approved` | Được duyệt trong hàng đợi; vẫn còn guard và điều kiện lịch/token. |
| Queue `publishing` | TikTok chưa xác nhận terminal; cần poll tiếp. |
| Queue `published` + SocialPost `published_to_tiktok` | Direct Post hoàn tất; độ hiển thị còn phụ thuộc privacy. |
| Queue `published` + SocialPost `sent_to_tiktok_inbox` | Đã gửi inbox; người dùng còn phải xuất bản trong TikTok. |

## 3. Những điểm hiện trạng không nên hiểu nhầm

1. **W1 — Alignment đã sửa lỗi thiếu helper trong code ngày 31/08.** Test mock đã qua; chưa khẳng định Whisper thật hay render end-to-end đã thành công.
2. **W2 — Lịch auto sau render chưa dùng timezone profile.** Nhánh queue “AI chọn lịch” lại dùng timezone; hai nhánh chưa thống nhất. Không coi `08:30` là 08:30 giờ Việt Nam ở mọi đường đi.
3. **W3 — Chưa có quota sản xuất/ngày ở consumer AUTO.** Tối đa 500 nguồn/job được xét, mọi eligible có thể tạo workflow cho từng profile; mặc định 20 recommendations và 2 post/ngày không được dùng để chặn ở đây.
4. **W4 — AUTO không tự bảo đảm public.** Scheduler chỉ Direct Post TikTok, privacy mặc định SELF_ONLY. Upload inbox và Direct Post có ý nghĩa khác nhau dù queue có thể cùng ghi published.
5. **W5 — Tắt Kafka làm mất đường kích hoạt AUTO planning.** Crawl/video có fallback riêng nhưng AUTO consumer idle; Kafka publish lỗi hiện chỉ warning, không có bảo đảm outbox/replay xuyên suốt.
6. **W6 — Phạm vi dữ liệu cần rà lại trước production.** Scheduler nguồn không copy `content_scope/created_by_type` sang SCHEDULED_RUN, nên rơi về default GLOBAL/SYSTEM của model. Query AUTO lại chỉ lọc crawl_job_id/status, không lọc PRIVATE owner theo profile. Đây là thiếu kiểm tra trong code đang trace, không phải hành vi phân quyền nên mặc định chấp nhận.
7. **W7 — V2 dùng được ảnh/video nguồn, không tự tìm/generate visual.** Image thiếu nguồn vẫn dùng ảnh demo. `require_video` chỉ là gate nguồn, không ép mọi clip phải là video.
8. **W8 — Tắt auto_queue không ngăn mọi cách tạo queue.** Mở trang queue có nhánh đồng bộ workflow rendered/approved sang needs_approval; xem I7.
9. **W9 — Đừng suy ra đã đăng từ MediaWorkflow hoặc counter scheduler.** Xem trạng thái queue + SocialPost + response TikTok; có publish_id chưa chắc có post_id hay public URL.

Ngoài W1/W7 được cập nhật rõ ở trên, các mục còn lại vẫn là ghi nhận của lượt vẽ ban đầu. Regression tests không thay thế integration test thật cho toàn chuỗi crawl, Whisper, Kafka, lịch và TikTok.

## 4. Ví dụ đường đi để đọc sơ đồ

**Ví dụ minh họa, không phải dữ liệu thực:** nguồn mới READY, Q=90; profile T=0.62, S=0.73, không avoid, risk MEDIUM, ít nhất 3 facts, không từ nhạy cảm → D4 đi thẳng PRODUCE. Series tốt nhất score=0.81, thứ hai=0.68, có 4 vector khác content_id → fixed USE_EXISTING. Compact quality=92, không CRITICAL → lưu draft PASS và ký phiên bản. Nếu `video_render_mode=auto` → Edge TTS rồi thử alignment, render; `approval_mode=auto` → duyệt; `auto_queue_enabled=true` → queue. Đến lịch, còn cần `schedule_enabled=true`, `auto_publish_enabled=true`, token và `video.publish` mới gửi TikTok. Direct Post mặc định SELF_ONLY; chỉ khi TikTok trả PUBLISH_COMPLETE mới hoàn tất Direct Post.

**Ví dụ nhánh review:** cùng bài nhưng S=0.65 → qua cosine 0.62 nhưng chưa đạt 0.70 để bypass Fit Judge. Fit risk HIGH → dừng trước series, không tạo workflow. Nếu Fit PRODUCE nhưng draft có số liệu không có trong facts → một repair; vẫn lỗi → tạo draft chờ duyệt, chưa gắn pending series, không TTS. Người dùng duyệt đúng chữ ký mới tiếp tục; sửa lời thoại sau đó sẽ hủy duyệt và vô hiệu hóa media cũ.
