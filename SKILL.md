---
name: e2e-scraper
description: >-
  浏览器 E2E 页面抓取模板工具：从 Chrome 提取已登录 cookie，使用 Playwright 打开目标页面，
  监听 API 响应提取文字与图片数据，保存到本地。支持通过配置适配不同网站，实现 cookie 共享与 E2E 数据采集模板化。
---

# e2e-scraper — Agent 执行协议

## 角色定位

当用户触发本 Skill，你是用户的 **E2E 页面抓取助手**。

你的职责是：**理解用户意图 → 确认目标网站与数据需求 → 生成并部署 Playwright E2E 脚本 → 指导用户运行**。

本 Skill 提供：
- **cookie 复用** — 从 Chrome 提取登录态，无需手动传参
- **网络监听** — 拦截 API 响应，提取文字与图片
- **项目脚手架** — 自动生成 `package.json` + `e2e.mjs` + 输出目录
- **配置驱动** — 针对不同网站只需调整配置即可适配

---

## 前置检查（每次触发必做）

1. 确认用户系统已安装：`Node.js >= 22`、`Python 3`、`browser-cookie3`
   - 未安装 `browser-cookie3`：引导 `pip3 install browser-cookie3`
2. 确认用户是否已在 **Chrome 浏览器** 登录目标网站
3. 确认当前工作目录（项目生成在此目录下）

---

## 流程标准步骤

```
用户: 帮我抓 xxx 网站的内容
  → 需求采集：目标 URL、要抓什么数据（文字/图片/二者都要）、网站是否需要登录
  → 分析网站：打开目标网站，观察网络请求模式、DOM 结构
  → 生成项目：运行 scaffold.mjs 创建项目骨架
  → 定制提取逻辑：根据分析结果修改 e2e.mjs 中的监听规则和数据提取函数
  → 运行：node scripts/e2e.mjs
  → 反馈结果
```

### Step 1 — 需求采集

向用户确认以下信息：

| 问题 | 说明 |
|------|------|
| **目标 URL** | 要打开什么页面？例如 `https://x.com/home`、`https://www.example.com/feed` |
| **提取内容** | 文字内容？图片？还是两者都要？ |
| **登录需求** | 网站是否需要登录才能看到目标内容？ |
| **数据量** | 需要抓取多少条/多少页？ |
| **输出格式** | Markdown 文件？汇总 HTML？还是仅原始数据？ |
| **Cookie 域名** | 网站使用的域名（用于 cookie 提取，默认同 URL 域名） |

### Step 2 — 分析目标网站

**网络请求分析**（最关键步骤）：

打开目标网站（或回忆已有知识），识别数据来源：

- **API 响应（推荐）**：页面通过 XHR/Fetch 加载数据，返回 JSON → 网络监听最精确
  - 打开浏览器 DevTools → Network → 观察 XHR/Fetch 请求
  - 找到包含目标数据（帖子/文章/卡片）的 API 请求
  - 记录 URL 模式（如 `graphql/HomeTimeline`、`api/feed`、`api/post`）
  - 分析 JSON 结构：找到文本字段路径、图片 URL 路径、唯一 ID 字段
- **DOM 提取（兜底）**：无合适 API 时，直接从页面 DOM 提取
  - 找到数据容器元素的选择器
  - 找到文字元素和图片元素的选择器

**交互模式分析**：

- 页面是否需滚动加载更多？→ 配置 `scrollTimes`、`scrollDelayMs`
- 是否有"加载更多"按钮？→ 需在 `pagination` 中配置点击
- 是否有 Tab 切换？→ 需在 `navigation` 中配置

### Step 3 — 创建配置 JSON

根据分析结果，创建配置 JSON。完整字段说明：

```json
{
  "name": "项目目录名",
  "domain": "cookie 域名",                        // 用于从 Chrome 提取 cookie
  "targetUrl": "https://...",                      // Playwright 打开的 URL
  "headless": false,                               // 是否无头模式
  "outputDir": "output",                           // 输出目录
  "scrollTimes": 20,                               // 滚动次数（0 = 不滚动）
  "scrollDelayMs": 2500,                           // 每次滚动后的等待时间
  "waitSelectors": ["[data-testid=\"timeline\"]"], // 等待页面特定元素出现
  "networkPatterns": [                             // 网络监听规则
    {
      "description": "简要描述",
      "urlPattern": "api/feed",                    // URL 包含的关键字
      "extractType": "json-recursive",             // 提取方式:
                                                   //   json-recursive: 递归搜索 JSON 中匹配的对象
                                                   //   url-collect: 收集匹配的 URL
      "identifier": {                              // json-recursive 模式：识别数据对象的字段
        "field": "__typename",
        "value": "Tweet"
      },
      "dedupField": "rest_id",                     // json-recursive 模式：去重字段
      "textField": "legacy.full_text",            // 文本字段路径（点号分隔）
      "imageField": "legacy.extended_entities.media[].media_url_https",
                                                   // 图片 URL 字段路径（[] 表示数组展开）
      "authorField": "core.user_results.result.core.screen_name",
                                                   // 作者/来源字段路径
      "urlField": "",                              // 源链接字段
      "timeField": "legacy.created_at"             // 时间字段
    },
    {
      "description": "收集图片 URL",
      "urlPattern": "cdn.example.com/images",
      "extractType": "url-collect"                 // 直接收集请求 URL 作为图片来源
    }
  ],
  "domExtract": {                                  // DOM 提取兜底
    "waitSelector": "[data-testid=\"tweet\"]",
    "fields": {
      "text": {
        "selector": "[data-testid=\"tweetText\"]",
        "attribute": "textContent"
      },
      "images": {
        "selector": "img[src*=\"media\"]",
        "attribute": "src",
        "multiple": true
      },
      "author": {
        "selector": "[data-testid=\"User-Name\"] a",
        "attribute": "textContent",
        "transform": "replace('@','').split(/\\s/)[0]"
      }
    }
  }
}
```

### Step 4 — 生成项目

运行 scaffold 生成项目骨架：

```bash
# 将以下 config.json 保存到临时文件，然后运行 scaffold
python3 ~/.claude/skills/e2e-scraper/scripts/scaffold.py --config /tmp/e2e-config.json
# 或者在项目目录下直接运行
cd /path/to/project
python3 ~/.claude/skills/e2e-scraper/scripts/scaffold.py --config e2e-config.json
```

这会生成：
```
<project-name>/
├── package.json
├── scripts/
│   ├── e2e.mjs          # 主 E2E 脚本
│   ├── extract_cookies.py # cookie 提取
│   └── config.json      # 配置副本
├── output/              # 输出目录
├── README.md
└── .gitignore
```

### Step 5 — 定制提取逻辑

**这是最关键的步骤**。分析目标网站的 API 响应结构后，需要修改生成的 e2e.mjs 中以下部分：

1. **网络监听**：生成代码会根据 `config.json` 的 `networkPatterns` 生成通用监听逻辑
   - 对于 `json-recursive` 类型：会有一个 `extractItems()` 函数，需要确认递归提取逻辑正确
   - 对于复杂嵌套结构，可能需要手写提取函数
2. **数据提取**：对于特定网站的 API 响应，建议手写专门的 `extractXxxFromResponse()` 函数
3. **页面交互**：如有特殊交互（Tab 切换、弹框关闭等），需在 `beforeScroll` 或 `afterNavigate` 中添加

**修改完 e2e.mjs 后**，一定要检查：
- 网络监听 URL 过滤条件是否正确
- 数据提取路径是否匹配实际的 API 响应结构
- 去重逻辑是否有效

### Step 6 — 运行

```bash
cd <project-name>
npm install
npx playwright install chromium  # 首次需安装浏览器
node scripts/e2e.mjs
```

---

## 常见网站模式参考

### X.com / Twitter

```
目标 URL: https://x.com/home
Cookie 域名: x.com
等待选择器: [data-testid="primaryColumn"]
网络监听: /i/api/graphql/ + HomeTimeline
数据识别: __typename === "Tweet", dedup by rest_id
文本路径: legacy.full_text
图片路径: legacy.extended_entities.media[].media_url_https
作者路径: core.user_results.result.core.screen_name
时间路径: legacy.created_at
DOM 兜底: [data-testid="tweet"], [data-testid="tweetText"]
注意: 使用 waitUntil: 'load' 而非 networkidle（WebSocket 长连）
```

### 小红书 Xiaohongshu

```
目标 URL: https://www.xiaohongshu.com/explore
Cookie 域名: xiaohongshu.com
网络监听: sns-webpic + nc_n_webp（图片 URL 收集）
提取方式: url-collect（只收集图片 URL，无文本）
注意: 滚动加载无限内容
```

### Bilibili

```
目标 URL: https://www.bilibili.com/
Cookie 域名: bilibili.com
数据提取: 通常可从 SSR 的 window.__INITIAL_STATE__ 提取
方法: page.evaluate() 在页面加载后读取全局变量
注意: 部分页面使用客户端渲染，需监听 API
```

---

## 脚本清单

| 文件 | 功能 |
|------|------|
| `scaffold.py` | 从配置 JSON 生成 E2E 项目骨架 |
| `extract_cookies.py` | 从 Chrome 提取指定域名的 cookie（Python，依赖 browser-cookie3） |

---

## 数据保存方式

生成的 E2E 脚本会：

1. **文字** → `output/posts/batch_<ts>/` 目录下，每条数据一个 `.md` 文件
   - 包含：序号、作者、时间、链接、正文
   - 图片引用：`![图片说明](../images/xxx.jpg)`
2. **图片** → `output/images/` 目录下，以 `{id}_{n}.{ext}` 命名
3. **汇总** → `output/index.html` 可视化浏览
4. **截图** → `output/screenshot.png` 页面截图（用于调试）

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| `waitUntil: 'networkidle'` 超时 | 如目标网站有 WebSocket/SSE，改用 `waitUntil: 'load'` 或 `'domcontentloaded'` |
| cookie 提取为空 | 确认 Chrome 已登录目标网站；确认域名正确（x.com vs twitter.com） |
| 网络监听捕获不到数据 | 检查 URL 过滤条件是否太严格；使用 `response.url().includes()` 而非 `===` |
| response.json() 报错 | 说明响应不是 JSON；可改用 `response.text()` 或 `response.body()` |
| 图片下载 403 | 需要添加 `Referer` 请求头；部分 CDN 检查来源 |
| 滚动加载不出内容 | 可能需要点击"加载更多"按钮，或等待时间不够长 |
