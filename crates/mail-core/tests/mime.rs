//! MIME parsing: what the user actually reads, not raw wire bytes.
//! Fixtures are shaped like real Gmail/Outlook mail: multipart, quoted-printable,
//! RFC 2047 encoded words, inline cid: images, attachments.

use mail_core::mime::parse_message;

/// Gmail sends multipart/alternative with quoted-printable. Before this, the UI
/// showed boundary markers and =E2=80=99 instead of a readable sentence.
const MULTIPART_ALT: &str = "From: =?UTF-8?Q?Ren=C3=A9e_M=C3=BCller?= <renee@example.com>\r\n\
To: sumo@example.com\r\n\
Subject: =?UTF-8?B?SW52b2ljZSDigJMgTWFyY2g=?=\r\n\
Date: Tue, 18 Aug 2026 09:12:44 -0700\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/alternative; boundary=\"b1_xyz\"\r\n\
\r\n\
--b1_xyz\r\n\
Content-Type: text/plain; charset=UTF-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
Hi Sumo =E2=80=94 the March invoice is ready. It=E2=80=99s due Friday.\r\n\
\r\n\
--b1_xyz\r\n\
Content-Type: text/html; charset=UTF-8\r\n\
Content-Transfer-Encoding: quoted-printable\r\n\
\r\n\
<p>Hi Sumo =E2=80=94 the March invoice is <b>ready</b>.</p>\r\n\
\r\n\
--b1_xyz--\r\n";

#[test]
fn decodes_quoted_printable_text_part_without_boundary_markers() {
    let parsed = parse_message(MULTIPART_ALT.as_bytes());

    assert!(
        parsed.text.contains("the March invoice is ready"),
        "text part not decoded: {:?}",
        parsed.text
    );
    assert!(
        parsed.text.contains("It\u{2019}s due Friday"),
        "quoted-printable UTF-8 not decoded: {:?}",
        parsed.text
    );
    assert!(
        !parsed.text.contains("b1_xyz"),
        "boundary leaked into readable text: {:?}",
        parsed.text
    );
    assert!(
        !parsed.text.contains("=E2=80"),
        "raw quoted-printable leaked: {:?}",
        parsed.text
    );
}

#[test]
fn keeps_html_part_separate_from_text_part() {
    let parsed = parse_message(MULTIPART_ALT.as_bytes());

    let html = parsed.html.expect("html part missing");
    assert!(html.contains("<b>ready</b>"), "html markup lost: {html:?}");
    assert!(
        !html.contains("b1_xyz"),
        "boundary leaked into html: {html:?}"
    );
}

#[test]
fn decodes_rfc2047_encoded_words_in_subject_and_from() {
    let parsed = parse_message(MULTIPART_ALT.as_bytes());

    assert_eq!(parsed.subject, "Invoice \u{2013} March");
    assert!(
        parsed.from.contains("Ren\u{e9}e M\u{fc}ller"),
        "encoded-word display name not decoded: {:?}",
        parsed.from
    );
    assert!(
        parsed.from.contains("renee@example.com"),
        "address lost: {:?}",
        parsed.from
    );
}

#[test]
fn normalizes_date_to_rfc3339() {
    let parsed = parse_message(MULTIPART_ALT.as_bytes());
    assert_eq!(parsed.date, "2026-08-18T16:12:44Z");
}

#[test]
fn plain_text_message_without_mime_still_reads() {
    let raw = "From: a@example.com\r\n\
Subject: plain note\r\n\
\r\n\
just a line\r\n";
    let parsed = parse_message(raw.as_bytes());
    assert_eq!(parsed.subject, "plain note");
    assert!(parsed.text.contains("just a line"));
    assert!(parsed.html.is_none());
    assert!(parsed.attachments.is_empty());
}
