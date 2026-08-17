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
    #[error("plaintext IMAP/SMTP is forbidden; use SSL (993/465) or STARTTLS")]
    PlaintextForbidden,
}

/// Remote mail must be implicit TLS or STARTTLS. Loopback (Proton Bridge) may use STARTTLS or SSL.
pub fn require_transport(endpoint: &ImapEndpoint) -> Result<(), ProbeError> {
    let tls = endpoint.tls.to_ascii_lowercase();
    match tls.as_str() {
        "ssl" | "tls" | "imaps" | "starttls" => Ok(()),
        _ => Err(ProbeError::PlaintextForbidden),
    }
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
    require_transport(endpoint)?;
    let host = endpoint.host.trim();
    let loopback = host.eq_ignore_ascii_case("127.0.0.1")
        || host.eq_ignore_ascii_case("localhost")
        || host == "::1";
    if loopback {
        let tls = endpoint.tls.to_ascii_lowercase();
        if tls != "starttls" && tls != "ssl" && tls != "tls" {
            return Err(ProbeError::Loopback);
        }
    }
    Ok(())
}
