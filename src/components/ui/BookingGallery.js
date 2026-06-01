import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { API_BASE_URL } from '../../utils/constants';

const SmartImage = ({ src, alt, className, isMain = false }) => {
  const [hasError, setHasError] = useState(false);
  const fullSrc = src.startsWith('http') ? src : `${API_BASE_URL}${src}`;

  if (hasError) {
    return (
      <div className={`bg-gray-100 flex flex-col items-center justify-center text-gray-900 ${className}`}>
        <ImageOff size={isMain ? 48 : 24} className="mb-2 text-gray-900" />
        <span className="text-[10px] font-bold uppercase text-gray-900">אין תמונה</span>
      </div>
    );
  }

  return (
    <img
      src={fullSrc}
      alt={alt}
      onError={() => setHasError(true)}
      className={`${className} transition-transform duration-500 hover:scale-105`}
    />
  );
};

const PlaceholderSlot = ({ isMain }) => (
  <div className={`bg-gray-100 flex flex-col items-center justify-center text-gray-900 w-full h-full ${isMain ? 'min-h-[450px]' : ''}`}>
    <ImageOff size={isMain ? 48 : 24} className="mb-2 text-gray-900" />
    <span className="text-[10px] font-bold uppercase text-gray-900">אין תמונה</span>
  </div>
);

const BookingGallery = ({ images = [] }) => {
  const displayImages = [...images, null, null, null, null, null].slice(0, 5);

  return (
    <div className="grid grid-cols-4 grid-rows-2 gap-3 h-[450px] rounded-[40px] overflow-hidden shadow-xl border border-white">
      <div className="col-span-2 row-span-2 relative overflow-hidden bg-gray-200">
        {displayImages[0] ? (
          <SmartImage src={displayImages[0]} alt="Main Property View" className="w-full h-full object-cover" isMain={true} />
        ) : (
          <PlaceholderSlot isMain={true} />
        )}
      </div>

      {displayImages.slice(1).map((img, index) => (
        <div key={index} className="col-span-1 row-span-1 relative overflow-hidden bg-gray-100">
          {img ? (
            <SmartImage src={img} alt={`View ${index + 1}`} className="w-full h-full object-cover" />
          ) : (
            <PlaceholderSlot isMain={false} />
          )}
          {index === 3 && images.length > 5 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer hover:bg-black/60 transition-colors">
              <span className="text-white font-black text-lg">+{images.length - 5} תמונות</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default BookingGallery;
