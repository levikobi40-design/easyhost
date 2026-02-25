import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { endShiftStaff, getStaffList, toggleStaffActive, updateStaffPhoto, uploadStaffPhoto } from '../../services/api';
import './StaffManager.css';

const buildQrUrl = (value) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(value)}`;

const StaffManager = () => {
  const [staff, setStaff] = useState([]);
  const [photoInputs, setPhotoInputs] = useState({});
  const [photoFiles, setPhotoFiles] = useState({});

  const loadStaff = async () => {
    try {
      const data = await getStaffList();
      setStaff(data);
      setPhotoInputs((prev) => {
        const next = { ...prev };
        data.forEach((member) => {
          if (next[member.id] === undefined) {
            next[member.id] = member.photo_url || '';
          }
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to load staff:', error);
    }
  };

  useEffect(() => {
    loadStaff();
    const interval = setInterval(loadStaff, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async (member) => {
    try {
      await toggleStaffActive(member.id, !member.active);
      loadStaff();
    } catch (error) {
      console.error('Failed to toggle staff:', error);
    }
  };

  const handleEndShift = async (member) => {
    try {
      await endShiftStaff(member.id);
      loadStaff();
    } catch (error) {
      console.error('Failed to end shift:', error);
    }
  };

  const handleSavePhoto = async (member) => {
    try {
      await updateStaffPhoto(member.id, photoInputs[member.id] || '');
      loadStaff();
    } catch (error) {
      console.error('Failed to update staff photo:', error);
    }
  };

  const handleUploadPhoto = async (member) => {
    const file = photoFiles[member.id];
    if (!file) return;
    try {
      const result = await uploadStaffPhoto(member.id, file);
      setPhotoInputs({ ...photoInputs, [member.id]: result.photo_url || '' });
      loadStaff();
    } catch (error) {
      console.error('Failed to upload staff photo:', error);
    }
  };

  return (
    <div className="staff-manager glass-card">
      <div className="staff-header">
        <h3><Users size={18} /> Staff Status</h3>
        <span>{staff.length} staff</span>
      </div>
      <div className="staff-list">
        {staff.length === 0 ? (
          <div className="staff-empty">No staff yet.</div>
        ) : (
          staff.map((member) => (
            <div key={member.id} className="staff-row">
              <div className="staff-info">
                <div className="staff-name">{member.name || member.id}</div>
                <div className="staff-meta">
                  {member.on_shift ? 'On Shift' : 'Off Shift'} · {member.gold_points ?? member.points} pts
                </div>
                <div className="staff-meta">
                  Current: {member.current_task ? `${member.current_task} ${member.current_room || ''}`.trim() : 'Idle'}
                </div>
                <div className="staff-photo-edit">
                  <input
                    type="url"
                    placeholder="Staff photo URL"
                    value={photoInputs[member.id] || ''}
                    onChange={(e) => setPhotoInputs({ ...photoInputs, [member.id]: e.target.value })}
                  />
                  <button className="btn-secondary" onClick={() => handleSavePhoto(member)}>
                    Save Photo
                  </button>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhotoFiles({ ...photoFiles, [member.id]: e.target.files?.[0] || null })}
                  />
                  <button className="btn-secondary" onClick={() => handleUploadPhoto(member)}>
                    Upload Photo
                  </button>
                </div>
              </div>
              <img
                className="staff-qr"
                src={buildQrUrl(member.id)}
                alt="QR code"
              />
              <div className="staff-actions">
                <button
                  className={`staff-toggle ${member.active ? 'active' : 'inactive'}`}
                  onClick={() => handleToggle(member)}
                >
                  {member.active ? 'Active' : 'Inactive'}
                </button>
                <button className="btn-secondary" onClick={() => handleEndShift(member)}>
                  End Shift
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default StaffManager;
