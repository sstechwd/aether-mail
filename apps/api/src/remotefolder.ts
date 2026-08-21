/**
 * Which folder name to hand IMAP.
 *
 * Aether shows canonical names ("Sent", "Trash") because every provider spells
 * them differently. An IMAP SELECT, though, needs the name the SERVER uses:
 * "[Gmail]/Sent Mail", "Sent Items", "INBOX.Sent". Any command that talks to
 * the server must use the remote name, never the one on screen.
 *
 * This exists as its own function because the mistake is easy to repeat — the
 * canonical name is right there on the message object and looks correct. It
 * was found through a real bug: downloading an attachment from a Sent message
 * returned "message not found" because the route passed "Sent".
 *
 * INBOX worked by coincidence, being the one folder whose canonical and remote
 * names always match, which is exactly why the bug survived so long.
 */

export type FolderSource = {
  folder?: string;
  remoteFolder?: string;
};

export function fetchFolderFor(message: FolderSource): string {
  const remote = (message.remoteFolder ?? "").trim();
  if (remote) return remote;
  // Rows synced before remoteFolder was stored still have the canonical name,
  // which is correct for every provider that does not rename its folders.
  return (message.folder ?? "").trim() || "INBOX";
}
