// @ts-check
/**
 * E2E 抓取脚本 — 由 e2e-scraper scaffold 生成
 * 配置文件：scripts/config.json
 * 可根据目标网站定制下方提取逻辑
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 运行时配置（从 config.json 读取） ─────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

const DOMAIN = config.domain;
const TARGET_URL = config.targetUrl;
const OUTPUT_DIR = path.join(__dirname, '..', config.outputDir || 'output');
const IMG_DIR = path.join(OUTPUT_DIR, 'images');
const ITEMS_DIR = path.join(OUTPUT_DIR, 'posts');
const SCROLL_TIMES = config.scrollTimes || 0;
const SCROLL_DELAY = config.scrollDelayMs || 2500;

// ── Cookie 提取 ──────────────────────────────────────────

function getCookies(domain) {
  const script = path.join(__dirname, 'extract_cookies.py');
  const raw = execSync(`python3 "${script}" "${domain}"`, { encoding: 'utf-8' });
  return JSON.parse(raw);
}

function toPlaywrightCookies(cookies, domain) {
  const cleanDomain = domain.replace('www.', '');
  return Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: `.${cleanDomain}`,
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
  }));
}

// ── 图片下载 ──────────────────────────────────────────

function downloadImage(url, filePath) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: `https://${DOMAIN}/`,
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const ext = (res.headers['content-type']?.split('/')[1] || 'jpg').split(';')[0];
      const finalPath = filePath.includes('.') ? filePath : `${filePath}.${ext}`;
      const file = fs.createWriteStream(finalPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

// ── 通用：从 JSON 递归提取数据对象 ──────────────────────

function extractItemsFromResponse(json, rule, seenIds, collected) {
  if (!json || typeof json !== 'object') return;

  const idField = rule.dedupField || 'id';
  const identifier = rule.identifier || {};

  if (identifier.field) {
    if (json[identifier.field] === identifier.value) {
      const itemId = String(json[idField] ?? '');
      if (itemId && seenIds.has(itemId)) return;
      if (itemId) seenIds.add(itemId);

      const item = {};
      item.id = itemId;

      if (rule.textField) item.text = getNested(json, rule.textField) || '';
      if (rule.authorField) item.author = getNested(json, rule.authorField) || 'unknown';
      if (rule.urlField) item.url = getNested(json, rule.urlField) || '';
      if (rule.timeField) item.time = getNested(json, rule.timeField) || '';
      if (rule.imageField) {
        const imgs = getNested(json, rule.imageField) || [];
        item.images = Array.isArray(imgs) ? imgs.filter(Boolean) : [];
      } else {
        item.images = [];
      }

      collected.push(item);
      return;
    }
  }

  for (const val of Object.values(json)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        extractItemsFromResponse(item, rule, seenIds, collected);
      }
    } else if (val && typeof val === 'object') {
      extractItemsFromResponse(val, rule, seenIds, collected);
    }
  }
}

/** 通过点号路径安全获取嵌套值，支持 [] 展开数组 */
function getNested(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  const parts = pathStr.split('.');
  let current = obj;
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2);
      if (current && typeof current === 'object' && key in current) {
        const arr = current[key];
        if (Array.isArray(arr)) {
          const restPath = parts.slice(pi + 1).join('.');
          return arr.map(item => getNested(item, restPath)).filter(Boolean).flat();
        }
      }
      return [];
    }
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

// ═══════════════════════════════════════════════════════
// 【定制区域】特殊网站的提取逻辑写在这里
// 例如：针对 X.com 的 Tweet 结构、小红书图片等
// ═══════════════════════════════════════════════════════

/* 示例：X.com 专用的提取函数（取消注释后替换下面默认流程）
function extractXcomTweets(json, seenIds, collected) {
  // 自定义提取逻辑...
}
*/

// ── 保存数据 ──────────────────────────────────────────

async function saveItems(items) {
  const timestamp = Date.now();
  const itemsDir = path.join(ITEMS_DIR, `batch_${timestamp}`);
  fs.mkdirSync(itemsDir, { recursive: true });

  let savedCount = 0;
  let imgCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.text && (!item.images || item.images.length === 0)) continue;

    const content = [
      `# 条目 #${i + 1}`,
      `- **来源**: @${item.author || '未知'}`,
      `- **时间**: ${item.time || '未知'}`,
      `- **链接**: ${item.url || ''}`,
      `- **图片**: ${(item.images || []).length} 张`,
      '',
      '---',
      '',
      item.text || '(无文本内容)',
      '',
      '---',
      ...((item.images && item.images.length > 0)
        ? ['', '## 图片', '', ...item.images.map((_, j) => `![图片 ${j + 1}](../images/${item.id}_${j + 1}.jpg)`) ]
        : []),
    ].join('\n');

    const fileName = `${String(i + 1).padStart(3, '0')}_${item.id}.md`;
    fs.writeFileSync(path.join(itemsDir, fileName), content, 'utf-8');
    savedCount++;

    for (let j = 0; j < (item.images || []).length; j++) {
      const imgPath = path.join(IMG_DIR, `${item.id}_${j + 1}`);
      try {
        await downloadImage(item.images[j], imgPath);
        imgCount++;
        process.stdout.write('.');
      } catch {}
    }
  }

  return { savedCount, imgCount, itemsDir };
}

function generateSummary(items, stats) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E 结果 - ${new Date().toLocaleString()}</title>
<style>
  body { font: 14px/1.6 -apple-system, sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px; }
  h1 { border-bottom: 2px solid #eee; padding-bottom: 8px; }
  .item { border: 1px solid #e1e8ed; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .item .meta { color: #536471; font-size: 13px; margin-bottom: 8px; }
  .item .text { white-space: pre-wrap; word-wrap: break-word; margin-bottom: 12px; }
  .item .images img { max-width: 200px; max-height: 200px; margin: 4px; border-radius: 8px; border: 1px solid #eee; }
  .item .images { display: flex; flex-wrap: wrap; }
  .stats { background: #f7f9fa; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
</style>
</head>
<body>
<h1>E2E 抓取结果 - ${config.name}</h1>
<div class="stats">
  <p>共 <strong>${stats.total}</strong> 条 · 下载 <strong>${stats.images}</strong> 张图片 · 时间: ${stats.time}</p>
</div>
${items.map((item, i) => `
<div class="item">
  <div class="meta">@${item.author || '未知'}${item.url ? ' · <a href="' + item.url + '" target="_blank">链接</a>' : ''}${item.time ? ' · ' + item.time : ''}</div>
  <div class="text">${escapeHtml(item.text || '(无文本)')}</div>
  <div class="images">${(item.images || []).map((_, j) => '<img src="../images/' + item.id + '_' + (j + 1) + '.jpg" alt="" loading="lazy">').join('')}</div>
</div>`).join('\n')}
</body>
</html>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf-8');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 主流程 ──────────────────────────────────────────

async function main() {
  // 1. 提取 cookie
  console.log(`正在提取 ${DOMAIN} 的 cookie...`);
  const rawCookies = getCookies(DOMAIN);
  if (rawCookies.error) {
    console.error(`失败: ${rawCookies.error}`);
    process.exit(1);
  }
  console.log(`成功提取 ${Object.keys(rawCookies).length} 个 cookie`);

  // 2. 创建目录
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(ITEMS_DIR, { recursive: true });

  // 3. 启动浏览器
  const browser = await chromium.launch({ headless: config.headless ?? false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // 4. 注入 cookie
  await context.addCookies(toPlaywrightCookies(rawCookies, DOMAIN));
  const page = await context.newPage();

  // 5. 监听网络
  const seenIds = new Set();
  const allItems = [];

  page.on('response', async response => {
    const url = response.url();

    // json-recursive 模式
    const jsonRules = config.networkPatterns.filter(r => r.extractType === 'json-recursive');
    for (const rule of jsonRules) {
      if (!url.includes(rule.urlPattern)) continue;
      try {
        const json = await response.json();
        const before = allItems.length;
        extractItemsFromResponse(json, rule, seenIds, allItems);
        const gained = allItems.length - before;
        if (gained > 0) {
          console.log(`  [${rule.description || rule.urlPattern}] 捕获 ${gained} 条 (累计 ${allItems.length})`);
        }
      } catch {}
    }

    // url-collect 模式
    const urlRules = config.networkPatterns.filter(r => r.extractType === 'url-collect');
    for (const rule of urlRules) {
      if (!url.includes(rule.urlPattern)) continue;
      const imgUrl = url.split('?')[0];
      if (!seenIds.has(imgUrl)) {
        seenIds.add(imgUrl);
        allItems.push({
          id: String(imgUrl).replace(/[^a-zA-Z0-9]/g, '_'),
          text: '',
          author: 'unknown',
          images: [url],
          url: url,
          time: '',
        });
        console.log(`  [${rule.description || '收集图片'}] 捕获图片`);
      }
    }
  });

  // 6. 打开目标页面
  console.log(`\n正在打开 ${TARGET_URL} ...`);
  await page.goto(TARGET_URL, { waitUntil: config.waitUntil || 'load', timeout: 90000 });
  console.log(`当前页面: ${page.url()}`);

  // 等待选择器
  const selectors = config.waitSelectors || [];
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 15000 });
      console.log(`  选择器 OK: ${sel}`);
    } catch {
      console.warn(`  选择器超时: ${sel}`);
    }
  }

  console.log(`\n当前捕获: ${allItems.length} 条`);

  // 7. 滚动加载
  if (SCROLL_TIMES > 0) {
    console.log(`\n开始滚动加载 (${SCROLL_TIMES} 次)...`);
    for (let i = 0; i < SCROLL_TIMES; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_DELAY);
      if ((i + 1) % 5 === 0) {
        console.log(`  滚动 ${i + 1}/${SCROLL_TIMES}，捕获 ${allItems.length} 条`);
      }
    }
  }

  console.log(`\n✅ 网络监听完成，共 ${allItems.length} 条`);

  // 8. DOM 兜底
  if (allItems.length === 0 && config.domExtract) {
    const de = config.domExtract;
    console.log('\n尝试 DOM 提取兜底...');
    try {
      const domItems = await page.evaluate((extract) => {
        const sel = extract.waitSelector || '*';
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map((el, i) => {
          const result = { id: `dom_${Date.now()}_${i}`, text: '', author: 'unknown', images: [], url: '', time: '' };
          if (!extract.fields) return result;
          if (extract.fields.text) {
            const f = extract.fields.text;
            const node = f.selector ? el.querySelector(f.selector) : el;
            result.text = node?.[f.attribute || 'textContent'] || '';
          }
          if (extract.fields.images) {
            const f = extract.fields.images;
            const nodes = f.multiple ? el.querySelectorAll(f.selector) : [el.querySelector(f.selector)];
            result.images = Array.from(nodes).map(n => n?.[f.attribute || 'src'] || '').filter(Boolean);
          }
          if (extract.fields.author) {
            const f = extract.fields.author;
            const node = f.selector ? el.querySelector(f.selector) : el;
            result.author = node?.[f.attribute || 'textContent'] || 'unknown';
          }
          return result;
        });
      }, de);
      console.log(`DOM 提取到 ${domItems.length} 条`);
      for (const item of domItems) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
    } catch (err) {
      console.warn('DOM 提取失败:', err.message);
    }
  }

  // 截图
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshot.png'), fullPage: false });

  if (allItems.length === 0) {
    console.log('\n❌ 未捕获到任何数据');
    await browser.close();
    process.exit(1);
  }

  // 9. 保存数据
  console.log('\n正在保存与下载图片...');
  const { savedCount, imgCount } = await saveItems(allItems);

  generateSummary(allItems, {
    total: allItems.length,
    images: imgCount,
    time: new Date().toLocaleString(),
  });

  console.log(`\n┌─────────────────────────────────────┐`);
  console.log(`│ ✅  E2E 完成！                      │`);
  console.log(`│  条目: ${String(savedCount).padStart(3)} 条`);
  console.log(`│  图片: ${String(imgCount).padStart(3)} 张`);
  console.log(`│  输出: ${OUTPUT_DIR}`);
  console.log(`└─────────────────────────────────────┘`);

  await browser.close();
}

main().catch(err => {
  console.error('\nE2E 失败:', err);
  process.exit(1);
});
