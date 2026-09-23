//! Local retrieval-augmented generation over notes and time logs.
//!
//! Embeddings are stored as little-endian `f32` BLOBs in
//! `notes_blocks.vector_embedding` and searched with an exact cosine scan,
//! which stays in the low milliseconds for tens of thousands of blocks. The
//! vector results are fused with FTS5 keyword hits (reciprocal rank fusion) so
//! exact identifiers like `NP-8801` are never lost to fuzzy similarity.
//!
//! Indexing is split into sync DB steps and one async embedding call so the
//! caller never holds the database across an `.await`.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::Result;
use crate::search::{self, SearchHit};

pub fn encode(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn decode(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na.sqrt() * nb.sqrt()) }
}

pub fn store_embedding(db: &Database, block_id: i64, embedding: &[f32]) -> Result<()> {
    db.conn()
        .execute("UPDATE notes_blocks SET vector_embedding = ?2 WHERE id = ?1", params![block_id, encode(embedding)])?;
    Ok(())
}

/// Blocks with text but no embedding yet: `(id, text)`.
pub fn pending_blocks(db: &Database, limit: usize) -> Result<Vec<(i64, String)>> {
    let mut st = db.conn().prepare_cached(
        "SELECT id, content_markdown FROM notes_blocks
         WHERE vector_embedding IS NULL AND trim(content_markdown) <> ''
         ORDER BY id LIMIT ?1",
    )?;
    let rows = st.query_map([limit as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextChunk {
    pub source: String,
    pub text: String,
    pub score: f64,
    pub block_id: Option<i64>,
    pub time_entry_id: Option<i64>,
}

/// Exact cosine top-k over all embedded blocks: `(block_id, similarity)`.
pub fn vector_top_k(db: &Database, query: &[f32], k: usize) -> Result<Vec<(i64, f32)>> {
    let mut st =
        db.conn().prepare_cached("SELECT id, vector_embedding FROM notes_blocks WHERE vector_embedding IS NOT NULL")?;
    let mut scored: Vec<(i64, f32)> = st
        .query_map([], |r| {
            let blob: Vec<u8> = r.get(1)?;
            Ok((r.get::<_, i64>(0)?, cosine(query, &decode(&blob))))
        })?
        .collect::<rusqlite::Result<_>>()?;
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.truncate(k);
    Ok(scored)
}

/// Hybrid retrieval: vector similarity (when a query embedding is given) fused
/// with keyword search over blocks and time logs.
pub fn retrieve(
    db: &Database,
    query_text: &str,
    query_embedding: Option<&[f32]>,
    k: usize,
) -> Result<Vec<ContextChunk>> {
    const RRF_K: f64 = 60.0;
    #[derive(Hash, PartialEq, Eq, Clone, Copy)]
    enum Key {
        Block(i64),
        Entry(i64),
    }
    let mut fused: HashMap<Key, f64> = HashMap::new();

    if let Some(q) = query_embedding {
        for (rank, (id, _)) in vector_top_k(db, q, k * 2)?.into_iter().enumerate() {
            *fused.entry(Key::Block(id)).or_default() += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
    }
    for (rank, hit) in search::search(db, query_text, k * 2)?.into_iter().enumerate() {
        let key = match hit {
            SearchHit::Block { id, .. } => Key::Block(id),
            SearchHit::TimeEntry { id, .. } => Key::Entry(id),
        };
        *fused.entry(key).or_default() += 1.0 / (RRF_K + rank as f64 + 1.0);
    }

    let mut ranked: Vec<(Key, f64)> = fused.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked.truncate(k);

    let conn = db.conn();
    let mut out = Vec::with_capacity(ranked.len());
    for (key, score) in ranked {
        let chunk = match key {
            Key::Block(id) => conn
                .query_row(
                    "SELECT p.title, b.content_markdown FROM notes_blocks b JOIN pages p ON p.id = b.page_id WHERE b.id = ?1",
                    [id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .optional()?
                .map(|(title, text)| ContextChunk { source: format!("Seite: {title}"), text, score, block_id: Some(id), time_entry_id: None }),
            Key::Entry(id) => conn
                .query_row(
                    "SELECT n.netzplan_nr, e.vorgang_nr, e.start_time, e.duration_minutes, e.description
                     FROM time_entries e JOIN netzplaene n ON n.id = e.netzplan_id WHERE e.id = ?1",
                    [id],
                    |r| {
                        let np: String = r.get(0)?;
                        let v: Option<String> = r.get(1)?;
                        let start: String = r.get(2)?;
                        let minutes: Option<i64> = r.get(3)?;
                        let desc: String = r.get(4)?;
                        let target = v.map_or(np.clone(), |v| format!("{np}/{v}"));
                        let hours = minutes.map_or("läuft".to_owned(), |m| format!("{:.2}h", m as f64 / 60.0));
                        Ok(format!("{} {target} {hours}: {desc}", &start[..10.min(start.len())]))
                    },
                )
                .optional()?
                .map(|text| ContextChunk { source: "Zeiterfassung".into(), text, score, block_id: None, time_entry_id: Some(id) }),
        };
        out.extend(chunk);
    }
    Ok(out)
}

/// Renders retrieved chunks as a system-prompt section.
pub fn format_context(chunks: &[ContextChunk]) -> String {
    let mut s = String::from("Relevanter Kontext aus dem lokalen Workspace:\n");
    for (i, c) in chunks.iter().enumerate() {
        s.push_str(&format!("\n[{}] ({})\n{}\n", i + 1, c.source, c.text.trim()));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_roundtrip_and_cosine() {
        let v = [0.5f32, -1.25, 3.0];
        assert_eq!(decode(&encode(&v)), v);
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[1.0, 0.0], &[0.0, 1.0]), 0.0);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0);
    }

    #[test]
    fn hybrid_retrieval_fuses_vector_and_keyword_hits() {
        let db = Database::open_in_memory().unwrap();
        let page = db.create_page(None, "Architektur", None).unwrap();
        let a = db.add_block(page.id, "paragraph", "Der Datenbank-Layer nutzt SQLite mit WAL.").unwrap();
        let b = db.add_block(page.id, "paragraph", "Netzplan NP-8801 wird im Oktober freigegeben.").unwrap();
        let c = db.add_block(page.id, "paragraph", "Kaffeemaschine im 3. OG ist defekt.").unwrap();
        db.add_block(page.id, "paragraph", "   ").unwrap();

        let pending = pending_blocks(&db, 10).unwrap();
        assert_eq!(pending.iter().map(|p| p.0).collect::<Vec<_>>(), [a.id, b.id, c.id]);
        store_embedding(&db, a.id, &[1.0, 0.0, 0.0]).unwrap();
        store_embedding(&db, b.id, &[0.0, 1.0, 0.0]).unwrap();
        store_embedding(&db, c.id, &[0.0, 0.0, 1.0]).unwrap();
        assert!(pending_blocks(&db, 10).unwrap().is_empty());

        // Vector points at the database block, keywords at the Netzplan block:
        // both must be in the top 2, the unrelated block must not.
        let chunks = retrieve(&db, "NP-8801", Some(&[0.9, 0.1, 0.0]), 2).unwrap();
        let ids: Vec<_> = chunks.iter().filter_map(|c| c.block_id).collect();
        assert!(ids.contains(&a.id) && ids.contains(&b.id), "{chunks:?}");
        assert!(format_context(&chunks).contains("[1] (Seite: Architektur)"));
    }
}
