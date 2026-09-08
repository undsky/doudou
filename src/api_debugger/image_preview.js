import { showToast } from "../utils/ui.js";

// 图片格式检测正则
const DATA_IMAGE_REGEX = /^data:image\/([a-zA-Z0-9+]+);base64,/i;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff)(\?.*)?$/i;
const PURE_BASE64_MAGIC_REGEX = /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|Qk0)/;
const IMAGE_FIELD_REGEX = /(image|img|pic|photo|avatar|cover|thumbnail|poster|icon|logo|badge|banner)/i;

/**
 * 格式化字节大小
 */
function formatBytes(bytes) {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 智能识别字符串是否为图片（URL 或 Base64）
 * @param {any} value 节点值
 * @param {string} fieldName 字段名（可选）
 * @returns {{ src: string, type: 'url'|'base64'|'pure_base64', format: string, raw: string, sizeText?: string } | null}
 */
export function detectImageSource(value, fieldName = "") {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 10) return null;

  // 1. Data URL (如 data:image/png;base64,...)
  const dataMatch = trimmed.match(DATA_IMAGE_REGEX);
  if (dataMatch) {
    const format = (dataMatch[1] || "IMAGE").toUpperCase();
    const base64Data = trimmed.slice(dataMatch[0].length);
    const approxBytes = Math.round((base64Data.length * 3) / 4);
    return {
      src: trimmed,
      type: "base64",
      format: format === "SVG+XML" ? "SVG" : format,
      raw: trimmed,
      sizeText: formatBytes(approxBytes),
    };
  }

  // 2. HTTP/HTTPS URL
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname.toLowerCase();
      const extMatch = pathname.match(/\.([a-z0-9]+)$/i);
      const knownExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];

      if (extMatch && knownExts.includes(extMatch[1])) {
        const ext = extMatch[1].toUpperCase();
        return {
          src: trimmed,
          type: "url",
          format: ext === "JPEG" ? "JPG" : ext,
          raw: trimmed,
        };
      }

      // 如果带 query 且有常见图片后缀或图片处理参数
      if (IMAGE_EXT_REGEX.test(pathname) || /format=(png|jpe?g|webp|gif)/i.test(url.search)) {
        const fmtMatch = url.search.match(/format=([a-z]+)/i);
        return {
          src: trimmed,
          type: "url",
          format: (fmtMatch ? fmtMatch[1] : "IMAGE").toUpperCase(),
          raw: trimmed,
        };
      }

      // 字段名明确标识为图片，且为合法 HTTP 链接
      if (fieldName && IMAGE_FIELD_REGEX.test(fieldName)) {
        return {
          src: trimmed,
          type: "url",
          format: "URL",
          raw: trimmed,
        };
      }
    } catch (e) {
      // 不是合法的 URL 结构，跳过
    }
  }

  // 3. 纯 Base64 字符串（不带 data:image/ 前缀）
  if (trimmed.length > 60) {
    let mime = null;
    let format = "BASE64";

    if (trimmed.startsWith("iVBORw0KGgo")) {
      mime = "image/png";
      format = "PNG";
    } else if (trimmed.startsWith("/9j/")) {
      mime = "image/jpeg";
      format = "JPEG";
    } else if (trimmed.startsWith("R0lGOD")) {
      mime = "image/gif";
      format = "GIF";
    } else if (trimmed.startsWith("UklGR")) {
      mime = "image/webp";
      format = "WEBP";
    } else if (trimmed.startsWith("Qk0")) {
      mime = "image/bmp";
      format = "BMP";
    } else if (fieldName && IMAGE_FIELD_REGEX.test(fieldName) && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 120))) {
      mime = "image/png";
      format = "BASE64";
    }

    if (mime) {
      const approxBytes = Math.round((trimmed.length * 3) / 4);
      return {
        src: `data:${mime};base64,${trimmed}`,
        type: "pure_base64",
        format,
        raw: trimmed,
        sizeText: formatBytes(approxBytes),
      };
    }
  }

  return null;
}

/**
 * 复制图片链接或 Base64
 */
export async function copyImageSource(src) {
  try {
    await navigator.clipboard.writeText(src);
    showToast("已复制到剪贴板", "success");
  } catch (err) {
    const input = document.createElement("textarea");
    input.value = src;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast("已复制到剪贴板", "success");
  }
}

/**
 * 新标签页打开图片
 */
export function openImageInNewTab(src) {
  if (src.startsWith("data:")) {
    try {
      const arr = src.split(",");
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return;
    } catch (e) {}
  }
  window.open(src, "_blank", "noreferrer");
}

/**
 * 下载图片到本地
 */
export async function downloadImage(src, defaultName = "image") {
  try {
    if (src.startsWith("data:")) {
      const extMatch = src.match(/^data:image\/([a-zA-Z0-9+]+);/i);
      const ext = (extMatch ? extMatch[1] : "png").toLowerCase().replace("jpeg", "jpg");
      const a = document.createElement("a");
      a.href = src;
      a.download = `${defaultName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("已开始下载", "success");
      return;
    }

    // HTTP/HTTPS: 尝试 fetch blob 防止跨域直接跳转预览
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("Fetch response not ok");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const urlObj = new URL(src);
      const fileName = urlObj.pathname.split("/").pop() || `${defaultName}.png`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      showToast("已开始下载", "success");
    } catch (e) {
      // Fallback
      const a = document.createElement("a");
      a.href = src;
      a.target = "_blank";
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("已在新标签页发起下载", "info");
    }
  } catch (err) {
    showToast("下载失败: " + err.message, "error");
  }
}

/**
 * 单例图片预览控制器
 */
class ImagePreviewController {
  constructor() {
    this.popoverEl = null;
    this.modalEl = null;
    this.currentImageInfo = null;
    this.currentTargetEl = null;
    this.hideTimer = null;
    this.showTimer = null;
    if (typeof document !== "undefined") {
      this._initDom();
    }
  }

  _ensureDom() {
    if (!this.popoverEl && typeof document !== "undefined") {
      this._initDom();
    }
  }

  _initDom() {
    // 1. 创建悬浮卡片
    this.popoverEl = document.createElement("div");
    this.popoverEl.id = "json-image-popover";
    this.popoverEl.className = "json-image-popover hidden";
    this.popoverEl.innerHTML = `
      <div class="jip-header">
        <span class="jip-format-badge">IMG</span>
        <span class="jip-meta-text">加载中...</span>
      </div>
      <div class="jip-preview-container" title="点击放大查看">
        <div class="jip-loading-spinner"></div>
        <img class="jip-image" alt="图片预览" />
        <div class="jip-error hidden">⚠️ 图片无法加载</div>
      </div>
      <div class="jip-actions">
        <button type="button" class="jip-btn jip-btn-zoom" title="放大查看">🔍 放大</button>
        <button type="button" class="jip-btn jip-btn-open" title="新标签打开">↗ 打开</button>
        <button type="button" class="jip-btn jip-btn-copy" title="复制">📋 复制</button>
        <button type="button" class="jip-btn jip-btn-download" title="下载图片">💾 下载</button>
      </div>
    `;
    document.body.appendChild(this.popoverEl);

    // 绑定悬浮卡片事件：进入卡片清除隐藏计时，离开卡片触发隐藏
    this.popoverEl.addEventListener("mouseenter", () => {
      this.cancelHide();
    });
    this.popoverEl.addEventListener("mouseleave", () => {
      this.scheduleHide(150);
    });

    // 绑定卡片操作按钮
    const zoomBtn = this.popoverEl.querySelector(".jip-btn-zoom");
    const openBtn = this.popoverEl.querySelector(".jip-btn-open");
    const copyBtn = this.popoverEl.querySelector(".jip-btn-copy");
    const downloadBtn = this.popoverEl.querySelector(".jip-btn-download");
    const previewContainer = this.popoverEl.querySelector(".jip-preview-container");

    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      this.openModal();
    };
    previewContainer.onclick = (e) => {
      e.stopPropagation();
      this.openModal();
    };
    openBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.currentImageInfo) openImageInNewTab(this.currentImageInfo.src);
    };
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.currentImageInfo) copyImageSource(this.currentImageInfo.raw);
    };
    downloadBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.currentImageInfo) downloadImage(this.currentImageInfo.src);
    };

    // 2. 创建大图弹窗
    this.modalEl = document.createElement("div");
    this.modalEl.id = "image-preview-modal";
    this.modalEl.className = "image-preview-modal hidden";
    this.modalEl.innerHTML = `
      <div class="ipm-backdrop"></div>
      <div class="ipm-container">
        <div class="ipm-toolbar">
          <div class="ipm-info">
            <span class="ipm-badge ipm-format-badge">IMG</span>
            <span class="ipm-meta">分辨率加载中...</span>
          </div>
          <div class="ipm-actions">
            <button type="button" class="ipm-btn ipm-btn-open" title="新标签打开">↗ 打开</button>
            <button type="button" class="ipm-btn ipm-btn-copy" title="复制">📋 复制</button>
            <button type="button" class="ipm-btn ipm-btn-download" title="下载图片">💾 下载</button>
            <button type="button" class="ipm-btn ipm-btn-close" title="关闭 (ESC)">✕</button>
          </div>
        </div>
        <div class="ipm-body">
          <img class="ipm-image" alt="大图预览" />
        </div>
      </div>
    `;
    document.body.appendChild(this.modalEl);

    // 绑定大图弹窗关闭事件
    const backdrop = this.modalEl.querySelector(".ipm-backdrop");
    const closeBtn = this.modalEl.querySelector(".ipm-btn-close");
    const mOpenBtn = this.modalEl.querySelector(".ipm-btn-open");
    const mCopyBtn = this.modalEl.querySelector(".ipm-btn-copy");
    const mDownloadBtn = this.modalEl.querySelector(".ipm-btn-download");

    backdrop.onclick = () => this.closeModal();
    closeBtn.onclick = () => this.closeModal();

    mOpenBtn.onclick = () => {
      if (this.currentImageInfo) openImageInNewTab(this.currentImageInfo.src);
    };
    mCopyBtn.onclick = () => {
      if (this.currentImageInfo) copyImageSource(this.currentImageInfo.raw);
    };
    mDownloadBtn.onclick = () => {
      if (this.currentImageInfo) downloadImage(this.currentImageInfo.src);
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.modalEl.classList.contains("hidden")) {
        this.closeModal();
      }
    });
  }

  show(imageInfo, targetEl) {
    this._ensureDom();
    this.cancelHide();
    clearTimeout(this.showTimer);

    // 防抖 80ms 避免快速滑过多个节点引起闪烁
    this.showTimer = setTimeout(() => {
      this._renderPopover(imageInfo, targetEl);
    }, 80);
  }

  _renderPopover(imageInfo, targetEl) {
    this.currentImageInfo = imageInfo;
    this.currentTargetEl = targetEl;

    const formatBadge = this.popoverEl.querySelector(".jip-format-badge");
    const metaText = this.popoverEl.querySelector(".jip-meta-text");
    const imgEl = this.popoverEl.querySelector(".jip-image");
    const spinner = this.popoverEl.querySelector(".jip-loading-spinner");
    const errorEl = this.popoverEl.querySelector(".jip-error");

    formatBadge.textContent = imageInfo.format || "IMG";
    metaText.textContent = imageInfo.sizeText ? `${imageInfo.sizeText} · 加载中...` : "加载中...";

    spinner.classList.remove("hidden");
    errorEl.classList.add("hidden");
    imgEl.style.display = "none";

    // 预加载并获取图片尺寸
    const testImg = new Image();
    testImg.onload = () => {
      if (this.currentImageInfo !== imageInfo) return;
      spinner.classList.add("hidden");
      imgEl.src = imageInfo.src;
      imgEl.style.display = "block";

      const dim = `${testImg.naturalWidth} × ${testImg.naturalHeight} px`;
      imageInfo.dimensions = dim;
      metaText.textContent = imageInfo.sizeText ? `${dim} · ${imageInfo.sizeText}` : dim;
      this._updatePosition(targetEl);
    };
    testImg.onerror = () => {
      if (this.currentImageInfo !== imageInfo) return;
      spinner.classList.add("hidden");
      errorEl.classList.remove("hidden");
      metaText.textContent = "图片加载失败";
    };
    testImg.src = imageInfo.src;

    this._updatePosition(targetEl);
    this.popoverEl.classList.remove("hidden");
  }

  _updatePosition(targetEl) {
    if (!targetEl || typeof targetEl.getBoundingClientRect !== "function") return;
    const rect = targetEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const popoverWidth = 290;
    const popoverHeight = 270;
    const padding = 12;

    // 默认展示在目标元素下方
    let top = rect.bottom + 6;
    if (top + popoverHeight > window.innerHeight - padding) {
      // 空间不足则展示在上方
      top = Math.max(padding, rect.top - popoverHeight - 6);
    }

    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - popoverWidth - padding);
    }

    this.popoverEl.style.top = `${Math.round(top)}px`;
    this.popoverEl.style.left = `${Math.round(left)}px`;
  }

  scheduleHide(delay = 180) {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, delay);
  }

  cancelHide() {
    clearTimeout(this.hideTimer);
  }

  hide() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    if (this.popoverEl) {
      this.popoverEl.classList.add("hidden");
    }
    this.currentTargetEl = null;
  }

  openModal() {
    if (!this.currentImageInfo) return;
    this.hide();

    const info = this.currentImageInfo;
    const badge = this.modalEl.querySelector(".ipm-format-badge");
    const meta = this.modalEl.querySelector(".ipm-meta");
    const img = this.modalEl.querySelector(".ipm-image");

    badge.textContent = info.format || "IMG";
    meta.textContent = [info.dimensions, info.sizeText].filter(Boolean).join(" · ") || "图片预览";
    img.src = info.src;

    this.modalEl.classList.remove("hidden");
  }

  closeModal() {
    if (this.modalEl) {
      this.modalEl.classList.add("hidden");
    }
  }
}

// 导出全局控制器实例
export const imagePreview = new ImagePreviewController();

/**
 * 配合 JSONEditor 的 onClassName 钩子
 */
export function getImageNodeClassName(node) {
  if (!node || typeof node.value !== "string") return "";
  const detected = detectImageSource(node.value, node.field);
  return detected ? "json-image-node" : "";
}

/**
 * 配合 JSONEditor 的 onEvent 钩子
 */
export function handleJsonEditorImageEvent(node, event) {
  if (!node || typeof node.value !== "string") return;
  const imageInfo = detectImageSource(node.value, node.field);
  if (!imageInfo) return;

  if (event.type === "mouseover") {
    imagePreview.show(imageInfo, event.target);
  } else if (event.type === "mouseout") {
    imagePreview.scheduleHide();
  } else if (event.type === "click") {
    // 点击直接弹出大图
    imagePreview.show(imageInfo, event.target);
    imagePreview.openModal();
  }
}

/**
 * 为 JSONEditor 容器绑定代码模式 (Ace Editor) 的图片字符串悬浮检测
 */
export function attachAceImageHover(container) {
  if (!container) return;

  container.addEventListener("mouseover", (e) => {
    const aceString = e.target.closest(".ace_string");
    if (!aceString) return;

    const rawText = aceString.textContent.replace(/^["']|["']$/g, "");
    const imgInfo = detectImageSource(rawText);
    if (imgInfo) {
      aceString.classList.add("json-image-detected");
      imagePreview.show(imgInfo, aceString);
    }
  });

  container.addEventListener("mouseout", (e) => {
    const aceString = e.target.closest(".ace_string");
    if (aceString) {
      imagePreview.scheduleHide();
    }
  });

  container.addEventListener("click", (e) => {
    const aceString = e.target.closest(".ace_string");
    if (!aceString) return;

    const rawText = aceString.textContent.replace(/^["']|["']$/g, "");
    const imgInfo = detectImageSource(rawText);
    if (imgInfo && e.ctrlKey) {
      imagePreview.show(imgInfo, aceString);
      imagePreview.openModal();
    }
  });
}
