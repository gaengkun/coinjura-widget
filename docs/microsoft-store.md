# Microsoft Store 제출 준비

- 앱 이름: 코인주라 위젯
- Package/Identity/Name: `D0A75DB0.4481814E6364E`
- Package/Identity/Publisher: `CN=018E8EDC-E534-47DB-8564-33CF013A600A`
- PublisherDisplayName: 코인주라
- 대상: Windows x64, Windows 10 2004 이상. WebView2 Evergreen 런타임 필요.

GitHub Actions의 `store-msix`를 수동 실행하면 검증된 패키지 구조의 MSIX와 SHA256이 아티팩트로 생성된다. 자동 공개 또는 Store 제출은 하지 않는다. 서명하지 않은 MSIX는 Partner Center 제출용이며 일반 사용자에게 직접 배포하지 않는다. Microsoft가 승인 후 서명한다.

Windows 로컬 빌드:

```powershell
npm ci
npm run tauri build -- --no-bundle --features store
./scripts/build-msix.ps1
```

Store 빌드는 자동 실행에 Windows StartupTask를 사용하며 기본값은 꺼짐이다. 사용자가 작업 관리자에서 차단한 상태는 강제로 해제하지 않는다. 일반 배포본은 기존 자동 실행 플러그인을 유지한다.

제출 전에 실제 Windows에서 MSIX 설치, 첫 실행, WebView2 유무, 시세 갱신, 트레이 복귀, 전역 단축키, 자동 실행 켜기/끄기와 재로그인, 종료/재실행 설정 보존, 업데이트 및 제거를 확인해야 한다. 패키지 생성 성공은 실행 테스트 또는 Store 인증 통과를 의미하지 않는다. 기존 무설치본에서 설정의 자동 이전을 보장하지 않는다.

검토 메모: runFullTrust는 바탕화면 창 제어, 트레이, 전역 단축키에 필요하다. 앱은 관리자 실행을 요청하지 않는다. 가격 조회 기능이며 지갑 연결 및 거래 서명 기능은 없다.
