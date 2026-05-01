// 视频粘贴上传功能注入脚本
// 拦截 Ctrl+V 粘贴事件，支持视频文件上传，与图片上传逻辑一致
// 支持所有图床：GitHub / Gitee / R2 / AliOSS / TxCOS / MinIO / S3 /
//              Qiniu / MP(公众号) / Upyun / Telegram / Cloudinary / formCustom

(function () {
  "use strict";

  const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov|avi|mkv|flv|wmv|m4v)$/i;
  const VIDEO_MIMETYPES = /^video\//i;
  const MAX_VIDEO_SIZE_MB = 100;

  // ==================== 通用工具函数 ====================

  function getDir() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      },
    );
  }

  function getDateFilename(filename) {
    const ts = Date.now();
    const ext = filename.split(".").pop();
    return `${ts}-${uuid()}.${ext}`;
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(",").pop());
      reader.onerror = (e) => reject(e);
    });
  }

  function isVideoFile(file) {
    if (!file) return false;
    if (VIDEO_MIMETYPES.test(file.type)) return true;
    if (file.name && VIDEO_EXTENSIONS.test(file.name)) return true;
    return false;
  }

  function checkVideo(file) {
    if (!isVideoFile(file)) {
      return { ok: false, msg: "不是视频文件" };
    }
    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      return { ok: false, msg: `视频大小不能超过 ${MAX_VIDEO_SIZE_MB}M` };
    }
    return { ok: true, msg: "" };
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ==================== 编码工具（复刻 tokenTools） ====================

  function utf16to8(str) {
    let out = "";
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c >= 0x0001 && c <= 0x007f) {
        out += str.charAt(i);
      } else if (c > 0x07ff) {
        out += String.fromCharCode(0xe0 | ((c >> 12) & 0x0f));
        out += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
        out += String.fromCharCode(0x80 | (c & 0x3f));
      } else {
        out += String.fromCharCode(0xc0 | ((c >> 6) & 0x1f));
        out += String.fromCharCode(0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  const base64EncodeChars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function base64encode(str) {
    let out = "";
    let i = 0;
    const len = str.length;
    while (i < len) {
      const c1 = str.charCodeAt(i++) & 0xff;
      if (i === len) {
        out += base64EncodeChars.charAt(c1 >> 2);
        out += base64EncodeChars.charAt((c1 & 0x3) << 4);
        out += "==";
        break;
      }
      const c2 = str.charCodeAt(i++);
      if (i === len) {
        out += base64EncodeChars.charAt(c1 >> 2);
        out += base64EncodeChars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4));
        out += base64EncodeChars.charAt((c2 & 0xf) << 2);
        out += "=";
        break;
      }
      const c3 = str.charCodeAt(i++);
      out += base64EncodeChars.charAt(c1 >> 2);
      out += base64EncodeChars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4));
      out += base64EncodeChars.charAt(((c2 & 0xf) << 2) | ((c3 & 0xc0) >> 6));
      out += base64EncodeChars.charAt(c3 & 0x3f);
    }
    return out;
  }

  function safe64(base64) {
    return base64.replace(/\+/g, "-").replace(/\//g, "_");
  }

  // ==================== Crypto 工具（Web Crypto API） ====================

  const encoder = new TextEncoder();

  function toBytes(data) {
    return typeof data === "string" ? encoder.encode(data) : data;
  }

  async function hmac(algo, key, data) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toBytes(key),
      { name: "HMAC", hash: algo },
      false,
      ["sign"],
    );
    return new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, toBytes(data)),
    );
  }

  const hmacSHA256 = (key, data) => hmac("SHA-256", key, data);
  const hmacSHA1 = (key, data) => hmac("SHA-1", key, data);

  async function sha256Hex(data) {
    const hash = await crypto.subtle.digest("SHA-256", toBytes(data));
    return toHex(hash);
  }

  async function sha1Hex(data) {
    const hash = await crypto.subtle.digest("SHA-1", toBytes(data));
    return toHex(hash);
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // MD5 实现（upyun 签名需要，Web Crypto 不支持 MD5）
  function md5(string) {
    function md5cycle(x, k) {
      let a = x[0],
        b = x[1],
        c = x[2],
        d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn((b & c) | (~b & d), a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn((b & d) | (c & ~d), a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | ~d), a, b, x, s, t);
    }
    function md51(s) {
      const n = s.length;
      let state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) {
        md5cycle(state, md5blk(s.substring(i - 64, i)));
      }
      s = s.substring(i - 64);
      const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (i = 0; i < s.length; i++)
        tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i++) tail[i] = 0;
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] =
          s.charCodeAt(i) +
          (s.charCodeAt(i + 1) << 8) +
          (s.charCodeAt(i + 2) << 16) +
          (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    }
    function rhex(n) {
      const hex_chr = "0123456789abcdef";
      let s = "";
      for (let j = 0; j < 4; j++)
        s +=
          hex_chr.charAt((n >> (j * 8 + 4)) & 0x0f) +
          hex_chr.charAt((n >> (j * 8)) & 0x0f);
      return s;
    }
    function add32(a, b) {
      return (a + b) & 0xffffffff;
    }
    const state = md51(string);
    return rhex(state[0]) + rhex(state[1]) + rhex(state[2]) + rhex(state[3]);
  }

  // ==================== Toast 提示 ====================

  function showToast(msg, type) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    const bgMap = { error: "#ff4d4f", success: "#52c41a", info: "#1890ff" };
    Object.assign(toast.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "10px 24px",
      borderRadius: "6px",
      background: bgMap[type] || bgMap.info,
      color: "#fff",
      fontSize: "14px",
      zIndex: "99999",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      transition: "opacity 0.3s",
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ==================== 获取 CodeMirror View ====================

  function getCmView() {
    // 1. 通过 Pinia store 获取（最可靠，与 docx_export.js 等一致）
    try {
      const appEl = document.querySelector("#app");
      if (appEl && appEl.__vue_app__) {
        const vueApp = appEl.__vue_app__;
        const pinia =
          vueApp._context.provides?.pinia ||
          vueApp._context.config.globalProperties?.$pinia;
        if (pinia?.state?.value?.editor?.editor) {
          return pinia.state.value.editor.editor;
        }
      }
    } catch (e) {}

    // 2. 通过 DOM 查询
    try {
      const cmEditor = document.querySelector(".cm-editor");
      if (cmEditor) {
        return cmEditor.cmView?.view || cmEditor._view || null;
      }
    } catch (e) {}

    return null;
  }

  // ==================== 读取上传配置 ====================

  function getStorageItem(key) {
    return localStorage.getItem(key);
  }

  function getImgHost() {
    return getStorageItem("imgHost") || "default";
  }

  function getHostConfig(host) {
    const raw = getStorageItem(`${host}Config`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ==================== AWS Signature V4 ====================

  function getAmzDate() {
    const now = new Date();
    const ts = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const ds = ts.slice(0, 8);
    return { amzDate: ts, dateStamp: ds };
  }

  async function createPresignedUrl({
    endpoint,
    region,
    bucket,
    key,
    accessKeyId,
    secretAccessKey,
    expiresIn = 300,
    pathStyle = false,
  }) {
    const { amzDate, dateStamp } = getAmzDate();
    const service = "s3";
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const credential = `${accessKeyId}/${credentialScope}`;

    let host, proto;
    if (endpoint) {
      const url = new URL(endpoint);
      proto = url.protocol;
      host = pathStyle ? url.host : `${bucket}.${url.host}`;
    } else {
      proto = "https:";
      host = `${bucket}.s3.${region}.amazonaws.com`;
    }

    const canonicalUri = pathStyle
      ? `/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`
      : `/${encodeURIComponent(key).replace(/%2F/g, "/")}`;

    const params = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", credential],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresIn)],
      ["X-Amz-SignedHeaders", "host"],
    ];
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const queryString = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const canonicalRequest = [
      "PUT",
      canonicalUri,
      queryString,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashedCanonicalRequest,
    ].join("\n");

    const kDate = await hmacSHA256("AWS4" + secretAccessKey, dateStamp);
    const kRegion = await hmacSHA256(kDate, region);
    const kService = await hmacSHA256(kRegion, service);
    const kSigning = await hmacSHA256(kService, "aws4_request");
    const signature = toHex(await hmacSHA256(kSigning, stringToSign));

    return `${proto}//${host}${canonicalUri}?${queryString}&X-Amz-Signature=${signature}`;
  }

  // ==================== S3 兼容上传（R2 / AliOSS / TxCOS / MinIO / S3） ====================

  async function s3CompatUpload(file, providerConfig) {
    const {
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      path: basePath,
      cdnHost,
      pathStyle = false,
    } = providerConfig;

    const dir = basePath ? `${basePath}/` : "";
    const dateFilename = getDateFilename(file.name);
    const key = dir + dateFilename;

    const presignedUrl = await createPresignedUrl({
      endpoint,
      region,
      bucket,
      key,
      accessKeyId,
      secretAccessKey,
      pathStyle,
    });

    const res = await fetch(presignedUrl, { method: "PUT", body: file });
    if (!res.ok)
      throw new Error(`S3 上传失败: ${res.status} ${res.statusText}`);

    if (cdnHost) {
      const host = cdnHost.endsWith("/") ? cdnHost.slice(0, -1) : cdnHost;
      return `${host}/${key}`;
    }
    if (endpoint) {
      const url = new URL(endpoint);
      return pathStyle
        ? `${url.protocol}//${url.host}/${bucket}/${key}`
        : `${url.protocol}//${bucket}.${url.host}/${key}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  // ---------- Cloudflare R2 ----------

  async function r2Upload(file) {
    const config = getHostConfig("r2");
    if (!config) throw new Error("R2 配置无效");
    const { accountId, accessKey, secretKey, bucket, path, domain } = config;
    console.log("[upload_video] R2 config:", {
      accountId,
      bucket,
      path,
      domain,
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
    });
    const dir = path ? `${path}/` : "";
    const dateFilename = getDateFilename(file.name);
    const key = dir + dateFilename;

    const presignedUrl = await createPresignedUrl({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      bucket,
      key,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      pathStyle: false,
    });
    console.log(
      "[upload_video] R2 presigned URL:",
      presignedUrl.substring(0, 120) + "...",
    );

    const res = await fetch(presignedUrl, { method: "PUT", body: file });
    console.log(
      "[upload_video] R2 response:",
      res.status,
      res.statusText,
      res.ok,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`R2 上传失败: ${res.status} ${res.statusText} ${body}`);
    }
    const resultUrl = `${domain}/${key}`;
    console.log("[upload_video] R2 result URL:", resultUrl);
    return resultUrl;
  }

  // ---------- AliOSS ----------

  async function aliOSSUpload(file) {
    const config = getHostConfig("aliOSS");
    if (!config) throw new Error("阿里云 OSS 配置无效");
    const {
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      useSSL,
      cdnHost,
      path,
    } = config;
    const secure = useSSL === undefined || useSSL;
    const proto = secure ? "https" : "http";
    return s3CompatUpload(file, {
      endpoint: `${proto}://${region}.aliyuncs.com`,
      region,
      bucket,
      accessKeyId,
      secretAccessKey: accessKeySecret,
      path,
      cdnHost,
      pathStyle: false,
    });
  }

  // ---------- TxCOS ----------

  async function txCOSUpload(file) {
    const config = getHostConfig("txCOS");
    if (!config) throw new Error("腾讯云 COS 配置无效");
    const { secretId, secretKey, bucket, region, path, cdnHost } = config;
    return s3CompatUpload(file, {
      endpoint: `https://cos.${region}.myqcloud.com`,
      region,
      bucket,
      accessKeyId: secretId,
      secretAccessKey: secretKey,
      path,
      cdnHost,
      pathStyle: false,
    });
  }

  // ---------- MinIO ----------

  async function minioUpload(file) {
    const config = getHostConfig("minio");
    if (!config) throw new Error("MinIO 配置无效");
    const { endpoint, port, useSSL, bucket, accessKey, secretKey } = config;
    const proto = useSSL ? "https" : "http";
    const ep = `${proto}://${endpoint}${port ? `:${port}` : ""}`;
    return s3CompatUpload(file, {
      endpoint: ep,
      region: "auto",
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      pathStyle: true,
    });
  }

  // ---------- S3 ----------

  async function s3Upload(file) {
    const config = getHostConfig("s3");
    if (!config) throw new Error("S3 配置无效");
    const {
      endpoint,
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      path,
      cdnHost,
      pathStyle,
    } = config;
    const ep = endpoint
      ? endpoint.startsWith("http")
        ? endpoint
        : `https://${endpoint}`
      : undefined;
    return s3CompatUpload(file, {
      endpoint: ep,
      region,
      bucket,
      accessKeyId,
      secretAccessKey: accessKeySecret,
      path,
      cdnHost,
      pathStyle: !!pathStyle,
    });
  }

  // ==================== GitHub 上传 ====================

  const defaultGithubConfig = {
    username: "bucketio",
    repoList: Array.from({ length: 20 }, (_, i) => `img${i}`),
    branch: "main",
    accessTokenList: [
      "ghp_sqQg5y7XC7Fy8XdoocsmdVEYRiRiTZPvbwzTL4MRjQc",
      "ghp_jB5JXzBjpGbgzdoocsmdogWfSHhfCKGVstozw1cAsPv",
      "ghp_zvy8wkHo259g7doocsmdJnUKOQd1WO1SPzZ9G0O9cJD",
      "ghp_DnCJc2Ms0RVZ1doocsmdiWOAN78FurfSeD1Pv2Y28pO",
      "ghp_EsMYDv9WVjXWP5doocsmd1nnDml2DEP95rOiz44bSo0",
      "ghp_L4isHf01nllOOdoocsmdHBGoDG6jscCA09WV44QDvlg",
      "ghp_qWciwYXHPakAUGdoocsmdBOBZdRcV08JThKey3mBZNJ",
      "ghp_rxkvIO08wVL2DMdoocsmd2jDEhcatp2rfVyhd3A7RiS",
      "ghp_1RvkWKboSxr0yVdoocsmd7OtBCpecYwoV6deh3utifJ",
      "ghp_cduanDnAug60ngdoocsmdF1uDstXUi6S9RMhY1qdada",
      "ghp_q6mxuJIkqAcsCXdoocsmdkkjWvzGlMVRuy5zI0IWNDx",
    ],
  };

  function getGithubConfig(useDefault) {
    if (useDefault) {
      const cfg = defaultGithubConfig;
      return {
        username: cfg.username,
        repo: pickRandom(cfg.repoList),
        branch: cfg.branch,
        accessToken: pickRandom(cfg.accessTokenList).replace("doocsmd", ""),
      };
    }
    const custom = getHostConfig("github");
    if (!custom) return null;
    const repoUrl = custom.repo
      .replace("https://github.com/", "")
      .replace("http://github.com/", "")
      .replace("github.com/", "")
      .split("/");
    return {
      username: repoUrl[0],
      repo: repoUrl[1],
      branch: custom.branch || "master",
      accessToken: custom.accessToken,
    };
  }

  async function ghFileUpload(base64Content, filename) {
    const useDefault = getImgHost() === "default";
    const config = getGithubConfig(useDefault);
    if (!config) throw new Error("GitHub 配置无效");
    const { username, repo, branch, accessToken } = config;
    const dir = getDir();
    const dateFilename = getDateFilename(filename);
    const url = `https://api.github.com/repos/${username}/${repo}/contents/${dir}/${dateFilename}`;

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: base64Content,
        branch,
        message: `Upload by ${window.location.href}`,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GitHub 上传失败: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    const downloadUrl = data.content.download_url;
    const githubHost = `raw.githubusercontent.com/${username}/${repo}/${branch}/`;
    const cdnHost = `fastly.jsdelivr.net/gh/${username}/${repo}@${branch}/`;
    return useDefault ? downloadUrl.replace(githubHost, cdnHost) : downloadUrl;
  }

  // ==================== Gitee 上传 ====================

  const defaultGiteeConfig = {
    username: "filesss",
    repoList: Array.from({ length: 20 }, (_, i) => `img${i}`),
    branch: "main",
    accessTokenList: [
      "ed5fc9866bd6c2fdoocsmddd433f806fd2f399c",
      "5448ffebbbf1151doocsmdc4e337cf814fc8a62",
      "25b05efd2557ca2doocsmd75b5c0835e3395911",
    ],
  };

  function getGiteeConfig(useDefault) {
    if (useDefault) {
      const cfg = defaultGiteeConfig;
      return {
        username: cfg.username,
        repo: pickRandom(cfg.repoList),
        branch: cfg.branch,
        accessToken: pickRandom(cfg.accessTokenList).replace("doocsmd", ""),
      };
    }
    const custom = getHostConfig("gitee");
    if (!custom) return null;
    const repoUrl = custom.repo
      .replace("https://gitee.com/", "")
      .replace("http://gitee.com/", "")
      .replace("gitee.com/", "")
      .split("/");
    return {
      username: repoUrl[0],
      repo: repoUrl[1],
      branch: custom.branch || "master",
      accessToken: custom.accessToken,
    };
  }

  async function giteeUpload(base64Content, filename) {
    const useDefault = getImgHost() === "default";
    const config = getGiteeConfig(useDefault);
    if (!config) throw new Error("Gitee 配置无效");
    const { username, repo, branch, accessToken } = config;
    const dir = getDir();
    const dateFilename = getDateFilename(filename);
    const url = `https://gitee.com/api/v5/repos/${username}/${repo}/contents/${dir}/${dateFilename}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: base64Content,
        branch,
        access_token: accessToken,
        message: `Upload by ${window.location.href}`,
      }),
    });

    if (!res.ok) throw new Error(`Gitee 上传失败: ${res.status}`);
    const data = await res.json();
    return encodeURI(data.content.download_url);
  }

  // ==================== 七牛云上传 ====================

  async function qiniuUpload(file) {
    const config = getHostConfig("qiniu");
    if (!config) throw new Error("七牛云配置无效");
    const { accessKey, secretKey, bucket, region, path, domain } = config;

    // 生成上传 token
    const putPolicy = JSON.stringify({
      scope: bucket,
      deadline: Math.trunc(Date.now() / 1000) + 3600,
    });
    const encoded = base64encode(utf16to8(putPolicy));
    const sign = await hmacSHA1(secretKey, encoded);
    const encodedSigned = bufferToBase64(sign);
    const token = `${accessKey}:${safe64(encodedSigned)}:${encoded}`;

    const dir = path ? `${path}/` : "";
    const dateFilename = dir + getDateFilename(file.name);

    // 七牛 HTTP 表单上传
    const regionUploadHosts = {
      z0: "upload.qiniup.com",
      z1: "upload-z1.qiniup.com",
      z2: "upload-z2.qiniup.com",
      na0: "upload-na0.qiniup.com",
      as0: "upload-as0.qiniup.com",
      "cn-east-2": "upload-cn-east-2.qiniup.com",
    };
    const uploadHost = regionUploadHosts[region] || "upload.qiniup.com";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("token", token);
    formData.append("key", dateFilename);

    const res = await fetch(`https://${uploadHost}`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error(`七牛云上传失败: ${res.status}`);
    const data = await res.json();
    return `${domain}/${data.key}`;
  }

  // ==================== 公众号图床上传 ====================

  async function getMpToken(appID, appsecret, proxyOrigin) {
    // 检查缓存 token
    const cached = getStorageItem(`mpToken:${appID}`);
    if (cached) {
      try {
        const token = JSON.parse(cached);
        if (token.expire && token.expire > Date.now()) {
          return token.access_token;
        }
      } catch {}
    }

    let url = "https://api.weixin.qq.com/cgi-bin/stable_token";
    if (proxyOrigin) {
      url = `${proxyOrigin}/cgi-bin/stable_token`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: appID,
        secret: appsecret,
      }),
    });

    if (!res.ok) throw new Error(`获取 access_token 失败: ${res.status}`);
    const data = await res.json();

    if (data.access_token) {
      const tokenInfo = {
        ...data,
        expire: Date.now() + data.expires_in * 1000,
      };
      localStorage.setItem(`mpToken:${appID}`, JSON.stringify(tokenInfo));
      return data.access_token;
    }
    throw new Error("获取 access_token 失败");
  }

  async function mpFileUpload(file) {
    const config = getHostConfig("mp");
    if (!config) throw new Error("公众号图床配置无效");
    let { appID, appsecret, proxyOrigin } = config;

    const access_token = await getMpToken(appID, appsecret, proxyOrigin);

    const formdata = new FormData();
    formdata.append("media", file, file.name);

    // 视频使用 add_material 接口，type=video
    let url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${access_token}&type=video`;
    if (proxyOrigin) {
      url = url.replace("https://api.weixin.qq.com", proxyOrigin);
    }

    const res = await fetch(url, { method: "POST", body: formdata });
    if (!res.ok) throw new Error(`公众号上传失败: ${res.status}`);
    const data = await res.json();

    if (!data.url && !data.media_id) {
      throw new Error(`上传失败: ${data.errmsg || "未获取到URL"}`);
    }

    let mediaUrl = data.url || data.media_id;
    if (proxyOrigin && window.location.href.startsWith("http") && data.url) {
      mediaUrl = `https://wsrv.nl?url=${encodeURIComponent(data.url)}`;
    }
    return mediaUrl;
  }

  // ==================== 又拍云上传 ====================

  async function upyunUpload(file) {
    const config = getHostConfig("upyun");
    if (!config) throw new Error("又拍云配置无效");
    const { bucket, operator, password, path, domain } = config;
    const filename = `${path}/${getDateFilename(file.name)}`;
    const uri = `/${bucket}/${filename}`;
    const arrayBuffer = await file.arrayBuffer();
    const date = new Date().toUTCString();

    // 签名：HMAC-SHA1(MD5(password), "PUT&uri&date")
    const signStr = ["PUT", uri, date].join("&");
    const passwordMd5 = md5(password);
    const sign = await hmacSHA1(passwordMd5, signStr);
    const signature = bufferToBase64(sign);
    const authorization = `UPYUN ${operator}:${signature}`;

    const url = `https://v0.api.upyun.com${uri}`;
    const res = await window.fetch(url, {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "X-Date": date,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: arrayBuffer,
    });

    if (!res.ok) throw new Error(`又拍云上传失败: ${res.status}`);
    return `${domain}/${filename}`;
  }

  // ==================== Telegram 上传 ====================

  async function telegramUpload(file) {
    const config = getHostConfig("telegram");
    if (!config) throw new Error("Telegram 配置无效");
    const { token, chatId } = config;

    // 视频使用 sendDocument（sendVideo 有格式限制）
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", file, file.name);

    const sendRes = await fetch(
      `https://api.telegram.org/bot${token}/sendDocument`,
      { method: "POST", body: form },
    );
    if (!sendRes.ok) throw new Error(`Telegram 上传失败: ${sendRes.status}`);
    const sendData = await sendRes.json();

    if (!sendData.ok || !sendData.result.document) {
      throw new Error("Telegram sendDocument 失败");
    }

    const fileId = sendData.result.document.file_id;

    // getFile 获取下载路径
    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
    );
    if (!fileRes.ok) throw new Error(`Telegram getFile 失败`);
    const fileData = await fileRes.json();

    if (!fileData.ok) throw new Error("Telegram getFile 失败");
    return `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
  }

  // ==================== Cloudinary 上传 ====================

  async function cloudinaryUpload(file) {
    const config = getHostConfig("cloudinary");
    if (!config) throw new Error("Cloudinary 配置无效");
    const {
      cloudName,
      apiKey,
      apiSecret,
      uploadPreset,
      folder = "",
      domain,
    } = config;

    if (!cloudName || !apiKey) {
      throw new Error("Cloudinary 配置缺少 cloudName / apiKey");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));

    if (apiSecret) {
      // signed upload
      const params = [];
      if (folder) params.push(`folder=${folder}`);
      if (uploadPreset) params.push(`upload_preset=${uploadPreset}`);
      params.push(`timestamp=${timestamp}`);
      const signatureBase = params.sort().join("&");
      const signature = await sha1Hex(signatureBase + apiSecret);
      formData.append("signature", signature);
    } else if (uploadPreset) {
      formData.append("upload_preset", uploadPreset);
    } else {
      throw new Error("未配置 apiSecret 时必须提供 uploadPreset");
    }

    if (folder) formData.append("folder", folder);

    // 视频使用 /video/upload 接口
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;
    const res = await fetch(uploadUrl, { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Cloudinary 上传失败: ${res.status}`);
    const data = await res.json();

    const originUrl = data.secure_url || data.url;
    if (!originUrl) throw new Error("Cloudinary 返回缺少 url 字段");

    if (domain) {
      const { pathname, search } = new URL(originUrl);
      return `${domain}${pathname}${search}`;
    }
    return originUrl;
  }

  // ==================== formCustom 自定义上传 ====================

  async function formCustomUpload(base64Content, file) {
    const customConfig = getStorageItem("formCustomConfig");
    if (!customConfig) throw new Error("自定义上传代码未配置");

    return new Promise((resolve, reject) => {
      const exportObj = {
        content: base64Content,
        file,
        util: {
          axios: window.fetch.bind(window),
          Buffer: { from: (str) => btoa(str) },
          uuidv4: uuid,
          tokenTools: { utf16to8, base64encode, safe64 },
          getDir,
          getDateFilename,
        },
        okCb: resolve,
        errCb: reject,
      };
      try {
        const str = `async (CUSTOM_ARG) => { ${customConfig} }`;
        const fn = new Function(`return ${str}`)();
        fn(exportObj).catch((err) => {
          console.error(err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ==================== 统一上传入口 ====================

  async function fileUpload(base64Content, file) {
    const imgHost = getImgHost();
    console.log("[upload_video] imgHost:", imgHost);
    console.log("[upload_video] file:", file.name, file.type, file.size);
    let url;
    switch (imgHost) {
      case "github":
        url = await ghFileUpload(base64Content, file.name);
        break;
      case "gitee":
        url = await giteeUpload(base64Content, file.name);
        break;
      case "r2":
        url = await r2Upload(file);
        break;
      case "aliOSS":
        url = await aliOSSUpload(file);
        break;
      case "txCOS":
        url = await txCOSUpload(file);
        break;
      case "minio":
        url = await minioUpload(file);
        break;
      case "s3":
        url = await s3Upload(file);
        break;
      case "qiniu":
        url = await qiniuUpload(file);
        break;
      case "mp":
        url = await mpFileUpload(file);
        break;
      case "upyun":
        url = await upyunUpload(file);
        break;
      case "telegram":
        url = await telegramUpload(file);
        break;
      case "cloudinary":
        url = await cloudinaryUpload(file);
        break;
      case "formCustom":
        url = await formCustomUpload(base64Content, file);
        break;
      default:
        url = await ghFileUpload(base64Content, file.name);
        break;
    }
    console.log("[upload_video] 上传结果 URL:", url);
    if (!url) throw new Error("上传返回空 URL");
    return url;
  }

  // ==================== 插入视频到编辑器 ====================

  function insertVideoToEditor(videoUrl, insertPos) {
    const view = getCmView();
    console.log("[upload_video] 插入视频:", {
      videoUrl,
      insertPos,
      hasView: !!view,
    });
    if (!view) {
      showToast("无法获取编辑器实例", "error");
      return;
    }
    const videoTag = `\n<video style="width: 100%;" src="${videoUrl}" controls></video>\n`;
    // 使用粘贴时保存的光标位置插入，而非当前光标位置
    if (insertPos !== undefined) {
      view.dispatch({ changes: { from: insertPos, insert: videoTag } });
    } else {
      view.dispatch(view.state.replaceSelection(videoTag));
    }
    console.log("[upload_video] 插入完成");
  }

  // ==================== 上传流程 ====================

  async function handleVideoUpload(file, insertPos) {
    const check = checkVideo(file);
    if (!check.ok) {
      showToast(check.msg, "error");
      return;
    }

    const imgHost = getImgHost();
    if (imgHost !== "default") {
      const configKey =
        imgHost === "formCustom" ? "formCustomConfig" : `${imgHost}Config`;
      const config = getStorageItem(configKey);
      if (!config) {
        showToast(`请先配置 ${imgHost} 图床参数`, "error");
        return;
      }
    }

    showToast("视频上传中...", "info");

    try {
      const base64Content = await toBase64(file);
      const url = await fileUpload(base64Content, file);
      insertVideoToEditor(url, insertPos);
      showToast("视频上传成功", "success");
    } catch (err) {
      console.error("[upload_video]", err);
      showToast("视频上传失败: " + (err.message || err), "error");
    }
  }

  // ==================== 拦截粘贴事件 ====================

  function initPasteHandler() {
    const cmContent = document.querySelector(".cm-content");
    if (!cmContent) return false;

    cmContent.addEventListener(
      "paste",
      function (event) {
        if (!event.clipboardData?.items) return;

        const items = [...event.clipboardData.items];
        const videoFiles = items
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file) => file && isVideoFile(file));

        if (videoFiles.length === 0) return;

        // 在粘贴时立即保存光标位置，上传完成后用此位置插入
        const view = getCmView();
        const insertPos = view ? view.state.selection.main.head : undefined;

        event.stopPropagation();
        event.preventDefault();

        for (const file of videoFiles) {
          handleVideoUpload(file, insertPos);
        }
      },
      true,
    );

    console.log("[upload_video] 视频粘贴上传已就绪");
    return true;
  }

  // ==================== 等待编辑器加载后初始化 ====================

  function waitAndInit() {
    if (initPasteHandler()) return;
    const observer = new MutationObserver(() => {
      if (initPasteHandler()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitAndInit);
  } else {
    waitAndInit();
  }
})();
