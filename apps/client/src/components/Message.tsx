import type { ChatMessage } from '../types';

interface MessageProps {
  message: ChatMessage;
  isStreaming?: boolean;
  modelId?: string;
}

export function Message({ message, isStreaming, modelId }: MessageProps) {
  return (
    <div className={`message ${message.role} ${isStreaming ? 'streaming' : ''}`}>
      <div className="message-header">
        <span className="message-role">
          {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'NIM' : message.role}
        </span>
        {message.role === 'assistant' && modelId && (
          <span className="message-model">{modelId}</span>
        )}
        {isStreaming && <span className="streaming-indicator">▋</span>}
      </div>
      <div className="message-content">
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="tool-call-summary">
            {message.tool_calls.map((call) => (
              <div className="tool-call-chip" key={call.id}>
                <span>Tool</span>
                <strong>{call.function.name}</strong>
              </div>
            ))}
          </div>
        )}
        {Array.isArray(message.content)
          ? message.content.map((part, i) =>
              part.type === 'text' ? (
                <div key={i} className="text-content">{part.text}</div>
              ) : (
                <div key={i} className="image-content">
                  <img src={part.image_url.url} alt="Attached image" />
                </div>
              )
            )
          : (
            <div className="text-content">{message.content}</div>
          )}
      </div>
    </div>
  );
}