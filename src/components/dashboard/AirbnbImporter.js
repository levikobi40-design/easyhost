import React, { useState } from 'react';
import { importProperty } from '../../services/api';
import './AirbnbImporter.css';

const AirbnbImporter = ({ onSuccess }) => {
  const [url, setUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);

  const handleImport = async () => {
    const raw = String(url).trim();
    if (raw.length < 5) return;

    setIsScanning(true);
    setError(null);
    try {
      await importProperty(raw);
      setUrl('');
      if (typeof onSuccess === 'function') onSuccess();
    } catch (e) {
      console.error('Import failed', e);
      setError(e?.message || 'ייבוא נכשל. נסה שוב.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="airbnb-importer relative overflow-hidden bg-white p-8 rounded-[40px] shadow-2xl border border-gray-100">
      <h2 className="text-2xl font-black mb-4">ייבוא נכס בלחיצה אחת</h2>
      <div className="flex gap-4">
        <input
          type="text"
          className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm"
          placeholder="הדבק לינק מ-Airbnb כאן..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()}
          disabled={isScanning}
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={isScanning || url.trim().length < 5}
          className="airbnb-importer-btn bg-yellow-400 hover:bg-yellow-500 text-black font-bold px-8 rounded-2xl transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isScanning ? 'סורק נכס...' : 'ייבוא'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {isScanning && <div className="scanning-laser-effect" aria-hidden />}
    </div>
  );
};

export default AirbnbImporter;
