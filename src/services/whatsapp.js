/**
 * WhatsApp Integration Service
 * Uses Twilio or Meta Cloud API for sending messages
 */

import { API_BASE_URL } from '../utils/constants';

class WhatsAppService {
  constructor() {
    // In production, these would be securely stored
    this.twilioAccountSid = process.env.REACT_APP_TWILIO_ACCOUNT_SID;
    this.twilioAuthToken = process.env.REACT_APP_TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.REACT_APP_TWILIO_PHONE_NUMBER;
    this.metaAccessToken = process.env.REACT_APP_META_ACCESS_TOKEN;
    this.metaPhoneNumberId = process.env.REACT_APP_META_PHONE_NUMBER_ID;
    
    // Message templates for common operations
    this.templates = {
      leadGreeting: {
        he: (leadName, property) =>
          `שלום ${leadName || ''} 👋\n\nתודה על ההתעניינות ב-*${property}*.\nאני כאן כדי לעזור עם פרטים וזמינות.\n\nהאם תרצו שנבדוק תאריכים מועדפים?`,
        en: (leadName, property) =>
          `Hi ${leadName || ''} 👋\n\nThanks for your interest in *${property}*.\nI can help with details and availability.\n\nWould you like me to check preferred dates?`,
        el: (leadName, property) =>
          `Γεια ${leadName || ''} 👋\n\nΕυχαριστούμε για το ενδιαφέρον σας στο *${property}*.\nΜπορώ να βοηθήσω με λεπτομέρειες και διαθεσιμότητα.\n\nΘέλετε να ελέγξω προτιμώμενες ημερομηνίες;`,
      },
      towelRequest: {
        he: (room) => `🏨 *בקשה חדשה*\n\nמגבות נדרשות בחדר *${room}*\n\n⏰ אנא טפל בהקדם`,
        en: (room) => `🏨 *New Request*\n\nTowels needed in room *${room}*\n\n⏰ Please handle ASAP`,
      },
      cleaningRequest: {
        he: (room) => `🧹 *בקשת ניקיון*\n\nניקיון נדרש בחדר *${room}*\n\n⏰ אנא תאם עם הצוות`,
        en: (room) => `🧹 *Cleaning Request*\n\nCleaning needed in room *${room}*\n\n⏰ Please coordinate with team`,
      },
      maintenanceRequest: {
        he: (room, issue) => `🔧 *תחזוקה*\n\nבעיה בחדר *${room}*:\n${issue}\n\n⚠️ דחיפות גבוהה`,
        en: (room, issue) => `🔧 *Maintenance*\n\nIssue in room *${room}*:\n${issue}\n\n⚠️ High priority`,
      },
      checkout: {
        he: (room, guest) => `✅ *צ'ק-אאוט*\n\nחדר *${room}* התפנה\nאורח: ${guest}\n\n🧹 נא להתחיל בניקיון`,
        en: (room, guest) => `✅ *Checkout*\n\nRoom *${room}* is now available\nGuest: ${guest}\n\n🧹 Please begin cleaning`,
      },
      taskAssignment: {
        he: (task, room, deadline) => `📋 *משימה חדשה*\n\n${task}\nחדר: *${room}*\nזמן סיום: ${deadline}`,
        en: (task, room, deadline) => `📋 *New Task*\n\n${task}\nRoom: *${room}*\nDeadline: ${deadline}`,
      },
      urgentAlert: {
        he: (message) => `🚨 *התראה דחופה*\n\n${message}\n\n⚡ נדרשת פעולה מיידית`,
        en: (message) => `🚨 *Urgent Alert*\n\n${message}\n\n⚡ Immediate action required`,
      },
    };

    // Staff contact list (in production, fetch from database)
    this.staffContacts = [
      { id: 1, name: 'יוסי - משק בית', phone: '+972501234567', department: 'housekeeping' },
      { id: 2, name: 'דנה - תחזוקה', phone: '+972509876543', department: 'maintenance' },
      { id: 3, name: 'אבי - קבלה', phone: '+972505555555', department: 'reception' },
      { id: 4, name: 'מיכל - שירות חדרים', phone: '+972503333333', department: 'room_service' },
    ];
  }

  getAuthHeaders() {
    try {
      const raw = localStorage.getItem('hotel-enterprise-storage');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const token = parsed?.state?.authToken;
      const tenantId = parsed?.state?.activeTenantId;
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (tenantId) headers['X-Tenant-Id'] = tenantId;
      return headers;
    } catch (error) {
      return {};
    }
  }

  /**
   * Send WhatsApp message via Twilio
   */
  async sendViaTwilio(to, message) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          to,
          message,
          provider: 'twilio',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send WhatsApp message');
      }

      return await response.json();
    } catch (error) {
      console.error('[WhatsApp] Twilio send error:', error);
      // Fallback to simulation for demo
      return this.simulateSend(to, message);
    }
  }

  /**
   * Send WhatsApp message via Meta Cloud API
   */
  async sendViaMeta(to, message, templateName = null) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          to,
          message,
          templateName,
          provider: 'meta',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send WhatsApp message');
      }

      return await response.json();
    } catch (error) {
      console.error('[WhatsApp] Meta send error:', error);
      // Fallback to simulation for demo
      return this.simulateSend(to, message);
    }
  }

  /**
   * Simulate message sending for demo purposes
   */
  simulateSend(to, message) {
    console.log(`[WhatsApp Simulation] Sending to ${to}:`, message);
    
    return {
      success: true,
      messageId: `sim_${Date.now()}`,
      to,
      message,
      timestamp: new Date().toISOString(),
      status: 'delivered',
    };
  }

  /**
   * Send message to department
   */
  async sendToDepartment(department, message, lang = 'he') {
    const staffMembers = this.staffContacts.filter((s) => s.department === department);
    
    if (staffMembers.length === 0) {
      console.warn(`[WhatsApp] No staff found for department: ${department}`);
      return [];
    }

    const results = await Promise.all(
      staffMembers.map((staff) => this.sendViaTwilio(staff.phone, message))
    );

    return results;
  }

  /**
   * Send towel request notification
   */
  async notifyTowelRequest(room, lang = 'he') {
    const message = this.templates.towelRequest[lang](room);
    return this.sendToDepartment('housekeeping', message, lang);
  }

  /**
   * Send cleaning request notification
   */
  async notifyCleaningRequest(room, lang = 'he') {
    const message = this.templates.cleaningRequest[lang](room);
    return this.sendToDepartment('housekeeping', message, lang);
  }

  /**
   * Send maintenance request notification
   */
  async notifyMaintenanceRequest(room, issue, lang = 'he') {
    const message = this.templates.maintenanceRequest[lang](room, issue);
    return this.sendToDepartment('maintenance', message, lang);
  }

  /**
   * Send checkout notification
   */
  async notifyCheckout(room, guestName, lang = 'he') {
    const message = this.templates.checkout[lang](room, guestName);
    return this.sendToDepartment('housekeeping', message, lang);
  }

  /**
   * Send task assignment
   */
  async assignTask(staffId, task, room, deadline, lang = 'he') {
    const staff = this.staffContacts.find((s) => s.id === staffId);
    if (!staff) {
      throw new Error(`Staff member not found: ${staffId}`);
    }

    const message = this.templates.taskAssignment[lang](task, room, deadline);
    return this.sendViaTwilio(staff.phone, message);
  }

  /**
   * Send urgent alert to all staff
   */
  async sendUrgentAlert(alertMessage, lang = 'he') {
    const message = this.templates.urgentAlert[lang](alertMessage);
    
    const results = await Promise.all(
      this.staffContacts.map((staff) => this.sendViaTwilio(staff.phone, message))
    );

    return results;
  }

  /**
   * Send personalized greeting to a lead
   */
  async sendLeadGreeting(lead, lang = 'he') {
    if (!lead || !lead.phone) {
      console.warn('[WhatsApp] Lead missing phone, skipping greeting');
      return null;
    }

    const leadName = lead.contact || lead.name || '';
    const propertyName = lead.property || lead.name || 'your property';
    const template = this.templates.leadGreeting[lang] || this.templates.leadGreeting.en;
    const message = template(leadName, propertyName);

    return this.sendViaTwilio(lead.phone, message);
  }

  /**
   * Get message delivery status
   */
  async getMessageStatus(messageId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/whatsapp/status/${messageId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get message status');
      }

      return await response.json();
    } catch (error) {
      console.error('[WhatsApp] Status check error:', error);
      return { status: 'unknown', messageId };
    }
  }

  /**
   * Set up webhook for incoming messages
   */
  async setupWebhook(callbackUrl) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/whatsapp/webhook/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ callbackUrl }),
      });

      return await response.json();
    } catch (error) {
      console.error('[WhatsApp] Webhook setup error:', error);
      throw error;
    }
  }

  /**
   * Process incoming webhook message
   */
  processIncomingMessage(webhookData) {
    // Parse incoming WhatsApp message
    const { from, body, timestamp, type } = webhookData;

    return {
      from,
      message: body,
      timestamp: new Date(timestamp).toISOString(),
      type,
      processed: true,
    };
  }
}

// Singleton instance
export const whatsappService = new WhatsAppService();

export default whatsappService;
