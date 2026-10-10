// 自我對弈測試：node test/selfplay.js [mode] [levelA] [levelB] [games]
const G = require('../shared/engine.js');
const AI = require('../shared/ai.js');
const [mode = 'classic', la = 'normal', lb = 'easy', games = '4'] = process.argv.slice(2);
const res = { 0: 0, 1: 0, draw: 0 };
let maxMs = 0, chains = 0, attacks = 0;
for (let g = 0; g < +games; g++) {
  const s = G.newGame({ mode, seed: g + 1 });
  while (s.winner === null) {
    const t0 = Date.now();
    const seq = AI.chooseTurn(s, s.turn === 0 ? la : lb);
    maxMs = Math.max(maxMs, Date.now() - t0);
    for (const a of seq) {
      if (!G.isLegal(s, a)) throw new Error('illegal ' + JSON.stringify(a));
      G.apply(s, a);
      if (s.last && s.last.type === 'attack') { attacks++; if (s.last.chain > 1) chains++; }
    }
    if (s.ply > 2000) throw new Error('too long');
  }
  res[s.winner]++;
  console.log(`game ${g}: winner=${s.winner} reason=${s.reason} ply=${s.ply}`);
}
console.log(res, 'max think ms', maxMs, 'attacks', attacks, 'chain continuations', chains);
