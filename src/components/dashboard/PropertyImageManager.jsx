import React, { useRef, useState, useCallback } from 'react';
import { UploadCloud, Trash2, Star, Loader2 } from 'lucide-react';
import { updateProperty, uploadImages, getPropertyById } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import {
  buildPropertyGalleryImages,
  buildPropertyImageUpdatePayload,
  removePropertyGalleryUrl,
  setPropertyGalleryCover,
  appendPropertyGalleryUrls,
  normalizePropertyImageUrl,
} from '../../utils/propertyGallery';
import './PropertyImageManager.css';

export default function PropertyImageManager({ property, onPropertyUpdate }) {
  const { refresh } = useProperties();
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const images = buildPropertyGalleryImages(property);
  const coverNorm = images[0] ? normalizePropertyImageUrl(images[0]) : '';

  const persistImages = useCallback(async (list) => {
    if (!property?.id) return null;
    const idStr = String(property.id);
    setBusy(true);
    try {
      const payload = buildPropertyImageUpdatePayload(property, list);
      await updateProperty(idStr, payload);
      await refresh(true, true);
      let saved = null;
      try {
        saved = await getPropertyById(idStr);
      } catch (_) {
        saved = null;
      }
      if (typeof onPropertyUpdate === 'function' && saved) {
        onPropertyUpdate(saved);
      }
      return saved;
    } catch (e) {
      window.alert(e?.message || 'שגיאה בשמירת תמונות');
      return null;
    } finally {
      setBusy(false);
    }
  }, [property, refresh, onPropertyUpdate]);

  const handleSetCover = async (url) => {
    const { after } = setPropertyGalleryCover(property, url);
    await persistImages(after);
  };

  const handleDelete = async (url) => {
    if (!window.confirm('למחוק תמונה זו מהגלריה?')) return;
    const { after } = removePropertyGalleryUrl(property, url);
    await persistImages(after);
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type?.startsWith('image/'));
    e.target.value = '';
    if (!files.length || !property?.id) return;
    setBusy(true);
    try {
      const result = await uploadImages(files, property.id);
      const serverUrls = Array.isArray(result?.urls) ? result.urls.filter(Boolean) : [];
      if (!serverUrls.length) {
        window.alert('העלאה נכשלה');
        return;
      }
      const merged = appendPropertyGalleryUrls(property, serverUrls);
      await persistImages(merged);
    } catch (err) {
      window.alert(err?.message || 'שגיאה בהעלאת תמונות');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="property-image-manager mb-8" aria-labelledby="property-image-manager-heading">
      <h3 id="property-image-manager-heading" className="font-bold text-gray-900 mb-3">
        ניהול תמונות
      </h3>

      {images.length > 0 ? (
        <div className="property-image-manager-grid">
          {images.map((url, idx) => {
            const isCover = normalizePropertyImageUrl(url) === coverNorm;
            return (
              <div
                key={`${normalizePropertyImageUrl(url)}-${idx}`}
                className={`property-image-manager-tile${isCover ? ' property-image-manager-tile--cover' : ''}`}
              >
                <img src={url} alt="" className="property-image-manager-img" loading="lazy" />
                {isCover && (
                  <span className="property-image-manager-cover-badge">
                    <Star size={12} fill="currentColor" />
                    שער
                  </span>
                )}
                <div className="property-image-manager-actions">
                  {!isCover && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSetCover(url)}
                      className="property-image-manager-btn property-image-manager-btn--cover"
                    >
                      הגדר כשער
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(url)}
                    className="property-image-manager-btn property-image-manager-btn--delete"
                    title="מחק תמונה"
                    aria-label="מחק תמונה"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-4 py-6 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
          אין תמונות שמורות. העלה תמונות לנכס.
        </p>
      )}

      <label className={`property-image-manager-upload${busy ? ' property-image-manager-upload--busy' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={handleFileSelect}
        />
        {busy ? (
          <Loader2 size={22} className="animate-spin text-amber-600" />
        ) : (
          <>
            <UploadCloud size={22} className="text-amber-600" />
            <span className="font-bold text-gray-800">הוסף תמונות</span>
            <span className="text-xs text-gray-500">PNG, JPG, WebP</span>
          </>
        )}
      </label>
    </section>
  );
}
