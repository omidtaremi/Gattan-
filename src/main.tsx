import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global handler to gracefully swallow benign AbortErrors (from canceled/timed-out fetches)
window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason;
  if (
    err?.name === 'AbortError' ||
    String(err?.message || '').toLowerCase().includes('aborterror') ||
    String(err?.message || '').toLowerCase().includes('the user aborted a request') ||
    String(err || '').toLowerCase().includes('aborterror')
  ) {
    event.preventDefault();
    return;
  }
});

window.addEventListener('error', (event) => {
  const err = event.error;
  if (
    err?.name === 'AbortError' ||
    String(event.message || '').toLowerCase().includes('aborterror') ||
    String(err?.message || '').toLowerCase().includes('aborterror') ||
    String(event.message || '').toLowerCase().includes('the user aborted a request')
  ) {
    event.preventDefault();
    return;
  }
});

// Suppress benign AbortErrors and storage quota warnings from showing up in console logs
const originalError = console.error;
const originalWarn = console.warn;

const shouldSuppress = (args: any[]) => {
  return args.some(arg => {
    if (typeof arg === 'string') {
      const lower = arg.toLowerCase();
      return (
        lower.includes('aborterror') ||
        lower.includes('the user aborted a request') ||
        lower.includes('exceeded the quota') ||
        lower.includes('quotaexceedederror')
      );
    }
    if (arg && typeof arg === 'object') {
      const str = String(arg.message || arg.code || arg.name || '').toLowerCase();
      return (
        str.includes('aborterror') ||
        str.includes('the user aborted a request') ||
        str.includes('exceeded the quota') ||
        str.includes('quotaexceedederror')
      );
    }
    return false;
  });
};

console.error = function (...args: any[]) {
  if (shouldSuppress(args)) return;
  originalError.apply(console, args);
};

console.warn = function (...args: any[]) {
  if (shouldSuppress(args)) return;
  originalWarn.apply(console, args);
};

// Global auto-select text when focusing any text-like input or textarea across the entire app
const AUTO_SELECT_INPUT_TYPES = new Set([
  '',
  'text',
  'number',
  'search',
  'email',
  'tel',
  'url',
  'password',
]);

const isAutoSelectableTextbox = (
  el: EventTarget | null
): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.dataset?.noAutoSelect === 'true') return false;
  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled;
  }
  if (el instanceof HTMLInputElement) {
    if (el.disabled) return false;
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    return AUTO_SELECT_INPUT_TYPES.has(inputType);
  }
  return false;
};

const safeSelectAll = (el: HTMLInputElement | HTMLTextAreaElement) => {
  try {
    if (el.value.length > 0 && typeof el.select === 'function') {
      el.select();
    }
  } catch {
    // Ignore selection errors on unsupported input types
  }
};

let justFocusedTextbox: HTMLInputElement | HTMLTextAreaElement | null = null;
let pointerDownPos: { x: number; y: number } | null = null;

document.addEventListener(
  'mousedown',
  (event) => {
    pointerDownPos = { x: event.clientX, y: event.clientY };
  },
  true
);

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (!isAutoSelectableTextbox(target)) {
    justFocusedTextbox = null;
    return;
  }

  justFocusedTextbox = target;
  safeSelectAll(target);

  // Re-apply on next animation frame in case React onFocus updates/reformats the input value
  requestAnimationFrame(() => {
    if (document.activeElement === target && justFocusedTextbox === target) {
      safeSelectAll(target);
    }
  });
});

document.addEventListener(
  'mouseup',
  (event) => {
    const activeTarget = justFocusedTextbox;
    justFocusedTextbox = null;

    if (!activeTarget || event.target !== activeTarget) {
      pointerDownPos = null;
      return;
    }

    const movedTooFar =
      pointerDownPos !== null &&
      (Math.abs(event.clientX - pointerDownPos.x) > 4 ||
        Math.abs(event.clientY - pointerDownPos.y) > 4);
    pointerDownPos = null;

    // Preserve user drag-selection; otherwise keep full text selected after initial click
    if (!movedTooFar && document.activeElement === activeTarget) {
      event.preventDefault();
      safeSelectAll(activeTarget);
    }
  },
  true
);

document.addEventListener('keydown', () => {
  justFocusedTextbox = null;
});

document.addEventListener('focusout', () => {
  justFocusedTextbox = null;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
