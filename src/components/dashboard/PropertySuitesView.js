import React, { useMemo } from 'react';

function parsePrice(description) {
  if (!description) return '—';
  const m = description.match(/מחיר\s*ללילה[:\s]*₪?(\d+)/i) || description.match(/₪(\d+)/);
  return m ? m[1] : '—';
}

function PropertySuitesView({ suites, onAddSuite }) {
  const list = useMemo(() => (Array.isArray(suites) ? suites : []), [suites]);
  return (
    <div className="bg-white rounded-[40px] p-8 shadow-sm border border-gray-100" dir="rtl">
      <h3 className="text-2xl font-black text-gray-900 mb-6">סוגי חדרים ומחירים</h3>

      <div className="space-y-4">
        {list.length > 0 ? (
          list.map((suite) => (
            <div
              key={suite.id}
              className="flex items-center justify-between p-6 border border-gray-100 rounded-[24px] hover:bg-gray-50 transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 bg-yellow-100 rounded-2xl flex items-center justify-center text-xl shrink-0">
                  🏨
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="property-suite-title font-black text-gray-900 group-hover:text-yellow-600 transition-colors">
                    {suite.name}
                  </h4>
                  <p className="text-xs text-gray-500">
                    {suite.bedrooms ?? suite.rooms ?? 1} חדרים • עד {suite.guests ?? suite.max_guests ?? 2} אורחים
                    {suite.beds != null && suite.beds > 0 ? ` • ${suite.beds} מיטות` : ''}
                    {suite.bathrooms != null && suite.bathrooms > 0 ? ` • ${suite.bathrooms} אמבטיות` : ''}
                  </p>
                </div>
              </div>

              <div className="text-left">
                <span className="text-xl font-black text-gray-900">${suite.price ?? parsePrice(suite.description)}</span>
                <p className="text-[10px] text-gray-400 font-bold uppercase">/ night</p>
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-gray-400">אין סוגי חדרים כרגע</div>
        )}
      </div>

      <button
        type="button"
        onClick={() => typeof onAddSuite === 'function' && onAddSuite()}
        className="w-full mt-8 py-4 rounded-2xl font-extrabold text-base text-white bg-gradient-to-l from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30 border-2 border-white/20 hover:from-blue-500 hover:to-indigo-500 hover:shadow-xl hover:-translate-y-0.5 transition-all"
      >
        + הוסף סוג חדר נוסף
      </button>
    </div>
  );
}

export default React.memo(PropertySuitesView);
