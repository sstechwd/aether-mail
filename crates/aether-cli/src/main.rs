//! aether-cli — password on stdin for secret-put; otherwise read from OS keyring.
//! Never print the secret. Never accept the secret as an argv flag.

use aether_secrets::{OsSecrets, SecretStore};
use mail_core::probe::{validate_probe, ImapEndpoint};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::process::ExitCode;

const SERVICE: &str = "aether-mail";

#[derive(Serialize)]
struct JsonOut {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folders: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<Vec<Fetched>>,
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
                })
                .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"cli\"}".into())
            );
            ExitCode::from(1)
        }
    }
}

fn sanitize(err: &str) -> String {
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
        "send" => send_mail(&flags),
        _ => Err("usage: aether-cli secret-put|secret-delete|probe|fetch|send --secret-ref <id> ...".into()),
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
    secrets()
        .put(refer, secret)
        .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
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
    let list = session
        .list(None, Some("*"))
        .map_err(|e| e.to_string())?;
    let folders: Vec<String> = list.iter().map(|n| n.name().to_string()).collect();
    let _ = session.logout();
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: Some(folders),
            messages: None,
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
            "(UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE RETURN-PATH REPLY-TO RECEIVED AUTHENTICATION-RESULTS MESSAGE-ID)] BODY.PEEK[TEXT]<0.4000>)",
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
        messages.push(Fetched {
            id: format!("imap-{uid}"),
            folder: folder.clone(),
            from: header_field(&header_txt, "From"),
            to: header_field(&header_txt, "To"),
            subject: header_field(&header_txt, "Subject"),
            date: header_field(&header_txt, "Date"),
            unread,
            body: String::from_utf8_lossy(text).chars().take(4000).collect(),
            headers: header_txt.chars().take(4000).collect(),
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
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
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
    let email = lettre::Message::builder()
        .from(from.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .to(to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .subject(subject)
        .body(body)
        .map_err(|e| e.to_string())?;
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
    lettre::Transport::send(&mailer, &email).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&JsonOut {
            ok: true,
            error: None,
            folders: None,
            messages: None,
        })
        .map_err(|e| e.to_string())?
    );
    Ok(())
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
