/*
 * 暗棋電腦 AI：明棋走法用 alpha-beta 搜尋；翻棋用「未翻棋池」的機率做期望值估算
 * （AI 只使用公開資訊，不偷看暗棋內容）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.DarkChessAI = factory(root.DarkChess);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var BASE = { K: 60, A: 30, E: 14, R: 8, H: 5, C: 18, P: 4 };
  var WIN = 100000;
  var LEVELS = {
    easy: { depth: 1, flipDepth: 1, noise: 8 },
    normal: { depth: 3, flipDepth: 1, noise: 0.6 },
    hard: { depth: 5, flipDepth: 2, noise: 0.3 }
  };

  function other(c) { return c === 'r' ? 'b' : 'r'; }

  function countAlive(s, color, t) {
    var dead = 0, list = s.captured[color];
    for (var i = 0; i < list.length; i++) if (list[i] === t) dead++;
    return G.COUNTS[t] - dead;
  }

  function pieceValue(s, color, t) {
    var v = BASE[t];
    var enemy = other(color);
    if (t === 'K') v += (5 - countAlive(s, enemy, 'P')) * 10; // 對方兵越少，帥越安全
    if (t === 'P' && countAlive(s, enemy, 'K') > 0) v += 4;   // 兵可以剋帥
    return v;
  }

  function material(s, color) {
    var total = 0;
    Object.keys(G.COUNTS).forEach(function (t) {
      total += countAlive(s, color, t) * pieceValue(s, color, t);
    });
    return total;
  }

  // 站在 player 的角度評估
  function evaluate(s, player) {
    if (s.winner !== null) {
      if (s.winner === 'draw') return 0;
      return s.winner === player ? WIN - s.ply : -WIN + s.ply;
    }
    var mine = s.colors[player];
    if (!mine) return 0;
    var theirs = other(mine);
    var score = material(s, mine) - material(s, theirs);
    // 輪到誰走，誰就能先吃：給輪到方「最好的一口吃子」七成價值，降低地平線效應
    var toMove = s.colors[s.turn], best = 0;
    for (var i = 0; i < G.SIZE; i++) {
      var pc = s.board[i];
      if (!pc || !pc.up || pc.c !== toMove) continue;
      var caps = G.capturesFrom(s.board, i);
      for (var k = 0; k < caps.length; k++) {
        var v = pieceValue(s, s.board[caps[k]].c, s.board[caps[k]].t);
        if (v > best) best = v;
      }
    }
    score += (s.turn === player ? 1 : -1) * best * 0.7;
    // 追擊：靠近自己吃得掉的對方明棋（殘局時讓優勢方主動逼近）
    score += chase(s, mine) - chase(s, theirs);
    return score;
  }

  function chase(s, color) {
    var total = 0;
    for (var i = 0; i < G.SIZE; i++) {
      var a = s.board[i];
      if (!a || !a.up || a.c !== color || a.t === 'C') continue;
      var best = 0;
      for (var j = 0; j < G.SIZE; j++) {
        var d = s.board[j];
        if (!d || !d.up || d.c === color || !G.outranks(a, d)) continue;
        // 對方也吃得掉我（同級）就不算追擊目標
        if (G.outranks(d, a) && d.t !== 'C') continue;
        var dist = Math.abs((i >> 3) - (j >> 3)) + Math.abs((i & 7) - (j & 7));
        var v = pieceValue(s, d.c, d.t) / (dist + 1);
        if (v > best) best = v;
      }
      total += best;
    }
    // 機動性：可走的空格越多越不容易被困住
    for (var m = 0; m < G.SIZE; m++) {
      var q = s.board[m];
      if (!q || !q.up || q.c !== color) continue;
      var nb = G.NEIGHBORS[m];
      for (var k = 0; k < nb.length; k++) if (!s.board[nb[k]]) total += 0.5;
    }
    return total * 0.6;
  }

  function isAttack(s, a) {
    return a.type === 'move' && s.board[a.to] && !s.board[a.to].up;
  }

  // 產生不含翻棋、不含攻擊暗棋（機率事件）的回合
  function turns(s) {
    var out = [];
    var acts = G.legalActions(s);
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (a.type === 'flip' || isAttack(s, a)) continue;
      out.push({ seq: [a], state: G.apply(G.clone(s), a) });
    }
    return out;
  }

  function negamax(s, depth, alpha, beta) {
    var me = s.turn;
    if (depth <= 0 || s.winner !== null) return evaluate(s, me);
    var ts = turns(s);
    if (ts.length === 0) return evaluate(s, me); // 只能翻棋：靜態評估
    // 吃子優先排序，加速剪枝
    ts.sort(function (x, y) { return captureGain(y) - captureGain(x); });
    var best = -Infinity;
    for (var i = 0; i < ts.length; i++) {
      var ns = ts[i].state;
      var v = ns.turn === me ? evaluate(ns, me) : -negamax(ns, depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function captureGain(t) {
    var n = 0;
    for (var i = 0; i < t.seq.length; i++) if (t.seq[i].type === 'move') n++;
    return t.state.noProgress === 0 ? n : 0;
  }

  function poolTotalOf(pool) {
    var t = 0;
    Object.keys(pool).forEach(function (k) { t += Math.max(0, pool[k]); });
    return t;
  }

  function flipValue(s, at, player, depth, pool) {
    var exp = 0, total = poolTotalOf(pool);
    Object.keys(pool).forEach(function (key) {
      var n = pool[key];
      if (n <= 0) return;
      var ns = G.clone(s);
      ns.board[at] = { c: key[0], t: key[1], up: false };
      G.apply(ns, { type: 'flip', at: at });
      var v = ns.winner !== null ? evaluate(ns, player) : -negamax(ns, depth - 1, -Infinity, Infinity);
      exp += (n / total) * v;
    });
    return exp;
  }

  // 連棋：攻擊暗棋的期望值（依未翻棋池的機率），more 表示還要往後看幾次連攻
  function attackValue(s, a, player, depth, pool, more) {
    var exp = 0, total = poolTotalOf(pool);
    Object.keys(pool).forEach(function (key) {
      var n = pool[key];
      if (n <= 0) return;
      var ns = G.clone(s);
      ns.board[a.to] = { c: key[0], t: key[1], up: false };
      G.apply(ns, a);
      var v;
      if (ns.winner !== null) v = evaluate(ns, player);
      else if (ns.turn !== player) v = -negamax(ns, depth - 1, -Infinity, Infinity);
      else {
        v = -negamax(G.apply(G.clone(ns), { type: 'end' }), depth - 1, -Infinity, Infinity);
        if (more > 0) {
          var sub = {}; Object.keys(pool).forEach(function (k) { sub[k] = pool[k]; }); sub[key]--;
          G.legalActions(ns).forEach(function (b) {
            if (b.type !== 'move') return;
            if (isAttack(ns, b)) v = Math.max(v, attackValue(ns, b, player, depth, sub, more - 1));
            else { // 連吃中吃明棋
              var cs = G.apply(G.clone(ns), b);
              if (cs.turn === player && cs.winner === null) cs = G.apply(cs, { type: 'end' });
              v = Math.max(v, cs.winner !== null ? evaluate(cs, player) : -negamax(cs, depth - 1, -Infinity, Infinity));
            }
          });
        }
      }
      exp += (n / total) * v;
    });
    return exp;
  }

  // 主要介面：回傳本回合要執行的動作序列
  function chooseTurn(state, level) {
    var cfg = LEVELS[level] || LEVELS.normal;
    var s = G.clone(state);
    var me = s.turn;
    var acts = G.legalActions(s);
    if (acts.length === 0) return [];

    // 還沒決定顏色：隨機翻一顆
    if (!s.colors[me]) {
      var flips0 = acts.filter(function (a) { return a.type === 'flip'; });
      return [flips0[Math.floor(Math.random() * flips0.length)]];
    }

    var candidates = [];
    // 一般走法與吃明棋（連吃中只剩「結束回合」）
    turns(s).forEach(function (t) {
      var v = t.state.turn === me && t.state.winner === null ? evaluate(t.state, me) : -negamax(t.state, cfg.depth - 1, -Infinity, Infinity);
      if (t.state.winner === me) v = WIN;
      // 無意義來回走動略扣分，避免和棋拖延
      if (captureGain(t) === 0) v -= 0.3;
      candidates.push({ seq: t.seq, v: v + (Math.random() - 0.5) * cfg.noise });
    });

    var pool = G.hiddenPool(s);
    acts.forEach(function (a) {
      if (a.type === 'flip') {
        var fv = flipValue(s, a.at, me, cfg.flipDepth, pool);
        candidates.push({ seq: [a], v: fv + 0.5 + (Math.random() - 0.5) * cfg.noise });
      } else if (isAttack(s, a)) {
        var av = attackValue(s, a, me, cfg.flipDepth, pool, 1);
        candidates.push({ seq: [a], v: av + 0.5 + (Math.random() - 0.5) * cfg.noise });
      }
    });

    if (candidates.length === 0) return [{ type: 'end' }];
    candidates.sort(function (x, y) { return y.v - x.v; });
    return candidates[0].seq;
  }

  return { chooseTurn: chooseTurn, evaluate: evaluate, LEVELS: LEVELS };
});
