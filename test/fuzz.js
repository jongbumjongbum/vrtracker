/* 무작위 조작 + 불변식 검사기.
   눈으로 훑어서 버그를 찾는 건 끝이 없어서, 대신 "어떤 조작을 어떤 순서로 하든
   반드시 참이어야 하는 것들"을 적어두고 앱을 마구 조작하면서 그게 깨지는지 본다.
   깨지면 그때까지의 조작 기록을 그대로 남기니 재현도 된다. */
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1';
  function st(){ return JSON.parse(localStorage.getItem(KEY)); }
  function near(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 0.02 : eps); }
  function $(id){ return document.getElementById(id); }
  function set(id, v){
    var e = $(id); if (!e) throw new Error('no #' + id);
    e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true}));
    e.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function tab(name){ document.querySelector('#modeSwitch button[data-mode="'+name+'"]').click(); }

  // 씨앗을 주는 난수 — 실패한 회차를 그대로 다시 돌릴 수 있게.
  function rng(seed){
    var s = seed >>> 0;
    return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ---------------- 불변식 ---------------- */
  // 하나라도 어긋나면 그 이유를 문자열로 돌려준다.
  function checkAll(){
    var s = st(), bad = [];
    if (!s) return ['state 없음'];

    (s.instances || []).forEach(function(inst, ii){
      var tag = 'VR#' + ii + '(' + inst.name + ')';
      // 날짜순 정렬
      for (var i=1;i<inst.cycles.length;i++){
        if (inst.cycles[i-1].date > inst.cycles[i].date) bad.push(tag + ' 사이클이 날짜순이 아님');
      }
      // 사슬: 앞 사이클의 Vnext 가 다음 사이클의 Vprev
      var prevV = inst.initV, prevPool = inst.initPool, qty = inst.initQty || 0, pool = inst.initPool || 0;
      inst.cycles.forEach(function(c, ci){
        if (!near(c.Vprev, prevV)) bad.push(tag + ' 사이클' + ci + ' Vprev(' + c.Vprev + ') != 직전 Vnext(' + prevV + ')');
        if (!near(c.PoolPrev, prevPool)) bad.push(tag + ' 사이클' + ci + ' PoolPrev 불일치');
        prevV = c.Vnext; prevPool = c.Pool;
        // 수량·현금 보존
        var buyC=0, sellP=0, run=qty;
        (c.fills||[]).forEach(function(f){
          if (f.type === 'buy'){ run += f.qty; buyC += f.qty*f.price; }
          else { var sq = Math.min(f.qty, Math.max(0, run)); run -= sq; sellP += sq*f.price; }
        });
        qty = run;
        pool = pool + (c.deposit||0) + sellP - buyC;
        if (!near(c.qty, qty)) bad.push(tag + ' 사이클' + ci + ' 수량(' + c.qty + ') != 체결 누적(' + qty + ')');
        if (!near(c.Pool, pool, 0.05)) bad.push(tag + ' 사이클' + ci + ' Pool(' + c.Pool + ') != 입출금·체결 누적(' + pool + ')');
        if (!near(c.E, c.qty * c.price, 0.05)) bad.push(tag + ' 사이클' + ci + ' E != 수량×종가');
        if (c.qty < -1e-9) bad.push(tag + ' 사이클' + ci + ' 보유수량이 음수(' + c.qty + ')');
      });
    });

    (s.muInstances || []).forEach(function(m, mi){
      var tag = '무매#' + mi + '(' + m.name + ')';
      for (var i=1;i<m.days.length;i++){
        if (m.days[i-1].date > m.days[i].date) bad.push(tag + ' 기록이 날짜순이 아님');
      }
      var qty = m.initQty || 0, cash = m.principal - (m.initQty||0)*(m.initAvgCost||0);
      m.days.forEach(function(d, di){
        (d.fills||[]).forEach(function(f){
          if (f.type === 'buy'){ qty += f.qty; cash -= f.qty*f.price; }
          else { var sq = Math.min(f.qty, qty); qty -= sq; cash += sq*f.price; }   // 팔린 만큼만 현금이 들어온다
        });
        if (!near(d.qty, qty)) bad.push(tag + ' ' + d.date + ' 수량(' + d.qty + ') != 체결 누적(' + qty + ')');
        if (!near(d.cash, cash, 0.05)) bad.push(tag + ' ' + d.date + ' 잔금(' + d.cash + ') != 체결 누적(' + cash + ')');
        // 원금 보존: 잔금 + 투입금액 == 원금 + 실현손익
        var invested = d.qty * d.avgCost;
        if (!near(d.cash + invested, m.principal + d.realizedPL, 0.05)){
          bad.push(tag + ' ' + d.date + ' 잔금+투입(' + (d.cash+invested).toFixed(2) + ') != 원금+실현손익(' + (m.principal+d.realizedPL).toFixed(2) + ')');
        }
        if (d.qty < -1e-9) bad.push(tag + ' ' + d.date + ' 수량이 음수');
        if (d.T < -1e-9 || d.T > m.splitCount + 1e-9) bad.push(tag + ' ' + d.date + ' T가 0~분할수 밖(' + d.T + ')');
      });
      if (m.days.length && !near(m.realizedPL, m.days[m.days.length-1].realizedPL, 0.02)){
        bad.push(tag + ' 인스턴스 실현손익이 마지막 기록과 다름');
      }
    });

    var pf = s.portfolio || {};
    (pf.holdings || []).forEach(function(h, hi){
      var tag = '직접입력#' + hi + '(' + h.ticker + ')';
      var qty = 0, cost = 0, realized = 0;
      (h.trades||[]).forEach(function(t){
        if (t.type === 'buy'){ qty += t.qty; cost += t.qty*t.price; }
        else {
          var avg = qty > 0 ? cost/qty : 0;
          var sq = Math.min(t.qty, qty);
          realized += sq*(t.price - avg);
          qty -= sq; cost = avg*Math.max(0, qty);
        }
      });
      if (!near(h.qty, qty)) bad.push(tag + ' 수량(' + h.qty + ') != 거래 누적(' + qty + ')');
      if (!near(h.realizedPL, realized, 0.05)) bad.push(tag + ' 실현손익(' + h.realizedPL + ') != 거래 누적(' + realized.toFixed(2) + ')');
      if (h.qty < -1e-9) bad.push(tag + ' 수량이 음수');
      for (var i=1;i<(h.trades||[]).length;i++){
        if (h.trades[i-1].date > h.trades[i].date) bad.push(tag + ' 거래가 날짜순이 아님');
      }
    });

    // 그외 예수금 = 입출금 + 직접입력 매매 + (반영된) 무매 매매
    var expected = 0;
    (pf.cashLog||[]).forEach(function(e){ if (e.kind==='입금'||e.kind==='출금') expected += e.amount; });
    (pf.holdings||[]).forEach(function(h){
      (h.trades||[]).forEach(function(t){ expected += (t.type==='buy'?-1:1) * t.qty * t.price; });
    });
    (s.muInstances||[]).forEach(function(m){
      (m.days||[]).forEach(function(d){
        if (!d.cashApplied) return;
        (d.fills||[]).forEach(function(f){ expected += (f.type==='buy'?-1:1) * f.qty * f.price; });
      });
    });
    if (!near(pf.extraCash || 0, expected, 0.05)){
      bad.push('그외 예수금(' + (pf.extraCash||0).toFixed(2) + ') != 입출금·매매 누적(' + expected.toFixed(2) + ')');
    }
    return bad;
  }

  /* ---------------- 조작 ---------------- */
  function d(rand, base, spread){
    var t = new Date(Date.parse(base) + Math.floor((rand()*2-1)*spread) * 86400000);
    return t.toISOString().slice(0,10);
  }
  function addFillRow(host, type, qty, price){
    $(host === 'fillsListHost' ? 'addFillBtn' : 'muAddFillBtn').click();
    var rows = document.querySelectorAll('#'+host+' tbody tr');
    var tr = rows[rows.length-1];
    var sel = tr.querySelector('select'); sel.value = type; sel.dispatchEvent(new Event('change',{bubbles:true}));
    var ins = tr.querySelectorAll('input');
    ins[0].value = qty; ins[0].dispatchEvent(new Event('input',{bubbles:true}));
    ins[1].value = price; ins[1].dispatchEvent(new Event('input',{bubbles:true}));
  }
  function pickVr(rand){ var s=st(); if(!s.instances.length) return null; return s.instances[Math.floor(rand()*s.instances.length)]; }
  function pickMu(rand){ var s=st(); if(!s.muInstances.length) return null; return s.muInstances[Math.floor(rand()*s.muInstances.length)]; }

  var ACTIONS = {
    createVR: function(rand){
      if (st().instances.length >= 3) return 'skip';
      tab('vr'); $('newInstanceBtn').click();
      set('ni_name','VR'+Math.floor(rand()*1000)); set('ni_ticker', rand()<0.5?'TQQQ':'SOXL');
      set('ni_date','2026-06-01'); set('ni_v', 5000+Math.floor(rand()*10000));
      set('ni_pool', 1000+Math.floor(rand()*5000)); set('ni_qty', Math.floor(rand()*100));
      set('ni_price', 20+Math.floor(rand()*120)); set('ni_goal','');
      $('ni_create').click();
    },
    addCycle: function(rand){
      var inst = pickVr(rand); if (!inst) return 'skip';
      tab('vr'); st(); // 선택
      var s = st(); s.selectedId = inst.id; localStorage.setItem(KEY, JSON.stringify(s));
      location.__noop = 1;
      // UI 로 선택
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(inst.name) === 0) { cards[i].click(); break; } }
      if (!$('cy_close')) return 'skip';
      var base = inst.cycles.length ? inst.cycles[inst.cycles.length-1].date : inst.initDate;
      set('cy_date', d(rand, base, 20));
      set('cy_close', (10 + rand()*150).toFixed(2));
      set('cy_deposit', Math.floor(rand()*1000));
      var n = Math.floor(rand()*3);
      var last = inst.cycles.length ? inst.cycles[inst.cycles.length-1] : {qty: inst.initQty};
      for (var k=0;k<n;k++){
        var isSell = rand() < 0.4 && (last.qty||0) > 0;
        addFillRow('fillsListHost', isSell?'sell':'buy',
          Math.max(1, Math.floor(rand() * (isSell ? Math.max(1,(last.qty||1)) : 20))),
          (10 + rand()*150).toFixed(2));
      }
      $('cy_submit').click();
    },
    deleteCycle: function(rand){
      var inst = pickVr(rand); if (!inst || !inst.cycles.length) return 'skip';
      tab('vr');
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(inst.name) === 0) { cards[i].click(); break; } }
      var rows = document.querySelectorAll('#mainArea tr[data-cycle-id]');
      if (!rows.length) return 'skip';
      rows[Math.floor(rand()*rows.length)].querySelector('.cyc-del').click();
    },
    editCycle: function(rand){
      var inst = pickVr(rand); if (!inst || !inst.cycles.length) return 'skip';
      tab('vr');
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(inst.name) === 0) { cards[i].click(); break; } }
      var rows = document.querySelectorAll('#mainArea tr[data-cycle-id]');
      if (!rows.length) return 'skip';
      var c = inst.cycles[Math.floor(rand()*inst.cycles.length)];
      var ans = [d(rand, c.date, 10), (10+rand()*150).toFixed(2), String(Math.floor(rand()*800))], ai = 0;
      window.prompt = function(){ return ans[ai++]; };
      var target = null;
      rows.forEach(function(r){ if (r.getAttribute('data-cycle-id') === c.id) target = r; });
      if (!target) return 'skip';
      target.querySelector('.cyc-edit').click();
    },
    createMu: function(rand){
      if (st().muInstances.length >= 3) return 'skip';
      tab('mu'); $('newInstanceBtn').click();
      set('mu_name','무매'+Math.floor(rand()*1000)); set('mu_ticker', rand()<0.5?'TQQQ':'SOXL');
      set('mu_date','2026-06-01'); set('mu_principal', 5000+Math.floor(rand()*20000));
      set('mu_split', 20 + Math.floor(rand()*3)*10);
      if (rand() < 0.35){ set('mu_qty', 1+Math.floor(rand()*30)); set('mu_avg', (10+rand()*80).toFixed(2)); }
      else { set('mu_qty',''); set('mu_avg',''); }
      $('mu_create').click();
    },
    addMuDay: function(rand){
      var m = pickMu(rand); if (!m) return 'skip';
      tab('mu');
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(m.name) === 0) { cards[i].click(); break; } }
      if (!$('mu_e_close')) return 'skip';
      var base = m.days.length ? m.days[m.days.length-1].date : m.startDate;
      set('mu_e_date', d(rand, base, 10));
      set('mu_e_close', (5 + rand()*120).toFixed(2));
      var last = m.days.length ? m.days[m.days.length-1] : {qty: m.initQty||0, cash: m.principal};
      var n = Math.floor(rand()*3);
      for (var k=0;k<n;k++){
        var isSell = rand() < 0.4 && (last.qty||0) > 0;
        addFillRow('muFillsListHost', isSell?'sell':'buy',
          Math.max(1, Math.floor(rand() * (isSell ? Math.max(1,(last.qty||1)) : 15))),
          (5 + rand()*120).toFixed(2));
      }
      if (rand() < 0.12 && $('mu_e_exhausted')) $('mu_e_exhausted').click();
      if (rand() < 0.15){ $('mu_e_toverride_on').click(); set('mu_e_toverride', (rand()*m.splitCount).toFixed(2)); }
      $('mu_e_submit').click();
    },
    deleteMuDay: function(rand){
      var m = pickMu(rand); if (!m || !m.days.length) return 'skip';
      tab('mu');
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(m.name) === 0) { cards[i].click(); break; } }
      var rows = document.querySelectorAll('#mainArea tr[data-day-id]');
      if (!rows.length) return 'skip';
      rows[Math.floor(rand()*rows.length)].querySelector('.mu-day-del').click();
    },
    editMuDay: function(rand){
      var m = pickMu(rand); if (!m || !m.days.length) return 'skip';
      tab('mu');
      var cards = document.querySelectorAll('.instance-card');
      for (var i=0;i<cards.length;i++){ if (cards[i].textContent.indexOf(m.name) === 0) { cards[i].click(); break; } }
      var rows = document.querySelectorAll('#mainArea tr[data-day-id]');
      if (!rows.length) return 'skip';
      var day = m.days[Math.floor(rand()*m.days.length)];
      var ans = [d(rand, day.date, 8), (5+rand()*120).toFixed(2)], ai = 0;
      window.prompt = function(){ return ans[ai++]; };
      var target = null;
      rows.forEach(function(r){ if (r.getAttribute('data-day-id') === day.id) target = r; });
      if (!target) return 'skip';
      target.querySelector('.mu-day-edit').click();
    },
    addHolding: function(rand){
      tab('portfolio');
      $('addHoldingBtn').click();
      var rows = document.querySelectorAll('#manualHoldingsHost tr[data-id]');
      var tr = rows[rows.length-1];
      var tk = tr.querySelector('.h-ticker');
      tk.value = ['AAPL','NVDA','MSFT','GOOG'][Math.floor(rand()*4)];
      tk.dispatchEvent(new Event('change',{bubbles:true}));
    },
    addTrade: function(rand){
      tab('portfolio');
      if (!$('tradeSubmitBtn')) return 'skip';
      var sel = $('tr_ticker');
      if (!sel.options.length) return 'skip';
      sel.selectedIndex = Math.floor(rand()*sel.options.length);
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      set('tr_type', rand() < 0.35 ? 'sell' : 'buy');
      set('tr_qty', 1 + Math.floor(rand()*20));
      set('tr_price', (20 + rand()*300).toFixed(2));
      set('tr_date', d(rand, '2026-08-01', 40));
      $('tradeSubmitBtn').click();
    },
    deleteTrade: function(rand){
      tab('portfolio');
      var btns = document.querySelectorAll('.trade-del');
      if (!btns.length) return 'skip';
      btns[Math.floor(rand()*btns.length)].click();
    },
    editTrade: function(rand){
      tab('portfolio');
      var btns = document.querySelectorAll('.trade-edit');
      if (!btns.length) return 'skip';
      var ans = [String(1+Math.floor(rand()*20)), (20+rand()*300).toFixed(2), d(rand,'2026-08-01',40), rand()<0.35?'매도':'매수'], ai=0;
      window.prompt = function(){ return ans[ai++]; };
      btns[Math.floor(rand()*btns.length)].click();
    },
    cashIn: function(rand){
      tab('portfolio');
      set('cashLogType', rand()<0.5?'in':'out');
      set('cashLogAmount', 100 + Math.floor(rand()*5000));
      set('cashLogDate', d(rand,'2026-07-01',60));
      $('cashLogAddBtn').click();
    },
    cashDel: function(rand){
      tab('portfolio');
      var btns = document.querySelectorAll('.cash-del');
      if (!btns.length) return 'skip';
      btns[Math.floor(rand()*btns.length)].click();
    },
    switchTab: function(rand){
      tab(['vr','mu','portfolio','pnl'][Math.floor(rand()*4)]);
    }
  };
  var NAMES = Object.keys(ACTIONS);

  window.__fuzz = function(steps, seed){
    var rand = rng(seed);
    var log = [], failures = [];
    window.confirm = function(){ return true; };
    window.alert = function(){};
    for (var i=0;i<steps;i++){
      var name = NAMES[Math.floor(rand()*NAMES.length)];
      // 초반엔 만들기 위주로
      if (i < 4) name = (i % 2 === 0) ? 'createVR' : 'createMu';
      var entry = { step: i, action: name };
      try {
        var r = ACTIONS[name](rand);
        entry.skipped = (r === 'skip');
      } catch(e){
        entry.threw = String(e && e.message || e);
        failures.push({ step: i, action: name, kind: '예외', detail: entry.threw, log: log.slice(-6) });
      }
      log.push(entry);
      var bad = [];
      try { bad = checkAll(); } catch(e){ bad = ['검사 자체가 터짐: ' + e.message]; }
      if (bad.length){
        failures.push({ step: i, action: name, kind: '불변식', detail: bad.slice(0,4), log: log.slice(-6) });
        // 같은 위반이 계속 쌓이면 의미가 없으니 여기서 멈춘다
        break;
      }
    }
    return {
      seed: seed, steps: log.length,
      실행: log.filter(function(x){ return !x.skipped && !x.threw; }).length,
      건너뜀: log.filter(function(x){ return x.skipped; }).length,
      실패: failures,
      콘솔오류: window.__errors.slice()
    };
  };
})();
