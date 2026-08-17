//! Secrets stay out of SQLite and out of the webview.

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, SecretError>;

pub trait SecretStore {
    fn put(&self, secret_ref: &str, secret: &str) -> Result<()>;
    fn get(&self, secret_ref: &str) -> Result<Option<String>>;
    fn delete(&self, secret_ref: &str) -> Result<()>;
}

#[derive(Default)]
pub struct MemorySecrets {
    inner: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemorySecrets {
    fn put(&self, secret_ref: &str, secret: &str) -> Result<()> {
        self.inner
            .lock()
            .map_err(|e| SecretError::Message(e.to_string()))?
            .insert(secret_ref.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, secret_ref: &str) -> Result<Option<String>> {
        Ok(self
            .inner
            .lock()
            .map_err(|e| SecretError::Message(e.to_string()))?
            .get(secret_ref)
            .cloned())
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        self.inner
            .lock()
            .map_err(|e| SecretError::Message(e.to_string()))?
            .remove(secret_ref);
        Ok(())
    }
}

/// Windows Credential Manager / macOS Keychain / libsecret.
pub struct OsSecrets {
    service: String,
}

impl OsSecrets {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}

impl SecretStore for OsSecrets {
    fn put(&self, secret_ref: &str, secret: &str) -> Result<()> {
        let entry = keyring::Entry::new(&self.service, secret_ref)
            .map_err(|e| SecretError::Message(e.to_string()))?;
        entry
            .set_password(secret)
            .map_err(|e| SecretError::Message(e.to_string()))
    }

    fn get(&self, secret_ref: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(&self.service, secret_ref)
            .map_err(|e| SecretError::Message(e.to_string()))?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Message(e.to_string())),
        }
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        let entry = keyring::Entry::new(&self.service, secret_ref)
            .map_err(|e| SecretError::Message(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Message(e.to_string())),
        }
    }
}
