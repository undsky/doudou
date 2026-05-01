/**
 * 轻量级 OpenAI API 封装
 * 参考 openai-node SDK 的 API 设计，使用 fetch 直接调用 OpenAI REST API
 * 适用于 Chrome MV3 Service Worker 环境
 *
 * 兼容 OpenAI API 格式的第三方服务（DeepSeek、通义千问等）
 */

export class OpenAIClient {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - API 密钥
   * @param {string} [options.baseURL='https://api.openai.com/v1'] - API 基础地址
   * @param {string} [options.model='gpt-4o'] - 默认模型
   * @param {number} [options.timeout=120000] - 请求超时（毫秒）
   * @param {number} [options.maxRetries=2] - 最大重试次数
   */
  constructor({
    apiKey,
    baseURL = "https://api.openai.com/v1",
    model = "gpt-4o",
    timeout = 120000,
    maxRetries = 2,
  } = {}) {
    if (!apiKey) {
      throw new Error("OpenAI API Key 未配置");
    }
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/+$/, ""); // 去除尾部斜杠
    this.model = model;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  /**
   * 从 Chrome Storage 加载配置并创建客户端
   * @returns {Promise<OpenAIClient|null>}
   */
  static async fromStorage() {
    try {
      const { openaiConfig } = await chrome.storage.sync.get(["openaiConfig"]);
      if (!openaiConfig?.openaiApiKey) {
        return null;
      }
      return new OpenAIClient({
        apiKey: openaiConfig.openaiApiKey,
        baseURL: openaiConfig.openaiBaseUrl || "https://api.openai.com/v1",
        model: openaiConfig.openaiModel || "gpt-4o",
      });
    } catch (e) {
      console.error("[OpenAI] 从存储加载配置失败:", e);
      return null;
    }
  }

  /**
   * 将文本和附件对象数组构建为兼容大模型输入格式的 userContent
   * @param {string} text - 用户输入的文本内容
   * @param {Array<Object>} attachments - 附件数组，包含 { isImage, isVideo, data, name } 属性
   * @returns {string|Array<Object>}
   */
  static buildUserContent(text, attachments = []) {
    if (!attachments || attachments.length === 0) {
      return text;
    }
    const parts = [];
    for (const a of attachments) {
      if (a.isImage) {
        parts.push({ type: "image_url", image_url: { url: a.data } });
      } else if (a.isVideo) {
        parts.push({ type: "video_url", video_url: { url: a.data } });
      } else {
        // 无论是文本还是其它未知类型读取为 DataURL 的文件，都在此统一作为附带文件名的文本块传给大模型。
        // 加上 [文件: xxx]\n 是为了在提示词中显式地告诉大模型这些文本内容或者 base64 来自于哪个附属文件，这能显著提升 AI 对上下文的理解能力。
        parts.push({ type: "text", text: `[文件: ${a.name}]\n${a.data}` });
      }
    }
    if (text) parts.push({ type: "text", text });
    return parts;
  }

  /**
   * 格式化消息数组，移除不支持或多余的字段（例如 reasoning_content）
   * @param {Array<Object>} messages
   * @returns {Array<Object>}
   */
  static formatMessages(messages) {
    return messages.map((m) => {
      if (m.reasoning_content !== undefined) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });
  }

  /**
   * 调用 Chat Completions API
   * @param {Array<{role: string, content: string}>} messages - 消息数组
   * @param {Object} [options] - 额外选项
   * @param {string} [options.model] - 覆盖默认模型
   * @param {number} [options.temperature] - 温度参数 0-2
   * @param {number} [options.max_tokens] - 最大生成 token 数
   * @param {boolean} [options.stream=false] - 是否流式响应
   * @returns {Promise<Object>} API 响应
   */
  async chatCompletions(messages, options = {}) {
    const {
      model = this.model,
      temperature,
      max_tokens,
      stream = false,
      ...rest
    } = options;

    const body = {
      model,
      messages: OpenAIClient.formatMessages(messages),
      stream,
      ...rest,
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens !== undefined) body.max_tokens = max_tokens;

    const response = await this._request("/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return response;
  }

  /**
   * 便捷方法：发送单条消息并获取回复文本
   * @param {string} userMessage - 用户消息
   * @param {Object} [options] - 额外选项
   * @param {string} [options.systemPrompt] - 系统提示
   * @returns {Promise<string>} 回复文本
   */
  async chat(userMessage, options = {}) {
    const { systemPrompt, ...rest } = options;
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    console.log(
      `[OpenAI] 发送请求，模型: ${rest.model || this.model}，用户消息长度: ${userMessage.length}`,
    );
    const result = await this.chatCompletions(messages, rest);

    // 详细日志，帮助排查空结果
    const message = result?.choices?.[0]?.message;
    const content = message?.content;
    const reasoningContent = message?.reasoning_content;
    const finishReason = result?.choices?.[0]?.finish_reason;
    const choicesLen = result?.choices?.length ?? 0;
    console.log(
      `[OpenAI] 响应: choices数量=${choicesLen}, finish_reason=${finishReason}, content长度=${content?.length ?? "null"}, reasoning长度=${reasoningContent?.length ?? "null"}`,
    );

    // 某些 coder 模型会返回 tool_calls 而非文本，自动重试并禁用工具调用
    if (!content && !reasoningContent && finishReason === "tool_calls") {
      // console.warn(
      //   "[OpenAI] 模型返回 tool_calls 而非文本内容，将以 tool_choice=none 重试",
      // );
      const retryResult = await this.chatCompletions(messages, {
        ...rest,
        tool_choice: "none",
      });
      const retryMsg = retryResult?.choices?.[0]?.message;
      const retryContent = retryMsg?.content || retryMsg?.reasoning_content;
      if (retryContent) {
        return retryContent;
      }
      console.warn(
        "[OpenAI] 重试后仍为空，原始响应:",
        JSON.stringify(retryResult).slice(0, 500),
      );
      return "";
    }

    if (!content && !reasoningContent) {
      console.warn(
        "[OpenAI] 返回内容为空，原始响应:",
        JSON.stringify(result).slice(0, 500),
      );
    }

    // DeepSeek 思考模式: content 可能为空，reasoning_content 中有内容
    return content || reasoningContent || "";
  }

  /**
   * 发送 HTTP 请求（带重试）
   * @private
   */
  async _request(path, options = {}) {
    const url = `${this.baseURL}${path}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers: { ...headers, ...options.headers },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const error = new Error(
            `OpenAI API 错误 ${response.status}: ${errorBody}`,
          );
          error.status = response.status;
          error.response = errorBody;

          // 4xx 错误（除 429）不重试
          if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429
          ) {
            throw error;
          }

          lastError = error;
          // 重试前等待
          if (attempt < this.maxRetries) {
            await this._sleep(Math.pow(2, attempt) * 1000);
            continue;
          }
          throw error;
        }

        return await response.json();
      } catch (e) {
        if (e.name === "AbortError") {
          lastError = new Error("OpenAI API 请求超时");
        } else {
          lastError = e;
        }

        // 非重试型错误直接抛出
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e;
        }

        if (attempt < this.maxRetries) {
          await this._sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError;
  }

  /**
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
