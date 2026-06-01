import React, { useState, useEffect } from 'react';
import { MapPin, Users, Trash2, Wind, Wifi, Tv, Car, Waves, UtensilsCrossed, Shirt, Building2 } from 'lucide-react';
import PropertyGallery from './PropertyGallery';
import { isBazaarJaffaProperty } from '../../data/propertyData';
import {
  ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN,
  ROOMS_WORKSPACE_OFFICE_INTERIOR_LOCAL,
} from '../../utils/propertyCardImages';

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

/** Hardcoded ROOMS / Workspace heroes — rotate by property.id % 3 */
export const ROOMS_WORKSPACE_HERO_URLS = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=600&q=80',
];

/** After local + CDN fail, cycle these Unsplash office heroes before giving up (avoids white boxes). */
const ROOMS_OFFICE_IMAGE_FALLBACK_CHAIN = [
  ROOMS_WORKSPACE_OFFICE_INTERIOR_LOCAL,
  ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN,
  ...ROOMS_WORKSPACE_HERO_URLS,
  PLACEHOLDER_IMAGE,
];

export function pickRoomsOfficeImageByPropertyId(propertyId) {
  const pool = ROOMS_WORKSPACE_HERO_URLS;
  const n = pool.length;
  const raw = propertyId != null ? String(propertyId) : '';
  const asNum = Number(raw);
  if (raw !== '' && Number.isFinite(asNum)) {
    return pool[Math.abs(Math.trunc(asNum)) % n];
  }
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(h) % n];
}

function propertyNameNeedsRoomsOfficeHero(name) {
  const s = `${name || ''}`;
  if (!s.trim()) return false;
  if (/\bROOMS\b/i.test(s)) return true;
  if (/workspace/i.test(s)) return true;
  if (/sky\s*tower/i.test(s) || s.includes('Sky Tower')) return true;
  return /סקיי\s*טאוור/.test(s);
}

const AMENITY_ICONS = {
  AC: Wind,
  'Wi-Fi': Wifi,
  Wifi: Wifi,
  טלוויזיה: Tv,
  TV: Tv,
  חניה: Car,
  בריכה: Waves,
  Pool: Waves,
  מטבח: UtensilsCrossed,
  'מכונת כביסה': Shirt,
  Dryer: Shirt,
  'Dedicated Workspace': Tv,
  'Cooking basics': UtensilsCrossed,
  'Carbon Monoxide Alarm': Users,
  'First Aid Kit': Users,
  Crib: Users,
};

const PropertyCard = React.memo(function PropertyCard({
  property,
  onDelete,
  onEdit,
  onManage,
  onBazaarPolicy,
  imageRefreshKey = 0,
}) {
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const rawMain = propertyNameNeedsRoomsOfficeHero(property.name)
    ? pickRoomsOfficeImageByPropertyId(property.id)
    : property.mainImage || PLACEHOLDER_IMAGE;
  const cacheBust = rawMain && !String(rawMain).includes('unsplash');
  const imgSrc = cacheBust
    ? `${rawMain}${String(rawMain).includes('?') ? '&' : '?'}_=${imageRefreshKey}`
    : rawMain;

  const [heroSrc, setHeroSrc] = useState(imgSrc);
  useEffect(() => {
    setHeroSrc(imgSrc);
    setImgFailed(false);
  }, [imgSrc, property.id]);

  const extraPhotos = property.pictures && property.pictures.length > 1 ? property.pictures.length - 1 : 0;

  return (
    <div className="property-card property-card-airbnb group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300">
      <div className="relative aspect-video overflow-hidden property-card-hero-bg bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400">
        {!imgFailed && (
          <img
            src={heroSrc}
            alt=""
            className="property-card-img absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 z-[1]"
            loading="lazy"
            decoding="async"
            onError={() => {
              if (heroSrc === imgSrc) {
                setHeroSrc(ROOMS_WORKSPACE_OFFICE_INTERIOR_LOCAL);
                return;
              }
              const i = ROOMS_OFFICE_IMAGE_FALLBACK_CHAIN.indexOf(heroSrc);
              if (i >= 0 && i < ROOMS_OFFICE_IMAGE_FALLBACK_CHAIN.length - 1) {
                setHeroSrc(ROOMS_OFFICE_IMAGE_FALLBACK_CHAIN[i + 1]);
              } else {
                setImgFailed(true);
              }
            }}
          />
        )}
        {imgFailed && (
          <div
            className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-300 to-slate-500 text-white"
            aria-hidden
          >
            <Building2 size={52} strokeWidth={1.6} className="opacity-95 drop-shadow-sm" />
            <span className="text-[11px] font-bold uppercase tracking-wide opacity-90">Workspace</span>
          </div>
        )}
        <div className="absolute top-3 right-3 z-[3]">
          <span
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-sm ${
              property.status === 'Ready' ? 'bg-green-500/90 text-white' : 'bg-amber-400/90 text-black'
            }`}
          >
            {property.status === 'Ready' ? 'מוכן' : 'בניקיון'}
          </span>
        </div>
      </div>
      {extraPhotos > 0 && galleryExpanded && (
        <div className="property-card-gallery-wrap px-3 pt-2 border-t border-gray-100 max-h-[min(280px,40vh)] overflow-y-auto">
          <PropertyGallery property={property} />
        </div>
      )}
      {extraPhotos > 0 && !galleryExpanded && (
        <button
          type="button"
          className="w-full text-center text-xs font-semibold text-gray-700 py-2 px-3 bg-gray-50 hover:bg-gray-100 border-t border-gray-100 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setGalleryExpanded(true);
          }}
        >
          הצג {extraPhotos} תמונות נוספות
        </button>
      )}
      {extraPhotos > 0 && galleryExpanded && (
        <button
          type="button"
          className="w-full text-[11px] text-gray-500 py-1.5 border-t border-gray-50 hover:bg-gray-50"
          onClick={(e) => {
            e.stopPropagation();
            setGalleryExpanded(false);
          }}
        >
          הסתר תמונות
        </button>
      )}
      <div className="p-4">
        <div className="flex justify-between items-start gap-2 mb-1">
          <h3 className="property-card-title text-base font-bold text-gray-900 flex-1">{property.name}</h3>
          <span className="text-gray-900 font-bold shrink-0">
            {property.brand === 'WeWork' || property.price === '0' ? (
              <>₪{property.price}<span className="text-gray-500 font-normal text-sm"> · לעדכון</span></>
            ) : (
              <>${property.price}<span className="text-gray-500 font-normal text-sm"> / night</span></>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-3 flex-wrap">
          <Users size={12} />
          <span>{property.guests} אורחים</span>
          <MapPin size={12} />
          <span>{property.city || '—'}</span>
          {property.brand && (
            <span className="text-gray-400">· {property.brand}</span>
          )}
          {property.propertyType && (
            <span className="text-gray-400">· {property.propertyType}</span>
          )}
          {property.occupancy_rate != null && property.occupancy_rate !== '' && (
            <span className="text-rose-600 font-semibold">
              · תפוסה {Math.round(Number(property.occupancy_rate))}%
            </span>
          )}
        </div>
        {property.amenities && property.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {property.amenities.slice(0, 5).map((a) => {
              const Icon = AMENITY_ICONS[a] || Wifi;
              return (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs"
                  style={{ background: '#f7f7f7', color: '#222222' }}
                  title={a}
                >
                  <Icon size={12} />
                  {a}
                </span>
              );
            })}
            {property.amenities.length > 5 && (
              <span className="text-xs text-gray-400">+{property.amenities.length - 5}</span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onManage ? onManage(property) : (onEdit && onEdit(property)); }}
              className="flex-1 min-h-[44px] flex items-center justify-center bg-gray-900 text-white py-3 px-4 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors"
            >
              נהל נכס
            </button>
            <button
              type="button"
              onClick={() => onDelete && onDelete(String(property.id))}
              className="w-10 h-10 flex items-center justify-center bg-red-50 rounded-xl text-red-600 hover:bg-red-100 transition-all shrink-0"
              title="מחק נכס"
            >
              <Trash2 size={16} />
            </button>
          </div>
          {isBazaarJaffaProperty(property) && typeof onBazaarPolicy === 'function' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBazaarPolicy(property);
              }}
              className="w-full py-2 rounded-xl text-xs font-bold border-2 border-amber-300 bg-amber-50/90 text-amber-950 hover:bg-amber-100 transition-colors"
            >
              צפה במדיניות המלון
            </button>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.property?.id === next.property?.id
  && prev.property?.mainImage === next.property?.mainImage
  && prev.property?.status === next.property?.status
  && prev.property?.name === next.property?.name
  && prev.property?.price === next.property?.price
  && prev.property?.occupancy_rate === next.property?.occupancy_rate
  && prev.imageRefreshKey === next.imageRefreshKey
));

export default PropertyCard;
