/* ===================================================================
   全网到手价 · 计算引擎与界面
   模型：product → offers[平台] → links[商品链接，≤5]
   同一平台的多条链接各自算到手价，平台取最低那条参与排行。
   =================================================================== */
(function () {
  'use strict';

  var PLATS = window.PLATFORMS || [];
  var GUIDES = window.GUIDES || {};
  var PITFALLS = window.PITFALLS || [];
  var PMAP = {};
  PLATS.forEach(function (p) { PMAP[p.id] = p; });

  var K_PROD = 'p_';
  var MAX_LINKS = 5;
  var S = { cur: '', sel: '', tab: 'taobao', open: {}, active: -1, findItems: [] };

  /* ---------------- 小工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = parseFloat(String(v).replace(/[,\s¥]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function trimNum(n) { return String(Math.round(n * 100) / 100); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uid(pre) { return (pre || 'id') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

  /* ---------------- 链接识别 ---------------- */
  var HOSTMAP = [
    ['taobao', /(taobao\.com|tmall\.com|tb\.cn|taobao\.cn)/i],
    ['jd', /(jd\.com|jd\.hk|jingxi\.com)/i],
    ['pdd', /(pinduoduo\.com|yangkeduo\.com)/i],
    ['douyin', /(douyin\.com|jinritemai\.com|douyinec\.com)/i],
    ['vip', /vip\.com/i],
    ['suning', /suning\.com/i],
    ['xhs', /(xiaohongshu\.com|xhslink\.com)/i],
    ['alibaba', /1688\.com/i]
  ];
  function isUrl(s) {
    s = String(s || '').trim();
    if (!s) return false;
    if (/^https?:\/\//i.test(s)) return true;
    if (/\s/.test(s)) return false;
    if (/^[a-z0-9.-]+\.(com|cn|net|hk|cc)(\/|$)/i.test(s)) return true;
    return HOSTMAP.some(function (h) { return h[1].test(s); });
  }
  function detectPlatform(url) {
    var s = String(url || '');
    for (var i = 0; i < HOSTMAP.length; i++) if (HOSTMAP[i][1].test(s)) return HOSTMAP[i][0];
    return '';
  }
  function hostOf(url) {
    var s = String(url || '').trim();
    if (!s || !isUrl(s)) return '';
    var m = s.match(/^https?:\/\/([^/?#]+)/i) || s.match(/^([^/?#]+)/);
    return m ? m[1].replace(/^www\./, '') : '';
  }
  function goodsId(url) {
    var s = String(url || '');
    var m = s.match(/[?&](?:id|goods_id|product_id|item_id)=(\d{5,})/i)
      || s.match(/item\.jd\.com\/(\d{5,})/i)
      || s.match(/offer\/(\d{5,})/i)
      || s.match(/(\d{6,})/);
    return m ? m[1] : '';
  }

  /* ---------------- 存储 ---------------- */
  var Store = (function () {
    var G = window.GhSync, LS = 'qgdj_data_v1';
    function raw() {
      try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; }
    }
    return {
      all: function () { return G ? (G.data() || {}) : raw(); },
      set: function (id, obj) {
        if (G) { G.set(id, obj); }
        else { var d = raw(); obj.t = Date.now(); d[id] = obj; localStorage.setItem(LS, JSON.stringify(d)); }
      },
      remove: function (id) {
        if (G) { G.remove(id); }
        else { var d = raw(); delete d[id]; localStorage.setItem(LS, JSON.stringify(d)); }
      }
    };
  })();

  /* ---------------- 数据模型 ---------------- */
  function blankLink() { return { url: '', price: '', memberPrice: '' }; }

  function blankOffer(pid) {
    var P = PMAP[pid] || {};
    return {
      pid: pid, on: false,
      links: [blankLink()],
      memberCost: '', subsidyRate: '', subsidyCap: '',
      coupons: [],
      redpacket: '', redpacketMin: '', liveRedpacket: '',
      coins: '', coinsCapPct: P.coins ? String(P.coins.capPct) : '',
      rebateChannel: '', rebateRate: '', rebateCap: '',
      payDiscount: '', freight: '', note: ''
    };
  }
  function blankProduct(name, spec) {
    return {
      id: uid(K_PROD), name: name || '新商品', spec: spec || '', note: '',
      createdAt: Date.now(),
      offers: PLATS.map(function (p) {
        var o = blankOffer(p.id);
        o.on = ['taobao', 'jd', 'pdd', 'douyin'].indexOf(p.id) >= 0;
        return o;
      })
    };
  }
  function newCoupon(P) {
    return { kind: (P.couponKinds && P.couponKinds[0]) || '店铺券', threshold: '', amount: '', mode: 'flat' };
  }

  /* 兼容旧数据：把 pagePrice / memberPrice 迁成 links[0] */
  function migrate(p) {
    var changed = false;
    (p.offers || []).forEach(function (o) {
      if (!o.links) {
        o.links = [{ url: '', price: o.pagePrice || '', memberPrice: o.memberPrice || '' }];
        delete o.pagePrice; delete o.memberPrice;
        changed = true;
      }
      if (!o.links.length) { o.links = [blankLink()]; changed = true; }
    });
    return changed;
  }

  function sampleProduct() {
    var p = blankProduct('戴森 V12 Detect Slim 无线吸尘器', '国行 · SV46 · 含 5 个吸头');
    p.note = '示例数据，仅供看清各字段怎么填，请替换成你真实的商品与链接。';
    function off(pid, patch) {
      var o = p.offers.filter(function (x) { return x.pid === pid; })[0];
      o.on = true;
      Object.keys(patch).forEach(function (k) { o[k] = patch[k]; });
      return o;
    }
    off('taobao', {
      links: [
        { url: 'https://item.taobao.com/item.htm?id=678901234567', price: '3699', memberPrice: '' },
        { url: 'https://detail.tmall.com/item.htm?id=678901234999', price: '3899', memberPrice: '' }
      ],
      subsidyRate: '15', subsidyCap: '500',
      coupons: [
        { kind: '店铺券', threshold: '3000', amount: '200', mode: 'flat' },
        { kind: '跨店满减', threshold: '3000', amount: '200', mode: 'flat' }
      ],
      redpacket: '30', coins: '3000', coinsCapPct: '5',
      rebateChannel: '一淘', rebateRate: '3', rebateCap: '60',
      payDiscount: '20', freight: '0'
    });
    off('jd', {
      links: [{ url: 'https://item.jd.com/100081234567.html', price: '3799', memberPrice: '3699' }],
      subsidyRate: '15', subsidyCap: '500',
      coupons: [
        { kind: '品类券', threshold: '3000', amount: '300', mode: 'flat' },
        { kind: '店铺券', threshold: '2000', amount: '100', mode: 'flat' }
      ],
      redpacket: '20', coins: '2000', coinsCapPct: '3',
      rebateChannel: '京东联盟', rebateRate: '2', rebateCap: '50',
      payDiscount: '30', freight: '0'
    });
    off('pdd', {
      links: [{ url: 'https://mobile.yangkeduo.com/goods.html?goods_id=456789012345', price: '2999', memberPrice: '2999' }],
      memberCost: '5.9',
      coupons: [{ kind: '店铺券', threshold: '2000', amount: '60', mode: 'flat' }],
      rebateChannel: '多多进宝', rebateRate: '1.5', payDiscount: '0', freight: '0'
    });
    off('douyin', {
      links: [{ url: 'https://haohuo.jinritemai.com/views/product/detail?id=3612345678901234567', price: '3799', memberPrice: '3299' }],
      coupons: [{ kind: '直播间券', threshold: '3000', amount: '150', mode: 'flat' }],
      liveRedpacket: '60', payDiscount: '20', freight: '0'
    });
    return p;
  }

  function products() {
    var d = Store.all(), out = [];
    Object.keys(d).forEach(function (k) {
      if (k.indexOf(K_PROD) === 0 && d[k] && d[k].offers) {
        if (migrate(d[k])) Store.set(k, d[k]);
        out.push(d[k]);
      }
    });
    out.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    return out;
  }
  function curProduct() {
    var list = products();
    if (!list.length) return null;
    var p = list.filter(function (x) { return x.id === S.cur; })[0];
    if (!p) { p = list[0]; S.cur = p.id; }
    return p;
  }
  function saveProduct(p) { Store.set(p.id, p); }

  /* ===================================================================
     计算引擎（按链接算）
     =================================================================== */
  function priceBase(l) {
    l = l || {};
    var page = num(l.price), mem = num(l.memberPrice);
    var base = 0, src = 'page';
    if (page > 0 && mem > 0) { base = Math.min(page, mem); src = mem < page ? 'member' : 'page'; }
    else if (page > 0) { base = page; src = 'page'; }
    else if (mem > 0) { base = mem; src = 'member'; }
    return { base: base, src: src, page: page, mem: mem, ref: page > 0 ? page : base };
  }

  function couponAmt(c, base) {
    var th = num(c.threshold), amt = num(c.amount);
    if (amt <= 0) return 0;
    if (th > 0 && base < th) return 0;
    if (c.mode === 'per' && th > 0) return Math.floor(base / th) * amt;
    return amt;
  }
  function couponDesc(c, base) {
    var th = num(c.threshold), amt = num(c.amount);
    if (th <= 0) return '无门槛减 ' + trimNum(amt);
    if (c.mode === 'per') return '每满 ' + trimNum(th) + ' 减 ' + trimNum(amt) + '（本次 ' + Math.floor(base / th) + ' 档）';
    return '满 ' + trimNum(th) + ' 减 ' + trimNum(amt);
  }

  function calc(o, l) {
    var b = priceBase(l);
    if (!(b.base > 0)) return null;
    var P = PMAP[o.pid] || {}, base = b.base;
    var list = [], cuts = 0, adds = 0, cost = 0, sub = 0;

    cost = num(o.memberCost);
    if (cost > 0) { list.push({ k: 'cost', label: '会员 / 卡费摊销', sub: '摊到本单', amt: cost, dir: 1 }); adds += cost; }

    var sr = num(o.subsidyRate);
    if (sr > 0) {
      var cap = num(o.subsidyCap);
      sub = r2(base * sr / 100);
      if (cap > 0) sub = Math.min(sub, cap);
      sub = r2(Math.min(sub, base));
      if (sub > 0) {
        list.push({
          k: 'subsidy', label: '政府补贴 / 以旧换新',
          sub: trimNum(sr) + '%' + (cap > 0 ? ' · 上限 ' + trimNum(cap) : ''),
          amt: sub, dir: -1
        });
        cuts += sub;
      }
    }

    var best = {};
    (o.coupons || []).forEach(function (c) {
      var amt = couponAmt(c, base);
      if (amt <= 0) return;
      var k = c.kind || '店铺券';
      if (!best[k] || amt > best[k].amt) best[k] = { amt: amt, c: c };
    });
    Object.keys(best).forEach(function (k) {
      var x = best[k];
      list.push({ k: 'coupon', ck: k, label: k, sub: couponDesc(x.c, base), amt: x.amt, dir: -1 });
      cuts += x.amt;
    });

    var rp = num(o.redpacket), rpMin = num(o.redpacketMin);
    if (rp > 0 && base >= rpMin) {
      list.push({ k: 'redpacket', label: '平台红包', sub: rpMin > 0 ? '满 ' + trimNum(rpMin) + ' 可用' : '无门槛', amt: rp, dir: -1 });
      cuts += rp;
    }

    var lr = num(o.liveRedpacket);
    if (lr > 0) { list.push({ k: 'live', label: '直播间红包 / 福袋', sub: '须直播间领取', amt: lr, dir: -1 }); cuts += lr; }

    var coins = num(o.coins);
    if (coins > 0 && P.coins) {
      var val = coins / P.coins.unit;
      var pct = num(o.coinsCapPct) || P.coins.capPct;
      var maxUse = base * pct / 100;
      var use = r2(Math.min(val, maxUse));
      if (use > 0) {
        list.push({
          k: 'coins', label: P.coins.label + '抵扣',
          sub: coins + ' 个 ≈ ' + fmt(val) + (val > maxUse ? ' · 已达 ' + trimNum(pct) + '% 上限' : ''),
          amt: use, dir: -1
        });
        cuts += use;
      }
    }

    var pd = num(o.payDiscount);
    if (pd > 0) { list.push({ k: 'pay', label: '支付立减', sub: P.pay || '', amt: pd, dir: -1 }); cuts += pd; }

    var paid = r2(Math.max(0, base - cuts));
    var freight = num(o.freight);
    if (freight > 0) { list.push({ k: 'freight', label: '运费', sub: '需另付', amt: freight, dir: 1 }); adds += freight; }

    var rate = num(o.rebateRate), rb = 0, ch = o.rebateChannel || '';
    if (rate > 0 && ch && ch !== '无') {
      rb = r2(paid * rate / 100);
      var rcap = num(o.rebateCap);
      if (rcap > 0) rb = r2(Math.min(rb, rcap));
      if (rb > 0) {
        list.push({
          k: 'rebate', label: ch + ' 返利',
          sub: trimNum(rate) + '% · 收货后返还' + (rcap > 0 && paid * rate / 100 > rcap ? '（已封顶）' : ''),
          amt: rb, dir: -1
        });
      }
    }

    var paidTotal = r2(paid + freight);
    var final = r2(Math.max(0, paidTotal - rb));

    return {
      ok: true, base: base, baseSrc: b.src, ref: b.ref, page: b.page,
      list: list, cuts: cuts, adds: adds, cost: cost, sub: sub,
      paid: paid, paidTotal: paidTotal, rebate: rb, freight: freight,
      final: final, save: Math.max(0, b.ref - final), pct: b.ref > 0 ? final / b.ref : 1,
      count: list.filter(function (x) { return x.dir < 0; }).length
    };
  }

  function offerBest(o) {
    var links = o.links || [], best = null;
    links.forEach(function (l, i) {
      var r = calc(o, l);
      if (r && (!best || r.final < best.r.final)) best = { l: l, r: r, i: i };
    });
    return best;
  }

  function computeAll(p) {
    var rows = [];
    (p.offers || []).forEach(function (o) {
      if (!o.on) return;
      var best = offerBest(o);
      if (best) {
        rows.push({
          o: o, l: best.l, r: best.r, li: best.i,
          P: PMAP[o.pid] || { name: o.pid, short: o.pid, brand: '#999' }
        });
      }
    });
    rows.sort(function (a, b) { return a.r.final - b.r.final; });
    return rows;
  }

  /* ===================================================================
     模糊搜索
     =================================================================== */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s\u3000\-_·、，。,.!?()（）\[\]【】/\\|:：;；"'“”‘’]+/g, '');
  }
  /* 子序列模糊匹配：字符按顺序出现即算命中，连续与靠前命中得分更高 */
  function fuzzyScore(q, t) {
    if (!q || !t) return -1;
    var idx = t.indexOf(q);
    if (idx >= 0) return 10 + (idx === 0 ? 4 : 0) + q.length * 1.5 - (t.length - q.length) * 0.02;
    var i = 0, j = 0, score = 0, run = 0, first = -1;
    while (i < t.length && j < q.length) {
      if (t.charAt(i) === q.charAt(j)) {
        if (first < 0) first = i;
        run++; score += 1 + run * 0.8;
        j++;
      } else { run = 0; }
      i++;
    }
    if (j < q.length) return -1;
    score -= (first < 0 ? 0 : first * 0.05);
    score -= (t.length - q.length) * 0.01;
    return Math.max(1, score);
  }

  function linkUrls(p) {
    var arr = [];
    (p.offers || []).forEach(function (o) {
      (o.links || []).forEach(function (l) { if (l.url) arr.push(l.url); });
    });
    return arr.join(' ');
  }
  function countLinks(p) {
    var n = 0;
    (p.offers || []).forEach(function (o) {
      n += (o.links || []).filter(function (l) { return l.url || num(l.price) > 0; }).length;
    });
    return n;
  }

  function searchProducts(q) {
    var terms = String(q || '').trim().split(/\s+/).map(norm).filter(Boolean);
    if (!terms.length) return [];
    var out = [];
    products().forEach(function (p) {
      var F = {
        '名称': norm(p.name),
        '规格': norm(p.spec),
        '备注': norm(p.note),
        '链接': norm(linkUrls(p))
      };
      var total = 0, hits = {}, okAll = true;
      for (var t = 0; t < terms.length; t++) {
        var bestS = -1, bestK = '';
        Object.keys(F).forEach(function (k) {
          var s = fuzzyScore(terms[t], F[k]);
          if (s > bestS) { bestS = s; bestK = k; }
        });
        if (bestS < 0) { okAll = false; break; }
        total += bestS;
        hits[bestK] = 1;
      }
      if (!okAll) return;
      var n = Object.keys(hits).length;
      total = total * (1 + 0.18 * (n - 1));   /* 命中字段越多，排得越前 */
      if (F['名称'].indexOf(terms[0]) >= 0) total += 6;
      out.push({ p: p, score: total, hits: Object.keys(hits) });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 8);
  }

  /* ===================================================================
     「怎么拿」文案
     =================================================================== */
  var HOW = {
    taobao: {
      member: '淘宝 App → 我的 → 88VIP 开通（88 元/年）；只有带「88VIP」角标的商品才 95 折',
      subsidy: '淘宝搜「国家补贴」进专区，实名后下单直接抵扣；家电数码 15%~20%，有单件上限',
      coupon: {
        '店铺券': '商品页价格下方「领券」；店铺首页关注 / 入会还能再领一张',
        '跨店满减': '大促期自动生效，商品页点「去凑单」凑到门槛即可，不用领券',
        '品类券': '领券中心 / 品类会场领取，可与店铺券叠加',
        '直播间券': '进淘宝直播或点淘的主播间，点屏幕下方「领取」，只在开播时段有效'
      },
      redpacket: '淘宝 App 搜「超级红包」，大促期每天领，结算时自动抵扣',
      live: '进对应主播直播间，点右下角红包领取，领完当场下单（过期快）',
      coins: '我的 → 淘金币，签到做任务攒；提交订单页<b>手动勾选</b>「淘金币抵扣」',
      rebate: {
        '一淘': '装「一淘」App → 淘宝账号登录 → <b>在一淘里</b>搜同款 / 粘链接 → 从一淘进商品页下单，确认收货返集分宝',
        '淘宝联盟': '阿里妈妈注册推广者 → 联盟后台转链 → 用自己的推广链接下单，收货后结佣金'
      },
      pay: '结算页换指定银行卡 / 云闪付，立减金额只在支付页显示'
    },
    jd: {
      member: '京东 App → 我的 → PLUS 会员开通；PLUS 价直接生效，另有每月运费券',
      subsidy: '商品页「以旧换新」或「国家补贴」专区，选旧机估价后补贴直接抵价',
      coupon: {
        '店铺券': '商品页「领券」或店铺首页关注领券',
        '满减（每满）': '大促期自动生效，商品页点「凑单」凑到门槛',
        '品类券': '京东 App → 领券中心，或商品页「领券」',
        'PLUS 专享券': 'PLUS 会员页领专属券包，每月刷新'
      },
      redpacket: '京东 App 签到 / 开宝箱 / PLUS 会员日领取，结算自动抵扣',
      live: '京东直播进入主播间领取，部分券仅直播间下单可用',
      coins: '我的 → 京豆（签到 / 评价 / 购物返）；提交订单页勾选「使用京豆」',
      rebate: { '京东联盟': 'union.jd.com 注册推广者 → 转链 → 通过自己的推广链接下单拿佣金' },
      pay: '结算页选白条 / 京东支付，注意首绑立减与分期手续费'
    },
    pdd: {
      member: '链接带「百亿补贴」黑标即是补贴后价，从百亿补贴频道进更便宜',
      subsidy: '搜「政府补贴」进专区，家电数码 15%~20%（常与百亿补贴二选一）',
      coupon: {
        '店铺券': '商品页「领券」，店铺关注再领一张',
        '平台券': '大促会场 / 限时秒杀页领平台券',
        '品类券': '品类专区页领取',
        '限时券': '整点刷新的限时券，领完立刻用'
      },
      redpacket: '拼单红包 / 多多果园领取，结算抵扣',
      live: '多多直播进入主播间领券',
      coins: '',
      rebate: { '多多进宝': 'jinbao.pinduoduo.com 注册推广者 → 转链 → 自己下单拿佣金' },
      pay: '结算页选微信 / 多多支付，看首绑或随机立减'
    },
    douyin: {
      member: '进品牌直播间，从小黄车点同款——直播专享价常低于商城页',
      subsidy: '抖音搜「国家补贴」专区，家电数码可用',
      coupon: {
        '店铺券': '商品页「领券」或品牌自播间口令券',
        '商城券': '抖音商城 → 领券中心领取',
        '品类券': '品类活动页领取',
        '直播间券': '直播间购物袋内的商品券，只在直播时段可用'
      },
      redpacket: '抖音商城红包页 / 支付页红包，结算自动抵扣',
      live: '直播间右下角红包、福袋，领取后当场下单',
      coins: '',
      rebate: { '精选联盟': 'buyin.jinritemai.com 注册达人 → 转链 → 自己下单拿佣金' },
      pay: '结算页选抖音支付 / DOU 分期，看首绑立减'
    },
    vip: {
      member: '唯品会 App → 我的 → 超级 VIP 开通（部分品牌 95 折 + 免运费）',
      subsidy: '',
      coupon: { '店铺券': '商品页「领券」', '满减（每满）': '品牌专场页自动满减', '品类券': '领券中心领取', '品牌券': '品牌页关注领取' },
      redpacket: 'App 签到领红包', live: '', coins: '',
      rebate: { '唯享客': '唯享客平台注册推广者后转链下单' },
      pay: '结算页选唯品花，偶有限时立减'
    },
    suning: {
      member: '苏宁易购 App → 我的 → SUPER 会员开通（2% 返利 + 免运费券）',
      subsidy: '商品页「以旧换新」+「国家补贴」专区，家电最强',
      coupon: { '店铺券': '商品页领券', '满减（每满）': '大促自动生效', '品类券': '领券中心', '会员券': 'SUPER 会员页领取' },
      redpacket: 'App 签到领券包', live: '', coins: '',
      rebate: { '苏宁推客': '苏宁推客注册后转链下单' },
      pay: '结算页选苏宁支付 / 银行卡立减'
    },
    xhs: {
      member: '部分商品有会员立减，商品页有会员标才生效',
      subsidy: '',
      coupon: { '店铺券': '店铺关注领券', '平台券': '商城首页领券中心', '品类券': '活动页领取', '直播间券': '买手直播间购物袋内领取' },
      redpacket: '商城红包页领取', live: '买手直播间的限时券与专属价', coins: '',
      rebate: {}, pay: '结算页选小红卡，偶有立减'
    },
    alibaba: {
      member: '按起订量选档位，或选「一件代发」只买 1 件',
      subsidy: '',
      coupon: { '店铺券': '商品页「领券」', '满减（每满）': '店铺满减自动生效', '品类券': '品类页领取', '批发券': '拿样 / 批发券在商品页领' },
      redpacket: '', live: '', coins: '',
      rebate: {}, pay: '结算页选诚 e 赊 / 支付宝立减'
    }
  };

  function howOf(pid, k, ck, ch) {
    var H = HOW[pid] || {};
    if (k === 'coupon') return (H.coupon && H.coupon[ck]) || '在商品页「领券」处领取，注意门槛按折前活动价判定';
    if (k === 'rebate') return (H.rebate && H.rebate[ch]) || '先在该返利平台搜到同款，再从返利入口进商品页下单';
    return H[k] || '按平台页面提示领取 / 勾选';
  }

  function linkLabel(row) {
    var n = (row.o.links || []).length;
    var host = hostOf(row.l.url);
    if (n <= 1) return host || '单条链接';
    return '第 ' + (row.li + 1) + ' 条链接' + (host ? '（' + host + '）' : '');
  }

  /* ===================================================================
     渲染
     =================================================================== */
  function renderVerdict(p, rows) {
    var box = $('#verdict');
    if (!rows.length) {
      box.className = 'verdict empty';
      var cnt = p ? (p.offers || []).filter(function (o) { return o.on && offerBest(o); }).length : 0;
      box.innerHTML =
        '<div class="vd-in"><div>' +
        '<div class="vd-label"><span class="tag">待录入</span><span>把平台上的链接和价格填进左侧，结果立刻出来</span></div>' +
        '<div class="vd-main"><span class="vd-price">还没算</span></div>' +
        '<div class="vd-sub">已填 <b>' + cnt + '</b> 个平台的有效价格。会员价、券、红包、金币、返利都能叠着算。</div>' +
        '</div></div>';
      return;
    }
    box.className = 'verdict';
    var best = rows[0], second = rows[1], worst = rows[rows.length - 1];
    box.innerHTML =
      '<div class="vd-in"><div>' +
        '<div class="vd-label"><span class="tag">最低到手价</span><span>已扣返利，未计分期免息与赠品</span></div>' +
        '<div class="vd-main">' +
          '<span class="vd-plat"><span class="bd" style="background:' + best.P.brand + '"></span>' + esc(best.P.name) + '</span>' +
          '<span class="vd-price"><span class="cur">¥</span>' + best.r.final.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>' +
        '</div>' +
        '<div class="vd-sub">' + esc(linkLabel(best)) + ' · 页面价 ' + fmt(best.r.ref) + ' → 省 <em>' + fmt(best.r.save) + '</em>（' +
          trimNum((1 - best.r.pct) * 100) + '%）· 共 ' + best.r.count + ' 项优惠在生效' +
          (best.r.cost > 0 ? ' · 已摊卡费 ' + fmt(best.r.cost) : '') +
        '</div>' +
      '</div>' +
      '<div class="vd-stats">' +
        '<div class="vd-stat"><div class="k">' + (second ? '比次优便宜' : '暂无对比') + '</div><div class="v">' + (second ? fmt(second.r.final - best.r.final) : '—') + '</div></div>' +
        '<div class="vd-stat"><div class="k">最贵平台</div><div class="v sm">' + esc(worst.P.short || worst.P.name) + ' ' + fmt(worst.r.final) + '</div></div>' +
        '<div class="vd-stat"><div class="k">全平台价差</div><div class="v">' + fmt(worst.r.final - best.r.final) + '</div></div>' +
      '</div></div>';
  }

  function renderRank(p, rows) {
    var box = $('#rank');
    if (!rows.length) {
      box.innerHTML = '<div class="empty-state">还没有可比的平台。<br>左侧任意一条链接填上价格就会被算进来。</div>';
      return;
    }
    if (!S.sel || !rows.filter(function (x) { return x.o.pid === S.sel; }).length) S.sel = rows[0].o.pid;
    var h = '<div class="rt-head"><span>#</span><span>平台 / 链接</span><span>到手价</span><span>已省</span><span>页面价</span><span>折扣</span></div>';
    rows.forEach(function (x, i) {
      var on = x.o.pid === S.sel;
      var nlink = (x.o.links || []).filter(function (l) { return num(l.price) + num(l.memberPrice) > 0; }).length;
      var extra = nlink > 1 ? nlink + ' 条链接 · 取最低' : (hostOf(x.l.url) || x.r.count + ' 项优惠');
      h += '<div class="rt-row' + (i === 0 ? ' best' : '') + (on ? ' on' : '') + '" data-sel="' + x.o.pid + '">' +
        '<span class="prank' + (i === 0 ? ' top1' : '') + '">' + (i + 1) + '</span>' +
        '<span class="rt-name"><span class="bd" style="background:' + x.P.brand + '"></span>' + esc(x.P.name) +
          (i === 0 ? '<span class="badge">最低</span>' : '') +
          '<small>' + esc(extra) + '</small>' +
        '</span>' +
        '<span class="num strong">' + fmt(x.r.final) + '</span>' +
        '<span class="num save">-' + trimNum(x.r.save) + '</span>' +
        '<span class="num dim">' + fmt(x.r.ref) + '</span>' +
        '<span class="pct">' + trimNum(x.r.pct * 100) + '%</span>' +
      '</div>';
    });
    box.innerHTML = h;
  }

  function renderDetail(p, rows) {
    var box = $('#stack'), pbox = $('#path');
    var cur = rows.filter(function (x) { return x.o.pid === S.sel; })[0] || rows[0];
    if (!cur) {
      box.innerHTML = '<div class="empty-state">填价格后这里显示每一项优惠怎么减的。</div>';
      pbox.innerHTML = '<div class="empty-state">按这里的顺序操作，才能真的拿到上面那个价。</div>';
      $('#stackFor').textContent = '';
      return;
    }
    $('#stackFor').textContent = cur.P.name + ' · ' + linkLabel(cur) + ' · 页面价 ' + fmt(cur.r.ref);

    var h = '<div class="st base"><div class="st-l">' + (cur.r.baseSrc === 'member' ? esc(cur.P.member || '会员价') : '活动价') +
      ' <span class="src">' + (cur.r.baseSrc === 'member' ? '覆盖页面价' : '页面价') + '</span></div>' +
      '<div class="st-amt">' + fmt(cur.r.base) + '</div></div>';

    var rebateRow = null;
    cur.r.list.forEach(function (it) {
      if (it.k === 'rebate') { rebateRow = it; return; }
      if (it.k === 'freight') return;
      h += '<div class="st"><div class="st-l">' + esc(it.label) +
        (it.sub ? ' <span class="src">' + esc(it.sub) + '</span>' : '') + '</div>' +
        '<div class="st-amt' + (it.dir > 0 ? ' plus' : '') + '">' + (it.dir > 0 ? '+' : '-') + fmt(it.amt) + '</div></div>';
    });

    h += '<div class="st"><div class="st-l">实付' + (cur.r.freight > 0 ? '（含运费 ' + trimNum(cur.r.freight) + '）' : '') + '</div>' +
      '<div class="st-amt' + (cur.r.freight > 0 ? ' plus' : '') + '">' + fmt(cur.r.paidTotal) + '</div></div>';

    if (rebateRow) {
      h += '<div class="st"><div class="st-l">' + esc(rebateRow.label) +
        (rebateRow.sub ? ' <span class="src">' + esc(rebateRow.sub) + '</span>' : '') + '</div>' +
        '<div class="st-amt">-' + fmt(rebateRow.amt) + '</div></div>';
    }
    h += '<div class="st total"><div class="st-l">到手价</div><div class="st-amt">' + fmt(cur.r.final) + '</div></div>';
    box.innerHTML = h;

    var steps = [];
    if (cur.r.baseSrc === 'member') {
      steps.push({ t: '先拿会员价 / 补贴价', d: howOf(cur.o.pid, 'member') + '。本案用 <b>' + esc(cur.P.member) + ' ' + fmt(cur.r.base) + '</b> 下单。' });
    }
    if (cur.r.sub > 0) steps.push({ t: '确认国补 / 以旧换新资格', d: howOf(cur.o.pid, 'subsidy') + '。可减 <b>' + fmt(cur.r.sub) + '</b>。' });
    var cps = cur.r.list.filter(function (i) { return i.k === 'coupon'; });
    if (cps.length) {
      var d = cps.map(function (c) {
        return '<b>' + esc(c.label) + '</b>（' + esc(c.sub) + '，-' + trimNum(c.amt) + '）：' + howOf(cur.o.pid, 'coupon', c.ck);
      }).join('<br>');
      steps.push({ t: '领齐 ' + cps.length + ' 张券', d: d });
    }
    if (cur.r.list.filter(function (i) { return i.k === 'redpacket'; }).length) {
      steps.push({ t: '领平台红包', d: howOf(cur.o.pid, 'redpacket') + '。可减 <b>' + fmt(num(cur.o.redpacket)) + '</b>。' });
    }
    if (cur.r.list.filter(function (i) { return i.k === 'live'; }).length) {
      steps.push({ t: '进直播间领红包再下单', d: howOf(cur.o.pid, 'live') + '。可减 <b>' + fmt(num(cur.o.liveRedpacket)) + '</b>。' });
    }
    if (cur.r.list.filter(function (i) { return i.k === 'coins'; }).length) {
      steps.push({ t: '结算页勾选金币 / 京豆抵扣', d: howOf(cur.o.pid, 'coins') });
    }
    var rb = cur.r.list.filter(function (i) { return i.k === 'rebate'; })[0];
    if (rb) {
      steps.push({ t: '从返利入口进（顺序别反）', d: howOf(cur.o.pid, 'rebate', null, cur.o.rebateChannel) + '。返 <b>' + fmt(rb.amt) + '</b>。先加购再跳返利容易丢单。' });
    }
    if (num(cur.o.payDiscount) > 0) {
      steps.push({ t: '换对支付方式', d: howOf(cur.o.pid, 'pay') + '。本案立减 <b>' + fmt(num(cur.o.payDiscount)) + '</b>。' });
    }
    steps.push({ t: '收货后核对返利 + 申请价保', d: '返利在确认收货后结算（集分宝 / 佣金）；京东 7~30 天、淘宝部分商品支持价保，降价了去申请退差。' });

    pbox.innerHTML = steps.map(function (s) {
      return '<div class="pstep"><div><div class="pstep-t">' + s.t + '</div><div class="pstep-d">' + s.d + '</div></div></div>';
    }).join('');
  }

  /* ---------------- 录入区 ---------------- */
  function fld(label, key, o, ph, unit) {
    return '<div class="f"><label>' + esc(label) + (unit ? ' <span class="u">' + unit + '</span>' : '') + '</label>' +
      '<input inputmode="decimal" autocomplete="off" data-off="' + o.pid + '" data-f="' + key + '" value="' + esc(o[key]) + '" placeholder="' + esc(ph || '') + '"></div>';
  }

  function linksBlock(o) {
    var links = (o.links && o.links.length) ? o.links : [blankLink()];
    var bestIdx = -1, bestV = Infinity, filled = 0;
    links.forEach(function (l, i) {
      var r = calc(o, l);
      if (r) { filled++; if (r.final < bestV) { bestV = r.final; bestIdx = i; } }
    });

    var h = '<div class="grp"><div class="grp-t">商品链接<span class="gt-note">最多 ' + MAX_LINKS + ' 条 · 平台取最低</span></div>';
    h += '<div class="lhead"><span>链接 / 商品 ID</span><span>页面价</span><span>会员价</span><span></span></div>';
    links.forEach(function (l, i) {
      var r = calc(o, l);
      var host = hostOf(l.url);
      var det = detectPlatform(l.url);
      var warn = (det && det !== o.pid) ? '<span class="lwarn">识别为 ' + esc((PMAP[det] || {}).name || det) + '</span>' : '';
      h += '<div class="lrow">' +
        '<input class="lurl" data-off="' + o.pid + '" data-l="' + i + '" data-f="url" value="' + esc(l.url) + '" placeholder="粘贴链接，或填商品 ID" autocomplete="off" spellcheck="false">' +
        '<input inputmode="decimal" autocomplete="off" data-off="' + o.pid + '" data-l="' + i + '" data-f="price" value="' + esc(l.price) + '" placeholder="¥">' +
        '<input inputmode="decimal" autocomplete="off" data-off="' + o.pid + '" data-l="' + i + '" data-f="memberPrice" value="' + esc(l.memberPrice) + '" placeholder="选填">' +
        (links.length > 1 ? '<button class="del" data-dellink="' + i + '" data-off="' + o.pid + '" title="删除这条链接">×</button>' : '<span></span>') +
      '</div>';
      h += '<div class="lmeta">' +
        (host ? '<button class="lopen" data-openurl="' + esc(l.url) + '">' + esc(host) + ' ↗</button>' : '<span class="lhost">未填链接</span>') +
        warn +
        '<span class="lprice' + (r ? (i === bestIdx && links.length > 1 && filled > 1 ? ' best' : '') : ' none') + '">' +
          (r ? '到手 ' + fmt(r.final) + (i === bestIdx && links.length > 1 && filled > 1 ? ' · 最低' : '') : '未填价格') +
        '</span></div>';
    });
    if (links.length < MAX_LINKS) {
      h += '<button class="add-row" data-addlink="' + o.pid + '">+ 添加链接（还可加 ' + (MAX_LINKS - links.length) + ' 条）</button>';
    } else {
      h += '<div class="lcap">已达 ' + MAX_LINKS + ' 条上限</div>';
    }
    h += '</div>';
    return h;
  }

  function cardBody(o) {
    var P = PMAP[o.pid] || {}, h = '';

    h += linksBlock(o);

    h += '<div class="grp"><div class="grp-t">补贴与会员成本</div><div class="fgrid">' +
      (P.subsidy ? fld('国补 / 以旧换新', 'subsidyRate', o, '如 15', '%') + fld('国补上限', 'subsidyCap', o, '如 500', '¥') : '') +
      fld(P.costLabel || '会员成本', 'memberCost', o, '摊到本单', '¥') +
      '</div></div>';

    h += '<div class="grp"><div class="grp-t">优惠券<span class="gt-note">同类只算最优一张</span></div>';
    if ((o.coupons || []).length) {
      h += '<div class="chead"><span>类型</span><span>门槛</span><span>面额</span><span>计法</span><span></span></div>';
      o.coupons.forEach(function (c, i) {
        h += '<div class="crow">' +
          '<select data-off="' + o.pid + '" data-c="' + i + '" data-f="kind">' +
          (P.couponKinds || ['店铺券']).map(function (k) {
            return '<option' + (k === c.kind ? ' selected' : '') + '>' + esc(k) + '</option>';
          }).join('') + '</select>' +
          '<input inputmode="decimal" autocomplete="off" data-off="' + o.pid + '" data-c="' + i + '" data-f="threshold" value="' + esc(c.threshold) + '" placeholder="门槛">' +
          '<input inputmode="decimal" autocomplete="off" data-off="' + o.pid + '" data-c="' + i + '" data-f="amount" value="' + esc(c.amount) + '" placeholder="减">' +
          '<select data-off="' + o.pid + '" data-c="' + i + '" data-f="mode">' +
            '<option value="flat"' + (c.mode !== 'per' ? ' selected' : '') + '>满减</option>' +
            '<option value="per"' + (c.mode === 'per' ? ' selected' : '') + '>每满</option>' +
          '</select>' +
          '<button class="del" data-delcoupon="' + i + '" data-off="' + o.pid + '" title="删除这张券">×</button>' +
        '</div>';
      });
    }
    h += '<button class="add-row" data-addcoupon="' + o.pid + '">+ 加一张券</button></div>';

    h += '<div class="grp"><div class="grp-t">红包与抵扣</div><div class="fgrid">' +
      fld('平台红包', 'redpacket', o, '可领总额', '¥') +
      fld('红包门槛', 'redpacketMin', o, '留空无门槛', '¥') +
      (P.live ? fld('直播间红包', 'liveRedpacket', o, '福袋/红包', '¥') : '') +
      (P.coins ? fld(P.coins.label + '数量', 'coins', o, P.coins.hint, '个') : '') +
      (P.coins ? fld('抵扣上限', 'coinsCapPct', o, '如 ' + P.coins.capPct, '%') : '') +
      '</div></div>';

    if (P.rebates && P.rebates.length) {
      h += '<div class="grp"><div class="grp-t">返利<span class="gt-note">同单只能走一条</span></div><div class="fgrid">' +
        '<div class="f full"><label>返利渠道</label><select data-off="' + o.pid + '" data-f="rebateChannel">' +
          '<option value=""' + (!o.rebateChannel ? ' selected' : '') + '>不走返利</option>' +
          P.rebates.map(function (r) {
            return '<option value="' + esc(r) + '"' + (o.rebateChannel === r ? ' selected' : '') + '>' + esc(r) + '</option>';
          }).join('') +
        '</select></div>' +
        fld('返利比例', 'rebateRate', o, '如 3', '%') +
        fld('返利上限', 'rebateCap', o, '留空不限', '¥') +
        '</div></div>';
    }

    h += '<div class="grp"><div class="grp-t">支付与运费</div><div class="fgrid">' +
      fld(P.pay || '支付立减', 'payDiscount', o, '银行卡/白条', '¥') +
      fld('运费', 'freight', o, '不包邮时填', '¥') +
      '</div>';
    if (P.note) h += '<div class="ihint" style="margin-top:7px">' + P.note + '</div>';
    h += '</div>';
    return h;
  }

  function renderCards() {
    var p = curProduct(), box = $('#cards');
    if (!p) { box.innerHTML = ''; return; }
    var rows = computeAll(p), rankMap = {};
    rows.forEach(function (x, i) { rankMap[x.o.pid] = i; });

    var h = '';
    (p.offers || []).forEach(function (o) {
      if (!o.on) return;
      var P = PMAP[o.pid] || { name: o.pid, brand: '#999' };
      var best = offerBest(o), rk = rankMap[o.pid], open = !!S.open[o.pid];
      var nlink = (o.links || []).length;
      h += '<div class="pcard' + (open ? ' open' : '') + '" data-card="' + o.pid + '">' +
        '<div class="pcard-h" data-toggle="' + o.pid + '">' +
          '<span class="prank' + (rk === 0 ? ' top1' : '') + '">' + (rk === 0 ? '1' : (rk !== undefined ? rk + 1 : '·')) + '</span>' +
          '<span class="pname"><span class="bd" style="background:' + P.brand + '"></span>' + esc(P.name) +
            (nlink > 1 ? '<span class="off-flag">' + nlink + ' 链接</span>' : '') +
          '</span>' +
          '<span class="pprice' + (best ? (rk === 0 ? ' low' : '') : ' none') + '">' + (best ? fmt(best.r.final) : '未填价') + '</span>' +
          '<svg class="pchev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>' +
        '</div>' +
        '<div class="pcard-b">' + cardBody(o) + '</div>' +
      '</div>';
    });
    box.innerHTML = h;

    var offs = (p.offers || []).filter(function (o) { return !o.on; });
    $('#addPlat').innerHTML = offs.map(function (o) {
      var P = PMAP[o.pid] || { name: o.pid, brand: '#999' };
      return '<button class="chip" data-addplat="' + o.pid + '"><span class="bd" style="background:' + P.brand + '"></span>' + esc(P.name) + ' +</button>';
    }).join('') || '<span class="mini-note">全部平台都在比价了</span>';
  }

  function updateCardHeads(p, rows) {
    var rankMap = {};
    rows.forEach(function (x, i) { rankMap[x.o.pid] = i; });
    (p.offers || []).forEach(function (o) {
      if (!o.on) return;
      var card = $('[data-card="' + o.pid + '"]');
      if (!card) return;
      var best = offerBest(o), rk = rankMap[o.pid];
      var pr = $('.pprice', card), rkEl = $('.prank', card);
      if (pr) {
        pr.textContent = best ? fmt(best.r.final) : '未填价';
        pr.className = 'pprice' + (best ? (rk === 0 ? ' low' : '') : ' none');
      }
      if (rkEl) {
        rkEl.textContent = rk === 0 ? '1' : (rk !== undefined ? rk + 1 : '·');
        rkEl.className = 'prank' + (rk === 0 ? ' top1' : '');
      }
    });
  }

  /* 只重绘某平台链接行的到手价，避免输入时丢焦点 */
  function paintLinkMeta(o) {
    var card = $('[data-card="' + o.pid + '"]');
    if (!card) return;
    var links = o.links || [];
    var bestIdx = -1, bestV = Infinity, filled = 0;
    links.forEach(function (l, i) {
      var r = calc(o, l);
      if (r) { filled++; if (r.final < bestV) { bestV = r.final; bestIdx = i; } }
    });
    $$('.lrow', card).forEach(function (row) {
      var urlIn = row.querySelector('[data-f="url"]');
      if (!urlIn) return;
      var i = +urlIn.dataset.l;
      var r = calc(o, links[i] || {});
      var meta = row.nextElementSibling;
      if (!meta || !meta.classList.contains('lmeta')) return;
      var sp = meta.querySelector('.lprice');
      if (sp) {
        sp.textContent = r ? '到手 ' + fmt(r.final) + (i === bestIdx && links.length > 1 && filled > 1 ? ' · 最低' : '') : '未填价格';
        sp.className = 'lprice' + (r ? (i === bestIdx && links.length > 1 && filled > 1 ? ' best' : '') : ' none');
      }
      var hostEl = meta.querySelector('.lopen, .lhost');
      var host = hostOf((links[i] || {}).url);
      if (hostEl && host) {
        hostEl.textContent = host + ' ↗';
        hostEl.setAttribute('data-openurl', (links[i] || {}).url);
        hostEl.className = 'lopen';
      } else if (hostEl && !host) {
        hostEl.textContent = '未填链接';
        hostEl.removeAttribute('data-openurl');
        hostEl.className = 'lhost';
      }
    });
  }

  function renderProductBar() {
    var list = products(), p = curProduct();
    var h = list.map(function (x) {
      return '<button class="pchip' + (p && x.id === p.id ? ' on' : '') + '" data-pid="' + x.id + '">' +
        '<span class="n">' + esc(x.name || '未命名') + '</span>' +
        (list.length > 1 ? '<span class="x" data-delpid="' + x.id + '" title="删除该商品">×</span>' : '') +
      '</button>';
    }).join('');
    h += '<button class="pchip add" id="btnNewProd">+ 新商品</button>';
    $('#productBar').innerHTML = h;
  }

  function renderProductFields(p) {
    if (!p) return;
    $('#prodName').value = p.name || '';
    $('#prodSpec').value = p.spec || '';
  }

  function renderGuide() {
    $('#guideTabs').innerHTML = PLATS.map(function (p) {
      if (!GUIDES[p.id]) return '';
      return '<button class="gtab' + (S.tab === p.id ? ' on' : '') + '" data-tab="' + p.id + '">' +
        '<span class="bd" style="background:' + p.brand + '"></span>' + esc(p.name) + '</button>';
    }).join('');

    var g = GUIDES[S.tab], body = '';
    if (g) {
      body = g.items.map(function (it, i) {
        return '<div class="gitem" data-gi="' + i + '"><h4>' + it.t + '</h4>' +
          '<div class="how">' + it.how + '</div>' +
          (it.tip ? '<div class="tip">' + it.tip + '</div>' : '') + '</div>';
      }).join('');
    }
    if (PITFALLS.length) {
      body += '<div class="pit-block" id="pitBlock" style="grid-column:1/-1;margin:4px 0 0;border-top:1px solid var(--line2);padding-top:12px">' +
        '<h3>所有人都踩过的坑</h3><ul class="pit-list">' +
        PITFALLS.map(function (x, i) { return '<li data-pi="' + i + '"><b>' + x[0] + '</b>：' + x[1] + '</li>'; }).join('') +
        '</ul></div>';
    }
    $('#guideBody').innerHTML = body;
  }

  function renderAll() {
    var p = curProduct();
    renderProductBar();
    if (!p) { renderVerdict(null, []); renderRank(null, []); renderDetail(null, []); return; }
    renderProductFields(p);
    var rows = computeAll(p);
    renderCards();
    renderVerdict(p, rows);
    renderRank(p, rows);
    renderDetail(p, rows);
    $('#calcHint').textContent = rows.length
      ? rows.length + ' 个平台 · 最省 ' + fmt(rows[0].r.save)
      : '填价格后自动算';
  }

  function refresh() {
    var p = curProduct();
    if (!p) return;
    var rows = computeAll(p);
    renderVerdict(p, rows);
    renderRank(p, rows);
    renderDetail(p, rows);
    updateCardHeads(p, rows);
    $('#calcHint').textContent = rows.length
      ? rows.length + ' 个平台 · 最省 ' + fmt(rows[0].r.save)
      : '填价格后自动算';
  }

  /* ===================================================================
     模糊检索（商品名 / 规格 / 链接）
     =================================================================== */
  function renderFindRes(q) {
    var box = $('#findRes');
    var raw = String(q || '').trim();
    if (!raw) { box.hidden = true; box.innerHTML = ''; S.active = -1; S.findItems = []; return; }

    var hits = searchProducts(raw);
    var url = isUrl(raw) ? raw : '';
    var det = url ? detectPlatform(url) : '';
    var items = [];

    if (url) {
      var pname = det ? (PMAP[det] || {}).name || det : '未知平台';
      var gid = goodsId(url);
      if (det) {
        items.push({
          type: 'join', plat: det, url: url,
          title: '加入当前商品的「' + pname + '」平台',
          sub: gid ? '识别到商品 ID ' + gid : url.slice(0, 46)
        });
      }
      items.push({
        type: 'newurl', plat: det || 'taobao', url: url, gid: gid,
        title: '用这条链接新建商品',
        sub: (det ? pname : '未识别平台，先按淘宝建') + (gid ? ' · ID ' + gid : '')
      });
    }

    hits.forEach(function (h) {
      var p = h.p;
      var best = computeAll(p)[0];
      items.push({
        type: 'prod', pid: p.id,
        title: p.name || '未命名',
        sub: (p.spec ? p.spec + ' · ' : '') + countLinks(p) + ' 条链接' + (best ? ' · 最低 ' + fmt(best.r.final) : ''),
        hits: h.hits,
        cur: !!(curProduct() && curProduct().id === p.id)
      });
    });

    if (!url && raw) {
      items.push({ type: 'new', name: raw, title: '用「' + raw + '」新建商品', sub: '没找到完全匹配的，直接建一个' });
    }

    if (!items.length) {
      box.hidden = false;
      box.innerHTML = '<div class="fempty">没有匹配的商品。换个关键词，或回车直接新建。</div>';
      S.active = -1; S.findItems = [];
      return;
    }

    var h = '';
    if (url) h += '<div class="fg-t">识别为商品链接</div>';
    else if (hits.length) h += '<div class="fg-t">匹配到 ' + hits.length + ' 个商品 · 命中字段越多越靠前</div>';

    items.forEach(function (it, i) {
      h += '<button class="fitem" data-fi="' + i + '">' +
        '<span class="fi-t">' + esc(it.title) + (it.cur ? '<i class="fi-cur">当前</i>' : '') + '</span>' +
        '<span class="fi-s">' + esc(it.sub) + '</span>' +
        (it.hits && it.hits.length ? '<span class="fi-h">' + it.hits.map(function (k) { return '<i>' + k + '</i>'; }).join('') + '</span>' : '') +
      '</button>';
    });
    box.innerHTML = h;
    box.hidden = false;
    S.findItems = items;
    S.active = 0;
    paintActive();
  }

  function paintActive() {
    $$('#findRes .fitem').forEach(function (el, i) {
      el.classList.toggle('on', i === S.active);
    });
  }
  function closeFind() {
    var box = $('#findRes');
    if (box) box.hidden = true;
    S.active = -1;
  }

  function joinLink(plat, url) {
    var p = curProduct();
    if (!p) return;
    var o = (p.offers || []).filter(function (x) { return x.pid === plat; })[0];
    if (!o) return;
    o.on = true;
    var empty = (o.links || []).filter(function (l) { return !l.url && !l.price; })[0];
    if (empty) { empty.url = url; }
    else if ((o.links || []).length < MAX_LINKS) { o.links.push({ url: url, price: '', memberPrice: '' }); }
    else { toast('「' + (PMAP[plat] || {}).name + '」已有 ' + MAX_LINKS + ' 条链接，先删一条'); return; }
    S.open[plat] = true;
    saveProduct(p);
    renderAll();
    $('#findInput').value = '';
    closeFind();
    var card = $('[data-card="' + plat + '"]');
    if (card) {
      if (card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flash(card);
    }
    toast('已加入「' + (PMAP[plat] || {}).name + '」，填上页面价即可');
  }

  function createFromUrl(plat, url) {
    var gid = goodsId(url);
    var name = (PMAP[plat] || {}).name || '新商品';
    var p = blankProduct(name + (gid ? ' ' + gid : ''), '');
    var o = p.offers.filter(function (x) { return x.pid === plat; })[0];
    if (o) { o.on = true; o.links = [{ url: url, price: '', memberPrice: '' }]; }
    Store.set(p.id, p);
    S.cur = p.id; S.sel = ''; S.open = {};
    if (o) S.open[plat] = true;
    renderAll();
    $('#findInput').value = '';
    closeFind();
    setTimeout(function () { $('#prodName').focus(); $('#prodName').select(); }, 60);
    toast('已新建商品，改个名字再填页面价');
  }

  function gotoProduct(pid) {
    S.cur = pid; S.sel = '';
    var p = products().filter(function (x) { return x.id === pid; })[0];
    if (p) {
      S.open = {};
      var first = (p.offers || []).filter(function (o) { return o.on; })[0];
      if (first) S.open[first.pid] = true;
    }
    renderAll();
    var fi = $('#findInput');
    if (fi) fi.value = '';
    closeFind();
    flash($('[data-pid="' + pid + '"]'));
  }

  function runFindItem(it) {
    if (!it) return;
    if (it.type === 'prod') { gotoProduct(it.pid); return; }
    if (it.type === 'join') { joinLink(it.plat, it.url); return; }
    if (it.type === 'newurl') { createFromUrl(it.plat, it.url); return; }
    if (it.type === 'new') {
      var p = blankProduct(it.name, '');
      Store.set(p.id, p);
      S.cur = p.id; S.sel = ''; S.open = { taobao: true };
      renderAll();
      $('#findInput').value = '';
      closeFind();
      $('#prodSpec').focus();
      return;
    }
  }

  /* ===================================================================
     交互
     =================================================================== */
  var saveTimer = null;
  function touch(p) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveProduct(p); }, 400);
  }
  function findOffer(pid) {
    var p = curProduct();
    if (!p) return null;
    return (p.offers || []).filter(function (o) { return o.pid === pid; })[0] || null;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }
  function flash(el) {
    if (!el) return;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  function onFieldEdit(e) {
    var el = e.target;
    if (!el || !el.dataset || !el.dataset.off) return false;
    var o = findOffer(el.dataset.off);
    if (!o) return false;
    var f = el.dataset.f, v = el.value;

    if (el.dataset.c !== undefined && el.dataset.c !== '') {
      var i = +el.dataset.c;
      if (!o.coupons[i]) return false;
      o.coupons[i][f] = v;
    } else if (el.dataset.l !== undefined && el.dataset.l !== '') {
      var li = +el.dataset.l;
      if (!o.links[li]) return false;
      o.links[li][f] = v;
      touch(curProduct());
      paintLinkMeta(o);
      refresh();
      return true;
    } else {
      o[f] = v;
    }
    touch(curProduct());
    refresh();
    return true;
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'prodName') {
      var p = curProduct(); if (!p) return;
      p.name = t.value; touch(p);
      clearTimeout(window.__pbTimer);
      window.__pbTimer = setTimeout(renderProductBar, 600);
      return;
    }
    if (t.id === 'prodSpec') {
      var p2 = curProduct(); if (!p2) return;
      p2.spec = t.value; touch(p2); return;
    }
    if (t.id === 'findInput') { renderFindRes(t.value); return; }
    onFieldEdit(e);
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.tagName === 'SELECT') onFieldEdit(e);
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target || {};
    if (t.id === 'findInput') {
      var n = (S.findItems || []).length;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.active = Math.min(n - 1, S.active + 1); paintActive(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); S.active = Math.max(0, S.active - 1); paintActive(); return; }
      if (e.key === 'Escape') { closeFind(); t.blur(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        var idx = S.active >= 0 ? S.active : 0;
        runFindItem((S.findItems || [])[idx]);
        return;
      }
    }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) {
      e.preventDefault();
      $('#findInput').focus();
    }
  });

  document.addEventListener('click', function (e) {
    var t = e.target;

    var fi = t.closest('[data-fi]');
    if (fi) {
      var it = (S.findItems || [])[+fi.getAttribute('data-fi')];
      runFindItem(it);
      return;
    }
    if (!t.closest('.find')) closeFind();

    var tg = t.closest('[data-toggle]');
    if (tg) {
      var pid = tg.getAttribute('data-toggle');
      S.open[pid] = !S.open[pid];
      var card = $('[data-card="' + pid + '"]');
      if (card) card.classList.toggle('open', !!S.open[pid]);
      return;
    }

    var sel = t.closest('[data-sel]');
    if (sel) {
      S.sel = sel.getAttribute('data-sel');
      var p = curProduct(), rows = computeAll(p);
      renderRank(p, rows); renderDetail(p, rows);
      return;
    }

    var del = t.closest('[data-delcoupon]');
    if (del) {
      var o = findOffer(del.getAttribute('data-off'));
      if (o) {
        o.coupons.splice(+del.getAttribute('data-delcoupon'), 1);
        saveProduct(curProduct()); renderCards(); refresh();
      }
      return;
    }
    var add = t.closest('[data-addcoupon]');
    if (add) {
      var o2 = findOffer(add.getAttribute('data-addcoupon'));
      if (o2) {
        o2.coupons.push(newCoupon(PMAP[o2.pid]));
        saveProduct(curProduct()); renderCards(); refresh();
      }
      return;
    }

    var dl = t.closest('[data-dellink]');
    if (dl) {
      var o4 = findOffer(dl.getAttribute('data-off'));
      if (o4 && o4.links.length > 1) {
        o4.links.splice(+dl.getAttribute('data-dellink'), 1);
        saveProduct(curProduct()); renderCards(); refresh();
      }
      return;
    }
    var al = t.closest('[data-addlink]');
    if (al) {
      var o5 = findOffer(al.getAttribute('data-addlink'));
      if (o5 && o5.links.length < MAX_LINKS) {
        o5.links.push(blankLink());
        saveProduct(curProduct()); renderCards(); refresh();
      }
      return;
    }
    var op = t.closest('[data-openurl]');
    if (op) {
      var u = op.getAttribute('data-openurl');
      if (u) window.open(/^https?:\/\//i.test(u) ? u : 'https://' + u, '_blank', 'noopener');
      return;
    }

    var ap = t.closest('[data-addplat]');
    if (ap) {
      var o3 = findOffer(ap.getAttribute('data-addplat'));
      if (o3) {
        o3.on = true; S.open[o3.pid] = true;
        saveProduct(curProduct()); renderCards(); refresh();
      }
      return;
    }

    var dp = t.closest('[data-delpid]');
    if (dp) {
      var id = dp.getAttribute('data-delpid');
      var pr2 = products().filter(function (x) { return x.id === id; })[0];
      if (pr2 && confirm('删除商品「' + (pr2.name || '未命名') + '」及其所有平台报价？')) {
        Store.remove(id);
        if (S.cur === id) S.cur = '';
        renderAll();
      }
      return;
    }

    var chip = t.closest('[data-pid]');
    if (chip) { gotoProduct(chip.getAttribute('data-pid')); return; }

    if (t.closest('#btnNewProd')) {
      var np = blankProduct('新商品 ' + (products().length + 1));
      Store.set(np.id, np);
      S.cur = np.id; S.sel = ''; S.open = { taobao: true };
      renderAll();
      setTimeout(function () { $('#prodName').focus(); $('#prodName').select(); }, 50);
      return;
    }

    var tab = t.closest('[data-tab]');
    if (tab) { S.tab = tab.getAttribute('data-tab'); renderGuide(); return; }

    if (t.closest('#btnSample')) {
      var sp = sampleProduct();
      Store.set(sp.id, sp);
      S.cur = sp.id; S.sel = ''; S.open = { taobao: true };
      renderAll();
      return;
    }
    if (t.closest('#btnClear')) {
      var p4 = curProduct();
      if (!p4) return;
      if (!confirm('清空当前商品的所有平台链接与优惠？')) return;
      p4.offers = PLATS.map(function (x) {
        var o = blankOffer(x.id);
        o.on = ['taobao', 'jd', 'pdd', 'douyin'].indexOf(x.id) >= 0;
        return o;
      });
      saveProduct(p4); renderAll();
      return;
    }
    if (t.closest('#btnPrint')) { window.print(); return; }
    if (t.closest('#btnSync')) { $('#syncModal').removeAttribute('hidden'); return; }
    if (t.closest('[data-close]')) { $('#syncModal').setAttribute('hidden', ''); return; }
  });

  /* ===================================================================
     同步
     =================================================================== */
  function initSync() {
    if (!window.GhSync) { $('#ghStatus').textContent = '本地存储'; return; }
    window.GhSync.init({
      storeKey: 'quanwang_daojia',
      file: 'dao_jia.json',
      desc: '全网到手价 · 比价数据',
      onChange: function () {
        var ae = document.activeElement;
        var typing = ae && $('#cards') && $('#cards').contains(ae);
        renderProductBar();
        var p = curProduct();
        if (!p) { renderAll(); return; }
        if (typing) { refresh(); } else { renderAll(); }
      }
    });
  }

  /* ===================================================================
     启动
     =================================================================== */
  function boot() {
    if (!products().length) {
      var sp = sampleProduct();
      Store.set(sp.id, sp);
      S.cur = sp.id;
    }
    S.open = { taobao: true };
    if (!curProduct()) return;
    renderAll();
    renderGuide();
    initSync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
