const DEFAULT_CONNECTOR_URL = "http://127.0.0.1:47831/api/v1";
const CONNECTOR_STORAGE_KEY = "learningShelfConnectorUrl";
const QUEUE_KEY = "learningShelfPendingExplorations";

// 端点在扩展的选项页里配置（默认连本机，可切到线上地址）
const CONNECTOR_URL = (await chrome.storage.sync.get(CONNECTOR_STORAGE_KEY))[CONNECTOR_STORAGE_KEY] || DEFAULT_CONNECTOR_URL;

const form = document.querySelector("#capture-form");
const titleInput = document.querySelector("#title-input");
const urlInput = document.querySelector("#url-input");
const platformInput = document.querySelector("#platform-input");
const sourceInput = document.querySelector("#source-input");
const pageSite = document.querySelector("#page-site");
const statusMessage = document.querySelector("#status-message");
const submitButton = document.querySelector("#submit-button");
const retryButton = document.querySelector("#retry-button");

function inferPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("bilibili.com")) return "B站";
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "YouTube";
    if (hostname.includes("mp.weixin.qq.com")) return "微信公众号";
    if (hostname.includes("xiaohongshu.com")) return "小红书";
  } catch {}
  return "网页";
}

function pageMetadata() {
  const pick = (selector) => document.querySelector(selector)?.content?.trim();
  const title = pick('meta[property="og:title"]') || pick('meta[name="twitter:title"]') || document.title;
  const image = pick('meta[property="og:image"]') || pick('meta[name="twitter:image"]') || "";
  return { title, url: location.href, image };
}

async function api(path, options = {}) {
  const response = await fetch(`${CONNECTOR_URL}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "学习架连接器暂时不可用。");
  return payload;
}

async function pendingItems() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
}

async function updateQueueHint() {
  const pending = await pendingItems();
  retryButton.hidden = pending.length === 0;
  if (pending.length) statusMessage.textContent = `有 ${pending.length} 条待发送内容。连接学习架后可重试。`;
}

async function queueExploration(exploration) {
  const pending = await pendingItems();
  pending.push({ exploration, queuedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [QUEUE_KEY]: pending });
}

async function loadSources() {
  try {
    const { sources } = await api("/sources");
    sources.forEach((source) => sourceInput.add(new Option(`${source.title} · ${source.platform}`, source.id)));
  } catch {
    statusMessage.textContent = "学习架暂未连接；保存后会先留在扩展本地。";
  }
}

let currentPage = { image: "" };

async function loadCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    pageSite.textContent = "请先打开一个网页，再使用收下功能。";
    submitButton.disabled = true;
    return;
  }
  let metadata = { title: tab.title || "未命名网页", url: tab.url, image: "" };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageMetadata });
    metadata = { ...metadata, ...result };
  } catch {}
  currentPage = metadata;
  titleInput.value = metadata.title || "未命名网页";
  urlInput.value = metadata.url;
  platformInput.value = inferPlatform(metadata.url);
  pageSite.textContent = new URL(metadata.url).hostname.replace(/^www\./, "");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const takeaway = String(data.get("takeaway") || "").trim();
  const exploration = {
    title: String(data.get("title")).trim(),
    url: String(data.get("url")).trim(),
    platform: String(data.get("platform")).trim() || inferPlatform(String(data.get("url"))),
    previewImage: String(data.get("url")).trim() === currentPage.url ? currentPage.image || "" : "",
    sourceId: String(data.get("sourceId") || "") || null,
    engagement: String(data.get("engagement") || "saved"),
    captureLevel: takeaway ? "trace" : "quick",
    takeaway,
  };
  submitButton.disabled = true;
  try {
    await api("/explorations", { method: "POST", body: JSON.stringify({ exploration }) });
    statusMessage.textContent = "已收进探索池。";
    submitButton.textContent = "已收下";
  } catch {
    await queueExploration(exploration);
    statusMessage.textContent = "学习架暂未连接，已安全留在扩展本地队列。";
    retryButton.hidden = false;
    submitButton.textContent = "已加入待发送";
  } finally {
    submitButton.disabled = false;
  }
});

retryButton.addEventListener("click", async () => {
  const pending = await pendingItems();
  if (!pending.length) return;
  retryButton.disabled = true;
  const remaining = [];
  for (const item of pending) {
    try { await api("/explorations", { method: "POST", body: JSON.stringify({ exploration: item.exploration }) }); }
    catch { remaining.push(item); }
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
  retryButton.disabled = false;
  retryButton.hidden = remaining.length === 0;
  statusMessage.textContent = remaining.length ? `仍有 ${remaining.length} 条待发送内容。` : "待发送内容已收进探索池。";
});

await Promise.all([loadCurrentPage(), loadSources(), updateQueueHint()]);
