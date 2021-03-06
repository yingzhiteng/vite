import path from 'path'
import chalk from 'chalk'
import { ServerPlugin } from '.'
import { resolveVue, cachedRead } from '../utils'
import { URL } from 'url'
import { resolveOptimizedModule, resolveNodeModuleFile } from '../resolver'

const debug = require('debug')('vite:resolve')

export const moduleIdToFileMap = new Map()
export const moduleFileToIdMap = new Map()

export const moduleRE = /^\/@modules\//

const getDebugPath = (root: string, p: string) => {
  const relative = path.relative(root, p)
  return relative.startsWith('..') ? p : relative
}

// plugin for resolving /@modules/:id requests.
export const moduleResolvePlugin: ServerPlugin = ({ root, app, watcher }) => {
  const vueResolved = resolveVue(root)

  app.use(async (ctx, next) => {
    if (!moduleRE.test(ctx.path)) {
      return next()
    }

    const id = ctx.path.replace(moduleRE, '')
    ctx.type = 'js'

    const serve = async (id: string, file: string, type: string) => {
      moduleIdToFileMap.set(id, file)
      moduleFileToIdMap.set(file, ctx.path)
      debug(`(${type}) ${id} -> ${getDebugPath(root, file)}`)
      await cachedRead(ctx, file)
      return next()
    }

    // special handling for vue runtime in case it's not installed
    if (!vueResolved.isLocal && id in vueResolved) {
      return serve(id, (vueResolved as any)[id], 'non-local vue')
    }

    // already resolved and cached
    const cachedPath = moduleIdToFileMap.get(id)
    if (cachedPath) {
      return serve(id, cachedPath, 'cached')
    }

    // resolve from vite optimized modules
    const optimized = resolveOptimizedModule(root, id)
    if (optimized) {
      return serve(id, optimized, 'optimized')
    }

    const nodeModulePath = resolveNodeModuleFile(root, id)
    if (nodeModulePath) {
      return serve(id, nodeModulePath, 'node_modules')
    }

    const importer = new URL(ctx.get('referer')).pathname
    console.error(
      chalk.red(
        `[vite] Failed to resolve module import "${id}". ` +
          `(imported by ${importer})`
      )
    )
    ctx.status = 404
  })
}
