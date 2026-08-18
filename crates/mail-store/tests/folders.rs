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
