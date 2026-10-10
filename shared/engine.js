/*
 * 暗棋規則引擎（瀏覽器與 Node 共用）
 * 棋盤 4 列 x 8 行，位置索引 idx = row * 8 + col
 * 模式：classic 一般暗棋；chain 連棋（吃子後同一顆棋可繼續吃）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DarkChess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 4, COLS = 8, SIZE = 32;
  var RANK = { K: 7, A: 6, E: 5, R: 4, H: 3, C: 2, P: 1 };
  var COUNTS = { K: 1, A: 2, E: 2, R: 2, H: 2, C: 2, P: 5 };
  var NAMES = {
    r: { K: '帥', A: '仕', E: '相', R: '俥', H: '傌', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', R: '車', H: '馬', C: '包', P: '卒' }
  };
  var COLOR_NAME = { r: '紅', b: '黑' };
  var NO_PROGRESS_LIMIT = 50; // 連續 50 手沒有翻棋或吃子判和

  function rowOf(i) { return (i / COLS) | 0; }
  function colOf(i) { return i % COLS; }

  function neighbors(i) {
    var r = rowOf(i), c = colOf(i), out = [];
    if (r > 0) out.push(i - COLS);
    if (r < ROWS - 1) out.push(i + COLS);
    if (c > 0) out.push(i - 1);
    if (c < COLS - 1) out.push(i + 1);
    return out;
  }
  var NEIGHBORS = [];
  for (var n = 0; n < SIZE; n++) NEIGHBORS.push(neighbors(n));

  // 每個位置往四個方向的射線（炮用）
  var RAYS = [];
  for (var p = 0; p < SIZE; p++) {
    var rays = [], dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      var ray = [], rr = rowOf(p) + dirs[d][0], cc = colOf(p) + dirs[d][1];
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
        ray.push(rr * COLS + cc);
        rr += dirs[d][0]; cc += dirs[d][1];
      }
      rays.push(ray);
    }
    RAYS.push(rays);
  }

  function makeRng(seed) {
    if (seed == null) return Math.random;
    var s = seed >>> 0;
    return function () { // mulberry32
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newGame(opts) {
    opts = opts || {};
    var rng = makeRng(opts.seed);
    var pieces = [];
    ['r', 'b'].forEach(function (c) {
      Object.keys(COUNTS).forEach(function (t) {
        for (var k = 0; k < COUNTS[t]; k++) pieces.push({ t: t, c: c, up: false });
      });
    });
    for (var i = pieces.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pieces[i]; pieces[i] = pieces[j]; pieces[j] = tmp;
    }
    return {
      board: pieces,
      mode: opts.mode === 'chain' ? 'chain' : 'classic',
      turn: 0,             // 輪到的玩家（0 或 1）
      colors: [null, null],// 玩家顏色，第一次翻棋決定
      chain: null,         // 連吃中的棋子位置
      chainCount: 0,
      noProgress: 0,
      ply: 0,
      captured: { r: [], b: [] }, // 被吃掉的棋子（依顏色）
      winner: null,        // 0 / 1 / 'draw'
      reason: '',
      last: null
    };
  }

  function clone(s) {
    return {
      board: s.board.map(function (x) { return x ? { t: x.t, c: x.c, up: x.up } : null; }),
      mode: s.mode, turn: s.turn, colors: s.colors.slice(), chain: s.chain,
      chainCount: s.chainCount, noProgress: s.noProgress, ply: s.ply,
      captured: { r: s.captured.r.slice(), b: s.captured.b.slice() },
      winner: s.winner, reason: s.reason, last: s.last
    };
  }

  // 攻擊方（非炮）能否吃防守方
  function outranks(a, d) {
    if (a.t === 'K' && d.t === 'P') return false; // 帥不能吃兵
    if (a.t === 'P' && d.t === 'K') return true;  // 兵可以吃帥
    return RANK[a.t] >= RANK[d.t];
  }

  // 位置 from 上的明棋可吃的位置
  function capturesFrom(board, from) {
    var pc = board[from], out = [];
    if (!pc || !pc.up) return out;
    if (pc.t === 'C') {
      var rays = RAYS[from];
      for (var d = 0; d < 4; d++) {
        var ray = rays[d], screened = false;
        for (var k = 0; k < ray.length; k++) {
          var q = board[ray[k]];
          if (!q) continue;
          if (!screened) { screened = true; continue; } // 炮架（明暗皆可）
          if (q.up && q.c !== pc.c) out.push(ray[k]);
          break;
        }
      }
    } else {
      var nb = NEIGHBORS[from];
      for (var m = 0; m < nb.length; m++) {
        var t = board[nb[m]];
        if (t && t.up && t.c !== pc.c && outranks(pc, t)) out.push(nb[m]);
      }
    }
    return out;
  }

  // 連棋模式：明棋可攻擊上下左右相鄰的暗棋（翻開後判定）
  function attacksFrom(board, from) {
    var pc = board[from], out = [];
    if (pc && pc.t === 'C') { // 炮包：隔一顆棋（炮架）跳著攻擊暗棋
      var rays = RAYS[from];
      for (var d = 0; d < 4; d++) {
        var ray = rays[d], screened = false;
        for (var k = 0; k < ray.length; k++) {
          var q = board[ray[k]];
          if (!q) continue;
          if (!screened) { screened = true; continue; }
          if (!q.up) out.push(ray[k]);
          break;
        }
      }
      return out;
    }
    var nb = NEIGHBORS[from];
    for (var m = 0; m < nb.length; m++) { var t = board[nb[m]]; if (t && !t.up) out.push(nb[m]); }
    return out;
  }

  function chainTargets(board, from) {
    return attacksFrom(board, from).concat(capturesFrom(board, from));
  }

  function stepsFrom(board, from) {
    var nb = NEIGHBORS[from], out = [];
    for (var m = 0; m < nb.length; m++) if (!board[nb[m]]) out.push(nb[m]);
    return out;
  }

  function colorOf(s, player) { return s.colors[player]; }

  // 列出目前玩家所有合法動作
  function legalActions(s) {
    var acts = [];
    if (s.winner !== null) return acts;
    if (s.chain !== null) {
      // 連吃中：同一顆棋可繼續攻擊暗棋，或吃掉吃得掉的敵方明棋（同級可吃，先動先吃）
      chainTargets(s.board, s.chain).forEach(function (to) {
        acts.push({ type: 'move', from: s.chain, to: to });
      });
      acts.push({ type: 'end' });
      return acts;
    }
    var col = colorOf(s, s.turn);
    for (var i = 0; i < SIZE; i++) {
      var pc = s.board[i];
      if (!pc) continue;
      if (!pc.up) { acts.push({ type: 'flip', at: i }); continue; }
      if (pc.c !== col) continue;
      capturesFrom(s.board, i).forEach(function (to) { acts.push({ type: 'move', from: i, to: to }); });
      if (s.mode === 'chain') attacksFrom(s.board, i).forEach(function (to) { acts.push({ type: 'move', from: i, to: to }); });
      stepsFrom(s.board, i).forEach(function (to) { acts.push({ type: 'move', from: i, to: to }); });
    }
    return acts;
  }

  function isLegal(s, a) {
    if (!a || s.winner !== null) return false;
    var acts = legalActions(s);
    for (var i = 0; i < acts.length; i++) {
      var b = acts[i];
      if (b.type !== a.type) continue;
      if (b.type === 'end') return true;
      if (b.type === 'flip' && b.at === a.at) return true;
      if (b.type === 'move' && b.from === a.from && b.to === a.to) return true;
    }
    return false;
  }

  function endTurn(s) {
    s.chain = null;
    s.chainCount = 0;
    s.turn = 1 - s.turn;
    s.ply++;
    checkResult(s);
  }

  function remaining(s, color) {
    return 16 - s.captured[color].length;
  }

  function checkResult(s) {
    var me = s.turn, col = s.colors[me];
    if (col && remaining(s, col) === 0) {
      s.winner = 1 - me; s.reason = COLOR_NAME[col] + '方棋子全被吃光'; return;
    }
    var other = s.colors[1 - me];
    if (other && remaining(s, other) === 0) {
      s.winner = me; s.reason = COLOR_NAME[other] + '方棋子全被吃光'; return;
    }
    if (legalActions(s).length === 0) {
      s.winner = 1 - me; s.reason = '無棋可走'; return;
    }
    if (s.noProgress >= NO_PROGRESS_LIMIT) {
      s.winner = 'draw'; s.reason = '連續 ' + NO_PROGRESS_LIMIT + ' 手未翻棋或吃子';
    }
  }

  // 套用動作（會修改 s），回傳 s。呼叫前應先 isLegal 檢查。
  function apply(s, a) {
    var me = s.turn;
    if (a.type === 'flip') {
      var pc = s.board[a.at];
      pc.up = true;
      if (!s.colors[me]) {
        s.colors[me] = pc.c;
        s.colors[1 - me] = pc.c === 'r' ? 'b' : 'r';
      }
      s.noProgress = 0;
      s.last = { type: 'flip', at: a.at, player: me, piece: { t: pc.t, c: pc.c } };
      endTurn(s);
    } else if (a.type === 'move' && s.board[a.to] && !s.board[a.to].up) {
      // 連棋：攻擊暗棋。翻開後：可吃的敵棋→吃掉並可續攻；自己的棋→停止；比自己大的敵棋→己方陣亡
      var att = s.board[a.from], hid = s.board[a.to];
      hid.up = true;
      s.noProgress = 0;
      var info = { type: 'attack', from: a.from, to: a.to, player: me, piece: { t: att.t, c: att.c }, revealed: { t: hid.t, c: hid.c }, chain: s.chainCount + 1 };
      if (hid.c === att.c) {
        info.result = 'own';
      } else if (att.t === 'C' || outranks(att, hid)) { // 炮包跳吃不比階級
        info.result = 'capture';
        s.board[a.to] = att; s.board[a.from] = null;
        s.captured[hid.c].push(hid.t);
      } else {
        info.result = 'die';
        s.board[a.from] = null;
        s.captured[att.c].push(att.t);
      }
      s.last = info;
      if (info.result === 'capture' && remaining(s, hid.c) > 0 && chainTargets(s.board, a.to).length > 0) {
        s.chain = a.to;
        s.chainCount++;
        return s;
      }
      endTurn(s);
    } else if (a.type === 'move') {
      var mover = s.board[a.from], target = s.board[a.to];
      s.board[a.to] = mover;
      s.board[a.from] = null;
      if (target) {
        s.captured[target.c].push(target.t);
        s.noProgress = 0;
        s.last = { type: 'capture', from: a.from, to: a.to, player: me, piece: { t: mover.t, c: mover.c }, victim: { t: target.t, c: target.c }, chain: s.chainCount + 1 };
        // 連棋模式：吃明棋後，同一顆棋還有目標就可以繼續連吃
        if (s.mode === 'chain' && remaining(s, target.c) > 0 && chainTargets(s.board, a.to).length > 0) {
          s.chain = a.to;
          s.chainCount++;
          return s;
        }
      } else {
        s.noProgress++;
        s.last = { type: 'move', from: a.from, to: a.to, player: me, piece: { t: mover.t, c: mover.c } };
      }
      endTurn(s);
    } else if (a.type === 'end') {
      s.last = { type: 'end', player: me, at: s.chain };
      endTurn(s);
    }
    return s;
  }

  // 給連線用：把未翻開的棋子內容遮掉
  function masked(s) {
    var c = clone(s);
    c.board = c.board.map(function (x) { return x && !x.up ? { up: false } : x; });
    return c;
  }

  // 未翻開棋子的種類統計（公開資訊）
  function hiddenPool(s) {
    var pool = {};
    ['r', 'b'].forEach(function (c) {
      Object.keys(COUNTS).forEach(function (t) { pool[c + t] = COUNTS[t]; });
    });
    s.board.forEach(function (x) { if (x && x.up) pool[x.c + x.t]--; });
    ['r', 'b'].forEach(function (c) { s.captured[c].forEach(function (t) { pool[c + t]--; }); });
    return pool;
  }

  function pieceName(pc) { return NAMES[pc.c][pc.t]; }

  function describe(last) {
    if (!last) return '';
    var who = '玩家' + (last.player + 1);
    if (last.type === 'flip') return who + ' 翻開 ' + COLOR_NAME[last.piece.c] + pieceName(last.piece);
    if (last.type === 'move') return who + ' ' + pieceName(last.piece) + ' 移動';
    if (last.type === 'capture') return who + ' ' + pieceName(last.piece) + ' 吃 ' + pieceName(last.victim) + (last.chain > 1 ? '（連吃第 ' + last.chain + ' 子）' : '');
    if (last.type === 'end') return who + ' 結束連吃';
    return '';
  }

  return {
    ROWS: ROWS, COLS: COLS, SIZE: SIZE, RANK: RANK, COUNTS: COUNTS, NAMES: NAMES,
    COLOR_NAME: COLOR_NAME, NEIGHBORS: NEIGHBORS, NO_PROGRESS_LIMIT: NO_PROGRESS_LIMIT,
    newGame: newGame, clone: clone, legalActions: legalActions, isLegal: isLegal,
    apply: apply, masked: masked, hiddenPool: hiddenPool, capturesFrom: capturesFrom,
    outranks: outranks, attacksFrom: attacksFrom, pieceName: pieceName, describe: describe, remaining: remaining
  };
});
