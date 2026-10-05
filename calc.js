/* 주식 기록 — 계산 모듈
   VR·무매의 기록 계산과 다음 주문표 계산만 모아 둔 파일. 화면(index.html)과
   바깥 자동화 프로그램(node)이 같은 식을 쓰도록 떼어 냈다. 여기에는 화면·
   저장·시세 조회 코드를 넣지 않는다. */
"use strict";

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

/* ---------------- domain logic ---------------- */
var TYPE_DEFAULTS = {
  // 매수한도 시간표는 defaultPoolLimitConfig 에 있다.
  "적립식": { startG: 10, gStepDays: 365 },
  "거치식": { startG: 10, gStepDays: 182.5 },
  "인출식": { startG: 40, gStepDays: 182.5 }
};

function currentSegment(inst, atDate){
  var d = new Date(atDate).getTime();
  var seg = inst.typeSegments[0];
  for (var i=0;i<inst.typeSegments.length;i++){
    if (new Date(inst.typeSegments[i].startDate).getTime() <= d) seg = inst.typeSegments[i];
  }
  return seg;
}
function daysBetween(a,b){ return (new Date(b).getTime() - new Date(a).getTime()) / 86400000; }

// G no longer climbs on its own just because time passed — it only moves
// once the user explicitly approves the step (see gApproveBtn below).
// seg.gApprovedSteps is the highest step the user has agreed to; on first
// encounter (older instances predating this feature) it's grandfathered
// to whatever elapsed time already implied, so existing G values don't
// jump backwards.
function gState(inst, atDate){
  var seg = currentSegment(inst, atDate);
  var def = TYPE_DEFAULTS[seg.type];
  var days = Math.max(0, daysBetween(seg.startDate, atDate));
  var elapsedSteps = Math.floor(days / def.gStepDays);
  if (seg.gApprovedSteps === undefined || seg.gApprovedSteps === null){
    seg.gApprovedSteps = elapsedSteps;
  }
  var approvedSteps = seg.gApprovedSteps;
  var G = seg.startG + approvedSteps;
  var due = elapsedSteps > approvedSteps;
  // "나중에"로 미루면 다음 사이클을 입력하기 전까지는 배너를 다시 보여주지 않는다.
  var pending = (due && !seg.gDeferred)
    ? { seg: seg, fromG: G, toG: seg.startG + approvedSteps + 1 }
    : null;
  return { seg: seg, def: def, elapsedSteps: elapsedSteps, approvedSteps: approvedSteps, G: G, due: due, deferred: !!(due && seg.gDeferred), pending: pending };
}

function currentG(inst, atDate){
  return gState(inst, atDate).G;
}

// Informational only: when would the next step become eligible, assuming
// the current one (if any) gets approved right away.
function nextGIncrease(inst, atDate){
  var gs = gState(inst, atDate);
  var seg = gs.seg, def = gs.def;
  var steps = gs.approvedSteps;
  var nextStepDays = (steps + 1) * def.gStepDays;
  var d = new Date(new Date(seg.startDate).getTime() + nextStepDays*86400000);
  return { date: d, nextG: seg.startG + steps + 1 };
}

// The Pool buy-limit ratio is user-editable (both at creation and later),
// so this is only the fallback shown/pre-filled when an instance hasn't
// customized it yet.
// 라오어 VR 중계표 '매수제한/매수한도' (VR0~7 282편, 2026-10-05):
//   시작 후 1년은 제한 없음 → 75% → 26주(반년)마다 −5% → 25% 에서 멈춤.
//   VR4 53주 75·79주 70·105주 65, VR2 135주 60·157주 55·185주 50·209주 45, VR0 1년 반 내내 25.
//   적립식→거치식으로 바뀌어도(VR2) 시간표는 VR 처음 시작일 기준으로 이어진다. 인출식(VR5)은 10% 고정.
// startDelayDays 가 없는 예전 설정은 예전처럼(현재 구간 시작일부터, 지연 없음) 계산한다.
function defaultPoolLimitConfig(type){
  if (type === "인출식") return { mode: "fixed", fixedPct: 10, basePct: 75, stepPct: 5, stepDays: 182.5, floorPct: 25, startDelayDays: 365 };
  return { mode: "schedule", basePct: 75, stepPct: 5, stepDays: 182.5, floorPct: 25, startDelayDays: 365, fixedPct: 10 };
}

function currentPoolLimit(inst, atDate){
  var seg = currentSegment(inst, atDate);
  var cfg = inst.poolLimitConfig || defaultPoolLimitConfig(seg.type);
  if (cfg.mode === "fixed"){
    return { buyPct: cfg.fixedPct, sellPct: null };
  }
  var delay = cfg.startDelayDays || 0;
  var from = delay ? inst.typeSegments[0].startDate : seg.startDate;
  var days = Math.max(0, daysBetween(from, atDate));
  if (days < delay) return { buyPct: 100, sellPct: null };
  var steps = Math.floor((days - delay) / cfg.stepDays);
  var pct = Math.max(cfg.floorPct, cfg.basePct - steps*cfg.stepPct);
  return { buyPct: pct, sellPct: null };
}

// A cycle can contain zero or more fills ({type:"buy"|"sell", qty, price}) —
// e.g. several ladder rungs filled at different prices, or a buy and a sell
// in the same check-in. Each fill's own price drives the cash math exactly
// (no more approximating the whole cycle's cash flow with one price), while
// `closePrice` alone values the resulting position for E.
function computeCycle(inst, prevCycleOrInit, input){
  // input: {date, closePrice, fills:[{type,qty,price}], deposit, spy, qqq}
  var Vprev = prevCycleOrInit.Vnext;
  var Poolprev = prevCycleOrInit.Pool;
  var Qprev = prevCycleOrInit.qty;
  // forceG replays a record with the G it was originally saved under — G is
  // derived from mutable approval state, so recomputing it during a replay
  // could silently rewrite history that already happened at a different G.
  var G = (input.forceG != null) ? input.forceG : currentG(inst, input.date);
  var fills = input.fills || [];
  // 매도는 그 시점에 가진 만큼까지만 반영한다. 예전엔 적힌 그대로 빼서,
  // 앞 사이클을 지우거나 날짜를 옮기면 뒤 사이클의 보유수량이 음수가 됐고
  // 그러면 평가금·손익 같은 그 뒤 숫자가 전부 말이 안 되는 값이 됐다.
  // (무매도 같은 방식으로 계산한다.) 기록 자체는 적은 그대로 남고, 줄여서
  // 반영한 경우에는 sellClamped 로 알려 사용자가 확인할 수 있게 한다.
  var buyQty = 0, buyCost = 0, sellQty = 0, sellProceeds = 0, sellClamped = false;
  var running = Qprev;
  fills.forEach(function(f){
    if (f.type === "buy"){
      buyQty += f.qty; buyCost += f.qty*f.price; running += f.qty;
    } else {
      var sq = Math.min(f.qty, Math.max(0, running));
      if (sq < f.qty - 1e-9) sellClamped = true;
      sellQty += sq; sellProceeds += sq*f.price; running -= sq;
    }
  });
  var deltaQty = buyQty - sellQty;
  var tradeCash = sellProceeds - buyCost;
  var qtyEnd = Qprev + deltaQty;
  var E = round2(qtyEnd * input.closePrice);
  // 배당금은 적립(deposit)과 달리 "그외 예수금"에서 옮겨온 돈이 아니라 이
  // VR 안에서 새로 생긴 돈이라, depositApplied 로 세지 않는다 (그래서
  // vrAppliedDeposits/그외 예수금 정산에서 빠진다).
  // 라오어 중계표 장부 순서 (VR0~7 282편 검산, 2026-10-05):
  //   마지막 Pool = 처음 Pool + 총매매액 + 배당          ← V 식에 이 값이 들어간다
  //   다음 V     = 직전V + 마지막Pool/G + (E-직전V)/(2√G) + 적립(인출이면 음수)
  //   다음 Pool  = 마지막 Pool + 적립
  // 배당은 Pool 을 거쳐서만 V 에 반영되고, V 에 따로 더하지 않는다.
  var dividend = Number(input.dividend || 0);
  var lastPool = Poolprev + tradeCash + dividend;
  var raw = Vprev + (lastPool / G) + ((E - Vprev) / (2 * Math.sqrt(G)));
  var Vnext = round2(raw) + Number(input.deposit || 0);
  var Pool = round2(lastPool + Number(input.deposit || 0));
  var band = inst.band || {low:0.85, high:1.15};
  var buyBandPrev = round2(Vprev * band.low);
  var sellBandPrev = round2(Vprev * band.high);
  var signal = "hold";
  if (E <= buyBandPrev) signal = "buy";
  else if (E >= sellBandPrev) signal = "sell";
  var limit = currentPoolLimit(inst, input.date);
  var buyBandNext = round2(Vnext * band.low);
  var sellBandNext = round2(Vnext * band.high);
  var buyLimitAmt = round2(Pool * (limit.buyPct/100));
  return {
    id: uid(), date: input.date, price: input.closePrice, qty: qtyEnd, E: E,
    fills: fills.map(function(f){ return { type: f.type, qty: f.qty, price: f.price }; }),
    deposit: Number(input.deposit||0), dividend: dividend, dividendNote: input.dividendNote || "",
    G: G, Vprev: Vprev, Vnext: Vnext,
    Pool: Pool, PoolPrev: Poolprev, deltaQty: deltaQty, tradeCash: tradeCash,
    buyBandPrev: buyBandPrev, sellBandPrev: sellBandPrev, signal: signal,
    buyBandNext: buyBandNext, sellBandNext: sellBandNext, sellClamped: sellClamped,
    poolLimitPct: limit.buyPct, buyLimitAmt: buyLimitAmt,
    spy: (input.spy !== "" && input.spy != null) ? Number(input.spy) : null,
    qqq: (input.qqq !== "" && input.qqq != null) ? Number(input.qqq) : null
  };
}

// 체결을 적은 순서대로 적용해보고, 그 시점에 가진 것보다 많이 파는 줄이
// 있으면 알려준다. 이걸 그냥 받아주면 VR은 보유수량이 음수가 되고, 무매는
// 팔지도 못한 주식의 대금이 잔금에 들어와서 그 뒤 숫자가 전부 어긋난다.
function findOverSell(fills, startQty){
  var qty = startQty || 0;
  for (var i=0;i<fills.length;i++){
    var f = fills[i];
    if (f.type === "buy"){ qty += f.qty; continue; }
    if (f.qty > qty + 1e-9) return { index: i, available: round4(qty), wanted: f.qty };
    qty -= f.qty;
  }
  return null;
}
function overSellMessage(over){
  return (over.index + 1) + "번째 체결에 매도 " + over.wanted + "주가 적혀 있는데, 그 시점에 가진 건 " +
    over.available + "주예요.\n\n수량을 고치거나, 먼저 매수 줄을 넣어주세요.\n" +
    "(없는 주식을 판 것으로 기록되면 이후 수량·잔금이 전부 어긋나요)";
}

function round2(n){ return Math.round(n*100)/100; }
function round4(n){ return Math.round(n*10000)/10000; }
// 표시용 자릿수. 입력값은 소수점 4자리까지 그대로 저장되고, 여기서 반올림하는
// 건 화면에 찍는 문자열뿐이다 (input value는 이 함수들을 안 거친다).
var MONEY_DIGITS = 2;
function fmtMoney(n){
  if (n == null || isNaN(n)) return "–";
  var sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  return sign + "$" + n.toLocaleString("en-US", {minimumFractionDigits:MONEY_DIGITS, maximumFractionDigits:MONEY_DIGITS});
}
function fmtMoney0(n){
  if (n == null || isNaN(n)) return "–";
  return (n<0?"-":"") + "$" + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits:MONEY_DIGITS, maximumFractionDigits:MONEY_DIGITS});
}
function fmtPct(n, d){
  if (n == null || isNaN(n)) return "–";
  return n.toFixed(d==null?1:d) + "%";
}
function fmtDate(d){
  var dt = new Date(d);
  return (dt.getMonth()+1) + "/" + dt.getDate() + "/" + String(dt.getFullYear()).slice(2);
}
function typeChip(type){
  var cls = type === "적립식" ? "chip-accum" : (type === "거치식" ? "chip-lump" : "chip-withdraw");
  return '<span class="chip ' + cls + '">' + type + '</span>';
}

function instanceInitPseudoCycle(inst){
  return { Vnext: inst.initV, Pool: inst.initPool, qty: inst.initQty, E: round2((inst.initQty||0) * (inst.initPrice||0)) };
}

// Every cycle's V/Pool/bands are derived from the one before it, so removing
// a record in the middle invalidates everything after it. This re-runs the
// chain from the seed state using each remaining cycle's own recorded
// inputs (date, close, fills, deposit) so the history stays self-consistent.
// 되돌아온 값: 다시 계산한 뒤 보유수량이 음수가 되어버린 사이클의 날짜들.
// VR은 매도 수량을 줄여 맞추지 않고 적힌 그대로 두기 때문에 (기록을 임의로
// 고치지 않으려고), 앞 기록을 지웠을 때 뒤에서 "가진 것보다 많이 판" 상태가
// 될 수 있다. 그건 조용히 두면 안 되는 상태라 부르는 쪽에서 알려준다.
function replayCycles(inst){
  var prev = instanceInitPseudoCycle(inst);
  var clampedDates = [];
  inst.cycles = inst.cycles.map(function(c){
    var res = computeCycle(inst, prev, {
      date: c.date,
      closePrice: c.price,
      fills: (c.fills && c.fills.length) ? c.fills : legacyFillsFromCycle(c),
      deposit: c.deposit,
      dividend: c.dividend,
      dividendNote: c.dividendNote,
      spy: c.spy,
      qqq: c.qqq,
      forceG: c.G
    });
    res.id = c.id;
    res.depositApplied = c.depositApplied;
    if (res.sellClamped) clampedDates.push(c.date);
    prev = res;
    return res;
  });
  return clampedDates;
}

/* --- VR 적립·인출과 "그외 예수금" ------------------------------------------
   증권사 계좌의 예수금은 하나다. VR에 적립한다는 건 새 돈이 들어오는 게
   아니라 계좌 안에서 "그외" 쪽 현금을 VR Pool 로 옮기는 것이다. 그래서
   적립하면 그외 예수금이 그만큼 줄고, 계좌 전체 예수금(예수금 합계)은
   그대로여야 한다. 인출식은 반대로 그외 예수금이 늘어난다.
   depositApplied 가 붙은 사이클만 센다 — 이 규칙이 생기기 전 기록들은
   이미 사용자가 손으로 맞춰둔 잔액에 녹아 있어서 다시 세면 두 번 빠진다. */
function vrAppliedDeposits(inst){
  var sum = 0;
  (inst.cycles || []).forEach(function(c){
    if (c.depositApplied) sum += Number(c.deposit || 0);
  });
  return round4(sum);
}

function lastState(inst){
  if (inst.cycles.length === 0) return instanceInitPseudoCycle(inst);
  return inst.cycles[inst.cycles.length-1];
}

// Reference-only running weighted-average cost, derived purely from recorded
// cycle fills. Not used anywhere in the VR formula itself (V/Pool/G/E don't
// need it) — it's just for showing an approximate profit/return alongside.
// Cycles recorded before multi-fill support only have a single net
// deltaQty/price — synthesize an equivalent single fill so old data still
// walks through computeEffectiveCostBasis the same way.
function legacyFillsFromCycle(c){
  var dq = c.deltaQty || 0;
  if (!dq) return [];
  return [{ type: dq > 0 ? "buy" : "sell", qty: Math.abs(dq), price: c.price }];
}
// avgCost = 증권사 방식(이동평균: 팔아도 평단 그대로), laorAvgCost = 라오어 '실효평단'
// = (매수금 − 매도금) ÷ 보유개수 (VR 중계표 '현 계좌 상황', 2025-09 VR2 155주차 등).
function computeEffectiveCostBasis(inst){
  var qty = inst.initQty || 0;
  var cost = qty * (inst.initPrice || 0);
  var net = cost;
  var realizedPL = 0;
  inst.cycles.forEach(function(c){
    var fills = (c.fills && c.fills.length) ? c.fills : legacyFillsFromCycle(c);
    fills.forEach(function(f){
      if (f.type === "buy"){
        cost += f.qty * f.price;
        net += f.qty * f.price;
        qty += f.qty;
      } else if (qty > 0){
        var avg = cost / qty;
        var sellQty = Math.min(f.qty, qty);
        realizedPL += sellQty * (f.price - avg);
        net -= sellQty * f.price;
        qty -= sellQty;
        cost = avg * Math.max(0, qty);
      }
    });
  });
  return { qty: qty, avgCost: qty > 0 ? cost/qty : 0, laorAvgCost: qty > 0 ? net/qty : 0, realizedPL: realizedPL };
}

var DEFAULT_TRANCHE_SIZE = 1; // base unit is always "1개씩" — the account owner personally scales it (e.g. "2배", "5배") to fit their own capital size, so this is a per-VR setting, not a derivable formula

// Reproduces the real 중계표 mechanic: each rung's price is the band dollar
// amount divided by the share count held BEFORE that rung (buyBand/q or
// sellBand/q) — not linear interpolation across a price range. Since q
// grows (buy) or shrinks (sell) by trancheSize each rung, the trigger
// price naturally steps away from the band on its own; the ladder starts
// exactly AT the band price and extends further in the adverse direction.
// `canAfford(cumulativeQty, cost)` decides whether to include the next
// rung; returning false stops the ladder there.
function buildBandLadder(startQty, bandDollar, direction, trancheSize, canAfford){
  var tranches = [];
  var q = startQty;
  var spent = 0;
  for (var i=0; i<2000; i++){
    if (direction < 0 && q - trancheSize < 0) break;
    var price = bandDollar / q;
    var cost = trancheSize * price;
    if (!canAfford(tranches.length * trancheSize + trancheSize, spent + cost)) break;
    tranches.push({ price: round2(price), qty: trancheSize });
    spent += cost;
    q += direction * trancheSize;
  }
  return tranches;
}

// VR 다음 사이클 매수·매도표. 화면(renderOrderTable)과 자동화가 같이 쓴다.
// 매도는 보유수량까지 전부 만들고(sellAll), "E가 V로 돌아오는" 추정치까지가
// 기본으로 보여줄 줄 수(sellDefaultCount)다. 보유 0주면 기준가에 한도만큼
// 무조건 매수 한 줄.
function vrOrderLadders(inst, last, buyBand, sellBand, limit){
  var qty = last.qty || 0;
  var V = last.Vnext;
  var buyLimitAmt = round2(last.Pool * (limit.buyPct/100));
  var trancheSize = inst.trancheSize || DEFAULT_TRANCHE_SIZE;
  var out = { buy: [], sellAll: [], sellDefaultCount: 0, buyLimitAmt: buyLimitAmt,
              maxBuyQty: 0, limitedByPool: false, refPrice: 0 };
  if (qty > 0){
    // Don't buy past the point where E would already be restored to V,
    // even if the pool limit would allow more.
    var maxBuyQty = Math.floor(Math.max(0, (V - buyBand) / (buyBand / qty)));
    out.maxBuyQty = maxBuyQty;
    out.buy = buildBandLadder(qty, buyBand, +1, trancheSize, function(cumQty, cumSpent){
      return cumQty <= maxBuyQty && cumSpent <= buyLimitAmt;
    });
    out.limitedByPool = out.buy.length * trancheSize < maxBuyQty;
    // Sell has no pool-based limit — the estimate is where E would return
    // to V, but a sharp rally can blow straight through it. The only real
    // ceiling is the shares actually held.
    var maxSellQty = Math.floor(Math.min(Math.max(0, (sellBand - V) / (sellBand / qty)), qty));
    out.sellAll = buildBandLadder(qty, sellBand, -1, trancheSize, function(cumQty){
      return cumQty <= qty;
    });
    var sellCum = 0;
    for (var si=0; si<out.sellAll.length; si++){
      sellCum += out.sellAll[si].qty;
      out.sellDefaultCount = si+1;
      if (sellCum >= maxSellQty) break;
    }
  } else {
    out.refPrice = inst.initPrice || (inst.cycles.length ? inst.cycles[inst.cycles.length-1].price : 0);
    if (out.refPrice > 0){
      var affordableQty = Math.floor(buyLimitAmt/out.refPrice);
      if (affordableQty > 0) out.buy = [{ price: round2(out.refPrice), qty: affordableQty }];
    }
  }
  return out;
}

/* ---------------- 무한매수법 (무매) ---------------- */
var MU_BASE_PCT = { TQQQ: 15, SOXL: 20 };

// 별% = base - (2*base/a)*T — generalizes the method's published 20/40-분할
// formulas (TQQQ 15-1.5T / 15-0.75T, SOXL 20-2T / 20-T) to any split count a,
// since in both cases the T-coefficient is exactly 2*base/a.
function muStarPct(ticker, splitCount, T){
  var base = MU_BASE_PCT[ticker] || 15;
  return base - (2*base/splitCount)*T;
}
function muStarPrice(avgCost, starPct){
  return round2(avgCost * (1 + starPct/100));
}
function muHalf(T, splitCount){
  return T < splitCount/2 ? "front" : "back";
}
function muDailyBuyAmount(cash, splitCount, T){
  var remainRounds = splitCount - T;
  if (remainRounds <= 0) return 0;
  return Math.max(0, cash / remainRounds);
}
// Reverse-mode 별지점: average of the last 5 recorded closes (including today's,
// when called after today's close is known).
function muReverseStarPrice(closes){
  var last5 = closes.slice(-5);
  if (!last5.length) return null;
  return round2(last5.reduce(function(s,c){ return s+c; }, 0) / last5.length);
}
// Reverse-mode 매도 fraction per day: 1/10 for 20분할, 1/20 for 40분할 — both
// equal 2/a, so this generalizes the same way as the 별% formula above.
function muReverseSellFraction(splitCount){
  return 2/splitCount;
}

// Seeds the starting state. A fresh 무매 leaves initQty/initAvgCost at 0, so
// cash is the whole principal and T is 0. A mid-entry (이미 들고 있는 물량으로
// 시작) instead starts with that position already deployed: the shares come
// in at their real 평단, so the seed cash is the principal minus what's
// already in the market, and T reflects how many rounds' worth that is.
function muInstanceInit(inst){
  var qty = inst.initQty || 0;
  var avg = inst.initAvgCost || 0;
  var used = qty * avg;
  var T = inst.initT || 0;
  return {
    T: T, qty: qty, avgCost: avg,
    cash: round2((inst.principal || 0) - used),
    mode: "general", half: muHalf(T, inst.splitCount),
    realizedPL: 0, close: null, reverseFirstDay: false, seasonStart: inst.startDate
  };
}
// How many rounds' worth of the seed a mid-entry position represents:
// (already deployed) ÷ (one round's budget). Used to prefill T.
function muDerivedT(principal, splitCount, qty, avgCost){
  if (!(principal > 0) || !(splitCount > 0)) return 0;
  var perRound = principal / splitCount;
  if (!(perRound > 0)) return 0;
  var t = (qty * avgCost) / perRound;
  return Math.max(0, Math.min(splitCount, Math.round(t*100)/100));
}
function muLastState(inst){
  return inst.days.length ? inst.days[inst.days.length-1] : muInstanceInit(inst);
}

// Walks this day's fills against the running qty/cost the same way VR's
// computeEffectiveCostBasis does, so avgCost and realizedPL stay consistent
// even when a day mixes a buy and a sell.
// T is fully determined by what actually filled, so it shouldn't be a manual
// choice. Every published sell rule turns out to be the same thing —
// T × (남은 수량 ÷ 직전 수량):
//   일반 쿼터매도(1/4 매도) → ×0.75      일반 지정가매도(3/4 매도) → ×0.25
//   리버스 20분할(1/10 매도) → ×0.9      리버스 40분할(1/20 매도) → ×0.95
// And every buy rule is the same fraction-of-budget idea:
//   일반: 그날 1회매수금 중 채워진 비율만큼 더함 (전액 +1, 절반 +0.5)
//   리버스: 잔금 중 쓴 비율 f에 대해 T + (분할수 − T) × f (쿼터매수 f=0.25)
// Sells apply before buys, matching the doc's combined "(×0.25 + 1)" case.
function muDeriveT(inst, prev, fills){
  var a = inst.splitCount;
  var sellQty = 0, buyCost = 0;
  (fills || []).forEach(function(f){
    if (f.type === "sell") sellQty += f.qty;
    else buyCost += f.qty * f.price;
  });
  var T = prev.T, why = [];
  // 라오어 표의 T 는 실제로 판 비율이 아니라 어느 매도가 체결됐느냐로 정해진다
  // (쿼터매도만 있던 164일 중 146일 ×0.75, 실제 비율과 맞는 날 1일 / 리버스 매도는 늘 ×(1−2/분할)).
  //   전량 매도 → 0, 지정가(평단×1.15|1.20) 체결 → ×0.25(남은 1/4), ★ 쿼터매도 → ×0.75
  if (sellQty > 0 && prev.qty > 0){
    var keepRatio, kind;
    var limitPrice = prev.avgCost * (1 + (MU_BASE_PCT[inst.ticker] || 15) / 100);
    var hitLimit = (fills || []).some(function(f){ return f.type === "sell" && f.price >= limitPrice - 0.01; });
    if (sellQty >= prev.qty){ keepRatio = 0; kind = "전량 매도"; }
    else if (prev.mode === "reverse"){ keepRatio = 1 - muReverseSellFraction(a); kind = "리버스 매도"; }
    else if (hitLimit){ keepRatio = 0.25; kind = "지정가 매도"; }
    else { keepRatio = 0.75; kind = "쿼터매도"; }
    T = T * keepRatio;
    why.push(kind + " " + sellQty + "주 → T×" + keepRatio);
  }
  if (buyCost > 0){
    if (prev.mode === "reverse"){
      var f = prev.cash > 0 ? Math.min(1, buyCost / prev.cash) : 0;
      var add = (a - T) * f;
      T = T + add;
      why.push("쿼터매수 " + fmtMoney0(buyCost) + " (잔금의 " + (f*100).toFixed(1) + "%) → T +" + add.toFixed(2));
    } else {
      // 라오어 표의 T 는 체결 금액 비율이 아니라 체결된 줄 수로 센다 (무매 전반전 734일 중 733일):
      // 전반전에 체결가가 모두 평단보다 위 = ★줄만 체결 → +0.5, 그 외(평단줄까지·후반전·첫매수) +1.
      var daily = muDailyBuyAmount(prev.cash, a, prev.T);
      var starOnly = (fills || []).every(function(f){ return f.type === "sell" || f.price > prev.avgCost; });
      var add = (prev.qty > 0 && muHalf(prev.T, a) === "front" && starOnly) ? 0.5 : 1;
      T = T + add;
      why.push("매수 " + fmtMoney0(buyCost) + " / 1회매수금 " + fmtMoney0(daily) + (add === 0.5 ? " (★줄만 체결)" : "") + " → T +" + add);
    }
  }
  if (!why.length) why.push("체결 없음 → T 그대로");
  T = Math.max(0, Math.min(a, T));
  return { T: T, why: why };
}

function computeMuDay(inst, prev, input){
  // input: {date, close, fills:[{type,qty,price}], tOverride, exhausted}
  // 수량·평단·실현손익·현금을 한 번에 걸어서 계산한다. 예전에는 현금만 따로
  // 세면서 매도 수량을 입력값 그대로 썼는데, 위 걸음은 가진 만큼만 파는지라
  // (sq) 보유수량보다 많이 매도로 적으면 팔지도 못한 주식의 대금이 잔금에
  // 들어왔다 — 그 뒤 모든 날의 잔금이 어긋난다.
  var qty = prev.qty, cost = prev.qty * prev.avgCost;
  var realizedGain = 0, buyCost = 0, sellProceeds = 0, clamped = false;
  (input.fills || []).forEach(function(f){
    if (f.type === "buy"){
      cost += f.qty * f.price; qty += f.qty; buyCost += f.qty * f.price;
    } else if (qty > 0){
      var avg = cost / qty;
      var sq = Math.min(f.qty, qty);
      if (sq < f.qty - 1e-9) clamped = true;
      realizedGain += sq * (f.price - avg);
      sellProceeds += sq * f.price;
      qty -= sq;
      cost = avg * Math.max(0, qty);
    } else if (f.qty > 0){
      clamped = true;   // 가진 게 없는데 매도로 적힌 줄
    }
  });
  var avgCost = qty > 0 ? cost/qty : 0;
  var cash = prev.cash - buyCost + sellProceeds;
  // 시즌 리셋 (원장 결정 2026-10-05: 라오어처럼 '1년 근처'가 아니라 연도가 바뀌면).
  // 주식을 들고는 리셋할 수 없으니, 해가 바뀐 뒤 처음 사이클이 끝나는 날(보유 0주) 잔금을
  // 원금으로 되돌린다. 남거나 모자란 돈은 이미 '그외 예수금'에 잡혀 있어 옮길 필요가 없다.
  var seasonStart = prev.seasonStart || inst.startDate || input.date;
  var seasonReset = null;
  if (qty === 0 && prev.qty > 0 && inst.principal > 0 &&
      String(input.date).slice(0, 4) > String(seasonStart).slice(0, 4)){
    seasonReset = { cashBefore: round2(cash), principal: inst.principal };
    cash = inst.principal;
    seasonStart = input.date;
  }

  var a = inst.splitCount;
  var mode = prev.mode, half = prev.half, reverseFirstDay = false;
  var T = (input.tOverride != null && !isNaN(input.tOverride))
    ? Math.max(0, Math.min(a, input.tOverride))
    : muDeriveT(inst, prev, input.fills).T;
  if (mode === "general"){
    if (input.exhausted){ mode = "reverse"; reverseFirstDay = true; }
    half = muHalf(T, a);
  } else {
    var base = MU_BASE_PCT[inst.ticker] || 15;
    var lossPct = avgCost > 0 ? ((input.close - avgCost) / avgCost * 100) : 0;
    if (lossPct > -base){ mode = "general"; half = muHalf(T, a); }
  }

  return {
    id: uid(), date: input.date, close: input.close,
    fills: (input.fills||[]).map(function(f){ return {type:f.type, qty:f.qty, price:f.price}; }),
    T: T, mode: mode, half: half, reverseFirstDay: reverseFirstDay,
    qty: qty, avgCost: avgCost, cash: round2(cash), value: round2(qty*input.close),
    seasonStart: seasonStart, seasonReset: seasonReset,
    realizedPL: round2(prev.realizedPL + realizedGain),
    // 그날 적힌 매도 수량이 그 시점 보유수량보다 많아서 일부만 반영됐다는 표시.
    // 기록을 지우거나 날짜를 옮기면 뒤 기록이 이렇게 될 수 있어서, 조용히
    // 넘어가지 않고 사용자에게 알려주는 데 쓴다.
    sellClamped: clamped,
    // 다시 계산(replayMuDays)할 때 그날 사용자가 실제로 준 입력을 그대로
    // 되먹여야 같은 결과가 나온다. v:2 는 이 두 값을 저장하기 시작한 판본
    // 표시로, 그 전 기록은 T를 건드리지 않고 그대로 둔다.
    v: 2,
    tOverride: (input.tOverride != null && !isNaN(input.tOverride)) ? input.tOverride : null,
    exhausted: !!input.exhausted
  };
}

// 무매 기록도 VR 사이클처럼 앞 기록에서 뒤 기록이 파생된다 (T·수량·평단·잔금).
// 그래서 중간에 하나를 끼워 넣거나 지우면 그 뒤가 전부 무효가 된다 — 씨앗
// 상태부터 각 기록의 원래 입력값으로 다시 굴려 앞뒤를 맞춘다.
function replayMuDays(inst){
  var prev = muInstanceInit(inst);
  var clampedDates = [];
  inst.days = inst.days.map(function(d){
    var res = computeMuDay(inst, prev, {
      date: d.date,
      close: d.close,
      fills: d.fills || [],
      // 그날 사용자가 T를 직접 지정했으면 그 값을, 아니면 체결에서 다시
      // 계산한다. 어느 쪽인지는 migrateMuDayInputs 가 미리 표시해둔다.
      tOverride: (d.v === 2) ? d.tOverride : ((typeof d.T === "number") ? d.T : null),
      exhausted: (d.v === 2) ? !!d.exhausted : !!d.reverseFirstDay
    });
    res.id = d.id;
    res.v = d.v;
    res.tOverride = (d.v === 2) ? d.tOverride : null;
    res.exhausted = (d.v === 2) ? !!d.exhausted : !!d.reverseFirstDay;
    res.cashApplied = d.cashApplied;
    if (res.sellClamped) clampedDates.push(d.date);
    prev = res;
    return res;
  });
  inst.realizedPL = prev.realizedPL || 0;
  inst.mode = prev.mode || "general";
  return clampedDates;
}

// 예전 판본으로 남은 무매 기록에는 "그날 T를 직접 지정했는지"가 안 적혀 있다.
// 그대로 두면 다시 계산할 때 T를 손대도 되는지 알 수 없어서, 기록을 지우거나
// 고쳤을 때 수량·평단·잔금만 맞고 T는 옛 값으로 남는다 — 안내문에는 T도 다시
// 계산된다고 적혀 있는데도. 그래서 딱 한 번, 지금 있는 기록을 그대로 굴려보고
// 체결만으로는 안 나오는 T를 가진 날만 "직접 지정한 날"로 표시해둔다.
// 비교 기준은 그 날 자신이 기록해둔 직전 상태라, 이 시점에는 항상 정확하다.
function migrateMuDayInputs(inst){
  var days = inst.days || [];
  if (!days.length) return false;
  var needs = false;
  for (var i=0;i<days.length;i++){ if (days[i].v !== 2){ needs = true; break; } }
  if (!needs) return false;
  var prev = muInstanceInit(inst);
  days.forEach(function(d){
    if (d.v !== 2){
      var natural = muDeriveT(inst, prev, d.fills || []).T;
      var stored = (typeof d.T === "number") ? d.T : natural;
      // 화면에 소수 둘째 자리까지만 보여주므로 그보다 작은 차이는 계산 오차다.
      d.tOverride = (Math.abs(stored - natural) > 0.005) ? stored : null;
      d.exhausted = !!d.reverseFirstDay;
      d.v = 2;
    }
    prev = d;
  });
  return true;
}

// 무매 체결이 계좌 현금에 준 영향의 합계. "그외 예수금"을 여기에 맞춰
// 움직이려면 바꾸기 전후를 비교해야 해서 따로 뽑아둔다. cashApplied 가 붙은
// 기록만 센다 — 이 기능이 생기기 전 기록들은 이미 사용자가 손으로 맞춰둔
// 예수금에 반영돼 있어서, 다시 세면 두 번 빠진다.
function muNetCash(inst){
  var net = 0;
  (inst.days || []).forEach(function(d){
    if (!d.cashApplied) return;
    (d.fills || []).forEach(function(f){
      net += (f.type === "buy" ? -1 : 1) * f.qty * f.price;
    });
  });
  return round4(net);
}

// Tomorrow's suggested order table, derived from the instance's current
// (last recorded) state — mirrors VR's renderOrderTable/buildBandLadder
// pattern: an anchor order sized to a cash budget, then a 1-unit-per-rung
// ladder continuing from that anchor while the same budget allows, so a
// lower close naturally buys more (since LOC orders all fill at the actual
// closing price, not their own limit).
// Builds the "큰수/별 anchor + descending 1-unit rungs" table exactly like
// the method's real LOC ladders: the anchor row is priced independently
// (10~15% above close, or the 별/평단 point), then buildBandLadder continues
// dividing the SAME day's budget by an ever-growing cumulative quantity —
// because every rung is a Limit-on-Close order, so however far the close
// actually falls, every rung whose limit clears it fills AT that close,
// meaning a lower close simply buys more shares for roughly the same budget.
// 그날 걸 매수 주문 = 지정가 앵커 몇 개 + 폭락 대비 사다리 하나.
// 사다리 단가는 "그날 매수시도금 ÷ 그 시점까지의 누적 수량"이라 앵커 가격과
// 무관하다. 전반전처럼 앵커가 둘(★지점·평단)일 때 앵커마다 사다리를 따로
// 만들면 완전히 같은 사다리가 두 벌 생기고, 급락하면 양쪽이 다 체결돼
// 1회 매수액의 두 배를 사게 된다. 사다리는 전체 금액 기준으로 하나만 만든다.
// 매수표가 비면 이유가 둘 중 하나다 — 쓸 돈이 없거나(분할 소진·잔금 0),
// 가격을 못 구했거나(평단도 시세도 없는 첫 매수). 예전엔 어느 쪽이든 "기준가를
// 넣어주세요"라고만 해서, 분할을 다 쓴 사람에게 엉뚱한 안내가 나갔다.
function muBuildBuyPlan(anchors, budget){
  if (!(budget > 0)) return { anchors: [], crash: [], reason: "nobudget" };
  var rows = [], cum = 0;
  anchors.forEach(function(a){
    if (!(a.price > 0)) return;
    // 개수를 미리 정한 줄(전반전 평단줄)은 그대로, 아니면 배정액÷가격. 비싸서 0개가
    // 나와도 라오어 표는 1개를 건다 (SOXL 300달러대, 2026-06 표).
    var q = (a.qty != null) ? a.qty : Math.floor(a.share / a.price + 1e-9);
    q = Math.max(1, q);
    rows.push({ label: a.label, price: round2(a.price), qty: q });
    cum += q;
  });
  if (!rows.length) return { anchors: [], crash: [], reason: "noprice" };
  // 사다리 n번째 칸 = 매수시도금 ÷ (앞줄까지 누적개수 + n), 센트 아래 버림.
  // 앞줄 개수가 이미 "그 가격에 살 수 있는 만큼"이라 첫 칸은 늘 가장 낮은 앞줄보다 아래다.
  var crash = [];
  for (var n = cum + 1; crash.length < 10; n++){
    crash.push({ price: Math.floor(budget / n * 100 + 1e-6) / 100, qty: 1 });
  }
  return { anchors: rows, crash: crash };
}
// 라오어 무매 V4.0 주문표 (팬딩 무매 중계 1,201장 검산, 2026-10-05):
//  · 큰수 = 직전 종가×1.12. ★지점-0.01 이 큰수보다 비싸면 첫 줄을 큰수에 건다 (증권사 가격제한).
//  · 전반전: 첫 줄 = ⌊1회매수금/2 ÷ 첫줄가격⌋개, 평단 줄 = ⌊1회매수금 ÷ 평단⌋ − 첫 줄 개수.
//    단 첫 줄 가격이 평단 이하로 내려오면(큰수<평단) 평단 줄 없이 1회매수금 전부를 첫 줄에.
//  · 후반전: 1회매수금 전부를 첫 줄 하나에.
//  · 매도: 보유 ⌊1/4⌋ 를 ★지점 LOC, 나머지를 평단×(1+15%|20%) 지정가 (리버스 중에도 지정가는 유지).
//  · 리버스: ★지점 = 최근 5일 종가평균, 매수 = 잔금/4, 매도 = ⌊보유×2/분할수⌋ (버림).
function muFirstRow(starTrigger, close){
  var big = close > 0 ? round2(close * 1.12) : null;
  if (starTrigger == null) return big == null ? null : { label: "큰수", price: big };
  if (big != null && big < starTrigger) return { label: "큰수", price: big };
  return { label: "★지점", price: starTrigger };
}
function muOrderPlan(inst, last, livePrice){
  var a = inst.splitCount;
  var base = MU_BASE_PCT[inst.ticker] || 15;
  var restPrice = last.avgCost > 0 ? round2(last.avgCost * (1 + base/100)) : null;
  if (last.mode === "reverse"){
    var closes = inst.days.map(function(d){ return d.close; }).filter(function(c){ return c > 0; });
    var starPrice = muReverseStarPrice(closes.length ? closes : [last.close]);
    var sellQty = Math.floor(last.qty * muReverseSellFraction(a) + 1e-9);
    if (last.reverseFirstDay){
      return { mode:"reverse", firstDay:true, sellQty: sellQty };
    }
    var buyTrigger = starPrice!=null ? round2(starPrice - 0.01) : null;
    var quarterCash = last.cash / 4;   // 반올림 전 값으로 나눠야 라오어 표와 센트까지 같다
    var first = muFirstRow(buyTrigger, last.close);
    return {
      mode: "reverse", firstDay: false, starPrice: starPrice, buyTrigger: buyTrigger,
      avgCost: last.avgCost,
      buy: muBuildBuyPlan(first ? [{ label: "쿼터매수", price: first.price, share: quarterCash }] : [], quarterCash),
      sellQty: sellQty, sellPrice: starPrice,
      sellRestQty: last.qty - sellQty, sellRestPrice: restPrice
    };
  }
  var starPct = muStarPct(inst.ticker, a, last.T);
  var starPrice = last.avgCost > 0 ? muStarPrice(last.avgCost, starPct) : null;
  var buyTrigger = starPrice != null ? round2(starPrice - 0.01) : null;
  // 개수·사다리는 반올림 전 1회매수금으로 계산한다 (라오어 표: 7939.58÷13.5=588.117… → ÷12 = 49.00, 588.12÷12 면 49.01)
  var daily = muDailyBuyAmount(last.cash, a, last.T);
  var dailyAmt = round2(daily);
  var quarterQty = Math.floor(last.qty / 4);
  var plan = {
    mode: "general", half: last.half, starPct: starPct, starPrice: starPrice,
    buyTrigger: buyTrigger, dailyAmt: dailyAmt, avgCost: last.avgCost,
    sellQuarterQty: quarterQty, sellQuarterPrice: starPrice,
    sellRestQty: last.qty - quarterQty, sellRestPrice: restPrice
  };
  if (last.qty === 0){
    // 첫매수는 평단이 없어 ★지점을 못 구하므로 큰수(종가×1.12)에 건다. 기준가는
    // 기록된 종가 → 실시간 시세 → 사용자가 직접 입력한 값 순. 시세 API는 언제든
    // 비어 있을 수 있어서, 그때 첫 주문표가 통째로 막히지 않게 수동 입력을 남겨둔다.
    var seedPrice = last.close || livePrice || inst.manualRefPrice || 0;
    plan.firstBuyRef = seedPrice;
    plan.needsRefPrice = !(seedPrice > 0);
    plan.buy = muBuildBuyPlan([
      { label: "첫매수(큰수)", price: buyTrigger || round2(seedPrice*1.12), share: daily }
    ], daily);
    return plan;
  }
  var first = muFirstRow(buyTrigger, last.close);
  plan.firstRow = first;
  if (last.half === "front" && first && first.price > last.avgCost){
    var q1 = Math.max(1, Math.floor(daily / 2 / first.price + 1e-9));
    var q2 = Math.max(1, Math.floor(daily / last.avgCost + 1e-9) - q1);
    plan.buy = muBuildBuyPlan([
      { label: first.label, price: first.price, qty: q1 },
      { label: "평단", price: last.avgCost, qty: q2 }
    ], daily);
  } else {
    plan.buy = muBuildBuyPlan(first ? [{ label: first.label, price: first.price, share: daily }] : [], daily);
  }
  return plan;
}

if (typeof module !== "undefined") module.exports = {
  uid: uid,
  vrOrderLadders: vrOrderLadders,
  DEFAULT_TRANCHE_SIZE: DEFAULT_TRANCHE_SIZE,
  MONEY_DIGITS: MONEY_DIGITS,
  MU_BASE_PCT: MU_BASE_PCT,
  TYPE_DEFAULTS: TYPE_DEFAULTS,
  buildBandLadder: buildBandLadder,
  computeCycle: computeCycle,
  computeEffectiveCostBasis: computeEffectiveCostBasis,
  computeMuDay: computeMuDay,
  currentG: currentG,
  currentPoolLimit: currentPoolLimit,
  currentSegment: currentSegment,
  daysBetween: daysBetween,
  defaultPoolLimitConfig: defaultPoolLimitConfig,
  findOverSell: findOverSell,
  fmtDate: fmtDate,
  fmtMoney: fmtMoney,
  fmtMoney0: fmtMoney0,
  fmtPct: fmtPct,
  gState: gState,
  instanceInitPseudoCycle: instanceInitPseudoCycle,
  lastState: lastState,
  legacyFillsFromCycle: legacyFillsFromCycle,
  migrateMuDayInputs: migrateMuDayInputs,
  muBuildBuyPlan: muBuildBuyPlan,
  muFirstRow: muFirstRow,
  muDailyBuyAmount: muDailyBuyAmount,
  muDeriveT: muDeriveT,
  muDerivedT: muDerivedT,
  muHalf: muHalf,
  muInstanceInit: muInstanceInit,
  muLastState: muLastState,
  muNetCash: muNetCash,
  muOrderPlan: muOrderPlan,
  muReverseSellFraction: muReverseSellFraction,
  muReverseStarPrice: muReverseStarPrice,
  muStarPct: muStarPct,
  muStarPrice: muStarPrice,
  nextGIncrease: nextGIncrease,
  overSellMessage: overSellMessage,
  replayCycles: replayCycles,
  replayMuDays: replayMuDays,
  round2: round2,
  round4: round4,
  typeChip: typeChip,
  vrAppliedDeposits: vrAppliedDeposits
};
