import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, Upload, Loader2, X,
} from 'lucide-react';
import { deleteProperty, createPropertyQuiet, bulkImportPropertyStaff, bootstrapOperationalData } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import { API_URL } from '../../utils/constants';
import PropertyCreatorModal from './PropertyCreatorModal';
import PropertySuitesView from './PropertySuitesView';
import GuestAddModal from './GuestAddModal';
import PropertyManagementDashboard from './PropertyManagementDashboard';
import PropertyCard from './PropertyCard';
import useStore from '../../store/useStore';
import { speakMayaReply } from '../../utils/mayaVoice';
import { isHiddenDemoProperty } from '../../utils/bazaarProperties';
import { ROOMS_BRANCH_PINS, ROOMS_PIN_ID_SET } from '../../config/roomsBranches';
import { WEWORK_BRANCH_PINS, WEWORK_PIN_ID_SET } from '../../config/weworkBranches';
import { inferPropertyEnterpriseMeta, uniqueSorted } from '../../utils/propertyEnterpriseMeta';
import { BAZAAR_JAFFA_GUEST_POLICY } from '../../data/propertyData';
import { PropertyGridSkeleton } from '../common/DashboardSkeletons';
import {
  parseEnterpriseWorkbook,
  validatePropertyLikeRows,
  buildMayaValidationReportHe,
  rowToCreatePropertyPayload,
  rowToStaffBulkRow,
  chunkArray,
} from '../../utils/massImportEngine';
import { resolvePropertyCardImage } from '../../utils/propertyCardImages';
import { persistPropertyImageOverrideFromItem } from '../../utils/propertyImagePersistence';
import './PropertiesDashboard.css';

const PAGE_SIZE = 20;

const MAYA_PROP_SORT_CONFIRM =
  'קובי, סידרתי את רשימת הנכסים — בזאר יפו וסיטי טאוור רמת גן בראש העמוד, עם גלריות מעודכנות.';

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

function parsePriceFromDescription(description) {
  if (!description) return null;
  if (/מחירי בסיס זמניים:\s*₪0|₪0 לכל סוגי ההשכרה/i.test(description)) return '0';
  const m = description.match(/מחיר\s*ללילה[:\s]*₪?(\d+)/i) || description.match(/₪(\d+)/);
  return m ? m[1] : null;
}

function ensureFullImageUrl(url) {
  if (!url || typeof url !== 'string') return PLACEHOLDER_IMAGE;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('/assets/')) return u;
  let filename = u.startsWith('/') ? u.replace(/^\/+/, '') : u;
  if (filename.startsWith('api/')) return PLACEHOLDER_IMAGE;
  if (filename.startsWith('uploads/')) return `${API_URL}/${filename}`;
  return `${API_URL}/uploads/${filename}`;
}

function mapRoomToProperty(room, listIndex = 0) {
  const price = parsePriceFromDescription(room.description);
  const isCleaning = ['pending', 'assigned', 'on_my_way', 'in_progress'].includes(room.latest_status || room.status || '');
  const pictures = Array.isArray(room.pictures) ? room.pictures.filter(Boolean) : [];
  let imgUrl = (pictures[0] || room.image_url || room.photo_url || '').trim();
  if (!imgUrl) {
    imgUrl = resolvePropertyCardImage(room, listIndex);
  }
  return {
    id: room.id != null ? String(room.id) : '',
    name: room.name,
    mainImage: ensureFullImageUrl(imgUrl),
    photo_url: imgUrl,
    pictures: pictures.filter(Boolean).map(ensureFullImageUrl),
    status: isCleaning ? 'InProgress' : 'Ready',
    price: price || '—',
    guests: room.max_guests ?? room.guests ?? 2,
    max_guests: room.max_guests ?? 2,
    bedrooms: room.bedrooms ?? 1,
    beds: room.beds ?? 1,
    bathrooms: room.bathrooms ?? 1,
    description: room.description || '',
    amenities: Array.isArray(room.amenities) ? room.amenities : [],
    ai_automation_enabled: Boolean(room.ai_automation_enabled),
    createdAt: room.created_at || room.createdAt || '',
    branchSlug: room.branchSlug || room.branch_slug || undefined,
  };
}

function isBazaarJaffaName(p) {
  const n = `${p?.name || ''}`.toLowerCase();
  return /בזאר|bazaar|מלון בזאר|hotel bazaar|jaffa|יפו/.test(n);
}

function isCityTowerName(p) {
  const n = `${p?.name || ''}`.toLowerCase();
  return /city tower|סיטי טאוור|leonardo plaza|ליאונרדו|רמת גן|ramat gan/.test(n);
}

function isRoomsWorkspaceName(p) {
  if (ROOMS_PIN_ID_SET.has(String(p?.id))) return true;
  const n = `${p?.name || ''}`.toLowerCase();
  return /rooms sky|sky tower|רומס|coworking|fattal/.test(n);
}

function isWeWorkWorkspaceName(p) {
  if (WEWORK_PIN_ID_SET.has(String(p?.id))) return true;
  const n = `${p?.name || ''}`.toLowerCase();
  return /wework|ווי וורק/.test(n);
}

function sortDashboardProperties(list) {
  const rank = (p) => {
    if (isBazaarJaffaName(p)) return 0;
    if (isCityTowerName(p)) return 1;
    if (isRoomsWorkspaceName(p)) return 2;
    if (isWeWorkWorkspaceName(p)) return 3;
    return 4;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const db = Date.parse(b.createdAt || b.created_at || 0) || 0;
    const da = Date.parse(a.createdAt || a.created_at || 0) || 0;
    return db - da;
  });
}

const EASYHOST_BLUE = '#2563eb';
const EASYHOST_BLUE_HOVER = '#1d4ed8';

export default function PropertiesDashboard() {
  const {
    properties: rawProperties,
    loading,
    refresh,
    dbLoadStatus,
    applyPropertySnapshot,
    hasMoreProperties,
    loadingMoreProperties,
    loadMoreProperties,
  } = useProperties();
  const addMayaMessage = useStore((s) => s.addMayaMessage);
  const role = useStore((s) => s.role);
  const activeTenantId = useStore((s) => s.activeTenantId);
  useEffect(() => {
    console.log('[PropertiesDashboard] mount', { loading, count: rawProperties?.length, dbLoadStatus });
  }, [loading, rawProperties?.length, dbLoadStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bootstrapOperationalData();
      } catch (_) {}
      if (!cancelled) refresh(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_ui_polish_dashboard_fired_v1') === '1') return;
      sessionStorage.setItem('maya_ui_polish_dashboard_fired_v1', '1');
      sessionStorage.setItem('maya_ui_polish_message_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-ui-polish-ready', { detail: { source: 'properties-dashboard' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_bazaar_dashboard_cleanup_fired_v1') === '1') return;
      sessionStorage.setItem('maya_bazaar_dashboard_cleanup_fired_v1', '1');
      sessionStorage.setItem('maya_bazaar_cleanup_message_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-bazaar-dashboard-cleanup-ready', { detail: { source: 'properties-dashboard' } }));
  }, []);

  useEffect(() => {
    if (activeTenantId !== 'BAZAAR_JAFFA') return;
    try {
      if (sessionStorage.getItem('maya_gallery_api_confirm_fired_v1') === '1') return;
      sessionStorage.setItem('maya_gallery_api_confirm_fired_v1', '1');
      sessionStorage.setItem('maya_gallery_api_confirm_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-bazaar-gallery-api-confirm-ready', { detail: { source: 'properties-dashboard' } }));
  }, [activeTenantId]);

  const applyFiltersViewResults = useCallback(() => {
    setVisibleCount(PAGE_SIZE);
    try {
      document.getElementById('properties-dashboard-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) {
      /* noop */
    }
  }, []);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [managedProperty, setManagedProperty] = useState(null);
  const [imageRefreshKey, setImageRefreshKey] = useState(0);
  const [branchFilter, setBranchFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('all');
  const [occupancyFilter, setOccupancyFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [massImportBusy, setMassImportBusy] = useState(false);
  const massInputRef = useRef(null);
  const [bazaarPolicyOpen, setBazaarPolicyOpen] = useState(false);
  const filtersInitRef = useRef(false);

  useEffect(() => {
    if (filtersInitRef.current) return;
    filtersInitRef.current = true;
    setBranchFilter('all');
    setCityFilter('all');
    setBrandFilter('all');
    setPropertyTypeFilter('all');
    setOccupancyFilter('all');
    setSearchQuery('');
  }, []);

  const properties = useMemo(() => {
    const filtered = Array.isArray(rawProperties)
      ? rawProperties.filter((p) => !isHiddenDemoProperty(p))
      : [];
    const sorted = sortDashboardProperties(filtered);
    const list = sorted.map((room, idx) => mapRoomToProperty(room, idx));
    return list.map((p) => ({
      ...p,
      ...inferPropertyEnterpriseMeta(p),
    }));
  }, [rawProperties]);

  const cityOptions = useMemo(
    () => uniqueSorted(properties.map((p) => String(p.city || '—').trim())),
    [properties],
  );
  const brandOptions = useMemo(
    () => uniqueSorted(properties.map((p) => String(p.brand || '').trim()).filter(Boolean)),
    [properties],
  );
  const typeOptions = useMemo(() => uniqueSorted(properties.map((p) => p.propertyType)), [properties]);
  const occOptions = useMemo(() => uniqueSorted(properties.map((p) => p.occupancy)), [properties]);

  const branchOptions = useMemo(
    () => [
      { id: 'all', label: 'כל הסניפים' },
      ...ROOMS_BRANCH_PINS.map((b) => ({ id: b.slug, label: `${b.name} · ${b.city}` })),
      ...WEWORK_BRANCH_PINS.map((b) => ({ id: b.slug, label: `${b.name} · ${b.cityHe}` })),
    ],
    [],
  );

  const filteredProperties = useMemo(() => {
    const cityVal = (p) => String(p.city || '—').trim();
    const brandVal = (p) => String(p.brand || '').trim();

    let list = properties;
    if (branchFilter !== 'all') {
      const roomsPin = ROOMS_BRANCH_PINS.find((b) => b.slug === branchFilter);
      if (roomsPin) {
        list = list.filter((p) => p.branchSlug === branchFilter || String(p.id) === roomsPin.id);
      } else {
        const wwPin = WEWORK_BRANCH_PINS.find((b) => b.slug === branchFilter);
        if (wwPin) {
          list = list.filter((p) => p.branchSlug === branchFilter || String(p.id) === wwPin.id);
        }
      }
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const blob = `${p.name} ${p.id} ${p.city || ''} ${p.brand || ''} ${p.propertyType || ''} ${p.description || ''}`.toLowerCase();
        return blob.includes(q);
      });
    }
    if (cityFilter !== 'all') list = list.filter((p) => cityVal(p) === cityFilter);
    if (brandFilter !== 'all') list = list.filter((p) => brandVal(p) === brandFilter);
    if (propertyTypeFilter !== 'all') list = list.filter((p) => p.propertyType === propertyTypeFilter);
    if (occupancyFilter !== 'all') list = list.filter((p) => p.occupancy === occupancyFilter);

    if (
      list.length === 0
      && properties.length > 0
      && !q
      && branchFilter === 'all'
      && cityFilter === 'all'
      && brandFilter === 'all'
      && propertyTypeFilter === 'all'
      && occupancyFilter === 'all'
    ) {
      return properties;
    }
    return list;
  }, [properties, branchFilter, searchQuery, cityFilter, brandFilter, propertyTypeFilter, occupancyFilter]);

  const visibleProperties = useMemo(
    () => filteredProperties.slice(0, visibleCount),
    [filteredProperties, visibleCount],
  );

  const suitesData = useMemo(
    () =>
      visibleProperties.map((p) => ({
        id: p.id,
        name: p.name,
        rooms: p.bedrooms ?? 1,
        guests: p.guests ?? p.max_guests ?? 2,
        bedrooms: p.bedrooms ?? 1,
        beds: p.beds ?? 1,
        bathrooms: p.bathrooms ?? 1,
        price: p.price,
        description: p.description,
      })),
    [visibleProperties],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, cityFilter, brandFilter, propertyTypeFilter, occupancyFilter, branchFilter, properties.length]);

  const loadMore = useCallback(() => {
    setVisibleCount((c) => {
      const cap = filteredProperties.length;
      const next = Math.min(c + PAGE_SIZE, cap);
      if (next >= cap && hasMoreProperties && !loadingMoreProperties) {
        queueMicrotask(() => loadMoreProperties());
      }
      return next;
    });
  }, [filteredProperties.length, hasMoreProperties, loadingMoreProperties, loadMoreProperties]);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const loadMoreSentinelRef = useRef(null);
  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || (visibleCount >= filteredProperties.length && !hasMoreProperties)) return undefined;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { root: null, rootMargin: '400px', threshold: 0 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [visibleCount, filteredProperties.length, hasMoreProperties]);

  const handleMassImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMassImportBusy(true);
    try {
      const { sheets } = await parseEnterpriseWorkbook(file);
      let propRows = [];
      if (sheets.Properties?.length) propRows = sheets.Properties;
      else if (sheets.WeWork?.length) propRows = sheets.WeWork;
      else if (sheets.wework?.length) propRows = sheets.wework;
      else if (sheets.Rooms?.length) propRows = sheets.Rooms;
      else if (sheets.Inventory?.length) propRows = sheets.Inventory;
      else if (sheets.Pricing?.length) propRows = sheets.Pricing;
      else if (sheets.default?.length) propRows = sheets.default;
      else {
        const keys = Object.keys(sheets);
        if (keys[0]) propRows = sheets[keys[0]] || [];
      }
      const stats = validatePropertyLikeRows(propRows);
      const msg = buildMayaValidationReportHe(stats);
      window.dispatchEvent(new CustomEvent('maya-mass-import-report', { detail: { ...stats, message: msg } }));
      for (const chunk of chunkArray(propRows, 40)) {
        for (const row of chunk) {
          const payload = rowToCreatePropertyPayload(row);
          if (!payload.name || payload.name === 'Imported Property') continue;
          try {
            await createPropertyQuiet(payload);
          } catch {
            /* skip row */
          }
        }
      }
      const staffSheet = sheets.Staff || sheets.staff || sheets['עובדים'];
      if (staffSheet?.length) {
        const pid =
          properties.find((p) => !ROOMS_PIN_ID_SET.has(String(p.id)))?.id || properties[0]?.id;
        if (pid) {
          const staffRows = staffSheet.map(rowToStaffBulkRow).filter((r) => r.name);
          for (const ch of chunkArray(staffRows, 200)) {
            try {
              await bulkImportPropertyStaff(pid, ch);
            } catch {
              /* ignore chunk */
            }
          }
        }
      }
      refresh(true);
    } catch (err) {
      window.alert(err?.message || 'ייבוא נכשל');
    } finally {
      setMassImportBusy(false);
    }
  };

  const openCreateModal = () => {
    setEditingProperty(null);
    setShowPropertyModal(true);
  };

  const openEditModal = (property) => {
    setEditingProperty(property);
    setShowPropertyModal(true);
  };

  const openManageDashboard = (property) => {
    setManagedProperty(property);
  };

  const closeManageDashboard = () => {
    setManagedProperty(null);
    refresh(true);
  };

  const closeModal = () => {
    setShowPropertyModal(false);
    setEditingProperty(null);
  };

  const handleModalSuccess = (created) => {
    const isNew = !editingProperty;
    if (created && typeof applyPropertySnapshot === 'function') {
      applyPropertySnapshot(created);
    }
    if (created?.id) {
      persistPropertyImageOverrideFromItem({
        id: created.id,
        mainImage: created.mainImage || created.photo_url || created.image_url,
        photo_url: created.photo_url,
        image_url: created.image_url,
        pictures: created.pictures || created.images,
      });
    }
    if (isNew && activeTenantId === 'BAZAAR_JAFFA') {
      addMayaMessage({ role: 'assistant', content: MAYA_PROP_SORT_CONFIRM });
      speakMayaReply(MAYA_PROP_SORT_CONFIRM, role, {});
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } else if (isNew) {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    window.dispatchEvent(
      new CustomEvent('properties-refresh', { detail: { force: true, silent: true } }),
    );
    setImageRefreshKey((k) => k + 1);
    closeModal();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('האם למחוק את הנכס?')) return;
    const idStr = id != null ? String(id) : '';
    if (!idStr) return;
    try {
      await deleteProperty(idStr);
      refresh();
      window.dispatchEvent(new Event('properties-refresh'));
    } catch (e) {
      window.alert(e?.message || 'שגיאה במחיקה');
    }
  };


  if (managedProperty) {
    return (
      <PropertyManagementDashboard
        property={managedProperty}
        onBack={closeManageDashboard}
        onEdit={(p) => { setManagedProperty(null); setEditingProperty(p); setShowPropertyModal(true); }}
        onPropertyUpdate={(updated) => {
          // Update the local snapshot so PropertyManagementDashboard receives
          // the backend-confirmed value immediately (prevents useEffect revert).
          setManagedProperty((prev) => (prev ? { ...prev, ...updated } : updated));
          // Also push into PropertiesContext so the property card is up-to-date.
          if (typeof applyPropertySnapshot === 'function') {
            applyPropertySnapshot(updated);
          }
        }}
      />
    );
  }

  return (
    <div className="properties-dashboard p-10 bg-[#eef2f7] min-h-screen" dir="rtl">
      <div className="flex justify-between items-center mb-12 properties-header-section pb-6 -mx-2 px-2 rounded-xl">
        <div>
          <h1 className="text-4xl font-black text-gray-900">הנכסים שלי</h1>
          <p className="text-gray-600 mt-1">
            נהל {filteredProperties.length} נכסים פעילים עם האוטומציה של מאיה
            {branchFilter !== 'all' ? ` (סניף נבחר)` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            ref={massInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            onChange={handleMassImport}
          />
          <button
            type="button"
            disabled={massImportBusy}
            onClick={() => massInputRef.current?.click()}
            className="props-add-btn"
            title="ייבוא המוני: גיליונות Staff, Properties, Rooms, Inventory, Pricing"
          >
            {massImportBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            <span className="mr-1">ייבוא Enterprise (אקסל גדול)</span>
          </button>
          <button
            type="button"
            onClick={() => setShowGuestModal(true)}
            className="props-add-btn"
          >
            <Plus size={16} className="props-add-icon" />
            הוסף אורח חדש
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="props-add-btn"
          >
            <Plus size={16} className="props-add-icon" />
            הוסף נכס חדש
          </button>
        </div>
      </div>

      <div
        className="mb-6 max-w-5xl rounded-2xl px-5 py-4 shadow-sm"
        style={{ backgroundColor: '#f8f9fa', border: '1px solid #e0e0e0' }}
      >
        <h3 className="text-sm font-black text-gray-900 mb-3">חיפוש וסינון</h3>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch mb-3">
          <div className="relative flex-1 min-w-[200px] sm:order-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFiltersViewResults()}
              placeholder="חיפוש לפי שם, עיר, מותג, מזהה…"
              className="w-full h-12 rounded-xl border border-slate-300 bg-white py-2.5 pr-10 pl-3 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
            />
          </div>
          <button
            type="button"
            onClick={applyFiltersViewResults}
            className="h-12 shrink-0 rounded-xl px-6 text-sm font-black text-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300/80 min-w-[160px] sm:order-2"
            style={{ backgroundColor: EASYHOST_BLUE }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = EASYHOST_BLUE_HOVER; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = EASYHOST_BLUE; }}
          >
            צפה בתוצאות
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
          >
            <option value="all">כל הערים</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
          >
            <option value="all">כל המותגים</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={propertyTypeFilter}
            onChange={(e) => setPropertyTypeFilter(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
          >
            <option value="all">כל סוגי הנכס</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={occupancyFilter}
            onChange={(e) => setOccupancyFilter(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
          >
            <option value="all">כל תפוסות</option>
            {occOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="mt-3">
          <label htmlFor="rooms-branch-select" className="sr-only">
            סניף
          </label>
          <select
            id="rooms-branch-select"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="h-12 w-full md:w-auto md:min-w-[280px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-gray-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200/60"
          >
            {branchOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-600 mt-3">
          מוצגים {visibleProperties.length} מתוך {filteredProperties.length} נכסים (טעינה הדרגתית לביצועים)
        </p>
      </div>

      {!loading && dbLoadStatus === 'cache' && rawProperties?.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-center text-sky-950 text-sm">
          Loading from cache — port 1000 is slow; showing last synced portfolio until the server responds.
        </div>
      )}

      {loading ? (
        <PropertyGridSkeleton cards={9} />
      ) : (
        <>
      {!loading && properties.length === 0 && dbLoadStatus !== 'ok' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-amber-950 text-sm">
          {dbLoadStatus === 'cache' || dbLoadStatus === 'stale'
            ? 'Loading from cache — port 1000 is slow or unreachable; showing last synced portfolio.'
            : 'Database loading or timeout'}
        </div>
      )}
        <div id="properties-dashboard-grid" className="properties-grid">
          {!loading && filteredProperties.length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500 rounded-2xl border border-dashed border-gray-200 bg-white/80">
              אין נכסים שמתאימים לסינון. נקה חיפוש או בחר &quot;כל הסניפים&quot; / כל הערים.
            </div>
          )}
          {visibleProperties.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              onDelete={handleDelete}
              onEdit={openEditModal}
              onManage={openManageDashboard}
              onBazaarPolicy={() => setBazaarPolicyOpen(true)}
              imageRefreshKey={imageRefreshKey}
            />
          ))}
          <div ref={loadMoreSentinelRef} className="col-span-full h-3 w-full pointer-events-none shrink-0" aria-hidden />
          <div
            role="button"
            tabIndex={0}
            className="property-card-add border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center p-10 group hover:border-indigo-400 cursor-pointer transition-all"
            onClick={openCreateModal}
            onKeyDown={(e) => e.key === 'Enter' && openCreateModal()}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors bg-indigo-50/80 group-hover:bg-indigo-100/90">
              <Plus className="props-add-tile-icon" size={32} />
            </div>
            <p className="props-add-tile-text">הוסף נכס נוסף</p>
          </div>
        </div>
        {(visibleCount < filteredProperties.length || hasMoreProperties) && (
          <div className="flex justify-center my-10">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMoreProperties}
              className="px-10 py-3.5 rounded-2xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 shadow-lg disabled:opacity-60"
            >
              {loadingMoreProperties
                ? 'טוען מהשרת...'
                : `טען עוד (${Math.max(0, filteredProperties.length - visibleCount)} מקומי${hasMoreProperties ? ' · יש עוד בשרת' : ''})`}
            </button>
          </div>
        )}
        </>
      )}

      <div className="mt-12 max-w-2xl">
        <PropertySuitesView
          suites={suitesData}
          onAddSuite={() => setShowPropertyModal(true)}
        />
        <p className="text-xs text-gray-500 mt-2 text-center" dir="rtl">
          סוגי חדרים לפי גלילה: {suitesData.length} / {filteredProperties.length} (אחרי סינון)
        </p>
      </div>

      {bazaarPolicyOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setBazaarPolicyOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bazaar-policy-modal-title"
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-xl border border-amber-200 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-2 mb-4">
              <h2 id="bazaar-policy-modal-title" className="text-lg font-black text-gray-900 pr-2">
                {BAZAAR_JAFFA_GUEST_POLICY.titleHe}
              </h2>
              <button
                type="button"
                onClick={() => setBazaarPolicyOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 shrink-0"
                aria-label="סגור"
              >
                <X size={22} />
              </button>
            </div>
            <ul className="text-sm text-gray-800 space-y-2 list-disc list-inside leading-relaxed" dir="rtl">
              {BAZAAR_JAFFA_GUEST_POLICY.bullets.map((b) => (
                <li key={b.label}>
                  <strong>{b.label}:</strong> {b.text}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setBazaarPolicyOpen(false)}
              className="mt-6 w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      <PropertyCreatorModal
        isOpen={showPropertyModal}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        initialProperty={editingProperty}
      />
      <GuestAddModal
        isOpen={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        onSuccess={() => { refresh(true); setImageRefreshKey((k) => k + 1); }}
      />
    </div>
  );
}
