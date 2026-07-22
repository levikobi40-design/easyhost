import React, { useState, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import {
  buildPropertyGalleryImages,
} from '../../utils/propertyGallery';
import useTranslations from '../../hooks/useTranslations';
import { isRtlLang } from '../../utils/languages';
import './PropertyGallery.css';

/**
 * PropertyGallery — renders backend pictures only (deduped by URL).
 */
export default function PropertyGallery({ property, className = '' }) {
  const { t, i18n } = useTranslations();
  const dir = isRtlLang(i18n?.language) ? 'rtl' : 'ltr';
  const allImages = useMemo(
    () => buildPropertyGalleryImages(property),
    [property?.id, property?.pictures, property?.images, property?.mainImage, property?.cover_image, property?.photo_url],
  );
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [broken, setBroken] = useState(() => new Set());

  if (!allImages.length) {
    return (
      <div className={`property-gallery property-gallery--empty ${className}`.trim()} dir={dir}>
        <div className="property-gallery-placeholder">
          <ImageOff size={32} />
          <span>{t('propertyGallery.noPhotos')}</span>
        </div>
      </div>
    );
  }

  const visibleImages = allImages.filter((src) => !broken.has(src));

  if (!visibleImages.length) {
    return (
      <div className={`property-gallery property-gallery--empty ${className}`.trim()} dir={dir}>
        <div className="property-gallery-placeholder">
          <ImageOff size={32} />
          <span>{t('propertyGallery.noPhotos')}</span>
        </div>
      </div>
    );
  }

  const openLightbox = (idx) => setLightboxIndex(idx);
  const closeLightbox = () => setLightboxIndex(null);
  const goPrev = () => setLightboxIndex((i) => (i <= 0 ? visibleImages.length - 1 : i - 1));
  const goNext = () => setLightboxIndex((i) => (i >= visibleImages.length - 1 ? 0 : i + 1));

  const markBroken = (src) => {
    setBroken((prev) => {
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  };

  const propertyName = property?.name || t('propertyGallery.propertyFallback');

  return (
    <div className={`property-gallery ${className}`.trim()} dir={dir}>
      <div className="property-gallery-grid property-gallery-grid--full">
        {visibleImages.map((src, idx) => (
          <button
            key={`${src}-${idx}`}
            type="button"
            className="property-gallery-thumb"
            onClick={() => openLightbox(idx)}
            aria-label={t('propertyGallery.imageN', { n: idx + 1 })}
          >
            <img
              src={src}
              alt={t('propertyGallery.imageAlt', { name: propertyName, n: idx + 1 })}
              loading="lazy"
              onError={() => markBroken(src)}
            />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <div
          className="property-gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t('propertyGallery.gallery')}
          onClick={closeLightbox}
        >
          <button
            type="button"
            className="property-gallery-lightbox-close"
            onClick={closeLightbox}
            aria-label={t('propertyGallery.close')}
          >
            <X size={24} />
          </button>
          <button
            type="button"
            className="property-gallery-lightbox-prev"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label={t('propertyGallery.prev')}
          >
            <ChevronRight size={28} />
          </button>
          <div className="property-gallery-lightbox-img-wrap" onClick={(e) => e.stopPropagation()}>
            <img
              src={visibleImages[lightboxIndex]}
              alt={t('propertyGallery.imageAlt', { name: propertyName, n: lightboxIndex + 1 })}
              onError={() => markBroken(visibleImages[lightboxIndex])}
            />
          </div>
          <button
            type="button"
            className="property-gallery-lightbox-next"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label={t('propertyGallery.next')}
          >
            <ChevronLeft size={28} />
          </button>
        </div>
      )}
    </div>
  );
}
