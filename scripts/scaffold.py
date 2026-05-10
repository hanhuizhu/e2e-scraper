#!/usr/bin/env python3
"""E2E 项目脚手架生成器：从配置 JSON 生成完整的 Playwright E2E 项目。

用法:
  python3 scaffold.py --config config.json
  python3 scaffold.py --name my-project --domain x.com --url "https://x.com/home"

Config JSON 字段：
  name          - 项目名称（目录名）
  domain        - Cookie 域名，如 "x.com"
  targetUrl     - 目标页面 URL
  headless      - 是否无头模式（默认 false）
  outputDir     - 输出目录（默认 "output"）
  waitUntil     - 等待策略：load / domcontentloaded / networkidle（默认 "load"）
  scrollTimes   - 滚动次数（0=不滚动，默认 20）
  scrollDelayMs - 滚动间隔毫秒（默认 2500）
  waitSelectors - 等待的 CSS 选择器数组
  networkPatterns - 网络监听规则数组
    urlPattern    - URL 包含关键字
    extractType   - json-recursive / url-collect
    identifier    - {field, value} 识别数据对象
    dedupField    - 去重字段名
    textField     - 文本字段路径（点号分隔）
    imageField    - 图片字段路径，数组用 []
    authorField   - 作者字段路径
    timeField     - 时间字段路径
    description   - 规则描述
  domExtract    - DOM 提取兜底配置（见 example config）
"""

import argparse
import json
import os
import shutil
import sys


DEFAULT_CONFIG = {
    "name": "my-e2e",
    "domain": "example.com",
    "targetUrl": "https://www.example.com",
    "headless": False,
    "outputDir": "output",
    "waitUntil": "load",
    "scrollTimes": 20,
    "scrollDelayMs": 2500,
    "waitSelectors": [],
    "networkPatterns": [],
    "domExtract": None,
}


def deep_merge(base, overrides):
    result = base.copy()
    for k, v in overrides.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def generate_package_json(config):
    return {
        "name": config["name"],
        "version": "1.0.0",
        "private": True,
        "type": "module",
        "scripts": {
            "e2e": "node scripts/e2e.mjs",
            "cookies": f"python3 scripts/extract_cookies.py {config['domain']}",
        },
        "dependencies": {
            "playwright": "^1.59.0",
        },
    }


def generate_readme(config):
    name = config["name"]
    domain = config["domain"]
    url = config["targetUrl"]
    return f"""# {name}

由 e2e-scraper 生成的 E2E 页面抓取项目。

## 目标

自动从 [{url}]({url}) 抓取内容，保存到本地。

## 原理

1. 通过 `browser-cookie3` 从 Chrome 提取已登录的 `{domain}` cookie
2. 使用 Playwright 打开目标页面，滚动加载更多内容
3. 拦截 API 响应（或 DOM 提取）获取文字与图片
4. 保存为 Markdown 文件并下载图片到本地

## 前置要求

- Python 3 + `browser-cookie3`（提取 Chrome cookie）
- Node.js 22+
- Chrome 浏览器（需已登录 {domain}）

## 安装

```bash
npm install
pip3 install browser-cookie3
```

## 使用

```bash
node scripts/e2e.mjs
```

## 定制

编辑 `scripts/config.json` 修改目标配置，或直接修改 `scripts/e2e.mjs` 中的提取逻辑。
"""


def main():
    parser = argparse.ArgumentParser(description="E2E 项目脚手架生成器")
    parser.add_argument("--config", help="配置 JSON 文件路径")
    parser.add_argument("--name", help="项目名称（目录名）")
    parser.add_argument("--domain", help="Cookie 域名")
    parser.add_argument("--url", help="目标 URL")
    parser.add_argument("--output", help="输出目录（默认当前目录）", default=".")
    args = parser.parse_args()

    # 读取配置
    config = DEFAULT_CONFIG.copy()
    if args.config:
        with open(args.config) as f:
            user_config = json.load(f)
        config = deep_merge(config, user_config)
    else:
        if args.name:
            config["name"] = args.name
        if args.domain:
            config["domain"] = args.domain
        if args.url:
            config["targetUrl"] = args.url

    if config["domain"] == "example.com" and not args.config:
        parser.print_help()
        print("\n错误：请通过 --config 或 --domain/--url 指定目标网站信息")
        sys.exit(1)

    name = config["name"]
    project_dir = os.path.join(os.path.abspath(args.output), name)
    os.makedirs(os.path.join(project_dir, "scripts"), exist_ok=True)
    os.makedirs(os.path.join(project_dir, "output"), exist_ok=True)

    # 定位 skill 目录
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 1. scripts/e2e.mjs — 从模板复制
    template_path = os.path.join(skill_dir, "scripts", "e2e_template.mjs")
    if os.path.exists(template_path):
        shutil.copy2(template_path, os.path.join(project_dir, "scripts", "e2e.mjs"))
    else:
        print(f"错误：找不到模板文件 {template_path}")
        sys.exit(1)

    # 2. scripts/extract_cookies.py
    src_cookie = os.path.join(skill_dir, "scripts", "extract_cookies.py")
    dst_cookie = os.path.join(project_dir, "scripts", "extract_cookies.py")
    if os.path.exists(src_cookie):
        shutil.copy2(src_cookie, dst_cookie)
    else:
        # 内联兜底
        with open(dst_cookie, "w") as f:
            f.write(COOKIE_FALLBACK)

    # 3. scripts/config.json
    with open(os.path.join(project_dir, "scripts", "config.json"), "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    # 4. package.json
    with open(os.path.join(project_dir, "package.json"), "w") as f:
        json.dump(generate_package_json(config), f, indent=2)
        f.write("\n")

    # 5. .gitignore
    with open(os.path.join(project_dir, ".gitignore"), "w") as f:
        f.write("node_modules/\noutput/\ndebug.png\n*.log\n")

    # 6. README.md
    with open(os.path.join(project_dir, "README.md"), "w") as f:
        f.write(generate_readme(config))

    print(f"""
✅ 项目已生成: {project_dir}

├── package.json           # Node.js 项目配置
├── scripts/
│   ├── e2e.mjs            # 主 E2E 脚本（config.json 驱动）
│   ├── extract_cookies.py # Chrome cookie 提取
│   └── config.json        # 运行配置（可编辑）
├── output/                # 输出目录
├── README.md
└── .gitignore

运行:
  cd {os.path.relpath(project_dir)}
  npm install
  npx playwright install chromium
  node scripts/e2e.mjs
""")


COOKIE_FALLBACK = """#!/usr/bin/env python3
import json, sys
import browser_cookie3

def get_cookies(domain):
    cj = browser_cookie3.chrome(domain_name=domain)
    clean = domain.replace('www.', '')
    return {c.name: c.value for c in cj if clean in c.domain}

def main():
    domains = sys.argv[1:] if len(sys.argv) > 1 else ['example.com']
    cookies = {}
    for d in domains:
        try:
            cookies.update(get_cookies(d))
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
    if not cookies:
        print(json.dumps({"error": f"未找到 {domains[0]} 的 cookie，请先登录"}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps(cookies, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
"""


if __name__ == "__main__":
    main()
