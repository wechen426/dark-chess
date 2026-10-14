/*
 * 象棋麻將（32 子型）規則引擎，瀏覽器與 Node 共用
 * 規則依 https://www.eastking.com.tw/blog/posts/chess-mahjong-playguide
 * - 一副象棋 32 子當牌，2～4 人，莊家 5 張、閒家 4 張，莊家先打
 * - 胡牌：一組面子 + 一對；或「五兵（卒）」
 * - 面子：順子（同色 帥仕相 / 俥傌炮）、刻子（同色同字三張）、槓子（四張）
 * - 對子：同色同字兩張，帥將也可湊成一對
 * - 吃只能吃上家，碰槓任一家；同時宣告時 胡 > 碰槓 > 吃
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessMahjong = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['K', 'A', 'E', 'R', 'H', 'C', 'P'];
  var COUNT = { K: 1, A: 2, E: 2, R: 2, H: 2, C: 2, P: 5 };
  var NAMES = {
    r: { K: '帥', A: '仕', E: '相', R: '俥', H: '傌', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', R: '車', H: '馬', C: '包', P: '卒' }
  };
  var SEQS = [['K', 'A', 'E'], ['R', 'H', 'C']];
  var KINDS = []; // 14 種牌：rK rA ... bP
  ['r', 'b'].forEach(function (c) { TYPES.forEach(function (t) { KINDS.push(c + t); }); });

  // 牌：0..31，tile(id) -> 'rK' 這種種類代碼
  var TILE = [];
  ['r', 'b'].forEach(function (c) {
    TYPES.forEach(function (t) { for (var i = 0; i < COUNT[t]; i++) TILE.push(c + t); });
  });

  function kind(id) { return TILE[id]; }
  function name(k) { return NAMES[k[0]][k[1]]; }
  function order(k) { return (k[0] === 'r' ? 0 : 10) + TYPES.indexOf(k[1]); }
  function sortTiles(ids) { return ids.slice().sort(function (a, b) { return order(kind(a)) - order(kind(b)) || a - b; }); }

  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  // ---------- 牌型判斷（以種類代碼陣列運算） ----------
  function isPair(a, b) { return a === b || (a[1] === 'K' && b[1] === 'K'); }
  function isMeld3(ks) {
    if (ks.length !== 3) return false;
    if (ks[0] === ks[1] && ks[1] === ks[2]) return true;
    var c = ks[0][0];
    if (ks[1][0] !== c || ks[2][0] !== c) return false;
    var ts = ks.map(function (k) { return k[1]; }).sort().join('');
    return SEQS.some(function (s) { return s.slice().sort().join('') === ts; });
  }

  // 手中暗牌能否拆成 (n-2)/3 組面子 + 一對
  function completes(ks) {
    if (ks.length % 3 !== 2) return false;
    if (ks.length === 2) return isPair(ks[0], ks[1]);
    var first = ks[0], rest = ks.slice(1);
    for (var i = 0; i < rest.length; i++) for (var j = i + 1; j < rest.length; j++) {
      if (isMeld3([first, rest[i], rest[j]])) {
        var left = rest.filter(function (_, x) { return x !== i && x !== j; });
        if (completes(left)) return true;
      }
    }
    // first 當對子的一張
    for (var p = 0; p < rest.length; p++) {
      if (isPair(first, rest[p])) {
        var others = rest.filter(function (_, x) { return x !== p; });
        if (allMelds(others)) return true;
      }
    }
    return false;
  }
  function allMelds(ks) {
    if (ks.length === 0) return true;
    if (ks.length % 3) return false;
    var first = ks[0], rest = ks.slice(1);
    for (var i = 0; i < rest.length; i++) for (var j = i + 1; j < rest.length; j++) {
      if (isMeld3([first, rest[i], rest[j]])) {
        if (allMelds(rest.filter(function (_, x) { return x !== i && x !== j; }))) return true;
      }
    }
    return false;
  }

  // 完整的胡牌判斷：concealed 是暗牌種類，melds 是已亮出的面子
  // 回傳 null 或 { pattern: '五兵' | '順子＋對子' ... }
  function winPattern(concealedKinds, melds) {
    if (concealedKinds.length + 3 * melds.length !== 5) return null;
    var all = concealedKinds.slice();
    melds.forEach(function (m) { if (m.type !== 'kan') m.tiles.forEach(function (id) { all.push(kind(id)); }); });
    var hasKan = melds.some(function (m) { return m.type === 'kan'; });
    if (!hasKan && all.length === 5 && all.every(function (k) { return k === all[0] && k[1] === 'P'; })) {
      return { pattern: k5name(all[0]) };
    }
    if (!completes(concealedKinds)) return null;
    // 說明牌型
    var meldType = null;
    if (melds.length) meldType = melds[0].type === 'chi' ? '順子' : melds[0].type === 'pon' ? '刻子' : '槓子';
    else {
      for (var i = 0; i < 5 && !meldType; i++) for (var j = i + 1; j < 5 && !meldType; j++) {
        var rest = concealedKinds.filter(function (_, x) { return x !== i && x !== j; });
        if (isPair(concealedKinds[i], concealedKinds[j]) && isMeld3(rest)) meldType = rest[0] === rest[1] ? '刻子' : '順子';
      }
    }
    return { pattern: meldType + '＋對子' };
  }
  function k5name(k) { return '五' + name(k); }

  // ---------- 對局狀態 ----------
  function newGame(opts) {
    opts = opts || {};
    var n = Math.max(2, Math.min(4, opts.players || 4));
    var dealer = opts.dealer || 0;
    var wall = shuffle(TILE.map(function (_, i) { return i; }), opts.rnd);
    var s = {
      n: n, dealer: dealer, wall: wall,
      hands: [], melds: [], discards: [],
      turn: dealer, phase: 'discard', drawn: null,
      pending: null, // 打出的牌等待宣告 { tile, from }
      result: null,  // { type: 'win'|'draw', winner, from, self, pattern, tile }
      log: []
    };
    for (var p = 0; p < n; p++) { s.hands.push([]); s.melds.push([]); s.discards.push([]); }
    for (var k = 0; k < n; k++) {
      var seat = (dealer + k) % n, cnt = seat === dealer ? 5 : 4;
      for (var c = 0; c < cnt; c++) s.hands[seat].push(s.wall.pop());
    }
    s.drawn = s.hands[dealer][4];
    return s;
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function kindsOf(ids) { return ids.map(kind); }
  function next(s, p) { return (p + 1) % s.n; }

  // 輪到的人（phase=discard）可做的動作
  function turnActions(s) {
    if (s.result || s.phase !== 'discard') return [];
    var p = s.turn, hand = s.hands[p], acts = [];
    if (winPattern(kindsOf(hand), s.melds[p])) acts.push({ type: 'tsumo' });
    if (s.wall.length) {
      // 暗槓：手上四張同字
      var seen = {};
      hand.forEach(function (id) {
        var k = kind(id); if (seen[k]) return; seen[k] = true;
        var same = hand.filter(function (x) { return kind(x) === k; });
        if (same.length >= 4) acts.push({ type: 'ankan', tiles: same.slice(0, 4) });
      });
      // 加槓：已碰的刻子摸到第四張
      s.melds[p].forEach(function (m, mi) {
        if (m.type !== 'pon') return;
        var k = kind(m.tiles[0]);
        hand.forEach(function (id) { if (kind(id) === k) acts.push({ type: 'kakan', meld: mi, tile: id }); });
      });
    }
    hand.forEach(function (id) { acts.push({ type: 'discard', tile: id }); });
    return acts;
  }

  // 別人打出牌後，玩家 p 可以宣告的動作（不含「過」）
  function claimOptions(s, p) {
    if (s.result || s.phase !== 'claim' || !s.pending || p === s.pending.from) return [];
    var t = s.pending.tile, k = kind(t), hand = s.hands[p], opts = [];
    if (winPattern(kindsOf(hand).concat([k]), s.melds[p])) opts.push({ type: 'ron' });
    var same = hand.filter(function (x) { return kind(x) === k; });
    if (same.length >= 2) opts.push({ type: 'pon', tiles: same.slice(0, 2) });
    if (same.length >= 3 && s.wall.length) opts.push({ type: 'kan', tiles: same.slice(0, 3) });
    if (p === next(s, s.pending.from)) {
      SEQS.forEach(function (seq) {
        if (k[1] === 'P' || seq.indexOf(k[1]) < 0) return;
        var need = seq.filter(function (x) { return x !== k[1]; }).map(function (x) { return k[0] + x; });
        var a = hand.filter(function (x) { return kind(x) === need[0]; })[0];
        var b = hand.filter(function (x) { return kind(x) === need[1]; })[0];
        if (a !== undefined && b !== undefined) opts.push({ type: 'chi', tiles: [a, b] });
      });
    }
    return opts;
  }

  function removeTiles(hand, ids) { ids.forEach(function (id) { hand.splice(hand.indexOf(id), 1); }); }
  function drawFor(s, p, fromBack) {
    if (!s.wall.length) return null;
    var id = fromBack ? s.wall.shift() : s.wall.pop();
    s.hands[p].push(id); s.drawn = id;
    return id;
  }
  function setDraw(s) {
    s.result = { type: 'draw' }; s.phase = 'over'; s.pending = null;
    s.log.push({ type: 'draw' });
  }

  // 輪到的人動作：tsumo / ankan / kakan / discard
  function applyTurn(s, a) {
    var p = s.turn, hand = s.hands[p];
    if (a.type === 'tsumo') {
      var w = winPattern(kindsOf(hand), s.melds[p]);
      s.result = { type: 'win', winner: p, self: true, pattern: w.pattern, tile: s.drawn };
      s.phase = 'over'; s.log.push({ type: 'tsumo', p: p, tile: s.drawn });
    } else if (a.type === 'ankan') {
      removeTiles(hand, a.tiles);
      s.melds[p].push({ type: 'kan', tiles: a.tiles, concealed: true });
      s.log.push({ type: 'ankan', p: p, tile: a.tiles[0] });
      drawFor(s, p, true);
    } else if (a.type === 'kakan') {
      removeTiles(hand, [a.tile]);
      var m = s.melds[p][a.meld];
      m.type = 'kan'; m.tiles.push(a.tile);
      s.log.push({ type: 'kakan', p: p, tile: a.tile });
      drawFor(s, p, true);
    } else if (a.type === 'discard') {
      removeTiles(hand, [a.tile]);
      s.discards[p].push(a.tile);
      s.pending = { tile: a.tile, from: p };
      s.phase = 'claim'; s.drawn = null;
      s.log.push({ type: 'discard', p: p, tile: a.tile });
    }
    return s;
  }

  function sameAct(a, b) {
    return a.type === b.type && JSON.stringify(a.tiles || []) === JSON.stringify(b.tiles || []) && a.tile === b.tile && a.meld === b.meld;
  }
  function isLegalTurn(s, a) { return turnActions(s).some(function (x) { return sameAct(x, a); }); }

  // 解決宣告：choices[p] = 動作或 null（過）；依 胡 > 碰槓 > 吃，同級時離打牌者最近的人優先
  function resolveClaims(s, choices) {
    var from = s.pending.from, t = s.pending.tile;
    var rank = { ron: 3, pon: 2, kan: 2, chi: 1 };
    var best = null, bestP = -1;
    for (var d = 1; d < s.n; d++) {
      var p = (from + d) % s.n, c = choices[p];
      if (!c) continue;
      if (!claimOptions(s, p).some(function (x) { return sameAct(x, c); })) continue;
      if (!best || rank[c.type] > rank[best.type]) { best = c; bestP = p; }
    }
    if (!best) {
      // 沒人要：下家摸牌
      s.pending = null;
      var np = next(s, from);
      if (!s.wall.length) { setDraw(s); return s; }
      s.turn = np; s.phase = 'discard';
      drawFor(s, np);
      s.log.push({ type: 'draw-tile', p: np });
      return s;
    }
    var pile = s.discards[from]; pile.splice(pile.lastIndexOf(t), 1);
    s.pending = null;
    if (best.type === 'ron') {
      var hand = s.hands[bestP].concat([t]);
      var w = winPattern(kindsOf(hand), s.melds[bestP]);
      s.hands[bestP].push(t);
      s.result = { type: 'win', winner: bestP, self: false, from: from, pattern: w.pattern, tile: t };
      s.phase = 'over'; s.log.push({ type: 'ron', p: bestP, from: from, tile: t });
      return s;
    }
    removeTiles(s.hands[bestP], best.tiles);
    var tiles = best.type === 'chi' ? sortTiles(best.tiles.concat([t])) : best.tiles.concat([t]);
    s.melds[bestP].push({ type: best.type, tiles: tiles, from: from });
    s.log.push({ type: best.type, p: bestP, from: from, tile: t });
    s.turn = bestP; s.phase = 'discard'; s.drawn = null;
    if (best.type === 'kan') drawFor(s, bestP, true);
    return s;
  }

  // 聽牌：再一張就胡的牌種（hand 為打牌後的手牌）
  function waits(handIds, melds) {
    var ks = kindsOf(handIds);
    return KINDS.filter(function (k) { return winPattern(ks.concat([k]), melds); });
  }

  // 對 p 來說還看不到的牌（牆 + 別人手牌）各種剩幾張
  function unseen(s, p) {
    var cnt = {};
    KINDS.forEach(function (k) { cnt[k] = 0; });
    TILE.forEach(function (k) { cnt[k]++; });
    var dec = function (id) { cnt[kind(id)]--; };
    s.hands[p].forEach(dec);
    for (var q = 0; q < s.n; q++) {
      s.discards[q].forEach(dec);
      s.melds[q].forEach(function (m) { m.tiles.forEach(dec); });
    }
    return cnt;
  }

  // 給玩家 p 看的狀態：別人的手牌和牌牆遮住
  function masked(s, p) {
    var m = clone(s);
    for (var q = 0; q < m.n; q++) if (q !== p && !(m.result && m.result.type)) m.hands[q] = m.hands[q].map(function () { return -1; });
    m.wall = m.wall.map(function () { return -1; });
    if (m.turn !== p) m.drawn = null;
    m.melds.forEach(function (ms) { ms.forEach(function (x) { if (x.concealed && !m.result) x.tiles = x.tiles.map(function (id, i) { return i === 1 || i === 2 ? id : -1; }); }); });
    return m;
  }

  return {
    TILE: TILE, KINDS: KINDS, NAMES: NAMES,
    kind: kind, name: name, sortTiles: sortTiles, isPair: isPair, isMeld3: isMeld3,
    winPattern: winPattern, newGame: newGame, clone: clone,
    turnActions: turnActions, claimOptions: claimOptions, applyTurn: applyTurn, isLegalTurn: isLegalTurn,
    resolveClaims: resolveClaims, waits: waits, unseen: unseen, masked: masked, next: next
  };
});
