/**
 * Conversation Management Hook
 * Handles conversation CRUD operations with persistence
 */

import { useState, useEffect, useCallback } from 'react';
import { storage } from '../services/storage';
import type { Conversation, ConversationSummary, StoredMessage } from '../types';

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const list = await storage.getConversations();
      setConversations(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load conversations'));
    } finally {
      setLoading(false);
    }
  }, []);

  const createConversation = useCallback(async (modelId: string, title?: string) => {
    try {
      const conversation = await storage.createConversation(modelId, title);
      setConversations((prev) => [conversation, ...prev]);
      return conversation;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create conversation'));
      throw err;
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    try {
      const [conversation, msgs] = await Promise.all([
        storage.getConversation(id),
        storage.getMessages(id),
      ]);
      if (conversation) {
        setCurrentConversation(conversation);
        setMessages(msgs);
      }
      return conversation;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load conversation'));
      return null;
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await storage.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversation?.id === id) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to delete conversation'));
    }
  }, [currentConversation]);

  const updateConversation = useCallback(async (id: string, updates: Partial<Pick<Conversation, 'title' | 'modelId'>>) => {
    try {
      await storage.updateConversation(id, updates);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c))
      );
      if (currentConversation?.id === id) {
        setCurrentConversation((prev) => (prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : null));
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update conversation'));
    }
  }, [currentConversation]);

  const addMessage = useCallback(
    async (
      conversationId: string,
      role: StoredMessage['role'],
      content: StoredMessage['content'],
      options?: { tool_calls?: StoredMessage['tool_calls']; tool_call_id?: string; name?: string }
    ) => {
      try {
        const message = await storage.addMessage(conversationId, role, content, options);
        setMessages((prev) => [...prev, message]);
        // Update conversation message count
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, messageCount: c.messageCount + 1, updatedAt: new Date().toISOString() } : c
          )
        );
        if (currentConversation?.id === conversationId) {
          setCurrentConversation((prev) =>
            prev ? { ...prev, messageCount: prev.messageCount + 1, updatedAt: new Date().toISOString() } : null
          );
        }
        return message;
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to add message'));
        throw err;
      }
    },
    [currentConversation]
  );

  const updateLastMessage = useCallback(async (conversationId: string, content: string) => {
    try {
      await storage.updateLastMessage(conversationId, content);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role === 'assistant' && last.conversationId === conversationId) {
          return [...prev.slice(0, -1), { ...last, content }];
        }
        return prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update message'));
    }
  }, []);

  const updateMessage = useCallback(async (messageId: string, updates: Partial<Pick<StoredMessage, 'content' | 'finishReason'>>) => {
    try {
      await storage.updateMessage(messageId, updates);
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, ...updates } : msg))
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update message'));
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    conversations,
    currentConversation,
    messages,
    loading,
    error,
    loadConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    updateConversation,
    addMessage,
    updateLastMessage,
    updateMessage,
    clearError,
  };
}