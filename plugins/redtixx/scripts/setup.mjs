#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const pluginSource = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const marketplaceName = "redtixx-agent"
export const pluginId = `redtixx@${marketplaceName}`

export function endpoint(value) {
  if (!value)
    throw new Error(
      "Provide --url with the MCP server address from your Redtixx account.",
    )
  const url = new URL(value)
  const role = url.pathname.match(/\/mcp\/(organizer|admin)\/?$/)?.[1]
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !role
  )
    throw new Error(
      "Use an HTTPS MCP address ending in /mcp/organizer/ or /mcp/admin/, without credentials, query or fragment.",
    )
  url.pathname = url.pathname.replace(/\/?$/, "/")
  return { url: url.href, role }
}

export function command(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  })
  if (result.error)
    throw new Error(
      `${program} is unavailable. Install a current Codex CLI and retry.`,
      { cause: result.error },
    )
  if (result.status !== 0)
    throw new Error(
      `${program} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    )
  return result.stdout.trim()
}

export async function prepare({ url, destination, source = pluginSource }) {
  const connection = endpoint(url)
  const root = resolve(destination)
  if (!isAbsolute(destination))
    throw new Error("The installation directory must be absolute.")
  // Keep the source checkout and the generated local marketplace independent.
  if (root === source || root.startsWith(source + sep) || source.startsWith(root + sep))
    throw new Error("Use an installation directory outside the source plugin.")
  const manifest = JSON.parse(
    await readFile(join(source, ".codex-plugin/plugin.json"), "utf8"),
  )
  const markerPath = join(root, "installation.json")
  let previous = null
  try {
    previous = JSON.parse(await readFile(markerPath, "utf8"))
    if (previous.id !== pluginId)
      throw new Error("The destination belongs to another integration.")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    try {
      if ((await readdir(root)).length)
        throw new Error(
          "The destination is not an empty Redtixx installation directory.",
        )
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  await mkdir(root, { recursive: true })
  const plugins = join(root, "plugins")
  await mkdir(plugins, { recursive: true })
  const staging = await mkdtemp(join(plugins, ".redtixx-"))
  try {
    await cp(source, staging, {
      recursive: true,
      filter: (path) => !relative(source, path).split(sep).includes("node_modules"),
    })
    await rm(join(plugins, "redtixx"), { recursive: true, force: true })
    await rename(staging, join(plugins, "redtixx"))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  await writeFile(
    join(root, "plugins/redtixx/.mcp.json"),
    JSON.stringify(
      {
        mcpServers: { redtixx: { url: connection.url } },
      },
      null,
      2,
    ) + "\n",
  )
  await mkdir(join(root, ".agents/plugins"), { recursive: true })
  await writeFile(
    join(root, ".agents/plugins/marketplace.json"),
    JSON.stringify(
      {
        name: marketplaceName,
        interface: { displayName: "REDTIXX" },
        plugins: [
          {
            name: "redtixx",
            source: { source: "local", path: "./plugins/redtixx" },
            policy: { installation: "AVAILABLE", authentication: "ON_USE" },
            category: "Productivity",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  )
  const installation = { id: pluginId, version: manifest.version, ...connection }
  await writeFile(markerPath, JSON.stringify(installation, null, 2) + "\n")
  return { root, installation, previous }
}

export async function install(options, run = command) {
  endpoint(options.url) // Validate before executing commands or writing files.
  run("codex", ["plugin", "add", "--help"])
  const prepared = await prepare(options)
  run("codex", ["plugin", "marketplace", "add", prepared.root])
  // add refreshes an installed plugin from the configured local source.
  run("codex", ["plugin", "add", pluginId, "--json"])
  return prepared
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: "string" },
      destination: { type: "string" },
      "prepare-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (values.help) {
    console.log(
      "REDTIXX Agent\n\nnode setup.mjs --url HTTPS_MCP_URL [--destination ABSOLUTE_PATH]\n\n--prepare-only  Build a local marketplace without changing Codex settings.",
    )
    return
  }
  const options = {
    url: values.url,
    destination: values.destination ?? join(homedir(), ".codex", "redtixx-agent"),
  }
  const result = values["prepare-only"]
    ? await prepare(options)
    : await install(options)
  console.log(
    `REDTIXX Agent ${result.installation.version}\nProfile: ${result.installation.role}\nMCP: ${result.installation.url}\nPlugin: ${pluginId}\nLocal files: ${result.root}`,
  )
  if (!values["prepare-only"])
    console.log(
      "\nStart a new Codex chat and invoke REDTIXX Agent. Complete OAuth in your browser, then ask the agent to call get_context. Never paste passwords, authenticator codes or tokens into chat.",
    )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
