/* ============================================================
 * app.js —— 滚滚长河 · 界面交互
 *  - HUD 年份计数器与飞览进度（源头 → 入海口）
 *  - 纪元年表导航（点击飞往该河段）
 *  - 类别图例筛选 / 搜索 / 河道刻度切换 / 航行按钮
 *  - 事件档案卡（含"宇宙日历"与"同时代"事件联想）
 *  - 纪元卡 / 科普课堂 / 帮助弹窗 / 底部小知识滚动
 * 依赖：data.js、scene.js
 * ============================================================ */
'use strict';

(function () {
  const D = window.TR_DATA;
  const S = window.TRScene;

  const $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function eventById(id) { return D.EVENTS.filter(function (e) { return e.id === id; })[0]; }

  /* ================= 启动自检 ================= */
  if (!window.THREE) {
    $('error-banner').textContent = '⚠️ three.js 加载失败，请确认 js/lib/three.min.js 存在';
    $('error-banner').classList.remove('hidden');
    return;
  }
  window.addEventListener('error', function (e) {
    const where = e.filename ? '（' + String(e.filename).split('/').pop() + ':' + e.lineno + '）' : '';
    $('error-banner').textContent = '⚠️ 运行出错：' + (e.message || e.type) + where;
    $('error-banner').classList.remove('hidden');
  });

  /* ================= 🎙 语音导览（Web Speech，离线可用） ================= */
  let voiceOn = false, zhVoice = null, lastEraSpoken = -1;
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    zhVoice = vs.filter(function (v) { return /^zh/i.test(v.lang); })[0] || null;
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text, urgent) {
    if (!voiceOn || !window.speechSynthesis || !text) return;
    if (!zhVoice) pickVoice();
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (zhVoice) u.voice = zhVoice;
      u.rate = 1.05;
      if (urgent) speechSynthesis.cancel();     // 航行播报以最新为准
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function firstSentence(s) {
    const m = String(s).split(/[。；]/)[0];
    return m ? m + '。' : '';
  }
  $('btn-voice').addEventListener('click', function () {
    voiceOn = !voiceOn;
    this.classList.toggle('on', voiceOn);
    if (voiceOn) speak('语音导览已开启。', true);
    else if (window.speechSynthesis) speechSynthesis.cancel();
    savePrefs();
  });

  /* ================= 🎥 录制飞览（MediaRecorder → webm 下载） ================= */
  let mediaRecorder = null, recChunks = [], recActive = false;
  function startRec() {
    const canvas = document.querySelector('#scene-container canvas');
    if (!canvas || !window.MediaRecorder) throw new Error('当前浏览器不支持画布录制');
    const stream = canvas.captureStream(30);
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    recChunks = [];
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size) recChunks.push(e.data);
    };
    mediaRecorder.onstop = function () {
      const blob = new Blob(recChunks, { type: 'video/webm' });
      window.__recInfo = { size: blob.size, at: Date.now() };   // 调试出口
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '滚滚长河-飞览-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    };
    mediaRecorder.start(250);
    recActive = true;
    $('rec-chip').classList.remove('hidden');
    $('btn-rec').classList.add('on');
    $('btn-rec').textContent = '⏹ 停止';
  }
  function stopRec() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recActive = false;
    $('rec-chip').classList.add('hidden');
    $('btn-rec').classList.remove('on');
    $('btn-rec').textContent = '🎥 录制';
  }
  $('btn-rec').addEventListener('click', function () {
    try {
      if (recActive) { stopRec(); }
      else { startRec(); S.replay(); syncButtons(); }
    } catch (err) {
      $('error-banner').textContent = '⚠️ 录制失败：' + err.message;
      $('error-banner').classList.remove('hidden');
    }
  });

  /* ================= 🔗 分享定位（URL hash） ================= */
  function updateHash() {
    try {
      const st = S.state;
      const parts = [];
      if (tour) {
        parts.push('tour=' + tour.id);       // 分享的是整条教学路线
      } else {
        if (st.mode !== 'deep') parts.push('m=' + st.mode);
        if (st.selected) parts.push('e=' + st.selected);
      }
      const newHash = parts.length ? '#' + parts.join('&') : '';
      if (location.hash !== newHash) {
        if (newHash) history.replaceState(null, '', newHash);
        else history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) {}
  }
  function applyHash() {
    const h = {};
    location.hash.slice(1).split('&').forEach(function (kv) {
      const i = kv.indexOf('=');
      if (i > 0) h[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    if (h.tour) {
      const t = D.TOURS.filter(function (x) { return x.id === h.tour; })[0];
      if (t) {
        window.__TR_NO_AUTO_FLY = true;
        startTour(t);
        return;
      }
    }
    if (h.m && D.ERAS[h.m]) {
      const b = document.querySelector('#mode-seg button[data-mode="' + h.m + '"]');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    if (h.e && eventById(h.e)) {
      window.__TR_NO_AUTO_FLY = true;      // 有定位事件时不自动起飞，直接飞往该河灯
      S.selectEvent(h.e, true);
      syncButtons();
    }
  }

  /* ================= HUD：年份计数器 + 飞览进度 ================= */
  let lastYearText = '', lastPaused = null;
  S.onFly(function (g) {
    const yearText = D.fmtAgo(g.ago);
    if (yearText !== lastYearText || S.state.paused !== lastPaused) {
      $('hud-year').textContent = yearText;
      lastYearText = yearText;
      lastPaused = S.state.paused;
      $('hud-sub').textContent = (S.state.paused ? '⏸ 已暂停 · ' : '🎬 飞览全程 · ') +
        (g.era || '大河尽头') + ' · 河灯 ' + g.lit + '/' + g.total;
    }
    $('hud-progress').firstElementChild.style.width = (g.pct * 100).toFixed(1) + '%';
    /* 纪元年表：高亮当前所在纪元 */
    document.querySelectorAll('.era-item').forEach(function (el, i) {
      el.classList.toggle('active', i === g.eraIdx);
    });
    /* 语音导览：进入新纪元时播报 */
    if (voiceOn && S.state.flying && !S.state.paused && g.eraIdx >= 0 && g.eraIdx !== lastEraSpoken) {
      lastEraSpoken = g.eraIdx;
      const era = D.ERAS[S.state.mode][g.eraIdx];
      speak('进入' + era.name + '，' + D.fmtAgo(era.from) + '至' +
        (era.to <= 0 ? '今天' : D.fmtAgo(era.to)) + '。' + firstSentence(era.blurb), true);
    }
    /* 纪录片模式：纪元切换时刷字幕 */
    if (docMode && S.state.flying && !S.state.paused && g.eraIdx >= 0 && g.eraIdx !== docEraIdx) {
      docEraIdx = g.eraIdx;
      docCaption(g.eraIdx);
    }
  });
  S.onFlyDone(function () {
    $('hud-year').textContent = '今天';
    lastYearText = '今天';
    $('hud-sub').textContent = '🌊 已到入海口 · 138 亿年奔流入海';
    syncButtons();
    if (recActive) setTimeout(stopRec, 1200);   // 录制时：入海定格后自动收尾
  });
  function modeSub() {
    const m = D.MODES.filter(function (x) { return x.id === S.state.mode; })[0];
    return '🏞️ ' + m.label + ' · ' + m.sub + ' · ' + S.eventsInMode().length + ' 盏河灯';
  }

  /* ================= 航行按钮 ================= */
  function syncButtons() {
    const st = S.state;
    const bf = $('btn-fly');
    if (st.flying) bf.textContent = st.paused ? '▶ 继续飞览' : '⏸ 暂停飞览';
    else if (st.flyHold && st.flyP < 1) bf.textContent = '▶ 从此处继续 (' + Math.round(st.flyP * 100) + '%)';
    else if (st.flyP >= 1) bf.textContent = '🔄 再飞一次';
    else bf.textContent = '🎬 飞览全程';
    $('btn-pause').textContent = st.paused ? '▶ 播放' : '⏸ 暂停';
    $('btn-overview').textContent = st.camMode === 'overview' ? '🚣 回到河段' : '🗺 全河鸟瞰';
    /* 语音导览与时间凝固联动 */
    if (window.speechSynthesis && voiceOn) {
      try {
        if (st.paused) speechSynthesis.pause();
        else speechSynthesis.resume();
      } catch (e) {}
    }
    /* 环境水声随暂停减弱/恢复 */
    if (waterGain && audioCtx) {
      try {
        waterGain.gain.linearRampToValueAtTime(st.paused ? 0.012 : 0.05, audioCtx.currentTime + 0.4);
      } catch (e) {}
    }
  }
  $('btn-fly').addEventListener('click', function () { lastEraSpoken = -1; S.toggleFly(); syncButtons(); });
  /* ⚡ 飞览速度三档：0.5× / 1× / 2× */
  const SPEEDS = [[0.5, '🐢 0.5×'], [1, '⚡ 1×'], [2, '🚀 2×']];
  let speedIdx = 1;
  $('btn-speed').addEventListener('click', function () {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    S.setSpeedMul(SPEEDS[speedIdx][0]);
    this.textContent = SPEEDS[speedIdx][1];
    pluck(500 + speedIdx * 160, 0.08, 0.03);
  });
  $('btn-pause').addEventListener('click', function () { S.togglePause(); syncButtons(); });
  $('btn-overview').addEventListener('click', function () { S.toggleOverview(); syncButtons(); });
  S.onCamMode(syncButtons);

  /* ================= 🧭 探索进度 + 🔔 交互音效 ================= */
  let explored = {};
  try { explored = JSON.parse(localStorage.getItem('tr-explored') || '{}'); } catch (e) {}
  let exploredN = Object.keys(explored).length;
  const ACHV = [
    [10, '🌱', '初涉长河'],
    [25, '🕯️', '灯火渐明'],
    [50, '🔥', '星火燎原'],
    [100, '💯', '百灯之约'],
    [200, '⛵', '半程巡礼'],
    [400, '🎓', '长河拾遗大家'],
    [551, '🏆', '燃尽长河 · 全图鉴']
  ];
  let achvShown = {};
  try { achvShown = JSON.parse(localStorage.getItem('tr-achv') || '{}'); } catch (e) {}
  function checkAchievements() {
    ACHV.forEach(function (a) {
      if (exploredN >= a[0] && !achvShown[a[0]]) {
        achvShown[a[0]] = 1;
        try { localStorage.setItem('tr-achv', JSON.stringify(achvShown)); } catch (e) {}
        showAchievement(a[1], a[2], '已探索 ' + a[0] + ' 个事件');
      }
    });
  }
  let achvTimer = null;
  function showAchievement(emoji, title, sub) {
    $('achv-emoji').textContent = emoji;
    $('achv-title').textContent = '成就解锁 · ' + title;
    $('achv-sub').textContent = sub;
    const t = $('achv-toast');
    t.classList.remove('hidden');
    pluck(660, 0.14, 0.05);
    setTimeout(function () { pluck(880, 0.18, 0.05); }, 130);
    if (achvTimer) clearTimeout(achvTimer);
    achvTimer = setTimeout(function () { t.classList.add('hidden'); }, 4200);
  }
  function markExplored(id) {
    if (explored[id]) return false;
    explored[id] = 1;
    exploredN++;
    try { localStorage.setItem('tr-explored', JSON.stringify(explored)); } catch (e) {}
    updateExplored();
    updateLegendCounts();
    drawRings();
    checkAchievements();
    return true;
  }
  function updateExplored() {
    const el = document.getElementById('explored');
    if (el) el.textContent = '🧭 已探索 ' + exploredN + ' / ' + D.EVENTS.length + ' 事件';
  }
  function ensureCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function pluck(freq, dur, vol) {
    try {
      const ctx = ensureCtx();
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }

  /* ================= 🎓 教学路线 ================= */
  let tour = null, tourIdx = 0, tourAuto = null;
  function buildTourList() {
    const box = $('tour-list');
    box.innerHTML = '';
    D.TOURS.forEach(function (t) {
      const el = document.createElement('button');
      el.className = 'tour-item';
      el.innerHTML = '<span>' + t.icon + ' ' + esc(t.name) + '</span><b>' + t.steps.length + ' 站</b>';
      el.title = t.desc;
      el.addEventListener('click', function () { startTour(t); });
      box.appendChild(el);
    });
  }
  function startTour(t) {
    tour = t;
    tourIdx = 0;
    $('tour-player').classList.remove('hidden');
    stopTourAuto();
    gotoTourStep(0);
    updateHash();          // 路线分享链接 #tour=xxx
  }
  function gotoTourStep(i) {
    if (!tour) return;
    tourIdx = Math.max(0, Math.min(tour.steps.length - 1, i));
    const ev = eventById(tour.steps[tourIdx]);
    if (!ev) return;
    $('tour-title').textContent = tour.icon + ' ' + tour.name;
    $('tour-stepnum').textContent = '第 ' + (tourIdx + 1) + ' / ' + tour.steps.length + ' 站 · ' + D.fmtAgo(ev.ago);
    pluck(560 + (tourIdx % 5) * 60, 0.1, 0.035);
    S.selectEvent(ev.id, true);
    speak('第' + (tourIdx + 1) + '站，' + ev.title + '。' + firstSentence(ev.desc), true);
    if (tourAuto && tourIdx >= tour.steps.length - 1) stopTourAuto();   // 末站停自动
  }
  function stopTourAuto() {
    if (tourAuto) { clearInterval(tourAuto); tourAuto = null; }
    const b = $('btn-tour-auto');
    if (b) { b.classList.remove('on'); b.textContent = '▶ 自动'; }
  }
  $('btn-tour-prev').addEventListener('click', function () { stopTourAuto(); gotoTourStep(tourIdx - 1); });
  $('btn-tour-next').addEventListener('click', function () { stopTourAuto(); gotoTourStep(tourIdx + 1); });
  $('btn-tour-auto').addEventListener('click', function () {
    if (tourAuto) { stopTourAuto(); return; }
    this.classList.add('on');
    this.textContent = '⏸ 自动中';
    tourAuto = setInterval(function () {
      if (!tour) { stopTourAuto(); return; }
      if (tourIdx >= tour.steps.length - 1) { stopTourAuto(); return; }
      gotoTourStep(tourIdx + 1);
    }, 9000);
  });
  $('btn-tour-exit').addEventListener('click', function () {
    stopTourAuto();
    tour = null;
    $('tour-player').classList.add('hidden');
    $('detail-panel').classList.add('hidden');
    S.clearSelection();
    updateHash();
  });

  /* ================= 🗺 小地图 ================= */
  function drawMinimap() {
    const mm = S.getMinimap();
    const cv = document.getElementById('minimap');
    if (!mm || !cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(mm.canvas, 0, 0, cv.width, cv.height);
    /* 镜头金点 + 朝向 */
    const d = S._dbg();
    const cp = mm.map(d.camera.position.x, d.camera.position.z);
    ctx.fillStyle = '#ffd27f';
    ctx.shadowColor = 'rgba(255,180,80,0.9)';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    /* 目标点（controls.target 视线落点） */
    const tp = mm.map(d.controls.target.x, d.controls.target.z);
    ctx.strokeStyle = 'rgba(255,210,127,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(tp.x, tp.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  setInterval(drawMinimap, 180);
  window.__drawMinimap = drawMinimap;   // 调试钩子（节流环境下手动补绘）
  document.getElementById('minimap').addEventListener('pointerdown', function (e) {
    const mm = S.getMinimap();
    if (!mm) return;
    const rect = this.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (340 / rect.width);
    const my = (e.clientY - rect.top) * (236 / rect.height);
    const w = mm.unmap(mx, my);
    S.mapSeek(w.x, w.z);
    syncButtons();
  });

  /* ================= 🏆 问答模式（寻宝） ================= */
  let quizOn = false, quizPool = [], quizIdx = 0, quizTarget = null;
  let quizRound = 0, quizStreak = 0, quizHintUsed = false;
  let quizScope = 'all';                   // 'all' | 'cn' | 'grc' | 'isl' | 'ind' | 'world'
  let quizRemain = 0, quizWrong = [];
  try { quizWrong = JSON.parse(localStorage.getItem('tr-wrong') || '[]'); } catch (e) {}
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function rebuildPool() {
    quizPool = shuffle(S.eventsInMode().filter(function (e) {
      if (e.imp < 2) return false;
      if (quizScope === 'cn') return !!e.cn;
      if (quizScope === 'grc') return e.cult === 'grc';
      if (quizScope === 'isl') return e.cult === 'isl';
      if (quizScope === 'ind') return e.cult === 'ind';
      if (quizScope === 'world') return !e.cn && !e.cult;
      return true;
    }));
    quizIdx = 0;
  }
  function startQuiz() {
    quizOn = true;
    window.__quizOn = true;
    rebuildPool();
    quizRound = 0; quizStreak = 0;
    if (S.state.flying) { S.toggleFly(); }   // 答题时先停下飞览
    nextQuestion();
    $('quiz-card').classList.remove('hidden');
  }
  function stopQuiz() {
    quizOn = false;
    window.__quizOn = false;
    quizTarget = null;
    S.setQuiz(null);
    $('quiz-card').classList.add('hidden');
    $('btn-quiz').classList.remove('on');
  }
  function eraNameOf(ev) {
    const p = S.progressOf(ev.ago);
    const eras = D.ERAS[S.state.mode];
    for (let i = 0; i < eras.length; i++) {
      const pA = Math.min(S.progressOf(eras[i].from), S.progressOf(eras[i].to));
      const pB = Math.max(S.progressOf(eras[i].from), S.progressOf(eras[i].to));
      if (p >= pA && p <= pB) return eras[i].name;
    }
    return '';
  }
  function nextQuestion() {
    if (!quizOn) return;
    if (!quizPool.length) { stopQuiz(); return; }
    if (quizIdx >= quizPool.length) { quizPool = shuffle(quizPool); quizIdx = 0; }
    const ev = quizPool[quizIdx++];
    quizTarget = ev;
    quizHintUsed = false;
    S.setQuiz(ev.id);
    const c = D.CATS[ev.cat];
    $('quiz-q').innerHTML = '🔎 请找到 <b>' + esc(ev.title) + '</b> 的河灯';
    $('quiz-hints').innerHTML =
      '<span class="chip cat" style="--c:' + c.color + '">' + c.icon + ' ' + c.name + '</span>' +
      '<span class="chip">' + esc(eraNameOf(ev)) + '</span>' +
      '<span class="chip year">' + D.fmtAgo(ev.ago) + '</span>';
    $('quiz-feedback').textContent = '';
    const rem = document.getElementById('quiz-remain');
    if (rem) rem.textContent = '⏳ 25s';
    updateQuizStats();
    speak('请找到，' + ev.title + '。', true);
  }
  function updateQuizStats() {
    $('quiz-stats').textContent = '✅ 连对 ' + quizStreak + ' · 已答 ' + quizRound + ' 题 · 🏆 最佳 ' + quizBest +
      (quizWrong.length ? ' · ❗ 错题 ' + quizWrong.length : '');
  }
  S.onQuiz(function (res) {
    if (!quizOn) return;
    quizRound++;
    if (res.correct) {
      quizStreak++;
      if (quizWrong.indexOf(res.id) >= 0) {
        quizWrong = quizWrong.filter(function (id) { return id !== res.id; });
        try { localStorage.setItem('tr-wrong', JSON.stringify(quizWrong)); } catch (e) {}
      }
      if (quizStreak > quizBest) { quizBest = quizStreak; savePrefs(); }
      $('quiz-feedback').textContent = '🎉 答对了！';
      $('quiz-feedback').className = 'ok';
      pluck(660, 0.12, 0.06); setTimeout(function () { pluck(880, 0.16, 0.06); }, 110);
      speak('答对了！', false);
    } else {
      quizStreak = 0;
      if (quizTarget && quizWrong.indexOf(quizTarget.id) < 0) {
        quizWrong.push(quizTarget.id);
        try { localStorage.setItem('tr-wrong', JSON.stringify(quizWrong)); } catch (e) {}
      }
      const clicked = eventById(res.id);
      $('quiz-feedback').textContent = '❌ 这是「' + (clicked ? clicked.title : '别的河灯') + '」，再找找';
      $('quiz-feedback').className = 'bad';
      pluck(200, 0.25, 0.05);
      speak('不对哦，再找找。', true);
    }
    updateQuizStats();
    setTimeout(function () { if (quizOn) nextQuestion(); }, res.correct ? 1400 : 1800);
  });
  $('btn-quiz').addEventListener('click', function () {
    if (quizOn) { stopQuiz(); }
    else {
      this.classList.add('on');
      /* 重置类别筛选，保证目标河灯可见 */
      document.querySelectorAll('.legend-item').forEach(function (el) { el.classList.add('on'); });
      Object.keys(D.CATS).forEach(function (k) { S.setCategory(k, true); });
      startQuiz();
    }
  });
  document.querySelectorAll('#quiz-scope button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#quiz-scope button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      quizScope = b.dataset.scope;
      if (!quizOn) { quizOn = true; window.__quizOn = true; $('quiz-card').classList.remove('hidden'); }
      quizRound = 0; quizStreak = 0;
      rebuildPool();
      nextQuestion();
      syncButtons();
    });
  });

  /* ❗ 错题重练：只出答错过的题 */
  $('btn-quiz-wrong').addEventListener('click', function () {
    if (!quizOn || !quizWrong.length) {
      const fb = $('quiz-feedback');
      fb.textContent = '暂无错题记录，继续加油！';
      fb.className = 'ok';
      return;
    }
    quizPool = shuffle(quizWrong.map(function (id) { return eventById(id); }).filter(Boolean));
    quizIdx = 0;
    quizTarget = null;
    nextQuestion();
  });

  $('btn-quiz-hint').addEventListener('click', function () {
    if (!quizTarget) return;
    quizHintUsed = true;
    S.focusEra(D.ERAS[S.state.mode].indexOf(
      D.ERAS[S.state.mode].filter(function (era) {
        const p = S.progressOf(quizTarget.ago);
        const pA = Math.min(S.progressOf(era.from), S.progressOf(era.to));
        const pB = Math.max(S.progressOf(era.from), S.progressOf(era.to));
        return p >= pA && p <= pB;
      })[0]
    ));
    if ($('detail-panel').classList.contains('hidden')) return;
  });
  $('btn-quiz-skip').addEventListener('click', function () {
    if (!quizTarget) return;
    const t = quizTarget;
    quizStreak = 0;
    S.setQuiz(null);          // 跳过：直接揭示答案
    S.selectEvent(t.id, true);
    quizRound++;
    updateQuizStats();
    $('quiz-feedback').textContent = '💡 答案已飞达，记住它的位置';
    $('quiz-feedback').className = 'bad';
    setTimeout(function () { if (quizOn) nextQuestion(); }, 2200);
  });

  /* ================= 🔊 环境水声（Web Audio 合成） ================= */
  let audioCtx = null, waterGain = null, soundOn = false;
  function startAmbience() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('浏览器不支持 Web Audio');
    audioCtx = new AC();
    const len = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {          // 布朗噪声 ≈ 流水声
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.2;
    }
    const dc = data[0] - data[len - 1];      // 首尾校正 → 无缝循环
    for (let i = 0; i < len; i++) data[i] += dc * i / len;
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420;
    waterGain = audioCtx.createGain();
    waterGain.gain.value = 0;
    src.connect(filt); filt.connect(waterGain); waterGain.connect(audioCtx.destination);
    src.start();
    /* 缓慢起伏（像波浪涨落） */
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
    lfo.start();
  }
  $('btn-sound').addEventListener('click', function () {
    soundOn = !soundOn;
    this.classList.toggle('on', soundOn);
    try {
      if (soundOn) {
        if (!audioCtx) startAmbience();
        else audioCtx.resume();
        if (waterGain) waterGain.gain.linearRampToValueAtTime(0.05, audioCtx.currentTime + 0.6);
      } else if (waterGain) {
        waterGain.gain.linearRampToValueAtTime(0.0, audioCtx.currentTime + 0.4);
      }
    } catch (err) {
      $('error-banner').textContent = '⚠️ 音频初始化失败：' + err.message;
      $('error-banner').classList.remove('hidden');
    }
  });

  /* ================= ⛶ 全屏 ================= */
  $('btn-fs').addEventListener('click', function () {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else {
        document.exitFullscreen();
      }
    } catch (e) {}
  });

  /* ================= 移动端面板抽屉 ================= */
  const sidePanel = document.getElementById('side-panel');
  document.getElementById('panel-toggle').addEventListener('click', function (e) {
    e.stopPropagation();
    sidePanel.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (sidePanel.classList.contains('open') &&
        !e.target.closest('#side-panel') && !e.target.closest('#panel-toggle')) {
      sidePanel.classList.remove('open');
    }
  });

  /* ================= 🖼 分享当前画面 ================= */
  $('btn-shot').addEventListener('click', function () {
    try {
      const src = document.querySelector('#scene-container canvas');
      if (!src || !src.width) throw new Error('画面尚未就绪');
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      ctx.font = Math.round(c.width * 0.02) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText('🏞️ 滚滚长河 · ' + document.getElementById('hud-year').textContent, c.width - 28, c.height - 28);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = '滚滚长河-' + new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      pluck(720, 0.1, 0.04);
    } catch (err) {
      $('error-banner').textContent = '⚠️ 保存画面失败：' + err.message;
      $('error-banner').classList.remove('hidden');
    }
  });

  /* ================= 📚 长河图鉴 ================= */
  let atlasKey = null, atlasView = 'era', atlasStar = false;
  function atlasGroups(evs) {
    if (atlasView === 'civ') {
      return [
        { icon: '🐉', name: '中国支流', filter: function (e) { return !!e.cn; } },
        { icon: '🏛️', name: '希腊·罗马支流', filter: function (e) { return e.cult === 'grc'; } },
        { icon: '🕌', name: '阿拉伯·伊斯兰支流', filter: function (e) { return e.cult === 'isl'; } },
        { icon: '🕉️', name: '印度支流', filter: function (e) { return e.cult === 'ind'; } },
        { icon: '🌍', name: '世界与自然', filter: function (e) { return !e.cn && !e.cult; } }
      ];
    }
    const eras = D.ERAS[S.state.mode];
    return eras.map(function (era) {
      const pA = Math.min(S.progressOf(era.from), S.progressOf(era.to));
      const pB = Math.max(S.progressOf(era.from), S.progressOf(era.to));
      return {
        icon: D.eraEmoji(era.name), name: era.name,
        filter: function (e) {
          const p = S.progressOf(e.ago);
          return p >= pA && p <= pB;
        }
      };
    });
  }
  function buildAtlasList() {
    const evs = S.eventsInMode().slice().sort(function (a, b) { return b.ago - a.ago; });
    const groups = atlasGroups(evs);
    let html = '';
    groups.forEach(function (grp, gi) {
      const set = evs.filter(grp.filter);
      const shown = atlasStar ? set.filter(function (e) { return !!e.wiki; }) : set;
      if (atlasStar && !shown.length) return;
      html += '<details' + (gi === groups.length - 1 ? ' open' : '') + '><summary>' +
        grp.icon + ' ' + esc(grp.name) + ' · ' + shown.length + ' 事件</summary><div class="atlas-ev">' +
        (shown.length ? shown.map(function (e) {
          return '<button class="chip link" data-goto="' + e.id + '"' + (e.wiki ? ' data-star="1"' : '') + '>' +
            (e.wiki ? '⭐ ' : '') + D.CATS[e.cat].icon + ' ' + esc(e.title) + '</button>';
        }).join('') : '<span class="dim">无</span>') + '</div></details>';
    });
    const list = document.getElementById('atlas-list');
    list.innerHTML = html;
    list.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById('modal-atlas').classList.add('hidden');
        S.selectEvent(b.dataset.goto, true);
        syncButtons();
      });
    });
    applyAtlasFilter();
  }
  function applyAtlasFilter() {
    const search = document.getElementById('atlas-search');
    const list = document.getElementById('atlas-list');
    const q = search ? search.value.trim().toLowerCase() : '';
    list.querySelectorAll('details').forEach(function (det) {
      const btns = det.querySelectorAll('[data-goto]');
      let any = !q;
      btns.forEach(function (b) {
        let show = !q || b.textContent.toLowerCase().indexOf(q) >= 0;
        if (atlasStar && b.dataset.star !== '1') show = false;
        b.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      det.style.display = any ? '' : 'none';
      if (q && any) det.open = true;
    });
  }
  function openAtlas() {
    const key = S.state.mode + '|' + atlasView + '|' + (atlasStar ? 1 : 0);
    if (atlasKey !== key) {
      buildAtlasList();
      atlasKey = key;
    }
    const search = document.getElementById('atlas-search');
    if (search && !search.dataset.bound) {
      search.addEventListener('input', applyAtlasFilter);
      search.dataset.bound = '1';
    }
    $('modal-atlas').classList.remove('hidden');
  }
  $('btn-atlas').addEventListener('click', openAtlas);
  document.querySelectorAll('#atlas-views [data-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#atlas-views [data-view]').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      atlasView = b.dataset.view;
      atlasKey = null;
      buildAtlasList();
      atlasKey = S.state.mode + '|' + atlasView + '|' + (atlasStar ? 1 : 0);
    });
  });
  $('btn-atlas-star').addEventListener('click', function () {
    atlasStar = !atlasStar;
    this.classList.toggle('on', atlasStar);
    atlasKey = null;
    buildAtlasList();
    atlasKey = S.state.mode + '|' + atlasView + '|' + (atlasStar ? 1 : 0);
  });

  /* ================= 💾 偏好记忆 ================= */
  const PREF_KEY = 'tr-prefs-v1';
  let quizBest = 0;
  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        mode: S.state.mode, day: S.state.dayMode, voice: voiceOn,
        labels: S.state.showLabels, best: quizBest
      }));
    } catch (e) {}
  }
  function restorePrefs() {
    let pf = null;
    try { pf = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) {}
    if (!pf) {
      const h = new Date().getHours();           // 首次访问：跟随系统时间选昼夜
      if (h >= 7 && h < 19) {
        document.getElementById('btn-day').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return;
    }
    quizBest = pf.best || 0;
    if (pf.labels === false) {
      S.setShowLabels(false);
      $('tg-labels').checked = false;
    }
    if (pf.day === true) {
      document.getElementById('btn-day').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    if (pf.voice === true) {
      voiceOn = true;
      document.getElementById('btn-voice').classList.add('on');
    }
    if (pf.mode && pf.mode !== 'deep' && D.ERAS[pf.mode]) {
      const b = document.querySelector('#mode-seg button[data-mode="' + pf.mode + '"]');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }

  /* ================= 🌗 昼夜切换 ================= */
  $('btn-day').addEventListener('click', function () {
    const day = S.toggleDay();
    this.classList.toggle('on', day);
    this.textContent = day ? '☀️ 白天' : '🌙 星夜';
    savePrefs();
  });
  /* ================= 进度条拖动跳转（像视频一样） ================= */
  const progBar = $('hud-progress');
  let scrubbing = false;
  function progXtoP(e) {
    const r = progBar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }
  /* 悬停/拖动时显示"年份 · 最近河灯"预览 */
  function showPreview(e) {
    const p = progXtoP(e);
    const info = S.nearestAt(p);
    const el = $('hud-preview');
    el.innerHTML = '<b>' + D.fmtAgo(info.ago) + '</b>' +
      (info.title ? ' · ' + esc(info.title) : '');
    el.style.left = Math.max(70, Math.min(e.clientX, window.innerWidth - 70)) + 'px';
    el.classList.remove('hidden');
  }
  function scrubTo(e) {
    lastEraSpoken = -1;
    S.seek(progXtoP(e));
    syncButtons();
  }
  progBar.addEventListener('pointerdown', function (e) {
    scrubbing = true;
    try { progBar.setPointerCapture(e.pointerId); } catch (err) {}
    scrubTo(e);
  });
  progBar.addEventListener('pointermove', function (e) {
    showPreview(e);
    if (scrubbing) scrubTo(e);
  });
  progBar.addEventListener('pointerup', function () { scrubbing = false; });
  progBar.addEventListener('pointerleave', function () {
    if (!scrubbing) $('hud-preview').classList.add('hidden');
  });
  window.addEventListener('pointerup', function () {
    scrubbing = false;
    $('hud-preview').classList.add('hidden');
  });

  /* ================= 悬停提示 ================= */
  S.onHover(function (h) {
    const tip = $('tooltip');
    if (!h) { tip.classList.add('hidden'); return; }
    tip.innerHTML = '<b>' + esc(h.title) + '</b><span>' + esc(h.sub) + '</span>';
    tip.classList.remove('hidden');
    const w = tip.offsetWidth || 160;
    tip.style.left = Math.min(window.innerWidth - w - 12, h.x + 14) + 'px';
    tip.style.top = (h.y + 16) + 'px';
  });

  /* ================= ⇄ 事件对比模式 ================= */
  let compareFirst = null;
  function fmtGap(gap) {
    if (gap <= 2) return '同年发生！';
    if (gap < 1e4) return '相隔 ' + Math.round(gap) + ' 年';
    if (gap < 1e8) return '相隔 ' + (gap / 1e4).toFixed(1) + ' 万年';
    return '相隔 ' + (gap / 1e8).toFixed(1) + ' 亿年';
  }
  function renderCompare(a, b) {
    const gap = Math.abs(a.ago - b.ago);
    const older = a.ago > b.ago ? a : b;
    const newer = a.ago > b.ago ? b : a;
    $('panel-body').innerHTML =
      '<div class="tags"><span class="chip" style="color:#cfe3ff;border-color:#7fa8d8">⇄ 对比</span></div>' +
      '<div class="compare-grid">' +
        compareCol(a) + compareCol(b) +
      '</div>' +
      '<div class="compare-gap">' + fmtGap(gap) + '</div>' +
      '<p class="desc" style="text-align:center;">' +
        (gap <= 2 ? '两盏河灯几乎同时点亮——历史在两岸齐头并进。'
                  : '「' + esc(older.title) + '」点亮 ' + Math.round(gap) + ' 年后，' +
                    '「' + esc(newer.title) + '」才加入这条长河。') + '</p>' +
      '<div class="near" style="justify-content:center;">' +
        '<button class="chip link" id="btn-compare-exit">✕ 结束对比</button></div>';
    $('detail-panel').classList.remove('hidden');
    document.getElementById('btn-compare-exit').addEventListener('click', function () {
      renderEventPanel(b.id);
    });
  }
  function compareCol(e) {
    const c = D.CATS[e.cat];
    return '<div class="compare-col" style="--c:' + c.color + '">' +
      '<div class="compare-emoji">' + (D.CAT_EMOJI[e.cat] || '📜') + '</div>' +
      '<h3>' + esc(e.title) + '</h3>' +
      '<p class="compare-year">' + D.fmtAgo(e.ago) + '</p>' +
      '<p class="compare-fact">' + esc(e.facts[0] || e.desc.slice(0, 40)) + '</p>' +
      '</div>';
  }

  /* ================= 选中：档案卡 / 纪元卡 ================= */
  S.onSelect(function (sel) {
    if (!sel) {
      if (compareFirst) { compareFirst = null; }        // 点空白取消对比
      $('detail-panel').classList.add('hidden');
      updateHash();
      autoResume();
      return;
    }
    if (sel.type === 'event' && compareFirst && sel.id !== compareFirst) {
      const a = eventById(compareFirst), b = eventById(sel.id);
      compareFirst = null;
      if (a && b) { renderCompare(a, b); return; }
    }
    if (sel.type === 'event') {
      renderEventPanel(sel.id);
      const ev = eventById(sel.id);
      if (ev) {
        if (markExplored(ev.id)) pluck(760, 0.12, 0.045);
        speak(ev.title + '，' + D.fmtAgo(ev.ago) + '。' + firstSentence(ev.desc), true);
        updateHash();
        syncButtons();
      }
    } else {
      renderEraPanel(sel.idx);
    }
  });

  function catChip(cat) {
    const c = D.CATS[cat];
    return '<span class="chip cat" style="--c:' + c.color + '">' + c.icon + ' ' + c.name + '</span>';
  }
  /* 信息窗主图：类别/纪元图腾 + 联网自动配维基图片（离线优雅降级） */
  function heroHtml(color, emoji) {
    return '<div id="panel-hero" style="--hc:' + color + '"><span>' + emoji + '</span><img id="panel-img" alt=""></div>';
  }
  function loadWikiImage(ev) {
    try {
      const img = document.getElementById('panel-img');
      const hero = document.getElementById('panel-hero');
      if (!img || !hero) return;
      let cached = null;
      try { cached = localStorage.getItem('tr-img-' + ev.id); } catch (e) {}
      if (cached) {
        img.src = cached; img.classList.add('show'); hero.classList.add('has-img');
        return;
      }
      if (!window.fetch) return;
      /* 三级回退：中文搜索 → 中文词条 → 英文词条 */
      const tries = [];
      const zhName = ev.wiki || ev.title;
      if (zhName) {
        tries.push('https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
          encodeURIComponent(zhName) + '&gsrnamespace=0&gsrlimit=2&prop=pageimages&piprop=thumbnail&pithumbsize=520&format=json&origin=*');
        tries.push('https://zh.wikipedia.org/w/api.php?action=query&titles=' +
          encodeURIComponent(zhName) + '&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=520&format=json&origin=*');
      }
      if (ev.en) {
        tries.push('https://en.wikipedia.org/w/api.php?action=query&titles=' +
          encodeURIComponent(ev.en.replace(/\s+/g, '_')) + '&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=520&format=json&origin=*');
        tries.push('https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
          encodeURIComponent(ev.en) + '&gsrnamespace=0&gsrlimit=2&prop=pageimages&piprop=thumbnail&pithumbsize=520&format=json&origin=*');
      }
      (function tryNext(i) {
        if (i >= tries.length) {
          try { localStorage.setItem('tr-img-' + ev.id, 'none'); } catch (e) {}   // 负缓存：所有来源都无图
          return;
        }
        let settled = false;
        const goNext = function () {
          if (settled) return;
          settled = true;
          tryNext(i + 1);
        };
        let ctrl = null, timer = null;
        try {
          if ('AbortController' in window) {
            ctrl = new AbortController();
            timer = setTimeout(function () { ctrl.abort(); }, 8000);
          }
        } catch (e) {}
        fetch(tries[i], ctrl ? { signal: ctrl.signal } : undefined)
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (timer) clearTimeout(timer);
            let thumb = null;
            const q = j && j.query;
            if (q && q.pages) {
              const arr = Object.keys(q.pages).map(function (k) { return q.pages[k]; });
              arr.sort(function (a, b) { return (a.index || 9) - (b.index || 9); });
              for (let k = 0; k < arr.length; k++) {
                if (arr[k].thumbnail && arr[k].thumbnail.source) { thumb = arr[k].thumbnail.source; break; }
              }
            }
            if (thumb) {
              try { localStorage.setItem('tr-img-' + ev.id, thumb); } catch (e) {}
              const im = document.getElementById('panel-img');
              const he = document.getElementById('panel-hero');
              if (im && he) { im.src = thumb; im.classList.add('show'); he.classList.add('has-img'); }
              settled = true;                     // 成功：不再前进
            } else {
              goNext();
            }
          })
          .catch(function () {
            if (timer) clearTimeout(timer);
            goNext();
          });
      })(0);
    } catch (e) {}
  }

  /* ---- 🔁 文明接力链（所属链与上下游） ---- */
  function chainHtml(ev) {
    const chain = D.CHAINS.filter(function (c) { return c.steps.indexOf(ev.id) >= 0; })[0];
    if (!chain) return '';
    const idx = chain.steps.indexOf(ev.id);
    const cell = function (stepId) {
      const e2 = eventById(stepId);
      if (!e2) return '';
      const cur = stepId === ev.id;
      return '<button class="chain-cell' + (cur ? ' cur' : '') + '" data-goto="' + stepId + '">' +
        esc(e2.title) + '</button>';
    };
    const parts = [];
    for (let i = 0; i < chain.steps.length; i++) {
      parts.push(cell(chain.steps[i]));
      if (i < chain.steps.length - 1) parts.push('<span class="chain-arrow">→</span>');
    }
    return '<h3>' + chain.icon + ' 文明接力 · ' + esc(chain.name) + '</h3>' +
      '<div class="chain-flow">' + parts.join('') + '</div>' +
      (idx < chain.steps.length - 1
        ? '<p class="chain-note">下一棒：<b>' + esc((eventById(chain.steps[idx + 1]) || {}).title || '') + '</b></p>'
        : '<p class="chain-note">这条接力的最新一棒——下一棒会是谁？</p>');
  }

  /* ---- 🎂 "你出生后的大事"（设置过生日才显示） ---- */
  function birthYear() {
    try { return parseInt(localStorage.getItem('tr-birth'), 10) || null; } catch (e) { return null; }
  }
  function birthAfterHtml(ev) {
    const y = birthYear();
    if (!y) return '';
    const birthAgo = Math.max(1, 2026 - y);
    const after = S.eventsInMode()
      .filter(function (e) { return e.id !== ev.id && e.ago < birthAgo; })
      .sort(function (a, b) { return b.ago - a.ago; })
      .slice(0, 6);
    if (!after.length) return '';
    return '<h3>🎂 你出生后的大事</h3><div class="near">' +
      after.map(function (e2) {
        const gap = Math.max(1, birthAgo - e2.ago);
        return '<button class="chip link" data-goto="' + e2.id + '">' +
          esc(e2.title) + ' <i>你出生后 ' + gap + ' 年</i></button>';
      }).join('') + '</div>';
  }

  /* ---- 事件档案卡 ---- */
  function renderEventPanel(id) {
    const ev = eventById(id);
    if (!ev) return;
    const near = nearbyEvents(ev);
    $('panel-body').innerHTML =
      heroHtml(D.CATS[ev.cat].color, D.CAT_EMOJI[ev.cat] || '📜') +
      '<div class="tags">' + catChip(ev.cat) +
        (ev.cn ? '<span class="chip" style="color:#ffd27f;border-color:#c9a04a">🏮 中国</span>' : '') +
        (ev.cult ? '<span class="chip" style="color:#cfe3ff;border-color:#7fa8d8">' + (D.CULTS[ev.cult] ? D.CULTS[ev.cult].name : ev.cult) + '</span>' : '') +
        '<span class="chip year">' + D.fmtAgo(ev.ago) + '</span></div>' +
      '<h2 id="panel-title">' + esc(ev.title) + '</h2>' +
      '<p id="panel-en">' + esc(ev.en) + '</p>' +
      '<div class="cosmic" title="把宇宙138亿年压缩成一年，该事件发生的时刻">🌌 宇宙日历：<b>' + D.cosmicDate(ev.ago) + '</b></div>' +
      '<div class="near"><button class="chip link" id="btn-compare">⇄ 与另一盏河灯对比</button></div>' +
      '<p class="desc">' + esc(ev.desc) + '</p>' +
      '<ul class="facts">' + ev.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
      chainHtml(ev) +
      birthAfterHtml(ev) +
      (near.length ? '<h3>⏳ 同时代的星空</h3><div class="near">' +
        near.map(function (e2) {
          return '<button class="chip link" data-goto="' + e2.id + '">' +
            esc(e2.title) + ' <i>' + D.fmtAgo(e2.ago) + '</i></button>';
        }).join('') + '</div>' : '');

    $('detail-panel').classList.remove('hidden');
    loadWikiImage(ev);
    $('detail-panel').querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { S.selectEvent(b.dataset.goto, true); });
    });
    const cmpBtn = document.getElementById('btn-compare');
    if (cmpBtn) cmpBtn.addEventListener('click', function () {
      compareFirst = ev.id;
      speak('对比模式：请再点一盏河灯。', true);
      $('panel-body').innerHTML =
        '<div class="tags"><span class="chip" style="color:#cfe3ff;border-color:#7fa8d8">⇄ 对比模式</span></div>' +
        '<h2>已选：「' + esc(ev.title) + '」</h2>' +
        '<p class="desc" style="margin-top:10px;">现在单击河面上<b>另一盏河灯</b>，看看两件事相隔多少年。</p>' +
        '<div class="near"><button class="chip link" id="btn-compare-cancel">✕ 取消对比</button></div>';
      document.getElementById('btn-compare-cancel').addEventListener('click', function () {
        compareFirst = null;
        renderEventPanel(ev.id);
      });
    });
  }
  /* "同时代"：河道上航程最近的其他河灯 */
  function nearbyEvents(ev) {
    const p0 = S.progressOf(ev.ago);
    return S.eventsInMode()
      .filter(function (e) { return e.id !== ev.id; })
      .map(function (e) { return { e: e, d: Math.abs(S.progressOf(e.ago) - p0) }; })
      .filter(function (x) { return x.d < 0.01; })
      .sort(function (a, b) { return a.d - b.d || b.e.imp - a.e.imp; })
      .slice(0, 6)
      .map(function (x) { return x.e; });
  }

  /* ---- 纪元卡 ---- */
  function renderEraPanel(idx) {
    const eras = D.ERAS[S.state.mode];
    const era = eras[idx];
    if (!era) return;
    const span = D.MODES.filter(function (m) { return m.id === S.state.mode; })[0].span;
    const evs = D.EVENTS
      .filter(function (e) { return e.ago <= span + 1 && e.ago <= era.from && e.ago >= era.to; })
      .sort(function (a, b) { return b.ago - a.ago; });
    $('panel-body').innerHTML =
      heroHtml(era.color, D.eraEmoji(era.name)) +
      '<div class="tags"><span class="chip era" style="--c:' + era.color + '">🍃 纪元</span></div>' +
      '<h2 id="panel-title">' + esc(era.name) + '</h2>' +
      '<p id="panel-en">' + D.fmtAgo(era.from) + ' ～ ' + (era.to <= 0 ? '今天' : D.fmtAgo(era.to)) + '</p>' +
      '<p class="desc">' + esc(era.blurb) + '</p>' +
      (era.long ? '<h3>📖 深度解读</h3><p class="desc long-text">' + esc(era.long) + '</p>' : '') +
      '<h3>📍 该河段的河灯（' + evs.length + '）</h3><div class="near">' +
      (evs.length ? evs.map(function (e) {
        return '<button class="chip link" data-goto="' + e.id + '">' +
          D.CATS[e.cat].icon + ' ' + esc(e.title) + '</button>';
      }).join('') : '<span class="dim">这一河段还没有放置河灯</span>') + '</div>';

    $('detail-panel').classList.remove('hidden');
    loadWikiImage({ id: 'era-' + S.state.mode + '-' + idx, title: era.name });
    $('detail-panel').querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { S.selectEvent(b.dataset.goto, true); });
    });
  }

  $('btn-close-info').addEventListener('click', function () {
    $('detail-panel').classList.add('hidden');
    S.clearSelection();
  });
  /* 关闭档案卡后自动续飞（被打断的飞览从原处继续） */
  function autoResume() {
    const st = S.state;
    if (window.__quizOn || st.paused) return;             // 问答中 / 手动暂停时不抢镜头
    if (S.resumeFly && S.resumeFly()) syncButtons();
  }

  /* ================= 纪元年表导航 ================= */
  function buildEraNav() {
    const box = $('era-nav');
    box.innerHTML = '';
    D.ERAS[S.state.mode].forEach(function (era, idx) {
      const el = document.createElement('button');
      el.className = 'era-item';
      el.style.setProperty('--c', era.color);
      el.innerHTML = '<i></i><span>' + esc(era.name) + '</span>' +
        '<b>' + D.fmtAgo(era.from) + ' →</b>';
      el.addEventListener('click', function () { S.focusEra(idx); });
      box.appendChild(el);
    });
  }

  /* ================= 类别图例 ================= */
  let legendEls = {};
  function buildLegend() {
    const box = $('legend');
    box.innerHTML = '';
    legendEls = {};
    Object.keys(D.CATS).forEach(function (k) {
      const c = D.CATS[k];
      const el = document.createElement('button');
      el.className = 'legend-item on';
      el.style.setProperty('--c', c.color);
      el.innerHTML = '<i></i>' + c.icon + ' ' + c.name + '<b></b>';
      el.addEventListener('click', function () {
        const on = !el.classList.contains('on');
        el.classList.toggle('on', on);
        S.setCategory(k, on);
      });
      box.appendChild(el);
      legendEls[k] = el.querySelector('b');
    });
    updateLegendCounts();
  }
  /* 图例数字 = "已探索/总数"（点亮过的事件计入） */
  function updateLegendCounts() {
    const explored = getExplored();
    Object.keys(D.CATS).forEach(function (k) {
      if (!legendEls[k]) return;
      const evs = S.eventsInMode().filter(function (e) { return e.cat === k; });
      const done = evs.filter(function (e) { return explored[e.id]; }).length;
      legendEls[k].textContent = done + '/' + evs.length;
    });
  }
  function getExplored() {
    try { return JSON.parse(localStorage.getItem('tr-explored') || '{}'); } catch (e) { return {}; }
  }
  function refreshCounts() {
    $('ev-count').textContent = S.eventsInMode().length + ' 盏河灯';
  }

  /* ================= 河道刻度切换 ================= */
  document.querySelectorAll('#mode-seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (quizOn) stopQuiz();          // 换河道时退出问答
      document.querySelectorAll('#mode-seg button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      $('search-input').value = '';
      $('search-drop').classList.add('hidden');
      S.setMode(b.dataset.mode);
      lastEraSpoken = -1;
      buildEraNav();
      buildLegend();
      updateHash();
      lastYearText = '';
      syncButtons();
      savePrefs();
    });
  });

  /* ================= 显示开关 / 键盘 ================= */
  $('tg-labels').addEventListener('change', function (e) { S.setShowLabels(e.target.checked); savePrefs(); });
  /* 键盘：轻点空格=暂停；按住空格+左键拖拽=平移（场景层处理）；P=暂停 */
  let spaceDownAt = 0;
  window.addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) { spaceDownAt = Date.now(); S.state.spacePanned = false; }
    } else if (e.key === 'p' || e.key === 'P') {
      S.togglePause();
      syncButtons();
    } else if (e.key === 'j' || e.key === 'J') {
      jumpLantern(1);
    } else if (e.key === 'k' || e.key === 'K') {
      jumpLantern(-1);
    } else if (e.key === 'ArrowRight') {
      S.nudge(e.shiftKey ? 0.03 : 0.008);
      syncButtons();
    } else if (e.key === 'ArrowLeft') {
      S.nudge(e.shiftKey ? -0.03 : -0.008);
      syncButtons();
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      /* 轻点（<320ms 且未发生平移）= 暂停/继续；按住拖拽则不触发 */
      if (!S.state.spacePanned && Date.now() - spaceDownAt < 320) {
        S.togglePause();
        syncButtons();
      }
    }
  });
  setInterval(syncButtons, 600);

  /* ⏳ 问答倒计时（按真实时间差计算；时间凝固时暂停计时） */
  let quizLastTick = 0;
  setInterval(function () {
    if (!quizOn || !quizTarget) { quizLastTick = 0; return; }
    if (S.state.paused) { quizLastTick = 0; return; }
    const nowT = Date.now();
    const delta = quizLastTick ? Math.min(1, (nowT - quizLastTick) / 1000) : 0;
    quizLastTick = nowT;
    quizRemain -= delta;
    const el = document.getElementById('quiz-remain');
    if (el) el.textContent = '⏳ ' + Math.max(0, Math.ceil(quizRemain)) + 's';
    if (quizRemain <= 0) {
      quizRemain = 0;
      quizStreak = 0;
      const fb = document.getElementById('quiz-feedback');
      if (fb) {
        fb.textContent = '⏰ 超时！正确答案是「' + quizTarget.title + '」';
        fb.className = 'bad';
      }
      pluck(200, 0.25, 0.05);
      updateQuizStats();
      setTimeout(function () { if (quizOn) nextQuestion(); }, 1600);
    }
  }, 250);

  /* ================= 搜索 ================= */
  const searchInput = $('search-input');
  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const first = $('search-drop').querySelector('[data-id]');
      if (first) { jumpTo(first.dataset.id); }
    } else if (e.key === 'Escape') { clearSearch(); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#search-box')) $('search-drop').classList.add('hidden');
  });

  function doSearch() {
    const q = searchInput.value.trim().toLowerCase();
    const drop = $('search-drop');
    if (!q) { clearSearch(); return; }
    const hits = D.EVENTS.filter(function (e) {
      return (e.title + e.en + e.desc).toLowerCase().indexOf(q) >= 0;
    });
    S.setSearch(new Set(hits.map(function (e) { return e.id; })));
    if (hits.length) {
      drop.innerHTML = hits.slice(0, 8).map(function (e) {
        return '<button data-id="' + e.id + '"><b>' + esc(e.title) + '</b><span>' +
          D.CATS[e.cat].icon + ' ' + D.fmtAgo(e.ago) + '</span></button>';
      }).join('') + (hits.length > 8 ? '<div class="more">… 共 ' + hits.length + ' 条</div>' : '');
      drop.classList.remove('hidden');
      drop.querySelectorAll('[data-id]').forEach(function (b) {
        b.addEventListener('click', function () { jumpTo(b.dataset.id); });
      });
    } else {
      drop.innerHTML = '<div class="more">没有找到「' + esc(searchInput.value) + '」相关河灯</div>';
      drop.classList.remove('hidden');
    }
  }
  function jumpTo(id) {
    $('search-drop').classList.add('hidden');
    S.selectEvent(id, true);
    syncButtons();
  }
  function clearSearch() {
    $('search-drop').classList.add('hidden');
    if (S.state.searchSet) S.setSearch(null);
  }

  /* ================= 📽️ 纪录片模式 ================= */
  let docMode = false, docEraIdx = -1, docTimer = null;
  function docCaption(eraIdx) {
    const eras = D.ERAS[S.state.mode];
    const era = eras[eraIdx];
    if (!era) return;
    const evs = S.eventsInMode()
      .filter(function (e) {
        const p = S.progressOf(e.ago);
        const pA = Math.min(S.progressOf(era.from), S.progressOf(era.to));
        const pB = Math.max(S.progressOf(era.from), S.progressOf(era.to));
        return p >= pA && p <= pB && e.imp >= 2;
      })
      .sort(function (a, b) { return b.ago - a.ago; })
      .slice(0, 4)
      .map(function (e) { return e.title; });
    $('doc-era').textContent = era.name + ' · ' + D.fmtAgo(era.from) + ' ～ ' + (era.to <= 0 ? '今天' : D.fmtAgo(era.to));
    $('doc-events').textContent = evs.length ? '本河段大事：' + evs.join(' · ') : era.blurb;
    $('doc-caption').classList.remove('hidden');
    if (docTimer) clearTimeout(docTimer);
    docTimer = setTimeout(function () { $('doc-caption').classList.add('hidden'); }, 9000);
  }
  $('btn-doc').addEventListener('click', function () {
    docMode = !docMode;
    this.classList.toggle('on', docMode);
    if (docMode) {
      lastEraSpoken = -1;
      docEraIdx = -1;
      if (!S.state.flying || S.state.flyP > 0.9) S.replay();   // 未在飞览或已到头 → 从头放映
      speak('纪录片模式开启，让我们从宇宙大爆炸开始。', true);
    } else {
      $('doc-caption').classList.add('hidden');
      if (window.speechSynthesis) speechSynthesis.cancel();
    }
  });
  S.onFlyDone(function () {
    if (docMode) {
      $('btn-doc').dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 放映结束自动关闭
      speak('纪录片播放完毕，感谢观赏。', false);
    }
  });

  /* ================= 📊 探索六环统计 ================= */
  function drawRings() {
    const cv = document.getElementById('rings-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const explored = getExplored();
    const cats = Object.keys(D.CATS);
    const r = 21, gap = 34, cy = 27;
    cats.forEach(function (k, i) {
      const evs = D.EVENTS.filter(function (e) { return e.cat === k; });
      const done = evs.filter(function (e) { return explored[e.id]; }).length;
      const cx = 25 + i * gap;
      const pct = evs.length ? done / evs.length : 0;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = D.CATS[k].color;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      ctx.stroke();
      ctx.font = '11px "Segoe UI Emoji","Microsoft YaHei"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8e2d4';
      ctx.fillText(D.CATS[k].icon, cx, cy + 1);
      cv.title = cats.map(function (kk) {
        const ee = D.EVENTS.filter(function (e) { return e.cat === kk; });
        const dd = ee.filter(function (e) { return explored[e.id]; }).length;
        return D.CATS[kk].icon + ' ' + D.CATS[kk].name + ' ' + dd + '/' + ee.length;
      }).join(' · ');
    });
  }

  /* ================= 🌟 今日之灯 ================= */
  function setupTodayLantern() {
    const d = new Date();
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    let pool = D.EVENTS.filter(function (e) { return e.imp >= 2; });
    try {                                   // 优先推荐还没探索过的事件
      const ex = JSON.parse(localStorage.getItem('tr-explored') || '{}');
      const fresh = pool.filter(function (e) { return !ex[e.id]; });
      if (fresh.length) pool = fresh;
    } catch (e) {}
    const ev = pool[seed % pool.length];
    if (!ev) return;
    const btn = document.getElementById('today-lantern');
    btn.innerHTML = '🌟 今日之灯：<b>' + esc(ev.title) + '</b>';
    btn.classList.remove('hidden');
    btn.addEventListener('click', function () {
      pluck(720, 0.1, 0.04);
      S.selectEvent(ev.id, true);
      syncButtons();
    });
  }

  /* ================= 🎂 时光机 ================= */
  function birthNearestEvent(ago) {
    const p0 = S.progressOf(ago);
    let best = null, bd = 1e9;
    S.eventsInMode().forEach(function (e) {
      const d = Math.abs(S.progressOf(e.ago) - p0);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  function launchBirth(year) {
    year = Math.max(1900, Math.min(2026, Math.round(year)));
    try { localStorage.setItem('tr-birth', String(year)); } catch (e) {}
    const ago = Math.max(1, 2026 - year);
    S.setBirthMarker(ago, '🎂 你出生时 · ' + year + ' 年');
    S.flyToProgress(S.progressOf(ago));
    syncButtons();
    const ev = birthNearestEvent(ago);
    if (ev) {
      setTimeout(function () {
        S.selectEvent(ev.id, false);
        showAchievement('🎂', year + ' 年 · 你出生时的世界',
          '你出生在 138 亿年长河的最后 ' + ago + ' 年 · 那年河上最近的事件：「' + ev.title + '」');
      }, 900);
    }
  }
  $('btn-birth').addEventListener('click', function () {
    let saved = '';
    try { saved = localStorage.getItem('tr-birth') || ''; } catch (e) {}
    document.getElementById('birth-year').value = saved;
    document.getElementById('modal-birth').classList.remove('hidden');
  });
  $('btn-birth-go').addEventListener('click', function () {
    const v = parseInt(document.getElementById('birth-year').value, 10);
    if (!v || v < 1900 || v > 2026) {
      document.getElementById('birth-year').focus();
      return;
    }
    document.getElementById('modal-birth').classList.add('hidden');
    pluck(660, 0.12, 0.05);
    launchBirth(v);
  });

  /* ================= 📊 探索报告 ================= */
  function drawReport() {
    const cv = document.getElementById('report-canvas');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const explored = getExplored();
    const total = D.EVENTS.length;
    const doneN = Object.keys(explored).length;

    /* 背景 */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a101e'); bg.addColorStop(1, '#060a14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    /* 星尘点缀 */
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(200,215,255,' + (0.05 + (i % 5) * 0.03) + ')';
      ctx.fillRect((i * 97) % W, (i * 53) % H, 2, 2);
    }
    /* 标题 */
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd27f';
    ctx.font = '700 44px "Microsoft YaHei"';
    ctx.fillText('🏞️ 滚滚长河 · 探索报告', 60, 90);
    ctx.fillStyle = '#8b93a4'; ctx.font = '20px "Microsoft YaHei"';
    const d = new Date();
    ctx.fillText(d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日', 62, 126);

    /* 总进度大数字 */
    ctx.fillStyle = '#e8e2d4'; ctx.font = '700 30px "Microsoft YaHei"';
    ctx.fillText('已点亮河灯', 60, 190);
    ctx.fillStyle = '#ffd27f'; ctx.font = '700 88px "Microsoft YaHei"';
    ctx.fillText(doneN, 60, 275);
    ctx.fillStyle = '#6b7688'; ctx.font = '26px "Microsoft YaHei"';
    ctx.fillText('/ ' + total, 60 + ctx.measureText(String(doneN)).width + 78, 272);

    /* 六类横条 */
    let y = 340;
    Object.keys(D.CATS).forEach(function (k) {
      const evs = D.EVENTS.filter(function (e) { return e.cat === k; });
      const done = evs.filter(function (e) { return explored[e.id]; }).length;
      const pct = evs.length ? done / evs.length : 0;
      ctx.fillStyle = '#e8e2d4'; ctx.font = '22px "Microsoft YaHei"';
      ctx.fillText(D.CATS[k].icon + ' ' + D.CATS[k].name, 60, y);
      ctx.fillStyle = '#6b7688'; ctx.font = '18px "Microsoft YaHei"';
      ctx.textAlign = 'right';
      ctx.fillText(done + ' / ' + evs.length, W - 60, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(60, y + 12, W - 120, 14);
      ctx.fillStyle = D.CATS[k].color;
      ctx.fillRect(60, y + 12, (W - 120) * pct, 14);
      y += 62;
    });

    /* 问答成绩 */
    y += 6;
    ctx.fillStyle = '#e8e2d4'; ctx.font = '22px "Microsoft YaHei"';
    let quizLine = '🏆 问答最佳连对 ' + quizBest;
    if (quizWrong.length) quizLine += ' · 错题待重练 ' + quizWrong.length;
    try {
      const b = localStorage.getItem('tr-birth');
      if (b) quizLine += ' · 🎂 出生于 ' + b + ' 年';
    } catch (e) {}
    ctx.fillText(quizLine, 60, y);

    /* 页脚 */
    ctx.fillStyle = '#5b6474'; ctx.font = '18px "Microsoft YaHei"';
    ctx.fillText('leon1734.github.io/time-rings · 把这条 138 亿年的长河分享给朋友', 60, H - 40);
  }
  $('btn-report').addEventListener('click', function () {
    drawReport();
    $('modal-report').classList.remove('hidden');
  });
  $('btn-report-save').addEventListener('click', function () {
    try {
      const a = document.createElement('a');
      a.href = document.getElementById('report-canvas').toDataURL('image/png');
      a.download = '滚滚长河-探索报告-' + new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      pluck(720, 0.1, 0.04);
    } catch (err) {
      $('error-banner').textContent = '⚠️ 保存失败：' + err.message;
      $('error-banner').classList.remove('hidden');
    }
  });

  /* ================= 🎲 随机漫游 ================= */
  $('btn-random').addEventListener('click', function () {
    const explored = getExplored();
    let pool = S.eventsInMode().filter(function (e) { return !explored[e.id]; });
    if (!pool.length) pool = S.eventsInMode();
    if (!pool.length) return;
    const ev = pool[Math.floor(Math.random() * pool.length)];
    pluck(500 + Math.floor(Math.random() * 300), 0.1, 0.04);
    S.selectEvent(ev.id, true);
    syncButtons();
  });

  /* ================= J/K 沿河跳灯 ================= */
  function jumpLantern(dir) {
    const st = S.state;
    let refP = st.flyP;
    if (st.selected) {
      const cur = eventById(st.selected);
      if (cur) refP = S.progressOf(cur.ago);
    }
    let best = null, bd = 1e9;
    S.eventsInMode().forEach(function (e) {
      const p = S.progressOf(e.ago);
      const d = (p - refP) * dir;
      if (d > 0.0005 && d < bd) { bd = d; best = e; }
    });
    if (best) { S.selectEvent(best.id, true); syncButtons(); }
  }

  /* ================= 底部小知识滚动 ================= */
  let tipIdx = Math.floor(Math.random() * D.TIPS.length);
  function showTip() {
    const el = $('tip-text');
    el.classList.add('fade');
    setTimeout(function () {
      el.textContent = '💡 ' + D.TIPS[tipIdx % D.TIPS.length];
      tipIdx++;
      el.classList.remove('fade');
    }, 420);
  }
  showTip();
  setInterval(showTip, 9000);

  /* ================= 科普课堂 ================= */
  function buildScience() {
    const cal = [
      ['1月1日 00:00', '宇宙大爆炸'],
      ['1月16日', '银河系成形'],
      ['9月1日', '太阳系与地球诞生'],
      ['9月22日', '生命起源'],
      ['12月17日', '寒武纪生命大爆发'],
      ['12月30日 06:00', '恐龙灭绝'],
      ['12月31日 23:48', '智人出现'],
      ['12月31日 23:59:37', '农业革命'],
      ['12月31日 23:59:48', '文字发明'],
      ['12月31日 23:59:58', '文艺复兴'],
      ['12月31日 23:59:59', '工业革命'],
      ['12月31日 23:59:59.9', '万维网 · AI大模型 · 你正在看的这一页']
    ];
    $('science-river').innerHTML = '<ul>' + D.SCIENCE.river.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
    $('science-log').innerHTML = '<ul>' + D.SCIENCE.log.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
    $('science-cal-note').textContent = D.SCIENCE.calendarIntro;
    $('science-cal-table').innerHTML = cal.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('');
    $('science-cal-foot').textContent = D.SCIENCE.calendarNote;
    $('science-vs-table').innerHTML = D.SCIENCE.vs.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>';
    }).join('');
    $('science-quotes').innerHTML = D.SCIENCE.quotes.map(function (q) {
      return '<p class="quote">' + q + '</p>';
    }).join('');
    $('science-faq').innerHTML = D.SCIENCE.faq.map(function (r) {
      return '<p class="faq-q">Q：' + r[0] + '</p><p class="faq-a">A：' + r[1] + '</p>';
    }).join('');
  }

  /* ================= 帮助 ================= */
  function buildHelp() {
    $('help-list').innerHTML = '<table>' + D.HELP.map(function (r) {
      return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td></tr>';
    }).join('') + '</table>';
  }

  /* ================= 弹窗开关 ================= */
  function openModal(id) { $(id).classList.remove('hidden'); }
  document.querySelectorAll('[data-modal]').forEach(function (b) {
    b.addEventListener('click', function () { openModal(b.dataset.modal); });
  });
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.classList.contains('modal-close')) m.classList.add('hidden');
    });
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('hidden'); });
  });

  /* ================= 启动 ================= */
  window.addEventListener('DOMContentLoaded', function () {
    buildEraNav();
    buildTourList();
    buildLegend();
    buildScience(); buildHelp();
    $('hud-sub').textContent = modeSub();
    syncButtons();
    updateExplored();
    drawRings();
    setupTodayLantern();
    restorePrefs();
    /* 首次访问：引导浮层 */
    try {
      if (!localStorage.getItem('tr-onboard')) {
        $('onboard').classList.remove('hidden');
      }
    } catch (e) {}
    $('btn-onboard-go').addEventListener('click', function () {
      $('onboard').classList.add('hidden');
      try { localStorage.setItem('tr-onboard', '1'); } catch (e) {}
      pluck(660, 0.12, 0.05);
      setTimeout(function () { pluck(880, 0.16, 0.05); }, 120);
    });
    applyHash();        // 解析分享链接（#m=模式&e=事件），有事件定位则不自动起飞
    /* PWA：https/localhost 下注册 Service Worker（离线可玩、可安装） */
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  });
})();
