import { useState, useEffect } from 'react';
import { StagingLanesMap, ontologyClient, KanbanBoard, KanbanColumnDef, KanbanCardDef, DashboardKPIBoxes, DashboardTabs, AppointmentObject } from '@gxo/semantic';
import { OrderCreationModal } from './components/OrderCreationModal';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'schedule' | 'gate' | 'admin' | 'staging-map'>('dashboard');
  const [dashboardTab, setDashboardTab] = useState<'Inbound' | 'Outbound' | 'Return'>('Outbound');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stats, setStats] = useState({ total: 0, checked_in: 0, completed: 0, late: 0, missed: 0, ib_count: 0, ob_count: 0 });
  const [appointments, setAppointments] = useState<AppointmentObject[]>([]);
  const [orderCreationAppt, setOrderCreationAppt] = useState<AppointmentObject | null>(null);
  const [metadata, setMetadata] = useState<any>({ customers: [], carriers: [], productTypes: [], doors: [], operators: [] });
  const [loading, setLoading] = useState(false);

  // Forms
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAppt, setNewAppt] = useState({ date: '', time: '', type: 'Inbound', carrierId: '', bol: '', customerId: '', productTypeId: '' });
  const [checkInSearch, setCheckInSearch] = useState('');
  const [checkInMatches, setCheckInMatches] = useState<any[]>([]);
  const [selectedCheckIn, setSelectedCheckIn] = useState<any | null>(null);
  const [checkInForm, setCheckInForm] = useState({ doorId: '', operatorId: '', pitTaskType: 'Inbound' });

  const [checkOutSearch, setCheckOutSearch] = useState('');
  const [checkOutMatches, setCheckOutMatches] = useState<any[]>([]);

  // Since we don't have customers/carriers in DB yet, use hardcoded list for dropdowns
  const customers = [{id: 1, name: 'Bayer'}, {id: 2, name: 'Syngenta'}];
  const carriers = [{id: 1, name: 'FedEx Freight'}, {id: 2, name: 'XPO Logistics'}];
  const productTypes = [{id: 1, name: 'Seed'}, {id: 2, name: 'Chemicals'}];

  // Fetch metadata on mount
  useEffect(() => {
    fetchMetadata();
  }, []);

  // Fetch stats & data when view changes
  useEffect(() => {
    if (view === 'dashboard' || view === 'schedule') {
      fetchDashboardData();
    }
    if (view === 'schedule' || view === 'gate') {
      fetchAppointments();
    }
  }, [view]);

  async function fetchMetadata() {
    try {
      const [doors, operators] = await Promise.all([
        ontologyClient.getDoors(),
        ontologyClient.getOperators()
      ]);
      setMetadata({ customers, carriers, productTypes, doors, operators });
    } catch (err) {
      console.error('Failed to load metadata', err);
    }
  }

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const statsData = await ontologyClient.getAppointmentStats().catch(() => ({ total: 0, checked_in: 0, completed: 0, late: 0, missed: 0, ib_count: 0, ob_count: 0 }));
      setStats(statsData);
      
      const appts = await ontologyClient.getAppointments();
      setAppointments(appts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAppointments() {
    setLoading(true);
    try {
      const appts = await ontologyClient.getAppointments();
      setAppointments(appts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Action: Add Appointment
  async function handleAddAppointment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await ontologyClient.createAppointment({
        date: newAppt.date,
        time: newAppt.time,
        type: newAppt.type,
        carrier: metadata.carriers.find((c: any) => c.id === parseInt(newAppt.carrierId))?.name || '',
        bolShipmentNo: newAppt.bol,
        customer: metadata.customers.find((c: any) => c.id === parseInt(newAppt.customerId))?.name || '',
        productType: metadata.productTypes.find((p: any) => p.id === parseInt(newAppt.productTypeId))?.name || ''
      });
      alert('Appointment created successfully!');
      setNewAppt({ date: '', time: '', type: 'Inbound', carrierId: '', bol: '', customerId: '', productTypeId: '' });
      setShowAddForm(false);
      fetchAppointments();
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Action: Search Check-In
  async function handleSearchCheckIn() {
    if (!checkInSearch.trim()) return;
    try {
      const appts = await ontologyClient.getAppointments('Scheduled');
      const query = checkInSearch.toLowerCase();
      const matches = appts.filter((appt: any) =>
        String(appt.properties.bolShipmentNo || '').toLowerCase().includes(query) ||
        String(appt.properties.carrier || '').toLowerCase().includes(query) ||
        String(appt.properties.customer || '').toLowerCase().includes(query)
      );
      setCheckInMatches(matches);
    } catch (err) {
      console.error(err);
    }
  }

  // Action: Confirm Check-In
  async function handleConfirmCheckIn(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCheckIn) return;
    try {
      await ontologyClient.checkInAppointment({
        appointmentId: selectedCheckIn.id,
        doorId: parseInt(checkInForm.doorId),
        operatorId: parseInt(checkInForm.operatorId)
      });
      // Create PIT Task for the check-in
      await ontologyClient.createPitTask({
        appointmentId: selectedCheckIn.id,
        type: checkInForm.pitTaskType
      });

      alert('Driver checked in successfully!');
      setSelectedCheckIn(null);
      setCheckInSearch('');
      setCheckInMatches([]);
      setView('dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Action: Search Check-Out
  async function handleSearchCheckOut() {
    if (!checkOutSearch.trim()) return;
    try {
      const appts = await ontologyClient.getAppointments('Checked In');
      const query = checkOutSearch.toLowerCase();
      const matches = appts.filter((appt: any) =>
        String(appt.properties.bolShipmentNo || '').toLowerCase().includes(query) ||
        String(appt.properties.carrier || '').toLowerCase().includes(query)
      );
      setCheckOutMatches(matches);
    } catch (err) {
      console.error(err);
    }
  }

  // Action: Confirm Check-Out
  async function handleConfirmCheckOut(apptId: number) {
    if (!confirm('Are you sure you want to check out this driver?')) return;
    try {
      await ontologyClient.checkOutAppointment({ appointmentId: apptId });
      alert('Driver checked out successfully!');
      setCheckOutSearch('');
      setCheckOutMatches([]);
      setView('dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Kanban setup
  const workflows: Record<string, KanbanColumnDef[]> = {
    Outbound: [
      { id: 'Order Creation', title: 'ORDER CREATION', colorTheme: 'yellow' },
      { id: 'Picking & Verification', title: 'PICKING & VERIFICATION', colorTheme: 'blue' },
      { id: 'Manifest', title: 'MANIFEST', colorTheme: 'gray' },
      { id: 'Final BOL', title: 'FINAL BOL', colorTheme: 'gray' },
      { id: 'Lane Audit', title: 'LANE AUDIT', colorTheme: 'red' },
      { id: 'Load', title: 'LOAD', colorTheme: 'blue' },
      { id: 'Ship/GI', title: 'SHIP/GI', colorTheme: 'green' }
    ],
    Inbound: [
      { id: 'Unload', title: 'UNLOAD', colorTheme: 'blue' },
      { id: 'Receive/PGR', title: 'RECEIVE/PGR', colorTheme: 'yellow' },
      { id: 'Verify', title: 'VERIFY', colorTheme: 'purple' },
      { id: 'Putaway', title: 'PUTAWAY', colorTheme: 'green' }
    ],
    Return: [
      { id: 'Unload', title: 'UNLOAD', colorTheme: 'blue' },
      { id: 'Verify', title: 'VERIFY', colorTheme: 'purple' },
      { id: 'PGR', title: 'PGR', colorTheme: 'gray' },
      { id: 'Receive', title: 'RECEIVE', colorTheme: 'yellow' },
      { id: 'Putaway', title: 'PUTAWAY', colorTheme: 'green' }
    ]
  };

  const kanbanColumns = workflows[dashboardTab] || workflows['Outbound'];

  const filteredAppointments = appointments.filter(appt => appt.properties.type === dashboardTab);

  const kanbanCards: KanbanCardDef[] = filteredAppointments.map(appt => {
    // Map current status to columns. Default unknown statuses to the first column
    let colId = appt.properties.status;
    if (!kanbanColumns.find(c => c.id === colId)) {
      colId = kanbanColumns[0].id;
    }

    const tags: { label: string; color: string }[] = [
      { label: appt.properties.type, color: appt.properties.type === 'Inbound' ? '#3b82f6' : '#10b981' }
    ];
    if (appt.properties.pickerName) {
      tags.push({ label: `Picker: ${appt.properties.pickerName}`, color: '#3b82f6' }); // Blue
    }
    if (appt.properties.verifierName) {
      tags.push({ label: `Verifier: ${appt.properties.verifierName}`, color: '#8b5cf6' }); // Purple
    }

    return {
      id: appt.id.toString(),
      columnId: colId,
      title: `#${appt.properties.bolShipmentNo}`,
      subtitle: `Carrier: ${appt.properties.carrier} | Customer: ${appt.properties.customer}`,
      statusTags: tags,
      onClick: colId === 'Order Creation' ? () => setOrderCreationAppt(appt) : undefined
    };
  });

  const getTextColor = (theme: string) => {
    switch (theme) {
      case 'yellow': return 'text-warning';
      case 'blue': return 'text-primary';
      case 'purple': return 'text-info';
      case 'green': return 'text-success';
      case 'red': return 'text-danger';
      case 'gray': return 'text-secondary';
      default: return 'text-dark';
    }
  };

  const dashboardKPIs = kanbanColumns.map(col => {
    const count = filteredAppointments.filter(a => {
      let st = a.properties.status;
      if (!kanbanColumns.find(c => c.id === st)) st = kanbanColumns[0].id;
      return st === col.id;
    }).length;
    return {
      label: col.id,
      val: count,
      color: getTextColor(col.colorTheme),
      desc: ''
    };
  });

  const handleMoveCard = async (cardId: string, toColumnId: string) => {
    setAppointments(prev => prev.map(a => a.id.toString() === cardId ? { ...a, properties: { ...a.properties, status: toColumnId } } : a));
    try {
      await ontologyClient.updateAppointment({ id: parseInt(cardId), status: toColumnId });
      if (toColumnId === 'Picking & Verification') {
        try {
          await ontologyClient.createPitTask({ appointmentId: parseInt(cardId), type: 'Pick' });
        } catch (e) {
          // Task might already exist, safe to ignore
        }
      }
    } catch (err) {
      console.error(err);
      fetchDashboardData();
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Sidebar Navigation */}
      <aside className="sidebar py-4" style={{ 
        width: sidebarCollapsed ? 64 : 280, 
        minWidth: sidebarCollapsed ? 64 : 280,
        borderRight: '1px solid var(--rule-soft)', 
        transition: 'width 0.25s ease, min-width 0.25s ease',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <div style={{ width: 280, padding: '0 1rem' }}>
          <div className="d-flex align-items-center justify-content-between mb-4">
            {!sidebarCollapsed && (
              <div className="sidebar-logo">
                <span className="sidebar-logo-text" style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>GXO</span>
                <div className="sidebar-subtitle text-uppercase text-muted fw-bold" style={{ fontSize: 10, letterSpacing: '0.1em' }}>Dock Schedule</div>
                <div className="sidebar-site small mt-1">Albert Lea Hub</div>
              </div>
            )}
            <button 
              className="btn btn-sm border-0 text-muted" 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{ padding: '6px 8px', borderRadius: 8 }}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <i className={`bi ${sidebarCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'} fs-5`}></i>
            </button>
          </div>

          {!sidebarCollapsed && (
            <>
              <div className="sidebar-section-heading text-uppercase text-muted fw-bold mb-2" style={{ fontSize: 11 }}>Main</div>
              <nav className="d-flex flex-column gap-1 mb-4">
                <button className={`btn text-start py-2 px-3 sidebar-link ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>
                  <i className="bi bi-house-door me-2"></i> Home
                </button>
                <button className={`btn text-start py-2 px-3 sidebar-link ${view === 'schedule' ? 'active' : ''}`} onClick={() => setView('schedule')}>
                  <i className="bi bi-calendar3 me-2"></i> Dock Schedule
                </button>
              </nav>

              <div className="sidebar-section-heading text-uppercase text-muted fw-bold mb-2" style={{ fontSize: 11 }}>Operations</div>
              <nav className="d-flex flex-column gap-1 mb-4">
                <button className={`btn text-start py-2 px-3 sidebar-link ${view === 'gate' ? 'active' : ''}`} onClick={() => setView('gate')}>
                  <i className="bi bi-door-open me-2"></i> Gate (In/Out)
                </button>
                <button className={`btn text-start py-2 px-3 sidebar-link ${view === 'staging-map' ? 'active' : ''}`} onClick={() => setView('staging-map')}>
                  <i className="bi bi-map me-2"></i> Staging Map
                </button>
              </nav>

              <div className="sidebar-section-heading text-uppercase text-muted fw-bold mb-2" style={{ fontSize: 11 }}>External</div>
              <nav className="d-flex flex-column gap-1">
                <a href="/pit-board" target="_blank" className="btn text-start py-2 px-3 sidebar-link text-decoration-none">
                  <i className="bi bi-forklift me-2"></i> PIT Board <i className="bi bi-box-arrow-up-right ms-2" style={{fontSize: 10}}></i>
                </a>
                <button className={`btn text-start py-2 px-3 sidebar-link ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>
                  <i className="bi bi-gear me-2"></i> Admin
                </button>
              </nav>
            </>
          )}

          {sidebarCollapsed && (
            <nav className="d-flex flex-column align-items-center gap-2">
              <button className={`btn p-2 sidebar-link ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')} title="Home">
                <i className="bi bi-house-door fs-5"></i>
              </button>
              <button className={`btn p-2 sidebar-link ${view === 'schedule' ? 'active' : ''}`} onClick={() => setView('schedule')} title="Dock Schedule">
                <i className="bi bi-calendar3 fs-5"></i>
              </button>
              <button className={`btn p-2 sidebar-link ${view === 'gate' ? 'active' : ''}`} onClick={() => setView('gate')} title="Gate (In/Out)">
                <i className="bi bi-door-open fs-5"></i>
              </button>
              <button className={`btn p-2 sidebar-link ${view === 'staging-map' ? 'active' : ''}`} onClick={() => setView('staging-map')} title="Staging Map">
                <i className="bi bi-map fs-5"></i>
              </button>
              <a href="/pit-board" target="_blank" className="btn p-2 sidebar-link text-decoration-none" title="PIT Board">
                <i className="bi bi-forklift fs-5"></i>
              </a>
              <button className={`btn p-2 sidebar-link ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')} title="Admin">
                <i className="bi bi-gear fs-5"></i>
              </button>
            </nav>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-grow-1 p-4 p-lg-5" style={{ overflowY: 'auto', position: 'relative' }}>
        {loading && (
          <div className="position-absolute top-50 start-50 translate-middle" style={{ zIndex: 1000 }}>
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        )}
        {view === 'dashboard' && (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <div>
                <span className="text-uppercase text-muted fw-bold" style={{ fontSize: 11 }}>Overview</span>
                <h1 className="display-5 font-serif fw-bold mb-0">Dashboard</h1>
              </div>
              <span className="badge bg-dark fs-6 py-2 px-3">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>

            {/* KPI statistics cards based on Kanban columns */}
            <DashboardKPIBoxes kpis={dashboardKPIs} />

            {orderCreationAppt && (
              <OrderCreationModal 
                appt={orderCreationAppt}
                onClose={() => setOrderCreationAppt(null)}
                onSave={async (_deliveries, _stops, _stagingLane) => {
                  try {
                    await ontologyClient.updateAppointment({
                      id: orderCreationAppt.id,
                      status: 'Picking & Verification' // Moves it to the next column
                    });
                    
                    // Create PIT Task so it shows up in PitBoard
                    try {
                      await ontologyClient.createPitTask({
                        appointmentId: orderCreationAppt.id,
                        type: 'Pick'
                      });
                    } catch (pitErr) {
                      console.log("PIT Task might already exist:", pitErr);
                    }

                    // Ideally, we'd also save the deliveries/stops to a new Load here.
                    setAppointments(prev => prev.map(a => 
                      a.id === orderCreationAppt.id ? { ...a, properties: { ...a.properties, status: 'Picking & Verification' } } : a
                    ));
                    setOrderCreationAppt(null);
                  } catch (e) {
                    console.error("Failed to release order:", e);
                  }
                }}
              />
            )}

            <DashboardTabs 
              tabs={[
                { id: 'Outbound', label: 'Outbound' },
                { id: 'Inbound', label: 'Inbound' },
                { id: 'Return', label: 'Returns' }
              ]} 
              activeTab={dashboardTab} 
              onTabChange={(id) => setDashboardTab(id as any)} 
            />

            {/* Kanban Board */}
            <div className="card border-0 p-4 shadow-sm" style={{ background: 'var(--surface)' }}>
              <KanbanBoard 
                columns={kanbanColumns} 
                cards={kanbanCards} 
                onMoveCard={handleMoveCard} 
              />
            </div>
          </div>
        )}



        {view === 'schedule' && (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h1 className="display-5 font-serif fw-bold mb-0">Dock Schedule</h1>
              <span className="badge bg-dark fs-6 py-2 px-3">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>

            {/* KPI statistics cards */}
            <div className="row g-3 mb-4">
              {[
                { label: 'Scheduled', val: stats.total, color: 'text-primary', desc: 'Total appointments' },
                { label: 'Checked In', val: stats.checked_in, color: 'text-warning', desc: 'At facility' },
                { label: 'Completed', val: stats.completed, color: 'text-success', desc: 'Checked out' },
                { label: 'Late', val: stats.late, color: 'text-danger', desc: '>15 mins late' },
                { label: 'Missed', val: stats.missed, color: 'text-secondary', desc: 'No show' },
                { label: 'IB / OB', val: `${stats.ib_count}/${stats.ob_count}`, color: 'text-dark', desc: 'Split ratio' }
              ].map((kpi, idx) => (
                <div className="col-6 col-md-4 col-lg-2" key={idx}>
                  <div className="card border-0 p-3 shadow-sm" style={{ background: 'var(--surface)' }}>
                    <span className="text-muted small fw-semibold d-block mb-1">{kpi.label}</span>
                    <h3 className={`fw-bold mb-1 ${kpi.color}`}>{kpi.val}</h3>
                    <span className="text-muted" style={{ fontSize: 11 }}>{kpi.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="d-flex justify-content-between align-items-center mb-4">
              <h4 className="font-serif fw-bold mb-0">Appointments</h4>
              <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
                <i className={`bi ${showAddForm ? 'bi-x-lg' : 'bi-plus-lg'} me-2`}></i> 
                {showAddForm ? 'Cancel' : 'Add Appointment'}
              </button>
            </div>

            {showAddForm && (
              <div className="card border-0 p-4 shadow-sm mb-4" style={{ background: 'var(--surface)', maxWidth: 640 }}>
                <form onSubmit={handleAddAppointment}>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small text-uppercase text-muted fw-bold">Date</label>
                      <input type="date" required className="form-control" value={newAppt.date} onChange={e => setNewAppt({...newAppt, date: e.target.value})} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small text-uppercase text-muted fw-bold">Time</label>
                      <input type="time" required className="form-control" value={newAppt.time} onChange={e => setNewAppt({...newAppt, time: e.target.value})} />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-uppercase text-muted fw-bold">Direction</label>
                    <select className="form-select" value={newAppt.type} onChange={e => setNewAppt({...newAppt, type: e.target.value})}>
                      <option value="Inbound">Inbound (IB)</option>
                      <option value="Outbound">Outbound (OB)</option>
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-uppercase text-muted fw-bold">Carrier</label>
                    <select required className="form-select" value={newAppt.carrierId} onChange={e => setNewAppt({...newAppt, carrierId: e.target.value})}>
                      <option value="">Select Carrier...</option>
                      {metadata.carriers.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-uppercase text-muted fw-bold">BOL / Shipment Number</label>
                    <input type="text" required placeholder="Type BOL number..." className="form-control" value={newAppt.bol} onChange={e => setNewAppt({...newAppt, bol: e.target.value})} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label small text-uppercase text-muted fw-bold">Customer</label>
                    <select required className="form-select" value={newAppt.customerId} onChange={e => setNewAppt({...newAppt, customerId: e.target.value})}>
                      <option value="">Select Customer...</option>
                      {metadata.customers.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-4">
                    <label className="form-label small text-uppercase text-muted fw-bold">Product Type</label>
                    <select required className="form-select" value={newAppt.productTypeId} onChange={e => setNewAppt({...newAppt, productTypeId: e.target.value})}>
                      <option value="">Select Product...</option>
                      {metadata.productTypes.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <button type="submit" className="btn btn-primary w-100 py-2">Create Appointment</button>
                </form>
              </div>
            )}

            <div className="card border-0 p-4 shadow-sm" style={{ background: 'var(--surface)' }}>
              <div className="table-responsive">
                <table className="table align-middle table-hover">
                  <thead>
                    <tr>
                      <th className="text-muted small fw-bold text-uppercase">Time</th>
                      <th className="text-muted small fw-bold text-uppercase">BOL #</th>
                      <th className="text-muted small fw-bold text-uppercase">Type</th>
                      <th className="text-muted small fw-bold text-uppercase">Carrier</th>
                      <th className="text-muted small fw-bold text-uppercase">Customer</th>
                      <th className="text-muted small fw-bold text-uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.sort((a, b) => (a.properties.time || '').localeCompare(b.properties.time || '')).map((appt) => (
                      <tr key={appt.id}>
                        <td className="fw-bold">{appt.properties.time || appt.properties.date}</td>
                        <td className="mono fw-semibold text-primary">#{appt.properties.bolShipmentNo}</td>
                        <td><span className={`badge ${appt.properties.type === 'Inbound' ? 'bg-primary' : 'bg-success'}`}>{appt.properties.type}</span></td>
                        <td>{appt.properties.carrier}</td>
                        <td>{appt.properties.customer}</td>
                        <td>
                          <span className={`badge ${
                            appt.properties.status === 'Completed' ? 'bg-secondary' : 
                            appt.properties.status === 'Checked In' ? 'bg-warning text-dark' : 'bg-info text-dark'
                          }`}>{appt.properties.status}</span>
                        </td>
                      </tr>
                    ))}
                    {appointments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-5">
                          <i className="bi bi-calendar-x fs-1 d-block mb-2"></i>
                          No appointments found for today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {view === 'gate' && (
          <div>
            <h1 className="display-5 font-serif fw-bold mb-4">Gate Operations</h1>
            <div className="row g-4">
              {/* Check-In Column */}
              <div className="col-md-6">
                <div className="card border-0 p-4 shadow-sm mb-4 h-100" style={{ background: 'var(--surface)' }}>
                  <h3 className="font-serif fw-bold mb-4"><i className="bi bi-box-arrow-in-right text-primary me-2"></i> Driver Check-In</h3>
                  <label className="form-label small text-uppercase text-muted fw-bold">Find Scheduled Appointment</label>
                  <div className="input-group mb-4">
                    <input type="text" placeholder="Search BOL, carrier, or customer..." className="form-control" value={checkInSearch} onChange={e => setCheckInSearch(e.target.value)} />
                    <button className="btn btn-outline-primary" type="button" onClick={handleSearchCheckIn}>Search</button>
                  </div>

                  {checkInMatches.length > 0 && !selectedCheckIn && (
                    <div className="list-group">
                      {checkInMatches.map((appt) => (
                        <button key={appt.id} className="list-group-item list-group-item-action border-0 shadow-sm mb-2 rounded" onClick={() => setSelectedCheckIn(appt)}>
                          <div className="d-flex w-100 justify-content-between">
                            <h5 className="mb-1 fw-bold">#{appt.properties.bolShipmentNo}</h5>
                            <small className="text-primary fw-bold">{appt.properties.time}</small>
                          </div>
                          <p className="mb-1 small">Carrier: {appt.properties.carrier} | Customer: {appt.properties.customer}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedCheckIn && (
                    <div className="card border p-3 mt-2 bg-light">
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <h5 className="fw-bold mb-0">Checking In: #{selectedCheckIn.properties.bolShipmentNo}</h5>
                        <button className="btn btn-sm btn-close" onClick={() => setSelectedCheckIn(null)}></button>
                      </div>
                      <form onSubmit={handleConfirmCheckIn}>
                        <div className="mb-3">
                          <label className="form-label small text-uppercase text-muted fw-bold">Assign Door</label>
                          <select required className="form-select" value={checkInForm.doorId} onChange={e => setCheckInForm({...checkInForm, doorId: e.target.value})}>
                            <option value="">Select Door...</option>
                            {metadata.doors.filter((d: any) => d.properties.status === 'Open').map((d: any) => (
                              <option key={d.id} value={d.id}>{d.properties.name} ({d.properties.direction})</option>
                            ))}
                          </select>
                        </div>
                        <div className="mb-3">
                          <label className="form-label small text-uppercase text-muted fw-bold">PIT Task Type</label>
                          <select required className="form-select" value={checkInForm.pitTaskType} onChange={e => setCheckInForm({...checkInForm, pitTaskType: e.target.value})}>
                            <option value="Inbound">Inbound</option>
                            <option value="Outbound">Outbound</option>
                            <option value="Pick">Pick</option>
                            <option value="Putaway">Putaway</option>
                            <option value="Verify">Verify</option>
                            <option value="Return">Return</option>
                            <option value="Retag">Retag</option>
                          </select>
                        </div>
                        <div className="mb-4">
                          <label className="form-label small text-uppercase text-muted fw-bold">Default Operator (Optional)</label>
                          <select className="form-select" value={checkInForm.operatorId} onChange={e => setCheckInForm({...checkInForm, operatorId: e.target.value})}>
                            <option value="">Leave Unassigned</option>
                            {metadata.operators.map((o: any) => (
                              <option key={o.id} value={o.id}>{o.properties.name}</option>
                            ))}
                          </select>
                        </div>
                        <button type="submit" className="btn btn-primary w-100 py-2">Confirm Check-In</button>
                      </form>
                    </div>
                  )}
                </div>
              </div>

              {/* Check-Out Column */}
              <div className="col-md-6">
                <div className="card border-0 p-4 shadow-sm h-100" style={{ background: 'var(--surface)' }}>
                  <h3 className="font-serif fw-bold mb-4"><i className="bi bi-box-arrow-left text-success me-2"></i> Driver Check-Out</h3>
                  <label className="form-label small text-uppercase text-muted fw-bold">Find Checked-In Appointment</label>
                  <div className="input-group mb-4">
                    <input type="text" placeholder="Search BOL or carrier..." className="form-control" value={checkOutSearch} onChange={e => setCheckOutSearch(e.target.value)} />
                    <button className="btn btn-outline-success" type="button" onClick={handleSearchCheckOut}>Search</button>
                  </div>

                  {checkOutMatches.length > 0 && (
                    <div className="list-group">
                      {checkOutMatches.map((appt) => (
                        <div key={appt.id} className="list-group-item d-flex justify-content-between align-items-center border-0 shadow-sm mb-2 rounded">
                          <div>
                            <h5 className="mb-1 fw-bold">#{appt.properties.bolShipmentNo}</h5>
                            <small className="text-muted"><i className="bi bi-door-closed me-1"></i> {appt.properties.doorName} | {appt.properties.carrier}</small>
                          </div>
                          <button className="btn btn-success" onClick={() => handleConfirmCheckOut(appt.id)}>Check Out</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Scheduled Arrivals */}
            <div className="card border-0 p-4 shadow-sm mt-4" style={{ background: 'var(--surface)' }}>
              <h3 className="font-serif fw-bold mb-4"><i className="bi bi-calendar-event text-primary me-2"></i> Scheduled Arrivals</h3>
              <div className="table-responsive">
                <table className="table align-middle table-hover">
                  <thead>
                    <tr>
                      <th className="text-muted small fw-bold text-uppercase">Time</th>
                      <th className="text-muted small fw-bold text-uppercase">BOL #</th>
                      <th className="text-muted small fw-bold text-uppercase">Type</th>
                      <th className="text-muted small fw-bold text-uppercase">Carrier</th>
                      <th className="text-muted small fw-bold text-uppercase">Customer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.filter(a => a.properties.status === 'Scheduled').sort((a, b) => (a.properties.time || '').localeCompare(b.properties.time || '')).map((appt) => (
                      <tr key={appt.id}>
                        <td className="fw-bold">{appt.properties.time}</td>
                        <td className="mono fw-semibold text-primary">#{appt.properties.bolShipmentNo}</td>
                        <td><span className={`badge ${appt.properties.type === 'Inbound' ? 'bg-primary' : 'bg-success'}`}>{appt.properties.type}</span></td>
                        <td>{appt.properties.carrier}</td>
                        <td>{appt.properties.customer}</td>
                      </tr>
                    ))}
                    {appointments.filter(a => a.properties.status === 'Scheduled').length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-muted py-4">
                          <i className="bi bi-calendar-x fs-3 d-block mb-2"></i>
                          No scheduled arrivals found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {view === 'staging-map' && (
          <div>
            <h1 className="display-5 font-serif fw-bold mb-2">Staging Lanes Map</h1>
            <p className="text-muted mb-4">Real-time status visual representation of Bayer Albert Lea staging lanes.</p>
            <div className="card border-0 p-4 shadow-sm" style={{ background: 'var(--surface)', minHeight: 600 }}>
              <StagingLanesMap />
            </div>
          </div>
        )}





        {view === 'admin' && (
          <div>
            <h1 className="display-5 font-serif fw-bold mb-4">Admin Dashboard</h1>
            <div className="row g-4">
              <div className="col-md-6">
                <div className="card border-0 p-4 shadow-sm" style={{ background: 'var(--surface)' }}>
                  <h3 className="font-serif fw-bold mb-3">Facility Doors</h3>
                  <ul className="list-group">
                    {metadata.doors.map((d: any) => (
                      <li key={d.id} className="list-group-item d-flex justify-content-between align-items-center">
                        {d.properties.name} ({d.properties.direction})
                        <span className={`badge ${d.properties.status === 'Open' ? 'bg-success' : 'bg-danger'}`}>{d.properties.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card border-0 p-4 shadow-sm" style={{ background: 'var(--surface)' }}>
                  <h3 className="font-serif fw-bold mb-3">PIT Operators</h3>
                  <ul className="list-group">
                    {metadata.operators.map((o: any) => (
                      <li key={o.id} className="list-group-item">{o.properties.name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
