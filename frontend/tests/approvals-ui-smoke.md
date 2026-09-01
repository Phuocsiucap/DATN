# Approvals and production board (synthetic data only)

Run `node tests/review-ui-server.mjs` from `frontend`, then open
`http://localhost:5187/__approvals-ui` (or set `REVIEW_UI_PORT`). The harness
renders the real page, blocks unspecified API requests and never uses real
accounts, AI, database records or TikTok publishing.

1. Only three tabs: Chờ duyệt 3, Đã duyệt · chưa lên lịch 1, Cần xử lý 1.
   Scheduled and published fixtures are excluded; they belong to other pages.
2. Open Đã duyệt. The automatically approved video has no date and shows strategy
   with auto review enabled, auto scheduling disabled. No POST is made.
3. Its row's Lên lịch opens manual scheduling. Empty time cannot be confirmed.
   Choose a future date, confirm, and check exactly one `approve-schedule` POST
   with `schedule_mode=manual` and the exact chosen instant. The video leaves
   Approvals for the Lịch đăng page. No `/approve` call is made.
4. Reset. Open the plain-review fixture in Chờ duyệt (it has a legacy date).
   Duyệt makes only `/approve`, clears the date and moves it to Đã duyệt.
5. Duyệt & lên lịch opens manual inputs without a POST. AI chọn giờ also makes
   no POST until Xác nhận để AI chọn lịch; that sends only `schedule_mode=ai`.
6. No Đã lên lịch, Đã đăng or Tất cả tab. Cần xử lý contains the failed item.
   The header's Xem lịch đăng links to the existing schedule page.
7. Open `http://localhost:5187/__video-list-ui`: four production columns only,
   completed work in Video hoàn tất, errors in Cần xử lý, and a link to Approvals.

Automated coverage: `node --test --test-concurrency=1 tests/approvals.test.mjs
tests/video-workspace-list.test.mjs tests/publishing-schedule.test.mjs`.
API/worker tests use mocks as well; these do not replace integration testing
against PostgreSQL and a running scheduler.
