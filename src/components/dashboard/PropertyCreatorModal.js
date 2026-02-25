import React, { useState, useEffect } from 'react';
import { createProperty, updateProperty } from '../../services/api';
import ImageUploader from '../ui/ImageUploader';
import './PropertyCreatorModal.css';

const AMENITIES = [
  'Wi-Fi',
  'מטבח',
  'מכונת כביסה',
  'בריכה',
  'חניה',
  'טלוויזיה',
  'Dedicated Workspace',
  'AC',
  'Dryer',
  'Carbon Monoxide Alarm',
  'First Aid Kit',
  'Crib',
  'Cooking basics',
];

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

function parsePriceFromDescription(desc) {
  if (!desc) return '';
  const m = desc.match(/מחיר\s*ללילה[:\s]*₪?(\d+)/i) || desc.match(/₪(\d+)/);
  return m ? m[1] : '';
}

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
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    if (isOpen && initialProperty) {
      setName(initialProperty.name || '');
      setPrice(parsePriceFromDescription(initialProperty.description) || '');
      setMaxGuests(initialProperty.max_guests ?? initialProperty.guests ?? 2);
      setBedrooms(initialProperty.bedrooms ?? 1);
      setBeds(initialProperty.beds ?? 1);
      setBathrooms(initialProperty.bathrooms ?? 1);
      setPhotoUrls((initialProperty?.mainImage || initialProperty?.photo_url) ? [initialProperty?.mainImage || initialProperty?.photo_url] : []);
      const am = Array.isArray(initialProperty.amenities) ? initialProperty.amenities : [];
      setAmenities(AMENITIES.reduce((acc, a) => ({ ...acc, [a]: am.includes(a) }), {}));
    } else if (isOpen && !initialProperty) {
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
      if (price) descParts.push(`מחיר ללילה: ₪${price}`);
      if (amenityList) descParts.push(`אמצעים: ${amenityList}`);
      const description = descParts.join(' | ') || 'נכס שנוצר ידנית';

      const priceNum = price !== '' && price != null ? Number(price) : null;
      const payload = {
        name: trimmedName || '',
        description: description || '',
        price: priceNum ?? 0,
        photo_url: photoUrl || '',
        images: images || [],
        amenities: selectedAmenities || [],
        max_guests: Math.max(1, parseInt(maxGuests, 10) || 2),
        bedrooms: Math.max(1, parseInt(bedrooms, 10) || 1),
        beds: Math.max(1, parseInt(beds, 10) || 1),
        bathrooms: Math.max(1, parseInt(bathrooms, 10) || 1),
      };
      const result = initialProperty
        ? await updateProperty(initialProperty.id, payload)
        : await createProperty(payload);
      const property = result?.property || result;
      window.alert('SUCCESS!');
      typeof onSuccess === 'function' && onSuccess(property);
      setSuccessMessage('Success');
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
      window.alert(`שגיאה: ${errMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="property-creator-backdrop" onClick={onClose}>
      <div
        className="property-creator-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8 bg-white rounded-[40px] shadow-2xl max-w-2xl mx-auto" dir="rtl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black">
              {initialProperty ? 'עריכת נכס' : 'הקמת נכס חדש ב-10 שניות'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl"
            >
              ×
            </button>
          </div>

          <ImageUploader
            key={initialProperty?.id ?? 'new'}
            maxFiles={5}
            onUploadComplete={setPhotoUrls}
            initialUrls={(initialProperty?.mainImage || initialProperty?.photo_url) ? [initialProperty?.mainImage || initialProperty?.photo_url] : []}
          />

          {/* הזנת נתונים בסיסיים */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
              className="p-4 rounded-2xl border border-gray-200 property-creator-input"
              placeholder="שם הנכס (למשל: סוויטה על הים)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="number"
              style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
              className="p-4 rounded-2xl border border-gray-200 property-creator-input"
              placeholder="מחיר ללילה (₪)"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-4 gap-3 mb-8">
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">אורחים</label>
              <input
                type="number"
                min={1}
                style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
                className="p-3 rounded-2xl border border-gray-200 property-creator-input w-full"
                value={maxGuests}
                onChange={(e) => setMaxGuests(Number(e.target.value) || 2)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">חדרים</label>
              <input
                type="number"
                min={1}
                style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
                className="p-3 rounded-2xl border border-gray-200 property-creator-input w-full"
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">מיטות</label>
              <input
                type="number"
                min={1}
                style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
                className="p-3 rounded-2xl border border-gray-200 property-creator-input w-full"
                value={beds}
                onChange={(e) => setBeds(Number(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">אמבטיות</label>
              <input
                type="number"
                min={1}
                style={{ color: '#000000', backgroundColor: '#FFFFFF' }}
                className="p-3 rounded-2xl border border-gray-200 property-creator-input w-full"
                value={bathrooms}
                onChange={(e) => setBathrooms(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          {/* רשימת צ'קבוקסים */}
          <div className="mb-8">
            <p className="font-bold mb-4 text-sm text-gray-900">מה יש בנכס?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {AMENITIES.map((item) => (
                <label
                  key={item}
                  className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-colors ${
                    amenities[item] ? 'bg-yellow-100' : 'bg-gray-50 hover:bg-yellow-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-yellow-400"
                    checked={!!amenities[item]}
                    onChange={() => toggleAmenity(item)}
                  />
                  <span className="text-xs font-bold text-gray-900">{item}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          {successMessage && (
            <div className="mb-4 p-4 rounded-2xl bg-green-500 text-white font-bold text-center text-lg">
              {successMessage}
            </div>
          )}

          {/* כפתור הפעלה */}
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black py-5 rounded-2xl shadow-lg transition-transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? (initialProperty ? 'מעדכן...' : 'יוצר...')
              : (initialProperty ? 'עדכן נכס' : 'צור דף נכס והפעל אוטומציה')}
          </button>
        </div>
      </div>
    </div>
  );
}
