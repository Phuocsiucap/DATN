import { CheckCircle2, XCircle } from 'lucide-react'

export default function TikTokCallbackPage() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const scopes = params.get('scopes')
  const hasSuccess = Boolean(code) && !error

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-8 text-[var(--on-surface)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <section className="rounded-md border border-[var(--outline-variant)] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${hasSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {hasSuccess ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[var(--on-surface)]">TikTok authorization</h1>
              <p className="mt-1 text-sm text-[var(--on-surface-variant)]">
                {hasSuccess ? 'TikTok returned an authorization code.' : 'TikTok did not complete authorization.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-[#eef2f7] bg-slate-50 p-4 text-sm text-[#475569]">
            {hasSuccess ? (
              <>
                <p>Authorization was received. You can return to SocialContentHub settings to finish account connection.</p>
                {scopes && <p className="break-words text-xs">Granted scopes: {scopes}</p>}
              </>
            ) : (
              <>
                <p>{params.get('error_description') || 'Please try connecting TikTok again from SocialContentHub settings.'}</p>
                {error && <p className="break-words text-xs">Error: {error}</p>}
              </>
            )}
          </div>

          <a href="/settings" className="mt-5 inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]">
            Back to settings
          </a>
        </section>
      </div>
    </main>
  )
}
