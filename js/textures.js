/* ============================================================
 * textures.js —— 时间年轮 · 程序化贴图
 *  - makeWoodTexture()  木纹年轮底纹（Canvas 实时生成）
 *  - makeGlowTexture()  径向光晕（节点光斑 / 前沿辉光）
 *  - makeTextSprite()   文字标签精灵（纪元名 / 事件名）
 *  - makeStarTexture()  柔和星点
 * 全部由程序生成，无外部图片依赖。
 * ============================================================ */
'use strict';

window.TR_TEX = (function () {

  /* ---------- 小工具 ---------- */
  function canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  /* 伪随机（可复现，保证每次打开纹理一致） */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ================= 木纹年轮底纹 =================
   * 深色胡桃木底 + 一圈圈深浅相间的年轮线（带自然扰动）。
   * 中心为树心，边缘略深，纹理随半径自然变密。 */
  function makeWoodTexture(size) {
    size = size || 2048;
    const c = canvas(size), ctx = c.getContext('2d');
    const cx = size / 2, R = size / 2;
    const rnd = mulberry32(20260912);

    /* 底色：径向渐变（树心偏亮暖，外缘偏深） */
    const base = ctx.createRadialGradient(cx, cx, 0, cx, cx, R);
    base.addColorStop(0, '#4a3320');
    base.addColorStop(0.25, '#3a2717');
    base.addColorStop(0.7, '#2e1f12');
    base.addColorStop(1, '#241710');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    /* 年轮圈数与扰动参数 */
    const RINGS = 130;
    const ph1 = rnd() * Math.PI * 2, ph2 = rnd() * Math.PI * 2, ph3 = rnd() * Math.PI * 2;
    const a1 = 4 + rnd() * 5, a2 = 2 + rnd() * 3, a3 = 1 + rnd() * 2;

    ctx.globalAlpha = 1;
    for (let i = 0; i < RINGS; i++) {
      const t = i / RINGS;
      const r0 = 14 + t * (R - 16);          // 平均半径
      /* 每圈的不规则形状（三重正弦扰动，各圈相位缓慢漂移） */
      const drift = (t * 18) % (Math.PI * 2);

      /* 早材：较宽的浅色带 */
      ctx.beginPath();
      for (let k = 0; k <= 180; k++) {
        const th = k / 180 * Math.PI * 2;
        const rr = r0 + 4 + a1 * Math.sin(th * 3 + ph1 + drift)
                      + a2 * Math.sin(th * 7 + ph2 + drift * 1.7)
                      + a3 * Math.sin(th * 13 + ph3);
        const x = cx + Math.cos(th) * rr, y = cx + Math.sin(th) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const light = 22 + 14 * rnd();
      ctx.strokeStyle = 'rgba(' + (90 + light * 1.6 | 0) + ',' + (62 + light | 0) + ',' + (36 + light * 0.6 | 0) + ',' + (0.16 + rnd() * 0.12) + ')';
      ctx.lineWidth = 3 + rnd() * 5;
      ctx.stroke();

      /* 晚材：紧随其后的细深线（年轮的"轮界"） */
      ctx.beginPath();
      for (let k = 0; k <= 180; k++) {
        const th = k / 180 * Math.PI * 2;
        const rr = r0 + a1 * Math.sin(th * 3 + ph1 + drift)
                      + a2 * Math.sin(th * 7 + ph2 + drift * 1.7)
                      + a3 * Math.sin(th * 13 + ph3);
        const x = cx + Math.cos(th) * rr, y = cx + Math.sin(th) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(10,5,2,' + (0.5 + rnd() * 0.35) + ')';
      ctx.lineWidth = 1 + rnd() * 1.8;
      ctx.stroke();
    }

    /* 髓心：中心一小块亮斑（树心） */
    const pith = ctx.createRadialGradient(cx, cx, 0, cx, cx, 26);
    pith.addColorStop(0, 'rgba(120,84,40,0.9)');
    pith.addColorStop(1, 'rgba(120,84,40,0)');
    ctx.fillStyle = pith;
    ctx.fillRect(cx - 30, cx - 30, 60, 60);

    /* 少量细小"树结"斑点 */
    for (let i = 0; i < 14; i++) {
      const th = rnd() * Math.PI * 2, rr = 60 + rnd() * (R - 90);
      const x = cx + Math.cos(th) * rr, y = cx + Math.sin(th) * rr, s = 3 + rnd() * 7;
      const knot = ctx.createRadialGradient(x, y, 0, x, y, s);
      knot.addColorStop(0, 'rgba(8,4,2,0.55)');
      knot.addColorStop(1, 'rgba(8,4,2,0)');
      ctx.fillStyle = knot;
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    return tex;
  }

  /* ================= 径向光晕 ================= */
  function makeGlowTexture(size) {
    size = size || 128;
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ================= 柔和星点 ================= */
  function makeStarTexture(size) {
    size = size || 64;
    const c = canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ================= 文字标签精灵 =================
   * text 主文字，sub 次行（可空），color 边框/主色
   * 返回 THREE.Sprite，scale 需由调用方按世界尺寸设置 */
  function makeTextSprite(text, sub, color, opts) {
    opts = opts || {};
    const fs = opts.fontSize || 44;         // 字号(px)
    const pad = 18;
    const meas = canvas(8).getContext('2d');
    meas.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    const w1 = meas.measureText(text).width;
    let w2 = 0;
    if (sub) {
      meas.font = '400 ' + (fs * 0.62 | 0) + 'px "Microsoft YaHei",sans-serif';
      w2 = meas.measureText(sub).width;
    }
    const W = Math.ceil(Math.max(w1, w2) + pad * 2);
    const H = Math.ceil(fs * (sub ? 1.85 : 1.3) + pad);

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    /* 圆角底 */
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.quadraticCurveTo(W, 0, W, r);
    ctx.lineTo(W, H - r); ctx.quadraticCurveTo(W, H, W - r, H);
    ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.fill();
    ctx.strokeStyle = color || '#ffd27f';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3ede2';
    ctx.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.fillText(text, W / 2, sub ? H * 0.36 : H / 2);
    if (sub) {
      ctx.fillStyle = color || '#ffd27f';
      ctx.font = '400 ' + (fs * 0.62 | 0) + 'px "Microsoft YaHei",sans-serif';
      ctx.fillText(sub, W / 2, H * 0.75);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.userData.aspect = W / H;
    return sp;
  }

  /* ================= 河水贴图 =================
   * 青蓝色水面 + 顺流方向的波纹长条（wrapT 重复，offset 流动） */
  function makeWaterTexture() {
    const size = 256;
    const c = canvas(size), ctx = c.getContext('2d');
    const rnd = mulberry32(20260913);
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#13404f');
    g.addColorStop(0.5, '#1b5568');
    g.addColorStop(1, '#13404f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    /* 顺流波纹（水平长条，带正弦弯曲） */
    for (let i = 0; i < 32; i++) {
      const y = rnd() * size;
      const amp = 2 + rnd() * 4, ph = rnd() * Math.PI * 2, th = 1 + rnd() * 2;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const yy = y + Math.sin((x / size) * Math.PI * 4 + ph) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = 'rgba(160,220,230,' + (0.04 + rnd() * 0.09) + ')';
      ctx.lineWidth = th;
      ctx.stroke();
    }
    /* 星点微光 */
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(220,245,250,' + (0.06 + rnd() * 0.2) + ')';
      ctx.fillRect(rnd() * size, rnd() * size, 1.6, 1.6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  /* ================= 瀑布水幕条纹 =================
   * 垂直白色细纹（wrapT 无缝重复），滚动即成奔流瀑布 */
  function makeStreakTexture() {
    const w = 128, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const rnd = mulberry32(8888);
    for (let i = 0; i < 34; i++) {
      const x0 = rnd() * w;
      const amp = 2 + rnd() * 5;
      const ph = rnd() * Math.PI * 2;
      const th = 0.8 + rnd() * 2.6;
      const a = 0.08 + rnd() * 0.4;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 4) {
        const x = x0 + Math.sin(y / h * Math.PI * 2 + ph) * amp;
        if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(225,242,252,' + a + ')';
      ctx.lineWidth = th;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    /* 几条更亮的主流线 */
    for (let i = 0; i < 6; i++) {
      const x0 = rnd() * w;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 4) {
        const x = x0 + Math.sin(y / h * Math.PI * 2 + rnd() * 0.001) * 3;
        if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(245,252,255,0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /* ================= 时代图腾（大 emoji 精灵贴图） ================= */
  function makeEmojiTexture(ch, px) {
    const size = px || 256;
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.font = Math.round(size * 0.72) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = size * 0.06;
    ctx.fillText(ch, size / 2, size / 2 + size * 0.04);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  return {
    makeWoodTexture: makeWoodTexture,
    makeWaterTexture: makeWaterTexture,
    makeStreakTexture: makeStreakTexture,
    makeGlowTexture: makeGlowTexture,
    makeStarTexture: makeStarTexture,
    makeTextSprite: makeTextSprite,
    makeEmojiTexture: makeEmojiTexture
  };
})();
