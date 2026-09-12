/* 원화로 산 매수가 예수금·원가에 제대로 반영되는지 본다.
   fuzz.js 가 "어떤 순서로 조작하든 참인 것"을 보는 반면, 여기는 정해진
   시나리오 몇 개를 또박또박 밟으면서 숫자가 맞는지 본다.

   run.html 콘솔에서:
     var s=document.createElement('script'); s.src='krw.js'; document.body.appendChild(s);
     __krwTest()
   빈 배열이 나오면 통과. */
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1';
  function st(){ return JSON.parse(localStorage.getItem(KEY)); }
  function $(id){ return document.getElementById(id); }
  function near(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 0.02 : eps); }
  function set(id, v){
    var e = $(id); if (!e) throw new Error('no #' + id);
    e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true}));
    e.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function tab(name){ document.querySelector('#modeSwitch button[data-mode="'+name+'"]').click(); }

  // 검사마다 깨끗한 상태에서 시작한다. 앞 회차 기록이 남아 있으면 예수금이
  // 어디서 왔는지 알 수 없어 결과를 믿을 수 없다.
  // stub.js 는 가짜 서버 사본도 localStorage('__fakeCloud')에 두므로 통째로
  // 비운다 — 로컬만 지우면 서버 사본이 다시 내려와 그대로 살아난다.
  // 로그인은 stub 이 자동으로 해주므로 새로고침만 하면 된다.
  function reset(){
    localStorage.clear();
    location.reload();
  }

  // 가짜 서버가 주는 환율. 앱이 켜질 때 자동으로 받아 상태에 넣어둔다.
  var FX = 1385.5;
  function requireFx(bad){
    var fx = st().fx;
    if (!fx || Math.abs(fx.usdkrw - FX) > 0.001){
      bad.push('환율이 아직 안 들어왔어요 (지금: ' + (fx && fx.usdkrw) + '). 잠시 뒤 다시 실행하세요.');
      return false;
    }
    return true;
  }

  // 종목 한 줄을 만들고 티커를 적는다. 티커가 있어야 매매 기록 폼이 나타난다.
  function addHolding(ticker){
    tab('portfolio');
    $('addHoldingBtn').click();
    var rows = document.querySelectorAll('#manualHoldingsHost tbody tr');
    var tr = rows[rows.length - 1];
    var inp = tr.querySelector('.h-ticker');
    inp.value = ticker;
    inp.dispatchEvent(new Event('change', {bubbles:true}));
    var hs = st().portfolio.holdings;
    return hs[hs.length - 1].id;
  }

  function recordTrade(hId, type, qty, price, krw, date){
    tab('portfolio');
    var sel = $('tr_ticker');
    sel.value = hId;
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    set('tr_type', type);
    set('tr_qty', qty);
    set('tr_price', price);
    set('tr_krw', krw == null ? '' : krw);
    set('tr_date', date);
    $('tradeSubmitBtn').click();
  }

  function holding(id){
    return st().portfolio.holdings.filter(function(h){ return h.id === id; })[0];
  }
  // 케이스들은 같은 상태 위에서 이어서 돈다 (매번 새로고침하면 느리고, 여러
  // 종목이 섞인 상태에서도 맞는지 보는 편이 낫다). 그래서 예수금은 절대값이
  // 아니라 그 케이스가 만든 변화량으로 본다.
  function cash(){ return st().portfolio.extraCash || 0; }
  function linkedRows(tradeId){
    return (st().portfolio.cashLog || []).filter(function(e){ return e.tradeId === tradeId; });
  }

  // trade-edit 은 prompt 를 다섯 번 부른다 (수량·가격·낸 원화·날짜·구분).
  // 순서대로 답을 돌려주고 원래 prompt 를 되돌려 놓는다.
  function editTrade(hId, answers){
    tab('portfolio');
    var btn = document.querySelector('.trade-edit[data-h="' + hId + '"]');
    if (!btn) throw new Error('수정 버튼을 못 찾음');
    var real = window.prompt, i = 0;
    window.prompt = function(){ return answers[i++]; };
    try { btn.click(); } finally { window.prompt = real; }
  }
  function deleteTrade(hId){
    tab('portfolio');
    var btn = document.querySelector('.trade-del[data-h="' + hId + '"]');
    if (!btn) throw new Error('삭제 버튼을 못 찾음');
    var real = window.confirm;
    window.confirm = function(){ return true; };
    try { btn.click(); } finally { window.confirm = real; }
  }

  // 종목 표에서 한 줄의 칸 값을 라벨로 읽는다. 화면에 실제로 찍힌 숫자를
  // 보는 것이라, 계산 함수가 맞아도 표에 안 붙었으면 잡힌다.
  function cellText(hId, label){
    tab('portfolio');
    var tr = document.querySelector('#manualHoldingsHost tr[data-id="' + hId + '"]');
    if (!tr) throw new Error('종목 줄을 못 찾음');
    var td = tr.querySelector('td[data-label="' + label + '"]');
    if (!td) throw new Error('"' + label + '" 칸을 못 찾음');
    return td.textContent.trim();
  }
  // 시세가 안 잡히는 티커는 표에 현재가 직접입력 칸이 뜬다. 그 칸으로 넣는다.
  // 앱은 state 를 메모리에 들고 있어서 localStorage 를 고쳐도 화면은 안 바뀐다 —
  // 무엇이든 UI 로 넣어야 한다.
  function setCurrentPrice(hId, price){
    tab('portfolio');
    var tr = document.querySelector('#manualHoldingsHost tr[data-id="' + hId + '"]');
    if (!tr) throw new Error('종목 줄을 못 찾음');
    var inp = tr.querySelector('.h-price');
    if (!inp) throw new Error('현재가 칸이 없음 (실시간 시세가 잡히는 티커예요)');
    inp.value = price;
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function setSeedKrw(hId, value){
    tab('portfolio');
    var tr = document.querySelector('#manualHoldingsHost tr[data-id="' + hId + '"]');
    if (!tr) throw new Error('종목 줄을 못 찾음');
    var inp = tr.querySelector('.h-krwseed');
    if (!inp) throw new Error('기존분 원화원가 칸을 못 찾음');
    var real = window.alert;
    window.alert = function(){};
    inp.value = value;
    try { inp.dispatchEvent(new Event('change', {bubbles:true})); }
    finally { window.alert = real; }
  }
  // 거래 기록 없이 수량·평단만 직접 넣는다 — 지금 QLD 가 그런 상태다.
  // 수량 직접 수정은 "예수금에 반영되지 않아요" confirm 을 띄우므로 확인을 눌러준다.
  function seedPosition(hId, qty, avgCost){
    tab('portfolio');
    var tr = document.querySelector('#manualHoldingsHost tr[data-id="' + hId + '"]');
    if (!tr) throw new Error('종목 줄을 못 찾음');
    var real = window.confirm;
    window.confirm = function(){ return true; };
    try {
      var q = tr.querySelector('.h-qty');
      q.value = qty;
      q.dispatchEvent(new Event('change', {bubbles:true}));
    } finally { window.confirm = real; }
    // 수량을 고치면 표가 다시 그려져 앞서 잡아둔 tr 은 버려진 줄이다. 다시 찾는다.
    tr = document.querySelector('#manualHoldingsHost tr[data-id="' + hId + '"]');
    var c = tr.querySelector('.h-cost');
    c.value = avgCost;
    c.dispatchEvent(new Event('change', {bubbles:true}));
  }

  var CASES = {};

  // 원화 칸을 채운 매수는 예수금을 건드리지 않는다. 매수로 빠진 만큼
  // 자동 입금 줄이 되돌려 놓기 때문이다.
  CASES.krwBuyKeepsCash = function(bad){
    var before = cash();
    var hId = addHolding('QLD');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    if (!near(cash() - before, 0)){
      bad.push('원화 매수로 예수금이 움직임: ' + (cash() - before));
    }
    var h = holding(hId);
    if (!h.trades.length){ bad.push('거래가 기록되지 않음'); return; }
    var t = h.trades[0];
    if (t.krwAmount !== 260000) bad.push('krwAmount 가 260000 이 아님: ' + t.krwAmount);
    var linked = linkedRows(t.id);
    if (linked.length !== 1){ bad.push('짝 입금 줄이 ' + linked.length + '개'); return; }
    if (!near(linked[0].amount, 200)) bad.push('짝 입금액이 200 이 아님: ' + linked[0].amount);
    if (linked[0].kind !== '입금') bad.push('짝 줄의 구분이 입금이 아님: ' + linked[0].kind);
    if (linked[0].date !== '2026-09-01') bad.push('짝 줄의 날짜가 거래일과 다름: ' + linked[0].date);
  };

  // 원화 칸을 비운 매수는 지금까지와 똑같이 예수금에서 빠진다.
  CASES.usdBuyStillSpendsCash = function(bad){
    var before = cash();
    var hId = addHolding('SPY');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-01');
    if (!near(cash() - before, -200)){
      bad.push('달러 매수로 예수금이 -200 만큼 안 움직임: ' + (cash() - before));
    }
    var t = holding(hId).trades[0];
    if (t.krwAmount != null) bad.push('원화를 안 적었는데 krwAmount 가 있음: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 0) bad.push('원화 매수가 아닌데 짝 입금 줄이 생김');
  };

  // 원화를 안 적었던 매수에 원화를 적으면 짝 입금 줄이 새로 생기고
  // 예수금은 0 으로 돌아온다.
  CASES.editAddKrw = function(bad){
    var before = cash();
    var hId = addHolding('AAA');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-01');
    editTrade(hId, ['2', '100', '260000', '2026-09-01', '매수']);
    if (!near(cash() - before, 0)) bad.push('원화를 더했는데 예수금이 제자리로 안 옴: ' + (cash() - before));
    var t = holding(hId).trades[0];
    if (t.krwAmount !== 260000) bad.push('krwAmount 가 안 붙음: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 1) bad.push('짝 입금 줄이 1개가 아님');
  };

  // 원화 금액과 수량을 같이 고치면 짝 입금 줄의 금액도 따라간다.
  CASES.editChangeKrw = function(bad){
    var before = cash();
    var hId = addHolding('BBB');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    editTrade(hId, ['3', '100', '390000', '2026-09-02', '매수']);
    if (!near(cash() - before, 0)) bad.push('고친 뒤 예수금이 움직임: ' + (cash() - before));
    var t = holding(hId).trades[0];
    if (t.krwAmount !== 390000) bad.push('krwAmount 가 안 바뀜: ' + t.krwAmount);
    var linked = linkedRows(t.id);
    if (linked.length !== 1){ bad.push('짝 입금 줄이 1개가 아님'); return; }
    if (!near(linked[0].amount, 300)) bad.push('짝 입금액이 300 이 아님: ' + linked[0].amount);
    if (linked[0].date !== '2026-09-02') bad.push('짝 줄 날짜가 안 따라감: ' + linked[0].date);
  };

  // 원화를 지우면 달러로 산 것이 되어 예수금에서 매수액이 빠진다.
  CASES.editRemoveKrw = function(bad){
    var before = cash();
    var hId = addHolding('CCC');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    editTrade(hId, ['2', '100', '', '2026-09-01', '매수']);
    if (!near(cash() - before, -200)) bad.push('원화를 지웠는데 예수금이 -200 만큼 안 빠짐: ' + (cash() - before));
    var t = holding(hId).trades[0];
    if (t.krwAmount != null) bad.push('krwAmount 가 안 지워짐: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 0) bad.push('짝 입금 줄이 안 지워짐');
  };

  // 거래를 지우면 짝 입금 줄도 같이 사라지고 예수금은 원래대로 돌아온다.
  CASES.deleteKrwTrade = function(bad){
    var before = cash();
    var hId = addHolding('DDD');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    var tradeId = holding(hId).trades[0].id;
    deleteTrade(hId);
    if (!near(cash() - before, 0)) bad.push('거래를 지웠는데 예수금이 제자리로 안 옴: ' + (cash() - before));
    if (holding(hId).trades.length !== 0) bad.push('거래가 안 지워짐');
    if (linkedRows(tradeId).length !== 0) bad.push('짝 입금 줄이 남아 있음');
  };

  // 원화 매수 두 건의 원화 원가는 낸 원화의 합이다. 손익은 그 원가와
  // (수량 x 현재가 x 환율) 의 차이다.
  CASES.krwBasisAndPnl = function(bad){
    if (!requireFx(bad)) return;
    var hId = addHolding('EEE');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    // 매수를 기록하면 그 가격이 현재가로도 들어간다 (h.currentPrice = price).
    // 'EEE' 는 가짜 서버의 시세 목록에 없어 실시간 값이 덮지 않는다.
    recordTrade(hId, 'buy', 2, 110, 300000, '2026-09-02');
    var cost = cellText(hId, '원화 원가');
    if (cost.indexOf('560,000') === -1) bad.push('원화 원가가 560,000 이 아님: ' + cost);
    // 4주 x $110 x 1385.5 = 609,620 -> 손익 +49,620
    var pnl = cellText(hId, '원화 손익');
    if (pnl.indexOf('49,620') === -1) bad.push('원화 손익이 49,620 이 아님: ' + pnl);
  };

  // 원화를 안 적은 종목은 원화 칸이 비어 있어야 한다 — 0원이 아니라 "–".
  CASES.noKrwShowsDash = function(bad){
    var hId = addHolding('FFF');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-01');
    var cost = cellText(hId, '원화 원가');
    if (cost !== '–') bad.push('원화를 안 적었는데 원가 칸이 "–" 가 아님: ' + cost);
  };

  // 절반만 원화로 샀으면 원화 손익은 그 절반에 대해서만 계산하고
  // 나머지가 빠져 있다고 알려야 한다.
  CASES.partialKrwWarns = function(bad){
    if (!requireFx(bad)) return;
    var hId = addHolding('GGG');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-02');
    var pnl = cellText(hId, '원화 손익');
    if (pnl.indexOf('미입력분 제외') === -1) bad.push('일부만 원화인데 안내가 없음: ' + pnl);
  };

  // 거래 기록 없이 쌓아둔 기존 물량에 원화 원가를 적으면 그 물량까지
  // 원화 손익에 들어온다.
  CASES.seedKrwCost = function(bad){
    var hId = addHolding('HHH');
    seedPosition(hId, 10, 90);
    setSeedKrw(hId, 1170000);
    var h = holding(hId);
    if (h.krwSeedCost !== 1170000) bad.push('krwSeedCost 가 안 들어감: ' + h.krwSeedCost);
    if (h.krwSeedQty !== 10) bad.push('krwSeedQty 가 10 이 아님: ' + h.krwSeedQty);
    if (!requireFx(bad)) return;
    setCurrentPrice(hId, 100);
    // 10주 x $100 x 1385.5 = 1,385,500 -> 손익 +215,500
    var pnl = cellText(hId, '원화 손익');
    if (pnl.indexOf('215,500') === -1) bad.push('기존분 원화 손익이 215,500 이 아님: ' + pnl);
  };

  // 기존 물량이 없는데 기존분 원가를 적으면 원가만 생기고 수량이 없어
  // 손익이 통째로 마이너스가 된다. 받지 않아야 한다.
  CASES.seedKrwRejectedWhenNoPosition = function(bad){
    var hId = addHolding('III');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    setSeedKrw(hId, 500000);
    var h = holding(hId);
    if (h.krwSeedCost != null) bad.push('기존 물량이 없는데 krwSeedCost 가 들어감: ' + h.krwSeedCost);
  };

  // 값을 비우면 기존분 원가가 지워진다.
  CASES.seedKrwCleared = function(bad){
    var hId = addHolding('JJJ');
    seedPosition(hId, 10, 90);
    setSeedKrw(hId, 1170000);
    setSeedKrw(hId, '');
    var h = holding(hId);
    if (h.krwSeedCost != null) bad.push('krwSeedCost 가 안 지워짐: ' + h.krwSeedCost);
    if (h.krwSeedQty != null) bad.push('krwSeedQty 가 안 지워짐: ' + h.krwSeedQty);
  };

  window.__krwTest = function(only){
    var bad = [];
    Object.keys(CASES).forEach(function(name){
      if (only && name !== only) return;
      try { CASES[name](bad); }
      catch (e){ bad.push(name + ' 에서 예외: ' + e.message); }
    });
    return bad;
  };
  window.__krwReset = reset;
  console.log('krw.js 준비됨 — __krwReset() 로 상태를 비우고 __krwTest() 를 실행하세요.');
})();
