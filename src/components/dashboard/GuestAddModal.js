import React, { useState } from 'react';
import { X } from 'lucide-react';
import { addManualGuest } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import './GuestAddModal.css';

const ROOM_COMPOSITIONS = [
  { id: 'זוג', label: 'זוג' },
  { id: 'זוג+1', label: 'זוג+1' },
  { id: 'בודד', label: 'בודד' },
  { id: 'משפחה', label: 'משפחה' },
  { id: 'קבוצה', label: 'קבוצה' },
];

function formatDateForInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function GuestAddModal({ isOpen, onClose, onSuccess }) {
  const { properties } = useProperties();
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [checkIn, setCheckIn] = useState(formatDateForInput(new Date()));
  const [checkOut, setCheckOut] = useState('');
  const [roomComposition, setRoomComposition] = useState('זוג');
  const [propertyId, setPropertyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const propsList = Array.isArray(properties) ? properties : [];
  const selectedProp = propsList.find((p) => p.id === propertyId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!guestName.trim()) {
      setError('נא להזין שם אורח');
      return;
    }
    if (!checkIn) {
      setError('נא להזין תאריך צ\'ק-אין');
      return;
    }
    if (!propertyId && !selectedProp?.name) {
      setError('נא לבחור נכס');
      return;
    }
    setLoading(true);
    try {
      await addManualGuest({
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim() || undefined,
        email: guestEmail.trim() || undefined,
        check_in: checkIn,
        check_out: checkOut || checkIn,
        room_composition: roomComposition,
        property_id: propertyId || undefined,
        property_name: selectedProp?.name || '',
      });
      window.dispatchEvent(new Event('maya-refresh-tasks'));
      window.dispatchEvent(new Event('properties-refresh'));
      typeof onSuccess === 'function' && onSuccess();
      onClose();
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setCheckIn(formatDateForInput(new Date()));
      setCheckOut('');
      setRoomComposition('זוג');
      setPropertyId('');
    } catch (err) {
      console.error('[GuestAddModal] Server error:', err?.status ?? 'N/A', err?.data ?? err?.message, err);
      setError(err?.message || 'שגיאה ביצירת הזמנה');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="guest-add-modal-backdrop" onClick={onClose}>
      <div className="guest-add-modal" onClick={(e) => e.stopPropagation()} dir="rtl" style={{ fontFamily: "'Heebo', sans-serif" }}>
        <div className="guest-add-modal-header">
          <h2>הוספת אורח</h2>
          <button type="button" className="guest-add-modal-close" onClick={onClose} aria-label="סגור">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="guest-add-modal-form">
          <div className="guest-add-field">
            <label>שם האורח</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="שם מלא"
              required
            />
          </div>
          <div className="guest-add-field">
            <label>טלפון (לשליחת הודעות)</label>
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="050-1234567"
            />
          </div>
          <div className="guest-add-field">
            <label>אימייל (אופציונלי)</label>
            <input
              type="email"
              name="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="guest@example.com"
            />
          </div>
          <div className="guest-add-row">
            <div className="guest-add-field">
              <label>צ'ק-אין</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
              />
            </div>
            <div className="guest-add-field">
              <label>צ'ק-אאוט</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>
          <div className="guest-add-field">
            <label>הרכב חדר</label>
            <select
              value={roomComposition}
              onChange={(e) => setRoomComposition(e.target.value)}
            >
              {ROOM_COMPOSITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="guest-add-field">
            <label>שיוך לנכס</label>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
            >
              <option value="">בחר נכס...</option>
              {propsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="guest-add-error">{error}</div>}
          <div className="guest-add-actions">
            <button type="submit" disabled={loading} className="guest-add-btn primary">
              {loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="guest-add-loader" aria-hidden />
                  שומר...
                </span>
              ) : (
                'הוסף אורח'
              )}
            </button>
            <button type="button" onClick={onClose} className="guest-add-btn secondary">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
