use mail_core::providers::{preset, ProviderKind};

#[test]
fn gmail_preset_uses_imap_ssl_993() {
    let p = preset(ProviderKind::Gmail);
    assert_eq!(p.imap_host, "imap.gmail.com");
    assert_eq!(p.imap_port, 993);
    assert_eq!(p.imap_tls, "ssl");
    assert_eq!(p.smtp_host, "smtp.gmail.com");
    assert_eq!(p.auth_method, "app-password");
}

#[test]
fn proton_preset_is_bridge_localhost() {
    let p = preset(ProviderKind::ProtonBridge);
    assert_eq!(p.imap_host, "127.0.0.1");
    assert_eq!(p.imap_port, 1143);
    assert_eq!(p.auth_method, "bridge");
    assert!(p.notes.contains("Bridge"));
}

#[test]
fn tutanota_is_unsupported() {
    assert!(preset(ProviderKind::Tutanota).unsupported);
}
