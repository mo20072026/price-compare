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
    w.__opened = [];
    w.open = u => { w.__opened.push(u); return null; };
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

  console.log('\n— 蓝框砍掉：链接行不再有价格输入框 —');
  ok(!d.querySelector('.lrow input[data-f="price"]'), '链接行没有内联价格输入框');
  ok(!d.querySelector('.lhead'), '旧表头已移除');
  const chip = d.querySelector('[data-card="taobao"] [data-priceedit="taobao|0"]');
  ok(chip && chip.textContent.includes('¥'), '价格标签显示当前价（实际 ' + (chip && chip.textContent) + '）');

  console.log('\n— 价格弹层 —');
  click(chip);
  ok(!d.querySelector('#pricePop').hidden, '点价格标签弹出填写面板');
  input(d.querySelector('#popPrice'), '3999');
  const chip2 = d.querySelector('[data-card="taobao"] [data-priceedit="taobao|0"]');
  ok(chip2.textContent.includes('3999'), '改价后标签同步（实际 ' + chip2.textContent + '）');
  const tbMeta0 = d.querySelector('[data-card="taobao"] .lmeta .lprice');
  ok(!tbMeta0.textContent.includes('2,659'), '到手价随新价重算（实际 ' + tbMeta0.textContent + '）');
  input(d.querySelector('#popPrice'), '3699');
  d.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(d.querySelector('#pricePop').hidden, '点外部关闭弹层');
  ok(d.querySelector('[data-card="taobao"] .lmeta .lprice').textContent.includes('2,659'), '改回原价后到手价复原');

  console.log('\n— 卡片工具行 —');
  click(d.querySelector('[data-card="taobao"] [data-srch="taobao"]'));
  ok(w.__opened.some(u => String(u).indexOf('s.taobao.com') >= 0), '搜同款打开平台搜索');
  click(d.querySelector('[data-card="taobao"] [data-typical="taobao"]'));
  ok(d.querySelector('#toast').textContent.includes('典型值'), '套用典型优惠有提示（实际：' + d.querySelector('#toast').textContent + '）');

  console.log('\n— 抓价助手 —');
  click(d.querySelector('#btnGrab'));
  ok(!d.querySelector('#grabModal').hidden, '点按钮打开抓价助手弹窗');
  ok((d.querySelector('#grabLink').href || '').startsWith('javascript:'), '书签链接已生成');
  ok(d.querySelector('#grabCode').value.length > 300, '手动复制代码已生成（' + d.querySelector('#grabCode').value.length + ' 字符）');
  d.querySelector('#grabModal [data-close="1"]').click();
  ok(d.querySelector('#grabModal').hidden, '可关闭弹窗');

  console.log('\n— 抓价码粘贴录入 —');
  const grabObj = { t: '戴森 V12 吸尘器 官方旗舰', p: '3399', u: 'https://item.jd.com/100012043978.html' };
  const b64 = Buffer.from(JSON.stringify(grabObj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  input(fi, 'DJ1.' + b64);
  items = [...d.querySelectorAll('#findRes .fitem')];
  console.log('  抓价码动作：' + items.map(i => i.querySelector('.fi-t').textContent).join(' / '));
  ok(items.some(i => i.textContent.includes('新建商品')), '抓价码给出「新建商品」动作');
  ok(items.some(i => i.textContent.includes('加入商品')), '抓价码给出「加入已有商品」动作（模糊匹配标题）');
  const newItemBtn = items.find(i => i.textContent.includes('新建商品'));
  click(newItemBtn);
  ok(d.querySelectorAll('.pchip').length === 4, '用抓价结果新建了商品（原 2 个 + 抓价 1 个）');
  ok(d.querySelector('#prodName').value.includes('戴森 V12 吸尘器'), '商品名来自抓到的标题');
  const newUrl = [...d.querySelectorAll('.lurl')].map(i => i.value).find(v => v.includes('100012043978'));
  ok(newUrl, '链接已写入');
  const newChip = [...d.querySelectorAll('.price-chip')].find(c => c.textContent.includes('3399'));
  ok(newChip, '价格 ¥3399 已自动填入（不用手算手填）');

  console.log('\n— 批量导入（技能 --json 桥接）—');
  click(d.querySelector('#btnImport'));
  ok(!d.querySelector('#importModal').hidden, '打开批量导入弹窗');
  const chipsBefore = d.querySelectorAll('.pchip').length;
  const impJson = JSON.stringify({
    keyword: '无线鼠标',
    results: {
      '苏宁易购': [{ title: '罗技(Logitech)M330 无线鼠标', price: 109.0, url: 'https://product.suning.com/0000000000/12411611206.html' }],
      '京东': [{ title: '罗技 M330 静音无线鼠标', price: 129, url: 'https://item.jd.com/1234567.html' }]
    }
  });
  input(d.querySelector('#impText'), impJson);
  click(d.querySelector('#impNew'));
  ok(d.querySelectorAll('.pchip').length === chipsBefore + 2, 'JSON 里 2 条商品各建一个（' + chipsBefore + ' → ' + d.querySelectorAll('.pchip').length + '）');
  ok(d.querySelector('#prodName').value.includes('M330'), '切到导入的第一个商品');
  ok([...d.querySelectorAll('.lurl')].some(i => i.value.includes('12411611206')), '苏宁链接已写入');
  ok([...d.querySelectorAll('.price-chip')].some(c => c.textContent.includes('109')), '价格 109 已自动填入');
  ok(d.querySelector('#importModal').hidden, '导入成功后自动关闭弹窗');

  const curCardLinks = () => d.querySelectorAll('[data-card="suning"] .lrow').length;
  const linksBefore = curCardLinks();
  const djItem = { t: '罗技 M330 无线鼠标 第二家', p: '99.5', u: 'https://product.suning.com/0070977076/12448074920.html' };
  const djStr = 'DJ1.' + Buffer.from(JSON.stringify(djItem), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  click(d.querySelector('#btnImport'));
  input(d.querySelector('#impText'), djStr + '    # ¥99.50 罗技 M330 第二条');
  click(d.querySelector('#impCur'));
  ok(curCardLinks() === linksBefore + 1, '抓价码行（带注释）加到当前商品');
  ok([...d.querySelectorAll('.price-chip')].some(c => c.textContent.includes('99.5')), '抓到 99.5 写入价格标签');

  click(d.querySelector('#btnImport'));
  input(d.querySelector('#impText'), impJson);
  click(d.querySelector('#impNew'));
  ok(d.querySelector('#toast').textContent.includes('重复'), '重复链接自动跳过（' + d.querySelector('#toast').textContent + '）');

  click(d.querySelector('#btnImport'));
  input(d.querySelector('#impText'), '¥199 测试用普通行商品 https://item.jd.com/999888.html');
  click(d.querySelector('#impNew'));
  ok(d.querySelector('#prodName').value.includes('测试用普通行商品'), '普通文本行「¥价格 标题 链接」也能导入');

  console.log('\n— 攻略与运行时 —');
  ok(d.querySelectorAll('.gitem').length > 5, '攻略渲染正常');
  ok(d.querySelectorAll('.gtab').length === 8, '8 个平台 tab');
  ok(errors.length === 0, '无 JS 错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'));
  process.exit(fail === 0 ? 0 : 1);
}, 350);
