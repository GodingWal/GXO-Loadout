import { useState } from "react";
import { Menu } from "lucide-react";
import { useData } from "./hooks/useData";
import type { Navigation, Employee, Contact } from "./types";
import { SidebarContent } from "./components/Sidebar";
import { EmployeeFormModal } from "./components/EmployeeFormModal";
import { SkillFormModal } from "./components/SkillFormModal";
import { ContactFormModal } from "./components/ContactFormModal";
import { CoachingFormModal } from "./components/CoachingFormModal";
import { HomePage } from "./pages/HomePage";
import { TeamRosterPage } from "./pages/TeamRosterPage";
import { EmployeeDetailPage } from "./pages/EmployeeDetailPage";
import { SkillsLibraryPage } from "./pages/SkillsLibraryPage";
import { SkillDetailPage } from "./pages/SkillDetailPage";
import { RecordAssessmentPage } from "./pages/RecordAssessmentPage";
import { ContactsPage } from "./pages/ContactsPage";
import { EquipmentsPage } from "./pages/EquipmentsPage";
import { InspectionsPage } from "./pages/InspectionsPage";
import { InventoryPage } from "./pages/InventoryPage";

const pageTitle = (view: Navigation): string => {
  switch (view.name) {
    case 'home': return 'Operations Hub';
    case 'roster': return 'Team Roster';
    case 'employee': return view.emp?.fullName || 'Employee';
    case 'library': return 'Skills Library';
    case 'skill': return view.skill?.name || 'Skill';
    case 'record': return 'Record Assessment';
    case 'contacts': return 'Contacts';
    case 'equipments': return 'Equipment Roster';
    case 'inspections': return 'PIT Inspections';
    case 'inventory': return 'Inventory';
    default: return '';
  }
};

export default function App() {
  const {
    employees, ratings, jobRoles, skills, coaching, contacts, equipments, skillsByRole,
    loading, error,
    saveEmployee, toggleActive,
    saveRating, updateRatingValue,
    saveSkill, removeSkill,
    saveCoaching, closeCoaching, reopenCoaching, removeCoaching,
    saveContact, removeContact,
    saveEquipment, removeEquipment,
  } = useData();

  const [view, setView] = useState<Navigation>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      if (viewParam === 'inspections') {
        const eqId = params.get('equipmentId');
        return { name: 'inspections', defaultEquipmentId: eqId || undefined };
      }
    }
    return { name: 'home' };
  });
  const [empFormOpen, setEmpFormOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [coachingFormOpen, setCoachingFormOpen] = useState(false);
  const [coachingEmp, setCoachingEmp] = useState<Employee | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navigate = (v: Navigation) => { setView(v); setMobileNavOpen(false); };
  const activeCount = employees.filter(e => e.active).length;

  const handleSaveEmp = async (data: Omit<Employee, 'id'>, editingId?: number) => {
    await saveEmployee(data, editingId);
    setEditingEmp(null);
  };

  const handleSaveRating = async (data: { employeeId: number; skill: string; rating: 1 | 2 | 3 | 4; notes: string }) => {
    await saveRating(data);
    setView({ name: 'home' });
  };

  const handleDeleteSkill = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}" from the skill catalog?\n\nExisting employee ratings for this skill will not be removed, but the skill will no longer appear in the library.`)) return;
    await removeSkill(id);
  };

  const handleDeleteContact = async (id: number, name: string) => {
    if (!confirm(`Delete contact "${name}"? This cannot be undone.`)) return;
    await removeContact(id);
  };

  const handleDeleteCoaching = async (id: number, title: string) => {
    if (!confirm(`Delete coaching opportunity "${title}"? This cannot be undone.`)) return;
    await removeCoaching(id);
  };

  const handleSaveCoaching = async (data: { title: string; employeeId: number; notes: string }) => {
    await saveCoaching(data);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2]">
        <div className="text-center">
          <div className="font-serif text-2xl text-stone-900 mb-1 tracking-tight">GXO</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 mb-6">Operations Hub</div>
          <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-900 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-500">Loading employee data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] p-4">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-serif text-stone-900 mb-2">Couldn't load data</h2>
          <p className="text-sm text-stone-600 mb-4">{error}</p>
          <button onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 transition">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-stone-900">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="w-64 border-r border-stone-200 bg-white px-5 py-7 flex-col flex-shrink-0 hidden md:flex">
          <SidebarContent view={view} navigate={navigate} activeCount={activeCount} />
        </aside>

        {/* Mobile sidebar overlay */}
        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
            <aside className="relative w-72 max-w-[85vw] bg-white px-5 py-6 flex flex-col overflow-y-auto shadow-2xl">
              <SidebarContent view={view} navigate={navigate} activeCount={activeCount} onClose={() => setMobileNavOpen(false)} />
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="md:hidden sticky top-0 z-30 bg-[#FAF7F2]/90 backdrop-blur-sm border-b border-stone-200 flex items-center gap-3 px-4 py-3">
            <button onClick={() => setMobileNavOpen(true)}
              className="p-2 -ml-2 hover:bg-stone-100 active:bg-stone-200 rounded-full transition" aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-stone-500 font-medium leading-none">
                {view.name === 'employee' || view.name === 'skill' ? 'Detail' : 'GXO'}
              </p>
              <h1 className="text-sm font-medium text-stone-900 truncate leading-tight mt-0.5">{pageTitle(view)}</h1>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            {view.name === 'home' && (
              <HomePage employees={employees} onNavigate={navigate}
                onAdd={() => { setEditingEmp(null); setEmpFormOpen(true); }} />
            )}

            {view.name === 'roster' && (
              <TeamRosterPage employees={employees} ratings={ratings} jobRoles={jobRoles} onNavigate={navigate}
                onBack={() => navigate({ name: 'home' })}
                onAdd={() => { setEditingEmp(null); setEmpFormOpen(true); }}
                onEdit={(emp) => { setEditingEmp(emp); setEmpFormOpen(true); }}
                onToggleActive={toggleActive} />
            )}

            {view.name === 'employee' && view.emp && (
              <EmployeeDetailPage
                employee={view.emp}
                ratings={ratings}
                coaching={coaching}
                skillsByRole={skillsByRole}
                onBack={() => navigate({ name: 'roster' })}
                onAddSkill={(emp, sk) => navigate({ name: 'record', defaultEmp: emp, defaultSkill: sk })}
                onUpdateRating={updateRatingValue}
                onAddCoaching={(emp) => { setCoachingEmp(emp); setCoachingFormOpen(true); }}
                onCloseCoaching={closeCoaching}
                onReopenCoaching={reopenCoaching}
                onDeleteCoaching={handleDeleteCoaching} />
            )}

            {view.name === 'library' && (
              <SkillsLibraryPage
                ratings={ratings}
                skills={skills}
                jobRoles={jobRoles}
                onNavigate={navigate}
                onAddSkill={() => setSkillFormOpen(true)}
                onDeleteSkill={handleDeleteSkill}
              />
            )}

            {view.name === 'skill' && view.skill && (
              <SkillDetailPage skill={view.skill} employees={employees} ratings={ratings}
                onBack={() => navigate({ name: 'library' })}
                onNavigate={navigate}
                onAddRating={(emp, sk) => navigate({ name: 'record', defaultEmp: emp, defaultSkill: sk })} />
            )}

            {view.name === 'record' && (
              <RecordAssessmentPage employees={employees} skillsByRole={skillsByRole}
                defaultEmployee={view.defaultEmp}
                defaultSkill={view.defaultSkill}
                onSave={handleSaveRating}
                onCancel={() => navigate({ name: 'home' })} />
            )}

            {view.name === 'contacts' && (
              <ContactsPage
                contacts={contacts}
                onAdd={() => { setEditingContact(null); setContactFormOpen(true); }}
                onEdit={(c) => { setEditingContact(c); setContactFormOpen(true); }}
                onDelete={handleDeleteContact} />
            )}

            {view.name === 'equipments' && (
              <EquipmentsPage
                equipments={equipments}
                employees={employees}
                onSave={saveEquipment}
                onDelete={removeEquipment} />
            )}

            {view.name === 'inspections' && (
              <InspectionsPage equipments={equipments} defaultEquipmentId={view.defaultEquipmentId} />
            )}

            {view.name === 'inventory' && (
              <InventoryPage equipments={equipments} />
            )}
          </main>
        </div>
      </div>

      <EmployeeFormModal
        open={empFormOpen}
        onClose={() => { setEmpFormOpen(false); setEditingEmp(null); }}
        onSave={handleSaveEmp}
        employee={editingEmp}
        jobRoles={jobRoles}
      />

      <SkillFormModal
        open={skillFormOpen}
        onClose={() => setSkillFormOpen(false)}
        onSave={saveSkill}
        jobRoles={jobRoles}
      />

      <ContactFormModal
        open={contactFormOpen}
        onClose={() => { setContactFormOpen(false); setEditingContact(null); }}
        onSave={(data, id) => saveContact(data, id)}
        contact={editingContact}
      />

      {coachingEmp && (
        <CoachingFormModal
          open={coachingFormOpen}
          onClose={() => { setCoachingFormOpen(false); setCoachingEmp(null); }}
          onSave={handleSaveCoaching}
          employee={coachingEmp}
        />
      )}
    </div>
  );
}
