import { useMemo } from "react";
import { SectionHead } from "../components/UI";
import type { Employee, Navigation } from "../types";

interface Props {
  employees: Employee[];
  onNavigate: (v: Navigation) => void;
  onAdd: () => void;
}

export const HomePage = ({ employees }: Props) => {
  const stats = useMemo(() => ({
    total: employees.length,
    active: employees.filter(e => e.active).length,
    firstShift: employees.filter(e => e.shift === '1st' && e.active).length,
    secondShift: employees.filter(e => e.shift === '2nd' && e.active).length,
  }), [employees]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-6 md:py-12">
      <SectionHead
        eyebrow="Bayer · Albert Lea"
        title="Operations Hub"
        subtitle="A directory of your team and Equipment. The source of truth for every other employee management activity."
      />

      <div className="mb-3 md:mb-4 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-stone-500 font-medium">Facility Performance (Daily)</h2>
        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md font-medium border border-emerald-100 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
          Auto-synced from AMB Reports
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-10">
        <StatCard label="Inbounds Staged" value="34" hint="Currently in lanes" />
        <StatCard label="Inbounds Putaway" value="26" hint="Completed today" accent="emerald" />
        <StatCard label="Orders Picked" value="12" hint="Outbound loads" />
        <StatCard label="Verify Errors" value="2" hint="Caught in verification" />
      </div>

      <div className="mb-3 md:mb-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-stone-500 font-medium">Team Overview</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-12">
        <StatCard label="Total" value={stats.total} hint="On the roster" />
        <StatCard label="Active" value={stats.active} hint="Currently working" accent="emerald" />
        <StatCard label="1st Shift" value={stats.firstShift} hint="Day shift" />
        <StatCard label="2nd Shift" value={stats.secondShift} hint="Night shift" />
      </div>
    </div>
  );
};

const StatCard = ({ label, value, suffix, hint, accent }: { label: string; value: number | string; suffix?: string; hint: string; accent?: 'emerald' }) => {
  const valueColor = accent === 'emerald' ? 'text-emerald-700' : 'text-stone-900';
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-6">
      <div className="text-[10px] md:text-xs uppercase tracking-wider text-stone-500 font-medium mb-2 md:mb-3">{label}</div>
      <div className="flex items-baseline gap-1 mb-1 md:mb-2">
        <div className={`font-serif text-3xl md:text-5xl ${valueColor} leading-none`}>{value}</div>
        {suffix && <div className={`text-sm md:text-base font-semibold ${valueColor}`}>{suffix}</div>}
      </div>
      <div className="text-[10px] md:text-xs text-stone-500">{hint}</div>
    </div>
  );
};
