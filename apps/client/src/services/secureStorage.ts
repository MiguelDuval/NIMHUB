import { registerPlugin, Capacitor } from '@capacitor/core';

export interface SecureStoragePlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
  has(options: { key: string }): Promise<{ value: boolean }>;
}

const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage');

function assertNative(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Secure storage is available only in the Android app');
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  assertNative();
  await SecureStorage.set({ key, value });
}

export async function secureGet(key: string): Promise<string | null> {
  assertNative();
  const result = await SecureStorage.get({ key });
  return result.value ?? null;
}

export async function secureHas(key: string): Promise<boolean> {
  assertNative();
  const result = await SecureStorage.has({ key });
  return result.value;
}

export async function secureRemove(key: string): Promise<void> {
  assertNative();
  await SecureStorage.remove({ key });
}
