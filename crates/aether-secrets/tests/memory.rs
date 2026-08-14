use aether_secrets::{MemorySecrets, SecretStore};

#[test]
fn put_get_delete_never_returns_empty_on_missing() {
    let store = MemorySecrets::default();
    store.put("keyring:acc-1", "s3cret").unwrap();
    assert_eq!(store.get("keyring:acc-1").unwrap().as_deref(), Some("s3cret"));
    store.delete("keyring:acc-1").unwrap();
    assert_eq!(store.get("keyring:acc-1").unwrap(), None);
}
