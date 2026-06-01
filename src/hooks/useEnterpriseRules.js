import { useState, useCallback, useMemo, useEffect } from 'react';

const G = 'enterprise_global_rules_v1';
const O = 'enterprise_property_overrides_v1';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    const p = JSON.parse(raw);
    return typeof p === 'object' && p ? { ...fallback, ...p } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export const DEFAULT_GLOBAL = {
  checkInTime: '15:00',
  lateCheckoutFee: 170,
  /** Applies to ROOMS brand unless property override */
  roomsDefaultCheckIn: '15:00',
};

/** Sync write to global rules (e.g. batch actions from Automation tab). Dispatches reload for all useEnterpriseRules consumers. */
export function patchEnterpriseGlobalRules(patch) {
  const next = { ...readJson(G, DEFAULT_GLOBAL), ...patch };
  try {
    localStorage.setItem(G, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('enterprise-global-rules-updated'));
  return next;
}

/** Remove one field from every property override so values inherit from global (e.g. after batch late-checkout). */
export function stripOverrideFieldFromAll(field) {
  const o = readJson(O, {});
  const next = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') {
      const { [field]: _removed, ...rest } = v;
      if (Object.keys(rest).length) next[k] = rest;
    }
  }
  try {
    localStorage.setItem(O, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('enterprise-global-rules-updated'));
}

/**
 * Global rules with per-property overrides (inheritance).
 * Example: all ROOMS branches use 15:00 check-in unless a property sets checkInTime.
 */
export function useEnterpriseRules() {
  const [globalRules, setGlobalRules] = useState(() => readJson(G, DEFAULT_GLOBAL));
  const [overrides, setOverrides] = useState(() => readJson(O, {}));

  useEffect(() => {
    const sync = () => {
      setGlobalRules(readJson(G, DEFAULT_GLOBAL));
      setOverrides(readJson(O, {}));
    };
    window.addEventListener('enterprise-global-rules-updated', sync);
    return () => window.removeEventListener('enterprise-global-rules-updated', sync);
  }, []);

  const persistGlobal = useCallback((next) => {
    setGlobalRules(next);
    try {
      localStorage.setItem(G, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('enterprise-global-rules-updated'));
  }, []);

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    try {
      localStorage.setItem(O, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('enterprise-global-rules-updated'));
  }, []);

  const setGlobalRule = useCallback(
    (patch) => {
      persistGlobal({ ...globalRules, ...patch });
    },
    [globalRules, persistGlobal],
  );

  const setPropertyOverride = useCallback(
    (propertyId, patch) => {
      const id = String(propertyId);
      const next = { ...overrides, [id]: { ...(overrides[id] || {}), ...patch } };
      persistOverrides(next);
    },
    [overrides, persistOverrides],
  );

  const resolveEffective = useCallback(
    (propertyId, brand, key) => {
      const id = String(propertyId);
      if (overrides[id]?.[key] != null && overrides[id][key] !== '') {
        return overrides[id][key];
      }
      if (brand === 'ROOMS' && key === 'checkInTime' && globalRules.roomsDefaultCheckIn) {
        return globalRules.roomsDefaultCheckIn;
      }
      return globalRules[key];
    },
    [globalRules, overrides],
  );

  const summary = useMemo(
    () => ({
      checkInGlobal: globalRules.checkInTime,
      lateFeeGlobal: globalRules.lateCheckoutFee,
      roomsCheckIn: globalRules.roomsDefaultCheckIn,
      overrideCount: Object.keys(overrides).length,
    }),
    [globalRules, overrides],
  );

  return {
    globalRules,
    overrides,
    setGlobalRule,
    setPropertyOverride,
    resolveEffective,
    summary,
  };
}
