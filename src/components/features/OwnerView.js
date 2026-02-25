import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, RefreshCw, Send, Search,
  Instagram, Facebook, Mail, Target, TrendingUp, Users,
  CheckCircle, Loader2, Copy, Star, BarChart3, Zap, PlusCircle,
  Phone, Calendar, Wifi, WifiOff, Coffee, Bed, LogOut, Bell,
  MessageSquare, ChevronRight, Heart, Utensils, Car, Sparkle
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import {
  getAIInsights, getAgentProfile, getLeads, getLeadsStats, createLead,
  generateMarketingPost, searchPropertyLeads, draftOutreachEmail,
  generateAcquisitionStrategy, publishPost, sendOutreachEmail
} from '../../services/api';
import './OwnerView.css';

// HARDCODED API URL - bypass .env issues
import { API_URL } from '../../utils/constants';

/**
 * Easy Host AI Owner Dashboard - Premium Glassmorphism
 * Thailand-style luxury hotel app experience
 */
const OwnerView = ({ aiLog, onShowSummary, onAIAction, t }) => {
  // Agent State
  const [agent, setAgent] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Marketing Post State
  const [postPlatform, setPostPlatform] = useState('instagram');
  const [propertyName, setPropertyName] = useState('Villa Mykonos');
  const [generatedPost, setGeneratedPost] = useState(null);
  const [postLoading, setPostLoading] = useState(false);
  const [postPublished, setPostPublished] = useState(false);

  // Lead Search State
  const [searchLocation, setSearchLocation] = useState('Mykonos, Greece');
  const [searchType, setSearchType] = useState('villa');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Acquisition Strategy State
  const [targetSegment, setTargetSegment] = useState('luxury travelers');
  const [strategy, setStrategy] = useState(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  // Insight State
  const [aiInsight, setAiInsight] = useState(null);

  // Real Leads State (from database)
  const [realLeads, setRealLeads] = useState([]);
  const [leadsStats, setLeadsStats] = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [serverOnline, setServerOnline] = useState(null);

  // Smart Suggestions State
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Services from API
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Maya Chat Messages
  const [mayaMessages, setMayaMessages] = useState([
    { type: 'maya', text: "Hello! I'm Maya, your Easy Host AI Concierge. How can I assist you today?" }
  ]);

  // Fetch services from API
  const fetchServices = useCallback(async () => {
    setServicesLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/services`);
      if (response.ok) {
        const data = await response.json();
        setServices(data);
      }
    } catch (error) {
      console.error('[Easy Host AI] Error fetching services:', error);
      // Fallback services
      setServices([
        { id: 'room_service', title: 'Room Service', icon: 'coffee', desc: 'Order food & beverages', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
        { id: 'housekeeping', title: 'Housekeeping', icon: 'sparkles', desc: 'Fresh towels & cleaning', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
        { id: 'spa', title: 'Spa & Wellness', icon: 'heart', desc: 'Relaxing treatments', gradient: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' },
        { id: 'checkout', title: 'Express Checkout', icon: 'logout', desc: 'Quick & easy departure', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }
      ]);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // Fetch smart suggestions from Maya (HARDCODED URL)
  const fetchSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/agent/suggestions`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
        setServerOnline(true);
      } else {
        setServerOnline(false);
      }
    } catch (error) {
      console.error('[Easy Host AI] Error fetching suggestions:', error);
      setServerOnline(false);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Fetch real leads from database (HARDCODED URL)
  const fetchRealLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/leads`);
      if (response.ok) {
        const data = await response.json();
        const leadsArray = Array.isArray(data) ? data : [];
        setRealLeads(leadsArray);
        setServerOnline(true);
        console.log(`[Easy Host AI] Loaded ${leadsArray.length} leads`);
      } else {
        setServerOnline(false);
      }

      // Fetch stats
      const statsResponse = await fetch(`${API_URL}/api/leads/stats`);
      if (statsResponse.ok) {
        const stats = await statsResponse.json();
        setLeadsStats(stats);
      }
    } catch (error) {
      console.error('[Easy Host AI] Error fetching leads:', error);
      setServerOnline(false);
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  // Add demo lead for testing (HARDCODED URL)
  const handleAddDemoLead = async () => {
    const demoNames = ['John Smith', 'Maria Garcia', 'David Chen', 'Anna Muller', 'Yuki Tanaka'];
    const randomName = demoNames[Math.floor(Math.random() * demoNames.length)];
    const randomGuests = Math.floor(Math.random() * 4) + 1;

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
      console.log('[Easy Host AI] Creating demo lead:', demoLead);
      const response = await fetch(`${API_URL}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demoLead)
      });
      if (response.ok) {
        setServerOnline(true);
        fetchRealLeads();
        fetchSuggestions();
        // Add Maya message
        setMayaMessages(prev => [...prev, {
          type: 'maya',
          text: `Great news! A new lead "${randomName}" has been added. Score looks promising!`
        }]);
      }
    } catch (err) {
      console.error('[Easy Host AI] Error creating demo lead:', err);
      setServerOnline(false);
    }
  };

  // Handle service request
  const handleServiceRequest = async (service) => {
    try {
      const response = await fetch(`${API_URL}/api/services/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: service.id, room: '101', details: '' })
      });
      if (response.ok) {
        const data = await response.json();
        setMayaMessages(prev => [...prev, {
          type: 'maya',
          text: data.message || `${service.title} request received!`
        }]);
        setServerOnline(true);
      }
    } catch (err) {
      console.error('[Easy Host AI] Service request error:', err);
    }
  };

  // Fetch agent profile and leads on mount
  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const data = await getAgentProfile();
        setAgent(data.agent);
      } catch (error) {
        console.error('Error fetching agent:', error);
        setAgent({
          name: "Maya",
          title: "Easy Host AI Concierge",
          avatar: "https://api.dicebear.com/7.x/personas/svg?seed=Maya&backgroundColor=667eea"
        });
      }
    };
    fetchAgent();
    fetchInsights();
    fetchRealLeads();
    fetchSuggestions();
    fetchServices();
  }, [fetchRealLeads, fetchSuggestions, fetchServices]);

  // Fetch AI insights
  const fetchInsights = useCallback(async () => {
    try {
      const data = await getAIInsights();
      setAiInsight(data);
    } catch (error) {
      console.error('Error fetching insights:', error);
    }
  }, []);

  // Generate Marketing Post
  const handleGeneratePost = async () => {
    setPostLoading(true);
    setPostPublished(false);
    setGeneratedPost(null);
    try {
      const result = await generateMarketingPost({
        property_name: propertyName,
        target_platform: postPlatform,
        offer_type: 'new_listing',
        key_features: ['ocean view', 'private pool', 'luxury amenities'],
        target_audience: 'luxury travelers'
      });
      setGeneratedPost(result);
    } catch (error) {
      console.error('Error generating post:', error);
    } finally {
      setPostLoading(false);
    }
  };

  // Publish Post
  const handlePublishPost = async () => {
    try {
      await publishPost({
        platform: postPlatform,
        content: generatedPost?.post_content
      });
      setPostPublished(true);
    } catch (error) {
      console.error('Error publishing:', error);
    }
  };

  // Draft Email for Lead
  const handleDraftEmail = async (lead) => {
    setSelectedLead(lead);
    setEmailLoading(true);
    setEmailDraft(null);
    setEmailSent(false);
    try {
      const result = await draftOutreachEmail({
        owner_name: lead.name,
        property_description: lead.property || `${lead.name}'s property`,
        key_benefits: ['40% higher bookings', 'professional management', 'premium guest network']
      });
      setEmailDraft(result);
    } catch (error) {
      console.error('Error drafting email:', error);
    } finally {
      setEmailLoading(false);
    }
  };

  // Send Email
  const handleSendEmail = async () => {
    try {
      await sendOutreachEmail({
        recipient: selectedLead?.email,
        subject: 'Easy Host AI Partnership',
        content: emailDraft?.email_draft
      });
      setEmailSent(true);
    } catch (error) {
      console.error('Error sending email:', error);
    }
  };

  // Generate Acquisition Strategy
  const handleGenerateStrategy = async () => {
    setStrategyLoading(true);
    setStrategy(null);
    try {
      const result = await generateAcquisitionStrategy({
        target_segment: targetSegment,
        budget_level: 'medium',
        season: 'summer'
      });
      setStrategy(result);
    } catch (error) {
      console.error('Error generating strategy:', error);
    } finally {
      setStrategyLoading(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  // Get service icon component
  const getServiceIcon = (iconName) => {
    const icons = {
      coffee: <Coffee size={32} />,
      sparkles: <Sparkles size={32} />,
      heart: <Heart size={32} />,
      logout: <LogOut size={32} />,
      utensils: <Utensils size={32} />,
      car: <Car size={32} />,
    };
    return icons[iconName] || <Sparkle size={32} />;
  };

  // Platform icons
  const platformIcons = {
    instagram: <Instagram size={18} />,
    facebook: <Facebook size={18} />,
    email: <Mail size={18} />
  };

  // Get suggestion icon
  const getSuggestionIcon = (iconName) => {
    const icons = {
      star: <Star size={20} />,
      users: <Users size={20} />,
      calendar: <Calendar size={20} />,
      sparkles: <Sparkles size={20} />,
    };
    return icons[iconName] || <Bell size={20} />;
  };

  return (
    <div className="owner-dashboard-premium">
      {/* Animated Background */}
      <div className="premium-bg-gradient"></div>
      <div className="premium-bg-particles"></div>

      {/* Maya AI Concierge - Glowing Avatar Section */}
      <div className="maya-hero-section">
        <div className="maya-avatar-container">
          <div className="maya-avatar-glow"></div>
          <div className="maya-avatar-ring"></div>
          {agent?.avatar ? (
            <img src={agent.avatar} alt="Maya" className="maya-avatar-img" />
          ) : (
            <div className="maya-avatar-fallback">
              <Sparkles size={40} />
            </div>
          )}
          <div className={`maya-status-indicator ${serverOnline ? 'online' : serverOnline === false ? 'offline' : 'checking'}`}>
            {serverOnline === null ? (
              <Loader2 size={12} className="spin" />
            ) : serverOnline ? (
              <span className="pulse-dot"></span>
            ) : (
              <WifiOff size={12} />
            )}
          </div>
        </div>
        <div className="maya-info">
          <div className="maya-brand-row">
            <span className="maya-brand">Easy Host AI</span>
            <span className="maya-badge">AI</span>
          </div>
          <h1 className="maya-name">{agent?.name || 'Maya'}</h1>
          <p className="maya-title">{agent?.title || 'AI Concierge'}</p>
        </div>
        <div className="maya-stats-row">
          <div className="maya-stat glass-stat">
            <Users size={18} />
            <span className="stat-value">{leadsStats?.total || realLeads.length}</span>
            <span className="stat-label">Leads</span>
          </div>
          <div className="maya-stat glass-stat">
            <TrendingUp size={18} />
            <span className="stat-value">{leadsStats?.won || 0}</span>
            <span className="stat-label">Won</span>
          </div>
          <div className={`maya-stat glass-stat server-stat ${serverOnline ? 'online' : 'offline'}`}>
            {serverOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span className="stat-value">{serverOnline === null ? '...' : serverOnline ? 'Online' : 'Offline'}</span>
            <span className="stat-label">Server</span>
          </div>
        </div>
      </div>

      {/* Maya Chat Bubbles */}
      <div className="maya-chat-section">
        {mayaMessages.slice(-2).map((msg, idx) => (
          <div key={idx} className="maya-chat-bubble glass-bubble">
            <div className="bubble-avatar">
              <Sparkles size={16} />
            </div>
            <p>{msg.text}</p>
          </div>
        ))}
      </div>

      {/* Smart Suggestions */}
      {suggestions.length > 0 && activeTab === 'dashboard' && (
        <div className="suggestions-section">
          <h3 className="section-title">
            <MessageSquare size={18} />
            Maya's Suggestions
          </h3>
          <div className="suggestions-grid">
            {suggestions.slice(0, 3).map((suggestion, idx) => (
              <div key={idx} className={`suggestion-tile glass-tile priority-${suggestion.priority}`}>
                <div className="suggestion-icon-wrap">
                  {getSuggestionIcon(suggestion.icon)}
                </div>
                <div className="suggestion-content">
                  <h4>{suggestion.title}</h4>
                  <p>{suggestion.message}</p>
                </div>
                {suggestion.action && (
                  <button className="suggestion-action-btn">
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service Tiles - Thailand Style */}
      {activeTab === 'dashboard' && (
        <div className="services-section">
          <h3 className="section-title">
            <Sparkle size={18} />
            Hotel Services
          </h3>
          <div className="services-tiles-grid">
            {(services.length > 0 ? services : [
              { id: 'room_service', title: 'Room Service', icon: 'coffee', desc: 'Order food & beverages', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
              { id: 'housekeeping', title: 'Housekeeping', icon: 'sparkles', desc: 'Fresh towels & cleaning', gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
              { id: 'spa', title: 'Spa & Wellness', icon: 'heart', desc: 'Relaxing treatments', gradient: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' },
              { id: 'checkout', title: 'Express Checkout', icon: 'logout', desc: 'Quick departure', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }
            ]).map((service) => (
              <div
                key={service.id}
                className="service-tile glass-service"
                onClick={() => handleServiceRequest(service)}
              >
                {service.img && (
                  <div className="service-tile-img" style={{ backgroundImage: `url(${service.img})` }}></div>
                )}
                <div className="service-tile-overlay" style={{ background: service.gradient }}></div>
                <div className="service-tile-content">
                  <div className="service-icon-circle">
                    {getServiceIcon(service.icon)}
                  </div>
                  <h4>{service.title}</h4>
                  <p>{service.desc}</p>
                  <button className="request-now-btn">
                    Request Now
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="premium-nav-tabs glass-nav">
        <button
          className={`premium-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Sparkles size={18} />
          <span>Dashboard</span>
        </button>
        <button
          className={`premium-tab ${activeTab === 'myleads' ? 'active' : ''}`}
          onClick={() => setActiveTab('myleads')}
        >
          <Users size={18} />
          <span>Leads</span>
          {realLeads.length > 0 && <span className="tab-count">{realLeads.length}</span>}
        </button>
        <button
          className={`premium-tab ${activeTab === 'marketing' ? 'active' : ''}`}
          onClick={() => setActiveTab('marketing')}
        >
          <Instagram size={18} />
          <span>Marketing</span>
        </button>
        <button
          className={`premium-tab ${activeTab === 'acquisition' ? 'active' : ''}`}
          onClick={() => setActiveTab('acquisition')}
        >
          <Target size={18} />
          <span>Strategy</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content-premium">
        {/* My Leads Tab */}
        {activeTab === 'myleads' && (
          <div className="content-panel glass-panel">
            <div className="panel-header">
              <div>
                <h3><Users size={22} /> Sales Leads</h3>
                <p>Real-time leads from Easy Host AI platform</p>
              </div>
              <div className="panel-actions">
                <button className="action-btn primary" onClick={handleAddDemoLead}>
                  <PlusCircle size={18} />
                  Add Demo Lead
                </button>
                <button
                  className="action-btn ghost"
                  onClick={() => { fetchRealLeads(); fetchSuggestions(); }}
                  disabled={leadsLoading}
                >
                  <RefreshCw size={18} className={leadsLoading ? 'spin' : ''} />
                </button>
              </div>
            </div>

            {/* Stats Pills */}
            <div className="leads-stats-pills">
              <div className="stat-pill">
                <span className="pill-value">{leadsStats?.total || 0}</span>
                <span className="pill-label">Total</span>
              </div>
              <div className="stat-pill new">
                <span className="pill-value">{leadsStats?.new || 0}</span>
                <span className="pill-label">New</span>
              </div>
              <div className="stat-pill qualified">
                <span className="pill-value">{leadsStats?.qualified || 0}</span>
                <span className="pill-label">Qualified</span>
              </div>
              <div className="stat-pill won">
                <span className="pill-value">{leadsStats?.won || 0}</span>
                <span className="pill-label">Won</span>
              </div>
            </div>

            {/* Leads List */}
            <div className="leads-list-premium">
              {leadsLoading ? (
                <div className="loading-state">
                  <Loader2 size={40} className="spin" />
                  <p>Loading leads...</p>
                </div>
              ) : realLeads.length === 0 ? (
                <div className="empty-state">
                  <Users size={60} />
                  <h4>No leads yet</h4>
                  <p>Click "Add Demo Lead" to test the connection</p>
                  <button className="action-btn primary large" onClick={handleAddDemoLead}>
                    <PlusCircle size={20} />
                    Create First Lead
                  </button>
                </div>
              ) : (
                realLeads.slice(0, 10).map(lead => (
                  <div key={lead.id} className="lead-card glass-card">
                    <div className="lead-score" data-score={lead.score >= 70 ? 'high' : lead.score >= 40 ? 'medium' : 'low'}>
                      {lead.score}
                    </div>
                    <div className="lead-info">
                      <h4>{lead.name}</h4>
                      <div className="lead-contacts">
                        {lead.email && <span><Mail size={12} /> {lead.email}</span>}
                        {lead.phone && <span><Phone size={12} /> {lead.phone}</span>}
                      </div>
                      {(lead.checkin || lead.checkout) && (
                        <div className="lead-dates">
                          <Calendar size={12} />
                          <span>{lead.checkin} - {lead.checkout}</span>
                          {lead.guests && <span className="guests-badge">{lead.guests} guests</span>}
                        </div>
                      )}
                    </div>
                    <div className="lead-status-col">
                      <span className={`status-badge ${lead.status}`}>{lead.status}</span>
                      <span className="source-text">{lead.source}</span>
                    </div>
                    <button className="email-btn" onClick={() => handleDraftEmail(lead)}>
                      <Mail size={16} />
                      Email
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Email Draft */}
            {emailDraft && (
              <div className="email-draft-section glass-panel">
                <div className="draft-header">
                  <span className="draft-badge"><Mail size={16} /> Email to {selectedLead?.name}</span>
                  <button className="icon-btn" onClick={() => copyToClipboard(emailDraft.email_draft)}>
                    <Copy size={16} />
                  </button>
                </div>
                <pre className="draft-content">{emailDraft.email_draft}</pre>
                <div className="draft-actions">
                  {emailSent ? (
                    <button className="action-btn success" disabled>
                      <CheckCircle size={18} /> Sent!
                    </button>
                  ) : (
                    <button className="action-btn send" onClick={handleSendEmail}>
                      <Send size={18} /> Send Email
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Marketing Tab */}
        {activeTab === 'marketing' && (
          <div className="content-panel glass-panel">
            <div className="panel-header">
              <div>
                <h3><Sparkles size={22} /> Marketing Post Generator</h3>
                <p>Create engaging content with Maya AI</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Property Name</label>
                  <input
                    type="text"
                    value={propertyName}
                    onChange={(e) => setPropertyName(e.target.value)}
                    placeholder="Villa Mykonos"
                    className="glass-input"
                  />
                </div>
                <div className="form-group">
                  <label>Platform</label>
                  <div className="platform-selector">
                    {['instagram', 'facebook', 'email'].map(platform => (
                      <button
                        key={platform}
                        className={`platform-btn ${postPlatform === platform ? 'selected' : ''}`}
                        onClick={() => setPostPlatform(platform)}
                      >
                        {platformIcons[platform]}
                        <span>{platform}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="generate-btn"
                onClick={handleGeneratePost}
                disabled={postLoading}
              >
                {postLoading ? (
                  <><Loader2 size={20} className="spin" /> Generating...</>
                ) : (
                  <><Sparkles size={20} /> Generate Post</>
                )}
              </button>

              {generatedPost && (
                <div className="output-panel glass-output">
                  <div className="output-header">
                    <span className="output-badge">
                      {platformIcons[postPlatform]} {postPlatform.toUpperCase()}
                    </span>
                    <button className="icon-btn" onClick={() => copyToClipboard(generatedPost.post_content)}>
                      <Copy size={16} />
                    </button>
                  </div>
                  <pre className="output-text">{generatedPost.post_content}</pre>
                  <div className="output-actions">
                    {postPublished ? (
                      <button className="action-btn success" disabled>
                        <CheckCircle size={18} /> Published!
                      </button>
                    ) : (
                      <button className="action-btn send" onClick={handlePublishPost}>
                        <Send size={18} /> Publish
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Acquisition Strategy Tab */}
        {activeTab === 'acquisition' && (
          <div className="content-panel glass-panel">
            <div className="panel-header">
              <div>
                <h3><Target size={22} /> Client Acquisition Strategy</h3>
                <p>Data-driven strategies powered by Maya AI</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="form-group single">
                <label>Target Segment</label>
                <select
                  value={targetSegment}
                  onChange={(e) => setTargetSegment(e.target.value)}
                  className="glass-select"
                >
                  <option value="luxury travelers">Luxury Travelers</option>
                  <option value="families">Families</option>
                  <option value="business travelers">Business Travelers</option>
                  <option value="couples">Couples & Honeymoon</option>
                </select>
              </div>

              <button
                className="generate-btn"
                onClick={handleGenerateStrategy}
                disabled={strategyLoading}
              >
                {strategyLoading ? (
                  <><Loader2 size={20} className="spin" /> Analyzing...</>
                ) : (
                  <><TrendingUp size={20} /> Generate Strategy</>
                )}
              </button>

              {strategy && (
                <div className="strategy-results">
                  <div className="strategy-card glass-card">
                    <h4><TrendingUp size={18} /> Marketing Channels</h4>
                    <div className="channels-list">
                      {strategy.strategy.recommendations.channels.map((channel, i) => (
                        <div key={i} className="channel-item">
                          <span className="channel-name">{channel.name}</span>
                          <span className={`channel-priority ${channel.priority.toLowerCase()}`}>
                            {channel.priority}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="strategy-card glass-card">
                    <h4>Pricing Strategy</h4>
                    <div className="pricing-content">
                      <strong>{strategy.strategy.recommendations.pricing_strategy.type}</strong>
                      <p>{strategy.strategy.recommendations.pricing_strategy.suggestion}</p>
                    </div>
                  </div>

                  <div className="strategy-card glass-card">
                    <h4>Ad Headlines</h4>
                    <div className="headlines-list">
                      {strategy.strategy.recommendations.ad_headlines.map((headline, i) => (
                        <div key={i} className="headline-item">
                          <span>{headline}</span>
                          <button className="icon-btn-sm" onClick={() => copyToClipboard(headline)}>
                            <Copy size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Insight Footer */}
      <div className="insight-footer glass-footer">
        <div className="insight-content">
          <Sparkles size={18} />
          <span>{aiInsight?.insight || 'Maya is ready to help grow your Easy Host AI business!'}</span>
        </div>
        <button className="refresh-btn" onClick={() => { fetchInsights(); fetchSuggestions(); }}>
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  );
};

export default OwnerView;
