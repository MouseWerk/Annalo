//! Tasks across all notes: `- [ ] text` / `- [x] text` items with an optional
//! due date (`📅 2026-09-30` or `due:2026-09-30`) and priority (`!!` hoch,
//! `!` mittel). The `tasks` table is derived from page content on every save.

use std::collections::HashSet;

use chrono::NaiveDate;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::{Error, Result};

/// A task item as found in a page's Markdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTask {
    /// 0-based among the page's (non-empty) task items.
    pub ordinal: usize,
    /// 0-based line in the Markdown.
    pub line: usize,
    /// Byte offset of the checkbox character (` ` or `x`) within the line.
    check: usize,
    pub done: bool,
    /// The text without checkbox, due date and priority markers; `[[links]]` and `#tags` stay.
    pub text: String,
    /// `YYYY-MM-DD`.
    pub due: Option<String>,
    /// 0 none, 1 mittel (`!`), 2 hoch (`!!`).
    pub priority: u8,
    pub tags: Vec<String>,
}

/// A task with its page, as listed in the task view and returned to the assistant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    pub page_id: i64,
    pub page_title: String,
    pub page_icon: Option<String>,
    pub ordinal: i64,
    pub line: i64,
    pub text: String,
    pub done: bool,
    pub due: Option<String>,
    pub priority: u8,
    /// Own `#tags` plus the page's tags written outside task lines.
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Open,
    Done,
    All,
}

/// Filter for [`Database::list_tasks`]. `None` fields do not filter.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TaskFilter {
    pub status: TaskStatus,
    /// Only tasks due on or before this day (`YYYY-MM-DD`).
    pub due_before: Option<String>,
    /// Tag of the task itself or written outside task lines on its page.
    pub tag: Option<String>,
    pub page_id: Option<i64>,
}

fn parse_date(s: &str) -> Option<String> {
    (s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()).then(|| s.to_owned())
}

/// Checkbox of a list item line: (byte offset of the box character, done, text after the box).
fn checkbox(line: &str) -> Option<(usize, bool, &str)> {
    let body = line.trim_start();
    let indent = line.len() - body.len();
    // `-`, `*`, `+` or `1.` / `1)` followed by a space.
    let marker = if body.starts_with(['-', '*', '+']) {
        1
    } else {
        let digits = body.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || !body[digits..].starts_with(['.', ')']) {
            return None;
        }
        digits + 1
    };
    let after = body[marker..].strip_prefix(' ')?;
    let b = after.as_bytes();
    if b.len() < 3 || b[0] != b'[' || b[2] != b']' || !matches!(b[1], b' ' | b'x' | b'X') {
        return None;
    }
    let rest = &after[3..];
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    Some((indent + marker + 1 + 1, b[1] != b' ', rest))
}

/// All task items outside fenced code blocks.
pub fn parse_tasks(markdown: &str) -> Vec<ParsedTask> {
    let mut out = vec![];
    let mut in_fence = false;
    for (line_no, line) in markdown.lines().enumerate() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let Some((check, done, rest)) = checkbox(line) else { continue };
        let mut due = None;
        let mut priority = 0;
        let mut words: Vec<&str> = vec![];
        let toks: Vec<&str> = rest.split_whitespace().collect();
        let mut i = 0;
        while i < toks.len() {
            let t = toks[i];
            if t == "📅" && i + 1 < toks.len() && parse_date(toks[i + 1]).is_some() {
                due = parse_date(toks[i + 1]);
                i += 2;
                continue;
            }
            if let Some(d) = t.strip_prefix("📅").or_else(|| t.strip_prefix("due:")).and_then(parse_date) {
                due = Some(d);
            } else if t == "!!" {
                priority = 2;
            } else if t == "!" {
                priority = priority.max(1);
            } else {
                words.push(t);
            }
            i += 1;
        }
        let text = words.join(" ");
        if text.is_empty() {
            continue;
        }
        let tags = crate::notes::tags(&text);
        out.push(ParsedTask { ordinal: out.len(), line: line_no, check, done, text, due, priority, tags });
    }
    out
}

/// Sets the checkbox of task `ordinal`; `None` when the page has no such task.
/// Everything else, including line endings, stays byte for byte.
pub fn set_task_state(markdown: &str, ordinal: usize, done: bool) -> Option<String> {
    let task = parse_tasks(markdown).into_iter().nth(ordinal)?;
    let mut out = String::with_capacity(markdown.len());
    for (i, line) in markdown.split_inclusive('\n').enumerate() {
        if i == task.line {
            out.push_str(&line[..task.check]);
            out.push(if done { 'x' } else { ' ' });
            out.push_str(&line[task.check + 1..]);
        } else {
            out.push_str(line);
        }
    }
    Some(out)
}

impl Database {
    /// Rebuilds the task rows of one page (called from `reindex_page`).
    pub(crate) fn reindex_tasks(&self, id: i64, content: &str) -> Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM tasks WHERE page_id = ?1", [id])?;
        let mut ins = conn.prepare_cached(
            "INSERT INTO tasks (page_id, ordinal, line, text, done, due, priority, tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        let tasks = parse_tasks(content);
        // Tags outside task lines (frontmatter, prose) belong to the page and so to each of its
        // tasks; a tag inside one task does not spread to the others.
        let task_lines: HashSet<usize> = tasks.iter().map(|t| t.line).collect();
        let prose: Vec<&str> =
            content.lines().enumerate().filter(|(i, _)| !task_lines.contains(i)).map(|(_, l)| l).collect();
        let page_tags = crate::notes::tags(&prose.join("\n"));
        for t in tasks {
            let mut tags = t.tags;
            tags.extend(page_tags.iter().filter(|p| !tags.contains(p)).cloned().collect::<Vec<_>>());
            ins.execute(params![
                id,
                t.ordinal as i64,
                t.line as i64,
                t.text,
                t.done,
                t.due,
                t.priority,
                tags.join(" ")
            ])?;
        }
        Ok(())
    }

    /// Tasks of all pages: open first, then by due date (undated last), priority and page.
    pub fn list_tasks(&self, f: &TaskFilter) -> Result<Vec<Task>> {
        let done = match f.status {
            TaskStatus::Open => Some(false),
            TaskStatus::Done => Some(true),
            TaskStatus::All => None,
        };
        let tag = f.tag.as_deref().map(|t| t.trim().trim_start_matches('#').to_lowercase()).filter(|t| !t.is_empty());
        let mut st = self.conn().prepare_cached(
            "SELECT t.page_id, p.title, p.icon, t.ordinal, t.line, t.text, t.done, t.due, t.priority, t.tags
             FROM tasks t JOIN pages p ON p.id = t.page_id
             WHERE (?1 IS NULL OR t.done = ?1)
               AND (?2 IS NULL OR t.due <= ?2)
               AND (?3 IS NULL OR instr(' ' || t.tags || ' ', ' ' || ?3 || ' ') > 0)
               AND (?4 IS NULL OR t.page_id = ?4)
             ORDER BY t.done, t.due IS NULL, t.due, t.priority DESC, p.title COLLATE NOCASE, t.page_id, t.ordinal",
        )?;
        let rows = st
            .query_map(params![done, f.due_before, tag, f.page_id], |r| {
                let tags: String = r.get(9)?;
                Ok(Task {
                    page_id: r.get(0)?,
                    page_title: r.get(1)?,
                    page_icon: r.get(2)?,
                    ordinal: r.get(3)?,
                    line: r.get(4)?,
                    text: r.get(5)?,
                    done: r.get(6)?,
                    due: r.get(7)?,
                    priority: r.get(8)?,
                    tags: tags.split_whitespace().map(str::to_owned).collect(),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Checks or unchecks task `ordinal` of a page by rewriting exactly its
    /// checkbox, then saves the page so links, tags and the index stay consistent.
    pub fn set_task_done(&self, page_id: i64, ordinal: i64, done: bool) -> Result<()> {
        let content: String = self
            .conn()
            .query_row("SELECT content FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
            .map_err(|_| Error::not_found("page", page_id.to_string()))?;
        let updated = usize::try_from(ordinal)
            .ok()
            .and_then(|o| set_task_state(&content, o, done))
            .ok_or_else(|| Error::not_found("task", format!("{page_id}/{ordinal}")))?;
        if updated != content {
            self.save_page_content(page_id, &updated)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_due_dates_priorities_and_tags() {
        let md = "# Plan\n- [ ] Angebot an [[Kunde X]] 📅 2026-09-30 !! #vertrieb\n\
                  * [x] Review due:2026-09-01 !\n  - [ ] Unterpunkt\n1. [X] Nummeriert\n\
                  - [ ] \n- [] kein Task\n- normal\n- [ ]ohne Leerzeichen\n\
                  ```\n- [ ] im Code\n```\n- [ ] 📅2026-10-01 ungültig 📅 2026-13-01";
        let t = parse_tasks(md);
        let texts: Vec<_> = t.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(
            texts,
            ["Angebot an [[Kunde X]] #vertrieb", "Review", "Unterpunkt", "Nummeriert", "ungültig 📅 2026-13-01"]
        );
        assert_eq!((t[0].due.as_deref(), t[0].priority, t[0].done), (Some("2026-09-30"), 2, false));
        assert_eq!(t[0].tags, ["vertrieb"]);
        assert_eq!((t[1].due.as_deref(), t[1].priority, t[1].done), (Some("2026-09-01"), 1, true));
        assert!(t[3].done);
        assert_eq!(t[4].due.as_deref(), Some("2026-10-01"));
        assert_eq!(t.iter().map(|t| t.ordinal).collect::<Vec<_>>(), [0, 1, 2, 3, 4]);
        assert_eq!(t[2].line, 3);
    }

    #[test]
    fn toggles_exactly_one_checkbox() {
        let md = "Intro [ ] nicht\r\n```\n- [ ] Code\n```\n- [ ] eins\r\n  - [x] zwei\n";
        assert_eq!(set_task_state(md, 0, true).unwrap(), md.replace("- [ ] eins", "- [x] eins"));
        assert_eq!(set_task_state(md, 1, false).unwrap(), md.replace("- [x] zwei", "- [ ] zwei"));
        assert_eq!(set_task_state(md, 1, true).unwrap(), md);
        assert!(set_task_state(md, 2, true).is_none());
    }

    #[test]
    fn index_filters_and_set_task_done() {
        let db = Database::open_in_memory().unwrap();
        let a = db.create_page(None, "Projekt", None).unwrap();
        let b = db.create_page(None, "Privat", None).unwrap();
        db.save_page_content(a.id, "#kunde\n\n- [ ] Später\n- [ ] Bald 📅 2026-09-20 !\n- [x] Fertig 📅 2026-09-01")
            .unwrap();
        db.save_page_content(b.id, "- [ ] Einkaufen #haushalt 📅 2026-09-25 !!\n- [ ] Putzen").unwrap();

        let open = db.list_tasks(&TaskFilter::default()).unwrap();
        let texts: Vec<_> = open.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, ["Bald", "Einkaufen #haushalt", "Putzen", "Später"]);
        assert_eq!(open[0].page_title, "Projekt");

        let due = db.list_tasks(&TaskFilter { due_before: Some("2026-09-22".into()), ..Default::default() }).unwrap();
        assert_eq!(due.len(), 1);
        let kunde = db.list_tasks(&TaskFilter { tag: Some("#Kunde".into()), ..Default::default() }).unwrap();
        assert_eq!(kunde.len(), 2, "page tag matches");
        let haushalt = db.list_tasks(&TaskFilter { tag: Some("haushalt".into()), ..Default::default() }).unwrap();
        assert_eq!(haushalt.len(), 1, "task tag does not spread to other tasks");
        let all = db.list_tasks(&TaskFilter { status: TaskStatus::All, page_id: Some(a.id), ..Default::default() });
        assert_eq!(all.unwrap().len(), 3);

        db.set_task_done(a.id, 0, true).unwrap();
        assert_eq!(
            db.page_doc(a.id).unwrap().content,
            "#kunde\n\n- [x] Später\n- [ ] Bald 📅 2026-09-20 !\n- [x] Fertig 📅 2026-09-01"
        );
        let done = db.list_tasks(&TaskFilter { status: TaskStatus::Done, ..Default::default() }).unwrap();
        assert_eq!(done.len(), 2);
        assert!(db.set_task_done(a.id, 9, true).is_err());
        assert!(db.set_task_done(999, 0, true).is_err());

        db.delete_page(b.id).unwrap();
        assert_eq!(db.list_tasks(&TaskFilter::default()).unwrap().len(), 1);
    }
}
