import React, { useEffect, useRef, useState } from 'react';
import {
  Users, Search, Filter, Plus,
  Mail, Phone, Globe, Calendar, Tag, Star,
  ArrowUpRight, ExternalLink, MessageCircle,
  Target, BarChart3, Activity
} from 'lucide-react';
import FinancialStat from './FinancialStat';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { maya, AGENT_TYPES } from '../../services/agentOrchestrator';
import { getLeads, getAutomationStats, subscribeToLeads, getFinancialSummary } from '../../services/api';
import { whatsappService } from '../../services/whatsapp';
import './LeadsCRM.css';

const sourceIcons = {
  airbnb: '🏠',
  booking: '📅',
  direct: '🎯',
  referral: '👥',
  social: '📱',
};

const LeadsCRM = () => {
  const { t } = useTranslations();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [leads, setLeads] = useState([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);
  const [financials, setFinancials] = useState(null);
  const greetedLeadIdsRef = useRef(new Set());
  const paymentAlertedIdsRef = useRef(new Set());
  const {
    addNotification,
    lang,
    setLeads: setStoreLeads,
    automationStats,
    objectionSuccess,
    setAutomationStats,
    setObjectionSuccess,
    activeTenantId,
    authToken,
  } = useStore();

  const isRTL = lang === 'he';

  const statusOptions = [
    { value: 'all', label: t('leadsCRM.status.all'), color: '#64748b' },
    { value: 'new', label: t('leadsCRM.status.new'), color: '#3b82f6' },
    { value: 'contacted', label: t('leadsCRM.status.contacted'), color: '#f59e0b' },
    { value: 'qualified', label: t('leadsCRM.status.qualified'), color: '#8b5cf6' },
    { value: 'converted', label: t('leadsCRM.status.converted'), color: '#10b981' },
    { value: 'lost', label: t('leadsCRM.status.lost'), color: '#ef4444' },
  ];

  const leadsWithFallback = leads;
  const filteredLeads = leadsWithFallback.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.contact.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const normalizeLead = (lead) => {
    const safeLead = lead || {};
    const fallbackId = safeLead.id || safeLead.lead_id || `${safeLead.email || safeLead.phone || Date.now()}`;
    const name = safeLead.name || safeLead.property_name || safeLead.property || 'Unknown Property';
    const contact = safeLead.contact || safeLead.full_name || safeLead.guest_name || 'Guest';
    return {
      id: fallbackId,
      name,
      contact,
      email: safeLead.email || '',
      phone: safeLead.phone || '',
      source: safeLead.source || 'direct',
      status: safeLead.status || 'new',
      value: safeLead.value || 0,
      rating: safeLead.rating || 0,
      createdAt: safeLead.createdAt || safeLead.created_at || new Date().toISOString(),
      notes: safeLead.notes || '',
      photo: safeLead.photo || `https://api.dicebear.com/7.x/personas/svg?seed=${encodeURIComponent(contact)}&backgroundColor=0b1220&radius=20`,
      property: safeLead.property || name,
    };
  };

  useEffect(() => {
    let isActive = true;
    const loadLeads = async () => {
      setIsLoadingLeads(true);
      try {
        const results = await getLeads(statusFilter === 'all' ? null : statusFilter);
        const normalized = Array.isArray(results) ? results.map(normalizeLead) : [];
        if (isActive) {
          setLeads(normalized);
          setStoreLeads(normalized);
        }
      } catch (error) {
        console.error('Failed to load leads:', error);
      } finally {
        if (isActive) setIsLoadingLeads(false);
      }
    };

    loadLeads();
    return () => {
      isActive = false;
    };
  }, [statusFilter, setStoreLeads, activeTenantId, authToken]);

  useEffect(() => {
    let isActive = true;
    const loadFinancials = async () => {
      try {
        const data = await getFinancialSummary();
        if (isActive) setFinancials(data);
      } catch (e) {
        if (isActive) setFinancials({ avg_ltv: '₪0', conversion_rate: '0%', projected_revenue: '₪0' });
      }
    };
    loadFinancials();
    return () => { isActive = false; };
  }, [activeTenantId, authToken]);

  useEffect(() => {
    let isActive = true;
    const loadAutomationStats = async () => {
      try {
        const statsResponse = await getAutomationStats();
        if (!isActive) return;
        setAutomationStats(statsResponse.automation_stats);
        setObjectionSuccess(statsResponse.objection_success);
      } catch (error) {
        console.error('Failed to load automation stats:', error);
      }
    };

    loadAutomationStats();
    return () => {
      isActive = false;
    };
  }, [setAutomationStats, setObjectionSuccess, activeTenantId, authToken]);

  useEffect(() => {
    const handleNewLead = async (incoming) => {
      const normalized = normalizeLead(incoming);
      setLeads((prev) => {
        const nextLeads = [normalized, ...prev];
        setStoreLeads(nextLeads);
        return nextLeads;
      });

      if (!greetedLeadIdsRef.current.has(normalized.id)) {
        greetedLeadIdsRef.current.add(normalized.id);
        try {
          await whatsappService.sendLeadGreeting(normalized, lang);
          addNotification({
            type: 'success',
            title: t('leadsCRM.actions.sendDemo'),
            message: t('leadsCRM.autoGreetingSent', { name: normalized.contact }),
          });
        } catch (error) {
          console.error('Failed to send greeting:', error);
        }
      }
    };

    const handleLeadUpdated = (incoming) => {
      const normalized = normalizeLead(incoming);
    const hasPaymentLink = Boolean(normalized.payment_link);
    const isPaid = normalized.status === 'paid';
    if ((hasPaymentLink || isPaid) && !paymentAlertedIdsRef.current.has(normalized.id)) {
      paymentAlertedIdsRef.current.add(normalized.id);
      addNotification({
        type: 'warning',
        title: t('notifications.paymentLinkReady', { defaultValue: 'Payment Link Ready' }),
        message: t('notifications.paymentLinkMessage', {
          defaultValue: `${normalized.contact || normalized.name} is ready to finalize payment.`,
        }),
      });
    }
      setLeads((prev) => {
        const nextLeads = prev.map((lead) =>
          lead.id === normalized.id ? { ...lead, ...normalized } : lead
        );
        setStoreLeads(nextLeads);
        return nextLeads;
      });
    };

    const handleAutomationStats = (statsUpdate) => {
      setAutomationStats(statsUpdate);
    };

    const eventSource = subscribeToLeads(
      handleNewLead,
      handleLeadUpdated,
      (error) => {
        console.error('Lead stream error:', error);
      },
      handleAutomationStats
    );

    return () => {
      if (eventSource && eventSource.close) eventSource.close();
    };
  }, [addNotification, lang, setAutomationStats, setStoreLeads, t, activeTenantId, authToken]);

  const handleScanLeads = async () => {
    setIsScanning(true);
    try {
      const result = await maya.executeTask(AGENT_TYPES.SCRAPER, {
        platforms: ['airbnb', 'booking'],
      });
      
      addNotification({
        type: 'success',
        title: t('leadsCRM.scanNew'),
        message: result.message,
      });

      if (result.leads && result.leads.length > 0) {
        result.leads.slice(0, 3).forEach((lead) => {
          addNotification({
            type: 'info',
            title: t('notifications.newLead'),
            messageKey: 'notifications.messages.newLead',
            messageValues: { platform: lead.platform || 'Airbnb' },
            data: lead,
          });
        });
      }
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Error',
        message: 'Lead scan failed',
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleSendDemo = async (lead) => {
    try {
      const result = await maya.executeTask(AGENT_TYPES.SALES, {
        type: 'send_demo',
        lead,
      });
      
      addNotification({
        type: 'success',
        title: t('leadsCRM.actions.sendDemo'),
        message: result.message,
      });
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Error',
        message: 'Demo send failed',
      });
    }
  };

  const getStatusColor = (status) => {
    return statusOptions.find((s) => s.value === status)?.color || '#64748b';
  };

  const getStatusLabel = (status) => {
    return statusOptions.find((s) => s.value === status)?.label || status;
  };

  const objectionMetrics = ['price', 'location', 'rules'].map((key) => {
    const stats = objectionSuccess?.[key] || { yes: 0, no: 0 };
    const total = stats.yes + stats.no;
    const rate = total > 0 ? Math.round((stats.yes / total) * 100) : 0;
    return {
      key,
      label: key === 'price' ? 'Price' : key === 'location' ? 'Location' : 'Rules',
      yes: stats.yes,
      no: stats.no,
      rate,
    };
  });

  return (
    <div className="crm-container" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Financial Stats */}
      <div className="mb-10">
        <h1 className="text-3xl font-black text-gray-900 mb-1">Leads & Revenue</h1>
        <p className="text-gray-500">מעקב אחרי המרה ורווחיות הנכסים שלך.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <FinancialStat
          label="LTV ממוצע"
          value={financials?.avg_ltv ?? '₪0'}
          trend=""
          icon={Users}
        />
        <FinancialStat
          label="יחס המרה"
          value={financials?.conversion_rate ?? '0%'}
          trend=""
          icon={Target}
        />
        <FinancialStat
          label="רווח תפעולי"
          value={financials?.projected_revenue ?? '₪0'}
          trend=""
          icon={BarChart3}
        />
        <FinancialStat
          label="עלות ניקיון ממוצעת"
          value="₪350"
          trend="-2%"
          icon={Activity}
        />
      </div>

      {/* Header */}
      <div className="crm-header">
        <div className="crm-title">
          <Users size={28} />
          <div>
            <h2>{t('leadsCRM.title')}</h2>
            <p>{t('leadsCRM.leadCount', { count: filteredLeads.length })}</p>
          </div>
        </div>
        <button
          onClick={handleScanLeads}
          disabled={isScanning}
          className="btn-primary scan-btn"
        >
          {isScanning ? (
            <>
              <Search size={18} className="animate-spin" />
              {t('common.scanning')}
            </>
          ) : (
            <>
              <Search size={18} />
              {t('leadsCRM.scanNew')}
            </>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="crm-filters glass-card">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('leadsCRM.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="status-filters">
          {statusOptions.map((status) => (
            <button
              key={status.value}
              onClick={() => setStatusFilter(status.value)}
              className={`status-filter-btn ${
                statusFilter === status.value ? 'active' : ''
              }`}
              style={{
                '--status-color': status.color,
              }}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {/* לידים אחרונים מה-Scraper */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden mb-10">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <h4 className="font-bold text-gray-800">לידים אחרונים מה-Scraper</h4>
        </div>
        {isLoadingLeads ? (
          <div className="p-12 text-center text-gray-400">טוען לידים...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right min-w-[500px]">
              <thead>
                <tr className="text-gray-400 text-xs uppercase tracking-wider">
                  <th className="p-6">מקור</th>
                  <th className="p-6">שם הנכס</th>
                  <th className="p-6">סטטוס המרה</th>
                  <th className="p-6">פוטנציאל הכנסה</th>
                  <th className="p-6 w-0" />
                </tr>
              </thead>
              <tbody className="text-sm">
                {filteredLeads.slice(0, 10).map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td className="p-6 font-bold text-blue-600">{lead.source || 'direct'}</td>
                    <td className="p-6 text-gray-800">{lead.name}</td>
                    <td className="p-6">
                      <span
                        className="px-3 py-1 rounded-full text-[10px] font-bold"
                        style={{
                          backgroundColor: `${getStatusColor(lead.status)}20`,
                          color: getStatusColor(lead.status),
                        }}
                      >
                        {getStatusLabel(lead.status).toUpperCase()}
                      </span>
                    </td>
                    <td className="p-6 font-black">₪{Number(lead.value || 0).toLocaleString()}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        className="p-2 text-gray-400 hover:text-blue-600"
                        onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredLeads.length === 0 && (
              <div className="p-12 text-center text-gray-400">אין לידים להצגה</div>
            )}
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="crm-stats">
        <div className="crm-stat glass-card">
          <span className="stat-value text-gradient">
            {leadsWithFallback.filter((l) => l.status === 'new').length}
          </span>
          <span className="stat-label">{t('leadsCRM.stats.newLeads')}</span>
        </div>
        <div className="crm-stat glass-card">
          <span className="stat-value" style={{ color: '#f59e0b' }}>
            {leadsWithFallback.filter((l) => l.status === 'contacted').length}
          </span>
          <span className="stat-label">{t('leadsCRM.stats.inProgress')}</span>
        </div>
        <div className="crm-stat glass-card">
          <span className="stat-value" style={{ color: '#8b5cf6' }}>
            {leadsWithFallback.filter((l) => l.status === 'qualified').length}
          </span>
          <span className="stat-label">{t('leadsCRM.stats.qualified')}</span>
        </div>
        <div className="crm-stat glass-card">
          <span className="stat-value" style={{ color: '#10b981' }}>
            ₪{leadsWithFallback.reduce((sum, l) => sum + l.value, 0).toLocaleString()}
          </span>
          <span className="stat-label">{t('leadsCRM.stats.totalValue')}</span>
        </div>
        <div className="crm-stat glass-card">
          <span className="stat-value" style={{ color: '#38bdf8' }}>
            {automationStats?.automated_messages ?? 0}
          </span>
          <span className="stat-label">AI Messages</span>
        </div>
      </div>

      {/* Success Meter */}
      <div className="success-meter glass-card">
        <div className="success-meter-header">
          <h3>Success Meter</h3>
          <span className="success-meter-subtitle">Objection conversion performance</span>
        </div>
        <div className="success-meter-grid">
          {objectionMetrics.map((metric) => (
            <div key={metric.key} className="success-meter-item">
              <div className="success-meter-label">
                <span>{metric.label}</span>
                <span>{metric.rate}%</span>
              </div>
              <div className="success-meter-bar">
                <span style={{ width: `${metric.rate}%` }} />
              </div>
              <div className="success-meter-meta">
                <span>Yes: {metric.yes}</span>
                <span>No: {metric.no}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leads Grid */}
      <div className="leads-grid">
        {filteredLeads.map((lead) => (
          <div
            key={lead.id}
            className="lead-card glass-card"
            onClick={() => setSelectedLead(lead)}
          >
              <div className="lead-card-header">
                <div
                  className="lead-avatar"
                  style={{ backgroundImage: `url(${lead.photo})` }}
                />
                <div className="lead-header-info">
                  <span className="lead-name">{lead.name}</span>
                  <span className="lead-contact">{lead.contact}</span>
                </div>
                <span
                  className="lead-status"
                  style={{
                    '--status-color': getStatusColor(lead.status),
                    boxShadow: `0 0 16px ${getStatusColor(lead.status)}`,
                  }}
                >
                  {getStatusLabel(lead.status)}
                </span>
              </div>

              <div className="lead-card-body">
                <div className="lead-meta-grid">
                  <div className="lead-meta-item">
                    <span className="meta-label">{t('leadsCRM.table.source')}</span>
                    <span className="meta-value">{sourceIcons[lead.source]} {lead.source}</span>
                  </div>
                  <div className="lead-meta-item">
                    <span className="meta-label">{t('leadsCRM.table.value')}</span>
                    <span className="meta-value">₪{lead.value.toLocaleString()} <span className="per-night">{t('leadsCRM.perNight')}</span></span>
                  </div>
                  <div className="lead-meta-item">
                    <span className="meta-label">{t('leadsCRM.table.rating')}</span>
                    <span className="meta-value rating">
                      <Star size={14} fill="#fbbf24" color="#fbbf24" />
                      {lead.rating}
                    </span>
                  </div>
                </div>
              </div>

              <div className="lead-card-actions">
                <button
                  className="lead-action whatsapp"
                  title="WhatsApp"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MessageCircle size={16} />
                </button>
                <button
                  className="lead-action call"
                  title={t('leadsCRM.actions.call')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone size={16} />
                </button>
              </div>
          </div>
        ))}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <div
          className="lead-modal-backdrop"
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="lead-modal glass-card"
            onClick={(e) => e.stopPropagation()}
          >
              <div className="lead-modal-header">
                <div className="lead-info">
                  <span className="source-icon large">
                    {sourceIcons[selectedLead.source]}
                  </span>
                  <div>
                    <h3>{selectedLead.name}</h3>
                    <p>{selectedLead.contact}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="close-modal-btn"
                >
                  ×
                </button>
              </div>

              <div className="lead-modal-content">
                <div className="lead-details-grid">
                  <div className="detail-item">
                    <Mail size={18} />
                    <div>
                    <span className="label">{t('leadsCRM.modal.email')}</span>
                      <span className="value">{selectedLead.email}</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <Phone size={18} />
                    <div>
                  <span className="label">{t('leadsCRM.modal.phone')}</span>
                      <span className="value">{selectedLead.phone}</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <Globe size={18} />
                    <div>
                  <span className="label">{t('leadsCRM.modal.source')}</span>
                      <span className="value">{selectedLead.source}</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <Calendar size={18} />
                    <div>
                  <span className="label">{t('leadsCRM.modal.createdAt')}</span>
                      <span className="value">
                    {new Date(selectedLead.createdAt).toLocaleDateString(lang === 'he' ? 'he-IL' : lang === 'el' ? 'el-GR' : 'en-US')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="lead-notes">
              <h4>{t('leadsCRM.modal.notes')}</h4>
                  <p>{selectedLead.notes}</p>
                </div>

                <div className="lead-actions">
                  <button
                    onClick={() => handleSendDemo(selectedLead)}
                    className="btn-primary"
                  >
                    <Mail size={18} />
                  {t('leadsCRM.actions.sendDemo')}
                  </button>
                  <button className="btn-secondary">
                    <MessageCircle size={18} />
                  {t('leadsCRM.modal.sendMessage')}
                  </button>
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadsCRM;
