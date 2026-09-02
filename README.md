# 学习聚合页

这是一个先解决“找课难”和“继续学很慢”的本地原型。

项目已确定向“学习驾驶舱 + Obsidian 学习记忆 + DeepTutor 学习现场”演进。完整的阶段目标、边界和验收标准见 [DEVELOPMENT_PLAN.md](/Users/sam/01-ai-lab/all-in-one/DEVELOPMENT_PLAN.md)。

已批准的对象模型与交互规则见 [PHASE_0_DESIGN.md](/Users/sam/01-ai-lab/all-in-one/PHASE_0_DESIGN.md)。

Obsidian 本地连接器的接口与安全设计见 [PHASE_1_CONNECTOR_DESIGN.md](/Users/sam/01-ai-lab/all-in-one/PHASE_1_CONNECTOR_DESIGN.md)。

## 现在已经有的能力

- 把 B 站、YouTube、公众号、CCTalk、人人讲等内容手动收录到一个页面
- 按平台、状态、优先级筛选
- 搜索课程名、作者、平台和标签
- 记录“看到哪里了”
- 一键继续打开原始链接
- 导出你自己的课程清单

## 怎么打开

现在推荐通过本机连接器启动。在 Finder 中双击 `启动学习驾驶舱.command`，它会启动本地服务并自动打开驾驶舱。

也可以在终端运行：

```bash
npm start
```

然后在浏览器打开 `http://127.0.0.1:47831`。这样课程会保存到 Obsidian Vault；直接打开 [index.html](/Users/sam/01-ai-lab/all-in-one/index.html) 仍可作为无连接器时的本地回退，但不会获得可靠持久化。

## 为什么先这样做

很多平台没有稳定、公开、合规的同步接口，尤其还涉及登录态、付费内容、收藏夹、历史记录等。
所以第一步更现实的做法不是“全自动抓取”，而是先把你真正会反复看的内容统一收进自己的入口。

## 后续推荐路线

1. 先把常看的 20 到 50 个课程或专栏整理进来。
2. 确认这个页面的字段对你够不够用。
3. 再决定要不要加导入器：
   - 浏览器书签导入
   - B 站收藏夹或稍后再看导入
   - YouTube 播放列表导入
   - 公众号文章链接导入
4. 如果你希望跨设备同步，再加一个轻量后端或接 Notion / Airtable / Supabase。

## 比较务实的产品拆分

- `v0`：本地单页，手动录入
- `v1`：支持导入 JSON / CSV
- `v2`：半自动抓取公开链接元数据
- `v3`：支持今日学习队列、复习提醒、学习笔记入口
