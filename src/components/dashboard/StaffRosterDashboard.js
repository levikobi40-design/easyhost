import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, RefreshCw } from 'lucide-react';
import { useProperties } from '../../context/PropertiesContext';
import { getPropertyStaff, addPropertyStaff } from '../../services/api';

const QUICK_STAFF = [
  { name: 'יוסי תחזוקה', role: 'תחזוקה', department: 'maintenance' },
  { name: 'דנה ניקיון', role: 'ניקיון', department: 'cleaning' },
];

export default function StaffRosterDashboard() {
  const { properties, refresh: refreshProperties } = useProperties();
  const [selectedId, setSelectedId] = useState('');
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('צוות');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const first = (properties && properties[0]?.id) || '';
    if (first && !selectedId) setSelectedId(String(first));
  }, [properties, selectedId]);

  const loadStaff = useCallback(async () => {
    if (!selectedId) {
      setStaff([]);
      return;
    }
    setLoading(true);
    try {
      const list = await getPropertyStaff(selectedId);
      setStaff(Array.isArray(list) ? list : []);
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!selectedId || !n) return;
    setSaving(true);
    try {
      await addPropertyStaff(selectedId, {
        name: n,
        role: role.trim() || 'צוות',
        phone_number: phone.trim() || undefined,
      });
      setName('');
      setPhone('');
      await loadStaff();
    } catch (err) {
      window.alert(err?.message || 'לא ניתן להוסי�� עובד');
    } finally {
      setSaving(false);
    }
  };

  const addQuick = async (preset) => {
    if (!selectedId) {
      window.alert('בחרו נכס מהרשימה');
      return;
    }
    setSaving(true);
    try {
      await addPropertyStaff(selectedId, {
        name: preset.name,
        role: preset.role,
        department: preset.department,
      });
      await loadStaff();
    } catch (err) {
      window.alert(err?.message || 'הוספה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="staff-roster-dashboard" dir="rtl" style={{ padding: '2rem', maxWidth: 720, margin: '0 auto', background: '#fbfbfb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={26} className="text-indigo-600" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>ניהול צוות</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
            עובדים אמיתיים לכל נכס — מאיה תוכל להגיד &quot;הקצאתי ל-[שם]&quot; כשמשימה משויכת.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => { refreshProperties(true); loadStaff(); }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700"
        >
          <RefreshCw size={16} /> רענון נכסים
        </button>
      </div>

      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>נכס</label>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{ width: '100%', padding: '0.65rem', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 20 }}
      >
        {(properties || []).length === 0 ? (
          <option value="">אין נכסים — הוסיפו נכס במסך הנכסים</option>
        ) : (
          (properties || []).map((p) => (
            <option key={p.id} value={p.id}>{p.name || p.title || p.id}</option>
          ))
        )}
      </select>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 8 }}>הוספה מהירה</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {QUICK_STAFF.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={saving || !selectedId}
              onClick={() => addQuick(p)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
            >
              <Plus size={16} /> {p.name}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleAdd} style={{ background: '#fff', padding: '1rem', borderRadius: 16, border: '1px solid #e5e7eb', marginBottom: 24 }}>
        <p style={{ fontWeight: 700, marginBottom: 12 }}>הוספת עובד</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם מלא"
          style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 8 }}
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="תפקיד (למשל ניקיון / תחזוקה)"
          style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 8 }}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="טלפון (אופציונלי)"
          style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 12 }}
        />
        <button
          type="submit"
          disabled={saving || !selectedId || !name.trim()}
          className="w-full py-2.5 rounded-xl bg-gray-900 text-white font-bold disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'שמור עובד'}
        </button>
      </form>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 12 }}>רשימת צוות בנכס</h2>
      {loading ? (
        <p className="text-gray-500">טוען…</p>
      ) : staff.length === 0 ? (
        <p className="text-gray-500">אין עובדים בנכס זה. הוסיפו עם הטופס או הכפתורים המהירים.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {staff.map((s) => (
            <li
              key={s.id}
              style={{
                padding: '0.75rem 1rem',
                background: '#fff',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 700 }}>{s.name}</span>
              <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>{s.role}{s.phone || s.phone_number ? ` · ${s.phone || s.phone_number}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
