use aether_secrets::{OsSecrets, SecretStore};

/// Live Windows Credential Manager write. Isolated test key; deleted after.
#[test]
fn os_keyring_roundtrip() {
    let store = OsSecrets::new("aether-mail-test");
    let key = "unit-test-ref";
    store.put(key, "not-a-real-password").unwrap();
    assert_eq!(store.get(key).unwrap().as_deref(), Some("not-a-real-password"));
    store.delete(key).unwrap();
    assert_eq!(store.get(key).unwrap(), None);
}
