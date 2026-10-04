import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useConversations } from './hooks/useConversations';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAgent } from './hooks/useAgent';
import { useMCPStatus } from './hooks/useMCPStatus';
import { useGatewayStatus } from './hooks/useGatewayStatus';
import { useAttachments } from './hooks/useAttachments';
import { storage } from './services/storage';
import { api } from './services/api';
import type { ChatMessage, StoredMessage } from './types';
import { Message } from './components/Message';
import { ModelSelector } from './components/ModelSelector';
import { MCPStatus } from './components/MCPStatus';
import { ConversationList } from './components/ConversationList';
import { WelcomeMessage } from './components/WelcomeMessage';
import { Composer } from './components/Composer';
import { AgentApprovalCard } from './components/AgentApprovalCard';
import { GatewaySettings } from './components/GatewaySettings';
import './styles.css';

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
    error: conversationsError,
  } = useConversations();

  const {
    models,
    selectedModelId,
    loading: modelsLoading,
    error: modelsError,
    selectModel,
    setModelFromConversation,
    refreshModels,
  } = useModels();

  const {
    attachments,
    addImage,
    error: attachmentError,
    removeImage,
    clearAttachments,
    getAttachmentContent,
    clearError: clearAttachError,
  } = useAttachments();

  const {
    url: gatewayUrl,
    status: gatewayStatus,
    error: gatewayError,
    nvidiaConfigured,
    updateUrl: updateGatewayUrl,
  } = useGatewayStatus();

  const [inputMessage, setInputMessage] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showModelDetails, setShowModelDetails] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [agentMode, setAgentMode] = useState(false);
  const currentConversationRef = useRef(currentConversation);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId],
  );
  const handleMessagesScroll = useCallback(() => {
    const element = messagesAreaRef.current;
    if (!element) return;
    shouldAutoScrollRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }, []);

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
      if (assistantMessageId) {
        updateMessage(assistantMessageId, { content });
      }
    },
    onComplete: () => {
      setStreamingContent('');
      setRetryCount(0);
    },
    onError: (err, assistantMessageId) => {
      if (assistantMessageId) {
        updateMessage(assistantMessageId, { content: 'Error: ' + err.message });
      }
      setStreamingContent('');
      setRetryCount(0);
    },
    onAbort: (assistantMessageId) => {
      if (assistantMessageId) {
        updateMessage(assistantMessageId, { content: 'Generation cancelled.' });
      }
      setStreamingContent('');
    },
  });

  const persistAgentMessages = useCallback(
    async (messagesToPersist: ChatMessage[]) => {
      const conversation = currentConversationRef.current;
      if (!conversation) return;
      for (const message of messagesToPersist) {
        await addMessage(
          conversation.id,
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
    [addMessage],
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

  useEffect(() => {
    const element = messagesAreaRef.current;
    if (!element || !shouldAutoScrollRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [chatMessages.length, streamingContent, agentStreamingText, agentApprovals.length]);

  const canUseAgent =
    gatewayStatus === 'connected' &&
    nvidiaConfigured === true &&
    (selectedModel?.capabilities.includes('tool-calling') ?? false);
  const {
    servers: mcpServers,
    tools: mcpTools,
    loading: mcpLoading,
    error: mcpError,
    refresh: refreshMCP,
  } = useMCPStatus(canUseAgent);

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
    const conversation = currentConversation ?? await createConversation(selectedModelId);
    if (!currentConversation) {
      currentConversationRef.current = conversation;
      await selectConversation(conversation.id);
    }

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

    await addMessage(conversation.id, 'user', content);
    const titleSource = text || (attachments.length > 0 ? 'Image request' : '');
    if (conversation.title === 'New Conversation' && titleSource) {
      const title = titleSource.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (title) {
        await updateConversation(conversation.id, { title });
      }
    }

    const apiMessages = [...chatMessages, { role: 'user' as const, content }];

    if (agentMode) {
      await runAgent(apiMessages);
      setInputMessage('');
      clearAttachments();
      return;
    }

    const assistantMsg = await addMessage(conversation.id, 'assistant', '');
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
    createConversation,
    selectConversation,
    updateConversation,
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
      const nextModel = models.find((model) => model.id === modelId);
      if (!nextModel?.capabilities.includes('vision') && attachments.length > 0) {
        clearAttachments();
      }
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
      models,
      attachments.length,
      clearAttachments,
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
      gatewayStatus === 'connected' &&
      nvidiaConfigured === true &&
      (attachments.length === 0 || (selectedModel?.capabilities.includes('vision') ?? false)) &&
      !effectiveBusy &&
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
      selectedModel,
      gatewayStatus,
      nvidiaConfigured,
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

  const allErrors = [modelsError, attachmentError, chatError, conversationsError]
    .filter(Boolean) as Error[];

  if (conversationsLoading) {
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

  const workstationStatusLabel =
    gatewayStatus === 'checking'
      ? 'Connecting…'
      : gatewayStatus === 'error'
      ? 'Gateway offline'
      : nvidiaConfigured === false
      ? 'NVIDIA key missing'
      : modelsLoading
      ? 'Loading models…'
      : agentActiveLabel ??
        (status === 'streaming'
          ? 'Streaming…'
          : status === 'pending'
          ? 'Sending…'
          : status === 'error'
          ? 'Error'
          : 'Ready');

  const statusClass =
    gatewayStatus === 'error' || status === 'error' || agentStatus === 'error'
      ? 'error'
      : gatewayStatus === 'checking' || modelsLoading ||
        status === 'streaming' || status === 'pending' ||
        agentStatus === 'running' || agentStatus === 'approval_required'
      ? 'pending'
      : 'success';

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
            loading={modelsLoading}
            showDetails={showModelDetails}
            onToggleDetails={() => setShowModelDetails(!showModelDetails)}
          />
          <MCPStatus
            enabled={canUseAgent}
            servers={mcpServers}
            tools={mcpTools}
            loading={mcpLoading}
            error={mcpError}
            onRefresh={refreshMCP}
          />
        </div>
        <div className="topbar-right">
          <GatewaySettings
            url={gatewayUrl}
            status={gatewayStatus}
            nvidiaConfigured={nvidiaConfigured}
            error={gatewayError}
            onSave={async (nextUrl) => {
              await updateGatewayUrl(nextUrl);
              await refreshModels();
              await refreshMCP();
            }}
            onTest={(nextUrl) => api.healthAt(nextUrl)}
          />
          <div className={"status-indicator " + statusClass}>
            <span className="status-dot"></span>
            <span>
              {workstationStatusLabel}
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

            <div
              ref={messagesAreaRef}
              className="messages-area"
              role="log"
              aria-live="polite"
              onScroll={handleMessagesScroll}
            >
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
              onAddImage={addImage}
              onAbort={handleAbort}
              attachments={attachments}
              onRemoveAttachment={removeImage}
              disabled={
                !selectedModelId ||
                (agentMode && !canUseAgent) ||
                effectiveBusy
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
        <span>Gateway: {gatewayUrl}</span>
        <span>NIM Hub v0.1</span>
      </footer>
    </main>
  );
}
