/* 象棋麻將介面：你坐下方（座位 0），其餘是電腦，逆時針輪流（下家在右邊） */
(function () {
  'use strict';
  var M = window.ChessMahjong, AI = window.ChessMahjongAI;
  var $ = function (id) { return document.getElementById(id); };
  var NAMES = ['你', '下家電腦', '對家電腦', '上家電腦'];
  var AI_DELAY = 700, CLAIM_DELAY = 550;

  var match = null; // { n, scores, dealer, hand, passes, over }
  var s = null;     // 本局狀態
  var selected = null, timer = null, logItems = [];
  var players = 4;
  try { players = +localStorage.getItem('cm-players') || 4; } catch (e) {}

  function seatName(p) {
    if (p === 0) return '你';
    if (match.n === 2) return '電腦';
    if (match.n === 3) return p === 1 ? '下家電腦' : '上家電腦';
    return NAMES[p];
  }
  function positions(n) {
    if (n === 2) return ['me', 'top'];
    if (n === 3) return ['me', 'right', 'left'];
    return ['me', 'right', 'top', 'left'];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function tileEl(id, size, tag) {
    var t = el(tag || 'span', 'tile' + (size ? ' ' + size : ''));
    if (id < 0 || id === undefined) { t.classList.add('back'); t.setAttribute('aria-label', '蓋著的牌'); return t; }
    var k = M.kind(id);
    t.classList.add(k[0]);
    t.textContent = M.name(k);
    t.dataset.id = id;
    return t;
  }

  // ---------- 對局流程 ----------
  function newMatch() {
    clearTimeout(timer);
    match = { n: players, scores: [], dealer: 0, hand: 0, passes: 0, over: false };
    for (var i = 0; i < players; i++) match.scores.push(0);
    logItems = [];
    newHand();
  }
  function newHand() {
    match.hand++;
    s = M.newGame({ players: match.n, dealer: match.dealer });
    selected = null; seenLog = 0;
    addLog('第 ' + match.hand + ' 局開始，' + seatName(match.dealer) + '做莊');
    render();
    step();
  }

  function addLog(text) { logItems.push(text); }
  function tname(id) { return M.name(M.kind(id)); }

  function describe(entry) {
    var who = seatName(entry.p);
    switch (entry.type) {
      case 'discard': return who + '打出 ' + tname(entry.tile);
      case 'pon': return who + '碰 ' + tname(entry.tile);
      case 'chi': return who + '吃 ' + tname(entry.tile);
      case 'kan': return who + '槓 ' + tname(entry.tile);
      case 'ankan': return who + '暗槓';
      case 'kakan': return who + '加槓 ' + tname(entry.tile);
      case 'ron': return who + '胡牌（' + seatName(entry.from) + '放槍 ' + tname(entry.tile) + '）';
      case 'tsumo': return who + '自摸';
      case 'draw': return '牌摸完了，流局';
      default: return null;
    }
  }
  var seenLog = 0;
  function syncLog() {
    for (; seenLog < s.log.length; seenLog++) {
      var d = describe(s.log[seenLog]);
      if (d) addLog(d);
    }
  }

  function step() {
    clearTimeout(timer);
    syncLog();
    if (s.result) { finishHand(); return; }
    if (s.phase === 'discard') {
      if (s.turn === 0) { render(); return; } // 等玩家
      render();
      timer = setTimeout(function () {
        M.applyTurn(s, AI.chooseTurn(s, s.turn));
        step();
      }, AI_DELAY);
      return;
    }
    // claim
    var mine = s.pending.from !== 0 ? M.claimOptions(s, 0) : [];
    render();
    if (mine.length) return; // 等玩家決定要不要
    timer = setTimeout(function () { resolve(null); }, CLAIM_DELAY);
  }

  function resolve(myChoice) {
    var ch = {};
    for (var p = 1; p < s.n; p++) if (p !== s.pending.from) ch[p] = AI.chooseClaim(s, p);
    if (s.pending.from !== 0) ch[0] = myChoice;
    M.resolveClaims(s, ch);
    selected = null;
    step();
  }

  function finishHand() {
    var r = s.result, n = match.n;
    if (r.type === 'win') {
      if (r.self) { for (var p = 0; p < n; p++) if (p !== r.winner) { match.scores[p]--; match.scores[r.winner]++; } }
      else { match.scores[r.from]--; match.scores[r.winner]++; }
    }
    var keep = r.type === 'draw' || r.winner === match.dealer;
    if (!keep) {
      match.dealer = (match.dealer + 1) % n;
      match.passes++;
      if (match.passes >= n) match.over = true;
    }
    render();
  }

  // ---------- 玩家操作 ----------
  function onTile(id) {
    if (!s || s.result || s.phase !== 'discard' || s.turn !== 0) return;
    if (selected === id) { play({ type: 'discard', tile: id }); return; }
    selected = id;
    render();
  }
  function play(a) {
    if (!M.isLegalTurn(s, a)) return;
    selected = null;
    M.applyTurn(s, a);
    step();
  }

  function actionButton(label, tiles, fn, primary) {
    var b = el('button', 'btn' + (primary ? ' primary' : ''));
    b.type = 'button';
    b.appendChild(document.createTextNode(label));
    (tiles || []).forEach(function (id) { b.appendChild(tileEl(id)); });
    b.addEventListener('click', fn);
    return b;
  }

  // ---------- 畫面 ----------
  function render() {
    var table = $('table');
    Array.prototype.slice.call(table.querySelectorAll('.seat, .result')).forEach(function (x) { x.remove(); });
    var pos = positions(s.n);
    var lastTile = s.pending ? s.pending.tile : null;
    for (var p = 0; p < s.n; p++) table.appendChild(seatEl(p, pos[p], lastTile));

    $('wallInfo').textContent = '第 ' + match.hand + ' 局・牌牆剩 ' + s.wall.length + ' 張';
    var msg = '';
    if (s.result) msg = '';
    else if (s.phase === 'discard') msg = s.turn === 0 ? '輪到你，點兩下打出一張牌' : seatName(s.turn) + '思考中…';
    else if (s.pending) msg = seatName(s.pending.from) + '打出「' + tname(s.pending.tile) + '」';
    $('msg').textContent = msg;

    renderActions();
    renderLog();
    if (s.result) table.appendChild(resultEl());
  }

  function seatEl(p, pos, lastTile) {
    var seat = el('div', 'seat pos-' + pos);
    if (!s.result && s.turn === p && s.phase === 'discard') seat.classList.add('active');
    var head = el('div', 'seat-name');
    head.appendChild(el('span', '', seatName(p)));
    if (p === s.dealer) head.appendChild(el('span', 'badge', '莊'));
    if (p === 0 && !s.result && s.phase !== 'discard' && M.waits(s.hands[0], s.melds[0]).length) head.appendChild(el('span', 'badge ting', '聽牌'));
    head.appendChild(el('span', 'score', (match.scores[p] > 0 ? '+' : '') + match.scores[p] + ' 分'));
    seat.appendChild(head);

    // 亮出的面子
    if (s.melds[p].length) {
      var ms = el('div', 'melds');
      s.melds[p].forEach(function (m) {
        var box = el('div', 'meld');
        box.title = { chi: '吃', pon: '碰', kan: '槓' }[m.type];
        m.tiles.forEach(function (id, i) {
          var show = !m.concealed || p === 0 || s.result || i === 1 || i === 2;
          box.appendChild(tileEl(show ? id : -1, 'sm'));
        });
        ms.appendChild(box);
      });
      seat.appendChild(ms);
    }

    // 手牌
    if (p === 0) {
      var hand = el('div', 'hand');
      var mineTurn = !s.result && s.phase === 'discard' && s.turn === 0;
      if (!mineTurn) hand.classList.add('locked');
      var ids = s.hands[0].slice();
      var drawn = mineTurn && s.drawn !== null && ids.indexOf(s.drawn) >= 0 ? s.drawn : null;
      var sorted = M.sortTiles(ids.filter(function (x) { return x !== drawn; }));
      if (drawn !== null) sorted.push(drawn);
      sorted.forEach(function (id) {
        var t = tileEl(id, '', 'button');
        t.type = 'button';
        t.setAttribute('aria-label', tname(id));
        if (id === drawn) t.classList.add('drawn');
        if (id === selected) t.classList.add('sel');
        if (s.result && s.result.winner === 0 && id === s.result.tile) t.classList.add('win');
        t.disabled = !mineTurn;
        t.addEventListener('click', function () { onTile(id); });
        hand.appendChild(t);
      });
      seat.appendChild(hand);
      var hint = el('div', 'hint');
      if (mineTurn && selected !== null) {
        var rest = s.hands[0].filter(function (x) { return x !== selected; });
        var w = M.waits(rest, s.melds[0]);
        hint.textContent = '再點一次打出「' + tname(selected) + '」' + (w.length ? '，打完聽：' + w.map(M.name).join('、') : '');
      }
      seat.appendChild(hint);
    } else {
      var tiles = el('div', 'tiles');
      var show = !!s.result;
      M.sortTiles(s.hands[p]).forEach(function (id) {
        var t = tileEl(show ? id : -1, 'sm');
        if (show && s.result.winner === p && id === s.result.tile) t.classList.add('win');
        tiles.appendChild(t);
      });
      seat.appendChild(tiles);
    }

    // 捨牌
    var pond = el('div', 'pond');
    pond.setAttribute('aria-label', seatName(p) + '的捨牌');
    s.discards[p].forEach(function (id) {
      var t = tileEl(id, 'xs');
      if (id === lastTile) t.classList.add('last');
      pond.appendChild(t);
    });
    seat.appendChild(pond);
    return seat;
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    if (!s || s.result) return;
    if (s.phase === 'discard' && s.turn === 0) {
      var acts = M.turnActions(s);
      acts.forEach(function (a) {
        if (a.type === 'tsumo') box.appendChild(actionButton('自摸', [], function () { play(a); }, true));
        if (a.type === 'ankan') box.appendChild(actionButton('暗槓', [a.tiles[0]], function () { play(a); }));
        if (a.type === 'kakan') box.appendChild(actionButton('加槓', [a.tile], function () { play(a); }));
      });
      if (selected !== null) box.appendChild(actionButton('打出', [selected], function () { play({ type: 'discard', tile: selected }); }, !acts.some(function (a) { return a.type === 'tsumo'; })));
      return;
    }
    if (s.phase === 'claim' && s.pending.from !== 0) {
      var opts = M.claimOptions(s, 0);
      if (!opts.length) return;
      opts.forEach(function (o) {
        var label = { ron: '胡', pon: '碰', kan: '槓', chi: '吃' }[o.type];
        box.appendChild(actionButton(label, o.type === 'ron' ? [s.pending.tile] : o.tiles.concat([s.pending.tile]), function () { resolve(o); }, o.type === 'ron'));
      });
      box.appendChild(actionButton('過', [], function () { resolve(null); }));
    }
  }

  function renderLog() {
    var log = $('log');
    log.innerHTML = '';
    logItems.forEach(function (t, i) {
      var li = el('li');
      li.appendChild(el('span', 'n', String(i + 1)));
      li.appendChild(el('span', '', t));
      log.appendChild(li);
    });
    log.scrollTop = log.scrollHeight;
  }

  function resultEl() {
    var r = s.result;
    var wrap = el('div', 'result');
    var box = el('div', 'box');
    var title, sub;
    if (r.type === 'draw') { title = '流局'; sub = '牌摸完了，沒有人胡牌，莊家連莊。'; }
    else {
      title = r.winner === 0 ? '你胡了！' : seatName(r.winner) + '胡牌';
      sub = r.pattern + '・' + (r.self ? '自摸' : seatName(r.from) + '放槍');
    }
    box.appendChild(el('strong', '', title));
    box.appendChild(el('span', 'note', sub));
    if (r.type === 'win') {
      var tiles = el('div', 'tiles');
      s.melds[r.winner].forEach(function (m) { m.tiles.forEach(function (id) { tiles.appendChild(tileEl(id)); }); });
      M.sortTiles(s.hands[r.winner]).forEach(function (id) { var t = tileEl(id); if (id === r.tile) t.classList.add('win'); tiles.appendChild(t); });
      box.appendChild(tiles);
    }
    if (match.over) {
      var lines = [];
      for (var p = 0; p < match.n; p++) lines.push(seatName(p) + ' ' + (match.scores[p] > 0 ? '+' : '') + match.scores[p]);
      box.appendChild(el('span', 'note', '一將結束：' + lines.join('，')));
    }
    var btn = actionButton(match.over ? '開始新的一將' : '下一局', [], function () { match.over ? newMatch() : newHand(); }, true);
    box.appendChild(btn);
    wrap.appendChild(box);
    setTimeout(function () { btn.focus(); }, 0);
    return wrap;
  }

  // ---------- 設定 ----------
  function syncSeg() {
    Array.prototype.forEach.call($('playersSeg').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.val === players));
    });
  }
  $('playersSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    players = +b.dataset.val;
    try { localStorage.setItem('cm-players', players); } catch (err) {}
    syncSeg();
  });
  $('newMatch').addEventListener('click', newMatch);

  syncSeg();
  newMatch();
})();
