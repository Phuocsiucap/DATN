# SocialContent — Phạm vi, quy tắc và lộ trình

**Bản BA v1.0 · 01/09/2026 · Đề xuất để refinement, chưa phải cam kết triển khai.**

## 1. Phạm vi đã chốt theo yêu cầu chủ dự án

Hệ thống chỉ có **Admin** và **Creator**. Creator là một cá nhân, có thể quản lý nhiều kênh của chính mình. Không xây tổ chức, hội nhóm, cộng tác nhiều người, mời thành viên, agency, phân quyền doanh nghiệp hay đồng sở hữu dự án.

Mục đích xuyên suốt: **tìm ý tưởng → tạo nội dung → đăng đa nền tảng → tăng tương tác và xây kênh → gắn link sản phẩm/affiliate để dẫn người xem tới nơi kiếm tiền bên ngoài**.

“Dự án cá nhân” chỉ là cách Creator sắp xếp công việc của mình. Một dự án thuộc một Creator. API key cá nhân cũng chỉ đại diện cho quyền Creator đã cấp; không tạo vai trò người dùng thứ ba.

Phạm vi kiếm tiền **chỉ dừng ở lưu và gắn URL sản phẩm/affiliate** theo vị trí kênh cho phép. Người xem có thể đi theo link tới nơi bán hàng bên ngoài; SocialContent không xử lý giao dịch đó và không có tài khoản Buyer/Seller.

**Không thuộc backlog:** đồng bộ cửa hàng/catalog, giá/tồn kho, giỏ hàng, đơn hàng, thanh toán người mua, giao hàng, thu/chi hộ, đối soát hoa hồng, báo cáo doanh thu bán hàng, đồng bộ chương trình affiliate. Cũng không xây website link-in-bio riêng hoặc hệ thống theo dõi chuyển đổi; có thể hướng dẫn Creator đặt link ở bio của kênh khi bài đăng không hỗ trợ link nhấp được.

Luồng Creator:

**Tạo tài khoản → kết nối kênh → chọn mục tiêu và ngách nội dung → cấu hình nguồn → crawl/nhập → chọn bài → AI draft → biên tập/media/voice → video hoặc định dạng khác → tự duyệt → gắn link nếu cần → lên lịch/đăng → trả lời tương tác → xem analytics → cải thiện nội dung.**

Luồng Admin:

**Quản lý người dùng → cấu hình nguồn/provider/gói/hạn mức → theo dõi hoạt động và chi phí → quản lý bài người dùng, vi phạm và khiếu nại → thanh toán/hỗ trợ → bảo mật, cloud và khôi phục sự cố.**

## 2. Hiện trạng và cách đọc backlog

Đã đọc tài liệu chương 2 hiện có, README backend, tài liệu AUTO/publishing, các route/model và cấu trúc frontend. Tài liệu cũ có 7 Theme, 11 Epic, 30 story. Bản mới giữ bảng đối chiếu với 30 story đó, không ghi đè báo cáo cũ.

Có bằng chứng mã/tài liệu cho: đăng nhập và quyền cơ bản; social profile thuộc user; crawl VNExpress và metadata Bilibili; chuẩn hóa, chống trùng, Story/Episode; chiến lược kênh; planning; draft/video/voice/render; duyệt/lịch; TikTok publishing; analytics; theo dõi usage AI. Không coi sự tồn tại của route hoặc màn hình là đã nghiệm thu.

Chưa thấy đầy đủ trong phạm vi khảo sát: thanh toán/gói/credit/quota dịch vụ, thư viện link sản phẩm/affiliate, các connector mới, hệ thống xử lý vi phạm và khiếu nại hoàn chỉnh. Các năng lực này là đề xuất; không kết luận tuyệt đối rằng ở nơi khác không có code liên quan.

Không gọi dịch vụ AI, TikTok hoặc cổng thanh toán để kiểm chứng. Tài liệu AUTO hiện có cũng lưu ý chưa xác nhận toàn luồng với dịch vụ thật. Working tree có thay đổi đang phát triển, không mặc định đó là bản đã phát hành.

- `Txx`: Theme, nêu kết quả sản phẩm và chỉ số đánh giá.
- `Exx.yy`: Epic, nêu năng lực, ưu tiên, giai đoạn và phụ thuộc chính.
- `USxx.yy.zz`: User Story có đúng một actor **Admin hoặc Creator**, mục đích và hai tiêu chí nghiệm thu riêng.
- `Bxx`: bằng chứng mã/tài liệu liên quan một phần story. AC mới vẫn cần kiểm chứng; không tự đánh dấu Done.
- Không có Bxx: đề xuất mới/chưa thấy trong phạm vi khảo sát.
- Yêu cầu cloud, bảo mật, migration và vận hành là yêu cầu hỗ trợ sản phẩm, viết theo lợi ích của Admin. Việc triển khai chúng cần task kỹ thuật riêng; không bổ sung vai trò DevOps/Developer vào hệ thống.

Priority và release được đề xuất ở cấp epic, story kế thừa để lọc. Chưa ước lượng story point, ngày giao hoặc người thực hiện vì chưa biết năng lực đội. Trước sprint phải tách tiếp story quá lớn và kiểm tra phụ thuộc theo phạm vi thực chọn.

## 3. Ma trận quyền hai vai trò

| Năng lực | Creator | Admin |
|---|---|---|
| Kênh xã hội | Kết nối, cấu hình, ngắt kênh của mình | Xem tình trạng kết nối phục vụ quản trị; không xem token thô |
| Nguồn, draft, media, video | Tạo và quản lý tài sản cá nhân | Quản lý theo nghiệp vụ vận hành/vi phạm, có audit |
| Duyệt biên tập | Tự duyệt nội dung mình định đăng | Không cần trở thành người biên tập cho mọi Creator |
| Lịch và đăng bài | Thao tác trên kênh mình được ủy quyền | Có thể chặn/hủy khi vi phạm; không mặc nhiên đăng thay Creator |
| Bài đã đăng | Xem, sửa/gỡ trong khả năng nền tảng | Tra cứu bài Creator, kiểm duyệt, xử lý và theo dõi yêu cầu gỡ |
| Analytics nội dung | Xem số liệu kênh và bài của mình | Tổng hợp vận hành; dữ liệu chi tiết chỉ cho mục đích hợp lệ |
| Link sản phẩm/affiliate | Lưu và gắn URL của mình | Kiểm tra link độc hại và đích đến vi phạm |
| Gói/thanh toán/hạn mức | Mua gói, xem hóa đơn, usage; yêu cầu hoàn tiền | Quản lý gói, giao dịch, hoàn tiền, quota và đối soát |
| Báo cáo vi phạm/khiếu nại | Gửi và theo dõi hồ sơ của mình | Xét, quyết định, thông báo và xử lý khiếu nại |
| Người dùng/cấu hình/cloud | Không truy cập quản trị | Quản trị theo chính sách, xác thực mạnh và audit |

Admin không có quyền bỏ qua nghĩa vụ bảo vệ dữ liệu hoặc xóa dấu vết hành động. Nếu hệ thống có nhiều tài khoản Admin thì có thể giao Admin khác xét khiếu nại; tất cả vẫn là cùng vai trò Admin, không phát sinh role mới.

## 4. Quy tắc nghiệp vụ quan trọng

| ID | Quy tắc | Epic chính |
|---|---|---|
| BR01 | Đăng ký công khai chỉ tạo Creator; không nhận quyền Admin từ request của người đăng ký. | E01.01, E03.03 |
| BR02 | Tách dữ liệu bằng Creator/user_id trên API, worker, file, cache, search và export. Đổi ID không đọc/sửa được tài sản người khác. | E02.01, E24.01 |
| BR03 | Đọc được nguồn không đồng nghĩa được tải, lưu lâu, biến đổi hoặc đăng lại để kiếm tiền. | E06.03, E12.02, E25.03 |
| BR04 | Chỉ crawl/đăng qua phương thức được phép. Không vượt CAPTCHA, paywall hoặc giới hạn truy cập; không tự chọn adapter khác cho nguồn lạ. | E04.03, E06.03 |
| BR05 | Giữ nguồn gốc từ nguồn → canonical → draft → media → post. Không ghi đè mất lịch sử khi nội dung thay đổi. | E07.01 |
| BR06 | AI không tự có quyền đăng, chi tiền hoặc chọn provider ngoài chính sách; nội dung nguồn là dữ liệu, không là chỉ dẫn cho hệ thống. | E10.02, E11.02 |
| BR07 | Tạo nội dung, Creator tự duyệt, chọn lịch và thực hiện đăng là các quyết định riêng. Tự động đăng mặc định tắt. | E15.01, E16.01 |
| BR08 | Duyệt gắn phiên bản/hash. Thay nội dung, media hoặc metadata quan trọng yêu cầu duyệt lại. | E11.01, E15.01 |
| BR09 | Trước dispatch phải kiểm tra lại owner, trạng thái tài khoản, scope/token, phê duyệt, vi phạm, quyền media, quota và lịch. | E16.01, E21.02, E32.04 |
| BR10 | Lưu UTC; hiển thị timezone IANA. Giờ mơ hồ do DST phải xác nhận. Không đổi lịch thủ công thành lịch AI ngoài ý muốn. | E06.01, E16.01 |
| BR11 | Timeout không chứng minh hành động thất bại. Đối soát kết quả ngoài hệ thống trước khi retry charge hoặc publish. | E16.02, E20.01 |
| BR12 | Đăng đa kênh có kết quả từng kênh. Không có rollback nguyên tử xuyên nền tảng; retry chỉ đích chưa hoàn tất. | E16.02 |
| BR13 | Upload hoàn tất khác provider đang xử lý và khác bài đã xuất bản. Ẩn nội bộ khác bài đã được gỡ bên ngoài. | E16.02, E32.04 |
| BR14 | Không tạo tương tác giả, mua bot, tự click affiliate hoặc đăng lặp để lách chính sách. Gợi ý tăng trưởng không đảm bảo viral hoặc thu nhập. | E16.04, E17.04, E31.03 |
| BR15 | Tách usage, credit dịch vụ, chi phí provider và tiền Creator trả cho SocialContent. Không ghi nhận hoặc đối soát tiền bán hàng/hoa hồng của Creator trong hệ thống. | T19–T22 |
| BR16 | Reserve quota nguyên tử trước tác vụ, settle phần dùng thật, release phần không dùng. Không cộng trực tiếp token, phút render và GB. | E21.01, E21.02 |
| BR17 | Retry lỗi hệ thống không tự thu Creator hai lần, nhưng mọi chi phí provider phát sinh vẫn phải ghi nhận. | E21.02, E22.01 |
| BR18 | Cấp gói/credit dựa thanh toán đã xác minh, không dựa redirect thành công trên trình duyệt. Webhook phải chống giả, replay và trùng. | E20.01 |
| BR19 | Chốt giá, đơn vị tính, tiền tệ và quy tắc làm tròn theo phiên bản; quyết toán dùng decimal/đơn vị tiền nhỏ nhất phù hợp. | E19.01, E20.02 |
| BR20 | Hết hạn gói, hạ gói hoặc khóa tài khoản không tự xóa tài sản/hóa đơn; chính sách đọc, xuất, job đang chạy và retention phải rõ. | E01.03, E19.02, E25.02 |
| BR21 | Chế tài Admin độc lập với tự duyệt biên tập. Nội dung đã duyệt vẫn bị chặn khi vi phạm. | E15.03, T32 |
| BR22 | Báo cáo và điểm AI là tín hiệu, không tự chứng minh vi phạm. Quyết định cần rule, phiên bản, bằng chứng, ngữ cảnh và lý do. | E32.03 |
| BR23 | Gỡ bên ngoài chỉ gọi hoàn tất khi đã xác nhận. API không hỗ trợ thì tạo yêu cầu xử lý thủ công và giữ trạng thái chưa gỡ/không hỗ trợ. | E16.03, E32.04 |
| BR24 | Lệnh chặn mới ngăn dispatch tiếp theo. Bài đã gửi trước thời điểm chặn phải đối soát và xử lý tiếp; không hứa đảo ngược ngay. | E32.04 |
| BR25 | Chế tài có phạm vi, thời hạn, thông báo và khiếu nại. Đảo quyết định phải sửa số lần tái phạm; không tự đăng lại bài/lịch đã hủy. | E32.05, E32.06 |
| BR26 | Không có dữ liệu analytics không phải số 0. Chỉ phân tích số liệu kênh/bài lấy được hợp lệ; không suy diễn doanh thu từ lượt xem. | E17.01, E17.04 |
| BR27 | URL phải giữ mã affiliate và tham số hợp lệ do Creator nhập; không tự thay mã, rút gọn, tạo redirect hoặc cookie stuffing. | E31.01, E31.02 |
| BR28 | Nhãn quảng cáo/affiliate phải phù hợp nội dung và kênh. Không bịa trải nghiệm dùng sản phẩm, review hoặc khẳng định tính năng. | E25.03, E31.03 |
| BR29 | Kiểm tra link hỏng không được nhầm bị nguồn chặn bot là link chết; quét an toàn không vượt quyền hoặc gây giao dịch bên ngoài. | E31.01, E31.03 |
| BR30 | Xóa dữ liệu phải xét DB, vector, cache, media, bên nhận và backup. Bằng chứng/hoá đơn có chính sách giữ riêng, không vô thời hạn mặc định. | E25.02, E32.06 |

## 5. Quản trị bài người dùng và tiêu chuẩn cộng đồng

Phạm vi quản trị: bài nhập, draft AI, caption, ảnh, audio, video, link đính kèm, lịch chờ và bài đăng từ hệ thống. Chưa mặc định quản lý toàn bộ bài Creator từng đăng ngoài SocialContent; muốn đồng bộ thêm phải có quyền và khả năng API riêng. Link sản phẩm/affiliate chịu kiểm tra an toàn nhưng không kéo theo quản lý giao dịch bán hàng.

Admin cần: danh sách bài theo Creator/kênh/trạng thái/rủi ro; hồ sơ nguồn và phiên bản; báo cáo/AI flag; hàng đợi xét; biện pháp tạm thời; kết luận; chế tài; thông báo; khiếu nại và audit. Xét vi phạm theo ngữ cảnh, không chỉ từ khóa hoặc số lượt báo cáo. Dữ liệu nhạy cảm chỉ lưu và hiển thị mức cần thiết.

Các trạng thái đề xuất phải độc lập:

| Miền trạng thái | Ví dụ vòng đời |
|---|---|
| Biên tập | Draft → Creator review → Approved / Changes requested |
| Xuất bản | Unscheduled → Scheduled → Dispatching → Provider processing → Published / Failed / Unknown |
| Kiểm duyệt | Detected/Reported → In review → No violation / Confirmed → Action pending → Action applied → Closed |
| Khiếu nại | Submitted → In review → Upheld / Overturned / Partially overturned → Resolved |
| Quyền đăng | Allowed / Held / Restricted until / Suspended |
| Nội bộ | Visible / Hidden / Quarantined / Deleted under policy |
| Bên ngoài | Published / Restricted / Removal requested / Removal confirmed / Unknown / Unsupported |

Đây là trạng thái nghiệp vụ mục tiêu, không phải enum đã có trong code. Bài có thể đồng thời “đã đăng bên ngoài”, “ẩn nội bộ” và “đang khiếu nại”. Một trường status chung sẽ làm mất thông tin này.

## 6. Hạn mức và chi phí

| Hạn mức | Đơn vị phải chốt | Hành vi khi hết |
|---|---|---|
| Kênh | Số profile hoạt động của Creator | Chặn thêm kênh, không xóa lịch sử |
| Crawl | Request nguồn/bản ghi/credit theo gói công bố | Dừng nhận thêm việc, giữ phần đã hoàn tất |
| AI | Token theo loại/model hoặc credit quy đổi | Không gọi provider khi thiếu reservation |
| TTS/STT | Ký tự hoặc giây/phút | Không tự chuyển sang provider đắt hơn |
| Render | Thời lượng đầu ra hoặc credit đã định nghĩa | Giữ draft/asset; không tạo render mới |
| Storage | Byte/GB; làm rõ file tạm, phiên bản và backup | Hạn chế thêm file, không tự xóa asset đang dùng |
| Publish | Bài/kênh/kỳ theo gói; khác quota API provider | Báo rõ loại giới hạn và khả năng thử lại |
| Song song/tốc độ | Job đang chạy hoặc request/cửa sổ | Queue công bằng/rate limit |
| Thư viện link | Số URL lưu nếu gói có giới hạn | Báo giới hạn, không tự thay link bài đã đăng |
| Ngân sách | Tiền/credit theo Creator, kênh, chiến dịch, job | Tách cảnh báo, soft cap và hard cap |

Trong cùng một đơn vị và kỳ: **available = allowance + adjustments − settled usage − active reservations**. Giá, quota, kỳ, timezone, credit mua/tặng/hết hạn và overage phải được công bố trước dùng.

Chỉ gọi là hard cap nếu cơ chế kỹ thuật thực sự ngăn vượt: reserve đủ giới hạn tối đa, giới hạn token/thời lượng hoặc chia tác vụ nhỏ. Với khoản chi provider đã phát sinh không thể hủy, phải giải thích hạn chế. Credit là quyền dùng dịch vụ, không mặc định là ví điện tử chuyển nhượng/rút tiền.

**Chỉ quản lý hai dòng tiền trong sản phẩm:** (1) Creator trả phí dùng SocialContent; (2) SocialContent trả cloud/AI/provider. Tiền Creator kiếm từ nội dung, affiliate hoặc bán hàng do dịch vụ bên ngoài quản lý; không đồng bộ, không đối soát, không dùng số dư credit dịch vụ để biểu diễn khoản đó.

## 7. Nghiệm thu, phi chức năng và dữ liệu thử

**Definition of Ready:** actor đúng một trong hai vai trò; mục tiêu rõ; input/output; quyền; AC; trạng thái lỗi; phụ thuộc; tác động chi phí/dữ liệu và chính sách được chốt. Tách nhỏ story nếu cần nhiều sprint.

**Definition of Done:** đạt AC trên build xác định; kiểm tra quyền phía máy chủ; trạng thái UI đúng; log/audit/usage cần thiết; không lộ secret; kiểm tra hồi quy phù hợp; tài liệu cập nhật; có bằng chứng nghiệm thu. Tác vụ ngoài hệ thống phải thử timeout, duplicate và retry. Mock thành công không được gọi là E2E với dịch vụ thật.

Các mục tiêu sau là **đề xuất để đo**, chưa kiểm thử và chưa cam kết SLA. Kịch bản tải tham chiếu cần đội phát triển chốt trước khi đo: số Creator đồng thời, sản lượng crawl, độ dài video, dung lượng media, tài nguyên cloud và quota provider.

| NFR | Tiêu chí đề xuất | Cách kiểm chứng |
|---|---|---|
| 01 Quyền | Không truy cập chéo Creator trên các đường đã công bố | Test hai Creator và một Admin: API/file/search/job/export |
| 02 Tương tác | API thường p95 ≤ 1 giây ở tải tham chiếu; không gồm upload/AI | Báo cáo tải và tài nguyên rõ ràng |
| 03 Tiến độ | UI nhận trạng thái job trong ≤ 10 giây khi hệ thống khỏe | Đo commit đến hiển thị |
| 04 Khả dụng | Mục tiêu API 99,9%/tháng nếu thương mại hóa | Định nghĩa SLI/cửa sổ/ngoại lệ trước vận hành |
| 05 Khôi phục | RPO ≤ 15 phút, RTO ≤ 4 giờ là mục tiêu ban đầu | Restore DB/media, đối soát job và bài đã gửi |
| 06 Tác vụ | Không mất job đã nhận hoặc lặp tác dụng do restart | Fault injection giữa DB/event/worker |
| 07 Quota | Không vượt số dư do reserve đồng thời | Nhiều request tranh phần quota cuối |
| 08 Tiền | Không charge/cấp credit trùng; sổ đối soát được | Webhook giả, trùng, đảo thứ tự và đến muộn |
| 09 Lịch | Dispatch trong 60 giây từ giờ hợp lệ khi hệ thống khỏe | Tách thời điểm dispatch và provider xuất bản |
| 10 URL/file | Chặn SSRF, redirect nội bộ và file nguy hiểm | Test private IP, IPv6, DNS thay đổi, upload giả MIME |
| 11 Secret | Không lộ trong response, log, trace, export | Dò dữ liệu thử và review cấu hình |
| 12 Kiểm duyệt | Hold có hiệu lực trước dispatch ngăn gửi mới | Race test Admin chặn khi worker chuẩn bị đăng |
| 13 Liên kết | URL cuối giữ mã affiliate và tham số hợp lệ | So sánh URL nhập, preview và payload; kiểm tra URL mã hóa |
| 14 Media | Output đạt preset, phụ đề nằm trong thời lượng | Kiểm tra file tự động và xem mẫu |
| 15 Tiếp cận | Luồng cốt lõi dùng được bằng bàn phím, không chỉ dựa màu | Kiểm tra focus, nhãn và thông báo lỗi |
| 16 Privacy | Xóa có dấu vết ở kho liên quan và sau restore | Tài khoản thử, thực thi xóa và kiểm tra phục hồi |

## 8. Lộ trình theo mục tiêu dự án

| Giai đoạn | Kết quả cần đạt | Điều kiện phát hành |
|---|---|---|
| R0 — Hoàn thiện lõi | Creator tự đi từ nguồn hợp lệ tới video, duyệt và TikTok; Admin quản lý người dùng và vận hành cơ bản | Luồng chính và lỗi/retry kiểm chứng; không truy cập chéo hoặc đăng ngoài ý muốn |
| R1 — Sử dụng ổn định và có kiểm soát | Trải nghiệm cá nhân, liên kết cơ bản, bảo mật, chi phí/quota, gói/thanh toán nếu bán dịch vụ, quản trị bài vi phạm và khôi phục | Có gate hạn mức, audit, moderation, thanh toán và restore tương ứng tính năng bật |
| R2 — Phát triển kênh | Đa nền tảng, nhiều định dạng, tương tác và tối ưu nội dung; tiếp tục hỗ trợ link ở các kênh mới | Mỗi connector đạt permission/quota/contract; không thêm đồng bộ bán hàng hoặc vai trò nhóm |

P0 = bắt buộc trước khi bật năng lực thuộc release tương ứng; P1 = quan trọng tiếp theo; P2 = bổ sung theo nhu cầu/chi phí. Không phải mọi P0 phải hoàn thành trong đồ án. Gói/thanh toán chỉ bắt buộc khi bắt đầu thu phí; cloud vẫn cần mức vận hành tối thiểu cho sản phẩm thực tế.

Thứ tự chọn story: **đúng phạm vi cá nhân → hoàn thiện lõi → bảo vệ dữ liệu/nội dung/chi phí → gắn link cơ bản → mở các kênh có quyền thật → tối ưu chất lượng và tương tác**. Không mở hàng loạt nền tảng cùng lúc; chọn TikTok hiện có rồi ưu tiên YouTube/Meta theo khả năng cấp quyền và nhu cầu Creator.

## 9. Điểm cần chốt khi triển khai, không phải câu hỏi chặn backlog

1. Kênh ưu tiên sau TikTok, quyền API/app review thật và vị trí kênh cho phép gắn link.
2. Đơn vị bán, giá, trial, overage, hoàn tiền, số kênh, retention và ngân sách cloud/AI.
3. Nguồn media được phép tái sử dụng và yêu cầu nội dung có giá trị gốc để kiếm tiền.
4. Các rule cộng đồng, mức chế tài, thời hạn xét/khiếu nại và cách Admin xử lý nội dung nhạy cảm.
5. Cách kiểm tra URL, mẫu nhãn affiliate/quảng cáo và các trường hợp phải Creator xác nhận thủ công.
6. Tải cần phục vụ, năng lực đội và phạm vi release. Chưa có dữ liệu thì không tự gán thời hạn hoặc story point.

Phần nghĩa vụ pháp lý, bảo vệ dữ liệu, hóa đơn, thuế, quảng cáo và thanh toán cần người có chuyên môn xác nhận theo thị trường triển khai; tài liệu BA này không là chứng nhận tuân thủ.
