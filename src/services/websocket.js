/**
 * WebSocket Service for Real-time Notifications
 * Handles bidirectional communication between client and server
 */

class WebSocketService {
  constructor() {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.listeners = new Map();
    this.isConnected = false;
    this.messageQueue = [];
  }

  /**
   * Connect to WebSocket server
   */
  connect(url = 'ws://127.0.0.1:5000/ws') {
    return new Promise((resolve, reject) => {
      try {
        // For development, we'll simulate WebSocket behavior
        // In production, use actual WebSocket or Socket.io
        console.log('[WebSocket] Connecting to:', url);
        
        // Simulate connection for now
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Start simulation of real-time events
        this.startEventSimulation();
        
        resolve(true);
      } catch (error) {
        console.error('[WebSocket] Connection error:', error);
        this.handleReconnect();
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.stopEventSimulation();
    console.log('[WebSocket] Disconnected');
  }

  /**
   * Subscribe to an event type
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);
    
    return () => this.off(eventType, callback);
  }

  /**
   * Unsubscribe from an event type
   */
  off(eventType, callback) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to the server
   */
  emit(eventType, data) {
    if (!this.isConnected) {
      console.warn('[WebSocket] Not connected, queueing message');
      this.messageQueue.push({ eventType, data });
      return;
    }

    const message = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
    
    // In production, send via actual WebSocket
    // this.socket.send(message);
    
    console.log('[WebSocket] Emitting:', eventType, data);
  }

  /**
   * Trigger event listeners
   */
  trigger(eventType, data) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }

  /**
   * Handle reconnection logic
   */
  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... Attempt ${this.reconnectAttempts}`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('[WebSocket] Max reconnection attempts reached');
      this.trigger('connection_failed', { message: 'Unable to connect to server' });
    }
  }

  /**
   * Start simulating real-time events for demo purposes
   */
  startEventSimulation() {
    // Simulate room service requests
    this.roomServiceInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        this.simulateRoomRequest();
      }
    }, 15000);

    // Simulate agent updates
    this.agentUpdateInterval = setInterval(() => {
      if (Math.random() > 0.5) {
        this.simulateAgentUpdate();
      }
    }, 20000);

    // Simulate new leads
    this.leadInterval = setInterval(() => {
      if (Math.random() > 0.8) {
        this.simulateNewLead();
      }
    }, 30000);
  }

  /**
   * Stop event simulation
   */
  stopEventSimulation() {
    clearInterval(this.roomServiceInterval);
    clearInterval(this.agentUpdateInterval);
    clearInterval(this.leadInterval);
  }

  /**
   * Simulate a room service request
   */
  simulateRoomRequest() {
    const rooms = [101, 102, 103, 104, 201, 202];
    const requests = [
      { type: 'towels', messageKey: 'notifications.messages.towels' },
      { type: 'cleaning', messageKey: 'notifications.messages.cleaning' },
      { type: 'room_service', messageKey: 'notifications.messages.roomService' },
      { type: 'maintenance', messageKey: 'notifications.messages.maintenance' },
    ];

    const room = rooms[Math.floor(Math.random() * rooms.length)];
    const request = requests[Math.floor(Math.random() * requests.length)];

    this.trigger('room_request', {
      id: Date.now(),
      room,
      type: request.type,
      messageKey: request.messageKey,
      messageValues: { room },
      priority: Math.random() > 0.7 ? 'high' : 'normal',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Simulate an agent status update
   */
  simulateAgentUpdate() {
    const agents = ['scraper', 'marketing', 'creative', 'sales', 'operations'];
    const actions = [
      'completed a task',
      'started a new task',
      'found a new lead',
      'sent a message',
      'created new content',
    ];

    const agent = agents[Math.floor(Math.random() * agents.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];

    this.trigger('agent_update', {
      id: Date.now(),
      agent,
      action,
      messageKey: 'notifications.messages.agentAction',
      messageValues: { agent, action },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Simulate a new lead
   */
  simulateNewLead() {
    const platforms = ['Airbnb', 'Booking.com', 'Direct'];
    const platform = platforms[Math.floor(Math.random() * platforms.length)];

    this.trigger('new_lead', {
      id: Date.now(),
      platform,
      propertyName: 'New property discovered',
      messageKey: 'notifications.messages.newLead',
      messageValues: { platform },
      priority: Math.random() > 0.5 ? 'hot' : 'warm',
      timestamp: new Date().toISOString(),
    });
  }
}

// Singleton instance
export const wsService = new WebSocketService();

export default wsService;
