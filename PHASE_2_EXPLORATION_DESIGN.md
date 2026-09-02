# 阶段 2：探索池与订阅源

> 状态：实现进行中（2026-09-02）。
> 关联总计划：[DEVELOPMENT_PLAN.md](/Users/sam/01-ai-lab/all-in-one/DEVELOPMENT_PLAN.md)。

## 目标

把“值得以后再看”的零散内容收进探索池，但不把它们伪装成需要立刻完成的课程。

首页继续以课程封面为主；探索池是独立入口，用来承接文章、视频、课程片段和网页。

## 最小对象

### 探索记录

- 文件位置：`Learning/01-探索记录/`
- 最小字段：`id`、`type=exploration`、`title`、`url`、`platform`、`captureLevel=quick`、`engagement=saved`、时间与 revision。
- 可选字段：`creator`、`contentType`、`progressKind`、`progressValue`、`whySaved`、`takeaway`、`question`、`nextAction`、`topicIds`、`sourceId`。
- 正文分区：为什么收下、收获、疑问、下一步。

### 订阅源

- 文件位置：`Learning/02-订阅源/`
- 最小字段：`id`、`type=source`、`title`、`platform`、`url`、`relationship=observing`、时间与 revision。
- 可选字段：`followReason`、`focusTopics`、`lastCapturedAt`。

## 页面流程

1. 用户从侧边入口打开探索池。
2. 点击“收下一个链接”，填写标题、链接和平台；标题可稍后修改。
3. 默认保存为“快速收下”，立即回到探索池。
4. 用户将鼠标停在卡片上时，可选“只是看过 / 有启发 / 想再看 / 想深入”。
5. 只有选择“有启发”或“想深入”时，才展开一行输入，记录收获或问题。

### 拖入与粘贴

- 探索池收录表单支持粘贴 URL、拖入文本和浏览器拖放数据。
- 系统优先提取 URL；若拖放数据包含标题则自动填入标题，否则保留可编辑的待填写标题。
- 首版不自动总结内容；AI 概要在后续用户确认、来源可读取时生成草案。

## 非目标

- 不自动读取浏览历史、订阅更新或平台登录态。
- 不在本阶段实现 AI 分类、专题升级或浏览器插件。
- 不强制用户给每条探索记录写完整笔记。

## 验收

- 新建探索记录会在 Obsidian 和探索池中出现。
- 用户在 Obsidian 改“收获”后，探索池自动刷新。
- 四个快捷状态能够更新正式 Markdown。
