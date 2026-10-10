/*
 * 產生單一檔案版本（不需伺服器，直接雙擊開啟即可對電腦或同機雙人）
 *   node build.js
 * 輸出：dist/dark-chess.html（完整網頁）、dist/artifact.html（給 Claude Artifact 發布用的片段）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const html = read('index.html');
const css = read('client/style.css');
const js = ['shared/engine.js', 'shared/ai.js', 'client/app.js'].map(read).join('\n');
const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
const title = html.match(/<title>.*<\/title>/)[0];
const body = html.match(/<!--APP-START-->([\s\S]*?)<!--APP-END-->/)[1];
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const fragment = `${title}\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>\n${safeJs}\n</script>\n`;
const artifact = fragment;
const full = `<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${fragment.replace(body, '').replace(/<script>[\s\S]*<\/script>\n/, '')}</head>\n<body>\n${body}\n<script>\n${safeJs}\n</script>\n</body>\n</html>\n`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/dark-chess.html'), full);
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), artifact);
console.log('已輸出 dist/dark-chess.html 與 dist/artifact.html');
