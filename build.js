/*
 * 產生單一檔案版本（不需伺服器，直接雙擊開啟即可對電腦）
 *   node build.js
 * 輸出：dist/dark-chess.html（暗棋完整網頁）、dist/artifact.html（給 Claude Artifact 發布用，兩個遊戲在同一頁）、
 *       dist/chess-mahjong.html（象棋麻將完整網頁）
 * 單檔版本沒有其他頁面可連，上方的遊戲切換列會換成目前遊戲的名稱
 */
'use strict';
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const appBody = page => read(page).match(/<!--APP-START-->([\s\S]*?)<!--APP-END-->/)[1];
// 單檔版本沒有其他頁面可連：切換列換成目前遊戲的名稱
const stripNav = body => body.replace(/<!--NAV-START-->[\s\S]*?aria-current="page">([^<]*)<\/a>[\s\S]*?<!--NAV-END-->/, '<span>$1</span>');

function bundle(page, cssFiles, jsFiles) {
  const html = read(page);
  const css = cssFiles.map(read).join('\n');
  const js = jsFiles.map(read).join('\n');
  const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
  const title = html.match(/<title>.*<\/title>/)[0];
  const body = stripNav(appBody(page));
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const fragment = `${title}\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>\n${safeJs}\n</script>\n`;
  const full = `<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${title}\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n<script>\n${safeJs}\n</script>\n</body>\n</html>\n`;
  return { fragment, full };
}

const chess = bundle('index.html', ['client/style.css'], ['shared/engine.js', 'shared/ai.js', 'client/app.js']);
const mj = bundle('mahjong.html', ['client/style.css', 'client/mahjong.css'], ['shared/chessmahjong.js', 'shared/chessmahjong-ai.js', 'client/mahjong.js']);

// Artifact：兩個遊戲放在同一頁，上方切換列改成頁內切換
const navSwitch = `
(function () {
  var games = document.querySelectorAll('[data-game]');
  function show(name) {
    Array.prototype.forEach.call(games, function (g) { g.hidden = g.dataset.game !== name; });
    try { localStorage.setItem('site-game', name); } catch (e) {}
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('.site-nav a');
    if (!a) return;
    e.preventDefault();
    show(/mahjong/.test(a.getAttribute('href')) ? 'mahjong' : 'chess');
  });
  var saved = null;
  try { saved = localStorage.getItem('site-game'); } catch (e) {}
  if (saved === 'mahjong') show('mahjong');
})();
`;
const artifactCss = ['client/style.css', 'client/mahjong.css'].map(read).join('\n');
const artifactJs = ['shared/engine.js', 'shared/ai.js', 'client/app.js', 'shared/chessmahjong.js', 'shared/chessmahjong-ai.js', 'client/mahjong.js'].map(read).join('\n') + navSwitch;
const fontsLink = read('index.html').match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
const artifact = `<title>象棋好好玩</title>\n${fontsLink}\n<style>\n${artifactCss}</style>\n` +
  `<div data-game="chess">${appBody('index.html')}</div>\n<div data-game="mahjong" hidden>${appBody('mahjong.html')}</div>\n` +
  `<script>\n${artifactJs.replace(/<\/script/gi, '<\\/script')}\n</script>\n`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/dark-chess.html'), chess.full);
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), artifact);
fs.writeFileSync(path.join(__dirname, 'dist/chess-mahjong.html'), mj.full);
console.log('已輸出 dist/dark-chess.html、dist/artifact.html、dist/chess-mahjong.html');
