/**
 * Storage Service - Conversation Persistence using IndexedDB
 * Provides a simple, Android-friendly persistence layer that can be migrated to SQLite later
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conversation, StoredMessage, ConversationSummary } from '../types';

const DB_NAME = 'nim-hub';
const DB_VERSION = 1;

interface NIMHubDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-updatedAt': string };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { 'by-conversationId': string; 'by-createdAt': string };
  };
}

let dbInstance: IDBPDatabase<NIMHubDB> | null = null;

async function getDB(): Promise<IDBPDatabase<NIMHubDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<NIMHubDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Conversations store
      const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
      convStore.createIndex('by-updatedAt', 'updatedAt');

      // Messages store
      const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
      msgStore.createIndex('by-conversationId', 'conversationId');
      msgStore.createIndex('by-createdAt', 'createdAt');
    },
  });

  return dbInstance;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

export const storage = {
  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    await getDB();
  },

  /**
   * Create a new conversation
   */
  async createConversation(modelId: string, title?: string): Promise<Conversation> {
    const db = await getDB();
    const id = generateId();
    const conversation: Conversation = {
      id,
      title: title ?? 'New Conversation',
      modelId,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      messageCount: 0,
    };
    await db.put('conversations', conversation);
    return conversation;
  },

  /**
   * Get all conversations sorted by updatedAt desc
   */
  async getConversations(): Promise<ConversationSummary[]> {
    const db = await getDB();
    const conversations = await db.getAllFromIndex('conversations', 'by-updatedAt');
    // Reverse to get newest first
    return conversations
      .slice()
      .reverse()
      .map((c) => ({
        id: c.id,
        title: c.title,
        modelId: c.modelId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount,
      }));
  },

  /**
   * Get a single conversation by ID
   */
  async getConversation(id: string): Promise<Conversation | undefined> {
    const db = await getDB();
    return db.get('conversations', id);
  },

  /**
   * Update conversation metadata
   */
  async updateConversation(id: string, updates: Partial<Pick<Conversation, 'title' | 'modelId'>>): Promise<void> {
    const db = await getDB();
    const conversation = await db.get('conversations', id);
    if (!conversation) return;

    const updated = { ...conversation, ...updates, updatedAt: nowISO() };
    await db.put('conversations', updated);
  },

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('conversations', id);
    // Delete associated messages
    const messages = await db.getAllFromIndex('messages', 'by-conversationId', id);
    for (const msg of messages) {
      await db.delete('messages', msg.id);
    }
  },

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    role: StoredMessage['role'],
    content: StoredMessage['content'],
    options?: { tool_calls?: StoredMessage['tool_calls']; tool_call_id?: string; name?: string }
  ): Promise<StoredMessage> {
    const db = await getDB();
    const id = generateId();
    const message: StoredMessage = {
      id,
      conversationId,
      role,
      content,
      createdAt: nowISO(),
      tool_calls: options?.tool_calls,
      tool_call_id: options?.tool_call_id,
      name: options?.name,
    };
    await db.put('messages', message);

    // Update conversation message count and updatedAt
    const conversation = await db.get('conversations', conversationId);
    if (conversation) {
      conversation.messageCount += 1;
      conversation.updatedAt = nowISO();
      await db.put('conversations', conversation);
    }

    return message;
  },

  /**
   * Get all messages for a conversation, ordered by createdAt
   */
  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const db = await getDB();
    const messages = await db.getAllFromIndex('messages', 'by-conversationId', conversationId);
    return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  /**
   * Update the last message (for streaming updates)
   */
  async updateLastMessage(conversationId: string, content: string): Promise<void> {
    const db = await getDB();
    const messages = await db.getAllFromIndex('messages', 'by-conversationId', conversationId);
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'assistant') {
      lastMessage.content = content;
      await db.put('messages', lastMessage);
    }
  },

  /**
   * Clear all data (for testing/reset)
   */
  async clearAll(): Promise<void> {
    const db = await getDB();
    await db.clear('conversations');
    await db.clear('messages');
  },
};

export { generateId, nowISO };