// Import + re-export JobRole from the ontology package to keep a single source of
// truth (the plain `export type { ... }` form does not bring the name into scope
// for local use below).
import type { JobRole } from '@gxo/semantic';
export type { JobRole };

export interface Employee {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  shift: '1st' | '2nd';
  jobRole: JobRole;
  hireDate: string;
  active: boolean;
  photoUrl?: string;
  shirtSize?: string;
  birthday?: string;
  cwr?: boolean;
  phoneNumber?: string;
  cwid?: string;
  notes?: string;
}

export interface EmployeeSkill {
  id: number;
  employeeId: number;
  skill: string;
  rating: 1 | 2 | 3 | 4;
  dateAssessed: string;
  assessedBy: string;
  notes?: string;
}

export interface Skill {
  id: number;
  name: string;
  jobRoles: string[];
  process?: string;
  action?: string;
}

export interface CoachingOpportunity {
  id: number;
  employeeId: number;
  title: string;
  notes?: string;
  status: 'Open' | 'Closed';
  dateOpened: string;
  dateClosed?: string;
}

export interface Contact {
  id: number;
  fullName: string;
  company: string;
  role: string;
  phone: string;
  email: string;
  category: string;
}

export type Navigation =
  | { name: 'home' }
  | { name: 'roster' }
  | { name: 'employee'; emp: Employee }
  | { name: 'library' }
  | { name: 'skill'; skill: Skill }
  | { name: 'record'; defaultEmp?: Employee; defaultSkill?: string }
  | { name: 'contacts' }
  | { name: 'equipments' }
  | { name: 'inspections'; defaultEquipmentId?: string }
  | { name: 'inventory' };

export const RATING_META: Record<number, { label: string; desc: string; color: string; bg: string; light: string }> = {
  1: { label: 'In-Training', desc: 'Learning, needs supervision', color: '#B91C1C', bg: '#FEF2F2', light: '#FEF2F2' },
  2: { label: 'Trained', desc: 'Can work independently', color: '#B45309', bg: '#FFFBEB', light: '#FFFBEB' },
  3: { label: 'Experienced', desc: 'Consistently meets standards', color: '#15803D', bg: '#F0FDF4', light: '#F0FDF4' },
  4: { label: 'Expert', desc: 'Can train others', color: '#1D4ED8', bg: '#EFF6FF', light: '#EFF6FF' },
};

export const ratingMeta = RATING_META;

const ROLE_COLORS: Record<string, { hex: string; bg: string }> = {
  'CSR/Clerk':         { hex: '#44403C', bg: 'bg-stone-700' },
  'Inventory':         { hex: '#065F46', bg: 'bg-emerald-800' },
  'PIT':               { hex: '#B45309', bg: 'bg-amber-700' },
  'Lab':               { hex: '#6B21A8', bg: 'bg-purple-800' },
  'Lead':              { hex: '#1E40AF', bg: 'bg-blue-800' },
  'Supervisor':        { hex: '#9F1239', bg: 'bg-rose-800' },
  'Operations Manager':{ hex: '#0F172A', bg: 'bg-slate-900' },
};

export const getRoleColor = (role: string): { hex: string; bg: string } => {
  return ROLE_COLORS[role] || { hex: '#78716C', bg: 'bg-stone-500' };
};

export const isPitRole = (role: string): boolean => {
  return role.toLowerCase().includes('pit');
};

export interface Equipment {
  id: number;
  name: string;
  type: 'Forklift' | 'Reach Truck' | 'Pallet Jack' | 'RF Scanner' | 'Printer' | 'Other';
  status: 'Available' | 'In Use' | 'Under Maintenance' | 'Out of Service';
  assignedToId?: number;
  lastInspected?: string;
  serialNumber: string;
  notes?: string;
}

