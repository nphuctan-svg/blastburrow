import type { Critter, Gadget } from './content.js';
import type { Checkpoint, Settings } from './engine.js';
import { applyReward, blankProfile, type Profile, type Reward } from './profile.js';

export interface Slot {
  id: number;
  token: string;
  critter: Critter;
  gadget: Gadget;
  name: string;
  base: Profile;
  pending: Reward[];
  completed?: string[];
}
export interface Save {
  settings: Settings;
  checkpoint: Checkpoint;
  runId: string;
  party: number;
  slots: number[];
}

const memory = new Map<string, unknown>();
const database = new Promise<IDBDatabase | null>(resolve => {
  if (!('indexedDB' in window)) return resolve(null);
  const request = indexedDB.open('burrow-brigade', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('save');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
  request.onblocked = () => resolve(null);
});
async function get<T>(key: string): Promise<T | undefined> {
  const db = await database;
  if (!db) return memory.get(key) as T | undefined;
  return new Promise(resolve => {
    const request = db.transaction('save', 'readonly').objectStore('save').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => resolve(undefined);
  });
}
async function set(key: string, value: unknown) {
  const db = await database;
  memory.set(key, structuredClone(value));
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('save', 'readwrite');
    transaction.objectStore('save').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export function randomKey(length = 16) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), value => value.toString(16).padStart(2, '0')).join('');
}

export async function getSlot(id: number): Promise<Slot> {
  const key = 'slot:' + id;
  const saved = await get<Slot>(key);
  if (saved) return saved;
  const slot: Slot = { id, token: randomKey(36), critter: id === 0 ? 'hare' : 'fox', gadget: 'standard',
    name: id === 0 ? 'Player 1' : 'Player 2', base: blankProfile(), pending: [] };
  await set(key, slot);
  return slot;
}
export const saveSlot = (slot: Slot) => set('slot:' + slot.id, slot);
export async function commitClear(slots: Slot[], reward: Reward) {
  const db = await database;
  const updated = slots.map(slot => {
    const completed = slot.completed ?? [];
    if (completed.includes(reward.id)) return slot;
    return { ...slot, completed: [...completed, reward.id], pending: [...slot.pending, reward] };
  });
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('save', 'readwrite');
      const store = transaction.objectStore('save');
      for (const slot of updated) store.put(slot, 'slot:' + slot.id);
      store.put(null, 'checkpoint');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  }
  slots.forEach((slot, i) => {
    Object.assign(slot, updated[i]);
    memory.set('slot:' + slot.id, structuredClone(slot));
  });
  memory.set('checkpoint', null);
}

export const profileOf = (slot: Slot) => slot.pending.reduce(applyReward, slot.base);
export const getCheckpoint = () => get<Save | null>('checkpoint');
export const saveCheckpoint = (save: Save | null) => set('checkpoint', save);
export const getControls = <T>() => get<T>('controls');
export const saveControls = (controls: unknown) => set('controls', controls);
export const getOptions = <T>() => get<T>('options');
export const saveOptions = (options: unknown) => set('options', options);

const syncing = new Map<number, Promise<boolean>>();
export function syncProfile(slot: Slot): Promise<boolean> {
  const existing = syncing.get(slot.id);
  if (existing) return existing;
  const operation = (async () => {
    try {
      let repeat: boolean;
      do {
        const outgoing = slot.pending.slice(0, 125);
        const response = await fetch('/api/profile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: slot.token, rewards: outgoing }),
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) return false;
        const { profile } = await response.json() as { profile: Profile };
        if (profile.xp >= slot.base.xp) slot.base = profile;
        const confirmed = new Set(outgoing.map(reward => reward.id));
        slot.pending = slot.pending.filter(reward => !confirmed.has(reward.id));
        await saveSlot(slot);
        repeat = outgoing.length === 125 && slot.pending.length > 0;
      } while (repeat);
      return true;
    } catch { return false; }
  })().finally(() => syncing.delete(slot.id));
  syncing.set(slot.id, operation);
  return operation;
}
