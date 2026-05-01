/**
 * 注入到页面执行的辅助函数
 * 这些函数会被 popup.js 通过 chrome.scripting.executeScript 注入到页面中
 * 因此需要保持独立，不能被混淆
 */

/**
 * 设置自动确认标志为 true
 */
function setCrawlerAutoConfirmTrue() {
  window.__CRAWLER_AUTO_CONFIRM = true;
}

// 导出函数供 popup.js 使用
export { setCrawlerAutoConfirmTrue };
