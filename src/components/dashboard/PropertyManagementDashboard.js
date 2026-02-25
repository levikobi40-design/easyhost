import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight, Users, Trash2, Sparkles, UserPlus, Smartphone,
} from 'lucide-react';
import {
  getPropertyStaff,
  addPropertyStaff,
  removePropertyStaff,
  updatePropertyStaff,
  updateProperty,
} from '../../services/api';
import './PropertyManagementDashboard.css';

const ROLES = ['Staff', 'מנהל', 'מנקה', 'מתחזק', 'דלפק', 'Security', 'Concierge'];

export default function PropertyManagementDashboard({ property, onBack, onEdit }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Staff');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editPhone, setEditPhone] = useState('');
  const [aiAutomation, setAiAutomation] = useState(Boolean(property?.ai_automation_enabled));

  const loadStaff = useCallback(async () => {
    if (!property?.id) return;
    setLoading(true);
    try {
      const list = await getPropertyStaff(property.id);
      setStaff(Array.isArray(list) ? list : []);
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [property?.id]);

  useEffect(() => {
    if (property?.id) {
      setAiAutomation(Boolean(property.ai_automation_enabled));
      loadStaff();
    }
  }, [property?.id, property?.ai_automation_enabled, loadStaff]);

  const handleAddEmployee = async () => {
    const name = (newName || '').trim();
    if (!name || !property?.id) return;
    setAdding(true);
    try {
      await addPropertyStaff(property.id, { name, role: newRole, phone_number: newPhone || undefined });
      setNewName('');
      setNewRole('Staff');
      setNewPhone('');
      loadStaff();
    } catch (e) {
      window.alert(e?.message || 'שגיאה בהוספת עובד');
    } finally {
      setAdding(false);
    }
  };

  const handleEditStaff = (s) => {
    setEditingId(s.id);
    setEditPhone(s.phone_number || s.phone || '');
  };

  const handleSaveStaff = async () => {
    if (!editingId || !property?.id) return;
    try {
      await updatePropertyStaff(property.id, editingId, { phone_number: editPhone || undefined });
      setEditingId(null);
      setEditPhone('');
      loadStaff();
    } catch (e) {
      window.alert(e?.message || 'שגיאה בעדכון');
    }
  };

  const handleRemoveEmployee = async (staffId) => {
    if (!window.confirm('להסיר עובד מהנכס?')) return;
    try {
      await removePropertyStaff(property.id, staffId);
      loadStaff();
    } catch (e) {
      window.alert(e?.message || 'שגיאה בהסרת עובד');
    }
  };

  const handleAiToggle = async (enabled) => {
    if (!property?.id) return;
    setAiAutomation(enabled);
    try {
      await updateProperty(property.id, { ai_automation_enabled: enabled, is_automation_enabled: enabled });
    } catch {
      setAiAutomation(!enabled);
      window.alert('שגיאה בעדכון אוטומציה');
    }
  };

  if (!property) return null;

  return (
    <div className="property-management-dashboard p-8 bg-[#FBFBFB] min-h-screen" dir="rtl">
      <button
        type="button"
        onClick={() => onBack && onBack()}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8 font-bold transition-colors"
      >
        <ArrowRight size={20} />
        חזרה לנכסים
      </button>

      <div className="flex flex-wrap gap-8 mb-10">
        <div className="w-32 h-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0">
          {property.mainImage ? (
            <img src={property.mainImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">🏨</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="property-management-title text-2xl font-black text-gray-900 mb-1">
            {property.name}
          </h1>
          <p className="text-gray-500 text-sm">נהל עובדים ואוטומציה</p>
          {typeof onEdit === 'function' && (
            <button
              type="button"
              onClick={() => onEdit(property)}
              className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-bold"
            >
              ערוך פרטי נכס
            </button>
          )}
        </div>
      </div>

      {/* AI Automation Toggle */}
      <div className="ai-automation-card bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
              <Sparkles size={24} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">אוטומציית AI</h3>
              <p className="text-sm text-gray-500">חיבור ל־AI Assistant מהסרגל</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiAutomation}
            onClick={() => handleAiToggle(!aiAutomation)}
            className={`relative w-14 h-8 rounded-full transition-colors ${
              aiAutomation ? 'bg-amber-500' : 'bg-gray-200'
            }`}
          >
            <span
              className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                aiAutomation ? 'right-1' : 'right-7'
              }`}
            />
          </button>
        </div>
        {aiAutomation && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
            ✓ מחובר ל־AI Assistant – מאיה מטפלת בהזמנות והודעות אוטומטית.
          </p>
        )}
      </div>

      {/* Employees */}
      <div className="property-staff-card bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Users size={20} />
          עובדי הנכס
        </h3>

        <div className="add-employee-form flex flex-wrap gap-3 mb-6">
          <input
            type="text"
            placeholder="שם העובד"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddEmployee()}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900"
            style={{ minWidth: 140 }}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input
            type="tel"
            placeholder="מספר נייד"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-900"
            style={{ minWidth: 120 }}
          />
          <button
            type="button"
            onClick={handleAddEmployee}
            disabled={!newName.trim() || adding}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white font-bold hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <UserPlus size={18} />
            {adding ? 'מוסיף...' : 'הוסף עובד'}
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400">טוען...</p>
        ) : staff.length === 0 ? (
          <p className="text-gray-500 py-4">אין עובדים כרגע. הוסף עובדים לנכס.</p>
        ) : (
          <ul className="space-y-2">
            {staff.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-gray-900">{s.name}</span>
                  {(s.phone_number || s.phone) && (
                    <span className="inline-flex items-center gap-1 mr-2" title="Mobile Verified">
                      <Smartphone size={14} className="text-green-600" />
                    </span>
                  )}
                  <span className="text-gray-500 text-sm mr-2">• {s.role}</span>
                  {(s.phone_number || s.phone) && (
                    <span className="text-gray-500 text-sm mr-2">• {s.phone_number || s.phone}</span>
                  )}
                  {editingId === s.id ? (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="tel"
                        placeholder="מספר נייד"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-900 text-sm"
                      />
                      <button type="button" onClick={handleSaveStaff} className="text-sm font-bold text-amber-600">שמור</button>
                      <button type="button" onClick={() => { setEditingId(null); setEditPhone(''); }} className="text-sm text-gray-500">ביטול</button>
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleEditStaff(s)}
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 transition-colors"
                    title="ערוך"
                  >
                    ערוך
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveEmployee(s.id)}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                    title="הסר עובד"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
