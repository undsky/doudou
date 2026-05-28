import { showToast } from "../utils/ui.js";

const STORAGE_KEY = "doudou_api_debugger_interfaces";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const FORBIDDEN_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

const state = {
  interfaces: [],
  activeId: null,
  requestTab: "headers",
  responseTab: "beautified",
  response: null,
  sending: false,
};

const dom = {};
let responseEditor = null;
let rawBodyEditor = null;
let abortController = null;
function normalizeMethod(method) {
  const upperMethod = String(method || "GET").toUpperCase();
  return ALLOWED_METHODS.has(upperMethod) ? upperMethod : "GET";
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultInterface(seed = {}) {
  return {
    id: createId(),
    name: "新接口",
    method: "GET",
    url: "",
    protocol: "auto",
    headers: [{ enabled: true, key: "", value: "" }],
    query: [{ enabled: true, key: "", value: "" }],
    bodyType: "none",
    rawFormat: "json",
    rawBody: "",
    formData: [{ enabled: true, key: "", value: "" }],
    ...seed,
  };
}

function cacheDom() {
  dom.addInterfaceButton = document.getElementById("add-interface-button");
  dom.importJsonButton = document.getElementById("import-json-button");
  dom.exportJsonButton = document.getElementById("export-json-button");
  dom.importJsonFile = document.getElementById("import-json-file");
  dom.curlInput = document.getElementById("curl-input");
  dom.importCurlButton = document.getElementById("import-curl-button");
  dom.interfaceList = document.getElementById("interface-list");
  dom.requestMethod = document.getElementById("request-method");
  dom.requestUrl = document.getElementById("request-url");
  dom.requestProtocol = document.getElementById("request-protocol");
  dom.sendButton = document.getElementById("send-button");
  dom.requestTabs = document.getElementById("request-tabs");
  dom.addHeaderButton = document.getElementById("add-header-button");
  dom.addQueryButton = document.getElementById("add-query-button");
  dom.addFormDataButton = document.getElementById("add-form-data-button");
  dom.headersTable = document.getElementById("headers-table");
  dom.queryTable = document.getElementById("query-table");
  dom.formDataTable = document.getElementById("form-data-table");
  dom.bodyFormData = document.getElementById("body-form-data");
  dom.bodyRaw = document.getElementById("body-raw");
  dom.rawFormat = document.getElementById("raw-format");
  dom.rawBodyJsoneditor = document.getElementById("raw-body-jsoneditor");
  dom.rawBody = document.getElementById("raw-body");
  dom.responseTabs = document.getElementById("response-tabs");
  dom.responseSummary = document.getElementById("response-summary");
  dom.copyResponseButton = document.getElementById("copy-response-button");
  dom.clearResponseButton = document.getElementById("clear-response-button");
  dom.responseJsoneditor = document.getElementById("response-jsoneditor");
  dom.responseTextPreview = document.getElementById("response-text-preview");
  dom.responseHeaders = document.getElementById("response-headers");
  dom.actualRequest = document.getElementById("actual-request");
}

function initResponseEditor() {
  responseEditor = new JSONEditor(dom.responseJsoneditor, {
    mode: "view",
    modes: ["tree", "code", "text", "view", "preview"],
    search: true,
    history: false,
    navigationBar: true,
    statusBar: true,
    mainMenuBar: true,
    language: "zh-CN",
    onError(error) {
      showToast(error.toString(), "error");
    },
  });
}

function initRawBodyEditor() {
  rawBodyEditor = new JSONEditor(dom.rawBodyJsoneditor, {
    mode: "code",
    modes: ["code"],
    search: true,
    history: true,
    navigationBar: false,
    statusBar: true,
    mainMenuBar: false,
    language: "zh-CN",
    onChangeText(text) {
      updateActiveInterface({ rawBody: text });
    },
    onError(error) {
      showToast(error.toString(), "error");
    },
  });
}

function loadInterfaces() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.interfaces)) {
      state.interfaces = saved.interfaces.map(normalizeInterface);
      state.activeId = saved.activeId;
    }
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!state.interfaces.length) {
    const api = createDefaultInterface();
    state.interfaces = [api];
    state.activeId = api.id;
    saveInterfaces();
  }

  if (!getActiveInterface()) {
    state.activeId = state.interfaces[0]?.id || null;
  }
}

function normalizeInterface(api) {
  const normalized = createDefaultInterface({
    ...api,
    id: typeof api.id === "string" && api.id ? api.id : createId(),
    method: normalizeMethod(api.method),
    protocol: ["auto", "http/1.1", "http/2"].includes(api.protocol) ? api.protocol : "auto",
    bodyType: ["none", "form-data", "raw"].includes(api.bodyType) ? api.bodyType : "none",
    rawFormat: ["json", "text"].includes(api.rawFormat) ? api.rawFormat : "json",
    headers: normalizeRows(api.headers),
    query: normalizeRows(api.query),
    formData: normalizeRows(api.formData),
  });
  normalized.name = typeof normalized.name === "string" ? normalized.name : "新接口";
  normalized.url = typeof normalized.url === "string" ? normalized.url : "";
  normalized.rawBody = typeof normalized.rawBody === "string" ? normalized.rawBody : "";
  return normalized;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ enabled: true, key: "", value: "" }];
  }
  return rows.map((row) => ({
    enabled: row.enabled !== false,
    key: row.key || "",
    value: row.value || "",
  }));
}

function saveInterfaces() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ interfaces: state.interfaces, activeId: state.activeId }),
  );
}

function getActiveInterface() {
  return state.interfaces.find((api) => api.id === state.activeId) || null;
}

function addInterface(seed = {}) {
  const api = createDefaultInterface(seed);
  state.interfaces.unshift(api);
  state.activeId = api.id;
  state.response = null;
  saveInterfaces();
  renderAll();
}

function deleteInterface(id) {
  state.interfaces = state.interfaces.filter((api) => api.id !== id);
  if (!state.interfaces.length) {
    const api = createDefaultInterface();
    state.interfaces = [api];
    state.activeId = api.id;
    state.response = null;
  } else if (state.activeId === id) {
    state.activeId = state.interfaces[0]?.id || null;
    state.response = null;
  }
  saveInterfaces();
  renderAll();
}

function updateActiveInterface(patch) {
  const api = getActiveInterface();
  if (!api) return;
  Object.assign(api, patch);
  saveInterfaces();
  renderInterfaceList();
}

function renderAll() {
  renderInterfaceList();
  renderRequestEditor();
  renderResponse();
}

function renderInterfaceList() {
  dom.interfaceList.textContent = "";

  if (!state.interfaces.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无接口";
    dom.interfaceList.appendChild(empty);
    return;
  }

  for (const api of state.interfaces) {
    const item = document.createElement("div");
    item.className = `interface-item${api.id === state.activeId ? " active" : ""}`;
    item.dataset.id = api.id;
    item.tabIndex = 0;

    const method = document.createElement("span");
    method.className = "method-badge";
    method.textContent = api.method || "GET";

    const text = document.createElement("span");
    const title = document.createElement("input");
    title.className = "interface-title-input";
    title.type = "text";
    title.value = api.name || "";
    title.placeholder = deriveInterfaceName(api);
    title.setAttribute("aria-label", "接口名称");
    title.addEventListener("click", (event) => event.stopPropagation());
    title.addEventListener("focus", () => selectInterfaceFromList(api.id));
    title.addEventListener("keydown", (event) => event.stopPropagation());
    title.addEventListener("input", () => {
      api.name = title.value;
      saveInterfaces();
    });
    const url = document.createElement("span");
    url.className = "interface-url";
    url.textContent = api.url || "未设置 URL";
    text.append(title, url);

    const del = document.createElement("button");
    del.className = "delete-interface";
    del.type = "button";
    del.textContent = "×";
    del.title = "删除接口";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteInterface(api.id);
    });

    item.addEventListener("click", () => selectInterface(api.id));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectInterface(api.id);
    });

    item.append(method, text, del);
    dom.interfaceList.appendChild(item);
  }
}

function selectInterface(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  state.response = null;
  saveInterfaces();
  renderAll();
}

function selectInterfaceFromList(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  state.response = null;
  saveInterfaces();
  renderRequestEditor();
  renderResponse();
  for (const item of dom.interfaceList.querySelectorAll(".interface-item")) {
    item.classList.toggle("active", item.dataset.id === id);
  }
}

function deriveInterfaceName(api) {
  try {
    const url = new URL(api.url);
    return url.pathname === "/" ? url.host : `${url.host}${url.pathname}`;
  } catch (error) {
    return "新接口";
  }
}

function renderRequestEditor() {
  const api = getActiveInterface();
  if (!api) return;

  dom.requestMethod.value = api.method;
  dom.requestUrl.value = api.url;
  dom.requestProtocol.value = api.protocol;
  dom.rawFormat.value = api.rawFormat;
  dom.rawBody.value = api.rawBody;
  if (rawBodyEditor) rawBodyEditor.setText(api.rawBody || "");

  for (const radio of document.querySelectorAll('input[name="body-type"]')) {
    radio.checked = radio.value === api.bodyType;
  }

  renderRequestTabs();
  renderBodyMode();
  renderKvTable(dom.headersTable, api.headers, () => saveInterfaces());
  renderKvTable(dom.queryTable, api.query, () => saveInterfaces());
  renderKvTable(dom.formDataTable, api.formData, () => saveInterfaces());
}

function renderRequestTabs() {
  for (const tab of dom.requestTabs.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === state.requestTab);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === `request-tab-${state.requestTab}`);
  }
}

function renderBodyMode() {
  const api = getActiveInterface();
  if (!api) return;
  dom.bodyFormData.classList.toggle("active", api.bodyType === "form-data");
  dom.bodyRaw.classList.toggle("active", api.bodyType === "raw");
  dom.rawBodyJsoneditor.classList.toggle("hidden", api.rawFormat !== "json");
  dom.rawBody.hidden = api.rawFormat === "json";
}

function renderKvTable(container, rows, onChange) {
  container.textContent = "";

  rows.forEach((row, index) => {
    const line = document.createElement("div");
    line.className = "kv-row";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = row.enabled;
    enabled.addEventListener("change", () => {
      row.enabled = enabled.checked;
      onChange();
    });

    const key = document.createElement("input");
    key.type = "text";
    key.placeholder = "参数名";
    key.value = row.key;
    key.addEventListener("input", () => {
      row.key = key.value;
      onChange();
    });

    const value = document.createElement("input");
    value.type = "text";
    value.placeholder = "参数值";
    value.value = row.value;
    value.addEventListener("input", () => {
      row.value = value.value;
      onChange();
    });

    const del = document.createElement("button");
    del.className = "kv-delete";
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      rows.splice(index, 1);
      if (!rows.length) rows.push({ enabled: true, key: "", value: "" });
      onChange();
      renderRequestEditor();
    });

    line.append(enabled, key, value, del);
    container.appendChild(line);
  });
}

function bindEvents() {
  dom.addInterfaceButton.addEventListener("click", () => addInterface());
  dom.importJsonButton.addEventListener("click", () => dom.importJsonFile.click());
  dom.exportJsonButton.addEventListener("click", exportInterfacesJson);
  dom.importJsonFile.addEventListener("change", importInterfacesJson);
  dom.importCurlButton.addEventListener("click", importCurl);
  dom.requestMethod.addEventListener("change", () => updateActiveInterface({ method: dom.requestMethod.value }));
  dom.requestUrl.addEventListener("input", () => updateActiveInterface({ url: dom.requestUrl.value }));
  dom.requestUrl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    sendRequest();
  });
  dom.requestProtocol.addEventListener("change", () => updateActiveInterface({ protocol: dom.requestProtocol.value }));
  dom.rawFormat.addEventListener("change", () => {
    updateActiveInterface({ rawFormat: dom.rawFormat.value });
    renderBodyMode();
  });
  dom.rawBody.addEventListener("input", () => updateActiveInterface({ rawBody: dom.rawBody.value }));
  dom.sendButton.addEventListener("click", sendRequest);
  dom.copyResponseButton.addEventListener("click", copyActiveResponse);
  dom.clearResponseButton.addEventListener("click", () => {
    state.response = null;
    renderResponse();
  });

  dom.requestTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    state.requestTab = button.dataset.tab;
    renderRequestTabs();
  });

  dom.responseTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    state.responseTab = button.dataset.tab;
    renderResponseTabs();
  });

  dom.addHeaderButton.addEventListener("click", () => addRow("headers"));
  dom.addQueryButton.addEventListener("click", () => addRow("query"));
  dom.addFormDataButton.addEventListener("click", () => addRow("formData"));

  for (const radio of document.querySelectorAll('input[name="body-type"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      updateActiveInterface({ bodyType: radio.value });
      renderBodyMode();
    });
  }
}

function addRow(key) {
  const api = getActiveInterface();
  if (!api) return;
  api[key].push({ enabled: true, key: "", value: "" });
  saveInterfaces();
  renderRequestEditor();
}

async function copyActiveResponse() {
  const response = state.response;
  if (!response) {
    showToast("暂无可复制内容", "error");
    return;
  }

  const content = getCopyResponseContent(response);
  if (!content) {
    showToast("暂无可复制内容", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    showToast("已复制", "success");
  } catch (error) {
    showToast("复制失败", "error");
  }
}

function getCopyResponseContent(response) {
  if (state.responseTab === "headers") return response.headersText || "";
  if (state.responseTab === "request") return response.actualRequest || "";
  return response.rawText || "";
}

function normalizeImportData(data, usedIds = new Set()) {
  const list = Array.isArray(data) ? data : data?.interfaces;
  if (!Array.isArray(list) || !list.length) {
    throw new Error("JSON 中没有可导入的接口列表");
  }

  const interfaces = list.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("接口数据格式不正确");
    }

    const api = normalizeInterface(item);
    while (usedIds.has(api.id)) api.id = createId();
    usedIds.add(api.id);
    return api;
  });
  const activeId = interfaces.some((api) => api.id === data?.activeId) ? data.activeId : interfaces[0].id;
  return { interfaces, activeId };
}

async function importInterfacesJson() {
  const file = dom.importJsonFile.files?.[0];
  dom.importJsonFile.value = "";
  if (!file) return;

  try {
    const data = normalizeImportData(
      JSON.parse(await file.text()),
      new Set(state.interfaces.map((api) => api.id)),
    );
    state.interfaces = [...state.interfaces, ...data.interfaces];
    state.activeId = data.activeId;
    state.response = null;
    saveInterfaces();
    renderAll();
    showToast("接口已导入", "success");
  } catch (error) {
    showToast(error.message || "JSON 导入失败", "error");
  }
}

function exportInterfacesJson() {
  const payload = {
    interfaces: state.interfaces.map(normalizeInterface),
    activeId: state.activeId,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `doudou-api-debugger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("接口已导出", "success");
}

function importCurl() {
  const input = dom.curlInput.value.trim();
  if (!input) {
    showToast("请先粘贴 cURL 命令", "error");
    return;
  }

  try {
    const parsed = parseCurl(input);
    addInterface(parsed);
    dom.curlInput.value = "";
    showToast("cURL 已导入", "success");
  } catch (error) {
    showToast(error.message || "cURL 解析失败", "error");
  }
}

function tokenizeCurl(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error("cURL 引号未闭合");
  if (current) tokens.push(current);
  return tokens;
}

function parseCurl(command) {
  const tokens = tokenizeCurl(command.replace(/\\\r?\n/g, " "));
  if (tokens[0] === "curl") tokens.shift();
  if (!tokens.length) throw new Error("未识别到 cURL 内容");

  const api = createDefaultInterface({ name: "导入接口", headers: [], query: [], formData: [] });
  let methodExplicit = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = () => tokens[++index] || "";

    if (token === "-X" || token === "--request") {
      api.method = normalizeMethod(next());
      methodExplicit = true;
    } else if (token.startsWith("-X") && token.length > 2) {
      api.method = normalizeMethod(token.slice(2));
      methodExplicit = true;
    } else if (token === "-H" || token === "--header") {
      appendHeader(api, next());
    } else if (token.startsWith("-H") && token.length > 2) {
      appendHeader(api, token.slice(2));
    } else if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(token)) {
      applyCurlData(api, next(), methodExplicit);
    } else if (token.startsWith("--data=") || token.startsWith("--data-raw=")) {
      applyCurlData(api, token.slice(token.indexOf("=") + 1), methodExplicit);
    } else if (token === "--url") {
      api.url = next();
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      api.url = token;
    }
  }

  if (!api.url) throw new Error("未识别到请求 URL");
  if (!api.headers.length) api.headers.push({ enabled: true, key: "", value: "" });
  if (!api.query.length) api.query.push({ enabled: true, key: "", value: "" });
  if (!api.formData.length) api.formData.push({ enabled: true, key: "", value: "" });
  api.name = deriveInterfaceName(api);
  return api;
}

function appendHeader(api, headerText) {
  const colonIndex = headerText.indexOf(":");
  if (colonIndex <= 0) return;
  api.headers.push({
    enabled: true,
    key: headerText.slice(0, colonIndex).trim(),
    value: headerText.slice(colonIndex + 1).trim(),
  });
}

function applyCurlData(api, data, methodExplicit) {
  if (!methodExplicit) api.method = "POST";
  api.bodyType = "raw";
  api.rawBody = data;
  api.rawFormat = canParseJson(data) ? "json" : "text";
}

function sanitizeText(text) {
  if (typeof text !== "string") return text;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/[​‌‍⁠﻿]/g, "").replace(/ /g, " ");
}

function canParseJson(text) {
  try {
    JSON.parse(sanitizeText(text));
    return true;
  } catch (error) {
    return false;
  }
}

function buildFinalUrl(api) {
  let url;
  try {
    url = new URL(api.url);
  } catch (error) {
    throw new Error("请输入有效的请求链接");
  }

  for (const row of api.query) {
    if (row.enabled && row.key.trim()) {
      url.searchParams.append(row.key.trim(), row.value);
    }
  }
  return url.toString();
}

function collectHeaders(api) {
  const headers = new Headers();
  const skipped = [];

  for (const row of api.headers) {
    const key = row.key.trim();
    if (!row.enabled || !key) continue;
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      skipped.push(key);
      continue;
    }
    headers.set(key, row.value);
  }

  if (api.bodyType === "raw" && api.method !== "GET" && !headers.has("Content-Type")) {
    if (api.rawFormat === "json") headers.set("Content-Type", "application/json;charset=utf-8");
    else headers.set("Content-Type", "text/plain;charset=utf-8");
  }

  return { headers, skipped };
}

function buildRequestBody(api, headers) {
  if (api.method === "GET" || api.bodyType === "none") {
    return undefined;
  }

  if (api.bodyType === "form-data") {
    headers.delete("Content-Type");
    const formData = new FormData();
    for (const row of api.formData) {
      if (row.enabled && row.key.trim()) formData.append(row.key.trim(), row.value);
    }
    return formData;
  }

  if (api.bodyType === "raw") {
    const text = api.rawFormat === "json" ? sanitizeText(api.rawBody) : api.rawBody;
    if (api.rawFormat === "json" && text.trim()) JSON.parse(text);
    return text;
  }

  return undefined;
}

async function sendRequest() {
  if (state.sending) {
    abortController?.abort();
    return;
  }

  const api = getActiveInterface();
  if (!api) return;

  let actualRequest = "";
  try {
    const finalUrl = buildFinalUrl(api);
    const { headers, skipped } = collectHeaders(api);
    const body = buildRequestBody(api, headers);
    actualRequest = buildActualRequestPreview(api, finalUrl, headers, body, skipped);

    setSending(true);
    setStreamingResponse({ actualRequest });

    const startedAt = performance.now();
    abortController = new AbortController();
    const options = {
      method: api.method,
      headers,
      signal: abortController.signal,
    };
    if (body !== undefined && api.method !== "GET") options.body = body;

    const response = await fetch(finalUrl, options);
    const headersText = formatHeaders(response.headers);
    const rawText = await readResponseBody(response);

    renderCompletedResponse({
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url,
      elapsedMs: Math.round(performance.now() - startedAt),
      headersText,
      rawText,
      actualRequest,
      contentType: response.headers.get("content-type") || "",
    });
  } catch (error) {
    if (error.name === "AbortError") {
      showToast("请求已取消", "error");
    } else {
      renderRequestError(error, actualRequest);
    }
  } finally {
    setSending(false);
    abortController = null;
  }
}

function setSending(sending) {
  state.sending = sending;
  dom.sendButton.textContent = sending ? "取消" : "发送";
}

function setStreamingResponse({ actualRequest }) {
  state.response = {
    status: null,
    statusText: "",
    ok: false,
    elapsedMs: null,
    headersText: "",
    rawText: "",
    actualRequest,
    contentType: "",
    parsedJson: null,
    isJson: false,
    error: null,
  };
  renderResponse();
}

async function readResponseBody(response) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let rawText = "";

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    rawText = decoder.decode(buffer);
    updateStreamingRaw(rawText);
    return rawText;
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawText += decoder.decode(value, { stream: true });
    updateStreamingRaw(rawText);
  }
  rawText += decoder.decode();
  updateStreamingRaw(rawText);
  return rawText;
}

function updateStreamingRaw(rawText) {
  if (!state.response) return;
  state.response.rawText = rawText;
  if (!state.response.isJson) dom.responseTextPreview.textContent = rawText;
}

function renderCompletedResponse(result) {
  const parsed = parseJsonResponse(result.rawText, result.contentType);
  state.response = {
    ...result,
    parsedJson: parsed.value,
    isJson: parsed.ok,
    error: null,
  };
  state.responseTab = "beautified";
  renderResponse();
}

function parseJsonResponse(rawText, contentType) {
  const text = sanitizeText(rawText);
  if (!text.trim()) return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (contentType.includes("json")) return { ok: false, value: null };
    return { ok: false, value: null };
  }
}

function renderRequestError(error, actualRequest) {
  state.response = {
    status: null,
    statusText: "",
    ok: false,
    elapsedMs: null,
    headersText: "",
    rawText: error.message || String(error),
    actualRequest,
    contentType: "text/plain",
    parsedJson: null,
    isJson: false,
    error: error.message || String(error),
  };
  state.responseTab = "beautified";
  renderResponse();
}

function renderResponse() {
  const response = state.response;

  if (!response) {
    dom.responseSummary.className = "response-summary";
    dom.responseSummary.textContent = "尚未发送请求";
    dom.responseHeaders.textContent = "";
    dom.actualRequest.textContent = "";
    dom.responseTextPreview.hidden = false;
    dom.responseTextPreview.textContent = "等待响应...";
    dom.responseJsoneditor.classList.add("hidden");
    responseEditor.set({ message: "等待响应" });
    responseEditor.expandAll();
    renderResponseTabs();
    return;
  }

  const summary = formatSummary(response);
  dom.responseSummary.className = `response-summary ${response.error ? "error" : response.ok ? "success" : "error"}`;
  dom.responseSummary.textContent = summary;
  dom.responseHeaders.textContent = response.headersText || "";
  dom.actualRequest.textContent = response.actualRequest || "";

  if (response.isJson) {
    dom.responseJsoneditor.classList.remove("hidden");
    dom.responseTextPreview.hidden = true;
    responseEditor.set(response.parsedJson);
    responseEditor.expandAll();
  } else {
    dom.responseJsoneditor.classList.add("hidden");
    dom.responseTextPreview.hidden = false;
    dom.responseTextPreview.textContent = response.rawText || "";
  }

  renderResponseTabs();
}

function formatSummary(response) {
  if (response.error) return `请求失败：${response.error}`;
  if (response.status === null) return "请求中...";
  const elapsed = response.elapsedMs === null ? "" : ` · ${response.elapsedMs}ms`;
  return `${response.status} ${response.statusText}${elapsed}`;
}

function renderResponseTabs() {
  for (const tab of dom.responseTabs.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === state.responseTab);
  }
  for (const view of document.querySelectorAll(".response-view")) {
    view.classList.remove("active");
  }

  const map = {
    beautified: document.getElementById("response-beautified"),
    headers: dom.responseHeaders,
    request: dom.actualRequest,
  };
  map[state.responseTab]?.classList.add("active");
}

function formatHeaders(headers) {
  const lines = [];
  headers.forEach((value, key) => lines.push(`${key}: ${value}`));
  return lines.join("\n");
}

function buildActualRequestPreview(api, finalUrl, headers, body, skipped) {
  const lines = [`${api.method} ${finalUrl}`, `HTTP 协议: ${api.protocol}`];

  if (skipped.length) {
    lines.push("", "跳过的受限请求头:", ...skipped.map((key) => `- ${key}`));
  }

  lines.push("", "请求头:");
  let hasHeader = false;
  headers.forEach((value, key) => {
    hasHeader = true;
    lines.push(`${key}: ${value}`);
  });
  if (!hasHeader) lines.push("(无)");

  lines.push("", "请求体:");
  if (body === undefined) {
    lines.push("(无)");
  } else if (body instanceof FormData) {
    for (const [key, value] of body.entries()) lines.push(`${key}=${value}`);
  } else {
    lines.push(String(body));
  }

  return lines.join("\n");
}

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  initResponseEditor();
  initRawBodyEditor();
  loadInterfaces();
  bindEvents();
  renderAll();
});
