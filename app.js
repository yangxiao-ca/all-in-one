const STORAGE_KEY = "learning-hub-courses-v1";
const API_BASE = "/api/v1";

const demoCourses = [
  { id: "9af746ba-7653-4ef8-9ad4-0a05d84d82e4", title: "B站增长案例拆解", platform: "B站", creator: "某增长博主", url: "https://www.bilibili.com/", status: "learning", priority: "high", progress: "看到第 8 节，重点是封面和标题的 AB 测试。", tags: ["增长", "内容", "B站"] },
  { id: "e8da6035-f3f8-42c9-8c69-cf839cd4e2a6", title: "YouTube 长视频叙事课", platform: "YouTube", creator: "Favorite Creator", url: "https://www.youtube.com/", status: "queued", priority: "high", progress: "准备周末集中看，先从播放列表第 1 个开始。", tags: ["叙事", "视频", "YouTube"] },
  { id: "2c80ea51-b6b0-4c0c-9b2b-f3c7c0f7ccea", title: "公众号写作方法论", platform: "微信公众号", creator: "某写作老师", url: "https://mp.weixin.qq.com/", status: "paused", priority: "medium", progress: "收藏了几篇长文，后面整理成写作卡片。", tags: ["写作", "公众号"] },
  { id: "6dc372aa-a58b-4bbf-bd44-f2bfc70d63c0", title: "CCTalk 商业分析基础", platform: "CCTalk", creator: "训练营讲师", url: "https://www.cctalk.com/", status: "learning", priority: "medium", progress: "刚开始，先补课前资料。", tags: ["商业分析", "训练营"] },
];

const statusLabelMap = { learning: "学习中", queued: "想学", done: "已完成", paused: "暂停" };
const elements = {
  planCard: document.querySelector("#plan-card"), planObjective: document.querySelector("#plan-objective"), planDetail: document.querySelector("#plan-detail"), openPlanDialog: document.querySelector("#open-plan-dialog"), planDialog: document.querySelector("#plan-dialog"), closePlanDialog: document.querySelector("#close-plan-dialog"), planForm: document.querySelector("#plan-form"), planCourseInput: document.querySelector("#plan-course-input"),
  totalCount: document.querySelector("#total-count"), activeCount: document.querySelector("#active-count"), priorityCount: document.querySelector("#priority-count"),
  searchInput: document.querySelector("#search-input"), platformFilter: document.querySelector("#platform-filter"), statusFilter: document.querySelector("#status-filter"), priorityFilter: document.querySelector("#priority-filter"), resetFilters: document.querySelector("#reset-filters"),
  form: document.querySelector("#course-form"), exportButton: document.querySelector("#export-button"), list: document.querySelector("#course-list"), template: document.querySelector("#course-card-template"), statFilters: document.querySelectorAll(".stat-filter"),
  addDialog: document.querySelector("#add-dialog"), filterDialog: document.querySelector("#filter-dialog"), editDialog: document.querySelector("#edit-dialog"), openAddDialog: document.querySelector("#open-add-dialog"), closeAddDialog: document.querySelector("#close-add-dialog"), cancelAddDialog: document.querySelector("#cancel-add-dialog"), closeFilterDialog: document.querySelector("#close-filter-dialog"), closeEditDialog: document.querySelector("#close-edit-dialog"), cancelEditDialog: document.querySelector("#cancel-edit-dialog"), editForm: document.querySelector("#edit-form"), editCoverFile: document.querySelector("#edit-cover-file"), editCoverPreview: document.querySelector("#edit-cover-preview"), removeCoverImage: document.querySelector("#remove-cover-image"), libraryTitle: document.querySelector("#library-title"), courseCountLabel: document.querySelector("#course-count-label"),
  explorationDialog: document.querySelector("#exploration-dialog"), openExplorationDialog: document.querySelector("#open-exploration-dialog"), openExplorationList: document.querySelector("#open-exploration-list"), closeExplorationDialog: document.querySelector("#close-exploration-dialog"), explorationForm: document.querySelector("#exploration-form"), explorationList: document.querySelector("#exploration-list"), explorationTitle: document.querySelector("#exploration-title"), resetExplorationSource: document.querySelector("#reset-exploration-source"), explorationDialogTitle: document.querySelector("#exploration-dialog-title"), explorationSubmitButton: document.querySelector("#exploration-submit-button"),
  sourceDialog: document.querySelector("#source-dialog"), openSourceDialog: document.querySelector("#open-source-dialog"), openSourceList: document.querySelector("#open-source-list"), closeSourceDialog: document.querySelector("#close-source-dialog"), sourceForm: document.querySelector("#source-form"), sourceList: document.querySelector("#source-list"), sourceDialogTitle: document.querySelector("#source-dialog-title"), sourceSubmitButton: document.querySelector("#source-submit-button"), explorationSourceInput: document.querySelector("#exploration-source-input"),
};

let courses = [];
let draggedCourseId = null;
let editingCourseId = null;
let pendingCoverImage = null;
let activeQuickFilter = "all";
let connectorReady = false;
let explorations = [];
let sources = [];
let editingSource = null;
let editingExploration = null;
let activeExplorationSourceId = null;
let currentPlan = null;

function loadLegacyCourses() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : structuredClone(demoCourses);
  } catch { return structuredClone(demoCourses); }
}
function saveLegacyCourses() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(courses)); return true; }
  catch { window.alert("本地学习库空间不足，请换一张更小的图片，或删除不再需要的封面图。"); return false; }
}
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "无法保存到 Obsidian。");
    error.payload = payload;
    throw error;
  }
  return payload;
}
async function loadFromConnector() {
  const { courses: remoteCourses } = await apiRequest("/courses");
  connectorReady = true;
  return remoteCourses;
}
async function loadExplorations() {
  const { explorations: records } = await apiRequest("/explorations");
  explorations = records;
}
async function loadSources() { const { sources: records } = await apiRequest("/sources"); sources = records; }
async function loadPlan() { const { plan } = await apiRequest("/plan"); currentPlan = plan; }
async function initializeCourses() {
  try {
    courses = await loadFromConnector();
    try { await loadExplorations(); } catch { explorations = []; }
    try { await loadSources(); } catch { sources = []; }
    try { await loadPlan(); } catch { currentPlan = null; }
    const legacyCourses = loadLegacyCourses();
    if (courses.length === 0 && legacyCourses.length > 0 && localStorage.getItem(STORAGE_KEY)) {
      const shouldMigrate = window.confirm(`发现 ${legacyCourses.length} 门浏览器本地课程。是否现在迁移到 Obsidian？\n\n原始浏览器数据会保留，不会被删除。`);
      if (shouldMigrate) {
        const result = await apiRequest("/migration/courses", { method: "POST", body: JSON.stringify({ courses: legacyCourses }) });
        courses = result.migrated;
      }
    }
  } catch {
    connectorReady = false;
    courses = loadLegacyCourses();
  }
  renderCourses();
  renderExplorations();
  renderSources();
  renderPlan();
  if (connectorReady) connectVaultEvents();
}
function renderPlan() { const course = courses.find((item) => item.id === currentPlan?.primaryCourseId); elements.planObjective.textContent = currentPlan?.objective || "还没有当前学习计划"; elements.planDetail.textContent = currentPlan ? `${course?.title || "未选择主线"} · 下一步：${currentPlan.nextAction || "未填写"}` : "先选一门主线课程，再写下这阶段最小的下一步。"; elements.openPlanDialog.textContent = currentPlan ? "编辑计划" : "建立计划"; }
function connectVaultEvents() {
  const events = new EventSource(`${API_BASE}/events`);
  const refreshCourses = async () => {
    try { courses = await loadFromConnector(); renderCourses(); }
    catch { events.close(); }
  };
  ["vault-changed", "course-changed", "course-deleted", "courses-reordered", "migration-complete"].forEach((eventName) => {
    events.addEventListener(eventName, refreshCourses);
  });
  events.addEventListener("explorations-changed", async () => {
    try { await loadExplorations(); renderExplorations(); renderSources(); }
    catch { events.close(); }
  });
  events.addEventListener("sources-changed", async () => { try { await loadSources(); renderSources(); } catch { events.close(); } });
}
function renderSources() {
  const selectedSourceId = elements.explorationSourceInput.value;
  elements.explorationSourceInput.innerHTML = "";
  elements.explorationSourceInput.add(new Option("暂不归属", ""));
  sources.forEach((source) => elements.explorationSourceInput.add(new Option(`${source.title} · ${source.platform}`, source.id)));
  elements.explorationSourceInput.value = sources.some((source) => source.id === selectedSourceId) ? selectedSourceId : "";
  elements.sourceList.innerHTML = "";
  if (!sources.length) { elements.sourceList.textContent = "还没有订阅源。把一个你会持续关注的博主或公众号放进来。"; return; }
  sources.forEach((source) => { const entry = document.createElement("article"); entry.className = "source-entry"; const card = document.createElement(source.url ? "a" : "div"); card.className = "source-card"; if (source.url) { card.href = source.url; card.target = "_blank"; card.rel = "noreferrer"; } const platform = document.createElement("span"); platform.textContent = `${source.platform} · ${explorations.filter((record) => record.sourceId === source.id).length} 条探索`; const title = document.createElement("strong"); title.textContent = source.title; const reason = document.createElement("p"); reason.textContent = source.followReason || "持续关注的内容来源"; card.append(platform, title, reason); const tools = document.createElement("div"); tools.className = "source-tools"; const view = document.createElement("button"); view.type = "button"; view.textContent = "查看探索"; view.addEventListener("click", () => { activeExplorationSourceId = source.id; renderExplorations(); document.querySelector(".exploration-section").scrollIntoView({ behavior: "smooth", block: "start" }); }); tools.append(view); if (!source.url && source.platform.includes("微信")) { const openWechat = document.createElement("button"); openWechat.type = "button"; openWechat.textContent = "打开微信"; openWechat.addEventListener("click", async () => { await navigator.clipboard.writeText(source.title); await apiRequest("/open-wechat", { method: "POST" }); openWechat.textContent = "已复制"; }); tools.append(openWechat); } const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "编辑"; edit.addEventListener("click", () => editSource(source)); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除"; remove.addEventListener("click", () => deleteSource(source)); tools.append(edit, remove); entry.append(card, tools); elements.sourceList.append(entry); });
}
function editSource(source) { editingSource = source; elements.sourceDialogTitle.textContent = "编辑订阅源"; elements.sourceSubmitButton.textContent = "保存修改"; elements.sourceForm.elements.title.value = source.title; elements.sourceForm.elements.url.value = source.url || ""; elements.sourceForm.elements.platform.value = source.platform || ""; elements.sourceForm.elements.followReason.value = source.followReason || ""; elements.sourceDialog.showModal(); }
async function deleteSource(source) { if (!window.confirm(`删除订阅源“${source.title}”？可从备份恢复。`)) return; try { await apiRequest(`/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" }); } catch (error) { window.alert(error.message); } }
function renderExplorations() {
  if (!elements.explorationList) return;
  elements.explorationList.innerHTML = "";
  const selectedSource = sources.find((source) => source.id === activeExplorationSourceId);
  const visibleExplorations = selectedSource ? explorations.filter((record) => record.sourceId === selectedSource.id) : explorations;
  elements.explorationTitle.textContent = selectedSource ? `${selectedSource.title} 的探索` : "探索池";
  elements.resetExplorationSource.hidden = !selectedSource;
  if (!visibleExplorations.length) { elements.explorationList.textContent = "这里还没有探索记录。先用上面的表单收下一条链接，四个轻量动作会显示在它下方。"; return; }
  visibleExplorations.forEach((record) => {
    const entry = document.createElement("article"); entry.className = "exploration-entry";
    const card = document.createElement("a");
    card.className = "exploration-card"; card.href = record.url || "#"; card.target = "_blank"; card.rel = "noreferrer";
    const source = sources.find((item) => item.id === record.sourceId);
    const meta = document.createElement("span"); meta.textContent = `${record.platform || "网页"} · ${source ? `来自 ${source.title}` : record.engagement}`;
    const title = document.createElement("strong"); title.textContent = record.title;
    const note = document.createElement("p"); note.textContent = record.takeaway || record.question || "快速收下，稍后再决定。";
    card.append(meta, title, note);
    const actions = document.createElement("div"); actions.className = "exploration-actions";
    [["只是看过", "seen"], ["有启发", "insight"], ["想再看", "revisit"], ["想深入", "deepen"]].forEach(([label, engagement]) => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.addEventListener("click", () => updateExplorationEngagement(record, engagement));
      actions.append(button);
    });
    const tools = document.createElement("div"); tools.className = "exploration-tools"; const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "编辑"; edit.addEventListener("click", () => editExploration(record)); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除"; remove.addEventListener("click", () => deleteExploration(record)); tools.append(edit, remove); entry.append(card, actions, tools); elements.explorationList.append(entry);
  });
}
async function updateExplorationEngagement(record, engagement) {
  const patch = { engagement, captureLevel: engagement === "seen" ? "trace" : "trace" };
  if (engagement === "insight") {
    const takeaway = window.prompt("留下这一点：", record.takeaway || "");
    if (takeaway === null) return;
    patch.takeaway = takeaway.trim();
  }
  if (engagement === "deepen") {
    const question = window.prompt("接下来想弄清什么？", record.question || "");
    if (question === null) return;
    patch.question = question.trim();
  }
  try { await apiRequest(`/explorations/${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify({ exploration: { ...record, ...patch }, revision: record.revision }) }); }
  catch (error) { window.alert(error.message); }
}
async function handleExplorationSubmit(event) {
  event.preventDefault();
  if (!elements.explorationForm.reportValidity()) return;
  const data = new FormData(elements.explorationForm);
  const takeaway = String(data.get("takeaway") || "").trim();
  const exploration = { title: String(data.get("title")).trim(), url: String(data.get("url")).trim(), platform: String(data.get("platform")).trim() || "未标注来源", sourceId: String(data.get("sourceId") || "") || null, captureLevel: takeaway ? "trace" : "quick", engagement: takeaway ? "insight" : "saved", takeaway };
  try { if (editingExploration) await apiRequest(`/explorations/${encodeURIComponent(editingExploration.id)}`, { method: "PATCH", body: JSON.stringify({ exploration: { ...editingExploration, ...exploration }, revision: editingExploration.revision }) }); else await apiRequest("/explorations", { method: "POST", body: JSON.stringify({ exploration }) }); elements.explorationForm.reset(); editingExploration = null; elements.explorationDialog.close(); }
  catch (error) { window.alert(error.message); }
}
function editExploration(record) { editingExploration = record; elements.explorationDialogTitle.textContent = "编辑探索记录"; elements.explorationSubmitButton.textContent = "保存修改"; elements.explorationForm.elements.title.value = record.title; elements.explorationForm.elements.url.value = record.url; elements.explorationForm.elements.platform.value = record.platform; elements.explorationForm.elements.sourceId.value = record.sourceId || ""; elements.explorationForm.elements.takeaway.value = record.takeaway || ""; elements.explorationDialog.showModal(); }
async function deleteExploration(record) { if (!window.confirm(`删除探索记录“${record.title}”？可从备份恢复。`)) return; try { await apiRequest(`/explorations/${encodeURIComponent(record.id)}`, { method: "DELETE" }); } catch (error) { window.alert(error.message); } }
function fillExplorationFromDroppedText(text) {
  const urlMatch = String(text || "").match(/https?:\/\/[^\s"<>]+/);
  if (!urlMatch) return;
  const url = urlMatch[0]; const form = elements.explorationForm;
  form.elements.url.value = url;
  if (!form.elements.title.value.trim()) { try { form.elements.title.value = new URL(url).hostname.replace(/^www\./, ""); } catch {} }
}
async function handleSourceSubmit(event) {
  event.preventDefault();
  if (!elements.sourceForm.reportValidity()) return;
  const data = new FormData(elements.sourceForm);
  const source = { title: String(data.get("title")).trim(), url: String(data.get("url")).trim(), platform: String(data.get("platform")).trim() || "未标注来源", followReason: String(data.get("followReason") || "").trim() };
  try { if (editingSource) await apiRequest(`/sources/${encodeURIComponent(editingSource.id)}`, { method: "PATCH", body: JSON.stringify({ source: { ...editingSource, ...source }, revision: editingSource.revision }) }); else await apiRequest("/sources", { method: "POST", body: JSON.stringify({ source }) }); await loadSources(); renderSources(); elements.sourceForm.reset(); editingSource = null; elements.sourceDialog.close(); }
  catch (error) { window.alert(error.message); }
}
async function createCourse(course) {
  if (!connectorReady) { courses.unshift(course); saveLegacyCourses(); return; }
  const { course: savedCourse } = await apiRequest("/courses", { method: "POST", body: JSON.stringify({ course }) });
  courses = [savedCourse, ...courses.filter((item) => item.id !== savedCourse.id)];
}
async function updateCourse(course) {
  if (!connectorReady) { saveLegacyCourses(); return; }
  try {
    const { course: savedCourse } = await apiRequest(`/courses/${encodeURIComponent(course.id)}`, { method: "PATCH", body: JSON.stringify({ course, revision: course.revision }) });
    courses = courses.map((item) => item.id === savedCourse.id ? savedCourse : item);
  } catch (error) {
    if (error.payload?.course) courses = courses.map((item) => item.id === course.id ? error.payload.course : item);
    throw error;
  }
}
async function deleteCourse(course) {
  if (!connectorReady) { courses = courses.filter((item) => item.id !== course.id); saveLegacyCourses(); return; }
  await apiRequest(`/courses/${encodeURIComponent(course.id)}`, { method: "DELETE" });
  courses = courses.filter((item) => item.id !== course.id);
}
async function persistOrder() {
  if (!connectorReady) { saveLegacyCourses(); return; }
  const { courses: savedCourses } = await apiRequest("/courses/reorder", { method: "POST", body: JSON.stringify({ courseIds: courses.map((course) => course.id) }) });
  courses = savedCourses;
}
function getAutoCoverTheme(course) {
  const seed = `${course.id}${course.title}`.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
  return ["forest", "coral", "lime", "night", "amber", "plum", "teal", "moss", "sand"][seed % 9];
}
function getCoverTheme(course) { return course.cover && course.cover !== "auto" ? course.cover : getAutoCoverTheme(course); }
function isCustomCoverImage(value) { return typeof value === "string" && (value.startsWith("data:image/") || value.startsWith("/api/v1/assets/")); }
function getPlatforms() { return ["all", ...new Set(courses.map((course) => course.platform))]; }
function renderPlatformOptions() {
  const current = elements.platformFilter.value || "all";
  elements.platformFilter.innerHTML = "";
  getPlatforms().forEach((platform) => elements.platformFilter.add(new Option(platform === "all" ? "全部平台" : platform, platform)));
  elements.platformFilter.value = getPlatforms().includes(current) ? current : "all";
}
function matchesFilters(course) {
  const keyword = elements.searchInput.value.trim().toLowerCase();
  const text = [course.title, course.platform, course.creator, course.progress, ...(course.tags || [])].join(" ").toLowerCase();
  const quickFilterMatch = activeQuickFilter === "all" || (activeQuickFilter === "learning" && course.status === "learning") || (activeQuickFilter === "high" && course.priority === "high");
  return (!keyword || text.includes(keyword)) && quickFilterMatch;
}
function renderStats() {
  elements.totalCount.textContent = courses.length;
  elements.activeCount.textContent = courses.filter((course) => course.status === "learning").length;
  elements.priorityCount.textContent = courses.filter((course) => course.priority === "high").length;
}
function updateHeader(filteredCourses) {
  const filterTitles = { all: "今天，想从哪一门开始？", learning: "正在学习的课程", high: "高优先级课程" };
  elements.libraryTitle.textContent = elements.searchInput.value ? "找到这些课程" : filterTitles[activeQuickFilter];
  elements.courseCountLabel.textContent = `共 ${filteredCourses.length} 门课程`;
}
function setQuickFilter(filter) {
  activeQuickFilter = filter;
  elements.statFilters.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.statFilter === filter)));
  renderCourses();
}
async function reorderCourses(sourceId, targetId, insertAfter) {
  if (sourceId === targetId) return;

  const sourceIndex = courses.findIndex((course) => course.id === sourceId);
  const targetIndex = courses.findIndex((course) => course.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const [sourceCourse] = courses.splice(sourceIndex, 1);
  const nextTargetIndex = courses.findIndex((course) => course.id === targetId);
  courses.splice(nextTargetIndex + Number(insertAfter), 0, sourceCourse);
  try { await persistOrder(); }
  catch (error) {
    window.alert(error.message);
    if (connectorReady) {
      try { courses = await loadFromConnector(); }
      catch { connectorReady = false; courses = loadLegacyCourses(); }
    }
  }
  renderCourses();
}
function enableCardDragging(card, course) {
  card.draggable = true;
  card.addEventListener("dragstart", (event) => {
    draggedCourseId = course.id;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", course.id);
  });
  card.addEventListener("dragover", (event) => {
    if (!draggedCourseId || draggedCourseId === course.id) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    card.classList.toggle("drag-after", event.clientY > rect.top + rect.height / 2);
    card.classList.toggle("drag-before", event.clientY <= rect.top + rect.height / 2);
  });
  card.addEventListener("dragleave", () => card.classList.remove("drag-before", "drag-after"));
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    reorderCourses(draggedCourseId, course.id, event.clientY > rect.top + rect.height / 2);
  });
  card.addEventListener("dragend", () => {
    draggedCourseId = null;
    document.querySelectorAll(".course-card").forEach((item) => item.classList.remove("is-dragging", "drag-before", "drag-after"));
  });
}
function renderCourses() {
  renderPlatformOptions(); renderStats();
  const filteredCourses = courses.filter(matchesFilters);
  updateHeader(filteredCourses); elements.list.innerHTML = "";
  if (!filteredCourses.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "没有找到合适的课程。换个关键词，或添加一门新的。"; elements.list.append(empty); return;
  }
  filteredCourses.forEach((course, index) => {
    const fragment = elements.template.content.cloneNode(true);
    const card = fragment.querySelector(".course-card");
    fragment.querySelector(".cover-index").textContent = String(index + 1).padStart(2, "0");
    fragment.querySelector(".cover-platform").textContent = course.platform;
    const cover = fragment.querySelector(".course-cover");
    cover.classList.add(`cover-theme-${getCoverTheme(course)}`);
    if (isCustomCoverImage(course.coverImage)) { cover.classList.add("has-custom-image"); cover.style.backgroundImage = `url("${course.coverImage}")`; }
    fragment.querySelector(".card-meta").textContent = `${course.creator} · ${statusLabelMap[course.status] || course.status}`;
    fragment.querySelector(".card-title").textContent = course.title;
    fragment.querySelector(".card-progress").textContent = course.progress || "还没有记录进度。";
    fragment.querySelector(".status-badge").textContent = statusLabelMap[course.status] || course.status;
    const courseLink = fragment.querySelector(".card-link");
    if (course.url) courseLink.href = course.url;
    else { courseLink.removeAttribute("target"); fragment.querySelector(".open-label").textContent = "待补链接"; }
    fragment.querySelector(".card-delete").addEventListener("click", async () => {
      if (!window.confirm(`删除“${course.title}”？课程文件会移入 Obsidian 的可恢复备份。`)) return;
      try { await deleteCourse(course); renderCourses(); }
      catch (error) { window.alert(error.message); }
    });
    fragment.querySelector(".card-edit").addEventListener("click", () => openEditDialog(course));
    card.dataset.courseId = course.id;
    enableCardDragging(card, course);
    elements.list.append(fragment);
  });
}
function resetFilters() {
  elements.searchInput.value = ""; elements.platformFilter.value = "all"; elements.statusFilter.value = "all"; elements.priorityFilter.value = "all"; setQuickFilter("all");
}
async function handleFormSubmit(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const data = new FormData(elements.form);
  const course = { id: crypto.randomUUID(), title: String(data.get("title")).trim(), platform: String(data.get("platform")).trim(), creator: String(data.get("creator")).trim(), url: String(data.get("url")).trim(), status: String(data.get("status")), priority: String(data.get("priority")), progress: String(data.get("progress")).trim(), tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean), cover: "auto" };
  try { await createCourse(course); elements.form.reset(); elements.addDialog.close(); renderCourses(); }
  catch (error) { window.alert(error.message); }
}
function openEditDialog(course) {
  editingCourseId = course.id;
  const fields = elements.editForm.elements;
  fields.title.value = course.title;
  fields.platform.value = course.platform;
  fields.creator.value = course.creator;
  fields.url.value = course.url;
  fields.status.value = course.status;
  fields.priority.value = course.priority;
  fields.cover.value = course.cover || "auto";
  fields.progress.value = course.progress || "";
  fields.tags.value = (course.tags || []).join(", ");
  elements.editCoverFile.value = "";
  pendingCoverImage = isCustomCoverImage(course.coverImage) ? course.coverImage : null;
  updateCoverPreview();
  elements.editDialog.showModal();
}
function updateCoverPreview() {
  const preview = elements.editCoverPreview;
  preview.className = "cover-preview";
  preview.style.backgroundImage = "";
  if (pendingCoverImage) {
    preview.classList.add("has-image");
    preview.style.backgroundImage = `url("${pendingCoverImage}")`;
    preview.querySelector("span").textContent = "本地图片";
    return;
  }
  preview.classList.add(`cover-theme-${elements.editForm.elements.cover.value}`);
  preview.querySelector("span").textContent = elements.editForm.elements.cover.value === "auto" ? "自动封面" : "配色封面";
}
async function prepareCoverImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  if (file.size > 12 * 1024 * 1024) throw new Error("图片请控制在 12MB 以内。");
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = sourceUrl; });
    const scale = Math.min(1, 1200 / image.naturalWidth, 1500 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(sourceUrl); }
}
async function handleEditFormSubmit(event) {
  event.preventDefault();
  if (!elements.editForm.reportValidity() || !editingCourseId) return;
  const course = courses.find((item) => item.id === editingCourseId);
  if (!course) return;
  const data = new FormData(elements.editForm);
  Object.assign(course, {
    title: String(data.get("title")).trim(), platform: String(data.get("platform")).trim(), creator: String(data.get("creator")).trim(), url: String(data.get("url")).trim(),
    status: String(data.get("status")), priority: String(data.get("priority")), cover: String(data.get("cover")), progress: String(data.get("progress")).trim(),
    tags: String(data.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean), coverImage: pendingCoverImage,
  });
  try { await updateCourse(course); elements.editDialog.close(); editingCourseId = null; renderCourses(); }
  catch (error) { window.alert(error.message); }
}
function exportCourses() {
  const blob = new Blob([JSON.stringify(courses, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "learning-hub-data.json"; link.click(); URL.revokeObjectURL(url);
}

elements.searchInput.addEventListener("input", renderCourses);
[elements.platformFilter, elements.statusFilter, elements.priorityFilter].forEach((input) => input.addEventListener("change", renderCourses));
elements.resetFilters.addEventListener("click", resetFilters);
elements.exportButton.addEventListener("click", exportCourses);
elements.openAddDialog.addEventListener("click", () => elements.addDialog.showModal());
async function openNewExplorationDialog() { editingExploration = null; elements.explorationForm.reset(); elements.explorationDialogTitle.textContent = "先收下，再决定。"; elements.explorationSubmitButton.textContent = "快速收下"; await loadExplorations(); renderExplorations(); elements.explorationDialog.showModal(); }
elements.openExplorationDialog.addEventListener("click", openNewExplorationDialog);
elements.openExplorationList.addEventListener("click", openNewExplorationDialog);
elements.resetExplorationSource.addEventListener("click", () => { activeExplorationSourceId = null; renderExplorations(); });
elements.closeExplorationDialog.addEventListener("click", () => elements.explorationDialog.close());
function openNewSourceDialog() { editingSource = null; elements.sourceForm.reset(); elements.sourceDialogTitle.textContent = "关注一个来源"; elements.sourceSubmitButton.textContent = "加入订阅源"; elements.sourceDialog.showModal(); }
elements.openSourceDialog.addEventListener("click", openNewSourceDialog);
elements.openSourceList.addEventListener("click", openNewSourceDialog);
elements.closeSourceDialog.addEventListener("click", () => elements.sourceDialog.close());
elements.statFilters.forEach((button) => button.addEventListener("click", () => setQuickFilter(button.dataset.statFilter)));
elements.closeAddDialog.addEventListener("click", () => elements.addDialog.close());
elements.cancelAddDialog.addEventListener("click", () => elements.addDialog.close());
elements.closeFilterDialog.addEventListener("click", () => elements.filterDialog.close());
elements.closeEditDialog.addEventListener("click", () => elements.editDialog.close());
elements.cancelEditDialog.addEventListener("click", () => elements.editDialog.close());
elements.editForm.elements.cover.addEventListener("change", updateCoverPreview);
elements.editCoverFile.addEventListener("change", async () => {
  try { pendingCoverImage = await prepareCoverImage(elements.editCoverFile.files[0]); updateCoverPreview(); }
  catch (error) { window.alert(error.message || "图片处理失败，请换一张图片再试。"); elements.editCoverFile.value = ""; }
});
elements.removeCoverImage.addEventListener("click", () => { pendingCoverImage = null; elements.editCoverFile.value = ""; updateCoverPreview(); });
elements.filterDialog.addEventListener("close", renderCourses);
elements.form.addEventListener("submit", handleFormSubmit);
elements.editForm.addEventListener("submit", handleEditFormSubmit);
elements.explorationForm.addEventListener("submit", handleExplorationSubmit);
elements.explorationForm.elements.url.addEventListener("paste", (event) => setTimeout(() => fillExplorationFromDroppedText(event.clipboardData?.getData("text/plain") || elements.explorationForm.elements.url.value), 0));
elements.explorationDialog.addEventListener("dragover", (event) => event.preventDefault());
elements.explorationDialog.addEventListener("drop", (event) => { event.preventDefault(); fillExplorationFromDroppedText(event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text/html")); });
elements.sourceForm.addEventListener("submit", handleSourceSubmit);
initializeCourses();
