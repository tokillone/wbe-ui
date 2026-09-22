#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeRuntimeCompatibilityIndex } from './runtime-region-indexes.mjs'

const MAP_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/

export async function packageMapAssets({ rootDirectory, distDirectory, mapVersion }) {
  const publicDirectory = resolve(rootDirectory, 'public')
  const sourceFiles = await productionMapAssetFiles(publicDirectory)
  const resolvedVersion = mapVersion || (await contentVersion(publicDirectory, sourceFiles))
  if (!MAP_VERSION_PATTERN.test(resolvedVersion)) {
    throw new Error(`Invalid map version: ${resolvedVersion}`)
  }

  await rm(resolve(distDirectory, 'tiles/generated'), { recursive: true, force: true })
  await rm(resolve(distDirectory, 'geo/render/region-index.json'), { force: true })
  writeRuntimeCompatibilityIndex(
    JSON.parse(await readFile(resolve(publicDirectory, 'geo/render/region-index.json'), 'utf8')),
    resolve(distDirectory, 'geo/render/region-index.json'),
  )

  const versionDirectory = resolve(distDirectory, 'map-assets', resolvedVersion)
  await rm(versionDirectory, { recursive: true, force: true })
  await mkdir(versionDirectory, { recursive: true })
  await symlink('../../tiles', resolve(versionDirectory, 'tiles'), 'dir')
  await symlink('../../geo', resolve(versionDirectory, 'geo'), 'dir')

  const manifestDirectory = resolve(distDirectory, 'map-assets/current')
  await mkdir(manifestDirectory, { recursive: true })
  const manifest = {
    schemaVersion: 1,
    mapVersion: resolvedVersion,
    baseUrl: `/map-assets/${resolvedVersion}`,
  }
  await writeFile(resolve(manifestDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
  return manifest
}

export async function productionMapAssetFiles(publicDirectory) {
  const roots = [
    resolve(publicDirectory, 'tiles/fonts'),
    resolve(publicDirectory, 'tiles/wbe-preview-composite.pmtiles'),
    resolve(publicDirectory, 'geo/render'),
  ]
  const files = []
  for (const root of roots) {
    const info = await stat(root)
    if (info.isFile()) files.push(root)
    else files.push(...(await walkFiles(root)))
  }
  return files
    .filter((file) => !file.endsWith('/geo/render/region-index.json'))
    .sort((left, right) => left.localeCompare(right))
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walkFiles(path) : Promise.resolve([path])
    }),
  )
  return nested.flat()
}

async function contentVersion(publicDirectory, files) {
  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(relative(publicDirectory, file))
    for await (const chunk of createReadStream(file)) digest.update(chunk)
  }
  return digest.digest('hex').slice(0, 16)
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const rootDirectory = resolve(dirname(modulePath), '..')
  const manifest = await packageMapAssets({
    rootDirectory,
    distDirectory: resolve(rootDirectory, 'dist'),
    mapVersion: process.env.MAP_VERSION,
  })
  console.log(`Versioned map manifest written: ${JSON.stringify(manifest)}`)
}
