import React, { useEffect, useState } from 'react';
import { MessageCircle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getMessages } from '../../services/api';
import './WhatsAppMonitor.css';

const WhatsAppMonitor = () => {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    let isActive = true;
    const loadMessages = async () => {
      try {
        const data = await getMessages(50);
        if (isActive) setMessages(data);
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };
    loadMessages();
    const interval = setInterval(loadMessages, 10000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="whatsapp-monitor glass-card">
      <div className="monitor-header">
        <h3><MessageCircle size={18} /> WhatsApp Monitor</h3>
        <span className="monitor-count">{messages.length} messages</span>
      </div>
      <div className="monitor-list">
        {messages.length === 0 ? (
          <div className="monitor-empty">No messages yet.</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`monitor-item ${msg.direction}`}>
              <div className="monitor-icon">
                {msg.direction === 'inbound' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
              </div>
              <div className="monitor-content">
                <span className="monitor-text">{msg.content}</span>
                <span className="monitor-time">{new Date(msg.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default WhatsAppMonitor;
