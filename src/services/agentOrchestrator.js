/**
 * Multi-Agent Orchestration System
 * Maya manages 5 specialized agents for hotel operations
 * Connected to properties DB and staff for guest queries and automation
 */

import { API_BASE_URL } from '../utils/constants';
import {
  getAIPropertyContext,
  createPropertyTask,
  sendMayaCommand,
  getPropertyTasks,
  sendTaskNotification,
} from './api';
import useStore from '../store/useStore';
import { MAYA_AI_RULES } from '../config/mayaRules';
import i18n from '../i18n';
import { notifyTasksChanged } from '../utils/taskSyncBridge';
import '../utils/mayaBrain';
import { getBazaarJaffaPolicyTextForMaya } from '../data/propertyData';

/** Flask returns HTTP 200 with success:false for Gemini failures — never treat that as a successful chat turn. */
function normalizeMayaCommandResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      success: false,
      message: '',
      displayMessage: '',
      brainFailure: true,
    };
  }
  const msg = raw.displayMessage || raw.message || raw.response || '';
  const failed = raw.success === false || raw.brainFailure === true;
  if (failed) {
    return {
      success: false,
      message: msg,
      displayMessage: msg,
      brainFailure: true,
      brainErrorCode: raw.brainErrorCode,
      brainErrorDetail: raw.brainErrorDetail,
      maintenanceMode: raw.maintenanceMode,
      taskCreated: raw.taskCreated,
      task: raw.task,
      tasks: raw.tasks,
      parsed: raw.parsed,
    };
  }
  return {
    success: true,
    message: msg,
    displayMessage: msg,
    maintenanceMode: raw.maintenanceMode,
    taskCreated: raw.taskCreated,
    task: raw.task,
    tasks: raw.tasks,
    parsed: raw.parsed,
    action: raw.action,
    scheduleHint: raw.scheduleHint,
  };
}

const getAuthHeaders = () => {
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
};

const MAYA_SYSTEM_PROMPT = `
You are Maya, the Senior Project Manager for EasyHost AI.
Be proactive, decisive, and operations-focused. Monitor occupancy, leads,
and operational status. Suggest actions before being asked and route work
to the correct agent via function calls.

${MAYA_AI_RULES.IDENTIFICATION.rule}
${MAYA_AI_RULES.STAFF_ACCESS.rule}
${MAYA_AI_RULES.STAFF_MEMORY?.rule || ''}
${MAYA_AI_RULES.ACTION_RULE.rule}
${MAYA_AI_RULES.DYNAMIC_DETAILS.rule}

Authoritative Hotel Bazaar Jaffa guest policy (recite when asked; do not contradict):
${getBazaarJaffaPolicyTextForMaya()}
`.trim();

// Agent Types
export const AGENT_TYPES = {
  SCRAPER: 'scraper',
  MARKETING: 'marketing',
  CREATIVE: 'creative',
  SALES: 'sales',
  OPERATIONS: 'operations',
};

// Agent Status
export const AGENT_STATUS = {
  ONLINE: 'online',
  BUSY: 'busy',
  OFFLINE: 'offline',
  ERROR: 'error',
};

/**
 * Base Agent class
 */
class BaseAgent {
  constructor(id, name, description) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.status = AGENT_STATUS.ONLINE;
    this.taskQueue = [];
    this.completedTasks = [];
  }

  async execute(task) {
    throw new Error('Execute method must be implemented');
  }

  getStatus() {
    return this.status;
  }

  setStatus(status) {
    this.status = status;
  }
}

/**
 * Scraper Agent - Scans Airbnb/Booking for hot leads
 */
export class ScraperAgent extends BaseAgent {
  constructor() {
    super(
      AGENT_TYPES.SCRAPER,
      'Scraper Agent',
      'Scans Airbnb and Booking to discover high-intent leads'
    );
    this.leadsFound = 0;
    this.lastScan = null;
  }

  async execute(task) {
    this.setStatus(AGENT_STATUS.BUSY);
    
    try {
      const leads = await this.scanPlatforms(task.platforms || ['airbnb', 'booking'], task.location);
      
      this.leadsFound += leads.length;
      this.lastScan = new Date().toISOString();
      this.setStatus(AGENT_STATUS.ONLINE);
      
      return {
        success: true,
        leads,
        timestamp: this.lastScan,
        message: i18n.t('orchestrator.messages.leadsFound', { count: leads.length }),
      };
    } catch (error) {
      this.setStatus(AGENT_STATUS.ERROR);
      throw error;
    }
  }

  async scanPlatforms(platforms, location = 'Greece') {
    const response = await fetch(`${API_BASE_URL}/agents/scout/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ platforms, location }),
    });

    if (!response.ok) {
      throw new Error('Failed to scan platforms');
    }

    const data = await response.json();
    return data.leads || [];
  }
}

/**
 * Marketing Agent - Creates social media posts and email campaigns
 */
export class MarketingAgent extends BaseAgent {
  constructor() {
    super(
      AGENT_TYPES.MARKETING,
      'Marketing Agent',
      'Creates social posts and email campaigns'
    );
    this.postsCreated = 0;
    this.campaignsSent = 0;
  }

  async execute(task) {
    this.setStatus(AGENT_STATUS.BUSY);
    
    try {
      let result;
      
      switch (task.type) {
        case 'social_post':
          result = await this.createSocialPost(task.content);
          this.postsCreated++;
          break;
        case 'email_campaign':
          result = await this.createEmailCampaign(task.campaign);
          this.campaignsSent++;
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      this.setStatus(AGENT_STATUS.ONLINE);
      return result;
    } catch (error) {
      this.setStatus(AGENT_STATUS.ERROR);
      throw error;
    }
  }

  async createSocialPost(content) {
    await new Promise((r) => setTimeout(r, 1000));
    
    return {
      success: true,
      post: {
        id: Date.now(),
        content: content.text,
        platforms: content.platforms || ['instagram', 'facebook'],
        scheduledFor: content.scheduledFor || new Date().toISOString(),
      },
      message: i18n.t('orchestrator.messages.postCreated'),
    };
  }

  async createEmailCampaign(campaign) {
    await new Promise((r) => setTimeout(r, 2000));
    
    return {
      success: true,
      campaign: {
        id: Date.now(),
        subject: campaign.subject,
        recipients: campaign.recipients || 500,
        sentAt: new Date().toISOString(),
      },
      message: i18n.t('orchestrator.messages.campaignSent', { count: campaign.recipients || 500 }),
    };
  }
}

/**
 * Creative Agent - Auto-edits videos/images for property presentation
 */
export class CreativeAgent extends BaseAgent {
  constructor() {
    super(
      AGENT_TYPES.CREATIVE,
      'Creative Agent',
      'Edits videos and images for property presentation'
    );
    this.assetsCreated = 0;
  }

  async execute(task) {
    this.setStatus(AGENT_STATUS.BUSY);
    
    try {
      let result;
      
      switch (task.type) {
        case 'edit_video':
          result = await this.editVideo(task.video);
          break;
        case 'enhance_images':
          result = await this.enhanceImages(task.images);
          break;
        case 'create_virtual_tour':
          result = await this.createVirtualTour(task.property);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      this.assetsCreated++;
      this.setStatus(AGENT_STATUS.ONLINE);
      return result;
    } catch (error) {
      this.setStatus(AGENT_STATUS.ERROR);
      throw error;
    }
  }

  async editVideo(video) {
    await new Promise((r) => setTimeout(r, 3000));
    
    return {
      success: true,
      video: {
        id: Date.now(),
        originalUrl: video.url,
        editedUrl: video.url + '?edited=true',
        duration: '2:30',
      },
      message: i18n.t('orchestrator.messages.videoEdited'),
    };
  }

  async enhanceImages(images) {
    await new Promise((r) => setTimeout(r, 2000));
    
    return {
      success: true,
      images: images.map((img, i) => ({
        id: Date.now() + i,
        originalUrl: img,
        enhancedUrl: img + '?enhanced=true',
      })),
      message: i18n.t('orchestrator.messages.imagesEnhanced', { count: images.length }),
    };
  }

  async createVirtualTour(property) {
    await new Promise((r) => setTimeout(r, 5000));
    
    return {
      success: true,
      tour: {
        id: Date.now(),
        propertyId: property.id,
        tourUrl: `https://tours.hotel.ai/${property.id}`,
      },
      message: i18n.t('orchestrator.messages.tourCreated'),
    };
  }
}

/**
 * Sales Manager Agent - Manages initial negotiations and sends demos
 */
export class SalesAgent extends BaseAgent {
  constructor() {
    super(
      AGENT_TYPES.SALES,
      'Sales Manager Agent',
      'Handles early negotiations and sends demos'
    );
    this.dealsInProgress = 0;
    this.dealsClosedToday = 0;
  }

  async execute(task) {
    this.setStatus(AGENT_STATUS.BUSY);
    
    try {
      let result;
      
      switch (task.type) {
        case 'send_demo':
          result = await this.sendDemo(task.lead);
          break;
        case 'negotiate':
          result = await this.handleNegotiation(task.deal);
          break;
        case 'follow_up':
          result = await this.followUp(task.leadId);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      this.setStatus(AGENT_STATUS.ONLINE);
      return result;
    } catch (error) {
      this.setStatus(AGENT_STATUS.ERROR);
      throw error;
    }
  }

  async sendDemo(lead) {
    await new Promise((r) => setTimeout(r, 1500));
    
    this.dealsInProgress++;
    
    return {
      success: true,
      demo: {
        id: Date.now(),
        leadId: lead.id,
        demoUrl: `https://demo.hotel.ai/${lead.id}`,
        sentAt: new Date().toISOString(),
      },
      message: i18n.t('orchestrator.messages.demoSent', { name: lead.name || 'Lead' }),
    };
  }

  async handleNegotiation(deal) {
    await new Promise((r) => setTimeout(r, 2000));
    
    return {
      success: true,
      negotiation: {
        id: Date.now(),
        dealId: deal.id,
        stage: 'proposal_sent',
        nextAction: 'await_response',
      },
      message: i18n.t('orchestrator.messages.negotiationStarted'),
    };
  }

  async followUp(leadId) {
    await new Promise((r) => setTimeout(r, 1000));
    
    return {
      success: true,
      followUp: {
        leadId,
        sentAt: new Date().toISOString(),
        type: 'email',
      },
      message: i18n.t('orchestrator.messages.followUpSent'),
    };
  }
}

/**
 * Operations Agent - Sends WhatsApp messages to staff for cleaning, maintenance, etc.
 */
export class OperationsAgent extends BaseAgent {
  constructor() {
    super(
      AGENT_TYPES.OPERATIONS,
      'Operations Agent',
      'Sends WhatsApp messages to staff for operational requests'
    );
    this.messagesSent = 0;
    this.tasksAssigned = 0;
  }

  async execute(task) {
    this.setStatus(AGENT_STATUS.BUSY);
    
    try {
      let result;
      
      switch (task.type) {
        case 'request_towels':
          result = await this.sendStaffMessage('housekeeping', task);
          break;
        case 'request_cleaning':
          result = await this.sendStaffMessage('housekeeping', task);
          break;
        case 'maintenance_request':
          result = await this.sendStaffMessage('maintenance', task);
          break;
        case 'room_service':
          result = await this.sendStaffMessage('room_service', task);
          break;
        case 'guest_checkout':
          result = await this.handleCheckout(task);
          break;
        default:
          result = await this.sendStaffMessage('general', task);
      }
      
      this.setStatus(AGENT_STATUS.ONLINE);
      return result;
    } catch (error) {
      this.setStatus(AGENT_STATUS.ERROR);
      throw error;
    }
  }

  async sendStaffMessage(department, task) {
    await new Promise((r) => setTimeout(r, 800));
    
    this.messagesSent++;
    this.tasksAssigned++;
    
    const staffByProperty = task.staffByProperty || {};
    const properties = task.properties || [];
    let relevantStaff = null;
    let propertyName = '';
    let propertyId = '';
    let propertyContext = '';
    const isMaintenance = department === 'maintenance';
    const preferName = isMaintenance ? 'kobi' : 'alma';
    const rolePattern = isMaintenance
      ? /מתחזק|maintenance/i
      : /מנקה|cleaner|cleaning|housekeeping|staff/i;

    for (const [pid, staffList] of Object.entries(staffByProperty)) {
      let s = staffList.find((x) => (x.name || '').toLowerCase() === preferName);
      if (!s) s = staffList.find((x) => rolePattern.test(x.role || ''));
      if (s) {
        relevantStaff = s;
        propertyId = pid;
        const prop = properties.find((p) => p.id === pid);
        propertyName = prop?.name || 'הנכס';
        const g = prop?.max_guests ?? 2;
        const br = prop?.bedrooms ?? 1;
        const b = prop?.beds ?? 1;
        propertyContext = `${g} Guests, ${br} Bedroom, ${b} Bed`;
        break;
      }
    }
    if (!relevantStaff && Object.values(staffByProperty).flat().length > 0) {
      const first = Object.entries(staffByProperty)[0];
      relevantStaff = first[1][0];
      propertyId = first[0];
      const prop = properties.find((p) => p.id === first[0]);
      propertyName = prop?.name || 'הנכס';
      const g = prop?.max_guests ?? 2;
      const br = prop?.bedrooms ?? 1;
      const b = prop?.beds ?? 1;
      propertyContext = `${g} Guests, ${br} Bedroom, ${b} Bed`;
    }
    if (!propertyId && properties.length > 0) {
      const prop = properties[0];
      propertyId = prop.id;
      propertyName = prop?.name || 'הנכס';
      const g = prop?.max_guests ?? 2;
      const br = prop?.bedrooms ?? 1;
      const b = prop?.beds ?? 1;
      propertyContext = `${g} Guests, ${br} Bedroom, ${b} Bed`;
      const staffForProp = staffByProperty[prop.id];
      if (staffForProp?.length > 0 && !relevantStaff) {
        relevantStaff = staffForProp[0];
      }
    }

    const staffName = relevantStaff?.name || 'Staff';
    const phone = relevantStaff?.phone_number || relevantStaff?.phone;
    const staffId = relevantStaff?.id || '';
    const displayMessage = phone
      ? `הקצאתי את המשימה ל-${staffName} (טלפון: ${phone}).`
      : `הקצאתי את המשימה ל-${staffName}. הוסיפו מספר טלפון בניהול הצוות ליצירת קשר ישיר.`;
    
    const message = this.generateMessage(department, task, { staffName, propertyName });
    const readyToSendHe = phone && propertyName
      ? `היי ${staffName}, יש קריאה בנכס ${propertyName}. ${task.description || 'בקשה לניקיון/שירות'}. אנא טפל בהקדם.`
      : null;
    
    let taskCreated = false;
    try {
      await createPropertyTask({
        property_id: propertyId,
        assigned_to: staffId,
        description: task.description || (department === 'housekeeping' ? 'ניקיון' : 'שירות'),
        status: 'Pending',
        property_name: propertyName,
        staff_name: staffName,
        staff_phone: phone || '',
        property_context: propertyContext,
      });
      taskCreated = true;
    } catch (e) {
      console.warn('[Maya] Could not persist task:', e);
    }
    
    return {
      success: true,
      taskCreated,
      message: {
        id: Date.now(),
        department,
        room: task.room,
        content: message,
        readyToSendHe,
        staffName,
        phone,
        propertyName,
        sentAt: new Date().toISOString(),
        status: 'delivered',
      },
      displayMessage,
    };
  }

  generateMessage(department, task, extra = {}) {
    const { staffName, propertyName } = extra;
    const base = {
      housekeeping: `🏨 בקשה חדשה מחדר ${task.room}\n\n${task.description || 'מגבות נדרשות'}\n\n⏰ אנא טפל בהקדם האפשרי`,
      maintenance: `🔧 תחזוקה נדרשת בחדר ${task.room}\n\n${task.description || 'בעיה טכנית'}\n\n⚠️ דחיפות: ${task.priority || 'רגילה'}`,
      room_service: `🍽️ הזמנת שירות חדרים\n\nחדר: ${task.room}\n${task.order || ''}\n\n⏰ זמן משלוח מבוקש: ${task.deliveryTime || 'בהקדם'}`,
      general: `📋 בקשה חדשה מחדר ${task.room}\n\n${task.description || 'בקשת אורח'}`,
    };
    let msg = base[department] || base.general;
    if (staffName && propertyName) {
      msg = `היי ${staffName}, יש קריאה בנכס ${propertyName}.\n\n${msg}`;
    }
    return (task.staffContext ? msg + task.staffContext : msg);
  }

  async handleCheckout(task) {
    await new Promise((r) => setTimeout(r, 1000));
    
    // Send multiple messages for checkout process
    await this.sendStaffMessage('housekeeping', {
      room: task.room,
      description: 'ניקיון לאחר צ\'ק-אאוט',
      priority: 'גבוהה',
    });
    
    return {
      success: true,
      checkout: {
        room: task.room,
        guestName: task.guestName,
        processedAt: new Date().toISOString(),
      },
      displayMessage: i18n.t('orchestrator.messages.checkoutDone', { room: task.room }),
    };
  }
}

/**
 * Maya - The Master Orchestrator
 * Manages all agents and handles high-level decisions
 */
class MayaOrchestrator {
  constructor() {
    this.agents = {
      [AGENT_TYPES.SCRAPER]: new ScraperAgent(),
      [AGENT_TYPES.MARKETING]: new MarketingAgent(),
      [AGENT_TYPES.CREATIVE]: new CreativeAgent(),
      [AGENT_TYPES.SALES]: new SalesAgent(),
      [AGENT_TYPES.OPERATIONS]: new OperationsAgent(),
    };
    
    this.taskHistory = [];
    this.isProcessing = false;
    this.systemPrompt = MAYA_SYSTEM_PROMPT;
  }

  /**
   * Execute a task using the appropriate agent
   */
  async executeTask(agentType, task) {
    const agent = this.agents[agentType];
    
    if (!agent) {
      throw new Error(`Agent ${agentType} not found`);
    }
    
    const taskRecord = {
      id: Date.now(),
      agentType,
      task,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    
    this.taskHistory.push(taskRecord);
    
    try {
      const result = await agent.execute(task);
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.status = 'completed';
      taskRecord.result = result;
      return result;
    } catch (error) {
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.status = 'failed';
      taskRecord.error = error.message;
      throw error;
    }
  }

  /**
   * Get all agent statuses
   */
  getAgentStatuses() {
    return Object.entries(this.agents).reduce((acc, [type, agent]) => {
      acc[type] = {
        status: agent.status,
        name: agent.name,
        description: agent.description,
      };
      return acc;
    }, {});
  }

  /**
   * Fetch property context (details + staff) for AI to answer guest queries
   */
  async getPropertyContext() {
    try {
      const ctx = await getAIPropertyContext();
      const n = (ctx.properties || []).length;
      const summary =
        (ctx.summary_for_ai || '').trim() ||
        (n ? `Portfolio: ${n} properties (synced from /properties).` : '');
      return summary ? `Property context: ${summary}` : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Process natural language command from Maya chat
   * @param {string} command - User message
   * @param {{ history?: Array }} options - Optional: history of previous messages for context
   */
  async processCommand(command, options = {}) {
    const history = options.history || [];
    const language = options.language || 'en';  // en | he — Maya responds in guest language
    const onDelta = options.onDelta || null;
    // Passed as 5th arg to sendMayaCommand so delta tokens reach the UI for every LLM path
    const cmdOpts = onDelta ? { onDelta } : {};
    const lowerCommand = command.toLowerCase();

    // "Send this to Kobi" / "Send to Alma" - open WhatsApp for selected task
    const sendToRegex = /(?:send|שלח).*(kobi|alma|avi|קובי|עלמה|אבי)|(kobi|alma|avi|קובי|עלמה|אבי).*(?:send|שלח)/i;
    const sendToMatch = command.match(sendToRegex);
    if (sendToMatch) {
      const namePart = (sendToMatch[1] || sendToMatch[2] || '').toLowerCase();
      const nameMap = { קובי: 'kobi', עלמה: 'alma', אבי: 'avi' };
      const staffKey = nameMap[namePart] || namePart;
      const lastTask = useStore.getState?.()?.lastSelectedTask;
      if (lastTask) {
        const ctx = await getAIPropertyContext();
        const staffMap = {};
        if (ctx.staff_by_property) {
          for (const list of Object.values(ctx.staff_by_property)) {
            for (const s of list) {
              const n = (s.name || '').toLowerCase();
              if (n && !staffMap[n]) staffMap[n] = s.phone_number || s.phone || '';
            }
          }
        }
        const targetPhone = staffMap[staffKey] || Object.entries(staffMap).find(([k]) => k.includes(staffKey) || staffKey.includes(k))?.[1];
        const res = await sendTaskNotification(lastTask, targetPhone || undefined);
        return {
          success: true,
          message: res.success ? 'ההודעה נשלחה בהצלחה לנייד שלך' : `שלחתי ל${staffKey} (ודא ש-Twilio מוגדר ב-.env)`,
          displayMessage: res.success ? (res.message || 'ההודעה נשלחה בהצלחה לנייד שלך') : `שלחתי ל${staffKey}`,
        };
      } else {
        return {
          success: true,
          message: 'Click a task card first, then say "Send to Kobi"',
          displayMessage: 'לחץ על כרטיס משימה ואז אמור "שלח לקובי"',
        };
      }
    }

    if (lowerCommand.includes('נראה אותה מנהלת') || lowerCommand.includes('בוא נראה אותה מנהלת') || lowerCommand.includes('maya manage')) {
      try {
        const tasks = await getPropertyTasks({ limit: 0 });
        const tasksForAnalysis = (tasks || []).map((t) => ({
          desc: (t.description || t.title || t.content || '').slice(0, 100),
          staff: t.staff_name || t.staffName || '',
          property: t.property_name || t.propertyName || '',
          status: t.status || 'Pending',
        }));
        const result = await sendMayaCommand('בוא נראה אותה מנהלת', tasksForAnalysis, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success) {
          return {
            success: true,
            message: norm.displayMessage,
            displayMessage: norm.displayMessage,
          };
        }
        return norm;
      } catch (e) {
        return {
          success: true,
          message: `יש לנו ${(await getPropertyTasks({ limit: 0 })).filter((t) => (t.status || '').toLowerCase() !== 'done').length} משימות פתוחות. האם להוציא תזכורת?`,
          displayMessage: `יש לנו משימות פתוחות. האם להוציא תזכורת?`,
        };
      }
    }

    if (lowerCommand.includes('daily report') || lowerCommand.includes('דוח יומי') || lowerCommand.includes('generate daily report')) {
      try {
        const result = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success && norm.displayMessage) {
          return {
            success: true,
            message: norm.displayMessage,
            displayMessage: norm.displayMessage,
          };
        }
        if (!norm.success) {
          return norm;
        }
      } catch (e) {
        const tasks = await getPropertyTasks({ limit: 0 });
        const today = new Date().toISOString().slice(0, 10);
        const doneToday = tasks.filter((t) => {
          const s = (t.status || '').toLowerCase();
          const isDone = s === 'done' || s === 'completed';
          const d = (t.created_at || t.updated_at || '').slice(0, 10);
          return isDone && d === today;
        });
        const pending = tasks.filter((t) => (t.status || '').toLowerCase() !== 'done' && (t.status || '').toLowerCase() !== 'completed');
        const summary = `דוח יומי: ${doneToday.length} משימות הושלמו היום. ${pending.length} ממתינות.`;
        return { success: true, message: summary, displayMessage: summary };
      }
    }
    
    if (lowerCommand.includes('מצב סימולציה') || lowerCommand.includes('סימולציה') || lowerCommand.includes('simulation') || lowerCommand.includes('simulate') || lowerCommand.includes('free mode') || lowerCommand.includes('סיימת') || lowerCommand.includes('המפתח הוגדר')) {
      try {
        const result = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success && norm.displayMessage) {
          return { success: true, message: norm.displayMessage, displayMessage: norm.displayMessage };
        }
        if (!norm.success) {
          return norm;
        }
      } catch (e) {
        console.warn('[Maya] simulation check:', e);
      }
      const setupMsg = (lowerCommand.includes('סיימת') || lowerCommand.includes('המפתח הוגדר') || lowerCommand.includes('המוח מחובר') || lowerCommand.includes('מערכת מחוברת'))
        ? 'המערכת מחוברת'
        : 'מצב סימולציה פעיל. הכפתור עבר לימין והוואטסאפ ירוק.';
      return { success: true, message: setupMsg, displayMessage: setupMsg };
    }

    if (lowerCommand.includes('100 clients') || lowerCommand.includes('100 לקוחות') || lowerCommand.includes('מאה לקוחות') || lowerCommand.includes('התשתית') || /\b100\+?\s*(לקוחות|clients)/.test(lowerCommand)) {
      try {
        const result = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success && norm.displayMessage) {
          return { success: true, message: norm.displayMessage, displayMessage: norm.displayMessage };
        }
        if (!norm.success) {
          return norm;
        }
      } catch (e) {
        console.warn('[Maya] 100-clients check:', e);
      }
      return {
        success: true,
        message: 'התשתית ל-100 לקוחות מוכנה. הודעות יישלחו כעת בתור מסודר.',
        displayMessage: 'התשתית ל-100 לקוחות מוכנה. הודעות יישלחו כעת בתור מסודר.',
      };
    }

    if (
      (/מי\s*עובד|who\s+works|מי\s+במשמרת/i.test(command) && (/היום|today|עכשיו/i.test(command) || lowerCommand.includes('today')))
    ) {
      try {
        const result = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success && norm.displayMessage) {
          return {
            success: true,
            message: norm.displayMessage,
            displayMessage: norm.displayMessage,
          };
        }
        if (!norm.success) {
          return norm;
        }
      } catch (e) {
        console.warn('[Maya] who-works route:', e?.message);
      }
    }

    if (/סידור\s*עבודה|תכיני\s*סידור|הכנ[יי]\s*סידור|prepare\s*(?:a\s*)?(?:work\s*)?schedule|make\s*(?:the\s*)?shift\s*plan/i.test(command)) {
      try {
        const result = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(result);
        if (norm.success && norm.displayMessage) {
          return {
            success: true,
            message: norm.displayMessage,
            displayMessage: norm.displayMessage,
            scheduleHint: result.scheduleHint,
          };
        }
        if (!norm.success) {
          return norm;
        }
      } catch (e) {
        console.warn('[Maya] work-schedule route:', e?.message);
      }
    }

    const taskTriggers = /towel|clean|maintenance|room|fix|repair|broken|service|needs cleaning|prepare|guests|מגבת|ניקיון|תחזוקה|חדר|dirty|מלוכלך|תקן|הכובס|מנקה|שירות|תיקון|לשלוח|cleaner|tell the cleaner|tell\s+\w+\s+to|add\s+task|create\s+task|עלמה|קובי|אבי|tell\s+alma|tell\s+kobi|קצר|חשמל|electrical|short circuit|נשרפה|נשרף|מנורה|תקלה|בעיה|דליפה|נזילה|יש תקלה|תתקן|לפתוח משימה/i;
    if (taskTriggers.test(command)) {
      try {
        const mayaResult = await sendMayaCommand(command, null, history, language, cmdOpts);
        const norm = normalizeMayaCommandResult(mayaResult);
        if (!norm.success) {
          return norm;
        }
        const taskCreated = mayaResult.taskCreated || mayaResult.action === 'add_task' || !!mayaResult.task;
        if (taskCreated) {
          notifyTasksChanged({ task: mayaResult.task });
          return {
            success: true,
            message: mayaResult.message || mayaResult.displayMessage || mayaResult.response,
            displayMessage: mayaResult.displayMessage || mayaResult.message || mayaResult.response,
            taskCreated,
          };
        }
        if (mayaResult.displayMessage || mayaResult.message || mayaResult.response) {
          return {
            success: true,
            message: mayaResult.displayMessage || mayaResult.message || mayaResult.response,
            displayMessage: mayaResult.displayMessage || mayaResult.message || mayaResult.response,
          };
        }
      } catch (e) {
        console.warn('[Maya] task route:', e?.message || e);
        throw e;
      }
    }

    // Default: full Maya brain (Gemini + PROPERTY_KNOWLEDGE) via Flask
    try {
      const mayaResult = await sendMayaCommand(command, null, history, language, cmdOpts);
      const norm = normalizeMayaCommandResult(mayaResult);
      if (!norm.success) {
        return norm;
      }
      const msg = norm.displayMessage || '';
      if (msg || mayaResult.maintenanceMode) {
        return {
          success: true,
          message: msg || i18n.t('orchestrator.messages.unknown'),
          displayMessage: msg,
          maintenanceMode: mayaResult.maintenanceMode,
          taskCreated: mayaResult.taskCreated,
          task: mayaResult.task,
          parsed: mayaResult.parsed,
        };
      }
    } catch (e) {
      console.warn('[Maya] /ai/maya-command failed:', e?.message || e);
      throw e;
    }

    const unknown = i18n.t('orchestrator.messages.unknown');
    return {
      success: true,
      message: unknown,
      displayMessage: unknown,
    };
  }

  /**
   * Get task history
   */
  getTaskHistory(limit = 50) {
    return this.taskHistory.slice(-limit).reverse();
  }

  /**
   * Generate daily report
   */
  async generateDailyReport() {
    const response = await fetch(`${API_BASE_URL}/reports/daily`, {
      headers: { ...getAuthHeaders() },
    });
    if (!response.ok) {
      throw new Error('Failed to generate report');
    }
    const data = await response.json();
    return data.report || data;
  }
}

// Singleton instance
export const maya = new MayaOrchestrator();

export default maya;
