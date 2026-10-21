const fs=require('fs'),{JSDOM}=require('C:/Users/DELL/.workbuddy/binaries/node/workspace/node_modules/jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true,
 beforeParse(w){w.print=()=>{};w.confirm=()=>true;w.open=()=>null;w.HTMLElement.prototype.scrollIntoView=function(){};
  w.fetch=(url)=>{const u=String(url);return Promise.resolve({json:()=>Promise.resolve(u.indexOf('/health')>=0?{ok:true}:{keyword:'无线鼠标',results:{'苏宁易购':[{title:'罗技M330 无线鼠标',price:109,url:'https://product.suning.com/0000000000/12411611206.html'}]},statuses:{'苏宁易购':{status:'ok',count:1,note:'1 条商品'}}})});};}});
const w=dom.window,d=w.document;
['data.js','gh-sync.js','app.js'].forEach(f=>{const s=d.createElement('script');s.textContent=fs.readFileSync(f,'utf8');d.body.appendChild(s);});
if(d.readyState==='loading')d.dispatchEvent(new w.Event('DOMContentLoaded'));
setTimeout(async()=>{
  const input=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  console.log('初始 chips:', d.querySelectorAll('.pchip').length);
  input(d.querySelector('#prodName'),'无线鼠标');
  await new Promise(r=>setTimeout(r,120));
  click(d.querySelector('#btnAutoGrab'));
  await new Promise(r=>setTimeout(r,400));
  console.log('svcCalls:', w.__svcCalls||'无');
  console.log('chips:', d.querySelectorAll('.pchip').length);
  console.log('report hidden:', d.querySelector('#autoReport').hidden);
  console.log('report:', d.querySelector('#autoReport').textContent.replace(/\s+/g,' ').slice(0,300));
  console.log('toast:', d.querySelector('#toast').textContent);
  console.log('links:', [...d.querySelectorAll('.lurl')].map(i=>i.value).filter(Boolean).join(' | '));
  console.log('chips text:', [...d.querySelectorAll('.price-chip')].map(c=>c.textContent).join(' | '));
  process.exit(0);
},400);
