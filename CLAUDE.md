# 코인주라 위젯

코인주라(coinjura.com) 시세를 바탕화면에 띄우는 Tauri v2 데스크톱 위젯.
맥(Apple Silicon 전용)·윈도우 배포.

## 구조

```
src/index.html   창 골격. 제목줄 · 시세표 · 설정 · 리사이즈 손잡이
src/main.js      전부 여기 있다(데이터·렌더·설정·알림·창 제어)
src/styles.css   테마 변수 기반. :root 가 다크, [data-theme="light"] 가 라이트
src/toast.html   급변동 알림 창(별도 Tauri 창). 자체 스타일·스크립트
src-tauri/       Rust. 트레이·단축키·창 제어·알림 창 위치 계산
```

인라인 `<script>`/`<style>` 을 쓰지 않는다 — CSP nonce 주입 때문에 막힌다.
(`tauri.conf.json` 의 `"csp": null` 로 풀어뒀지만 분리 구조를 유지한다.)

## 데이터

```
https://coinjura.com/theme/basic/live/widget-v1.js     시세(2분 주기, 열 방식)
https://coinjura.com/theme/basic/live/widget-names.js  한글명(1시간 캐시)
```

`widget-v1.js` 는 서버의 `theme/basic/api/widget/cj-widget-build.php` 가 2분마다
만든다. 열(column) 방식으로 담아 gzip 효율을 높였다 — `s`(심볼) 배열과
`pU/pB/pBN/pBY`(거래소별 가격), `cU/cB/cBN/cBY`(24h), `kp`(김프)가 같은 인덱스로 대응한다.

**요청 주소에 `?g=<2분 버킷>` 을 붙인다.** Cloudflare 가 stale-while-revalidate 로
낡은 사본을 그대로 내주는 바람에 새 파일이 있는데도 한 세대 전 것을 받았다
(실측 128초 vs 8초). 세대마다 주소가 달라지면 그 재사용이 끊기고, 모든 사용자가
같은 버킷 값을 쓰므로 엣지 캐시는 그대로 작동한다.

## 알림

- 위젯이 **숨겨져 있을 때만** 뜬다. 보이는 중이면 시세가 이미 화면에 있다.
- 창은 `toast` 라벨의 별도 Tauri 창. 위젯이 있던 자리에 위젯 폭으로 뜬다.
  끌어다 놓으면 그 좌표를 `localStorage.cj_widget_toastpos` 에 저장해 다음부터 거기 뜬다.
- 누르면 닫고 끌면 옮긴다. 움직인 거리 4px 로 가른다.
- **2분 창은 갱신마다 겹치지 않는 새 구간**이라 넘을 때마다 알린다.
  10분·1시간·24시간은 구간이 겹치므로 "단계가 올라갈 때만" 울린다.
- 표본 시각은 벽시계가 아니라 **데이터 생성 시각(`d.t`)** 이다. 둘을 섞으면
  원본이 늦게 도착한 만큼 목표가 앞당겨져 직전 표본을 잡고 0.00% 가 나온다.
- 감시 거래소는 활성 탭이 아니라 코인마다 고정한다(`alertEx`). 탭을 옮겨도
  감시 대상이 바뀌지 않는다.

## 설정

`cfg`(코인·거래소·표시 항목)와 `ui`(투명도·레이어·위치·테마)로 나뉘어
localStorage 에 따로 저장된다. **`normCfg()` 를 저장할 때와 불러올 때 모두 태운다** —
목록이 빈 배열로 저장되면 행은 그려지되 칸이 없어 백지가 되고, 그 상태가 저장돼
다시 켜도 같아서 사용자가 스스로 빠져나올 수 없다.

`cols`(시세 표)와 `acols`(알림 창)는 **다른 설정**이다. 화면에서도 "시세 표시 항목" /
"알림 전용 항목"으로 이름을 나눠 뒀다.

## 버전 알림

자동 업데이터를 쓰지 않는다. 서버가 `widget-v1.js` 의 `app` 필드로 최신 버전과
받으러 갈 주소를 알려주고, 앱이 자기 버전과 견줘 낮으면 제목줄에 [업데이트] 버튼을
띄운다. 누르면 다운로드 페이지가 브라우저로 열린다. 서명 키도 CI 비밀값도 필요 없고,
받으러 오는 길에 사이트를 한 번 거치게 된다.

버전 비교는 마침표 단위 숫자로 한다 — 문자열로 비교하면 `0.10.0 < 0.9.0` 이 된다.

## 배포

```bash
# 로컬 확인
npm run tauri build -- --target aarch64-apple-darwin

# 릴리스 (맥 + 윈도우가 GitHub Actions 에서 빌드된다)
git tag v0.7.4 && git push origin v0.7.4
```

빌드가 끝나 자산이 붙은 것을 확인한 **뒤에** 서버 PHP 의 버전 상수를 올린다.
먼저 올리면 아직 없는 버전을 받으러 가게 된다.

고정 이름 자산이 함께 올라가므로 다운로드 주소는 판올림해도 바뀌지 않는다.

```
.../releases/latest/download/coinjura-widget-mac.dmg
.../releases/latest/download/coinjura-widget-win-setup.exe
```

번들 파일 이름에 공백이 있다(`Coinjura Widget_0.7.3_x64-setup.exe`). 워크플로우에서
`find` 결과를 반드시 널 구분자로 읽어야 한다 — 공백에서 쪼개져 경로가 깨진다.

서명·공증은 하지 않는다. 유저는 첫 실행에서 한 번 우회해야 한다
(맥: 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기 / 윈도우: 추가 정보 → 실행).
인텔 맥은 지원하지 않는다.

## 플랫폼 차이

- Dock 아이콘 클릭 복귀는 macOS 전용(`RunEvent::Reopen`). 윈도우는 `skipTaskbar` 라
  작업표시줄 버튼도 없어 트레이가 유일한 복귀 경로다. 그래서 윈도우에서 처음 숨길 때
  트레이 위치를 한 번 알려준다.
- `setAlwaysOnTop` 과 `setAlwaysOnBottom` 은 같은 창 레벨을 건드린다. 끄는 쪽을 먼저
  부르고 켜는 쪽을 마지막에 불러야 그 상태가 남는다.
