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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
