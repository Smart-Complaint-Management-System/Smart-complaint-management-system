
export default function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-2 break-words text-sm text-slate-700">
        {value || "Not available"}
      </p>
    </div>
  );
}
