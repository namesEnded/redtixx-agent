import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  endpoint,
  install,
  prepare,
  pluginId,
} from "../plugins/redtixx/scripts/setup.mjs"

for (const role of ["organizer", "admin"])
  test(`Preserves the selected ${role} endpoint`, () => {
    assert.deepEqual(endpoint(`https://api.example.test/mcp/${role}`), {
      url: `https://api.example.test/mcp/${role}/`,
      role,
    })
  })

for (const value of [
  undefined,
  "not a URL",
  "http://api.example.test/mcp/admin/",
  "https://user:password@api.example.test/mcp/admin/",
  "https://api.example.test/mcp/admin/?token=secret",
  "https://api.example.test/mcp/admin/#token",
  "https://api.example.test/mcp/",
])
  test(`Rejects an unsafe or incomplete endpoint: ${value ?? "missing"}`, () => {
    assert.throws(() => endpoint(value))
  })

test("Builds a self-contained install and changes only its own endpoint on repeat", async () => {
  const root = await mkdtemp(join(tmpdir(), "redtixx-setup-"))
  try {
    const destination = join(root, "installation")
    const sibling = join(root, "unrelated.txt")
    await writeFile(sibling, "keep me")
    const calls = []
    await install(
      { url: "https://api.example.test/mcp/organizer/", destination },
      (program, args) => {
        calls.push([program, args])
        return "{}"
      },
    )
    assert.deepEqual(
      calls.map(([, args]) => args.slice(0, 3)),
      [
        ["plugin", "add", "--help"],
        ["plugin", "marketplace", "add"],
        ["plugin", "add", pluginId],
      ],
    )
    const catalog = JSON.parse(
      await readFile(join(destination, ".agents/plugins/marketplace.json")),
    )
    const plugin = JSON.parse(
      await readFile(join(destination, "plugins/redtixx/.codex-plugin/plugin.json")),
    )
    assert.equal(catalog.plugins[0].source.path, "./plugins/redtixx")
    assert.equal(plugin.name, "redtixx")
    const obsolete = join(destination, "plugins/redtixx/obsolete-file.txt")
    await writeFile(obsolete, "old package content")
    await prepare({ url: "https://new.example.test/mcp/admin/", destination })
    await assert.rejects(readFile(obsolete), { code: "ENOENT" })
    const config = JSON.parse(
      await readFile(join(destination, "plugins/redtixx/.mcp.json")),
    )
    assert.deepEqual(config, {
      mcpServers: { redtixx: { url: "https://new.example.test/mcp/admin/" } },
    })
    assert.equal(await readFile(sibling, "utf8"), "keep me")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Stops on a missing CLI before preparing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "redtixx-no-cli-"))
  try {
    const destination = join(root, "installation")
    await assert.rejects(
      install({ url: "https://api.example.test/mcp/admin/", destination }, () => {
        throw new Error("CLI unavailable")
      }),
      /CLI unavailable/,
    )
    await assert.rejects(readFile(join(destination, "installation.json")), {
      code: "ENOENT",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Does not overwrite another integration's folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "redtixx-existing-"))
  try {
    await mkdir(join(root, "installation"))
    const file = join(root, "installation", "settings.json")
    await writeFile(file, '{"keep":true}')
    await assert.rejects(
      prepare({
        url: "https://api.example.test/mcp/admin/",
        destination: join(root, "installation"),
      }),
      /not an empty/,
    )
    assert.equal(await readFile(file, "utf8"), '{"keep":true}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
