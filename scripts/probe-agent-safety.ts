/**
 * Verify the approve route rejects forged proposals.
 *
 * The propose call is convenience; the approve call is the security boundary.
 * A hostile client can POST anything, so the server must re-validate rather
 * than trust the object it is handed.
 */
const BASE = "http://127.0.0.1:8787";

const FORGED = [
  { label: "send_email", proposal: { action: "send_email", to: "attacker@evil.example" } },
  { label: "delete_messages", proposal: { action: "delete_messages", ids: ["all"] } },
  { label: "run_shell", proposal: { action: "run_shell", cmd: "echo pwned" } },
  {
    label: "empty pattern (would file everything)",
    proposal: { action: "create_rule", field: "from", contains: "", then: "move", folder: "Trash" },
  },
  {
    label: "move with no folder",
    proposal: { action: "create_rule", field: "from", contains: "x@y.z", then: "move" },
  },
  {
    label: "unknown verb 'forward'",
    proposal: { action: "create_rule", field: "from", contains: "x@y.z", then: "forward" },
  },
];

const VALID = {
  label: "a legitimate rule",
  proposal: {
    action: "create_rule",
    field: "from",
    contains: "probe-test@example.invalid",
    then: "star",
  },
};

async function approve(proposal: unknown): Promise<number> {
  const r = await fetch(`${BASE}/api/agent/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
    body: JSON.stringify({ proposal }),
  });
  return r.status;
}

async function main(): Promise<void> {
  let failures = 0;
  console.log("=== forged proposals must be refused ===");
  for (const f of FORGED) {
    const status = await approve(f.proposal);
    const ok = status === 400;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "REFUSED" : "!! ACCEPTED"}  ${String(status).padEnd(4)} ${f.label}`);
  }

  console.log("\n=== a valid proposal must still work ===");
  const good = await approve(VALID.proposal);
  console.log(`  ${good === 201 ? "created" : "FAILED"}  ${good}  ${VALID.label}`);
  if (good !== 201) failures += 1;

  // Clean up the probe rule so the real profile is untouched.
  const res = await fetch(`${BASE}/api/rules`, { headers: { Origin: "http://tauri.localhost" } });
  const list = (await res.json()) as { rules?: { id: string; contains: string }[] };
  for (const rule of list.rules ?? []) {
    if (rule.contains === "probe-test@example.invalid") {
      await fetch(`${BASE}/api/rules/${rule.id}`, {
        method: "DELETE",
        headers: { Origin: "http://tauri.localhost" },
      });
      console.log("  cleaned up probe rule");
    }
  }

  console.log(failures === 0 ? "\nALL GOOD" : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
