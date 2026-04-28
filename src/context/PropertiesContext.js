import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import { getProperties } from '../services/api';
import hotelRealtime from '../services/hotelRealtime';
import { API_URL } from '../utils/constants';
import { isHiddenDemoProperty } from '../utils/bazaarProperties';
import { ROOMS_BRANCH_PINS, ROOMS_PIN_ID_SET } from '../config/roomsBranches';
import {
  WEWORK_BRANCH_PINS,
  WEWORK_PIN_ID_SET,
  WEWORK_RENTAL_LABELS_HE,
} from '../config/weworkBranches';
import {
  ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN,
  applyVarietyToPropertyList,
  resolvePropertyCardImage,
} from '../utils/propertyCardImages';
import {
  mergePropertyImageOverrides,
} from '../utils/propertyImagePersistence';
import { applyHardLockHeroes } from '../utils/propertyHeroHardLock';
import { loadMappedPropertyList, saveMappedPropertyList } from '../utils/propertyListCache';
import { initialProperties, ensurePropertyPortfolioImages } from '../data/initialProperties';
import useStore from '../store/useStore';

const PropertiesContext = createContext(null);

const PLACEHOLDER = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

const MIN_REFRESH_GAP_MS = 1500;
/** Server-side property page size (matches mission tasks initial page). */
const PROPERTIES_PAGE_SIZE = 30;

function createdAtMs(room) {
  const s = room?.created_at || room?.createdAt;
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Pin Hotel Bazaar / Jaffa pilot row at the top, then newest created_at first. */
function isBazaarJaffaProperty(p) {
  const n = `${p?.name || ''}`.toLowerCase();
  return /בזאר|bazaar|מלון בזאר|hotel bazaar|jaffa|יפו/.test(n);
}

function isCityTowerProperty(p) {
  const n = `${p?.name || ''}`.toLowerCase();
  return /city tower|סיטי טאוור|leonardo plaza|ליאונרדו|רמת גן|ramat gan|בורסה|diamond exchange/i.test(n);
}

function isRoomsWorkspaceDuplicate(p) {
  if (ROOMS_PIN_ID_SET.has(String(p?.id))) return true;
  const n = `${p?.name || ''}`.toLowerCase();
  return /rooms sky|sky tower|רומס|rooms by fattal|room by fattal|coworking|סקיי טאוור/i.test(n);
}

function isWeWorkPortfolioDuplicate(p) {
  if (WEWORK_PIN_ID_SET.has(String(p?.id))) return true;
  const n = `${p?.name || ''}`.toLowerCase();
  return /wework|ווי וורק/i.test(n);
}

function ensureFullUrl(url) {
  if (!url || typeof url !== 'string') return PLACEHOLDER;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('/assets/')) return u;
  const path = u.startsWith('/') ? u.replace(/^\/+/, '') : u;
  return path.startsWith('uploads/') ? `${API_URL}/${path}` : `${API_URL}/uploads/${path}`;
}

/** Pinned pilot row — always first in the list (Hotel Bazaar Jaffa). Images: public/assets/images/hotels/bazaar/ */
function buildBazaarJaffaPinned() {
  const gallery = [
    '/assets/images/hotels/bazaar/hotel_main.jpg',
    ...Array.from({ length: 40 }, (_, i) => `/assets/images/hotels/bazaar/${String(i + 1).padStart(2, '0')}.jpg`),
  ];
  return mapRoomToProperty({
    id: 'bazaar-jaffa-hotel',
    name: 'Hotel Bazaar Jaffa',
    description:
      'Bohemian Jaffa vibes — historic Bauhaus near the Flea Market. 32 rooms. No on-site pool (beach & city pools nearby).',
    pictures: gallery,
    photo_url: gallery[0],
    room_number: undefined,
    max_guests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: [],
    status: 'active',
    created_at: new Date().toISOString(),
  });
}

/** Leonardo Plaza City Tower — Ramat Gan (urban / business). Images: public/assets/images/hotels/city-tower/ */
function buildCityTowerPinned() {
  const gallery = [
    '/assets/images/hotels/city-tower/hero.jpg',
    '/assets/images/hotels/city-tower/lounge.jpg',
  ];
  return mapRoomToProperty({
    id: 'leonardo-city-tower-ramat-gan',
    name: 'Leonardo Plaza City Tower',
    description:
      'Urban, business, elegant — Ramat Gan (Diamond Exchange / בורסה). 17 floors. Share Spa; rooftop pool (seasonal); Business Lounge; kosher certification Ramat Gan Rabbinate. Room types: Deluxe (14m²), Deluxe Grand, Executive, Club (floors 16–17), Junior Suite, Jacuzzi Suite, Accessible Deluxe. Check-in/out 15:00 / 11:00; Saturday & holidays 18:00 / 14:00; late checkout 250 ₪.',
    pictures: gallery,
    photo_url: gallery[0],
    room_number: undefined,
    max_guests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ['Spa', 'Pool', 'Business Lounge', 'Kosher'],
    status: 'active',
    created_at: new Date().toISOString(),
  });
}

/** Pinned ROOMS (Fattal) branches — one card per site. */
function buildRoomsBranchPins() {
  return ROOMS_BRANCH_PINS.map((b) =>
    mapRoomToProperty({
      id: b.id,
      name: b.name,
      description: b.description,
      pictures: b.gallery,
      photo_url: b.gallery[0],
      branchSlug: b.slug,
      room_number: undefined,
      max_guests: 1,
      bedrooms: 0,
      beds: 0,
      bathrooms: 0,
      amenities: ['ROOMS', b.city],
      status: 'active',
      created_at: new Date().toISOString(),
    }),
  );
}

/** WeWork Israel — 14 placeholder branches; images pending; pricing ₪0 until bulk update. */
function buildWeWorkBranchPins() {
  const rentalLine = WEWORK_RENTAL_LABELS_HE.join(' · ');
  return WEWORK_BRANCH_PINS.map((b) =>
    mapRoomToProperty({
      id: b.id,
      name: b.name,
      description: `WeWork ${b.cityHe} — ${b.address}. [תמונה: Pending Upload] מחירי בסיס זמניים: ₪0 לכל סוגי ההשכרה (לעדכון המוני). אפשרויות השכרה: ${rentalLine}.`,
      pictures: [ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN],
      photo_url: ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN,
      branchSlug: b.slug,
      room_number: undefined,
      max_guests: 1,
      bedrooms: 0,
      beds: 0,
      bathrooms: 0,
      amenities: ['WeWork', 'Workspace', b.cityHe, ...WEWORK_RENTAL_LABELS_HE.slice(0, 3)],
      status: 'active',
      created_at: new Date().toISOString(),
    }),
  );
}

function mapRoomToProperty(room, listIndex = 0) {
  const pictures = Array.isArray(room.pictures) ? room.pictures.filter(Boolean) : [];
  let imgUrl = (pictures[0] || room.image_url || room.photo_url || '').trim();
  if (!imgUrl) {
    imgUrl = resolvePropertyCardImage(room, listIndex);
  }
  return {
    id: room.id != null ? String(room.id) : '',
    name: room.name,
    room_number: room.room_number != null && String(room.room_number).trim() ? String(room.room_number).trim() : undefined,
    mainImage: ensureFullUrl(imgUrl),
    photo_url: imgUrl,
    pictures: pictures.filter(Boolean).map(ensureFullUrl),
    max_guests: room.max_guests ?? 2,
    bedrooms: room.bedrooms ?? 1,
    beds: room.beds ?? 1,
    bathrooms: room.bathrooms ?? 1,
    description: room.description || '',
    amenities: Array.isArray(room.amenities) ? room.amenities : [],
    ai_automation_enabled: Boolean(room.ai_automation_enabled),
    status: room.status || 'active',
    created_at: room.created_at || room.createdAt || null,
    branchSlug: room.branchSlug || room.branch_slug || undefined,
    occupancy_rate: room.occupancy_rate ?? null,
  };
}

/** Drop legacy demo rows; keep Bazaar pinned separately. */
function filterDemoProperties(mapped) {
  return mapped.filter((p) => !isHiddenDemoProperty(p));
}

/** Pinned portfolio when API returns nothing or fails — Bazaar + 14 ROOMS (15 cards), 80% occupancy. */
function getFallbackPropertyList() {
  const rows = ensurePropertyPortfolioImages(initialProperties.map((x) => ({ ...x })));
  return applyVarietyToPropertyList(
    rows.map((room, i) =>
      mapRoomToProperty(
        {
          ...room,
          pictures: [room.image_url || room.photo_url].filter(Boolean),
          occupancy_rate: room.occupancy_rate ?? null,
        },
        i,
      ),
    ),
  );
}

function finalizePropertyList(mapped) {
  const filtered = filterDemoProperties(mapped).filter(
    (p) =>
      String(p.id) !== 'bazaar-jaffa-hotel'
      && String(p.id) !== 'leonardo-city-tower-ramat-gan'
      && !ROOMS_PIN_ID_SET.has(String(p.id))
      && !WEWORK_PIN_ID_SET.has(String(p.id))
      && !isBazaarJaffaProperty(p)
      && !isCityTowerProperty(p)
      && !isRoomsWorkspaceDuplicate(p)
      && !isWeWorkPortfolioDuplicate(p),
  );
  const sortedRest = [...filtered].sort((a, b) => createdAtMs(b) - createdAtMs(a));
  const merged = [
    buildBazaarJaffaPinned(),
    buildCityTowerPinned(),
    ...buildRoomsBranchPins(),
    ...buildWeWorkBranchPins(),
    ...sortedRest,
  ];
  return applyVarietyToPropertyList(merged);
}

/** Start empty — first GET /properties wins (no sessionStorage hydrate for initial KPI/stats). */
function initialPropertiesState() {
  return [];
}

export function PropertiesProvider({ children }) {
  const authToken = useStore((s) => s.authToken);
  const [properties, setProperties] = useState(() => initialPropertiesState());
  const [loading, setLoading] = useState(true);
  const [dbLoadStatus, setDbLoadStatus] = useState('loading');
  const [hasMoreProperties, setHasMoreProperties] = useState(false);
  const [loadingMoreProperties, setLoadingMoreProperties] = useState(false);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(null);
  const propertiesLengthRef = useRef(0);
  /** Raw API room rows accumulated (server pagination). */
  const rawRoomsAccRef = useRef([]);

  const buildAndApplyMapped = useCallback((roomList) => {
    const mapped =
      roomList.length === 0
        ? getFallbackPropertyList()
        : finalizePropertyList(roomList.map((r, i) => mapRoomToProperty(r, i)));
    if (roomList.length === 0) {
      console.warn('[properties] API returned 0 rooms — using pinned fallback (Bazaar, WeWork, ROOMS, City Tower)');
    }
    const withImages = applyHardLockHeroes(mergePropertyImageOverrides(mapped));
    console.log('[properties] merged list length:', withImages.length);
    setProperties(withImages);
    if (withImages.length > 0) saveMappedPropertyList(withImages, { force: true });
    return withImages;
  }, []);

  useEffect(() => {
    propertiesLengthRef.current = Array.isArray(properties) ? properties.length : 0;
  }, [properties]);

  const refresh = useCallback(async (force = false, silent = false) => {
    if (!authToken) return;
    const now = Date.now();
    if (inFlightRef.current) return inFlightRef.current;
    if (!force && now - lastFetchAtRef.current < MIN_REFRESH_GAP_MS) {
      return;
    }
    const blockUi = !silent && propertiesLengthRef.current === 0;
    if (blockUi) setLoading(true);
    const p = (async () => {
      try {
        let out;
        if (force) {
          rawRoomsAccRef.current = [];
        }
        const accLen = rawRoomsAccRef.current.length;
        if (silent && accLen > 0) {
          const cap = Math.max(PROPERTIES_PAGE_SIZE, accLen);
          out = await getProperties({ limit: cap, offset: 0 });
          if (!out.networkError && Array.isArray(out.list)) {
            rawRoomsAccRef.current = out.list;
          }
        } else {
          out = await getProperties({ limit: PROPERTIES_PAGE_SIZE, offset: 0 });
          if (!out.networkError && Array.isArray(out.list)) {
            rawRoomsAccRef.current = out.list;
          }
        }

        lastFetchAtRef.current = Date.now();
        const networkError = Boolean(out.networkError);
        const dbStatus = out.dbStatus || 'ok';
        let roomList = [...rawRoomsAccRef.current];

        if (networkError && roomList.length === 0) {
          const cached = loadMappedPropertyList();
          if (cached?.items?.length) {
            setDbLoadStatus('cache');
            setProperties(applyHardLockHeroes(mergePropertyImageOverrides(cached.items)));
            setHasMoreProperties(false);
            console.warn('[properties] server slow/unreachable — Loading from cache');
            return;
          }
        }
        setDbLoadStatus(networkError ? 'cache' : dbStatus || 'ok');
        const total = Number(out.propertiesTotal) || roomList.length;
        const hasMore = Boolean(out.propertiesHasMore) || roomList.length < total;
        setHasMoreProperties(roomList.length > 0 && hasMore);

        console.log('[properties] GET /properties rows:', roomList.length, roomList[0] ? '(sample id: ' + String(roomList[0].id) + ')' : '');
        const mapped = buildAndApplyMapped(roomList);
        try {
          const first = mapped && mapped[0];
          if (first && isBazaarJaffaProperty(first)) {
            const voiceDone = sessionStorage.getItem('maya_bazaar_voice_done') === '1';
            const policyDone = sessionStorage.getItem('maya_bazaar_policy_kb_v1_done') === '1';
            const dealsDone = sessionStorage.getItem('maya_bazaar_deals_campaign_done') === '1';
            if (!voiceDone) sessionStorage.setItem('maya_bazaar_pending_speak', '1');
            if (!policyDone) sessionStorage.setItem('maya_bazaar_policy_kb_pending', '1');
            if (!dealsDone) sessionStorage.setItem('maya_bazaar_deals_campaign_pending', '1');
            if (!voiceDone || !policyDone || !dealsDone) {
              window.dispatchEvent(new CustomEvent('maya-bazaar-properties-ready', { detail: { source: 'refresh' } }));
            }
          }
          try {
            const hasRoomsBranch = mapped.some((p) => ROOMS_PIN_ID_SET.has(String(p.id)));
            const enterpriseDone = sessionStorage.getItem('maya_enterprise_voice_v1_done') === '1';
            if (hasRoomsBranch && !enterpriseDone) {
              sessionStorage.setItem('maya_enterprise_voice_pending', '1');
              window.dispatchEvent(new CustomEvent('maya-enterprise-ready', { detail: { source: 'refresh' } }));
            }
          } catch (_) {
            /* ignore */
          }
          try {
            const hasWeWork = mapped.some((p) => WEWORK_PIN_ID_SET.has(String(p.id)));
            const weworkDone = sessionStorage.getItem('maya_wework_injection_v1_done') === '1';
            if (hasWeWork && !weworkDone) {
              sessionStorage.setItem('maya_wework_injection_pending', '1');
              window.dispatchEvent(new CustomEvent('maya-wework-portfolio-ready', { detail: { source: 'refresh' } }));
            }
          } catch (_) {
            /* ignore */
          }
        } catch (_) {
          /* ignore */
        }
      } catch (e) {
        console.warn('[properties] GET /properties failed — trying cache then fallback', e);
        const cached = loadMappedPropertyList();
        if (cached?.items?.length) {
          setDbLoadStatus('cache');
          setProperties(applyHardLockHeroes(mergePropertyImageOverrides(cached.items)));
        } else {
          setDbLoadStatus('error');
          setProperties(applyHardLockHeroes(mergePropertyImageOverrides(getFallbackPropertyList())));
        }
        setHasMoreProperties(false);
      } finally {
        if (blockUi) setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, [authToken, buildAndApplyMapped]);

  const loadMoreProperties = useCallback(async () => {
    if (loadingMoreProperties || !hasMoreProperties) return;
    const off = rawRoomsAccRef.current.length;
    if (off === 0) return;
    setLoadingMoreProperties(true);
    try {
      const out = await getProperties({ limit: PROPERTIES_PAGE_SIZE, offset: off });
      if (out.networkError || !Array.isArray(out.list) || !out.list.length) {
        setHasMoreProperties(false);
        return;
      }
      rawRoomsAccRef.current = [...rawRoomsAccRef.current, ...out.list];
      const total = Number(out.propertiesTotal) || rawRoomsAccRef.current.length;
      const mergedLen = rawRoomsAccRef.current.length;
      setHasMoreProperties(mergedLen < total && out.propertiesHasMore !== false);
      buildAndApplyMapped(rawRoomsAccRef.current);
    } catch (_) {
      setHasMoreProperties(false);
    } finally {
      setLoadingMoreProperties(false);
    }
  }, [hasMoreProperties, loadingMoreProperties, buildAndApplyMapped]);

  const applyPropertySnapshot = useCallback((room) => {
    if (!room || room.id == null) return;
    const mapped = mapRoomToProperty(room);
    setProperties((prev) => {
      const id = String(room.id);
      const rest = prev.filter((p) => p.id !== id);
      const next = finalizePropertyList([mapped, ...rest]);
      return applyHardLockHeroes(mergePropertyImageOverrides(next));
    });
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
      applyPropertySnapshot,
      hasMoreProperties,
      loadingMoreProperties,
      loadMoreProperties,
    }),
    [
      properties,
      loading,
      refresh,
      dbLoadStatus,
      applyPropertySnapshot,
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
