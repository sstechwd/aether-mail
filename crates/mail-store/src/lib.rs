//! Local SQLite + FTS5 mail store.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderSummary {
    pub name: String,
    pub unread: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMessage {
    pub id: String,
    pub account_id: String,
    pub folder: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: DateTime<Utc>,
    pub unread: bool,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMessage {
    pub id: String,
    pub account_id: String,
    pub folder: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: DateTime<Utc>,
    pub unread: bool,
    pub body: String,
}

pub struct MailStore {
    conn: Connection,
}

impl MailStore {
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_file(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                from_addr TEXT NOT NULL,
                to_addr TEXT NOT NULL,
                subject TEXT NOT NULL,
                date_utc TEXT NOT NULL,
                unread INTEGER NOT NULL,
                body TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_account_folder
                ON messages(account_id, folder, date_utc DESC);
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                id UNINDEXED,
                account_id UNINDEXED,
                subject,
                from_addr,
                to_addr,
                body,
                content='messages',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, id, account_id, subject, from_addr, to_addr, body)
                VALUES (new.rowid, new.id, new.account_id, new.subject, new.from_addr, new.to_addr, new.body);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, id, account_id, subject, from_addr, to_addr, body)
                VALUES ('delete', old.rowid, old.id, old.account_id, old.subject, old.from_addr, old.to_addr, old.body);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, id, account_id, subject, from_addr, to_addr, body)
                VALUES ('delete', old.rowid, old.id, old.account_id, old.subject, old.from_addr, old.to_addr, old.body);
                INSERT INTO messages_fts(rowid, id, account_id, subject, from_addr, to_addr, body)
                VALUES (new.rowid, new.id, new.account_id, new.subject, new.from_addr, new.to_addr, new.body);
            END;
            "#,
        )?;
        Ok(())
    }

    pub fn upsert_message(&self, msg: NewMessage) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO messages (id, account_id, folder, from_addr, to_addr, subject, date_utc, unread, body)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                account_id = excluded.account_id,
                folder = excluded.folder,
                from_addr = excluded.from_addr,
                to_addr = excluded.to_addr,
                subject = excluded.subject,
                date_utc = excluded.date_utc,
                unread = excluded.unread,
                body = excluded.body
            "#,
            params![
                msg.id,
                msg.account_id,
                msg.folder,
                msg.from,
                msg.to,
                msg.subject,
                msg.date.to_rfc3339(),
                msg.unread as i64,
                msg.body,
            ],
        )?;
        Ok(())
    }

    pub fn list_folders(&self, account_id: &str) -> Result<Vec<FolderSummary>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT folder,
                   SUM(CASE WHEN unread = 1 THEN 1 ELSE 0 END) AS unread,
                   COUNT(*) AS total
            FROM messages
            WHERE account_id = ?1
            GROUP BY folder
            ORDER BY folder
            "#,
        )?;
        let rows = stmt.query_map(params![account_id], |row| {
            Ok(FolderSummary {
                name: row.get(0)?,
                unread: row.get(1)?,
                total: row.get(2)?,
            })
        })?;
        rows.collect::<rusqlite::Result<_>>().map_err(Into::into)
    }

    pub fn list_messages(&self, account_id: &str, folder: &str) -> Result<Vec<StoredMessage>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, account_id, folder, from_addr, to_addr, subject, date_utc, unread, body
            FROM messages
            WHERE account_id = ?1 AND folder = ?2
            ORDER BY date_utc DESC
            "#,
        )?;
        let rows = stmt.query_map(params![account_id, folder], map_message)?;
        rows.collect::<rusqlite::Result<_>>().map_err(Into::into)
    }

    pub fn get_message(&self, id: &str) -> Result<Option<StoredMessage>> {
        self.conn
            .query_row(
                r#"
                SELECT id, account_id, folder, from_addr, to_addr, subject, date_utc, unread, body
                FROM messages WHERE id = ?1
                "#,
                params![id],
                map_message,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn mark_read(&self, id: &str) -> Result<()> {
        self.conn
            .execute("UPDATE messages SET unread = 0 WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn search(&self, account_id: &str, query: &str) -> Result<Vec<StoredMessage>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT m.id, m.account_id, m.folder, m.from_addr, m.to_addr, m.subject, m.date_utc, m.unread, m.body
            FROM messages_fts f
            JOIN messages m ON m.rowid = f.rowid
            WHERE f.account_id = ?1 AND messages_fts MATCH ?2
            ORDER BY m.date_utc DESC
            "#,
        )?;
        let phrase = format!("\"{}\"", query.replace('"', " "));
        let rows = stmt.query_map(params![account_id, phrase], map_message)?;
        rows.collect::<rusqlite::Result<_>>().map_err(Into::into)
    }
}

fn map_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredMessage> {
    let date_raw: String = row.get(6)?;
    let date = DateTime::parse_from_rfc3339(&date_raw)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })?;
    Ok(StoredMessage {
        id: row.get(0)?,
        account_id: row.get(1)?,
        folder: row.get(2)?,
        from: row.get(3)?,
        to: row.get(4)?,
        subject: row.get(5)?,
        date,
        unread: row.get::<_, i64>(7)? != 0,
        body: row.get(8)?,
    })
}
