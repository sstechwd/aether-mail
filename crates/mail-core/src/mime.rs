//! MIME → what a human reads. Wraps Stalwart's `mail-parser`.
//!
//! Rules that matter here:
//! - The UI must never see boundary markers or `=E2=80=99`. Decode, don't regex.
//! - Attachment *bytes* are not carried in the envelope path; we carry metadata
//!   plus a part index so the body can be pulled on demand.
//! - Inline `cid:` parts are separated from real attachments so the HTML view can
//!   swap `src="cid:x"` for local data without a network fetch.

use chrono::{DateTime, TimeZone, Utc};
use mail_parser::{Address, MessageParser, MimeHeaders, PartType};

/// One attached or inline part. `content_id` set = inline image referenced by `cid:`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    /// Index into the parsed message's part list — how the body is fetched later.
    pub part: usize,
    pub filename: String,
    pub mime_type: String,
    pub size: usize,
    /// Present for inline parts (`Content-ID`), stripped of angle brackets.
    pub content_id: Option<String>,
    pub inline: bool,
}

/// A message decoded far enough to render and to reason about.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedMessage {
    pub from: String,
    pub to: String,
    pub subject: String,
    /// RFC 3339 / ISO 8601 UTC. Empty when the message carries no parsable Date.
    pub date: String,
    pub message_id: String,
    pub text: String,
    pub html: Option<String>,
    pub attachments: Vec<Attachment>,
}

/// Parse raw RFC 5322 bytes. Never panics, never returns wire noise: a message we
/// cannot parse degrades to a lossy-UTF-8 text body so the user still sees something.
pub fn parse_message(raw: &[u8]) -> ParsedMessage {
    let Some(msg) = MessageParser::default().parse(raw) else {
        return ParsedMessage {
            text: String::from_utf8_lossy(raw).to_string(),
            ..Default::default()
        };
    };

    let text = msg
        .text_bodies()
        .find_map(|p| match &p.body {
            PartType::Text(t) => Some(t.to_string()),
            _ => None,
        })
        .or_else(|| msg.body_text(0).map(|t| t.to_string()))
        .unwrap_or_default();

    // Strict: only a genuine text/html part counts. mail-parser's `body_html`
    // helper will happily synthesize HTML from a plain-text message, which would
    // push plain notes through the sandboxed iframe renderer for no reason.
    let html = msg.parts.iter().find_map(|p| {
        let is_html_type = p
            .content_type()
            .and_then(|c| c.subtype())
            .map(|s| s.eq_ignore_ascii_case("html"))
            .unwrap_or(false);
        match (&p.body, is_html_type) {
            (PartType::Html(h), _) => Some(h.to_string()),
            (PartType::Text(t), true) => Some(t.to_string()),
            _ => None,
        }
    });

    let mut attachments = Vec::new();
    for (idx, part) in msg.parts.iter().enumerate() {
        let is_binary = matches!(&part.body, PartType::Binary(_) | PartType::InlineBinary(_));
        let content_id = part
            .content_id()
            .map(|c| c.trim_matches(['<', '>']).to_string());
        let named = part.attachment_name().map(str::to_string);
        // A part counts as an attachment if it carries bytes, or if it is a named
        // part (some senders attach text/csv with a filename and no binary flag).
        if !is_binary && named.is_none() {
            continue;
        }
        let inline = matches!(&part.body, PartType::InlineBinary(_))
            || content_id.is_some()
            || part
                .content_disposition()
                .map(|d| d.ctype().eq_ignore_ascii_case("inline"))
                .unwrap_or(false);
        let mime_type = part
            .content_type()
            .map(|c| match c.subtype() {
                Some(sub) => format!("{}/{}", c.ctype(), sub),
                None => c.ctype().to_string(),
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());
        attachments.push(Attachment {
            part: idx,
            filename: named.unwrap_or_else(|| {
                content_id
                    .clone()
                    .map(|c| format!("inline-{c}"))
                    .unwrap_or_else(|| format!("part-{idx}"))
            }),
            mime_type,
            size: part.len(),
            content_id,
            inline,
        });
    }

    ParsedMessage {
        from: msg.from().map(render_address).unwrap_or_default(),
        to: msg.to().map(render_address).unwrap_or_default(),
        subject: msg.subject().unwrap_or_default().to_string(),
        date: msg
            .date()
            .and_then(|d| Utc.timestamp_opt(d.to_timestamp(), 0).single())
            .map(|d: DateTime<Utc>| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_default(),
        message_id: msg.message_id().unwrap_or_default().to_string(),
        text,
        html,
        attachments,
    }
}

/// Return the decoded bytes of one part, by the index reported in `Attachment::part`.
pub fn part_bytes(raw: &[u8], part: usize) -> Option<Vec<u8>> {
    let msg = MessageParser::default().parse(raw)?;
    let p = msg.parts.get(part)?;
    match &p.body {
        PartType::Binary(b) | PartType::InlineBinary(b) => Some(b.to_vec()),
        PartType::Text(t) | PartType::Html(t) => Some(t.as_bytes().to_vec()),
        _ => None,
    }
}

/// IMAP returns `BODY[HEADER.FIELDS (...)]` and `BODY[TEXT]` as separate items.
/// A multipart body cannot be decoded without the boundary from its header, so
/// rejoin them with the blank line RFC 5322 requires before parsing.
pub fn parse_fetched(header: &[u8], text: &[u8]) -> ParsedMessage {
    let mut raw = Vec::with_capacity(header.len() + text.len() + 2);
    raw.extend_from_slice(header);
    if !header.ends_with(b"\r\n\r\n") {
        if header.ends_with(b"\r\n") {
            raw.extend_from_slice(b"\r\n");
        } else if !header.is_empty() {
            raw.extend_from_slice(b"\r\n\r\n");
        }
    }
    raw.extend_from_slice(text);
    parse_message(&raw)
}

/// A short, whitespace-collapsed snippet for the message list. Char-bounded (not
/// byte-bounded) so a multibyte character is never sliced in half.
pub fn preview(text: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(max_chars.min(text.len()));
    let mut last_was_space = false;
    for ch in text.chars() {
        if out.chars().count() >= max_chars {
            break;
        }
        if ch.is_whitespace() {
            if !last_was_space && !out.is_empty() {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out.trim_end().to_string()
}

/// `"Renée Müller" <renee@example.com>` — decoded, never a raw encoded-word.
fn render_address(addr: &Address) -> String {
    let mut out = Vec::new();
    for a in addr.iter() {
        let email = a.address().unwrap_or_default();
        if email.is_empty() {
            continue;
        }
        match a.name() {
            Some(name) if !name.trim().is_empty() => out.push(format!("{name} <{email}>")),
            _ => out.push(email.to_string()),
        }
    }
    out.join(", ")
}
