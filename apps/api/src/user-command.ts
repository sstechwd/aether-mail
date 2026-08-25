/**
 * Commands the USER types in chat. These run immediately.
 *
 * This is not the model acting on mail. The user asked. Mail-body text
 * never goes through this parser.
 *
 * Mail folders only. Aether is not Hermes: it will not create a folder
 * on the desktop or touch the filesystem.
 */

export type UserCommand =
  | { action: "create_folder"; name: string }
  | { action: "need_folder_name" }
  | { action: "refuse_filesystem" }
  | {
      action: "create_rule";
      field: "from" | "to" | "subject";
      contains: string;
      then: "move" | "star" | "read";
      folder?: string;
    };

const FORBIDDEN = /\b(send|delete|deletes|forward|trash)\b/i;
const FILESYSTEM = /(?:\bdesktop\b|\bdocuments\b|\bdownloads\b|c:\\|\\\\|\.\.|\/home\/|\/tmp\b)/i;

function cleanFolder(raw: string): string | null {
  const name = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\.$/, "").trim();
  if (!name || name.length > 40) return null;
  if (FILESYSTEM.test(name)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) return null;
  return name;
}

export function parseUserCommand(spoken: string): UserCommand | null {
  const text = (spoken ?? "").trim();
  if (!text) return null;

  if (/\b(folder|director(y|ies)|rule)\b/i.test(text) && FILESYSTEM.test(text)) {
    return { action: "refuse_filesystem" };
  }

  const folderOnly = text.match(
    /^(?:please\s+)?(?:make|create|add|new)\s+(?:me\s+)?(?:a\s+)?(?:mail\s+)?folders?(?:\s+(?:called|named|for))?(?:\s+(.+))?$/i,
  );
  if (folderOnly) {
    const rest = (folderOnly[1] ?? "").trim();
    if (!rest) return { action: "need_folder_name" };
    if (FILESYSTEM.test(rest)) return { action: "refuse_filesystem" };
    const name = cleanFolder(rest);
    if (!name) return { action: "need_folder_name" };
    return { action: "create_folder", name };
  }

  const folderNamed = text.match(
    /^(?:please\s+)?(?:make|create|add)\s+(?:a\s+)?folder\s+(?:called|named)\s+(.+)$/i,
  );
  if (folderNamed) {
    const name = cleanFolder(folderNamed[1]);
    if (!name) return { action: "need_folder_name" };
    return { action: "create_folder", name };
  }

  if (FORBIDDEN.test(text)) return null;

  const rule = text.match(
    /^(?:please\s+)?(?:make|create|add)\s+(?:a\s+)?rule\s+(?:that\s+)?(?:files|moves|puts)\s+(?:mail\s+)?(?:from\s+)?(.+?)\s+(?:to|into)\s+(.+)$/i,
  );
  if (rule) {
    const contains = rule[1].trim();
    const folder = cleanFolder(rule[2]);
    if (!contains || !folder) return null;
    return { action: "create_rule", field: "from", contains, then: "move", folder };
  }

  const fileInto = text.match(
    /^(?:please\s+)?file\s+(?:mail\s+)?(?:from\s+)?(.+?)\s+(?:to|into)\s+(.+)$/i,
  );
  if (fileInto) {
    const contains = fileInto[1].trim();
    const folder = cleanFolder(fileInto[2]);
    if (!contains || !folder) return null;
    return { action: "create_rule", field: "from", contains, then: "move", folder };
  }

  return null;
}
