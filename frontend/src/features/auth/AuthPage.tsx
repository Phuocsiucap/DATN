import { useState } from 'react'
import { ArrowRight, CheckCircle2, LogIn, ShieldCheck, Sparkles, UserPlus } from 'lucide-react'
import { loginApi, registerApi } from '@/commons/apis/api'

type AuthMode = 'login' | 'register'

type AuthPageProps = {
  onAuthenticated: () => Promise<void> | void
}

const emptyLoginForm = { email: '', password: '' }
const emptyRegisterForm = { email: '', password: '', roles: 'user' }

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [loginForm, setLoginForm] = useState(emptyLoginForm)
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleLogin = async () => {
    setLoading(true)
    setMessage('')
    try {
      await loginApi(loginForm)
      await onAuthenticated()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Đăng nhập thất bại')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setLoading(true)
    setMessage('')
    try {
      const roles = registerForm.roles.split(',').map((role) => role.trim()).filter(Boolean)
      await registerApi({
        email: registerForm.email,
        password: registerForm.password,
        roles,
      })
      setMessage('Tạo tài khoản thành công. Hãy đăng nhập bằng tài khoản vừa tạo.')
      setRegisterForm(emptyRegisterForm)
      setMode('login')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Tạo tài khoản thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="compact-ui min-h-screen" style={{ backgroundColor: 'var(--surface)' }}>
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="hidden border-r px-8 py-7 lg:flex lg:flex-col" style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="SocialContent Hub" className="h-9 w-9 rounded-md object-contain" />
            <div>
              <h1 className="text-sm font-bold leading-tight text-white">SOCIALCONTENT</h1>
              <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>STUDIO</p>
            </div>
          </div>

          <div className="mt-auto max-w-md space-y-4 pb-8">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="text-2xl font-semibold leading-tight text-white">
                Vào workspace quản lý nội dung
              </h2>
              <p className="mt-3 text-sm leading-6" style={{ color: 'rgba(255,255,255,0.68)' }}>
                Truy cập dashboard, quản lý tài khoản và theo dõi pipeline sản xuất nội dung trong cùng một không gian làm việc.
              </p>
            </div>
          </div>

          <div className="grid gap-3 pb-4">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <CheckCircle2 size={16} className="text-emerald-300" />
              <p className="mt-2 text-xs font-semibold text-white">Session bảo mật</p>
              <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.58)' }}>Cookie auth qua `/auth/me`.</p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <Sparkles size={16} className="text-blue-200" />
              <p className="mt-2 text-xs font-semibold text-white">AI workflow</p>
              <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.58)' }}>Crawl, planning và output theo module.</p>
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen min-w-0 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-[calc(100vw-2rem)] max-w-md min-w-0">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <img src="/logo.png" alt="SocialContent Hub" className="h-9 w-9 rounded-md object-contain" />
              <div>
                <h1 className="text-sm font-bold leading-tight" style={{ color: 'var(--on-surface)' }}>SOCIALCONTENT</h1>
                <p className="text-[10px] font-medium" style={{ color: 'var(--on-surface-variant)' }}>STUDIO</p>
              </div>
            </div>

            <div className="bento-card rounded-xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-semibold" style={{ color: 'var(--on-surface)' }}>
                    {mode === 'login' ? 'Đăng nhập hệ thống' : 'Tạo tài khoản'}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                    {mode === 'login'
                      ? 'Dùng tài khoản được cấp để vào dashboard.'
                      : 'Tạo user mới cho workspace.'}
                  </p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ backgroundColor: 'var(--surface-container-low)', color: 'var(--accent)' }}>
                  <LogIn size={16} />
                </div>
              </div>

              <div className="mb-5 flex rounded-md p-1" style={{ backgroundColor: 'var(--surface-container)' }}>
                <button
                  onClick={() => setMode('login')}
                  className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ backgroundColor: mode === 'login' ? 'var(--surface-container-lowest)' : 'transparent', color: 'var(--on-surface)' }}
                >
                  Login
                </button>
                <button
                  onClick={() => setMode('register')}
                  className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{ backgroundColor: mode === 'register' ? 'var(--surface-container-lowest)' : 'transparent', color: 'var(--on-surface)' }}
                >
                  Register
                </button>
              </div>

              {message && (
                <div className="mb-4 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-low)', color: 'var(--on-surface)' }}>
                  {message}
                </div>
              )}

              {mode === 'login' ? (
                <div className="space-y-4">
                  <label className="block space-y-1.5 text-xs font-medium">
                    <span>Email</span>
                    <input
                      className="h-9 w-full rounded-md border px-3 outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={loginForm.email}
                      onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="admin@example.com"
                    />
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium">
                    <span>Password</span>
                    <input
                      className="h-9 w-full rounded-md border px-3 outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      type="password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </label>
                  <button
                    onClick={() => void handleLogin()}
                    disabled={loading}
                    className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--on-secondary)' }}
                  >
                    Đăng nhập dashboard
                    <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="block space-y-1.5 text-xs font-medium">
                    <span>Email</span>
                    <input
                      className="h-9 w-full rounded-md border px-3 outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={registerForm.email}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="user@example.com"
                    />
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium">
                    <span>Password</span>
                    <input
                      className="h-9 w-full rounded-md border px-3 outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      type="password"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium">
                    <span>Roles</span>
                    <input
                      className="h-9 w-full rounded-md border px-3 outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={registerForm.roles}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, roles: e.target.value }))}
                      placeholder="user"
                    />
                  </label>
                  <button
                    onClick={() => void handleRegister()}
                    disabled={loading}
                    className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
                  >
                    Tạo tài khoản
                    <UserPlus size={14} />
                  </button>
                </div>
              )}
            </div>

            <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--on-surface-variant)' }}>
              SocialContent Studio
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
