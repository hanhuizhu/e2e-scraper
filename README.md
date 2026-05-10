# E2E Scraper — Claude Code 通用 E2E 页面抓取 Skill

基于 Playwright 的可配置 E2E 页面抓取工具。从 Chrome 提取登录 cookie，打开目标页面，通过 API 网络监听或 DOM 提取采集文字与图片，保存到本地。

## 原理

```
用户描述目标网站
       ↓
Agent 分析 → 生成 config.json → scaffold.py 创建项目
       ↓
Cookie 复用: browser-cookie3 → Chrome 登录态 → Playwright 注入
       ↓
网络监听: 拦截 API 响应 → JSON 递归提取 → 图片 URL 收集
       ↓
         ↓ 无 API → DOM 提取（CSS 选择器）
       ↓
数据落盘: Markdown + 图片下载 + HTML 汇总
```

## 前置要求

- **Python 3** + `browser-cookie3`
- **Node.js 22+** + Playwright
- **Chrome 浏览器**（需已登录目标网站）

## 安装 Skill

```bash
# 安装依赖
pip3 install browser-cookie3
```

Skill 位于 `~/.claude/skills/e2e-scraper/`，Claude Code 自动加载。

## 使用方式

### 方式 1：通过 Claude Code Skill 触发

说"做一个 xxx 的 e2e"或"帮我抓 xxx 的内容"，Agent 会：

1. 询问目标 URL、提取内容、数据量
2. 分析网站 API/DOM 结构
3. 生成配置文件
4. 运行 scaffold.py 创建项目
5. 定制提取逻辑
6. 指导运行

### 方式 2：直接使用 scaffold

```bash
# 通过配置文件
python3 ~/.claude/skills/e2e-scraper/scripts/scaffold.py --config config.json

# 通过命令行参数
python3 ~/.claude/skills/e2e-scraper/scripts/scaffold.py \
  --name my-scraper \
  --domain example.com \
  --url "https://www.example.com/feed"

# 进入项目目录安装依赖
cd my-scraper
npm install
npx playwright install chromium
node scripts/e2e.mjs
```

## 脚本清单

| 文件 | 功能 |
|------|------|
| `scaffold.py` | 从配置 JSON 生成完整的 Playwright E2E 项目 |
| `e2e_template.mjs` | E2E 脚本模板，运行时读取 config.json |
| `extract_cookies.py` | 从 Chrome 提取指定域名的 cookie |
| `config.example.json` | 配置字段参考 |

## Config 字段说明

详见 `scripts/config.example.json`，核心字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 项目名称 |
| `domain` | string | Cookie 域名 |
| `targetUrl` | string | 目标页面 URL |
| `networkPatterns` | array | 网络监听规则 |
| `networkPatterns[].extractType` | `json-recursive` / `url-collect` | 提取方式 |
| `networkPatterns[].identifier` | `{field, value}` | 识别数据对象（如 `__typename: Tweet`）|
| `networkPatterns[].dedupField` | string | 去重字段 |
| `networkPatterns[].textField` | string | 文本字段路径（点号分隔）|
| `networkPatterns[].imageField` | string | 图片字段路径（`[]` 表示数组展开）|
| `domExtract` | object | DOM 提取兜底配置 |
| `scrollTimes` | number | 滚动次数 |

## 数据输出

```
output/
├── posts/batch_<ts>/          # 条目 Markdown 文件
│   ├── 001_<id>.md
│   └── ...
├── images/                    # 下载的图片
│   ├── <id>_1.jpg
│   └── ...
├── index.html                 # 可视化汇总页
└── screenshot.png             # 页面截图
```
