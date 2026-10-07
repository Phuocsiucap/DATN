import { CheckCircle2, XCircle } from 'lucide-react'

/**
 * Handles the Google OAuth redirect at /auth/youtube/callback.
 *
 * Google redirects here with ?code=...&state=... on success, or
 * ?error=access_denied&state=... on denial.
 *
 * The page itself does nothing with the code — the backend polling loop in
 * SettingsPage picks it up via GET /social-profiles/youtube/oauth/{state}/status
 * which calls the backend's receive_youtube_oauth_callback internally.
 *
 * NOTE: Because this app is a SPA without a real /auth/youtube/callback server
 * route, the Google redirect URI must point here AND we must also store the
 * code server-side.  The backend exposes GET /auth/youtube/callback as a
 * lightweight endpoint that reads ?code & ?state and stores them in the
 * in-memory session dict (receive_youtube_oauth_callback), then returns a
 * minimal HTML page that immediately closes the popup window.
 *
 * This frontend component is shown as a fallback if the popup is not closed
 * automatically (e.g. the user navigated to the URL directly).
 */
export default function YouTubeCallbackPage() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const hasSuccess = Boolean(code) && !error

  // Attempt to close the popup automatically
  try {
    if (window.opener) {
      window.close()
    }
  } catch {
    // Cross-origin opener — ignore
  }

  return (
    <main className="h-full w-full overflow-y-auto bg-[var(--surface)] p-3 text-[var(--on-surface)]">
      <div className="flex min-h-full w-full items-center justify-center">
        <section className="w-full max-w-sm rounded-md border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                hasSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
              }`}
            >
              {hasSuccess ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[var(--on-surface)]">
                YouTube authorization
              </h1>
              <p className="mt-1 text-sm text-[var(--on-surface-variant)]">
                {hasSuccess
                  ? 'Google returned an authorization code.'
                  : 'Google did not complete authorization.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-[#eef2f7] bg-slate-50 p-4 text-sm text-[#475569]">
            {hasSuccess ? (
              <p>
                Authorization received. You can return to Social account to finish the connection.
                This window will close automatically.
              </p>
            ) : (
              <>
                <p>
                  {params.get('error_description') ||
                    'Please try connecting YouTube again from Social account.'}
                </p>
                {error && <p className="break-words text-xs">Error: {error}</p>}
              </>
            )}
          </div>

          <a
            href="/social-account"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            Back to Social account
          </a>
        </section>
      </div>
    </main>
  )
}
