# 코인주라 위젯 (Tauri)

`coinjura-mini-widget.html`을 Tauri v2로 감싼 맥/윈도우 데스크톱 위젯.

## 실행

```bash
npm run tauri dev      # 개발 (코드 고치고 바로 확인)
npm run tauri build    # 배포용 설치파일 생성 (맥=dmg, 윈도우=msi/exe)
```

### 윈도우 빌드

맥에서는 윈도우용을 만들 수 없다. 둘 중 하나.

- 윈도우 PC에서 위와 똑같은 명령 실행
- `git tag v0.1.1 && git push origin v0.1.1` → GitHub Actions가 맥(arm64·x64)과
  윈도우를 동시에 빌드해서 릴리스 초안에 올린다 (`.github/workflows/release.yml`)

빌드 결과물: `src-tauri/target/release/bundle/macos/코인주라 위젯.app`

> 코드 서명은 안 했습니다. 이 맥에서 직접 빌드한 파일은 격리 속성이 안 붙어서 그냥 열립니다.
> 다만 `.dmg`를 다른 사람에게 보내거나 다운로드로 받으면 Gatekeeper가 막으니,
> 그때는 Finder에서 **우클릭 → 열기 → 열기** 로 한 번 허용해야 합니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/index.html` | 위젯 마크업 (위젯 화면 + 설정 화면) |
| `src/styles.css` | 스타일 |
| `src/main.js` | 시세 로딩·렌더링·설정·알림 로직 |
| `src-tauri/src/lib.rs` | 트레이 아이콘/메뉴, 창 닫기 → 트레이 숨김 |
| `src-tauri/tauri.conf.json` | 창 설정(크기·투명·항상위·프레임리스) |
| `src-tauri/capabilities/default.json` | 권한 (http 스코프, 창 제어, 리사이즈, 알림) |
| `.github/workflows/release.yml` | 태그 push 시 맥·윈도우 동시 빌드 |

## 데이터 소스

전부 `https://coinjura.com/theme/basic/api/json-proxy.php?f=toplist/…` 경유.

| 파일 | 쓰임 |
|---|---|
| `top500-all.json` | 국내(업비트·빗썸) 시세·24h 변동률 |
| `top500-all-en.json` | 해외(바이낸스·바이비트) 시세·24h 변동률 |
| `top500-kimchi.json` | 원/달러 환율, 코인 한글명, 대표 거래소, 코인게코 id |

갱신 주기 2분(`REFRESH`).

### 김프 계산

`(국내가 − 해외가×환율) / (해외가×환율) × 100`

- 환율은 `top500-kimchi.json`의 `usdkrw_rate`.
- 같은 티커라도 거래소마다 다른 코인일 수 있어서(WAVES·LIT·HNT·DATA·BEAM 등),
  `cgid`(코인게코 id)로 코인을 확정한 뒤에 비교한다. 확정 못 하면 `—`.
- 검증: 사이트가 계산한 `diff_pct`와 231개 중 230개가 최대 오차 0.006%p로 일치
  (나머지 1개 RON은 해외 쪽 코인 확정 불가로 미표시).

### 전송량

http 플러그인에 `gzip` 기능을 켜뒀다 (`Cargo.toml`). 없으면 압축 안 된 원본을 받는다
— 회당 528KB → 75KB. 확인: `cargo tree --format "{p} | {f}" | grep reqwest`

서버(`json-proxy.php`)가 `Cache-Control: no-store`를 보내서 Cloudflare가 캐싱을 못 한다.
`public, max-age=60`으로 바꾸고 Cache Rule을 걸면 원본 요청이 유저 수와 무관하게
분당 1회로 떨어진다. **아직 적용 안 됨.**

더 줄이려면 필요한 필드만 담은 컴팩트 파일을 만들면 된다 (231개 코인 전부 담아도
gzip 5.7KB). 유저별 쿼리 파라미터 방식은 캐시 키가 유저마다 갈려 캐시를 파괴하므로 쓰지 말 것.

### CORS

`json-proxy.php`는 `Access-Control-Allow-Origin`을 안 내려줘서 웹뷰의 일반 `fetch`로는 못 부른다.
그래서 앱에서는 `tauri-plugin-http`를 쓴다 (`src/main.js`의 `cjFetch`).
브라우저에서 파일을 그냥 열면 일반 `fetch`로 폴백하므로 CORS에 막힌다 — 앱으로 실행할 것.

허용 도메인은 `capabilities/default.json`의 `http:default` 스코프에서 `https://coinjura.com/*`로 제한.

## 위젯 조작

- **타이틀바 드래그** — 창 이동
- **◆** — 항상 위 켜기/끄기
- **◐** — 투명도 4단계 (100 → 90 → 75 → 60%)
- **×** — 트레이로 숨기기 (종료 아님)
- **메뉴바 트레이 아이콘** — 보기/숨기기, 종료
- **⚙** — 거래소·표시항목·코인·알림 설정
- **창 가장자리 드래그** — 크기 조절. 테두리 없는 창이라 `.rz` 그립 5개 +
  `startResizeDragging`으로 직접 만들었다. 윈도우는 이게 없으면 크기 조절이 아예 안 된다.

설정은 `localStorage`에 저장된다 (`cj_widget`, `cj_widget_ui`, `cj_widget_alert`).

## 급변동 알림

설정에서 임계값(끄기 / ±5% / ±10% / ±20%)을 고르면, 갱신할 때마다 선택한 코인의
24h 변동률이 임계값을 넘으면 시스템 알림을 보낸다.
같은 코인·같은 방향은 6시간에 한 번만 (`ALERT_COOLDOWN`).

## 알아둘 것

- `tauri.conf.json`의 `macOSPrivateApi: true` — 창 투명도에 필요. App Store 제출은 불가.
- `csp: null` — 위젯이 인라인 `style` 속성으로 그리드 폭을 잡는데,
  Tauri가 CSP에 nonce를 주입하면 `'unsafe-inline'`이 무시돼서 레이아웃이 깨진다.
  네트워크 접근은 CSP 대신 capabilities의 http 스코프로 막고 있다.
- 트레이 좌클릭 = 창 토글, 우클릭 = 메뉴 (윈도우 관례). `icon_as_template`은 맥
  메뉴바 전용이라 `#[cfg(target_os = "macos")]`로 감쌌다.
- 폰트 스택에 맥·윈도우 폰트를 같이 나열했다. `--mono`에 `Consolas`가 없으면
  윈도우에서 시세 숫자 정렬이 깨진다.
- 코드 서명 없음 → 맥 배포는 사실상 불가 (Apple Developer 연 $99 필요).
  윈도우는 SmartScreen 경고만 뜨고 유저가 통과시킬 수 있어 서명 없이도 배포된다.
- 도크 아이콘 없이 메뉴바에만 띄우려면 `lib.rs`의 `setup`에서
  `app.set_activation_policy(tauri::ActivationPolicy::Accessory);` 추가.
