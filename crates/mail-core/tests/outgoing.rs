//! Building outgoing mail with attachments.
//!
//! Sending a file is table stakes — the compose window had no way to do it.
//! The message must be real multipart/mixed so any mail client can read it,
//! and the filename must never let a sender write outside their own message.

use mail_core::outgoing::{build_outgoing, guess_mime, Outgoing, OutgoingAttachment};

fn attachment(name: &str, mime: &str, bytes: &[u8]) -> OutgoingAttachment {
    OutgoingAttachment {
        filename: name.to_string(),
        mime_type: mime.to_string(),
        bytes: bytes.to_vec(),
    }
}

#[test]
fn plain_message_without_attachments_stays_simple() {
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "hello".into(),
        body: "just text".into(),
        html: None,
        attachments: vec![],
    })
    .expect("build failed");

    let raw = String::from_utf8_lossy(&mail);
    assert!(raw.contains("Subject: hello"), "subject missing");
    assert!(raw.contains("just text"), "body missing");
    // No attachments: do not pay for a multipart envelope.
    assert!(
        !raw.contains("multipart/mixed"),
        "plain mail should not be multipart"
    );
}

#[test]
fn message_with_one_attachment_is_multipart_and_carries_the_file() {
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "here is the report".into(),
        body: "see attached".into(),
        html: None,
        attachments: vec![attachment("q3.pdf", "application/pdf", b"%PDF-1.4 fake")],
    })
    .expect("build failed");

    let raw = String::from_utf8_lossy(&mail);
    assert!(raw.contains("multipart/mixed"), "not multipart: {raw:.200}");
    assert!(raw.contains("see attached"), "body lost");
    assert!(raw.contains("application/pdf"), "attachment type lost");
    assert!(raw.contains("q3.pdf"), "filename lost");
    assert!(
        raw.contains("Content-Disposition: attachment"),
        "disposition missing"
    );
    // Binary must be base64 encoded, not raw on the wire.
    assert!(
        raw.contains("base64"),
        "attachment not base64 encoded: {raw:.400}"
    );
}

#[test]
fn multiple_attachments_all_survive() {
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "two files".into(),
        body: "both attached".into(),
        html: None,
        attachments: vec![
            attachment("a.txt", "text/plain", b"alpha"),
            attachment("b.png", "image/png", b"\x89PNG\r\n\x1a\n"),
        ],
    })
    .expect("build failed");

    let raw = String::from_utf8_lossy(&mail);
    assert!(raw.contains("a.txt"), "first attachment lost");
    assert!(raw.contains("b.png"), "second attachment lost");
    assert!(raw.contains("image/png"), "png type lost");
}

#[test]
fn attachment_filename_cannot_carry_a_path() {
    // A crafted filename must not escape into a directory traversal when a
    // receiving client saves it.
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "nasty".into(),
        body: "x".into(),
        html: None,
        attachments: vec![attachment("../../etc/passwd", "text/plain", b"root:x:0:0")],
    })
    .expect("build failed");

    let raw = String::from_utf8_lossy(&mail);
    assert!(
        !raw.contains("../"),
        "path separators survived into the message: {raw:.400}"
    );
    assert!(raw.contains("passwd"), "basename should survive");
}

#[test]
fn rejects_a_message_with_no_recipient() {
    let err = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "   ".into(),
        subject: "x".into(),
        body: "x".into(),
        html: None,
        attachments: vec![],
    });
    assert!(err.is_err(), "empty recipient must be refused");
}

#[test]
fn guesses_common_mime_types_from_the_extension() {
    assert_eq!(guess_mime("report.pdf"), "application/pdf");
    assert_eq!(guess_mime("photo.PNG"), "image/png");
    assert_eq!(guess_mime("notes.txt"), "text/plain");
    assert_eq!(
        guess_mime("sheet.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    // Unknown extensions fall back to a safe generic type.
    assert_eq!(guess_mime("mystery.zzz"), "application/octet-stream");
    assert_eq!(guess_mime("noextension"), "application/octet-stream");
}

// ---------------------------------------------------------------------------
// Rich text.
//
// When the user formats a message we must send multipart/alternative: an HTML
// part for clients that render it, and a text part for those that do not. A
// mail with no text part looks empty to anyone reading in plain text.
// ---------------------------------------------------------------------------

#[test]
fn html_body_produces_multipart_alternative() {
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "Formatted".into(),
        body: "Hello world".into(),
        html: Some("<p><b>Hello</b> world</p>".into()),
        ..Default::default()
    })
    .expect("builds");
    let text = String::from_utf8(mail).expect("utf8");

    assert!(
        text.contains("multipart/alternative"),
        "needs an alternative container"
    );
    assert!(text.contains("text/plain"), "needs a plain part");
    assert!(text.contains("text/html"), "needs an html part");
    assert!(text.contains("<b>Hello</b>"), "html survives");
    assert!(text.contains("Hello world"), "plain survives");
}

#[test]
fn plain_part_comes_before_html_part() {
    // RFC 2046: least-faithful alternative first. Clients pick the last one
    // they understand, so HTML must come after or nobody sees the formatting.
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "Order".into(),
        body: "plain version".into(),
        html: Some("<p>html version</p>".into()),
        ..Default::default()
    })
    .expect("builds");
    let text = String::from_utf8(mail).expect("utf8");

    let plain_at = text.find("text/plain").expect("plain part");
    let html_at = text.find("text/html").expect("html part");
    assert!(plain_at < html_at, "text/plain must come first");
}

#[test]
fn html_with_attachments_nests_alternative_inside_mixed() {
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "Both".into(),
        body: "see attached".into(),
        html: Some("<p>see <b>attached</b></p>".into()),
        attachments: vec![attachment("a.txt", "text/plain", b"hi")],
    })
    .expect("builds");
    let text = String::from_utf8(mail).expect("utf8");

    assert!(text.contains("multipart/mixed"), "outer container");
    assert!(text.contains("multipart/alternative"), "inner container");
    assert!(text.contains("a.txt"), "attachment present");
    assert!(text.contains("<b>attached</b>"), "html present");
}

#[test]
fn no_html_still_sends_a_simple_plain_message() {
    // Not every message is formatted; the simple path must not regress.
    let mail = build_outgoing(&Outgoing {
        from: "me@example.com".into(),
        to: "you@example.com".into(),
        subject: "Plain".into(),
        body: "just words".into(),
        html: None,
        ..Default::default()
    })
    .expect("builds");
    let text = String::from_utf8(mail).expect("utf8");

    assert!(!text.contains("multipart"), "no container needed");
    assert!(text.contains("just words"));
}

// ---------------------------------------------------------------------------
// XOAUTH2.
//
// Google and Microsoft are retiring app passwords, so IMAP and SMTP have to
// authenticate with a bearer token. The SASL initial response is a fixed
// shape and getting a separator wrong fails with an opaque server error, so
// it is pinned here.
// ---------------------------------------------------------------------------

#[test]
fn xoauth2_has_the_exact_sasl_shape() {
    let s = mail_core::outgoing::xoauth2_sasl("me@example.com", "tok123");
    let decoded = String::from_utf8(
        base64_decode(&s).expect("valid base64"),
    )
    .expect("utf8");
    assert_eq!(decoded, "user=me@example.com\x01auth=Bearer tok123\x01\x01");
}

#[test]
fn xoauth2_is_base64() {
    let s = mail_core::outgoing::xoauth2_sasl("a@b.c", "t");
    assert!(s.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}
