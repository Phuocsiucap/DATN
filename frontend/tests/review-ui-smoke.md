# Review UI smoke test (mock only)

Run from `frontend/`:

```sh
node --test --test-concurrency=1 tests/planning-run-detail.test.mjs tests/draft-media-links.test.mjs
node tests/review-ui-server.mjs
```

Open `http://localhost:5187/__review-ui`. This harness renders the real Planning
and Video Workspace components with synthetic data. Its Axios adapter rejects
unspecified calls and the server refuses `/api` requests; it never proxies to
the application API. No real credentials, AI, TTS, database or publish jobs are
used. Controls prefixed with “Giả lập” only change in-memory fixtures.

Verify:

1. Open **Chi tiết**. The first candidate offers source review; the second
   already has a draft and offers **Mở để duyệt draft**.
   The overview uses compact v3; verify the log contains no `/diagnostics` GET.
   Open **Xem chi tiết quyết định** for one candidate: only that candidate is
   fetched. Its topic matrix/quality log appears. Collapse/reopen: no extra GET.
   Use **Lỗi tải chẩn đoán** before opening the other candidate; the failed load
   must expose **Tải lại chi tiết**, without disabling review/navigation.
2. Read **Xem bài nguồn**, enter a note, choose **Cho phép sinh draft**. The log
   shows only a candidate-review POST, and the approval button disappears.
3. Click **Giả lập job lỗi**. Within the 3-second polling interval, the error and
   **Thử sinh draft lại** appear. Retry sends `RETRY`, not another initial approval.
4. Click **Giả lập job xong**. Polling links the resulting workflow. Open either
   candidate's draft: the sheet closes, the editor opens, and no approval POST
   is sent merely by opening it.
5. Before approving, attempt voice/render: the UI shows the gate and sends no
   voice/render POST. **Xem bài gốc** provides source access from the studio.
6. In **Script**, edit **Voice text**. Toggle **Bật/tắt lỗi duyệt**, then approve:
   save-story contains the edit, approve-draft uses its returned signature, and
   the simulated conflict is visible in the studio. Toggle back and approve;
   success is visible and the review banner disappears. No approve-video or
   queue-post request is sent.
7. In **Danh sách draft (test)**, opening the row's draft and **View full** →
   open draft both navigate to `mock-workflow`, not `plan-id-not-workflow-id`.
8. Reject that workflow, then **Khôi phục workflow**. Only restoration uses the
   legacy workflow-approve endpoint; it does not approve draft quality.
9. **Đặt lại fixture** → open detail → **Lỗi lần tải kế tiếp** → approve source.
   The saved decision stays queued despite the refresh error; approval is not
   offered again. **Tải lại trạng thái** clears the refresh error on success.
   If diagnostics were already open before approval, they must not continue
   showing the previous decision after the overview's review state changes.
10. Reset again, reject the source candidate. It becomes rejected without a new
    workflow/draft; only the candidate-review POST with `REJECT` is sent.

Unit tests separately cover missing/deleted and unlinked workflows, current vs
historical review states, and unavailable navigation callbacks. The backend
test suites cover ownership, hard gates, idempotency, queued work, quality gates,
and exact script signatures. These checks do not replace a real PostgreSQL +
worker integration run. Restart the API and planning worker to load backend
review changes before testing real jobs; real approval can incur AI/TTS costs.
