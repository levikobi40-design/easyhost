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
  const [previewUrls, setPreviewUrls] = useState([]);
  const [uploadedUrls, setUploadedUrls] = useState(Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : []);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  // Ref tracks the live uploadedUrls so handleFileSelect never needs it as a
  // useCallback dep — prevents input re-mount (iOS file-picker reset) on each upload.
  const uploadedUrlsRef = useRef(uploadedUrls);
  useEffect(() => { uploadedUrlsRef.current = uploadedUrls; }, [uploadedUrls]);

  // Serialise initialUrls content so the effect only re-runs when the list
  // actually changes, not on every parent render that creates a new array ref.
  const initialUrlsKey = JSON.stringify(
    Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : [],
  );
  useEffect(() => {
    const next = Array.isArray(initialUrls) ? initialUrls.filter(Boolean) : [];
    setUploadedUrls((prev) => {
      // Never reduce the displayed image count from a parent-driven sync.
      if (next.length === 0) return prev;
      if (next.length < prev.length) {
        const merged = [...new Set([...prev, ...next])];
        return merged;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, initialUrlsKey]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
      });
    };
  }, [previewUrls]);

  const handleFileSelect = useCallback(
    async (files) => {
      const list = Array.from(files || [])
        .filter((f) => f.type?.startsWith('image/'))
        .slice(0, maxFiles - uploadedUrlsRef.current.length);
      if (list.length === 0) return;

      const localPreviews = list.map((f) => URL.createObjectURL(f));
      setPreviewUrls((prev) => [...prev, ...localPreviews]);
      setError(null);
      setIsUploading(true);

      try {
        // ── Attempt server upload ────────────────────────────────────────────
        const result = await uploadImages(list, propertyId);
        const urls = Array.isArray(result?.urls) ? result.urls : [];

        // FIX: compute `next` from the ref (stable, no deps) — never inside a
        // setState updater (updater runs async in React 18; accessing `next`
        // outside would give undefined and wipe the parent's photoUrls state).
        const next = [...urls, ...uploadedUrlsRef.current];
        setUploadedUrls(next);
        typeof onUploadComplete === 'function' && onUploadComplete(next);
        setPreviewUrls([]);
      } catch (serverErr) {
        // ── Base64 fallback — keeps images visible when server upload fails
        //    (network timeout on mobile, cold-start Railway delay, 401, etc.)
        console.warn('[ImageUploader] server upload failed, falling back to base64:', serverErr?.message);
        try {
          const dataUris = await Promise.all(list.map(fileToDataUri));
          const next = [...dataUris, ...uploadedUrlsRef.current];
          setUploadedUrls(next);
          typeof onUploadComplete === 'function' && onUploadComplete(next);
          setPreviewUrls([]);
          // Show a soft warning — upload worked locally, will store as data URI
          setError('תמונה נשמרה זמנית (מצב לא מקוון). תועלה לשרת בשמירה.');
        } catch (b64Err) {
          setError(serverErr?.message || 'שגיאה בהעלאת תמונות');
          // Don't wipe preview — keep the blob URL visible so user sees their choice
        }
      } finally {
        setIsUploading(false);
      }
    },
    // uploadedUrls intentionally NOT in deps — use uploadedUrlsRef to avoid
    // re-creating this callback (and re-mounting the <input>) on every upload.
    [maxFiles, onUploadComplete, propertyId],
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
