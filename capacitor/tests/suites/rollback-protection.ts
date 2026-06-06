import { describe, expect, test } from 'bun:test'

import {
  buildCompatibleCheckResponse,
  capacitorState,
  createLogger,
  createUpdater,
  fetchState,
  initializeUpdater,
  readJsonBody,
  waitForFetchCalls,
} from '../helpers/capacitor-test-harness'

const DEFAULT_CHECKSUM = '0'.repeat(64)
const BLOCKED_STORAGE_KEY = 'otalan:capacitor:blocked-rollback-bundles:com.example.app:production:device-1'
const ROLLBACK_STORAGE_KEY = 'otalan:capacitor:rollback-protection:com.example.app:production:device-1'

function createProtectedUpdater(input: {
  logger?: Pick<Console, 'warn'>
  validationDelayMs?: number
} = {}) {
  return createUpdater({
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    appId: 'com.example.app',
    channel: 'production',
    deviceId: 'device-1',
    rollbackProtection: {
      validationDelayMs: input.validationDelayMs ?? 0,
    },
    logger: input.logger,
  })
}

describe('@otalan/capacitor rollback protection', () => {
  test('sync records pending rollback protection metadata when a bundle is staged', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          checksum: DEFAULT_CHECKSUM,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await updater.sync()

    expect(JSON.parse(localStorage.getItem(ROLLBACK_STORAGE_KEY) ?? '{}')).toEqual({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: expect.any(Number),
    })
  })

  test('ready validates a pending launched bundle before confirming it', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-next' }
    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await updater.ready()
    await waitForFetchCalls(1)

    expect(capacitorState.readyCalls).toBe(1)
    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      bundleId: 'bundle-next',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready shares pending validation across concurrent callers', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-next' }
    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const updater = createProtectedUpdater({
      validationDelayMs: 1,
    })

    await expect(Promise.all([
      updater.ready(),
      updater.ready(),
    ])).resolves.toEqual([
      { currentBundleId: 'bundle-next' },
      { currentBundleId: 'bundle-next' },
    ])

    await waitForFetchCalls(1)
    expect(capacitorState.readyCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(1)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready calls native ready before waiting for the validation delay', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-next' }
    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const updater = createProtectedUpdater({
      validationDelayMs: 50,
    })

    const readyPromise = updater.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(capacitorState.readyCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).not.toBeNull()

    await readyPromise

    expect(fetchState.calls).toHaveLength(1)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready restores the previous bundle when the pending bundle already failed validation', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-bad',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
      launchAttemptedAt: Date.now() - 20_000,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-bad' }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    const result = await updater.ready()

    expect(result).toEqual({
      currentBundleId: 'bundle-current',
      previousBundleId: 'bundle-bad',
      rollback: true,
    })
    expect(capacitorState.readyCalls).toBe(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-current' }])
    expect(capacitorState.resetCalls).toBe(0)
    expect(capacitorState.reloadCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('sync stops when startup rollback protection restores a previous bundle', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-bad',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
      launchAttemptedAt: Date.now() - 20_000,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-bad' }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toEqual({ updateAvailable: false })

    expect(capacitorState.readyCalls).toBe(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-current' }])
    expect(capacitorState.reloadCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready resets to the default bundle when a failed bundle has no previous bundle', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-bad',
      stagedAt: 1,
      launchAttemptedAt: Date.now() - 20_000,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-bad' }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    const result = await updater.ready()

    expect(result).toEqual({
      currentBundleId: null,
      previousBundleId: 'bundle-bad',
      rollback: true,
    })
    expect(capacitorState.readyCalls).toBe(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.resetCalls).toBe(1)
    expect(capacitorState.reloadCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready locally blocks a bundle rolled back by the native runtime', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-bad',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.readyResult = {
      currentBundleId: 'bundle-current',
      previousBundleId: 'bundle-bad',
      rollback: true,
    }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await updater.ready()

    expect(JSON.parse(localStorage.getItem(BLOCKED_STORAGE_KEY) ?? '[]')).toEqual(['bundle-bad'])
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
    expect(fetchState.calls).toHaveLength(0)
  })

  test('ready clears stale pending metadata when native launches a different bundle without rollback', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-old-target',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
      launchAttemptedAt: Date.now() - 20_000,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.readyResult = { currentBundleId: 'bundle-current' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const updater = createProtectedUpdater()

    await updater.ready()

    expect(capacitorState.readyCalls).toBe(1)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.resetCalls).toBe(0)
    expect(capacitorState.reloadCalls).toBe(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(BLOCKED_STORAGE_KEY)).toBeNull()
  })

  test('ready rolls back a relaunched bundle even inside the validation window', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-bad',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
      launchAttemptedAt: Date.now(),
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-bad' }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
      validationDelayMs: 10_000,
    })

    const result = await updater.ready()

    expect(result).toEqual({
      currentBundleId: 'bundle-current',
      previousBundleId: 'bundle-bad',
      rollback: true,
    })
    expect(capacitorState.readyCalls).toBe(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-current' }])
    expect(capacitorState.resetCalls).toBe(0)
    expect(capacitorState.reloadCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('ready uses a 10000ms validation delay by default', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-next' }
    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    fetchState.handler = async () => new Response(null, { status: 204 })
    const originalSetTimeout = globalThis.setTimeout
    const validationDelays: number[] = []
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 10_000) {
        validationDelays.push(delay)
        callback(...args)
        return 0 as unknown as ReturnType<typeof setTimeout>
      }

      return originalSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    try {
      await updater.ready()
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }

    expect(capacitorState.readyCalls).toBe(1)
    expect(validationDelays).toEqual([10_000])
    expect(capacitorState.resetCalls).toBe(0)
    expect(capacitorState.reloadCalls).toBe(0)
    expect(fetchState.calls).toHaveLength(1)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('sync skips a locally blocked rollback target bundle', async () => {
    localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(['bundle-bad']))
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-bad',
          downloadUrl: 'https://cdn.example.com/bundle-bad.zip',
          checksum: DEFAULT_CHECKSUM,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toEqual({ updateAvailable: false })

    expect(logger.warnCalls[0]?.[0]).toBe('[ota] update skipped because bundle failed rollback validation')
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('check skips a locally blocked rollback target bundle', async () => {
    localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(['bundle-bad']))
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-bad',
          downloadUrl: 'https://cdn.example.com/bundle-bad.zip',
          checksum: DEFAULT_CHECKSUM,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = createProtectedUpdater({
      logger: logger.logger,
    })

    await expect(updater.check()).resolves.toEqual({
      updateAvailable: false,
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })

    expect(logger.warnCalls[0]?.[0]).toBe('[ota] update skipped because bundle failed rollback validation')
  })

  test('initialized sync forwards rollback protection config to the low-level updater', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          checksum: DEFAULT_CHECKSUM,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      onResume: false,
      rollbackProtection: false,
    })

    await updater.sync()

    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('sync honors rollback protection disabled through object config', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          checksum: DEFAULT_CHECKSUM,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      rollbackProtection: {
        enabled: false,
        validationDelayMs: 1,
      },
    })

    await updater.sync()

    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })

  test('initialized sync joins startup validation instead of rolling back the same launch', async () => {
    localStorage.setItem(ROLLBACK_STORAGE_KEY, JSON.stringify({
      targetBundleId: 'bundle-next',
      previousBundleId: 'bundle-current',
      stagedAt: 1,
    }))
    capacitorState.currentBundle = { bundleId: 'bundle-next' }
    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse())
      }

      return new Response(null, { status: 204 })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      onResume: false,
      rollbackProtection: { validationDelayMs: 1 },
    })

    await updater.sync()

    expect(capacitorState.readyCalls).toBe(1)
    expect(capacitorState.resetCalls).toBe(0)
    expect(capacitorState.reloadCalls).toBe(0)
    expect(localStorage.getItem(ROLLBACK_STORAGE_KEY)).toBeNull()
  })
})
