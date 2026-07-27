import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import { getProperties, coercePropertiesRows } from '../services/api';
import hotelRealtime from '../services/hotelRealtime';

const PropertiesContext = createContext(null);

const MIN_REFRESH_GAP_MS = 1500;
const PROPERTIES_PAGE_SIZE = 30;

export function PropertiesProvider({ children }) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbLoadStatus, setDbLoadStatus] = useState('loading');
  const [apiResultCount, setApiResultCount] = useState(0);
  const [hasMoreProperties, setHasMoreProperties] = useState(false);
  const [loadingMoreProperties, setLoadingMoreProperties] = useState(false);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(null);
  const propertiesLengthRef = useRef(0);
  const rawRoomsAccRef = useRef([]);
  const apiSucceededRef = useRef(false);

  useEffect(() => {
    propertiesLengthRef.current = Array.isArray(properties) ? properties.length : 0;
  }, [properties]);

  const applyRows = useCallback((rows) => {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    console.log('[PropertiesContext] state count', list.length);
    if (list.length > 0) {
      apiSucceededRef.current = true;
      setProperties(list);
      setDbLoadStatus('ok');
    } else if (!apiSucceededRef.current) {
      setProperties([]);
    }
    return list;
  }, []);

  const refresh = useCallback(async (force = false, silent = false) => {
    const now = Date.now();
    if (inFlightRef.current) {
      if (force) {
        try { await inFlightRef.current; } catch (_) { /* stale fetch */ }
      } else {
        return inFlightRef.current;
      }
    }
    if (!force && now - lastFetchAtRef.current < MIN_REFRESH_GAP_MS) {
      return;
    }
    const blockUi = !silent && propertiesLengthRef.current === 0;
    if (blockUi) setLoading(true);
    const p = (async () => {
      try {
        const fetchOpts = force
          ? { limit: 500, offset: 0 }
          : silent && rawRoomsAccRef.current.length > 0
            ? { limit: Math.max(PROPERTIES_PAGE_SIZE, rawRoomsAccRef.current.length), offset: 0 }
            : { limit: PROPERTIES_PAGE_SIZE, offset: 0 };
        const out = await getProperties(fetchOpts);
        const rows = coercePropertiesRows(out.rows ?? out.raw ?? out.list ?? out);
        console.log('[PropertiesContext] raw count', rows.length);
        setApiResultCount(rows.length);
        lastFetchAtRef.current = Date.now();

        if (rows.length > 0) {
          rawRoomsAccRef.current = rows;
          applyRows(rows);
          console.log('[PropertiesContext] state count after refetch', rows.length);
        } else if (out.apiOk) {
          apiSucceededRef.current = true;
          setDbLoadStatus('ok');
          if (propertiesLengthRef.current === 0) setProperties([]);
        } else if (out.networkError) {
          if (propertiesLengthRef.current > 0 || rawRoomsAccRef.current.length > 0) {
            setDbLoadStatus('ok');
          } else if (!apiSucceededRef.current) {
            setDbLoadStatus('error');
          }
        } else if (!apiSucceededRef.current) {
          setDbLoadStatus(out.dbStatus || 'error');
        }

        const roomList = rawRoomsAccRef.current;
        const total = Number(out.propertiesTotal) || roomList.length;
        const hasMore = Boolean(out.propertiesHasMore) || roomList.length < total;
        setHasMoreProperties(roomList.length > 0 && hasMore);
      } catch (e) {
        console.warn('[properties] GET /properties failed', e);
        if (propertiesLengthRef.current === 0 && !apiSucceededRef.current) {
          setDbLoadStatus('error');
        }
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, [applyRows]);

  const loadMoreProperties = useCallback(async () => {
    if (loadingMoreProperties || !hasMoreProperties) return;
    const off = rawRoomsAccRef.current.length;
    if (off === 0) return;
    setLoadingMoreProperties(true);
    try {
      const out = await getProperties({ limit: PROPERTIES_PAGE_SIZE, offset: off });
      const chunk = coercePropertiesRows(out.rows ?? out.raw ?? out.list ?? out);
      if (out.networkError || !chunk.length) {
        setHasMoreProperties(false);
        return;
      }
      rawRoomsAccRef.current = [...rawRoomsAccRef.current, ...chunk];
      applyRows(rawRoomsAccRef.current);
      const total = Number(out.propertiesTotal) || rawRoomsAccRef.current.length;
      setHasMoreProperties(rawRoomsAccRef.current.length < total && out.propertiesHasMore !== false);
    } catch (_) {
      setHasMoreProperties(false);
    } finally {
      setLoadingMoreProperties(false);
    }
  }, [hasMoreProperties, loadingMoreProperties, applyRows]);

  const applyPropertySnapshot = useCallback((room) => {
    if (!room || room.id == null) return;
    const id = String(room.id);
    apiSucceededRef.current = true;
    setDbLoadStatus('ok');
    rawRoomsAccRef.current = [
      room,
      ...rawRoomsAccRef.current.filter((r) => String(r?.id) !== id),
    ];
    setProperties((prev) => {
      const rest = prev.filter((p) => String(p?.id) !== id);
      return [room, ...rest];
    });
  }, []);

  const removePropertyById = useCallback((propertyId) => {
    const id = propertyId != null ? String(propertyId).trim() : '';
    if (!id) return;
    rawRoomsAccRef.current = rawRoomsAccRef.current.filter((r) => String(r?.id) !== id);
    setProperties((prev) => prev.filter((p) => String(p?.id) !== id));
    setApiResultCount((n) => Math.max(0, (Number(n) || 0) - 1));
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    const onRefresh = (ev) => {
      const d = ev?.detail && typeof ev.detail === 'object' ? ev.detail : {};
      refresh(d.force === true, d.silent === true);
    };
    window.addEventListener('properties-refresh', onRefresh);
    const unsub = hotelRealtime.subscribe('property_updated', () => refresh(false, true));
    const unsub2 = hotelRealtime.subscribe('new_guest', () => refresh(false, true));
    const interval = setInterval(() => refresh(false, true), 120000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('properties-refresh', onRefresh);
      unsub();
      unsub2();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      properties,
      loading,
      refresh,
      dbLoadStatus,
      apiResultCount,
      applyPropertySnapshot,
      removePropertyById,
      hasMoreProperties,
      loadingMoreProperties,
      loadMoreProperties,
    }),
    [
      properties,
      loading,
      refresh,
      dbLoadStatus,
      apiResultCount,
      applyPropertySnapshot,
      removePropertyById,
      hasMoreProperties,
      loadingMoreProperties,
      loadMoreProperties,
    ],
  );
  return <PropertiesContext.Provider value={value}>{children}</PropertiesContext.Provider>;
}

export function useProperties() {
  const ctx = useContext(PropertiesContext);
  if (!ctx) {
    throw new Error('useProperties must be used within PropertiesProvider');
  }
  return ctx;
}
