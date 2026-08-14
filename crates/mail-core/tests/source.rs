use chrono::{TimeZone, Utc};
use mail_core::{Envelope, InMemorySource, MailSource};

#[test]
fn memory_source_lists_and_fetches() {
    let mut src = InMemorySource::new("fixture");
    src.push(Envelope {
        id: "m1".into(),
        folder: "INBOX".into(),
        from: "ada@example.com".into(),
        to: "you@localhost".into(),
        subject: "notes".into(),
        date: Utc.with_ymd_and_hms(2026, 8, 13, 10, 0, 0).unwrap(),
    });
    let folders = src.list_folders().unwrap();
    assert_eq!(folders, vec!["INBOX".to_string()]);
    let listed = src.list_envelopes("INBOX").unwrap();
    assert_eq!(listed[0].subject, "notes");
    assert_eq!(src.fetch("m1").unwrap().unwrap().from, "ada@example.com");
    assert!(src.fetch("nope").unwrap().is_none());
}
