//! Desktop integration: tray icon, close to tray, quick-capture window,
//! native reminders and autostart. The decisions live in `aether_core::desktop`;
//! this module only wires them to the window system.

use std::str::FromStr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use aether_core::desktop::{self as core, CaptureOutcome};
use aether_core::{Database, Error};
use chrono::{Local, NaiveDate, TimeDelta, TimeZone, Utc};
use serde::Serialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_notification::NotificationExt;

use crate::{AppState, Result, lock};

/// Passed by the autostart entry: start hidden in the tray.
pub const MINIMIZED_ARG: &str = "--minimized";
pub const MAIN: &str = "main";
pub const CAPTURE: &str = "capture";

#[derive(Clone)]
struct TrayHandles {
    tray: TrayIcon,
    stop: MenuItem<Wry>,
    resume: MenuItem<Wry>,
}

#[derive(Default)]
pub struct Desktop {
    tray: Mutex<Option<TrayHandles>>,
    capture_shortcut: Mutex<Option<Shortcut>>,
    palette_shortcut: Mutex<Option<Shortcut>>,
    /// A reminder was shown while the app was in the background: the next time the
    /// main window gets focus it opens the timesheet.
    pending_timesheet: AtomicBool,
}

impl Desktop {
    pub fn has_tray(&self) -> bool {
        lock(&self.tray).is_some()
    }
}

fn desktop(app: &AppHandle) -> State<'_, Desktop> {
    app.state::<Desktop>()
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// --------------------------------------------------------------------- tray

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Timer stoppen", false, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Zuletzt verwendet starten", false, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Schnellerfassung", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&open, &sep()?, &stop, &resume, &capture, &sep()?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("AETHER OS")
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    *lock(&desktop(app).tray) = Some(TrayHandles { tray, stop, resume });
    refresh_tray(app);
    Ok(())
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "open" => show_main(app),
        // The UI stops the timer so it can ask about idle time first.
        "stop" => {
            show_main(app);
            let _ = app.emit_to(MAIN, "tray://timer-stop", ());
        }
        "resume" => {
            if let Err(e) = resume_last(app) {
                notify(app, "Timer nicht gestartet", &e.to_string());
            }
        }
        "capture" => open_capture(app),
        "quit" => request_quit(app),
        _ => {}
    }
}

/// Starts a timer on the Netzplan/Vorgang of the most recent entry.
fn resume_last(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    {
        let db = state.db();
        let last = db.last_finished_entry()?.ok_or_else(|| Error::State("Noch keine Buchung vorhanden".into()))?;
        db.start_timer(
            last.netzplan_id,
            last.vorgang_nr.as_deref(),
            last.leistungsart.as_deref(),
            &last.description,
            Utc::now(),
        )?;
    }
    lock(&state.idle).reset();
    let _ = app.emit("data://entries", ());
    refresh_tray(app);
    Ok(())
}

/// Updates the tooltip (running timer) and which timer entry is enabled.
pub fn refresh_tray(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let (running, has_last) = {
        let db = state.db();
        let running = db.running_timer().ok().flatten().map(|e| {
            let nr = db.netzplan_by_id(e.netzplan_id).map(|n| n.netzplan_nr).unwrap_or_default();
            (core::timer_label(&nr, e.vorgang_nr.as_deref()), (Utc::now() - e.start_time).num_minutes())
        });
        (running, db.last_finished_entry().ok().flatten().is_some())
    };
    // Cloned out of the lock: tray calls wait for the main thread, which may want the lock.
    let handles = lock(&desktop(app).tray).clone();
    let Some(t) = handles else { return };
    let tip = core::tray_tooltip(running.as_ref().map(|(l, m)| (l.as_str(), *m)));
    let _ = t.tray.set_tooltip(Some(tip));
    let _ = t.stop.set_enabled(running.is_some());
    let _ = t.resume.set_enabled(running.is_none() && has_last);
}

/// Asks the UI to store pending edits; it then calls `app_quit`.
pub fn request_quit(app: &AppHandle) {
    match app.get_webview_window(MAIN) {
        Some(_) => {
            let _ = app.emit_to(MAIN, "app://quit-requested", ());
        }
        None => app.exit(0),
    }
}

// ----------------------------------------------------------- window events

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    match (window.label(), event) {
        (MAIN, WindowEvent::Focused(true)) => {
            if desktop(app).pending_timesheet.swap(false, Ordering::Relaxed) {
                let _ = app.emit_to(MAIN, "nav://timesheet", ());
            }
        }
        // Without close-to-tray the UI destroys the main window; a hidden capture window
        // must not keep the process alive then.
        (MAIN, WindowEvent::Destroyed) => app.exit(0),
        #[cfg(windows)]
        (CAPTURE, WindowEvent::Focused(false)) => {
            let _ = window.hide();
        }
        _ => {}
    }
}

/// Hides the main window to the tray (minimizes it when there is no tray icon).
#[tauri::command]
pub fn window_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = if desktop(&app).has_tray() { w.hide() } else { w.minimize() };
    }
}

/// Quits after the UI has stored its edits.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

// ------------------------------------------------------------ quick capture

/// Shows the quick-capture window, creating it on first use.
pub fn open_capture(app: &AppHandle) {
    // Creating a webview from an event handler can deadlock on Windows; build it elsewhere.
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = show_capture(&app) {
            eprintln!("quick capture failed: {e}");
        }
    });
}

fn show_capture(app: &AppHandle) -> tauri::Result<()> {
    let w = match app.get_webview_window(CAPTURE) {
        Some(w) => w,
        None => WebviewWindowBuilder::new(app, CAPTURE, WebviewUrl::App("index.html#capture".into()))
            .title("Schnellerfassung – AETHER OS")
            .inner_size(620.0, 132.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()?,
    };
    w.center()?;
    w.show()?;
    w.set_focus()?;
    let _ = app.emit_to(CAPTURE, "capture://shown", ());
    Ok(())
}

#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(CAPTURE) {
        let _ = w.hide();
    }
}

/// Books `/zeit` lines and appends everything else to today's daily note.
#[tauri::command]
pub fn capture_submit(app: AppHandle, state: State<AppState>, text: String) -> Result<CaptureOutcome> {
    let thresholds = state.settings().thresholds;
    let out = core::capture(&state.db(), &text, Utc::now(), &Local, &thresholds)?;
    if !out.bookings.is_empty() {
        let _ = app.emit("data://entries", ());
        refresh_tray(&app);
    }
    if let Some(a) = &out.appended {
        // Open editors of the daily note reload; task lists refresh.
        let _ = app.emit("data://tasks", a.page_id);
    }
    Ok(out)
}

/// Applies the global shortcuts; `None` keeps a slot as it is, `Some("")` switches it off.
/// New shortcuts are registered before the old ones are released, so a failure (e.g. the
/// combination belongs to another program) keeps the previous shortcuts working. A shortcut
/// that moves between the two slots (swap) stays registered and only changes its role.
pub fn apply_shortcuts(
    app: &AppHandle,
    capture: Option<&str>,
    palette: Option<&str>,
) -> std::result::Result<(), String> {
    let d = desktop(app);
    let (old_c, old_p) = (*lock(&d.capture_shortcut), *lock(&d.palette_shortcut));
    let target = |spec: Option<&str>, old: Option<Shortcut>| -> std::result::Result<Option<Shortcut>, String> {
        match spec.map(str::trim) {
            None => Ok(old),
            Some("") => Ok(None),
            Some(s) => parse_shortcut(s).map(Some),
        }
    };
    let (new_c, new_p) = (target(capture, old_c)?, target(palette, old_p)?);
    if new_c.is_some() && new_c == new_p {
        return Err("Palette und Schnellerfassung brauchen verschiedene Tastenkürzel".into());
    }
    let ours = [old_c, old_p];
    let gs = app.global_shortcut();
    let mut added: Vec<Shortcut> = Vec::new();
    // The slot locks are not held while (un)registering: the shortcut handler reads them.
    for sc in [new_c, new_p].into_iter().flatten() {
        if ours.contains(&Some(sc)) || added.contains(&sc) {
            continue;
        }
        if let Err(e) = gs.register(sc) {
            for a in added {
                let _ = gs.unregister(a);
            }
            return Err(format!("Tastenkürzel „{}“ ist nicht verfügbar: {e}", sc.into_string()));
        }
        added.push(sc);
    }
    for sc in ours.into_iter().flatten() {
        if Some(sc) != new_c && Some(sc) != new_p {
            let _ = gs.unregister(sc);
        }
    }
    *lock(&d.capture_shortcut) = new_c;
    *lock(&d.palette_shortcut) = new_p;
    Ok(())
}

/// Parses `Ctrl+Shift+K`-style shortcuts. Ctrl+Alt is refused: on German keyboards it is
/// AltGr, which types `@`, `€`, `{` … and would be swallowed by the global shortcut.
pub fn parse_shortcut(spec: &str) -> std::result::Result<Shortcut, String> {
    let spec = spec.trim();
    let sc = Shortcut::from_str(spec).map_err(|e| format!("Tastenkürzel „{spec}“ ungültig: {e}"))?;
    if sc.mods.contains(Modifiers::CONTROL | Modifiers::ALT) {
        return Err(format!(
            "Tastenkürzel „{spec}“ nicht möglich: Strg+Alt entspricht AltGr und wird zum Tippen von Zeichen wie @ oder € gebraucht"
        ));
    }
    Ok(sc)
}

/// Whether `shortcut` is the registered quick-capture shortcut.
pub fn is_capture_shortcut(app: &AppHandle, shortcut: &Shortcut) -> bool {
    app.try_state::<Desktop>().is_some_and(|d| lock(&d.capture_shortcut).as_ref() == Some(shortcut))
}

/// Whether `shortcut` is the registered command-palette shortcut.
pub fn is_palette_shortcut(app: &AppHandle, shortcut: &Shortcut) -> bool {
    app.try_state::<Desktop>().is_some_and(|d| lock(&d.palette_shortcut).as_ref() == Some(shortcut))
}

// ---------------------------------------------------------------- reminders

fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("notification failed: {e}");
    }
}

fn meta_date(db: &Database, key: &str) -> Option<NaiveDate> {
    db.meta_get(key).ok().flatten().and_then(|s| s.parse().ok())
}

/// Minutes booked today (local time), including a running timer.
fn booked_today(db: &Database) -> Result<i64> {
    let now = Utc::now();
    let midnight = Local::now().date_naive().and_hms_opt(0, 0, 0).unwrap_or_default();
    let from = Local.from_local_datetime(&midnight).earliest().map(|d| d.with_timezone(&Utc));
    let filter = aether_core::db::EntryFilter { from, to: Some(now + TimeDelta::days(1)), ..Default::default() };
    let booked: i64 = db.list_time_entries(&filter)?.iter().filter_map(|r| r.entry.duration_minutes).sum();
    let running = db.running_timer()?.map_or(0, |e| (now - e.start_time).num_minutes().max(0));
    Ok(booked + running)
}

/// Called every ~30 s: tray tooltip and reminder notifications.
pub fn periodic(app: &AppHandle) {
    refresh_tray(app);
    let state = app.state::<AppState>();
    let settings = state.settings();
    let now = Local::now().naive_local();
    let today = now.date().to_string();
    let (eod, late) = {
        let db = state.db();
        let eod = booked_today(&db)
            .ok()
            .and_then(|booked| core::end_of_day_reminder(now, &settings, booked, meta_date(&db, "reminder.day")));
        let running = db.running_timer().ok().flatten();
        let since = running.as_ref().map(|e| e.start_time.with_timezone(&Local).naive_local());
        let n = &settings.notifications;
        let late_allowed = n.late_timer && !n.is_quiet(now.time());
        let late =
            (late_allowed && core::late_timer_reminder(now, since, meta_date(&db, "late_timer.day"))).then(|| {
                let e = running.as_ref().expect("late reminder implies a running timer");
                let nr = db.netzplan_by_id(e.netzplan_id).map(|n| n.netzplan_nr).unwrap_or_default();
                let start = e.start_time.with_timezone(&Local).format("%H:%M");
                format!(
                    "{} läuft seit {start} Uhr – stoppen nicht vergessen.",
                    core::timer_label(&nr, e.vorgang_nr.as_deref())
                )
            });
        if eod.is_some() {
            let _ = db.meta_set("reminder.day", &today);
        }
        if late.is_some() {
            let _ = db.meta_set("late_timer.day", &today);
        }
        (eod, late)
    };
    if let Some(msg) = eod {
        notify(app, &msg, "Zur Zeiterfassung: AETHER OS öffnen");
        let focused = app.get_webview_window(MAIN).is_some_and(|w| w.is_focused().unwrap_or(false));
        if !focused {
            desktop(app).pending_timesheet.store(true, Ordering::Relaxed);
        }
    }
    if let Some(body) = late {
        notify(app, "Timer läuft noch", &body);
    }
}

// ---------------------------------------------------------------- autostart

#[derive(Serialize)]
pub struct DesktopInfo {
    autostart: bool,
    /// Autostart can be changed (the OS entry is readable).
    autostart_available: bool,
    tray: bool,
    capture_shortcut_active: bool,
    palette_shortcut_active: bool,
}

#[tauri::command]
pub fn desktop_info(app: AppHandle) -> DesktopInfo {
    let d = desktop(&app);
    let autostart = app.try_state::<tauri_plugin_autostart::AutoLaunchManager>().map(|m| m.is_enabled());
    DesktopInfo {
        autostart: matches!(autostart, Some(Ok(true))),
        autostart_available: matches!(autostart, Some(Ok(_))),
        tray: d.has_tray(),
        capture_shortcut_active: lock(&d.capture_shortcut).is_some(),
        palette_shortcut_active: lock(&d.palette_shortcut).is_some(),
    }
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<DesktopInfo> {
    let m = app.autolaunch();
    let res = if enabled { m.enable() } else { m.disable() };
    res.map_err(|e| Error::State(format!("Autostart konnte nicht geändert werden: {e}")))?;
    Ok(desktop_info(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_parse_and_refuse_altgr() {
        let sc = parse_shortcut(" Ctrl+Shift+K ").unwrap();
        assert!(sc.mods.contains(Modifiers::CONTROL | Modifiers::SHIFT));
        assert!(parse_shortcut("Alt+Space").is_ok());
        assert!(parse_shortcut("Ctrl+Shift+Space").is_ok());
        for bad in ["Ctrl+Alt+K", "Alt+Ctrl+Space", "Ctrl+Alt+Shift+E"] {
            let e = parse_shortcut(bad).unwrap_err();
            assert!(e.contains("AltGr"), "{bad}: {e}");
        }
        assert!(parse_shortcut("Strg+Foo").unwrap_err().contains("ungültig"));
    }
}
