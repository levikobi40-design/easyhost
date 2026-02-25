import React, { useState, useEffect } from 'react';
import { Plus, MapPin, Users, Trash2, Wind, Wifi, Tv, Car, Waves, UtensilsCrossed, Shirt } from 'lucide-react';
import { getProperties, deleteProperty } from '../../services/api';
import { API_URL } from '../../utils/constants';
import PropertyCreatorModal from './PropertyCreatorModal';
import PropertySuitesView from './PropertySuitesView';
import PropertyManagementDashboard from './PropertyManagementDashboard';
import './PropertiesDashboard.css';

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

function parsePriceFromDescription(description) {
  if (!description) return null;
  const m = description.match(/מחיר\s*ללילה[:\s]*₪?(\d+)/i) || description.match(/₪(\d+)/);
  return m ? m[1] : null;
}

function ensureFullImageUrl(url) {
  if (!url || typeof url !== 'string') return PLACEHOLDER_IMAGE;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  let filename = u.startsWith('/') ? u.replace(/^\/+/, '') : u;
  if (filename.startsWith('api/')) return PLACEHOLDER_IMAGE;
  if (filename.startsWith('uploads/')) return `${API_URL}/${filename}`;
  return `${API_URL}/uploads/${filename}`;
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

function mapRoomToProperty(room) {
  const price = parsePriceFromDescription(room.description);
  const isCleaning = ['pending', 'assigned', 'on_my_way', 'in_progress'].includes(room.latest_status || room.status || '');
  const imgUrl = room.image_url || room.photo_url || '';
  return {
    id: room.id != null ? String(room.id) : '',
    name: room.name,
    mainImage: ensureFullImageUrl(imgUrl),
    photo_url: imgUrl,
    status: isCleaning ? 'InProgress' : 'Ready',
    price: price || '—',
    guests: room.max_guests ?? room.guests ?? 2,
    max_guests: room.max_guests ?? 2,
    bedrooms: room.bedrooms ?? 1,
    beds: room.beds ?? 1,
    bathrooms: room.bathrooms ?? 1,
    description: room.description || '',
    amenities: Array.isArray(room.amenities) ? room.amenities : [],
    ai_automation_enabled: Boolean(room.ai_automation_enabled),
  };
}

const PropertyCard = ({ property, onDelete, onEdit, onManage, imageRefreshKey = 0 }) => {
  const cacheBust = property.mainImage && !property.mainImage.includes('unsplash');
  const imgSrc = cacheBust
    ? `${property.mainImage}${property.mainImage.includes('?') ? '&' : '?'}_=${imageRefreshKey}`
    : property.mainImage;

  return (
    <div className="property-card property-card-airbnb group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300">
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={imgSrc}
          alt={property.name}
          className="property-card-img w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-3 right-3">
          <span
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-sm ${
              property.status === 'Ready' ? 'bg-green-500/90 text-white' : 'bg-amber-400/90 text-black'
            }`}
          >
            {property.status === 'Ready' ? 'מוכן' : 'בניקיון'}
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="flex justify-between items-start gap-2 mb-1">
          <h3 className="property-card-title text-base font-bold text-gray-900 flex-1">{property.name}</h3>
          <span className="text-gray-900 font-bold shrink-0">₪{property.price}<span className="text-gray-500 font-normal text-sm"> / לילה</span></span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
          <Users size={12} />
          <span>{property.guests} אורחים</span>
          <MapPin size={12} />
          <span>תל אביב</span>
        </div>
        {property.amenities && property.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {property.amenities.slice(0, 5).map((a) => {
              const Icon = AMENITY_ICONS[a] || Wifi;
              return (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs"
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onManage ? onManage(property) : (onEdit && onEdit(property)); }}
            className="flex-1 bg-gray-900 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors"
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
      </div>
    </div>
  );
};

export default function PropertiesDashboard() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [managedProperty, setManagedProperty] = useState(null);
  const [imageRefreshKey, setImageRefreshKey] = useState(0);

  const openCreateModal = () => {
    setEditingProperty(null);
    setShowPropertyModal(true);
  };

  const openEditModal = (property) => {
    setEditingProperty(property);
    setShowPropertyModal(true);
  };

  const openManageDashboard = (property) => {
    setManagedProperty(property);
  };

  const closeManageDashboard = () => {
    setManagedProperty(null);
    loadProperties();
  };

  const closeModal = () => {
    setShowPropertyModal(false);
    setEditingProperty(null);
  };

  const handleModalSuccess = () => {
    loadProperties();
    closeModal();
  };

  const loadProperties = async () => {
    try {
      const rooms = await getProperties();
      setProperties(Array.isArray(rooms) ? rooms.map(mapRoomToProperty) : []);
      setImageRefreshKey((k) => k + 1);
    } catch (e) {
      setProperties([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('האם למחוק את הנכס?')) return;
    const idStr = id != null ? String(id) : '';
    if (!idStr) return;
    try {
      await deleteProperty(idStr);
      setProperties((prev) => prev.filter((p) => String(p.id) !== idStr));
    } catch (e) {
      window.alert(e?.message || 'שגיאה במחיקה');
    }
  };

  useEffect(() => {
    loadProperties();
  }, []);

  if (managedProperty) {
    return (
      <PropertyManagementDashboard
        property={managedProperty}
        onBack={closeManageDashboard}
        onEdit={(p) => { setManagedProperty(null); setEditingProperty(p); setShowPropertyModal(true); }}
      />
    );
  }

  return (
    <div className="properties-dashboard p-10 bg-[#FBFBFB] min-h-screen" dir="rtl">
      <div className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-black text-gray-900">הנכסים שלי</h1>
          <p className="text-gray-500 mt-1">
            נהל {properties.length} נכסים פעילים עם האוטומציה של מאיה.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="bg-yellow-400 hover:bg-yellow-500 text-black font-black px-8 py-4 rounded-[20px] shadow-lg flex items-center gap-2 transition-transform active:scale-95"
        >
          <Plus size={20} />
          הוסף נכס חדש
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400">טוען נכסים...</div>
      ) : (
        <div className="properties-grid">
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} onDelete={handleDelete} onEdit={openEditModal} onManage={openManageDashboard} imageRefreshKey={imageRefreshKey} />
          ))}
          <div
            role="button"
            tabIndex={0}
            className="property-card-add border-2 border-dashed border-gray-200 rounded-[32px] flex flex-col items-center justify-center p-10 group hover:border-yellow-400 cursor-pointer transition-all"
            onClick={openCreateModal}
            onKeyDown={(e) => e.key === 'Enter' && openCreateModal()}
          >
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 group-hover:bg-yellow-50 transition-colors">
              <Plus className="text-gray-300 group-hover:text-yellow-600" size={32} />
            </div>
            <p className="text-gray-400 font-bold">הוסף נכס נוסף</p>
          </div>
        </div>
      )}

      <div className="mt-12 max-w-2xl">
        <PropertySuitesView
          suites={properties.map((p) => ({
            id: p.id,
            name: p.name,
            rooms: p.bedrooms ?? 1,
            guests: p.guests ?? p.max_guests ?? 2,
            bedrooms: p.bedrooms ?? 1,
            beds: p.beds ?? 1,
            bathrooms: p.bathrooms ?? 1,
            price: p.price,
            description: p.description,
          }))}
          onAddSuite={() => setShowPropertyModal(true)}
        />
      </div>

      <PropertyCreatorModal
        isOpen={showPropertyModal}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        initialProperty={editingProperty}
      />
    </div>
  );
}
