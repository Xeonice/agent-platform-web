// 产物下载的两条路径（S6 收尾 ③）：
//  · **流式落盘**（`showSaveFilePicker` 存在）：response.body → 磁盘句柄，**整个产物不进内存**；
//  · **回退**（jsdom 默认就是这条，因为它没有 showSaveFilePicker）：blob + object URL。
// 两条共用的纪律：始终是带凭据的 fetch，绝不退回裸 `<a href>` 直链。
//
// 流式路径在 jsdom 里没有原生实现 ⇒ 这里注入一个替身：一个真正的 `WritableStream` 子类，
// 顺带满足 `FileSystemWritableFileStream` 的形状（因此**零类型断言**）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  abortError,
  FakeFileHandle,
  FakeWritableFile,
  installSaveFilePicker,
} from '@/mocks/saveFilePicker';
import { OBJECT_URL_REVOKE_DELAY_MS, useTaskArtifactDownload } from '@/hooks/task/useAgentTask';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const ARTIFACT_URL = `${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`;

/** 可控的产物响应流。不 close 就一直挂着 ⇒ 能在"下载途中"这一刻做断言。 */
function mockArtifactStream(init: { contentLength?: number } = {}): {
  push: (bytes: number) => void;
  close: () => void;
  hits: () => number;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  let hits = 0;
  server.use(
    http.get(ARTIFACT_URL, () => {
      hits += 1;
      return new HttpResponse(
        stream,
        init.contentLength === undefined
          ? undefined
          : { headers: { 'content-length': String(init.contentLength) } },
      );
    }),
  );
  return {
    push: (bytes) => controller?.enqueue(new Uint8Array(bytes)),
    close: () => controller?.close(),
    hits: () => hits,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

function renderDownload() {
  return renderHook(() => useTaskArtifactDownload('sb-1', 'task-1'));
}

describe('useTaskArtifactDownload · 流式落盘（File System Access API）', () => {
  it('body 直接管进磁盘句柄：**一次 createObjectURL 都不发生**（几百 MB 产物不进内存）', async () => {
    const { calls, writable } = installSaveFilePicker();
    const createObjectURL = vi.fn(() => 'blob:should-not-happen');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const stream = mockArtifactStream({ contentLength: 12 });

    const { result } = renderDownload();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(calls).toEqual([{ suggestedName: 'patch.diff' }]);
    });
    await waitFor(() => {
      expect(stream.hits()).toBe(1);
    });

    act(() => {
      stream.push(5);
      stream.push(7);
    });
    await waitFor(() => {
      expect(writable.writtenBytes).toBe(12);
    });
    act(() => {
      stream.close();
    });

    await waitFor(() => {
      expect(writable.closed).toBe(true);
    });
    // 关键：全程没有把产物物化成 Blob。
    expect(createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.downloadingName).toBeNull();
    });
    expect(result.current.error).toBeNull();
  });

  it('⚠️ 存盘对话框先于 fetch 打开（transient user activation 只有几秒，先 await 网络会偶发抛 SecurityError）', async () => {
    // 用一个**挂着不 resolve** 的存盘对话框把时序钉死：只要顺序反了，
    // 请求就会在对话框还没关掉之前先发出去。
    const writable = new FakeWritableFile();
    let openPicker!: (handle: FileSystemFileHandle) => void;
    const pending = new Promise<FileSystemFileHandle>((resolve) => {
      openPicker = resolve;
    });
    const picker = vi.fn(() => pending);
    window.showSaveFilePicker = picker;
    const stream = mockArtifactStream();

    const { result } = renderDownload();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(picker).toHaveBeenCalled();
    });
    // 对话框还开着（用户还没选位置）⇒ 一个请求都不该发出去。顺序反了这里就是 1。
    await Promise.resolve();
    expect(stream.hits()).toBe(0);

    // 用户选好位置 ⇒ 这时才去取数据。
    act(() => {
      openPicker(new FakeFileHandle('patch.diff', writable));
    });
    await waitFor(() => {
      expect(stream.hits()).toBe(1);
    });
    act(() => {
      stream.close();
    });
  });

  it('带 content-length ⇒ 边写边报进度（已下载 / 总量 + 百分比）', async () => {
    installSaveFilePicker();
    const stream = mockArtifactStream({ contentLength: 4096 });

    const { result } = renderDownload();
    act(() => {
      result.current.download('big.bin');
    });
    await waitFor(() => {
      expect(stream.hits()).toBe(1);
    });

    act(() => {
      stream.push(1024);
    });
    await waitFor(() => {
      expect(result.current.progressLabel).toBe('已下载 1.0 KB / 4.0 KB（25%）');
    });

    act(() => {
      stream.push(3072);
      stream.close();
    });
    await waitFor(() => {
      expect(result.current.downloadingName).toBeNull();
    });
  });

  it('⚠️ **没有** content-length ⇒ 只报已下载多少，不猜百分比（后端不保证带这个头）', async () => {
    installSaveFilePicker();
    const stream = mockArtifactStream();

    const { result } = renderDownload();
    act(() => {
      result.current.download('big.bin');
    });
    await waitFor(() => {
      expect(stream.hits()).toBe(1);
    });

    act(() => {
      stream.push(2048);
    });
    await waitFor(() => {
      expect(result.current.progressLabel).toBe('已下载 2.0 KB');
    });
    expect(result.current.progressLabel).not.toContain('%');

    act(() => {
      stream.close();
    });
  });

  it('用户取消存盘 = **正常路径**：不报错、不发请求、安静回到可下载态', async () => {
    installSaveFilePicker({ reject: abortError() });
    const stream = mockArtifactStream();

    const { result } = renderDownload();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(result.current.downloadingName).toBeNull();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.progressLabel).toBeUndefined();
    // 取消发生在 fetch 之前 ⇒ 一个字节都没下过。
    expect(stream.hits()).toBe(0);
  });

  it('取消之外的存盘失败仍然是错误（别把降级做成"什么都不报"）', async () => {
    installSaveFilePicker({ reject: new Error('磁盘不可写') });
    mockArtifactStream();

    const { result } = renderDownload();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe('磁盘不可写');
    });
    expect(result.current.downloadingName).toBeNull();
  });

  it('取流途中失败 ⇒ abort 而不是 close（半截内容不该被当成完整产物提交）', async () => {
    const { writable } = installSaveFilePicker();
    server.use(
      http.get(ARTIFACT_URL, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '产物已被清理', retryable: false },
          { status: 404 },
        ),
      ),
    );

    const { result } = renderDownload();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    // 404 在拿到 writable 之前就抛了 ⇒ 既没 close 也没写进任何东西。
    expect(writable.closed).toBe(false);
    expect(writable.writtenBytes).toBe(0);
  });
});

describe('useTaskArtifactDownload · 回退路径（浏览器没有 showSaveFilePicker）', () => {
  it('走 blob + 一次性 object URL，且撤销**推迟**到下一拍（当场 revoke 会打断下载）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    let hits = 0;
    server.use(
      http.get(ARTIFACT_URL, () => {
        hits += 1;
        return HttpResponse.text('artifact body');
      }),
    );

    const { result } = renderDownload();
    // jsdom 没有 showSaveFilePicker ⇒ 这就是默认被测到的那条路径。
    expect(window.showSaveFilePicker).toBeUndefined();
    act(() => {
      result.current.download('patch.diff');
    });

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
    expect(hits).toBe(1);
    expect(click).toHaveBeenCalled();
    // 回退路径没有进度可报（整包读完才有东西），progressLabel 全程缺席。
    expect(result.current.progressLabel).toBeUndefined();

    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS);
    });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('取产物失败 ⇒ 人话错误（不是静默空文件）', async () => {
    server.use(
      http.get(ARTIFACT_URL, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '产物已被清理', retryable: false },
          { status: 404 },
        ),
      ),
    );

    const { result } = renderDownload();
    act(() => {
      result.current.download('gone.txt');
    });

    await waitFor(() => {
      expect(result.current.error?.message).toContain('产物已被清理');
    });
    expect(result.current.downloadingName).toBeNull();
  });
});

describe('useTaskArtifactDownload · 并发与前置条件', () => {
  it('⚠️ 同一拍连点两次只起**一条**流（state 拦不住这一拍，靠同步的 in-flight ref）', async () => {
    installSaveFilePicker();
    const stream = mockArtifactStream();

    const { result } = renderDownload();
    act(() => {
      result.current.download('a.bin');
      result.current.download('b.bin');
    });

    await waitFor(() => {
      expect(stream.hits()).toBe(1);
    });
    expect(result.current.downloadingName).toBe('a.bin');
    act(() => {
      stream.close();
    });
  });

  it('taskId 为 null ⇒ 什么都不做（面板上根本没有产物可下）', () => {
    const { calls } = installSaveFilePicker();
    const { result } = renderHook(() => useTaskArtifactDownload('sb-1', null));

    act(() => {
      result.current.download('a.bin');
    });

    expect(calls).toHaveLength(0);
    expect(result.current.downloadingName).toBeNull();
  });
});
