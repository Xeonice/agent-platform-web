import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { API, NOW, online, provider, resources, runtime } from './fixtures';

// Baseline reads only. Each acceptance scenario declares its objects and mutations explicitly.
export const server = setupServer(
  http.get(`${API}/api/health`, () => HttpResponse.json({ status: 'ok' })),
  http.get(`${API}/api/projects`, () => HttpResponse.json([])),
  http.get(`${API}/api/sandboxes`, () => HttpResponse.json([])),
  http.get(`${API}/api/providers`, () => HttpResponse.json([provider])),
  http.get(`${API}/api/runtimes`, () => HttpResponse.json([runtime()])),
  http.get(`${API}/api/images`, () => HttpResponse.json([])),
  http.get(`${API}/api/credentials`, () => HttpResponse.json([])),
  http.get(`${API}/api/credentials/git`, () => HttpResponse.json([])),
  http.get(`${API}/api/automations/attention`, () => HttpResponse.json([])),
  http.get(`${API}/api/projects/:id/automations`, () => HttpResponse.json([])),
  http.get(`${API}/api/projects/:id/branches`, () =>
    HttpResponse.json(['main', 'feat/login-refresh']),
  ),
  http.get(`${API}/api/retained-volumes`, () => HttpResponse.json([])),
  http.get(`${API}/api/system/init-status`, () =>
    HttpResponse.json({
      initialized: true,
      initializedAt: NOW,
      lastConnectivityCheck: online,
      lastConnectivityCheckAt: NOW,
    }),
  ),
  http.get(`${API}/api/system/resources`, () => HttpResponse.json(resources)),
  http.get(`${API}/api/system/settings`, () =>
    HttpResponse.json({
      initialized: true,
      accessPasscodeEnabled: false,
      version: { platform: '0.2.4', node: '22' },
    }),
  ),
  http.get(`${API}/api/system/providers`, () =>
    HttpResponse.json({
      providers: [],
      runtimes: [],
      imageSpecs: [],
      healthWindowMs: 3600000,
      healthWarnRate: 0.2,
      healthErrorRate: 0.5,
    }),
  ),
);
