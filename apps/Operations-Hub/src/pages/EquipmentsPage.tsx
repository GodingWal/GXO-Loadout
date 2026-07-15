import { useState, useMemo } from "react";
import { Wrench, Plus, Search, Trash2, Edit, X, User, Calendar, Tag, QrCode } from "lucide-react";
import QRCode from "react-qr-code";
import { SectionHead } from "../components/UI";
import type { Equipment, Employee } from "../types";

interface Props {
  equipments: Equipment[];
  employees: Employee[];
  onSave: (data: Omit<Equipment, 'id'>, editingId?: number) => void;
  onDelete: (id: number) => void;
}

const EQUIPMENT_TYPES = ['Forklift', 'Reach Truck', 'Pallet Jack', 'RF Scanner', 'Printer', 'Other'] as const;
const STATUS_OPTIONS = ['Available', 'In Use', 'Under Maintenance', 'Out of Service'] as const;

export const EquipmentsPage = ({ equipments, employees, onSave, onDelete }: Props) => {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");

  // Edit/Create Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  const [qrEquipment, setQrEquipment] = useState<Equipment | null>(null);

  // Form State
  const [form, setForm] = useState<Omit<Equipment, 'id'>>({
    name: '',
    type: 'Forklift',
    status: 'Available',
    assignedToId: undefined,
    serialNumber: '',
    lastInspected: '',
    notes: '',
  });

  const stats = useMemo(() => ({
    total: equipments.length,
    available: equipments.filter(e => e.status === 'Available').length,
    inUse: equipments.filter(e => e.status === 'In Use').length,
    maintenance: equipments.filter(e => e.status === 'Under Maintenance' || e.status === 'Out of Service').length,
  }), [equipments]);

  const filteredEquipments = useMemo(() => {
    return equipments.filter(eq => {
      const matchSearch =
        eq.name.toLowerCase().includes(search.toLowerCase()) ||
        eq.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
        (eq.notes && eq.notes.toLowerCase().includes(search.toLowerCase()));

      const matchType = selectedType === "All" || eq.type === selectedType;
      const matchStatus = selectedStatus === "All" || eq.status === selectedStatus;

      return matchSearch && matchType && matchStatus;
    });
  }, [equipments, search, selectedType, selectedStatus]);

  const handleOpenModal = (item: Equipment | null = null) => {
    if (item) {
      setEditingItem(item);
      setForm({
        name: item.name,
        type: item.type,
        status: item.status,
        assignedToId: item.assignedToId,
        serialNumber: item.serialNumber,
        lastInspected: item.lastInspected || '',
        notes: item.notes || '',
      });
    } else {
      setEditingItem(null);
      setForm({
        name: '',
        type: 'Forklift',
        status: 'Available',
        assignedToId: undefined,
        serialNumber: '',
        lastInspected: new Date().toISOString().split('T')[0],
        notes: '',
      });
    }
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.serialNumber.trim()) return;
    onSave(form, editingItem?.id);
    setModalOpen(false);
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      onDelete(id);
    }
  };

  const getStatusColor = (status: Equipment['status']) => {
    switch (status) {
      case 'Available':
        return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
      case 'In Use':
        return { bg: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' };
      case 'Under Maintenance':
        return { bg: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
      case 'Out of Service':
        return { bg: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' };
    }
  };

  const activeEmployees = useMemo(() => employees.filter(e => e.active), [employees]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-6 md:py-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <SectionHead
          eyebrow="Equipment & Fleet"
          title="Equipment Roster"
          subtitle="Track, assign, and manage warehouse equipment assets."
        />
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center justify-center gap-2 px-5 py-3 md:py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 active:bg-stone-700 transition self-start shadow-sm"
        >
          <Plus size={16} />
          <span>Add Equipment</span>
        </button>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5">
          <div className="text-[10px] md:text-xs uppercase tracking-wider text-stone-500 font-medium mb-1">Total Assets</div>
          <div className="font-serif text-2xl md:text-3xl text-stone-900 leading-none">{stats.total}</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5">
          <div className="text-[10px] md:text-xs uppercase tracking-wider text-stone-500 font-medium mb-1">Available</div>
          <div className="font-serif text-2xl md:text-3xl text-emerald-700 leading-none">{stats.available}</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5">
          <div className="text-[10px] md:text-xs uppercase tracking-wider text-stone-500 font-medium mb-1">In Use</div>
          <div className="font-serif text-2xl md:text-3xl text-blue-700 leading-none">{stats.inUse}</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 md:p-5">
          <div className="text-[10px] md:text-xs uppercase tracking-wider text-stone-500 font-medium mb-1">Down / Repair</div>
          <div className="font-serif text-2xl md:text-3xl text-amber-700 leading-none">{stats.maintenance}</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3 md:gap-4 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Search assets or serial numbers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 sm:py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="px-4 py-3 sm:py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition"
          >
            <option value="All">All Types</option>
            {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="px-4 py-3 sm:py-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition"
          >
            <option value="All">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Equipment Grid */}
      {filteredEquipments.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-2xl border border-dashed border-stone-200">
          <Wrench size={32} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-serif text-lg text-stone-900 mb-1">No equipment found</h3>
          <p className="text-sm text-stone-500">Try adjusting your filters or search terms.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredEquipments.map(eq => {
            const statusStyle = getStatusColor(eq.status);
            const assignedEmp = eq.assignedToId ? employees.find(emp => emp.id === eq.assignedToId) : null;

            return (
              <div key={eq.id} className="bg-white border border-stone-200 rounded-2xl p-5 hover:border-stone-900 hover:shadow-lg transition flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{eq.type}</span>
                      <h4 className="font-serif text-lg text-stone-900">{eq.name}</h4>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusStyle.bg}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {eq.status}
                    </span>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-xs text-stone-600">
                      <Tag size={13} className="text-stone-400" />
                      <span>Serial: <span className="font-mono font-medium">{eq.serialNumber}</span></span>
                    </div>

                    {eq.lastInspected && (
                      <div className="flex items-center gap-2 text-xs text-stone-600">
                        <Calendar size={13} className="text-stone-400" />
                        <span>Last Inspected: <span className="font-medium">{eq.lastInspected}</span></span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-stone-600">
                      <User size={13} className="text-stone-400" />
                      {assignedEmp ? (
                        <span>Assigned to: <span className="font-medium text-stone-900">{assignedEmp.fullName}</span> ({assignedEmp.jobRole})</span>
                      ) : (
                        <span className="text-stone-400 italic">Unassigned</span>
                      )}
                    </div>
                  </div>

                  {eq.notes && (
                    <p className="text-xs text-stone-500 bg-stone-50 p-2.5 rounded-xl border border-stone-100 mb-4 line-clamp-2">
                      {eq.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end border-t border-stone-100 pt-3 gap-2">
                  <button
                    onClick={() => setQrEquipment(eq)}
                    className="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 rounded-lg transition"
                    title="Print QR Code"
                  >
                    <QrCode size={16} />
                  </button>
                  <button
                    onClick={() => handleOpenModal(eq)}
                    className="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 rounded-lg transition"
                    title="Edit asset"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(eq.id, eq.name)}
                    className="p-2 text-stone-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete asset"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 bg-stone-900/40 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 md:px-7 py-5 md:py-6 border-b border-stone-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <p className="text-[10px] md:text-xs uppercase tracking-[0.2em] text-stone-500 font-medium mb-1">
                  {editingItem ? 'Edit Asset' : 'New Asset'}
                </p>
                <h2 className="text-xl md:text-2xl font-serif text-stone-900 truncate">
                  {editingItem ? form.name || 'Edit Asset' : 'Add Equipment'}
                </h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2.5 hover:bg-stone-100 active:bg-stone-200 rounded-full transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-5 md:px-7 py-5 md:py-6 space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Asset Name *</label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Forklift #3"
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                  >
                    {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Serial Number *</label>
                  <input
                    required
                    type="text"
                    value={form.serialNumber}
                    onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))}
                    placeholder="FL-2024-03"
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Last Inspected</label>
                  <input
                    type="date"
                    value={form.lastInspected}
                    onChange={e => setForm(f => ({ ...f, lastInspected: e.target.value }))}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Assign to Operator</label>
                <select
                  value={form.assignedToId || ''}
                  onChange={e => setForm(f => ({ ...f, assignedToId: e.target.value ? parseInt(e.target.value) : undefined }))}
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition"
                >
                  <option value="">Unassigned</option>
                  {activeEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.jobRole})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">Notes / Description</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="E.g., battery health, minor scratches, specific issues..."
                  rows={3}
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 focus:bg-white transition resize-none"
                />
              </div>

              <div className="pt-4 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-3 text-sm font-medium text-stone-700 hover:bg-stone-100 active:bg-stone-200 rounded-full transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-3 text-sm font-medium text-white bg-stone-900 hover:bg-stone-800 active:bg-stone-700 rounded-full transition shadow-sm"
                >
                  {editingItem ? 'Save Changes' : 'Create Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrEquipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" onClick={() => setQrEquipment(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col qr-modal" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between no-print">
              <h3 className="font-serif text-lg text-stone-900">QR Code</h3>
              <button onClick={() => setQrEquipment(null)} className="p-2 hover:bg-stone-100 rounded-full transition">
                <X size={18} />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center bg-white qr-print-area">
              <div className="mb-4 text-center">
                <div className="text-xl font-bold">{qrEquipment.name}</div>
                <div className="text-stone-500">ID: {qrEquipment.serialNumber}</div>
              </div>
              <QRCode value={`${window.location.origin}/?view=inspections&equipmentId=${qrEquipment.serialNumber}`} size={200} />
              <div className="mt-4 text-sm font-semibold uppercase tracking-wider text-stone-500">
                Scan to Inspect
              </div>
            </div>
            <div className="p-4 border-t border-stone-100 flex justify-end no-print">
              <button
                onClick={() => window.print()}
                className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 transition flex items-center gap-2"
              >
                <QrCode size={16} />
                Print QR Code
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .qr-modal, .qr-modal * {
            visibility: visible;
          }
          .qr-modal {
            position: absolute;
            left: 0;
            top: 0;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
};
