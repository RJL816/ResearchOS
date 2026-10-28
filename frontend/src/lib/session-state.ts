"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

// Drafts live only in this application window's session, scoped by project/Idea.
const values = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();
let storageFailed = false;
const warningListeners = new Set<() => void>();

function read<T>(key: string, initial: T, persistent = false): T {
  if (!values.has(key)) {
    try {
      const raw = persistent ? (localStorage.getItem(key) ?? sessionStorage.getItem(key)) : sessionStorage.getItem(key);
      values.set(key, raw === null ? initial : JSON.parse(raw));
    } catch {
      values.set(key, initial);
      storageFailed = true;
    }
  }
  return values.get(key) as T;
}
function notify(key: string) { listeners.get(key)?.forEach((fn) => fn()); }

export function useSessionState<T>(key: string, initial: T, persistent = false): [T, (value: SetStateAction<T>) => void] {
  const subscribe = useCallback((fn: () => void) => {
    const set = listeners.get(key) ?? new Set();
    set.add(fn); listeners.set(key, set);
    return () => { set.delete(fn); if (!set.size) listeners.delete(key); };
  }, [key]);
  const snapshot = useCallback(() => read(key, initial, persistent), [key, initial, persistent]);
  const serverSnapshot = useCallback(() => initial, [initial]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setValue = useCallback((update: SetStateAction<T>) => {
    const previous = read(key, initial, persistent);
    const next = typeof update === "function" ? (update as (old: T) => T)(previous) : update;
    values.set(key, next);
    try { (persistent ? localStorage : sessionStorage).setItem(key, JSON.stringify(next)); }
    catch { storageFailed = true; warningListeners.forEach((fn) => fn()); }
    notify(key);
  }, [key, initial, persistent]);
  return [value, setValue];
}

export function useSessionStorageWarning() {
  return useSyncExternalStore(
    (fn) => { warningListeners.add(fn); return () => { warningListeners.delete(fn); }; },
    () => storageFailed,
    () => false,
  );
}
