/*
 * 象棋麻將電腦玩家：只用自己看得到的資訊（自己的手牌、所有人的捨牌和亮牌）
 * 打牌時選「打掉後聽的牌最多」的那張；還沒聽牌就看對子、搭子剩幾張可以湊
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chessmahjong.js'));
  else root.ChessMahjongAI = factory(root.ChessMahjong);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var SEQS = [['K', 'A', 'E'], ['R', 'H', 'C']];

  // 手牌好壞：聽牌時 = 可胡張數 * 10；否則看兩兩之間能不能變成對子或面子
  function handValue(ids, melds, cnt) {
    var w = M.waits(ids, melds), ukeire = 0;
    w.forEach(function (k) { ukeire += cnt[k]; });
    if (w.length) return 10 + ukeire * 10;
    var ks = ids.map(M.kind), v = 0;
    for (var i = 0; i < ks.length; i++) for (var j = i + 1; j < ks.length; j++) {
      var a = ks[i], b = ks[j];
      if (a === b) v += 1 + (cnt[a] > 0 ? 1 : 0) * 0.5 + (a[1] === 'P' ? cnt[a] * 0.3 : 0);
      else if (M.isPair(a, b)) v += 0.8;
      else if (a[0] === b[0]) {
        SEQS.forEach(function (s) {
          if (s.indexOf(a[1]) >= 0 && s.indexOf(b[1]) >= 0) {
            var miss = a[0] + s.filter(function (x) { return x !== a[1] && x !== b[1]; })[0];
            v += 0.4 + cnt[miss] * 0.4;
          }
        });
      }
    }
    // 孤張扣分：剩越少越沒用
    ks.forEach(function (k) { v += cnt[k] * 0.05; });
    return v;
  }

  // 輪到自己：回傳一個 turnActions 裡的動作
  function chooseTurn(s, p) {
    var acts = M.turnActions(s);
    var win = acts.filter(function (a) { return a.type === 'tsumo'; })[0];
    if (win) return win;
    var kan = acts.filter(function (a) { return a.type === 'ankan' || a.type === 'kakan'; })[0];
    if (kan) return kan;
    var cnt = M.unseen(s, p), best = null, bestV = -Infinity;
    acts.forEach(function (a) {
      if (a.type !== 'discard') return;
      var rest = s.hands[p].filter(function (x) { return x !== a.tile; });
      var v = handValue(rest, s.melds[p], cnt) + Math.random() * 0.01;
      // 不打別人可能剛好要胡的牌太難算，這裡只稍微偏好打出已出現較多的牌
      v += (2 - cnt[M.kind(a.tile)]) * 0.02;
      if (v > bestV) { bestV = v; best = a; }
    });
    return best;
  }

  // 別人打牌時：回傳要宣告的動作或 null
  function chooseClaim(s, p) {
    var opts = M.claimOptions(s, p);
    if (!opts.length) return null;
    var ron = opts.filter(function (o) { return o.type === 'ron'; })[0];
    if (ron) return ron;
    var kan = opts.filter(function (o) { return o.type === 'kan'; })[0];
    if (kan) return kan;
    var cnt = M.unseen(s, p);
    cnt[M.kind(s.pending.tile)]--;
    var now = handValue(s.hands[p], s.melds[p], cnt);
    var best = null, bestV = now;
    opts.forEach(function (o) {
      var rest = s.hands[p].filter(function (x) { return o.tiles.indexOf(x) < 0; });
      var melds = s.melds[p].concat([{ type: o.type, tiles: o.tiles.concat([s.pending.tile]) }]);
      // 吃碰後還要打一張，取打完最好的結果
      rest.forEach(function (d) {
        var after = rest.filter(function (x) { return x !== d; });
        var v = handValue(after, melds, cnt);
        if (v > bestV + 0.5) { bestV = v; best = o; }
      });
    });
    return best;
  }

  return { chooseTurn: chooseTurn, chooseClaim: chooseClaim, handValue: handValue };
});
