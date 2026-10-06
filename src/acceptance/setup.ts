import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { server } from './support/server';
import { useAppStore } from '@/stores';

// jsdom has no scrolling implementation; feature assertions can spy on this boundary.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
});

process.env['NEXT_PUBLIC_API_BASE_URL'] = 'http://localhost:3001';
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});
