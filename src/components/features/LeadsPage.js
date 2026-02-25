import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Phone, Mail, Calendar, UserCheck, Clock, Filter, RefreshCw, Wifi, WifiOff, TrendingUp, PlusCircle } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import Card from '../ui/Card';
import Button from '../ui/Button';
import LeadDetailsModal from './LeadDetailsModal';
import { getLeads, getLeadsStats, updateLead, subscribeToLeads, getHealth, createLead } from '../../services/api';
import useStore from '../../store/useStore';
import './LeadsPage.css';

/**
 * Leads page component with table and real-time updates
 */
const LeadsPage = () => {
  const { t: translate, i18n } = useTranslations();
  const { activeTenantId, authToken } = useStore();
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [serverOnline, setServerOnline] = useState(null);

  const eventSourceRef = useRef(null);
  const healthCheckRef = useRef(null);

  // Status options for filter
  const statusOptions = [
    { value: null, label: translate('leadsPage.status.all') },
    { value: 'new', label: translate('leadsPage.status.new') },
    { value: 'contacted', label: translate('leadsPage.status.contacted') },
    { value: 'qualified', label: translate('leadsPage.status.qualified') },
    { value: 'won', label: translate('leadsPage.status.won') },
    { value: 'lost', label: translate('leadsPage.status.lost') },
  ];

  // Check server health
  const checkHealth = useCallback(async () => {
    try {
      const health = await getHealth();
      setServerOnline(health.ok === true);
    } catch (err) {
      setServerOnline(false);
    }
  }, []);

  // Fetch leads
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsData, statsData] = await Promise.all([
        getLeads(statusFilter),
        getLeadsStats()
      ]);

      // Ensure leadsData is an array
      const leadsArray = Array.isArray(leadsData) ? leadsData : [];
      setLeads(leadsArray);
      setStats(statsData);

      // If we got here, server is online
      setServerOnline(true);
      console.log(`[Leads] Loaded ${leadsArray.length} leads successfully`);
    } catch (err) {
      console.error('Error fetching leads:', err);
      setError(translate('leadsPage.errorLoad'));
      setServerOnline(false);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, translate]);

  // Handle new lead from SSE
  const handleNewLead = useCallback((lead) => {
    console.log('New lead received:', lead);
    setLeads(prev => [lead, ...prev]);
    // Refresh stats
    getLeadsStats().then(setStats).catch(console.error);
  }, []);

  // Handle lead updated from SSE
  const handleLeadUpdated = useCallback((updatedLead) => {
    console.log('Lead updated:', updatedLead);
    setLeads(prev =>
      prev.map(lead =>
        lead.id === updatedLead.id ? updatedLead : lead
      )
    );
    // Update selected lead if it's the same one
    setSelectedLead(prev =>
      prev && prev.id === updatedLead.id ? updatedLead : prev
    );
    // Refresh stats
    getLeadsStats().then(setStats).catch(console.error);
  }, []);

  // Start SSE connection
  const startSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus('connecting');

    const eventSource = subscribeToLeads(
      handleNewLead,
      handleLeadUpdated,
      () => setConnectionStatus('error')
    );

    eventSource.addEventListener('connected', () => {
      setConnectionStatus('sse');
    });

    eventSourceRef.current = eventSource;
  }, [handleNewLead, handleLeadUpdated]);

  // Initial load
  useEffect(() => {
    fetchLeads();
    startSSE();
    checkHealth();

    // Health check every 30 seconds
    healthCheckRef.current = setInterval(checkHealth, 30000);

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
      }
    };
  }, [fetchLeads, startSSE, checkHealth, activeTenantId, authToken]);

  // Re-fetch when filter changes
  useEffect(() => {
    fetchLeads();
  }, [statusFilter, fetchLeads, activeTenantId, authToken]);

  // Handle status update
  const handleStatusUpdate = async (leadId, newStatus) => {
    try {
      await updateLead(leadId, { status: newStatus });
      setLeads(prev =>
        prev.map(lead =>
          lead.id === leadId ? { ...lead, status: newStatus } : lead
        )
      );
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead(prev => ({ ...prev, status: newStatus }));
      }
      // Refresh stats
      const newStats = await getLeadsStats();
      setStats(newStats);
    } catch (err) {
      console.error('Error updating lead status:', err);
    }
  };

  // Handle score update
  const handleScoreUpdate = async (leadId, newScore) => {
    try {
      await updateLead(leadId, { score: newScore });
      setLeads(prev =>
        prev.map(lead =>
          lead.id === leadId ? { ...lead, score: newScore } : lead
        )
      );
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead(prev => ({ ...prev, score: newScore }));
      }
    } catch (err) {
      console.error('Error updating lead score:', err);
    }
  };

  // Add demo lead for testing
  const handleAddDemoLead = async () => {
    const demoNames = ['John Smith', 'Maria Garcia', 'David Chen', 'Anna Müller', 'Yuki Tanaka'];
    const randomName = demoNames[Math.floor(Math.random() * demoNames.length)];
    const randomGuests = Math.floor(Math.random() * 4) + 1;

    // Generate dates (checkin: 7-30 days from now, checkout: 3-7 days after checkin)
    const checkinDate = new Date();
    checkinDate.setDate(checkinDate.getDate() + Math.floor(Math.random() * 23) + 7);
    const checkoutDate = new Date(checkinDate);
    checkoutDate.setDate(checkoutDate.getDate() + Math.floor(Math.random() * 4) + 3);

    const demoLead = {
      name: randomName,
      email: `${randomName.toLowerCase().replace(' ', '.')}@example.com`,
      phone: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      guests: randomGuests,
      checkin: checkinDate.toISOString().split('T')[0],
      checkout: checkoutDate.toISOString().split('T')[0],
      source: 'widget'
    };

    try {
      console.log('[Demo] Creating demo lead:', demoLead);
      const result = await createLead(demoLead);
      console.log('[Demo] Lead created:', result);
      // Refresh leads list
      fetchLeads();
    } catch (err) {
      console.error('[Demo] Error creating demo lead:', err);
      alert(`Failed to create demo lead: ${err.message}`);
    }
  };

  // Get score color
  const getScoreColor = (score) => {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-medium';
    return 'score-low';
  };

  // Get status badge class
  const getStatusClass = (status) => {
    return `status-badge status-${status}`;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(i18n.language === 'he' ? 'he-IL' : i18n.language === 'el' ? 'el-GR' : 'en-US');
  };

  // Format time
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString(i18n.language === 'he' ? 'he-IL' : i18n.language === 'el' ? 'el-GR' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Server status indicator
  const renderServerStatus = () => {
    if (serverOnline === null) {
      return (
        <div className="server-status checking">
          <span className="status-dot"></span>
          <span>{translate('common.checking')}</span>
        </div>
      );
    }
    if (serverOnline) {
      return (
        <div className="server-status online">
          <span className="status-dot"></span>
          <span>{translate('common.online')}</span>
        </div>
      );
    }
    return (
      <div className="server-status offline">
        <span className="status-dot"></span>
        <span>{translate('common.offline')}</span>
      </div>
    );
  };

  // Connection status indicator
  const renderConnectionStatus = () => {
    if (connectionStatus === 'sse') {
      return (
        <div className="connection-status connected">
          <Wifi size={14} />
          <span>{translate('common.live')}</span>
        </div>
      );
    }
    if (connectionStatus === 'error') {
      return (
        <div className="connection-status error">
          <WifiOff size={14} />
          <span>{translate('common.offline')}</span>
        </div>
      );
    }
    return (
      <div className="connection-status connecting">
        <Wifi size={14} className="blink" />
        <span>...</span>
      </div>
    );
  };

  return (
    <div className="leads-page fade-in">
      {/* Header */}
      <div className="leads-header">
        <div className="leads-title-row">
          <h2 className="leads-title">
            <Users size={24} />
            {translate('leadsPage.title')}
          </h2>
          <div className="status-indicators">
            {renderServerStatus()}
            {renderConnectionStatus()}
          </div>
        </div>

        <div className="leads-actions">
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddDemoLead}
            className="demo-lead-btn"
          >
            <PlusCircle size={16} />
            {translate('leadsPage.addDemo')}
          </Button>
          <div className="filter-group">
            <Filter size={16} />
            <select
              value={statusFilter || ''}
              onChange={(e) => setStatusFilter(e.target.value || null)}
              className="status-filter"
            >
              {statusOptions.map(opt => (
                <option key={opt.value || 'all'} value={opt.value || ''}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLeads}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="leads-stats">
        <Card className="stat-card">
          <div className="stat-value">{stats?.total || leads.length}</div>
          <div className="stat-label">{translate('leadsPage.stats.total')}</div>
        </Card>
        <Card className="stat-card stat-new">
          <div className="stat-value">{stats?.new || 0}</div>
          <div className="stat-label">{translate('leadsPage.stats.new')}</div>
        </Card>
        <Card className="stat-card stat-qualified">
          <div className="stat-value">{stats?.qualified || 0}</div>
          <div className="stat-label">{translate('leadsPage.stats.qualified')}</div>
        </Card>
        <Card className="stat-card stat-won">
          <div className="stat-value">{stats?.won || 0}</div>
          <div className="stat-label">{translate('leadsPage.stats.won')}</div>
        </Card>
        <Card className="stat-card stat-avg">
          <div className="stat-value">
            <TrendingUp size={18} />
            {stats?.avg_score || 0}
          </div>
          <div className="stat-label">{translate('leadsPage.stats.avgScore')}</div>
        </Card>
      </div>

      {/* Leads Table */}
      <Card className="leads-table-card">
        {loading && leads.length === 0 ? (
          <div className="leads-loading">
            {translate('common.loading')}
          </div>
        ) : error ? (
          <div className="leads-error">{error}</div>
        ) : leads.length === 0 ? (
          <div className="leads-empty">
            <Users size={48} />
            <p>{translate('leadsPage.empty')}</p>
          </div>
        ) : (
          <div className="leads-table-wrapper">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>{translate('leadsPage.table.score')}</th>
                  <th>{translate('leadsPage.table.name')}</th>
                  <th>{translate('leadsPage.table.contact')}</th>
                  <th>{translate('leadsPage.table.dates')}</th>
                  <th>{translate('leadsPage.table.guests')}</th>
                  <th>{translate('leadsPage.table.status')}</th>
                  <th>{translate('leadsPage.table.created')}</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    className="lead-row"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td>
                      <span className={`score-badge ${getScoreColor(lead.score)}`}>
                        {lead.score}
                      </span>
                    </td>
                    <td className="lead-name">{lead.name}</td>
                    <td className="lead-contact">
                      {lead.phone && (
                        <span className="contact-item">
                          <Phone size={14} />
                          {lead.phone}
                        </span>
                      )}
                      {lead.email && (
                        <span className="contact-item">
                          <Mail size={14} />
                          {lead.email}
                        </span>
                      )}
                    </td>
                    <td className="lead-dates">
                      {lead.checkin && lead.checkout ? (
                        <span className="dates-item">
                          <Calendar size={14} />
                          {formatDate(lead.checkin)} - {formatDate(lead.checkout)}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="lead-guests">
                      {lead.guests ? (
                        <span className="guests-item">
                          <UserCheck size={14} />
                          {lead.guests}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <span className={getStatusClass(lead.status)}>
                        {statusOptions.find(s => s.value === lead.status)?.label || lead.status}
                      </span>
                    </td>
                    <td className="lead-created">
                      <span className="created-item">
                        <Clock size={14} />
                        {formatDate(lead.created_at)}
                        <span className="created-time">{formatTime(lead.created_at)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lead Details Modal */}
      {selectedLead && (
          <LeadDetailsModal
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onStatusUpdate={handleStatusUpdate}
            onScoreUpdate={handleScoreUpdate}
          />
      )}
    </div>
  );
};

export default LeadsPage;
