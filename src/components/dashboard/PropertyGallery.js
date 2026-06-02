import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { resolvePropertyCardImage } from '../../utils/propertyCardImages';
import './PropertyGallery.css';

const PLACEHOLDER = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

/**
 * PropertyGallery — clean, modern photo gallery for properties.
 * Displays all pictures from the pictures array in a responsive scrollable grid.
 * Supports lightbox on click.
 */
export default function PropertyGallery({ property, className = '' }) {
  const pictures = (property?.pictures && Array.isArray(property.pictures))
    ? property.pictures.filter(Boolean)
    : [];
  const mainImage =
    property?.mainImage
    || property?.photo_url
    || property?.image_url
    || pictures[0]
    || resolvePropertyCardImage(property)
    || PLACEHOLDER;
  const allImages = pictures.length > 0 ? pictures : (mainImage ? [mainImage] : []);

  const [lightboxIndex, setLightboxIndex] = useState(null);

  if (allImages.length === 0) return null;

  const openLightbox = (idx) => setLightboxIndex(idx);
  const closeLightbox = () => setLightboxIndex(null);
  const goPrev = () => setLightboxIndex((i) => (i <= 0 ? allImages.length - 1 : i - 1));
  const goNext = () => setLightboxIndex((i) => (i >= allImages.length - 1 ? 0 : i + 1));

  return (
    <div className={`property-gallery ${className}`.trim()} dir="rtl">
      <div className="property-gallery-grid property-gallery-grid--full">
        {allImages.map((src, idx) => (
          <button
            key={idx}
            type="button"
            className="property-gallery-thumb"
            onClick={() => openLightbox(idx)}
            aria-label={`תמונה ${idx + 1}`}
          >
            <img src={src} alt={`${property?.name || 'נכס'} - תמונה ${idx + 1}`} loading="lazy" />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <div
          className="property-gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="גלריית תמונות"
          onClick={closeLightbox}
        >
          <button
            type="button"
            className="property-gallery-lightbox-close"
            onClick={closeLightbox}
            aria-label="סגור"
          >
            <X size={24} />
          </button>
          <button
            type="button"
            className="property-gallery-lightbox-prev"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label="הקודם"
          >
            <ChevronRight size={28} />
          </button>
          <div className="property-gallery-lightbox-img-wrap" onClick={(e) => e.stopPropagation()}>
            <img
              src={allImages[lightboxIndex]}
              alt={`${property?.name || 'נכס'} - תמונה ${lightboxIndex + 1}`}
            />
          </div>
          <button
            type="button"
            className="property-gallery-lightbox-next"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label="הבא"
          >
            <ChevronLeft size={28} />
          </button>
        </div>
      )}
    </div>
  );
}
