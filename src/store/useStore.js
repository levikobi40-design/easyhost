import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '../i18n';

// Main application store with Zustand
export const useStore = create(
  persist(
    (set, get) => ({
      // User & Auth State
      user: null,
      role: 'host', // 'host', 'operator', 'field'
      isAuthenticated: false,
      authToken: null,
      hasHydrated: false,
      market: process.env.REACT_APP_MARKET || 'US',
      setAuthToken: (authToken) => set({ authToken, isAuthenticated: Boolean(authToken) }),
      setUser: (user) => set({ user }),
      setRole: (role) => set({ role }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      tenants: [
        { id: 'demo', name: 'Demo Hotels' },
        { id: 'pilot-1', name: 'Pilot Group 1' },
        { id: 'pilot-2', name: 'Pilot Group 2' },
      ],
      activeTenantId: 'demo',
      setActiveTenantId: (activeTenantId) => set({ activeTenantId, authToken: null, isAuthenticated: false }),

      fieldLanguage: 'en',
      setFieldLanguage: (fieldLanguage) => set({ fieldLanguage }),

      staffProfile: { staffId: '', name: '', phone: '', goldPoints: 0, rank: null, rankTier: 'starter', language: '' },
      setStaffProfile: (profile) => set({ staffProfile: profile }),
      
      // Language
      lang: 'he',
      setLang: (lang) => {
        const market = get().market === 'IL' ? 'IL' : 'US';
        const allowed = market === 'IL' ? ['he', 'th', 'hi'] : ['en', 'he', 'es'];
        const nextLang = allowed.includes(lang) ? lang : allowed[0];
        i18n.changeLanguage(nextLang);
        if (typeof document !== 'undefined') {
          const dir = nextLang === 'he' ? 'rtl' : 'ltr';
          document.documentElement.dir = dir;
          document.body.dir = dir;
          document.documentElement.lang = nextLang;
        }
        set({ lang: nextLang });
      },
      
      // UI State
      sidebarOpen: true,
      mayaChatOpen: false,
      notificationsPanelOpen: false,
      
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleMayaChat: () => set((state) => ({ mayaChatOpen: !state.mayaChatOpen })),
      toggleNotifications: () => set((state) => ({ notificationsPanelOpen: !state.notificationsPanelOpen })),
      
      // Real-time Notifications
      notifications: [],
      unreadCount: 0,
      
      addNotification: (notification) => set((state) => ({
        notifications: [
          {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            read: false,
            ...notification,
          },
          ...state.notifications,
        ].slice(0, 100), // Keep last 100 notifications
        unreadCount: state.unreadCount + 1,
      })),
      
      markNotificationRead: (id) => set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      })),
      
      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
      
      // Agents State
      agents: {
        scraper: { status: 'online', lastAction: null, taskCount: 0, leadsFound: 0 },
        marketing: { status: 'online', lastAction: null, taskCount: 0, postsCreated: 0 },
        creative: { status: 'online', lastAction: null, taskCount: 0, assetsCreated: 0 },
        sales: { status: 'busy', lastAction: null, taskCount: 0, dealsInProgress: 0 },
        operations: { status: 'online', lastAction: null, taskCount: 0, messagessSent: 0 },
      },
      
      updateAgentStatus: (agentId, updates) => set((state) => ({
        agents: {
          ...state.agents,
          [agentId]: { ...state.agents[agentId], ...updates },
        },
      })),
      
      // Maya chat draggable position (persisted)
      mayaChatPosition: null,
      setMayaChatPosition: (pos) => set({ mayaChatPosition: pos }),

      // Maya context - last selected task for "send this to Kobi" etc.
      lastSelectedTask: null,
      setLastSelectedTask: (task) => set({ lastSelectedTask: task }),

      // Maya Chat State
      mayaMessages: [
        {
          id: 1,
          role: 'assistant',
          content: i18n.t('mayaChat.greeting'),
          timestamp: new Date().toISOString(),
        },
      ],
      mayaIsTyping: false,
      
      addMayaMessage: (message) => set((state) => ({
        mayaMessages: [
          ...state.mayaMessages,
          {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...message,
          },
        ],
      })),
      
      setMayaTyping: (isTyping) => set({ mayaIsTyping: isTyping }),
      
      // Leads CRM State
      leads: [],
      leadsFilter: 'all', // 'all', 'new', 'contacted', 'qualified', 'converted', 'lost'

      setLeads: (leads) => set({ leads }),
      
      addLead: (lead) => set((state) => ({
        leads: [
          {
            id: Date.now(),
            createdAt: new Date().toISOString(),
            status: 'new',
            source: 'airbnb',
            ...lead,
          },
          ...state.leads,
        ],
      })),
      
      updateLead: (id, updates) => set((state) => ({
        leads: state.leads.map((lead) =>
          lead.id === id ? { ...lead, ...updates } : lead
        ),
      })),
      
      setLeadsFilter: (filter) => set({ leadsFilter: filter }),
      
      // Dashboard Stats
      stats: {
        revenue: { today: 12500, week: 87500, month: 350000, trend: 12.5 },
        occupancy: { current: 87, average: 82, trend: 5.2 },
        bookings: { today: 8, week: 45, month: 180, trend: 8.3 },
        savings: { today: 2400, week: 16800, month: 67200, automationRate: 82 },
        agents: { activeTasksTotal: 24, completedToday: 156 },
      },

      // Automation Stats
      automationStats: {
        automated_messages: 0,
        last_scan: null,
        leads_total: 0,
      },
      objectionSuccess: {},
      
      updateStats: (updates) => set((state) => ({
        stats: { ...state.stats, ...updates },
      })),

      setAutomationStats: (automationStats) => set({
        automationStats: {
          automated_messages: automationStats?.automated_messages ?? 0,
          last_scan: automationStats?.last_scan ?? null,
          leads_total: automationStats?.leads_total ?? 0,
        },
      }),

      setObjectionSuccess: (objectionSuccess) => set({
        objectionSuccess: objectionSuccess || {},
      }),
      
      // Rooms State
      rooms: [
        { id: 101, name: 'Royal Suite', status: 'occupied', guest: 'David Cohen', checkOut: '2026-01-28', image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400' },
        { id: 102, name: 'Ocean Suite', status: 'available', guest: null, checkOut: null, image: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400' },
        { id: 103, name: 'Diamond Suite', status: 'cleaning', guest: null, checkOut: null, image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400' },
        { id: 104, name: 'Sunset Suite', status: 'occupied', guest: 'Sarah Miller', checkOut: '2026-01-30', image: 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=400' },
        { id: 201, name: 'VIP Penthouse', status: 'maintenance', guest: null, checkOut: null, image: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=400' },
        { id: 202, name: 'Modern Suite', status: 'occupied', guest: 'John Smith', checkOut: '2026-01-26', image: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=400' },
      ],
      
      updateRoom: (id, updates) => set((state) => ({
        rooms: state.rooms.map((room) =>
          room.id === id ? { ...room, ...updates } : room
        ),
      })),
      
      // Daily Report State
      dailyReport: null,
      isGeneratingReport: false,
      
      setDailyReport: (report) => set({ dailyReport: report }),
      setGeneratingReport: (isGenerating) => set({ isGeneratingReport: isGenerating }),

      calendarMode: 'ical', // 'ical' | 'manual'
      setCalendarMode: (calendarMode) => set({ calendarMode }),

      fieldTasks: [
        { id: 'task-1', title: 'Cleaning', room: '201', priority: 'high', status: 'open' },
        { id: 'task-2', title: 'Maintenance', room: '104', priority: 'medium', status: 'open' },
        { id: 'task-3', title: 'VIP Treats', room: '303', priority: 'high', status: 'open' },
      ],
      completeFieldTask: (taskId) => set((state) => ({
        fieldTasks: state.fieldTasks.map((task) =>
          task.id === taskId ? { ...task, status: 'completed' } : task
        ),
      })),
    }),
    {
      name: 'hotel-enterprise-storage',
      partialize: (state) => ({
        lang: state.lang,
        role: state.role,
        sidebarOpen: state.sidebarOpen,
        activeTenantId: state.activeTenantId,
        authToken: state.authToken,
        fieldLanguage: state.fieldLanguage,
        staffProfile: state.staffProfile,
        calendarMode: state.calendarMode,
        mayaChatPosition: state.mayaChatPosition,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export default useStore;
