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

      // Atomic login — sets token, tenant, and role in one update so
      // setActiveTenantId never wipes the auth token mid-login.
      loginSuccess: (token, tenantId, userRole) => set({
        authToken: token,
        isAuthenticated: true,
        activeTenantId: tenantId || get().activeTenantId,
        role: userRole || 'host',
      }),

      tenants: [
        { id: 'demo', name: 'Active Portfolios' },
        { id: 'BAZAAR_JAFFA', name: 'Hotel Bazaar Jaffa' },
        { id: 'pilot-1', name: 'Pilot Group 1' },
        { id: 'pilot-2', name: 'Pilot Group 2' },
      ],
      activeTenantId: 'demo',
      // Only use setActiveTenantId for intentional tenant-switching (logs out).
      setActiveTenantId: (activeTenantId) => {
        try {
          localStorage.removeItem('admin_token');
        } catch (_) { /* ignore */ }
        set({ activeTenantId, authToken: null, isAuthenticated: false });
      },
      /** Set tenant without clearing auth — e.g. Bikta phone routing after field clock-in. */
      setActiveTenantIdKeepAuth: (activeTenantId) => set({ activeTenantId }),

      fieldLanguage: 'en',
      setFieldLanguage: (fieldLanguage) => set({ fieldLanguage }),

      staffProfile: { staffId: '', name: '', phone: '', goldPoints: 0, rank: null, rankTier: 'starter', language: '' },
      setStaffProfile: (profile) => set({ staffProfile: profile }),
      
      // Currency — USD default, configurable (ILS for Israeli market)
      currency: process.env.REACT_APP_CURRENCY || 'USD',
      setCurrency: (currency) => set({ currency }),

      // Language
      lang: 'en',
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
      
      // UI State — sidebar starts closed on mobile so it doesn't block the content
      sidebarOpen: typeof window !== 'undefined' && window.innerWidth < 768 ? false : true,
      mayaChatOpen: false,
      notificationsPanelOpen: false,
      
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleMayaChat: () => set((state) => ({ mayaChatOpen: !state.mayaChatOpen })),
      /** Explicit open/close (e.g. Bikta matrix — open Maya without toggling). */
      setMayaChatOpen: (open) => set({ mayaChatOpen: !!open }),
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

      /** Patch an existing message by id (used for live-streaming token append). */
      patchMayaMessage: (id, patch) =>
        set((state) => ({
          mayaMessages: state.mayaMessages.map((m) =>
            m.id === id ? { ...m, ...patch } : m
          ),
        })),

      /** Replace chat bubbles from server-backed maya_service history (cross-browser). */
      hydrateMayaChatFromServer: (rows) =>
        set(() => {
          const list = Array.isArray(rows) ? rows : [];
          if (!list.length) return {};
          const mapped = list.map((m, idx) => ({
            id: m.id != null ? m.id : `srv-${idx}-${m.timestamp || idx}`,
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
            timestamp: m.timestamp || new Date().toISOString(),
          }));
          return { mayaMessages: mapped };
        }),
      
      setMayaTyping: (isTyping) => set({ mayaIsTyping: isTyping }),

      /** Task / automation lines — not in main chat (Activity drawer). */
      mayaActivityLog: [],
      mayaBatchProcessing: false,
      setMayaBatchProcessing: (v) => set({ mayaBatchProcessing: !!v }),
      addMayaActivityEntry: (entry) =>
        set((state) => ({
          mayaActivityLog: [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              ts: new Date().toISOString(),
              ...entry,
            },
            ...state.mayaActivityLog,
          ].slice(0, 500),
        })),

      /** Reset Maya for Bikta (clears loop / stale context; server adds hospitality prompt). */
      resetMayaChatForBikta: () =>
        set({
          mayaIsTyping: false,
          mayaActivityLog: [],
          mayaMessages: [
            {
              id: Date.now(),
              role: 'assistant',
              content:
                'שלום! אני מאיה — העוזרת החכמה של הבקתה נס ציונה. איך אפשר לעזור היום?',
              timestamp: new Date().toISOString(),
            },
          ],
        }),

      /** Pilot: Hotel Bazaar Jaffa — Kobi / EasyHost greeting. */
      resetMayaChatForBazaar: () =>
        set({
          mayaIsTyping: false,
          mayaActivityLog: [],
          mayaMessages: [
            {
              id: Date.now(),
              role: 'assistant',
              content:
                'אהלן קובי, ניקיתי את כל נתוני הדמו. מלון בזאר מוכן עם 41 התמונות שלו. איך אפשר לעזור?',
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      
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
        { id: 101, name: 'Bazaar Jaffa — Superior', status: 'occupied', guest: 'יוסי לוי', checkOut: '2026-01-28', image: '/assets/images/hotels/bazaar/01.jpg' },
        { id: 102, name: 'Bazaar Jaffa — Deluxe', status: 'available', guest: null, checkOut: null, image: '/assets/images/hotels/bazaar/02.jpg' },
        { id: 103, name: 'Bazaar Jaffa — Junior Suite', status: 'cleaning', guest: null, checkOut: null, image: '/assets/images/hotels/bazaar/03.jpg' },
        { id: 104, name: 'Bazaar Jaffa — Sea View Deluxe', status: 'occupied', guest: 'מיכל אברהם', checkOut: '2026-01-30', image: '/assets/images/hotels/bazaar/04.jpg' },
        { id: 201, name: 'Bazaar Jaffa — Penthouse', status: 'maintenance', guest: null, checkOut: null, image: '/assets/images/hotels/bazaar/05.jpg' },
        { id: 202, name: 'Bazaar Jaffa — Classic', status: 'occupied', guest: 'רועי כהן', checkOut: '2026-01-26', image: '/assets/images/hotels/bazaar/06.jpg' },
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
        currency: state.currency,
        role: state.role,
        sidebarOpen: state.sidebarOpen,
        activeTenantId: state.activeTenantId,
        authToken: state.authToken,
        fieldLanguage: state.fieldLanguage,
        staffProfile: state.staffProfile,
        calendarMode: state.calendarMode,
        mayaChatPosition: state.mayaChatPosition,
      }),
      onRehydrateStorage: () => (_state, _error) => {
        queueMicrotask(() => {
          try {
            const s = useStore.getState();
            useStore.setState({
              hasHydrated: true,
              isAuthenticated: Boolean(s.authToken),
            });
          } catch (_) {}
        });
      },
    }
  )
);

if (typeof useStore?.persist?.onFinishHydration === 'function') {
  useStore.persist.onFinishHydration(() => {
    const s = useStore.getState();
    useStore.setState({
      hasHydrated: true,
      isAuthenticated: Boolean(s.authToken),
    });
  });
}

export default useStore;
