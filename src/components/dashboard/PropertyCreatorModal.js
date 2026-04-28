import React, { useState, useEffect, useRef } from 'react';
import {
  X, Home, DollarSign, Users, BedDouble, Bath,
  Wifi, UtensilsCrossed, Shirt, Waves, Car, Tv, Monitor, AirVent, Wind,
  ShieldAlert, Heart, Baby, ChefHat,
} from 'lucide-react';
import { createProperty, updateProperty, getPropertyById } from '../../services/api';
import { persistPropertyImageOverrideFromItem } from '../../utils/propertyImagePersistence';
import ImageUploader from '../ui/ImageUploader';
import './PropertyCreatorModal.css';

const AMENITY_CONFIG = [
  { key: 'Wi-Fi', label: 'Wi-Fi', Icon: Wifi },
  { key: 'Kitchen', label: 'Kitchen', Icon: UtensilsCrossed },
  { key: 'Washer', label: 'Washer', Icon: Shirt },
  { key: 'Pool', label: 'Pool', Icon: Waves },
  { key: 'Parking', label: 'Parking', Icon: Car },
  { key: 'TV', label: 'TV', Icon: Tv },
  { key: 'Workspace', label: 'Workspace', Icon: Monitor },
  { key: 'AC', label: 'AC', Icon: AirVent },
  { key: 'Dryer', label: 'Dryer', Icon: Wind },
  { key: 'Smoke detector', label: 'Smoke detector', Icon: ShieldAlert },
  { key: 'First aid kit', label: 'First aid kit', Icon: Heart },
  { key: 'Crib', label: 'Crib', Icon: Baby },
  { key: 'Basic kitchen', label: 'Basic kitchen', Icon: ChefHat },
];

const AMENITIES = AMENITY_CONFIG.map((a) => a.key);

/** Map legacy amenity keys (from DB) to new keys */
const AMENITY_LEGACY_MAP = {
  'מטבח': 'Kitchen',
  'מכונת כביסה': 'Washer',
  'בריכה': 'Pool',
  'חניה': 'Parking',
  'טלוויזיה': 'TV',
  'Dedicated Workspace': 'Workspace',
  'Carbon Monoxide Alarm': 'Smoke detector',
  'First Aid Kit': 'First aid kit',
  'Crib': 'Crib',
  'Cooking basics': 'Basic kitchen',
};

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

function parsePriceFromDescription(desc) {
  if (!desc) return '';
  const m = desc.match(/מחיר\s*ללילה[:\s]*₪?(\d+)/i) || desc.match(/₪(\d+)/);
  return m ? m[1] : '';
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

export default function PropertyCreatorModal({ isOpen, onClose, onSuccess, initialProperty }) {
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

  // Track which property ID was last initialised so background reference changes
  // (e.g. parent re-render after property list refresh) don't re-run the reset
  // and wipe freshly-uploaded photos that haven't been submitted yet.
  const initializedForRef = useRef(null);

  // Stable ID for the editing session — set ONCE when the modal opens for an
  // existing property and never re-read from the live prop.  This prevents any
  // parent re-render (triggered by a background properties-refresh) from
  // silently changing which record gallery-saves and form-submits target.
  const editPropertyIdRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      // Modal closed — clear both session trackers.
      initializedForRef.current = null;
      editPropertyIdRef.current = null;
      return;
    }

    const incomingId = initialProperty?.id != null ? String(initialProperty.id).trim() : '';
    const sessionKey = incomingId || 'new';
    // Only initialise once per open-session (same property ID).
    // This prevents a background properties-list refresh from resetting
    // photoUrls while the user is uploading inside the open modal.
    if (initializedForRef.current === sessionKey) return;
    initializedForRef.current = sessionKey;

    // Pin the property ID for this entire modal session.
    editPropertyIdRef.current = incomingId || null;

    if (initialProperty) {
      setName(initialProperty.name || '');
      setPrice(parsePriceFromDescription(initialProperty.description) || '');
      setMaxGuests(initialProperty.max_guests ?? initialProperty.guests ?? 2);
      setBedrooms(initialProperty.bedrooms ?? 1);
      setBeds(initialProperty.beds ?? 1);
      setBathrooms(initialProperty.bathrooms ?? 1);
      const pics = Array.isArray(initialProperty.pictures) && initialProperty.pictures.length > 0
        ? initialProperty.pictures.filter(Boolean)
        : (initialProperty?.mainImage || initialProperty?.photo_url) ? [initialProperty.mainImage || initialProperty.photo_url] : [];
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

  /** After upload: persist public URLs to backend before updating UI (edit mode only). */
  const handlePhotoUrlsComplete = async (urls) => {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    // Show uploaded images immediately in the UI (optimistic update).
    setPhotoUrls(list);
    // Use the ID captured when the modal opened — never re-read from live prop to
    // avoid targeting the wrong record if the parent re-renders mid-session.
    const pid = editPropertyIdRef.current;
    if (!pid || list.length === 0) {
      // New property or no ID yet — images will be saved on form submit.
      return;
    }
    setIsGallerySaving(true);
    setError(null);
    try {
      const result = await updateProperty(pid, {
        pictures: list,
        images: list,
        photo_url: list[0],
      });

      // Use the updateProperty response directly — it already runs list_manual_rooms
      // after the commit, so it reflects the freshly-saved gallery without a second
      // round-trip that might race against the DB write.
      const saved = result?.property || result;
      const fromServer =
        Array.isArray(saved?.pictures) && saved.pictures.length > 0
          ? saved.pictures.filter(Boolean)
          : saved?.mainImage || saved?.photo_url
            ? [saved.mainImage || saved.photo_url].filter(Boolean)
            : [];

      // Persist to localStorage override immediately so background property-list
      // refreshes (mergePropertyImageOverrides) re-apply the hero image on every card
      // render — even before the user submits the form.
      persistPropertyImageOverrideFromItem({
        id: pid,
        mainImage: list[0],
        photo_url: list[0],
        image_url: list[0],
        pictures: list,
      });

      if (fromServer.length > 0 && fromServer.length >= list.length) {
        // Server confirmed at least as many images as we uploaded — use server data.
        setPhotoUrls(fromServer);
      } else if (fromServer.length > 0) {
        // Server returned fewer images than expected (partial write / race) — merge
        // local list with server result to keep everything visible.
        const merged = [...new Set([...list, ...fromServer])];
        setPhotoUrls(merged);
      }
      // If fromServer is empty the upload succeeded (no error thrown) but the
      // backend didn't echo pictures — keep the optimistic local state (list).
    } catch (e) {
      // Keep the optimistic local state so the image stays visible.
      // The error message tells the user that the save may not have persisted.
      setError(e?.message || 'שמירת תמונות נכשלה — התמונה מוצגת אך ייתכן שלא נשמרה');
    } finally {
      setIsGallerySaving(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = (name || '').trim() || 'Unnamed Property';

    setIsSubmitting(true);
    setError(null);

    try {
      const images = Array.isArray(photoUrls) ? photoUrls : [];
      const selectedAmenities = AMENITIES.filter((a) => amenities[a]);
      const photoUrl = ((images || []).length > 0) ? (images || [])[0] : PLACEHOLDER_IMAGE;

      const amenityList = (selectedAmenities || []).join(', ');
      const descParts = [];
      if (price) descParts.push(`Price per night: $${price}`);
      if (amenityList) descParts.push(`אמצעים: ${amenityList}`);
      const description = descParts.join(' | ') || 'נכס שנוצר ידנית';

      const priceNum = price !== '' && price != null ? Number(price) : null;
      const payload = {
        name: trimmedName || '',
        description: description || '',
        price: priceNum ?? 0,
        photo_url: photoUrl || '',
        images: images || [],
        pictures: images || [],
        amenities: selectedAmenities || [],
        max_guests: Math.max(1, parseInt(maxGuests, 10) || 2),
        bedrooms: Math.max(1, parseInt(bedrooms, 10) || 1),
        beds: Math.max(1, parseInt(beds, 10) || 1),
        bathrooms: Math.max(1, parseInt(bathrooms, 10) || 1),
      };
      // Use the ID pinned at modal-open time so the correct record is always
      // targeted even if the parent re-renders while the modal is open.
      const editId = editPropertyIdRef.current;
      const result = editId
        ? await updateProperty(editId, payload)
        : await createProperty(payload);
      let property = result?.property || result;
      const savedId = property?.id || editId;

      // Extract confirmed pictures from the save response first; fall back to
      // a fresh GET only if the response is missing picture data.
      const responseFromServer =
        Array.isArray(property?.pictures) && property.pictures.length > 0
          ? property.pictures.filter(Boolean)
          : property?.mainImage || property?.photo_url
            ? [property.mainImage || property.photo_url].filter(Boolean)
            : [];

      if (responseFromServer.length > 0) {
        if (images.length > 0) setPhotoUrls(responseFromServer);
        else setPhotoUrls(responseFromServer);
      } else if (savedId) {
        // Response missing pictures — do a single GET to verify persistence.
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
            throw new Error('התמונות נשמרו אך לא אומתו מול השרת — נסה שוב');
          }
          if (fromServer.length > 0) setPhotoUrls(fromServer);
        } catch (refreshErr) {
          if (images.length > 0) throw refreshErr;
          console.warn('[PropertyCreatorModal] getPropertyById after save failed:', refreshErr);
        }
      }

      // Persist confirmed images to localStorage so subsequent background list
      // refreshes don't wipe the hero image from property cards.
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
      setSuccessMessage('הנכס נוצר בהצלחה');
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
      const errMsg = e?.message || 'אירעה שגיאה. נסה שוב.';
      setError(errMsg);
      console.error('[Create Property] Request failed:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="property-creator-modal-panel w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        style={{ fontFamily: "'Heebo', sans-serif", direction: 'rtl', unicodeBidi: 'isolate' }}
      >
        {/* Header — 32px bottom spacing */}
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-xl font-bold text-[#1a1a1a]">
            {initialProperty ? 'עריכת נכס' : 'הקמת נכס חדש'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-[#e5e7eb] bg-white text-[#1a1a1a] hover:bg-[#f5f5f5] hover:border-[#d1d5db] transition-colors"
            aria-label="סגור"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 pt-6 space-y-6">
          {/* Image Gallery */}
          <ImageUploader
            key={initialProperty?.id ?? 'new'}
            variant="airbnb"
            maxFiles={5}
            onUploadComplete={handlePhotoUrlsComplete}
            propertyId={initialProperty?.id ?? null}
            initialUrls={Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : []}
          />

          {/* Form inputs — premium spacing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputWithIcon
              Icon={Home}
              placeholder="שם הנכס"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <InputWithIcon
              Icon={DollarSign}
              placeholder="מחיר ללילה (₪)"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5563]">
                <Users size={14} className="text-[#6b7280]" />
                אורחים
              </label>
              <InputWithIcon
                Icon={Users}
                placeholder="2"
                value={maxGuests}
                onChange={(e) => setMaxGuests(Number(e.target.value) || 2)}
                type="number"
                min={1}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5563]">
                <BedDouble size={14} className="text-[#6b7280]" />
                חדרים
              </label>
              <InputWithIcon
                Icon={BedDouble}
                placeholder="1"
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value) || 1)}
                type="number"
                min={1}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5563]">
                <BedDouble size={14} className="text-[#6b7280]" />
                מיטות
              </label>
              <InputWithIcon
                Icon={BedDouble}
                placeholder="1"
                value={beds}
                onChange={(e) => setBeds(Number(e.target.value) || 1)}
                type="number"
                min={1}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5563]">
                <Bath size={14} className="text-[#6b7280]" />
                אמבטיות
              </label>
              <InputWithIcon
                Icon={Bath}
                placeholder="1"
                value={bathrooms}
                onChange={(e) => setBathrooms(Number(e.target.value) || 1)}
                type="number"
                min={1}
              />
            </div>
          </div>

          {/* Amenities — 60x60px, icon on top, 5 cols desktop / 4 mobile */}
          <div>
            <p className="text-sm font-semibold text-[#1a1a1a] mb-3">אמצעים ואפשרויות</p>
            <div className="grid grid-cols-5 sm:grid-cols-5 max-sm:grid-cols-4 gap-2">
              {AMENITY_CONFIG.map(({ key, label, Icon }) => (
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
              ))}
            </div>
          </div>

          {/* Customer options (optional section) */}
          <div className="p-4 rounded-xl border border-[#e5e7eb] bg-[#fafafa] space-y-2">
            <p className="text-sm font-semibold text-[#1a1a1a]">אפשרויות לקוח</p>
            <div className="space-y-1 text-xs text-[#4b5563]">
              <p><span className="font-medium text-[#1a1a1a]">מדיניות ביטול:</span> גמישה — החזר מלא עד 24 שעות</p>
              <p><span className="font-medium text-[#1a1a1a]">פרטי תשלום:</span> אשראי / העברה / דמי ניקוי</p>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {successMessage && (
            <div className="p-4 rounded-xl bg-emerald-500 text-white font-semibold text-center">
              {successMessage}
            </div>
          )}

          {/* Primary button — 12px radius, slight shadow */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || isGallerySaving}
            className="w-full py-4 rounded-xl font-bold text-white bg-[#0d9488] shadow-[0_2px_8px_rgba(13,148,136,0.3)] hover:bg-[#0f766e] hover:shadow-[0_4px_12px_rgba(13,148,136,0.4)] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="property-loader" aria-hidden />
                {initialProperty ? 'מעדכן...' : 'יוצר...'}
              </span>
            ) : (
              initialProperty ? 'עדכן נכס' : 'צור דף נכס'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
