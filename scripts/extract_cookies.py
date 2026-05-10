#!/usr/bin/env python3
"""从 Chrome 浏览器提取指定域名的 cookie，输出为 JSON。

用法:
  python3 extract_cookies.py <domain> [<domain2> ...]

示例:
  python3 extract_cookies.py x.com
  python3 extract_cookies.py xiaohongshu.com
  python3 extract_cookies.py bilibili.com zhihu.com
"""

import json
import sys
import browser_cookie3


def get_cookies(domain: str) -> dict[str, str]:
    """从 Chrome 提取指定域名的 cookie。"""
    cj = browser_cookie3.chrome(domain_name=domain)
    clean = domain.replace('www.', '')
    return {c.name: c.value for c in cj if clean in c.domain}


def main():
    domains = sys.argv[1:] if len(sys.argv) > 1 else ['x.com']
    cookies = {}

    for domain in domains:
        try:
            found = get_cookies(domain)
            cookies.update(found)
        except Exception as e:
            print(
                json.dumps({"error": f"提取 {domain} cookie 失败: {e}"},
                           ensure_ascii=False),
                file=sys.stderr)

    # 如果是 x.com，也尝试 twitter.com
    if any('x.com' in d for d in domains):
        try:
            cookies.update(get_cookies('twitter.com'))
        except Exception:
            pass

    if not cookies:
        print(json.dumps({
            "error":
                f"未找到 {', '.join(domains)} 的 cookie，请先在 Chrome 中登录相关网站"
        }, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps(cookies, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
