/* VR 사이클 마감 폼이 종가를 스스로 채우는지 본다.
   시세 서버를 부르지 않고, 앱이 읽는 자리(localStorage)에 일별 시세를 심어둔 뒤
   폼에 찍히는 값을 확인한다.

   run.html 콘솔에서:
     var s=document.createElement('script'); s.src='vrclose.js'; document.body.appendChild(s);
     __vrCloseReset()   // 새로고침됨 → 다시 붙인 뒤
     __vrCloseTest()
   빈 배열이면 통과. */
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1';
  function $(id){ return document.getElementById(id); }
  function tab(n){ document.querySelector('#modeSwitch button[data-mode="'+n+'"]').click(); }
  function set(id, v){
    var e = $(id); if (!e) throw new Error('no #' + id);
    e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true}));
    e.dispatchEvent(new Event('change', {bubbles:true}));
  }

  // 9/18(금)이 쉰 날인 셈 — 16, 17 다음이 바로 21(월)이다. 이 구멍이
  // "휴장일이면 직전 거래일 종가" 규칙을 시험하는 자리다.
  var BARS = {
    TQQQ: [['2026-09-16',100],['2026-09-17',101],['2026-09-21',102]],
    SPY:  [['2026-09-16',500],['2026-09-17',501],['2026-09-21',502]],
    QQQ:  [['2026-09-16',600],['2026-09-17',601],['2026-09-21',602]]
  };
  function seedSeries(){
    Object.keys(BARS).forEach(function(sym){
      localStorage.setItem('vrtracker_series_' + sym, JSON.stringify({
        fetchedAt: Date.now(),
        values: BARS[sym].map(function(b){ return { date: b[0], close: b[1], high: b[1], low: b[1] }; })
      }));
    });
  }
  function reset(){ localStorage.clear(); seedSeries(); location.reload(); }

  function openVr(){
    tab('vr');
    $('newInstanceBtn').click();
    set('ni_name','자동종가'); set('ni_ticker','TQQQ');
    set('ni_date','2026-09-01'); set('ni_v', 5000);
    set('ni_pool', 2000); set('ni_qty', 50);
    set('ni_price', 100); set('ni_goal','');
    $('ni_create').click();
    tab('vr');
    var cards = document.querySelectorAll('.instance-card');
    for (var i=0;i<cards.length;i++){
      if (cards[i].textContent.indexOf('자동종가') === 0){ cards[i].click(); break; }
    }
    if (!$('cy_close')) throw new Error('마감 폼이 안 열림');
  }
  function vals(){
    return { close: $('cy_close').value, spy: $('cy_spy').value, qqq: $('cy_qqq').value };
  }

  var CASES = {};

  // 거래일을 그대로 고르면 그 날 종가가 세 칸에 다 들어온다.
  CASES.exactTradingDay = function(bad){
    openVr();
    set('cy_date', '2026-09-17');
    var v = vals();
    if (v.close !== '101') bad.push('TQQQ 종가가 101 이 아님: ' + v.close);
    if (v.spy !== '501') bad.push('SPY 종가가 501 이 아님: ' + v.spy);
    if (v.qqq !== '601') bad.push('QQQ 종가가 601 이 아님: ' + v.qqq);
  };

  // 쉰 날을 고르면 직전 거래일 종가가 들어온다.
  CASES.holidayFallsBack = function(bad){
    set('cy_date', '2026-09-18');
    var v = vals();
    if (v.close !== '101') bad.push('휴장일에 직전 거래일(101) 이 아님: ' + v.close);
    if (v.spy !== '501') bad.push('휴장일 SPY 가 501 이 아님: ' + v.spy);
  };

  // 아직 안 온 날짜는 비워 둔다 — 오늘 종가로 채우면 평가금이 조용히 틀린다.
  CASES.futureDateStaysEmpty = function(bad){
    set('cy_date', '2026-09-25');
    var v = vals();
    if (v.close !== '') bad.push('미래 날짜인데 종가가 채워짐: ' + v.close);
    if (v.spy !== '') bad.push('미래 날짜인데 SPY 가 채워짐: ' + v.spy);
  };

  // 직접 적은 값은 날짜를 바꿔도 안 건드린다.
  CASES.typedValueKept = function(bad){
    set('cy_date', '2026-09-17');
    set('cy_close', '88.88');
    set('cy_date', '2026-09-21');
    var v = vals();
    if (v.close !== '88.88') bad.push('직접 적은 값이 덮어써짐: ' + v.close);
    if (v.spy !== '502') bad.push('안 건드린 SPY 는 따라와야 함: ' + v.spy);
  };

  window.__vrCloseTest = function(){
    var bad = [];
    Object.keys(CASES).forEach(function(name){
      try { CASES[name](bad); } catch(e){ bad.push(name + ' 에서 예외: ' + e.message); }
    });
    return bad;
  };
  window.__vrCloseReset = reset;
  console.log('vrclose.js 준비됨 — __vrCloseReset() 후 다시 붙이고 __vrCloseTest()');
})();
