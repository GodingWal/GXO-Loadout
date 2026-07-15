import { useState, useEffect } from 'react';
import type { AppointmentObject, StagingLaneObject } from '@gxo/semantic';
import { ontologyClient } from '@gxo/semantic';

export function OrderCreationModal({ appt, onClose, onSave }: { appt: AppointmentObject, onClose: () => void, onSave: (deliveries: string, stops: number, stagingLane: string) => void }) {
  const [deliveries, setDeliveries] = useState('1');
  const [stops, setStops] = useState(1);
  const [stagingLane, setStagingLane] = useState('');
  const [lanes, setLanes] = useState<StagingLaneObject[]>([]);

  useEffect(() => {
    ontologyClient.getStagingLanes().then(data => {
      setLanes(data.filter(lane => lane.properties.status === 'EMPTY'));
    }).catch(e => console.error("Failed to load staging lanes", e));
  }, []);

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1040 }}></div>
      <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1050 }} role="dialog">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content border-0 shadow-lg" style={{ borderRadius: 16 }}>
            <div className="modal-header border-bottom-0 pb-0">
              <h5 className="modal-title fw-bold">Order Creation: #{appt.properties.bolShipmentNo}</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body py-4">
              <p className="text-muted mb-4 small">Configure the routing and staging requirements before releasing for picking.</p>
              
              <div className="mb-3">
                <label className="form-label small text-uppercase text-muted fw-bold">Deliveries / POs</label>
                <input type="text" className="form-control" placeholder="E.g. 1, or multiple comma-separated" value={deliveries} onChange={e => setDeliveries(e.target.value)} />
                <div className="form-text">Comma-separated list of delivery numbers.</div>
              </div>

              <div className="mb-3">
                <label className="form-label small text-uppercase text-muted fw-bold">Number of Stops</label>
                <input type="number" className="form-control" min={1} value={stops} onChange={e => setStops(parseInt(e.target.value))} />
              </div>

              <div className="mb-4">
                <label className="form-label small text-uppercase text-muted fw-bold">Staging Lane</label>
                <select className="form-select" value={stagingLane} onChange={e => setStagingLane(e.target.value)}>
                  <option value="">Select a staging lane...</option>
                  {lanes.map(lane => (
                    <option key={lane.id} value={lane.id}>{lane.properties.name}</option>
                  ))}
                </select>
              </div>

              <div className="d-flex gap-2 justify-content-end">
                <button type="button" className="btn btn-light fw-semibold px-4" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary fw-semibold px-4" onClick={() => onSave(deliveries, stops, stagingLane)}>Save & Release</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
