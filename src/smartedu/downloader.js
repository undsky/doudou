/**
 * 教育资源下载助手 - Content Script
 * 国家中小学智慧教育平台 (smartedu.cn) 电子课本 / 课程视频 / 课件资源下载
 */

(function () {
  "use strict";

  if (window.doudouSmarteduDownloaderInjected) return;
  window.doudouSmarteduDownloaderInjected = true;

  // ==================== 全局状态 ====================

  // 已发现的资源，key = 去重标识
  const resourceMap = new Map();

  let panelEl = null;
  let isDownloading = false;
  // 收起后停靠在页面右侧的小圆钮
  let ballEl = null;
  let isCollapsed = false;
  let autoScanTimer = null;

  // 可下载的文件格式
  const ALLOW_FORMATS = new Set([
    "pdf",
    "mp4",
    "m3u8",
    "mp3",
    "m4a",
    "wav",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "zip",
    "epub",
  ]);

  // 资源详情接口（不同栏目路径不同，逐个尝试）
  const DETAIL_PATHS = [
    "zxx/ndrv2/resources/tch_material/details/{id}.json",
    "zxx/ndrv2/national_lesson/resources/details/{id}.json",
    "zxx/ndrv2/prepare_lesson/resources/details/{id}.json",
    "zxx/ndrv2/thematic_course/resources/details/{id}.json",
    "zxx/ndrv2/special_edu/resources/details/{id}.json",
    "zxx/ndrv2/resources/details/{id}.json",
    "zxx/ndrv2/national_lesson/lesson_activity/details/{id}.json",
  ];

  const FILE_HOSTS = [
    "https://s-file-1.ykt.cbern.com.cn/",
    "https://s-file-2.ykt.cbern.com.cn/",
  ];

  // ==================== 工具函数 ====================

  function appendToBody(element) {
    if (!element) return;
    const parent = document.body || document.documentElement;
    if (parent) {
      parent.appendChild(element);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          (document.body || document.documentElement).appendChild(element);
        },
        { once: true },
      );
    }
  }

  function showToast(message, duration = 3000) {
    const existing = document.querySelector(".doudou-smartedu-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "doudou-smartedu-toast";
    toast.textContent = message;
    appendToBody(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function createProgress(title) {
    const existing = document.querySelector(".doudou-smartedu-progress");
    if (existing) existing.remove();

    const progress = document.createElement("div");
    progress.className = "doudou-smartedu-progress";
    progress.innerHTML = `
      <div class="doudou-smartedu-progress-title"></div>
      <div class="doudou-smartedu-progress-bar">
        <div class="doudou-smartedu-progress-fill"></div>
      </div>
      <div class="doudou-smartedu-progress-text">准备中...</div>
    `;
    progress.querySelector(".doudou-smartedu-progress-title").textContent =
      title;
    appendToBody(progress);

    return {
      update: (percent, text) => {
        const fill = progress.querySelector(".doudou-smartedu-progress-fill");
        if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        const textEl = progress.querySelector(".doudou-smartedu-progress-text");
        if (textEl && text) textEl.textContent = text;
      },
      setTitle: (text) => {
        const titleEl = progress.querySelector(
          ".doudou-smartedu-progress-title",
        );
        if (titleEl) titleEl.textContent = text;
      },
      close: () => setTimeout(() => progress.remove(), 600),
    };
  }

  function safeParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)}${units[index]}`;
  }

  function sanitizeFilename(name) {
    return (name || "教育资源")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  // ==================== 鉴权 ====================

  // 平台登录态存放在 localStorage 的 ND_UC_AUTH-* 中，部分资源下载需要携带
  function getAuthToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.includes("ND_UC_AUTH")) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const data = safeParse(raw);
        if (!data) continue;

        let inner = data.value !== undefined ? data.value : data;
        if (typeof inner === "string") inner = safeParse(inner) || {};

        const token = inner?.access_token || data?.access_token;
        if (token) return token;
      }
    } catch (e) {
      console.warn("[豆豆] 读取智慧教育平台登录态失败:", e);
    }
    return null;
  }

  function buildAuthHeaders() {
    const token = getAuthToken();
    if (!token) return {};
    return { "X-ND-AUTH": `MAC id="${token}",nonce="0",mac="0"` };
  }

  // ==================== HLS 视频（m3u8）====================

  // 平台的视频密钥接口需要 sign = md5(nonce + keyId).slice(0, 16)，WebCrypto 不提供 MD5
  function md5(input) {
    function rotl(n, c) {
      return (n << c) | (n >>> (32 - c));
    }
    function add(x, y) {
      const low = (x & 0xffff) + (y & 0xffff);
      return (((x >> 16) + (y >> 16) + (low >> 16)) << 16) | (low & 0xffff);
    }
    function cmn(q, a, b, x, s, t) {
      return add(rotl(add(add(a, q), add(x, t)), s), b);
    }
    const FF = (a, b, c, d, x, s, t) =>
      cmn((b & c) | (~b & d), a, b, x, s, t);
    const GG = (a, b, c, d, x, s, t) =>
      cmn((b & d) | (c & ~d), a, b, x, s, t);
    const HH = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
    const II = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);

    const str = Array.from(new TextEncoder().encode(input), (byte) =>
      String.fromCharCode(byte),
    ).join("");
    const blocks = [];
    for (let i = 0; i < str.length * 8; i += 8) {
      blocks[i >> 5] |= (str.charCodeAt(i / 8) & 255) << i % 32;
    }
    const bitLength = str.length * 8;
    blocks[bitLength >> 5] |= 0x80 << bitLength % 32;
    blocks[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < blocks.length; i += 16) {
      const oa = a;
      const ob = b;
      const oc = c;
      const od = d;
      const x = (k) => blocks[i + k] | 0;

      a = FF(a, b, c, d, x(0), 7, -680876936);
      d = FF(d, a, b, c, x(1), 12, -389564586);
      c = FF(c, d, a, b, x(2), 17, 606105819);
      b = FF(b, c, d, a, x(3), 22, -1044525330);
      a = FF(a, b, c, d, x(4), 7, -176418897);
      d = FF(d, a, b, c, x(5), 12, 1200080426);
      c = FF(c, d, a, b, x(6), 17, -1473231341);
      b = FF(b, c, d, a, x(7), 22, -45705983);
      a = FF(a, b, c, d, x(8), 7, 1770035416);
      d = FF(d, a, b, c, x(9), 12, -1958414417);
      c = FF(c, d, a, b, x(10), 17, -42063);
      b = FF(b, c, d, a, x(11), 22, -1990404162);
      a = FF(a, b, c, d, x(12), 7, 1804603682);
      d = FF(d, a, b, c, x(13), 12, -40341101);
      c = FF(c, d, a, b, x(14), 17, -1502002290);
      b = FF(b, c, d, a, x(15), 22, 1236535329);

      a = GG(a, b, c, d, x(1), 5, -165796510);
      d = GG(d, a, b, c, x(6), 9, -1069501632);
      c = GG(c, d, a, b, x(11), 14, 643717713);
      b = GG(b, c, d, a, x(0), 20, -373897302);
      a = GG(a, b, c, d, x(5), 5, -701558691);
      d = GG(d, a, b, c, x(10), 9, 38016083);
      c = GG(c, d, a, b, x(15), 14, -660478335);
      b = GG(b, c, d, a, x(4), 20, -405537848);
      a = GG(a, b, c, d, x(9), 5, 568446438);
      d = GG(d, a, b, c, x(14), 9, -1019803690);
      c = GG(c, d, a, b, x(3), 14, -187363961);
      b = GG(b, c, d, a, x(8), 20, 1163531501);
      a = GG(a, b, c, d, x(13), 5, -1444681467);
      d = GG(d, a, b, c, x(2), 9, -51403784);
      c = GG(c, d, a, b, x(7), 14, 1735328473);
      b = GG(b, c, d, a, x(12), 20, -1926607734);

      a = HH(a, b, c, d, x(5), 4, -378558);
      d = HH(d, a, b, c, x(8), 11, -2022574463);
      c = HH(c, d, a, b, x(11), 16, 1839030562);
      b = HH(b, c, d, a, x(14), 23, -35309556);
      a = HH(a, b, c, d, x(1), 4, -1530992060);
      d = HH(d, a, b, c, x(4), 11, 1272893353);
      c = HH(c, d, a, b, x(7), 16, -155497632);
      b = HH(b, c, d, a, x(10), 23, -1094730640);
      a = HH(a, b, c, d, x(13), 4, 681279174);
      d = HH(d, a, b, c, x(0), 11, -358537222);
      c = HH(c, d, a, b, x(3), 16, -722521979);
      b = HH(b, c, d, a, x(6), 23, 76029189);
      a = HH(a, b, c, d, x(9), 4, -640364487);
      d = HH(d, a, b, c, x(12), 11, -421815835);
      c = HH(c, d, a, b, x(15), 16, 530742520);
      b = HH(b, c, d, a, x(2), 23, -995338651);

      a = II(a, b, c, d, x(0), 6, -198630844);
      d = II(d, a, b, c, x(7), 10, 1126891415);
      c = II(c, d, a, b, x(14), 15, -1416354905);
      b = II(b, c, d, a, x(5), 21, -57434055);
      a = II(a, b, c, d, x(12), 6, 1700485571);
      d = II(d, a, b, c, x(3), 10, -1894986606);
      c = II(c, d, a, b, x(10), 15, -1051523);
      b = II(b, c, d, a, x(1), 21, -2054922799);
      a = II(a, b, c, d, x(8), 6, 1873313359);
      d = II(d, a, b, c, x(15), 10, -30611744);
      c = II(c, d, a, b, x(6), 15, -1560198380);
      b = II(b, c, d, a, x(13), 21, 1309151649);
      a = II(a, b, c, d, x(4), 6, -145523070);
      d = II(d, a, b, c, x(11), 10, -1120210379);
      c = II(c, d, a, b, x(2), 15, 718787259);
      b = II(b, c, d, a, x(9), 21, -343485551);

      a = add(a, oa);
      b = add(b, ob);
      c = add(c, oc);
      d = add(d, od);
    }

    const hex = "0123456789abcdef";
    return [a, b, c, d]
      .map((num) => {
        let s = "";
        for (let i = 0; i < 4; i++) {
          const byte = (num >>> (i * 8)) & 255;
          s += hex[(byte >> 4) & 15] + hex[byte & 15];
        }
        return s;
      })
      .join("");
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0) & 0xff);
  }

  function hexToBytes(hex) {
    const clean = hex.replace(/^0x/i, "");
    const bytes = new Uint8Array(Math.ceil(clean.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // 分片序号作为 IV（EXT-X-KEY 未显式给出 IV 时按 HLS 规范推导）
  function sequenceIv(sequence) {
    const iv = new Uint8Array(16);
    const view = new DataView(iv.buffer);
    view.setUint32(12, sequence >>> 0);
    return iv;
  }

  // 构造一个补充密文块，使 CBC 解密时最后一块恰好还原成合法的 PKCS7 填充
  async function makePaddingBlock(key, lastBlock) {
    const target = new Uint8Array(16);
    for (let i = 0; i < 16; i++) target[i] = 0x10 ^ lastBlock[i];
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: new Uint8Array(16) },
        key,
        target,
      ),
    );
    return encrypted.slice(0, 16);
  }

  // WebCrypto 不支持 ECB，用 CBC(IV=0) 反推：ECB 明文 = CBC 明文 XOR 前一个密文块
  async function aesEcbDecrypt(key, cipher) {
    const total = cipher.length;
    const padding = await makePaddingBlock(key, cipher.slice(total - 16));
    const buffer = new Uint8Array(total + 16);
    buffer.set(cipher);
    buffer.set(padding, total);

    const cbc = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: new Uint8Array(16) },
        key,
        buffer,
      ),
    );

    const out = new Uint8Array(total);
    for (let block = 0; block * 16 < total; block++) {
      for (let i = 0; i < 16; i++) {
        const index = block * 16 + i;
        out[index] = cbc[index] ^ (block === 0 ? 0 : cipher[index - 16]);
      }
    }

    const pad = out[total - 1];
    return pad >= 1 && pad <= 16 ? out.slice(0, total - pad) : out;
  }

  const hlsKeyCache = new Map();

  // 密钥接口：先取 nonce，再用 md5(nonce + keyId) 前 16 位签名换取密钥，
  // 返回的密钥本体还经过一层 AES-ECB(密钥=签名) 加密
  async function fetchHlsKey(keyUri) {
    if (!keyUri) throw new Error("播放列表未提供密钥地址");
    if (hlsKeyCache.has(keyUri)) return hlsKeyCache.get(keyUri);

    const keyId = keyUri.split("?")[0].split("/").filter(Boolean).pop();

    const signRes = await fetch(`${keyUri}/signs`);
    if (!signRes.ok) throw new Error(`获取密钥签名失败 HTTP ${signRes.status}`);
    const nonce = (await signRes.json())?.nonce;
    if (!nonce) throw new Error("密钥签名接口返回异常");

    const sign = md5(nonce + keyId).slice(0, 16);
    const keyRes = await fetch(
      `${keyUri}?nonce=${encodeURIComponent(nonce)}&sign=${sign}`,
    );
    if (!keyRes.ok) throw new Error(`获取视频密钥失败 HTTP ${keyRes.status}`);

    const payload = await keyRes.json();
    if (!payload?.key) throw new Error("视频密钥接口返回异常");

    const signKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(sign),
      "AES-CBC",
      false,
      ["encrypt", "decrypt"],
    );
    const plain = await aesEcbDecrypt(signKey, base64ToBytes(payload.key));
    const keyBytes = Uint8Array.from(
      new TextDecoder().decode(plain),
      (ch) => ch.charCodeAt(0) & 0xff,
    );

    hlsKeyCache.set(keyUri, keyBytes);
    return keyBytes;
  }

  function parseM3u8(text, baseUrl) {
    const result = { variants: [], segments: [], key: null, mediaSequence: 0 };
    let pendingVariant = null;

    text.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidth = line.match(/BANDWIDTH=(\d+)/);
        pendingVariant = { bandwidth: bandwidth ? Number(bandwidth[1]) : 0 };
        return;
      }

      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        result.mediaSequence = Number(line.split(":")[1]) || 0;
        return;
      }

      if (line.startsWith("#EXT-X-KEY:")) {
        const method = line.match(/METHOD=([^,\s]+)/);
        const uri = line.match(/URI="([^"]+)"/);
        const iv = line.match(/IV=0x([0-9a-fA-F]+)/);
        result.key = {
          method: method ? method[1] : "NONE",
          uri: uri ? new URL(uri[1], baseUrl).href : null,
          iv: iv ? iv[1] : null,
        };
        return;
      }

      if (line.startsWith("#")) return;

      const url = new URL(line, baseUrl).href;
      if (pendingVariant) {
        result.variants.push({ ...pendingVariant, url });
        pendingVariant = null;
      } else {
        result.segments.push(url);
      }
    });

    return result;
  }

  function withAccessToken(url) {
    if (!url || !url.toLowerCase().includes(".m3u8")) return url;
    const token = getAuthToken();
    if (!token) return url;
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has("accessToken")) {
        parsed.searchParams.set("accessToken", token);
      }
      return parsed.href;
    } catch (e) {
      return url;
    }
  }

  async function fetchPlaylist(urls) {
    let lastError = null;

    for (const rawUrl of urls) {
      const url = withAccessToken(rawUrl);
      try {
        const response = await fetch(url, { headers: buildAuthHeaders() });
        if (response.ok) return { url, text: await response.text() };
        lastError =
          response.status === 401 || response.status === 403
            ? new Error("需要登录，请先登录国家中小学智慧教育平台后重试")
            : new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("播放列表下载失败");
  }

  async function fetchSegment(url) {
    // 分片本身可公开访问，先不带自定义头避免 CORS 预检，失败再带鉴权重试
    let response = null;
    try {
      response = await fetch(url);
    } catch (e) {
      response = null;
    }
    if (!response || !response.ok) {
      response = await fetch(url, { headers: buildAuthHeaders() });
    }
    if (!response.ok) throw new Error(`分片下载失败 HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function decryptSegment(key, data, ivHex, sequence) {
    const iv = ivHex ? hexToBytes(ivHex) : sequenceIv(sequence);

    try {
      return new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, data),
      );
    } catch (e) {
      // 分片未按 PKCS7 填充时，补一个合法填充块再解密
      const padding = await makePaddingBlock(key, data.slice(data.length - 16));
      const buffer = new Uint8Array(data.length + 16);
      buffer.set(data);
      buffer.set(padding, data.length);
      return new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, buffer),
      );
    }
  }

  const SEGMENT_CONCURRENCY = 6;

  async function downloadHlsVideo(res, progress) {
    const filename =
      sanitizeFilename(`${res.title}${res.quality ? `-${res.quality}` : ""}`) +
      ".ts";

    if (progress) {
      progress.setTitle(filename);
      progress.update(0, "解析播放列表...");
    }

    const urls = res.urls && res.urls.length ? res.urls : [res.url];
    let playlist = await fetchPlaylist(urls);
    let info = parseM3u8(playlist.text, playlist.url);

    // 主播放列表：挑码率最高的一路
    if (info.segments.length === 0 && info.variants.length > 0) {
      const best = info.variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
      playlist = await fetchPlaylist([best.url]);
      info = parseM3u8(playlist.text, playlist.url);
    }

    if (info.segments.length === 0) {
      throw new Error("播放列表中没有找到视频分片");
    }

    // 避免多路 CDN URL 的查询参数在相对分片地址上被错误继承
    info.segments = info.segments.map((url) => {
      const clean = new URL(url);
      clean.search = "";
      clean.hash = "";
      return clean.href;
    });

    let cryptoKey = null;
    if (info.key && info.key.method && info.key.method !== "NONE") {
      if (info.key.method !== "AES-128") {
        throw new Error(`暂不支持的加密方式：${info.key.method}`);
      }
      if (progress) progress.update(0, "获取解密密钥...");
      const keyBytes = await fetchHlsKey(info.key.uri);
      cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, [
        "encrypt",
        "decrypt",
      ]);
    }

    const total = info.segments.length;
    const chunks = new Array(total);
    let finished = 0;
    let bytes = 0;

    const worker = async (offset) => {
      for (let i = offset; i < total; i += SEGMENT_CONCURRENCY) {
        let data = await fetchSegment(info.segments[i]);
        if (cryptoKey) {
          data = await decryptSegment(
            cryptoKey,
            data,
            info.key.iv,
            info.mediaSequence + i,
          );
        }
        chunks[i] = data;
        finished++;
        bytes += data.length;
        if (progress) {
          progress.update(
            (finished / total) * 100,
            `分片 ${finished}/${total} · ${formatSize(bytes)}`,
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SEGMENT_CONCURRENCY, total) }, (_, i) =>
        worker(i),
      ),
    );

    if (progress) progress.update(100, `合并中 · ${formatSize(bytes)}`);
    saveBlob(new Blob(chunks, { type: "video/mp2t" }), filename);

    return { success: true };
  }

  // ==================== 资源解析 ====================

  function pickStorageUrls(item) {
    const raw = item.ti_storages || item.ti_storage || item.ti_url;
    const list = Array.isArray(raw) ? raw : [raw];
    return list.filter((url) => typeof url === "string" && url.startsWith("http"));
  }

  function normalizeFormat(item, url) {
    let format = String(item.ti_format || "").toLowerCase();
    if (format.includes("/")) format = format.split("/").pop();
    if (!format) {
      const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
      format = match ? match[1].toLowerCase() : "";
    }
    return format;
  }

  // 同一资源的多路视频（1080p / 720p / 480p / 360p）用清晰度区分
  function pickQuality(item) {
    const flag = String(item.ti_file_flag || "");
    const flagMatch = flag.match(/(\d{3,4})p/i);
    if (flagMatch) return `${flagMatch[1]}p`;

    // 原画链接不带清晰度标记，从转码地址的分辨率推断
    const urls = pickStorageUrls(item);
    const urlMatch = urls[0] && urls[0].match(/-\d{3,4}x(\d{3,4})-/);
    if (urlMatch) return `${urlMatch[1]}p`;

    return "";
  }

  // 缩略图 / 预览图 / 切片目录等非资源本体
  function isPreviewItem(item) {
    const flag = String(item.ti_file_flag || "").toLowerCase();
    return (
      flag.includes("thumbnail") ||
      flag.includes("cover") ||
      flag === "image" ||
      flag.includes("preview")
    );
  }

  // 资源名称：平台把「课件 / 教学设计 / 学习任务单」放在 title，
  // 把课时名（如「我是中国人」）放在 global_title，两者拼接才是完整名称
  function buildResourceName(node, inherited) {
    const own =
      node?.title ||
      node?.custom_properties?.alias_name ||
      node?.resource_type_code_name ||
      "";
    const lesson =
      node?.global_title?.["zh-CN"] ||
      node?.global_title?.zh_CN ||
      node?.custom_properties?.original_title ||
      "";

    if (own && lesson && own !== lesson) return `${lesson}-${own}`;
    return own || lesson || inherited || "";
  }

  // 递归遍历 JSON，收集所有 ti_items 中可下载的文件
  function collectResources(root) {
    const found = [];
    const visited = new WeakSet();

    (function walk(node, depth, inheritedTitle) {
      if (!node || typeof node !== "object" || depth > 10) return;
      if (visited.has(node)) return;
      visited.add(node);

      const name = buildResourceName(node, inheritedTitle);

      if (Array.isArray(node.ti_items)) {
        node.ti_items.forEach((item) => {
          if (!item || typeof item !== "object") return;
          if (isPreviewItem(item)) return;

          const urls = pickStorageUrls(item);
          if (urls.length === 0) return;

          const format = normalizeFormat(item, urls[0]);
          if (!ALLOW_FORMATS.has(format)) return;

          const quality = pickQuality(item);

          found.push({
            key: `${format}|${urls[0]}`,
            title: name || "未命名资源",
            quality,
            format,
            urls,
            url: urls[0],
            size: Number(item.ti_size) || 0,
          });
        });
      }

      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        const value = node[key];
        if (value && typeof value === "object") walk(value, depth + 1, name);
      }
    })(root, 0, "");

    return found;
  }

  // 同一资源可能有多种格式，pdf / mp4 优先展示
  function addResources(list) {
    let added = 0;
    list.forEach((res) => {
      if (resourceMap.has(res.key)) return;
      resourceMap.set(res.key, res);
      added++;
    });
    return added;
  }

  function getSortedResources() {
    const weight = { pdf: 0, mp4: 1, m3u8: 2, mp3: 3, m4a: 3 };
    return Array.from(resourceMap.values()).sort((a, b) => {
      const wa = weight[a.format] ?? 5;
      const wb = weight[b.format] ?? 5;
      if (wa !== wb) return wa - wb;

      const titleDiff = a.title.localeCompare(b.title, "zh-CN");
      if (titleDiff !== 0) return titleDiff;

      // 同一资源的多路视频按清晰度从高到低
      return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
    });
  }

  // ==================== 资源发现 ====================

  // 从地址栏中提取资源 ID（不同栏目参数名不同）
  function getResourceIds() {
    const ids = new Set();
    const keys = [
      "contentId",
      "activityId",
      "resourceId",
      "courseId",
      "chapterId",
      "id",
    ];

    const collect = (search) => {
      if (!search) return;
      const params = new URLSearchParams(
        search.startsWith("?") ? search.slice(1) : search,
      );
      keys.forEach((key) => {
        const value = params.get(key);
        if (value && /^[0-9a-zA-Z-]{8,}$/.test(value)) ids.add(value);
      });
    };

    collect(location.search);

    // hash 路由形如 #/tchMaterial/detail?contentId=xxx
    const hashQueryIndex = location.hash.indexOf("?");
    if (hashQueryIndex !== -1) collect(location.hash.slice(hashQueryIndex));

    return Array.from(ids);
  }

  async function fetchDetailJson(id) {
    const headers = buildAuthHeaders();

    for (const path of DETAIL_PATHS) {
      for (const host of FILE_HOSTS) {
        const url = host + path.replace("{id}", id);
        try {
          const response = await fetch(url, { headers });
          if (!response.ok) continue;

          const text = await response.text();
          if (text.indexOf("ti_items") === -1) continue;

          const data = safeParse(text);
          if (data) return data;
        } catch (e) {
          // 单个接口失败继续尝试下一个
        }
      }
    }
    return null;
  }

  // 主动扫描当前页面资源
  async function scanResources() {
    const ids = getResourceIds();
    let added = 0;

    for (const id of ids) {
      const data = await fetchDetailJson(id);
      if (data) added += addResources(collectResources(data));
    }

    return added;
  }

  // ==================== 下载 ====================

  function buildFilename(res) {
    const suffix = res.quality ? `-${res.quality}` : "";
    const extension = res.format === "m3u8" ? "ts" : res.format;
    return sanitizeFilename(`${res.title}${suffix}`) + "." + extension;
  }

  async function downloadViaBackground(url, filename) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "DOUDOU_DOWNLOAD_MEDIA",
          action: "download",
          url,
          filename,
        },
        (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          resolve(response || { success: false, error: "后台下载无响应" });
        },
      );
    });
  }

  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename.replace(/\//g, "_");
    appendToBody(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
  }

  async function downloadResource(res, progress) {
    const filename = buildFilename(res);

    // HLS 视频：下载全部分片、解密并按顺序合并为可播放的 TS 文件
    if (res.format === "m3u8") {
      return downloadHlsVideo(res, progress);
    }

    if (progress) progress.setTitle(filename);

    const urls = res.urls && res.urls.length ? res.urls : [res.url];
    let lastError = null;
    let needAuth = false;

    // 资源分布在 r1/r2/r3 多个 CDN 节点，逐个尝试
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: buildAuthHeaders() });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) needAuth = true;
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        const total =
          Number(response.headers.get("content-length")) || res.size || 0;

        // 大文件（视频/PDF）分块读取，展示下载进度
        if (response.body && typeof response.body.getReader === "function") {
          const reader = response.body.getReader();
          const chunks = [];
          let received = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;

            if (progress) {
              const percent = total ? (received / total) * 100 : 0;
              progress.update(
                percent,
                total
                  ? `${formatSize(received)} / ${formatSize(total)}`
                  : `已下载 ${formatSize(received)}`,
              );
            }
          }

          saveBlob(new Blob(chunks), filename);
        } else {
          const blob = await response.blob();
          if (progress) progress.update(100, formatSize(blob.size));
          saveBlob(blob, filename);
        }

        return { success: true };
      } catch (error) {
        lastError = error;
      }
    }

    if (needAuth) {
      return {
        success: false,
        error: "需要登录，请先登录国家中小学智慧教育平台后重试",
      };
    }

    // 网络/跨域类错误才回退后台下载（后台下载无法携带鉴权头）
    console.warn("[豆豆] 页面内下载失败，回退到后台下载:", lastError);
    if (progress) progress.update(100, "转后台下载...");
    const result = await downloadViaBackground(urls[0], filename);
    if (result?.success) return { success: true };
    return {
      success: false,
      error: result?.error || lastError?.message || "下载失败",
    };
  }

  async function downloadOne(res, btn) {
    if (isDownloading) {
      showToast("正在下载中，请稍候");
      return;
    }
    isDownloading = true;

    const originalText = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "下载中";
    }

    const progress = createProgress(buildFilename(res));

    try {
      const result = await downloadResource(res, progress);
      if (result.success) {
        showToast("下载完成");
      } else {
        showToast("下载失败: " + result.error);
      }
    } catch (error) {
      showToast("下载失败: " + error.message);
    } finally {
      progress.close();
      isDownloading = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText || "下载";
      }
    }
  }

  // 批量下载时，同一视频课程仅保留分辨率最高的一路
  function getBatchResources() {
    const list = getSortedResources();
    const highestVideoByTitle = new Map();
    const result = [];

    list.forEach((res) => {
      if (res.format !== "m3u8") {
        result.push(res);
        return;
      }

      const current = highestVideoByTitle.get(res.title);
      const quality = parseInt(res.quality, 10) || 0;
      const currentQuality = parseInt(current?.quality, 10) || 0;
      if (!current || quality > currentQuality) {
        highestVideoByTitle.set(res.title, res);
      }
    });

    result.push(...highestVideoByTitle.values());
    return result;
  }

  async function downloadAll() {
    if (isDownloading) {
      showToast("正在下载中，请稍候");
      return;
    }

    const list = getBatchResources();
    if (list.length === 0) {
      showToast("没有可下载的资源");
      return;
    }

    isDownloading = true;
    const progress = createProgress("批量下载");
    let success = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        progress.setTitle(`(${i + 1}/${list.length}) ${buildFilename(list[i])}`);
        progress.update(0, "准备中...");

        const result = await downloadResource(list[i], progress);
        if (result.success) success++;

        await new Promise((r) => setTimeout(r, 500));
      }
      showToast(`批量下载完成：成功 ${success}/${list.length}`);
    } catch (error) {
      showToast("批量下载失败: " + error.message);
    } finally {
      progress.close();
      isDownloading = false;
    }
  }

  // ==================== 面板 UI ====================

  function renderList() {
    if (!panelEl) return;

    const listEl = panelEl.querySelector(".doudou-smartedu-list");
    const countEl = panelEl.querySelector(".doudou-smartedu-count");
    const list = getSortedResources();

    listEl.innerHTML = "";
    countEl.textContent = `共 ${list.length} 个资源`;

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "doudou-smartedu-empty";
      empty.innerHTML =
        "暂未发现可下载资源<br />请先打开电子课本 / 课程详情页并播放或预览，<br />再点击右上角刷新按钮";
      listEl.appendChild(empty);
      return;
    }

    list.forEach((res) => {
      const item = document.createElement("div");
      item.className = "doudou-smartedu-item";

      const info = document.createElement("div");
      info.className = "doudou-smartedu-item-info";

      const title = document.createElement("div");
      title.className = "doudou-smartedu-item-title";
      title.textContent = res.title;
      title.title = res.title;

      const meta = document.createElement("div");
      meta.className = "doudou-smartedu-item-meta";

      const badge = document.createElement("span");
      badge.className = "doudou-smartedu-badge";
      badge.textContent = res.format;
      meta.appendChild(badge);

      if (res.quality) {
        const quality = document.createElement("span");
        quality.className =
          "doudou-smartedu-badge doudou-smartedu-badge-plain";
        quality.textContent = res.quality;
        meta.appendChild(quality);
      }

      // m3u8 的 ti_size 是播放列表文件本身的大小（几 KB），不是视频体积，不展示
      const sizeText = res.format === "m3u8" ? "" : formatSize(res.size);
      if (sizeText) {
        const size = document.createElement("span");
        size.textContent = sizeText;
        meta.appendChild(size);
      }

      info.appendChild(title);
      info.appendChild(meta);

      const btn = document.createElement("button");
      btn.className = "doudou-smartedu-btn";
      btn.textContent = "下载";
      btn.addEventListener("click", () => downloadOne(res, btn));

      item.appendChild(info);
      item.appendChild(btn);
      listEl.appendChild(item);
    });
  }

  function createPanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement("div");
    panelEl.className = "doudou-smartedu-panel";
    panelEl.innerHTML = `
      <div class="doudou-smartedu-panel-header">
        <div>
          <div class="doudou-smartedu-panel-title">资源下载</div>
          <div class="doudou-smartedu-panel-subtitle">国家中小学智慧教育平台</div>
        </div>
        <div class="doudou-smartedu-panel-actions">
          <button class="doudou-smartedu-icon-btn" data-action="refresh" title="重新扫描">⟳</button>
          <button class="doudou-smartedu-icon-btn" data-action="collapse" title="收起">—</button>
        </div>
      </div>
      <div class="doudou-smartedu-list"></div>
      <div class="doudou-smartedu-panel-footer">
        <span class="doudou-smartedu-count">共 0 个资源</span>
        <button class="doudou-smartedu-btn doudou-smartedu-btn-send" data-action="download-all">全部下载</button>
      </div>
    `;

    panelEl
      .querySelector('[data-action="collapse"]')
      .addEventListener("click", () => collapsePanel());

    panelEl
      .querySelector('[data-action="refresh"]')
      .addEventListener("click", () => openPanel(true));

    panelEl
      .querySelector('[data-action="download-all"]')
      .addEventListener("click", () => downloadAll());

    appendToBody(panelEl);
    return panelEl;
  }

  // ==================== 收起 / 展开 ====================

  function updateBallCount() {
    if (!ballEl) return;
    const countEl = ballEl.querySelector(".doudou-smartedu-ball-count");
    if (countEl) countEl.textContent = resourceMap.size;
  }

  function showBall() {
    if (ballEl) {
      updateBallCount();
      return;
    }

    ballEl = document.createElement("div");
    ballEl.className = "doudou-smartedu-ball";
    ballEl.title = "展开教育资源下载";
    ballEl.innerHTML = `
      <span class="doudou-smartedu-ball-icon">📚</span>
      <span class="doudou-smartedu-ball-count">0</span>
    `;
    ballEl.addEventListener("click", () => expandPanel());
    appendToBody(ballEl);
    updateBallCount();
  }

  function hideBall() {
    if (!ballEl) return;
    ballEl.remove();
    ballEl = null;
  }

  function collapsePanel() {
    isCollapsed = true;
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    showBall();
  }

  function expandPanel() {
    isCollapsed = false;
    hideBall();
    createPanel();
    renderList();
  }

  async function openPanel(forceScan = false) {
    expandPanel();

    if (forceScan || resourceMap.size === 0) {
      const countEl = panelEl.querySelector(".doudou-smartedu-count");
      if (countEl) countEl.textContent = "正在扫描资源...";

      try {
        await scanResources();
      } catch (e) {
        console.warn("[豆豆] 扫描教育资源失败:", e);
      }

      renderList();

      if (resourceMap.size === 0) {
        showToast("未发现资源，请打开电子课本或课程详情页后重试", 4000);
      }
    }
  }

  // 发现资源后自动弹出面板（用户收起过则只更新小圆钮）
  function autoShowPanel() {
    if (resourceMap.size === 0) return;

    if (isCollapsed) {
      showBall();
      return;
    }

    if (panelEl) {
      renderList();
      return;
    }

    createPanel();
    renderList();
  }

  // 资源详情页才自动扫描/弹出，列表页、首页不打扰
  function isDetailPage() {
    return getResourceIds().length > 0;
  }

  function scheduleAutoScan(delay = 1000) {
    clearTimeout(autoScanTimer);
    autoScanTimer = setTimeout(async () => {
      if (!isDetailPage()) return;

      try {
        await scanResources();
      } catch (e) {
        console.warn("[豆豆] 自动扫描教育资源失败:", e);
      }

      autoShowPanel();
    }, delay);
  }

  // ==================== 初始化 ====================

  function init() {
    if (!location.hostname.includes("smartedu.cn")) return;

    // 注入接口拦截脚本到 main world
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("src/smartedu/inject.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn("[豆豆] 注入智慧教育平台拦截脚本失败:", e);
    }

    // 接收页面接口中捕获到的资源数据
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== "DOUDOU_SMARTEDU_RESOURCE_DATA") return;
      if (!isDetailPage()) return;

      try {
        const added = addResources(collectResources(event.data.data));
        if (added > 0) autoShowPanel();
      } catch (e) {}
    });

    // 切换资源时清空旧的扫描结果并重新扫描（保持用户的收起状态）
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        resourceMap.clear();
        if (panelEl) renderList();
        updateBallCount();
        scheduleAutoScan();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // 首次进入页面自动扫描
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => scheduleAutoScan(), {
        once: true,
      });
    } else {
      scheduleAutoScan();
    }
  }

  init();
  console.log("[豆豆] 教育资源下载助手已注入");
})();
