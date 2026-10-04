import { useState, useCallback, useEffect, useMemo } from 'react';
import { useConversations } from './hooks/useConversations';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAgent } from './hooks/useAgent';
import { useAttachments } from './hooks/useAttachments';
import { useGlobalEvents } from './hooks/useGlobalEvents';
import { storage } from './services/storage';
import type { ChatMessage, StoredMessage } from './types';
import { Message } from './components/Message';
import { ModelSelector } from './components/ModelSelector';
import { ConversationList } from './components/ConversationList';
import { WelcomeMessage } from './components/WelcomeMessage';
import { Composer } from './components/Composer';
import { AgentApprovalCard } from './components/AgentApprovalCard';
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
    updateMessage,
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
  const [agentMode, setAgentMode] = useState(false);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId],
  );
  const chatMessages = useMemo(
    (): ChatMessage[] => storedMessages.map(storedToChatMessage),
    [storedMessages],
  );

  const {
    status,
    error: chatError,
    abort,
    retry,
    send,
    isRetryable,
  } = useChat({
    modelId: selectedModelId,
    messages: chatMessages,
    onChunk: (content, assistantMessageId) => {
      setStreamingContent(content);
      if (currentConversation && assistantMessageId) {
        updateMessage(assistantMessageId, { content });
      }
    },
    onComplete: () => {
      setStreamingContent('');
      setRetryCount(0);
    },
    onError: (err, assistantMessageId) => {
      if (currentConversation && assistantMessageId) {
        updateMessage(assistantMessageId, { content: 'Error: ' + err.message });
      }
      setStreamingContent('');
      setRetryCount(0);
    },
  });

  const persistAgentMessages = useCallback(
    async (messagesToPersist: ChatMessage[]) => {
      if (!currentConversation) return;
      for (const message of messagesToPersist) {
        await addMessage(
          currentConversation.id,
          message.role,
          message.content,
          {
            tool_calls: message.tool_calls,
            tool_call_id: message.tool_call_id,
            name: message.name,
          },
        );
      }
    },
    [addMessage, currentConversation],
  );

  const {
    status: agentStatus,
    error: agentError,
    approvals: agentApprovals,
    streamingText: agentStreamingText,
    activities: agentActivities,
    run: runAgent,
    approve: approveAgent,
    abort: abortAgent,
    reject: rejectAgent,
    reset: resetAgent,
  } = useAgent({
    modelId: selectedModelId,
    onMessages: persistAgentMessages,
  });

  const canUseAgent = selectedModel?.capabilities.includes('tool-calling') ?? false;
  const effectiveBusy =
    status === 'streaming' ||
    status === 'pending' ||
    agentStatus === 'running' ||
    agentStatus === 'approval_required';

  const agentDisplayError = agentError
    ? [agentError.message, agentError.code].filter(Boolean).join(' · ')
    : null;

  const handleSend = useCallback(async () => {
    const text = inputMessage.trim();
    if (!text && attachments.length === 0) return;
    if (!selectedModelId) return;
    if (effectiveBusy) return;
    if (!currentConversation) return;

    let content: string | Array<
      { type: 'text'; text: string } |
      { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'high' | 'low' } }
    > = text;

    if (attachments.length > 0) {
      const attachmentContents = await Promise.all(
        attachments.map((att) => getAttachmentContent(att)),
      );
      content = [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...attachmentContents,
      ];
    }

    await addMessage(currentConversation.id, 'user', content);
    const apiMessages = [...chatMessages, { role: 'user' as const, content }];

    if (agentMode) {
      await runAgent(apiMessages);
      setInputMessage('');
      clearAttachments();
      return;
    }

    const assistantMsg = await addMessage(currentConversation.id, 'assistant', '');
    const assistantMessageId = assistantMsg.id;

    setInputMessage('');
    clearAttachments();
    await send(apiMessages, { stream: true, assistantMessageId });
  }, [
    inputMessage,
    attachments,
    selectedModelId,
    effectiveBusy,
    currentConversation,
    chatMessages,
    addMessage,
    clearAttachments,
    send,
    getAttachmentContent,
    agentMode,
    runAgent,
  ]);

  const handleNewConversation = useCallback(async () => {
    if (!selectedModelId || effectiveBusy) return;
    const conversation = await createConversation(selectedModelId);
    await selectConversation(conversation.id);
    setStreamingContent('');
    resetAgent();
  }, [
    selectedModelId,
    effectiveBusy,
    createConversation,
    selectConversation,
    resetAgent,
  ]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      if (effectiveBusy) return;
      resetAgent();
      selectModel(modelId);
      if (currentConversation) {
        updateConversation(currentConversation.id, { modelId });
      }
    },
    [
      selectModel,
      currentConversation,
      updateConversation,
      resetAgent,
      effectiveBusy,
    ],
  );

  const handleAgentToggle = useCallback(() => {
    if (effectiveBusy) return;
    if (agentMode) {
      setAgentMode(false);
      resetAgent();
      return;
    }
    setAgentMode(true);
  }, [agentMode, effectiveBusy, resetAgent]);

  const handleConversationSelect = useCallback(
    async (conversationId: string) => {
      if (effectiveBusy) return;
      const conversation = await selectConversation(conversationId);
      setStreamingContent('');
      resetAgent();
      if (conversation) {
        setModelFromConversation(conversation.modelId);
      }
    },
    [selectConversation, setModelFromConversation, resetAgent, effectiveBusy],
  );

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      if (effectiveBusy) return;
      deleteConversation(conversationId);
    },
    [deleteConversation, effectiveBusy],
  );

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    retry();
  }, [retry]);

  const handleAbort = useCallback(() => {
    if (agentMode) {
      abortAgent();
      return;
    }
    abort();
    setStreamingContent('');
  }, [abort, abortAgent, agentMode]);

  const canSend = useMemo(
    () =>
      Boolean(inputMessage.trim() || attachments.length > 0) &&
      Boolean(selectedModelId) &&
      !effectiveBusy &&
      !(agentMode && agentStatus === 'approval_required') &&
      (agentMode
        ? canUseAgent
        : status === 'idle' || status === 'success' || status === 'error'),
    [
      inputMessage,
      attachments.length,
      selectedModelId,
      effectiveBusy,
      agentMode,
      agentStatus,
      canUseAgent,
      status,
    ],
  );

  useEffect(() => {
    if (agentMode && !canUseAgent) {
      setAgentMode(false);
      resetAgent();
    }
  }, [agentMode, canUseAgent, resetAgent]);

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

  const agentActiveLabel =
    agentStatus === 'running'
      ? 'Agent running…'
      : agentStatus === 'approval_required'
      ? 'Approval required'
      : agentStatus === 'cancelled'
      ? 'Agent cancelled'
      : agentStatus === 'error'
      ? 'Agent error'
      : null;

  const statusClass =
    agentStatus === 'running'
      ? 'pending'
      : agentStatus === 'approval_required'
      ? 'pending'
      : agentStatus === 'error'
      ? 'error'
      : status;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="eyebrow">PERSONAL AI WORKSTATION</div>
          <h1>NIM Hub</h1>
        </div>
        <div className="topbar-center">
          <button
            className={'mode-toggle ' + (agentMode ? 'active' : '')}
            onClick={handleAgentToggle}
            disabled={!canUseAgent || effectiveBusy}
            title={
              canUseAgent
                ? 'Toggle model-driven MCP agent mode'
                : 'Selected model does not advertise tool-calling'
            }
          >
            {agentMode ? 'Agent ON' : 'Agent'}
          </button>
          <ModelSelector
            models={models}
            selectedModelId={selectedModelId}
            onChange={handleModelChange}
            disabled={modelsLoading || effectiveBusy}
            showDetails={showModelDetails}
            onToggleDetails={() => setShowModelDetails(!showModelDetails)}
          />
        </div>
        <div className="topbar-right">
          <div className={"status-indicator " + statusClass}>
            <span className="status-dot"></span>
            <span>
              {agentActiveLabel ??
                (status === 'streaming'
                  ? 'Streaming...'
                  : status === 'pending'
                  ? 'Sending...'
                  : status === 'error'
                  ? 'Error'
                  : 'Ready')}
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={handleNewConversation}
            disabled={effectiveBusy}
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
              <button
                className="icon-btn"
                onClick={handleNewConversation}
                disabled={effectiveBusy}
                title="New Conversation"
              >
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
              {chatMessages.length === 0 &&
                streamingContent === '' &&
                agentStreamingText === '' && (
                  <WelcomeMessage selectedModel={selectedModel} />
                )}

              {chatMessages.map((msg, index) => (
                <Message key={msg.role + '-' + index} message={msg} modelId={selectedModelId} />
              ))}

              {streamingContent && (
                <Message
                  message={{ role: 'assistant', content: streamingContent }}
                  isStreaming={true}
                  modelId={selectedModelId}
                />
              )}

              {agentStreamingText && (
                <Message
                  message={{ role: 'assistant', content: agentStreamingText }}
                  isStreaming={agentStatus === 'running'}
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
                      <div className="error-code">{chatError.code}</div>
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

            {agentApprovals.length > 0 && (
              <AgentApprovalCard
                approvals={agentApprovals}
                onApprove={approveAgent}
                onReject={rejectAgent}
                busy={agentStatus === 'running'}
              />
            )}

            {agentDisplayError && (
              <div className="agent-error" role="alert">
                <strong>Agent error</strong>
                <span>{agentDisplayError}</span>
              </div>
            )}

            {agentActivities.length > 0 && agentStatus === 'running' && (
              <div className="agent-activity" aria-live="polite" aria-label="Agent activity">
                {agentActivities.map((activity) => (
                  <div className="agent-activity-item" key={activity.id}>
                    <span className={'agent-activity-dot ' + activity.type}></span>
                    <span className="agent-activity-label">
                      {activity.type === 'tool_error' ? 'Tool error' : 'Tool completed'}
                    </span>
                    <strong>{activity.tool ?? 'MCP tool'}</strong>
                    {activity.message && <span className="agent-activity-message">{activity.message}</span>}
                  </div>
                ))}
              </div>
            )}

            <Composer
              inputMessage={inputMessage}
              onInputChange={setInputMessage}
              onSend={handleSend}
              onAttach={() => {}}
              onAbort={handleAbort}
              attachments={attachments}
              onRemoveAttachment={removeImage}
              disabled={
                !selectedModelId ||
                (agentMode && !canUseAgent) ||
                effectiveBusy ||
                (agentMode && agentStatus === 'approval_required')
              }
              streaming={status === 'streaming' || agentStatus === 'running'}
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
