# Luzzle

**Luzzle** 是一款以真实语境阅读为核心的英语词汇学习工具，提供 **网页版（Web）** 与 **桌面客户端（macOS / Windows）** 双端支持。

将阅读中遇到的生词、熟词新义与地道短语化作可拼合、可拆解的实体拼块，结合构词理据与 FSRS 间隔重复算法，完成从「读懂」到「运用」的闭环。

---

## 在线体验与下载

- **一键免配置在线体验版（推荐）**：[https://inmistpiercer.github.io/luzzle/demo/](https://inmistpiercer.github.io/luzzle/demo/)
  - 预置 **3 篇演示文章**、**词汇拼块与词族连线**、四套视觉主题，并在「设置」中内置 **模拟次日 / 重置演示**，打开即可直接体验「读 · 拼 · 构 · 锻」完整闭环；
  - 使用独立浏览器数据库（`luzzle-test`），与正式版完全隔离，不会污染个人词库。
- **空白正式版（日常长期使用）**：[https://inmistpiercer.github.io/luzzle/](https://inmistpiercer.github.io/luzzle/)
  - 干净空白词库，适合导入自己的 `EPUB / PDF / Markdown / TXT` 文档长期积累。
- **桌面客户端（macOS `.dmg` / Windows `.exe`）**：前往本仓库 [Releases](../../releases) 页面下载对应系统安装包

> **macOS 首次打开提示**：若提示无法验证开发者，请在访达中右键点击 `Luzzle.app` 选择 **打开**（或在「系统设置 → 隐私与安全性」中点击 **仍要打开**）。

---

## 核心模块

- **读 · 阅读与摘词**：支持导入 `EPUB`、`PDF`、`Markdown`、`TXT` 文档；内置约 4.8 万条义项、6.5 万条显式词形映射及规则还原，支持自动识别 2,290+ 条常见短语、多色荧光笔划选、`⌘/Ctrl` 隔词合成原型短语、PDF 重排与双语对照。
- **拼 · 词汇拼板与收纳盒**：同词多义复合镶嵌、短语挂靠配件、词族自动吸合与分格收纳管理，支持中英释义一键翻面。
- **构 · 构词工坊**：按前缀、词根/词基、后缀进行透明拆解与音变溯源，串联常见同根词族。
- **锻 · 记忆锻造台**：基于 FSRS 记忆调度与五阶成长模型（`初识 → 识记 → 巩固 → 理解 → 运用`），按掌握程度动态匹配认义、多义辨析、新句填词、拼写与造句题型。
- **四套独立视觉风格**：内置 **积木岛屿**、**琥珀终端**、**霓虹暗房**、**制图台** 四套全场景主题。

---

## 隐私与安全设计

- **纯本地优先，零后台收集**：所有导入文档、词汇拼块与学习记录均 **100% 保存在你的本地设备**（网页版存于浏览器 IndexedDB，桌面版独立存于系统应用数据目录），项目无任何自建后台或第三方统计外联。
- **核心功能可离线使用**：词典、义项、短语、词形、词素与例句库均随包提供。桌面版和本地托管的网页版可在断网时使用阅读、查词、构词与锻造。在线网页版需要连接站点以载入页面和仍未缓存的数据。
- **可选自配 AI 接口（BYOK）**：
  - 支持配置你自己的 **OpenAI 兼容接口**（如 DeepSeek、OpenAI、本地 `localhost` Ollama / LM Studio）或 **Anthropic** 接口，用于实时流式语境解析、全文双语翻译与 PDF 版面重排；
  - 仅在你主动点击 AI 功能时向你指定的接口发起直连请求（强制 HTTPS 加密传输，本机离线模型除外）；
  - **桌面版专属防护**：API Key 通过操作系统级加密服务（macOS 钥匙串 / Windows DPAPI）加密保存，不写入明文词库，并在本地自动维护滚动数据备份。

---

## 本地开发与构建

环境要求：**Node.js 22.12 或更新的 22.x 版本**（CI 使用 Node.js 22）。

```bash
cd app
npm install
```

### 网页版（Web）

```bash
# 启动本地网页开发服务（空白正式版 / 预置演示版）
npm run dev
npm run dev:test

# 构建静态生产包（正式版输出至 app/dist/，体验版输出至 app/dist-test/）
npm run build
npm run build:test

# 运行全量单元测试与类型检查
npm run typecheck && npm test
```

四套风格的浏览器回归需要 Playwright 和 Chromium。先运行 `npm run dev:test`，再在另一个终端运行 `npm run e2e`。

### 桌面版（Electron）

```bash
# 启动桌面端热重载开发窗口
npm run electron:dev

# 编译并直接启动本地桌面版
npm run electron:start

# 打包 macOS 安装镜像（输出至 app/release/*.dmg）
npm run electron:mac

# 打包 Windows 安装程序与便携版（输出至 app/release/*.exe）
npm run electron:win
```

---

## 数据来源与致谢

本项目内置离线语言数据整理自以下开源项目与学术资源（仅供个人学习与非商业研究使用）：

- **ECDICT**（MIT License）
- **MorphoLex-EN**（Sánchez-Gutiérrez et al., 2018）
- **MorphyNet**（CC BY-SA 3.0，源自 Wiktionary）
- **Tatoeba**（CC BY 2.0 FR）
