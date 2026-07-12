import { OpenAIClient } from "./ai/openai.js";

(function () {
  const ICON_URL = chrome.runtime.getURL("icons/doudou_128.png");

  // 通知 background 侧边栏已打开（关闭时 port 自动断开）
  // Service worker 可能被回收重启，端口断开后自动重连
  let sidepanelPort = null;
  let screenshotBusy = false;

  // 模型选择相关
  let selectedModelConfigId = null; // 当前选中的配置ID

  function onPortMessage(msg) {
    if (msg.type === "SCREENSHOT_RESULT") {
      screenshotBusy = false;
      if (msg.data) {
        addAttachment({
          data: msg.data,
          name: "screenshot.png",
          isImage: true,
        });
      }
    } else if (msg.type === "ASK_AI") {
      textarea.value = msg.data;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
      textarea.scrollTop = textarea.scrollHeight;
    } else if (msg.type === "SUMMARIZE_PAGE") {
      startNewTopic();
      textarea.value = `请用中文总结以下页面内容：\n\n${msg.data}`;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
      sendMessage();
    } else if (msg.type === "VOICE_RESULT") {
      voiceFinal = msg.final || "";
      voiceInterim = msg.interim || "";
      // 语音指令：豆豆发送
      if (/豆豆[,，\s]*发送[。.!！\s]*$/.test(voiceFinal)) {
        voiceFinal = voiceFinal
          .replace(/豆豆[,，\s]*发送[。.!！\s]*$/, "")
          .trim();
        textarea.value = voiceBaseText + voiceFinal;
        stopVoice();
        sendMessage();
        return;
      }
      textarea.value = voiceBaseText + voiceFinal + voiceInterim;
      textarea.dispatchEvent(new Event("input"));
    } else if (msg.type === "VOICE_ERROR") {
      console.error("[豆豆] 语音识别错误:", msg.error);
      stopVoice();
    } else if (msg.type === "VOICE_END") {
      stopVoice();
    }
  }

  function connectPort() {
    sidepanelPort = chrome.runtime.connect({ name: "doudou-sidepanel" });
    sidepanelPort.onMessage.addListener(onPortMessage);
    sidepanelPort.onDisconnect.addListener(() => {
      sidepanelPort = null;
      // Service worker 重启后自动重连
      setTimeout(connectPort, 200);
    });
  }
  connectPort();

  // 设置图标
  document.getElementById("welcome-icon").src = ICON_URL;

  // ========== Markdown 检测与渲染 ==========
  // 配置 marked
  if (typeof marked !== "undefined") {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }

  function isMarkdown(text) {
    if (!text || typeof text !== "string") return false;
    // 检测常见 markdown 特征
    const mdPatterns = [
      /^#{1,6}\s+/m,           // 标题
      /\*\*[^*]+\*\*/,          // 粗体
      /\*[^*]+\*/,              // 斜体
      /```[\s\S]*?```/,         // 代码块
      /`[^`]+`/,                // 行内代码
      /^\s*[-*+]\s+/m,          // 无序列表
      /^\s*\d+\.\s+/m,          // 有序列表
      /\[.+?\]\(.+?\)/,         // 链接
      /^\s*>/m,                 // 引用
      /^\s*\|.*\|/m,            // 表格
      /^---+$/m,                // 分割线
      /!\[.*?\]\(.*?\)/,        // 图片
    ];
    let matchCount = 0;
    for (const pattern of mdPatterns) {
      if (pattern.test(text)) matchCount++;
      if (matchCount >= 1) return true;
    }
    return false;
  }

  function mdToHtml(text) {
    if (!text) return "";
    // 如果 marked 可用且内容含 markdown 特征，使用 marked 渲染
    if (typeof marked !== "undefined" && isMarkdown(text)) {
      try {
        return marked.parse(text);
      } catch (e) {
        console.warn("[豆豆] marked 渲染失败，回退简单渲染:", e);
      }
    }
    // 回退：简单 HTML 转义
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html
      .split(/\n{2,}/)
      .map((p) => {
        p = p.trim();
        if (!p) return p;
        return `<p>${p.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    return html;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  // ========== 状态 ==========
  let chatMessages = [];
  let isGenerating = false;
  let currentPort = null;
  let translateMode = false;
  let pendingAttachments = [];

  // ========== Enter 发送开关 ==========
  const enterSendCheckbox = document.getElementById("doudou-enter-send");
  let enterSendEnabled = enterSendCheckbox.checked; // 默认 true

  function getDefaultPlaceholder() {
    const key = enterSendEnabled ? "Enter" : "Ctrl+Enter";
    return `输入 / 选择技能、发消息快捷键 ${key}、发消息语音指令：豆豆发送`;
  }

  function applyEnterSendState(enabled) {
    enterSendEnabled = enabled;
    enterSendCheckbox.checked = enabled;
    if (!translateMode) {
      textarea.placeholder = getDefaultPlaceholder();
    }
    updateSendBtn();
  }

  // 恢复保存的状态
  chrome.storage.local.get("enterSendEnabled", (res) => {
    applyEnterSendState(res.enterSendEnabled !== false); // 默认 true
  });

  enterSendCheckbox.addEventListener("change", () => {
    enterSendEnabled = enterSendCheckbox.checked;
    chrome.storage.local.set({ enterSendEnabled });
    if (!translateMode) {
      textarea.placeholder = getDefaultPlaceholder();
    }
    updateSendBtn();
  });

  // ========== TTS 语音播放（自动跟随模式） ==========
  const ttsBtn = document.getElementById("doudou-tts-btn");
  let ttsAutoPlay = false; // 开关状态
  let ttsSentenceBuffer = ""; // 句子级缓冲
  const TTS_SENTENCE_RE = /[。！？.!?\n]/; // 句子结束符

  function stopTTS() {
    speechSynthesis.cancel();
    ttsSentenceBuffer = "";
  }

  function ttsSpeak(text) {
    if (!text.trim()) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    speechSynthesis.speak(utter);
  }

  /** 流式 chunk 到达时调用，按句子切分并朗读 */
  function ttsFeed(chunk) {
    if (!ttsAutoPlay) return;
    ttsSentenceBuffer += chunk;
    let idx;
    while ((idx = ttsSentenceBuffer.search(TTS_SENTENCE_RE)) !== -1) {
      const sentence = ttsSentenceBuffer.slice(0, idx + 1);
      ttsSentenceBuffer = ttsSentenceBuffer.slice(idx + 1);
      ttsSpeak(sentence);
    }
  }

  /** AI 回答结束时调用，朗读剩余缓冲 */
  function ttsFlush() {
    if (!ttsAutoPlay) return;
    if (ttsSentenceBuffer.trim()) {
      ttsSpeak(ttsSentenceBuffer);
    }
    ttsSentenceBuffer = "";
  }

  function applyTTSAutoPlayState(enabled) {
    ttsAutoPlay = enabled;
    if (ttsAutoPlay) {
      ttsBtn.classList.add("voice-active");
      ttsBtn.title = "关闭自动朗读";
    } else {
      ttsBtn.classList.remove("voice-active");
      ttsBtn.title = "开启自动朗读";
      stopTTS();
    }
  }

  // 恢复保存的 TTS 状态
  chrome.storage.local.get("ttsAutoPlay", (res) => {
    if (res.ttsAutoPlay !== undefined) {
      applyTTSAutoPlayState(res.ttsAutoPlay);
    }
  });

  function toggleTTSAutoPlay() {
    ttsAutoPlay = !ttsAutoPlay;
    chrome.storage.local.set({ ttsAutoPlay });
    applyTTSAutoPlayState(ttsAutoPlay);
  }

  ttsBtn.addEventListener("click", toggleTTSAutoPlay);

  // ========== 技能选择器 ==========
  const SKILLS = [
    {
      id: "new-topic",
      icon: "💬",
      name: "开启新对话",
      desc: "清空当前对话，重新开始",
    },
    {
      id: "summarize-page",
      icon: "📝",
      name: "总结页面",
      desc: "自动获取当前页面内容并总结",
    },
    { id: "translate", icon: "🌐", name: "翻译", desc: "翻译文本内容" },
  ];

  let skillPickerVisible = false;
  let activeSkillIndex = 0;
  let filteredSkills = [...SKILLS];

  const skillPicker = document.getElementById("doudou-skill-picker");
  const skillList = document.getElementById("doudou-skill-list");
  const skillSearch = document.getElementById("doudou-skill-search");
  const textarea = document.getElementById("doudou-input");
  const translateBar = document.getElementById("doudou-translate-bar");
  const translateCloseBtn = document.getElementById("doudou-translate-close");

  // ========== 技能快捷图标栏 ==========
  const skillShortcutsContainer = document.getElementById(
    "doudou-skill-shortcuts",
  );

  function executeSkillById(skillId) {
    if (skillId === "new-topic") startNewTopic();
    else if (skillId === "summarize-page") summarizePage();
    else if (skillId === "translate") enterTranslateMode();
  }

  function renderSkillShortcuts() {
    skillShortcutsContainer.innerHTML = SKILLS.map(
      (s) =>
        `<button class="skill-shortcut-btn" data-skill-id="${s.id}" title="${s.name}">
          <span>${s.icon}</span>
          <span class="skill-shortcut-tooltip">${s.name}</span>
        </button>`,
    ).join("");
    skillShortcutsContainer
      .querySelectorAll(".skill-shortcut-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          executeSkillById(btn.dataset.skillId);
        });
      });
  }

  renderSkillShortcuts();

  // ========== 模型选择器 ==========
  const modelSelector = document.getElementById("doudou-model-selector");

  // 加载对话类型的配置列表
  async function loadDialogModels() {
    try {
      const { openaiConfigs, selectedDialogModelId } = await chrome.storage.sync.get([
        "openaiConfigs",
        "selectedDialogModelId",
      ]);

      if (!openaiConfigs || openaiConfigs.length === 0) {
        modelSelector.innerHTML = '<option value="">未配置模型</option>';
        return;
      }

      // 只显示对话或多态类型的配置
      const dialogConfigs = openaiConfigs.filter((c) => c.type === "dialog" || c.type === "poly");

      if (dialogConfigs.length === 0) {
        modelSelector.innerHTML = '<option value="">无对话模型</option>';
        return;
      }

      // 渲染选项
      modelSelector.innerHTML = dialogConfigs
        .map((config) => `<option value="${config.id}">${config.name || "未命名配置"}</option>`)
        .join("");

      // 恢复上次选择
      if (selectedDialogModelId && dialogConfigs.find((c) => c.id === selectedDialogModelId)) {
        modelSelector.value = selectedDialogModelId;
        selectedModelConfigId = selectedDialogModelId;
      } else {
        // 默认选中第一个
        selectedModelConfigId = dialogConfigs[0].id;
        modelSelector.value = selectedModelConfigId;
      }

      console.log(`[豆豆侧边栏] 加载了 ${dialogConfigs.length} 个对话模型，当前选中: ${selectedModelConfigId}`);
    } catch (error) {
      console.error("[豆豆侧边栏] 加载模型列表失败:", error);
      modelSelector.innerHTML = '<option value="">加载失败</option>';
    }
  }

  // 监听模型切换
  modelSelector.addEventListener("change", async () => {
    selectedModelConfigId = modelSelector.value;
    // 缓存用户选择
    await chrome.storage.sync.set({ selectedDialogModelId: selectedModelConfigId });
    console.log(`[豆豆侧边栏] 切换模型: ${selectedModelConfigId}`);
  });

  // 初始化加载
  loadDialogModels();

  function showSkillPicker(query) {
    const q = (query || "").toLowerCase();
    filteredSkills = SKILLS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
    );
    activeSkillIndex = 0;
    skillPicker.classList.add("visible");
    skillPickerVisible = true;
    skillSearch.value = query || "";
    renderSkillList();
  }

  function hideSkillPicker() {
    skillPicker.classList.remove("visible");
    skillPickerVisible = false;
  }

  function renderSkillList() {
    if (filteredSkills.length === 0) {
      skillList.innerHTML = '<div class="skill-picker-empty">无匹配技能</div>';
      return;
    }
    skillList.innerHTML = filteredSkills
      .map(
        (s, i) =>
          `<div class="skill-picker-item${i === activeSkillIndex ? " active" : ""}" data-index="${i}">
            <span class="skill-picker-icon">${s.icon}</span>
            <span class="skill-picker-info">
              <span class="skill-picker-name">${s.name}</span>
              <span class="skill-picker-desc">${s.desc}</span>
            </span>
          </div>`,
      )
      .join("");
    skillList.querySelectorAll(".skill-picker-item").forEach((item) => {
      item.addEventListener("mouseenter", () => {
        activeSkillIndex = Number(item.dataset.index);
        updateActiveSkill();
      });
      item.addEventListener("click", () => {
        activeSkillIndex = Number(item.dataset.index);
        executeActiveSkill();
      });
    });
  }

  function updateActiveSkill() {
    skillList.querySelectorAll(".skill-picker-item").forEach((item, i) => {
      item.classList.toggle("active", i === activeSkillIndex);
    });
  }

  function navigateSkillPicker(dir) {
    if (filteredSkills.length === 0) return;
    activeSkillIndex += dir;
    if (activeSkillIndex < 0) {
      activeSkillIndex = filteredSkills.length - 1;
    } else if (activeSkillIndex >= filteredSkills.length) {
      activeSkillIndex = 0;
    }
    updateActiveSkill();
  }

  function executeActiveSkill() {
    const skill = filteredSkills[activeSkillIndex];
    hideSkillPicker();
    textarea.value = "";
    textarea.style.height = "auto";
    if (!skill) return;
    if (skill.id === "new-topic") startNewTopic();
    else if (skill.id === "summarize-page") summarizePage();
    else if (skill.id === "translate") enterTranslateMode();
  }

  function handleSkillInput(value) {
    if (value.startsWith("/")) {
      const query = value.slice(1);
      showSkillPicker(query);
    } else if (skillPickerVisible) {
      hideSkillPicker();
    }
  }

  skillSearch.addEventListener("input", () => {
    const q = skillSearch.value.toLowerCase();
    filteredSkills = SKILLS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
    );
    activeSkillIndex = 0;
    renderSkillList();
  });

  // ========== 总结页面 ==========
  function summarizePage() {
    startNewTopic();
    chrome.runtime.sendMessage(
      { type: "SIDEPANEL_GET_PAGE_CONTENT" },
      (res) => {
        if (chrome.runtime.lastError) {
          showError("获取页面内容失败: " + chrome.runtime.lastError.message);
          return;
        }
        if (!res || !res.success) {
          showError("获取页面内容失败: " + (res?.error || "未知错误"));
          return;
        }
        const pageContent = res.data;
        textarea.value = `请用中文总结以下页面内容：\n\n${pageContent}`;
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
        sendMessage();
      },
    );
  }

  // ========== 翻译模式 ==========
  function enterTranslateMode() {
    translateMode = true;
    chatMessages = [];
    translateBar.classList.add("visible");
    textarea.placeholder = "输入要翻译的文本";
    textarea.focus();
  }

  function exitTranslateMode() {
    translateMode = false;
    chatMessages = [];
    translateBar.classList.remove("visible");
    textarea.placeholder = getDefaultPlaceholder();
  }

  translateCloseBtn.addEventListener("click", () => exitTranslateMode());

  // ========== 输入事件 ==========
  document.getElementById("doudou-send").addEventListener("click", () => {
    if (isGenerating) {
      stopGeneration();
    } else {
      sendMessage();
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.ctrlKey && skillPickerVisible) {
      e.preventDefault();
      executeActiveSkill();
      return;
    }
    if (e.key === "Enter") {
      const shouldSend = enterSendEnabled ? !e.ctrlKey : e.ctrlKey;
      if (shouldSend) {
        e.preventDefault();
        sendMessage();
        return;
      }
    }
    if (e.key === "Escape" && skillPickerVisible) {
      hideSkillPicker();
      return;
    }
    if (skillPickerVisible && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      navigateSkillPicker(e.key === "ArrowDown" ? 1 : -1);
    }
  });

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    handleSkillInput(textarea.value);
  });

  // 输入框聚焦边框
  const inputWrapper = document.getElementById("doudou-input-wrapper");
  textarea.addEventListener("focus", () =>
    inputWrapper.classList.add("focused"),
  );
  textarea.addEventListener("blur", () =>
    inputWrapper.classList.remove("focused"),
  );

  // ========== 附件管理 ==========
  const TEXT_EXTS = new Set(["txt", "csv", "md"]);
  const fileInput = document.getElementById("doudou-file-input");

  document
    .getElementById("doudou-attach-btn")
    .addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    Array.from(fileInput.files).forEach((file) => {
      const ext = file.name.split(".").pop().toLowerCase();
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isText = TEXT_EXTS.has(ext);
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) =>
          addAttachment({
            data: e.target.result,
            name: file.name,
            isImage: true,
          });
        reader.readAsDataURL(file);
      } else if (isVideo) {
        const reader = new FileReader();
        reader.onload = (e) =>
          addAttachment({
            data: e.target.result,
            name: file.name,
            isImage: false,
            isVideo: true,
            isText: false,
          });
        reader.readAsDataURL(file);
      } else if (isText) {
        const reader = new FileReader();
        reader.onload = (e) =>
          addAttachment({
            data: e.target.result,
            name: file.name,
            isImage: false,
            isText: true,
          });
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) =>
          addAttachment({
            data: e.target.result,
            name: file.name,
            isImage: false,
            isText: false,
          });
        reader.readAsDataURL(file);
      }
    });
    fileInput.value = "";
  });

  // 截图：通知 background 让 content script 执行截图
  document
    .getElementById("doudou-screenshot-btn")
    .addEventListener("click", () => {
      if (screenshotBusy) return;
      screenshotBusy = true;
      chrome.runtime.sendMessage(
        { type: "SIDEPANEL_CAPTURE_SCREENSHOT" },
        (res) => {
          if (chrome.runtime.lastError) {
            screenshotBusy = false;
            console.error("[豆豆] 截图失败:", chrome.runtime.lastError.message);
            return;
          }
          if (res && !res.success) {
            screenshotBusy = false;
            console.error("[豆豆] 截图失败:", res.error);
          }
        },
      );
    });

  // ========== 语音输入（通过 content script 实现） ==========
  const voiceBtn = document.getElementById("doudou-voice-btn");
  let voiceActive = false;
  let voiceBaseText = ""; // 开始语音时输入框已有的文本
  let voiceFinal = ""; // 语音已确认文本
  let voiceInterim = ""; // 语音临时文本

  function stopVoice() {
    if (voiceActive) {
      chrome.runtime.sendMessage({ type: "VOICE_STOP" });
    }
    voiceActive = false;
    voiceInterim = "";
    voiceBtn.classList.remove("voice-active");
    voiceBtn.title = "语音输入";
  }

  function startVoice() {
    voiceBaseText = textarea.value;
    voiceFinal = "";
    voiceInterim = "";
    voiceActive = true;
    voiceBtn.classList.add("voice-active");
    voiceBtn.title = "停止语音输入";
    chrome.runtime.sendMessage({ type: "VOICE_START" }, (res) => {
      if (chrome.runtime.lastError || (res && !res.success)) {
        const err =
          res?.error || chrome.runtime.lastError?.message || "未知错误";
        console.error("[豆豆] 语音启动失败:", err);
        alert(err);
        stopVoice();
      }
    });
  }

  voiceBtn.addEventListener("click", () => {
    if (voiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  });

  function addAttachment(att) {
    pendingAttachments.push(att);
    renderAttachmentPreview();
  }

  function removeAttachment(index) {
    pendingAttachments.splice(index, 1);
    renderAttachmentPreview();
  }

  function clearAttachments() {
    pendingAttachments = [];
    renderAttachmentPreview();
  }

  function getFileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    const icons = {
      pdf: "📄",
      doc: "📝",
      docx: "📝",
      xls: "📊",
      xlsx: "📊",
      ppt: "📑",
      pptx: "📑",
      txt: "📃",
      csv: "📃",
      md: "📃",
      epub: "📖",
      mobi: "📖",
      mp4: "🎥",
      webm: "🎥",
      mov: "🎥",
      avi: "🎥",
      mkv: "🎥",
    };
    return icons[ext] || "📎";
  }

  function renderAttachmentPreview() {
    const container = document.getElementById("doudou-attachment-preview");
    if (!container) return;
    container.innerHTML = pendingAttachments
      .map((att, i) => {
        if (att.isImage) {
          return `<div class="sidebar-attachment-item">
            <img src="${att.data}" />
            <button class="attachment-remove" data-index="${i}">&times;</button>
          </div>`;
        } else if (att.isVideo) {
          return `<div class="sidebar-attachment-item">
            <video src="${att.data}" />
            <button class="attachment-remove" data-index="${i}">&times;</button>
          </div>`;
        }
        return `<div class="sidebar-attachment-item sidebar-attachment-file">
          <span class="attachment-file-icon">${getFileIcon(att.name)}</span>
          <span class="attachment-file-name" title="${att.name}">${att.name.length > 8 ? att.name.slice(0, 6) + "…" : att.name}</span>
          <button class="attachment-remove" data-index="${i}">&times;</button>
        </div>`;
      })
      .join("");
    container.querySelectorAll(".attachment-remove").forEach((btn) => {
      btn.addEventListener("click", () =>
        removeAttachment(Number(btn.dataset.index)),
      );
    });
  }

  let autoScrollEnabled = true;
  const SCROLL_DOWN_THRESHOLD = 3; // 需要连续向下滚动次数才触发回到底部
  let scrollDownCount = 0;
  const doudouChatArea = document.getElementById("doudou-chat-area");
  if (doudouChatArea) {
    doudouChatArea.addEventListener("wheel", (e) => {
      if (e.deltaY < -10) {
        autoScrollEnabled = false;
        scrollDownCount = 0;
      } else if (e.deltaY > 20) {
        scrollDownCount++;
        if (scrollDownCount >= SCROLL_DOWN_THRESHOLD) {
          autoScrollEnabled = true;
        }
      }
    });

    let lastTouchY = 0;
    let touchDownCount = 0;
    doudouChatArea.addEventListener("touchstart", (e) => {
      lastTouchY = e.touches[0].clientY;
    });
    doudouChatArea.addEventListener("touchmove", (e) => {
      const y = e.touches[0].clientY;
      if (y - lastTouchY > 10) {
        autoScrollEnabled = false;
        touchDownCount = 0;
      } else if (lastTouchY - y > 20) {
        touchDownCount++;
        if (touchDownCount >= SCROLL_DOWN_THRESHOLD) {
          autoScrollEnabled = true;
        }
      }
      lastTouchY = y;
    });
  }

  // ========== 消息显示 ==========
  function scrollToBottom(chatArea, force = false) {
    if (!chatArea) return;
    if (force) {
      autoScrollEnabled = true;
      chatArea.scrollTop = chatArea.scrollHeight;
      return;
    }
    const isNearBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 100;
    if (isNearBottom || autoScrollEnabled) {
      chatArea.scrollTop = chatArea.scrollHeight;
      autoScrollEnabled = true;
    }
  }

  function startNewTopic() {
    chatMessages = [];
    const chatArea = document.getElementById("doudou-chat-area");
    if (chatArea) {
      chatArea.innerHTML = `
        <div class="chat-welcome">
          <img src="${ICON_URL}" />
          <div>你好，我是豆豆 AI 助手<br>有什么可以帮你的？</div>
        </div>
      `;
    }
    if (currentPort) {
      currentPort.disconnect();
      currentPort = null;
    }
    isGenerating = false;
    updateSendBtn();
  }

  function appendMessage(role, content, attachments) {
    const chatArea = document.getElementById("doudou-chat-area");
    if (!chatArea) return null;

    const welcome = chatArea.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    const msgEl = document.createElement("div");
    msgEl.className = `chat-msg ${role}`;

    const avatarHtml =
      role === "user"
        ? `<div class="chat-msg-avatar" style="background:#1890ff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;">我</div>`
        : `<img class="chat-msg-avatar" src="${ICON_URL}" />`;

    let bubbleContent;
    if (role === "user") {
      const attHtml = (attachments || [])
        .map((a) => {
          if (a.isImage) {
            return `<img src="${a.data}" style="max-width:120px;max-height:120px;border-radius:6px;display:block;margin-bottom:4px;" />`;
          } else if (a.isVideo) {
            return `<video src="${a.data}" style="max-width:120px;max-height:120px;border-radius:6px;display:block;margin-bottom:4px;" controls></video>`;
          }
          return `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f0f0f0;border-radius:4px;font-size:12px;color:#555;margin-bottom:4px;">${getFileIcon(a.name)} ${escapeHtml(a.name)}</div>`;
        })
        .join("");
      bubbleContent = attHtml + (content ? escapeHtml(content) : "");
    } else {
      bubbleContent = content || '<span class="typing-dot"></span>';
    }

    msgEl.innerHTML = `${avatarHtml}<div class="chat-msg-bubble">${bubbleContent}<button class="chat-copy-btn" title="复制">📋</button></div>`;
    const copyBtn = msgEl.querySelector(".chat-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const bubble = copyBtn.closest(".chat-msg-bubble");
        if (!bubble) return;
        const clone = bubble.cloneNode(true);
        const btn = clone.querySelector(".chat-copy-btn");
        if (btn) btn.remove();
        navigator.clipboard.writeText(clone.innerText.trim()).then(() => {
          copyBtn.textContent = "✓";
          setTimeout(() => {
            copyBtn.textContent = "📋";
          }, 1500);
        });
      });
    }
    chatArea.appendChild(msgEl);
    scrollToBottom(chatArea, role === "user");

    return msgEl;
  }

  function updateSendBtn() {
    const btn = document.getElementById("doudou-send");
    if (!btn) return;
    if (isGenerating) {
      btn.classList.add("stop");
      btn.title = "停止";
      btn.innerHTML = "■";
    } else {
      btn.classList.remove("stop");
      btn.title = enterSendEnabled ? "发送 (Enter)" : "发送 (Ctrl+Enter)";
      btn.innerHTML = "↑";
    }
  }

  function stopGeneration() {
    if (!isGenerating) return;
    if (currentPort) {
      currentPort.disconnect();
      currentPort = null;
    }
    isGenerating = false;
    updateSendBtn();
  }

  function showError(msg) {
    const chatArea = document.getElementById("doudou-chat-area");
    if (!chatArea) return;
    const el = document.createElement("div");
    el.className = "sidebar-error";
    el.style.textAlign = "center";
    el.textContent = msg;
    chatArea.appendChild(el);
    scrollToBottom(chatArea, true);
  }

  // ========== 发送消息 ==========
  function sendMessage() {
    if (isGenerating) return;
    const text = textarea.value.trim();
    const attachments = pendingAttachments.slice();
    if (!text && attachments.length === 0) return;

    textarea.value = "";
    textarea.style.height = "auto";

    let userContent = OpenAIClient.buildUserContent(text, attachments);
    clearAttachments();

    let messages;

    if (translateMode) {
      const fromSelect = document.getElementById("doudou-translate-from");
      const toSelect = document.getElementById("doudou-translate-to");
      const fromLang =
        fromSelect?.options[fromSelect.selectedIndex]?.text || "自动检测";
      const toLang =
        toSelect?.options[toSelect.selectedIndex]?.text || "中文（简体）";
      const fromHint =
        fromSelect?.value === "auto" ? "自动检测源语言" : `源语言为${fromLang}`;
      const systemPrompt = `你是一个专业翻译助手。请将用户输入的文本翻译为${toLang}。${fromHint}。只输出翻译结果，不要解释，不要添加任何额外内容。`;

      chatMessages.push({ role: "user", content: userContent });
      appendMessage("user", text, attachments);

      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];
    } else {
      chatMessages.push({ role: "user", content: userContent });
      appendMessage("user", text, attachments);
      messages = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    }

    const aiMsgEl = appendMessage("assistant", "");
    const bubble = aiMsgEl?.querySelector(".chat-msg-bubble");

    // 用单独的容器存放文本内容
    let contentEl = null;
    function getContentEl() {
      if (!contentEl && bubble) {
        contentEl = document.createElement("div");
        contentEl.className = "chat-msg-content";
        const mdContainer = document.createElement("div");
        mdContainer.className = "markdown-container";
        contentEl.appendChild(mdContainer);
        bubble.appendChild(contentEl);
      }
      return contentEl;
    }

    function ensureReasoningWrapper(el) {
      let reasoningWrapper = el.querySelector(".reasoning-wrapper");
      if (!reasoningWrapper) {
        reasoningWrapper = document.createElement("div");
        reasoningWrapper.className = "reasoning-wrapper";
        reasoningWrapper.style.cssText = "margin-bottom:8px;";

        const header = document.createElement("div");
        header.className = "reasoning-header";
        header.style.cssText =
          "color:#888;font-size:12px;cursor:pointer;user-select:none;padding:4px 0;";
        const reasoningHidden =
          localStorage.getItem("reasoning-toggle-hidden") === "true";
        header.innerHTML =
          "<span style='text-decoration:underline;'>thinking...</span> <span class='reasoning-toggle'>" +
          (reasoningHidden ? "▶" : "▼") +
          "</span>";

        const content = document.createElement("div");
        content.className = "reasoning-content";
        content.style.cssText =
          "color:#888;font-size:12px;font-style:italic;border-left:2px solid #ddd;padding-left:8px;margin-top:4px;";
        if (reasoningHidden) content.style.display = "none";

        header.onclick = () => {
          const isHidden = content.style.display === "none";
          content.style.display = isHidden ? "block" : "none";
          header.querySelector(".reasoning-toggle").textContent = isHidden
            ? "▼"
            : "▶";
          localStorage.setItem("reasoning-toggle-hidden", !isHidden);
        };

        reasoningWrapper.appendChild(header);
        reasoningWrapper.appendChild(content);

        const mdDiv = el.querySelector(".markdown-container");
        if (mdDiv) {
          el.insertBefore(reasoningWrapper, mdDiv);
        } else {
          el.appendChild(reasoningWrapper);
        }
      }
      return reasoningWrapper;
    }

    isGenerating = true;
    updateSendBtn();
    stopTTS(); // 新回答开始，停止旧的朗读

    let fullContent = "";
    let totalContent = "";

    const port = chrome.runtime.connect({ name: "doudou-chat" });
    currentPort = port;

    const configType = translateMode ? "translate" : "dialog";
    console.log(`[豆豆侧边栏] 发送${translateMode ? '翻译' : '对话'}请求，configType: ${configType}, selectedModelConfigId: ${selectedModelConfigId}`);

    port.postMessage({
      type: "DOUDOU_CHAT_STREAM",
      messages: messages,
      configType: configType,
      configId: translateMode ? undefined : selectedModelConfigId, // 传递选中的配置ID
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === "reasoning") {
        const el = getContentEl();
        if (el) {
          const wrapper = ensureReasoningWrapper(el);
          const content = wrapper.querySelector(".reasoning-content");
          content.textContent += msg.data;
        }
        const chatArea = document.getElementById("doudou-chat-area");
        scrollToBottom(chatArea);
      } else if (msg.type === "chunk") {
        fullContent += msg.data;
        totalContent += msg.data;
        
        let displayContent = fullContent;
        let extractedReasoning = "";

        if (displayContent.startsWith("<think>\\n") || displayContent.startsWith("<think>")) {
          const thinkEnd = displayContent.indexOf("</think>");
          if (thinkEnd !== -1) {
            extractedReasoning = displayContent.substring(displayContent.startsWith("<think>\\n") ? 8 : 7, thinkEnd);
            displayContent = displayContent.substring(thinkEnd + 8);
            displayContent = displayContent.replace(/^\\n+/, "");
          } else {
            extractedReasoning = displayContent.substring(displayContent.startsWith("<think>\\n") ? 8 : 7);
            displayContent = "";
          }
        }

        const el = getContentEl();
        if (el) {
          if (extractedReasoning) {
            const wrapper = ensureReasoningWrapper(el);
            const content = wrapper.querySelector(".reasoning-content");
            content.textContent = extractedReasoning;
          }
          
          const mdContainer = el.querySelector(".markdown-container");
          if (mdContainer) {
            mdContainer.innerHTML = mdToHtml(displayContent);
          } else {
            el.innerHTML = mdToHtml(displayContent);
          }
        }
        
        const chatArea = document.getElementById("doudou-chat-area");
        scrollToBottom(chatArea);
        
        // 当内容包含在 <think> 中且未结束时，不朗读 thinking 内部的内容
        let isThinkingNow = (fullContent.startsWith("<think>\\n") || fullContent.startsWith("<think>")) && fullContent.indexOf("</think>") === -1;
        if (!isThinkingNow) {
          ttsFeed(msg.data);
        }
      } else if (msg.type === "done") {
        chatMessages.push({ role: "assistant", content: totalContent });
        isGenerating = false;
        currentPort = null;
        updateSendBtn();
        // 隐藏 typing-dot
        const dot = bubble?.querySelector(".typing-dot");
        if (dot) dot.remove();
        ttsFlush();
        port.disconnect();
      } else if (msg.type === "error") {
        isGenerating = false;
        currentPort = null;
        updateSendBtn();
        if (bubble) {
          const el = getContentEl();
          if (el) el.innerHTML = "";
        }
        if (aiMsgEl && !fullContent) aiMsgEl.remove();
        showError(msg.data || "请求失败");
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      if (isGenerating) {
        if (totalContent) {
          chatMessages.push({ role: "assistant", content: totalContent });
        } else if (aiMsgEl) {
          aiMsgEl.remove();
        }
        isGenerating = false;
        currentPort = null;
        updateSendBtn();
      }
    });
  }

  // 自动聚焦输入框
  textarea.focus();
})();
