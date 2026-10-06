/**
 * useWSJTX — Vitest + React 18
 *
 * Covers the switch between server polling and rig-bridge SSE ("local mode"):
 * a plugin-init without WSJT-X data must not stop polling, and once SSE goes
 * silent the hook must fall back to polling. Rendered with createRoot/act
 * (same pattern as the hooks in ./app).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));
vi.mock('../utils/relaySession', () => ({
  getRelaySessionId: () => 'test-session',
}));

import { useWSJTX } from './useWSJTX.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;

function Harness() {
  useWSJTX();
  return null;
}

const decodePolls = () => api.fetch.mock.calls.filter(([url]) => url.startsWith('/api/wsjtx/decodes')).length;

const sse = (detail) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('rig-plugin-data', { detail }));
  });
};

const advance = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  api.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/wsjtx/decodes')
        ? { decodes: [], timestamp: Date.now() }
        : {
            enabled: true,
            clients: { 'WSJT-X': { lastSeen: Date.now() } },
            decodes: [],
            qsos: [],
            wspr: [],
            stats: { totalDecodes: 0, totalQsos: 0, totalWspr: 0, activeClients: 1 },
          },
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useWSJTX polling vs rig-bridge SSE', () => {
  it('keeps polling the server when rig-bridge sends plugin-init without WSJT-X decodes', async () => {
    await act(async () => root.render(<Harness />));
    // rig-bridge sends plugin-init on every SSE connect, even with no WSJT-X plugin running
    await advance(5_000);
    sse({ type: 'plugin-init', plugins: ['rigctld'], decodes: [] });

    await advance(26_000); // t = 31 s — the first tick must already poll
    expect(decodePolls()).toBeGreaterThan(0);
  });

  it('ignores non-WSJT-X plugin traffic such as APRS', async () => {
    await act(async () => root.render(<Harness />));
    await advance(5_000);
    sse({ type: 'plugin', event: 'aprs', data: {} });

    await advance(26_000); // t = 31 s — the first tick must already poll
    expect(decodePolls()).toBeGreaterThan(0);
  });

  it('pauses polling while WSJT-X data arrives over SSE and resumes once SSE goes silent', async () => {
    await act(async () => root.render(<Harness />));
    // Arrive after mount so the first tick (t = 30 s) still sees fresh SSE data
    await advance(5_000);
    sse({ type: 'plugin', event: 'status', data: { clientId: 'WSJT-X' } });

    await advance(24_000); // t = 29 s
    await advance(2_000); // t = 31 s — first tick ran, SSE is fresh
    expect(decodePolls()).toBe(0);

    // No further SSE messages: after the 30 s staleness window polling must resume
    await advance(20_000); // t = 51 s
    expect(decodePolls()).toBeGreaterThan(0);
  });
});
