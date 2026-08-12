// MSW Node server（单测用，vitest.setup.ts 启动）。
import { setupServer } from 'msw/node';
import { handlers } from '@/mocks/handlers';

export const server = setupServer(...handlers);
