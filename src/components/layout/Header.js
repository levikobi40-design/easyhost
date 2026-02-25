import React from 'react';
import { UserCircle, Sparkles, LayoutDashboard, Users } from 'lucide-react';
import Button from '../ui/Button';
import { AI_ASSISTANT_URL } from '../../utils/constants';
import './Header.css';

/**
 * Easy Host AI Header - Premium navigation with glassmorphism
 */
const Header = ({ lang, setLang, role, setRole, page, setPage, t }) => {
  const handleAIAssistantClick = () => {
    window.open(AI_ASSISTANT_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <header className="app-header easyhost-header">
      <div className="header-content">
        {/* Brand Logo */}
        <div className="header-section header-brand">
          <span className="brand-logo">Easy Host AI</span>
          <span className="brand-ai-badge">AI</span>
        </div>

        {/* Language Switcher */}
        <div className="header-section lang-switcher">
          {['he', 'en', 'el'].map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`lang-btn ${lang === l ? 'active' : ''}`}
              aria-label={`Switch to ${l.toUpperCase()}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Page Navigation */}
        <div className="header-section header-nav">
          <button
            onClick={() => setPage('dashboard')}
            className={`nav-btn ${page === 'dashboard' ? 'active' : ''}`}
          >
            <LayoutDashboard size={18} />
            <span>{t.dashboard || 'Dashboard'}</span>
          </button>
          <button
            onClick={() => setPage('leads')}
            className={`nav-btn ${page === 'leads' ? 'active' : ''}`}
          >
            <Users size={18} />
            <span>{t.leads || 'Leads'}</span>
          </button>
        </div>

        {/* Maya AI Button */}
        <div className="header-section header-center">
          <Button
            variant="primary"
            size="lg"
            onClick={handleAIAssistantClick}
            className="maya-btn"
          >
            <Sparkles size={20} />
            Maya
          </Button>
        </div>

        {/* Role Selector */}
        <div className="header-section header-right">
          <div className="role-selector">
            <UserCircle size={20} />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="role-select"
            >
              <option value="owner">{t.owner}</option>
              <option value="staff">{t.staff}</option>
              <option value="guest">{t.guest}</option>
            </select>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
