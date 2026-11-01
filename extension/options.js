const STORAGE_KEY = "learningShelfConnectorUrl";
const DEFAULT_URL = "http://127.0.0.1:47831/api/v1";
const PRESET_URLS = ["http://127.0.0.1:47831/api/v1", "https://learn.dream3398.cn/api/v1"];

const select = document.querySelector("#endpoint-select");
const customInput = document.querySelector("#endpoint-custom");
const saveButton = document.querySelector("#save-button");
const testButton = document.querySelector("#test-button");
const statusEl = document.querySelector("#status");

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = `status ${ok ? "ok" : "bad"}`;
}

function syncCustomVisibility() {
  customInput.hidden = select.value !== "custom";
}

async function load() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const saved = stored[STORAGE_KEY] || DEFAULT_URL;
  if (PRESET_URLS.includes(saved)) select.value = saved;
  else { select.value = "custom"; customInput.value = saved; }
  syncCustomVisibility();
}

function resolveUrl() {
  const value = select.value === "custom" ? customInput.value.trim() : select.value;
  return value.replace(/\/+$/, "");
}

saveButton.addEventListener("click", async () => {
  const url = resolveUrl();
  if (!/^https?:\/\//.test(url)) { setStatus("地址需要以 http:// 或 https:// 开头。", false); return; }
  await chrome.storage.sync.set({ [STORAGE_KEY]: url });
  setStatus("已保存。", true);
});

testButton.addEventListener("click", async () => {
  const url = resolveUrl();
  setStatus("正在测试…", true);
  try {
    const response = await fetch(`${url}/health`);
    const payload = await response.json();
    if (response.ok && payload.ok) setStatus(`连接成功（版本 ${payload.version || "未知"}）。`, true);
    else setStatus(`服务返回异常：${payload.error || response.status}`, false);
  } catch {
    setStatus("连不上。请确认服务已启动，且该地址已在扩展权限里允许。", false);
  }
});

select.addEventListener("change", syncCustomVisibility);
await load();
