/* ============================================================
 * scene.js —— 滚滚长河 · 三维场景（航拍画卷）
 *  - 一条蜿蜒大河：源头 = 宇宙大爆炸，入海口 = 今天，只向前不回头
 *  - 时间沿河道编码（深时为对数刻度，文明/近现代为线性）
 *  - 河水按纪元染色；河床级级下降，纪元交界处跌水瀑布
 *  - 历史事件 = 漂浮在水面的发光河灯（随水波起伏）
 *  - 🎬 飞览全程：航拍镜头从源头自动飞到入海口，随时可接管
 *  - 射线拾取：河灯 → 事件档案；纪元标签 → 纪元卡
 * 依赖：three.min.js、OrbitControls.js、data.js、textures.js
 * 对外暴露 window.TRScene
 * ============================================================ */
'use strict';

window.TRScene = (function () {
  const D = window.TR_DATA;
  const TEX = window.TR_TEX;
  const TAU = Math.PI * 2;

  /* ================= 全局状态 ================= */
  const state = {
    mode: 'deep',
    flyP: 0,               // 飞览航程 0(源头) → 1(入海口)
    flying: false,
    paused: false,         // 时间凝固：水流/波浪/河灯/飞览全部暂停
    flyHold: false,        // 飞览被点击/拖拽/跳转打断，可「从此处继续」
    speedMul: 1,           // 飞览速度倍率（0.5 / 1 / 2）
    spaceHeld: false,      // 按住空格（平移模式）
    spacePanned: false,    // 本次按住期间是否发生过平移（区分轻点=暂停）
    dayMode: false,        // 昼夜：false=星夜（默认） true=白天
    quizTarget: null,      // 问答模式：目标事件 id（null=未开启）
    camMode: 'section',    // 'section' 沿河 | 'overview' 全河鸟瞰
    selected: null,
    hovered: null,
    catOn: {},
    searchSet: null,
    showLabels: true
  };
  Object.keys(D.CATS).forEach(function (k) { state.catOn[k] = true; });

  /* ================= Three 基础对象 ================= */
  let renderer, scene, camera, controls, raycaster, pointerVec;
  let world = null;            // 河流世界（随刻度重建）
  let curve, waterMesh, waterTex;
  let lanterns = [];           // 事件河灯
  let sprays = [];             // 跌水浪花
  let clouds = [];             // 岸边流云
  let flowPts = null;          // 顺流流光粒子
  let flowDrops = [];
  let curtainTex = null;       // 瀑布水幕条纹纹理
  let eraLabels = [];          // 纪元/今天标签
  let ambLight = null, dirLight = null;   // 灯光（昼夜切换调强度）
  let skyStars = null, skyNeb = null;     // 深空星幕/银河（白天隐藏）
  const _rvec = new THREE.Vector3(), _uvec = new THREE.Vector3();  // 平移用临时向量
  const _v3 = new THREE.Vector3();            // 标签投影用临时向量
  let mmCanvas = null, mmCtx = null;          // 小地图离屏画布
  let mmScale = 1, mmOX = 0, mmOZ = 0, mmW = 340, mmH = 236;
  let mmCurves = [];                          // 全部支流曲线（小地图用）
  /* 走廊表：丘陵自动让位（side: +1 右岸 / -1 左岸） */
  const CORRIDORS = [
    { side: 1, off: function (p) { return 155 + Math.sin(p * 8.5) * 38; } },   // 中国
    { side: -1, off: function (p) { return 120 + Math.sin(p * 9) * 20; } },    // 希腊·罗马
    { side: 1, off: function (p) { return 205 + Math.sin(p * 9) * 16; } },     // 阿拉伯·伊斯兰
    { side: -1, off: function (p) { return 205 + Math.sin(p * 9) * 16; } }     // 印度
  ];
  /* 文明支流定义 */
  const CIV_BRANCHES = [
    { id: 'grc', name: '🏛️ 希腊·罗马支流', color: 0x7fb0e8, css: '#7fb0e8', side: -1, base: 120, wob: 20,
      totems: ['🏛️', '🦅'],
      gates: [['希腊城邦', 2500], ['罗马帝国', 2050]] },
    { id: 'isl', name: '🕌 阿拉伯·伊斯兰支流', color: 0x6fd0a8, css: '#6fd0a8', side: 1, base: 205, wob: 16,
      totems: ['🕌', '🌙'],
      gates: [['希吉拉 · 伊斯兰纪元', 1404]] },
    { id: 'ind', name: '🕉️ 印度支流', color: 0xe89f6f, css: '#e89f6f', side: -1, base: 205, wob: 16,
      totems: ['🕉️', '🪷'],
      gates: [['佛陀与佛教', 2500]] }
  ];
  let fpsAcc = 0, fpsN = 0, prIdx = 0;        // FPS 自适应画质
  let meteors = [], meteorTimer = 0;          // 星夜流星
  let birthMarker = null, birthLabel = null;  // 时光机：出生时刻标记
  let birdGroup = null, birdP = 0.05;         // 白天雁群
  let PR_LEVELS = [1.5, 1.25, 1];
  let glowTex, starTex;
  let beacon = null, beaconT = 0;
  let camTween = null;
  let lastT = performance.now();

  /* ================= 回调 ================= */
  const cb = { onHover: null, onSelect: null, onFly: null, onFlyDone: null, onCamMode: null };

  /* ================= 工具 ================= */
  function modeInfo() { return D.MODES.filter(function (m) { return m.id === state.mode; })[0]; }
  function progressFor(ago) {
    const span = modeInfo().span;
    if (state.mode === 'deep') return 1 - Math.log1p(ago) / Math.log1p(span);
    return 1 - Math.min(ago, span) / span;
  }
  function agoForProgress(p) {
    const span = modeInfo().span;
    p = Math.min(1, Math.max(0, p));
    if (state.mode === 'deep') return Math.exp((1 - p) * Math.log1p(span)) - 1;
    return (1 - p) * span;
  }
  function eraIdxOf(ago, eras) {
    for (let i = 0; i < eras.length; i++) {
      if (ago <= eras[i].from && ago >= eras[i].to) return i;
    }
    return eras.length - 1;
  }
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 河床逐级下降：每过一个纪元跌一截（跌水） */
  let ERAS_CUR = [];
  function waterYAt(p) {
    const ago = agoForProgress(p);
    return -2.2 * eraIdxOf(ago, ERAS_CUR);
  }

  /* ================= 河道曲线（蜿蜒向右，永不回头） ================= */
  const CP = [
    [-300, 0, -340],
    [ 380, 0, -460],
    [ 720, 0,  -90],
    [ 560, 0,  320],
    [1080, 0,  460],
    [1480, 0,  100],
    [1740, 0, -260],
    [2180, 0,  170],
    [2640, 0,  300]
  ];
  function buildCurve() {
    const pts = CP.map(function (c) { return new THREE.Vector3(c[0], 0, c[2]); });
    const c = new THREE.CatmullRomCurve3(pts);
    c.arcLengthDivisions = 1200;
    return c;
  }

  /* 沿曲线生成带状网格（左右顶点可不同高：yFn(p, v)，v=+1/-1） */
  function buildRibbon(t0, t1, widthFn, yFn, uvRep, colorFn, crv) {
    crv = crv || curve;
    const SEG = 240;
    const pos = [], uvs = [], colors = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const p = t0 + (t1 - t0) * (i / SEG);
      const pc = Math.min(0.9999, Math.max(0.0001, p));
      const pt = crv.getPointAt(pc);
      const tn = crv.getTangentAt(pc);
      const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
      const w = widthFn(p), y1 = yFn(p, 1), y2 = yFn(p, -1);
      pos.push(pt.x + n.x * w, y1, pt.z + n.z * w);
      pos.push(pt.x - n.x * w, y2, pt.z - n.z * w);
      uvs.push(0, p * uvRep, 1, p * uvRep);
      if (colorFn) {
        const cl = colorFn(p, 0), cr = colorFn(p, 1);
        colors.push(cl.r, cl.g, cl.b, cr.r, cr.g, cr.b);
      }
      if (i < SEG) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colorFn) geo.setAttribute('tint', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
  function halfWidth(p) { return 14 + 42 * Math.pow(p, 1.35); }

  /* 单侧岸带：横向从 k0*河宽 到 k1*河宽（k 为倍率），yFn(p, k) 给出每点高度 */
  function buildBandGeo(t0, t1, k0, k1, side, yFn, colorFn) {
    const SEG = 200, pos = [], cols = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const p = t0 + (t1 - t0) * (i / SEG);
      const pc = Math.min(0.9999, Math.max(0.0001, p));
      const pt = curve.getPointAt(pc);
      const tn = curve.getTangentAt(pc);
      const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
      const hw = halfWidth(pc);
      pos.push(pt.x + n.x * side * k0 * hw, yFn(pc, k0), pt.z + n.z * side * k0 * hw,
               pt.x + n.x * side * k1 * hw, yFn(pc, k1), pt.z + n.z * side * k1 * hw);
      if (colorFn) {
        const c0 = colorFn(pc, k0), c1 = colorFn(pc, k1);
        cols.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
      }
      if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colorFn) geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* 立体跌水水幕：横跨河宽的垂直瀑布面（上游高水位 → 下游低水位） */
  function buildCurtainGeo(t, yTop, yBot, kSpan) {
    const SEG = 26, pos = [], uvs = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const p = t - 0.003 + 0.006 * (i / SEG);
      const pc = Math.min(0.9999, Math.max(0.0001, p));
      const pt = curve.getPointAt(pc);
      const tn = curve.getTangentAt(pc);
      const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
      const k = halfWidth(pc) * kSpan;
      pos.push(pt.x - n.x * k, yTop, pt.z - n.z * k,  pt.x + n.x * k, yTop, pt.z + n.z * k,
               pt.x - n.x * k, yBot, pt.z - n.z * k,  pt.x + n.x * k, yBot, pt.z + n.z * k);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);   // v: 0=顶 1=底（条纹向下滚动）
      if (i < SEG) {
        const a = i * 4;
        idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4,     // 上半（水舌）
                 a + 2, a + 3, a + 6, a + 3, a + 7, a + 6); // 下半（帘面）
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function nX(p, side) {
    const pc = Math.min(0.9999, Math.max(0.0001, p));
    const tn = curve.getTangentAt(pc);
    return -tn.z * side;
  }
  function nZ(p, side) {
    const pc = Math.min(0.9999, Math.max(0.0001, p));
    const tn = curve.getTangentAt(pc);
    return tn.x * side;
  }
  function pointOnCurve(p) {
    const pc = Math.min(0.9999, Math.max(0.0001, p));
    const pt = curve.getPointAt(pc);
    const tn = curve.getTangentAt(pc);
    const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
    return { x: pt.x, y: 0, z: pt.z, nx: n.x, nz: n.z, tx: tn.x, tz: tn.z };
  }

  /* ================= 初始化 ================= */
  function init() {
    const holder = document.getElementById('scene-container');
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    const basePR = Math.min(window.devicePixelRatio || 1, 2);
    PR_LEVELS = [];
    [basePR, 1.5, 1.25, 1].forEach(function (v) {
      if (v < basePR + 0.01 && PR_LEVELS.indexOf(v) < 0) PR_LEVELS.push(v);
    });
    if (!PR_LEVELS.length) PR_LEVELS = [1];
    prIdx = 0;
    renderer.setPixelRatio(PR_LEVELS[0]);
    renderer.setSize(holder.clientWidth, holder.clientHeight);
    renderer.setClearColor(0x04060c);
    holder.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x04060c, 380, 1700);
    camera = new THREE.PerspectiveCamera(50, holder.clientWidth / holder.clientHeight, 0.5, 9000);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 40;
    controls.maxDistance = 3000;
    controls.maxPolarAngle = 1.45;

    ambLight = new THREE.AmbientLight(0xffffff, state.dayMode ? 1.0 : 0.55);
    scene.add(ambLight);
    dirLight = new THREE.DirectionalLight(0xfff2dc, state.dayMode ? 0.8 : 0.4);
    dirLight.position.set(0.4, 1, 0.25);
    scene.add(dirLight);

    raycaster = new THREE.Raycaster();
    pointerVec = new THREE.Vector2();

    glowTex = TEX.makeGlowTexture(128);
    starTex = TEX.makeStarTexture(64);
    waterTex = TEX.makeWaterTexture();
    curtainTex = TEX.makeStreakTexture();

    buildSky();
    ERAS_CUR = D.ERAS[state.mode];
    curve = buildCurve();
    buildWorld();
    bindPointer();

    window.addEventListener('resize', onResize);
    let lastRafT = performance.now();
    requestAnimationFrame(function frame(now) {
      requestAnimationFrame(frame);
      lastRafT = now;
      loop(now);
    });
    setInterval(function () {
      if (performance.now() - lastRafT > 500) loop(performance.now());
      /* 自愈：画布尺寸被异常归零时（面板收起瞬间触发过 resize）恢复 */
      if (renderer && renderer.domElement.width < 2) onResize();
    }, 200);
  }
  function onResize() {
    const holder = document.getElementById('scene-container');
    if (!holder || !renderer) return;
    const w = holder.clientWidth, h = holder.clientHeight;
    if (w < 2 || h < 2) return;            // 面板隐藏/布局收起时忽略，避免画布归零
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /* ================= 深空星空（天上银河） ================= */
  function buildSky() {
    const N = 2400;
    const pos = new Float32Array(N * 3);
    const rnd = mulberry32(31337);
    for (let i = 0; i < N; i++) {
      const r = 1400 + rnd() * 1600;
      const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
      pos[i * 3] = RIVER_LEN_X() / 2 + r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.8 + 30;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    skyStars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3, map: starTex, transparent: true, opacity: 0.6,
      depthWrite: false, sizeAttenuation: true, color: 0xcfd8ff, fog: false
    }));
    skyStars.visible = !state.dayMode;
    scene.add(skyStars);
    /* 一条淡淡的银河 */
    skyNeb = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x8fa4e8, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    skyNeb.position.set(1100, 620, -800);
    skyNeb.scale.set(2400, 540, 1);
    skyNeb.visible = !state.dayMode;
    scene.add(skyNeb);

    /* --- 🌠 流星池（星夜偶发划落） --- */
    meteors = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xdce8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      line.visible = false;
      line.userData = { life: 0, vel: new THREE.Vector3(), head: new THREE.Vector3() };
      scene.add(line);
      meteors.push(line);
    }

    /* --- 🦅 雁群（白天沿河飞行） --- */
    birdGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.makeEmojiTexture('🦅', 128), transparent: true, depthWrite: false
      }));
      b.scale.set(9, 9, 1);
      b.userData = { off: (i - 1) * 16, lag: i * 0.006 };
      birdGroup.add(b);
    }
    birdGroup.visible = state.dayMode;
    scene.add(birdGroup);
  }
  function RIVER_LEN_X() { return 2400; }

  /* ================= 🗺 小地图 ================= */
  function buildMinimap() {
    mmW = 340; mmH = 236;
    mmCanvas = document.createElement('canvas');
    mmCanvas.width = mmW * 2; mmCanvas.height = mmH * 2;
    mmCtx = mmCanvas.getContext('2d');
    mmCtx.scale(2, 2);

    const SAMP = 280;
    const mainSamples = [];
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i <= SAMP; i++) {
      const pt = curve.getPointAt(i / SAMP);
      mainSamples.push(pt);
      minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
      minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
    }
    const branchSets = [];
    mmCurves.forEach(function (bc) {
      const samples = [];
      for (let i = 0; i <= 140; i++) {
        const pt = bc.curve.getPointAt(i / 140);
        samples.push(pt);
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
      }
      branchSets.push({ samples: samples, color: bc.color });
    });
    const pad = 14;
    mmScale = Math.min((mmW - pad * 2) / (maxX - minX), (mmH - pad * 2) / (maxZ - minZ));
    mmOX = pad - minX * mmScale + ((mmW - pad * 2) - (maxX - minX) * mmScale) / 2;
    mmOZ = pad - minZ * mmScale + ((mmH - pad * 2) - (maxZ - minZ) * mmScale) / 2;

    mmCtx.clearRect(0, 0, mmW, mmH);
    mmCtx.lineCap = 'round'; mmCtx.lineJoin = 'round';

    /* 主线按纪元分段着色 */
    const eras = D.ERAS[state.mode];
    for (let i = 0; i < eras.length; i++) {
      const pA = Math.min(progressFor(eras[i].from), progressFor(eras[i].to));
      const pB = Math.max(progressFor(eras[i].from), progressFor(eras[i].to));
      mmCtx.beginPath();
      const i0 = Math.max(0, Math.round(pA * SAMP)), i1 = Math.min(SAMP, Math.round(pB * SAMP));
      for (let k = i0; k <= i1; k++) {
        const pt = mainSamples[k];
        const x = mmOX + pt.x * mmScale, y = mmOZ + pt.z * mmScale;
        if (k === i0) mmCtx.moveTo(x, y); else mmCtx.lineTo(x, y);
      }
      mmCtx.strokeStyle = eras[i].color;
      mmCtx.globalAlpha = 0.9;
      mmCtx.lineWidth = 5;
      mmCtx.stroke();
    }
    mmCtx.globalAlpha = 1;

    /* 支流 */
    branchSets.forEach(function (b) {
      mmCtx.beginPath();
      b.samples.forEach(function (pt, k) {
        const x = mmOX + pt.x * mmScale, y = mmOZ + pt.z * mmScale;
        if (k === 0) mmCtx.moveTo(x, y); else mmCtx.lineTo(x, y);
      });
      mmCtx.strokeStyle = b.color;
      mmCtx.lineWidth = 3.2;
      mmCtx.stroke();
    });

    /* 河灯微点 */
    lanterns.forEach(function (m) {
      const pt = curve.getPointAt(Math.min(0.999, Math.max(0.001, m.p)));
      const x = mmOX + pt.x * mmScale, y = mmOZ + pt.z * mmScale;
      mmCtx.fillStyle = D.CATS[m.ev.cat].color;
      mmCtx.globalAlpha = 0.75;
      mmCtx.beginPath(); mmCtx.arc(x, y, 1.3, 0, TAU); mmCtx.fill();
    });
    mmCtx.globalAlpha = 1;

    /* 源头 / 入海口 */
    const p0 = mainSamples[0], p1 = mainSamples[SAMP];
    mmCtx.fillStyle = '#fff';
    mmCtx.beginPath(); mmCtx.arc(mmOX + p0.x * mmScale, mmOZ + p0.z * mmScale, 3, 0, TAU); mmCtx.fill();
    mmCtx.fillStyle = '#ffc27a';
    mmCtx.beginPath(); mmCtx.arc(mmOX + p1.x * mmScale, mmOZ + p1.z * mmScale, 4, 0, TAU); mmCtx.fill();
  }
  function mmMap(x, z) { return { x: mmOX + x * mmScale, y: mmOZ + z * mmScale }; }
  function mmUnmap(mx, my) { return { x: (mx - mmOX) / mmScale, z: (my - mmOZ) / mmScale }; }
  /* 点击小地图 → 找主河道最近点跳转 */
  function mapSeek(wx, wz) {
    let best = 0, bd = 1e18;
    for (let i = 0; i <= 320; i++) {
      const pt = curve.getPointAt(i / 320);
      const dd = (pt.x - wx) * (pt.x - wx) + (pt.z - wz) * (pt.z - wz);
      if (dd < bd) { bd = dd; best = i / 320; }
    }
    jumpToProgress(best);
  }

  /* ================= 构建河流世界 ================= */
  function disposeGroup(g) {
    g.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { m.dispose(); });
      }
    });
  }

  function buildWorld() {
    if (world) { scene.remove(world); disposeGroup(world); }
    world = new THREE.Group();
    lanterns = []; sprays = []; eraLabels = [];
    beacon = null; camTween = null;

    const eras = D.ERAS[state.mode];
    ERAS_CUR = eras;
    const mode = modeInfo();

    /* --- 两岸地形：内岸缓坡（稻田感）+ 外围丘陵，按纪元着色 --- */
    const tmpColor = new THREE.Color();
    function eraCol(p, mul) {
      const era = eras[eraIdxOf(agoForProgress(p), eras)];
      tmpColor.set(era.color);
      tmpColor.multiplyScalar(mul);
      return tmpColor;
    }
    [1, -1].forEach(function (side) {
      const mIn = state.dayMode ? 0.8 : 0.22;      // 内岸亮度（昼/夜）
      const mHill = state.dayMode ? 0.55 : 0.15;   // 丘陵亮度
      world.add(new THREE.Mesh(
        buildBandGeo(0, 1, 0.97, 2.4, side,
          function (p, k) { return waterYAt(p) + 0.12 + ((k - 0.97) / 1.43) * 2.3; },
          function (p) { return eraCol(p, mIn + 0.08 * Math.sin(p * 90 + side * 5)); }),
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
      world.add(new THREE.Mesh(
        buildBandGeo(0, 1, 2.4, 4.3, side,
          function (p, k) {
            const t = (k - 2.4) / 1.9;
            /* 全部支流走廊内压低丘陵，避免掩埋支流 */
            const lat = side * k * halfWidth(p);
            let corridor = 1;
            CORRIDORS.forEach(function (c) {
              if (c.side !== side) return;
              const d = Math.abs(lat - c.off(p));
              corridor = Math.min(corridor, Math.max(0.05, (d - 30) / 55));
            });
            return waterYAt(p) + 2.4 + Math.pow(t, 1.25) * 15 * corridor + Math.sin(p * 57 + k * 3.1) * 1.5 * corridor;
          },
          function (p, k) { return eraCol(p, mHill * (0.85 + 0.3 * Math.sin(p * 80 + k))); }),
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    });

    /* --- 河面水体（自定义着色器：流纹/闪光/岸沫/波浪） --- */
    const waterGeo = buildRibbon(0, 1,
      function (p) { return halfWidth(p); },
      function (p) { return waterYAt(p); },
      100,
      function (p, side) {
        const era = eras[eraIdxOf(agoForProgress(p), eras)];
        tmpColor.set(era.color);
        tmpColor.multiplyScalar(0.75 + 0.1 * Math.sin(p * 90 + side * 2));
        return tmpColor;
      });
    const waterUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 } },
      { uCdeep: { value: new THREE.Color(state.dayMode ? 0x3f7d96 : 0x0c3040) } },
      { uCshal: { value: new THREE.Color(state.dayMode ? 0x77b0c2 : 0x1c5b70) } }
    ]);
    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: [
        'uniform float uTime;',
        'attribute vec3 tint;',
        'varying vec2 vUv;',
        'varying vec3 vTint;',
        'varying float vWave;',
        '#include <fog_pars_vertex>',
        'void main() {',
        '  vUv = uv;',
        '  vTint = tint;',
        '  vec3 pos = position;',
        '  float w = sin(pos.x * 0.045 + uTime * 1.7) * cos(pos.z * 0.038 + uTime * 1.25)',
        '          + 0.5 * sin(pos.z * 0.06 + pos.x * 0.02 + uTime * 2.3)',
        '          + 0.4 * sin((pos.x + pos.z) * 0.026 - uTime * 1.1);',
        '  pos.y += w * 0.55;',
        '  vWave = w;',
        '  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uCdeep;',
        'uniform vec3 uCshal;',
        'varying vec2 vUv;',
        'varying vec3 vTint;',
        'varying float vWave;',
        '#include <fog_pars_fragment>',
        'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float noise(vec2 p) {',
        '  vec2 i = floor(p), f = fract(p);',
        '  vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
        '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
        '}',
        'float fbm(vec2 p) {',
        '  float v = 0.0, a = 0.5;',
        '  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }',
        '  return v;',
        '}',
        'void main() {',
        '  float t = uTime;',
        /* 顺流长纹：两层噪声视差滚动 */
        '  float n1 = fbm(vUv * vec2(4.0, 60.0) + vec2(0.0, -t * 0.55));',
        '  float n2 = fbm(vUv * vec2(3.0, 44.0) + vec2(0.37, -t * 0.34));',
        '  float streak = smoothstep(0.42, 0.78, n1 * 0.6 + n2 * 0.4);',
        /* 河水 = 纯净青蓝（深浅流动），颜色随昼夜 uniform 切换；纪元色仅 15% 微染 */
        '  vec3 col = mix(uCdeep, uCshal, streak);',
        '  col = mix(col, vTint * 1.15, 0.15);',
        '  col *= 0.90 + 0.20 * smoothstep(0.35, 1.2, vWave);',
        /* 波峰微光 */
        '  col += smoothstep(0.35, 1.2, vWave) * 0.07;',
        /* 碎金闪光（稀疏） */
        '  float sp = pow(max(0.0, fbm(vUv * vec2(9.0, 140.0) + vec2(0.0, -t * 1.4)) - 0.62), 2.0) * 2.6;',
        '  col += vec3(0.88, 0.94, 1.0) * sp;',
        /* 岸缘白沫（细线贴岸，噪声破碎） */
        '  float edge = abs(vUv.x - 0.5) * 2.0;',
        '  float foamN = fbm(vUv * vec2(10.0, 70.0) + vec2(0.0, -t * 0.7));',
        '  float foam = smoothstep(0.90, 1.02, edge + foamN * 0.10);',
        '  col = mix(col, vec3(0.88, 0.95, 0.98), foam * 0.85);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <fog_fragment>',
        '}'
      ].join('\n'),
      fog: true,
      side: THREE.DoubleSide
    });
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    world.add(waterMesh);

    /* --- 立体跌水 + 石拱门（纪元染色已烘入水面着色器，不再叠加贴图层） --- */
    const gateApex = {};   // idx → 拱门顶点坐标（供纪元标签悬挂）
    eras.forEach(function (era, idx) {
      const pA = Math.min(progressFor(era.from), progressFor(era.to));   // 较老（上游）
      const pB = Math.max(progressFor(era.from), progressFor(era.to));   // 较新（下游）
      /* 跌水瀑布（除最末带外，每带入口一道）：水幕 + 白浪带 + 浪花 + 石拱门 */
      if (idx > 0 && pA > 0.006 && pA < 0.996) {
        const yUp = waterYAt(pA - 0.004) + 0.1;    // 上游高水位
        const yDown = waterYAt(pA + 0.004) - 1.6;  // 下游低水位（帘底没入水中）

        /* 垂直水幕（条纹纹理向下奔流） */
        const curtain = new THREE.Mesh(
          buildCurtainGeo(pA, yUp, yDown, 0.98),
          new THREE.MeshBasicMaterial({
            map: curtainTex, color: 0xcfeaff, transparent: true, opacity: 0.85,
            side: THREE.DoubleSide, depthWrite: false
          }));
        world.add(curtain);

        /* 顶部白浪带（水舌翻卷处） */
        const foam = new THREE.Mesh(
          buildRibbon(pA - 0.0035, pA + 0.0035,
            function (p) { return halfWidth(p) * 1.0; },
            function (p) { return waterYAt(p) + 0.95; },
            1),
          new THREE.MeshBasicMaterial({
            color: 0xeaf6ff, transparent: true, opacity: 0.55,
            side: THREE.DoubleSide, depthWrite: false
          }));
        world.add(foam);

        /* 帘底浪花 */
        const NP = 18, pp = pointOnCurve(pA);
        const arr = new Float32Array(NP * 3);
        const rnd = mulberry32(hashStr(era.name) % 99991);
        for (let k = 0; k < NP; k++) {
          const o = (rnd() * 2 - 1) * halfWidth(pA) * 0.9;
          const d = rnd() * 9 - 4.5;
          arr[k * 3] = pp.x + pp.tx * d + pp.nx * o;
          arr[k * 3 + 1] = waterYAt(pA) + 0.3 + rnd() * 1.6;
          arr[k * 3 + 2] = pp.z + pp.tz * d + pp.nz * o;
        }
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const pts = new THREE.Points(pgeo, new THREE.PointsMaterial({
          map: starTex, color: 0xeaf6ff, transparent: true, opacity: 0.75,
          size: 3.5, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        world.add(pts);
        sprays.push(pts);

        /* 纪元石拱门（横跨河面，历史之门） */
        const gp = pointOnCurve(pA);
        const gtn = curve.getTangentAt(Math.min(0.999, pA));
        const R = halfWidth(pA) * 1.12 + 2;
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(R, 1.35, 8, 26, Math.PI),
          new THREE.MeshLambertMaterial({ color: 0x6b6353 })
        );
        arch.position.set(gp.x, waterYAt(pA + 0.003) - 2.0, gp.z);
        arch.rotation.y = Math.atan2(gtn.x, gtn.z);
        world.add(arch);
        gateApex[idx] = { x: gp.x, y: waterYAt(pA + 0.003) - 2.0 + R + 1.2, z: gp.z };
      }
    });

    /* --- 源头大爆炸之光 --- */
    const src = pointOnCurve(0.004);
    const srcY = waterYAt(0.004);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff2d8, transparent: true, opacity: state.dayMode ? 0.5 : 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    core.position.set(src.x, srcY + 16, src.z);
    core.scale.set(70, 70, 1);
    world.add(core);
    const coreHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc27a, transparent: true, opacity: state.dayMode ? 0.22 : 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    coreHalo.position.copy(core.position);
    coreHalo.scale.set(170, 170, 1);
    world.add(coreHalo);

    /* --- 入海口（今天之海） --- */
    const seaP = pointOnCurve(0.999);
    const seaY = waterYAt(0.999);
    const seaTn = curve.getTangentAt(0.999);
    const ocean = new THREE.Mesh(
      new THREE.CircleGeometry(560, 40),
      new THREE.MeshBasicMaterial({ color: state.dayMode ? 0x2f7295 : 0x14324a, transparent: true, opacity: 0.92 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(seaP.x + seaTn.x * 320, seaY - 1.5, seaP.z + seaTn.z * 320);
    world.add(ocean);
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc27a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sun.position.set(seaP.x + seaTn.x * 420, seaY + 90, seaP.z + seaTn.z * 420);
    sun.scale.set(330, 200, 1);
    world.add(sun);
    const today = TEX.makeTextSprite('今天', '公元 ' + D.NOW_YEAR + ' · 入海口', '#ffe9c0', { fontSize: 46 });
    today.scale.set(24, 24 / today.userData.aspect, 1);
    today.position.set(seaP.x + seaTn.x * 300, seaY + 46, seaP.z + seaTn.z * 300);
    today.userData = { type: 'today' };
    world.add(today);
    eraLabels.push(today);

    /* --- 纪元名标签（拱顶/悬浮，大号）+ 岸边时代图腾 --- */
    eras.forEach(function (era, idx) {
      const pA = Math.min(progressFor(era.from), progressFor(era.to));
      const pB = Math.max(progressFor(era.from), progressFor(era.to));
      const pMid = (pA + pB) / 2;
      const sub = D.fmtAgo(era.from) + ' ～ ' + (era.to <= 0 ? '今天' : D.fmtAgo(era.to));
      const sp = TEX.makeTextSprite(era.name, sub, '#ffd9a0', { fontSize: 52 });
      const apex = gateApex[idx];
      if (apex) {
        sp.scale.set(30, 30 / sp.userData.aspect, 1);
        sp.position.set(apex.x, apex.y + 4, apex.z);
      } else {
        if (pB - pA < 0.012) return;            // 太窄的河段不放
        const pos = pointOnCurve(pMid);
        const side = idx % 2 === 0 ? 1 : -1;
        sp.scale.set(34, 34 / sp.userData.aspect, 1);
        sp.position.set(pos.x + pos.nx * side * halfWidth(pMid) * 2.5,
                        waterYAt(pMid) + 22,
                        pos.z + pos.nz * side * halfWidth(pMid) * 2.5);
      }
      sp.userData = { type: 'era', idx: idx };
      world.add(sp);
      eraLabels.push(sp);

      /* 岸边时代图腾：恐龙🦕/鱼类🐟/农桑🌾/帆船⛵…（大 emoji 立于内岸，点击飞往纪元） */
      if (pB - pA < 0.006) return;
      const ipos = pointOnCurve(Math.min(0.998, Math.max(0.002, pMid)));
      const iside = idx % 2 === 0 ? 1 : -1;
      const iscale = Math.min(50, Math.max(26, halfWidth(pMid) * 0.9));
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.makeEmojiTexture(D.eraEmoji(era.name), 256),
        transparent: true, depthWrite: false
      }));
      icon.scale.set(iscale, iscale, 1);
      icon.position.set(ipos.x + ipos.nx * iside * 1.7 * halfWidth(pMid),
                        waterYAt(pMid) + 6 + iscale * 0.5,
                        ipos.z + ipos.nz * iside * 1.7 * halfWidth(pMid));
      icon.userData = { type: 'era', idx: idx };
      world.add(icon);
      eraLabels.push(icon);
    });

    /* --- 岸边林木（实例化低多边形树，增添生机） --- */
    (function plantTrees() {
      const COUNT = 260;
      const coneGeo = new THREE.ConeGeometry(1.8, 6, 6);
      const coneMat = new THREE.MeshLambertMaterial({ color: 0x1f3b2a });
      const inst = new THREE.InstancedMesh(coneGeo, coneMat, COUNT);
      const rnd = mulberry32(777);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
            s = new THREE.Vector3(), pv = new THREE.Vector3();
      for (let i = 0; i < COUNT; i++) {
        const p = 0.02 + rnd() * 0.96;
        const side = rnd() > 0.5 ? 1 : -1;
        const k = 1.25 + rnd() * 0.9;
        const sc = 0.7 + rnd() * 0.8;
        const pt = pointOnCurve(p);
        const yBank = waterYAt(p) + 0.12 + ((k - 0.97) / 1.43) * 2.3;
        pv.set(pt.x + pt.nx * side * k * halfWidth(p), yBank + 2.6 * sc, pt.z + pt.nz * side * k * halfWidth(p));
        s.setScalar(sc);
        m.compose(pv, q, s);
        inst.setMatrixAt(i, m);
      }
      world.add(inst);
    })();

    /* --- 岸边流云（缓缓飘移的雾团） --- */
    clouds = [];
    const rndCloud = mulberry32(2024);
    for (let i = 0; i < 9; i++) {
      const cs = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x9fb2c8, transparent: true, opacity: 0.09, depthWrite: false
      }));
      const p = 0.05 + (i / 9) * 0.9 + rndCloud() * 0.04;
      const side = i % 2 === 0 ? 1 : -1;
      const pos = pointOnCurve(p);
      cs.position.set(
        pos.x + pos.nx * side * halfWidth(p) * (2.2 + rndCloud() * 1.2),
        waterYAt(p) + 58 + rndCloud() * 34,
        pos.z + pos.nz * side * halfWidth(p) * (2.2 + rndCloud() * 1.2));
      cs.scale.set(80 + rndCloud() * 60, 30 + rndCloud() * 16, 1);
      world.add(cs);
      clouds.push({ s: cs, ph: rndCloud() * TAU, y: cs.position.y });
    }

    /* --- 事件河灯 --- */
    const evs = D.EVENTS.filter(function (e) { return e.ago <= mode.span + 1 && !e.cn && !e.cult; })
      .slice()
      .sort(function (a, b) { return b.ago - a.ago; });

    evs.forEach(function (ev, i) {
      const cat = D.CATS[ev.cat];
      const p = Math.min(0.996, Math.max(0.003, progressFor(ev.ago)));
      const pos = pointOnCurve(p);
      const side = i % 2 === 0 ? 1 : -1;
      const lat = halfWidth(p) * (0.16 + (hashStr(ev.id) % 30) / 100);
      const size = ev.imp >= 3 ? 34 : ev.imp === 2 ? 25 : 17;

      const g = new THREE.Group();
      g.position.set(pos.x + pos.nx * side * lat, waterYAt(p) + 1.4, pos.z + pos.nz * side * lat);

      /* 水面光斑（灯在水面上的倒光，径向柔边） */
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(1, 22),
        new THREE.MeshBasicMaterial({
          map: glowTex, color: cat.color, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.scale.setScalar(size * 0.75);
      pool.position.y = -0.7;
      g.add(pool);

      const boat = new THREE.Mesh(
        new THREE.CylinderGeometry(3.8, 4.8, 1.5, 10),
        new THREE.MeshLambertMaterial({ color: 0x241811 })
      );
      boat.scale.y = 0.7;
      boat.position.y = -0.6;
      g.add(boat);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: cat.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      glow.position.y = 3.2;
      glow.scale.setScalar(size);
      glow.userData = { type: 'event', id: ev.id };
      g.add(glow);

      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xfff8e8, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      flame.position.y = 3.2;
      flame.scale.setScalar(size * 0.3);
      flame.userData = { type: 'event', id: ev.id };
      g.add(flame);

      let label = null;
      if (ev.imp >= 3) {
        label = TEX.makeTextSprite(ev.title, null, cat.color, { fontSize: 52 });
        label.scale.set(16.5, 16.5 / label.userData.aspect, 1);
        label.position.y = size * 0.7 + 7;
        label.userData = { type: 'event', id: ev.id };
        g.add(label);
      } else if (ev.imp === 2) {
        label = TEX.makeTextSprite(ev.title, null, cat.color, { fontSize: 44 });
        label.scale.set(12, 12 / label.userData.aspect, 1);
        label.position.y = size * 0.62 + 5;
        label.userData = { type: 'event', id: ev.id };
        g.add(label);
      }

      world.add(g);
      lanterns.push({ ev: ev, group: g, glow: glow, label: label,
                      p: p, size: size, phase: (hashStr(ev.id) % 628) / 100 });
    });

    /* --- 🐉 中国支流：中华文明事件分入平行支流（与世界主线对照） --- */
    (function buildBranch() {
      const cnEv = D.EVENTS.filter(function (e) { return e.cn && e.ago <= mode.span + 1; });
      if (cnEv.length < 3) return;
      let pMin = 1, pMax = 0;
      cnEv.forEach(function (e) {
        const p = progressFor(e.ago);
        pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
      });
      pMin = Math.max(0.01, pMin - 0.025);
      pMax = Math.min(0.98, pMax + 0.02);
      if (pMax - pMin < 0.05) return;

      /* 支流曲线：沿主线平侧偏移，蜿蜒相伴 */
      const pts = [];
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const p = pMin + (pMax - pMin) * (i / N);
        const pt = curve.getPointAt(p);
        const tn = curve.getTangentAt(p);
        const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
        const off = CORRIDORS[0].off(p);
        pts.push(new THREE.Vector3(pt.x + n.x * off, 0, pt.z + n.z * off));
      }
      const bCurve = new THREE.CatmullRomCurve3(pts);
      bCurve.arcLengthDivisions = 600;
      mmCurves.push({ curve: bCurve, color: '#e8b84a' });
      const yB = function (bp) { return waterYAt(pMin + (pMax - pMin) * bp) + 3.5; };
      const hwB = function (t) { return 8 + 15 * t; };

      /* 支流河床（纪元色岸带） */
      const tmpC2 = new THREE.Color();
      const berm = buildRibbon(0, 1,
        function (t) { return hwB(t) * 1.6; },
        function (t) { return yB(t) - 2.3; },
        1,
        function (t, side) {
          const era = eras[eraIdxOf(agoForProgress(pMin + (pMax - pMin) * t), eras)];
          tmpC2.set(era.color);
          tmpC2.multiplyScalar((state.dayMode ? 0.62 : 0.26) + 0.05 * Math.sin(t * 40 + side * 3));
          return tmpC2;
        },
        bCurve);
      world.add(new THREE.Mesh(berm, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

      /* 支流水面（复用主水面着色器，流纹同步） */
      const bWaterGeo = buildRibbon(0, 1,
        function (t) { return hwB(t); },
        function (t) { return yB(t); },
        40,
        function (t, side) {
          const era = eras[eraIdxOf(agoForProgress(pMin + (pMax - pMin) * t), eras)];
          tmpC2.set(era.color);
          tmpC2.multiplyScalar(0.75 + 0.08 * Math.sin(t * 60 + side * 2));
          return tmpC2;
        },
        bCurve);
      world.add(new THREE.Mesh(bWaterGeo, waterMat));

      /* 汇入口/分流口连接带 */
      [[0, 1], [1, -1]].forEach(function (cfg) {
        const bp = cfg[0] === 0 ? 0.002 : 0.998;
        const mp = pMin + (pMax - pMin) * (cfg[0] === 0 ? 0 : 1);
        const pt = curve.getPointAt(Math.min(0.9999, Math.max(0.0001, mp)));
        const tn = curve.getTangentAt(Math.min(0.9999, Math.max(0.0001, mp)));
        const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
        const bpt = bCurve.getPointAt(bp);
        const linkCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(pt.x + n.x * halfWidth(mp) * 0.9, 0, pt.z + n.z * halfWidth(mp) * 0.9),
          new THREE.Vector3((pt.x + bpt.x) / 2, 0, (pt.z + bpt.z) / 2),
          new THREE.Vector3(bpt.x, 0, bpt.z)
        ]);
        linkCurve.arcLengthDivisions = 60;
        const link = buildRibbon(0, 1,
          function (t) { return 5 + 9 * (cfg[0] === 0 ? t : 1 - t); },
          function (t) { return yB(cfg[0] === 0 ? t : 1 - t) + 0.05; },
          8,
          null,
          linkCurve);
        world.add(new THREE.Mesh(link, waterMat));
      });

      /* 支流名牌 */
      const midP = 0.5;
      const midPt = bCurve.getPointAt(midP);
      const blabel = TEX.makeTextSprite('🐉 中国支流', '中华文明 · ' + cnEv.length + ' 盏河灯', '#ffd27f', { fontSize: 52 });
      blabel.scale.set(34, 34 / blabel.userData.aspect, 1);
      blabel.position.set(midPt.x, yB(midP) + 30, midPt.z);
      world.add(blabel);

      /* 支流首尾图腾 */
      [['🐉', 0.03], ['🏮', 0.97]].forEach(function (cfg) {
        const tp = bCurve.getPointAt(cfg[1]);
        const ts = new THREE.Sprite(new THREE.SpriteMaterial({
          map: TEX.makeEmojiTexture(cfg[0], 256), transparent: true, depthWrite: false
        }));
        ts.scale.set(30, 30, 1);
        ts.position.set(tp.x, yB(cfg[1]) + 14, tp.z);
        world.add(ts);
      });

      /* 中华事件河灯迁入支流 */
      cnEv.forEach(function (ev, i) {
        const cat = D.CATS[ev.cat];
        const bp = Math.min(0.9, Math.max(0.1, (progressFor(ev.ago) - pMin) / (pMax - pMin)));
        const pt = bCurve.getPointAt(bp);
        const tn = bCurve.getTangentAt(bp);
        const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
        const h2 = hashStr(ev.id);
        const lat = hwB(bp) * (0.2 + (h2 % 25) / 100);
        const size = ev.imp >= 3 ? 30 : 22;
        const g = new THREE.Group();
        g.position.set(pt.x + n.x * lat, yB(bp) + 1.4, pt.z + n.z * lat);

        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(1, 22),
          new THREE.MeshBasicMaterial({
            map: glowTex, color: cat.color, transparent: true, opacity: 0.4,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
        pool.rotation.x = -Math.PI / 2;
        pool.scale.setScalar(size * 0.75);
        pool.position.y = -0.7;
        g.add(pool);

        const boat = new THREE.Mesh(
          new THREE.CylinderGeometry(3.8, 4.8, 1.5, 10),
          new THREE.MeshLambertMaterial({ color: 0x5a3a10 })   // 支流灯船偏金铜色
        );
        boat.scale.y = 0.7;
        boat.position.y = -0.6;
        g.add(boat);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: cat.color, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        glow.position.y = 3.2;
        glow.scale.setScalar(size);
        glow.userData = { type: 'event', id: ev.id };
        g.add(glow);

        const flame = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xfff8e8, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        flame.position.y = 3.2;
        flame.scale.setScalar(size * 0.3);
        flame.userData = { type: 'event', id: ev.id };
        g.add(flame);

        let label = null;
        if (ev.imp >= 3) {
          label = TEX.makeTextSprite('🏮 ' + ev.title, null, cat.color, { fontSize: 52 });
          label.scale.set(16.5, 16.5 / label.userData.aspect, 1);
          label.position.y = size * 0.7 + 7;
          label.userData = { type: 'event', id: ev.id };
          g.add(label);
        }

        world.add(g);
        lanterns.push({ ev: ev, group: g, glow: glow, label: label,
                        p: progressFor(ev.ago), size: size,
                        phase: (hashStr(ev.id + 'b') % 628) / 100 });
      });
    })();

    /* --- 🌍 文明支流体系：希腊·罗马 / 阿拉伯·伊斯兰 / 印度 --- */
    CIV_BRANCHES.forEach(function (def) {
      const cnEv = D.EVENTS.filter(function (e) { return e.cult === def.id && e.ago <= mode.span + 1; });
      if (cnEv.length < 3) return;
      let pMin = 1, pMax = 0;
      cnEv.forEach(function (e) {
        const p = progressFor(e.ago);
        pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
      });
      pMin = Math.max(0.01, pMin - 0.03);
      pMax = Math.min(0.98, pMax + 0.02);
      if (pMax - pMin < 0.04) return;

      const pts = [];
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const p = pMin + (pMax - pMin) * (i / N);
        const pt = curve.getPointAt(p);
        const off = def.base + Math.sin(p * 9) * def.wob;
        pts.push(new THREE.Vector3(pt.x + nX(p, def.side) * off, 0, pt.z + nZ(p, def.side) * off));
      }
      const bCurve = new THREE.CatmullRomCurve3(pts);
      bCurve.arcLengthDivisions = 600;
      mmCurves.push({ curve: bCurve, color: def.css });
      const yB = function (bp) { return waterYAt(pMin + (pMax - pMin) * bp) + 3.5; };
      const hwB = function (t) { return 7 + 12 * t; };

      /* 岸带 */
      const tmpC3 = new THREE.Color();
      const berm = buildRibbon(0, 1,
        function (t) { return hwB(t) * 1.6; },
        function (t) { return yB(t) - 2.3; },
        1,
        function (t, side) {
          const era = eras[eraIdxOf(agoForProgress(pMin + (pMax - pMin) * t), eras)];
          tmpC3.set(era.color);
          tmpC3.multiplyScalar((state.dayMode ? 0.62 : 0.26) + 0.05 * Math.sin(t * 40 + side * 3));
          return tmpC3;
        },
        bCurve);
      world.add(new THREE.Mesh(berm, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

      /* 水面（复用主水面着色器） */
      const bWaterGeo = buildRibbon(0, 1,
        function (t) { return hwB(t); },
        function (t) { return yB(t); },
        40,
        function (t, side) {
          const era = eras[eraIdxOf(agoForProgress(pMin + (pMax - pMin) * t), eras)];
          tmpC3.set(era.color);
          tmpC3.multiplyScalar(0.75 + 0.08 * Math.sin(t * 60 + side * 2));
          return tmpC3;
        },
        bCurve);
      world.add(new THREE.Mesh(bWaterGeo, waterMat));

      /* 名牌 + 首尾图腾 + 里程碑拱门 */
      const midPt = bCurve.getPointAt(0.5);
      const blabel = TEX.makeTextSprite(def.name, def.totems[0] + ' ' + cnEv.length + ' 盏河灯', '#ffffff', { fontSize: 46 });
      blabel.scale.set(30, 30 / blabel.userData.aspect, 1);
      blabel.position.set(midPt.x, yB(0.5) + 26, midPt.z);
      world.add(blabel);

      [[def.totems[0], 0.03], [def.totems[1], 0.97]].forEach(function (cfg) {
        const tp = bCurve.getPointAt(cfg[1]);
        const ts = new THREE.Sprite(new THREE.SpriteMaterial({
          map: TEX.makeEmojiTexture(cfg[0], 256), transparent: true, depthWrite: false
        }));
        ts.scale.set(26, 26, 1);
        ts.position.set(tp.x, yB(cfg[1]) + 13, tp.z);
        world.add(ts);
      });

      def.gates.forEach(function (gt) {
        const bpD = (progressFor(gt[1]) - pMin) / (pMax - pMin);
        if (bpD < 0.05 || bpD > 0.95) return;
        const gp = bCurve.getPointAt(bpD);
        const gt2 = bCurve.getTangentAt(bpD);
        const R = hwB(bpD) * 1.2 + 2;
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(R, 0.95, 8, 24, Math.PI),
          new THREE.MeshLambertMaterial({ color: def.color })
        );
        arch.position.set(gp.x, yB(bpD) - 1.4, gp.z);
        arch.rotation.y = Math.atan2(gt2.x, gt2.z);
        world.add(arch);
        const lb = TEX.makeTextSprite(gt[0], null, '#ffffff', { fontSize: 38 });
        lb.scale.set(10, 10 / lb.userData.aspect, 1);
        lb.position.set(gp.x, yB(bpD) - 1.4 + R + 3, gp.z);
        world.add(lb);
      });

      /* 河灯 */
      cnEv.forEach(function (ev, i) {
        const cat = D.CATS[ev.cat];
        const bp = Math.min(0.92, Math.max(0.08, (progressFor(ev.ago) - pMin) / (pMax - pMin)));
        const pt = bCurve.getPointAt(bp);
        const tn = bCurve.getTangentAt(bp);
        const n = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
        const h2 = hashStr(ev.id);
        const lat = hwB(bp) * (0.2 + (h2 % 25) / 100);
        const size = ev.imp >= 3 ? 28 : 20;
        const g = new THREE.Group();
        g.position.set(pt.x + n.x * lat, yB(bp) + 1.4, pt.z + n.z * lat);

        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(1, 22),
          new THREE.MeshBasicMaterial({
            map: glowTex, color: cat.color, transparent: true, opacity: 0.4,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
        pool.rotation.x = -Math.PI / 2;
        pool.scale.setScalar(size * 0.75);
        pool.position.y = -0.7;
        g.add(pool);

        const boat = new THREE.Mesh(
          new THREE.CylinderGeometry(3.4, 4.2, 1.4, 10),
          new THREE.MeshLambertMaterial({ color: 0x4a3418 })
        );
        boat.scale.y = 0.7;
        boat.position.y = -0.6;
        g.add(boat);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: cat.color, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        glow.position.y = 3.2;
        glow.scale.setScalar(size);
        glow.userData = { type: 'event', id: ev.id };
        g.add(glow);

        const flame = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xfff8e8, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        flame.position.y = 3.2;
        flame.scale.setScalar(size * 0.3);
        flame.userData = { type: 'event', id: ev.id };
        g.add(flame);

        let label = null;
        if (ev.imp >= 3) {
          label = TEX.makeTextSprite(ev.title, null, cat.color, { fontSize: 50 });
          label.scale.set(15, 15 / label.userData.aspect, 1);
          label.position.y = size * 0.7 + 6.5;
          label.userData = { type: 'event', id: ev.id };
          g.add(label);
        }

        world.add(g);
        lanterns.push({ ev: ev, group: g, glow: glow, label: label,
                        p: progressFor(ev.ago), size: size, eraIdx: eraIdxOf(ev.ago, eras),
                        phase: (hashStr(ev.id + 'c') % 628) / 100 });
      });
    });

    /* --- 顺流流光粒子（奔流感） --- */
    flowDrops = [];
    const ND = 220;
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ND * 3), 3));
    const drnd = mulberry32(555);
    for (let i = 0; i < ND; i++) {
      flowDrops.push({ p: drnd(), o: drnd() * 2 - 1, sp: 0.010 + drnd() * 0.014 });
    }
    flowPts = new THREE.Points(dgeo, new THREE.PointsMaterial({
      map: starTex, color: 0xbfe8ff, transparent: true, opacity: state.dayMode ? 0.22 : 0.55,
      size: 2.2, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    world.add(flowPts);

    birthMarker = null; birthLabel = null;   // 重建后清除出生标记
    buildMinimap();          // 生成小地图底图（含全部河灯微点）
    scene.add(world);
    state.selected = null;
    applyVisibility();
  }

  /* ================= 可见性 ================= */
  function applyVisibility() {
    lanterns.forEach(function (m) {
      const okCat = state.catOn[m.ev.cat];
      const okSearch = !state.searchSet || state.searchSet.has(m.ev.id);
      m.group.visible = okCat && okSearch;
    });
    eraLabels.forEach(function (l) { l.visible = state.showLabels || l.userData.type === 'today'; });
  }

  /* ================= 相机 ================= */
  function sectionCamera(p) {
    const pos = pointOnCurve(p);
    const aheadP = Math.min(0.999, p + 0.055);
    const ahead = pointOnCurve(aheadP);
    return {
      eye: new THREE.Vector3(pos.x + pos.nx * 150, waterYAt(p) + 185, pos.z + pos.nz * 150),
      look: new THREE.Vector3(ahead.x, waterYAt(aheadP) + 2, ahead.z)
    };
  }
  function overviewCamera() {
    const mid = curve.getPointAt(0.5);
    return {
      eye: new THREE.Vector3(mid.x, 1750, mid.z + 1150),
      look: new THREE.Vector3(mid.x, 0, mid.z)
    };
  }
  function applyCam(cam) {
    camera.position.copy(cam.eye);
    controls.target.copy(cam.look);
    controls.update();
  }
  function tweenToEye(eye, look, dur) {
    camTween = {
      t0: performance.now(), dur: dur || 1300,
      fromPos: camera.position.clone(), fromTgt: controls.target.clone(),
      toPos: eye, toTgt: look
    };
  }
  function updateTween(now) {
    if (!camTween) return;
    const k = Math.min(1, (now - camTween.t0) / camTween.dur);
    const e = easeInOut(k);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, e);
    if (k >= 1) camTween = null;
  }

  /* ================= 视角切换 ================= */
  function setOverview(on) {
    state.camMode = on ? 'overview' : 'section';
    scene.fog.near = on ? 900 : 380;
    scene.fog.far = on ? 6500 : 1700;
    const wasFlying = state.flying;
    if (wasFlying) stopFly(true);
    const cam = on ? overviewCamera() : sectionCamera(state.flyP);
    tweenToEye(cam.eye, cam.look, 1200);
  }

  /* ================= 飞览全程 ================= */
  function startFly() {
    state.flyP = 0;
    state.flying = true;
    state.paused = false;
    state.flyHold = false;
    state.camMode = 'section';
    scene.fog.near = 380; scene.fog.far = 1700;
    controls.enabled = false;
    camTween = null;
    applyCam(sectionCamera(0));
  }
  function stopFly(keepTarget) {
    if (state.flying) {
      state.flying = false;
      state.flyHold = state.flyP > 0.001 && state.flyP < 0.999;   // 中途打断 → 可续飞
      controls.enabled = true;
      if (keepTarget) controls.target.copy(sectionCamera(state.flyP).look);
    } else {
      controls.enabled = true;
    }
  }
  /* 从当前航程恢复飞览 */
  function resumeFly() {
    if (!state.flyHold || state.flyP >= 0.999) return false;
    state.flying = true;
    state.paused = false;
    state.flyHold = false;
    state.camMode = 'section';
    scene.fog.near = 380; scene.fog.far = 1700;
    controls.enabled = false;
    camTween = null;
    return true;
  }
  function updateFly(dt) {
    if (state.paused || camTween) return;
    state.flyP += dt * state.speedMul / modeInfo().fly;
    if (state.flyP >= 1) {
      state.flyP = 1;
      state.flying = false;
      state.flyHold = false;
      controls.enabled = true;
      applyCam(sectionCamera(0.999));
      if (cb.onFlyDone) cb.onFlyDone();
      return;
    }
    const cam = sectionCamera(state.flyP);
    camera.position.lerp(cam.eye, Math.min(1, dt * 3.2));
    controls.target.lerp(cam.look, Math.min(1, dt * 3.2));
    camera.lookAt(controls.target);
  }

  /* ================= 主循环 ================= */
  function loop(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!world) return;

    if (!state.paused) {
      /* GPU 水面：时间 uniform 驱动流纹/闪光/波浪 */
      if (waterMesh) waterMesh.material.uniforms.uTime.value = now / 1000;
      /* 瀑布水幕条纹下落 */
      if (curtainTex) curtainTex.offset.y -= dt * 1.4;

      sprays.forEach(function (s, i) {                // 浪花闪烁
        s.material.opacity = 0.55 + 0.3 * Math.sin(now / 260 + i * 1.7);
      });

      /* 顺流流光粒子：沿河道推进，入海口重生 */
      if (flowPts) {
        const arr = flowPts.geometry.attributes.position.array;
        for (let i = 0; i < flowDrops.length; i++) {
          const dr = flowDrops[i];
          dr.p += dt * dr.sp;
          if (dr.p > 0.999) dr.p -= 0.997;
          const pt = pointOnCurve(dr.p);
          const hw = halfWidth(dr.p) * dr.o * 0.78;
          arr[i * 3] = pt.x + pt.nx * hw;
          arr[i * 3 + 1] = waterYAt(dr.p) + 1.0;
          arr[i * 3 + 2] = pt.z + pt.nz * hw;
        }
        flowPts.geometry.attributes.position.needsUpdate = true;
      }

      /* 河灯起伏 + 灯焰闪烁 */
      lanterns.forEach(function (m) {
        if (!m.group.visible) return;
        m.group.position.y = waterYAt(m.p) + 1.4 + Math.sin(now / 900 + m.phase) * 0.9;
        const baseOp = state.dayMode ? 0.42 : 0.7;
        const echo = (state.hoverEra !== null && m.eraIdx === state.hoverEra)
          ? 0.22 + 0.1 * Math.sin(now / 260) : 0;
        m.glow.material.opacity = m.ev.id === state.selected ? 1.0
          : Math.min(1.35, baseOp + 0.15 * Math.sin(now / 700 + m.phase * 2) + echo);
      });

      /* 流云漂移 */
      const ts2 = now / 1000;
      clouds.forEach(function (c) {
        c.s.position.x += Math.sin(ts2 * 0.015 + c.ph) * dt * 2.2;
        c.s.position.y = c.y + Math.sin(ts2 * 0.02 + c.ph) * 3;
      });

      /* 🌠 流星：随机生成、划落后熄灭（仅星夜） */
      meteorTimer -= dt;
      if (!state.dayMode && meteorTimer <= 0) {
        meteorTimer = 6 + Math.random() * 9;
        const free = meteors.filter(function (m) { return !m.visible; })[0];
        if (free) {
          const u = free.userData;
          u.head.set(300 + Math.random() * 1800, 420 + Math.random() * 260, -700 + Math.random() * 1200);
          u.vel.set(-260 - Math.random() * 160, -120 - Math.random() * 60, 60).multiplyScalar(0.9);
          u.life = 1.15;
          free.visible = true;
        }
      }
      meteors.forEach(function (m) {
        if (!m.visible) return;
        const u = m.userData;
        u.life -= dt;
        if (u.life <= 0) { m.visible = false; return; }
        u.head.addScaledVector(u.vel, dt);
        const arr = m.geometry.attributes.position.array;
        arr[0] = u.head.x; arr[1] = u.head.y; arr[2] = u.head.z;
        arr[3] = u.head.x - u.vel.x * 0.22; arr[4] = u.head.y - u.vel.y * 0.22; arr[5] = u.head.z - u.vel.z * 0.22;
        m.geometry.attributes.position.needsUpdate = true;
        m.material.opacity = Math.min(1, u.life) * 0.85;
      });

      /* 🦅 雁群：白天沿河缓缓飞行（循环） */
      if (birdGroup) {
        birdGroup.visible = state.dayMode;
        if (state.dayMode) {
          birdP += dt * 0.004;
          if (birdP > 0.98) birdP = 0.02;
          const bt = birdP;
          const bp = pointOnCurve(bt);
          birdGroup.position.set(bp.x, waterYAt(bt) + 74 + Math.sin(ts2 * 2.1) * 3, bp.z);
          birdGroup.children.forEach(function (b, i) {
            const bp2 = pointOnCurve(Math.min(0.999, bt + b.userData.lag));
            b.position.set(bp2.x - bp.x + b.userData.off * 0.2,
                           b.userData.off * 0.55 + Math.sin(ts2 * 5 + i) * 1.2,
                           bp2.z - bp.z);
            b.scale.set(9, 9 * (0.82 + 0.18 * Math.abs(Math.sin(ts2 * 6 + i))), 1);
          });
        }
      }

      /* FPS 自适应画质：帧时长过长逐级降 pixelRatio，流畅则恢复 */
      fpsAcc += dt; fpsN++;
      if (fpsN >= 90) {
        const avg = fpsAcc / fpsN;
        fpsAcc = 0; fpsN = 0;
        if (avg > 0.034 && prIdx < PR_LEVELS.length - 1) {
          prIdx++;
          renderer.setPixelRatio(PR_LEVELS[prIdx]);
          onResize();
        } else if (avg < 0.017 && prIdx > 0) {
          prIdx--;
          renderer.setPixelRatio(PR_LEVELS[prIdx]);
          onResize();
        }
      }
    } else {
      /* 暂停时仅恢复被选中河灯的脉动显示 */
    }

    /* 河灯标签：距离筛选 + 最近 26 个 + 屏幕网格去重（密集河段防重叠） */
    if (state.showLabels) {
      const cands = [];
      lanterns.forEach(function (m) {
        if (!m.label || !m.group.visible) return;
        const dist = camera.position.distanceTo(m.group.position);
        const near = m.ev.imp >= 3 ? 430 : 170;
        if (dist < near) cands.push({ m: m, d: dist });
      });
      cands.sort(function (a, b) { return a.d - b.d; });
      const used = {};
      let shown = 0;
      cands.forEach(function (c) {
        let ok = shown < 26 || c.m.ev.id === state.selected;
        if (ok) {
          _v3.copy(c.m.group.position).project(camera);
          const key = Math.round((_v3.x + 1) * 32) * 100 + Math.round((1 - _v3.y) * 20);
          if (used[key]) ok = false; else { used[key] = 1; shown++; }
        }
        c.m.label.visible = ok;
      });
    } else {
      lanterns.forEach(function (m) { if (m.label) m.label.visible = false; });
    }

    /* 🎂 出生时刻白环脉动 */
    if (birthMarker) {
      birthMarker.scale.setScalar(1 + 0.16 * Math.sin(now / 280));
    }

    /* 定位光环 */
    if (beacon) {
      beaconT += dt;
      const t = beaconT / 1.5;
      if (t >= 1) { world.remove(beacon); beacon.material.dispose(); beacon.geometry.dispose(); beacon = null; }
      else {
        beacon.scale.setScalar(1.5 + t * 12);
        beacon.material.opacity = (1 - t) * 0.9;
      }
    }

    updateTween(now);
    if (state.flying) updateFly(dt);
    else controls.update();

    if (cb.onFly && state.flying) emitFly();

    renderer.render(scene, camera);
  }

  /* ================= 飞览进度播报 ================= */
  function emitFly() {
    if (!cb.onFly) return;
    const ago = agoForProgress(state.flyP);
    let eraName = '', eraIdx = -1;
    const eras = D.ERAS[state.mode];
    for (let i = 0; i < eras.length; i++) {
      if (ago <= eras[i].from && ago >= eras[i].to) { eraName = eras[i].name; eraIdx = i; break; }
    }
    let lit = 0;
    lanterns.forEach(function (m) { if (m.p <= state.flyP) lit++; });
    cb.onFly({ pct: state.flyP, ago: ago, era: eraName, eraIdx: eraIdx, lit: lit, total: lanterns.length });
  }

  /* ================= 拾取 ================= */
  function pick() {
    raycaster.setFromCamera(pointerVec, camera);
    const targets = [];
    lanterns.forEach(function (m) {
      if (m.group.visible) {
        targets.push(m.glow);
        if (m.label && m.label.visible) targets.push(m.label);
      }
    });
    eraLabels.forEach(function (l) { if (l.visible) targets.push(l); });
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    if (u && u.type === 'event') return { type: 'event', id: u.id };
    if (u && u.type === 'era') return { type: 'era', idx: u.idx };
    if (u && u.type === 'today') return { type: 'today' };
    return null;
  }

  function setHovered(h, x, y) {
    state.hovered = h;
    if (cb.onHover) cb.onHover(h ? { x: x, y: y, title: h.title, sub: h.sub } : null);
    document.body.style.cursor = h ? 'pointer' : '';
  }

  /* ================= 指针交互 ================= */
  function bindPointer() {
    const dom = renderer.domElement;
    let downX = 0, downY = 0;
    let panning = false, panX = 0, panY = 0;

    /* 按住空格 = 平移模式（配合左键拖拽，类似设计软件的抓手） */
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !e.repeat) {
        state.spaceHeld = true;
        state.spacePanned = false;
        document.body.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        state.spaceHeld = false;
        if (!panning) document.body.style.cursor = '';
      }
    });
    window.addEventListener('blur', function () {
      state.spaceHeld = false;
      if (!panning) document.body.style.cursor = '';
    });

    /* 空格 + 左键拖拽：沿屏幕平面平移相机与视线目标 */
    function panBy(dx, dy) {
      const dist = camera.position.distanceTo(controls.target);
      const k = dist * 0.0013;
      _rvec.setFromMatrixColumn(camera.matrix, 0);
      _uvec.setFromMatrixColumn(camera.matrix, 1);
      camera.position.addScaledVector(_rvec, -dx * k).addScaledVector(_uvec, dy * k);
      controls.target.addScaledVector(_rvec, -dx * k).addScaledVector(_uvec, dy * k);
    }

    dom.addEventListener('pointerdown', function (e) {
      downX = e.clientX; downY = e.clientY;
      if (state.spaceHeld && e.button === 0) {
        panning = true;
        panX = e.clientX; panY = e.clientY;
        if (state.flying) {                       // 飞览中平移 = 接管镜头
          stopFly(true);
          if (cb.onCamMode) cb.onCamMode();
        }
        controls.enabled = false;                 // 抑制 OrbitControls 旋转
        document.body.style.cursor = 'grabbing';
        return;
      }
      /* 飞览中普通拖拽 = 同样接管镜头 */
      if (state.flying) {
        stopFly(true);
        if (cb.onCamMode) cb.onCamMode();
      }
    });

    dom.addEventListener('pointermove', function (e) {
      if (panning && e.buttons) {
        state.spacePanned = true;
        panBy(e.clientX - panX, e.clientY - panY);
        panX = e.clientX; panY = e.clientY;
        return;
      }
      const rect = dom.getBoundingClientRect();
      pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (!e.buttons) doHover(e.clientX, e.clientY);
    });

    dom.addEventListener('pointerleave', function () { setHovered(null); });

    window.addEventListener('pointerup', function (e) {
      if (panning) {
        panning = false;
        controls.enabled = true;
        document.body.style.cursor = '';
        downX = -999; downY = -999;
        return;
      }
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      if (e.target !== dom) return;
      const rect = dom.getBoundingClientRect();
      pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = pick();
      if (hit && hit.type === 'event') {
        selectEvent(hit.id, false);
      } else if (hit && hit.type === 'era') {
        focusEra(hit.idx);
      } else if (hit && hit.type === 'today') {
        jumpToProgress(0.999);
      } else {
        state.selected = null;
        if (cb.onSelect) cb.onSelect(null);
      }
      downX = -999; downY = -999;
    });
  }

  function doHover(x, y) {
    const hit = pick();
    if (hit && hit.type === 'event') {
      const m = lanterns.filter(function (q) { return q.ev.id === hit.id; })[0];
      setHovered({ title: m.ev.title, sub: D.fmtAgo(m.ev.ago) }, x, y);
    } else if (hit && hit.type === 'era') {
      setHovered({ title: D.ERAS[state.mode][hit.idx].name, sub: '纪元 · 单击飞往该河段' }, x, y);
    } else if (hit && hit.type === 'today') {
      setHovered({ title: '今天 · 入海口', sub: '单击飞往' }, x, y);
    } else {
      setHovered(null);
    }
  }

  /* ================= 选中 / 跳转 ================= */
  function setSelected(id) { state.selected = id; }

  /* ================= 🏆 问答模式（点击判定） ================= */
  function setQuiz(idOrNull) { state.quizTarget = idOrNull; }
  function wrongFlash(id) {
    const m = lanterns.filter(function (q) { return q.ev.id === id; })[0];
    if (!m) return;
    m.glow.material.color.set(0xff5a4d);
    m.glow.material.opacity = 1.0;
    setTimeout(function () {
      m.glow.material.color.set(D.CATS[m.ev.cat].color);
    }, 900);
  }

  function selectEvent(id, fly) {
    /* 问答模式：点击河灯先判答案 */
    let quizCorrect = false;
    if (state.quizTarget) {
      if (id === state.quizTarget) {
        state.quizTarget = null;
        quizCorrect = true;
      } else {
        wrongFlash(id);
        if (cb.onQuiz) cb.onQuiz({ correct: false, id: id });
        return;
      }
    }
    setSelected(id);
    const m = lanterns.filter(function (x) { return x.ev.id === id; })[0];
    if (m) {
      stopFly(false);
      if (state.camMode === 'overview') setOverview(false);
      const pos = m.group.position;
      /* 默认不移动镜头（原地弹出信息窗）；搜索/分享/跳转等显式传 fly 才飞过去 */
      if (fly !== false) {
        const eye = new THREE.Vector3(pos.x - 26, pos.y + 22, pos.z + 36);
        tweenToEye(eye, pos.clone(), 1300);
      }
      if (beacon) { world.remove(beacon); beacon.material.dispose(); beacon.geometry.dispose(); }
      beacon = new THREE.Mesh(
        new THREE.RingGeometry(1, 1.32, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffd27f, transparent: true, opacity: 0.9,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(pos.x, waterYAt(m.p) + 0.4, pos.z);
      world.add(beacon);
      beaconT = 0;
      emitFly();
    }
    if (quizCorrect && cb.onQuiz) cb.onQuiz({ correct: true, id: id });
    if (cb.onSelect) cb.onSelect({ type: 'event', id: id });
  }

  /* 🎂 时光机：在"你出生那年"的河段放置白色标记环 */
  function setBirthMarker(ago, text) {
    if (birthMarker) { world.remove(birthMarker); birthMarker.geometry.dispose(); birthMarker.material.dispose(); birthMarker = null; }
    if (birthLabel) { world.remove(birthLabel); birthLabel.material.dispose(); birthLabel = null; }
    if (ago == null) return;
    const p = Math.min(0.998, Math.max(0.002, progressFor(ago)));
    const pt = pointOnCurve(p);
    birthMarker = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    birthMarker.rotation.x = -Math.PI / 2;
    birthMarker.position.set(pt.x, waterYAt(p) + 0.5, pt.z);
    world.add(birthMarker);
    birthLabel = TEX.makeTextSprite(text, null, '#ffffff', { fontSize: 44 });
    birthLabel.scale.set(15, 15 / birthLabel.userData.aspect, 1);
    birthLabel.position.set(pt.x, waterYAt(p) + 13, pt.z);
    world.add(birthLabel);
  }

  function focusEra(idx) {
    const era = D.ERAS[state.mode][idx];
    if (!era) return;
    setSelected(null);
    stopFly(false);
    if (state.camMode === 'overview') setOverview(false);
    const pMid = (progressFor(era.from) + progressFor(era.to)) / 2;
    state.flyP = pMid;
    const cam = sectionCamera(pMid);
    tweenToEye(cam.eye, cam.look, 1300);
    emitFly();
    if (cb.onSelect) cb.onSelect({ type: 'era', idx: idx });
  }

  function jumpToProgress(p) {
    stopFly(false);
    if (state.camMode === 'overview') setOverview(false);
    state.flyP = Math.min(0.999, Math.max(0.001, p));
    const cam = sectionCamera(state.flyP);
    tweenToEye(cam.eye, cam.look, 1300);
    emitFly();
  }

  /* ================= 暂停 / 时间凝固与航程跳转 ================= */
  function togglePause() {
    state.paused = !state.paused;
    if (cb.onCamMode) cb.onCamMode();          // 通知 UI 立即刷新按钮状态
    return state.paused;
  }
  /* 拖动进度条 / ←→ 跳转：进入暂停态，镜头直接就位 */
  function seek(p) {
    stopFly(false);
    if (state.camMode === 'overview') setOverview(false);
    state.paused = true;
    state.flyHold = state.flyP > 0.001 && state.flyP < 0.999;
    state.flyP = Math.min(0.999, Math.max(0.001, p));
    applyCam(sectionCamera(state.flyP));
    emitFly();
    if (cb.onCamMode) cb.onCamMode();
  }
  function nudge(d) { seek(state.flyP + d); }

  /* ================= 昼夜切换 ================= */
  function toggleDay() {
    state.dayMode = !state.dayMode;
    const day = state.dayMode;
    renderer.setClearColor(day ? 0x9cc0d8 : 0x04060c);
    scene.fog.color.set(day ? 0xaac6d8 : 0x04060c);
    if (ambLight) ambLight.intensity = day ? 1.0 : 0.55;
    if (dirLight) dirLight.intensity = day ? 0.8 : 0.4;
    if (skyStars) skyStars.visible = !day;
    if (skyNeb) skyNeb.visible = !day;
    buildWorld();
    /* 恢复当前视点 */
    const cam = state.camMode === 'overview' ? overviewCamera() : sectionCamera(state.flyP);
    applyCam(cam);
    return day;
  }

  /* ================= 对外接口 ================= */
  window.addEventListener('DOMContentLoaded', function () {
    if (!window.THREE) return;
    init();
    /* 分享链接带事件定位时（app.js 置位 __TR_NO_AUTO_FLY），不自动起飞 */
    setTimeout(function () {
      if (!window.__TR_NO_AUTO_FLY) startFly();
    }, 600);
  });

  return {
    state: state,
    onHover: function (f) { cb.onHover = f; },
    onSelect: function (f) { cb.onSelect = f; },
    onQuiz: function (f) { cb.onQuiz = f; },
    onFly: function (f) { cb.onFly = f; },
    onFlyDone: function (f) { cb.onFlyDone = f; },
    onCamMode: function (f) { cb.onCamMode = f; },
    setMode: function (id) {
      if (!D.ERAS[id] || id === state.mode) return;
      state.mode = id;
      state.searchSet = null;
      buildWorld();
      startFly();
    },
    replay: startFly,
    skip: function () {
      stopFly(false);
      jumpToProgress(0.999);
    },
    toggleFly: function () {
      const st = state;
      if (st.flying) { st.paused = !st.paused; return st.paused ? 'paused' : 'fly'; }
      if (resumeFly()) return 'fly';
      startFly();
      return 'fly';
    },
    resumeFly: resumeFly,
    togglePause: togglePause,
    setSpeedMul: function (m) { state.speedMul = m; },
    toggleDay: toggleDay,
    setQuiz: setQuiz,
    seek: seek,
    nudge: nudge,
    flyToProgress: jumpToProgress,
    setBirthMarker: setBirthMarker,
    toggleOverview: function () {
      setOverview(state.camMode !== 'overview');
      return state.camMode === 'overview';
    },
    resetView: function () {
      setOverview(false);
      const cam = sectionCamera(state.flyP);
      tweenToEye(cam.eye, cam.look, 1200);
    },
    setCategory: function (cat, on) { state.catOn[cat] = on; applyVisibility(); },
    setSearch: function (set) { state.searchSet = set; applyVisibility(); },
    setShowLabels: function (b) { state.showLabels = b; applyVisibility(); },
    selectEvent: selectEvent,
    focusEra: focusEra,
    clearSelection: function () {
      setSelected(null);
      if (cb.onSelect) cb.onSelect(null);      // 通知 UI（含更新分享 hash）
    },
    eventsInMode: function () {
      const span = modeInfo().span;
      return D.EVENTS.filter(function (e) { return e.ago <= span + 1; });
    },
    progressOf: function (ago) { return progressFor(ago); },
    /* 航程 p 处的年份与最近河灯（进度条实时预览用） */
    nearestAt: function (p) {
      const ago = agoForProgress(p);
      let best = null, bd = 1e9;
      lanterns.forEach(function (m) {
        const d = Math.abs(m.p - p);
        if (d < bd) { bd = d; best = m; }
      });
      return { ago: ago, title: best ? best.ev.title : null };
    },
    isReady: function () { return !!renderer; },
    resize: function () { onResize(); },
    getMinimap: function () { return mmCanvas ? { canvas: mmCanvas, map: mmMap, unmap: mmUnmap } : null; },
    mapSeek: mapSeek,
    _dbg: function () { return { camera: camera, controls: controls, renderer: renderer, scene: scene, curve: curve }; }
  };
})();
