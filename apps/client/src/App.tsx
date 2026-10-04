import { useState, useCallback, useEffect, useMemo } from 'react';
import { useConversations } from './hooks/useConversations';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAttachments } from './hooks/useAttachments';
import { useGlobalEvents } from './hooks/useGlobalEvents';
import { storage } from './services/storage';
import type { ChatMessage, StoredMessage, ModelCapabilityInfo } from './types';
import type { ImageAttachment } from './types';
import { Message } from './components/Message';
import { ModelSelector } from './components/ModelSelector';
import { ConversationList } from './components/ConversationList';
import { WelcomeMessage } from './components/WelcomeMessage';
import { Composer } from './components/Composer';
import './styles.css';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://127.0.0.1:8787';

function storedToChatMessage(msg: StoredMessage): ChatMessage {
  return {
    role: msg.role,
    content: msg.content,
    name: msg.name,
    tool_call_id: msg.tool_call_id,
    tool_calls: msg.tool_calls,
  };
}

export default function App() {
  useEffect(() => { storage.init().catch(console.error); }, []);

  const {
    conversations,
    currentConversation,
    messages: storedMessages,
    loading: conversationsLoading,
    createConversation,
    selectConversation,
    deleteConversation,
    updateConversation,
    addMessage,
    updateLastMessage,
    clearError: clearConvError,
  } = useConversations();

  const {
    models,
    selectedModelId,
    loading: modelsLoading,
    error: modelsError,
    selectModel,
    setModelFromConversation,
  } = useModels();

  const {
    attachments,
    error: attachmentError,
    addImage,
    removeImage,
    clearAttachments,
    getAttachmentContent,
    clearError: clearAttachError,
  } = useAttachments();

  useGlobalEvents();

  const [inputMessage, setInputMessage] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showModelDetails, setShowModelDetails] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const selectedModel = useMemo(() => models.find((m) => m.id === selectedModelId), [models, selectedModelId]);
  const chatMessages = useMemo((): ChatMessage[] => storedMessages.map(storedToChatMessage), [storedMessages]);

  const { status, error: chatError, abort, retry, send, isRetryable } = useChat({
    modelId: selectedModelId,
    messages: chatMessages,
    onChunk: (content, assistantMessageId) => {
      setStreamingContent(content);
      if (currentConversation && assistantMessageId) {
        // Update the specific assistant message by ID
        storage.updateMessage(assistantMessageId, { content });
      }
    },
    onComplete: (response, assistantMessageId) => {
      const content = response.choices[0]?.message?.content ?? '';
      // Message already persisted via onChunk -> updateMessage
      // No need to add again
      setStreamingContent('');
      setRetryCount(0);
    },
    onError: (err, assistantMessageId) => {
      if (currentConversation && assistantMessageId) {
        // Update the specific assistant message with error
        storage.updateMessage(assistantMessageId, { content: 'Error: ' + err.message });
      }
      setStreamingContent('');
      setRetryCount(0);
    },
  });

  const handleSend = useCallback(async () => {
    const text = inputMessage.trim();
    if (!text && attachments.length === 0) return;
    if (!selectedModelId) return;
    if (status === 'streaming' || status === 'pending') return;
    if (!currentConversation) return;

    let content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'high' | 'low' } }> = text;
    if (attachments.length > 0) {
      const attachmentContents = await Promise.all(attachments.map(att => getAttachmentContent(att)));
      content = [...(text ? [{ type: 'text' as const, text }] : []), ...attachmentContents];
    }

    // Persist user message
    await addMessage(currentConversation.id, 'user', content);
    const apiMessages = [...chatMessages, { role: 'user' as const, content }];
    
    // Create assistant placeholder message BEFORE streaming starts
    const assistantMsg = await addMessage(currentConversation.id, 'assistant', '');
    const assistantMessageId = assistantMsg.id;

    setInputMessage('');
    clearAttachments();
    
    // Send with the assistant message ID for streaming updates
    await send(apiMessages, { stream: true, assistantMessageId });
  }, [inputMessage, attachments, selectedModelId, status, currentConversation, chatMessages, addMessage, clearAttachments, send, getAttachmentContent]);

  const handleNewConversation = useCallback(async () => {
    if (!selectedModelId) return;
    const conversation = await createConversation(selectedModelId);
    await selectConversation(conversation.id);
    setStreamingContent('');
  }, [selectedModelId, createConversation, selectConversation]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      selectModel(modelId);
      if (currentConversation) {
        updateConversation(currentConversation.id, { modelId });
      }
    },
    [selectModel, currentConversation, updateConversation]
  );

  const handleConversationSelect = useCallback(
    (conversationId: string) => {
      selectConversation(conversationId);
      setStreamingContent('');
      // Sync model with conversation
      if (currentConversation) {
        setModelFromConversation(currentConversation.modelId);
      }
    },
    [selectConversation, setModelFromConversation]
  );

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      deleteConversation(conversationId);
    },
    [deleteConversation]
  );

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    retry();
  }, [retry]);

  const handleAbort = useCallback(() => {
    abort();
    setStreamingContent('');
  }, [abort]);

  const canSend = useMemo((): boolean =>
      Boolean(inputMessage.trim() || attachments.length > 0) &&
      Boolean(selectedModelId) &&
      (status === 'idle' || status === 'success' || status === 'error'),
    [inputMessage, attachments.length, selectedModelId, status]
  );

  const isLoading = conversationsLoading || modelsLoading;
  const allErrors = [modelsError, attachmentError, chatError].filter(Boolean) as Error[];

  if (isLoading) {
    return (
      <main className="shell">
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Loading NIM Hub...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="eyebrow">PERSONAL AI WORKSTATION</div>
          <h1>NIM Hub</h1>
        </div>
        <div className="topbar-center">
          <ModelSelector
            models={models}
            selectedModelId={selectedModelId}
            onChange={handleModelChange}
            disabled={modelsLoading || status === 'streaming'}
            showDetails={showModelDetails}
            onToggleDetails={() => setShowModelDetails(!showModelDetails)}
          />
        </div>
        <div className="topbar-right">
          <div className={"status-indicator " + status}>
            <span className="status-dot"></span>
            <span>
              {status === 'streaming'
                ? 'Streaming...'
                : status === 'pending'
                ? 'Sending...'
                : status === 'error'
                ? 'Error'
                : 'Ready'}
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={handleNewConversation}
            disabled={status === 'streaming'}
            title="New Conversation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {showSidebar ? (
                <>
                  <line x1="15" y1="18" x2="9" y2="12"></line>
                  <line x1="15" y1="6" x2="9" y2="12"></line>
                </>
              ) : (
                <>
                  <line x1="9" y1="18" x2="15" y2="12"></line>
                  <line x1="9" y1="6" x2="15" y2="12"></line>
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      <section className="workspace">
        {showSidebar && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Conversations</span>
              <button className="icon-btn" onClick={handleNewConversation} title="New Conversation">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
            <ConversationList
              conversations={conversations}
              currentConversationId={currentConversation?.id ?? null}
              onSelect={handleConversationSelect}
              onDelete={handleDeleteConversation}
              onNew={handleNewConversation}
            />
          </aside>
        )}

        <div className="main-area">
          <div className="chat-container">
            {selectedModel && (
              <div className="model-capabilities-bar">
                <span className="model-name">{selectedModel.name ?? selectedModel.id}</span>
                <div className="capability-tags">
                  {selectedModel.capabilities.map((cap) => (
                    <span key={cap} className={"capability-tag " + cap}>{cap}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="messages-area" role="log" aria-live="polite">
              {chatMessages.length === 0 && streamingContent === '' && (
                <WelcomeMessage selectedModel={selectedModel} />
              )}

              {chatMessages.map((msg, index) => (
                <Message key={msg.role + "-" + index} message={msg} modelId={selectedModelId} />
              ))}

              {streamingContent && (
                <Message
                  message={{ role: 'assistant', content: streamingContent }}
                  isStreaming={true}
                  modelId={selectedModelId}
                />
              )}

              {chatError && status === 'error' && (
                <div className="message error">
                  <div className="message-header">
                    <span className="message-role">Error</span>
                  </div>
                  <div className="message-content">
                    <div className="error-content">
                      <p>{chatError.message}</p>
                      <div className="error-code">Code: {chatError.code}</div>
                      {isRetryable && (
                        <button className="btn-retry" onClick={handleRetry}>
                          Retry ({retryCount + 1}/3)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Composer
              inputMessage={inputMessage}
              onInputChange={setInputMessage}
              onSend={handleSend}
              onAttach={() => {}}
              onAbort={handleAbort}
              attachments={attachments}
              onRemoveAttachment={removeImage}
              disabled={!selectedModelId}
              streaming={status === 'streaming'}
              canSend={canSend}
              visionEnabled={selectedModel?.capabilities.includes('vision') ?? false}
            />
          </div>
        </div>
      </section>

      {allErrors.length > 0 && (
        <div className="error-toast" role="alert">
          {allErrors.map((err, i) => (
            <div key={i} className="toast-item">
              <span>{err.message}</span>
              <button onClick={() => { clearConvError(); clearAttachError(); }}>x</button>
            </div>
          ))}
        </div>
      )}

      <footer className="footer">
        <span>Gateway: {GATEWAY_URL}</span>
        <span>NIM Hub v0.1</span>
      </footer>
    </main>
  );
}

