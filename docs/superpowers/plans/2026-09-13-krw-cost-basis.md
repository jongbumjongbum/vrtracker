# 원화 원가·손익 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원화로 적립 매수한 종목의 실제 낸 원화를 저장해서, 원화 기준 손익과 달러 기준 손익을 나란히 볼 수 있게 한다.

**Architecture:** 거래(`trade`)에 `krwAmount` 한 필드를 더한다. 원화 매수는 밖에서 들어온 원화로 결제되므로 달러 예수금이 줄면 안 된다 — 매수가 깎은 금액과 똑같은 입금 줄을 `tradeId`로 묶어 자동 생성해 상쇄한다. 원화 원가는 저장하지 않고 `computeKrwBasis(h)`가 거래 목록에서 매번 다시 계산한다 (달러 원가를 다루는 `replayManualHolding`과 같은 방식).

**Tech Stack:** 단일 파일 바닐라 JS (`index.html`, ES5 문법 — `var`/`function`만, 화살표 함수·템플릿 리터럴 없음). 빌드 없음. 검사는 브라우저에서 UI를 직접 조작하는 방식 (`test/`).

**Spec:** `docs/superpowers/specs/2026-09-13-krw-cost-basis-design.md`

## Global Constraints

- **ES5 문법만** — `var`, `function(){}`. `let`/`const`/화살표 함수/템플릿 리터럴/`class` 금지. 기존 코드와 같은 스타일.
- **새 필드는 전부 선택 사항** — 없으면 지금과 100% 같게 동작해야 한다. 정규화 단계에서 기본값 0을 채워 넣지 않는다 ("입력 안 함"과 "0원"을 구분해야 화면에서 "미입력분 제외"를 띄울 수 있다).
- **원화 금액은 항상 원 단위 그대로** 저장·표시한다. `inputValueToUsd`/`usdToInputValue`를 통과시키지 않는다 — 실제로 낸 돈이라 달러로 환산하면 다시 환율에 흔들린다.
- **자동 입금 줄의 금액은 달러**(`qty × price`)다. 원화 금액이 아니다. 매수가 예수금에서 뺀 것과 같은 단위여야 정확히 0으로 상쇄된다.
- **총자산·도넛·손익 탭은 건드리지 않는다.** 달러 기준 유지, QLD는 총자산에 계속 포함.
- **커밋 메시지는 한국어 서술형** (저장소 기존 스타일: "배당금을 예수금에 반영한다"). `feat:` 같은 접두사 쓰지 않는다. 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` 한 줄.

## 검사 방식에 대하여

이 저장소에는 단위 테스트 실행기가 없다. `index.html`의 함수는 전부 IIFE 안에 있어 밖에서 부를 수 없다. 기존 검사(`test/fuzz.js`)는 **UI를 실제로 조작하고 `localStorage`의 상태를 확인**하는 방식이다. 이 계획의 테스트도 같은 방식을 따른다 — 함수를 직접 부르지 않고 화면을 조작한 뒤 저장된 상태를 본다.

**검사 돌리는 법** (모든 Task 공통):

```bash
python3 -m http.server 8731
```

브라우저에서 `http://127.0.0.1:8731/test/run.html` 을 열고, 개발자 도구 콘솔에서:

```js
var s=document.createElement('script'); s.src='krw.js'; document.body.appendChild(s);
```

붙은 뒤 `__krwTest()` 를 실행한다. `[]` 가 나오면 통과, 문자열이 들어 있으면 그게 실패 이유다.

**검사 하네스에서 걸려 넘어지기 쉬운 것 (확인함):**

- **앱은 `state` 를 메모리에 들고 있다.** `localStorage` 를 고쳐도 화면은 안 바뀐다. 데이터를 심을 때는 반드시 UI 를 조작해야 한다 (읽기만 `localStorage` 로 한다 — `saveState()` 가 즉시 써주므로 읽기는 안전하다).
- **가짜 서버 사본이 `localStorage.__fakeCloud` 에 따로 있다.** 로컬만 지우면 서버 사본이 다시 내려와 기록이 살아난다. 비울 때는 `localStorage.clear()` 로 통째로 지운다. 로그인은 `stub.js` 가 자동으로 해준다.
- **환율은 가짜 서버가 `1385.5` 로 준다** (`test/stub.js:101`). 앱이 켜질 때 자동으로 받아둔다. 검사에서 다른 값으로 덮으려 하지 말고 이 값을 쓴다.
- **시세는 `TQQQ / SOXL / AAPL / NVDA` 네 개만 준다** (`test/stub.js:95`). 그 외 티커는 실시간 값이 없어 `h.currentPrice` 가 쓰인다 — 검사에서 현재가를 마음대로 정하려면 이 네 개를 피한다.
- **매수를 기록하면 그 가격이 현재가로도 들어간다** (`h.currentPrice = price`). 시세가 안 잡히는 티커는 따로 현재가를 넣지 않아도 된다.
- **표를 다시 그리면 앞서 잡아둔 `tr` 은 버려진 DOM 이다.** 조작 사이마다 다시 찾아야 한다.

## 파일 구조

| 파일 | 역할 | 변경 |
|---|---|---|
| `index.html` | 앱 전체 (단일 파일) | 수정 — 아래 5곳 |
| `test/krw.js` | 원화 매수 시나리오 검사 | **신규** |
| `test/fuzz.js` | 무작위 조작 + 불변식 | 수정 — 불변식 3종, 조작 1종 |
| `test/README.md` | 검사 설명서 | 수정 — `krw.js` 문단 추가 |

`index.html` 안에서 손대는 지점:

| 위치 | 무엇 |
|---|---|
| `pushCashLog` 바로 뒤 (1825 부근) | `syncKrwDeposit` 신규 |
| `manualHoldingSeed` 바로 뒤 (1875 부근) | `computeKrwBasis`, `fmtKrw0` 신규 |
| 예수금 변동내역 행 만들기 (3777 부근) | 짝 입금 줄은 삭제 버튼 감추기 |
| 매수/매도 기록 폼 + 핸들러 (3982~4070) | 낸 원화 칸, 등록·수정·삭제 처리 |
| `renderManualHoldingsTable` (5045 부근) | 원화 칸 3개, `₩적립` 표시 |

---

### Task 1: 원화 매수를 기록하면 예수금이 그대로 남는다

지금 `mutateManualTrades`는 매수를 기록할 때마다 `extraCash`를 매수액만큼 깎는다. 원화로 산 건은 달러 예수금이 아니라 밖에서 들어온 원화로 결제된 것이라 깎이면 안 된다. 같은 금액의 입금 줄을 자동으로 붙여 상쇄한다.

**Files:**
- Modify: `index.html:1825` (`pushCashLog` 바로 뒤에 `syncKrwDeposit` 추가)
- Modify: `index.html:3980-3990` (매수/매도 기록 폼)
- Modify: `index.html:4048-4070` (`tradeSubmitBtn` 핸들러)
- Test: `test/krw.js` (신규)

**Interfaces:**
- Produces: `syncKrwDeposit(tradeId, t)` — `t`는 거래 객체 또는 `null`. 이 거래에 딸린 자동 입금 줄을 있어야 할 상태로 맞추고 `extraCash`를 그만큼 보정한다. `t`가 `null`이거나 원화 매수가 아니면 줄을 없앤다. Task 2가 수정·삭제에서, Task 5가 검사에서 쓴다.
- Produces: 거래 객체의 선택 필드 `krwAmount` (number, 원 단위). Task 3의 `computeKrwBasis`가 읽는다.
- Produces: `cashLog` 항목의 선택 필드 `tradeId` (string). Task 2가 읽는다.

- [ ] **Step 1: 검사 파일을 만들고 첫 케이스를 쓴다 (실패하는 상태)**

`test/krw.js` 를 새로 만든다:

```js
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
```

- [ ] **Step 2: 검사를 돌려 실패를 확인한다**

로컬 서버를 켜고 `test/run.html` 콘솔에서 `krw.js` 를 붙인 뒤:

```js
__krwReset()
```

새로고침되면 다시 `krw.js` 를 붙이고:

```js
__krwTest()
```

예상: `krwBuyKeepsCash 에서 예외: no #tr_krw` — 아직 원화 칸이 없다.

- [ ] **Step 3: `syncKrwDeposit` 을 추가한다**

`index.html` 의 `pushCashLog` 함수 바로 뒤(1825 부근)에 넣는다:

```js
  // 원화로 산 매수는 달러 예수금이 아니라 밖에서 들어온 원화로 결제된다.
  // 그런데 mutateManualTrades 는 매수액만큼 예수금을 깎으므로, 같은 금액의
  // 입금 줄을 붙여 되돌려 놓는다 (순효과 0). 가짜 보정이 아니라 진짜 입금
  // 줄이라 "예수금 = 입출금 + 매매 누적" 불변식도 그대로 성립한다.
  // 입금액은 원화가 아니라 달러(qty*price)다 — 매수가 뺀 것과 같은 단위라야
  // 정확히 0 이 된다. 원화 금액은 사람이 읽는 메모로만 남는다.
  // t 가 null 이거나 원화 매수가 아니면 짝 줄을 없앤다.
  function syncKrwDeposit(tradeId, t){
    var log = state.portfolio.cashLog;
    var i = -1;
    for (var k = 0; k < log.length; k++){ if (log[k].tradeId === tradeId){ i = k; break; } }
    var want = (t && t.type === "buy" && t.krwAmount > 0) ? round4(t.qty * t.price) : 0;
    var had = i !== -1 ? log[i].amount : 0;
    state.portfolio.extraCash = round4((state.portfolio.extraCash || 0) + want - had);
    if (!want){
      if (i !== -1) log.splice(i, 1);
      return;
    }
    var note = "원화 적립 ₩" + Math.round(t.krwAmount).toLocaleString("ko-KR");
    if (i !== -1){
      log[i].amount = want; log[i].date = t.date; log[i].note = note;
    } else {
      log.push({ id: uid(), date: t.date, kind: "입금", amount: want, note: note, tradeId: tradeId });
    }
    log.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
  }
```

- [ ] **Step 4: 폼에 "낸 원화" 칸을 더한다**

`index.html:3982` 부근, 5칸짜리 `form-grid` 를 6칸으로 바꾸고 칸 하나를 끼워 넣는다:

```js
        ? ('<div class="form-grid" style="grid-template-columns:repeat(6,1fr);align-items:end;">' +
            field("종목", '<select id="tr_ticker">' + tickerOptions + '</select>') +
            field("구분", '<select id="tr_type"><option value="buy">매수</option><option value="sell">매도</option></select>') +
            field("수량", '<input id="tr_qty" type="number" autocomplete="off" inputmode="decimal" step="0.0001" placeholder="예: 10" />') +
            field("가격 ($)", '<input id="tr_price" type="number" autocomplete="off" inputmode="decimal" step="0.0001" placeholder="예: 230.5" />') +
            field("낸 원화 (₩)", '<input id="tr_krw" type="number" autocomplete="off" inputmode="numeric" step="1" min="0" placeholder="원화로 샀을 때만" />') +
            field("날짜", '<input id="tr_date" type="date" autocomplete="off" value="' + todayStr() + '" />') +
          '</div>' +
```

바로 위 `card-desc`(3981 부근)에 한 문장을 더한다:

```js
        '<div class="card-desc">여기서 매수·매도를 기록하면 수량·매입평균가·실현손익이 자동 계산되고, 매수한 금액은 "VR 외 예수금"에서 빠지고 매도한 금액은 더해져요.<br>' +
        '<b>원화 주식모으기로 샀으면 [낸 원화]에 실제 결제된 원화를 적어주세요.</b> 밖에서 새로 넣은 돈이라 예수금은 그대로 두고, 원화 기준 손익을 따로 계산해요.</div>' +
```

- [ ] **Step 5: 등록 핸들러가 원화를 읽고 짝 입금 줄을 만들게 한다**

`index.html:4048` 의 `tradeSubmitBtn` 핸들러를 이렇게 바꾼다:

```js
      document.getElementById("tradeSubmitBtn").addEventListener("click", function(){
        var hId = document.getElementById("tr_ticker").value;
        var type = document.getElementById("tr_type").value;
        var qty = parseFloat(document.getElementById("tr_qty").value);
        var price = parseFloat(document.getElementById("tr_price").value);
        var date = document.getElementById("tr_date").value || todayStr();
        var krwRaw = document.getElementById("tr_krw").value;
        var krw = krwRaw === "" ? null : parseFloat(krwRaw);
        if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0){ alert("수량과 가격을 입력해주세요."); return; }
        if (krw !== null && (isNaN(krw) || krw <= 0)){
          alert("낸 원화는 0보다 큰 숫자여야 해요. 원화로 산 게 아니면 비워두세요.");
          return;
        }
        var h = manual.find(function(x){ return x.id === hId; });
        if (!h) return;
        if (type === "sell" && (h.qty||0) <= 0){ alert("팔 수량이 없어요."); return; }
        var tradeId = uid();
        mutateManualTrades(h, function(trades){
          var t = { id: tradeId, date: date, type: type, qty: qty, price: price };
          // 원화 금액은 매수에만 붙인다 — 원화 기준 실현손익은 아직 다루지 않는다.
          if (type === "buy" && krw !== null) t.krwAmount = krw;
          trades.push(t);
          trades.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
        });
        var rec = h.trades.find(function(t){ return t.id === tradeId; });
        // mutateManualTrades 가 예수금을 이미 움직인 뒤라야 상쇄가 맞는다.
        syncKrwDeposit(tradeId, rec);
        h.currentPrice = price;
        // 매도는 보유수량까지만 기록된다 (replayManualHolding이 잘라낸다).
        if (type === "sell" && rec && rec.qty < qty){
          alert("보유수량보다 많이 입력해서 " + rec.qty + "주만 매도로 기록했어요.");
        }
        saveState();
        renderMain();
      });
```

- [ ] **Step 6: 매도를 고르면 원화 칸을 잠근다**

같은 `if (tradeableHoldings.length){` 블록 안, `tradeSubmitBtn` 리스너 바로 뒤에 넣는다:

```js
      // 원화 기준 실현손익은 범위 밖이라, 매도에는 원화를 받지 않는다.
      // 칸이 열려 있으면 적어도 무시되는데, 적은 사람은 반영된 줄 안다.
      var trTypeEl = document.getElementById("tr_type");
      var trKrwEl = document.getElementById("tr_krw");
      function syncKrwFieldEnabled(){
        var isSell = trTypeEl.value === "sell";
        trKrwEl.disabled = isSell;
        if (isSell) trKrwEl.value = "";
      }
      trTypeEl.addEventListener("change", syncKrwFieldEnabled);
      syncKrwFieldEnabled();
```

- [ ] **Step 7: 검사를 돌려 통과를 확인한다**

콘솔에서 `__krwReset()` → 새로고침 → `krw.js` 다시 붙이기 → `__krwTest()`.

예상: `[]`

- [ ] **Step 8: 기존 검사가 깨지지 않았는지 본다**

같은 콘솔에서 fuzz 를 붙이고 돌린다:

```js
var s=document.createElement('script'); s.src='fuzz.js'; document.body.appendChild(s);
```

```js
JSON.stringify(__fuzz(80, 1))
```

예상: `"실패":[]` — 예수금 불변식이 그대로 성립해야 한다 (아직 fuzz 는 원화 칸을 쓰지 않으므로 기존 동작만 확인하는 것이다).

- [ ] **Step 9: 커밋**

```bash
git add index.html test/krw.js
git commit -F - <<'MSG'
원화로 산 매수는 예수금을 건드리지 않는다

주식모으기로 원화 결제한 매수는 달러 예수금이 아니라 밖에서 새로
들어온 원화로 산 것이라 예수금이 줄면 안 된다. 매수가 깎은 금액과
같은 입금 줄을 거래에 묶어 자동으로 남겨 상쇄한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 거래를 고치거나 지우면 짝 입금 줄도 따라간다

Task 1 은 만들기만 했다. 거래를 수정·삭제하면 짝 줄이 떠돌면서 예수금이 어긋난다. 네 경우를 모두 처리한다.

| 고치기 전 | 고친 뒤 | 결과 |
|---|---|---|
| 원화 없음 | 원화 있음 | 입금 줄을 새로 만든다 |
| 원화 있음 | 원화 있음 | 금액·날짜·메모를 고친다 |
| 원화 있음 | 원화 없음 | 입금 줄을 지운다 (예수금이 매수액만큼 줄어든다) |
| (거래 삭제) | — | 입금 줄도 같이 지운다 |

**Files:**
- Modify: `index.html:3777` (예수금 변동내역 행 — 짝 줄은 삭제 버튼 감추기)
- Modify: `index.html:4005-4017` (`.trade-del` 핸들러)
- Modify: `index.html:4019-4044` (`.trade-edit` 핸들러)
- Test: `test/krw.js` (케이스 추가)

**Interfaces:**
- Consumes: Task 1 의 `syncKrwDeposit(tradeId, t)`, 거래의 `krwAmount`, `cashLog` 항목의 `tradeId`.

- [ ] **Step 1: 실패하는 검사 케이스 4개를 더한다**

`test/krw.js` 의 `CASES.usdBuyStillSpendsCash` 정의 바로 뒤, `window.__krwTest` 선언 앞에 넣는다. 먼저 `prompt` 를 가로채는 도우미를 `linkedRows` 함수 뒤에 더한다:

```js
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
```

그리고 케이스들:

```js
  // 원화를 안 적었던 매수에 원화를 적으면 짝 입금 줄이 새로 생기고
  // 예수금은 0 으로 돌아온다.
  CASES.editAddKrw = function(bad){
    var hId = addHolding('AAA');
    recordTrade(hId, 'buy', 2, 100, null, '2026-09-01');
    editTrade(hId, ['2', '100', '260000', '2026-09-01', '매수']);
    var s = st();
    if (!near(s.portfolio.extraCash, 0)) bad.push('원화를 더한 뒤 예수금이 0이 아님: ' + s.portfolio.extraCash);
    var t = holding(hId).trades[0];
    if (t.krwAmount !== 260000) bad.push('krwAmount 가 안 붙음: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 1) bad.push('짝 입금 줄이 1개가 아님');
  };

  // 원화 금액과 수량을 같이 고치면 짝 입금 줄의 금액도 따라간다.
  CASES.editChangeKrw = function(bad){
    var hId = addHolding('BBB');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    editTrade(hId, ['3', '100', '390000', '2026-09-02', '매수']);
    var s = st();
    if (!near(s.portfolio.extraCash, 0)) bad.push('고친 뒤 예수금이 0이 아님: ' + s.portfolio.extraCash);
    var t = holding(hId).trades[0];
    if (t.krwAmount !== 390000) bad.push('krwAmount 가 안 바뀜: ' + t.krwAmount);
    var linked = linkedRows(t.id);
    if (linked.length !== 1){ bad.push('짝 입금 줄이 1개가 아님'); return; }
    if (!near(linked[0].amount, 300)) bad.push('짝 입금액이 300 이 아님: ' + linked[0].amount);
    if (linked[0].date !== '2026-09-02') bad.push('짝 줄 날짜가 안 따라감: ' + linked[0].date);
  };

  // 원화를 지우면 달러로 산 것이 되어 예수금에서 매수액이 빠진다.
  CASES.editRemoveKrw = function(bad){
    var hId = addHolding('CCC');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    editTrade(hId, ['2', '100', '', '2026-09-01', '매수']);
    var s = st();
    if (!near(s.portfolio.extraCash, -200)) bad.push('원화를 지운 뒤 예수금이 -200 이 아님: ' + s.portfolio.extraCash);
    var t = holding(hId).trades[0];
    if (t.krwAmount != null) bad.push('krwAmount 가 안 지워짐: ' + t.krwAmount);
    if (linkedRows(t.id).length !== 0) bad.push('짝 입금 줄이 안 지워짐');
  };

  // 거래를 지우면 짝 입금 줄도 같이 사라지고 예수금은 원래대로 돌아온다.
  CASES.deleteKrwTrade = function(bad){
    var hId = addHolding('DDD');
    recordTrade(hId, 'buy', 2, 100, 260000, '2026-09-01');
    var tradeId = holding(hId).trades[0].id;
    deleteTrade(hId);
    var s = st();
    if (!near(s.portfolio.extraCash, 0)) bad.push('거래 삭제 뒤 예수금이 0이 아님: ' + s.portfolio.extraCash);
    if (holding(hId).trades.length !== 0) bad.push('거래가 안 지워짐');
    if (linkedRows(tradeId).length !== 0) bad.push('짝 입금 줄이 남아 있음');
  };
```

- [ ] **Step 2: 검사를 돌려 실패를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: `editAddKrw`, `editChangeKrw`, `editRemoveKrw`, `deleteKrwTrade` 네 개가 실패한다 (수정 폼에 원화 prompt 가 없어 답이 밀리고, 삭제는 짝 줄을 안 지운다).

- [ ] **Step 3: 삭제 핸들러가 짝 줄도 지우게 한다**

`index.html:4011` 의 `mutateManualTrades` 호출 뒤에 한 줄을 더한다:

```js
        mutateManualTrades(f.h, function(trades){
          var i = trades.findIndex(function(x){ return x.id === f.t.id; });
          if (i !== -1) trades.splice(i, 1);
        });
        // 거래가 사라졌으니 거기 딸린 자동 입금 줄도 같이 사라져야 한다.
        syncKrwDeposit(f.t.id, null);
        saveState();
        renderMain();
```

- [ ] **Step 4: 수정 핸들러에 원화 prompt 를 더한다**

`index.html:4019` 의 `.trade-edit` 핸들러를 이렇게 바꾼다:

```js
    Array.prototype.forEach.call(manCard.querySelectorAll(".trade-edit"), function(btn){
      btn.addEventListener("click", function(){
        var f = findTrade(btn.getAttribute("data-h"), btn.getAttribute("data-t"));
        if (!f) return;
        var qs = prompt("수량", String(f.t.qty));
        if (qs === null) return;
        var ps = prompt("가격 ($)", String(f.t.price));
        if (ps === null) return;
        var ks = prompt("낸 원화 (₩) — 원화로 산 게 아니면 비워두세요", f.t.krwAmount != null ? String(f.t.krwAmount) : "");
        if (ks === null) return;
        var ds = prompt("날짜 (YYYY-MM-DD)", f.t.date);
        if (ds === null) return;
        var ts = prompt('구분: "매수" 또는 "매도"', f.t.type === "buy" ? "매수" : "매도");
        if (ts === null) return;
        var nq = parseFloat(qs), np = parseFloat(ps);
        var nt = (ts.trim() === "매도" || ts.trim().toLowerCase() === "sell") ? "sell" : "buy";
        var nk = ks.trim() === "" ? null : parseFloat(ks);
        if (isNaN(nq) || nq <= 0 || isNaN(np) || np <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(ds.trim())){
          alert("수량·가격은 0보다 큰 숫자, 날짜는 YYYY-MM-DD 형식이어야 해요.");
          return;
        }
        if (nk !== null && (isNaN(nk) || nk <= 0)){
          alert("낸 원화는 0보다 큰 숫자여야 해요. 원화로 산 게 아니면 비워두세요.");
          return;
        }
        mutateManualTrades(f.h, function(trades){
          var t = trades.find(function(x){ return x.id === f.t.id; });
          t.qty = nq; t.price = np; t.date = ds.trim(); t.type = nt;
          // 매도로 바꾸면 원화 금액은 의미가 없어진다.
          if (nt === "buy" && nk !== null) t.krwAmount = nk;
          else delete t.krwAmount;
          trades.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
        });
        // 예수금이 새 매수액으로 갱신된 뒤라야 상쇄 금액이 맞는다.
        var updated = (f.h.trades || []).find(function(x){ return x.id === f.t.id; });
        syncKrwDeposit(f.t.id, updated);
        saveState();
        renderMain();
      });
    });
```

- [ ] **Step 5: 짝 입금 줄은 목록에서 직접 못 지우게 한다**

자동으로 만든 줄을 손으로 지우면 예수금이 매수액만큼 틀어진다. `index.html:3777` 의 `allCashRows` 를 바꾼다:

```js
    var allCashRows = state.portfolio.cashLog
      .filter(function(e){ return e.kind === "입금" || e.kind === "출금" || e.kind === "배당금"; })
      // 거래에 딸려 자동으로 생긴 입금 줄은 여기서 지우면 예수금이 어긋난다.
      // 거래를 지우거나 고치면 알아서 따라가므로 "자동"으로만 보여준다.
      .map(function(e){ return { id: e.id, date: e.date, kind: e.kind, amount: e.amount, note: e.note, canDelete: !e.tradeId }; })
      .concat(derivedCashRows)
      .sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
```

- [ ] **Step 6: 검사를 돌려 통과를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: `[]`

- [ ] **Step 7: 커밋**

```bash
git add index.html test/krw.js
git commit -F - <<'MSG'
원화 매수를 고치거나 지우면 짝 입금 줄도 따라간다

원화를 새로 적거나 지우거나 금액을 바꾸는 네 경우를 모두 다룬다.
자동으로 생긴 입금 줄은 변동내역에서 직접 지울 수 없게 했다 —
지우면 예수금이 매수액만큼 조용히 어긋난다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 원화 원가와 원화 손익을 표에 보여준다

**Files:**
- Modify: `index.html:1875` 부근 (`manualHoldingSeed` 뒤에 `computeKrwBasis`, `fmtKrw0` 추가)
- Modify: `index.html:5045` (`renderManualHoldingsTable`)
- Test: `test/krw.js` (케이스 추가)

**Interfaces:**
- Produces: `computeKrwBasis(h)` → `{ krwQty: number, krwCost: number }`. `krwQty`는 원화 원가가 기록된 수량, `krwCost`는 그 수량에 들어간 원화 총액. Task 4 가 `krwSeedCost`/`krwSeedQty` 를 채워 넣고, Task 5 가 같은 계산을 검사에서 다시 한다.
- Produces: `fmtKrw0(n)` → `"₩1,240,000"` 꼴 문자열. `null`/`NaN` 이면 `"–"`.
- Consumes: Task 1 의 `krwAmount`. Task 4 의 `h.krwSeedCost`/`h.krwSeedQty` (아직 없으므로 `|| 0`).

- [ ] **Step 1: 실패하는 검사 케이스를 더한다**

`test/krw.js` 의 도우미 자리에 표를 읽는 함수를 더한다 (`linkedRows` 뒤):

```js
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
```

케이스:

```js
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
    // 4주 x $110 x 1385.5 = 609,620 → 손익 +49,620
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
```

- [ ] **Step 2: 검사를 돌려 실패를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: `krwBasisAndPnl 에서 예외: "원화 원가" 칸을 못 찾음` 등 세 개 실패.

- [ ] **Step 3: 계산 함수를 추가한다**

`index.html` 의 `manualHoldingSeed` 함수 바로 뒤(1875 부근)에 넣는다:

```js
  // 원화 금액은 보기 통화와 상관없이 언제나 원으로 적는다. 실제로 낸 돈이라
  // 달러로 환산해 보여주면 그 숫자가 다시 오늘 환율에 흔들린다.
  function fmtKrw0(n){
    if (n == null || isNaN(n)) return "–";
    return (n < 0 ? "-" : "") + "₩" + Math.round(Math.abs(n)).toLocaleString("ko-KR");
  }
  // 원화로 산 물량의 원가를 따로 센다. replayManualHolding 과 같은 순서로
  // 거래를 훑되, 낸 원화가 적힌 매수만 원가에 넣는다. 매도는 평균단가 방식과
  // 똑같이 비례로 덜어낸다 — 그래야 달러 원가와 원화 원가가 어긋나지 않는다.
  // krwQty 가 전체 수량보다 작으면 원화를 안 적은 물량이 섞여 있다는 뜻이라,
  // 화면에서 "미입력분 제외"라고 알려준다.
  function computeKrwBasis(h){
    var seed = manualHoldingSeed(h);
    var qty = seed.qty;
    var krwQty = h.krwSeedQty || 0;
    var krwCost = h.krwSeedCost || 0;
    (h.trades || []).forEach(function(t){
      if (t.type === "buy"){
        qty += t.qty;
        if (t.krwAmount > 0){ krwQty += t.qty; krwCost += t.krwAmount; }
      } else {
        var sq = Math.min(t.qty, qty);
        var f = qty > 0 ? sq / qty : 0;
        krwQty = krwQty * (1 - f);
        krwCost = krwCost * (1 - f);
        qty -= sq;
      }
    });
    return { krwQty: krwQty, krwCost: krwCost };
  }
```

- [ ] **Step 4: 표에 칸 두 개와 표시를 더한다**

`index.html:5045` `renderManualHoldingsTable` 안, `var hKey = "hold:" + h.id;` 줄 앞에 넣는다:

```js
      var kb = computeKrwBasis(h);
      var fxRate = (state.fx && state.fx.usdkrw) ? state.fx.usdkrw : null;
      var hasKrw = kb.krwCost > 0;
      var krwCostCell = hasKrw ? fmtKrw0(kb.krwCost) : '<span class="footnote">–</span>';
      var krwPnlCell = '<span class="footnote">–</span>';
      var krwPnlCls = "var(--ink-soft)";
      if (hasKrw && fxRate == null){
        krwPnlCell = '<span class="footnote">환율 필요</span>';
      } else if (hasKrw){
        var krwValue = kb.krwQty * effPrice * fxRate;
        var krwProfit = krwValue - kb.krwCost;
        var krwPct = (krwProfit / kb.krwCost) * 100;
        krwPnlCls = krwProfit > 0 ? "var(--buy)" : (krwProfit < 0 ? "var(--sell)" : "var(--ink-soft)");
        krwPnlCell = (krwProfit > 0 ? "+" : "") + fmtKrw0(krwProfit) +
          ' <span class="footnote" style="display:inline;">' + fmtPct(krwPct, 1) + '</span>' +
          // 원화를 안 적은 물량이 섞여 있으면 이 손익은 일부만 센 것이다.
          (kb.krwQty < (h.qty || 0) - 1e-6
            ? ' <span class="footnote" style="display:inline;">원화 원가 미입력분 제외</span>'
            : '');
      }
```

같은 함수의 `rowHeadCell(...)` 줄을 바꿔 `₩적립` 표시를 붙인다:

```js
        rowHeadCell(hKey,
          escapeHtml(h.ticker || "새 종목") +
            (hasKrw ? ' <span class="footnote" style="display:inline;">₩적립</span>' : ''),
          headSub) +
```

`실현손익` 칸(`<td ... data-label="실현손익">`) 바로 뒤에 두 칸을 끼워 넣는다:

```js
        '<td class="num" data-label="원화 원가">' + krwCostCell + '</td>' +
        '<td class="num" data-label="원화 손익" style="color:' + krwPnlCls + '">' + krwPnlCell + '</td>' +
```

머리글 줄(`host.innerHTML = ...` 의 `<thead>`)에도 같은 자리에 두 개를 더한다:

```js
    host.innerHTML = '<div class="table-wrap"><table class="stack-mobile collapsible-rows"><thead><tr>' +
      '<th>티커</th><th class="num">수량</th><th class="num">매입평균가</th><th class="num">현재가</th>' +
      '<th class="num">평가금</th><th class="num">미실현 수익금</th><th class="num">미실현 수익률</th><th class="num">실현손익</th>' +
      '<th class="num">원화 원가</th><th class="num">원화 손익</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
```

- [ ] **Step 5: 검사를 돌려 통과를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: `[]`

- [ ] **Step 6: 커밋**

```bash
git add index.html test/krw.js
git commit -F - <<'MSG'
원화로 산 물량의 원가와 손익을 종목 표에 보여준다

낸 원화를 그대로 더해 원가를 세고, 오늘 환율로 환산한 평가금과의
차이를 원화 손익으로 보여준다. 원화를 안 적은 물량이 섞여 있으면
그 몫은 빼고 계산했다고 칸에 적는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 앱에 기록하기 전부터 갖고 있던 물량의 원화 원가

지금 QLD 는 표에서 수량만 직접 고쳐 쌓아왔다. `manualHoldingSeed` 가 그 물량을 "거래 기록 이전의 출발 상태"로 돌려주므로 수량·평단은 그대로 보존된다. 다만 그 물량에 들어간 원화를 앱이 알 길이 없어서, 한 번만 적을 수 있는 칸을 둔다.

**Files:**
- Modify: `index.html:5045` (`renderManualHoldingsTable` — 칸 하나와 핸들러)
- Test: `test/krw.js` (케이스 추가)

**Interfaces:**
- Produces: `h.krwSeedCost` (number, 원), `h.krwSeedQty` (number, 주). Task 3 의 `computeKrwBasis` 가 읽는다. 둘은 항상 같이 쓰거나 같이 없다.

- [ ] **Step 1: 실패하는 검사 케이스를 더한다**

`test/krw.js` 도우미에 칸을 채우는 함수를 더한다:

```js
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
```

케이스:

```js
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
    // 10주 x $100 x 1385.5 = 1,385,500 → 손익 +215,500
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
```

- [ ] **Step 2: 검사를 돌려 실패를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: 세 케이스 모두 `기존분 원화원가 칸을 못 찾음` 으로 실패.

- [ ] **Step 3: 표에 칸을 더한다**

`index.html` `renderManualHoldingsTable` 의 `원화 손익` 칸 바로 뒤에 넣는다:

```js
        '<td class="num" data-label="기존분 원화원가"><input type="number" autocomplete="off" inputmode="numeric" step="1" min="0" class="cell-input h-krwseed" value="' + (h.krwSeedCost || "") + '" placeholder="모르면 비워두기" /></td>' +
```

머리글에도 같은 자리에:

```js
      '<th class="num">원화 원가</th><th class="num">원화 손익</th><th class="num">기존분 원화원가</th><th></th>' +
```

- [ ] **Step 4: 핸들러를 붙인다**

같은 함수 아래쪽, `tr.querySelector(".h-cost")` 리스너 바로 뒤에 넣는다:

```js
      // 이 앱에 매수 기록을 넣기 전부터 갖고 있던 물량에 들어간 원화.
      // 대응 수량은 사용자가 따로 적지 않고, 거래 기록을 되감은 출발 수량을
      // 그대로 쓴다 — 그 수량이 곧 "기록 없이 쌓여 있던 물량"이다.
      tr.querySelector(".h-krwseed").addEventListener("change", function(){
        var v = parseFloat(this.value);
        if (isNaN(v) || v <= 0){
          delete h.krwSeedCost; delete h.krwSeedQty;
          commit();
          return;
        }
        var seedQty = manualHoldingSeed(h).qty;
        if (seedQty <= 0){
          alert("이 종목은 매수 기록만으로 쌓인 물량이라 따로 적을 기존분이 없어요.\n\n" +
            "각 매수 기록의 [낸 원화]에 적어주세요.");
          this.value = "";
          return;
        }
        h.krwSeedCost = v;
        h.krwSeedQty = seedQty;
        commit();
      });
```

- [ ] **Step 5: 안내 문구를 더한다**

`index.html:3974` 부근 `manCard.innerHTML` 의 `card-desc` 마지막 줄 뒤에 한 문장을 더한다:

```js
        '표의 <b>실현손익 칸은 아래 매수/매도 기록으로 확정된 것만</b> 보여줘요 — 손익 탭에 직접 적은 "이 앱 쓰기 전 실현손익"은 여기 안 들어가요. 전체 실현손익은 <b>손익 탭</b>에서 기간을 "전체"로 놓고 보세요.<br>' +
        '<b>기존분 원화원가</b>는 이 앱에 매수 기록을 넣기 전부터 갖고 있던 물량에 들어간 원화 총액이에요 (증권사 앱의 총 매수금액). 적으면 그 물량까지 원화 손익에 들어와요. 모르면 비워두세요 — 앞으로 기록하는 매수분만 계산해요.</div>' +
```

- [ ] **Step 6: 검사를 돌려 통과를 확인한다**

`__krwReset()` → 새로고침 → `krw.js` 붙이기 → `__krwTest()`

예상: `[]`

- [ ] **Step 7: 커밋**

```bash
git add index.html test/krw.js
git commit -F - <<'MSG'
앱에 기록하기 전부터 갖고 있던 물량의 원화 원가를 적을 수 있게

수량만 직접 고쳐 쌓아온 물량은 들어간 원화를 앱이 알 길이 없다.
종목마다 한 번 적는 칸을 두고, 대응 수량은 거래 기록을 되감은
출발 수량을 그대로 쓴다. 기존 물량이 없으면 받지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 자동 검사기가 원화 원가까지 본다

`test/krw.js` 는 정해진 시나리오만 본다. 무작위 조작 중에도 깨지지 않는지는 `fuzz.js` 가 봐야 한다.

**Files:**
- Modify: `test/fuzz.js` (불변식 3종, `addTrade` 조작)
- Modify: `test/README.md` (설명 추가)

**Interfaces:**
- Consumes: Task 1 의 `krwAmount`/`tradeId`, Task 3 의 계산 규칙 (fuzz 는 앱 함수를 부를 수 없으므로 같은 계산을 따로 적는다 — 규칙이 두 곳에 있으니 한쪽만 고치면 검사가 잡아낸다).

- [ ] **Step 1: 불변식을 더한다 (아직 조작이 없어 통과한다)**

`test/fuzz.js` 의 `(pf.holdings || []).forEach(function(h, hi){` 블록 안, 거래 날짜순 검사 뒤에 넣는다:

```js
      // 원화 원가 — index.html 의 computeKrwBasis 와 같은 규칙을 따로 적는다.
      // 한쪽만 고치면 여기서 어긋나므로 규칙이 조용히 갈라지지 않는다.
      var kq = h.krwSeedQty || 0, kc = h.krwSeedCost || 0, q2 = 0;
      (h.trades||[]).forEach(function(t){
        if (t.type === 'buy'){
          q2 += t.qty;
          if (t.krwAmount > 0){ kq += t.qty; kc += t.krwAmount; }
        } else {
          var sq = Math.min(t.qty, q2), f = q2 > 0 ? sq/q2 : 0;
          kq *= (1-f); kc *= (1-f); q2 -= sq;
        }
      });
      if (kc < -1e-9) bad.push(tag + ' 원화 원가가 음수(' + kc + ')');
      if (kq < -1e-9) bad.push(tag + ' 원화 기록수량이 음수(' + kq + ')');
      if (kq > q2 + 1e-6) bad.push(tag + ' 원화 기록수량(' + kq + ') > 전체 수량(' + q2 + ')');
```

같은 파일, 예수금 불변식 바로 앞(`// 그외 예수금 = ...` 줄 앞)에 넣는다:

```js
    // 원화 매수에는 같은 금액(달러)의 자동 입금 줄이 정확히 하나 붙어 있어야 한다.
    (pf.holdings||[]).forEach(function(h, hi){
      (h.trades||[]).forEach(function(t){
        var linked = (pf.cashLog||[]).filter(function(e){ return e.tradeId === t.id; });
        var want = (t.type === 'buy' && t.krwAmount > 0);
        if (want && linked.length !== 1){
          bad.push('직접입력#' + hi + ' 원화매수의 짝 입금 줄이 ' + linked.length + '개');
        } else if (!want && linked.length !== 0){
          bad.push('직접입력#' + hi + ' 원화매수가 아닌데 짝 입금 줄이 ' + linked.length + '개');
        } else if (want && !near(linked[0].amount, t.qty*t.price, 0.05)){
          bad.push('직접입력#' + hi + ' 짝 입금액(' + linked[0].amount + ') != 매수액(' + (t.qty*t.price).toFixed(2) + ')');
        }
      });
    });
    // 지워진 거래의 짝 입금 줄이 남아 있으면 예수금이 그만큼 부풀어 있다.
    var liveTradeIds = {};
    (pf.holdings||[]).forEach(function(h){ (h.trades||[]).forEach(function(t){ liveTradeIds[t.id] = true; }); });
    (pf.cashLog||[]).forEach(function(e){
      if (e.tradeId && !liveTradeIds[e.tradeId]){
        bad.push('없어진 거래의 짝 입금 줄이 남아 있음 (' + e.tradeId + ')');
      }
    });
```

- [ ] **Step 2: 돌려서 통과하는지 본다**

```js
JSON.stringify(__fuzz(80, 1))
```

예상: `"실패":[]` — 아직 원화 매수를 만들지 않으므로 새 불변식은 전부 빈손으로 통과한다. 여기서 실패가 나면 불변식 자체가 잘못 적힌 것이다.

- [ ] **Step 3: 무작위 조작에 원화 매수를 섞는다**

`test/fuzz.js` 의 `addTrade` 를 바꾼다:

```js
    addTrade: function(rand){
      tab('portfolio');
      if (!$('tradeSubmitBtn')) return 'skip';
      var sel = $('tr_ticker');
      if (!sel.options.length) return 'skip';
      sel.selectedIndex = Math.floor(rand()*sel.options.length);
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      var isSell = rand() < 0.35;
      set('tr_type', isSell ? 'sell' : 'buy');
      set('tr_qty', 1 + Math.floor(rand()*20));
      set('tr_price', (20 + rand()*300).toFixed(2));
      // 원화로 산 매수도 섞는다 — 예수금 상쇄와 원화 원가가 같이 굴러가는지 본다.
      set('tr_krw', (!isSell && rand() < 0.4) ? (10000 + Math.floor(rand()*400000)) : '');
      set('tr_date', d(rand, '2026-08-01', 40));
      $('tradeSubmitBtn').click();
    },
```

- [ ] **Step 4: 여러 씨앗으로 돌린다**

```js
JSON.stringify(__fuzz(120, 1))
```

`localStorage.clear()` 후 새로고침하고 씨앗을 2, 3, 4, 5 로 바꿔가며 반복한다.

예상: 매번 `"실패":[]`

- [ ] **Step 5: 설명서를 고친다**

`test/README.md` 의 "무엇을 검사하나" 목록에서 `직접입력 종목` 항목 뒤에 한 줄을 더한다:

```markdown
- **원화 매수** — 원화 원가가 음수가 아닌지 / 원화로 산 수량이 전체 수량을
  넘지 않는지 / 원화 매수마다 같은 금액의 자동 입금 줄이 정확히 하나 붙어
  있는지 / 지워진 거래의 입금 줄이 남아 있지 않은지
```

같은 파일 "파일" 목록에 한 줄을 더한다:

```markdown
- `krw.js` — 원화 매수 시나리오 검사 (정해진 순서를 밟으며 숫자 확인)
```

"돌리는 법" 문단 끝에 한 문단을 더한다:

````markdown
## 원화 매수 검사 (krw.js)

무작위 조작으로는 잘 안 나오는 경우들 — 원화를 나중에 붙이거나 지우는 수정,
기존분 원화원가 — 을 정해진 순서로 밟아본다. `run.html` 콘솔에서:

```js
var s=document.createElement('script'); s.src='krw.js'; document.body.appendChild(s);
```

`__krwReset()` 으로 상태를 비우면 새로고침되니, 다시 붙인 뒤 `__krwTest()` 를
실행한다. 빈 배열 `[]` 이면 통과다.
````

- [ ] **Step 6: 커밋**

```bash
git add test/fuzz.js test/README.md
git commit -F - <<'MSG'
자동 검사기가 원화 원가와 짝 입금 줄까지 본다

무작위 매수에 원화 결제를 섞고, 원화 원가가 음수가 되거나 원화로 산
수량이 전체를 넘거나 짝 입금 줄이 어긋나거나 남아도는 경우를 잡는다.
원가 계산 규칙을 검사기에도 따로 적어, 한쪽만 고치면 드러나게 했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Self-Review

**스펙 대조**

| 스펙 항목 | 담당 Task |
|---|---|
| 2절 — 낸 원화 저장 | Task 1 |
| 2절 — 기존 흐름 재사용, 새 탭 없음 | Task 1 (기존 폼에 칸만 추가) |
| 2절 — 총자산에서 빼지 않음 | 전 Task (총자산 코드 미변경) |
| 2절 범위 밖 — 원화 실현손익 | Task 1 Step 6 (매도 시 칸 잠금), Task 2 Step 4 (매도 전환 시 `krwAmount` 삭제) |
| 3절 — 기존 기록 보존 | Task 4 (`manualHoldingSeed` 그대로 사용) |
| 3절 — 기존분 원화 원가 1회 입력 | Task 4 |
| 4절 — `krwAmount` | Task 1 |
| 4절 — `krwSeedCost`/`krwSeedQty` | Task 4 |
| 4절 — `cashLog.tradeId` | Task 1 |
| 4절 — 기본값 0 채우지 않음 | Global Constraints + Task 4 (`delete`) |
| 5절 — `computeKrwBasis` | Task 3 |
| 5절 — 매도 비례 차감 | Task 3 |
| 5절 — 원가 0이면 `–` | Task 3 (`noKrwShowsDash`) |
| 5절 — 미입력분 제외 안내 | Task 3 (`partialKrwWarns`) |
| 5절 — 환율 없으면 안내 | Task 3 Step 4 |
| 6절 — 예수금 상쇄 | Task 1 |
| 6절 — 네 가지 수정 경우 | Task 2 |
| 6절 — 기존 예수금 불변식 유지 | Task 1 Step 8, Task 5 |
| 7절 (1) — 폼 6칸 | Task 1 |
| 7절 (2) — 표 칸 + `₩적립` | Task 3 |
| 7절 (3) — 기존분 입력 | Task 4 |
| 7절 — 총자산 통계 미변경 | 해당 코드 미변경 |
| 8절 — 불변식 2종 | Task 5 (3종으로 늘림) |
| 8절 — 손으로 확인할 것 1~5 | 각각 `usdBuyStillSpendsCash`, `krwBuyKeepsCash`, `deleteKrwTrade`, `krwBasisAndPnl`, `seedKrwCost` |

빠진 항목 없음.

**이름 일관성**

`syncKrwDeposit(tradeId, t)` — Task 1 정의, Task 2 사용. `computeKrwBasis(h)` → `{krwQty, krwCost}` — Task 3 정의, Task 4·5 사용. `fmtKrw0(n)` — Task 3 정의·사용. `krwAmount`/`krwSeedCost`/`krwSeedQty`/`tradeId` — 전 Task 동일 표기. CSS 클래스 `h-krwseed` — Task 4 정의·사용. 입력 id `tr_krw` — Task 1 정의, Task 5 사용.

**순서 의존성**

Task 2 는 Task 1 의 `syncKrwDeposit` 이 있어야 한다. Task 3 은 Task 1 의 `krwAmount` 가 있어야 뜻이 있다. Task 4 는 Task 3 의 `computeKrwBasis` 가 있어야 화면에 반영된다. Task 5 는 1~4 가 다 있어야 한다. 순서대로 진행한다.
