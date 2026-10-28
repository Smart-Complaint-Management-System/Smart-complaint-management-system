import { useEffect } from "react";

export default function AdminLoginModal({
  isOpen,
  email,
  setEmail,
  password,
  setPassword,
  loading,
  error,
  onLogin,
  onClose,
}) {
  // ESC key to close
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Administrator Sign In</h2>
            <p className="mt-1 text-sm text-slate-500">
              Authorized administrator credentials required for triage and resolution.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors text-lg leading-none cursor-pointer"
            aria-label="Close login"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onLogin} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Administrator Email
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@scms.pes.edu"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter admin password"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
              ⚠️ {error}
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 border border-slate-100">
            <span className="font-semibold text-slate-700">Evaluation Credentials:</span>
            <br />
            Email: <code className="font-mono text-slate-800">admin@scms.pes.edu</code>
            <br />
            Password: <code className="font-mono text-slate-800">AdminPassword123!</code>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              className="flex-1 rounded-xl bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer shadow-sm"
            >
              {loading ? "Authenticating…" : "Sign In"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
