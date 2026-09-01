use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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

/// 위젯 창 보이기/숨기기 토글
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
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
        .invoke_handler(tauri::generate_handler![set_tray_text, set_hotkey])
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
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
