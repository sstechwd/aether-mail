use mail_store::MailStore;

#[test]
fn ensure_folder_shows_empty_spam() {
    let store = MailStore::open_memory().unwrap();
    store.ensure_folder("acc", "Spam").unwrap();
    let names: Vec<_> = store
        .list_folders("acc")
        .unwrap()
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert!(names.contains(&"Spam".to_string()));
}

#[test]
fn mark_folder_read_clears_unread() {
    use chrono::Utc;
    use mail_store::NewMessage;
    let store = MailStore::open_memory().unwrap();
    store
        .upsert_message(NewMessage {
            id: "m1".into(),
            account_id: "acc".into(),
            folder: "INBOX".into(),
            from: "a@b.c".into(),
            to: "you@localhost".into(),
            subject: "hi".into(),
            date: Utc::now(),
            unread: true,
            starred: false,
            body: "x".into(),
        })
        .unwrap();
    store.mark_folder_read("acc", "INBOX").unwrap();
    let inbox = store
        .list_folders("acc")
        .unwrap()
        .into_iter()
        .find(|f| f.name == "INBOX")
        .unwrap();
    assert_eq!(inbox.unread, 0);
}
