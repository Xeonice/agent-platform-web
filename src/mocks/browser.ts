// MSW 浏览器 worker（仅 dev 启动，见 app/providers.tsx）。需先 `pnpm exec msw init public/`。
import { setupWorker } from 'msw/browser';
import { handlers } from '@/mocks/handlers';
import { wsHandlers } from '@/mocks/ws-handlers';

export const worker = setupWorker(...handlers, ...wsHandlers);
