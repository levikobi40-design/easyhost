import React, { useState, useCallback, useEffect } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { uploadImages } from '../../services/api';

const ImageUploader = ({ onUploadComplete, maxFiles = 10, initialUrls = [], propertyId = null, variant = 'default' }) => {
  const [previewUrls, setPreviewUrls] = useState([]);
  const [uploadedUrls, setUploadedUrls] = useState(Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : []);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  // Serialise initialUrls content so the effect only re-runs when the list
  // actually changes, not on every parent render that creates a new array ref.
  const initialUrlsKey = JSON.stringify(
    Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : [],
  );
  useEffect(() => {
    const next = Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : [];
    setUploadedUrls((prev) => {
      // Never reduce the displayed image count from a parent-driven sync.
      // If the parent passes fewer URLs than what we already show (e.g. because
      // it re-rendered with stale backend data while an upload is in flight),
      // keep the current list so freshly-uploaded images don't disappear.
      if (next.length === 0) return prev;
      if (next.length < prev.length) {
        // Merge: keep everything that was already showing plus what the parent has.
        const merged = [...new Set([...prev, ...next])];
        return merged;
      }
      return next;
    });
    // initialUrls is intentionally tracked via initialUrlsKey (content equality),
    // not by reference, to prevent spurious resets on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, initialUrlsKey]);

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
        const result = await uploadImages(list, propertyId);
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
    [maxFiles, uploadedUrls, onUploadComplete, propertyId]
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
  const isAirbnb = variant === 'airbnb';

  const removeByIndex = (idx) => {
    if (idx < previewUrls.length) {
      URL.revokeObjectURL(previewUrls[idx]);
      setPreviewUrls((prev) => prev.filter((_, i) => i !== idx));
    } else {
      const uploadIdx = idx - previewUrls.length;
      const next = uploadedUrls.filter((_, i) => i !== uploadIdx);
      setUploadedUrls(next);
      typeof onUploadComplete === 'function' && onUploadComplete(next);
    }
  };

  if (isAirbnb) {
    return (
      <div className="image-uploader-airbnb mb-6">
        {allPreviews.length > 0 ? (
          <div className="image-uploader-mosaic">
            <div className="image-uploader-hero">
              <img src={allPreviews[0]} alt="Main" className="image-uploader-hero-img" />
              <button
                type="button"
                onClick={() => removeByIndex(0)}
                className="image-uploader-remove"
                aria-label="הסר"
              >
                <X size={16} />
              </button>
            </div>
            <div className="image-uploader-thumbs">
              {allPreviews.slice(1, 5).map((url, i) => (
                <div key={i} className="image-uploader-thumb-wrap">
                  <img src={url} alt="" className="image-uploader-thumb-img" />
                  <button
                    type="button"
                    onClick={() => removeByIndex(i + 1)}
                    className="image-uploader-remove image-uploader-remove-thumb"
                    aria-label="הסר"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {allPreviews.length < maxFiles && (
                <label
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="image-uploader-add-more"
                >
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleInputChange}
                    className="hidden"
                    disabled={isUploading}
                  />
                  {isUploading ? (
                    <span className="text-xs text-[#6b7280]">...</span>
                  ) : (
                    <>
                      <UploadCloud size={20} className="text-[#6b7280]" />
                      <span className="text-[10px] font-medium text-[#6b7280]">הוסף תמונות</span>
                    </>
                  )}
                </label>
              )}
            </div>
          </div>
        ) : (
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="image-uploader-airbnb-zone"
          >
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleInputChange}
              className="hidden"
              disabled={isUploading}
            />
            {isUploading ? (
              <span className="image-uploader-airbnb-text">מעלה...</span>
            ) : (
              <>
                <UploadCloud size={24} className="image-uploader-airbnb-icon text-[#6b7280]" />
                <span className="image-uploader-airbnb-add-btn">הוסף תמונות</span>
                <span className="image-uploader-airbnb-hint text-xs text-[#9ca3af]">גרור או לחץ לבחירה</span>
              </>
            )}
          </label>
        )}
        {error && <p className="image-uploader-airbnb-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mb-8">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={`image-uploader-zone block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 group flex flex-col items-center justify-center min-h-[180px] ${
          isUploading
            ? 'border-emerald-500/50 bg-slate-800/80 opacity-80 pointer-events-none'
            : 'border-slate-600 bg-slate-900/60 hover:border-emerald-500/60 hover:bg-slate-800/50'
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
        <div className="w-14 h-14 rounded-xl bg-slate-800/80 border border-slate-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform duration-200">
          {isUploading ? (
            <span className="text-xl text-emerald-400 animate-pulse">Uploading…</span>
          ) : (
            <UploadCloud size={28} className="text-emerald-400/90" />
          )}
        </div>
        <p className="text-slate-200 font-semibold text-base">
          {isUploading ? 'Uploading…' : 'Drag & drop or click to select'}
        </p>
        <p className="text-sm text-slate-500 mt-1">PNG, JPG, WebP up to 10MB</p>
      </label>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {allPreviews.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-6">
          {previewUrls.map((url, i) => (
            <div key={`preview-${i}`} className="relative h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 group">
              <img src={url} alt="Preview" className="w-full h-full object-cover" />
              {!isUploading && (
                <button
                  type="button"
                  onClick={() => removePreview(i)}
                  className="absolute top-1 right-1 bg-slate-900/80 text-slate-300 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {uploadedUrls.map((url, i) => (
            <div key={`uploaded-${i}`} className="relative h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 group">
              <img src={url} alt="Uploaded" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeUploaded(i)}
                className="absolute top-1 right-1 bg-slate-900/80 text-slate-300 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 hover:text-white"
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
