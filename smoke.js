/* 冒烟测试：用 jsdom 真实加载页面，验证计算引擎与渲染 */
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
  url: 'http://localhost/',
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  beforeParse(w) {
    w.addEventListener('error', e => errors.push(e.message));
    w.print = () => {};
    w.confirm = () => true;
  }
});

const w = dom.window, d = w.document;

// jsdom 不会自动加载外部脚本（无 resources loader），手动注入
['data.js', 'gh-sync.js', 'app.js'].forEach(f => {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(path.join(dir, f), 'utf8');
  d.body.appendChild(s);
});

// 手动触发 DOMContentLoaded 后的 boot（app.js 已判断 readyState）
if (d.readyState === 'loading') d.dispatchEvent(new w.Event('DOMContentLoaded'));

setTimeout(() => {
  console.log('\n— 渲染结果 —');
  const verdict = d.querySelector('#verdict').textContent.replace(/\s+/g, ' ').trim();
  console.log('  结论条：' + verdict.slice(0, 110));

  ok(/#T4|¥2,659/.test(verdict) || verdict.includes('2,659'), '最优到手价为淘宝 2,659.00');

  const rows = [...d.querySelectorAll('.rt-row')];
  ok(rows.length === 4, '排行表 4 个平台（实际 ' + rows.length + '）');

  const prices = rows.map(r => r.querySelector('.num.strong').textContent);
  console.log('  排行：' + prices.join(' < '));
  ok(prices[0] === '¥2,659.00', '第一名为 2,659.00，实际 ' + prices[0]);
  ok(prices[1] === '¥2,679.00', '第二名为 2,679.00，实际 ' + prices[1]);
  ok(prices[2] === '¥2,894.91', '第三名为拼多多 2,894.91，实际 ' + prices[2]);
  ok(prices[3] === '¥3,069.00', '第四名为抖音 3,069.00，实际 ' + prices[3]);

  const total = d.querySelector('.st.total .st-amt');
  ok(total && total.textContent === '¥2,659.00', '明细栈合计与排行一致');

  const stackLabels = [...d.querySelectorAll('.st .st-l')].map(x => x.textContent.trim());
  console.log('  明细：' + stackLabels.join(' / '));
  ok(stackLabels.some(t => t.includes('政府补贴')), '国补计入');
  ok(stackLabels.some(t => t.includes('店铺券')), '店铺券计入');
  ok(stackLabels.some(t => t.includes('跨店满减')), '跨店满减计入');
  ok(stackLabels.some(t => t.includes('淘金币')), '淘金币计入');
  ok(stackLabels.some(t => t.includes('一淘')), '一淘返利计入');
  ok(stackLabels.some(t => t.includes('实付')), '有实付行');

  const steps = d.querySelectorAll('.pstep');
  ok(steps.length >= 5, '操作路径 ≥5 步（实际 ' + steps.length + '）');
  console.log('  路径：' + [...steps].map(s => s.querySelector('.pstep-t').textContent).join(' → '));

  // 交互：切换排行行
  rows[3].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const forTxt = d.querySelector('#stackFor').textContent;
  ok(forTxt.includes('抖音'), '点击第 4 行可切换明细到抖音，实际：' + forTxt);

  // 交互：改价
  const input = d.querySelector('[data-off="pdd"][data-f="pagePrice"]');
  ok(!!input, '能定位到拼多多的页面价输入框');
  if (input) {
    input.value = '1999';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const v2 = d.querySelector('#verdict').textContent;
    ok(v2.includes('拼多多'), '改价后最优平台变为拼多多');
    console.log('  改价后结论：' + v2.replace(/\s+/g, ' ').trim().slice(0, 90));
  }

  // 交互：加券
  const before = d.querySelectorAll('[data-card="jd"] .crow').length;
  const addBtn = d.querySelector('[data-addcoupon="jd"]');
  addBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const after = d.querySelectorAll('[data-card="jd"] .crow').length;
  ok(after === before + 1, '加券按钮生效（' + before + ' → ' + after + '）');

  // 攻略
  const gitems = d.querySelectorAll('.gitem');
  ok(gitems.length > 5, '攻略渲染（淘宝 ' + gitems.length + ' 条）');
  const tabs = d.querySelectorAll('.gtab');
  ok(tabs.length === 8, '8 个平台 tab（实际 ' + tabs.length + '）');

  // 新增商品
  d.querySelector('#btnNewProd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(d.querySelectorAll('.pchip').length === 3, '新建商品后 chip 数为 3（含 + 按钮）');

  console.log('\n— 运行时错误 —');
  ok(errors.length === 0, '无 JS 错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'));
  process.exit(fail === 0 ? 0 : 1);
}, 300);
