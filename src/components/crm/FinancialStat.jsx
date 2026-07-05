import React from 'react';
import { TrendingUp } from 'lucide-react';

function FinancialStat({ label, value, trend, icon: Icon }) {
  return (
    <div className="financial-stat bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-gray-50 rounded-2xl text-gray-800">
          <Icon size={20} />
        </div>
        {trend != null && trend !== '' && (
          <span className="text-emerald-500 text-xs font-bold flex items-center gap-1">
            <TrendingUp size={12} /> {trend}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-xs font-medium mb-1">{label}</p>
      <h3 className="text-2xl font-black text-gray-900">{value}</h3>
    </div>
  );
}

export default FinancialStat;
