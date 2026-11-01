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
- Chrome / Edge 扩展一键收下当前网页到探索池（安装见 [extension/README.md](/Users/sam/01-ai-lab/all-in-one/extension/README.md)）

## 怎么打开

在 Mac 上，直接双击桌面的“学习驾驶舱”图标即可启动服务并打开页面。

现在推荐通过本机连接器启动。在 Finder 中双击 `启动学习驾驶舱.command`，它会启动本地服务并自动打开驾驶舱。

也可以在终端运行：

```bash
npm start
```

然后在浏览器打开 `http://127.0.0.1:47831`。这样课程会保存到 Obsidian Vault；直接打开 [index.html](/Users/sam/01-ai-lab/all-in-one/index.html) 仍可作为无连接器时的本地回退，但不会获得可靠持久化。

## 浏览器扩展

扩展在 [extension](/Users/sam/01-ai-lab/all-in-one/extension) 目录。首次使用需要在 Chrome 或 Edge 的扩展管理页打开“开发者模式”，然后选择“加载已解压的扩展程序”。完整步骤见 [extension/README.md](/Users/sam/01-ai-lab/all-in-one/extension/README.md)。

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

## 数据架构

学习数据（订阅源、探索记录、课程、计划等）与项目代码**完全解耦**，存放在独立 git 仓库：

- **数据仓库**：[github.com/yangxiao-ca/all-in-one-resources](https://github.com/yangxiao-ca/all-in-one-resources)（私有）
- **本地路径**：`Learning/` 目录（已被 `.gitignore` 忽略，父项目不跟踪）
- **Obsidian 同步**：`/Users/sam/Obsidian/程序员/Learning` 是软链接，指向项目内的 `Learning/`

### 首次克隆后恢复数据

```bash
# 1. 克隆项目
git clone <本项目地址>

# 2. 克隆数据仓库到 Learning/
git clone git@github.com:yangxiao-ca/all-in-one-resources.git Learning/

# 3. 如果需要在 Obsidian 中看到，创建软链接
ln -s "$(pwd)/Learning" /Users/sam/Obsidian/程序员/Learning
```

### 数据备份策略

数据仓库独立于项目代码，即使项目目录丢失或被覆盖，只要远端仓库还在，`git clone` 即可恢复全部数据。建议在数据仓库中也配置定期自动备份。
