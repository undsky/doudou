// JSON编辑器逻辑
let editor = null;

// 清理JSON文本中的不可见字符（BOM、零宽字符、不间断空格等）
function sanitizeJSON(text) {
  if (typeof text !== "string") return text;
  // 去除 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  // 去除零宽字符
  text = text.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "");
  // 不间断空格替换为普通空格
  text = text.replace(/\u00A0/g, " ");
  return text;
}

document.addEventListener("DOMContentLoaded", () => {
  // 初始化编辑器
  const container = document.getElementById("jsoneditor");
  const options = {
    // 编辑模式配置
    mode: "tree",
    modes: ["tree", "code", "form", "text", "view", "preview"],

    // 启用所有功能
    search: true,
    history: true,
    navigationBar: true,
    statusBar: true,
    mainMenuBar: true,
    colorPicker: true,

    sortObjectKeys: false,
    limitDragging: false,
    escapeUnicode: false,
    timestampTag: true,

    language: "zh-CN",

    onError: function (err) {
      showToast(err.toString(), "error");
    },

    onModeChange: function (newMode, oldMode) {
      // 同步更新Tab按钮状态
      updateModeTab(newMode);
    },
  };

  editor = new JSONEditor(container, options);

  // 拦截粘贴事件，清理不可见字符
  container.addEventListener("paste", (e) => {
    const mode = editor.getMode();
    if (mode === "code" || mode === "text") {
      const raw = e.clipboardData.getData("text/plain");
      const cleaned = sanitizeJSON(raw);
      if (cleaned !== raw) {
        e.stopPropagation();
        e.preventDefault();
        editor.setText(cleaned);
      }
    }
  }, true);

  // 包装模式切换，切换前清理文本中的不可见字符
  const origSetMode = editor.setMode.bind(editor);
  editor.setMode = function (mode) {
    try {
      const curMode = editor.getMode();
      if (curMode === "code" || curMode === "text") {
        const text = editor.getText();
        const cleaned = sanitizeJSON(text);
        if (cleaned !== text) {
          editor.setText(cleaned);
        }
      }
    } catch (e) {
      // ignore
    }
    origSetMode(mode);
  };

  // 设置初始 JSON
  const initialJson = {
    welcome: "欢迎使用 JSON 编辑器",
    features: [
      "🌳 树形视图编辑",
      "💻 代码视图编辑",
      "📝 表单视图编辑",
      "📄 文本视图编辑",
      "👁️ 预览模式",
      "🔍 搜索和过滤",
      "↩️ 撤销和重做",
      "🎨 颜色选择器",
      "⏰ 时间戳识别",
    ],
    example: {
      string: "Hello World",
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      object: { nested: "value" },
      color: "#1890ff",
      timestamp: Date.now(),
    },
  };
  editor.set(initialJson);

  // 模式Tab切换
  const modeTabs = document.querySelectorAll(".mode-tab");
  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      editor.setMode(mode);
      updateModeTab(mode);
    });
  });

  function updateModeTab(mode) {
    modeTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.mode === mode);
    });
  }

  // Toast 提示
  function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast " + type;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2000);
  }

  // 新建
  document.getElementById("btn-new").addEventListener("click", () => {
    editor.set({});
    showToast("已新建空白 JSON", "success");
  });

  // 打开文件
  document.getElementById("btn-open").addEventListener("click", () => {
    document.getElementById("file-input").click();
  });

  document.getElementById("file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = sanitizeJSON(event.target.result);
        const json = JSON.parse(text);
        editor.set(json);
        showToast("文件已加载: " + file.name, "success");
      } catch (err) {
        showToast("无效的 JSON 文件", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // 复制到剪贴板
  document.getElementById("btn-copy").addEventListener("click", async () => {
    try {
      const json = editor.get();
      const text = JSON.stringify(json, null, 2);
      await navigator.clipboard.writeText(text);
      showToast("已复制到剪贴板", "success");
    } catch (err) {
      showToast("复制失败: " + err.message, "error");
    }
  });

  // 下载
  document.getElementById("btn-download").addEventListener("click", () => {
    try {
      const json = editor.get();
      const text = JSON.stringify(json, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(
        now.getMonth() + 1
      ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(
        now.getHours()
      ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      a.download = `json_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("文件已下载", "success");
    } catch (err) {
      showToast("下载失败: " + err.message, "error");
    }
  });
});
