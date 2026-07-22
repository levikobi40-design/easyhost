import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { addManualGuest } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import useStore from '../../store/useStore';
import { isRtlLang, normalizeLang } from '../../utils/languages';
import './GuestAddModal.css';

/** Stable API values (legacy Hebrew ids kept for backend compatibility). */
const ROOM_COMPOSITIONS = [
  { id: 'זוג', key: 'couple' },
  { id: 'זוג+1', key: 'couplePlus1' },
  { id: 'בודד', key: 'single' },
  { id: 'משפחה', key: 'family' },
  { id: 'קבוצה', key: 'group' },
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
  const { t } = useTranslation();
  const lang = normalizeLang(useStore((s) => s.lang) || 'en');
  const tr = useCallback((key, opts) => t(key, { ...(opts || {}), lng: lang }), [t, lang]);
  const dir = isRtlLang(lang) ? 'rtl' : 'ltr';

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
      setError(tr('guestAddModal.errorName'));
      return;
    }
    if (!checkIn) {
      setError(tr('guestAddModal.errorCheckIn'));
      return;
    }
    if (!propertyId && !selectedProp?.name) {
      setError(tr('guestAddModal.errorProperty'));
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
      setError(err?.message || tr('guestAddModal.errorCreate'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="guest-add-modal-backdrop" onClick={onClose}>
      <div
        key={lang}
        className="guest-add-modal"
        onClick={(e) => e.stopPropagation()}
        dir={dir}
      >
        <div className="guest-add-modal-header">
          <h2>{tr('guestAddModal.title')}</h2>
          <button
            type="button"
            className="guest-add-modal-close"
            onClick={onClose}
            aria-label={tr('guestAddModal.close')}
          >
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="guest-add-modal-form">
          <div className="guest-add-field">
            <label>{tr('guestAddModal.guestName')}</label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder={tr('guestAddModal.guestNamePlaceholder')}
              required
            />
          </div>
          <div className="guest-add-field">
            <label>{tr('guestAddModal.phone')}</label>
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder={tr('guestAddModal.phonePlaceholder')}
            />
          </div>
          <div className="guest-add-field">
            <label>{tr('guestAddModal.email')}</label>
            <input
              type="email"
              name="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder={tr('guestAddModal.emailPlaceholder')}
            />
          </div>
          <div className="guest-add-row">
            <div className="guest-add-field">
              <label>{tr('guestAddModal.checkIn')}</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
              />
            </div>
            <div className="guest-add-field">
              <label>{tr('guestAddModal.checkOut')}</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>
          <div className="guest-add-field">
            <label>{tr('guestAddModal.roomComposition')}</label>
            <select
              value={roomComposition}
              onChange={(e) => setRoomComposition(e.target.value)}
            >
              {ROOM_COMPOSITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr(`guestAddModal.composition.${c.key}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="guest-add-field">
            <label>{tr('guestAddModal.property')}</label>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
            >
              <option value="">{tr('guestAddModal.selectProperty')}</option>
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
                  {tr('guestAddModal.saving')}
                </span>
              ) : (
                tr('guestAddModal.submit')
              )}
            </button>
            <button type="button" onClick={onClose} className="guest-add-btn secondary">
              {tr('guestAddModal.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
