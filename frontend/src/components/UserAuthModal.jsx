import { useState, useEffect } from "react";

export default function UserAuthModal({
  isOpen,
  onClose,
  onLoginSuccess,
  onRegisterSuccess,
}) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (isRegister) {
      if (!name.trim()) {
        setError("Please enter your full name.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      setLoading(true);
      try {
        await onRegisterSuccess(name.trim(), email.trim(), password);
        setName("");
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        onClose();
      } catch (err) {
        setError(
          err.response?.data?.message || err.message || "Registration failed."
        );
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        await onLoginSuccess(email.trim(), password);
        setEmail("");
        setPassword("");
        onClose();
      } catch (err) {
        setError(
          err.response?.data?.message || err.message || "Invalid credentials. Please verify your email and password."
        );
      } finally {
        setLoading(false);
      }
    }
  }

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
            <h2 className="text-xl font-bold text-slate-900">
              {isRegister ? "Create User Account" : "User Sign In"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isRegister
                ? "Register to submit and track complaints."
                : "Sign in with your registered account credentials."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-lg leading-none cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {isRegister && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dhruva Hegde"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Email Address
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@scms.pes.edu"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {isRegister && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Confirm Password
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
              ⚠️ {error}
            </div>
          )}

          {!isRegister && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 border border-slate-100">
              <span className="font-semibold text-slate-700">Sample Student Account:</span>
              <br />
              Email: <code className="font-mono text-slate-800">student@scms.pes.edu</code>
              <br />
              Password: <code className="font-mono text-slate-800">StudentPassword123!</code>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
            >
              {loading
                ? isRegister
                  ? "Creating account…"
                  : "Signing in…"
                : isRegister
                ? "Register Account"
                : "Sign In"}
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

        <div className="mt-5 border-t border-slate-100 pt-4 text-center">
          <p className="text-sm text-slate-500">
            {isRegister ? "Already have an account?" : "Need an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="font-semibold text-blue-600 hover:underline cursor-pointer"
            >
              {isRegister ? "Sign In" : "Register here"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
