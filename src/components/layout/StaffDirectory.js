import React, { useState, useEffect } from 'react';
import { Users, Phone } from 'lucide-react';
import { getAIPropertyContext } from '../../services/api';
import { toWhatsAppPhone } from '../../utils/phone';
import './StaffDirectory.css';

const STAFF_LABEL = 'Staff';

export default function StaffDirectory() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAIPropertyContext()
      .then((ctx) => {
        const flat = [];
        const byName = {};
        if (ctx.staff_by_property) {
          for (const list of Object.values(ctx.staff_by_property)) {
            for (const s of list) {
              const name = (s.name || '').trim();
              if (name && !byName[name]) {
                byName[name] = s;
                flat.push({ name, phone: s.phone_number || s.phone || '', role: s.role || '' });
              }
            }
          }
        }
        setStaff(flat);
      })
      .catch(() => setStaff([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading || staff.length === 0) return null;

  return (
    <div className="staff-directory">
      <div className="staff-directory-header">
        <Users size={18} />
        <span>{STAFF_LABEL}</span>
      </div>
      <div className="staff-directory-list">
        {staff.map((s, i) => (
          <div key={`${s.name}-${i}`} className="staff-directory-item">
            <span className="staff-name">{s.name}</span>
            {s.phone ? (
              <a
                href={`https://wa.me/${toWhatsAppPhone(s.phone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="staff-phone-link"
                title={`WhatsApp ${s.name}`}
              >
                <Phone size={14} />
                {s.phone}
              </a>
            ) : (
              <span className="staff-phone-na">—</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
