import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const revision = "1e44a0c"
const expectedSha256 = "9f15a54ad81105d18a2d4f3bcbebc16cca757a4ef1ca2a5489b7cde90136b94d"
const archiveUrl = `https://codeload.github.com/mbaozi/SearXNGforWindows/zip/${revision}`
const projectRoot = new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1")
const runtimeDir = join(projectRoot, "src-tauri", "local-search-runtime")
const markerPath = join(runtimeDir, ".mangosteen-runtime.json")

if (await isReady()) {
  console.log("[local-search] pinned Windows runtime is ready")
  process.exit(0)
}

const stagingRoot = join(tmpdir(), `mangosteen-searxng-${revision}-${process.pid}`)
const archivePath = `${stagingRoot}.zip`
try {
  await mkdir(stagingRoot, { recursive: true })
  const download = spawnSync(
    "curl.exe",
    ["--fail", "--location", "--retry", "2", "--connect-timeout", "15", "--silent", "--show-error", "--output", archivePath, archiveUrl],
    { encoding: "utf8" },
  )
  if (download.status !== 0) throw new Error(download.stderr || "could not download local search runtime")
  const archive = await readFile(archivePath)
  const actualSha256 = createHash("sha256").update(archive).digest("hex")
  if (actualSha256 !== expectedSha256) {
    throw new Error(`checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`)
  }
  const extract = spawnSync(
    "tar.exe",
    ["-xf", archivePath, "-C", stagingRoot],
    { encoding: "utf8" },
  )
  if (extract.status !== 0) throw new Error(extract.stderr || "could not extract local search runtime")

  const sourceDir = join(stagingRoot, `SearXNGforWindows-${revision}`)
  if (!existsSync(join(sourceDir, "python", "python.exe"))) {
    throw new Error("downloaded runtime does not contain python\\python.exe")
  }

  const nextDir = `${runtimeDir}.next-${process.pid}`
  await rm(nextDir, { recursive: true, force: true })
  await cp(sourceDir, nextDir, { recursive: true })
  await writeFile(join(nextDir, ".mangosteen-runtime.json"), JSON.stringify({ revision, expectedSha256 }, null, 2))
  await rm(runtimeDir, { recursive: true, force: true })
  await rename(nextDir, runtimeDir)
  console.log("[local-search] bundled pinned Windows runtime")
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(archivePath, { force: true })
}

async function isReady() {
  if (!existsSync(join(runtimeDir, "python", "python.exe")) || !existsSync(markerPath)) return false
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"))
    return marker.revision === revision && marker.expectedSha256 === expectedSha256
  } catch {
    return false
  }
}
