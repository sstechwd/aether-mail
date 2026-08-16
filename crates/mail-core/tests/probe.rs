use mail_core::probe::{validate_probe, ImapEndpoint, ProbeError};

#[test]
fn probe_requires_secret_and_host() {
    let ep = ImapEndpoint {
        host: "imap.gmail.com".into(),
        port: 993,
        tls: "ssl".into(),
    };
    assert_eq!(
        validate_probe(&ep, "a@b.c", ""),
        Err(ProbeError::MissingSecret)
    );
    assert!(validate_probe(&ep, "a@b.c", "app-password").is_ok());
}
