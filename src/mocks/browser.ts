// MSW 浏览器 worker（仅 dev 启动，见 app/providers.tsx）。需先 `pnpm exec msw init public/`。
// 只 mock REST；终端已改 socket.io（走 /socket.io/ 握手，非 /terminal），MSW 不拦截，
// 终端 echo 依赖真后端 daemon（S1 联调），故不再注册 WS handler。
import { setupWorker } from 'msw/browser';
import { handlers } from '@/mocks/handlers';

export const worker = setupWorker(...handlers);
