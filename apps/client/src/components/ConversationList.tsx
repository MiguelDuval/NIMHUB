import type { ConversationSummary } from '../types';

interface ConversationListProps {
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  onNew,
}: ConversationListProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (conversations.length === 0) {
    return (
      <div className="empty-conversations">
        <p>No conversations yet</p>
        <button className="btn-primary" onClick={onNew}>
          Start a new chat
        </button>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
          onClick={() => onSelect(conv.id)}
        >
          <div className="conversation-info">
            <div className="conversation-title">{conv.title}</div>
            <div className="conversation-meta">
              <span className="model-badge">{conv.modelId}</span>
              <span className="time">{formatTime(conv.updatedAt)}</span>
            </div>
          </div>
          <button
            className="icon-btn delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(conv.id);
            }}
            title="Delete conversation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}