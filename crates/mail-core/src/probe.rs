//! IMAP login probe. No network in unit tests.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImapEndpoint {
    pub host: String,
    pub port: u16,
    pub tls: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProbeError {
    #[error("need host")]
    MissingHost,
    #[error("need username")]
    MissingUser,
    #[error("need password")]
    MissingSecret,
    #[error("refusing to probe loopback without explicit bridge preset")]
    Loopback,
}

pub fn validate_probe(endpoint: &ImapEndpoint, username: &str, secret: &str) -> Result<(), ProbeError> {
    if endpoint.host.trim().is_empty() {
        return Err(ProbeError::MissingHost);
    }
    if username.trim().is_empty() {
        return Err(ProbeError::MissingUser);
    }
    if secret.is_empty() {
        return Err(ProbeError::MissingSecret);
    }
    Ok(())
}
