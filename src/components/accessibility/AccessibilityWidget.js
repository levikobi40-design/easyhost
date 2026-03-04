import React, { useState, useEffect, useRef, useCallback } from 'react';
import './AccessibilityWidget.css';

const CLASSES = {
  highContrast: 'a11y-high-contrast',
  largeText:    'a11y-large-text',
  reduceMotion: 'a11y-reduce-motion',
};

const STORAGE_KEY = 'a11y-prefs';

const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
};

const savePrefs = (prefs) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
};

const applyPrefs = (prefs) => {
  Object.entries(CLASSES).forEach(([key, cls]) => {
    document.documentElement.classList.toggle(cls, !!prefs[key]);
  });
};

export default function AccessibilityWidget() {
  const [open, setOpen]   = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const panelRef          = useRef(null);
  const triggerRef        = useRef(null);

  /* Apply saved prefs on mount */
  useEffect(() => { applyPrefs(prefs); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Persist + apply whenever prefs change */
  useEffect(() => {
    savePrefs(prefs);
    applyPrefs(prefs);
  }, [prefs]);

  /* Close panel on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const toggle = useCallback((key) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const resetAll = useCallback(() => {
    setPrefs({});
  }, []);

  const OPTIONS = [
    { key: 'highContrast', label: 'ניגודיות גבוהה',    icon: '◑' },
    { key: 'largeText',    label: 'טקסט גדול',          icon: 'A+' },
    { key: 'reduceMotion', label: 'הפחת אנימציות',      icon: '⏸' },
  ];

  return (
    <div className="a11y-widget" role="complementary" aria-label="תפריט נגישות">
      <button
        ref={triggerRef}
        className="a11y-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'סגור תפריט נגישות' : 'פתח תפריט נגישות'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="נגישות"
      >
        ♿
      </button>

      {open && (
        <div
          ref={panelRef}
          className="a11y-panel"
          role="dialog"
          aria-modal="false"
          aria-label="אפשרויות נגישות"
        >
          <div className="a11y-panel-header">
            <span aria-hidden="true">♿</span> תפריט נגישות
          </div>

          <div className="a11y-options" role="group" aria-label="הגדרות נגישות">
            {OPTIONS.map(({ key, label, icon }) => (
              <button
                key={key}
                className="a11y-option"
                onClick={() => toggle(key)}
                aria-pressed={!!prefs[key]}
                aria-label={`${label} — ${prefs[key] ? 'פעיל' : 'כבוי'}`}
              >
                <span className="a11y-option-label">
                  <span aria-hidden="true">{icon}</span>
                  {label}
                </span>
                <span
                  className={`a11y-toggle${prefs[key] ? ' on' : ''}`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>

          <div className="a11y-panel-footer">
            <button className="a11y-reset" onClick={resetAll} aria-label="אפס את כל הגדרות הנגישות">
              אפס הכל
            </button>
            <p style={{ marginTop: 6, marginBottom: 0 }}>
              עמוד זה עומד בתקן WCAG 2.1 AA
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
