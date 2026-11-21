/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'gatan_theme';

const listeners = new Set<() => void>();

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let currentTheme: ThemeMode = getStoredTheme();

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function setAppTheme(theme: ThemeMode): void {
  currentTheme = theme;
  applyThemeToDocument(theme);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota / private mode errors
    }
  }
  notifyListeners();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const handleStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) {
      const next: ThemeMode = e.newValue === 'light' ? 'light' : 'dark';
      if (next !== currentTheme) {
        currentTheme = next;
        applyThemeToDocument(next);
        notifyListeners();
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

function getSnapshot(): ThemeMode {
  return currentTheme;
}

function getServerSnapshot(): ThemeMode {
  return 'dark';
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setAppTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setAppTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    isLight: theme === 'light',
    setTheme,
    toggleTheme,
  };
}
