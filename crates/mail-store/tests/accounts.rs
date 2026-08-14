use mail_store::{Account, MailStore};

#[test]
fn upsert_account_does_not_store_a_password_field() {
    let store = MailStore::open_memory().unwrap();
    store
        .upsert_account(Account {
            id: "acc-1".into(),
            display_name: "Work".into(),
            email: "you@example.com".into(),
            provider: "custom".into(),
            imap_host: "mail.example.com".into(),
            imap_port: 993,
            imap_tls: "ssl".into(),
            smtp_host: "mail.example.com".into(),
            smtp_port: 587,
            smtp_tls: "starttls".into(),
            username: "you@example.com".into(),
            secret_ref: "keyring:acc-1".into(),
            auth_method: "password".into(),
        })
        .unwrap();

    let got = store.get_account("acc-1").unwrap().unwrap();
    assert_eq!(got.email, "you@example.com");
    assert_eq!(got.secret_ref, "keyring:acc-1");
    assert_eq!(got.imap_port, 993);
    let listed = store.list_accounts().unwrap();
    assert_eq!(listed.len(), 1);
}
