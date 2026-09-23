//! Page graph for the Graph View: page hierarchy plus `[[Wiki Links]]` between pages.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: i64,
    pub title: String,
    pub icon: Option<String>,
    /// Number of edges touching this page, for node sizing.
    pub degree: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Parent,
    Link,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: i64,
    pub to: i64,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Extracts `[[Target]]` and `[[Target|alias]]` link targets from markdown.
pub fn wiki_links(markdown: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = markdown;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        let target = inner.split('|').next().unwrap_or("").trim();
        if !target.is_empty() && !target.contains('\n') {
            out.push(target.to_owned());
        }
        rest = &after[end + 2..];
    }
    out
}

pub fn page_graph(db: &Database) -> Result<PageGraph> {
    let pages = db.list_pages()?;
    let by_title: HashMap<String, i64> = pages.iter().map(|p| (p.title.to_lowercase(), p.id)).collect();
    let mut edges = BTreeSet::new();
    for p in &pages {
        if let Some(parent) = p.parent_id {
            edges.insert(GraphEdge { from: parent, to: p.id, kind: EdgeKind::Parent });
        }
        for b in db.list_blocks(p.id)? {
            for target in wiki_links(&b.content_markdown) {
                if let Some(&to) = by_title.get(&target.to_lowercase())
                    && to != p.id
                {
                    edges.insert(GraphEdge { from: p.id, to, kind: EdgeKind::Link });
                }
            }
        }
    }
    let edges: Vec<GraphEdge> = edges.into_iter().collect();
    let nodes = pages
        .into_iter()
        .map(|p| GraphNode {
            degree: edges.iter().filter(|e| e.from == p.id || e.to == p.id).count(),
            id: p.id,
            title: p.title,
            icon: p.icon,
        })
        .collect();
    Ok(PageGraph { nodes, edges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_links() {
        assert_eq!(wiki_links("see [[A]] and [[B|bee]], not [[ ]] or [[open"), vec!["A", "B"]);
    }

    #[test]
    fn builds_graph_from_hierarchy_and_links() {
        let db = Database::open_in_memory().unwrap();
        let root = db.create_page(None, "Root", None).unwrap();
        let a = db.create_page(Some(root.id), "Alpha", None).unwrap();
        let b = db.create_page(None, "Beta", None).unwrap();
        db.add_block(a.id, "paragraph", "Link to [[beta]] and [[Alpha]] and [[Missing]]").unwrap();
        let g = page_graph(&db).unwrap();
        assert_eq!(
            g.edges,
            vec![
                GraphEdge { from: root.id, to: a.id, kind: EdgeKind::Parent },
                GraphEdge { from: a.id, to: b.id, kind: EdgeKind::Link },
            ]
        );
        assert_eq!(g.nodes.iter().find(|n| n.id == a.id).unwrap().degree, 2);
    }
}
