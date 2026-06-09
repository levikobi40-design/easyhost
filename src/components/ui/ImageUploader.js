import React, { useState, useCallback, useEffect, useRef } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { uploadImages } from '../../services/api';

/** Read a File as a base64 data-URI (used as mobile fallback when server upload fails). */
function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ImageUploader = ({ onUploadComplete, maxFiles = 10, initialUrls = [], propertyId = null, variant = 'default' }) => {
  // Single source of truth: all displayed images (both local data-URIs and
  // confirmed server URLs) live here. No separate previewUrls state.
  const [uploadedUrls, setUploadedUrls] = useState(Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : []);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  // Ref tracks the live list without adding it to useCallback deps —
  // prevents handleFileSelect from being recreated on every upload
  // (which would cause the <input> to re-mount and reset on iOS).
  const uploadedUrlsRef = useRef(uploadedUrls);
  useEffect(() => { uploadedUrlsRef.current = uploadedUrls; }, [uploadedUrls]);

  // Serialise initialUrls content so the sync effect only re-runs when the
  // actual list changes, not when the parent creates a new array reference.
  const initialUrlsKey = (Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : []).join('||');
  useEffect(() => {
    const next = Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : [];
    setUploadedUrls((prev) => {
      if (next.length === 0) return prev;            // never wipe on empty sync
      if (next.length < prev.length) {
        return [...new Set([...prev, ...next])];     // merge, keep local extras
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, initialUrlsKey]);

  const handleFileSelect = useCallback(
    async (files) => {
      const list = Array.from(files || [])
        .filter((f) => f.type?.startsWith('image/'))
        .slice(0, maxFiles - uploadedUrlsRef.current.length);
      if (list.length === 0) return;

      setError(null);
      setIsUploading(true);

      // ── STEP 1: Convert to base64 data URIs immediately ─────────────────
      // We intentionally avoid URL.createObjectURL here. On iOS Safari, blob
      // URLs are invalidated when the app returns from the photo-picker
      // background transition — the image flashes and disappears ~1 second
      // after selection. Data URIs live entirely in memory and survive any
      // app-lifecycle event, keeping the preview stable indefinitely.
      let dataUris;
      try {
        dataUris = await Promise.all(list.map(fileToDataUri));
      } catch (readErr) {
        console.error('[ImageUploader] FileReader failed:', readErr);
        setError('שגיאה בקריאת הקובץ — נסה שוב');
        setIsUploading(false);
        return;
      }

      // Show the data-URI preview right away — persistent on iOS.
      const withDataUris = [...dataUris, ...uploadedUrlsRef.current];
      setUploadedUrls(withDataUris);
      typeof onUploadComplete === 'function' && onUploadComplete(withDataUris);

      // ── STEP 2: Try to upgrade to a server URL silently ─────────────────
      // The property form already has the data URI; the upload just improves
      // storage efficiency. A failure here is non-fatal.
      try {
        const result = await uploadImages(list, propertyId);
        const serverUrls = Array.isArray(result?.urls) ? result.urls.filter(Boolean) : [];
        if (serverUrls.length > 0) {
          // Replace data-URI placeholders with the confirmed server URLs.
          const upgraded = [
            ...serverUrls,
            ...uploadedUrlsRef.current.filter((u) => !dataUris.includes(u)),
          ];
          setUploadedUrls(upgraded);
          typeof onUploadComplete === 'function' && onUploadComplete(upgraded);
        }
      } catch (serverErr) {
        // Silent fallback — data URI is already stored, property can still be saved.
        console.warn('[ImageUploader] server upload failed, keeping data URI:', serverErr?.message);
        setError('תמונה נשמרה זמנית (ללא חיבור לשרת). תישמר מלאה עם שמירת הנכס.');
      } finally {
        setIsUploading(false);
      }
    },
    [maxFiles, onUploadComplete, propertyId],
  );

  const handleInputChange = useCallback((e) => {
    // Copy files before resetting the input so the FileList reference stays
    // valid throughout the async handleFileSelect execution on iOS.
    const filesCopy = e.target.files;
    handleFileSelect(filesCopy);
    // Reset input value after handing off files so the same file can be
    // re-selected without triggering a no-change event.
    try { e.target.value = ''; } catch (_) { /* read-only in some browsers */ }
  }, [handleFileSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer?.files);
  }, [handleFileSelect]);

  const handleDragOver = (e) => { e.preventDefault(); };

  const removeUploaded = useCallback((index) => {
    const next = uploadedUrlsRef.current.filter((_, i) => i !== index);
    setUploadedUrls(next);
    typeof onUploadComplete === 'function' && onUploadComplete(next);
  }, [onUploadComplete]);

  // All images — now a single list (no separate blob-URL previews).
  const allPreviews = uploadedUrls;
  const isAirbnb = variant === 'airbnb';

  const removeByIndex = useCallback((idx) => {
    const next = uploadedUrlsRef.current.filter((_, i) => i !== idx);
    setUploadedUrls(next);
    typeof onUploadComplete === 'function' && onUploadComplete(next);
  }, [onUploadComplete]);

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
          {allPreviews.map((url, i) => (
            <div key={`img-${i}`} className="relative h-24 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 group">
              <img src={url} alt="Preview" className="w-full h-full object-cover" />
              {!isUploading && (
                <button
                  type="button"
                  onClick={() => removeByIndex(i)}
                  className="absolute top-1 right-1 bg-slate-900/80 text-slate-300 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageUploader;
