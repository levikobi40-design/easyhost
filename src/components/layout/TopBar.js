import React from 'react';
import { Menu, UserCircle } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import NotificationCenter from '../notifications/NotificationCenter';
import easyHostLogo from '../../assets/easyhost-logo.svg';
import './TopBar.css';

const TopBar = () => {
  const { lang, setLang, role, setRole, sidebarOpen, toggleSidebar, tenants, activeTenantId, setActiveTenantId, market } = useStore();
  const { t } = useTranslations();

  const languages = market === 'IL'
    ? [
        { code: 'he', label: t('languages.he'), flag: '🇮🇱' },
        { code: 'th', label: 'Thai', flag: '🇹🇭' },
        { code: 'hi', label: 'Hindi', flag: '🇮🇳' },
      ]
    : [
        { code: 'en', label: t('languages.en'), flag: '🇺🇸' },
        { code: 'es', label: 'Spanish', flag: '🇪🇸' },
      ];

  return (
    <header className="top-bar glass">
      <div className="top-bar-start">
        <button
          onClick={toggleSidebar}
          className="menu-btn"
        >
          <Menu size={22} />
        </button>
        <div className="topbar-logo">
          <img src={easyHostLogo} alt="Easy Host AI" className="topbar-logo-img" />
          <span className="topbar-logo-text">Easy Host AI</span>
        </div>
        <div className="breadcrumb">
          <span className="breadcrumb-item">{t('topbar.breadcrumbEnterprise')}</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-item active">{t('topbar.breadcrumbDashboard')}</span>
        </div>
      </div>

      <div className="top-bar-end">
        <div className="tenant-selector">
          <select
            value={activeTenantId}
            onChange={(e) => setActiveTenantId(e.target.value)}
            className="tenant-select"
            aria-label="Select tenant"
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
        {/* Language Selector */}
        <div className="lang-selector">
          {languages.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`lang-btn ${lang === l.code ? 'active' : ''}`}
            >
              {l.flag}
            </button>
          ))}
        </div>

        {/* Notifications */}
        <NotificationCenter />

        {/* Role Selector */}
        <div className="role-selector">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="role-select"
            aria-label="Select role"
          >
            <option value="host">{t('roles.host')}</option>
            <option value="operator">{t('roles.operator')}</option>
            <option value="field">{t('roles.field')}</option>
          </select>
        </div>

        {/* User Menu */}
        <div className="user-menu">
          <div className="user-avatar">
            <UserCircle size={24} />
          </div>
          <div className="user-info">
            <span className="user-name">{t('topbar.userName')}</span>
            <span className="user-role">{t(`roles.${role}`)}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
