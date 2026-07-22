import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Home, DollarSign, Users, BedDouble, Bath, Minus, Plus,
  Wifi, UtensilsCrossed, Shirt, Waves, Car, Tv, Monitor, AirVent, Wind,
  ShieldAlert, Heart, Baby, ChefHat,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createProperty, updateProperty, getPropertyById } from '../../services/api';
import { persistPropertyImageOverrideFromItem, clearPropertyImageOverride } from '../../utils/propertyImagePersistence';
import { dedupePropertyGalleryUrls, buildPropertyGalleryImages, buildPropertyImageUpdatePayload } from '../../utils/propertyGallery';
import ImageUploader from '../ui/ImageUploader';
import useStore from '../../store/useStore';
import { isRtlLang, normalizeLang } from '../../utils/languages';
import './PropertyCreatorModal.css';

const AMENITY_CONFIG = [
  { key: 'Wi-Fi', slug: 'wifi', Icon: Wifi },
  { key: 'Kitchen', slug: 'kitchen', Icon: UtensilsCrossed },
  { key: 'Washer', slug: 'washer', Icon: Shirt },
  { key: 'Pool', slug: 'pool', Icon: Waves },
  { key: 'Parking', slug: 'parking', Icon: Car },
  { key: 'TV', slug: 'tv', Icon: Tv },
  { key: 'Workspace', slug: 'workspace', Icon: Monitor },
  { key: 'AC', slug: 'ac', Icon: AirVent },
  { key: 'Dryer', slug: 'dryer', Icon: Wind },
  { key: 'Smoke detector', slug: 'smokeDetector', Icon: ShieldAlert },
  { key: 'First aid kit', slug: 'firstAidKit', Icon: Heart },
  { key: 'Crib', slug: 'crib', Icon: Baby },
  { key: 'Basic kitchen', slug: 'basicKitchen', Icon: ChefHat },
];

const AMENITIES = AMENITY_CONFIG.map((a) => a.key);

/** Map legacy amenity keys (from DB) to new keys — data matching only */
const AMENITY_LEGACY_MAP = {
  'מטבח': 'Kitchen',
  'מכונת כביסה': 'Washer',
  'בריכה': 'Pool',
  'חניה': 'Parking',
  'טלוויזיה': 'TV',
  'Dedicated Workspace': 'Workspace',
  'Carbon Monoxide Alarm': 'Smoke detector',
  'First Aid Kit': 'First aid kit',
  Crib: 'Crib',
  'Cooking basics': 'Basic kitchen',
};

/** True when the backend/CDN storage warning should be ignored (local upload fallback). */
function isImageStorageConfigError(msg) {
  const s = String(msg || '').toLowerCase();
  if (!s) return false;
  return (
    s.includes('image storage is not configured') ||
    s.includes('storage is not configured') ||
    s.includes('אחסון תמונות לא הוגדר') ||
    s.includes('אחסון תמונות')
  );
}

function parsePriceFromDescription(desc) {
  if (!desc) return '';
  const m = desc.match(/Price per night:\s*\$?(\d+(?:\.\d+)?)/i)
    || desc.match(/מחיר\s*ללילה[:\s]*₪?(\d+(?:\.\d+)?)/i)
    || desc.match(/₪(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function parsePriceFromProperty(prop) {
  if (!prop) return '';
  for (const key of ['price_per_night', 'nightly_price', 'price']) {
    const v = prop[key];
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
      return String(v);
    }
  }
  return parsePriceFromDescription(prop.description);
}

/** Reusable input with left-side icon */
const InputWithIcon = ({ Icon, placeholder, value, onChange, type = 'text', min }) => (
  <div className="flex items-center gap-3 w-full px-4 py-3 border border-[#e0e0e0] rounded-[10px] bg-white focus-within:border-[#b0b0b0] focus-within:ring-1 focus-within:ring-[#e0e0e0] transition-all">
    <Icon size={20} className="flex-shrink-0 text-[#6b7280]" strokeWidth={1.5} />
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      min={min}
      className="flex-1 min-w-0 border-0 bg-transparent text-[#1a1a1a] text-[15px] placeholder:text-[#9ca3af] outline-none"
    />
  </div>
);

/** Touch-friendly − / value / + stepper (mobile-first; also fine on desktop). */
const QuantityStepper = ({ label, Icon, value, onChange, min = 1, max = 99, decreaseLabel, increaseLabel }) => {
  const n = Math.max(min, Math.min(max, Number(value) || min));
  const dec = () => onChange(Math.max(min, n - 1));
  const inc = () => onChange(Math.min(max, n + 1));
  return (
    <div className="property-qty-field">
      <label className="property-qty-label">
        {Icon ? <Icon size={14} className="property-qty-label-icon" aria-hidden /> : null}
        {label}
      </label>
      <div className="property-qty-stepper" role="group" aria-label={label}>
        <button
          type="button"
          className="property-qty-btn"
          onClick={dec}
          disabled={n <= min}
          aria-label={`${label}: ${decreaseLabel}`}
        >
          <Minus size={18} strokeWidth={2.5} aria-hidden />
        </button>
        <span className="property-qty-value" aria-live="polite">{n}</span>
        <button
          type="button"
          className="property-qty-btn"
          onClick={inc}
          disabled={n >= max}
          aria-label={`${label}: ${increaseLabel}`}
        >
          <Plus size={18} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </div>
  );
};

export default function PropertyCreatorModal({ isOpen, onClose, onSuccess, initialProperty }) {
  const { t } = useTranslation();
  const lang = normalizeLang(useStore((s) => s.lang) || 'en');
  const tr = useCallback((key, opts) => t(key, { ...(opts || {}), lng: lang }), [t, lang]);
  const dir = isRtlLang(lang) ? 'rtl' : 'ltr';

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [maxGuests, setMaxGuests] = useState(2);
  const [bedrooms, setBedrooms] = useState(1);
  const [beds, setBeds] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [amenities, setAmenities] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGallerySaving, setIsGallerySaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const initializedForRef = useRef(null);
  const editPropertyIdRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      initializedForRef.current = null;
      editPropertyIdRef.current = null;
      return;
    }

    const incomingId = initialProperty?.id != null ? String(initialProperty.id).trim() : '';
    const sessionKey = incomingId || 'new';
    if (initializedForRef.current === sessionKey) return;
    initializedForRef.current = sessionKey;
    editPropertyIdRef.current = incomingId || null;

    if (initialProperty) {
      setName(initialProperty.name || '');
      setPrice(parsePriceFromProperty(initialProperty) || '');
      setMaxGuests(initialProperty.max_guests ?? initialProperty.guests ?? 2);
      setBedrooms(initialProperty.bedrooms ?? 1);
      setBeds(initialProperty.beds ?? 1);
      setBathrooms(initialProperty.bathrooms ?? 1);
      const pics = buildPropertyGalleryImages(initialProperty);
      setPhotoUrls(pics);
      const am = Array.isArray(initialProperty.amenities) ? initialProperty.amenities : [];
      const norm = (x) => AMENITY_LEGACY_MAP[x] || x;
      setAmenities(AMENITIES.reduce((acc, a) => ({
        ...acc,
        [a]: am.some((x) => norm(x) === a || x === a),
      }), {}));
    } else {
      setName('');
      setPrice('');
      setMaxGuests(2);
      setBedrooms(1);
      setBeds(1);
      setBathrooms(1);
      setPhotoUrls([]);
      setAmenities({});
    }
  }, [isOpen, initialProperty]);

  const toggleAmenity = (key) => {
    setAmenities((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePhotoUrlsComplete = async (urls) => {
    const list = dedupePropertyGalleryUrls(Array.isArray(urls) ? urls.filter(Boolean) : []);
    setPhotoUrls(list);
    const pid = editPropertyIdRef.current;
    if (!pid) {
      return;
    }
    const before = buildPropertyGalleryImages(initialProperty || { id: pid });
    const deleting = before.find((u) => !list.includes(u)) || before[0] || '';
    console.log('[ImageDelete] property id', pid);
    console.log('[ImageDelete] deleting url', deleting);
    console.log('[ImageDelete] before images', before);
    console.log('[ImageDelete] after images', list);
    setIsGallerySaving(true);
    setError(null);
    try {
      const payload = buildPropertyImageUpdatePayload(initialProperty || { id: pid }, list);
      const result = await updateProperty(pid, payload);
      console.log('[ImageDelete] backend response', result?.property || result);

      const saved = result?.property || result;
      let fromServer = dedupePropertyGalleryUrls(
        Array.isArray(saved?.pictures) ? saved.pictures.filter(Boolean) : [],
      );
      if (!fromServer.length && list.length) {
        try {
          const fresh = await getPropertyById(pid);
          fromServer = dedupePropertyGalleryUrls(
            Array.isArray(fresh?.pictures) ? fresh.pictures.filter(Boolean) : [],
          );
        } catch (_) {
          fromServer = list;
        }
      }
      setPhotoUrls(fromServer);
      if (fromServer.length) {
        persistPropertyImageOverrideFromItem({
          id: pid,
          mainImage: fromServer[0],
          photo_url: fromServer[0],
          image_url: fromServer[0],
          pictures: fromServer,
        });
      } else {
        clearPropertyImageOverride(pid);
      }
      window.dispatchEvent(new CustomEvent('properties-refresh', { detail: { force: true, silent: true } }));
    } catch (e) {
      if (isImageStorageConfigError(e?.message)) {
        setPhotoUrls(list);
        setError(null);
        return;
      }
      setError(e?.message || tr('propertyCreatorModal.errorGallerySave'));
    } finally {
      setIsGallerySaving(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = (name || '').trim() || tr('propertyCreatorModal.unnamed');

    setIsSubmitting(true);
    setError(null);

    try {
      const images = dedupePropertyGalleryUrls(Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : []);
      const selectedAmenities = AMENITIES.filter((a) => amenities[a]);
      const imageFields = buildPropertyImageUpdatePayload({}, images);

      const amenityList = (selectedAmenities || []).join(', ');
      const descParts = [];
      if (price) descParts.push(`Price per night: $${price}`);
      if (amenityList) descParts.push(tr('propertyCreatorModal.descAmenities', { list: amenityList }));
      const description = descParts.join(' | ') || tr('propertyCreatorModal.descManual');

      const priceNum = price !== '' && price != null ? Number(price) : null;
      const payload = {
        name: trimmedName || '',
        type: 'hotel',
        city: '',
        country: '',
        status: 'active',
        description: description || '',
        price_per_night: Number.isFinite(priceNum) ? priceNum : undefined,
        nightly_price: Number.isFinite(priceNum) ? priceNum : undefined,
        price: Number.isFinite(priceNum) ? priceNum : undefined,
        currency: 'USD',
        ...imageFields,
        amenities: selectedAmenities || [],
        max_guests: Math.max(1, parseInt(maxGuests, 10) || 2),
        bedrooms: Math.max(1, parseInt(bedrooms, 10) || 1),
        beds: Math.max(1, parseInt(beds, 10) || 1),
        bathrooms: Math.max(1, parseInt(bathrooms, 10) || 1),
      };
      const editId = editPropertyIdRef.current;
      const result = editId
        ? await updateProperty(editId, payload)
        : await createProperty(payload);
      let property = result?.property || result;
      const savedId = property?.id || editId;
      if (!editId && !savedId) {
        throw new Error(tr('propertyCreatorModal.errorNoId'));
      }

      const responseFromServer =
        Array.isArray(property?.pictures) && property.pictures.length > 0
          ? property.pictures.filter(Boolean)
          : property?.mainImage || property?.photo_url
            ? [property.mainImage || property.photo_url].filter(Boolean)
            : [];

      if (responseFromServer.length > 0) {
        setPhotoUrls(responseFromServer);
      } else if (savedId) {
        try {
          const fresh = await getPropertyById(savedId);
          property = { ...property, ...fresh };
          const fromServer =
            Array.isArray(fresh?.pictures) && fresh.pictures.length > 0
              ? fresh.pictures.filter(Boolean)
              : fresh?.mainImage || fresh?.photo_url
                ? [fresh.mainImage || fresh.photo_url].filter(Boolean)
                : [];
          if (images.length > 0 && !fromServer.length) {
            setPhotoUrls(images);
          } else if (fromServer.length > 0) {
            setPhotoUrls(fromServer);
          }
        } catch (refreshErr) {
          if (images.length > 0) setPhotoUrls(images);
          console.warn('[PropertyCreatorModal] getPropertyById after save failed:', refreshErr);
        }
      }

      if (savedId && images.length > 0) {
        persistPropertyImageOverrideFromItem({
          id: savedId,
          mainImage: images[0],
          photo_url: images[0],
          image_url: images[0],
          pictures: images,
        });
      }

      typeof onSuccess === 'function' && onSuccess(property);
      setSuccessMessage(tr('propertyCreatorModal.successCreated'));
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
        setName('');
        setPrice('');
        setMaxGuests(2);
        setBedrooms(1);
        setBeds(1);
        setBathrooms(1);
        setPhotoUrls([]);
        setAmenities({});
      }, 2000);
    } catch (e) {
      if (isImageStorageConfigError(e?.message)) {
        setError(null);
        console.warn('[PropertyCreatorModal] ignored storage warning:', e?.message);
      } else {
        const errMsg = e?.message || tr('propertyCreatorModal.errorGeneric');
        setError(errMsg);
        console.error('[Create Property] Request failed:', e);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const decreaseLabel = tr('propertyCreatorModal.decrease');
  const increaseLabel = tr('propertyCreatorModal.increase');

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        key={lang}
        className="property-creator-modal-panel w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
        onClick={(e) => e.stopPropagation()}
        dir={dir}
      >
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-xl font-bold text-[#1a1a1a]">
            {initialProperty
              ? tr('propertyCreatorModal.titleEdit')
              : tr('propertyCreatorModal.titleCreate')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-[#e5e7eb] bg-white text-[#1a1a1a] hover:bg-[#f5f5f5] hover:border-[#d1d5db] transition-colors"
            aria-label={tr('propertyCreatorModal.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 pt-6 space-y-6">
          <ImageUploader
            key={initialProperty?.id ?? 'new'}
            variant="airbnb"
            maxFiles={5}
            onUploadComplete={handlePhotoUrlsComplete}
            propertyId={initialProperty?.id ?? null}
            initialUrls={Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : []}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputWithIcon
              Icon={Home}
              placeholder={tr('propertyCreatorModal.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <InputWithIcon
              Icon={DollarSign}
              placeholder={tr('propertyCreatorModal.pricePlaceholder')}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
            />
          </div>

          <div className="property-qty-grid">
            <QuantityStepper
              label={tr('propertyCreatorModal.guests')}
              Icon={Users}
              value={maxGuests}
              onChange={setMaxGuests}
              min={1}
              max={50}
              decreaseLabel={decreaseLabel}
              increaseLabel={increaseLabel}
            />
            <QuantityStepper
              label={tr('propertyCreatorModal.rooms')}
              Icon={BedDouble}
              value={bedrooms}
              onChange={setBedrooms}
              min={1}
              max={30}
              decreaseLabel={decreaseLabel}
              increaseLabel={increaseLabel}
            />
            <QuantityStepper
              label={tr('propertyCreatorModal.beds')}
              Icon={BedDouble}
              value={beds}
              onChange={setBeds}
              min={1}
              max={50}
              decreaseLabel={decreaseLabel}
              increaseLabel={increaseLabel}
            />
            <QuantityStepper
              label={tr('propertyCreatorModal.baths')}
              Icon={Bath}
              value={bathrooms}
              onChange={setBathrooms}
              min={1}
              max={20}
              decreaseLabel={decreaseLabel}
              increaseLabel={increaseLabel}
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-[#1a1a1a] mb-3">
              {tr('propertyCreatorModal.amenitiesTitle')}
            </p>
            <div className="grid grid-cols-5 sm:grid-cols-5 max-sm:grid-cols-4 gap-2">
              {AMENITY_CONFIG.map(({ key, slug, Icon }) => {
                const label = tr(`propertyCreatorModal.amenities.${slug}`);
                return (
                  <label
                    key={key}
                    className={`
                    amenity-tile flex flex-col items-center justify-center w-[60px] h-[60px] rounded-xl border cursor-pointer
                    transition-all duration-200 select-none
                    ${amenities[key]
                      ? 'amenity-tile--selected border border-[#d4d4d4] bg-[#f7f7f7] text-[#222222] shadow-sm'
                      : 'border-[#e5e5e5] bg-white text-[#6b7280] hover:scale-[1.03] hover:border-[#d4d4d4]'
                    }
                  `}
                  >
                    <input
                      type="checkbox"
                      checked={!!amenities[key]}
                      onChange={() => toggleAmenity(key)}
                      className="sr-only"
                    />
                    <Icon
                      size={20}
                      className={`mb-1 flex-shrink-0 ${amenities[key] ? 'text-[#222222]' : 'text-[#6b7280]'}`}
                      strokeWidth={1.5}
                    />
                    <span
                      className={`text-[10px] font-semibold text-center leading-tight px-0.5 truncate w-full max-w-[52px] ${amenities[key] ? 'text-[#222222]' : 'text-[#6b7280]'}`}
                    >
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-[#e5e7eb] bg-[#fafafa] space-y-2">
            <p className="text-sm font-semibold text-[#1a1a1a]">
              {tr('propertyCreatorModal.customerOptions')}
            </p>
            <div className="space-y-1 text-xs text-[#4b5563]">
              <p>
                <span className="font-medium text-[#1a1a1a]">
                  {tr('propertyCreatorModal.cancelPolicyLabel')}
                </span>{' '}
                {tr('propertyCreatorModal.cancelPolicyText')}
              </p>
              <p>
                <span className="font-medium text-[#1a1a1a]">
                  {tr('propertyCreatorModal.paymentLabel')}
                </span>{' '}
                {tr('propertyCreatorModal.paymentText')}
              </p>
            </div>
          </div>

          {error && !isImageStorageConfigError(error) && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {successMessage && (
            <div className="p-4 rounded-xl bg-emerald-500 text-white font-semibold text-center">
              {successMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || isGallerySaving}
            className="w-full py-4 rounded-xl font-bold text-white bg-[#0d9488] shadow-[0_2px_8px_rgba(13,148,136,0.3)] hover:bg-[#0f766e] hover:shadow-[0_4px_12px_rgba(13,148,136,0.4)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="property-loader" aria-hidden />
                {initialProperty
                  ? tr('propertyCreatorModal.updating')
                  : tr('propertyCreatorModal.creating')}
              </span>
            ) : (
              initialProperty
                ? tr('propertyCreatorModal.submitUpdate')
                : tr('propertyCreatorModal.submitCreate')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
