/**
 * Shared UI Utilities for Doudou Extension
 */

/**
 * 显示极简风格的提示框
 * @param {string} message 提示信息
 * @param {string} type 提示类型: 'info', 'success', 'error', 'warning'
 */
export function showToast(message, type = "info") {
  // popup 页面已通过 popup.css 内置 toast 样式，只在内容页注入 ui.css
  const isPopup = location.protocol === 'chrome-extension:' && location.pathname.endsWith('popup.html');
  if (!isPopup && !document.getElementById("doudou-ui-css")) {
    const link = document.createElement("link");
    link.id = "doudou-ui-css";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL('src/utils/ui.css');
    document.head.appendChild(link);
  }

  // 移除已存在的 toast
  const existingToast = document.querySelector(".custom-toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.className = `custom-toast custom-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // 3秒后自动消失
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * 显示自定义确认框
 * @param {string} message 消息内容
 * @param {string} title 标题
 * @param {string} type 按钮类型: 'danger', 'primary'
 * @param {boolean} isHtml 消息是否为 HTML 内容
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, title = "提示", type = "danger", isHtml = false) {
  return new Promise((resolve) => {
    // 检查是否已存在模态框，不存在则创建
    let modal = document.getElementById("ui-confirm-modal");
    if (!modal) {
      modal = createConfirmModal();
    }

    const titleEl = modal.querySelector(".ui-confirm-title");
    const messageEl = modal.querySelector(".ui-confirm-message");
    const okBtn = modal.querySelector(".ui-confirm-ok");
    const cancelBtn = modal.querySelector(".ui-confirm-cancel");

    titleEl.textContent = title;
    if (isHtml) {
      messageEl.innerHTML = message;
    } else {
      messageEl.textContent = message;
    }

    // Set button style based on type
    if (type === "primary") {
      okBtn.style.backgroundColor = "#1890ff"; // Blue
    } else {
      okBtn.style.backgroundColor = "#ff4d4f"; // Red (Danger)
    }

    modal.style.display = "flex";

    const newOkBtn = modal.querySelector(".ui-confirm-ok");
    const newCancelBtn = modal.querySelector(".ui-confirm-cancel");

    // 重新绑定事件
    newOkBtn.onclick = () => {
      modal.style.display = "none";
      resolve(true);
    };

    newCancelBtn.onclick = () => {
      modal.style.display = "none";
      resolve(false);
    };

    // 点击背景关闭
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        resolve(false);
      }
    };
  });
}

function createConfirmModal() {
  const overlay = document.createElement("div");
  overlay.id = "ui-confirm-modal";
  overlay.className = "modal-overlay"; // Reuse existing class if possible, or define shared styles
  overlay.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    align-items: center;
    justify-content: center;
  `;

  overlay.innerHTML = `
    <div class="modal" style="background: #fff; border-radius: 8px; width: 320px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); overflow: hidden; animation: modalIn 0.2s ease-out;">
      <div class="modal-content" style="padding: 24px;">
        <h3 class="ui-confirm-title" style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #333;"></h3>
        <p class="ui-confirm-message" style="margin: 0 0 24px; color: #666; font-size: 14px; line-height: 1.5;"></p>
        <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 12px;">
          <button class="ui-confirm-cancel" style="padding: 6px 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; color: #666;">取消</button>
          <button class="ui-confirm-ok" style="padding: 6px 12px; border: none; background: #ff4d4f; border-radius: 4px; cursor: pointer; color: #fff;">确认</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}
