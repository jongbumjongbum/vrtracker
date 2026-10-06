# Privacy 탭 미커밋 변경 검토

## 원장 결정 필요

없음.

## 바꾼 것

코드 변경 없음. 검토 결과만 이 문서에 작성했다.

실행한 테스트:

- `node test/privacy.js` → 통과, 출력 `[]`
- `node test/seed.js` → 통과, 출력 `통과 — 기존분 검사 6종 전부 정상`

## 알아낸 것

### 중간 — Privacy 숫자 입력이 `Infinity`를 받아 예수금/포트폴리오 표시를 오염시킬 수 있음

- 위치: `index.html:4716`-`4725`, `index.html:4764`-`4782`, `index.html:4801`-`4825`
- 관련 근거: 기존 코드에는 `parseFloat`가 `"Infinity"`를 무한대로 받는 문제를 막기 위한 `parseStrictNumber`와 `Number.isFinite` 검사가 이미 있다(`index.html:1752`-`1760`, `index.html:1791`-`1792`). 그런데 Privacy 설정/매매 추가/매매 수정은 `parseFloat`와 `isNaN`만 쓴다.
- 재현 조건:
  1. Privacy 탭에서 배수 또는 시작 기준 잔금 prompt/input에 브라우저가 허용하는 큰 지수값(예: `1e309`)이나 `Infinity` 계열 값을 넣는다.
  2. `mv > 0`, `cv > 0` 검사를 통과하면 `p.multiple` 또는 `p.startCash`에 비유한값이 저장된다(`index.html:4720`-`4725`).
  3. `privacyCash()`가 `p.startCash * p.multiple`로 `Infinity`를 만들고(`index.html:2174`-`2181`), 포트폴리오의 Privacy 예수금/그외 예수금 표시가 `$Infinity`, `-$Infinity`처럼 깨진다(`index.html:4098`-`4099`, `index.html:4148`-`4149`). 원화 보기에서는 `Math.round(Infinity).toLocaleString(...)` 경로도 탄다(`index.html:2558`-`2564`).
  4. 매매 추가/수정에서도 수량 또는 가격이 `Infinity`면 `mutateManualTrades()`가 `replayManualHolding()`을 통해 `state.portfolio.extraCash`까지 `Infinity`/`NaN` 계열로 바꿀 수 있다(`index.html:2117`-`2138`, `index.html:2142`-`2148`, `index.html:4770`-`4778`, `index.html:4810`-`4824`).
- 영향:
  - Privacy 예수금과 그외 예수금이 깨진다.
  - Privacy 매매 추가/수정 경로에서는 `extraCash` 자체가 깨질 수 있어 포트폴리오 총자산/차트 스냅샷에도 번질 수 있다.
  - `node test/privacy.js`는 정상 숫자 시나리오만 다뤄서 이 입력은 잡지 못한다.
- 고칠 방향:
  - Privacy 설정의 배수/시작 기준 잔금, Privacy 매매 추가/수정의 수량/가격에 기존 `parseStrictNumber()`를 재사용한다.
  - `qty * price`, `startCash * multiple`, `privacyCash()` 누적 결과에 `Number.isFinite(round2(...))` 또는 동등 검사를 추가해 너무 큰 값도 거절한다.
  - 가능하면 직접입력 매매 쪽(`index.html:4521`-`4528`, `index.html:4552`-`4558`)도 같은 취약점이 남아 있으니 함께 정리하는 편이 좋다. 다만 이번 변경의 직접 범위는 Privacy 탭이다.

### 확인한 정상 동작

- Privacy 예수금 공식은 요구사항과 맞다. `privacyCash()`는 `startCash * multiple`에서 시작하고, 시작일이 있으면 `t.date <= startDate` 거래를 제외해 시작일 다음 날부터만 반영한다(`index.html:2174`-`2181`). `test/privacy.js:75`-`80`에서 같은 날 매매 제외와 시작일 없음 전체 반영을 확인한다.
- Privacy 매매 수정/삭제는 기존 직접입력 재계산 함수 `mutateManualTrades()`를 써서 `extraCash`를 old net cash와 new net cash 차이만큼 움직인다(`index.html:2142`-`2148`, `index.html:4773`-`4782`, `index.html:4791`-`4798`, `index.html:4816`-`4825`). `test/privacy.js:81`-`90`에서 Privacy 매매 추가/삭제 후 그외 예수금이 유지되는지 확인한다.
- 직접입력 SOXL 이동은 Privacy가 비어 있고 SOXL 줄이 하나일 때만 가능하며, 이동 시 `extraCash`는 건드리지 않는다(`index.html:2202`-`2212`). 버튼 클릭 전 `stashBackup()`을 호출한다(`index.html:4656`-`4663`). `test/privacy.js:52`-`67`에서 중복 없음, 재실행 거절, recordIds 유지가 확인된다.
- 총자산/손익/CSV/차트 보유 종목 집계는 `allTradeHoldings()`를 통해 Privacy 보유분을 포함한다(`index.html:2190`-`2194`, `index.html:4036`-`4086`, `index.html:4962`, `index.html:5118`, `index.html:7079`-`7084`).
- 다른 회원 영향은 제한적으로 보인다. SOXL이 없거나 Privacy가 비어 있으면 `allTradeHoldings()`가 Privacy를 합계에 넣지 않고(`index.html:2190`-`2194`), 이동 함수도 거절한다(`index.html:2202`-`2207`). `test/privacy.js:98`-`107`에서 SOXL 없는 계정과 SOXL 두 줄 계정 거절을 확인한다.
- 클라우드 동기화의 새 버전 경로는 Privacy 매매를 `recordIds()`와 `recordCount()`에 포함한다(`index.html:900`-`919`, `index.html:936`-`948`). 옛 사본을 받아올 때 `missingRecords()` 백업 및 기록 수 감소 확인도 작동한다(`index.html:1425`-`1451`). 단, 옛 버전 앱 자체가 저장 전에 새 `recordIds()`를 실행할 수는 없으므로 완전한 양방향 병합은 아니다.
- 백업의 “종목 기록만” 복원은 SOXL 백업을 Privacy 자리로 매핑해 직접입력과 Privacy 중복을 피하려는 처리가 있다(`index.html:1315`-`1363`).
- 원화 표시 모드는 `extraCash` 입력칸 이름 변경과 환산 경로가 유지된다(`index.html:4150`-`4167`). Privacy 설정/매매 입력은 달러 기준으로 고정 표기되어 있어 원화 보기 환산 입력과 섞이지 않는다(`index.html:4708`-`4710`, `index.html:4752`-`4756`).

## 미확인

- 브라우저 UI에서 실제 클릭/렌더링은 실행하지 않았다. 요청에 따라 브라우저 테스트는 열지 않고 코드 경로와 Node 테스트(`privacy.js`, `seed.js`)로 판단했다.
- Supabase 실제 충돌 상황은 네트워크 없이 재현하지 않았다. 코드상으로는 새 버전끼리의 `recordIds`/`recordCount` 보호와 백업 생성 경로까지 확인했다.
