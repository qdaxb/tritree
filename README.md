# Tritree

一款 AI 辅助社交媒体内容创作工具。通过反复的「三选一」决策，让 AI 引导你从个人偏好出发，生长出一篇完整的发布内容。
![image](https://github.com/user-attachments/assets/c425c2ec-1302-472f-9249-54167e61fcc0)

## 产品理念

Tritree 的核心交互是一棵不断生长的创作树。每一轮，AI 导演（Director）会根据你的根记忆（Root Memory）和当前创作路径，生成三个方向各异的分支选项。你选择一个，树继续生长；未选的分支折叠进历史。最终，AI 会在合适的时机提供「完成发布包」的选项，输出标题、正文、话题标签和配图提示词。

整个过程无需从空白提示词开始，也无需手动组织思路——AI 负责决定下一步创作方向，你只需做选择。

## 功能特性

- **根记忆（Root Memory）**：首次使用时完成轻量偏好设置（内容领域、语气、表达风格、视角），或直接输入一句 Seed 描述。偏好会随创作积累持续更新。
- **AI 导演**：每轮自动决定创作意图，生成三个分支选项（探索 / 深化 / 重构 / 完成），并实时更新草稿。
- **创作树画布**：以可视化树形结构展示当前节点与历史路径，支持点击历史节点查看或从该节点重新分支。
- **实时草稿（Live Draft）**：每次选择后草稿立即更新，支持流式输出，可手动编辑并保存。
- **草稿对比**：可选择任意两个历史节点的草稿进行差异对比。
- **技能系统（Skills）**：为每次创作会话启用特定写作技能，影响 AI 的生成风格与策略。
- **发布包输出**：最终输出包含标题、正文、话题标签和配图提示词，可直接复制使用。
- **本地持久化**：所有数据存储在本地 SQLite 文件中，无需登录，无需联网（除 AI API 调用外）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 + React 19 |
| AI 接口 | Anthropic API（默认接入 Kimi K2.5，兼容 OpenAI 格式） |
| 数据库 | SQLite（通过 Drizzle ORM） |
| 可视化 | D3.js |
| 样式 | CSS Modules / 全局 CSS |
| 测试 | Vitest + Testing Library |
| 类型校验 | TypeScript + Zod |

## 快速开始

### 环境要求

- Node.js >= 24.0.0

### 安装

```bash
npm install
```

### 配置

复制 `.env.example` 为 `.env.local` 并填写 API 密钥：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
# Anthropic 兼容接口地址（默认接入 Kimi）
ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic

# 你的 API 密钥
ANTHROPIC_AUTH_TOKEN=your_api_key_here

# 使用的模型
ANTHROPIC_MODEL=kimi-k2.5

# 本地数据库路径（自动创建）
TREEABLE_DB_PATH=.treeable/treeable.sqlite
```

> 如需使用 OpenAI 原生接口，将 `ANTHROPIC_BASE_URL` 改为 `https://api.openai.com` 并填入对应密钥和模型名称即可。

### 启动开发服务器

```bash
npm run dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000)。

## 使用流程

1. **初始化根记忆**：首次打开时，选择你的内容偏好（领域、语气、风格、视角），或直接输入一句 Seed 描述你想创作的方向。
2. **开始创作**：点击「开始创作」，AI 自动生成第一轮三个分支选项。
3. **选择分支**：在树画布上点击你想要的方向，草稿实时更新。
4. **持续迭代**：每轮选择后，AI 继续生成下一轮选项，直到内容成熟。
5. **完成发布包**：当 AI 判断内容足够完整时，会提供「完成」选项，生成可直接使用的发布包。
6. **新念头**：点击「新念头」可随时开启全新的创作主题。

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面与 API 路由
│   ├── api/
│   │   ├── root-memory/    # 根记忆读写
│   │   ├── sessions/       # 会话管理、选择、草稿、选项生成
│   │   └── skills/         # 技能库管理
│   └── page.tsx
├── components/
│   ├── TreeableApp.tsx     # 主应用组件
│   ├── draft/              # 实时草稿面板
│   ├── history/            # 历史路径小地图
│   ├── root-memory/        # 根记忆设置界面
│   ├── skills/             # 技能选择与管理
│   └── tree/               # 创作树画布
└── lib/
    ├── ai/                 # AI 导演逻辑与流式处理
    ├── api/                # API 错误处理
    ├── db/                 # 数据库 schema 与 repository
    ├── stream/             # NDJSON 流解析
    ├── domain.ts           # 核心领域类型定义
    └── app-state.ts        # 应用状态管理
```

## 开发命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test

# 监听模式运行测试
npm run test:watch

# TypeScript 类型检查
npm run typecheck
```

## 数据存储

所有数据默认存储在项目根目录的 `.treeable/treeable.sqlite` 文件中（可通过 `TREEABLE_DB_PATH` 环境变量修改路径）。数据库在首次启动时自动创建，包含以下数据：

- 根记忆与偏好设置
- 创作会话与树节点
- 每轮草稿版本快照
- 分支历史摘要
- 最终发布包
- 技能库

## 注意事项

- 本项目为本地个人使用设计，不包含多用户、认证或计费功能。
- AI 生成需要有效的 API 密钥，请确保 `.env.local` 配置正确后再启动。
- 数据库文件包含你的创作内容，请妥善备份 `.treeable/` 目录。

## License

Apache License 2.0. See [LICENSE](./LICENSE).
