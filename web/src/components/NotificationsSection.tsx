import { api, AppNotification } from '../api';

interface NotificationsSectionProps {
  notifications: AppNotification[];
  unreadCount: number;
  onRefresh: () => Promise<void>;
}

export function NotificationsSection({
  notifications,
  unreadCount,
  onRefresh,
}: NotificationsSectionProps) {
  async function handleMarkNotificationRead(id: string) {
    try {
      await api.markNotificationRead(id);
      await onRefresh();
    } catch {
      // ignora
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      await api.markAllNotificationsRead();
      await onRefresh();
    } catch {
      // ignora
    }
  }

  async function handleEnableBrowserNotifications() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      await Notification.requestPermission();
    }
  }

  return (
    <section className="panel" aria-labelledby="notifications-title">
      <div className="summary-bar">
        <div>
          <h2 id="notifications-title">
            Minha Caixa de Entrada ({unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'})
          </h2>
          <p className="subtitle">
            Notificações privadas da sua conta (protegidas por RLS individual no banco).
          </p>
        </div>
        <div className="user-bar">
          {typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'default' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleEnableBrowserNotifications}
              >
                Ativar alerta discreto no navegador
              </button>
            )}
          {unreadCount > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleMarkAllNotificationsRead}
            >
              Marcar todas como lidas
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <p className="subtitle" style={{ marginTop: '1rem' }}>
          Nenhuma notificação até o momento.
        </p>
      ) : (
        <ul className="expense-list" style={{ marginTop: '1rem' }}>
          {notifications.map((n) => (
            <li
              key={n.id}
              className="expense-item"
              style={{
                padding: '0.85rem 1rem',
                opacity: n.is_read ? 0.72 : 1,
              }}
            >
              <div className="expense-main">
                <div className="expense-title">
                  <span>{n.title}</span>
                  {!n.is_read && <span className="badge badge-private">Nova</span>}
                </div>
                <div className="expense-meta">
                  <span>{n.body}</span>
                </div>
              </div>
              {!n.is_read && (
                <div className="expense-right">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => handleMarkNotificationRead(n.id)}
                  >
                    Marcar como lida
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
