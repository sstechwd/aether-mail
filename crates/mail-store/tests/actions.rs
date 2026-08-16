use chrono::{TimeZone, Utc};
use mail_store::{MailStore, NewMessage};

fn seed() -> MailStore {
    let store = MailStore::open_memory().unwrap();
    store
        .upsert_message(NewMessage {
            id: "m1".into(),
            account_id: "fixture".into(),
            folder: "INBOX".into(),
            from: "a@b.c".into(),
            to: "you@localhost".into(),
            subject: "hello".into(),
            date: Utc.with_ymd_and_hms(2026, 8, 14, 10, 0, 0).unwrap(),
            unread: true,
            starred: false,
            body: "pay invoice Friday".into(),
        })
        .unwrap();
    store
}

#[test]
fn star_archive_unread() {
    let store = seed();
    store.set_starred("m1", true).unwrap();
    assert!(store.get_message("m1").unwrap().unwrap().starred);
    store.move_to("m1", "Archive").unwrap();
    assert_eq!(store.get_message("m1").unwrap().unwrap().folder, "Archive");
    store.mark_unread("m1").unwrap();
    assert!(store.get_message("m1").unwrap().unwrap().unread);
}
