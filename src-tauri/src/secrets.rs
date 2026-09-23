//! Storage for the LiteLLM API key.
//!
//! Windows: Credential Manager, macOS: Keychain. Elsewhere (Linux test
//! builds) the key is written to `secrets.json` in the app data directory
//! with owner-only permissions.

use std::path::{Path, PathBuf};

const SERVICE: &str = "AETHER OS";
const ACCOUNT: &str = "litellm-api-key";

pub struct SecretStore {
    #[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
    file: PathBuf,
}

impl SecretStore {
    pub fn new(data_dir: &Path) -> Self {
        SecretStore { file: data_dir.join("secrets.json") }
    }

    /// Human-readable name of the backend, shown in the settings.
    pub fn backend(&self) -> &'static str {
        if cfg!(windows) {
            "Windows-Anmeldeinformationsverwaltung"
        } else if cfg!(target_os = "macos") {
            "macOS-Schlüsselbund"
        } else {
            "Datei im App-Datenordner (nur für Tests)"
        }
    }

    #[cfg(any(windows, target_os = "macos"))]
    pub fn get(&self) -> Option<String> {
        keyring::Entry::new(SERVICE, ACCOUNT).ok()?.get_password().ok().filter(|k| !k.is_empty())
    }

    #[cfg(any(windows, target_os = "macos"))]
    pub fn set(&self, key: Option<&str>) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
        match key.filter(|k| !k.is_empty()) {
            Some(k) => entry.set_password(k).map_err(|e| e.to_string()),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    pub fn get(&self) -> Option<String> {
        let _ = (SERVICE, ACCOUNT);
        let raw = std::fs::read_to_string(&self.file).ok()?;
        let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
        v["litellm_api_key"].as_str().filter(|k| !k.is_empty()).map(str::to_owned)
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    pub fn set(&self, key: Option<&str>) -> Result<(), String> {
        match key.filter(|k| !k.is_empty()) {
            Some(k) => {
                std::fs::write(&self.file, serde_json::json!({ "litellm_api_key": k }).to_string())
                    .map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&self.file, std::fs::Permissions::from_mode(0o600));
                }
                Ok(())
            }
            None => match std::fs::remove_file(&self.file) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        }
    }
}
