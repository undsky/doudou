/**
 * 防采集 & 模拟人类行为 公共工具
 * 提供随机延迟、指数退避、人类行为模拟、限流检测等能力
 */

/**
 * 基础延迟
 * @param {number} ms 毫秒数
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 随机延迟，防止被风控检测到固定间隔
 * @param {number} minMs 最小延迟（毫秒）
 * @param {number} maxMs 最大延迟（毫秒）
 */
export function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return sleep(delay);
}

/**
 * 带抖动的指数退避延迟，用于被限制后逐步增大间隔
 * @param {number} attempt 当前重试次数（从 0 开始）
 * @param {number} baseMs 基础延迟（毫秒），默认 3000
 * @param {number} maxMs 最大延迟（毫秒），默认 60000
 */
export function exponentialBackoff(attempt, baseMs = 3000, maxMs = 60000) {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exp * (0.5 + Math.random() * 0.5); // 50%-100% 的抖动
  return sleep(Math.floor(jitter));
}

/**
 * 注入人类真实行为模拟（鼠标移动、随机滚动、悬停等）
 * 通过 chrome.scripting.executeScript 在目标页面中执行
 * @param {number} tabId Chrome 标签页 ID
 * @param {"browse"|"read"|"idle"} mode 模拟模式
 *   - browse: 浏览模式，鼠标移动 + 悬停 + 小幅滚动
 *   - read:   阅读模式，模拟阅读帖子详情
 *   - idle:   空闲模式，轻微鼠标抖动
 */
export async function simulateHumanBehavior(tabId, mode = "browse") {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (mode) => {
      const rand = (min, max) => Math.floor(Math.random() * (max - min)) + min;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // 生成贝塞尔曲线路径点，模拟自然鼠标轨迹
      function bezierPath(x0, y0, x1, y1, steps) {
        const cx = x0 + (x1 - x0) * (0.2 + Math.random() * 0.6);
        const cy =
          y0 +
          (y1 - y0) * (0.2 + Math.random() * 0.6) +
          (Math.random() - 0.5) * 100;
        const points = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
          const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
          points.push({ x: Math.round(x), y: Math.round(y) });
        }
        return points;
      }

      // 模拟鼠标沿路径移动
      async function moveMouse(x0, y0, x1, y1) {
        const steps = rand(8, 16);
        const points = bezierPath(x0, y0, x1, y1, steps);
        for (const p of points) {
          document
            .elementFromPoint(p.x, p.y)
            ?.dispatchEvent(
              new MouseEvent("mousemove", {
                clientX: p.x,
                clientY: p.y,
                bubbles: true,
              }),
            );
          await sleep(rand(10, 30));
        }
      }

      // 模拟悬停在某个元素上
      async function hoverRandomElement() {
        const targets = [
          ...document.querySelectorAll('article[data-testid="tweet"]'),
          ...document.querySelectorAll('a[role="link"]'),
          ...document.querySelectorAll("span"),
        ];
        if (targets.length === 0) return;
        const el = targets[rand(0, targets.length)];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const x = rect.left + rand(5, Math.max(6, rect.width - 5));
        const y = rect.top + rand(5, Math.max(6, rect.height - 5));
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
          return;
        await moveMouse(
          rand(100, window.innerWidth - 100),
          rand(100, window.innerHeight - 100),
          x,
          y,
        );
        el.dispatchEvent(
          new MouseEvent("mouseenter", {
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        el.dispatchEvent(
          new MouseEvent("mouseover", {
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
        await sleep(rand(200, 800));
        el.dispatchEvent(
          new MouseEvent("mouseleave", {
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      }

      // 模拟自然滚动（带加速减速）
      async function naturalScroll() {
        const distance = rand(80, 300) * (Math.random() > 0.15 ? 1 : -1);
        const steps = rand(3, 7);
        for (let i = 0; i < steps; i++) {
          const ratio = Math.sin((i / steps) * Math.PI); // 先快后慢的正弦曲线
          window.scrollBy(0, Math.round((distance / steps) * (0.5 + ratio)));
          await sleep(rand(30, 80));
        }
      }

      return (async () => {
        if (mode === "browse") {
          // 浏览模式：鼠标移动 + 悬停 + 小幅滚动
          await hoverRandomElement();
          await sleep(rand(300, 800));
          if (Math.random() > 0.4) await naturalScroll();
          await sleep(rand(200, 500));
          if (Math.random() > 0.5) await hoverRandomElement();
        } else if (mode === "read") {
          // 阅读模式：模拟阅读帖子详情
          await naturalScroll();
          await sleep(rand(500, 1200));
          await hoverRandomElement();
          await sleep(rand(300, 600));
          if (Math.random() > 0.6) await naturalScroll();
        } else if (mode === "idle") {
          // 空闲模式：轻微鼠标抖动
          const x = rand(200, window.innerWidth - 200);
          const y = rand(200, window.innerHeight - 200);
          await moveMouse(x, y, x + rand(-30, 30), y + rand(-30, 30));
        }
      })();
    },
    args: [mode],
  });
}
