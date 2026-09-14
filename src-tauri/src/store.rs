#[tauri::command]
pub fn cj_is_store() -> bool {
    cfg!(all(windows, feature = "store"))
}

#[tauri::command]
pub async fn cj_autostart(app: tauri::AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(all(windows, feature = "store"))]
        {
            let _ = app;
            use windows::ApplicationModel::{StartupTask, StartupTaskState};
            let read = || -> windows::core::Result<bool> {
                let task = StartupTask::GetAsync(&windows::core::HSTRING::from("CoinjuraStartup"))?.get()?;
                if let Some(value) = enabled {
                    if value {
                        task.RequestEnableAsync()?.get()?;
                    } else {
                        task.Disable()?;
                    }
                }
                let state = task.State()?;
                Ok(state == StartupTaskState::Enabled || state == StartupTaskState::EnabledByPolicy)
            };
            read().map_err(|e| e.to_string())
        }
        #[cfg(not(all(windows, feature = "store")))]
        {
            use tauri_plugin_autostart::ManagerExt;
            let manager = app.autolaunch();
            if let Some(value) = enabled {
                if value { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())?;
            }
            manager.is_enabled().map_err(|e| e.to_string())
        }
    }).await.map_err(|e| e.to_string())?
}
