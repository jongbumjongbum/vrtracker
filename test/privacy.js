/* Privacy 검사 — 라오어 Privacy(SOXL) 기록.

   1) 직접입력 종목의 SOXL 을 Privacy 로 옮겨도 보유·평단·실현손익·예수금이 그대로인지
   2) 두 번 옮기지 않는지, 옮긴 뒤 SOXL 이 직접입력·Privacy 두 군데서 잡히지 않는지
   3) Privacy 예수금 = 잔금 × 배수 − 매수 + 매도 (시작일 다음 날부터), 설정 전엔 0
   4) 그외 예수금 = extraCash − Privacy 예수금 (음수도 그대로), Privacy 매매로 안 변함
   5) 동기화 신분증(recordIds)이 옮기기 전후로 같은지 — 다르면 옛 사본과 견줄 때 "사라졌다"로 오판

   index.html 에서 해당 함수들을 그대로 떼어내 돌린다.
   실행:  node test/privacy.js       (빈 실패 목록이면 통과) */
const fs=require('fs');
const src=fs.readFileSync(__dirname + '/../index.html','utf8');
function grab(name){
  const i=src.indexOf('function '+name+'(');
  if(i<0) throw new Error('없음: '+name);
  let d=0,j=src.indexOf('{',i);
  for(let k=j;k<src.length;k++){ if(src[k]==='{')d++; else if(src[k]==='}'){d--; if(!d){ return src.slice(i,k+1);} } }
}
var state;
var PRIVACY_TICKER = "SOXL";
function round2(n){ return Math.round(n*100)/100; }
function round4(n){ return Math.round(n*10000)/10000; }
function todayStr(){ return "2026-10-06"; }
function pad(n){ return n<10 ? "0"+n : ""+n; }
var _id=0; function uid(){ return "id"+(++_id); }
eval(['manualHoldingSeed','migrateManualSeed','replayManualHolding','mutateManualTrades','syncKrwDeposit',
  'emptyPrivacyHolding','normalizePrivacy','privacyCash','otherCashAfterPrivacy','allTradeHoldings',
  'isPrivacyTicker','migrateSoxlToPrivacy','recordIds',
  'manualRealizedMonth','manualRealizedDate','manualRealizedLabel','realizedPLBuckets'].map(grab).join('\n'));

let bad=[];
function eq(label,got,want,eps){ if(!(Math.abs(got-want)<=(eps==null?0.01:eps))) bad.push(label+': '+got+' (기대 '+want+')'); }
function ok(label,cond){ if(!cond) bad.push(label); }
function add(h,t){ mutateManualTrades(h,function(l){ l.push(Object.assign({id:uid()},t)); l.sort((a,b)=>new Date(a.date)-new Date(b.date)); }); }
function soxlRealized(){ return realizedPLBuckets().events.filter(e=>e.ticker==='SOXL').reduce((s,e)=>s+e.amount,0); }

// --- 직접입력 SOXL (기존분 10주@30, 매매 여럿) + 다른 종목 하나 ---
state={instances:[],muInstances:[],portfolio:{extraCash:5000,holdings:[],cashLog:[],manualRealized:[]}};
var soxl={id:'h1',ticker:'soxl',qty:10,avgCost:30,realizedPL:0,trades:[],seedQty:10,seedAvgCost:30,seedRealizedPL:0};
var aapl={id:'h2',ticker:'AAPL',qty:0,avgCost:0,realizedPL:0,trades:[],seedQty:0,seedAvgCost:0,seedRealizedPL:0};
state.portfolio.holdings.push(soxl,aapl);
add(soxl,{date:'2026-08-01',type:'buy',qty:20,price:24});
add(soxl,{date:'2026-08-05',type:'sell',qty:12,price:28});
add(soxl,{date:'2026-08-09',type:'buy',qty:5,price:22});
add(aapl,{date:'2026-08-02',type:'buy',qty:3,price:200});
normalizePrivacy();
var before={qty:soxl.qty,avg:soxl.avgCost,real:soxl.realizedPL,cash:state.portfolio.extraCash,ids:recordIds(state).sort().join(),
  soxlReal:soxlRealized(),n:soxl.trades.length};

// 옮기기 전: Privacy 는 비어서 합계에 안 끼고, SOXL 은 직접입력으로 한 번만 잡힌다
eq('옮기기 전 합계 대상 종목 수',allTradeHoldings().length,2);
var why=migrateSoxlToPrivacy();
ok('옮기기 실패: '+why, why===null);
var h=state.privacy.holding;
eq('옮긴 뒤 보유',h.qty,before.qty); eq('옮긴 뒤 평단',h.avgCost,before.avg,1e-9); eq('옮긴 뒤 실현손익',h.realizedPL,before.real);
eq('옮긴 뒤 거래 수',h.trades.length,before.n);
ok('옮긴 뒤 티커 SOXL', h.ticker==='SOXL');
eq('옮겨도 extraCash 그대로',state.portfolio.extraCash,before.cash);
ok('직접입력에서 SOXL 이 빠짐', !state.portfolio.holdings.some(x=>isPrivacyTicker(x.ticker)));
eq('직접입력에 AAPL 은 남음',state.portfolio.holdings.length,1);
eq('합계 대상: AAPL + Privacy (중복 없음)',allTradeHoldings().filter(x=>isPrivacyTicker(x.ticker)).length,1);
eq('손익 탭 SOXL 실현손익 그대로(중복 없음)',soxlRealized(),before.soxlReal);
ok('동기화 신분증이 그대로', recordIds(state).sort().join()===before.ids);
// 다시 돌려도 아무 일 없음 (SOXL 이 직접입력에 없으니까)
var snap=JSON.stringify(state);
ok('두 번째 옮기기는 거절', migrateSoxlToPrivacy()!==null);
ok('두 번째 옮기기가 기록을 안 건드림', JSON.stringify(state)===snap);
// 옮긴 뒤 다시 계산해도 같은 값 (replay 로 기존분이 살아 있는지)
mutateManualTrades(h,function(){});
eq('다시 계산 후 보유',h.qty,before.qty); eq('다시 계산 후 실현손익',h.realizedPL,before.real);

// --- Privacy 예수금 ---
eq('설정 전 Privacy 예수금 0',privacyCash(state.privacy),0);
eq('설정 전 그외 = extraCash',otherCashAfterPrivacy(),state.portfolio.extraCash);
state.privacy.multiple=6; state.privacy.startCash=100;   // 시작값 600
// 매매(시작일 없음 = 전부): -480 + 336 - 110 = -254 → 346
eq('시작일 없을 때 Privacy 예수금',privacyCash(state.privacy),600-480+336-110);
state.privacy.startDate='2026-08-05';                     // 8/5 매매는 잔금에 이미 들어 있음 → 8/9 만
eq('시작일 다음 날부터',privacyCash(state.privacy),600-110);
eq('그외 = extraCash - Privacy',otherCashAfterPrivacy(),round2(state.portfolio.extraCash-490));
// Privacy 매수: extraCash 와 Privacy 예수금이 같이 줄어 그외는 그대로
var other0=otherCashAfterPrivacy(), ec0=state.portfolio.extraCash;
add(h,{date:'2026-09-01',type:'buy',qty:100,price:30});
eq('Privacy 매수로 extraCash 감소',state.portfolio.extraCash,ec0-3000);
eq('Privacy 매수로 그외는 그대로',otherCashAfterPrivacy(),other0);
// 큰 매도·삭제도 마찬가지
add(h,{date:'2026-09-02',type:'sell',qty:50,price:33});
eq('Privacy 매도 후에도 그외 그대로',otherCashAfterPrivacy(),other0);
mutateManualTrades(h,function(l){ l.splice(l.findIndex(t=>t.date==='2026-09-02'),1); });
eq('Privacy 삭제 후에도 그외 그대로',otherCashAfterPrivacy(),other0);
// VR Pool 돈을 끌어다 쓴 경우: 그외가 음수 — 그대로 둔다
state.portfolio.extraCash=200; state.privacy.startDate=null; state.privacy.startCash=1000;
var pv=privacyCash(state.privacy);
ok('Privacy 예수금이 양수', pv>200);
eq('그외 음수 그대로',otherCashAfterPrivacy(),round2(200-pv));
ok('그외가 음수', otherCashAfterPrivacy()<0);

// --- 다른 회원: SOXL 이 없으면 옮길 게 없고, 빈 Privacy 는 아무 데도 안 잡힌다 ---
state={instances:[],muInstances:[],portfolio:{extraCash:100,holdings:[aapl],cashLog:[],manualRealized:[]}};
normalizePrivacy();
ok('SOXL 없으면 옮기기 거절', migrateSoxlToPrivacy()!==null);
eq('빈 Privacy 는 합계에 안 끼임',allTradeHoldings().length,1);
// SOXL 줄이 둘이면 합치지 않는다 (이동평균이 달라짐)
state.portfolio.holdings=[{ticker:'SOXL',trades:[],qty:1,seedQty:1,seedAvgCost:1,seedRealizedPL:0},{ticker:'SOXL',trades:[],qty:1,seedQty:1,seedAvgCost:1,seedRealizedPL:0}];
ok('SOXL 줄이 둘이면 거절', migrateSoxlToPrivacy()!==null && state.portfolio.holdings.length===2);
// 옛 사본(서버·백업)에는 privacy 가 없다 — 신분증 계산이 터지면 안 된다
ok('privacy 없는 옛 사본도 신분증 계산', Array.isArray(recordIds({portfolio:{holdings:[aapl]}})));

console.log(JSON.stringify(bad,null,1));
process.exitCode = bad.length ? 1 : 0;
