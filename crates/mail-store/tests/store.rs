use chrono::{TimeZone, Utc};
use mail_store::{MailStore, NewMessage};

#[test]
fn empty_store_has_no_folders() {
    let store = MailStore::open_memory().unwrap();
    assert!(store.list_folders("fixture").unwrap().is_empty());
}

#[test]
fn insert_then_list_inbox_and_search_body() {
    let store = MailStore::open_memory().unwrap();
    store
        .upsert_message(NewMessage {
            id: "m1".into(),
            account_id: "fixture".into(),
            folder: "INBOX".into(),
            from: "Ada <ada@example.com>".into(),
            to: "you@localhost".into(),
            subject: "Analytical Engine".into(),
            date: Utc.with_ymd_and_hms(2026, 8, 13, 10, 0, 0).unwrap(),
            unread: true,
            starred: false,
            body: "Please review the punch-card sequence.".into(),
        })
        .unwrap();

    let folders = store.list_folders("fixture").unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].name, "INBOX");
    assert_eq!(folders[0].unread, 1);
    assert_eq!(folders[0].total, 1);

    let listed = store.list_messages("fixture", "INBOX").unwrap();
    assert_eq!(listed[0].subject, "Analytical Engine");
    assert!(listed[0].unread);

    store.mark_read("m1").unwrap();
    let again = store.get_message("m1").unwrap().unwrap();
    assert!(!again.unread);
    assert!(again.body.contains("punch-card"));

    let hits = store.search("fixture", "punch-card").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "m1");
}
