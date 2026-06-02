import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { getDispatchStatus, setDispatchStatus } from '../../services/api';
import './DispatchControls.css';

const DispatchControls = () => {
  const [enabled, setEnabled] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(60);

  useEffect(() => {
    const load = async () => {
      try {
        const status = await getDispatchStatus();
        setEnabled(Boolean(status.enabled));
        setIntervalSeconds(status.interval_seconds || 60);
      } catch (error) {
        console.error('Failed to load dispatch status:', error);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    try {
      const status = await setDispatchStatus(enabled, intervalSeconds);
      setEnabled(Boolean(status.enabled));
      setIntervalSeconds(status.interval_seconds || 60);
    } catch (error) {
      console.error('Failed to update dispatch status:', error);
    }
  };

  return (
    <div className="dispatch-controls glass-card">
      <div className="dispatch-header">
        <h3><Zap size={18} /> Auto-Dispatch</h3>
      </div>
      <div className="dispatch-body">
        <label className="dispatch-row">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>
        <label className="dispatch-row">
          <span>Interval (seconds)</span>
          <input
            type="number"
            min="10"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
          />
        </label>
        <button className="btn-primary" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
};

export default DispatchControls;
