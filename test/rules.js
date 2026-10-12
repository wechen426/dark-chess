// 規則單元測試：node test/rules.js
const G = require('../shared/engine.js');
const assert = require('assert');
function setup(mode, pieces, colors = ['r', 'b']) {
  const s = G.newGame({ mode, seed: 1 });
  s.board = Array(32).fill(null);
  for (const [i, c, t, up = true] of pieces) s.board[i] = { c, t, up };
  s.colors = colors;
  return s;
}
const has = (s, a) => G.isLegal(s, a);
// 兵吃帥、帥不能吃兵
let s = setup('classic', [[0, 'r', 'P'], [1, 'b', 'K'], [9, 'r', 'K'], [17, 'b', 'P']]);
assert(has(s, { type: 'move', from: 0, to: 1 }), '兵可吃將');
assert(!has(s, { type: 'move', from: 9, to: 17 }), '帥不可吃卒');
// 大吃小、同級互吃、小不能吃大
s = setup('classic', [[0, 'r', 'R'], [1, 'b', 'R'], [8, 'b', 'A']]);
assert(has(s, { type: 'move', from: 0, to: 1 }));
assert(!has(s, { type: 'move', from: 0, to: 8 }));
// 炮：隔一子吃，不能直接吃相鄰，不能吃暗棋
s = setup('classic', [[0, 'r', 'C'], [1, 'b', 'P', false], [5, 'b', 'K'], [8, 'b', 'H'], [24, 'b', 'A', false], [16, 'r', 'P']]);
assert(has(s, { type: 'move', from: 0, to: 5 }), '炮隔暗棋吃將');
assert(!has(s, { type: 'move', from: 0, to: 8 }), '炮不能直接吃相鄰');
assert(!has(s, { type: 'move', from: 0, to: 24 }), '炮不能吃暗棋');
// 連棋：攻擊相鄰暗棋，翻出可吃敵棋→吃掉並可續攻
s = setup('chain', [[0, 'r', 'R'], [1, 'b', 'H', false], [2, 'b', 'P', false], [9, 'b', 'A'], [30, 'b', 'P', false]]);
assert(has(s, { type: 'move', from: 0, to: 1 }), '可攻擊暗棋');
G.apply(s, { type: 'move', from: 0, to: 1 });
assert.strictEqual(s.turn, 0); assert.strictEqual(s.chain, 1); assert.strictEqual(s.board[1].t, 'R');
assert(!has(s, { type: 'move', from: 1, to: 9 }), '連吃中吃不掉的明棋（士比俥大）不能吃');
assert(has(s, { type: 'move', from: 1, to: 2 }) && has(s, { type: 'end' }));
G.apply(s, { type: 'move', from: 1, to: 2 });
assert.deepStrictEqual(s.captured.b, ['H', 'P']); assert.strictEqual(s.turn, 1, '無相鄰暗棋自動換手');
// 象攻暗棋吃兵後，可接著吃同級的明相，再繼續攻暗棋
s = setup('chain', [[0, 'b', 'E'], [1, 'r', 'P', false], [2, 'r', 'E'], [3, 'r', 'H', false], [30, 'r', 'P', false]], ['b', 'r']);
G.apply(s, { type: 'move', from: 0, to: 1 });
assert(has(s, { type: 'move', from: 1, to: 2 }), '連吃中可吃同級明棋');
G.apply(s, { type: 'move', from: 1, to: 2 });
assert.strictEqual(s.turn, 0); assert.strictEqual(s.chain, 2);
G.apply(s, { type: 'move', from: 2, to: 3 });
assert.deepStrictEqual(s.captured.r, ['P', 'E', 'H']);
// 回合一開始吃明棋，也可以接著連吃
s = setup('chain', [[0, 'b', 'E'], [1, 'r', 'E'], [2, 'r', 'P'], [10, 'r', 'H', false], [30, 'r', 'P', false]], ['b', 'r']);
G.apply(s, { type: 'move', from: 0, to: 1 }); assert.strictEqual(s.turn, 0); assert.strictEqual(s.chain, 1);
G.apply(s, { type: 'move', from: 1, to: 2 }); G.apply(s, { type: 'move', from: 2, to: 10 });
assert.deepStrictEqual(s.captured.r, ['E', 'P', 'H']);
// 翻出自己的棋：停止，原地不動
s = setup('chain', [[0, 'r', 'R'], [1, 'r', 'P', false], [30, 'b', 'P', false]]);
G.apply(s, { type: 'move', from: 0, to: 1 });
assert.strictEqual(s.turn, 1); assert(s.board[0].t === 'R' && s.board[1].up && s.board[1].c === 'r');
// 翻出比自己大的敵棋：停在原地，不陣亡
s = setup('chain', [[0, 'r', 'A'], [1, 'b', 'K', false], [30, 'b', 'P', false]]);
G.apply(s, { type: 'move', from: 0, to: 1 });
assert.strictEqual(s.board[0].t, 'A'); assert(s.board[1].up && s.board[1].t === 'K');
assert.deepStrictEqual(s.captured.r, []); assert.strictEqual(s.turn, 1); assert.strictEqual(s.last.result, 'blocked');
// 兵攻暗棋翻出將：吃掉
s = setup('chain', [[0, 'r', 'P'], [1, 'b', 'K', false], [30, 'b', 'P', false]]);
G.apply(s, { type: 'move', from: 0, to: 1 });
assert.deepStrictEqual(s.captured.b, ['K']);
// 炮：隔一顆跳著攻擊暗棋，翻出敵棋一律吃掉；不能攻擊相鄰暗棋
s = setup('chain', [[0, 'r', 'C'], [1, 'b', 'P', false], [3, 'b', 'K', false], [8, 'b', 'A', false], [30, 'b', 'P', false]]);
assert(!has(s, { type: 'move', from: 0, to: 1 }), '炮不能攻擊相鄰暗棋');
assert(!has(s, { type: 'move', from: 0, to: 8 }));
assert(has(s, { type: 'move', from: 0, to: 3 }), '炮隔一顆攻擊暗棋');
G.apply(s, { type: 'move', from: 0, to: 3 });
assert.deepStrictEqual(s.captured.b, ['K']); assert.strictEqual(s.board[3].t, 'C');
// 一般模式不能攻擊暗棋；連棋模式吃明棋後直接換手
s = setup('classic', [[0, 'r', 'R'], [1, 'b', 'H', false]]);
assert(!has(s, { type: 'move', from: 0, to: 1 }));
s = setup('chain', [[0, 'r', 'K'], [1, 'b', 'R'], [30, 'b', 'P', false]]);
G.apply(s, { type: 'move', from: 0, to: 1 }); assert.strictEqual(s.turn, 1, '吃完沒有目標就換手');
// 一般模式吃完就換手
s = setup('classic', [[0, 'r', 'K'], [1, 'b', 'R'], [2, 'b', 'H'], [30, 'b', 'P', false]]);
G.apply(s, { type: 'move', from: 0, to: 1 });
assert.strictEqual(s.turn, 1);
// 第一次翻棋決定顏色
s = G.newGame({ seed: 5 });
const c = s.board[10].c; G.apply(s, { type: 'flip', at: 10 });
assert.strictEqual(s.colors[0], c);
// 遮蔽：暗棋內容不外洩
assert(G.masked(s).board.every(p => !p || p.up || p.t === undefined));
// 投降：對手獲勝，之後不能再下
s = G.newGame({ seed: 3 }); G.apply(s, { type: 'flip', at: 5 });
G.resign(s, 1);
assert.strictEqual(s.winner, 0); assert.strictEqual(s.last.type, 'resign');
assert.strictEqual(G.legalActions(s).length, 0);
console.log('規則測試全部通過');
