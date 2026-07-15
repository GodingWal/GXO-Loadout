import { useState, useRef, useEffect, useCallback } from 'react';
import type { Equipment } from '../types';

/* ─── Types ──────────────────────────────────────────────────── */

interface InspectionEntry {
  /** ISO date string YYYY-MM-DD */
  date: string;
  equipmentSerial: string;
  physicalDamage: string;
  fluidLeaks: string;
  controls: string;
  safetyDevices: string;
  operatorShift: string;
  repairsNeeded: string;
  taggedOutOfService: string;
  supvInitials: string;
}

interface InspectionsPageProps {
  equipments: Equipment[];
  defaultEquipmentId?: string;
}

/* ─── Helpers ────────────────────────────────────────────────── */

const STORAGE_KEY = 'gxo-pit-inspections';

function loadInspections(): InspectionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveInspections(entries: InspectionEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

const DAY_LABELS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thur', 'Fri', 'Sat'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Return all weeks that overlap a given month. Each "week" is an array of 7 Date objects (Sun–Sat). */
function getWeeksForMonth(year: number, month: number): Date[][] {
  const weeks: Date[][] = [];

  // Start from the Sunday on or before the 1st
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday

  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);

  let cursor = new Date(start);
  while (cursor <= lastDay) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─── Component ──────────────────────────────────────────────── */

export function InspectionsPage({ equipments, defaultEquipmentId }: InspectionsPageProps) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedEquipment, setSelectedEquipment] = useState(defaultEquipmentId || '');
  const [inspections, setInspections] = useState<InspectionEntry[]>(loadInspections);
  const printRef = useRef<HTMLDivElement>(null);

  // Inspection entry modal
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(toISO(now));
  const [entryForm, setEntryForm] = useState({
    physicalDamage: '',
    fluidLeaks: '',
    controls: '',
    safetyDevices: '',
    operatorShift: '',
    repairsNeeded: '',
    taggedOutOfService: '',
    supvInitials: '',
  });

  // Auto-open entry modal if navigated via QR (deep-link)
  useEffect(() => {
    if (defaultEquipmentId) {
      setEntryOpen(true);
    }
  }, [defaultEquipmentId]);

  // Persist inspections
  useEffect(() => { saveInspections(inspections); }, [inspections]);

  const pitEquipments = equipments.filter(e =>
    e.type === 'Forklift' || e.type === 'Reach Truck' || e.type === 'Pallet Jack'
  );

  const weeks = getWeeksForMonth(selectedYear, selectedMonth);

  const handleMonthChange = (month: number, year: number) => {
    setSelectedMonth(month);
    setSelectedYear(year);
  };

  const openEntryModal = useCallback(() => {
    setEntryDate(toISO(new Date()));
    setEntryForm({
      physicalDamage: '',
      fluidLeaks: '',
      controls: '',
      safetyDevices: '',
      operatorShift: '',
      repairsNeeded: '',
      taggedOutOfService: '',
      supvInitials: '',
    });
    setEntryOpen(true);
  }, []);

  const handleSubmitEntry = () => {
    if (!selectedEquipment) { alert('Please select equipment first.'); return; }
    if (!entryForm.operatorShift.trim()) { alert('Operator name is required.'); return; }

    const entry: InspectionEntry = {
      date: entryDate,
      equipmentSerial: selectedEquipment,
      ...entryForm,
    };

    setInspections(prev => [...prev, entry]);
    setEntryOpen(false);
  };

  /** Get all inspection entries for a given date + equipment */
  const getEntriesForDay = (date: Date): InspectionEntry[] => {
    const iso = toISO(date);
    return inspections.filter(
      e => e.date === iso && e.equipmentSerial === selectedEquipment
    );
  };

  /** Merge multiple entries for same day into a single display row */
  const mergedRow = (date: Date) => {
    const entries = getEntriesForDay(date);
    if (entries.length === 0) return null;
    return {
      physicalDamage: entries.map(e => e.physicalDamage).filter(Boolean).join(', '),
      fluidLeaks: entries.map(e => e.fluidLeaks).filter(Boolean).join(', '),
      controls: entries.map(e => e.controls).filter(Boolean).join(', '),
      safetyDevices: entries.map(e => e.safetyDevices).filter(Boolean).join(', '),
      operatorShift: entries.map(e => e.operatorShift).filter(Boolean).join(', '),
      repairsNeeded: entries.map(e => e.repairsNeeded).filter(Boolean).join(', '),
      taggedOutOfService: entries.map(e => e.taggedOutOfService).filter(Boolean).join(', '),
      supvInitials: entries.map(e => e.supvInitials).filter(Boolean).join(', '),
    };
  };

  const handlePrint = () => { window.print(); };

  /* ─── Styles (inline for print fidelity) ──────────────────── */

  const thStyle: React.CSSProperties = {
    border: '1px solid #222',
    padding: '1px 2px',
    fontSize: 7,
    fontWeight: 700,
    textAlign: 'center',
    background: '#f8f4ef',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    border: '1px solid #555',
    padding: '0px 2px',
    fontSize: 7,
    height: 13,
    verticalAlign: 'middle',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    maxWidth: 0,
  };

  const weekHeaderStyle: React.CSSProperties = {
    border: '1px solid #222',
    padding: '1px 2px',
    fontSize: 7,
    fontWeight: 700,
    background: '#d4d0cc',
  };

  /* ─── Render a single week block (tbody) ──────────────────── */
  const renderWeek = (weekDates: Date[], weekIdx: number, isFirst: boolean) => {
    return (
      <tbody key={weekIdx}>
        {/* Week header – every week */}
        <tr>
          <td style={weekHeaderStyle}>Week:</td>
          <td colSpan={2} style={weekHeaderStyle}>
            <span style={{ marginRight: 3 }}>Mon/Yr:</span>
          </td>
          <td style={weekHeaderStyle}>/</td>
          <td colSpan={2} style={weekHeaderStyle}>
            {isFirst && <span style={{ marginRight: 3 }}>PIT ID #:</span>}
          </td>
          <td colSpan={2} style={weekHeaderStyle}></td>
          <td style={{ ...weekHeaderStyle, fontSize: 6, lineHeight: '1' }}>Tagged<br />Out of<br />Service<br />(Y/N)</td>
          <td style={{ ...weekHeaderStyle, fontSize: 6, lineHeight: '1' }}>Supv.<br />Notified<br />Initials</td>
        </tr>
        {/* Column headers – every week */}
        <tr>
          <th style={{ ...thStyle, width: 38 }}>Day of<br />Week</th>
          <th style={{ ...thStyle, width: 52 }}>Physical<br />Damage/ Wear</th>
          <th style={{ ...thStyle, width: 34 }}>Fluid<br />Leaks</th>
          <th style={{ ...thStyle, width: 40 }}>Controls</th>
          <th style={{ ...thStyle, width: 40 }}>Safety<br />Devices</th>
          <th style={{ ...thStyle, width: 120 }}>Operator(s) Names/Shift</th>
          <th style={{ ...thStyle, width: 120 }}>Repairs Needed</th>
          <th style={{ ...thStyle, width: 0 }} colSpan={1}></th>
          <th style={{ ...thStyle, width: 32 }}></th>
          <th style={{ ...thStyle, width: 32 }}></th>
        </tr>
        {/* 7 day rows */}
        {weekDates.map((date, dayIdx) => {
          const row = mergedRow(date);
          return (
            <tr key={dayIdx}>
              <td style={{ ...tdStyle, fontWeight: 600, fontSize: 7, textAlign: 'center', maxWidth: 'none' }}>{DAY_LABELS[dayIdx]}</td>
              <td style={tdStyle}>{row?.physicalDamage || ''}</td>
              <td style={tdStyle}>{row?.fluidLeaks || ''}</td>
              <td style={tdStyle}>{row?.controls || ''}</td>
              <td style={tdStyle}>{row?.safetyDevices || ''}</td>
              <td style={tdStyle}>{row?.operatorShift || ''}</td>
              <td style={tdStyle}>{row?.repairsNeeded || ''}</td>
              <td style={{ ...tdStyle, width: 0 }} colSpan={1}></td>
              <td style={{ ...tdStyle, width: 32 }}>{row?.taggedOutOfService || ''}</td>
              <td style={{ ...tdStyle, width: 32 }}>{row?.supvInitials || ''}</td>
            </tr>
          );
        })}
      </tbody>
    );
  };

  /* ─── Question labels for the entry modal ─────────────────── */
  const fields: { key: keyof typeof entryForm; label: string; placeholder: string; type?: 'select' }[] = [
    { key: 'physicalDamage', label: 'Physical Damage / Wear?', placeholder: 'OK, Scratches, Dents…' },
    { key: 'fluidLeaks', label: 'Fluid Leaks?', placeholder: 'None, Oil leak, Hydraulic…' },
    { key: 'controls', label: 'Controls functioning?', placeholder: 'OK, Horn broken…' },
    { key: 'safetyDevices', label: 'Safety Devices?', placeholder: 'OK, Seatbelt missing…' },
    { key: 'operatorShift', label: 'Operator Name / Shift *', placeholder: 'John D. / 1st' },
    { key: 'repairsNeeded', label: 'Repairs Needed?', placeholder: 'None, Replace tire…' },
    { key: 'taggedOutOfService', label: 'Tagged Out of Service?', placeholder: 'Y or N', type: 'select' },
    { key: 'supvInitials', label: 'Supervisor Notified / Initials', placeholder: 'JD' },
  ];

  const selectedEquipObj = equipments.find(e => e.serialNumber === selectedEquipment);

  /* ─── JSX ──────────────────────────────────────────────────── */
  return (
    <div className="p-6 md:p-8">
      {/* Screen-only controls */}
      <div className="no-print mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Assets</p>
            <h1 className="text-2xl md:text-3xl font-serif text-stone-900 tracking-tight">PIT Pre-Shift Inspections</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openEntryModal}
              disabled={!selectedEquipment}
              className="px-5 py-2.5 bg-emerald-700 text-white rounded-full text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
              Fill Out Inspection
            </button>
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 transition flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
              Print Checklist
            </button>
          </div>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <select
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white"
            value={selectedEquipment}
            onChange={e => setSelectedEquipment(e.target.value)}
          >
            <option value="">Select PIT equipment...</option>
            {pitEquipments.map(eq => (
              <option key={eq.id} value={eq.serialNumber}>{eq.name} ({eq.serialNumber})</option>
            ))}
          </select>

          <select
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white"
            value={selectedMonth}
            onChange={e => handleMonthChange(parseInt(e.target.value), selectedYear)}
          >
            {MONTHS.map((m, idx) => (
              <option key={idx} value={idx}>{m}</option>
            ))}
          </select>

          <select
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white"
            value={selectedYear}
            onChange={e => handleMonthChange(selectedMonth, parseInt(e.target.value))}
          >
            {[2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Printable checklist – full month */}
      <div ref={printRef} className="pit-checklist-print" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        {/* Form header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, borderBottom: '2px solid #222', paddingBottom: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 700 }}>
            FORM5142 - PIT Pre-Shift Inspection Checklist Rev06
          </div>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#FF4713', fontFamily: 'Arial Black, Arial, sans-serif' }}>
            GXO
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          {weeks.map((week, idx) => renderWeek(week, idx, idx === 0))}
        </table>
      </div>

      {/* ─── Inspection Entry Modal ─────────────────────────── */}
      {entryOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-stone-900/40 backdrop-blur-sm" onClick={() => setEntryOpen(false)}>
          <div className="bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 md:px-7 py-5 md:py-6 border-b border-stone-100 sticky top-0 bg-white z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] md:text-xs uppercase tracking-[0.2em] text-stone-500 font-medium mb-1">Pre-Shift Inspection</p>
                  <h2 className="text-xl md:text-2xl font-serif text-stone-900">
                    {selectedEquipObj ? selectedEquipObj.name : selectedEquipment}
                  </h2>
                </div>
                <button onClick={() => setEntryOpen(false)} className="p-2.5 hover:bg-stone-100 active:bg-stone-200 rounded-full transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {selectedEquipObj && (
                <p className="text-xs text-stone-500 mt-1">Serial: {selectedEquipObj.serialNumber} · {selectedEquipObj.type}</p>
              )}
            </div>

            {/* Form body */}
            <div className="px-5 md:px-7 py-5 md:py-6 space-y-4">
              {/* Date picker */}
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Inspection Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={e => setEntryDate(e.target.value)}
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                />
              </div>

              {/* Inspection questions */}
              {fields.map(f => (
                <div key={f.key}>
                  <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      value={entryForm[f.key]}
                      onChange={e => setEntryForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                    >
                      <option value="">Select…</option>
                      <option value="N">N – No</option>
                      <option value="Y">Y – Yes</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={entryForm[f.key]}
                      onChange={e => setEntryForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                    />
                  )}
                </div>
              ))}

              {/* Actions */}
              <div className="pt-4 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setEntryOpen(false)}
                  className="px-5 py-3 text-sm font-medium text-stone-700 hover:bg-stone-100 active:bg-stone-200 rounded-full transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitEntry}
                  className="px-5 py-3 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-500 rounded-full transition shadow-sm"
                >
                  Submit Inspection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print, header, aside, [class*="sidebar"], nav { 
            display: none !important; 
          }
          body, html { 
            margin: 0 !important; 
            padding: 0 !important; 
            background: white !important;
          }
          .min-h-screen { min-height: auto !important; }
          .flex.min-h-screen { display: block !important; }
          main { overflow: visible !important; padding: 0 !important; }
          .p-6, .md\:p-8 { padding: 0 !important; }
          .pit-checklist-print { 
            padding: 4px !important; 
            margin: 0 !important;
          }
          @page { 
            size: portrait; 
            margin: 0.2in; 
          }
        }
      `}</style>
    </div>
  );
}
