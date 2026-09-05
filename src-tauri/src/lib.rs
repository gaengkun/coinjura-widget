use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 토스트 세대 번호. 새 토스트가 뜨면 앞선 타이머가 남의 토스트를 지우지 않도록
/// 자기 세대가 아직 최신인지 확인하고 숨긴다.
static TOAST_GEN: AtomicU64 = AtomicU64::new(0);

/// 위젯이 숨겨져 있을 때 화면 오른쪽 위에 잠깐 뜨는 알림 창.
/// 줄 수만큼 창 높이를 키운다.
#[tauri::command]
fn show_toast(
    app: tauri::AppHandle,
    lines: Vec<serde_json::Value>,
    cols: Vec<String>,
    pos: Option<(f64, f64)>,
) {
    let Some(w) = app.get_webview_window("toast") else {
        return;
    };

    // 너무 많으면 화면을 덮으므로 여섯 줄에서 끊는다.
    let shown: Vec<&serde_json::Value> = lines.iter().take(6).collect();
    if shown.is_empty() {
        return;
    }
    let n = shown.len() as f64;

    let js = format!(
        "window.__cjToast && window.__cjToast({}, {})",
        serde_json::to_string(&shown).unwrap_or_else(|_| "[]".into()),
        serde_json::to_string(&cols).unwrap_or_else(|_| "[]".into())
    );
    let _ = w.eval(&js);

    // 위젯이 있던 그 자리에 그대로 띄운다. 사용자의 눈이 이미 그 위치를 알고 있어서
    // 화면 구석에 띄우는 것보다 알아채기 쉽다. 폭도 위젯에 맞춰 자리가 겹치게 한다.
    let main = app.get_webview_window("main");
    let mut w_logical = 300.0_f64;
    let mut x = 0.0_f64;
    let mut y = 0.0_f64;
    let mut placed = false;

    if let Some(m) = &main {
        if let (Ok(p), Ok(sz)) = (m.outer_position(), m.outer_size()) {
            let sf = m.scale_factor().unwrap_or(1.0);
            x = p.x as f64 / sf;
            y = p.y as f64 / sf;
            w_logical = (sz.width as f64 / sf).clamp(240.0, 460.0);
            placed = true;
        }
    }
    // 사용자가 알림을 끌어다 놓은 적이 있으면 그 자리를 우선한다.
    if let Some((px, py)) = pos {
        x = px;
        y = py;
        placed = true;
    }

    let h_logical = 14.0 + n * 20.0;
    let _ = w.set_size(tauri::LogicalSize::new(w_logical, h_logical));

    // 위젯이 놓인 모니터 밖으로 나가지 않게 붙잡아 둔다.
    let mon = main
        .as_ref()
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(mon) = mon {
        let sf = mon.scale_factor();
        let (mp, ms) = (mon.position(), mon.size());
        let (mx, my) = (mp.x as f64 / sf, mp.y as f64 / sf);
        let (mw, mh) = (ms.width as f64 / sf, ms.height as f64 / sf);
        if !placed {
            x = mx + mw - w_logical - 14.0;
            y = my + 40.0;
        }
        x = x.clamp(mx + 8.0, (mx + mw - w_logical - 8.0).max(mx + 8.0));
        y = y.clamp(my + 8.0, (my + mh - h_logical - 8.0).max(my + 8.0));
    }
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));

    // 눌러서 닫을 수 있어야 하므로 클릭을 통과시키지 않는다.
    let _ = w.set_ignore_cursor_events(false);
    let _ = w.show();
    // 창이 숨어 있는 동안에는 화면이 안 그려져 전환이 시작되지 않는다.
    // 그래서 내용 채우기와 연출 시작을 나눠, 띄운 뒤에 연출을 건다.
    let _ = w.eval(&format!("window.__cjPlay && window.__cjPlay({}, {})", x, y));

    let gen = TOAST_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(5600));
        if TOAST_GEN.load(Ordering::SeqCst) != gen {
            return; // 그 사이 새 토스트가 떴다
        }
        if let Some(w) = app2.get_webview_window("toast") {
            let _ = w.hide();
        }
    });
}

/// 창이 어느 모니터에도 충분히 걸쳐 있지 않으면 화면 중앙으로 되돌린다.
/// 모니터 사이로 끌어 놓쳤을 때 "보이기를 눌러도 안 보이는" 상태를 막는 최후의 방어선이라
/// 프론트엔드가 아니라 여기(Rust)에 둔다 — 저장된 좌표가 이미 망가진 뒤에도 동작해야 한다.
fn ensure_on_screen(w: &tauri::WebviewWindow) {
    const NEED: i32 = 80;
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else {
        return;
    };
    let mons = w.available_monitors().unwrap_or_default();
    if mons.is_empty() {
        return;
    }
    let (ww, wh) = (size.width as i32, size.height as i32);
    let ok = mons.iter().any(|m| {
        let (mp, ms) = (m.position(), m.size());
        let ox = (pos.x + ww).min(mp.x + ms.width as i32) - pos.x.max(mp.x);
        let oy = (pos.y + wh).min(mp.y + ms.height as i32) - pos.y.max(mp.y);
        ox >= NEED && oy >= NEED
    });
    if !ok {
        let _ = w.center();
        // 투명도가 낮게 설정돼 있으면 중앙으로 와도 안 보이므로 프론트에도 알린다
        let _ = w.emit("cj://recover", ());
    }
}

/// 윈도우에서 처음 숨길 때 딱 한 번, 어디로 갔는지 알려준다.
///
/// 윈도우 11 은 새 트레이 아이콘을 숨김 영역(^) 안에 넣는다. 밖으로 꺼내
/// 고정하는 건 사용자가 직접 끌어야 하고 앱이 강제할 API 가 없다.
/// 게다가 skipTaskbar 라 작업표시줄 버튼도 없어서, 모르는 사람은 실행 중인
/// 앱을 화면 어디에서도 못 찾는다. 그 상태를 막는 최소한의 안내다.
#[cfg(target_os = "windows")]
fn hint_tray_once(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let marker = dir.join("tray-hint-shown");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, b"1");
    let _ = app
        .notification()
        .builder()
        .title("코인주라 위젯")
        .body("작업 표시줄 오른쪽 ^ 안에 있습니다. 아이콘을 밖으로 끌어다 놓으면 계속 보입니다.")
        .show();
}

#[cfg(not(target_os = "windows"))]
fn hint_tray_once(_app: &tauri::AppHandle) {}

/// 위젯 창 보이기/숨기기 토글
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            hint_tray_once(app);
        } else {
            ensure_on_screen(&w);
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// 단축키로 여는 경우: 작업 중인 창의 포커스를 뺏지 않는다.
/// 숨길 때는 애니메이션 없이 즉시 사라져야 하므로 hide()를 바로 호출한다.
fn toggle_window_quiet(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            hint_tray_once(app);
        } else {
            ensure_on_screen(&w);
            let _ = w.show();
            // set_focus 하지 않음 — 사용 중인 프로그램의 포커스 유지
        }
    }
}

/// 트레이에 급등락 표시.
/// macOS는 메뉴바 아이콘 옆에 텍스트를 붙일 수 있고, 그 외 OS는 툴팁으로만 표시된다.
#[tauri::command]
fn set_tray_text(app: tauri::AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        #[cfg(target_os = "macos")]
        {
            let title = if text.is_empty() { None } else { Some(text.as_str()) };
            let _ = tray.set_title(title);
        }
        let tip = if text.is_empty() {
            "코인주라 위젯".to_string()
        } else {
            format!("코인주라 위젯 · {}", text)
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// 전역 show/hide 단축키 등록. 빈 문자열이면 해제만 한다.
/// 등록 실패(다른 앱이 선점 등)는 Err로 돌려보내 설정 화면에서 즉시 알린다.
/// 알림을 눌렀을 때 즉시 닫는다. 세대 번호를 올려 남은 타이머를 무효로 만든다.
#[tauri::command]
fn hide_toast(app: tauri::AppHandle) {
    TOAST_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("toast") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if accelerator.trim().is_empty() {
        return Ok(());
    }
    gs.on_shortcut(accelerator.as_str(), move |app, _sc, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_window_quiet(app);
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_tray_text, set_hotkey, show_toast, hide_toast])
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "위젯 보기 / 숨기기", true, None::<&str>)?;
            let center_i = MenuItem::with_id(app, "center", "화면 중앙으로 되돌리기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show_i, &center_i, &sep, &quit_i])?;

            #[allow(unused_mut)]
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("코인주라 위젯")
                .menu(&menu)
                // 좌클릭은 메뉴 대신 창 토글 (윈도우 관례, 맥에서도 동일하게)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_window(app),
                    // 투명도를 낮추거나 화면 밖으로 밀어넣어 위젯을 잃어버렸을 때의 복구 경로
                    "center" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.center();
                            let _ = w.set_focus();
                            let _ = w.emit("cj://recover", ());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                });

            // 메뉴바 흑백 아이콘은 맥 전용 개념
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(true);
            }

            tray.build(app)?;

            // 지난 실행에서 화면 밖에 저장된 좌표로 떠 있는 경우를 시작 시점에 바로잡는다
            if let Some(w) = app.get_webview_window("main") {
                ensure_on_screen(&w);
            }

            Ok(())
        })
        // 창 닫기 = 종료가 아니라 트레이로 숨기기
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                hint_tray_once(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Dock 아이콘 클릭 — 창을 닫아둔 상태에서 눌러도 다시 뜨게 한다.
        // 기본 동작은 "보이는 창이 없으면 아무것도 안 함"이라, 트레이로만 되살릴 수
        // 있었다. 알림 창(toast)은 숨은 창이지만 사용자가 되찾으려는 창이 아니므로
        // main 만 되살린다.
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(w) = _app.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(false) {
                        ensure_on_screen(&w);
                        let _ = w.show();
                    }
                    let _ = w.set_focus();
                }
            }
        });
}
