import React, { useState, useEffect, Component } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getRevenueTrend } from '../../services/api';
import useCurrency from '../../hooks/useCurrency';
import { formatHebrewDate } from '../../utils/hebrewFormat';

const fallbackFormat = (n, opts = {}) => {
  if (n == null || isNaN(n)) return '—';
  const { compact = false } = opts;
  const num = Number(n);
  if (compact && Math.abs(num) >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

// ── Error boundary so a recharts crash never breaks the whole dashboard ──────
class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          הגרף אינו זמין
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Custom Tooltip for the Area chart ────────────────────────────────────────
const RevenueTooltip = ({ active, payload, label }) => {
  const currency = useCurrency();
  const fmt = currency?.format || fallbackFormat;
  if (!active || !payload || !payload.length) return null;
  const val = payload[0]?.value ?? 0;
  const dateStr = payload[0]?.payload?.date;
  const displayLabel = dateStr
    ? formatHebrewDate(dateStr, { includeTime: false })
    : (label || '');
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '8px 14px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      }}
    >
      <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{displayLabel}</p>
      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700, color: '#0ea5e9' }}>
        {fmt(val)}
      </p>
    </div>
  );
};

// ── Custom Tooltip for the Bar chart ─────────────────────────────────────────
const OccupancyTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const booked = payload.find((p) => p.dataKey === 'booked')?.value ?? 0;
  const avail  = payload.find((p) => p.dataKey === 'available')?.value ?? 0;
  const total  = booked + avail || 1;
  const pct    = Math.round((booked / total) * 100);
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '8px 14px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      }}
    >
      <p style={{ margin: 0, fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 13, color: '#0ea5e9' }}>
        <span style={{ fontWeight: 700 }}>{booked}</span> לילות מוזמנים ({pct}%)
      </p>
      <p style={{ margin: '1px 0 0', fontSize: 12, color: '#9ca3af' }}>{avail} פנויים</p>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export default function RevenueCharts() {
  const currency = useCurrency();
  const fmt = currency?.format || fallbackFormat;
  const [trend,    setTrend]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [fetchKey, setFetchKey] = useState(0);   // bump to re-fetch

  // Initial load + re-fetch on Live Simulator / task events
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRevenueTrend().then((data) => {
      if (!cancelled) {
        setTrend(data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchKey]);

  useEffect(() => {
    const bump = () => setFetchKey((k) => k + 1);
    window.addEventListener('maya-refresh-tasks', bump);
    window.addEventListener('simulate-complete',  bump);
    return () => {
      window.removeEventListener('maya-refresh-tasks', bump);
      window.removeEventListener('simulate-complete',  bump);
    };
  }, []);

  const dailyData    = trend?.daily_revenue ?? [];
  const occupancyData = trend?.occupancy     ?? [];
  const totalRevenue  = trend?.total_revenue  ?? 0;

  // Skeleton while loading
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {[0, 1].map((i) => (
          <div key={i} className="glass-card p-6 min-h-[300px] animate-pulse">
            <div className="h-4 bg-slate-600/50 rounded w-1/3 mb-4" />
            <div className="h-48 bg-slate-700/40 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* ── Revenue Area Chart ─────────────────────────────────────────────── */}
      <div className="glass-card p-6">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-base font-bold text-slate-100">הכנסות — 30 ימים אחרונים</h3>
          <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/20 px-3 py-1 rounded-full">
            {fmt(totalRevenue)} סה״כ
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">הכנסה יומית מהזמנות מאושרות</p>

        {dailyData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            אין נתוני הכנסות עדיין
          </div>
        ) : (
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1d4ed8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmt(v, { compact: v >= 1000 })}
                  width={52}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#1d4ed8"
                  strokeWidth={3}
                  fill="url(#revenueGradient)"
                  dot={false}
                  activeDot={{ r: 6, fill: '#1d4ed8', stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={true}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        )}
      </div>

      {/* ── Occupancy Bar Chart ────────────────────────────────────────────── */}
      <div className="glass-card p-6">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-base font-bold text-slate-100">תפוסה לפי נכס</h3>
          <span className="text-xs font-semibold text-blue-400 bg-blue-500/20 px-3 py-1 rounded-full">
            30 ימים
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">לילות מוזמנים מתוך 30 זמינים</p>

        {occupancyData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            אין נתוני תפוסה עדיין
          </div>
        ) : (
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={occupancyData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 30]}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => String(v)}
                />
                <YAxis
                  type="category"
                  dataKey="property"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip content={<OccupancyTooltip />} />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
                      {value === 'booked' ? 'מוזמן' : 'פנוי'}
                    </span>
                  )}
                  iconSize={10}
                  iconType="circle"
                />
                <Bar dataKey="booked"    stackId="occ" fill="#10b981" radius={[0, 0, 0, 0]} isAnimationActive={true} animationDuration={700} animationEasing="ease-out" />
                <Bar dataKey="available" stackId="occ" fill="#e5e7eb" radius={[4, 4, 4, 4]} isAnimationActive={true} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        )}
      </div>
    </div>
  );
}
