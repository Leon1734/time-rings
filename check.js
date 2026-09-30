#!/usr/bin/env node
/* ============================================================
 * check.js —— data.js 数据体检
 *  用法：node check.js
 *  校验：id 唯一性 / 必填字段 / cat 合法性 / imp 区间 / ago 范围
 *        / facts 数组 / 标题重复 / cn 与 wiki 字段格式 / 教学路线 id 有效性
 *  全部通过 exit 0；发现错误 exit 1（警告不影响）
 * ============================================================ */
'use strict';

const fs = require('fs');
global.window = {};
eval(fs.readFileSync('js/data.js', 'utf8'));
const D = window.TR_DATA;

let errors = 0, warns = 0;
const err = (m) => { console.log('  ❌ ' + m); errors++; };
const warn = (m) => { console.log('  ⚠️  ' + m); warns++; };

console.log('📜 事件：' + D.EVENTS.length + ' 条');

/* ---- 字段完整性 ---- */
const ids = new Set();
const titles = new Map();
D.EVENTS.forEach((e, i) => {
  const at = '#' + i + (e.id ? ' (' + e.id + ')' : '');
  if (!e.id) err(at + ' 缺 id');
  else if (ids.has(e.id)) err('重复 id: ' + e.id);
  else ids.add(e.id);

  if (!e.title) err(e.id + ' 缺 title');
  else if (titles.has(e.title)) warn('标题重复: "' + e.title + '"（' + titles.get(e.title) + ' 与 ' + e.id + '）');
  else titles.set(e.title, e.id);

  if (!D.CATS[e.cat]) err(e.id + ' cat 非法: ' + e.cat);
  if (typeof e.ago !== 'number' || !isFinite(e.ago) || e.ago < 0) err(e.id + ' ago 非法: ' + e.ago);
  else if (e.ago > D.T_UNIVERSE) {
    if (e.ago - D.T_UNIVERSE <= 2200) warn(e.id + ' ago 略超宇宙年龄（+' + (e.ago - D.T_UNIVERSE) + '，"补当年"写法可接受，渲染时会自动钳制）');
    else err(e.id + ' ago 超出宇宙年龄过多: ' + e.ago);
  }
  if (![1, 2, 3].includes(e.imp)) warn(e.id + ' imp 应为 1/2/3，当前: ' + e.imp);
  if (typeof e.desc !== 'string' || e.desc.length < 10) warn(e.id + ' desc 过短或缺失');
  if (!Array.isArray(e.facts) || e.facts.length === 0) warn(e.id + ' 无 facts 趣味知识');
  if (e.en && typeof e.en !== 'string') warn(e.id + ' en 应为字符串');
  if (e.cn !== undefined && e.cn !== 1) warn(e.id + ' cn 只应为 1');
  if (e.wiki && typeof e.wiki !== 'string') warn(e.id + ' wiki 应为字符串（维基词条名）');
});

/* ---- cn 标记抽查（支流覆盖） ---- */
const cnN = D.EVENTS.filter(e => e.cn === 1).length;
console.log('🐉 中国支流：' + cnN + ' 盏');
if (cnN === 0) warn('没有任何 cn:1 事件——中国支流将不出现');

/* ---- 教学路线 id 有效性 ---- */
console.log('🎓 教学路线：' + D.TOURS.length + ' 条');
D.TOURS.forEach(t => {
  const bad = t.steps.filter(id => !ids.has(id));
  if (bad.length) err('路线 "' + t.name + '" 含无效 id: ' + bad.join(', '));
  else console.log('  ✅ ' + t.icon + ' ' + t.name + ' · ' + t.steps.length + ' 站');
});

/* ---- 纪元覆盖 ---- */
Object.keys(D.ERAS).forEach(k => {
  D.ERAS[k].forEach(e => {
    if (typeof e.from !== 'number' || typeof e.to !== 'number') err('ERAS.' + k + ' "' + e.name + '" from/to 非数值');
    else if (e.from < e.to) err('ERAS.' + k + ' "' + e.name + '" from 应 ≥ to（更老 ≥ 更新）');
  });
});
console.log('🍃 纪元表：deep ' + D.ERAS.deep.length + ' / civ ' + D.ERAS.civ.length + ' / modern ' + D.ERAS.modern.length);

console.log('------------------------');
if (errors) { console.log('❌ ' + errors + ' 个错误，' + warns + ' 个警告'); process.exit(1); }
console.log('✅ 体检通过' + (warns ? '（' + warns + ' 个可选警告）' : ''));
