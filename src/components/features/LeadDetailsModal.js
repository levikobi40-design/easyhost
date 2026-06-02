import React, { useState } from 'react';
import { X, Phone, Mail, Calendar, UserCheck, Clock, Copy, Check, MessageCircle } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import Button from '../ui/Button';
import './LeadDetailsModal.css';

/**
 * Modal for viewing and managing lead details
 * Includes WhatsApp/Email message copy functionality
 */
const LeadDetailsModal = ({ lead, onClose, onStatusUpdate }) => {
  const { t, i18n } = useTranslations();
  const [copied, setCopied] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(lead.status);

  // Status options
  const statusOptions = [
    { value: 'new', label: t('leadsPage.status.new'), color: 'primary' },
    { value: 'contacted', label: t('leadsPage.status.contacted'), color: 'accent' },
    { value: 'qualified', label: t('leadsPage.status.qualified'), color: 'secondary' },
    { value: 'booked', label: t('leadsPage.status.won'), color: 'secondary' },
    { value: 'lost', label: t('leadsPage.status.lost'), color: 'danger' },
  ];

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const locale = i18n.language === 'he' ? 'he-IL' : i18n.language === 'el' ? 'el-GR' : 'en-US';
    return new Date(dateStr).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Generate WhatsApp message
  const generateWhatsAppMessage = () => {
    const hotelName = t('branding.name');
    const intro = t('leadModal.whatsapp.intro', { name: lead.name, hotelName });
    let dateInfo = '';
    if (lead.checkin && lead.checkout) {
      dateInfo = t('leadModal.whatsapp.dates', {
        checkin: formatDate(lead.checkin),
        checkout: formatDate(lead.checkout),
      });
    }

    let guestsInfo = '';
    if (lead.guests) {
      guestsInfo = t('leadModal.whatsapp.guests', { guests: lead.guests });
    }

    const closing = t('leadModal.whatsapp.closing');

    return `${intro}${dateInfo}${guestsInfo}${closing}`;
  };

  // Generate Email message
  const generateEmailMessage = () => {
    const hotelName = t('branding.name');
    const subject = t('leadModal.email.subject', { hotelName });

    const body = generateWhatsAppMessage();

    return { subject, body };
  };

  // Copy to clipboard
  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle status change
  const handleStatusChange = (newStatus) => {
    setSelectedStatus(newStatus);
    onStatusUpdate(lead.id, newStatus);
  };

  // Open WhatsApp
  const openWhatsApp = () => {
    if (lead.phone) {
      const message = encodeURIComponent(generateWhatsAppMessage());
      const phone = lead.phone.replace(/[^\d+]/g, '');
      window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    }
  };

  // Open Email
  const openEmail = () => {
    if (lead.email) {
      const { subject, body } = generateEmailMessage();
      const mailtoUrl = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoUrl;
    }
  };

  return (
    <div className="lead-modal-overlay" onClick={onClose}>
      <div className="lead-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="lead-modal-header">
          <div className="lead-modal-title">
            <h2>{lead.name}</h2>
            <span className={`score-badge score-${lead.score >= 70 ? 'high' : lead.score >= 40 ? 'medium' : 'low'}`}>
              {t('leadModal.score')}: {lead.score}
            </span>
          </div>
          <button className="lead-modal-close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="lead-modal-content">
          {/* Contact Info */}
          <div className="lead-section">
            <h3>{t('leadModal.contactInfo')}</h3>
            <div className="lead-info-grid">
              {lead.phone && (
                <div className="lead-info-item">
                  <Phone size={18} />
                  <span>{lead.phone}</span>
                </div>
              )}
              {lead.email && (
                <div className="lead-info-item">
                  <Mail size={18} />
                  <span>{lead.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Booking Details */}
          <div className="lead-section">
            <h3>{t('leadModal.bookingDetails')}</h3>
            <div className="lead-info-grid">
              {(lead.checkin || lead.checkout) && (
                <div className="lead-info-item">
                  <Calendar size={18} />
                  <span>
                    {formatDate(lead.checkin)} - {formatDate(lead.checkout)}
                  </span>
                </div>
              )}
              {lead.guests && (
                <div className="lead-info-item">
                  <UserCheck size={18} />
                  <span>{lead.guests} {t('leadsPage.table.guests').toLowerCase()}</span>
                </div>
              )}
              <div className="lead-info-item">
                <Clock size={18} />
                <span>
                  {t('leadModal.created')} {formatDate(lead.created_at)}
                </span>
              </div>
            </div>
          </div>

          {/* Status Update */}
          <div className="lead-section">
            <h3>{t('leadModal.status')}</h3>
            <div className="status-buttons">
              {statusOptions.map(option => (
                <button
                  key={option.value}
                  className={`status-btn status-btn-${option.color} ${selectedStatus === option.value ? 'active' : ''}`}
                  onClick={() => handleStatusChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="lead-section">
            <h3>{t('leadModal.quickActions')}</h3>
            <div className="quick-actions">
              {lead.phone && (
                <Button variant="secondary" onClick={openWhatsApp}>
                  <MessageCircle size={18} />
                  WhatsApp
                </Button>
              )}
              {lead.email && (
                <Button variant="primary" onClick={openEmail}>
                  <Mail size={18} />
                  Email
                </Button>
              )}
            </div>
          </div>

          {/* Message Templates */}
          <div className="lead-section">
            <h3>{t('leadModal.copyMessage')}</h3>
            <div className="message-templates">
              {/* WhatsApp Message */}
              <div className="message-template">
                <div className="template-header">
                  <MessageCircle size={16} />
                  <span>WhatsApp</span>
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(generateWhatsAppMessage(), 'whatsapp')}
                  >
                    {copied === 'whatsapp' ? <Check size={16} /> : <Copy size={16} />}
                    {copied === 'whatsapp' ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
                <pre className="message-preview">{generateWhatsAppMessage()}</pre>
              </div>

              {/* Email Message */}
              <div className="message-template">
                <div className="template-header">
                  <Mail size={16} />
                  <span>Email</span>
                  <button
                    className="copy-btn"
                    onClick={() => {
                      const { body } = generateEmailMessage();
                      copyToClipboard(body, 'email');
                    }}
                  >
                    {copied === 'email' ? <Check size={16} /> : <Copy size={16} />}
                    {copied === 'email' ? t('common.copied') : t('common.copy')}
                  </button>
                </div>
                <pre className="message-preview">{generateEmailMessage().body}</pre>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="lead-modal-footer">
          <span className="lead-source">
            {t('leadModal.source')} {lead.source}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LeadDetailsModal;
