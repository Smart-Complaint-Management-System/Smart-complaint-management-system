const STAGES = ["Submitted", "Assigned", "Accepted", "In Progress", "Work Completed", "Resolved", "Closed"];

export default function StatusTimeline({ currentStatus }) {
  const effectiveIndex = STAGES.indexOf(currentStatus);

  return (
    <div className="py-4">
      <div className="flex items-center justify-between">
        {STAGES.map((stage, idx) => {
          const isDone = effectiveIndex > idx;
          const isCurrent = effectiveIndex === idx;

          return (
            <div key={stage} className="flex-1 text-center relative">
              {/* Connector line */}
              {idx > 0 && (
                <div
                  className={`absolute top-4 -left-1/2 w-full h-1 -translate-y-1/2 z-0 ${
                    effectiveIndex >= idx ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                />
              )}

              {/* Circle */}
              <div className="relative z-10 flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-100"
                      : isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isDone ? "✓" : idx + 1}
                </div>
                <span
                  className={`mt-2 block text-xs font-medium ${
                    isCurrent
                      ? "font-bold text-blue-700"
                      : isDone
                      ? "text-emerald-700"
                      : "text-slate-400"
                  }`}
                >
                  {stage}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
