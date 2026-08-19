use mail_core::probe::{require_transport, ImapEndpoint, ProbeError};

#[test]
fn remote_imap_must_use_tls() {
    let plain = ImapEndpoint {
        host: "imap.gmail.com".into(),
        port: 143,
        tls: "none".into(),
    };
    assert_eq!(
        require_transport(&plain),
        Err(ProbeError::PlaintextForbidden)
    );
}

#[test]
fn implicit_ssl_993_is_ok() {
    let ssl = ImapEndpoint {
        host: "imap.gmail.com".into(),
        port: 993,
        tls: "ssl".into(),
    };
    assert!(require_transport(&ssl).is_ok());
}

#[test]
fn loopback_bridge_must_be_starttls() {
    let bridge = ImapEndpoint {
        host: "127.0.0.1".into(),
        port: 1143,
        tls: "starttls".into(),
    };
    assert!(require_transport(&bridge).is_ok());
    let raw = ImapEndpoint {
        host: "127.0.0.1".into(),
        port: 143,
        tls: "none".into(),
    };
    assert_eq!(require_transport(&raw), Err(ProbeError::PlaintextForbidden));
}
