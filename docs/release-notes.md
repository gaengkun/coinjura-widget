## v0.7.12 거래소별 코인 선택 및 알림 개선

- 거래소를 한 곳씩 선택해 해당 거래소의 코인을 등록하고, 선택 목록을 거래소별로 저장합니다.
- 선택한 거래소에 시세가 있는 코인만 표시하며, 코인 선택 목록의 거래소 라벨을 제거했습니다.
- 알림을 거래소별 한 줄로 표시하고, 기존 거래소 변동률과 변화량을 함께 보여줍니다. 변화량이 0이면 회색으로 표시합니다.
- 알림 노출 시간을 숫자로 설정할 수 있습니다. 기본값은 3초입니다.
- 레이어는 항상 위·항상 뒤 두 가지로 정리하고, 첫 실행은 항상 뒤로 시작합니다.

### 다운로드

- Windows 무설치: coinjura-widget-win-portable.exe
- Windows 설치: coinjura-widget-win-setup.exe 또는 coinjura-widget-win.msi
- Mac Apple Silicon: coinjura-widget-mac.dmg

Windows 무설치본은 Microsoft WebView2 런타임이 필요합니다. 기존 위젯을 종료한 뒤 파일을 교체하세요. 자동 실행을 사용한다면 실행 파일의 위치를 유지하세요.

Mac 배포본은 ad-hoc 서명이며 Apple 공증 버전은 아닙니다. Intel Mac은 지원하지 않습니다.
