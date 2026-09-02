import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 47831);
const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_VAULT_ROOT = "/Users/sam/Nutstore Files/.symlinks/坚果云/obsidian/程序员";
const VAULT_ROOT = resolve(process.env.LEARNING_VAULT_ROOT || DEFAULT_VAULT_ROOT);
const LEARNING_ROOT = join(VAULT_ROOT, "Learning");
const COURSE_DIR = join(LEARNING_ROOT, "04-课程");
const EXPLORATION_DIR = join(LEARNING_ROOT, "01-探索记录");
const SOURCE_DIR = join(LEARNING_ROOT, "02-订阅源");
const PLAN_DIR = join(LEARNING_ROOT, "00-当前计划");
const CURRENT_PLAN_FILE = join(PLAN_DIR, "current-plan.md");
const COVER_DIR = join(LEARNING_ROOT, "06-附件", "covers");
const DELETED_DIR = join(LEARNING_ROOT, "_系统索引", "backups", "deleted");
const COURSE_INDEX_FILE = join(LEARNING_ROOT, "_系统索引", "courses-index.json");
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const clients = new Set();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function fail(response, statusCode, message, details) {
  sendJson(response, statusCode, { error: message, details });
}

function assertInside(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) throw new Error("Path is outside the learning directory.");
  return normalizedTarget;
}

async function ensureDirectories() {
  await mkdir(COURSE_DIR, { recursive: true });
  await mkdir(EXPLORATION_DIR, { recursive: true });
  await mkdir(SOURCE_DIR, { recursive: true });
  await mkdir(PLAN_DIR, { recursive: true });
  await mkdir(COVER_DIR, { recursive: true });
  await mkdir(DELETED_DIR, { recursive: true });
}

function slugify(value) {
  const safe = String(value || "untitled").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return safe.slice(0, 72) || "untitled";
}

function courseSignature(course) {
  return [course.title, course.platform, course.creator, course.url].map((value) => String(value || "").trim().toLowerCase()).join("\u0000");
}

function shortId(id) {
  return String(id || crypto.randomUUID()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
}

function parseFrontmatter(source) {
  if (!source.startsWith("---\n")) return { data: {}, body: source };
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return { data: {}, body: source };
  const data = {};
  for (const line of source.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    try { data[key] = JSON.parse(rawValue); }
    catch { data[key] = rawValue; }
  }
  return { data, body: source.slice(end + 5).trim() };
}

function serializeFrontmatter(data) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`);
  return `---\n${lines.join("\n")}\n---`;
}

function courseToMarkdown(course) {
  const metadata = {
    id: course.id,
    type: "course",
    title: course.title,
    platform: course.platform,
    creator: course.creator,
    url: course.url,
    status: course.status || "library",
    priority: course.priority || "medium",
    progress: course.progress || "",
    tags: course.tags || [],
    coverAsset: course.coverAsset || null,
    coverStyle: course.cover || "auto",
    order: Number.isFinite(course.order) ? course.order : 0,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    revision: course.revision,
    archived: Boolean(course.archived),
  };
  const body = [
    `# ${course.title}`,
    "",
    "## 进度备注",
    course.progress || "",
    "",
    "## 为什么学习",
    course.reasonToLearn || "",
    "",
    "## 下一步",
    course.nextAction || "",
  ].join("\n");
  return `${serializeFrontmatter(metadata)}\n\n${body}\n`;
}

function assetUrl(relativePath) {
  return `/api/v1/assets/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function explorationToMarkdown(record) {
  const metadata = {
    id: record.id,
    type: "exploration",
    title: record.title,
    url: record.url,
    platform: record.platform,
    creator: record.creator || "",
    contentType: record.contentType || "webpage",
    captureLevel: record.captureLevel || "quick",
    engagement: record.engagement || "saved",
    progressKind: record.progressKind || "none",
    progressValue: record.progressValue || "",
    sourceId: record.sourceId || null,
    topicIds: record.topicIds || [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    archived: Boolean(record.archived),
  };
  const body = [
    `# ${record.title}`,
    "",
    "## 为什么收下",
    record.whySaved || "",
    "",
    "## 收获",
    record.takeaway || "",
    "",
    "## 疑问",
    record.question || "",
    "",
    "## 下一步",
    record.nextAction || "",
  ].join("\n");
  return `${serializeFrontmatter(metadata)}\n\n${body}\n`;
}

function normalizeExploration(metadata, body, filePath) {
  const sections = Object.fromEntries([...body.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |$)/gm)].map((match) => [match[1], match[2].trim()]));
  return {
    id: metadata.id,
    title: metadata.title || basename(filePath, ".md"),
    url: metadata.url || "",
    platform: metadata.platform || "",
    creator: metadata.creator || "",
    contentType: metadata.contentType || "webpage",
    captureLevel: metadata.captureLevel || "quick",
    engagement: metadata.engagement || "saved",
    progressKind: metadata.progressKind || "none",
    progressValue: metadata.progressValue || "",
    sourceId: metadata.sourceId || null,
    topicIds: Array.isArray(metadata.topicIds) ? metadata.topicIds : [],
    whySaved: sections["为什么收下"] || "",
    takeaway: sections["收获"] || "",
    question: sections["疑问"] || "",
    nextAction: sections["下一步"] || "",
    createdAt: metadata.createdAt || "",
    updatedAt: metadata.updatedAt || "",
    revision: Number(metadata.revision || 0),
    archived: Boolean(metadata.archived),
    filePath: relative(LEARNING_ROOT, filePath),
  };
}

async function listExplorations() {
  const entries = await readdir(EXPLORATION_DIR, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(EXPLORATION_DIR, entry.name);
    const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type === "exploration" && data.id) records.push(normalizeExploration(data, body, filePath));
  }
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function findExploration(id) {
  for (const record of await listExplorations()) {
    if (record.id !== id) continue;
    const entries = await readdir(EXPLORATION_DIR);
    for (const name of entries) {
      const filePath = join(EXPLORATION_DIR, name);
      if (extname(name) !== ".md") continue;
      const { data } = parseFrontmatter(await readFile(filePath, "utf8"));
      if (data.id === id) return { record, filePath };
    }
  }
  return null;
}

async function persistExploration(input, expectedRevision, existing) {
  if (existing && Number(expectedRevision) !== existing.record.revision) {
    const error = new Error("Exploration has been modified outside this page.");
    error.code = "REVISION_CONFLICT";
    error.record = existing.record;
    throw error;
  }
  const now = new Date().toISOString();
  const record = {
    ...existing?.record,
    ...input,
    id: existing?.record.id || input.id || crypto.randomUUID(),
    title: String(input.title || existing?.record.title || "未命名探索").trim(),
    url: String(input.url || existing?.record.url || "").trim(),
    platform: String(input.platform || existing?.record.platform || "").trim(),
    creator: String(input.creator || existing?.record.creator || "").trim(),
    captureLevel: input.captureLevel || existing?.record.captureLevel || "quick",
    engagement: input.engagement || existing?.record.engagement || "saved",
    createdAt: existing?.record.createdAt || now,
    updatedAt: now,
    revision: (existing?.record.revision || 0) + 1,
  };
  const filePath = assertInside(EXPLORATION_DIR, join(EXPLORATION_DIR, `${slugify(record.title)}--${shortId(record.id)}.md`));
  await atomicWrite(filePath, explorationToMarkdown(record));
  if (existing && existing.filePath !== filePath && existsSync(existing.filePath)) await unlink(existing.filePath);
  const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
  return normalizeExploration(data, body, filePath);
}

function sourceToMarkdown(source) {
  return `${serializeFrontmatter({ id: source.id, type: "source", title: source.title, platform: source.platform || "", url: source.url || "", relationship: source.relationship || "observing", followReason: source.followReason || "", focusTopics: source.focusTopics || [], createdAt: source.createdAt, updatedAt: source.updatedAt, revision: source.revision })}\n\n# ${source.title}\n`;
}

async function listSources() {
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true }); const sources = [];
  for (const entry of entries) { if (!entry.isFile() || extname(entry.name) !== ".md") continue; const filePath = join(SOURCE_DIR, entry.name); const { data } = parseFrontmatter(await readFile(filePath, "utf8")); if (data.type === "source" && data.id) sources.push({ ...data, filePath: relative(LEARNING_ROOT, filePath) }); }
  return sources.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function findSource(id) {
  for (const source of await listSources()) { if (source.id === id) return { source, filePath: join(LEARNING_ROOT, source.filePath) }; }
  return null;
}

async function persistSource(input, expectedRevision, existing) {
  if (existing && Number(expectedRevision) !== Number(existing.source.revision)) { const error = new Error("Source has been modified outside this page."); error.code = "REVISION_CONFLICT"; throw error; }
  const now = new Date().toISOString(); const id = input.id || crypto.randomUUID();
  const source = { ...existing?.source, ...input, id, title: String(input.title || existing?.source.title || "未命名订阅源").trim(), platform: String(input.platform || existing?.source.platform || "未标注来源").trim(), url: String(input.url || existing?.source.url || "").trim(), relationship: input.relationship || existing?.source.relationship || "observing", focusTopics: Array.isArray(input.focusTopics) ? input.focusTopics : existing?.source.focusTopics || [], createdAt: existing?.source.createdAt || now, updatedAt: now, revision: Number(existing?.source.revision || 0) + 1 };
  const filePath = assertInside(SOURCE_DIR, join(SOURCE_DIR, `${slugify(source.title)}--${shortId(id)}.md`)); await atomicWrite(filePath, sourceToMarkdown(source)); if (existing && existing.filePath !== filePath) await unlink(existing.filePath); return { ...source, filePath: relative(LEARNING_ROOT, filePath) };
}

async function readCurrentPlan() {
  if (!existsSync(CURRENT_PLAN_FILE)) return null;
  const { data, body } = parseFrontmatter(await readFile(CURRENT_PLAN_FILE, "utf8"));
  if (data.type !== "plan") return null;
  const sections = Object.fromEntries([...body.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |$)/gm)].map((match) => [match[1], match[2].trim()]));
  return { ...data, objective: sections["目标"] || data.objective || "", completionCriteria: sections["完成标准"] || data.completionCriteria || "", nextAction: sections["下一步"] || data.nextAction || "", filePath: relative(LEARNING_ROOT, CURRENT_PLAN_FILE) };
}

async function persistCurrentPlan(input, expectedRevision) {
  const existing = await readCurrentPlan();
  if (existing && Number(expectedRevision) !== Number(existing.revision)) { const error = new Error("Plan has been modified outside this page."); error.code = "REVISION_CONFLICT"; throw error; }
  const now = new Date().toISOString(); const plan = { ...existing, ...input, id: existing?.id || crypto.randomUUID(), type: "plan", status: input.status || existing?.status || "active", primaryCourseId: input.primaryCourseId || null, rhythm: input.rhythm || "", deepTutorLink: input.deepTutorLink || "", createdAt: existing?.createdAt || now, updatedAt: now, revision: Number(existing?.revision || 0) + 1 };
  const body = [`# 当前学习计划`, "", "## 目标", plan.objective || "", "", "## 完成标准", plan.completionCriteria || "", "", "## 下一步", plan.nextAction || ""].join("\n");
  await atomicWrite(CURRENT_PLAN_FILE, `${serializeFrontmatter(plan)}\n\n${body}\n`); return { ...plan, filePath: relative(LEARNING_ROOT, CURRENT_PLAN_FILE) };
}

function normalizeCourse(metadata, body, filePath) {
  const sections = Object.fromEntries([...body.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |$)/gm)].map((match) => [match[1], match[2].trim()]));
  return {
    id: metadata.id,
    title: metadata.title || basename(filePath, ".md"),
    platform: metadata.platform || "",
    creator: metadata.creator || "",
    url: metadata.url || "",
    status: metadata.status || "library",
    priority: metadata.priority || "medium",
    // The Markdown body is the user-editable source of truth for learning notes.
    progress: sections["进度备注"] || metadata.progress || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    cover: metadata.coverStyle || "auto",
    coverAsset: metadata.coverAsset || null,
    coverImage: metadata.coverAsset ? assetUrl(metadata.coverAsset) : null,
    order: Number(metadata.order || 0),
    createdAt: metadata.createdAt || "",
    updatedAt: metadata.updatedAt || "",
    revision: Number(metadata.revision || 0),
    archived: Boolean(metadata.archived),
    reasonToLearn: sections["为什么学习"] || "",
    nextAction: sections["下一步"] || "",
    filePath: relative(LEARNING_ROOT, filePath),
  };
}

async function listCourses() {
  const entries = await readdir(COURSE_DIR, { withFileTypes: true });
  const courses = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(COURSE_DIR, entry.name);
    const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type !== "course" || !data.id) continue;
    courses.push(normalizeCourse(data, body, filePath));
  }
  return courses.sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
}

async function findCourse(id) {
  const course = (await listCourses()).find((item) => item.id === id);
  if (!course) return null;
  const filePath = assertInside(COURSE_DIR, join(COURSE_DIR, `${slugify(course.title)}--${shortId(course.id)}.md`));
  if (existsSync(filePath)) return { course, filePath };
  const entries = await readdir(COURSE_DIR);
  for (const entry of entries) {
    const candidate = join(COURSE_DIR, entry);
    const { data } = parseFrontmatter(await readFile(candidate, "utf8"));
    if (data.id === id) return { course, filePath: candidate };
  }
  return null;
}

async function writeCourseIndex() {
  const courses = await listCourses();
  const index = {
    generatedAt: new Date().toISOString(),
    version: 1,
    courses: courses.map(({ id, title, platform, status, priority, order, updatedAt, filePath }) => ({
      id, title, platform, status, priority, order, updatedAt, filePath,
    })),
  };
  await atomicWrite(COURSE_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
}

function decodeCoverImage(dataUrl, id) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) throw new Error("Unsupported cover image format.");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("Cover image is too large.");
  return { bytes, relativePath: `06-附件/covers/${id}.${extension}` };
}

async function atomicWrite(filePath, text) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, text, "utf8");
  await rename(temporaryPath, filePath);
}

async function persistCourse(input, expectedRevision, existing) {
  const now = new Date().toISOString();
  if (existing && Number(expectedRevision) !== existing.course.revision) {
    const error = new Error("Course has been modified outside this page.");
    error.code = "REVISION_CONFLICT";
    error.course = existing.course;
    throw error;
  }
  const id = existing?.course.id || input.id || crypto.randomUUID();
  const cover = decodeCoverImage(input.coverImage, id);
  const hasCoverImageUpdate = Object.hasOwn(input, "coverImage");
  const retainedCoverAsset = typeof input.coverImage === "string" && input.coverImage.startsWith("/api/v1/assets/")
    ? existing?.course.coverAsset || null
    : null;
  if (cover) await writeFile(assertInside(LEARNING_ROOT, join(LEARNING_ROOT, cover.relativePath)), cover.bytes);
  const course = {
    ...existing?.course,
    ...input,
    id,
    title: String(input.title || existing?.course.title || "未命名课程").trim(),
    platform: String(input.platform || existing?.course.platform || "").trim(),
    creator: String(input.creator || existing?.course.creator || "").trim(),
    url: String(input.url || existing?.course.url || "").trim(),
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.course.tags || [],
    // A null coverImage deliberately unlinks the cover; the file stays as a recoverable orphan.
    coverAsset: cover?.relativePath || retainedCoverAsset || (hasCoverImageUpdate ? null : existing?.course.coverAsset || null),
    coverImage: undefined,
    createdAt: existing?.course.createdAt || now,
    updatedAt: now,
    revision: (existing?.course.revision || 0) + 1,
  };
  const fileName = `${slugify(course.title)}--${shortId(course.id)}.md`;
  const nextPath = assertInside(COURSE_DIR, join(COURSE_DIR, fileName));
  await atomicWrite(nextPath, courseToMarkdown(course));
  if (existing && existing.filePath !== nextPath && existsSync(existing.filePath)) await unlink(existing.filePath);
  return normalizeCourse(parseFrontmatter(await readFile(nextPath, "utf8")).data, parseFrontmatter(await readFile(nextPath, "utf8")).body, nextPath);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function broadcast(event, payload = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(message);
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/v1/health") return sendJson(response, 200, { ok: true, vaultRoot: VAULT_ROOT, learningRoot: LEARNING_ROOT });
  if (request.method === "GET" && pathname === "/api/v1/courses") return sendJson(response, 200, { courses: await listCourses() });
  if (request.method === "GET" && pathname === "/api/v1/explorations") return sendJson(response, 200, { explorations: await listExplorations() });
  if (request.method === "GET" && pathname === "/api/v1/sources") return sendJson(response, 200, { sources: await listSources() });
  if (request.method === "GET" && pathname === "/api/v1/plan") return sendJson(response, 200, { plan: await readCurrentPlan() });
  if (request.method === "POST" && pathname === "/api/v1/open-wechat") {
    execFile("open", ["-a", "WeChat"], (error) => {
      if (error) console.error("Unable to open WeChat:", error.message);
    });
    return sendJson(response, 200, { opened: true });
  }
  if (request.method === "GET" && pathname === "/api/v1/events") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    response.write("event: ready\ndata: {}\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/courses") {
    const body = await readJson(request);
    const course = await persistCourse(body.course || body, undefined, null);
    await writeCourseIndex();
    broadcast("course-changed", { id: course.id });
    return sendJson(response, 201, { course });
  }
  if (request.method === "POST" && pathname === "/api/v1/explorations") {
    const body = await readJson(request);
    const exploration = await persistExploration(body.exploration || body, undefined, null);
    broadcast("explorations-changed", { id: exploration.id });
    return sendJson(response, 201, { exploration });
  }
  if (request.method === "POST" && pathname === "/api/v1/sources") {
    const body = await readJson(request); const source = await persistSource(body.source || body);
    broadcast("sources-changed", { id: source.id }); return sendJson(response, 201, { source });
  }
  if (request.method === "PUT" && pathname === "/api/v1/plan") { const body = await readJson(request); const plan = await persistCurrentPlan(body.plan || body, body.revision); broadcast("plan-changed", { id: plan.id }); return sendJson(response, 200, { plan }); }
  const sourceMatch = pathname.match(/^\/api\/v1\/sources\/([^/]+)$/);
  if (sourceMatch) { const id = decodeURIComponent(sourceMatch[1]); const existing = await findSource(id); if (!existing) return fail(response, 404, "Source not found."); if (request.method === "PATCH") { const body = await readJson(request); const source = await persistSource(body.source || body, body.revision, existing); broadcast("sources-changed", { id }); return sendJson(response, 200, { source }); } if (request.method === "DELETE") { await rename(existing.filePath, join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`)); broadcast("sources-changed", { id }); return sendJson(response, 200, { deleted: id }); } }
  const courseMatch = pathname.match(/^\/api\/v1\/courses\/([^/]+)$/);
  if (courseMatch) {
    const id = decodeURIComponent(courseMatch[1]);
    const existing = await findCourse(id);
    if (!existing) return fail(response, 404, "Course not found.");
    if (request.method === "GET") return sendJson(response, 200, { course: existing.course });
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const course = await persistCourse(body.course || body, body.revision, existing);
      await writeCourseIndex();
      broadcast("course-changed", { id: course.id });
      return sendJson(response, 200, { course });
    }
    if (request.method === "DELETE") {
      const deletedPath = join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`);
      await rename(existing.filePath, deletedPath);
      await writeCourseIndex();
      broadcast("course-deleted", { id });
      return sendJson(response, 200, { deleted: id });
    }
  }
  const explorationMatch = pathname.match(/^\/api\/v1\/explorations\/([^/]+)$/);
  if (explorationMatch) {
    const id = decodeURIComponent(explorationMatch[1]);
    const existing = await findExploration(id);
    if (!existing) return fail(response, 404, "Exploration not found.");
    if (request.method === "GET") return sendJson(response, 200, { exploration: existing.record });
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const exploration = await persistExploration(body.exploration || body, body.revision, existing);
      broadcast("explorations-changed", { id: exploration.id });
      return sendJson(response, 200, { exploration });
    }
    if (request.method === "DELETE") {
      const deletedPath = join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`);
      await rename(existing.filePath, deletedPath);
      broadcast("explorations-changed", { id });
      return sendJson(response, 200, { deleted: id });
    }
  }
  if (request.method === "POST" && pathname === "/api/v1/courses/reorder") {
    const { courseIds } = await readJson(request);
    if (!Array.isArray(courseIds)) return fail(response, 400, "courseIds must be an array.");
    const byId = new Map((await listCourses()).map((course) => [course.id, course]));
    for (const [order, id] of courseIds.entries()) {
      const existing = await findCourse(id);
      if (!existing) continue;
      await persistCourse({ ...existing.course, order }, existing.course.revision, existing);
      byId.delete(id);
    }
    await writeCourseIndex();
    broadcast("courses-reordered");
    return sendJson(response, 200, { courses: await listCourses() });
  }
  if (request.method === "POST" && pathname === "/api/v1/migration/courses") {
    const { courses = [] } = await readJson(request);
    if (!Array.isArray(courses)) return fail(response, 400, "courses must be an array.");
    const existingCourses = await listCourses();
    const existingIds = new Set(existingCourses.map((course) => course.id));
    const existingSignatures = new Set(existingCourses.map(courseSignature));
    const migrated = [];
    for (const [order, legacyCourse] of courses.entries()) {
      if ((legacyCourse.id && existingIds.has(legacyCourse.id)) || existingSignatures.has(courseSignature(legacyCourse))) continue;
      const course = await persistCourse({ ...legacyCourse, order, status: legacyCourse.status || "library" }, undefined, null);
      migrated.push(course);
      existingIds.add(course.id);
      existingSignatures.add(courseSignature(course));
    }
    await writeCourseIndex();
    broadcast("migration-complete", { count: migrated.length });
    return sendJson(response, 200, { migrated, skipped: courses.length - migrated.length });
  }
  if (request.method === "GET" && pathname.startsWith("/api/v1/assets/")) {
    const relativePath = pathname.slice("/api/v1/assets/".length).split("/").map(decodeURIComponent).join("/");
    const assetPath = assertInside(join(LEARNING_ROOT, "06-附件"), join(LEARNING_ROOT, relativePath));
    if (!existsSync(assetPath)) return fail(response, 404, "Asset not found.");
    response.writeHead(200, { "content-type": contentTypes[extname(assetPath).toLowerCase()] || "application/octet-stream", "cache-control": "private, max-age=86400" });
    createReadStream(assetPath).pipe(response);
    return;
  }
  return fail(response, 404, "API route not found.");
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = assertInside(APP_ROOT, join(APP_ROOT, normalize(requested)));
  if (!existsSync(filePath) || (await stat(filePath)).isDirectory()) return false;
  response.writeHead(200, { "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(filePath).pipe(response);
  return true;
}

await ensureDirectories();
function watchVaultDirectory(directory, eventName) {
  let timer = null;
  watch(directory, { persistent: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => broadcast(eventName), 250);
  });
}

watchVaultDirectory(COURSE_DIR, "vault-changed");
watchVaultDirectory(EXPLORATION_DIR, "explorations-changed");

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host || "";
    if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) return fail(response, 403, "Loopback requests only.");
    const url = new URL(request.url || "/", `http://${host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url.pathname);
    if (request.method !== "GET" && request.method !== "HEAD") return fail(response, 405, "Method not allowed.");
    if (await serveStatic(response, decodeURIComponent(url.pathname))) return;
    fail(response, 404, "Not found.");
  } catch (error) {
    if (error.code === "REVISION_CONFLICT") return sendJson(response, 409, { error: error.message, course: error.course });
    console.error(error);
    fail(response, 500, error.message || "Internal server error.");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Learning Cockpit is running at http://127.0.0.1:${PORT}`);
  console.log(`Vault: ${VAULT_ROOT}`);
});
