import React, { useState, useCallback, useEffect } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { uploadImages } from '../../services/api';

const ImageUploader = ({ onUploadComplete, maxFiles = 10, initialUrls = [] }) => {
  const [previewUrls, setPreviewUrls] = useState([]);
  const [uploadedUrls, setUploadedUrls] = useState(Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : []);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const handleFileSelect = useCallback(
    async (files) => {
      const list = Array.from(files || []).filter((f) => f.type?.startsWith('image/')).slice(0, maxFiles - uploadedUrls.length);
      if (list.length === 0) return;

      const localPreviews = list.map((f) => URL.createObjectURL(f));
      setPreviewUrls((prev) => [...prev, ...localPreviews]);
      setError(null);
      setIsUploading(true);

      try {
        const result = await uploadImages(list);
        const urls = Array.isArray(result?.urls) ? result.urls : [];
        let next;
        setUploadedUrls((prev) => {
          const prevArr = Array.isArray(prev) ? prev : [];
          next = [...urls, ...prevArr];
          return next;
        });
        typeof onUploadComplete === 'function' && onUploadComplete(next);
        setPreviewUrls([]);
      } catch (e) {
        setError(e?.message || 'שגיאה בהעלאת תמונות');
        setPreviewUrls((prev) => prev.slice(0, -list.length));
      } finally {
        setIsUploading(false);
      }
    },
    [maxFiles, uploadedUrls, onUploadComplete]
  );

  const handleInputChange = (e) => {
    handleFileSelect(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer?.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const removePreview = (index) => {
    setPreviewUrls((prev) => {
      const next = prev.filter((_, i) => i !== index);
      URL.revokeObjectURL(prev[index]);
      return next;
    });
  };

  const removeUploaded = (index) => {
    const next = uploadedUrls.filter((_, i) => i !== index);
    setUploadedUrls(next);
    typeof onUploadComplete === 'function' && onUploadComplete(next);
  };

  const allPreviews = [...previewUrls, ...uploadedUrls];

  return (
    <div className="mb-8">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={`block border-2 border-dashed rounded-[32px] p-12 text-center cursor-pointer transition-all group flex flex-col items-center justify-center bg-gray-50 ${
          isUploading
            ? 'border-yellow-400 opacity-70 pointer-events-none'
            : 'border-gray-200 hover:border-yellow-400 hover:bg-yellow-50/50'
        }`}
      >
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleInputChange}
          className="hidden"
          disabled={isUploading}
        />
        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          {isUploading ? (
            <span className="text-2xl animate-spin">⏳</span>
          ) : (
            <UploadCloud size={32} className="text-yellow-500" />
          )}
        </div>
        <p className="text-gray-900 font-black text-lg">
          {isUploading ? 'מעלה תמונות...' : 'גרור תמונות לכאן או לחץ לבחירה'}
        </p>
        <p className="text-sm text-gray-500 mt-2">מומלץ להעלות לפחות 5 תמונות איכותיות</p>
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {allPreviews.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-6">
          {previewUrls.map((url, i) => (
            <div key={`preview-${i}`} className="relative h-24 rounded-2xl overflow-hidden shadow-sm group">
              <img src={url} alt="תצוגה מקדימה" className="w-full h-full object-cover" />
              {!isUploading && (
                <button
                  type="button"
                  onClick={() => removePreview(i)}
                  className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {uploadedUrls.map((url, i) => (
            <div key={`uploaded-${i}`} className="relative h-24 rounded-2xl overflow-hidden shadow-sm group">
              <img src={url} alt="תמונה" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeUploaded(i)}
                className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
