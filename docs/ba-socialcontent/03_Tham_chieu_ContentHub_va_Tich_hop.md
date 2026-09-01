# Tham chiếu công cụ Creator và phạm vi tích hợp

**Tra cứu ngày 01/09/2026.** Chỉ lấy ý tưởng phục vụ Creator cá nhân; không sao chép mô hình nhóm, cửa hàng hoặc phạm vi thương mại của công cụ tham khảo. Đề xuất không có nghĩa dự án đã có tính năng hoặc được cấp cùng quyền API.

## 1. Năng lực phù hợp để tham khảo

| Nguồn chính thức | Năng lực tham khảo | Áp dụng cho dự án |
|---|---|---|
| [Buffer Home](https://support.buffer.com/en-us/articles/using-buffer-home-WXHZkDiPYb) | Tập trung bản nháp, lịch sắp tới, bình luận và thói quen đăng | E01.04: dashboard cá nhân và việc cần làm; không lấy mô hình tổ chức của Buffer |
| [Buffer — giới thiệu sản phẩm](https://support.buffer.com/en-us/articles/what-is-buffer-and-where-can-i-watch-a-demo-nXDfoFkLiL) | Lập lịch, phân tích và trả lời tương tác | T16–T18: quản lý kênh và cải thiện hiệu quả nội dung của một Creator |
| [Metricool Autolists](https://metricool.com/autolists-social-media-management/) | Danh sách nội dung định kỳ, lịch chạy và khả năng tạm dừng | E16.04: tái sử dụng nội dung còn giá trị, có cooldown, hạn dùng và chống spam |
| [Metricool SmartLinks](https://metricool.com/metricool-smartlinks/) | Tổ chức liên kết tới các điểm đến của Creator | Chỉ lấy nhu cầu quản lý link cho T31; **không** xây trang bio riêng hoặc đo conversion |
| [Repurpose.io](https://repurpose.io/) và [trợ giúp workflow](https://support.repurpose.io/en/) | Tái sử dụng nội dung theo định dạng/kênh và tự động phân phối | E14.03–04, E16.02: tạo biến thể và adapter đăng; chỉ dùng media có quyền |
| [OpusClip — hướng dẫn kết quả](https://help.opus.pro/docs/article/get-clips-faq-1) | Clip ngắn và điểm gợi ý khả năng thu hút | E14.03 cắt clip; E11.04 hook; E17.04 kiểm chứng hiệu quả bằng số liệu thực |
| [Beacons — sử dụng link affiliate](https://help.beacons.ai/en/articles/4701889) | Tầm quan trọng của liên kết riêng để dẫn tới sản phẩm affiliate | E31.01–02: Creator tự cung cấp URL và hệ thống giữ nguyên tham số; **không** đồng bộ chương trình, đơn hoặc hoa hồng |

Đây là suy luận BA về những năng lực phù hợp, không phải bảng xếp hạng sản phẩm hay bằng chứng SocialContent sẽ đạt mức tăng trưởng tương tự. Không sao chép bảng giá và giới hạn của các công cụ tham khảo.

## 2. Căn cứ cho các giới hạn bắt buộc

- App và người dùng cần quyền đăng phù hợp; tồn tại code OAuth chưa chứng minh ứng dụng đã đủ điều kiện xuất bản trong mọi hoàn cảnh. [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started).
- Quota và thủ tục audit phải theo dõi theo API/tài khoản, không hardcode như cam kết cố định. [YouTube Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).
- Bản quyền, tiêu chuẩn cộng đồng và điều kiện kiếm tiền là các cổng riêng. Nội dung tái sử dụng hoặc sản xuất hàng loạt thiếu giá trị gốc có thể gặp vấn đề kiếm tiền. [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392?hl=en-EN).
- Robots không tự cấp quyền truy cập hay khai thác dữ liệu. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html).
- Webhook có thể trùng và đến không đúng thứ tự; yêu cầu xác minh/chống lặp áp dụng cho thanh toán phí SocialContent. Không có nghĩa đã chọn Stripe. [Stripe Webhooks](https://docs.stripe.com/webhooks).
- Quyền đối tượng, tài nguyên không giới hạn, SSRF và API ngoài là những vùng cần kiểm thử. [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).

## 3. Ma trận nền tảng mục tiêu

“Đề xuất” là nhu cầu cần khảo sát API, không phải xác nhận mọi thao tác đã khả dụng. Phải xác minh riêng từng khả năng: đọc nguồn, tải media, đăng, sửa/gỡ, analytics, bình luận và vị trí gắn link. Không hỗ trợ thì nêu giới hạn hoặc dùng xuất/nhập thủ công, không lách quyền.

| Nền tảng/nguồn | Hiện trạng khảo sát | Mục tiêu giới hạn | Điều kiện |
|---|---|---|---|
| VNExpress | Có crawler URL/RSS | Lấy bài và metadata làm tư liệu sáng tạo | Quyền khai thác, robots, quyền media |
| Bilibili | Có crawler metadata video/playlist | Khám phá nội dung và thứ tự tập | Metadata không phải quyền tải/tái xuất bản |
| Website/RSS/Atom khác | Đề xuất | Nguồn tin theo ngách được phép | Adapter, allowlist, tốc độ, SSRF, điều khoản |
| TikTok | Có code kết nối, đăng, analytics | Hoàn thiện vận hành kênh và link nơi được phép | App review, scope, loại tài khoản và quota |
| YouTube/Shorts | Đề xuất | Nguồn hợp lệ, đăng video, phân tích kênh | Scope/quota; không tải transcript/video tùy ý |
| Facebook/Instagram | Đề xuất | Đăng biến thể, analytics, tương tác hợp lệ | Loại tài khoản, quyền, định dạng, app review |
| Threads/X | Đề xuất theo nhu cầu | Bài ngắn, link, phản hồi được hỗ trợ | Khả năng endpoint, quyền và chi phí API |
| Pinterest | Đề xuất theo nhu cầu | Ảnh/video và link tới điểm đến | Quyền đăng, định dạng và quy tắc link |
| Reddit/diễn đàn | Đề xuất nguồn chọn lọc | Khám phá câu hỏi/chủ đề công khai được phép | Điều khoản, phạm vi đọc; không spam quảng bá |
| WordPress/CMS cá nhân | Đề xuất | Nhập bài của mình hoặc đăng ra blog của mình | Credential, quyền asset và chống đăng trùng |
| Drive/Dropbox/kho file cá nhân | Đề xuất | Nhập tư liệu và lưu đầu ra | Chỉ file được cấp quyền, revoke và giới hạn tải |
| File/text/podcast cá nhân | Đề xuất nhập mở rộng | Tạo nội dung từ tư liệu Creator có quyền | Kiểu file, mã độc, quyền sử dụng, tài nguyên |
| Link sản phẩm/affiliate bất kỳ | Chức năng đề xuất T31 | **Chỉ lưu URL, kiểm tra và gắn vào nội dung** | Giữ tham số, nhãn quảng cáo, vị trí link và an toàn đích |

Không có connector cửa hàng, catalog, tồn kho, đơn hàng, giao dịch người mua, hoa hồng hoặc doanh thu bán hàng trong phạm vi cuối cùng. Không tạo website link-in-bio. Nếu một kênh chỉ cho đặt link ở bio, hệ thống hướng dẫn Creator thực hiện trên chính kênh đó.

Ưu tiên một adapter có giá trị và đủ quyền tại một thời điểm. Năng lực công cụ tham khảo không bảo đảm dự án được truy cập cùng dữ liệu.
