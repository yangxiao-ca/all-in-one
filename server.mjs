import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ *
 * 配置：全部走环境变量，本地与服务器共用同一份代码
 * ------------------------------------------------------------------ */

const env = process.env;
const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(env.PORT || 47831);
// 默认只监听回环；放在反向代理后面时保持 127.0.0.1 即可。
const HOST = env.HOST || "127.0.0.1";
// 数据默认跟随项目目录，git 全程跟踪；如需外接 Obsidian 库，用 LEARNING_VAULT_ROOT 环境变量覆盖。
const LEARNING_ROOT = resolve(env.LEARNING_VAULT_ROOT || join(APP_ROOT, "Learning"));
const COURSE_DIR = join(LEARNING_ROOT, "04-课程");
const EXPLORATION_DIR = join(LEARNING_ROOT, "01-探索记录");
const SOURCE_DIR = join(LEARNING_ROOT, "02-订阅源");
const PLAN_DIR = join(LEARNING_ROOT, "00-当前计划");
const CURRENT_PLAN_FILE = join(PLAN_DIR, "current-plan.md");
const COVER_DIR = join(LEARNING_ROOT, "06-附件", "covers");
const DELETED_DIR = join(LEARNING_ROOT, "_系统索引", "backups", "deleted");
const COURSE_INDEX_FILE = join(LEARNING_ROOT, "_系统索引", "courses-index.json");
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const WRITE_LIMIT_PER_MINUTE = Number(env.WRITE_LIMIT_PER_MINUTE || 120);
const WECHAT_OPEN_COMMAND = env.WECHAT_OPEN_COMMAND || "";

// 反向代理会把真实域名透传成 Host，这里显式放行。
const EXTRA_ALLOWED_HOSTS = String(env.ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
// 由受信反向代理转发时，才采信 X-Forwarded-* 头。
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(env.TRUST_PROXY || ""));
// 只读模式：把线上站点当纯浏览端，禁止任何写操作（防止手机误改）。
const READ_ONLY = /^(1|true|yes|on)$/i.test(String(env.READ_ONLY || ""));

const clients = new Set();
const writeBuckets = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

// 静态资源扩展名白名单：没在名单里的文件一律不对外提供。
const SERVABLE_EXTENSIONS = new Set(Object.keys(contentTypes));
// 明确禁止外泄的文件名（即使扩展名在白名单内）。
const BLOCKED_FILENAMES = new Set(["package.json", "package-lock.json", "server.mjs", "manifest.json"]);
// 禁止对外暴露的顶层目录（源码、部署脚本、扩展源码等）
const BLOCKED_TOP_DIRS = new Set(["extension", "deploy", "scripts", "node_modules", "docs", ".git"]);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  // 个人学习库不希望被搜索引擎收录
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; "),
};

/* ------------------------------------------------------------------ *
 * 日志
 * ------------------------------------------------------------------ */

function log(level, message, extra) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (extra === undefined) console[level === "error" ? "error" : "log"](line);
  else console[level === "error" ? "error" : "log"](line, extra);
}

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

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
  // 用 sep 收口，避免 /root-evil 被误判为 /root 的子路径
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)) {
    const error = new Error("Path is outside the learning directory.");
    error.code = "PATH_OUTSIDE_ROOT";
    throw error;
  }
  return normalizedTarget;
}

async function ensureDirectories() {
  if (!existsSync(LEARNING_ROOT)) {
    log("error", `学习数据目录不存在：${LEARNING_ROOT}`);
    log("error", "请检查 Learning 目录是否存在，或通过 LEARNING_VAULT_ROOT 环境变量指定。");
    process.exit(1);
  }
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
  return String(id || randomUUID()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
}

async function atomicWrite(filePath, text) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, text, "utf8");
  await rename(temporaryPath, filePath);
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

function sectionsOf(body) {
  return Object.fromEntries([...body.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |$)/gm)].map((match) => [match[1], match[2].trim()]));
}

/* ------------------------------------------------------------------ *
 * 课程
 * ------------------------------------------------------------------ */

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

function normalizeCourse(metadata, body, filePath) {
  const sections = sectionsOf(body);
  return {
    id: metadata.id,
    title: metadata.title || basename(filePath, ".md"),
    platform: metadata.platform || "",
    creator: metadata.creator || "",
    url: metadata.url || "",
    status: metadata.status || "library",
    priority: metadata.priority || "medium",
    // Markdown 正文才是学习笔记的唯一可信来源
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
  if (!existsSync(COURSE_DIR)) return [];
  const entries = await readdir(COURSE_DIR, { withFileTypes: true });
  const courses = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(COURSE_DIR, entry.name);
    const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type !== "course" || !data.id) continue;
    courses.push(normalizeCourse(data, body, filePath));
  }
  return courses.sort((left, right) => left.order - right.order || String(left.createdAt).localeCompare(String(right.createdAt)));
}

async function findCourse(id) {
  const course = (await listCourses()).find((item) => item.id === id);
  if (!course) return null;
  const preferred = assertInside(COURSE_DIR, join(COURSE_DIR, `${slugify(course.title)}--${shortId(course.id)}.md`));
  if (existsSync(preferred)) return { course, filePath: preferred };
  // 文件名可能被 Obsidian 或人工改过，回退到按 frontmatter 里的 id 全量匹配
  for (const entry of await readdir(COURSE_DIR)) {
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

async function persistCourse(input, expectedRevision, existing) {
  const now = new Date().toISOString();
  if (existing && Number(expectedRevision) !== existing.course.revision) {
    const error = new Error("Course has been modified outside this page.");
    error.code = "REVISION_CONFLICT";
    error.course = existing.course;
    throw error;
  }
  const id = existing?.course.id || input.id || randomUUID();
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
    // coverImage 显式为 null 表示解除封面绑定，图片文件保留为可恢复的孤儿文件
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
  const written = await readFile(nextPath, "utf8");
  const { data, body } = parseFrontmatter(written);
  return normalizeCourse(data, body, nextPath);
}

/* ------------------------------------------------------------------ *
 * 探索池
 * ------------------------------------------------------------------ */

function explorationToMarkdown(record) {
  const metadata = {
    id: record.id,
    type: "exploration",
    title: record.title,
    url: record.url,
    platform: record.platform,
    previewImage: record.previewImage || "",
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
  const sections = sectionsOf(body);
  return {
    id: metadata.id,
    title: metadata.title || basename(filePath, ".md"),
    url: metadata.url || "",
    platform: metadata.platform || "",
    previewImage: metadata.previewImage || "",
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
  if (!existsSync(EXPLORATION_DIR)) return [];
  const entries = await readdir(EXPLORATION_DIR, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(EXPLORATION_DIR, entry.name);
    const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type === "exploration" && data.id) records.push(normalizeExploration(data, body, filePath));
  }
  return records.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function findExploration(id) {
  for (const entry of await readdir(EXPLORATION_DIR)) {
    if (extname(entry.name) !== ".md") continue;
    const filePath = join(EXPLORATION_DIR, entry.name);
    const { data, body } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type === "exploration" && data.id === id) return { record: normalizeExploration(data, body, filePath), filePath };
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
    id: existing?.record.id || input.id || randomUUID(),
    title: String(input.title || existing?.record.title || "未命名探索").trim(),
    url: String(input.url || existing?.record.url || "").trim(),
    platform: String(input.platform ?? existing?.record.platform ?? "").trim(),
    creator: String(input.creator ?? existing?.record.creator ?? "").trim(),
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

/* ------------------------------------------------------------------ *
 * 订阅源
 * ------------------------------------------------------------------ */

function sourceToMarkdown(source) {
  return `${serializeFrontmatter({ id: source.id, type: "source", title: source.title, platform: source.platform || "", url: source.url || "", relationship: source.relationship || "observing", followReason: source.followReason || "", focusTopics: source.focusTopics || [], createdAt: source.createdAt, updatedAt: source.updatedAt, revision: source.revision })}\n\n# ${source.title}\n`;
}

async function listSources() {
  if (!existsSync(SOURCE_DIR)) return [];
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(SOURCE_DIR, entry.name);
    const { data } = parseFrontmatter(await readFile(filePath, "utf8"));
    if (data.type === "source" && data.id) sources.push({ ...data, filePath: relative(LEARNING_ROOT, filePath) });
  }
  return sources.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function findSource(id) {
  for (const source of await listSources()) {
    if (source.id === id) return { source, filePath: join(LEARNING_ROOT, source.filePath) };
  }
  return null;
}

async function persistSource(input, expectedRevision, existing) {
  if (existing && Number(expectedRevision) !== Number(existing.source.revision)) {
    const error = new Error("Source has been modified outside this page.");
    error.code = "REVISION_CONFLICT";
    throw error;
  }
  const now = new Date().toISOString();
  const id = input.id || existing?.source.id || randomUUID();
  const source = {
    ...existing?.source,
    ...input,
    id,
    title: String(input.title || existing?.source.title || "未命名订阅源").trim(),
    platform: String(input.platform ?? existing?.source.platform ?? "未标注来源").trim() || "未标注来源",
    url: String(input.url ?? existing?.source.url ?? "").trim(),
    relationship: input.relationship || existing?.source.relationship || "observing",
    focusTopics: Array.isArray(input.focusTopics) ? input.focusTopics : existing?.source.focusTopics || [],
    createdAt: existing?.source.createdAt || now,
    updatedAt: now,
    revision: Number(existing?.source.revision || 0) + 1,
  };
  const filePath = assertInside(SOURCE_DIR, join(SOURCE_DIR, `${slugify(source.title)}--${shortId(id)}.md`));
  await atomicWrite(filePath, sourceToMarkdown(source));
  if (existing && existing.filePath !== filePath && existsSync(existing.filePath)) await unlink(existing.filePath);
  return { ...source, filePath: relative(LEARNING_ROOT, filePath) };
}

/* ------------------------------------------------------------------ *
 * 当前计划
 * ------------------------------------------------------------------ */

async function readCurrentPlan() {
  if (!existsSync(CURRENT_PLAN_FILE)) return null;
  const { data, body } = parseFrontmatter(await readFile(CURRENT_PLAN_FILE, "utf8"));
  if (data.type !== "plan") return null;
  const sections = sectionsOf(body);
  return {
    ...data,
    objective: sections["目标"] || data.objective || "",
    completionCriteria: sections["完成标准"] || data.completionCriteria || "",
    nextAction: sections["下一步"] || data.nextAction || "",
    filePath: relative(LEARNING_ROOT, CURRENT_PLAN_FILE),
  };
}

async function persistCurrentPlan(input, expectedRevision) {
  const existing = await readCurrentPlan();
  if (existing && Number(expectedRevision) !== Number(existing.revision)) {
    const error = new Error("Plan has been modified outside this page.");
    error.code = "REVISION_CONFLICT";
    throw error;
  }
  const now = new Date().toISOString();
  const plan = {
    ...existing,
    ...input,
    id: existing?.id || randomUUID(),
    type: "plan",
    status: input.status || existing?.status || "active",
    primaryCourseId: input.primaryCourseId || null,
    rhythm: input.rhythm || "",
    deepTutorLink: input.deepTutorLink || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: Number(existing?.revision || 0) + 1,
  };
  const body = [
    "# 当前学习计划",
    "",
    "## 目标",
    plan.objective || "",
    "",
    "## 完成标准",
    plan.completionCriteria || "",
    "",
    "## 下一步",
    plan.nextAction || "",
  ].join("\n");
  await atomicWrite(CURRENT_PLAN_FILE, `${serializeFrontmatter(plan)}\n\n${body}\n`);
  return { ...plan, filePath: relative(LEARNING_ROOT, CURRENT_PLAN_FILE) };
}

/* ------------------------------------------------------------------ *
 * HTTP 辅助
 * ------------------------------------------------------------------ */

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body is not valid JSON.");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function clientKey(request) {
  if (TRUST_PROXY) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "unknown";
}

// 写接口限流：单用户场景下只是防脚本误刷，阈值给得宽松
function writeAllowed(request) {
  const key = clientKey(request);
  const now = Date.now();
  const bucket = writeBuckets.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  writeBuckets.set(key, bucket);
  if (writeBuckets.size > 500) {
    for (const [entryKey, entry] of writeBuckets) if (now > entry.resetAt) writeBuckets.delete(entryKey);
  }
  return bucket.count <= WRITE_LIMIT_PER_MINUTE;
}

function hostAllowed(request) {
  const raw = TRUST_PROXY
    ? String(request.headers["x-forwarded-host"] || request.headers.host || "")
    : String(request.headers.host || "");
  const host = raw.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
  return EXTRA_ALLOWED_HOSTS.includes(host);
}

function broadcast(event, payload = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(message);
}

/* ------------------------------------------------------------------ *
 * API 路由
 * ------------------------------------------------------------------ */

async function handleApi(request, response, pathname) {
  const isWrite = request.method !== "GET" && request.method !== "HEAD";
  if (isWrite && !writeAllowed(request)) return fail(response, 429, "操作过于频繁，请稍后再试。");
  if (isWrite && READ_ONLY) return fail(response, 403, "当前站点为只读模式，写操作已禁用。");

  if (request.method === "GET" && pathname === "/api/v1/health") {
    return sendJson(response, 200, {
      ok: true,
      version: BUILD_VERSION,
      learningRoot: LEARNING_ROOT,
      readOnly: READ_ONLY,
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round((Date.now() - new Date(STARTED_AT).getTime()) / 1000),
    });
  }
  if (request.method === "GET" && pathname === "/api/v1/version") {
    return sendJson(response, 200, { version: BUILD_VERSION, commit: BUILD_COMMIT, buildTime: BUILD_TIME, startedAt: STARTED_AT });
  }
  if (request.method === "GET" && pathname === "/api/v1/courses") return sendJson(response, 200, { courses: await listCourses() });
  if (request.method === "GET" && pathname === "/api/v1/explorations") return sendJson(response, 200, { explorations: await listExplorations() });
  if (request.method === "GET" && pathname === "/api/v1/sources") return sendJson(response, 200, { sources: await listSources() });
  if (request.method === "GET" && pathname === "/api/v1/plan") return sendJson(response, 200, { plan: await readCurrentPlan() });

  if (request.method === "POST" && pathname === "/api/v1/open-wechat") {
    // 只有 macOS 才有微信客户端；服务器上明确返回不支持，而不是静默失败
    if (WECHAT_OPEN_COMMAND) {
      const [command, ...args] = WECHAT_OPEN_COMMAND.split(" ").filter(Boolean);
      execFile(command, args, (error) => { if (error) log("error", `打开微信失败：${error.message}`); });
      return sendJson(response, 200, { opened: true });
    }
    if (process.platform !== "darwin") return fail(response, 501, "打开微信仅在 macOS 本机可用。");
    execFile("open", ["-a", "WeChat"], (error) => { if (error) log("error", `打开微信失败：${error.message}`); });
    return sendJson(response, 200, { opened: true });
  }

  if (request.method === "GET" && pathname === "/api/v1/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // 告诉 Nginx 之类的反代不要缓冲
      "x-accel-buffering": "no",
    });
    response.write("event: ready\ndata: {}\n\n");
    response.write(": connected\n\n");
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
    const body = await readJson(request);
    const source = await persistSource(body.source || body, undefined, null);
    broadcast("sources-changed", { id: source.id });
    return sendJson(response, 201, { source });
  }
  if (request.method === "PUT" && pathname === "/api/v1/plan") {
    const body = await readJson(request);
    const plan = await persistCurrentPlan(body.plan || body, body.revision);
    broadcast("plan-changed", { id: plan.id });
    return sendJson(response, 200, { plan });
  }

  const sourceMatch = pathname.match(/^\/api\/v1\/sources\/([^/]+)$/);
  if (sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1]);
    const existing = await findSource(id);
    if (!existing) return fail(response, 404, "Source not found.");
    if (request.method === "DELETE") {
      await rename(existing.filePath, join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`));
      broadcast("sources-changed", { id });
      return sendJson(response, 200, { deleted: id });
    }
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const source = await persistSource(body.source || body, body.revision, existing);
      broadcast("sources-changed", { id });
      return sendJson(response, 200, { source });
    }
  }

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
      await rename(existing.filePath, join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`));
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
      await rename(existing.filePath, join(DELETED_DIR, `${basename(existing.filePath, ".md")}--${Date.now()}.md`));
      broadcast("explorations-changed", { id });
      return sendJson(response, 200, { deleted: id });
    }
  }

  if (request.method === "POST" && pathname === "/api/v1/courses/reorder") {
    const { courseIds } = await readJson(request);
    if (!Array.isArray(courseIds)) return fail(response, 400, "courseIds must be an array.");
    for (const [order, id] of courseIds.entries()) {
      const existing = await findCourse(id);
      if (!existing) continue;
      await persistCourse({ ...existing.course, order }, existing.course.revision, existing);
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
    response.writeHead(200, {
      "content-type": contentTypes[extname(assetPath).toLowerCase()] || "application/octet-stream",
      "cache-control": "private, max-age=86400",
      ...SECURITY_HEADERS,
    });
    createReadStream(assetPath).pipe(response);
    return;
  }

  return fail(response, 404, "API route not found.");
}

/* ------------------------------------------------------------------ *
 * 静态资源
 * ------------------------------------------------------------------ */

function isServableFile(filePath) {
  const relativePath = relative(APP_ROOT, filePath);
  if (!relativePath || relativePath.startsWith("..")) return false;
  const segments = relativePath.split(sep);
  // 任一层级出现点文件（.env、.DS_Store、.git 等）一律不提供
  if (segments.some((segment) => segment.startsWith("."))) return false;
  if (BLOCKED_TOP_DIRS.has(segments[0])) return false;
  if (BLOCKED_FILENAMES.has(basename(filePath))) return false;
  return SERVABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let filePath;
  try {
    filePath = assertInside(APP_ROOT, join(APP_ROOT, normalize(requested)));
  } catch {
    return false;
  }
  if (!isServableFile(filePath)) return false;
  if (!existsSync(filePath)) return false;
  const info = await stat(filePath);
  if (info.isDirectory()) return false;

  // ETag 让手机端可以 304 复用，省流量也更快
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const headers = {
    "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "cache-control": basename(filePath) === "sw.js" ? "no-cache" : "no-cache, must-revalidate",
    etag,
    ...SECURITY_HEADERS,
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  response.writeHead(200, headers);
  if (request.method === "HEAD") { response.end(); return true; }
  createReadStream(filePath).pipe(response);
  return true;
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

const BUILD_VERSION = env.APP_VERSION || "0.2.0";
const BUILD_COMMIT = env.APP_COMMIT || "unknown";
const BUILD_TIME = env.APP_BUILD_TIME || "";
const STARTED_AT = new Date().toISOString();

await ensureDirectories();

function watchVaultDirectory(directory, eventName) {
  let timer = null;
  try {
    watch(directory, { persistent: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => broadcast(eventName), 250);
    });
  } catch (error) {
    // Syncthing／网络盘上的目录监听可能不可用，退化成不推送事件，不影响读写
    log("error", `无法监听目录 ${directory}：${error.message}`);
  }
}

watchVaultDirectory(COURSE_DIR, "vault-changed");
watchVaultDirectory(EXPLORATION_DIR, "explorations-changed");

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  try {
    if (!hostAllowed(request)) return fail(response, 403, "Host not allowed.");
    const host = request.headers.host || "127.0.0.1";
    const url = new URL(request.url || "/", `http://${host}`);

    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url.pathname);
    if (request.method !== "GET" && request.method !== "HEAD") return fail(response, 405, "Method not allowed.");
    if (await serveStatic(request, response, decodeURIComponent(url.pathname))) return;
    fail(response, 404, "Not found.");
  } catch (error) {
    if (error.code === "REVISION_CONFLICT") return sendJson(response, 409, { error: error.message, course: error.course, record: error.record });
    if (error.code === "PATH_OUTSIDE_ROOT") return fail(response, 404, "Not found.");
    if (error.code === "BODY_TOO_LARGE") return fail(response, 413, error.message);
    if (error.code === "INVALID_JSON") return fail(response, 400, error.message);
    log("error", `${request.method} ${request.url} 处理失败：${error.message}`);
    if (error.stack) log("error", error.stack.split("\n").slice(1, 4).join("\n"));
    fail(response, 500, error.message || "Internal server error.");
  } finally {
    if (env.ACCESS_LOG === "1") {
      log("log", `${request.method} ${request.url} -> ${response.statusCode} ${Date.now() - startedAt}ms`);
    }
  }
});

// SSE 心跳：反向代理通常 60s 空闲就断链，定期发注释行保活
const heartbeat = setInterval(() => {
  for (const client of clients) {
    try { client.write(`: ping ${Date.now()}\n\n`); }
    catch { clients.delete(client); }
  }
}, 25_000);
heartbeat.unref();

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    log("error", `端口 ${PORT} 已被占用。可能已有一个学习架实例在运行，或端口被其他程序占用。`);
    log("error", "可用 PORT=其他端口 重新启动。");
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  log("log", `学习架已启动：http://${HOST}:${PORT}`);
  log("log", `学习数据：${LEARNING_ROOT}`);
  log("log", `允许的 Host：127.0.0.1 / localhost${EXTRA_ALLOWED_HOSTS.length ? ` / ${EXTRA_ALLOWED_HOSTS.join(" / ")}` : ""}`);
  if (READ_ONLY) log("log", "只读模式已开启，所有写操作会被拒绝。");
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("log", `收到 ${signal}，正在关闭……`);
  clearInterval(heartbeat);
  for (const client of clients) { try { client.end(); } catch { /* 已断开 */ } }
  clients.clear();
  server.close(() => {
    log("log", "已安全退出。");
    process.exit(0);
  });
  // 兜底：10 秒内没关干净就强退
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
