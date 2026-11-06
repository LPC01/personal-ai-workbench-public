/** HTTP 健康检查（26 SPEC §11：健康检查通过后才进入 RUNNING）。 */
export async function httpHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的健康检查：在**总窗口**内按间隔重试，直到服务开始响应 2xx。
 *
 * RT-03（修 known-limitations #19）：此前重试次数固定 `10 × 200ms`，**总窗口恒定约 2 秒**，
 * `timeoutMs` 只被当作**单次请求**超时 —— 于是 manifest 里声明 `timeoutSeconds: 30` 也不生效，
 * 慢启动项目（vite / pnpm dev 冷启动）必然被判 `UNHEALTHY`。现改为**总窗口 = `totalTimeoutMs`**，
 * 与 26 SPEC §5「`webUI.healthCheck.timeoutSeconds`」的语义对齐：声明多少就给多少。
 *
 * @param totalTimeoutMs 健康检查的**总**宽限期（毫秒）；窗口耗尽仍不健康即判失败。
 * @param requestTimeoutMs **单次**请求超时（毫秒）；默认取 `min(total, 2000)`，
 *                        避免一次慢请求吃掉整个窗口。
 * @param intervalMs      两次尝试之间的间隔（毫秒）。
 * @param maxAttempts     最大尝试次数（**护栏**，防止 `totalTimeoutMs` 被误传成极大值时空转）。
 */
export async function healthCheckWithRetry(
  url: string,
  totalTimeoutMs: number,
  requestTimeoutMs = Math.min(totalTimeoutMs, 2000),
  intervalMs = 200,
  maxAttempts = 600,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, totalTimeoutMs);
  const perRequest = Math.max(1, Math.min(requestTimeoutMs, Math.max(1, totalTimeoutMs)));
  for (let i = 0; i < maxAttempts; i++) {
    if (await httpHealthCheck(url, perRequest)) {
      return true;
    }
    const remaining = deadline - Date.now();
    // 窗口已耗尽（或剩余时间不够再等一个间隔）→ 判定失败，不再空转
    if (remaining <= 0) {
      return false;
    }
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }
  return false;
}
