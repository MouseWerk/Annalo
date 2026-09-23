//! Import an Obsidian vault (a folder of Markdown files) and export the
//! workspace back to plain Markdown files.
//!
//! Folders become pages; a `Name.md` next to a folder `Name/` becomes that
//! folder page's content (the "folder note" convention). Titles are file
//! names without extension, so Obsidian `[[links]]` keep working.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::Result;
use crate::model::PageNode;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ImportReport {
    pub pages: usize,
    pub folders: usize,
    /// Files that are not Markdown (attachments) and were left out.
    pub skipped: usize,
    /// Page created to hold the import.
    pub root_page_id: i64,
}

fn hidden(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.') || n == "node_modules")
}

fn is_md(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

fn stem(p: &Path) -> String {
    p.file_stem().and_then(|s| s.to_str()).unwrap_or("Ohne Titel").to_owned()
}

/// Imports `dir` under a new top-level page named after the folder.
pub fn import_vault(db: &Database, dir: &Path) -> Result<ImportReport> {
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("Import").to_owned();
    db.atomic(|| {
        let root = db.create_page(None, &name, Some("library"))?;
        let mut report = ImportReport { root_page_id: root.id, ..Default::default() };
        import_dir(db, dir, root.id, &mut report)?;
        Ok(report)
    })
}

fn import_dir(db: &Database, dir: &Path, parent: i64, report: &mut ImportReport) -> Result<()> {
    let mut entries: Vec<PathBuf> =
        fs::read_dir(dir)?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| !hidden(p)).collect();
    entries.sort_by_key(|p| (!p.is_dir(), p.file_name().map(|n| n.to_ascii_lowercase())));

    let folder_names: Vec<String> = entries.iter().filter(|p| p.is_dir()).map(|p| stem(p)).collect();
    for path in &entries {
        if path.is_dir() {
            let title = path.file_name().and_then(|n| n.to_str()).unwrap_or("Ordner").to_owned();
            let note = dir.join(format!("{title}.md"));
            let page = db.create_page(Some(parent), &title, Some("folder"))?;
            if note.is_file() {
                db.save_page_content(page.id, &fs::read_to_string(&note)?)?;
                report.pages += 1;
            }
            report.folders += 1;
            import_dir(db, path, page.id, report)?;
        } else if is_md(path) {
            let title = stem(path);
            if folder_names.iter().any(|f| f == &title) {
                continue; // folder note, already used as the folder page's content
            }
            let page = db.create_page(Some(parent), &title, Some("file-text"))?;
            db.save_page_content(page.id, &fs::read_to_string(path)?)?;
            report.pages += 1;
        } else {
            report.skipped += 1;
        }
    }
    Ok(())
}

/// Characters Windows does not allow in file names.
fn file_name(title: &str) -> String {
    let cleaned: String =
        title
            .chars()
            .map(|c| {
                if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                    '-'
                } else {
                    c
                }
            })
            .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').to_owned();
    if cleaned.is_empty() { "Ohne Titel".into() } else { cleaned }
}

fn unique(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base} ({n}){ext}"));
        n += 1;
    }
    candidate
}

/// Writes every page as a Markdown file below `dir`. Returns the number of files.
pub fn export_vault(db: &Database, dir: &Path) -> Result<usize> {
    fs::create_dir_all(dir)?;
    let mut count = 0;
    for node in db.page_tree()? {
        export_node(db, &node, dir, &mut count)?;
    }
    Ok(count)
}

fn export_node(db: &Database, node: &PageNode, dir: &Path, count: &mut usize) -> Result<()> {
    let base = file_name(&node.page.title);
    let content = db.page_doc(node.page.id)?.content;
    let file = unique(dir, &base, ".md");
    if !content.is_empty() || node.children.is_empty() {
        fs::write(&file, content)?;
        *count += 1;
    }
    if !node.children.is_empty() {
        let sub = unique(dir, &base, "");
        fs::create_dir_all(&sub)?;
        for child in &node.children {
            export_node(db, child, &sub, count)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("aether-vault-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn imports_obsidian_layout_and_round_trips() {
        let vault = tmp("in");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        fs::write(vault.join(".obsidian/app.json"), "{}").unwrap();
        fs::create_dir_all(vault.join("Projekte/Rollout")).unwrap();
        fs::write(vault.join("Projekte.md"), "Übersicht aller [[Rollout]]-Themen #projekt").unwrap();
        fs::write(vault.join("Projekte/Rollout/Plan.md"), "# Plan\n\nSiehe [[Projekte]]").unwrap();
        fs::write(vault.join("Inbox.md"), "- [ ] Aufgabe").unwrap();
        fs::write(vault.join("bild.png"), [0u8; 4]).unwrap();

        let db = Database::open_in_memory().unwrap();
        let r = import_vault(&db, &vault).unwrap();
        assert_eq!((r.pages, r.folders, r.skipped), (3, 2, 1));
        let projekte = db.page_by_title("Projekte").unwrap().unwrap();
        assert_eq!(db.page_doc(projekte.id).unwrap().backlinks.len(), 1, "Plan links to Projekte");
        assert_eq!(db.pages_with_tag("projekt").unwrap().len(), 1);

        let out = tmp("out");
        assert_eq!(export_vault(&db, &out).unwrap(), 3);
        let root = out.join(vault.file_name().unwrap());
        assert_eq!(fs::read_to_string(root.join("Projekte/Rollout/Plan.md")).unwrap(), "# Plan\n\nSiehe [[Projekte]]");
        assert!(root.join("Projekte.md").is_file());
        assert!(root.join("Inbox.md").is_file());
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(file_name("A/B: C?"), "A-B- C-");
        assert_eq!(file_name("  ...  "), "Ohne Titel");
    }
}
