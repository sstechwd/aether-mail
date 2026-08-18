import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type InspectPrefs = { autoInspect: boolean; alwaysShow: boolean };

const DEFAULTS: InspectPrefs = { autoInspect: true, alwaysShow: false };

export class InspectBook {
  constructor(private filePath: string) {}

  read(): InspectPrefs {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<InspectPrefs>;
      return {
        autoInspect: raw.autoInspect !== false,
        alwaysShow: Boolean(raw.alwaysShow),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULTS };
      throw err;
    }
  }

  save(next: Partial<InspectPrefs>): InspectPrefs {
    const cur = this.read();
    const out: InspectPrefs = {
      autoInspect: next.autoInspect ?? cur.autoInspect,
      alwaysShow: next.alwaysShow ?? cur.alwaysShow,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(out, null, 2), "utf8");
    return out;
  }
}
