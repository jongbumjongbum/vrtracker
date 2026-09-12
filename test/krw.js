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
  function linkedRows(tradeId){
    return (st().portfolio.cashLog || []).filter(function(e){ return e.tradeId === tradeId; });
  }

  var CASES = {};

  // 원화 칸을 채운 매수는 예수금을 건드리지 않는다. 매수로 빠진 만큼
  // 자동 입금 줄이 되돌려 놓기 때문이다.
  CASES.krwBuyKeepsCash = function(bad){
    var hId = addHolding('QLD');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    var s = st();
    if (!near(s.portfolio.extraCash, 0)){
      bad.push('원화 매수 후 예수금이 0이 아님: ' + s.portfolio.extraCash);
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
    var hId = addHolding('SPY');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-01');
    var s = st();
    if (!near(s.portfolio.extraCash, -200)){
      bad.push('달러 매수 후 예수금이 -200 이 아님: ' + s.portfolio.extraCash);
    }
    var t = holding(hId).trades[0];
    if (t.krwAmount != null) bad.push('원화를 안 적었는데 krwAmount 가 있음: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 0) bad.push('원화 매수가 아닌데 짝 입금 줄이 생김');
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
