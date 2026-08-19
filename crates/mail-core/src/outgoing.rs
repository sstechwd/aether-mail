//! Building outgoing mail.
//!
//! Kept in `mail-core` rather than the CLI so the message shape is testable
//! without a network or an SMTP server. `aether-cli send` consumes this.
//!
//! Security notes:
//! - Attachment filenames are attacker-influenced (a draft can come from an
//!   agent proposal). We strip any path before it reaches the wire.
//! - Headers are sanitized against CRLF injection: a newline in a subject or
//!   recipient would otherwise let a caller inject arbitrary headers.

use base64::Engine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingAttachment {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outgoing {
    pub from: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<OutgoingAttachment>,
}

/// Strip any directory component. A filename is never a path.
pub fn safe_filename(name: &str) -> String {
    let base = name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('.')
        .to_string();
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '"' | '\r' | '\n' | '\0'))
        .collect();
    if cleaned.is_empty() {
        "attachment".to_string()
    } else {
        cleaned
    }
}

/// A header value can never contain a line break.
fn header_safe(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

/// Best-effort content type from a file extension.
pub fn guess_mime(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    // No extension at all (no '.' in the name) must not match the whole name.
    if !filename.contains('.') {
        return "application/octet-stream";
    }
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ics" => "text/calendar",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// Render RFC 5322 bytes ready to hand to SMTP.
pub fn build_outgoing(mail: &Outgoing) -> Result<Vec<u8>, String> {
    let to = header_safe(&mail.to);
    if to.is_empty() {
        return Err("need a recipient".into());
    }
    let from = header_safe(&mail.from);
    if from.is_empty() {
        return Err("need a sender".into());
    }
    let subject = header_safe(&mail.subject);

    let mut out = String::new();
    out.push_str(&format!("From: {from}\r\n"));
    out.push_str(&format!("To: {to}\r\n"));
    out.push_str(&format!("Subject: {}\r\n", encode_header(&subject)));
    out.push_str("MIME-Version: 1.0\r\n");

    if mail.attachments.is_empty() {
        out.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(&mail.body.replace("\r\n", "\n").replace('\n', "\r\n"));
        return Ok(out.into_bytes());
    }

    let boundary = boundary_for(mail);
    out.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"
    ));
    out.push_str("This is a multi-part message in MIME format.\r\n\r\n");

    out.push_str(&format!("--{boundary}\r\n"));
    out.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
    out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
    out.push_str(&mail.body.replace("\r\n", "\n").replace('\n', "\r\n"));
    out.push_str("\r\n\r\n");

    for att in &mail.attachments {
        let name = safe_filename(&att.filename);
        let mime = if att.mime_type.trim().is_empty() {
            guess_mime(&name).to_string()
        } else {
            header_safe(&att.mime_type)
        };
        out.push_str(&format!("--{boundary}\r\n"));
        out.push_str(&format!("Content-Type: {mime}; name=\"{name}\"\r\n"));
        out.push_str("Content-Transfer-Encoding: base64\r\n");
        out.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{name}\"\r\n\r\n"
        ));
        let encoded = base64::engine::general_purpose::STANDARD.encode(&att.bytes);
        // RFC 2045: base64 lines are at most 76 characters.
        for chunk in encoded.as_bytes().chunks(76) {
            out.push_str(&String::from_utf8_lossy(chunk));
            out.push_str("\r\n");
        }
        out.push_str("\r\n");
    }

    out.push_str(&format!("--{boundary}--\r\n"));
    Ok(out.into_bytes())
}

/// RFC 2047 encode a header only when it is not plain ASCII.
fn encode_header(value: &str) -> String {
    if value.is_ascii() {
        return value.to_string();
    }
    format!(
        "=?UTF-8?B?{}?=",
        base64::engine::general_purpose::STANDARD.encode(value.as_bytes())
    )
}

/// Deterministic, collision-resistant boundary that cannot appear in the body.
fn boundary_for(mail: &Outgoing) -> String {
    let mut seed: u64 = 0xcbf29ce484222325;
    let mut mix = |bytes: &[u8]| {
        for b in bytes {
            seed ^= u64::from(*b);
            seed = seed.wrapping_mul(0x100000001b3);
        }
    };
    mix(mail.subject.as_bytes());
    mix(mail.body.as_bytes());
    for a in &mail.attachments {
        mix(a.filename.as_bytes());
        mix(&a.bytes.len().to_le_bytes());
    }
    format!("----=_aether_{seed:016x}")
}
