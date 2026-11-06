#!/usr/bin/env node
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, stat, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve, extname, isAbsolute, sep, basename } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export function validateManifest(manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.variants) ||
    manifest.variants.length < 1 ||
    manifest.variants.length > 3
  )
    throw new Error("Manifest requires one to three variants")
  const identifiers = new Set()
  for (const variant of manifest.variants) {
    if (
      !variant ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(variant.id) ||
      identifiers.has(variant.id)
    )
      throw new Error("Use unique safe variant IDs")
    identifiers.add(variant.id)
    if (typeof variant.image !== "string" || !isAbsolute(variant.image))
      throw new Error("Each image must be an absolute local path")
    if (!variant.title?.ru?.trim() || !variant.title?.en?.trim())
      throw new Error("Each variant needs RU and EN titles")
    if (
      !variant.design ||
      !Array.isArray(variant.design.texts) ||
      !variant.framing?.desktop ||
      !variant.framing?.mobile
    )
      throw new Error("Supply PosterDesign and MediaFraming from cover_brief")
  }
  return manifest
}

export async function preview(manifestFile, outputDirectory) {
  const manifest = validateManifest(JSON.parse(await readFile(manifestFile, "utf8")))
  const fontDirectory = process.env.REDTIXX_FONT_DIR
  if (!fontDirectory || !isAbsolute(fontDirectory))
    throw new Error(
      "Set REDTIXX_FONT_DIR to an absolute folder containing your licensed DrukCyr-Bold.woff2 font. This font is not distributed with the plugin.",
    )
  const drukFont = resolve(fontDirectory, "DrukCyr-Bold.woff2")
  await stat(drukFont)
  const directory = dirname(fileURLToPath(import.meta.url))
  const built = resolve(directory, "dist")
  await stat(resolve(built, "preview.js"))
  await mkdir(outputDirectory, { recursive: true })
  const images = new Map(
    await Promise.all(
      manifest.variants.map(async (variant) => {
        const type = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
        }[extname(variant.image).toLowerCase()]
        if (!type || !(await stat(variant.image)).isFile())
          throw new Error("Use a PNG, JPEG or WebP file")
        return [
          `/input/${variant.id}`,
          { type, content: await readFile(variant.image) },
        ]
      }),
    ),
  )
  const server = createServer(async (req, response) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname
      if (/^DrukCyr-Bold-[a-zA-Z0-9_-]+\.woff2$/.test(basename(pathname))) {
        response.setHeader("Content-Type", "font/woff2")
        response.end(await readFile(drukFont))
        return
      }
      const image = images.get(pathname)
      if (image) {
        response.setHeader("Content-Type", image.type)
        response.end(image.content)
        return
      }
      const path = resolve(
        built,
        pathname === "/" ? "index.html" : `.${decodeURIComponent(pathname)}`,
      )
      if (!path.startsWith(built + sep)) {
        response.writeHead(404)
        response.end()
        return
      }
      const types = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".png": "image/png",
      }
      response.setHeader(
        "Content-Type",
        types[extname(path)] || "application/octet-stream",
      )
      response.setHeader("Cache-Control", "no-store")
      response.end(await readFile(path))
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  const outputs = []
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1800 },
      deviceScaleFactor: 1,
    })
    await page.route("**/*", (route) => {
      const url = route.request().url()
      return url.startsWith(origin + "/") ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
        ? route.continue()
        : route.abort()
    })
    await page.goto(origin)
    await page.waitForFunction(() => typeof window.redtixxRender === "function")
    for (const variant of manifest.variants)
      for (const locale of ["ru", "en"])
        for (const target of [
          "poster",
          "desktop",
          "mobile",
          "card_desktop",
          "card_mobile",
        ]) {
          const width =
            target === "poster"
              ? 1024
              : target.includes("mobile")
                ? 390
                : target === "card_desktop"
                  ? 640
                  : 1280
          await page.setViewportSize({ width, height: 1800 })
          await page.evaluate((payload) => window.redtixxRender(payload), {
            ...variant,
            editor: manifest.object?.document?.editor,
            locale,
            target,
            image: `${origin}/input/${variant.id}`,
            title: variant.title[locale],
            category: variant.category?.[locale],
          })
          const name = `${variant.id}-${locale}-${target}.png`
          await page.locator(".preview-result").screenshot({
            path: resolve(outputDirectory, name),
            animations: "disabled",
          })
          outputs.push(name)
        }
    await writeFile(
      resolve(outputDirectory, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Redtixx cover variants</title><style>body{font:16px system-ui;max-width:1400px;margin:auto}img{max-width:100%;max-height:650px;object-fit:contain}figure{display:inline-block;max-width:45%;vertical-align:top}</style>${outputs.map((name) => `<figure><figcaption>${name}</figcaption><img src="${name}" alt="${name}"></figure>`).join("")}`,
    )
    return outputs.map((name) => resolve(outputDirectory, name))
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , manifest, output] = process.argv
  if (!manifest || !output) {
    process.stderr.write(
      "Usage: redtixx-cover-preview /absolute/manifest.json /absolute/output\n",
    )
    process.exitCode = 2
  } else {
    try {
      const files = await preview(resolve(manifest), resolve(output))
      process.stdout.write(
        JSON.stringify({ files, gallery: resolve(output, "index.html") }) + "\n",
      )
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    }
  }
}
