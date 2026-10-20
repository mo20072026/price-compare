/* 冒烟测试：jsdom 真实加载页面，验证多链接模型、算价与模糊检索 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:/Users/DELL/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

let fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fail++;
}
const errors = [];
const dom = new JSDOM(html, {
  url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.addEventListener('error', e => errors.push(e.message));
    w.print = () => {};
    w.confirm = () => true;
    w.open = () => null;
    w.HTMLElement.prototype.scrollIntoView = function () {};
  }
});
const w = dom.window, d = w.document;

['data.js', 'gh-sync.js', 'app.js'].forEach(f => {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(path.join(dir, f), 'utf8');
  d.body.appendChild(s);
});
if (d.readyState === 'loading') d.dispatchEvent(new w.Event('DOMContentLoaded'));

const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

setTimeout(() => {
  console.log('\n— 算价（多链接模型）—');
  const rows = [...d.querySelectorAll('.rt-row')];
  const prices = rows.map(r => r.querySelector('.num.strong').textContent);
  console.log('  排行：' + prices.join(' < '));
  ok(rows.length === 4, '4 个平台参与比价');
  ok(prices[0] === '¥2,659.00', '最优 2,659.00（淘宝第 1 条链接）');
  ok(prices[1] === '¥2,679.00', '次优 2,679.00');
  ok(prices[2] === '¥2,894.91', '拼多多第三 2,894.91，实际 ' + prices[2]);
  ok(prices[3] === '¥3,069.00', '抖音第四');

  const vd = d.querySelector('#verdict').textContent.replace(/\s+/g, ' ');
  ok(/第 1 条链接/.test(vd), '结论条标明取的是第几条链接');
  console.log('  结论：' + vd.slice(0, 96));

  const tbLinks = d.querySelectorAll('[data-card="taobao"] .lrow');
  ok(tbLinks.length === 2, '淘宝显示 2 条链接（实际 ' + tbLinks.length + '）');
  const metas = [...d.querySelectorAll('[data-card="taobao"] .lmeta')].map(m => m.textContent.trim());
  console.log('  淘宝链接：' + metas.join(' | '));
  ok(metas[0].includes('到手 ¥2,659.00') && metas[0].includes('最低'), '第 1 条标为最低');
  ok(metas[1].includes('到手 ¥2,859.00'), '第 2 条单独算出 2,859.00，实际 ' + metas[1]);

  console.log('\n— 链接增删与上限 —');
  const addBtn = d.querySelector('[data-addlink="jd"]');
  click(addBtn); click(d.querySelector('[data-addlink="jd"]'));
  ok(d.querySelectorAll('[data-card="jd"] .lrow').length === 3, '可添加到 3 条');
  click(d.querySelector('[data-addlink="jd"]')); click(d.querySelector('[data-addlink="jd"]'));
  ok(d.querySelectorAll('[data-card="jd"] .lrow').length === 5, '上限 5 条');
  ok(!d.querySelector('[data-addlink="jd"]'), '满 5 条后隐藏「添加链接」按钮');
  ok(d.querySelector('[data-card="jd"] .lcap').textContent.includes('上限'), '显示已达上限提示');
  click(d.querySelector('[data-card="jd"] [data-dellink="4"]'));
  ok(d.querySelectorAll('[data-card="jd"] .lrow').length === 4, '可删除链接');

  console.log('\n— 模糊检索 —');
  const fi = d.querySelector('#findInput');

  input(fi, '戴森');
  let items = [...d.querySelectorAll('#findRes .fitem')];
  ok(items.length >= 2, '搜「戴森」命中商品 + 新建项（' + items.length + '）');
  console.log('  ' + items.map(i => i.querySelector('.fi-t').textContent).join(' / '));
  ok(items[0].textContent.includes('命中') === false, '首项是商品');

  input(fi, 'sv46');
  items = [...d.querySelectorAll('#findRes .fitem')];
  const hitSpec = items.some(i => (i.querySelector('.fi-h') || {}).textContent === '规格');
  ok(hitSpec, '规格字段模糊命中（sv46 → SV46）');

  input(fi, '戴');
  items = [...d.querySelectorAll('#findRes .fitem')];
  ok(items.length > 0 && items[0].querySelector('.fi-t').textContent.includes('戴森'), '单字也能模糊命中');

  input(fi, 'taobao');
  items = [...d.querySelectorAll('#findRes .fitem')];
  const hitLink = items.some(i => (i.querySelector('.fi-h') || {}).textContent === '链接');
  ok(hitLink, '链接地址参与检索（taobao → 链接字段命中）');

  input(fi, 'https://item.jd.com/1000999888.html');
  items = [...d.querySelectorAll('#findRes .fitem')];
  console.log('  链接识别：' + items.map(i => i.querySelector('.fi-t').textContent).join(' / '));
  ok(items.length === 2, '粘贴链接给出「加入当前商品」+「新建商品」两个动作');
  ok(items[0].textContent.includes('京东'), '识别为京东');
  ok(items[1].textContent.includes('1000999888'), '从链接提取到商品 ID');

  console.log('\n— 动作 —');
  click(items[0]);
  const jdLinks = [...d.querySelectorAll('[data-card="jd"] .lrow input.lurl')].map(i => i.value);
  ok(jdLinks.some(v => v.includes('1000999888')), '「加入当前商品」写入了京东链接');
  ok(d.querySelector('#toast').textContent.includes('京东'), '有 toast 提示');
  ok(fi.value === '', '加入后清空检索框');

  input(fi, '不存在的商品xyz');
  items = [...d.querySelectorAll('#findRes .fitem')];
  ok(items.length === 1 && items[0].textContent.includes('新建商品'), '无匹配时提供「新建」兜底');
  click(items[0]);
  ok(d.querySelectorAll('.pchip').length === 3, '新建后商品 chip 变 3（含 + 按钮）');
  ok(d.querySelector('#prodName').value === '不存在的商品xyz', '用检索词做了商品名');

  input(fi, '戴森');
  click(d.querySelectorAll('#findRes .fitem')[0]);
  ok(d.querySelector('#prodName').value.includes('戴森'), '点搜索结果可切回原商品');

  console.log('\n— 攻略与运行时 —');
  ok(d.querySelectorAll('.gitem').length > 5, '攻略渲染正常');
  ok(d.querySelectorAll('.gtab').length === 8, '8 个平台 tab');
  ok(errors.length === 0, '无 JS 错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'));
  process.exit(fail === 0 ? 0 : 1);
}, 350);
