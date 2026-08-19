//! Protocol types and a MailSource trait. IMAP/SMTP adapters come next.

pub mod mime;
pub mod probe;
pub mod providers;

use chrono::{DateTime, Utc};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub id: String,
    pub folder: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: DateTime<Utc>,
}

pub trait MailSource {
    fn list_folders(&self) -> Result<Vec<String>>;
    fn list_envelopes(&self, folder: &str) -> Result<Vec<Envelope>>;
    fn fetch(&self, id: &str) -> Result<Option<Envelope>>;
}

#[derive(Debug, Default)]
pub struct InMemorySource {
    account_id: String,
    envelopes: Vec<Envelope>,
}

impl InMemorySource {
    pub fn new(account_id: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            envelopes: Vec::new(),
        }
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub fn push(&mut self, envelope: Envelope) {
        self.envelopes.push(envelope);
    }
}

impl MailSource for InMemorySource {
    fn list_folders(&self) -> Result<Vec<String>> {
        let mut names: Vec<String> = self.envelopes.iter().map(|e| e.folder.clone()).collect();
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn list_envelopes(&self, folder: &str) -> Result<Vec<Envelope>> {
        Ok(self
            .envelopes
            .iter()
            .filter(|e| e.folder == folder)
            .cloned()
            .collect())
    }

    fn fetch(&self, id: &str) -> Result<Option<Envelope>> {
        Ok(self.envelopes.iter().find(|e| e.id == id).cloned())
    }
}
