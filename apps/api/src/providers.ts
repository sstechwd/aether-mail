/** Keep in sync with crates/mail-core/src/providers.rs */
export type Provider = {
  id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  imap_tls: string;
  smtp_host: string;
  smtp_port: number;
  smtp_tls: string;
  auth_method: string;
  unsupported: boolean;
  notes: string;
};

export const PROVIDERS: Provider[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "app-password",
    unsupported: false,
    notes: "Use a Google app password until OAuth2 ships. We never host Gmail.",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "app-password",
    unsupported: false,
    notes: "Many work tenants require OAuth2. App password works on some consumer accounts.",
  },
  {
    id: "icloud",
    label: "iCloud",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "app-password",
    unsupported: false,
    notes: "Apple app-specific password required.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    imap_host: "imap.fastmail.com",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "smtp.fastmail.com",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "password",
    unsupported: false,
    notes: "IMAP now. JMAP can come later.",
  },
  {
    id: "yahoo",
    label: "Yahoo",
    imap_host: "imap.mail.yahoo.com",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "smtp.mail.yahoo.com",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "app-password",
    unsupported: false,
    notes: "Yahoo app password required.",
  },
  {
    id: "proton-bridge",
    label: "Proton Mail (via Bridge)",
    imap_host: "127.0.0.1",
    imap_port: 1143,
    imap_tls: "starttls",
    smtp_host: "127.0.0.1",
    smtp_port: 1025,
    smtp_tls: "starttls",
    auth_method: "bridge",
    unsupported: false,
    notes: "Install Proton Bridge first. We do not speak Proton's native API.",
  },
  {
    id: "custom",
    label: "Custom IMAP / SMTP",
    imap_host: "",
    imap_port: 993,
    imap_tls: "ssl",
    smtp_host: "",
    smtp_port: 587,
    smtp_tls: "starttls",
    auth_method: "password",
    unsupported: false,
    notes: "Any domain that already gives you IMAP. We do not host the mailbox.",
  },
  {
    id: "tutanota",
    label: "Tutanota",
    imap_host: "",
    imap_port: 0,
    imap_tls: "",
    smtp_host: "",
    smtp_port: 0,
    smtp_tls: "",
    auth_method: "",
    unsupported: true,
    notes: "No standard IMAP. Not supported.",
  },
];
