/*
 * 產生單一檔案版本（不需伺服器，直接雙擊開啟即可對電腦）
 *   node build.js
 * 輸出：dist/dark-chess.html（暗棋完整網頁）、dist/artifact.html（給 Claude Artifact 發布用的暗棋片段）、
 *       dist/chess-mahjong.html（象棋麻將完整網頁）
 * 單檔版本沒有其他頁面可連，會拿掉上方的遊戲切換列
 */
'use strict';
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

function bundle(page, cssFiles, jsFiles) {
  const html = read(page);
  const css = cssFiles.map(read).join('\n');
  const js = jsFiles.map(read).join('\n');
  const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
  const title = html.match(/<title>.*<\/title>/)[0];
  const body = html.match(/<!--APP-START-->([\s\S]*?)<!--APP-END-->/)[1].replace(/\n[ \t]*<!--NAV-START-->[\s\S]*?<!--NAV-END-->/, '');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const fragment = `${title}\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>\n${safeJs}\n</script>\n`;
  const full = `<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${title}\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n<script>\n${safeJs}\n</script>\n</body>\n</html>\n`;
  return { fragment, full };
}

const chess = bundle('index.html', ['client/style.css'], ['shared/engine.js', 'shared/ai.js', 'client/app.js']);
const mj = bundle('mahjong.html', ['client/style.css', 'client/mahjong.css'], ['shared/chessmahjong.js', 'shared/chessmahjong-ai.js', 'client/mahjong.js']);

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/dark-chess.html'), chess.full);
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), chess.fragment);
fs.writeFileSync(path.join(__dirname, 'dist/chess-mahjong.html'), mj.full);
console.log('已輸出 dist/dark-chess.html、dist/artifact.html、dist/chess-mahjong.html');
