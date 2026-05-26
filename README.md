# Tritree

Tritree 是一款 AI 辅助创作工作台。它不急着把你的想法一次性写成定稿，而是从一句 seed 开始，生成第一版作品，再不断给出三个可选择的下一步方向。每一次选择都会长成一条分支，让创作过程像一棵树一样可回看、可比较、可重走。

![Tritree preview](docs/images/preview.png)

## 为什么用 Tritree

- **让 AI 陪你做判断**：AI 不只输出文本，也会提出下一步问题和方向，帮你在角度、结构、表达和收尾之间做选择。
- **保留创作现场**：每个节点都有草稿、选择和历史路径。你可以回到任意一步重新分支，不怕好想法被一次覆盖掉。
- **适合从想法长成作品**：从社媒内容到 PRD 文档，Tritree 都会围绕作品类型调整输出结构、编辑面板和交付方式。
- **把个人风格沉淀下来**：你可以用代表作生成「我的风格」，也可以用 Skills 保存长期有效的写作习惯、平台要求和审稿标准。
- **为自托管团队准备**：支持多用户、管理员、OIDC、GitHub Skill 导入和可选外部工具接入，适合把团队自己的创作方法放进去。

## 核心体验

- **创作树**：从 seed 生成草稿，再通过三选一方向持续分支；支持自定义方向和从历史节点重新出发。
- **实时草稿**：流式生成、手动编辑、父子版本 diff、任意节点对比都在同一个工作台里完成。
- **局部改写**：选中文本后给 AI 指令，只改你选中的部分，再自然接回当前草稿。
- **发布与交付**：社媒内容可以整理成平台版本；PRD 可以导出 Markdown 交付稿并检查关键章节。
- **Skills**：启用不同 Skills 后，AI 会按你的风格、平台、约束和检查规则生成草稿与下一步建议。

## 适合用来

- 写微博、小红书、朋友圈等社交媒体内容。
- 把零散想法扩展成完整文章或说明。
- 沉淀产品需求、PRD 和决策文档。
- 维护团队内部的写作规范、审稿标准和可复用提示词。

## 快速开始

环境要求：

- Node.js >= 24.0.0

安装依赖：

```bash
npm install
```

复制环境变量：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少配置 AI 接口：

```env
ANTHROPIC_BASE_URL=https://your-provider.example/anthropic
ANTHROPIC_AUTH_TOKEN=your_api_key_here
ANTHROPIC_MODEL=your_model_name

TRITREE_DB_PATH=.tritree/tritree.sqlite
# 可选：配置后会使用 MySQL，而不是本地 SQLite 文件
# TRITREE_DATABASE_URL=mysql://user:password@localhost:3306/tritree
```

复制默认内容配置：

```bash
mkdir -p .tritree
cp config/defaults.example.json .tritree/defaults.json
```

启动开发服务器：

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。首次启动且数据库里没有用户时，会进入管理员初始化页；第一个用户会成为管理员。

## 使用流程

1. 点击「新念头」，选择作品类型，输入 seed 和创作要求。若只配置了一个作品类型，页面会直接使用该类型。
2. 可选配置「我的风格」和本轮 Skills。
3. 生成第一版作品后，在创作树里选择一个方向，或写下自己的方向。
4. 审阅 diff、手动编辑，或对选中文本发起局部 AI 改写。
5. 内容接近完成后打开发布或交付助手，复制最终版本。

## 灵感接口

新 seed 页面可以显示灵感列表。默认灵感来自 `.tritree/defaults.json` 里的 `inspirations`；配置 `TRITREE_INSPIRATION_URL` 后，Tritree 会改为通过后端代理请求外部接口。如需认证，可配置 `TRITREE_INSPIRATION_TOKEN`，请求会带上 `Authorization: Bearer <token>`。请求会附加当前作品类型，例如 `?artifactTypeId=social-post` 或 `?artifactTypeId=prd`。

接口返回：

```json
{
  "inspirations": [
    {
      "id": "idea-1",
      "title": "AI 产品真实困境",
      "detail": "我想写 AI 产品经理在真实项目里的困境。",
      "artifactTypeIds": ["social-post"]
    }
  ]
}
```

## 作品类型配置

默认展示全部作品类型。可通过 `TRITREE_ARTIFACT_TYPES` 控制新 seed 页面和生成流程可用的类型：

```env
TRITREE_ARTIFACT_TYPES=social-post,prd
```

设置为 `prd` 时只展示 PRD 内容，seed 页面不会显示作品类型选择。设置为 `all` 或留空时展示全部类型。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 应用框架 | Next.js 16 App Router + React 19 |
| AI 执行 | Mastra Agent + AI SDK Anthropic-compatible provider |
| 认证 | NextAuth v4 Credentials / OIDC |
| 数据 | Drizzle ORM；默认 SQLite，配置 `TRITREE_DATABASE_URL` 后使用 MySQL |
| 编辑与可视化 | CodeMirror diff/merge、D3.js、lucide-react |
| 校验与测试 | TypeScript、Zod、Vitest、Testing Library |

## 开发命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm test             # 运行测试
npm run test:watch   # 监听模式运行测试
npm run typecheck    # TypeScript 类型检查
```

## 自托管提示

数据默认存储在项目根目录 `.tritree/tritree.sqlite`，可通过 `TRITREE_DB_PATH` 修改。设置 `TRITREE_DATABASE_URL=mysql://...` 后会改用 MySQL。生产环境请显式配置 `NEXTAUTH_SECRET`，并定期备份 SQLite 文件或 MySQL 数据库。子路径部署、OIDC、外部 MCP 工具、外部风格生成和 Skill 执行隔离都支持按需开启，相关变量可参考 `.env.example`。

系统默认 Skills、创作要求快捷按钮和默认灵感都来自默认内容配置。默认读取 `.tritree/defaults.json`；也可以用 `TRITREE_DEFAULTS_CONFIG_PATH=/absolute/path/to/defaults.json` 指向其他 JSON 文件。配置缺失、JSON 无效、`systemSkills` 为空或任一字段不合法时，应用会直接报错，不回退到代码里的旧默认值。

## License

Apache License 2.0. See [LICENSE](./LICENSE).
