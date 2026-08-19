//! IMAP hands us headers and body text as *separate* fetch items. To decode a
//! multipart body you need the Content-Type boundary from the header, so the list
//! path must rejoin them before parsing — without pulling whole messages into RAM.

use mail_core::mime::{parse_fetched, preview};

const HEADER: &str = "From: Ops <ops@example.com>\r\n\
To: sumo@example.com\r\n\
Subject: =?UTF-8?Q?Deploy_=E2=9C=93?=\r\n\
Date: Tue, 18 Aug 2026 09:12:44 -0700\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/alternative; boundary=\"bnd\"\r\n";

const TEXT: &str = "--bnd\r\n\
Content-Type: text/plain; charset=UTF-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
Deploy finished =E2=80=94 all green.\r\n\
\r\n\
--bnd\r\n\
Content-Type: text/html; charset=UTF-8\r\n\
\r\n\
<p>Deploy finished</p>\r\n\
\r\n\
--bnd--\r\n";

#[test]
fn rejoins_split_header_and_text_to_decode_a_multipart_body() {
    let parsed = parse_fetched(HEADER.as_bytes(), TEXT.as_bytes());

    assert_eq!(parsed.subject, "Deploy \u{2713}");
    assert!(
        parsed.text.contains("Deploy finished \u{2014} all green"),
        "body not decoded from split fetch: {:?}",
        parsed.text
    );
    assert!(
        !parsed.text.contains("--bnd"),
        "boundary leaked: {:?}",
        parsed.text
    );
    assert!(parsed.html.is_some(), "html part lost in split fetch");
}

#[test]
fn header_only_fetch_still_yields_envelope_fields() {
    let parsed = parse_fetched(HEADER.as_bytes(), b"");
    assert_eq!(parsed.from, "Ops <ops@example.com>");
    assert_eq!(parsed.date, "2026-08-18T16:12:44Z");
}

#[test]
fn preview_is_bounded_and_collapses_whitespace() {
    let long = format!("start {}end", "x ".repeat(4000));
    let out = preview(&long, 200);
    assert!(
        out.chars().count() <= 200,
        "preview not capped: {}",
        out.chars().count()
    );
    assert!(
        out.starts_with("start"),
        "preview lost the beginning: {out:?}"
    );
    assert!(!out.contains("  "), "preview kept runs of whitespace");
}

#[test]
fn preview_does_not_split_a_multibyte_character() {
    let s = "\u{2014}".repeat(50); // em dashes, 3 bytes each
    let out = preview(&s, 10);
    assert_eq!(out.chars().count(), 10);
    assert!(out.chars().all(|c| c == '\u{2014}'));
}
