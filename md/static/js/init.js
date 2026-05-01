// 主题初始化：检测暗色模式并应用到 loading 界面
const theme = localStorage.getItem("vueuse-color-scheme");
if (
  theme === "dark" ||
  (theme === "auto" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches)
) {
  document.querySelector(".loading").classList.add("dark");
}

// 超时提示：30秒后显示加载超时提醒
setTimeout(() => {
  const tip = document.querySelector(".loading .timeout-tip");
  if (tip) {
    tip.style.display = "block";
  }
}, 30000);

// MathJax 配置
window.MathJax = {
  tex: { tags: "ams" },
  svg: { fontCache: "none" },
};
