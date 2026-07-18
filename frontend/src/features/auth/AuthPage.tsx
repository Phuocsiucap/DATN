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
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
      <div className="absolute inset-0 opacity-80" style={{ background: 'radial-gradient(circle at top left, rgba(33,112,228,0.16), transparent 30%), radial-gradient(circle at bottom right, rgba(0,164,114,0.14), transparent 28%), linear-gradient(135deg, rgba(9,20,38,0.03), rgba(248,249,255,0.98))' }} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-2 gap-8 px-6 py-8">
        <div className="flex flex-col justify-center gap-8 text-[var(--on-surface)]">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'rgba(255,255,255,0.7)' }}>
            <ShieldCheck size={16} style={{ color: 'var(--secondary)' }} />
            System auth portal
          </div>

          <div className="space-y-4 max-w-xl">
            <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-tight">
              Quản lý đăng nhập hệ thống và tài khoản TikTok trong một luồng
            </h1>
            <p className="text-base md:text-lg" style={{ color: 'var(--on-surface-variant)' }}>
              Trang này đồng bộ với giao diện dashboard hiện tại, hỗ trợ đăng nhập hệ thống, tạo user phụ, rồi mở nhiều profile TikTok bằng QR session riêng cho từng tài khoản.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 max-w-2xl">
            <div className="bento-card rounded-2xl p-4">
              <CheckCircle2 size={20} style={{ color: 'var(--secondary)' }} />
              <p className="mt-3 text-sm font-semibold">System login</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--on-surface-variant)' }}>Cookie-based auth với `/auth/me`</p>
            </div>
            <div className="bento-card rounded-2xl p-4">
              <UserPlus size={20} style={{ color: 'var(--secondary)' }} />
              <p className="mt-3 text-sm font-semibold">Create users</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--on-surface-variant)' }}>System user tạo tài khoản mới</p>
            </div>
            <div className="bento-card rounded-2xl p-4">
              <Sparkles size={20} style={{ color: 'var(--secondary)' }} />
              <p className="mt-3 text-sm font-semibold">TikTok QR</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--on-surface-variant)' }}>Mỗi profile có QR login riêng</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <div className="w-full max-w-xl bento-card rounded-[28px] p-6 md:p-8 shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-semibold" style={{ color: 'var(--on-surface)' }}>
                  {mode === 'login' ? 'Đăng nhập hệ thống' : 'Tạo tài khoản'}
                </h2>
                <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                  {mode === 'login'
                    ? 'Dùng tài khoản system để vào dashboard.'
                    : 'System account mới có quyền tạo user khác.'}
                </p>
              </div>
              <div className="rounded-2xl px-3 py-2" style={{ backgroundColor: 'var(--surface-container-low)', color: 'var(--secondary)' }}>
                <LogIn size={18} />
              </div>
            </div>

            <div className="mb-6 flex rounded-xl p-1" style={{ backgroundColor: 'var(--surface-container-low)' }}>
              <button
                onClick={() => setMode('login')}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all"
                style={{ backgroundColor: mode === 'login' ? 'var(--surface-container-lowest)' : 'transparent', color: 'var(--on-surface)' }}
              >
                Login
              </button>
              <button
                onClick={() => setMode('register')}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all"
                style={{ backgroundColor: mode === 'register' ? 'var(--surface-container-lowest)' : 'transparent', color: 'var(--on-surface)' }}
              >
                Register
              </button>
            </div>

            {message && (
              <div className="mb-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}>
                {message}
              </div>
            )}

            {mode === 'login' ? (
              <div className="space-y-4">
                <label className="block space-y-2 text-sm">
                  <span>Email</span>
                  <input
                    className="w-full rounded-xl border px-4 py-3 outline-none transition-colors"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    value={loginForm.email}
                    onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="admin@example.com"
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>Password</span>
                  <input
                    className="w-full rounded-xl border px-4 py-3 outline-none transition-colors"
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
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
                >
                  Đăng nhập dashboard
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block space-y-2 text-sm">
                  <span>Email</span>
                  <input
                    className="w-full rounded-xl border px-4 py-3 outline-none transition-colors"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="user@example.com"
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>Password</span>
                  <input
                    className="w-full rounded-xl border px-4 py-3 outline-none transition-colors"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>Roles</span>
                  <input
                    className="w-full rounded-xl border px-4 py-3 outline-none transition-colors"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    value={registerForm.roles}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, roles: e.target.value }))}
                    placeholder="user"
                  />
                </label>
                <button
                  onClick={() => void handleRegister()}
                  disabled={loading}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
                >
                  Tạo tài khoản
                  <UserPlus size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}