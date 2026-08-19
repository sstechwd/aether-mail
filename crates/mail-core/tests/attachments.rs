//! Attachments and inline cid: images — the "shows a placeholder" bug in CHECKPOINT §8.
//! A real newsletter is multipart/related: an HTML part plus an image referenced
//! as <img src="cid:logo123">. We must resolve that locally, never over the network.

use mail_core::mime::{parse_message, part_bytes};

/// base64 of a 1x1 GIF — stands in for a real inline logo.
const GIF_B64: &str = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

fn related_with_inline_and_attachment() -> String {
    format!(
        "From: Billing <billing@example.com>\r\n\
Subject: Your receipt\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"mix\"\r\n\
\r\n\
--mix\r\n\
Content-Type: multipart/related; boundary=\"rel\"\r\n\
\r\n\
--rel\r\n\
Content-Type: text/html; charset=UTF-8\r\n\
\r\n\
<p>Thanks!</p><img src=3D\"cid:logo123\" alt=3D\"logo\">\r\n\
\r\n\
--rel\r\n\
Content-Type: image/gif\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-ID: <logo123>\r\n\
Content-Disposition: inline; filename=\"logo.gif\"\r\n\
\r\n\
{GIF_B64}\r\n\
\r\n\
--rel--\r\n\
\r\n\
--mix\r\n\
Content-Type: application/pdf\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-Disposition: attachment; filename=\"receipt.pdf\"\r\n\
\r\n\
JVBERi0xLjQK\r\n\
\r\n\
--mix--\r\n"
    )
}

#[test]
fn separates_inline_images_from_real_attachments() {
    let raw = related_with_inline_and_attachment();
    let parsed = parse_message(raw.as_bytes());

    let inline: Vec<_> = parsed.attachments.iter().filter(|a| a.inline).collect();
    let files: Vec<_> = parsed.attachments.iter().filter(|a| !a.inline).collect();

    assert_eq!(
        inline.len(),
        1,
        "expected one inline part: {:?}",
        parsed.attachments
    );
    assert_eq!(inline[0].content_id.as_deref(), Some("logo123"));
    assert_eq!(inline[0].mime_type, "image/gif");

    assert_eq!(
        files.len(),
        1,
        "expected one real attachment: {:?}",
        parsed.attachments
    );
    assert_eq!(files[0].filename, "receipt.pdf");
    assert_eq!(files[0].mime_type, "application/pdf");
}

#[test]
fn inline_part_bytes_decode_to_real_image_data() {
    let raw = related_with_inline_and_attachment();
    let parsed = parse_message(raw.as_bytes());
    let inline = parsed
        .attachments
        .iter()
        .find(|a| a.content_id.as_deref() == Some("logo123"))
        .expect("inline part missing");

    let bytes = part_bytes(raw.as_bytes(), inline.part).expect("no bytes for inline part");

    // GIF89a magic — proves base64 was actually decoded, not passed through.
    assert_eq!(&bytes[..6], b"GIF89a", "inline image not base64-decoded");
}

#[test]
fn attachment_names_survive_rfc2047_encoding() {
    let raw = "From: a@example.com\r\n\
Subject: report\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"m\"\r\n\
\r\n\
--m\r\n\
Content-Type: text/plain\r\n\
\r\n\
see attached\r\n\
\r\n\
--m\r\n\
Content-Type: application/pdf\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-Disposition: attachment; filename=\"=?UTF-8?Q?a=C3=B1o.pdf?=\"\r\n\
\r\n\
JVBERi0xLjQK\r\n\
\r\n\
--m--\r\n";
    let parsed = parse_message(raw.as_bytes());
    let file = parsed
        .attachments
        .iter()
        .find(|a| !a.inline)
        .expect("attachment missing");
    assert_eq!(file.filename, "a\u{f1}o.pdf");
}

#[test]
fn treats_content_id_part_as_inline_without_a_disposition_header() {
    // Real newsletters often send Content-ID and no Content-Disposition at all.
    // If we only trusted the disposition header this would show up as a junk
    // "attachment" in the strip and the <img src="cid:"> would stay broken.
    let raw = format!(
        "From: News <news@example.com>\r\n\
Subject: weekly\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/related; boundary=\"r\"\r\n\
\r\n\
--r\r\n\
Content-Type: text/html\r\n\
\r\n\
<img src=\"cid:hdr\">\r\n\
\r\n\
--r\r\n\
Content-Type: image/gif\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-ID: <hdr>\r\n\
\r\n\
{GIF_B64}\r\n\
\r\n\
--r--\r\n"
    );
    let parsed = parse_message(raw.as_bytes());
    let part = parsed
        .attachments
        .iter()
        .find(|a| a.content_id.as_deref() == Some("hdr"))
        .expect("cid part missing entirely");
    assert!(
        part.inline,
        "cid part without Content-Disposition must still be inline: {part:?}"
    );
    assert!(
        parsed.attachments.iter().all(|a| a.inline),
        "no real attachments expected here: {:?}",
        parsed.attachments
    );
}

#[test]
fn text_only_message_reports_no_attachments() {
    let raw = "From: a@example.com\r\nSubject: hi\r\n\r\nno files here\r\n";
    let parsed = parse_message(raw.as_bytes());
    assert!(parsed.attachments.is_empty(), "{:?}", parsed.attachments);
}
