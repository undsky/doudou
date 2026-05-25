(function () {
  if (document.getElementById("doudou-floating-btn")) return;

  const ICON_URL = chrome.runtime.getURL("icons/doudou_128.png");
  const STORAGE_POS_KEY = "doudouBtnPos";
  const DRAG_THRESHOLD = 4;

  function showCopyToast() {
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.75)",
      color: "#fff",
      padding: "8px 20px",
      borderRadius: "6px",
      fontSize: "14px",
      zIndex: "2147483647",
      transition: "opacity 0.3s",
      pointerEvents: "none",
    });
    toast.textContent = "已复制到剪贴板";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  // 扩展上下文是否有效（重载后旧 content script 会失效）
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function isDoudouCanvasPage() {
    return (
      location.pathname.endsWith("/doudou_canvas.html") ||
      (!!document.getElementById("add-script-node") &&
        !!document.getElementById("canvas-container"))
    );
  }

  function postCanvasSidePanelResponse(requestId, payload) {
    window.postMessage(
      {
        type: "DOUDOU_OPEN_SIDE_PANEL_RESPONSE",
        requestId,
        source: "doudou-extension",
        ...payload,
      },
      "*",
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "DOUDOU_OPEN_SIDE_PANEL_REQUEST") return;
    if (event.data?.source !== "doudou-canvas") return;
    if (!isDoudouCanvasPage()) return;

    const { requestId } = event.data;
    if (!isContextValid()) {
      postCanvasSidePanelResponse(requestId, {
        success: false,
        error: "扩展上下文不可用，请刷新页面后重试",
      });
      return;
    }

    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      postCanvasSidePanelResponse(requestId, {
        success: !!response?.success && !runtimeError,
        error: runtimeError?.message || response?.error || "打开豆豆侧边栏失败",
      });
    });
  });

  const ACTIONS = [
    { id: "clone-article", icon: "📋", label: "AI文章复刻" },
    { id: "screenshot", icon: "📸", label: "页面截图" },
    {
      id: "douyin-media-download",
      icon: `<svg viewBox="0 0 448 512" width="16" height="16" fill="currentColor" style="vertical-align: middle;"><path d="M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,52.23,71.18V0l88,0a121.18,121.18,0,0,0,1.86,22.17h0A122.18,122.18,0,0,0,381,102.39a121.43,121.43,0,0,0,67,20.14Z"/></svg>`,
      label: "抖音下载",
    },
    { id: "generate-qrcode", icon: "🔳", label: "生成二维码" },
    { id: "export-cookies", icon: "🍪", label: "导出Cookies" },
    { id: "summarize-page", icon: "📝", label: "总结页面" },
    { id: "translate", icon: "🌐", label: "翻译" },
  ];

  // ========== 样式 ==========
  function injectStyles() {
    const style = document.createElement("style");
    style.id = "doudou-floating-btn-style";
    style.textContent = `
      /* --- 浮窗按钮 --- */
      #doudou-floating-btn {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        touch-action: none;
      }
      #doudou-floating-btn .doudou-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        cursor: grab;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        transition: box-shadow 0.2s;
        object-fit: cover;
        background: #fff;
      }
      #doudou-floating-btn .doudou-avatar:active { cursor: grabbing; }
      #doudou-floating-btn .doudou-avatar:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      }
      #doudou-floating-btn .doudou-close {
        width: 18px; height: 18px; border-radius: 50%;
        background: rgba(0,0,0,0.35); color: #fff;
        font-size: 11px; line-height: 18px; text-align: center;
        cursor: pointer; position: absolute; top: -4px; right: -4px;
        display: none; border: none; padding: 0;
      }
      #doudou-floating-btn:hover .doudou-close { display: block; }
      #doudou-floating-btn .doudou-close:hover { background: rgba(0,0,0,0.6); }

      /* --- 快捷操作面板（悬停显示） --- */
      #doudou-floating-btn .doudou-actions {
        display: none;
        flex-direction: column;
        gap: 2px;
        background: #fff;
        border-radius: 8px;
        padding: 4px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.12);
        color: #333;
      }
      #doudou-floating-btn:hover .doudou-actions {
        display: flex;
      }
      #doudou-floating-btn .doudou-action-item {
        width: 34px; height: 34px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 6px; cursor: pointer; font-size: 18px;
        transition: background-color 0.15s;
        position: relative; border: none; background: none; padding: 0;
        color: #333;
      }
      #doudou-floating-btn .doudou-action-item:hover {
        background-color: #f0f0f0;
      }
      #doudou-floating-btn .doudou-action-item::before {
        content: attr(data-label);
        position: absolute; right: 44px; white-space: nowrap;
        background: rgba(0,0,0,0.75); color: #fff;
        padding: 4px 8px; border-radius: 4px; font-size: 12px;
        pointer-events: none; opacity: 0; transition: opacity 0.15s;
      }
      #doudou-floating-btn .doudou-action-item:hover::before { opacity: 1; }

      /* --- 截图二级菜单 --- */
      #doudou-floating-btn .doudou-screenshot-sub {
        display: none;
        position: absolute;
        right: 44px;
        top: 0;
        flex-direction: column;
        gap: 2px;
        background: #fff;
        border-radius: 6px;
        padding: 4px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        white-space: nowrap;
        cursor: default;
      }
      /* 使用隐形伪元素桥接主按钮与子菜单之间的物理间隙，避免导致 hover 状态丢失 */
      #doudou-floating-btn .doudou-screenshot-sub::after {
        content: "";
        position: absolute;
        top: 0;
        right: -16px;
        width: 16px;
        height: 100%;
        background: transparent;
      }
      #doudou-floating-btn .doudou-action-item-wrapper.has-sub:hover .doudou-screenshot-sub {
        display: flex;
      }
      /* 当有子菜单时，隐藏默认的 tooltip */
      #doudou-floating-btn .doudou-action-item-wrapper.has-sub:hover .doudou-action-item::before {
        display: none;
      }
      #doudou-floating-btn .doudou-sub-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        font-size: 13px;
        color: #333;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.15s;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }
      #doudou-floating-btn .doudou-sub-item:hover {
        background-color: #f0f0f0;
      }

      /* --- 翻译 toast --- */
      #doudou-translate-toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: rgba(0,0,0,0.78);
        color: #fff;
        padding: 8px 20px;
        border-radius: 20px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #doudou-translate-toast button {
        background: none;
        border: 1px solid rgba(255,255,255,0.4);
        color: #fff;
        padding: 2px 12px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 12px;
      }
      #doudou-translate-toast button:hover {
        background: rgba(255,255,255,0.15);
      }

      /* --- 选择翻译弹窗 --- */
      #doudou-selection-bar {
        position: fixed;
        z-index: 2147483647;
        background: rgba(0,0,0,0.78);
        color: #fff;
        padding: 4px 6px;
        border-radius: 16px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 2px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.2);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
      }
      #doudou-selection-bar button {
        background: none;
        border: none;
        color: #fff;
        padding: 4px 10px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      #doudou-selection-bar button:hover {
        background: rgba(255,255,255,0.15);
      }

      /* --- 翻译结果高亮 --- */
      [data-doudou-translate] {
        background-color: #fffde7;
        color: #000;
      }
    `;
    document.head.appendChild(style);
  }

  // ========== 位置工具 ==========
  function clampPosition(x, y, elWidth, elHeight) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.max(0, Math.min(x, vw - elWidth)),
      y: Math.max(0, Math.min(y, vh - elHeight)),
    };
  }

  // ========== 截图选区（供 Side Panel 和 Popup 调用） ==========
  function showSelectionOverlay(fullScreenshot, mode = "sidepanel") {
    // 强制清理可能残留或并发生成的旧图层
    document
      .querySelectorAll("#doudou-screenshot-overlay")
      .forEach((el) => el.remove());

    const dpr = window.devicePixelRatio || 1;
    const overlay = document.createElement("div");
    overlay.id = "doudou-screenshot-overlay";
    const crosshairSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cline x1='16' y1='0' x2='16' y2='32' stroke='%23fff' stroke-width='2'/%3E%3Cline x1='0' y1='16' x2='32' y2='16' stroke='%23fff' stroke-width='2'/%3E%3Cline x1='16' y1='0' x2='16' y2='32' stroke='%231890ff' stroke-width='1'/%3E%3Cline x1='0' y1='16' x2='32' y2='16' stroke='%231890ff' stroke-width='1'/%3E%3C/svg%3E") 16 16, crosshair`;
    overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;cursor:${crosshairSvg};user-select:none;`;

    const bg = document.createElement("canvas");
    bg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;";
    const img = new Image();
    img.onload = () => {
      bg.width = img.width;
      bg.height = img.height;
      const ctx = bg.getContext("2d");
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, bg.width, bg.height);
      overlay.prepend(bg);
    };
    img.src = fullScreenshot;

    const sel = document.createElement("div");
    sel.style.cssText =
      "position:absolute;display:none;border:2px solid #1890ff;box-sizing:border-box;pointer-events:none;overflow:hidden;";
    overlay.appendChild(sel);

    const selImg = document.createElement("img");
    selImg.src = fullScreenshot;
    selImg.style.cssText =
      "position:absolute;pointer-events:none;max-width:none !important;max-height:none !important;";
    sel.appendChild(selImg);

    const handles = [];
    const handlePositions = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    const handleCursors = [
      "nwse-resize",
      "ns-resize",
      "nesw-resize",
      "ew-resize",
      "nwse-resize",
      "ns-resize",
      "nesw-resize",
      "ew-resize",
    ];
    handlePositions.forEach((pos, idx) => {
      const h = document.createElement("div");
      h.dataset.handle = pos;
      h.style.cssText = `position:absolute;display:none;width:10px;height:10px;background:#fff;border:2px solid #1890ff;border-radius:50%;pointer-events:auto;cursor:${handleCursors[idx]};transform:translate(-50%,-50%);z-index:2;`;
      overlay.appendChild(h);
      handles.push(h);
    });

    const btns = document.createElement("div");
    btns.style.cssText =
      "position:absolute;display:none;gap:4px;background:rgba(255,255,255,0.95);border-radius:20px;padding:6px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);pointer-events:auto;z-index:3;";
    btns.innerHTML = `<button id="doudou-ss-cancel" style="width:28px;height:28px;border:none;border-radius:50%;background:none;cursor:pointer;font-size:16px;color:#666;display:flex;align-items:center;justify-content:center;">✕</button>
      <button id="doudou-ss-confirm" style="width:28px;height:28px;border:none;border-radius:50%;background:none;cursor:pointer;font-size:16px;color:#1890ff;display:flex;align-items:center;justify-content:center;">✓</button>`;
    overlay.appendChild(btns);

    document.body.appendChild(overlay);

    let rect = { x: 0, y: 0, w: 0, h: 0 };
    let drawing = false,
      moving = false,
      resizing = false;
    let startX, startY, moveOffX, moveOffY, resizeHandle;
    let hasSelection = false;

    function updateSelection() {
      const r = normalizeRect(rect);
      sel.style.left = r.x + "px";
      sel.style.top = r.y + "px";
      sel.style.width = r.w + "px";
      sel.style.height = r.h + "px";
      sel.style.display = r.w > 2 && r.h > 2 ? "block" : "none";

      selImg.style.left = -r.x + "px";
      selImg.style.top = -r.y + "px";
      selImg.style.width = overlay.offsetWidth + "px";
      selImg.style.height = overlay.offsetHeight + "px";

      const posMap = {
        nw: [0, 0],
        n: [r.w / 2, 0],
        ne: [r.w, 0],
        e: [r.w, r.h / 2],
        se: [r.w, r.h],
        s: [r.w / 2, r.h],
        sw: [0, r.h],
        w: [0, r.h / 2],
      };
      const showHandles = r.w > 2 && r.h > 2;
      handles.forEach((h) => {
        const [hx, hy] = posMap[h.dataset.handle];
        h.style.left = r.x + hx + "px";
        h.style.top = r.y + hy + "px";
        h.style.display = showHandles ? "block" : "none";
      });

      if (hasSelection && r.w > 10 && r.h > 10) {
        btns.style.display = "flex";
        btns.style.left = r.x + r.w - btns.offsetWidth + "px";
        btns.style.top = r.y + r.h + 8 + "px";
      }
    }

    function normalizeRect(r) {
      return {
        x: r.w < 0 ? r.x + r.w : r.x,
        y: r.h < 0 ? r.y + r.h : r.y,
        w: Math.abs(r.w),
        h: Math.abs(r.h),
      };
    }

    function cleanup() {
      overlay.remove();
      document
        .querySelectorAll("#doudou-screenshot-overlay")
        .forEach((el) => el.remove());
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target.dataset?.handle) {
        resizing = true;
        resizeHandle = e.target.dataset.handle;
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
        return;
      }
      if (
        e.target.id === "doudou-ss-cancel" ||
        e.target.id === "doudou-ss-confirm"
      )
        return;

      const nr = normalizeRect(rect);
      if (
        hasSelection &&
        e.clientX >= nr.x &&
        e.clientX <= nr.x + nr.w &&
        e.clientY >= nr.y &&
        e.clientY <= nr.y + nr.h
      ) {
        moving = true;
        moveOffX = e.clientX - nr.x;
        moveOffY = e.clientY - nr.y;
        overlay.style.cursor = "move";
        e.preventDefault();
        return;
      }

      // 如果已经有选区了，并且点击在界外，则不允许重新绘制，保护现有选区
      if (hasSelection) return;

      drawing = true;
      hasSelection = false;
      btns.style.display = "none";
      rect.x = e.clientX;
      rect.y = e.clientY;
      rect.w = 0;
      rect.h = 0;
      updateSelection();
    });

    overlay.addEventListener("mousemove", (e) => {
      if (drawing) {
        rect.w = e.clientX - rect.x;
        rect.h = e.clientY - rect.y;
        updateSelection();
      } else if (moving) {
        const nr = normalizeRect(rect);
        rect.x = e.clientX - moveOffX;
        rect.y = e.clientY - moveOffY;
        rect.w = nr.w;
        rect.h = nr.h;
        updateSelection();
      } else if (resizing) {
        const nr = normalizeRect(rect);
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const h = resizeHandle;
        let { x, y, w, h: height } = nr;

        if (h.includes("w")) {
          x = nr.x + dx;
          w = nr.w - dx;
        }
        if (h.includes("e")) {
          w = nr.w + dx;
        }
        if (h.includes("n")) {
          y = nr.y + dy;
          height = nr.h - dy;
        }
        if (h.includes("s")) {
          height = nr.h + dy;
        }

        if (w > 0 && height > 0) {
          rect = { x, y, w, h: height };
          startX = e.clientX;
          startY = e.clientY;
          updateSelection();
        }
      }
    });

    overlay.addEventListener("mouseup", () => {
      if (drawing) {
        drawing = false;
        const nr = normalizeRect(rect);
        rect = nr;
        if (nr.w > 5 && nr.h > 5) {
          hasSelection = true;
          sel.style.pointerEvents = "auto";
          sel.style.cursor = "move";
          updateSelection();
        }
      }
      if (moving) {
        moving = false;
        overlay.style.cursor = crosshairSvg;
      }
      if (resizing) {
        resizing = false;
        rect = normalizeRect(rect);
      }
    });

    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("message", onIframeEsc);
        chrome.runtime.sendMessage({ type: "SCREENSHOT_CANCELLED" });
      }
    };
    document.addEventListener("keydown", onKey, true);

    // 监听来自 iframe 的 ESC 转发
    const onIframeEsc = (e) => {
      if (e.data?.type === "DOUDOU_IFRAME_ESC") {
        cleanup();
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("message", onIframeEsc);
        chrome.runtime.sendMessage({ type: "SCREENSHOT_CANCELLED" });
      }
    };
    window.addEventListener("message", onIframeEsc);

    setTimeout(() => {
      btns.querySelector("#doudou-ss-cancel").addEventListener("click", (e) => {
        e.stopPropagation();
        cleanup();
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("message", onIframeEsc);
        chrome.runtime.sendMessage({ type: "SCREENSHOT_CANCELLED" });
      });

      btns
        .querySelector("#doudou-ss-confirm")
        .addEventListener("click", (e) => {
          e.stopPropagation();
          const nr = normalizeRect(rect);
          const canvas = document.createElement("canvas");
          canvas.width = nr.w * dpr;
          canvas.height = nr.h * dpr;
          const cctx = canvas.getContext("2d");
          cctx.drawImage(
            img,
            nr.x * dpr,
            nr.y * dpr,
            nr.w * dpr,
            nr.h * dpr,
            0,
            0,
            nr.w * dpr,
            nr.h * dpr,
          );
          const cropped = canvas.toDataURL("image/png");
          cleanup();
          document.removeEventListener("keydown", onKey, true);
          window.removeEventListener("message", onIframeEsc);

          if (isContextValid()) {
            if (mode === "download") {
              chrome.runtime.sendMessage({
                type: "DOWNLOAD_SCREENSHOT",
                data: cropped,
              });
            } else {
              chrome.runtime.sendMessage({
                type: "SCREENSHOT_RESULT",
                data: cropped,
              });
            }
          }
        });
    }, 0);
  }

  // ========== 监听来自 background 的截图请求 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_SCREENSHOT_SELECTION" && msg.data) {
      if (window !== window.top) return;
      showSelectionOverlay(msg.data, msg.mode || "sidepanel");
      sendResponse({ success: true });
    }
  });

  // ========== 页面翻译 ==========
  let isTranslating = false;
  const translatePorts = new Set();
  let translateSession = 0;
  let toastTimer = null;

  const IFRAME_TOAST_PREFIX = "DOUDOU_IFRAME_TOAST:";

  function broadcastToFrames(type) {
    function broadcast(win) {
      for (let i = 0; i < win.frames.length; i++) {
        try {
          win.frames[i].postMessage({ type }, "*");
          broadcast(win.frames[i]);
        } catch (e) {}
      }
    }
    broadcast(window.top);
  }

  if (window === window.top) {
    window.addEventListener("message", (e) => {
      if (!e.data || typeof e.data.type !== "string") return;
      if (e.data.type === IFRAME_TOAST_PREFIX + "SHOW") {
        showTranslateToast(
          e.data.text,
          (e.data.buttons || []).map((label) => ({
            label,
            onClick: () => {
              if (label === "取消") {
                cancelTranslation();
              } else if (label === "移除翻译") {
                broadcastToFrames("DOUDOU_TRANSLATE_REMOVE");
                removeAllTranslations();
                removeTranslateToast();
              } else if (label === "关闭") {
                removeTranslateToast();
              }
            },
          })),
        );
      } else if (e.data.type === IFRAME_TOAST_PREFIX + "UPDATE") {
        updateTranslateToast(e.data.text);
      } else if (e.data.type === IFRAME_TOAST_PREFIX + "REMOVE") {
        removeTranslateToast();
      }
    });
  }

  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "DOUDOU_TRANSLATE_CANCEL" && window !== window.top) {
      cancelTranslation();
    } else if (
      e.data.type === "DOUDOU_TRANSLATE_REMOVE" &&
      window !== window.top
    ) {
      removeAllTranslations();
      removeTranslateToast();
    }
  });

  function showTranslateToast(text, buttons) {
    if (window !== window.top) {
      const buttonConfigs = (buttons || []).map((b) => b.label);
      window.top.postMessage(
        { type: IFRAME_TOAST_PREFIX + "SHOW", text, buttons: buttonConfigs },
        "*",
      );
      return;
    }
    clearToastTimer();
    document.getElementById("doudou-translate-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "doudou-translate-toast";
    const span = document.createElement("span");
    span.textContent = text;
    toast.appendChild(span);
    if (buttons) {
      buttons.forEach(({ label, onClick }) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.addEventListener("click", onClick);
        toast.appendChild(btn);
      });
    }
    document.body.appendChild(toast);
  }

  function updateTranslateToast(text) {
    if (window !== window.top) {
      window.top.postMessage(
        { type: IFRAME_TOAST_PREFIX + "UPDATE", text },
        "*",
      );
      return;
    }
    const span = document.querySelector("#doudou-translate-toast span");
    if (span) span.textContent = text;
  }

  function clearToastTimer() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function removeTranslateToast() {
    if (window !== window.top) {
      window.top.postMessage({ type: IFRAME_TOAST_PREFIX + "REMOVE" }, "*");
      return;
    }
    clearToastTimer();
    document.getElementById("doudou-translate-toast")?.remove();
  }

  function removeAllTranslations() {
    function clean(doc) {
      doc
        .querySelectorAll("[data-doudou-translate]")
        .forEach((el) => el.remove());
      doc.querySelectorAll("iframe").forEach((frame) => {
        try {
          if (frame.contentDocument) clean(frame.contentDocument);
        } catch (e) {}
      });
    }
    clean(document);
  }

  function cancelTranslation() {
    if (window === window.top) {
      broadcastToFrames("DOUDOU_TRANSLATE_CANCEL");
    }
    isTranslating = false;
    translateSession++;
    translatePorts.forEach((p) => {
      try {
        p.disconnect();
      } catch {}
    });
    translatePorts.clear();
    removeAllTranslations();
    removeTranslateToast();
  }

  function callTranslateLLM(messages) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const port = chrome.runtime.connect({ name: "doudou-chat" });
      translatePorts.add(port);
      let full = "";

      function finish(ok, val) {
        if (settled) return;
        settled = true;
        translatePorts.delete(port);
        try {
          port.disconnect();
        } catch {}
        ok ? resolve(val) : reject(val);
      }

      port.postMessage({ type: "DOUDOU_CHAT_STREAM", messages });

      function cleanLLMOutput(text) {
        if (!text) return text;
        let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
        cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
        return cleaned.trim();
      }

      port.onMessage.addListener((msg) => {
        if (msg.type === "chunk") {
          full += msg.data;
        } else if (msg.type === "done") {
          finish(true, cleanLLMOutput(full));
        } else if (msg.type === "error") {
          finish(false, new Error(msg.data || "翻译失败"));
        }
      });

      port.onDisconnect.addListener(() => {
        finish(
          full ? true : false,
          cleanLLMOutput(full) || new Error("连接断开"),
        );
      });
    });
  }

  function collectTextBlocks() {
    const SKIP_TAGS = new Set([
      "SCRIPT",
      "STYLE",
      "NOSCRIPT",
      "SVG",
      "MATH",
      "TEXTAREA",
      "INPUT",
      "SELECT",
      "CANVAS",
      "VIDEO",
      "AUDIO",
    ]);
    const INLINE_TAGS = new Set([
      "A",
      "ABBR",
      "B",
      "BDO",
      "BR",
      "CITE",
      "CODE",
      "DATA",
      "DFN",
      "EM",
      "I",
      "IMG",
      "KBD",
      "LABEL",
      "MARK",
      "Q",
      "S",
      "SAMP",
      "SMALL",
      "SPAN",
      "STRONG",
      "SUB",
      "SUP",
      "TIME",
      "U",
      "VAR",
      "WBR",
      "RUBY",
      "RT",
      "RP",
      "BDI",
      "DEL",
      "INS",
    ]);
    const results = [];

    function walk(el) {
      if (!el || el.nodeType !== 1) return;

      if (el.tagName === "IFRAME") {
        try {
          if (el.contentDocument && el.contentDocument.body) {
            walk(el.contentDocument.body);
          }
        } catch (e) {}
        return;
      }

      if (SKIP_TAGS.has(el.tagName)) return;
      if (el.id === "doudou-floating-btn" || el.id === "doudou-translate-toast")
        return;

      // 判断是否为叶子块元素（所有子元素都是行内标签）
      let isLeaf = true;
      for (let i = 0; i < el.children.length; i++) {
        if (!INLINE_TAGS.has(el.children[i].tagName)) {
          isLeaf = false;
          break;
        }
      }

      if (isLeaf) {
        const text = el.innerText?.trim();
        if (!text || text.length < 2) return;
        if (
          el.offsetParent === null &&
          getComputedStyle(el).position !== "fixed"
        )
          return;
        if (el.querySelector("[data-doudou-translate]")) return;
        results.push(el);
      } else {
        for (let i = 0; i < el.children.length; i++) {
          walk(el.children[i]);
        }
      }
    }

    walk(document.body);

    results.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const topA =
        rectA.top + (a.ownerDocument.defaultView?.scrollY || window.scrollY);
      const topB =
        rectB.top + (b.ownerDocument.defaultView?.scrollY || window.scrollY);
      if (Math.abs(topA - topB) < 10) {
        const leftA =
          rectA.left + (a.ownerDocument.defaultView?.scrollX || window.scrollX);
        const leftB =
          rectB.left + (b.ownerDocument.defaultView?.scrollX || window.scrollX);
        return leftA - leftB;
      }
      return topA - topB;
    });

    return results;
  }

  function insertTranslation(el, translated) {
    const span = document.createElement("span");
    span.dataset.doudouTranslate = "";
    span.textContent = "\n" + translated;
    el.appendChild(span);
  }

  function parseNumberedTranslations(text) {
    const map = {};
    let curNum = null;
    let curText = "";
    for (const line of text.split("\n")) {
      const m = line.match(/^\[(\d+)\]\s*(.*)/);
      if (m) {
        if (curNum !== null) map[curNum] = curText.trim();
        curNum = parseInt(m[1]);
        curText = m[2];
      } else if (curNum !== null) {
        curText += "\n" + line;
      }
    }
    if (curNum !== null) map[curNum] = curText.trim();
    return map;
  }

  // ========== 选择翻译弹窗 ==========
  // overrideRect: 可选，从 iframe postMessage 传递来的主框架坐标系下的 rect
  // overrideText: 可选，从 iframe 传递来的选中文本
  function showSelectionBar(selection, overrideRect, overrideText) {
    removeSelectionBar();
    let rect, selectedText, selectedRange;
    if (overrideRect && overrideText) {
      // 从 iframe 传递过来的信息，selection 可能为 null
      rect = overrideRect;
      selectedText = overrideText;
      selectedRange = null; // iframe 中的选区无法在主框架中直接使用
    } else {
      const range = selection.getRangeAt(0);
      rect = range.getBoundingClientRect();
      selectedText = selection.toString().trim();
      selectedRange = range.cloneRange();
    }

    const bar = document.createElement("div");
    bar.id = "doudou-selection-bar";

    const translateBtn = document.createElement("button");
    translateBtn.textContent = "🌐 翻译";
    translateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectedText) {
        removeSelectionBar();
        if (!isContextValid() || isTranslating) return;
        removeAllTranslations();
        removeTranslateToast();
        if (selectedRange) {
          translateSelection(selectedRange, selectedText);
        } else {
          // iframe 来源：没有可用的 range，使用临时方式翻译
          translateSelectionTextOnly(selectedText);
        }
      }
    });
    bar.appendChild(translateBtn);

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "📋 复制";
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectedText) {
        navigator.clipboard.writeText(selectedText).then(() => {
          showCopyToast();
        });
        removeSelectionBar();
      }
    });
    bar.appendChild(copyBtn);

    const askAiBtn = document.createElement("button");
    askAiBtn.textContent = "💬 问AI";
    askAiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectedText && isContextValid()) {
        removeSelectionBar();
        chrome.runtime.sendMessage({ type: "ASK_AI", data: selectedText });
      }
    });
    bar.appendChild(askAiBtn);

    document.body.appendChild(bar);

    // 定位到选区下方居中
    const barRect = bar.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - barRect.width / 2;
    let top = rect.bottom + 6;

    // 边界约束
    left = Math.max(4, Math.min(left, window.innerWidth - barRect.width - 4));
    if (top + barRect.height > window.innerHeight - 4) {
      top = rect.top - barRect.height - 6;
    }

    bar.style.left = left + "px";
    bar.style.top = top + "px";
  }

  function removeSelectionBar() {
    document.getElementById("doudou-selection-bar")?.remove();
  }

  // iframe 来源的翻译：没有 range 对象，只翻译文本并显示 toast
  function translateSelectionTextOnly(text) {
    isTranslating = true;
    const session = ++translateSession;
    showTranslateToast("翻译中...", [
      { label: "取消", onClick: cancelTranslation },
    ]);

    const messages = [
      {
        role: "system",
        content:
          "你是一个专业翻译。将用户提供的文本翻译为中文（简体）。如果原文已经是中文，则翻译为英文。只输出翻译结果，不要解释，不要添加任何额外内容。保留原文的段落结构。",
      },
      { role: "user", content: text },
    ];

    callTranslateLLM(messages)
      .then((translated) => {
        if (session !== translateSession) return;
        isTranslating = false;
        // 没有 range，通过 toast 显示翻译结果
        showTranslateToast(translated, [
          {
            label: "复制",
            onClick: () => {
              navigator.clipboard
                .writeText(translated)
                .then(() => showCopyToast());
              removeTranslateToast();
            },
          },
          { label: "关闭", onClick: removeTranslateToast },
        ]);
      })
      .catch((err) => {
        if (session !== translateSession) return;
        isTranslating = false;
        showTranslateToast("翻译失败: " + err.message);
        clearToastTimer();
        toastTimer = setTimeout(removeTranslateToast, 3000);
      });
  }

  function startPageTranslation() {
    if (!isContextValid()) return;
    if (isTranslating) return;

    removeAllTranslations();
    removeTranslateToast();
    removeSelectionBar();

    translateFullPage();
  }

  function translateSelection(range, text) {
    isTranslating = true;
    const session = ++translateSession;
    showTranslateToast("翻译中...", [
      { label: "取消", onClick: cancelTranslation },
    ]);

    const messages = [
      {
        role: "system",
        content:
          "你是一个专业翻译。将用户提供的文本翻译为中文（简体）。如果原文已经是中文，则翻译为英文。只输出翻译结果，不要解释，不要添加任何额外内容。保留原文的段落结构。",
      },
      { role: "user", content: text },
    ];

    callTranslateLLM(messages)
      .then((translated) => {
        if (session !== translateSession) return;
        const span = document.createElement("span");
        span.dataset.doudouTranslate = "";
        span.textContent = "\n" + translated;
        const insertRange = range.cloneRange();
        insertRange.collapse(false);
        insertRange.insertNode(span);
        isTranslating = false;
        removeTranslateToast();
      })
      .catch((err) => {
        if (session !== translateSession) return;
        isTranslating = false;
        showTranslateToast("翻译失败: " + err.message);
        clearToastTimer();
        toastTimer = setTimeout(removeTranslateToast, 3000);
      });
  }

  async function translateFullPage() {
    const blocks = collectTextBlocks();
    if (blocks.length === 0) return;

    isTranslating = true;
    const session = ++translateSession;
    const BATCH = 10;
    const CONCURRENCY = 26;
    let translated = 0;

    showTranslateToast(`翻译中... 0/${blocks.length}`, [
      { label: "取消", onClick: cancelTranslation },
    ]);

    // 拆分为批次任务
    const tasks = [];
    for (let i = 0; i < blocks.length; i += BATCH) {
      tasks.push(blocks.slice(i, i + BATCH));
    }

    // 并发池：同时跑 CONCURRENCY 个批次
    let taskIdx = 0;
    let failed = false;

    async function runNext() {
      while (taskIdx < tasks.length) {
        if (session !== translateSession || failed) return;
        const idx = taskIdx++;
        const batch = tasks[idx];
        const numbered = batch
          .map((el, i) => `[${i + 1}] ${el.innerText.trim()}`)
          .join("\n");

        const messages = [
          {
            role: "system",
            content:
              "你是一个专业翻译。将以下编号段落翻译为中文（简体）。如果原文已经是中文，则翻译为英文。保持相同的编号格式 [N] 输出翻译结果，每个编号占一行。只输出翻译，不要解释。",
          },
          { role: "user", content: numbered },
        ];

        try {
          const result = await callTranslateLLM(messages);
          if (session !== translateSession) return;
          const map = parseNumberedTranslations(result);
          for (let j = 0; j < batch.length; j++) {
            if (map[j + 1]) insertTranslation(batch[j], map[j + 1]);
          }
          translated += batch.length;
          updateTranslateToast(
            `翻译中... ${Math.min(translated, blocks.length)}/${blocks.length}`,
          );
        } catch (err) {
          if (session !== translateSession) return;
          failed = true;
          isTranslating = false;
          showTranslateToast("翻译失败: " + err.message);
          clearToastTimer();
          toastTimer = setTimeout(removeTranslateToast, 3000);
          return;
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, tasks.length); i++) {
      workers.push(runNext());
    }
    await Promise.all(workers);

    if (session !== translateSession || failed) return;
    isTranslating = false;
    showTranslateToast("翻译完成", [
      {
        label: "移除翻译",
        onClick: () => {
          removeAllTranslations();
          removeTranslateToast();
        },
      },
      { label: "关闭", onClick: removeTranslateToast },
    ]);
  }

  // ========== 浮窗按钮 ==========
  function createFloatingButton() {
    injectStyles();

    const container = document.createElement("div");
    container.id = "doudou-floating-btn";

    const defaultX = window.innerWidth - 56;
    const defaultY = Math.round(window.innerHeight / 2 - 20);

    let preferredPos = { x: defaultX, y: defaultY };

    container.style.left = defaultX + "px";
    container.style.top = defaultY + "px";

    chrome.storage.local.get(STORAGE_POS_KEY, (result) => {
      const pos = result[STORAGE_POS_KEY];
      if (pos) {
        preferredPos = pos;
        const clamped = clampPosition(pos.x, pos.y, 48, 40);
        container.style.left = clamped.x + "px";
        container.style.top = clamped.y + "px";
      }
    });

    const avatar = document.createElement("img");
    avatar.className = "doudou-avatar";
    avatar.src = ICON_URL;
    avatar.draggable = false;

    // --- 拖拽 ---
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, offsetX, offsetY;

    avatar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      isDragging = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      if (
        !hasDragged &&
        Math.abs(e.clientX - startX) < DRAG_THRESHOLD &&
        Math.abs(e.clientY - startY) < DRAG_THRESHOLD
      )
        return;
      hasDragged = true;
      const clamped = clampPosition(
        e.clientX - offsetX,
        e.clientY - offsetY,
        48,
        40,
      );
      container.style.left = clamped.x + "px";
      container.style.top = clamped.y + "px";
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (isDragging && hasDragged) {
        const rect = container.getBoundingClientRect();
        preferredPos = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        };
        if (isContextValid())
          chrome.storage.local.set({
            [STORAGE_POS_KEY]: preferredPos,
          });
      }
      isDragging = false;
    }

    // 点击头像 → 打开 Side Panel
    avatar.addEventListener("click", () => {
      if (hasDragged) return;
      if (isContextValid())
        chrome.runtime.sendMessage({ type: "TOGGLE_SIDE_PANEL" });
    });

    // Close button
    const closeBtn = document.createElement("div");
    closeBtn.className = "doudou-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      container.remove();
      document.getElementById("doudou-floating-btn-style")?.remove();
      if (isContextValid())
        chrome.storage.local.set({ doudouBtnVisible: false });
    });

    container.appendChild(closeBtn);
    container.appendChild(avatar);

    // Actions panel (hover 显示)
    const actionsPanel = document.createElement("div");
    actionsPanel.className = "doudou-actions";
    ACTIONS.forEach((action) => {
      const btnContainer = document.createElement("div");
      btnContainer.className = "doudou-action-item-wrapper";
      if (action.id === "screenshot") {
        btnContainer.classList.add("has-sub");
      }
      btnContainer.style.position = "relative";
      btnContainer.style.display = "flex";

      const btn = document.createElement("button");
      btn.className = "doudou-action-item";
      btn.setAttribute("data-label", action.label);
      btn.innerHTML = action.icon;
      btn.addEventListener("mousedown", (e) => e.preventDefault());

      if (action.id === "screenshot") {
        // 创建子菜单
        const subMenu = document.createElement("div");
        subMenu.className = "doudou-screenshot-sub";

        const fullBtn = document.createElement("button");
        fullBtn.className = "doudou-sub-item";
        fullBtn.innerHTML = `<span style="font-size:14px">📄</span> <span>整页截图</span>`;
        const handleFull = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isContextValid())
            chrome.runtime.sendMessage({
              type: "DOUDOU_BTN_ACTION",
              action: "screenshot",
            });
        };
        fullBtn.addEventListener("click", handleFull);

        const selectBtn = document.createElement("button");
        selectBtn.className = "doudou-sub-item";
        selectBtn.innerHTML = `<span style="font-size:14px">✂️</span> <span>选择截图</span>`;
        const handleSelect = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isContextValid()) {
            chrome.runtime.sendMessage(
              { type: "POPUP_CAPTURE_SCREENSHOT" },
              (res) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "[豆豆] 截图失败:",
                    chrome.runtime.lastError.message,
                  );
                  return;
                }
                if (res && !res.success) {
                  console.error("[豆豆] 截图失败:", res.error);
                }
              },
            );
          }
        };
        selectBtn.addEventListener("click", handleSelect);

        subMenu.appendChild(fullBtn);
        subMenu.appendChild(selectBtn);
        btnContainer.appendChild(btn);
        btnContainer.appendChild(subMenu);

        // 由于点击子按钮会冒泡到 btn 或者 actionsPanel，我们把整体放进 btnContainer 里
        actionsPanel.appendChild(btnContainer);
      } else {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (action.id === "translate") {
            if (isContextValid()) {
              chrome.runtime.sendMessage({ type: "DOUDOU_TRANSLATE_PAGE" });
            }
            return;
          }
          if (action.id === "douyin-media-download") {
            if (!location.hostname.includes("douyin.com")) {
              alert("此功能仅在抖音网页端可用");
              return;
            }
            window.dispatchEvent(
              new CustomEvent("DOUDOU_TRIGGER_MEDIA_DOWNLOAD"),
            );
            return;
          }
          if (action.id === "summarize-page") {
            if (!isContextValid()) return;
            chrome.runtime.sendMessage({ type: "SUMMARIZE_PAGE_ACTION" });
            return;
          }

          if (isContextValid()) {
            chrome.runtime.sendMessage(
              {
                type: "DOUDOU_BTN_ACTION",
                action: action.id,
              },
              (res) => {
                if (chrome.runtime.lastError) {
                  console.error(chrome.runtime.lastError);
                  return;
                }
                if (res && res.error) {
                  alert("操作失败: " + res.error);
                }
              },
            );
          }
        });
        actionsPanel.appendChild(btnContainer);
        btnContainer.appendChild(btn);
      }
    });
    container.appendChild(actionsPanel);

    document.body.appendChild(container);

    window.addEventListener("resize", () => {
      const clamped = clampPosition(preferredPos.x, preferredPos.y, 48, 40);
      container.style.left = clamped.x + "px";
      container.style.top = clamped.y + "px";
    });

    // 侧边栏关闭后，恢复头像到保存的位置
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SIDEPANEL_CLOSED") {
        chrome.storage.local.get(STORAGE_POS_KEY, (result) => {
          const pos = result[STORAGE_POS_KEY];
          if (pos) {
            preferredPos = pos;
            const clamped = clampPosition(pos.x, pos.y, 48, 40);
            container.style.left = clamped.x + "px";
            container.style.top = clamped.y + "px";
          }
        });
      }
    });
  }

  function removeFloatingButton() {
    document.getElementById("doudou-floating-btn")?.remove();
    document.getElementById("doudou-floating-btn-style")?.remove();
  }

  // ========== 选择翻译弹窗：监听文本选择 ==========
  document.addEventListener("mouseup", (e) => {
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (
      el?.closest(
        "#doudou-floating-btn, #doudou-selection-bar, #doudou-translate-toast",
      )
    )
      return;
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && text.length > 0) {
        if (window !== window.top) {
          // 在 iframe 中：先在本地显示弹窗（保底），同时向 parent 发送坐标
          showSelectionBar(selection);
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          try {
            window.parent.postMessage(
              {
                type: "DOUDOU_IFRAME_SELECTION",
                text: text,
                rect: {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                },
              },
              "*",
            );
          } catch (err) {}
        } else {
          showSelectionBar(selection);
        }
      } else {
        removeSelectionBar();
      }
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!el?.closest("#doudou-selection-bar")) {
      removeSelectionBar();
      // 逐级通知 parent 移除
      if (window !== window.top) {
        try {
          window.parent.postMessage(
            { type: "DOUDOU_IFRAME_SELECTION_REMOVE" },
            "*",
          );
        } catch (err) {}
      }
    }
  });

  // 每一级 frame 都监听子 iframe 发来的选区消息（逐级中继）
  let _doudouSelectionSource = null;
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data.type !== "string") return;

    if (e.data.type === "DOUDOU_IFRAME_SELECTION") {
      // 找到发送消息的直接子 iframe 元素
      const iframeEl = findDirectChildIframe(e.source);
      if (!iframeEl || !e.data.rect || !e.data.text) return;

      // 将子 iframe 内部坐标转换为当前 frame 的坐标
      const iframeRect = iframeEl.getBoundingClientRect();
      const adjustedRect = {
        left: e.data.rect.left + iframeRect.left,
        top: e.data.rect.top + iframeRect.top,
        right: e.data.rect.right + iframeRect.left,
        bottom: e.data.rect.bottom + iframeRect.top,
        width: e.data.rect.width,
        height: e.data.rect.height,
      };

      if (window === window.top) {
        // 已到顶层：在此显示弹窗
        showSelectionBar(null, adjustedRect, e.data.text);
        // 通知源 iframe 链移除它们的弹窗
        try {
          e.source.postMessage({ type: "DOUDOU_IFRAME_SELECTION_TAKEN" }, "*");
        } catch (err) {}
      } else {
        // 当前也是 iframe：继续向上中继
        try {
          window.parent.postMessage(
            {
              type: "DOUDOU_IFRAME_SELECTION",
              text: e.data.text,
              rect: adjustedRect,
            },
            "*",
          );
        } catch (err) {}
        // 保存源引用，以便收到 TAKEN 后向下传递
        _doudouSelectionSource = e.source;
      }
    } else if (e.data.type === "DOUDOU_IFRAME_SELECTION_TAKEN") {
      // 主框架已接管显示，移除本 frame 的弹窗
      removeSelectionBar();
      // 如果本 frame 是中继节点，继续向下传递 TAKEN
      if (_doudouSelectionSource) {
        try {
          _doudouSelectionSource.postMessage(
            { type: "DOUDOU_IFRAME_SELECTION_TAKEN" },
            "*",
          );
        } catch (err) {}
        _doudouSelectionSource = null;
      }
    } else if (e.data.type === "DOUDOU_IFRAME_SELECTION_REMOVE") {
      removeSelectionBar();
      // 继续向上传递移除通知
      if (window !== window.top) {
        try {
          window.parent.postMessage(
            { type: "DOUDOU_IFRAME_SELECTION_REMOVE" },
            "*",
          );
        } catch (err) {}
      }
    }
  });

  // 查找直接子 iframe 元素（contentWindow 比较即使跨域也有效）
  function findDirectChildIframe(source) {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        if (iframe.contentWindow === source) return iframe;
      } catch (e) {}
    }
    return null;
  }

  // ========== 初始化 ==========
  if (!isContextValid()) return;

  // 监听来自 background 的全页面/跨 iframe 翻译指令
  document.addEventListener("DOUDOU_TRANSLATE_PAGE", () => {
    startPageTranslation();
  });

  // 如果当前是 iframe，监听 ESC 键并转发给主框架（用于截图选区等场景）
  if (window !== window.top) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          try {
            window.top.postMessage({ type: "DOUDOU_IFRAME_ESC" }, "*");
          } catch (err) {}
        }
      },
      true,
    );
  }

  if (window === window.top) {
    chrome.storage.local.get("doudouBtnVisible", ({ doudouBtnVisible }) => {
      if (doudouBtnVisible !== false) createFloatingButton();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (!isContextValid()) return;
      if (namespace === "local" && "doudouBtnVisible" in changes) {
        if (changes.doudouBtnVisible.newValue === false) {
          removeFloatingButton();
        } else if (!document.getElementById("doudou-floating-btn")) {
          createFloatingButton();
        }
      }
    });
  }
})();
