import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Home, Users, BookOpen, GraduationCap, BookUser, Building2, X, Wrench, ChevronDown, ChevronRight, Package, ClipboardCheck } from "lucide-react";
import type { Navigation } from "../types";


interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  indent?: boolean;
}

const NavItem = ({ icon: Icon, label, active, onClick, badge, indent }: NavItemProps) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 ${indent ? 'pl-8 pr-3' : 'px-3'} py-3 md:py-2.5 rounded-xl text-sm font-medium transition ${active ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100 active:bg-stone-200 hover:text-stone-900'}`}>
    <Icon size={16} />
    <span className="flex-1 text-left">{label}</span>
    {badge !== undefined && (
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>
        {badge}
      </span>
    )}
  </button>
);

interface SidebarProps {
  view: Navigation;
  navigate: (v: Navigation) => void;
  activeCount: number;
  onClose?: () => void;
}

export const SidebarContent = ({ view, navigate, activeCount, onClose }: SidebarProps) => {
  const [assetsOpen, setAssetsOpen] = useState(
    view.name === 'roster' || view.name === 'employee' || view.name === 'equipments' || view.name === 'inspections'
  );
  const [appsOpen, setAppsOpen] = useState(
    view.name === 'inventory'
  );
  const [skillsOpen, setSkillsOpen] = useState(
    view.name === 'library' || view.name === 'skill' || view.name === 'record'
  );

  return (
    <>
      <div className="mb-8 md:mb-10 px-1 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <svg viewBox="0 0 300 110" className="h-8 w-auto" xmlns="http://www.w3.org/2000/svg" aria-label="GXO">
          <text x="0" y="85" fontFamily="Arial Black, Arial, sans-serif" fontSize="100" fontWeight="900" fill="#FF4713" letterSpacing="-2">GXO</text>
          </svg>
          <div className="border-l border-stone-200 pl-2.5 min-w-0">
            <div className="font-medium text-sm text-stone-900 leading-tight">Operations Hub</div>
            <div className="text-[11px] text-stone-500">Bayer · Albert Lea</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-2 hover:bg-stone-100 rounded-full transition flex-shrink-0" aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="mb-2 px-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold">Main</p>
      </div>
      <nav className="space-y-1 mb-6">
        <NavItem icon={Home} label="Home"
          active={view.name === 'home'}
          onClick={() => { navigate({ name: 'home' }); onClose?.(); }} />
      </nav>

      {/* Collapsible Assets folder */}
      <div className="mb-2 px-3">
        <button
          onClick={() => setAssetsOpen(!assetsOpen)}
          className="w-full flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold hover:text-stone-600 transition"
        >
          {assetsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Assets
        </button>
      </div>
      {assetsOpen && (
        <nav className="space-y-1 mb-6">
          <NavItem icon={Users} label="Team Roster"
            active={view.name === 'roster' || view.name === 'employee'}
            onClick={() => { navigate({ name: 'roster' }); onClose?.(); }}
            badge={activeCount} />
          <NavItem icon={Wrench} label="Equipment"
            active={view.name === 'equipments'}
            onClick={() => { navigate({ name: 'equipments' }); onClose?.(); }} />
          <NavItem icon={ClipboardCheck} label="Inspections"
            active={view.name === 'inspections'}
            onClick={() => { navigate({ name: 'inspections' }); onClose?.(); }} />
        </nav>
      )}

      {/* Collapsible Apps folder */}
      <div className="mb-2 px-3">
        <button
          onClick={() => setAppsOpen(!appsOpen)}
          className="w-full flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold hover:text-stone-600 transition"
        >
          {appsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Apps
        </button>
      </div>
      {appsOpen && (
        <nav className="space-y-1 mb-6">
          <NavItem icon={Package} label="Inventory"
            active={view.name === 'inventory'}
            onClick={() => { navigate({ name: 'inventory' }); onClose?.(); }} />
        </nav>
      )}

      {/* Collapsible Skills folder */}
      <div className="mb-2 px-3">
        <button
          onClick={() => setSkillsOpen(!skillsOpen)}
          className="w-full flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold hover:text-stone-600 transition"
        >
          {skillsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Skills
        </button>
      </div>
      {skillsOpen && (
        <nav className="space-y-1 mb-6">
          <NavItem icon={BookOpen} label="Skills Library"
            active={view.name === 'library' || view.name === 'skill'}
            onClick={() => { navigate({ name: 'library' }); onClose?.(); }} />
          <NavItem icon={GraduationCap} label="Record Assessment"
            active={view.name === 'record'}
            onClick={() => { navigate({ name: 'record' }); onClose?.(); }} />
        </nav>
      )}

      <div className="mb-2 px-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold">Directory</p>
      </div>
      <nav className="space-y-1 flex-1">
        <NavItem icon={BookUser} label="Contacts"
          active={view.name === 'contacts'}
          onClick={() => { navigate({ name: 'contacts' }); onClose?.(); }} />
      </nav>

      <div className="border-t border-stone-100 pt-5 px-2">
        <div className="text-[11px] uppercase tracking-wider text-stone-400 mb-1.5 flex items-center gap-1.5">
          <Building2 size={11} /> Site
        </div>
        <div className="text-sm text-stone-700 font-medium">Bayer · Albert Lea</div>
        <div className="text-xs text-stone-500 mt-0.5">{activeCount} active members</div>
      </div>
    </>
  );
};
