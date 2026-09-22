/* 무매 → VR 옮기기 검사.
   무작위 조작(fuzz.js)으로는 잘 안 나오는 경우들을 정해진 순서로 밟아본다:
   체결(fills) 없이 deltaQty 만 남은 옛 판본 사이클, 같은 날짜의 무매 기록이
   둘인 경우, 그 뒤에 적힌 무매 매도 때문에 옮길 수 없는 경우, 무매 시작일보다
   앞선 사이클, 숫자가 아닌 입력.

   run.html 콘솔에서:
     var s=document.createElement('script'); s.src='xfer.js'; document.body.appendChild(s);
     __xferReset()   // 새로고침됨 → 다시 붙인 뒤
     __xferTest()
   빈 배열이면 통과. */
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1', CLOUD = '__fakeCloud';
  function $(id){ return document.getElementById(id); }
  function st(){ return JSON.parse(localStorage.getItem(KEY)); }
  // 거절 경로는 기록을 한 글자도 안 건드려야 한다. 다만 카드를 누르거나 탭을
  // 옮기면 selectedId·updatedAt 같은 화면 상태는 저장되니, 기록 본체만 비교한다.
  function raw(){
    var s = st();
    return JSON.stringify({ instances: s.instances, muInstances: s.muInstances, portfolio: s.portfolio });
  }
  // 거절됐는데 뭔가 바뀌었으면 어디가 바뀌었는지까지 적는다.
  function changed(before, label, bad){
    var after = raw();
    if (after === before) return;
    var a = JSON.parse(before), b = JSON.parse(after), out = [];
    (function diff(x, y, path){
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      if (typeof x !== 'object' || typeof y !== 'object' || !x || !y){ out.push(path + ': ' + JSON.stringify(x) + ' -> ' + JSON.stringify(y)); return; }
      var keys = {}; Object.keys(x).concat(Object.keys(y)).forEach(function(k){ keys[k] = 1; });
      Object.keys(keys).forEach(function(k){ diff(x[k], y[k], path + '.' + k); });
    })(a, b, '');
    bad.push(label + ': 거절됐어야 하는데 기록이 바뀜 — ' + out.slice(0, 6).join(' | '));
  }
  function near(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 0.02 : eps); }
  function tab(n){ document.querySelector('#modeSwitch button[data-mode="'+n+'"]').click(); }
  function set(id, v){
    var e = $(id); if (!e) throw new Error('no #' + id);
    e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true}));
    e.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function openCard(mode, name){
    tab(mode);
    var cards = document.querySelectorAll('.instance-card');
    for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(name) === 0){ cards[i].click(); return true; } }
    throw new Error(name + ' 카드가 없음');
  }
  function vr(name){ return st().instances.filter(function(i){ return i.name === name; })[0]; }
  function mu(name){ return st().muInstances.filter(function(m){ return m.name === name; })[0]; }
  function fillsEq(fills, want){
    if (!fills || fills.length !== want.length) return false;
    for (var i=0;i<want.length;i++){
      if (fills[i].type !== want[i][0] || !near(fills[i].qty, want[i][1], 1e-9) || !near(fills[i].price, want[i][2], 1e-9)) return false;
    }
    return true;
  }
  // 질문 문구로 답을 고른다 — 무매 번호는 같은 종목 무매가 여럿일 때만 묻는다.
  var alerts = [];
  function answers(map){
    window.prompt = function(q){
      for (var k in map){ if (String(q).indexOf(k) !== -1) return map[k]; }
      return null;
    };
  }
  window.alert = function(m){ alerts.push(String(m)); };
  window.confirm = function(){ return true; };

  function createMu(name, qty, avg){
    tab('mu'); $('newInstanceBtn').click();
    set('mu_name', name); set('mu_ticker', 'TQQQ');
    set('mu_date', '2026-08-15'); set('mu_principal', 10000); set('mu_split', 40);
    set('mu_qty', qty == null ? '' : qty); set('mu_avg', avg == null ? '' : avg);
    $('mu_create').click();
  }
  function addMuDay(name, date, close, fills){
    openCard('mu', name);
    set('mu_e_date', date); set('mu_e_close', close);
    (fills || []).forEach(function(f){
      $('muAddFillBtn').click();
      var rows = document.querySelectorAll('#muFillsListHost tbody tr');
      var tr = rows[rows.length-1];
      var sel = tr.querySelector('select'); sel.value = f[0]; sel.dispatchEvent(new Event('change',{bubbles:true}));
      var ins = tr.querySelectorAll('input');
      ins[0].value = f[1]; ins[0].dispatchEvent(new Event('input',{bubbles:true}));
      ins[1].value = f[2]; ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    });
    $('mu_e_submit').click();
  }
  function transfer(vrName, map){
    openCard('vr', vrName);
    var btn = $('muXferBtn');
    if (!btn) throw new Error(vrName + ' 에 옮겨오기 버튼이 없음');
    alerts.length = 0;
    answers(map);
    btn.click();
  }

  // typeSegments 에 gApprovedSteps 를 넣어 두는 건 앱이 처음 그릴 때 그 칸을
  // 0 으로 채워 저장하기 때문이다 — 빼먹으면 "거절인데 기록이 바뀜" 헛경보가 난다.
  function cyc(id, date, price, qty, extra){
    var E = qty * price;
    var base = { id: id, date: date, price: price, qty: qty, E: E, deposit: 0, dividend: 0, G: 10,
      Vprev: 5000, Vnext: 5000, Pool: 1500, PoolPrev: 2000, tradeCash: 0, deltaQty: 0,
      buyBandPrev: 4250, sellBandPrev: 5750, signal: 'hold', buyBandNext: 4250, sellBandNext: 5750,
      sellClamped: false, poolLimitPct: 75, buyLimitAmt: 1125, spy: null, qqq: null, depositApplied: true };
    for (var k in extra) base[k] = extra[k];
    return base;
  }
  function seed(){
    var now = new Date().toISOString();
    var s = {
      instances: [
        // 첫 사이클은 여러 체결 이전 판본 모양: fills 없이 deltaQty 만 있다.
        { id: 'vrL', name: '레거시VR', ticker: 'TQQQ', cycleDays: 14, initDate: '2026-08-01',
          initV: 5000, initPool: 2000, initQty: 20, initPrice: 100, band: {low:0.85, high:1.15},
          typeSegments: [{ type: '적립식', startDate: '2026-08-01', startG: 10, gApprovedSteps: 0 }],
          cycles: [
            cyc('c1', '2026-09-01', 100, 25, { deltaQty: 5, tradeCash: -500, Pool: 1500, PoolPrev: 2000 }),
            cyc('c2', '2026-09-15', 110, 25, { fills: [], Pool: 1500, PoolPrev: 1500 })
          ] },
        { id: 'vrE', name: '이른VR', ticker: 'TQQQ', cycleDays: 14, initDate: '2026-07-01',
          initV: 1000, initPool: 1000, initQty: 0, initPrice: 100, band: {low:0.85, high:1.15},
          typeSegments: [{ type: '적립식', startDate: '2026-07-01', startG: 10, gApprovedSteps: 0 }],
          cycles: [ cyc('e1', '2026-08-01', 100, 0, { fills: [], Vprev: 1000, Vnext: 1000, Pool: 1000, PoolPrev: 1000 }) ] }
      ],
      muInstances: [], selectedId: null, muSelectedId: null, viewMode: 'vr', portfolioCurrency: 'USD',
      portfolio: { holdings: [], extraCash: 0, cashLog: [], assetSnapshots: [], manualRealized: [] },
      updatedAt: now
    };
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem(CLOUD, JSON.stringify(s));
    location.reload();
  }

  var CASES = {};

  // 옛 판본 사이클(체결 없이 deltaQty 5)에 3주를 붙이면 원래 5주 매수가
  // 그대로 남고 그 위에 3주가 더해져야 한다. 무매에는 그 날 3주 매도 기록이
  // 새로 생기고, 그외 예수금이 306 늘고, VR Pool + 그외 합은 그대로다.
  CASES.legacyCycle = function(bad){
    createMu('무매A', 10, 95);
    var s0 = st(), extra0 = s0.portfolio.extraCash || 0;
    var v0 = s0.instances.filter(function(i){ return i.name === '레거시VR'; })[0];
    var sum0 = v0.cycles[v0.cycles.length-1].Pool + extra0;
    transfer('레거시VR', { '사이클 시작일': '2026-09-01', '몇 주': '3', '옮기는 가격': '102' });
    var v = vr('레거시VR'), c1 = v.cycles[0], c2 = v.cycles[1];
    if (!fillsEq(c1.fills, [['buy',5,100],['buy',3,102]])) bad.push('legacyCycle: 첫 사이클 체결이 [매수5@100, 매수3@102] 가 아님: ' + JSON.stringify(c1.fills));
    if (!near(c1.qty, 28)) bad.push('legacyCycle: 첫 사이클 수량 ' + c1.qty + ' != 28');
    if (!near(c1.Pool, 1194)) bad.push('legacyCycle: 첫 사이클 Pool ' + c1.Pool + ' != 1194');
    if (!near(c2.qty, 28) || !near(c2.Pool, 1194)) bad.push('legacyCycle: 뒤 사이클이 다시 계산되지 않음 qty=' + c2.qty + ' Pool=' + c2.Pool);
    var m = mu('무매A'), d = m.days[m.days.length-1];
    if (!d || d.date !== '2026-09-01' || !fillsEq(d.fills, [['sell',3,102]])) bad.push('legacyCycle: 무매에 9/1 매도 3주 기록이 없음: ' + JSON.stringify(m.days));
    if (d && !near(d.qty, 7)) bad.push('legacyCycle: 무매 수량 ' + d.qty + ' != 7');
    if (d && !d.cashApplied) bad.push('legacyCycle: 새 무매 기록에 cashApplied 가 없음');
    var s = st();
    if (!near(s.portfolio.extraCash, extra0 + 306)) bad.push('legacyCycle: 그외 예수금 ' + s.portfolio.extraCash + ' != ' + (extra0 + 306));
    if (!near(c2.Pool + s.portfolio.extraCash, sum0)) bad.push('legacyCycle: VR Pool + 그외 합이 달라짐 ' + (c2.Pool + s.portfolio.extraCash) + ' != ' + sum0);
  };

  // 같은 날짜 기록이 둘(첫째는 0주, 둘째에서 10주 매수)이면 매도는 둘째 뒤에
  // 붙어야 한다. 첫째에 붙으면 팔 게 없어 줄여 팔리는데 현금은 다 들어온다.
  CASES.sameDateDays = function(bad){
    createMu('무매B', null, null);
    addMuDay('무매B', '2026-09-15', 110, []);
    addMuDay('무매B', '2026-09-15', 110, [['buy', 10, 110]]);
    transfer('레거시VR', { '번호를': '2', '사이클 시작일': '2026-09-15', '몇 주': '4', '옮기는 가격': '110' });
    var m = mu('무매B');
    if (m.days.length !== 2) bad.push('sameDateDays: 무매 기록이 2개가 아님 (' + m.days.length + ')');
    if (m.days[0].fills.length) bad.push('sameDateDays: 매도가 첫째 기록에 붙음');
    if (!fillsEq(m.days[1].fills, [['buy',10,110],['sell',4,110]])) bad.push('sameDateDays: 둘째 기록 체결이 다름: ' + JSON.stringify(m.days[1].fills));
    if (!near(m.days[1].qty, 6)) bad.push('sameDateDays: 무매 수량 ' + m.days[1].qty + ' != 6');
    m.days.forEach(function(d){ if (d.sellClamped) bad.push('sameDateDays: ' + d.date + ' 매도가 줄여서 반영됨'); });
    var c2 = vr('레거시VR').cycles[1];
    if (!fillsEq(c2.fills, [['buy',4,110]]) || !near(c2.qty, 32) || !near(c2.Pool, 754)) bad.push('sameDateDays: VR 둘째 사이클 qty=' + c2.qty + ' Pool=' + c2.Pool + ' fills=' + JSON.stringify(c2.fills));
  };

  // 그 뒤 날짜에 8주 매도가 적혀 있으면 (10주 보유) 9/15 에는 2주까지만 옮길
  // 수 있다. 5주는 거절되고 기록이 그대로여야 하고, 2주는 된다.
  CASES.futureSellGuard = function(bad){
    createMu('무매C', 10, 90);
    addMuDay('무매C', '2026-09-20', 100, [['sell', 8, 100]]);
    var before = raw();
    transfer('레거시VR', { '번호를': '3', '사이클 시작일': '2026-09-15', '몇 주': '5', '옮기는 가격': '110' });
    changed(before, 'futureSellGuard', bad);
    if (!alerts.some(function(a){ return a.indexOf('최대 2주') !== -1; })) bad.push('futureSellGuard: 최대 2주 안내가 없음: ' + JSON.stringify(alerts));
    transfer('레거시VR', { '번호를': '3', '사이클 시작일': '2026-09-15', '몇 주': '2', '옮기는 가격': '110' });
    var m = mu('무매C');
    if (m.days.length !== 2 || m.days[0].date !== '2026-09-15' || !fillsEq(m.days[0].fills, [['sell',2,110]])) bad.push('futureSellGuard: 9/15 매도 2주 기록이 앞에 안 들어감: ' + JSON.stringify(m.days));
    m.days.forEach(function(d){ if (d.sellClamped) bad.push('futureSellGuard: ' + d.date + ' 매도가 줄여서 반영됨'); });
    if (!near(m.days[m.days.length-1].qty, 0)) bad.push('futureSellGuard: 무매 최종 수량 ' + m.days[m.days.length-1].qty + ' != 0');
    var c2 = vr('레거시VR').cycles[1];
    if (!near(c2.qty, 34) || !near(c2.Pool, 534)) bad.push('futureSellGuard: VR 둘째 사이클 qty=' + c2.qty + ' Pool=' + c2.Pool);
  };

  // 무매가 시작하기 전 날짜의 사이클로는 옮길 수 없다.
  CASES.beforeStartDate = function(bad){
    var before = raw();
    transfer('이른VR', { '번호를': '1', '사이클 시작일': '2026-08-01', '몇 주': '1', '옮기는 가격': '100' });
    changed(before, 'beforeStartDate', bad);
    if (!alerts.some(function(a){ return a.indexOf('시작했어요') !== -1; })) bad.push('beforeStartDate: 시작일 안내가 없음: ' + JSON.stringify(alerts));
  };

  // 그 날짜 사이클이 없으면 새로 만들지 않고 거절한다.
  CASES.noCycleOnDate = function(bad){
    var before = raw();
    transfer('레거시VR', { '번호를': '1', '사이클 시작일': '2026-09-10', '몇 주': '1', '옮기는 가격': '100' });
    changed(before, 'noCycleOnDate', bad);
    if (vr('레거시VR').cycles.length !== 2) bad.push('noCycleOnDate: 사이클이 새로 생김');
    if (!alerts.some(function(a){ return a.indexOf('사이클 기록이 없어요') !== -1; })) bad.push('noCycleOnDate: 안내가 없음: ' + JSON.stringify(alerts));
  };

  // 숫자가 아닌 수량·가격은 전부 거절되고 기록은 그대로다.
  CASES.rejectsBadNumbers = function(bad){
    var before = raw();
    ['Infinity', '1abc', '1e400', '-3', '0', '2 3', ''].forEach(function(v){
      transfer('레거시VR', { '번호를': '1', '사이클 시작일': '2026-09-15', '몇 주': v, '옮기는 가격': '110' });
      changed(before, 'rejectsBadNumbers 수량 \"' + v + '\"', bad);
      transfer('레거시VR', { '번호를': '1', '사이클 시작일': '2026-09-15', '몇 주': '1', '옮기는 가격': v });
      changed(before, 'rejectsBadNumbers 가격 \"' + v + '\"', bad);
    });
    // 정상 입력은 여전히 통과해야 검사가 의미 있다.
    var q0 = vr('레거시VR').cycles[1].qty;
    transfer('레거시VR', { '번호를': '1', '사이클 시작일': '2026-09-15', '몇 주': '1', '옮기는 가격': '110' });
    if (!near(vr('레거시VR').cycles[1].qty, q0 + 1)) bad.push('rejectsBadNumbers: 정상 입력 1주가 안 들어감');
  };

  window.__xferTest = function(){
    var bad = [];
    Object.keys(CASES).forEach(function(name){
      try { CASES[name](bad); } catch(e){ bad.push(name + ' 에서 예외: ' + e.message); }
    });
    return bad;
  };
  window.__xferReset = seed;
  console.log('xfer.js 준비됨 — __xferReset() 후 다시 붙이고 __xferTest()');
})();
