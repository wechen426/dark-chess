/* 暗棋連棋：網頁介面（單機對電腦、同機雙人、線上雙人） */
(function () {
  'use strict';
  var G = window.DarkChess, AI = window.DarkChessAI;
  var $ = function (id) { return document.getElementById(id); };

  var opts = { rule: 'classic', opp: 'ai', level: 'normal', first: 'me' };
  var game = null;         // 目前狀態（線上模式為伺服器送來、已遮蔽暗棋的狀態）
  var history = [];        // 悔棋用
  var logItems = [];
  var selected = null;
  var aiThinking = false;
  var aiTimer = null;
  var playMode = 'ai';     // 本局實際的對手類型
  var humanSeat = 0;       // 對電腦時，人類的座位
  var net = { ws: null, seat: null, room: null, connected: false };
  var prevBoardKey = '';
  var busy = false;        // 動畫播放中，暫停操作
  var view = null;         // 動畫中暫時顯示的狀態
  var epoch = 0;           // 新局或悔棋時作廢進行中的動畫
  var netQueue = Promise.resolve();
  var bannerToken = 0;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try { var saved = JSON.parse(localStorage.getItem('darkchess-opts') || 'null'); if (saved) Object.assign(opts, saved); } catch (e) {}
  if (opts.opp === 'online') opts.opp = 'ai';

  // ---------- 設定 ----------
  function syncSegs() {
    document.querySelectorAll('.seg').forEach(function (seg) {
      var key = seg.getAttribute('data-key');
      seg.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-val') === opts[key]));
      });
    });
    $('aiOpts').hidden = opts.opp !== 'ai';
    $('firstOpts').hidden = opts.opp !== 'ai';
    $('onlineBox').hidden = opts.opp !== 'online';
    $('localStart').hidden = opts.opp === 'online';
  }
  document.querySelectorAll('.seg').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      opts[seg.getAttribute('data-key')] = b.getAttribute('data-val');
      try { localStorage.setItem('darkchess-opts', JSON.stringify(opts)); } catch (err) {}
      syncSegs();
    });
  });

  // ---------- 對局 ----------
  function startLocal() {
    disconnect();
    clearTimeout(aiTimer); aiThinking = false;
    playMode = opts.opp === 'online' ? 'ai' : opts.opp;
    humanSeat = opts.first === 'me' ? 0 : 1;
    game = G.newGame({ mode: opts.rule });
    history = []; logItems = []; selected = null; prevBoardKey = '';
    var my = ++epoch;
    busy = true; view = null;
    render();
    showBanner(game).then(function () {
      if (my !== epoch) return;
      busy = false; render(); maybeAi();
    });
  }

  // ---------- 動畫 ----------
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? Math.min(ms, 350) : ms); }); }

  // 回合開始提示：紅方／黑方回合
  function showBanner(state) {
    if (!state || state.winner !== null) return Promise.resolve();
    var el = $('turnBanner'), col = state.colors[state.turn];
    el.className = 'turn-banner ' + (col || 'none');
    $('bannerDisc').textContent = col ? (col === 'r' ? '帥' : '將') : '？';
    $('bannerTitle').textContent = col ? G.COLOR_NAME[col] + '方回合' : seatName(state.turn) + '先翻棋';
    $('bannerSub').textContent = col ? seatName(state.turn) + (seatName(state.turn) === '你' ? '的回合' : '走') : '第一顆翻出的顏色就是你的顏色';
    if (playMode === 'local' && col) $('bannerSub').textContent = seatName(state.turn);
    var token = ++bannerToken;
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('show');
    return wait(1050).then(function () { if (token === bannerToken) { el.classList.remove('show'); el.hidden = true; } });
  }

  // 播放一步：攻擊暗棋時先翻開停留，讓人看清楚再結算；換手時顯示回合提示
  function present(prev, next) {
    var my = epoch;
    busy = true;
    var l = next.last, p = Promise.resolve();
    if (l && l.type === 'attack' && prev) {
      p = p.then(function () {
        var v = G.clone(prev);
        v.board[l.to] = { t: l.revealed.t, c: l.revealed.c, up: true };
        v.last = { type: 'reveal', from: l.from, to: l.to };
        v.chain = null;
        view = v; render();
        return wait(900);
      });
    }
    p = p.then(function () {
      if (my !== epoch) return;
      view = null;
      addLog(next);
      render();
      if (prev && next.winner === null && next.turn !== prev.turn) return wait(l && l.type === 'attack' ? 550 : 380).then(function () { return my === epoch && showBanner(next); });
    });
    return p.then(function () { if (my === epoch) { busy = false; render(); } return my === epoch; });
  }


  function seatName(seat) {
    if (playMode === 'ai') return seat === humanSeat ? '你' : '電腦';
    if (playMode === 'online') return seat === net.seat ? '你' : '對手';
    return seat === 0 ? '玩家一' : '玩家二';
  }
  function bottomSeat() {
    if (playMode === 'ai') return humanSeat;
    if (playMode === 'online') return net.seat == null ? 0 : net.seat;
    return 0;
  }
  function humanCanAct() {
    if (!game || game.winner !== null || aiThinking || busy) return false;
    if (playMode === 'ai') return game.turn === humanSeat;
    if (playMode === 'online') return net.connected && game.turn === net.seat;
    return true;
  }

  function addLog(state) {
    var l = state.last;
    if (!l) return;
    var who = seatName(l.player), text;
    if (l.type === 'flip') text = who + '翻開' + G.COLOR_NAME[l.piece.c] + G.pieceName(l.piece);
    else if (l.type === 'move') text = who + '：' + G.pieceName(l.piece) + ' ' + coord(l.from) + '→' + coord(l.to);
    else if (l.type === 'capture') text = who + '：' + G.pieceName(l.piece) + '吃' + G.pieceName(l.victim) + (l.chain > 1 ? '（連吃 ' + l.chain + '）' : '');
    else if (l.type === 'attack') {
      var rv = G.COLOR_NAME[l.revealed.c] + G.pieceName(l.revealed);
      text = who + '：' + G.pieceName(l.piece) + '攻暗棋翻出' + rv + (
        l.result === 'capture' ? '，吃掉' + (l.chain > 1 ? '（連吃 ' + l.chain + '）' : '') :
        l.result === 'own' ? '（自己的棋），停止' : '，' + G.pieceName(l.piece) + '陣亡');
    }
    else if (l.type === 'end') text = who + '結束連吃';
    else if (l.type === 'resign') text = who + '投降';
    logItems.push(text);
  }
  function coord(i) { return 'ABCD'[(i / 8) | 0] + ((i % 8) + 1); }

  function doAction(a) {
    if (playMode === 'online') {
      send({ type: 'action', action: a });
      selected = null;
      return;
    }
    if (!G.isLegal(game, a)) return;
    if (game.chain === null && (playMode !== 'ai' || game.turn === humanSeat)) {
      history.push({ state: G.clone(game), log: logItems.slice() });
    }
    var prev = G.clone(game);
    G.apply(game, a);
    selected = null;
    present(prev, game).then(function (ok) { if (ok) maybeAi(); });
  }

  function maybeAi() {
    if (playMode !== 'ai' || !game || game.winner !== null || game.turn === humanSeat) return;
    aiThinking = true;
    render();
    aiTimer = setTimeout(function () {
      var seq = AI.chooseTurn(game, opts.level);
      playSeq(seq, 0);
    }, 450);
  }
  function playSeq(seq, k) {
    aiThinking = false;
    if (k >= seq.length) {
      // 連吃中回合未結束，電腦要再想一次
      if (game.winner === null && game.turn !== humanSeat) maybeAi(); else render();
      return;
    }
    var a = seq[k];
    if (!G.isLegal(game, a)) { render(); return; }
    var prev = G.clone(game);
    G.apply(game, a);
    present(prev, game).then(function (ok) {
      if (!ok || game.winner !== null || game.turn === humanSeat) return;
      aiTimer = setTimeout(function () { playSeq(seq, k + 1); }, 300);
    });
  }

  // ---------- 投降 ----------
  // 第一次按下先變成「確定投降？」，避免誤觸；3 秒內沒確認就恢復
  var resignArmed = false, resignTimer = null;
  function canResign() {
    if (!game || game.winner !== null) return false;
    if (playMode === 'online') return net.connected && net.seat != null;
    return true;
  }
  function resignSeat() {
    if (playMode === 'ai') return humanSeat;
    if (playMode === 'online') return net.seat;
    return game.turn; // 同機雙人：輪到的人投降
  }
  function disarmResign() {
    resignArmed = false; clearTimeout(resignTimer);
    $('resignBtn').textContent = '投降';
    $('resignBtn').classList.remove('danger');
    $('resignCancel').hidden = true;
  }
  function onResign() {
    if (!canResign()) return;
    if (!resignArmed) {
      resignArmed = true;
      $('resignBtn').textContent = '確定投降？';
      $('resignBtn').classList.add('danger');
      $('resignCancel').hidden = false;
      resignTimer = setTimeout(disarmResign, 3000);
      return;
    }
    disarmResign();
    if (playMode === 'online') { send({ type: 'resign' }); return; }
    clearTimeout(aiTimer); aiThinking = false;
    epoch++; busy = false; view = null; $('turnBanner').hidden = true;
    selected = null;
    G.resign(game, resignSeat());
    addLog(game);
    prevBoardKey = '';
    render();
  }

  function undo() {
    if (playMode === 'online' || !history.length) return;
    clearTimeout(aiTimer); aiThinking = false;
    epoch++; busy = false; view = null; $('turnBanner').hidden = true;
    var h = history.pop();
    game = h.state; logItems = h.log; selected = null; prevBoardKey = '';
    render();
  }

  // ---------- 點擊 ----------
  function onCell(i) {
    if (!humanCanAct()) return;
    var acts = G.legalActions(game);
    var find = function (pred) { for (var k = 0; k < acts.length; k++) if (pred(acts[k])) return acts[k]; return null; };
    var pc = game.board[i];

    if (game.chain !== null) {
      var c = find(function (a) { return a.type === 'move' && a.to === i; });
      if (c) doAction(c);
      return;
    }
    if (selected !== null) {
      var mv = find(function (a) { return a.type === 'move' && a.from === selected && a.to === i; });
      if (mv) { doAction(mv); return; }
    }
    if (pc && !pc.up) {
      var f = find(function (a) { return a.type === 'flip' && a.at === i; });
      if (f) doAction(f);
      return;
    }
    if (pc && pc.up && pc.c === game.colors[game.turn]) {
      selected = selected === i ? null : i;
      render();
      return;
    }
    selected = null;
    render();
  }

  // ---------- 繪製 ----------
  var boardEl = $('board');
  var vertical = false;
  function layoutMode() {
    var v = window.innerWidth < 620;
    if (v !== vertical) { vertical = v; prevBoardKey = ''; }
    boardEl.className = 'board ' + (vertical ? 'vertical' : 'horizontal');
  }

  function render() {
    var real = game;
    if (view) game = view;
    try { renderInner(); } finally { game = real; }
  }
  function renderInner() {
    if (!game) return;
    layoutMode();
    var acts = humanCanAct() ? G.legalActions(game) : [];
    var targets = {}, captures = {};
    acts.forEach(function (a) {
      if (a.type !== 'move') return;
      if (game.chain !== null || a.from === selected) {
        if (game.board[a.to]) captures[a.to] = true; else targets[a.to] = true;
      }
    });
    var last = game.last || {};
    var lastCells = {};
    if (last.type === 'flip') lastCells[last.at] = 'flipped';
    if (last.type === 'move' || last.type === 'capture') { lastCells[last.from] = 'from'; lastCells[last.to] = 'moved'; }
    if (last.type === 'attack') { lastCells[last.from] = last.result === 'die' ? 'died' : 'from'; lastCells[last.to] = last.result === 'capture' ? 'moved' : 'last'; }
    if (last.type === 'reveal') { lastCells[last.from] = 'attacking'; lastCells[last.to] = 'flipped'; }

    // 畫面只在狀態改變時重建，才不會一直重播動畫
    var key = JSON.stringify([game.board, game.last, game.ply, game.chain, game.chainCount, selected, acts.length, vertical, aiThinking]);
    if (key !== prevBoardKey) {
      prevBoardKey = key;
      var frag = document.createDocumentFragment();
      // 視角：自己的座位在下方；直式時把棋盤轉 90 度
      for (var i = 0; i < G.SIZE; i++) {
        var r = (i / 8) | 0, c = i % 8;
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = 0;
        if (vertical) { cell.style.gridRow = String(c + 1); cell.style.gridColumn = String(r + 1); }
        else { cell.style.gridRow = String(r + 1); cell.style.gridColumn = String(c + 1); }
        var pc = game.board[i];
        var label = coord(i);
        if (pc) {
          var p = document.createElement('div');
          if (pc.up) { p.className = 'piece ' + pc.c; p.textContent = G.pieceName(pc); label += ' ' + G.COLOR_NAME[pc.c] + G.pieceName(pc); }
          else { p.className = 'piece down'; label += ' 暗棋'; }
          cell.appendChild(p);
        } else if (lastCells[i] === 'died' && last.piece) {
          var ghost = document.createElement('div'); // 陣亡的棋子淡出
          ghost.className = 'piece ghost ' + last.piece.c; ghost.textContent = G.pieceName(last.piece);
          cell.appendChild(ghost);
          label += ' 空格';
        } else label += ' 空格';
        if (i === selected) cell.classList.add('selected');
        if (i === game.chain) cell.classList.add('chain');
        if (targets[i]) cell.classList.add('target');
        if (captures[i]) cell.classList.add('capture');
        if (lastCells[i]) { cell.classList.add('last'); if (lastCells[i] !== 'from' && lastCells[i] !== 'last') cell.classList.add(lastCells[i]); }
        cell.setAttribute('aria-label', label);
        cell.dataset.i = i;
        frag.appendChild(cell);
      }
      boardEl.innerHTML = '';
      boardEl.appendChild(frag);
      if (game.winner !== null) boardEl.appendChild(resultBox());
    }
    boardEl.classList.toggle('locked', !humanCanAct());

    // 玩家資訊
    var b = bottomSeat(), seats = [b, 1 - b];
    seats.forEach(function (seat, pos) {
      $('name' + pos).textContent = seatName(seat);
      var col = game.colors[seat];
      $('chip' + pos).textContent = col ? G.COLOR_NAME[col] + '方・剩 ' + G.remaining(game, col) : '未定色';
      $('tag' + pos).classList.toggle('active', game.winner === null && game.turn === seat);
      var tray = $('tray' + pos);
      tray.innerHTML = '';
      if (col) {
        var enemy = col === 'r' ? 'b' : 'r';
        game.captured[enemy].forEach(function (t) {
          var m = document.createElement('span');
          m.className = 'mini ' + enemy;
          m.textContent = G.NAMES[enemy][t];
          tray.appendChild(m);
        });
      }
    });

    $('chainBar').hidden = !(game.chain !== null && humanCanAct());
    $('gameActions').hidden = !canResign();
    $('resignLabel').textContent = playMode === 'local' ? '輪到的一方可以投降' : '';

    // 狀態列
    var dot = $('statusDot'), txt;
    dot.className = 'dot';
    if (game.winner !== null) {
      txt = game.winner === 'draw' ? '和局' : seatName(game.winner) + '獲勝';
    } else {
      var tc = game.colors[game.turn];
      if (tc) dot.classList.add(tc);
      if (playMode === 'online' && !net.connected) txt = '未連線';
      else if (aiThinking) txt = '電腦思考中…';
      else if (playMode === 'local') txt = '輪到' + seatName(game.turn) + (tc ? '（' + G.COLOR_NAME[tc] + '）' : '');
      else txt = game.turn === bottomSeat() ? '輪到你' + (tc ? '（' + G.COLOR_NAME[tc] + '）' : '・請翻一顆棋') : '等待' + seatName(game.turn);
      if (game.chain !== null) txt += '・連吃中';
    }
    $('statusText').textContent = txt;

    // 棋譜
    var log = $('log');
    if (log.childElementCount !== logItems.length) {
      log.innerHTML = '';
      logItems.forEach(function (t, k) {
        var li = document.createElement('li');
        var n = document.createElement('span'); n.className = 'n'; n.textContent = (k + 1) + '.';
        var s = document.createElement('span'); s.textContent = t;
        li.appendChild(n); li.appendChild(s); log.appendChild(li);
      });
      log.scrollTop = log.scrollHeight;
    }
    $('idle').textContent = game.noProgress;
    $('undoBtn').disabled = playMode === 'online' || !history.length;
  }

  function resultBox() {
    var wrap = document.createElement('div');
    wrap.className = 'result';
    var box = document.createElement('div'); box.className = 'box';
    var s = document.createElement('strong');
    s.textContent = game.winner === 'draw' ? '和局' : seatName(game.winner) + '獲勝';
    var p = document.createElement('span');
    p.textContent = game.last && game.last.type === 'resign' ? seatName(game.last.player) + '投降' + (game.colors[game.last.player] ? '（' + G.COLOR_NAME[game.colors[game.last.player]] + '方）' : '') : game.reason;
    var btn = document.createElement('button'); btn.className = 'btn primary'; btn.type = 'button';
    btn.textContent = '再來一局';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (playMode === 'online') send({ type: 'rematch' }); else startLocal();
    });
    box.appendChild(s); box.appendChild(p); box.appendChild(btn);
    wrap.appendChild(box);
    return wrap;
  }

  boardEl.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (cell) onCell(+cell.dataset.i);
  });
  boardEl.addEventListener('keydown', function (e) {
    var cell = e.target.closest('.cell');
    if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onCell(+cell.dataset.i); }
  });
  $('endChain').addEventListener('click', function () { if (humanCanAct() && game.chain !== null) doAction({ type: 'end' }); });
  $('startBtn').addEventListener('click', startLocal);
  $('undoBtn').addEventListener('click', undo);
  $('resignBtn').addEventListener('click', onResign);
  $('resignCancel').addEventListener('click', disarmResign);
  window.addEventListener('resize', render);

  // ---------- 線上對戰 ----------
  function defaultServer() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      if (!/claude\.ai|claudeusercontent/.test(location.host)) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    }
    return 'ws://localhost:3000';
  }
  $('serverUrl').value = defaultServer();

  function note(t, err) { var n = $('netNote'); n.textContent = t; n.classList.toggle('err', !!err); }

  // 線上對戰有兩種傳輸方式：
  //  1. Claude Artifact 頁面：用 Artifact 的共享資料庫（db）同步棋局，不需要伺服器
  //  2. 其他情況：連到本專案的 WebSocket 伺服器（node server/server.js）
  var cloud = { db: null, ready: false, ref: null, unsub: null, code: null, gameNo: -1, seq: -1, data: null, writing: false };
  var inArtifact = !!(window.claude && typeof window.claude.use === 'function');
  var clientId = (function () {
    var id = null;
    try { id = sessionStorage.getItem('darkchess-client'); } catch (e) {}
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { sessionStorage.setItem('darkchess-client', id); } catch (e) {}
    }
    return id;
  })();

  function disconnect() {
    if (net.ws) { net.ws.onclose = null; try { net.ws.close(); } catch (e) {} }
    if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
    cloud.ref = null; cloud.code = null; cloud.gameNo = -1; cloud.seq = -1; cloud.data = null;
    net = { ws: null, seat: null, room: null, connected: false };
    $('roomShow').hidden = true;
  }
  function send(m) {
    if (cloud.ref) { cloudSend(m); return; }
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(m));
  }

  function handleMsg(m) {
    if (m.type === 'created') {
      net.room = m.room; net.seat = m.seat;
      $('roomCode').textContent = m.room; $('roomShow').hidden = false;
      note(cloud.ref ? '房間已建立，等待對手加入。請把這個網頁分享給對手，對方開啟後選「線上雙人」並輸入房號。' : '房間已建立，等待對手加入…');
    } else if (m.type === 'start') {
      net.seat = m.seat; net.room = m.room; playMode = 'online'; net.connected = true;
      logItems = []; history = []; prevBoardKey = '';
      $('roomCode').textContent = m.room; $('roomShow').hidden = false;
      note(m.seat == null ? '你正在觀戰這個房間。' : '對局開始！' + (m.seat === m.state.turn ? '你先手。' : '對手先手。'));
      var my = ++epoch;
      netQueue = Promise.resolve().then(function () {
        game = m.state; selected = null; view = null; busy = true; render();
        return showBanner(game).then(function () { if (my === epoch) { busy = false; render(); } });
      });
    } else if (m.type === 'state') {
      net.connected = true;
      netQueue = netQueue.then(function () {
        var prev = game; game = m.state; selected = null;
        return present(prev, game);
      });
    } else if (m.type === 'error') {
      note(m.msg, true);
    } else if (m.type === 'opponent_left') {
      net.connected = false;
      note('對手已離線。', true);
      render();
    }
  }

  function connect(first) {
    disconnect();
    clearTimeout(aiTimer); aiThinking = false;
    if (inArtifact) { cloudConnect(first); return; }
    var url = $('serverUrl').value.trim();
    note('連線中…');
    var ws;
    try { ws = new WebSocket(url); } catch (e) { note('伺服器網址格式不正確，請以 ws:// 或 wss:// 開頭。', true); return; }
    net.ws = ws;
    ws.onopen = function () { send(first); };
    ws.onerror = function () { note('連不上伺服器。請確認已執行 node server/server.js，且網址正確。', true); };
    ws.onclose = function () {
      net.connected = false;
      if (playMode === 'online') { note('連線已中斷。', true); render(); }
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handleMsg(m);
    };
  }

  // ---------- Artifact 共享資料庫 ----------
  function plainState(st) { return G.clone(JSON.parse(JSON.stringify(st))); }
  function writeFailed() {
    note('無法寫入棋局。請確認已登入 claude.ai，且這個網頁的分享權限是「參與者」以上（請網頁擁有者在分享選單設定）。', true);
  }

  function cloudConnect(first) {
    if (!cloud.ready) { note('正在準備線上功能，請稍候再試。'); return; }
    if (!cloud.db) { note('這個檢視無法使用線上對戰。請登入 claude.ai 後再開啟這個網頁。', true); return; }
    note('連線中…');
    var p = first.type === 'create' ? cloudCreate(first.mode) : cloudJoin(first.room);
    p.catch(function (e) {
      if (e && e.code === 'invalid_argument') writeFailed();
      else note('線上服務暫時無法使用，請稍後再試。', true);
    });
  }

  function cloudCreate(mode) {
    var tries = 0;
    function attempt() {
      var code = String(Math.floor(1000 + Math.random() * 9000));
      var ref = cloud.db.doc('games/' + code);
      return ref.get().then(function (snap) {
        var d = snap.exists ? snap.data() : null;
        // 房號被占用（且最近一小時內有人用過）就換一個
        if (d && Date.now() - (d.updatedAt || 0) < 3600e3 && tries++ < 8) return attempt();
        return ref.set({ mode: mode, order: [clientId, null], state: null, seq: 0, gameNo: 0, updatedAt: Date.now() })
          .then(function () { cloudSubscribe(code, ref); });
      });
    }
    return attempt();
  }

  function cloudJoin(code) {
    var ref = cloud.db.doc('games/' + code);
    return ref.get().then(function (snap) {
      if (!snap.exists) { note('找不到這個房號。', true); return; }
      var d = snap.data();
      if (d.order.indexOf(clientId) >= 0 || d.order[1]) { cloudSubscribe(code, ref); return; } // 回到自己的房間，或觀戰
      // 用短租約搶第二個座位，避免兩人同時加入
      return ref.acquire({ holder: clientId, ttlMs: 5000 }).then(function (lease) {
        if (!lease.acquired) { note('有人正在加入這個房間，請稍後再試。', true); return; }
        return ref.get().then(function (s2) {
          var d2 = s2.data();
          if (d2.order[1]) { cloudSubscribe(code, ref); return; }
          return ref.update({ order: [d2.order[0], clientId], state: G.newGame({ mode: d2.mode }), seq: 1, gameNo: 1, updatedAt: Date.now() })
            .then(function () { cloudSubscribe(code, ref); });
        });
      });
    });
  }

  function cloudSubscribe(code, ref) {
    cloud.ref = ref; cloud.code = code;
    cloud.unsub = ref.onSnapshot(function (snap) {
      if (cloud.ref !== ref || !snap.exists) return;
      var d = snap.data();
      cloud.data = d;
      var seat = d.order.indexOf(clientId);
      if (seat < 0) seat = null;
      if (!d.state) { if (seat === 0) handleMsg({ type: 'created', room: code, seat: 0 }); return; }
      if (d.gameNo !== cloud.gameNo) {
        cloud.gameNo = d.gameNo; cloud.seq = d.seq;
        handleMsg({ type: 'start', room: code, seat: seat, state: plainState(d.state) });
      } else if (d.seq !== cloud.seq) {
        cloud.seq = d.seq;
        handleMsg({ type: 'state', state: plainState(d.state) });
      }
    }, function () {
      net.connected = false;
      note('與共享棋局的連線中斷，請重新加入房間。', true);
      render();
    });
  }

  function cloudWrite(body) {
    if (cloud.writing) return;
    cloud.writing = true;
    body.updatedAt = Date.now();
    cloud.ref.update(body).catch(writeFailed).then(function () { cloud.writing = false; });
  }

  function cloudSend(m) {
    var d = cloud.data;
    if (!d || !d.state) return;
    if (m.type === 'action') {
      var s = plainState(d.state);
      if (d.order[s.turn] !== clientId || !G.isLegal(s, m.action)) return;
      G.apply(s, m.action);
      cloudWrite({ state: JSON.parse(JSON.stringify(s)), seq: d.seq + 1 });
    } else if (m.type === 'resign') {
      var seat = d.order.indexOf(clientId);
      if (seat < 0 || d.state.winner !== null) return;
      var rs = G.resign(plainState(d.state), seat);
      cloudWrite({ state: JSON.parse(JSON.stringify(rs)), seq: d.seq + 1 });
    } else if (m.type === 'rematch') {
      if (d.state.winner === null || d.order.indexOf(clientId) < 0) return;
      // 再來一局：交換先手
      cloudWrite({ order: [d.order[1], d.order[0]], state: G.newGame({ mode: d.mode }), seq: d.seq + 1, gameNo: d.gameNo + 1 });
    }
  }

  if (inArtifact) {
    $('serverField').hidden = true;
    note('線上對戰會透過這個網頁的共享資料同步。對手需要能開啟這個網頁，並有「參與者」以上的權限。');
    window.claude.use('db').then(function (db) {
      cloud.db = db; cloud.ready = true;
      if (!db) note('這個檢視無法使用線上對戰。請登入 claude.ai 後再開啟這個網頁。', true);
    }, function () { cloud.ready = true; });
  }

  $('createRoom').addEventListener('click', function () { connect({ type: 'create', mode: opts.rule }); });
  $('joinRoom').addEventListener('click', function () {
    var code = $('roomInput').value.trim();
    if (!/^\d{4}$/.test(code)) { note('房號是 4 位數字。', true); return; }
    connect({ type: 'join', room: code });
  });

  syncSegs();
  startLocal();
})();
