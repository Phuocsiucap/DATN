import { type FormEvent, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Mail,
  ShieldCheck,
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
      setMessage({
        type: 'error',
        text: getApiErrorMessage(error, 'Đăng nhập thất bại. Vui lòng kiểm tra lại email hoặc mật khẩu.'),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const roles = registerForm.roles
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean)
      await registerApi({
        email: registerForm.email,
        password: registerForm.password,
        roles,
      })
      setMessage({ type: 'success', text: 'Tạo tài khoản thành công! Vui lòng đăng nhập.' })
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
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 lg:grid-cols-12">
        {/* Left Side: Clean Modern Branding Banner */}
        <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-8 text-white sm:p-10 lg:col-span-5">
          <div className="relative z-10">
            <div className="mb-10 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-500/30">
                <Layers className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight tracking-tight text-white">SocialContent</h1>
                <p className="text-xs font-medium text-slate-400">Studio Platform</p>
              </div>
            </div>

            <div className="my-8 space-y-4">
              <h2 className="text-2xl font-extrabold leading-snug text-white sm:text-3xl">
                Nền tảng quản lý & xuất bản nội dung
              </h2>
              <p className="text-sm leading-relaxed text-slate-300">
                Tối ưu hóa quy trình từ thu thập tin tức, lên kịch bản đến quản lý đa kênh trong một giao diện duy nhất.
              </p>
            </div>

            <div className="space-y-3 border-t border-slate-700/60 pt-4">
              {[
                'Quản lý nguồn tin & dữ liệu tập trung',
                'Lập kế hoạch nội dung tự động',
                'Quản lý phân quyền & an toàn dữ liệu',
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-2.5 text-xs text-slate-200">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                  </div>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 mt-8 flex items-center justify-between border-t border-slate-800 pt-8 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Hệ thống bảo mật
            </span>
            <span>v2.5.0</span>
          </div>

          {/* Decorative ambient background blur */}
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl" />
        </div>

        {/* Right Side: Simple Modern Form */}
        <div className="flex flex-col justify-center bg-white p-8 sm:p-10 lg:col-span-7">
          <div className="mx-auto w-full max-w-md">
            {/* Tab Switcher */}
            <div className="mb-8 flex rounded-xl border border-slate-200/60 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setMessage(null)
                }}
                className={`flex-1 rounded-lg py-2.5 text-xs font-semibold transition-all ${
                  mode === 'login'
                    ? 'border border-slate-200/50 bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register')
                  setMessage(null)
                }}
                className={`flex-1 rounded-lg py-2.5 text-xs font-semibold transition-all ${
                  mode === 'register'
                    ? 'border border-slate-200/50 bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Tạo tài khoản
              </button>
            </div>

            {/* Header */}
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                {mode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản mới'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {mode === 'login'
                  ? 'Nhập thông tin đăng nhập để truy cập vào hệ thống'
                  : 'Điền thông tin bên dưới để đăng ký tài khoản'}
              </p>
            </div>

            {/* Message alert */}
            {message && (
              <div
                className={`mb-6 flex items-start gap-2.5 rounded-xl border p-3.5 text-xs ${
                  message.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {message.type === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                )}
                <span className="leading-relaxed">{message.text}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
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
                    placeholder="name@company.com"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Mật khẩu</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
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
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Vai trò (Roles)</label>
                  <input
                    type="text"
                    required
                    value={registerForm.roles}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, roles: e.target.value }))}
                    placeholder="user"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">
                    Phân tách bằng dấu phẩy nếu có nhiều role (vd: user, admin)
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-60"
              >
                {loading ? (
                  <span>Đang xử lý...</span>
                ) : (
                  <>
                    <span>{mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản'}</span>
                    {mode === 'login' ? <ArrowRight className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
              SocialContent Studio &copy; {new Date().getFullYear()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

