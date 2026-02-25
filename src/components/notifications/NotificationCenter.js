import React, { useEffect } from 'react';
import {
  Bell, X, CheckCircle2, AlertTriangle, Info,
  Zap, MessageCircle, User, Trash2
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { wsService } from '../../services/websocket';
import './NotificationCenter.css';

const NotificationCenter = () => {
  const {
    notifications,
    unreadCount,
    notificationsPanelOpen,
    toggleNotifications,
    addNotification,
    markNotificationRead,
    clearNotifications,
  } = useStore();
  const { t, i18n } = useTranslations();

  // Subscribe to WebSocket events
  useEffect(() => {
    // Connect to WebSocket
    wsService.connect();

    // Subscribe to room requests
    const unsubRoom = wsService.on('room_request', (data) => {
      addNotification({
        type: data.priority === 'high' ? 'warning' : 'info',
        title: t('notifications.roomRequest'),
        message: data.message,
        data,
      });
    });

    // Subscribe to agent updates
    const unsubAgent = wsService.on('agent_update', (data) => {
      addNotification({
        type: 'success',
        title: t('notifications.agentUpdate'),
        message: data.message,
        data,
      });
    });

    // Subscribe to new leads
    const unsubLead = wsService.on('new_lead', (data) => {
      addNotification({
        type: data.priority === 'hot' ? 'warning' : 'info',
        title: t('notifications.newLead'),
        message: data.message,
        data,
      });
    });

    return () => {
      unsubRoom();
      unsubAgent();
      unsubLead();
      wsService.disconnect();
    };
  }, [addNotification]);

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 size={20} />;
      case 'warning':
        return <AlertTriangle size={20} />;
      case 'error':
        return <X size={20} />;
      default:
        return <Info size={20} />;
    }
  };

  const getTimeAgo = (timestamp) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    const locale = i18n.language === 'he' ? 'he-IL' : i18n.language === 'el' ? 'el-GR' : 'en-US';
    if (diffMins < 1) return t('notifications.time.now');
    if (diffMins < 60) return t('notifications.time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('notifications.time.hoursAgo', { count: diffHours });
    return then.toLocaleDateString(locale);
  };

  return (
    <>
      {/* Notification Bell */}
      <button
        onClick={toggleNotifications}
        className="notification-bell"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {notificationsPanelOpen && (
        <>
          <div
            className="notification-backdrop"
            onClick={toggleNotifications}
          />
          <div className="notification-panel glass-dark">
              <div className="panel-header">
                <h3>
                  <Bell size={20} />
                  {t('notifications.title')}
                  {unreadCount > 0 && (
                    <span className="unread-count">{t('notifications.newCount', { count: unreadCount })}</span>
                  )}
                </h3>
                <div className="panel-actions">
                  {notifications.length > 0 && (
                    <button onClick={clearNotifications} className="clear-btn">
                      <Trash2 size={16} />
                      {t('notifications.clearAll')}
                    </button>
                  )}
                  <button onClick={toggleNotifications} className="close-panel-btn">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="notifications-list">
                {notifications.length === 0 ? (
                  <div className="no-notifications">
                    <Bell size={48} />
                    <p>{t('notifications.empty')}</p>
                  </div>
                ) : (
                  <>
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => markNotificationRead(notification.id)}
                        className={`notification-item ${notification.type} ${
                          notification.read ? 'read' : 'unread'
                        }`}
                      >
                        <div className={`notification-icon ${notification.type}`}>
                          {getIcon(notification.type)}
                        </div>
                        <div className="notification-content">
                          <div className="notification-header">
                            <span className="notification-title">
                              {notification.title}
                            </span>
                            <span className="notification-time">
                              {getTimeAgo(notification.timestamp)}
                            </span>
                          </div>
                          <p className="notification-message">
                            {notification.messageKey
                              ? t(notification.messageKey, notification.messageValues || {})
                              : notification.message}
                          </p>
                        </div>
                        {!notification.read && <div className="unread-dot" />}
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="panel-footer">
                <div className="connection-status">
                  <span className="status-indicator online" />
                  <span>{t('notifications.connected')}</span>
                </div>
              </div>
          </div>
        </>
      )}
    </>
  );
};

export default NotificationCenter;
