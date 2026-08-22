import { type FormEvent, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { loginApi, registerApi } from '@/commons/apis/api'

type AuthMode = 'login' | 'register'

type AuthPageProps = {
  onAuthenticated: () => Promise<void> | void
}

type AuthMessage = {
  type: 'success' | 'error'
  text: string
}

const emptyLoginForm = { email: '', password: '' }
const emptyRegisterForm = { email: '', password: '', roles: 'user' }

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') {
      return response.data.detail
    }
  }
  return fallback
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [loginForm, setLoginForm] = useState(emptyLoginForm)
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    setMessage(null)
    try {
      await loginApi(loginForm)
      await onAuthenticated()
    } catch (error: unknown) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Đăng nhập thất bại') })
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const roles = registerForm.roles.split(',').map((role) => role.trim()).filter(Boolean)
      await registerApi({
        email: registerForm.email,
        password: registerForm.password,
        roles,
      })
      setMessage({ type: 'success', text: 'Tạo tài khoản thành công. Hãy đăng nhập bằng tài khoản vừa tạo.' })
      setRegisterForm(emptyRegisterForm)
      setMode('login')
    } catch (error: unknown) {
      setMessage({ type: 'error', text: getApiErrorMessage(error, 'Tạo tài khoản thất bại') })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === 'login') {
      void handleLogin()
      return
    }
    void handleRegister()
  }

  const passwordValue = mode === 'login' ? loginForm.password : registerForm.password

  return (
    <div
      className="compact-ui min-h-screen overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #f7fafc 0%, #eef4fb 46%, #f8fafc 100%)' }}
    >
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        <aside
          className="relative hidden min-h-screen overflow-hidden border-r px-8 py-7 lg:flex lg:flex-col xl:px-12"
          style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="absolute inset-0 opacity-80"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 h-1/2"
            style={{
              background: 'linear-gradient(180deg, rgba(23,32,51,0) 0%, rgba(13,19,31,0.92) 100%)',
            }}
          />

          <div className="relative z-10 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/logo.png" alt="SocialContent Studio" className="h-10 w-10 rounded-md object-contain" />
              <div className="min-w-0">
                <h1 className="text-sm font-extrabold leading-tight text-white">SocialContent</h1>
                <p className="text-[10px] font-semibold uppercase" style={{ color: 'rgba(255,255,255,0.58)' }}>
                  Studio Console
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-white">
              <ShieldCheck size={13} className="text-emerald-300" />
              Bảo mật phiên
            </div>
          </div>

          <div className="relative z-10 flex flex-1 flex-col justify-center py-12">
            <div className="max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white">
                <Sparkles size={15} className="text-blue-200" />
                SocialContent Studio
              </div>
              <h2 className="max-w-lg text-4xl font-extrabold leading-tight text-white xl:text-5xl">
                Quản lý nội dung từ thu thập đến xuất bản.
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-6" style={{ color: 'rgba(255,255,255,0.68)' }}>
                Đăng nhập để theo dõi nguồn dữ liệu, kế hoạch nội dung, trạng thái duyệt và cấu hình tài khoản trong cùng một workspace.
              </p>
            </div>

            <div className="mt-10 max-w-2xl rounded-lg border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-semibold text-white">Không gian làm việc</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Các module chính sau khi đăng nhập
                  </p>
                </div>
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.08] text-blue-200">
                  <Database size={16} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Thu thập dữ liệu', 'Quản lý nguồn crawl và tác vụ đầu vào.'],
                  ['Lập kế hoạch', 'Tạo lịch nội dung và kịch bản sản xuất.'],
                  ['Duyệt nội dung', 'Kiểm tra bản nháp trước khi xuất bản.'],
                  ['Tài khoản', 'Phân quyền người dùng trong hệ thống.'],
                ].map(([title, description], index) => (
                  <div key={title} className="rounded-md border border-white/10 bg-white/[0.06] p-3">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.08] text-white">
                      {index === 0 ? <Database size={15} /> : <FileCheck2 size={15} />}
                    </div>
                    <p className="text-xs font-semibold text-white">{title}</p>
                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'rgba(255,255,255,0.56)' }}>
                      {description}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-md border border-white/10 bg-[#0f1726]/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-white">Truy cập theo vai trò</p>
                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'rgba(255,255,255,0.56)' }}>
                      Người dùng chỉ thấy các khu vực phù hợp với quyền được cấp.
                    </p>
                  </div>
                  <ShieldCheck size={17} className="shrink-0 text-emerald-300" />
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen min-w-0 items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
          <div className="w-full max-w-[440px] min-w-0">
            <div className="mb-8 flex items-center justify-between gap-3 lg:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <img src="/logo.png" alt="SocialContent Studio" className="h-10 w-10 rounded-md object-contain" />
                <div className="min-w-0">
                  <h1 className="text-sm font-extrabold leading-tight" style={{ color: 'var(--on-surface)' }}>
                    SocialContent
                  </h1>
                  <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
                    Studio Console
                  </p>
                </div>
              </div>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white" style={{ borderColor: 'var(--outline-variant)' }}>
                <Sparkles size={15} style={{ color: 'var(--accent)' }} />
              </div>
            </div>

            <section className="rounded-lg border bg-white shadow-[0_18px_50px_rgba(16,24,40,0.10)]" style={{ borderColor: 'var(--outline-variant)' }}>
              <div className="border-b px-5 py-5 sm:px-6" style={{ borderColor: 'var(--outline-variant)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase" style={{ color: 'var(--accent)' }}>
                      {mode === 'login' ? 'Đăng nhập' : 'Tài khoản mới'}
                    </p>
                    <h2 className="mt-2 text-2xl font-extrabold leading-tight" style={{ color: 'var(--on-surface)' }}>
                      {mode === 'login' ? 'Đăng nhập vào Studio' : 'Tạo tài khoản truy cập'}
                    </h2>
                    <p className="mt-2 text-sm leading-5" style={{ color: 'var(--on-surface-variant)' }}>
                      {mode === 'login'
                        ? 'Tiếp tục công việc sản xuất, duyệt và xuất bản nội dung.'
                        : 'Thêm người dùng mới vào workspace với role phù hợp.'}
                    </p>
                  </div>
                  <div
                    className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md sm:inline-flex"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
                  >
                    {mode === 'login' ? <LockKeyhole size={18} /> : <UserPlus size={18} />}
                  </div>
                </div>
              </div>

              <div className="px-5 py-5 sm:px-6">
                <div className="mb-5 grid grid-cols-2 rounded-md border bg-[var(--surface-container-low)] p-1" style={{ borderColor: 'var(--outline-variant)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login')
                      setMessage(null)
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-bold transition-all"
                    style={{
                      backgroundColor: mode === 'login' ? 'var(--surface-container-lowest)' : 'transparent',
                      color: mode === 'login' ? 'var(--on-surface)' : 'var(--on-surface-variant)',
                      boxShadow: mode === 'login' ? 'var(--shadow-card)' : 'none',
                    }}
                  >
                    <KeyRound size={14} />
                    Đăng nhập
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register')
                      setMessage(null)
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-bold transition-all"
                    style={{
                      backgroundColor: mode === 'register' ? 'var(--surface-container-lowest)' : 'transparent',
                      color: mode === 'register' ? 'var(--on-surface)' : 'var(--on-surface-variant)',
                      boxShadow: mode === 'register' ? 'var(--shadow-card)' : 'none',
                    }}
                  >
                    <UserPlus size={14} />
                    Đăng ký
                  </button>
                </div>

                {message && (
                  <div
                    className="mb-5 flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs leading-5"
                    style={{
                      borderColor: message.type === 'success' ? 'rgba(22,163,74,0.28)' : 'rgba(220,38,38,0.24)',
                      backgroundColor: message.type === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.07)',
                      color: message.type === 'success' ? '#166534' : '#b91c1c',
                    }}
                  >
                    {message.type === 'success' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
                    <span>{message.text}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <label className="block space-y-1.5 text-xs font-bold" style={{ color: 'var(--on-surface)' }}>
                    <span>Email</span>
                    <div className="relative">
                      <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--on-surface-variant)' }} />
                      <input
                        className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-[var(--on-surface-variant)] focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
                        style={{ borderColor: 'var(--outline-variant)' }}
                        type="email"
                        autoComplete={mode === 'login' ? 'email' : 'username'}
                        value={mode === 'login' ? loginForm.email : registerForm.email}
                        onChange={(e) => {
                          const email = e.target.value
                          if (mode === 'login') {
                            setLoginForm((prev) => ({ ...prev, email }))
                            return
                          }
                          setRegisterForm((prev) => ({ ...prev, email }))
                        }}
                        placeholder={mode === 'login' ? 'admin@example.com' : 'user@example.com'}
                        required
                      />
                    </div>
                  </label>

                  <label className="block space-y-1.5 text-xs font-bold" style={{ color: 'var(--on-surface)' }}>
                    <span>Mật khẩu</span>
                    <div className="relative">
                      <LockKeyhole size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--on-surface-variant)' }} />
                      <input
                        className="h-10 w-full rounded-md border bg-white pl-9 pr-10 text-sm outline-none transition-colors placeholder:text-[var(--on-surface-variant)] focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
                        style={{ borderColor: 'var(--outline-variant)' }}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        value={passwordValue}
                        onChange={(e) => {
                          const password = e.target.value
                          if (mode === 'login') {
                            setLoginForm((prev) => ({ ...prev, password }))
                            return
                          }
                          setRegisterForm((prev) => ({ ...prev, password }))
                        }}
                        placeholder="Nhập mật khẩu"
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-container)]"
                        style={{ color: 'var(--on-surface-variant)' }}
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>

                  {mode === 'register' && (
                    <label className="block space-y-1.5 text-xs font-bold" style={{ color: 'var(--on-surface)' }}>
                      <span>Roles</span>
                      <input
                        className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition-colors placeholder:text-[var(--on-surface-variant)] focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
                        style={{ borderColor: 'var(--outline-variant)' }}
                        value={registerForm.roles}
                        onChange={(e) => setRegisterForm((prev) => ({ ...prev, roles: e.target.value }))}
                        placeholder="user"
                        required
                      />
                      <span className="block text-[11px] font-medium" style={{ color: 'var(--on-surface-variant)' }}>
                        Có thể nhập nhiều role, phân tách bằng dấu phẩy.
                      </span>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition-all disabled:opacity-55"
                    style={{
                      backgroundColor: mode === 'login' ? 'var(--accent)' : 'var(--primary)',
                      color: mode === 'login' ? 'var(--on-secondary)' : 'var(--on-primary)',
                      boxShadow: '0 10px 24px rgba(37, 99, 235, 0.20)',
                    }}
                  >
                    {loading ? 'Đang xử lý...' : mode === 'login' ? 'Vào dashboard' : 'Tạo tài khoản'}
                    {!loading && (mode === 'login' ? <ArrowRight size={16} /> : <UserPlus size={16} />)}
                  </button>
                </form>
              </div>

              <div className="flex items-center gap-2 border-t px-5 py-4 text-[11px] sm:px-6" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                <ShieldCheck size={14} className="shrink-0" style={{ color: 'var(--success)' }} />
                <span>Phiên đăng nhập được xác thực qua cookie bảo mật và tự động kiểm tra bằng `/auth/me`.</span>
              </div>
            </section>

            <p className="mt-5 text-center text-[11px] font-medium" style={{ color: 'var(--on-surface-variant)' }}>
              SocialContent Studio - Nền tảng quản lý nội dung
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
