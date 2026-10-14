// 象棋麻將：牌型單元測試 + 電腦四人自我對局
'use strict';
const assert = require('assert');
const M = require('../shared/chessmahjong.js');
const AI = require('../shared/chessmahjong-ai.js');

const W = (ks, melds) => M.winPattern(ks, melds || []);
assert.ok(W(['rK', 'rA', 'rE', 'bP', 'bP']), '帥仕相＋卒卒');
assert.ok(W(['bR', 'bH', 'bC', 'rK', 'bK']), '車馬包＋帥將');
assert.ok(W(['rP', 'rP', 'rP', 'bA', 'bA']), '兵兵兵＋士士');
assert.ok(W(['rP', 'rP', 'rP', 'rP', 'rP']), '五兵');
assert.ok(!W(['rK', 'rA', 'bE', 'bP', 'bP']), '不同色不成順');
assert.ok(!W(['rA', 'rE', 'rR', 'bP', 'bP']), '仕相俥不是順子');
assert.ok(!W(['rK', 'rA', 'rE', 'bP', 'rP']), '兵卒不成對');
assert.ok(W(['bP', 'bP'], [{ type: 'chi', tiles: [] }]), '吃了之後單吊對子');
assert.strictEqual(M.TILE.length, 32);

// 吃只能吃上家；碰任一家；胡優先
function setup(hands) {
  const s = M.newGame({ players: 4, dealer: 0 });
  s.hands = hands; s.wall = [27, 28]; s.turn = 0; s.phase = 'discard'; s.discards = [[], [], [], []];
  return s;
}
// 玩家0打出傌(7)；玩家1有俥(5)炮(9)可吃；玩家2有傌(8)…只有一張不能碰；玩家3有士士
let s = setup([[7, 0, 1, 16, 31], [5, 9, 11, 12], [8, 17, 19, 21], [17, 18, 22, 23]]);
M.applyTurn(s, { type: 'discard', tile: 7 });
assert.deepStrictEqual(M.claimOptions(s, 1).map(o => o.type), ['ron', 'chi'], '下家能胡也能吃');
assert.deepStrictEqual(M.claimOptions(s, 2), [], '對家不能吃');
// 玩家0打出士？換成：玩家0打出帥(0)，玩家3 手上 將 + 包包 → 帥將對可胡
s = setup([[0, 1, 2, 3, 31], [5, 9, 11, 12], [8, 18, 19, 21], [16, 25, 26, 13]]);
s.hands[3] = [16, 21, 22, 23]; // 將 車 車 馬 → 不成
M.applyTurn(s, { type: 'discard', tile: 0 });
assert.deepStrictEqual(M.claimOptions(s, 3), []);
s = setup([[0, 1, 2, 3, 31], [5, 9, 11, 12], [8, 18, 19, 21], [16, 21, 23, 25]]); // 將 車馬包 → 胡帥
M.applyTurn(s, { type: 'discard', tile: 0 });
assert.deepStrictEqual(M.claimOptions(s, 3).map(o => o.type), ['ron']);
M.resolveClaims(s, { 3: { type: 'ron' } });
assert.strictEqual(s.result.winner, 3);
assert.strictEqual(s.result.pattern, '順子＋對子');
// 胡 > 碰：玩家1可碰兵、玩家2可胡兵
s = setup([[11, 1, 2, 3, 31], [12, 13, 5, 24], [14, 9, 25, 26], [17, 18, 19, 20]]); // 玩家2：兵 + 炮 + 包包? 炮包不同色
s.hands[2] = [14, 21, 23, 25]; // 兵 車馬包 → 胡兵
M.applyTurn(s, { type: 'discard', tile: 11 });
assert.deepStrictEqual(M.claimOptions(s, 1).map(o => o.type), ['pon']);
M.resolveClaims(s, { 1: M.claimOptions(s, 1)[0], 2: { type: 'ron' } });
assert.strictEqual(s.result.winner, 2, '胡優先於碰');
// 沒人要：下家摸牌
s = setup([[7, 0, 1, 16, 31], [5, 10, 11, 12], [8, 17, 19, 21], [17, 18, 22, 23]]);
M.applyTurn(s, { type: 'discard', tile: 7 });
M.resolveClaims(s, {});
assert.strictEqual(s.turn, 1); assert.strictEqual(s.hands[1].length, 5);
// 牌摸完流局
s.wall = []; M.applyTurn(s, { type: 'discard', tile: 5 }); M.resolveClaims(s, {});
assert.strictEqual(s.result.type, 'draw');
console.log('象棋麻將規則測試通過');

// 自我對局
const tally = { win: 0, self: 0, draw: 0 };
const N = +(process.argv[2] || 300);
for (let g = 0; g < N; g++) {
  const n = 2 + (g % 3);
  const st = M.newGame({ players: n, dealer: g % n });
  let guard = 0;
  while (!st.result && guard++ < 500) {
    if (st.phase === 'discard') {
      const a = AI.chooseTurn(st, st.turn);
      assert.ok(M.isLegalTurn(st, a), 'AI 動作要合法');
      M.applyTurn(st, a);
    } else {
      const ch = {};
      for (let p = 0; p < n; p++) if (p !== st.pending.from) ch[p] = AI.chooseClaim(st, p);
      M.resolveClaims(st, ch);
    }
    // 牌數守恆
    let total = st.wall.length + (st.pending ? 0 : 0);
    for (let p = 0; p < n; p++) total += st.hands[p].length + st.discards[p].length + st.melds[p].reduce((x, m) => x + m.tiles.length, 0);
    assert.strictEqual(total, 32, '牌數要是 32');
  }
  assert.ok(st.result, '一局要結束');
  if (st.result.type === 'draw') tally.draw++; else { tally.win++; if (st.result.self) tally.self++; }
}
console.log('自我對局', N, '局：', tally);
