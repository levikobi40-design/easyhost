import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getAutomatedWelcomeSetting, setAutomatedWelcomeSetting, bootstrapOperationalData, syncIcalPrepTasks } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import { useMission } from '../../context/MissionContext';
import './EnterpriseDashboard.css';

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1400&auto=format&fit=crop';

const STAFF_ROLES = [
  { id: 'cleaner', label: 'Cleaner', key: 'staff-cleaner' },
  { id: 'maintenance', label: 'Maintenance', key: 'staff-maintenance' },
  { id: 'reception', label: 'Reception', key: 'staff-reception' },
  { id: 'housekeeping', label: 'Housekeeping', key: 'staff-housekeeping' },
];

const extractPropertyId = (str) => {
  const m = String(str || '').match(/(?:airbnb|booking)[^/]*\/[^/]*\/?rooms?\/(\d+)|/i)
    || String(str || '').match(/\/rooms?\/(\d+)/i)
    || String(str || '').match(/\b(\d{7,20})\b/);
  return m ? m[1] : '';
};

const extractTitleFromUrl = (str) => {
  try {
    const u = new URL(str);
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    if (/^\d+$/.test(slug)) return `Property #${slug}`;
    return slug.replace(/[-_]/g, ' ').trim() || 'Property';
  } catch {
    return 'Property';
  }
};

const extractPhotoId = (str) => {
  const m = String(str || '').match(/photo_id=(\d+)/i);
  return m ? m[1] : '';
};

const buildImageUrl = (photoId) => {
  if (photoId) return `https://a0.muscache.com/im/pictures/${photoId}.jpg?im_w=1200`;
  return PLACEHOLDER_IMAGE;
};

const isIcalOrCalendarUrl = (raw) => {
  const u = String(raw || '').trim().toLowerCase();
  if (!u.startsWith('http') && !u.startsWith('webcal://')) return false;
  if (u.startsWith('webcal://')) return true;
  if (u.endsWith('.ics')) return true;
  if (u.includes('/calendar/ical') || u.includes('ical.') || u.includes('format=ical')) return true;
  if (u.includes('booking.com') && u.includes('ical')) return true;
  if (u.includes('airbnb.') && (u.includes('/ical/') || u.includes('calendar'))) return true;
  return false;
};

const EnterpriseDashboard = () => {
  const { refresh: refreshProperties, properties } = useProperties();
  const { refresh: refreshMissionTasks } = useMission();
  const [linkInput, setLinkInput] = useState('');
  const [icalPropertyId, setIcalPropertyId] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [property, setProperty] = useState(null);
  const [staffPhones, setStaffPhones] = useState({ cleaner: '', maintenance: '', reception: '', housekeeping: '' });
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [automatedWelcome, setAutomatedWelcome] = useState(false);
  const [smartTaskAssignment, setSmartTaskAssignment] = useState(false);
  const automatedWelcomeBusyRef = useRef(false);
  const progressRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    getAutomatedWelcomeSetting()
      .then((r) => {
        setAutomatedWelcome(r?.automated_welcome_enabled ?? false);
        setSmartTaskAssignment(r?.smart_task_assignment_enabled ?? false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bootstrapOperationalData();
      } catch (_) {}
      if (cancelled) return;
      refreshProperties(true, true);
      window.dispatchEvent(new Event('maya-refresh-tasks'));
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProperties]);

  const handleAutomatedWelcomeToggle = useCallback(async () => {
    if (automatedWelcomeBusyRef.current) return;
    automatedWelcomeBusyRef.current = true;
    const next = !automatedWelcome;
    try {
      await setAutomatedWelcomeSetting({
        automated_welcome_enabled: next,
        smart_task_assignment_enabled: smartTaskAssignment,
      });
      setAutomatedWelcome(next);
    } catch {
      // keep prior state on error
    } finally {
      automatedWelcomeBusyRef.current = false;
    }
  }, [automatedWelcome, smartTaskAssignment]);

  const handleSmartTaskToggle = useCallback(async () => {
    if (automatedWelcomeBusyRef.current) return;
    automatedWelcomeBusyRef.current = true;
    const next = !smartTaskAssignment;
    try {
      await setAutomatedWelcomeSetting({
        automated_welcome_enabled: automatedWelcome,
        smart_task_assignment_enabled: next,
      });
      setSmartTaskAssignment(next);
    } catch {
      // keep prior state on error
    } finally {
      automatedWelcomeBusyRef.current = false;
    }
  }, [automatedWelcome, smartTaskAssignment]);

  const handlePropertyImport = useCallback(async (url) => {
    const raw = String(url || linkInput).trim();
    if (raw.length < 5) return;

    if (isIcalOrCalendarUrl(raw)) {
      setIsAnalyzing(true);
      setProperty(null);
      try {
        const res = await syncIcalPrepTasks(raw, icalPropertyId || undefined);
        const n = res?.created ?? 0;
        const sk = res?.skipped ?? 0;
        window.alert(
          n || sk
            ? `סנכרון iCal: נוצרו ${n} משימות הכנה לצ'ק-אין. דולגו (כבר קיימות): ${sk}.`
            : 'סנכרון הושלם — לא נמצאו הזמנות חדשות בטווח (או חסר מודול icalendar בשרת: pip install icalendar).',
        );
        refreshMissionTasks();
        window.dispatchEvent(new Event('maya-refresh-tasks'));
      } catch (e) {
        window.alert(e?.message || 'סנכרון iCal נכשל. ודאו שהקישור הוא ייצוא iCal מ-Airbnb/Booking.');
      } finally {
        setIsAnalyzing(false);
      }
      return;
    }

    const propertyId = extractPropertyId(raw);
    const title = extractTitleFromUrl(raw);
    const photoId = extractPhotoId(raw);
    const imageUrl = buildImageUrl(photoId);
    const estRevenue = propertyId ? 800 + (parseInt(propertyId.slice(-4), 10) % 4000) : 1500;

    setIsAnalyzing(true);
    setProperty(null);

    setTimeout(() => {
      setProperty({
        id: propertyId || `p-${Date.now()}`,
        title,
        estRevenue,
        imageUrl,
      });
      setIsAnalyzing(false);
    }, 3000);
  }, [linkInput, icalPropertyId, refreshMissionTasks]);

  const handlePaste = useCallback((e) => {
    const pasted = e.clipboardData?.getData?.('text') || '';
    setLinkInput(pasted);
    if (pasted.trim().length >= 5) handlePropertyImport(pasted);
  }, [handlePropertyImport]);

  const handleStaffChange = useCallback((id, value) => {
    setStaffPhones((prev) => ({ ...prev, [id]: value }));
  }, []);

  const hasProperty = !!property && !isAnalyzing;

  return (
    <div ref={containerRef} dir="rtl" className="enterprise-saas" style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Sticky Top Bar - Magic Input */}
      <div className="saas-top-bar" style={{
        position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '1rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
          Airbnb / Booking — קישור נכס או ייצוא iCal (לוח שנה)
        </label>
        <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
          הדביקו קישור iCal מייצוא הלוח ב-Airbnb או Booking כדי ליצור משימות &quot;הכנה לצ&apos;ק-אין&quot; אוטומטית. קישור דף נכס בלבד יציג תצוגה מהירה (דמו).
        </p>
        {(properties?.length > 0) && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>נכס לקישור משימות (אופציונלי)</label>
            <select
              value={icalPropertyId}
              onChange={(e) => setIcalPropertyId(e.target.value)}
              style={{ width: '100%', maxWidth: 420, padding: '0.5rem', borderRadius: 8, border: '1px solid #e5e7eb' }}
            >
              <option value="">ברירת מחדל — נכס ראשון בפורטפוליו</option>
              {(properties || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.title || p.id}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="https://www.airbnb.com/calendar/ical/... או קישור חדר"
            className="saas-input"
            style={{
              flex: 1, padding: '0.75rem 1rem', fontSize: '1rem', border: '2px solid #e5e7eb',
              borderRadius: 8, background: '#fff', color: '#111', direction: 'rtl', textAlign: 'right',
            }}
          />
          <button
            type="button"
            onClick={() => handlePropertyImport()}
            disabled={linkInput.trim().length < 5}
            className="btn-primary"
            style={{ padding: '0.75rem 1.25rem', whiteSpace: 'nowrap' }}
          >
            Import
          </button>
        </div>
        {/* Analyzing Progress Bar */}
        <div
          key="progress-bar"
          style={{
            marginTop: '0.75rem',
            opacity: isAnalyzing ? 1 : 0,
            visibility: isAnalyzing ? 'visible' : 'hidden',
            height: isAnalyzing ? 'auto' : 0,
            overflow: 'hidden',
            transition: 'opacity 0.2s, height 0.2s',
          }}
        >
          <div style={{ fontWeight: 600, color: '#4b5563', marginBottom: '0.5rem' }}>
            Analyzing Property Assets...
          </div>
          <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
            <div
              ref={progressRef}
              style={{
                height: '100%',
                width: '100%',
                background: 'linear-gradient(90deg, #d4af37, #f9e27d)',
                borderRadius: 3,
                animation: isAnalyzing ? 'saas-progress 3s ease-out forwards' : 'none',
                transformOrigin: 'left',
              }}
            />
          </div>
        </div>
      </div>

      {/* Automation — Maya pipeline (synced with server DEMO_AUTOMATION_SETTINGS) */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontWeight: 600, color: '#374151' }}>
            Enable Automated Welcome Messages
          </span>
          <button
            type="button"
            onClick={handleAutomatedWelcomeToggle}
            disabled={false}
            role="switch"
            aria-checked={automatedWelcome}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              border: 'none',
              background: automatedWelcome ? '#22c55e' : '#e5e7eb',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: automatedWelcome ? 25 : 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transition: 'left 0.2s',
              }}
            />
          </button>
        </div>
        <div
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            borderTop: '1px solid #f3f4f6',
          }}
        >
          <span style={{ fontWeight: 600, color: '#374151' }}>
            Smart Task Assignment (Maya → Worker + manager)
          </span>
          <button
            type="button"
            onClick={handleSmartTaskToggle}
            disabled={false}
            role="switch"
            aria-checked={smartTaskAssignment}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              border: 'none',
              background: smartTaskAssignment ? '#22c55e' : '#e5e7eb',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: smartTaskAssignment ? 25 : 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transition: 'left 0.2s',
              }}
            />
          </button>
        </div>
      </div>

      {/* Main Content - Always Rendered, Opacity-Based Visibility */}
      <div className="saas-main" style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
        {/* Property Card */}
        <div
          key="property-card"
          className="saas-property-card"
          style={{
            opacity: hasProperty ? 1 : 0.3,
            pointerEvents: hasProperty ? 'auto' : 'none',
            transition: 'opacity 0.3s',
            background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              height: 220,
              backgroundImage: `url(${property?.imageUrl || PLACEHOLDER_IMAGE})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111', marginBottom: '0.25rem' }}>
              {property?.title || '—'}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              Est. Revenue: ${(property?.estRevenue || 0).toLocaleString()}/month
            </div>
          </div>
        </div>

        {/* Staff Onboarding Grid */}
        <div
          key="staff-grid"
          className="saas-staff-grid"
          style={{
            opacity: hasProperty ? 1 : 0.3,
            pointerEvents: hasProperty ? 'auto' : 'none',
            transition: 'opacity 0.3s',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {STAFF_ROLES.map((role) => (
            <div
              key={role.key}
              className="saas-staff-card"
              style={{
                background: '#fff',
                borderRadius: 12,
                padding: '1rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                border: '1px solid #e5e7eb',
              }}
            >
              <label style={{ display: 'block', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                {role.label}
              </label>
              <input
                type="tel"
                value={staffPhones[role.id] || ''}
                onChange={(e) => handleStaffChange(role.id, e.target.value)}
                placeholder="+972..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  fontSize: '0.9rem',
                  color: '#111',
                  background: '#fff',
                }}
              />
            </div>
          ))}
        </div>

        {/* Generate Client Proposal Button */}
        <div
          key="proposal-section"
          style={{
            marginTop: '1.5rem',
            opacity: hasProperty ? 1 : 0.3,
            pointerEvents: hasProperty ? 'auto' : 'none',
            transition: 'opacity 0.3s',
          }}
        >
          <button
            type="button"
            onClick={() => setShowProposalModal(true)}
            className="btn-primary"
            style={{ padding: '0.75rem 1.5rem' }}
          >
            Generate Client Proposal
          </button>
        </div>
      </div>

      {/* Proposal Modal */}
      {showProposalModal && (
        <div
          key="modal-backdrop"
          className="saas-modal-backdrop"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowProposalModal(false)}
        >
          <div
            key="modal-content"
            className="saas-modal"
            style={{
              background: '#fff', borderRadius: 12, padding: '1.5rem', maxWidth: 480, width: '90%',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '1rem', color: '#111' }}>Client Proposal Email</h3>
            <div style={{ marginBottom: '0.75rem' }}>
              <strong>Subject:</strong>
              <div style={{ padding: '0.5rem', background: '#f3f4f6', borderRadius: 6, marginTop: '0.25rem' }}>
                Your property {property?.title || 'Property'} is ready for automation.
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <strong>Body:</strong>
              <div style={{ padding: '0.5rem', background: '#f3f4f6', borderRadius: 6, marginTop: '0.25rem', fontSize: '0.9rem' }}>
                Hi, I&apos;ve already set up {property?.title || 'your property'} on our AI system. It&apos;s ready to manage your staff. Click here to assign your cleaners: [Link]
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowProposalModal(false)}
              className="btn-primary"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Image Fallback Handler - No DOM removal, just CSS */}
      <style>{`
        .saas-input:focus { outline: none; border-color: #d4af37; }
        .saas-input::placeholder { color: #9ca3af; }
      `}</style>
    </div>
  );
};

export default EnterpriseDashboard;
