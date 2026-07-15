import { useState, useEffect } from 'react';
import { ontologyClient } from '@gxo/semantic';

export function PitBoard() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = [
    'Outbound', 'Inbound', 'Inbound/outbound', 'Pick', 
    'Putaway', 'Verify', 'Return', 'Retag'
  ];

  useEffect(() => {
    fetchPitTasks();
  }, []);

  async function fetchPitTasks() {
    setLoading(true);
    try {
      const pitTasks = await ontologyClient.getPitTasks();
      const appts = await ontologyClient.getAppointments();
      
      const enrichedTasks = pitTasks.map(t => {
        const appt = appts.find(a => a.id === t.properties.appointmentId);
        return {
          id: t.id,
          appt_id: t.properties.appointmentId,
          type: t.properties.type || 'Inbound/outbound',
          bol_shipment_no: appt?.properties.bolShipmentNo || 'Unknown',
          carrier: appt?.properties.carrier || 'Unknown',
          door_name: appt?.properties.doorName || null,
          pit_status: t.properties.status,
          operator_name: t.properties.operatorName,
          startedAt: t.properties.startedAt
        };
      });
      setTasks(enrichedTasks);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTask(apptId: number, operatorName: string) {
    if (!operatorName.trim()) {
      alert('Please enter operator name');
      return;
    }
    try {
      // In a real scenario, type might already be set. For start action, we just start it.
      await ontologyClient.startPitTask({ appointmentId: apptId, operatorName });
      fetchPitTasks();
    } catch (err: any) {
      alert(err.message);
    }
  }

  const workflows: Record<string, string[]> = {
    Outbound: ['Order Creation', 'Picking & Verification', 'Manifest', 'Final BOL', 'Lane Audit', 'Load', 'Ship/GI'],
    Inbound: ['Unload', 'Receive/PGR', 'Verify', 'Putaway'],
    Return: ['Unload', 'Verify', 'PGR', 'Receive', 'Putaway']
  };

  async function handleCompleteTask(apptId: number) {
    try {
      await ontologyClient.completePitTask({ appointmentId: apptId });
      
      // Auto-advance Kanban board
      const appts = await ontologyClient.getAppointments();
      const match = appts.find(a => a.id === apptId);
      if (match) {
        const typeFlow = workflows[match.properties.type] || workflows['Outbound'];
        const currentIndex = typeFlow.indexOf(match.properties.status);
        if (currentIndex !== -1 && currentIndex < typeFlow.length - 1) {
          const nextStage = typeFlow[currentIndex + 1];
          await ontologyClient.updateAppointment({ id: apptId, status: nextStage });
        }
      }

      fetchPitTasks();
    } catch (err: any) {
      alert(err.message);
    }
  }

  const filteredTasks = selectedCategory ? tasks.filter(t => t.type.toLowerCase() === selectedCategory.toLowerCase()) : tasks;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="px-4 py-3 bg-white shadow-sm d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center gap-3">
          <span className="sidebar-logo-text" style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>GXO</span>
          <h2 className="mb-0 font-serif fw-bold" style={{ fontSize: 20 }}>PIT Operator Dashboard</h2>
        </div>
        <div>
          <button className="btn btn-outline-secondary btn-sm me-2" onClick={fetchPitTasks}>
            <i className="bi bi-arrow-clockwise"></i> Refresh
          </button>
          <a href="/" className="btn btn-primary btn-sm">
            <i className="bi bi-arrow-left"></i> Back to Main
          </a>
        </div>
      </header>

      <main className="p-4 p-lg-5">
        {/* Categories Grid */}
        <div className="row g-3 mb-5">
          {categories.map(cat => {
            const count = tasks.filter(t => t.type.toLowerCase() === cat.toLowerCase()).length;
            const isSelected = selectedCategory === cat;
            return (
              <div className="col-6 col-md-3" key={cat}>
                <div 
                  className={`card border-0 p-3 shadow-sm h-100 ${isSelected ? 'bg-primary text-white' : 'bg-white text-dark'}`}
                  style={{ cursor: 'pointer', transition: 'all 0.2s', transform: isSelected ? 'translateY(-2px)' : 'none' }}
                  onClick={() => setSelectedCategory(isSelected ? null : cat)}
                >
                  <h4 className="fw-bold mb-1 font-serif">{cat}</h4>
                  <span className={isSelected ? 'text-white-50' : 'text-muted'}>{count} Tasks</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Task List */}
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h3 className="font-serif fw-bold mb-0">
            {selectedCategory ? `${selectedCategory} Tasks` : 'All Active Tasks'}
          </h3>
          <span className="badge bg-secondary">{filteredTasks.length} total</span>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : (
          <div className="row g-4">
            {filteredTasks.map((t) => (
              <div className="col-md-4 col-lg-3" key={t.appt_id}>
                <div className="card border-0 p-3 shadow-sm" style={{ background: 'var(--surface)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h4 className="mb-0 font-serif fw-bold">#{t.bol_shipment_no}</h4>
                    <span className={`badge ${
                      t.pit_status === 'Pending' ? 'bg-warning text-dark' : 
                      t.pit_status === 'Completed' ? 'bg-success' : 'bg-primary'
                    }`}>{t.pit_status}</span>
                  </div>
                  <p className="small text-muted mb-1">Type: <strong>{t.type}</strong></p>
                  <p className="small text-muted mb-1">Carrier: {t.carrier} | Door: {t.door_name || 'Unassigned'}</p>
                  
                  {t.pit_status === 'Pending' ? (
                    <div className="mt-3">
                      <input type="text" placeholder="Type operator name..." id={`op-name-${t.appt_id}`} className="form-control mb-2" />
                      <button className="btn btn-sm btn-primary w-100" onClick={() => {
                        const name = (document.getElementById(`op-name-${t.appt_id}`) as HTMLInputElement)?.value;
                        handleStartTask(t.appt_id, name);
                      }}>Start Task</button>
                    </div>
                  ) : t.pit_status === 'In Progress' ? (
                    <div className="mt-3">
                      <small className="text-muted d-block mb-1">Assigned: <strong>{t.operator_name}</strong></small>
                      <button className="btn btn-sm btn-success w-100" onClick={() => handleCompleteTask(t.appt_id)}>Complete Task</button>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <small className="text-success d-block fw-bold"><i className="bi bi-check-circle me-1"></i> Completed</small>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {filteredTasks.length === 0 && (
              <div className="col-12">
                <div className="card border-0 p-5 text-center text-muted" style={{ background: 'var(--surface)' }}>
                  <i className="bi bi-inbox fs-1 mb-2"></i>
                  <p className="mb-0">No tasks found for this category.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
