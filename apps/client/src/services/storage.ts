/**
 * Storage Service - Conversation Persistence using IndexedDB
 * Provides a simple, Android-friendly persistence layer that can be migrated to SQLite later
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Artifact, Conversation, StoredMessage, ConversationSummary } from '../types';

const DB_NAME = 'nim-hub';
const DB_VERSION = 3;

interface NIMHubDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-updatedAt': string; 'by-pinned': string; 'by-archived': string };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { 'by-conversationId': string; 'by-createdAt': string };
  };
  artifacts: {
    key: string;
    value: Artifact;
    indexes: { 'by-createdAt': string; 'by-type': string };
  };
}

let dbInstance: IDBPDatabase<NIMHubDB> | null = null;

async function getDB(): Promise<IDBPDatabase<NIMHubDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<NIMHubDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // Conversations store
      if (oldVersion < 1) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-updatedAt', 'updatedAt');
      } else {
        const convStore = transaction.objectStore('conversations');
        if (oldVersion < 2) {
          convStore.createIndex('by-pinned', 'pinned');
          convStore.createIndex('by-archived', 'archived');
        }
      }

      // Messages store
      if (oldVersion < 1) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversationId', 'conversationId');
        msgStore.createIndex('by-createdAt', 'createdAt');
      }

      if (oldVersion < 3) {
        const artifactStore = db.createObjectStore('artifacts', { keyPath: 'id' });
        artifactStore.createIndex('by-createdAt', 'createdAt');
        artifactStore.createIndex('by-type', 'type');
      }
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

function messagePreview(content: StoredMessage['content']): string {
  if (typeof content === 'string') {
    return content.trim().replace(/\s+/g, ' ').slice(0, 160);
  }

  if (Array.isArray(content)) {
    const textPart = content.find(
      (part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim(),
    );
    if (textPart && textPart.type === 'text') {
      return textPart.text.trim().replace(/\s+/g, ' ').slice(0, 160);
    }
    return 'Image attachment';
  }

  return '';
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
      pinned: false,
      archived: false,
      tags: [],
    };
    await db.put('conversations', conversation);
    return conversation;
  },

  /**
   * Get all conversations sorted by updatedAt desc (pinned first, then by updatedAt)
   */
  async getConversations(): Promise<ConversationSummary[]> {
    const db = await getDB();
    const conversations = await db.getAll('conversations');
    // Sort: pinned first, then by updatedAt desc
    return conversations
      .slice()
      .sort((a, b) => {
        // Pinned conversations first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Then by updatedAt desc
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .map((c) => ({
        id: c.id,
        title: c.title,
        modelId: c.modelId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount,
        lastMessagePreview: c.lastMessagePreview,
        pinned: c.pinned,
        archived: c.archived,
        tags: c.tags,
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
  async updateConversation(
    id: string,
    updates: Partial<Pick<Conversation, 'title' | 'modelId' | 'pinned' | 'archived' | 'tags' | 'systemPrompt' | 'metadata'>>
  ): Promise<void> {
    const db = await getDB();
    const conversation = await db.get('conversations', id);
    if (!conversation) return;

    const updated = { ...conversation, ...updates, updatedAt: nowISO() };
    await db.put('conversations', updated);
  },

  /**
   * Toggle conversation pinned status
   */
  async togglePinned(id: string): Promise<void> {
    const db = await getDB();
    const conversation = await db.get('conversations', id);
    if (!conversation) return;
    conversation.pinned = !conversation.pinned;
    conversation.updatedAt = nowISO();
    await db.put('conversations', conversation);
  },

  /**
   * Toggle conversation archived status
   */
  async toggleArchived(id: string): Promise<void> {
    const db = await getDB();
    const conversation = await db.get('conversations', id);
    if (!conversation) return;
    conversation.archived = !conversation.archived;
    conversation.updatedAt = nowISO();
    await db.put('conversations', conversation);
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
      if (role !== 'tool') {
        const preview = messagePreview(content);
        if (preview) {
          conversation.lastMessagePreview = preview;
        }
      }
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
   * Update a specific message by ID (for streaming updates)
   */
  async updateMessage(messageId: string, updates: Partial<Pick<StoredMessage, 'content' | 'finishReason'>>): Promise<void> {
    const db = await getDB();
    const message = await db.get('messages', messageId);
    if (!message) return;

    const updated = { ...message, ...updates };
    await db.put('messages', updated);
  },

  /**
   * Update the last message (for streaming updates - legacy)
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

  async saveArtifact(input: Omit<Artifact, 'id' | 'createdAt' | 'size'> & { size?: number }): Promise<Artifact> {
    const db = await getDB();
    const artifact: Artifact = {
      ...input,
      id: generateId(),
      createdAt: nowISO(),
      size: input.size ?? input.blob.size,
    };
    await db.put('artifacts', artifact);
    return artifact;
  },

  async getArtifact(id: string): Promise<Artifact | undefined> {
    const db = await getDB();
    return db.get('artifacts', id);
  },

  async getArtifacts(type?: Artifact['type']): Promise<Artifact[]> {
    const db = await getDB();
    const artifacts = type
      ? await db.getAllFromIndex('artifacts', 'by-type', type)
      : await db.getAll('artifacts');
    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async deleteArtifact(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('artifacts', id);
  },

  /**
   * Clear all data (for testing/reset)
   */
  async clearAll(): Promise<void>
    const db = await getDB();
    await db.clear('conversations');
    await db.clear('messages');
    await db.clear('artifacts');
  },
};

export { generateId, nowISO };