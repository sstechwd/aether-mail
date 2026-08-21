//! aether-cli — password on stdin for secret-put; otherwise read from OS keyring.
//! Never print the secret. Never accept the secret as an argv flag.

use aether_secrets::{OsSecrets, SecretStore};
use base64::Engine;
use mail_core::mime::{parse_fetched, part_bytes, preview, Attachment};
use mail_core::outgoing::{build_outgoing, guess_mime, Outgoing, OutgoingAttachment};
use mail_core::probe::{validate_probe, ImapEndpoint};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::process::ExitCode;

const SERVICE: &str = "aether-mail";
/// Envelope preview shown in the list. Bodies load on open, so this stays small.
const PREVIEW_CHARS: usize = 400;
/// Cap on a single decoded body handed to the UI.
const BODY_CHARS: usize = 200_000;
/// Refuse to inline an image larger than this (bytes) — keeps the webview lean.
const MAX_INLINE_BYTES: usize = 2 * 1024 * 1024;
/// Most providers reject mail over ~25MB; refuse locally with a clear message
/// rather than letting SMTP fail after the upload.
const MAX_ATTACH_TOTAL: usize = 24 * 1024 * 1024;

#[derive(Serialize)]
struct JsonOut {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folders: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<Vec<Fetched>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    part: Option<PartOut>,
}

#[derive(Serialize)]
struct Fetched {
    id: String,
    folder: String,
    from: String,
    to: String,
    subject: String,
    date: String,
    unread: bool,
    body: String,
    headers: String,
    /// Decoded text/html part, when the message actually has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
    /// Short snippet for the list row.
    preview: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<AttachmentOut>,
}

#[derive(Serialize)]
struct AttachmentOut {
    part: usize,
    filename: String,
    mime_type: String,
    size: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_id: Option<String>,
    inline: bool,
}

#[derive(Serialize)]
struct PartOut {
    mime_type: String,
    /// base64 of the decoded bytes — safe to embed as a data: URL.
    data: String,
}

impl From<&Attachment> for AttachmentOut {
    fn from(a: &Attachment) -> Self {
        Self {
            part: a.part,
            filename: a.filename.clone(),
            mime_type: a.mime_type.clone(),
            size: a.size,
            content_id: a.content_id.clone(),
            inline: a.inline,
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(
                io::stderr(),
                "{}",
                serde_json::to_string(&JsonOut {
                    ok: false,
                    error: Some(sanitize(&e)),
                    folders: None,
                    messages: None,
                    part: None,
                })
                .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"cli\"}".into())
            );
            ExitCode::from(1)
        }
    }
}

fn sanitize(err: &str) -> String {
    // Our own static usage text is known-safe and never contains a credential.
    // Everything else is treated as untrusted: if it mentions credentials at all,
    // we drop it rather than risk echoing a password into a log.
    if err.starts_with("usage: aether-cli") {
        return err.to_string();
    }
    let lower = err.to_ascii_lowercase();
    if lower.contains("password") || lower.contains("secret") || lower.contains("credential") {
        "mail command failed (details omitted so a secret is not printed)".into()
    } else {
        err.chars().take(240).collect()
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let action = args.first().map(String::as_str).unwrap_or("");
    let flags = flags(&args);
    match action {
        "secret-put" => secret_put(&flags),
        "secret-delete" => secret_delete(&flags),
        "probe" => probe(&flags),
        "fetch" => fetch_mail(&flags),
        "part" => fetch_part(&flags),
        "send" => send_mail(&flags),
        _ => Err("usage: aether-cli secret-put|secret-delete|probe|fetch|part|send [flags]".into()),
    }
}

fn flags(args: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut i = 1;
    while i < args.len() {
        if args[i].starts_with("--") && i + 1 < args.len() {
            out.insert(args[i][2..].to_string(), args[i + 1].clone());
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn secrets() -> OsSecrets {
    OsSecrets::new(SERVICE)
}

fn secret_put(flags: &HashMap<String, String>) -> Result<(), String> {
    let refer = flags.get("secret-ref").ok_or("need --secret-ref")?;
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| e.to_string())?;
    let secret = buf.trim_end_matches(['\r', '\n']);
    if secret.is_empty() {
        return Err("need password on stdin".into());
    }
    secrets().put(refer, secret).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
            part: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

fn secret_delete(flags: &HashMap<String, String>) -> Result<(), String> {
    let refer = flags.get("secret-ref").ok_or("need --secret-ref")?;
    secrets().delete(refer).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
            part: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

fn load_secret(flags: &HashMap<String, String>) -> Result<String, String> {
    let refer = flags.get("secret-ref").ok_or("need --secret-ref")?;
    secrets()
        .get(refer)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no secret in OS keyring for this account".into())
}

fn probe(flags: &HashMap<String, String>) -> Result<(), String> {
    let host = flags.get("host").cloned().unwrap_or_default();
    let port: u16 = flags
        .get("port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(993);
    let tls = flags.get("tls").cloned().unwrap_or_else(|| "ssl".into());
    let user = flags.get("user").cloned().unwrap_or_default();
    let secret = load_secret(flags)?;
    let ep = ImapEndpoint {
        host: host.clone(),
        port,
        tls: tls.clone(),
    };
    validate_probe(&ep, &user, &secret).map_err(|e| e.to_string())?;
    let mut session = imap_login(&host, port, &tls, &user, &secret)?;
    let list = session.list(None, Some("*")).map_err(|e| e.to_string())?;
    let folders: Vec<String> = list.iter().map(|n| n.name().to_string()).collect();
    let _ = session.logout();
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: Some(folders),
            messages: None,
            part: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

fn fetch_mail(flags: &HashMap<String, String>) -> Result<(), String> {
    let host = flags.get("host").cloned().unwrap_or_default();
    let port: u16 = flags
        .get("port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(993);
    let tls = flags.get("tls").cloned().unwrap_or_else(|| "ssl".into());
    let user = flags.get("user").cloned().unwrap_or_default();
    let folder = flags
        .get("folder")
        .cloned()
        .unwrap_or_else(|| "INBOX".into());
    let secret = load_secret(flags)?;
    let ep = ImapEndpoint {
        host: host.clone(),
        port,
        tls: tls.clone(),
    };
    validate_probe(&ep, &user, &secret).map_err(|e| e.to_string())?;
    let mut session = imap_login(&host, port, &tls, &user, &secret)?;
    let mut seq = "1:40".to_string();
    if let Ok(mailbox) = session.select(&folder) {
        let exists = mailbox.exists;
        if exists == 0 {
            let _ = session.logout();
            println!(
                "{}",
                serde_json::to_string(&JsonOut {
                    ok: true,
                    error: None,
                    folders: None,
                    messages: Some(Vec::new()),
                    part: None,
                })
                .map_err(|e| e.to_string())?
            );
            return Ok(());
        }
        let start = if exists > 40 { exists - 39 } else { 1 };
        seq = format!("{start}:{exists}");
    }
    let fetches = session
        .fetch(
            &seq,
            // Full header + body text: a multipart body cannot be decoded without
            // the Content-Type boundary, and truncating mid-part corrupts base64.
            "(UID FLAGS BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.262144>)",
        )
        .map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    for item in fetches.iter() {
        let uid = item.uid.unwrap_or(0);
        let header = item.header().unwrap_or(b"");
        let header_txt = String::from_utf8_lossy(header);
        let text = item.text().unwrap_or(b"");
        let unread = item
            .flags()
            .iter()
            .all(|f| format!("{f:?}") != "Seen" && format!("{f:?}") != "\\Seen");
        let parsed = parse_fetched(header, text);
        // Prefer decoded MIME; fall back to raw only if the message had no text part.
        let body: String = if parsed.text.trim().is_empty() {
            String::from_utf8_lossy(text)
                .chars()
                .take(BODY_CHARS)
                .collect()
        } else {
            parsed.text.chars().take(BODY_CHARS).collect()
        };
        messages.push(Fetched {
            id: format!("imap-{uid}"),
            folder: folder.clone(),
            // Decoded (RFC 2047) values win; raw header is the fallback.
            from: non_empty(parsed.from.clone(), || header_field(&header_txt, "From")),
            to: non_empty(parsed.to.clone(), || header_field(&header_txt, "To")),
            subject: non_empty(parsed.subject.clone(), || {
                header_field(&header_txt, "Subject")
            }),
            date: non_empty(parsed.date.clone(), || header_field(&header_txt, "Date")),
            unread,
            preview: preview(&body, PREVIEW_CHARS),
            html: parsed.html.map(|h| h.chars().take(BODY_CHARS).collect()),
            attachments: parsed.attachments.iter().map(AttachmentOut::from).collect(),
            body,
            headers: header_txt.chars().take(8000).collect(),
        });
    }
    let _ = session.logout();
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: Some(messages),
            part: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

/// Pull one decoded part (attachment or inline image) on demand, by UID + index.
/// Kept separate from `fetch` so the list path never carries attachment bytes.
fn fetch_part(flags: &HashMap<String, String>) -> Result<(), String> {
    let host = flags.get("host").cloned().unwrap_or_default();
    let port: u16 = flags
        .get("port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(993);
    let tls = flags.get("tls").cloned().unwrap_or_else(|| "ssl".into());
    let user = flags.get("user").cloned().unwrap_or_default();
    let folder = flags
        .get("folder")
        .cloned()
        .unwrap_or_else(|| "INBOX".into());
    let uid = flags
        .get("uid")
        .and_then(|u| u.trim_start_matches("imap-").parse::<u32>().ok())
        .ok_or("need --uid")?;
    let index: usize = flags
        .get("part")
        .and_then(|p| p.parse().ok())
        .ok_or("need --part")?;
    let secret = load_secret(flags)?;
    let ep = ImapEndpoint {
        host: host.clone(),
        port,
        tls: tls.clone(),
    };
    validate_probe(&ep, &user, &secret).map_err(|e| e.to_string())?;
    let mut session = imap_login(&host, port, &tls, &user, &secret)?;
    session.select(&folder).map_err(|e| e.to_string())?;
    let fetches = session
        .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
        .map_err(|e| e.to_string())?;
    let item = fetches.iter().next().ok_or("message not found")?;
    let raw = item.body().or_else(|| item.text()).unwrap_or(b"");
    let parsed = parse_fetched(b"", raw);
    let meta = parsed
        .attachments
        .iter()
        .find(|a| a.part == index)
        .ok_or("no such part")?;
    if meta.size > MAX_INLINE_BYTES {
        let _ = session.logout();
        return Err(format!(
            "part is {} bytes, over the {MAX_INLINE_BYTES} byte inline limit",
            meta.size
        ));
    }
    let bytes = part_bytes(raw, index).ok_or("part has no decodable bytes")?;
    let _ = session.logout();
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
            part: Some(PartOut {
                mime_type: meta.mime_type.clone(),
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
            }),
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

/// `Name <a@b.c>` -> `a@b.c`. lettre's envelope wants a bare address.
fn extract_addr(value: &str) -> String {
    if let Some(start) = value.rfind('<') {
        if let Some(end) = value[start..].find('>') {
            return value[start + 1..start + end].trim().to_string();
        }
    }
    value.trim().to_string()
}

/// stdin is either a raw body (older callers) or `{"body": "...",
/// "attachments": ["C:/path/file.pdf"]}`. Returns (body, paths).
/// Parse the JSON the API sends on stdin: body text, optional formatted HTML,
/// and attachment paths. Paths go over stdin rather than argv so filenames
/// never reach a process list or a shell log.
fn parse_send_stdin(raw: &str) -> (String, Option<String>, Vec<String>) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with('{') {
        return (raw.to_string(), None, Vec::new());
    }
    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(v) => {
            let body = v
                .get("body")
                .and_then(|b| b.as_str())
                .unwrap_or_default()
                .to_string();
            let html = v
                .get("html")
                .and_then(|h| h.as_str())
                .filter(|h| !h.trim().is_empty())
                .map(str::to_string);
            let paths = v
                .get("attachments")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|p| p.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            (body, html, paths)
        }
        // Body that merely happens to start with '{' is still a body.
        Err(_) => (raw.to_string(), None, Vec::new()),
    }
}

fn non_empty(value: String, fallback: impl FnOnce() -> String) -> String {
    if value.trim().is_empty() {
        fallback()
    } else {
        value
    }
}

fn send_mail(flags: &HashMap<String, String>) -> Result<(), String> {
    let smtp_host = flags.get("smtp-host").cloned().unwrap_or_default();
    let smtp_port: u16 = flags
        .get("smtp-port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(587);
    let user = flags.get("user").cloned().unwrap_or_default();
    let from = flags.get("from").cloned().unwrap_or_else(|| user.clone());
    let to = flags.get("to").cloned().unwrap_or_default();
    let subject = flags.get("subject").cloned().unwrap_or_default();
    if smtp_host.is_empty() || to.is_empty() {
        return Err("need --smtp-host and --to".into());
    }
    if smtp_port == 25 {
        return Err("plaintext SMTP port 25 is forbidden".into());
    }
    let secret = load_secret(flags)?;
    let mut body = String::new();
    io::stdin()
        .read_to_string(&mut body)
        .map_err(|e| e.to_string())?;

    // stdin is either a plain body (back-compat) or a JSON envelope carrying
    // the body plus attachment paths. Paths never go on argv: the command line
    // is visible to every process on the machine.
    let (body_text, body_html, attachment_paths) = parse_send_stdin(&body);

    let mut attachments = Vec::new();
    let mut total: usize = 0;
    for path in &attachment_paths {
        let bytes = std::fs::read(path).map_err(|e| format!("cannot read attachment: {e}"))?;
        total += bytes.len();
        if total > MAX_ATTACH_TOTAL {
            return Err(format!(
                "attachments exceed the {} MB limit most mail servers accept",
                MAX_ATTACH_TOTAL / (1024 * 1024)
            ));
        }
        let filename = std::path::Path::new(path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "attachment".to_string());
        let mime_type = guess_mime(&filename).to_string();
        attachments.push(OutgoingAttachment {
            filename,
            mime_type,
            bytes,
        });
    }

    let raw = build_outgoing(&Outgoing {
        from: from.clone(),
        to: to.clone(),
        subject: subject.clone(),
        body: body_text,
        html: body_html,
        attachments,
    })?;

    let creds = lettre::transport::smtp::authentication::Credentials::new(user, secret);
    let mailer = if smtp_port == 465 {
        lettre::SmtpTransport::relay(&smtp_host)
            .map_err(|e| e.to_string())?
            .port(465)
            .credentials(creds)
            .build()
    } else {
        lettre::SmtpTransport::starttls_relay(&smtp_host)
            .map_err(|e| e.to_string())?
            .port(smtp_port)
            .credentials(creds)
            .build()
    };
    // Send the raw RFC 5322 bytes we built, so multipart/attachments survive
    // exactly as composed. Envelope addresses are parsed separately.
    let envelope = lettre::address::Envelope::new(
        Some(
            extract_addr(&from)
                .parse()
                .map_err(|e: lettre::address::AddressError| e.to_string())?,
        ),
        vec![extract_addr(&to)
            .parse()
            .map_err(|e: lettre::address::AddressError| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    lettre::Transport::send_raw(&mailer, &envelope, &raw).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
            part: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
}

/// SASL XOAUTH2 authenticator.
///
/// `imap` calls this to produce the initial client response. The secret is a
/// short-lived OAuth access token, not a password.
struct XOAuth2 {
    email: String,
    access_token: String,
}

impl imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> Self::Response {
        // mail_core owns the wire format so it is pinned by one test.
        mail_core::outgoing::xoauth2_sasl(&self.email, &self.access_token)
    }
}

fn imap_login(
    host: &str,
    port: u16,
    tls: &str,
    user: &str,
    secret: &str,
) -> Result<imap::Session<native_tls::TlsStream<std::net::TcpStream>>, String> {
    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(false)
        .danger_accept_invalid_hostnames(false)
        .build()
        .map_err(|e| e.to_string())?;
    let mode = tls.to_ascii_lowercase();
    let client = if mode == "starttls" {
        let raw = imap::connect_starttls((host, port), host, &connector).or_else(|_| {
            let tcp = std::net::TcpStream::connect((host, port)).map_err(|e| e.to_string())?;
            let client = imap::Client::new(tcp);
            client.secure(host, &connector).map_err(|e| e.to_string())
        });
        match raw {
            Ok(c) => c,
            Err(e) => return Err(e.to_string()),
        }
    } else {
        imap::connect((host, port), host, &connector).map_err(|e| e.to_string())?
    };

    /*
     * An OAuth access token arrives prefixed so the CLI can tell it apart from
     * a password without a second argument. Google and Microsoft are retiring
     * app passwords, but plenty of servers still only speak LOGIN, so both
     * paths stay.
     */
    if let Some(token) = secret.strip_prefix("oauth2:") {
        let auth = XOAuth2 {
            email: user.to_string(),
            access_token: token.to_string(),
        };
        return client
            .authenticate("XOAUTH2", &auth)
            .map_err(|e| e.0.to_string());
    }

    client.login(user, secret).map_err(|e| e.0.to_string())
}

fn header_field(headers: &str, name: &str) -> String {
    let prefix = format!("{name}:");
    for line in headers.lines() {
        if line.len() >= prefix.len() && line[..prefix.len()].eq_ignore_ascii_case(&prefix) {
            return line[prefix.len()..].trim().to_string();
        }
    }
    String::new()
}
