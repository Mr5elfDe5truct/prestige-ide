// Auto-update, like Prestige's: checks GitHub Releases (latest.json, signed with the Prestige IDE updater key) when the
// app opens and from Settings, then downloads, verifies the signature, installs and restarts.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { errMsg } from "./backends";
import { h } from "./ui/transcript";

let pending: Update | null = null;
let installing = false;

export const appVersion = () => getVersion().catch(() => "dev");

/** Looks for a newer release. Quiet on launch; returns a message when asked from Settings. */
export async function checkForUpdates(bar: HTMLElement, busy: () => boolean): Promise<string> {
  if (installing) return "Already installing an update.";
  try {
    pending = await check({ timeout: 15000 });
  } catch (e) {
    const m = errMsg(e);
    return `Couldn't check: ${m === "not reachable" ? "no internet connection" : m}`;
  }
  if (!pending) return "You're on the latest version.";
  drawBar(bar, busy);
  return `Prestige IDE ${pending.version} is available.`;
}

function drawBar(bar: HTMLElement, busy: () => boolean) {
  if (!pending) return;
  bar.innerHTML = "";
  const text = h("span", "", `Prestige IDE ${pending.version} is available (you have ${pending.currentVersion}).`);
  const now = h("button", "btn small primary", "Update and restart");
  const later = h("button", "btn small", "Later");
  bar.append(text, now, later);
  bar.hidden = false;
  later.onclick = () => (bar.hidden = true);
  now.onclick = async () => {
    if (busy() && !confirm("The agent is still working. Updating restarts Prestige IDE and stops it. Update anyway?")) return;
    if (!pending || installing) return;
    installing = true;
    now.disabled = true;
    later.hidden = true;
    let total = 0;
    let got = 0;
    try {
      // Download and verify the signature first; nothing changes until the file checks out.
      await pending.download((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          text.textContent = `Downloading ${pending!.version}… ${(got / 1e6).toFixed(1)}${total ? ` of ${(total / 1e6).toFixed(1)}` : ""} MB`;
        }
      });
      text.textContent = `Installing ${pending.version}. Windows may ask for permission; Prestige IDE restarts when it's done.`;
      await pending.install();
      await relaunch();
    } catch (e) {
      installing = false;
      now.disabled = false;
      later.hidden = false;
      text.textContent = `The update didn't finish: ${errMsg(e)}. Prestige IDE is unchanged.`;
    }
  };
}
