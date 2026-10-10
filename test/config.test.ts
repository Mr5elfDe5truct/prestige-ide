// Settings files: which rules and hooks apply, the trust gate for project files, and how rules match calls.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fake } from "./fake-tauri.ts";
import { config, decide, loadConfig, trust } from "../src/config";
import { settings } from "../src/store";

const ROOT = "C:/proj";
const USER = `${fake.home}/.prestige/settings.json`;
const PROJECT = `${ROOT}/.prestige/settings.json`;
const LOCAL = `${ROOT}/.prestige/settings.local.json`;
const json = (o: any) => JSON.stringify(o);

beforeEach(() => {
  fake.reset();
  settings.trustedConfigs = {};
});

describe("trust", () => {
  test("a project file's allow rules and hooks wait for trust; its deny rules apply at once", async () => {
    fake.write(PROJECT, json({ permissions: { allow: ["run_command(npm test*)"], deny: ["edit_file(.env)"] }, hooks: { Stop: [{ command: "x" }] } }));
    const eff = await loadConfig(ROOT);
    assert.equal(eff.files[0].needsTrust, true);
    assert.deepEqual(eff.allow, []);
    assert.deepEqual(eff.deny, ["edit_file(.env)"]);
    assert.equal(eff.hooks.Stop.length, 0);
  });

  test("trusting a file turns it on, and changing it asks again", async () => {
    fake.write(PROJECT, json({ permissions: { allow: ["run_command(npm test*)"] } }));
    await trust((await loadConfig(ROOT)).files[0]);
    assert.deepEqual((await loadConfig(ROOT)).allow, ["run_command(npm test*)"]);
    fake.write(PROJECT, json({ permissions: { allow: ["run_command(*)"] } }));
    const again = await loadConfig(ROOT);
    assert.equal(again.files[0].needsTrust, true);
    assert.deepEqual(again.allow, []);
  });

  test("your own file in your home folder is always trusted", async () => {
    fake.write(USER, json({ permissions: { allow: ["run_command(git status*)"] }, hooks: { PostToolUse: [{ command: "y" }] } }));
    const eff = await loadConfig(ROOT);
    assert.equal(eff.files[0].scope, "user");
    assert.deepEqual(eff.allow, ["run_command(git status*)"]);
    assert.equal(eff.hooks.PostToolUse[0].source, USER);
  });

  test("a file with only deny rules needs no trust", async () => {
    fake.write(LOCAL, json({ permissions: { deny: ["run_command(git push*)"] } }));
    const eff = await loadConfig(ROOT);
    assert.equal(eff.files[0].needsTrust, false);
    assert.deepEqual(eff.deny, ["run_command(git push*)"]);
  });

  test("broken JSON is reported, not thrown", async () => {
    fake.write(PROJECT, "{ not json");
    const eff = await loadConfig(ROOT);
    assert.equal(eff.files[0].ok, false);
    assert.ok(eff.files[0].error);
  });
});

describe("rules", () => {
  async function use(allow: string[], deny: string[] = []) {
    fake.write(USER, json({ permissions: { allow, deny } }));
    await loadConfig(ROOT);
  }
  const run = (command: string) => decide("run_command", { command }, ROOT);

  test("command globs", async () => {
    await use(["run_command(npm test*)"]);
    assert.equal(run("npm test")?.decision, "allow");
    assert.equal(run("npm test -- --watch")?.decision, "allow");
    assert.equal(run("npm run build"), undefined);
  });

  test("deny beats allow", async () => {
    await use(["run_command(git *)"], ["run_command(git push*)"]);
    assert.equal(run("git status")?.decision, "allow");
    assert.deepEqual(run("git push origin main"), { decision: "deny", rule: "run_command(git push*)" });
  });

  test("an allow rule never covers a compound command", async () => {
    await use(["run_command(npm test*)"]);
    for (const c of ["npm test; rm x", "npm test\nrm x", "npm test > out.txt", "npm test | tee x"]) assert.equal(run(c), undefined, c);
  });

  test("a deny rule still catches a compound command", async () => {
    await use([], ["run_command(*Remove-Item*)"]);
    assert.equal(run("npm test; Remove-Item -Recurse x")?.decision, "deny");
  });

  test("a deny rule checks every command chained inside another", async () => {
    await use(["run_command(npm test*)"], ["run_command(git push*)"]);
    for (const c of ["npm test; git push", "npm test && git push --force", "npm test\ngit push", "echo $(git push)", "npm test | git push"]) {
      assert.equal(run(c)?.decision, "deny", c);
    }
    assert.equal(run("npm test; git status"), undefined);
  });

  test("path globs on file tools, relative to the project", async () => {
    await use(["edit_file(src/**)"], ["write_file(.env*)", "edit_file(.env*)"]);
    const edit = (path: string) => decide("edit_file", { path }, ROOT)?.decision;
    assert.equal(edit("src/a.ts"), "allow");
    assert.equal(edit("src/deep/b.ts"), "allow");
    assert.equal(edit("C:\\proj\\src\\c.ts"), "allow");
    assert.equal(edit("docs/a.md"), undefined);
    assert.equal(edit(".env"), "deny");
    assert.equal(edit(".env.local"), "deny");
    assert.equal(decide("write_file", { path: ".env" }, ROOT)?.decision, "deny");
  });

  test("a single * in a path doesn't cross folders", async () => {
    await use(["edit_file(src/*.ts)"]);
    assert.equal(decide("edit_file", { path: "src/a.ts" }, ROOT)?.decision, "allow");
    assert.equal(decide("edit_file", { path: "src/ui/a.ts" }, ROOT), undefined);
  });

  test("wildcards in tool names (MCP servers)", async () => {
    await use(["browser__*"]);
    assert.equal(decide("browser__browser_click", { ref: "1" }, ROOT)?.decision, "allow");
    assert.equal(decide("workstation__make_image", {}, ROOT), undefined);
  });

  test("hooks from every trusted file are merged in order", async () => {
    fake.write(USER, json({ hooks: { Stop: [{ command: "user" }] } }));
    fake.write(LOCAL, json({ hooks: { Stop: [{ command: "local" }] } }));
    settings.trustedConfigs = {};
    const first = await loadConfig(ROOT);
    await trust(first.files.find((f) => f.scope === "local")!);
    await loadConfig(ROOT);
    assert.deepEqual(config().hooks.Stop.map((h) => h.command), ["user", "local"]);
  });
});
