
export default function LoginPrompt({ onLogin }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="font-semibold">Admin login required</p>

      <p className="mt-2 text-sm text-slate-500">
        Sign in to view complaints.
      </p>

      <button
        type="button"
        onClick={onLogin}
        className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white"
      >
        Sign in
      </button>
    </div>
  );
}
