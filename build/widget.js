/**
 * Hotel Lead Capture Widget
 * Embeddable widget for capturing leads from external websites
 *
 * Usage:
 * <script src="https://your-domain.com/widget.js" data-hotel-id="your-hotel-id" data-api-url="https://your-api.com"></script>
 */

(function() {
  'use strict';

  // Get configuration from script tag
  const scriptTag = document.currentScript || document.querySelector('script[data-hotel-id]');
  const hotelId = scriptTag?.getAttribute('data-hotel-id') || 'default';
  const apiUrl = scriptTag?.getAttribute('data-api-url') || 'http://127.0.0.1:5000';
  const primaryColor = scriptTag?.getAttribute('data-primary-color') || '#6366f1';
  const position = scriptTag?.getAttribute('data-position') || 'right'; // 'left' or 'right'

  // Debug: Log widget configuration at startup
  console.log('[Widget] Initialized with config:', { hotelId, apiUrl, primaryColor, position });

  // Widget state
  let isOpen = false;
  let currentStep = 1;
  let formData = {
    checkin: '',
    checkout: '',
    guests: 2,
    name: '',
    email: '',
    phone: ''
  };

  // Translations
  const translations = {
    he: {
      title: 'בקשת הצעת מחיר',
      step1Title: 'בחרו תאריכים',
      step2Title: 'מספר אורחים',
      step3Title: 'פרטי קשר',
      checkin: 'כניסה',
      checkout: 'יציאה',
      guests: 'אורחים',
      name: 'שם מלא',
      email: 'אימייל',
      phone: 'טלפון',
      next: 'הבא',
      back: 'חזרה',
      submit: 'שלח',
      success: 'תודה! ניצור קשר בהקדם',
      error: 'שגיאה, נסו שוב',
      close: 'סגור'
    },
    en: {
      title: 'Get a Quote',
      step1Title: 'Select Dates',
      step2Title: 'Number of Guests',
      step3Title: 'Contact Info',
      checkin: 'Check-in',
      checkout: 'Check-out',
      guests: 'Guests',
      name: 'Full Name',
      email: 'Email',
      phone: 'Phone',
      next: 'Next',
      back: 'Back',
      submit: 'Submit',
      success: 'Thank you! We will contact you soon',
      error: 'Error, please try again',
      close: 'Close'
    }
  };

  // Detect language from page or default to English
  const detectLanguage = () => {
    const htmlLang = document.documentElement.lang?.substring(0, 2);
    return translations[htmlLang] ? htmlLang : 'en';
  };

  let lang = detectLanguage();
  const t = () => translations[lang];

  // Create and inject styles
  const injectStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      .hlw-widget-container {
        position: fixed;
        bottom: 20px;
        ${position === 'left' ? 'left: 20px;' : 'right: 20px;'}
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .hlw-trigger-btn {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: ${primaryColor};
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }

      .hlw-trigger-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 25px rgba(0, 0, 0, 0.4);
      }

      .hlw-trigger-btn svg {
        width: 28px;
        height: 28px;
        fill: white;
      }

      .hlw-popup {
        position: absolute;
        bottom: 70px;
        ${position === 'left' ? 'left: 0;' : 'right: 0;'}
        width: 340px;
        background: #1a1a2e;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        opacity: 0;
        transform: translateY(20px) scale(0.95);
        transition: all 0.3s ease;
        pointer-events: none;
      }

      .hlw-popup.open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .hlw-header {
        background: linear-gradient(135deg, ${primaryColor} 0%, #764ba2 100%);
        padding: 20px;
        color: white;
        position: relative;
      }

      .hlw-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .hlw-close-btn {
        position: absolute;
        top: 12px;
        ${position === 'left' ? 'left: 12px;' : 'right: 12px;'}
        background: rgba(255,255,255,0.2);
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
        transition: background 0.2s ease;
      }

      .hlw-close-btn:hover {
        background: rgba(255,255,255,0.3);
      }

      .hlw-progress {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }

      .hlw-progress-step {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
        transition: background 0.3s ease;
      }

      .hlw-progress-step.active {
        background: white;
      }

      .hlw-body {
        padding: 20px;
      }

      .hlw-step-title {
        color: #a0a0b8;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 16px;
      }

      .hlw-form-group {
        margin-bottom: 16px;
      }

      .hlw-form-group label {
        display: block;
        color: #e0e0e0;
        font-size: 13px;
        margin-bottom: 6px;
      }

      .hlw-form-group input {
        width: 100%;
        padding: 12px 14px;
        background: #252540;
        border: 1px solid #3a3a5c;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        box-sizing: border-box;
        transition: border-color 0.2s ease;
      }

      .hlw-form-group input:focus {
        outline: none;
        border-color: ${primaryColor};
      }

      .hlw-form-group input::placeholder {
        color: #6a6a8a;
      }

      .hlw-guests-control {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .hlw-guests-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #252540;
        border: 1px solid #3a3a5c;
        color: white;
        font-size: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .hlw-guests-btn:hover {
        background: ${primaryColor};
        border-color: ${primaryColor};
      }

      .hlw-guests-value {
        font-size: 32px;
        font-weight: 600;
        color: white;
        min-width: 60px;
        text-align: center;
      }

      .hlw-buttons {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }

      .hlw-btn {
        flex: 1;
        padding: 14px 20px;
        border-radius: 8px;
        border: none;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .hlw-btn-secondary {
        background: #252540;
        color: #a0a0b8;
      }

      .hlw-btn-secondary:hover {
        background: #3a3a5c;
        color: white;
      }

      .hlw-btn-primary {
        background: ${primaryColor};
        color: white;
      }

      .hlw-btn-primary:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
      }

      .hlw-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .hlw-success {
        text-align: center;
        padding: 40px 20px;
        color: white;
      }

      .hlw-success svg {
        width: 64px;
        height: 64px;
        fill: #10b981;
        margin-bottom: 16px;
      }

      .hlw-success h4 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      .hlw-success p {
        margin: 0;
        color: #a0a0b8;
        font-size: 14px;
      }

      .hlw-error {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
        padding: 12px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 16px;
      }

      @media (max-width: 480px) {
        .hlw-popup {
          width: calc(100vw - 40px);
          ${position === 'left' ? 'left: 0;' : 'right: 0;'}
        }
      }
    `;
    document.head.appendChild(style);
  };

  // Create widget HTML
  const createWidget = () => {
    const container = document.createElement('div');
    container.className = 'hlw-widget-container';
    container.innerHTML = `
      <button class="hlw-trigger-btn" aria-label="Open contact form">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
      </button>
      <div class="hlw-popup" id="hlw-popup">
        <div class="hlw-header">
          <button class="hlw-close-btn" aria-label="Close">&times;</button>
          <h3>${t().title}</h3>
          <div class="hlw-progress">
            <div class="hlw-progress-step active" data-step="1"></div>
            <div class="hlw-progress-step" data-step="2"></div>
            <div class="hlw-progress-step" data-step="3"></div>
          </div>
        </div>
        <div class="hlw-body">
          <div id="hlw-step-content"></div>
        </div>
      </div>
    `;
    document.body.appendChild(container);
    return container;
  };

  // Render current step
  const renderStep = () => {
    const content = document.getElementById('hlw-step-content');
    const today = new Date().toISOString().split('T')[0];

    switch(currentStep) {
      case 1:
        content.innerHTML = `
          <div class="hlw-step-title">${t().step1Title}</div>
          <div class="hlw-form-group">
            <label>${t().checkin}</label>
            <input type="date" id="hlw-checkin" min="${today}" value="${formData.checkin}">
          </div>
          <div class="hlw-form-group">
            <label>${t().checkout}</label>
            <input type="date" id="hlw-checkout" min="${today}" value="${formData.checkout}">
          </div>
          <div class="hlw-buttons">
            <button class="hlw-btn hlw-btn-primary" id="hlw-next">${t().next}</button>
          </div>
        `;
        break;

      case 2:
        content.innerHTML = `
          <div class="hlw-step-title">${t().step2Title}</div>
          <div class="hlw-form-group">
            <div class="hlw-guests-control">
              <button class="hlw-guests-btn" id="hlw-guests-minus">-</button>
              <span class="hlw-guests-value" id="hlw-guests-value">${formData.guests}</span>
              <button class="hlw-guests-btn" id="hlw-guests-plus">+</button>
            </div>
          </div>
          <div class="hlw-buttons">
            <button class="hlw-btn hlw-btn-secondary" id="hlw-back">${t().back}</button>
            <button class="hlw-btn hlw-btn-primary" id="hlw-next">${t().next}</button>
          </div>
        `;
        break;

      case 3:
        content.innerHTML = `
          <div class="hlw-step-title">${t().step3Title}</div>
          <div id="hlw-error" class="hlw-error" style="display:none;"></div>
          <div class="hlw-form-group">
            <label>${t().name} *</label>
            <input type="text" id="hlw-name" value="${formData.name}" required>
          </div>
          <div class="hlw-form-group">
            <label>${t().email}</label>
            <input type="email" id="hlw-email" value="${formData.email}">
          </div>
          <div class="hlw-form-group">
            <label>${t().phone}</label>
            <input type="tel" id="hlw-phone" value="${formData.phone}">
          </div>
          <div class="hlw-buttons">
            <button class="hlw-btn hlw-btn-secondary" id="hlw-back">${t().back}</button>
            <button class="hlw-btn hlw-btn-primary" id="hlw-submit">${t().submit}</button>
          </div>
        `;
        break;

      case 4: // Success
        content.innerHTML = `
          <div class="hlw-success">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
            <h4>${t().success}</h4>
          </div>
        `;
        break;
    }

    // Update progress
    document.querySelectorAll('.hlw-progress-step').forEach(step => {
      const stepNum = parseInt(step.dataset.step);
      step.classList.toggle('active', stepNum <= currentStep);
    });

    // Attach event listeners
    attachStepListeners();
  };

  // Attach event listeners for current step
  const attachStepListeners = () => {
    const nextBtn = document.getElementById('hlw-next');
    const backBtn = document.getElementById('hlw-back');
    const submitBtn = document.getElementById('hlw-submit');
    const guestsPlus = document.getElementById('hlw-guests-plus');
    const guestsMinus = document.getElementById('hlw-guests-minus');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        saveStepData();
        currentStep++;
        renderStep();
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        saveStepData();
        currentStep--;
        renderStep();
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', handleSubmit);
    }

    if (guestsPlus) {
      guestsPlus.addEventListener('click', () => {
        if (formData.guests < 20) {
          formData.guests++;
          document.getElementById('hlw-guests-value').textContent = formData.guests;
        }
      });
    }

    if (guestsMinus) {
      guestsMinus.addEventListener('click', () => {
        if (formData.guests > 1) {
          formData.guests--;
          document.getElementById('hlw-guests-value').textContent = formData.guests;
        }
      });
    }
  };

  // Save data from current step
  const saveStepData = () => {
    switch(currentStep) {
      case 1:
        formData.checkin = document.getElementById('hlw-checkin')?.value || '';
        formData.checkout = document.getElementById('hlw-checkout')?.value || '';
        break;
      case 3:
        formData.name = document.getElementById('hlw-name')?.value || '';
        formData.email = document.getElementById('hlw-email')?.value || '';
        formData.phone = document.getElementById('hlw-phone')?.value || '';
        break;
    }
  };

  // Submit form
  const handleSubmit = async () => {
    saveStepData();

    // Validate
    if (!formData.name.trim()) {
      const errorEl = document.getElementById('hlw-error');
      if (errorEl) {
        errorEl.textContent = lang === 'he' ? 'שם הוא שדה חובה' : 'Name is required';
        errorEl.style.display = 'block';
      }
      return;
    }

    const submitBtn = document.getElementById('hlw-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
    }

    const fullUrl = `${apiUrl}/api/leads`;
    const payload = {
      hotel_id: hotelId,
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      guests: formData.guests,
      checkin: formData.checkin || null,
      checkout: formData.checkout || null,
      source: 'widget'
    };

    // Debug logging
    console.log('[Widget] Submitting lead to:', fullUrl);
    console.log('[Widget] Payload:', payload);

    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      console.log('[Widget] Response status:', response.status);
      console.log('[Widget] Response body:', responseText);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      currentStep = 4; // Success
      renderStep();

      // Reset and close after delay
      setTimeout(() => {
        closeWidget();
        resetForm();
      }, 3000);

    } catch (error) {
      console.error('[Widget] Submit error:', error);
      const errorEl = document.getElementById('hlw-error');
      if (errorEl) {
        errorEl.textContent = t().error + ' - ' + error.message;
        errorEl.style.display = 'block';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = t().submit;
      }
    }
  };

  // Reset form
  const resetForm = () => {
    currentStep = 1;
    formData = {
      checkin: '',
      checkout: '',
      guests: 2,
      name: '',
      email: '',
      phone: ''
    };
  };

  // Toggle widget open/close
  const toggleWidget = () => {
    isOpen = !isOpen;
    const popup = document.getElementById('hlw-popup');
    if (popup) {
      popup.classList.toggle('open', isOpen);
      if (isOpen) {
        renderStep();
      }
    }
  };

  const closeWidget = () => {
    isOpen = false;
    const popup = document.getElementById('hlw-popup');
    if (popup) {
      popup.classList.remove('open');
    }
  };

  // Initialize widget
  const init = () => {
    injectStyles();
    const container = createWidget();

    // Trigger button click
    container.querySelector('.hlw-trigger-btn').addEventListener('click', toggleWidget);

    // Close button click
    container.querySelector('.hlw-close-btn').addEventListener('click', closeWidget);

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (isOpen && !container.contains(e.target)) {
        closeWidget();
      }
    });
  };

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
