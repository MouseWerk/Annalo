//! Where the workspace lives.
//!
//! The data folder holds `workspace.db` (+ WAL files), `attachments/` and `backups/`.
//! By default it is the app data folder; a bootstrap file `location.json`
//! (`{"data_dir": "…"}`) in the app config folder points elsewhere, and the
//! `AETHER_DATA_DIR` environment variable (tests) overrides both.
//! Moving copies everything to the new folder; the old one is left untouched.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::{Error, Result};

pub const DB_FILE: &str = "workspace.db";
/// Name of the bootstrap file in the app config folder.
pub const LOCATION_FILE: &str = "location.json";
/// Folders next to the database that move with it.
const DATA_DIRS: [&str; 2] = ["attachments", "backups"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Location {
    pub data_dir: String,
}

/// The data folder `location.json` in `config_dir` points to, if any.
pub fn read_location(config_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_dir.join(LOCATION_FILE)).ok()?;
    let loc: Location = serde_json::from_str(&raw).ok()?;
    let dir = loc.data_dir.trim();
    (!dir.is_empty()).then(|| PathBuf::from(dir))
}

/// Writes `location.json` (via a temporary file, so a crash never leaves half a file).
pub fn write_location(config_dir: &Path, data_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let json = serde_json::to_string_pretty(&Location { data_dir: data_dir.display().to_string() })?;
    let tmp = config_dir.join(format!(".{LOCATION_FILE}.part"));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, config_dir.join(LOCATION_FILE))?;
    Ok(())
}

/// The data folder to open: `env` (AETHER_DATA_DIR) wins, then `location.json`, then `default`.
pub fn resolve(env: Option<PathBuf>, config_dir: Option<&Path>, default: PathBuf) -> PathBuf {
    env.filter(|p| !p.as_os_str().is_empty()).or_else(|| config_dir.and_then(read_location)).unwrap_or(default)
}

/// Whether `path` is a network share or inside a OneDrive/Dropbox folder. SQLite's locking
/// does not survive sync clients or SMB well; such a database can be corrupted.
pub fn is_synced_or_network(path: &str) -> bool {
    let p = path.trim();
    let unc = p.starts_with("\\\\") || p.starts_with("//");
    let lower = p.to_lowercase();
    unc || lower.contains("onedrive") || lower.contains("dropbox")
}

impl Database {
    /// Moves the WAL contents into the main database file and truncates the WAL.
    pub fn checkpoint(&self) -> Result<()> {
        self.conn().query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        Ok(())
    }
}

/// Copies the workspace in `from` (whose database is `db`) to the folder `to`: the database
/// after a checkpoint, its WAL files, `attachments/` and `backups/`. Refuses a folder that
/// already holds a workspace, the same folder, or one inside it. Returns the files copied.
pub fn copy_workspace(db: &Database, from: &Path, to: &Path) -> Result<usize> {
    if to.as_os_str().is_empty() {
        return Err(Error::State("Kein Zielordner angegeben".into()));
    }
    std::fs::create_dir_all(to)?;
    let (from_c, to_c) = (from.canonicalize()?, to.canonicalize()?);
    if from_c == to_c {
        return Err(Error::State("Die Daten liegen bereits in diesem Ordner".into()));
    }
    if to_c.starts_with(&from_c) {
        return Err(Error::State("Der Zielordner liegt im bisherigen Datenordner".into()));
    }
    if to.join(DB_FILE).exists() {
        return Err(Error::State(format!("Im Zielordner liegt bereits eine Datenbank ({DB_FILE})")));
    }
    db.checkpoint()?;
    let mut n = 0;
    for name in [DB_FILE.to_owned(), format!("{DB_FILE}-wal"), format!("{DB_FILE}-shm")] {
        let src = from.join(&name);
        if src.is_file() {
            copy_file(&src, &to.join(&name))?;
            n += 1;
        }
    }
    for dir in DATA_DIRS {
        let src = from.join(dir);
        if src.is_dir() {
            n += copy_dir(&src, &to.join(dir))?;
        }
    }
    Ok(n)
}

/// Writes under a temporary name and renames, so an interrupted copy leaves no truncated file.
fn copy_file(src: &Path, dst: &Path) -> Result<()> {
    let name = dst.file_name().and_then(|n| n.to_str()).unwrap_or("datei");
    let tmp = dst.with_file_name(format!(".{name}.part"));
    let copied = std::fs::copy(src, &tmp).and_then(|_| std::fs::rename(&tmp, dst));
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Copies regular files and folders recursively; symlinks are skipped.
fn copy_dir(src: &Path, dst: &Path) -> Result<usize> {
    std::fs::create_dir_all(dst)?;
    let mut n = 0;
    for entry in std::fs::read_dir(src)?.flatten() {
        let kind = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if kind.is_dir() {
            n += copy_dir(&entry.path(), &to)?;
        } else if kind.is_file() {
            copy_file(&entry.path(), &to)?;
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_network_and_synced_folders() {
        for p in [
            r"\\server\share\Aether",
            "//nas/daten",
            r"C:\Users\anna\OneDrive - Firma\Aether",
            r"C:\Users\anna\onedrive\x",
            "/home/anna/Dropbox/aether",
        ] {
            assert!(is_synced_or_network(p), "{p}");
        }
        for p in [r"C:\Users\anna\AppData\Roaming\os.aether.workspace", "/home/anna/.local/share/aether", r"D:\Daten"] {
            assert!(!is_synced_or_network(p), "{p}");
        }
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("aether-datadir-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn location_file_and_precedence() {
        let cfg = temp("cfg");
        let default = PathBuf::from("/default");
        assert_eq!(resolve(None, Some(&cfg), default.clone()), default);
        write_location(&cfg, Path::new("/daten/aether")).unwrap();
        assert_eq!(read_location(&cfg), Some(PathBuf::from("/daten/aether")));
        assert_eq!(resolve(None, Some(&cfg), default.clone()), PathBuf::from("/daten/aether"));
        assert_eq!(resolve(Some(PathBuf::from("/env")), Some(&cfg), default.clone()), PathBuf::from("/env"));
        std::fs::write(cfg.join(LOCATION_FILE), "kaputt").unwrap();
        assert_eq!(resolve(None, Some(&cfg), default.clone()), default, "a broken file is ignored");
        let _ = std::fs::remove_dir_all(&cfg);
    }

    #[test]
    fn copies_database_attachments_and_backups() {
        let from = temp("from");
        let to = temp("to").join("neu");
        let db = Database::open(from.join(DB_FILE)).unwrap();
        let p = db.create_page(None, "Notiz", None).unwrap();
        db.save_page_content(p.id, "Inhalt im WAL").unwrap();
        std::fs::create_dir_all(from.join("attachments")).unwrap();
        std::fs::write(from.join("attachments/bild.png"), [1u8, 2]).unwrap();
        std::fs::create_dir_all(from.join("backups/attachments")).unwrap();
        std::fs::write(from.join("backups/aether-1.db"), [3u8]).unwrap();
        std::fs::write(from.join("backups/attachments/bild.png"), [1u8, 2]).unwrap();

        assert!(copy_workspace(&db, &from, &from).is_err(), "same folder");
        assert!(copy_workspace(&db, &from, &from.join("sub")).is_err(), "nested folder");
        assert!(copy_workspace(&db, &from, &to).unwrap() >= 4);
        let copy = Database::open(to.join(DB_FILE)).unwrap();
        assert_eq!(copy.page_doc(p.id).unwrap().content, "Inhalt im WAL");
        assert_eq!(std::fs::read(to.join("attachments/bild.png")).unwrap(), [1, 2]);
        assert!(to.join("backups/attachments/bild.png").is_file());
        drop(copy);
        assert!(copy_workspace(&db, &from, &to).is_err(), "never overwrites a workspace");
        let _ = std::fs::remove_dir_all(&from);
        let _ = std::fs::remove_dir_all(to.parent().unwrap());
    }
}
