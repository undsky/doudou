const form = document.getElementById("converter-form");
const fileInput = document.getElementById("converter-file-input");
const clearButton = document.getElementById("clear-button");
const convertButton = document.getElementById("convert-button");
const downloadButton = document.getElementById("download-button");
const downloadSplitButton = document.getElementById("download-split-button");
const selectedRoot = document.getElementById("converter-selected");
const selectedCount = document.getElementById("selected-count");
const selectedList = document.getElementById("converter-selected-list");
const statusPanel = document.getElementById("status-panel");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const statusMeta = document.getElementById("status-meta");
const statusInputFormat = document.getElementById("status-input-format");
const statusDirection = document.getElementById("status-direction");
const statusOutputName = document.getElementById("status-output-name");
const statusCounts = document.getElementById("status-counts");
const statusMode = document.getElementById("status-mode");
const badgeRoot = document.getElementById("converter-badges");
const warningBox = document.getElementById("converter-warning-box");
const warningList = document.getElementById("converter-warning-list");
const outputPreview = document.getElementById("output-preview");

const requiredElements = [
  form,
  fileInput,
  clearButton,
  convertButton,
  downloadButton,
  downloadSplitButton,
  selectedRoot,
  selectedCount,
  selectedList,
  statusPanel,
  statusTitle,
  statusMessage,
  statusMeta,
  statusInputFormat,
  statusDirection,
  statusOutputName,
  statusCounts,
  statusMode,
  badgeRoot,
  warningBox,
  warningList,
  outputPreview,
];

if (requiredElements.every(Boolean)) {
  initConverter();
}

function initConverter() {
  const knownCpaKeys = new Set([
    "access_token",
    "account_id",
    "disabled",
    "email",
    "expired",
    "id_token",
    "last_refresh",
    "refresh_token",
    "type",
  ]);
  const knownSubAccountKeys = new Set([
    "name",
    "notes",
    "platform",
    "type",
    "credentials",
    "extra",
    "proxy_key",
    "concurrency",
    "priority",
    "rate_multiplier",
    "expires_at",
    "auto_pause_on_expired",
    "group",
  ]);
  const knownSubCredentialKeys = new Set([
    "access_token",
    "refresh_token",
    "id_token",
    "email",
    "chatgpt_account_id",
    "chatgpt_user_id",
    "client_id",
    "organization_id",
    "plan_type",
    "expires_at",
  ]);
  const knownWrappedCpaKeys = new Set([
    "auth_mode",
    "OPENAI_API_KEY",
    "tokens",
    "last_refresh",
    "expired",
    "email",
    "type",
    "disabled",
  ]);

  let currentResult = null;

  const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  const deepClone = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  };

  const asString = (value) => (typeof value === "string" ? value.trim() : "");

  const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

  const pickUnknownKeys = (object, knownKeys) => {
    if (!isPlainObject(object)) return {};
    return Object.fromEntries(
      Object.entries(object).filter(([key]) => !knownKeys.has(key)),
    );
  };

  const applyUnknownFields = (target, extraFields) => {
    if (!isPlainObject(target) || !isPlainObject(extraFields)) return;
    Object.entries(extraFields).forEach(([key, value]) => {
      if (!hasOwn(target, key)) {
        target[key] = value;
      }
    });
  };

  const formatJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  const buildTimestampTag = () => {
    const now = new Date();
    return [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
      String(now.getUTCHours()).padStart(2, "0"),
      String(now.getUTCMinutes()).padStart(2, "0"),
      String(now.getUTCSeconds()).padStart(2, "0"),
    ].join("");
  };

  const nowIso = () => new Date().toISOString().replace(".000Z", "Z");

  const normalizeIsoString = (value) => {
    const raw = asString(value);
    if (!raw) return "";
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return "";
    return new Date(ms).toISOString().replace(".000Z", "Z");
  };

  const isoToEpochSeconds = (value) => {
    const ms = Date.parse(String(value));
    if (!Number.isFinite(ms)) {
      throw new Error(`无效的 ISO 时间：${value}`);
    }
    return Math.floor(ms / 1000);
  };

  const epochishToIso = (value) => {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string" && value.trim() && Number.isNaN(Number(value))) {
      const normalized = normalizeIsoString(value);
      if (!normalized) {
        throw new Error(`无效的时间值：${value}`);
      }
      return normalized;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`无效的时间值：${value}`);
    }
    const normalized = numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    return new Date(normalized * 1000).toISOString().replace(".000Z", "Z");
  };

  const decodeJwtClaims = (token) => {
    const raw = asString(token);
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;

    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) {
      payload += "=";
    }

    try {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoded = new TextDecoder().decode(bytes);
      const claims = JSON.parse(decoded);
      return isPlainObject(claims) ? claims : null;
    } catch {
      return null;
    }
  };

  const extractOpenAIInfo = (idToken) => {
    const claims = decodeJwtClaims(idToken);
    const auth = isPlainObject(claims?.["https://api.openai.com/auth"])
      ? claims["https://api.openai.com/auth"]
      : {};
    const organizations = Array.isArray(auth.organizations)
      ? auth.organizations.filter((item) => isPlainObject(item))
      : [];
    const preferred = organizations.find(
      (item) => item.is_default === true && asString(item.id),
    );
    const organizationId = preferred
      ? asString(preferred.id)
      : asString(organizations[0]?.id);

    const userId = asString(auth.user_id);

    return {
      email: asString(claims?.email),
      chatgptAccountId: asString(auth.chatgpt_account_id) || userId,
      chatgptUserId: asString(auth.chatgpt_user_id) || userId,
      planType: asString(auth.chatgpt_plan_type),
      organizationId,
    };
  };

  const safeNameSegment = (value, fallback) => {
    const normalized = String(value || fallback || "account")
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || String(fallback || "account");
  };

  const buildCodexFilename = (record, index) => {
    const base = safeNameSegment(
      record.email || record.account_id,
      `account-${index + 1}`,
    );
    return `codex-${base}.json`;
  };

  const getModeValue = () => {
    const checked = form.querySelector('input[name="conversion_mode"]:checked');
    return checked?.value === "lossless" ? "lossless" : "compat";
  };

  const getModeLabel = (mode) =>
    mode === "lossless" ? "保真模式" : "兼容模式";

  const isCpaLike = (value) =>
    isPlainObject(value) &&
    typeof value.access_token === "string" &&
    typeof value.refresh_token === "string" &&
    (typeof value.id_token === "string" || typeof value.account_id === "string");

  const isWrappedCpaLike = (value) =>
    isPlainObject(value) && isPlainObject(value.tokens) && isCpaLike(value.tokens);

  const detectFormat = (payload) => {
    if (Array.isArray(payload)) {
      if (
        payload.length > 0 &&
        payload.every((item) => isCpaLike(item) || isWrappedCpaLike(item))
      ) {
        return "cpa-list";
      }
      return "unknown";
    }
    if (isPlainObject(payload) && Array.isArray(payload.accounts)) {
      return "sub";
    }
    if (isCpaLike(payload) || isWrappedCpaLike(payload)) {
      return "cpa";
    }
    return "unknown";
  };

  const setPreviewText = (text) => {
    outputPreview.textContent = text || "";
  };

  const renderSelectedFiles = () => {
    const files = Array.from(fileInput.files || []);
    selectedRoot.hidden = files.length === 0;
    selectedCount.textContent = files.length ? `${files.length} 个` : "";
    selectedList.replaceChildren(
      ...files.map((file) => {
        const item = document.createElement("article");
        item.className = "selected-file-item";

        const name = document.createElement("span");
        name.className = "selected-file-name";
        name.title = file.name;
        name.textContent = file.name;

        const meta = document.createElement("span");
        meta.className = "selected-file-meta";
        meta.textContent = formatSize(file.size);

        item.append(name, meta);
        return item;
      }),
    );
  };

  const renderBadges = (badges) => {
    badgeRoot.hidden = badges.length === 0;
    badgeRoot.replaceChildren(
      ...badges.map((badge) => {
        const pill = document.createElement("span");
        pill.className = "converter-pill";

        const label = document.createElement("span");
        label.textContent = badge.label;

        const value = document.createElement("strong");
        value.textContent = badge.value;

        pill.append(label, value);
        return pill;
      }),
    );
  };

  const renderWarnings = (warnings) => {
    warningBox.hidden = warnings.length === 0;
    warningList.replaceChildren(
      ...warnings.map((warning) => {
        const item = document.createElement("li");
        item.textContent = warning;
        return item;
      }),
    );
  };

  const setBusy = (busy) => {
    convertButton.disabled = busy;
    clearButton.disabled = busy;
    fileInput.disabled = busy;
    convertButton.textContent = busy ? "转换中..." : "开始转换";
  };

  const clearResult = () => {
    currentResult = null;
    statusPanel.dataset.state = "idle";
    statusTitle.textContent = "尚未开始";
    statusMessage.textContent =
      "选择 JSON 后点击“开始转换”，结果会在这里预览并提供下载。";
    statusMeta.hidden = true;
    statusInputFormat.textContent = "";
    statusDirection.textContent = "";
    statusOutputName.textContent = "";
    statusCounts.textContent = "";
    statusMode.textContent = "";
    setPreviewText("转换成功后，这里会展示输出 JSON。");
    downloadButton.disabled = true;
    downloadSplitButton.hidden = true;
    renderBadges([]);
    renderWarnings([]);
  };

  const clearAll = () => {
    form.reset();
    fileInput.value = "";
    renderSelectedFiles();
    clearResult();
  };

  const setError = (message) => {
    currentResult = null;
    statusPanel.dataset.state = "error";
    statusTitle.textContent = "转换失败";
    statusMessage.textContent = message;
    statusMeta.hidden = true;
    setPreviewText("");
    downloadButton.disabled = true;
    downloadSplitButton.hidden = true;
    renderBadges([]);
    renderWarnings([]);
  };

  const setSuccess = (result) => {
    currentResult = result;
    statusPanel.dataset.state = "success";
    statusTitle.textContent = "转换完成";
    statusMessage.textContent =
      "已在当前浏览器本地完成处理，文件内容没有上传到服务器。";
    statusMeta.hidden = false;
    statusInputFormat.textContent = result.inputFormatLabel;
    statusDirection.textContent = result.directionLabel;
    statusOutputName.textContent = result.primaryDownload.filename;
    statusCounts.textContent = `输入 ${result.inputRecordCount} 条，输出 ${result.outputRecordCount} 条`;
    statusMode.textContent = result.modeLabel;
    setPreviewText(result.primaryDownload.text);
    downloadButton.disabled = false;
    downloadSplitButton.hidden = result.splitDownloads.length === 0;
    renderBadges(result.badges);
    renderWarnings(result.warnings);
  };

  const parseJsonFile = async (file) => {
    const text = await file.text();
    const zeroWidthChars = new RegExp(
      `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`,
      "g",
    );
    const normalized = text
      .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
      .replace(zeroWidthChars, "")
      .replace(new RegExp(String.fromCharCode(0x00a0), "g"), " ");

    try {
      return JSON.parse(normalized);
    } catch (error) {
      throw new Error(`${file.name} 不是合法 JSON：${error.message}`);
    }
  };

  const unwrapCpaRecord = (record, warnings, sourceLabel) => {
    if (!isWrappedCpaLike(record)) return record;

    const tokens = deepClone(record.tokens);
    if (tokens.last_refresh === undefined && record.last_refresh !== undefined) {
      tokens.last_refresh = record.last_refresh;
    }
    if (tokens.expired === undefined && record.expired !== undefined) {
      tokens.expired = record.expired;
    }
    if (tokens.email === undefined && record.email !== undefined) {
      tokens.email = record.email;
    }
    if (tokens.type === undefined && record.type !== undefined) {
      tokens.type = record.type;
    }
    if (tokens.disabled === undefined && typeof record.disabled === "boolean") {
      tokens.disabled = record.disabled;
    }

    const wrapperExtra = pickUnknownKeys(record, knownWrappedCpaKeys);
    if (Object.keys(wrapperExtra).length > 0) {
      tokens.__auth_wrapper_extra = wrapperExtra;
    }

    warnings.push(
      `${sourceLabel} 检测到 auth_mode + tokens 包裹格式，已按 tokens 内的凭证转换。`,
    );
    return tokens;
  };

  const normalizeCpaRecord = (rawRecord, index, warnings, sourceLabel) => {
    const record = unwrapCpaRecord(rawRecord, warnings, sourceLabel);
    if (!isPlainObject(record)) {
      throw new Error(`${sourceLabel} 不是对象，无法按 CPA 解析`);
    }

    const idToken = asString(record.id_token);
    const openaiInfo = extractOpenAIInfo(idToken);
    const accessToken = asString(record.access_token);
    const refreshToken = asString(record.refresh_token);
    const accountId = asString(record.account_id) || openaiInfo.chatgptAccountId;

    if (!accessToken) {
      throw new Error(`${sourceLabel} 缺少 access_token`);
    }
    if (!refreshToken) {
      throw new Error(`${sourceLabel} 缺少 refresh_token`);
    }
    if (!accountId) {
      throw new Error(
        `${sourceLabel} 缺少 account_id，且无法从 id_token 解析 chatgpt_account_id`,
      );
    }

    const email = asString(record.email) || openaiInfo.email;
    if (!email) {
      warnings.push(`${sourceLabel} 没有可用邮箱，将继续转换，但建议补上 email。`);
    }
    if (!idToken) {
      warnings.push(
        `${sourceLabel} 没有 id_token，SUB 输出里将缺少可自动补全的 OpenAI 身份字段。`,
      );
    }

    let expired = "";
    if (record.expired !== undefined && record.expired !== null && record.expired !== "") {
      expired = normalizeIsoString(record.expired);
      if (!expired) {
        warnings.push(`${sourceLabel} 的 expired 不是合法 ISO 时间，已忽略。`);
      }
    }

    let lastRefresh = "";
    if (
      record.last_refresh !== undefined &&
      record.last_refresh !== null &&
      record.last_refresh !== ""
    ) {
      lastRefresh = normalizeIsoString(record.last_refresh);
      if (!lastRefresh) {
        warnings.push(`${sourceLabel} 的 last_refresh 不是合法 ISO 时间，已置空。`);
      }
    }

    const preservedSub = isPlainObject(record.__sub) ? deepClone(record.__sub) : null;
    const unknownTopLevel = pickUnknownKeys(
      record,
      new Set([...knownCpaKeys, "__sub"]),
    );

    return {
      index,
      sourceLabel,
      accessToken,
      refreshToken,
      idToken,
      accountId,
      email,
      expired,
      lastRefresh,
      disabled: typeof record.disabled === "boolean" ? record.disabled : false,
      type: asString(record.type) || "codex",
      preservedSub,
      unknownTopLevel,
      openaiInfo,
    };
  };

  const toNonNegativeInt = (value, fallback) =>
    Number.isInteger(value) && value >= 0 ? value : fallback;

  const toNonNegativeNumber = (value, fallback) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : fallback;

  const buildSubAccountFromCpa = (normalized, mode) => {
    const preservedSub =
      mode === "lossless" && isPlainObject(normalized.preservedSub)
        ? normalized.preservedSub
        : null;
    const credentialsExtra = isPlainObject(preservedSub?.credentials_extra)
      ? deepClone(preservedSub.credentials_extra)
      : {};
    const credentials = isPlainObject(credentialsExtra) ? credentialsExtra : {};

    credentials.access_token = normalized.accessToken;
    credentials.refresh_token = normalized.refreshToken;
    credentials.id_token = normalized.idToken;
    if (normalized.email) {
      credentials.email = normalized.email;
    }
    credentials.chatgpt_account_id = normalized.accountId;
    if (!asString(credentials.chatgpt_user_id) && normalized.openaiInfo.chatgptUserId) {
      credentials.chatgpt_user_id = normalized.openaiInfo.chatgptUserId;
    }
    if (!asString(credentials.organization_id) && normalized.openaiInfo.organizationId) {
      credentials.organization_id = normalized.openaiInfo.organizationId;
    }
    if (!asString(credentials.plan_type) && normalized.openaiInfo.planType) {
      credentials.plan_type = normalized.openaiInfo.planType;
    }
    if (
      !asString(credentials.client_id) &&
      typeof normalized.unknownTopLevel.client_id === "string"
    ) {
      credentials.client_id = asString(normalized.unknownTopLevel.client_id);
    }
    if (normalized.expired) {
      credentials.expires_at = isoToEpochSeconds(normalized.expired);
    }

    const extra =
      mode === "lossless" && isPlainObject(preservedSub?.extra)
        ? deepClone(preservedSub.extra)
        : {};
    if (normalized.email && !asString(extra.email)) {
      extra.email = normalized.email;
    }
    if (!asString(extra.privacy_mode)) {
      extra.privacy_mode = "training_off";
    }
    if (mode === "lossless") {
      extra.cpa_last_refresh = normalized.lastRefresh;
      extra.cpa_disabled = normalized.disabled;
      extra.cpa_type = normalized.type;
      if (Object.keys(normalized.unknownTopLevel).length > 0) {
        extra.cpa_unknown_top_level = deepClone(normalized.unknownTopLevel);
      }
    }

    const account = {
      name:
        asString(preservedSub?.name) ||
        normalized.email ||
        normalized.accountId ||
        `account-${normalized.index + 1}`,
      platform: asString(preservedSub?.platform) || "openai",
      type: asString(preservedSub?.type) || "oauth",
      credentials,
      extra,
      concurrency: toNonNegativeInt(preservedSub?.concurrency, 10),
      priority: toNonNegativeInt(preservedSub?.priority, 1),
      rate_multiplier: toNonNegativeNumber(preservedSub?.rate_multiplier, 1),
      auto_pause_on_expired:
        typeof preservedSub?.auto_pause_on_expired === "boolean"
          ? preservedSub.auto_pause_on_expired
          : true,
    };

    if (mode === "lossless") {
      if (typeof preservedSub?.notes === "string" || preservedSub?.notes === null) {
        account.notes = preservedSub.notes;
      }
      if (asString(preservedSub?.proxy_key)) {
        account.proxy_key = asString(preservedSub.proxy_key);
      }
      if (asString(preservedSub?.group)) {
        account.group = asString(preservedSub.group);
      }
      if (preservedSub?.expires_at !== undefined && preservedSub?.expires_at !== null) {
        account.expires_at = preservedSub.expires_at;
      }
      applyUnknownFields(account, preservedSub?.account_extra);
    }

    return account;
  };

  const normalizeSubAccountToCpa = (account, index, warnings, mode) => {
    const sourceLabel = `accounts[${index + 1}]`;
    if (!isPlainObject(account)) {
      warnings.push(`${sourceLabel} 不是对象，已跳过。`);
      return null;
    }

    const platform = asString(account.platform).toLowerCase();
    const accountType = asString(account.type).toLowerCase();
    if (platform && platform !== "openai") {
      warnings.push(
        `${sourceLabel} 的 platform=${account.platform}，当前只转换 openai OAuth 账号，已跳过。`,
      );
      return null;
    }
    if (accountType && accountType !== "oauth") {
      warnings.push(
        `${sourceLabel} 的 type=${account.type}，当前只转换 OAuth 账号，已跳过。`,
      );
      return null;
    }

    const credentials = isPlainObject(account.credentials) ? account.credentials : null;
    if (!credentials) {
      warnings.push(`${sourceLabel} 缺少 credentials，已跳过。`);
      return null;
    }

    const extra = isPlainObject(account.extra) ? account.extra : {};
    const idToken = asString(credentials.id_token);
    const accessToken = asString(credentials.access_token);
    const openaiInfo = extractOpenAIInfo(idToken) || extractOpenAIInfo(accessToken);
    const refreshToken = asString(credentials.refresh_token);
    const accountId =
      asString(credentials.chatgpt_account_id) || openaiInfo.chatgptAccountId;

    if (!accessToken) {
      warnings.push(`${sourceLabel} 缺少 access_token，已跳过。`);
      return null;
    }
    if (!accountId) {
      warnings.push(
        `${sourceLabel} 缺少 chatgpt_account_id，且无法从 id_token 解析，已跳过。`,
      );
      return null;
    }
    if (!idToken) {
      warnings.push(
        `${sourceLabel} 没有 id_token，生成的 CPA 仍可导出，但字段保真度会降低。`,
      );
    }

    const email = asString(credentials.email) || asString(extra.email) || openaiInfo.email;
    if (!email) {
      warnings.push(
        `${sourceLabel} 没有可用邮箱，将继续导出，但建议补上 credentials.email。`,
      );
    }

    let expired = "";
    if (
      credentials.expires_at !== undefined &&
      credentials.expires_at !== null &&
      credentials.expires_at !== ""
    ) {
      try {
        expired = epochishToIso(credentials.expires_at);
      } catch {
        warnings.push(`${sourceLabel} 的 credentials.expires_at 无法识别，已置空。`);
      }
    }

    let lastRefresh = "";
    if (
      extra.cpa_last_refresh !== undefined &&
      extra.cpa_last_refresh !== null &&
      extra.cpa_last_refresh !== ""
    ) {
      lastRefresh = normalizeIsoString(extra.cpa_last_refresh);
      if (!lastRefresh) {
        warnings.push(
          `${sourceLabel} 的 extra.cpa_last_refresh 不是合法 ISO 时间，已置空。`,
        );
      }
    }

    const cpa = {
      access_token: accessToken,
      account_id: accountId,
      disabled: typeof extra.cpa_disabled === "boolean" ? extra.cpa_disabled : false,
      email,
      expired,
      id_token: idToken,
      last_refresh: lastRefresh,
      refresh_token: refreshToken,
      type: asString(extra.cpa_type) || "codex",
    };

    if (mode === "lossless") {
      const credentialsExtra = pickUnknownKeys(credentials, knownSubCredentialKeys);
      const accountExtra = pickUnknownKeys(account, knownSubAccountKeys);
      cpa.__sub = {
        name: asString(account.name),
        notes:
          typeof account.notes === "string" || account.notes === null
            ? account.notes
            : null,
        platform: asString(account.platform) || "openai",
        type: asString(account.type) || "oauth",
        proxy_key: asString(account.proxy_key),
        concurrency: Number.isInteger(account.concurrency) ? account.concurrency : 0,
        priority: Number.isInteger(account.priority) ? account.priority : 0,
        rate_multiplier:
          typeof account.rate_multiplier === "number" &&
          Number.isFinite(account.rate_multiplier)
            ? account.rate_multiplier
            : null,
        expires_at: account.expires_at ?? null,
        auto_pause_on_expired:
          typeof account.auto_pause_on_expired === "boolean"
            ? account.auto_pause_on_expired
            : null,
        group: asString(account.group) || asString(extra.group),
        credentials_extra: credentialsExtra,
        extra: deepClone(extra),
      };
      if (Object.keys(accountExtra).length > 0) {
        cpa.__sub.account_extra = accountExtra;
      }
    }

    return cpa;
  };

  const convertCpaPayload = (records, fileCount, mode) => {
    const warnings = [];
    const normalizedRecords = records.map((record, index) =>
      normalizeCpaRecord(record, index, warnings, `CPA[${index + 1}]`),
    );
    const accounts = normalizedRecords.map((record) =>
      buildSubAccountFromCpa(record, mode),
    );
    const output = {
      type: "sub2api-data",
      version: 1,
      exported_at: nowIso(),
      proxies: [],
      accounts,
    };

    return {
      directionLabel: "CPA -> SUB",
      inputFormatLabel: normalizedRecords.length > 1 ? "CPA 批量" : "CPA 单账号",
      modeLabel: getModeLabel(mode),
      inputRecordCount: normalizedRecords.length,
      outputRecordCount: accounts.length,
      primaryDownload: {
        filename: `sub2api-account-${buildTimestampTag()}.json`,
        text: formatJson(output),
      },
      splitDownloads: [],
      warnings,
      badges: [
        { label: "输入文件", value: String(fileCount) },
        { label: "CPA 数量", value: String(normalizedRecords.length) },
        { label: "SUB 账号", value: String(accounts.length) },
      ],
    };
  };

  const convertSubPayload = (payload, mode) => {
    if (!isPlainObject(payload) || !Array.isArray(payload.accounts)) {
      throw new Error("当前文件没有 accounts 数组，无法按 SUB 包解析。");
    }

    const warnings = [];
    const cpaRecords = payload.accounts
      .map((account, index) => normalizeSubAccountToCpa(account, index, warnings, mode))
      .filter(Boolean);

    if (cpaRecords.length === 0) {
      throw new Error("SUB 文件里没有可转换的 openai/oauth 账号。");
    }

    const primaryOutput = cpaRecords.length === 1 ? cpaRecords[0] : cpaRecords;
    const splitDownloads = cpaRecords.map((record, index) => ({
      filename: buildCodexFilename(record, index),
      text: formatJson(record),
    }));

    return {
      directionLabel: "SUB -> CPA",
      inputFormatLabel: "SUB 账号包",
      modeLabel: getModeLabel(mode),
      inputRecordCount: payload.accounts.length,
      outputRecordCount: cpaRecords.length,
      primaryDownload: {
        filename:
          cpaRecords.length === 1
            ? splitDownloads[0].filename
            : `codex-batch-${buildTimestampTag()}.json`,
        text: formatJson(primaryOutput),
      },
      splitDownloads: cpaRecords.length > 1 ? splitDownloads : [],
      warnings,
      badges: [
        { label: "SUB 账号", value: String(payload.accounts.length) },
        { label: "导出 CPA", value: String(cpaRecords.length) },
        { label: "跳过条目", value: String(payload.accounts.length - cpaRecords.length) },
      ],
    };
  };

  const combineFiles = async (files) => {
    const parsedFiles = await Promise.all(
      files.map(async (file) => ({
        file,
        payload: await parseJsonFile(file),
      })),
    );

    if (parsedFiles.length === 1) {
      const detected = detectFormat(parsedFiles[0].payload);
      if (detected === "unknown") {
        throw new Error("无法识别当前 JSON 是 CPA 还是 SUB。");
      }
      return {
        kind: detected,
        payload: parsedFiles[0].payload,
        fileCount: 1,
      };
    }

    const flattenedCpa = [];
    const flattenedSubAccounts = [];
    let detectedKind = null;

    parsedFiles.forEach(({ file, payload }) => {
      const detected = detectFormat(payload);
      if (detected === "unknown") {
        throw new Error(`无法识别 ${file.name} 的格式。`);
      }

      const currentKind = detected === "sub" ? "sub" : "cpa";
      if (detectedKind && detectedKind !== currentKind) {
        throw new Error("不能同时选择 CPA 和 SUB 文件，请分开转换。");
      }
      detectedKind = currentKind;

      if (detected === "sub") {
        flattenedSubAccounts.push(...payload.accounts);
        return;
      }
      if (detected === "cpa") {
        flattenedCpa.push(payload);
        return;
      }
      if (detected === "cpa-list") {
        flattenedCpa.push(...payload);
      }
    });

    if (detectedKind === "sub") {
      if (flattenedSubAccounts.length === 0) {
        throw new Error("没有找到可转换的 SUB 账号。");
      }
      return {
        kind: "sub",
        payload: {
          type: "sub2api-data",
          version: 1,
          accounts: flattenedSubAccounts,
        },
        fileCount: parsedFiles.length,
      };
    }

    if (flattenedCpa.length === 0) {
      throw new Error("没有找到可合并的 CPA 记录。");
    }

    return {
      kind: "cpa-list",
      payload: flattenedCpa,
      fileCount: parsedFiles.length,
    };
  };

  const downloadTextFile = (text, filename) => {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const downloadSequentially = async (entries) => {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      downloadTextFile(entry.text, entry.filename);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearResult();

    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      setError("请先选择一个/多个 SUB 文件，或一个/多个 CPA 文件。");
      return;
    }

    const mode = getModeValue();
    setBusy(true);

    try {
      const combined = await combineFiles(files);
      const result =
        combined.kind === "sub"
          ? convertSubPayload(combined.payload, mode)
          : convertCpaPayload(
              Array.isArray(combined.payload) ? combined.payload : [combined.payload],
              combined.fileCount,
              mode,
            );
      setSuccess(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "转换过程中发生未知错误。");
    } finally {
      setBusy(false);
    }
  });

  clearButton.addEventListener("click", clearAll);

  fileInput.addEventListener("change", () => {
    renderSelectedFiles();
    clearResult();
  });

  downloadButton.addEventListener("click", () => {
    if (!currentResult) return;
    downloadTextFile(
      currentResult.primaryDownload.text,
      currentResult.primaryDownload.filename,
    );
  });

  downloadSplitButton.addEventListener("click", async () => {
    if (!currentResult || !currentResult.splitDownloads.length) return;
    await downloadSequentially(currentResult.splitDownloads);
  });

  renderSelectedFiles();
  clearResult();
}
