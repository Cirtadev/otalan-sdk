import { beforeEach, describe, expect, mock, test } from 'bun:test'

type ExpoCheckResult = {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
  manifest?: unknown
}

type ExpoFetchResult = {
  isNew?: boolean
  isRollBackToEmbedded?: boolean
}

const asyncStorageState = {
  storedItems: new Map<string, string>(),
}

const expoState = {
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0' as string | null,
  updateId: 'update-1' as string | null,
  manifest: {
    metadata: {
      bundleId: 'bundle-current',
    },
    runtimeVersion: '1.0.0',
  } as unknown,
  extraParamCalls: [] as Array<{ key: string; value: string | null | undefined }>,
  requestHeaderOverrideError: null as Error | null,
  requestHeaderOverrideCalls: [] as Array<Record<string, string>>,
  checkCalls: 0,
  fetchCalls: 0,
  reloadCalls: 0,
  checkResult: {
    isAvailable: true,
    manifest: {
      metadata: {
        bundleId: 'bundle-next',
      },
      runtimeVersion: '1.0.0',
    },
  } as ExpoCheckResult,
  fetchResult: {
    isNew: true,
  } as ExpoFetchResult,
}

const fetchState = {
  calls: [] as Array<{ url: string; init?: RequestInit }>,
  handler: async () => new Response(null, { status: 204 }),
}

let importCounter = 0

function applyModuleMocks() {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (key: string) => asyncStorageState.storedItems.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        asyncStorageState.storedItems.set(key, value)
      },
      removeItem: async (key: string) => {
        asyncStorageState.storedItems.delete(key)
      },
    },
  }))

  mock.module('react-native', () => ({
    Platform: { OS: 'ios' },
  }))

  mock.module('expo-updates', () => ({
    isEnabled: expoState.isEnabled,
    isEmbeddedLaunch: expoState.isEmbeddedLaunch,
    isEmergencyLaunch: expoState.isEmergencyLaunch,
    runtimeVersion: expoState.runtimeVersion,
    updateId: expoState.updateId,
    manifest: expoState.manifest,
    setExtraParamAsync: async (key: string, value: string | null | undefined) => {
      expoState.extraParamCalls.push({ key, value })
    },
    setUpdateRequestHeadersOverride: (headers: Record<string, string>) => {
      if (expoState.requestHeaderOverrideError) {
        throw expoState.requestHeaderOverrideError
      }

      expoState.requestHeaderOverrideCalls.push(headers)
    },
    checkForUpdateAsync: async () => {
      expoState.checkCalls += 1
      return expoState.checkResult
    },
    fetchUpdateAsync: async () => {
      expoState.fetchCalls += 1
      return expoState.fetchResult
    },
    reloadAsync: async () => {
      expoState.reloadCalls += 1
    },
  }))

  mock.module('expo-application', () => ({
    getIosIdForVendorAsync: async () => null,
  }))
}

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?expo-rollback=${importCounter}`)
}

function createLogger() {
  const warnCalls: unknown[][] = []

  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => {
        warnCalls.push(args)
      },
    },
  }
}

function buildConfig(input: Record<string, unknown> = {}) {
  return {
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    appId: 'com.example.app',
    channel: 'production',
    deviceId: 'device-1',
    rollbackProtection: {
      validationDelayMs: 0,
    },
    ...input,
  }
}

function buildEmptyRollbackHeaders() {
  return {
    'x-api-key': 'otalan_ota_xxx',
    'x-otalan-blocked-bundle-ids': '',
    'x-otalan-rollback-target-bundle-id': '',
  }
}

function buildRollbackHeaders(bundleId: string) {
  return {
    'x-api-key': 'otalan_ota_xxx',
    'x-otalan-blocked-bundle-ids': JSON.stringify([bundleId]),
    'x-otalan-rollback-target-bundle-id': bundleId,
  }
}

function buildManifest(bundleId: string) {
  return {
    metadata: {
      bundleId,
    },
    runtimeVersion: '1.0.0',
  }
}

function readJsonBody(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  asyncStorageState.storedItems = new Map()
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = false
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'
  expoState.manifest = buildManifest('bundle-current')
  expoState.extraParamCalls = []
  expoState.requestHeaderOverrideError = null
  expoState.requestHeaderOverrideCalls = []
  expoState.checkCalls = 0
  expoState.fetchCalls = 0
  expoState.reloadCalls = 0
  expoState.checkResult = {
    isAvailable: true,
    manifest: buildManifest('bundle-next'),
  }
  expoState.fetchResult = {
    isNew: true,
  }
  fetchState.calls = []
  fetchState.handler = async () => new Response(null, { status: 204 })
  globalThis.fetch = (async (input, init) => {
    fetchState.calls.push({
      url: String(input),
      init,
    })

    return fetchState.handler(String(input), init)
  }) as typeof fetch
})

describe('@otalan/expo rollback protection', () => {
  test('sync records pending rollback protection metadata before reload', async () => {
    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater(buildConfig())

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(JSON.parse(
      asyncStorageState.storedItems.get('otalan:expo:rollback-protection:com.example.app:production:device-1') ?? '{}',
    )).toEqual({
      targetBundleId: 'bundle-next',
      stagedAt: expect.any(Number),
    })

    await updater.ready()
  })

  test('ready validates a pending launched bundle before confirming it', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-next',
        stagedAt: 1,
      }),
    )
    expoState.manifest = buildManifest('bundle-next')

    const { createUpdater } = await loadSdk()
    const updater = createUpdater(buildConfig())

    await updater.ready()

    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      appId: 'com.example.app',
      channel: 'production',
      bundleId: 'bundle-next',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
    })
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
    )).toBe(false)
  })

  test('ready shares pending validation across concurrent callers', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-next',
        stagedAt: 1,
      }),
    )
    expoState.manifest = buildManifest('bundle-next')

    const { createUpdater } = await loadSdk()
    const updater = createUpdater(buildConfig({
      rollbackProtection: {
        validationDelayMs: 1,
      },
    }))

    await Promise.all([
      updater.ready(),
      updater.ready(),
    ])

    expect(fetchState.calls).toHaveLength(1)
    expect(expoState.checkCalls).toBe(0)
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
    )).toBe(false)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe(false)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1',
    )).toBe(false)
  })

  test('ready requests rollback when a pending bundle already failed validation', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-bad',
        stagedAt: 1,
        launchAttemptedAt: Date.now() + 1_000,
      }),
    )
    expoState.manifest = buildManifest('bundle-bad')
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: true,
    }
    expoState.fetchResult = {
      isNew: false,
      isRollBackToEmbedded: true,
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater(buildConfig({
      rollbackProtection: {
        validationDelayMs: 1,
      },
    }))

    await updater.ready()

    expect(expoState.extraParamCalls).toContainEqual({
      key: 'otalan-rollback-target-bundle-id',
      value: 'bundle-bad',
    })
    expect(expoState.extraParamCalls).toContainEqual({
      key: 'otalan-blocked-bundle-ids',
      value: JSON.stringify(['bundle-bad']),
    })
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      buildRollbackHeaders('bundle-bad'),
      buildEmptyRollbackHeaders(),
    ])
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(fetchState.calls).toHaveLength(0)
  })

  test('minimal sync shares startup rollback handling with ready', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-bad',
        stagedAt: 1,
        launchAttemptedAt: Date.now() - 20_000,
      }),
    )
    expoState.manifest = buildManifest('bundle-bad')
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: true,
    }
    expoState.fetchResult = {
      isNew: false,
      isRollBackToEmbedded: true,
    }

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater(buildConfig())

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      buildRollbackHeaders('bundle-bad'),
      buildEmptyRollbackHeaders(),
    ])
  })

  test('ready applies a non-blocked active update while requesting rollback', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-bad',
        stagedAt: 1,
        launchAttemptedAt: Date.now() - 20_000,
      }),
    )
    expoState.manifest = buildManifest('bundle-bad')
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-fixed'),
    }
    expoState.fetchResult = {
      isNew: true,
      isRollBackToEmbedded: false,
    }

    const { createUpdater } = await loadSdk()
    const logger = createLogger()
    const updater = createUpdater(buildConfig({
      logger: logger.logger,
    }))

    await updater.ready()

    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe(false)
    expect(JSON.parse(
      asyncStorageState.storedItems.get('otalan:expo:rollback-protection:com.example.app:production:device-1') ?? '{}',
    )).toEqual({
      targetBundleId: 'bundle-fixed',
      stagedAt: expect.any(Number),
    })
    expect(logger.warnCalls).toHaveLength(0)
  })

  test('ready does not apply a blocked update while requesting rollback', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-bad',
        stagedAt: 1,
        launchAttemptedAt: Date.now() - 20_000,
      }),
    )
    expoState.manifest = buildManifest('bundle-bad')
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-bad'),
    }

    const { createUpdater } = await loadSdk()
    const logger = createLogger()
    const updater = createUpdater(buildConfig({
      logger: logger.logger,
    }))

    await updater.ready()

    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
    expect(asyncStorageState.storedItems.get(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe('bundle-bad')
    expect(JSON.parse(
      asyncStorageState.storedItems.get('otalan:expo:rollback-protection:com.example.app:production:device-1') ?? '{}',
    )).toEqual({
      targetBundleId: 'bundle-bad',
      stagedAt: 1,
      launchAttemptedAt: expect.any(Number),
    })
    expect(logger.warnCalls[0]?.[0]).toBe('[ota] Expo update skipped because bundle failed rollback validation.')
  })

  test('sync applies a non-blocked active update while a rollback request is pending', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
      'bundle-bad',
    )
    expoState.manifest = buildManifest('bundle-current')
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-fixed'),
    }
    expoState.fetchResult = {
      isNew: true,
      isRollBackToEmbedded: false,
    }

    const { initializeUpdater } = await loadSdk()
    const logger = createLogger()
    const updater = await initializeUpdater(buildConfig({
      logger: logger.logger,
    }))

    await updater.ready()
    expoState.fetchCalls = 0
    expoState.reloadCalls = 0
    fetchState.calls = []
    logger.warnCalls.length = 0

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe(false)
    expect(JSON.parse(
      asyncStorageState.storedItems.get('otalan:expo:rollback-protection:com.example.app:production:device-1') ?? '{}',
    )).toEqual({
      targetBundleId: 'bundle-fixed',
      stagedAt: expect.any(Number),
    })
    expect(logger.warnCalls).toHaveLength(0)
  })

  test('sync does not apply a blocked update while a rollback request is pending', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
      'bundle-bad',
    )
    asyncStorageState.storedItems.set(
      'otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1',
      JSON.stringify(['bundle-bad']),
    )
    expoState.manifest = buildManifest('bundle-current')
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-bad'),
    }

    const { initializeUpdater } = await loadSdk()
    const logger = createLogger()
    const updater = await initializeUpdater(buildConfig({
      logger: logger.logger,
    }))

    await updater.ready()
    expoState.fetchCalls = 0
    expoState.reloadCalls = 0
    fetchState.calls = []
    logger.warnCalls.length = 0

    await expect(updater.sync()).resolves.toBe(false)

    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
    expect(asyncStorageState.storedItems.get(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe('bundle-bad')
    expect(logger.warnCalls[0]?.[0]).toBe('[ota] Expo update skipped because bundle failed rollback validation.')
  })

  test('sync applies rollback-to-embedded while a rollback request is pending', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
      'bundle-bad',
    )
    expoState.manifest = buildManifest('bundle-current')
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: true,
    }
    expoState.fetchResult = {
      isNew: false,
      isRollBackToEmbedded: true,
    }

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater(buildConfig())

    await updater.ready()
    expoState.fetchCalls = 0
    expoState.reloadCalls = 0
    fetchState.calls = []

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
    )).toBe(false)
  })

  test('check clears stale rollback extra params when rollback context is empty', async () => {
    const {
      OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY,
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY,
      createUpdater,
    } = await loadSdk()
    const updater = createUpdater(buildConfig())

    await expect(updater.check()).resolves.toEqual({ updateAvailable: true })

    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'device-1' },
      { key: OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY, value: null },
      { key: OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY, value: null },
    ])
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      buildEmptyRollbackHeaders(),
    ])
  })

  test('check keeps rollback context in Expo extra params when header override fails', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1',
      JSON.stringify(['bundle-bad']),
    )
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-request:com.example.app:production:device-1',
      'bundle-bad',
    )
    expoState.requestHeaderOverrideError = new Error('request header override unavailable')

    const {
      OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY,
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY,
      createUpdater,
    } = await loadSdk()
    const logger = createLogger()
    const updater = createUpdater(buildConfig({
      logger: logger.logger,
    }))

    await expect(updater.check()).resolves.toEqual({ updateAvailable: true })

    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'device-1' },
      {
        key: OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY,
        value: JSON.stringify(['bundle-bad']),
      },
      {
        key: OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY,
        value: 'bundle-bad',
      },
    ])
    expect(expoState.requestHeaderOverrideCalls).toHaveLength(0)
    expect(logger.warnCalls[0]?.[0]).toBe('Otalan Expo update request header override failed.')
  })

  test('ready blocks pending bundle after embedded rollback launch', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
      JSON.stringify({
        targetBundleId: 'bundle-bad',
        stagedAt: 1,
        launchAttemptedAt: Date.now() - 20_000,
      }),
    )
    expoState.isEmbeddedLaunch = true
    expoState.manifest = buildManifest('bundle-embedded')

    const { createUpdater } = await loadSdk()
    const updater = createUpdater(buildConfig())

    await updater.ready()

    expect(JSON.parse(
      asyncStorageState.storedItems.get('otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1') ?? '[]',
    )).toEqual(['bundle-bad'])
    expect(fetchState.calls).toHaveLength(0)
  })

  test('check skips locally blocked rollback target bundles', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1',
      JSON.stringify(['bundle-bad']),
    )
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-bad'),
    }

    const { createUpdater } = await loadSdk()
    const logger = createLogger()
    const updater = createUpdater(buildConfig({
      logger: logger.logger,
    }))

    await expect(updater.check()).resolves.toEqual({ updateAvailable: false })

    expect(logger.warnCalls[0]?.[0]).toBe('[ota] Expo update skipped because bundle failed rollback validation.')
    expect(expoState.extraParamCalls).toContainEqual({
      key: 'otalan-blocked-bundle-ids',
      value: JSON.stringify(['bundle-bad']),
    })
  })

  test('sync honors disabled rollback protection', async () => {
    asyncStorageState.storedItems.set(
      'otalan:expo:blocked-rollback-bundles:com.example.app:production:device-1',
      JSON.stringify(['bundle-bad']),
    )
    expoState.checkResult = {
      isAvailable: true,
      manifest: buildManifest('bundle-bad'),
    }

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater(buildConfig({
      rollbackProtection: false,
    }))

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
    )).toBe(false)

    await updater.ready()
  })

  test('sync does not record pending metadata for rollback-to-embedded responses', async () => {
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: true,
    }
    expoState.fetchResult = {
      isNew: false,
      isRollBackToEmbedded: true,
    }

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater(buildConfig())

    await expect(updater.sync()).resolves.toBe(true)

    expect(asyncStorageState.storedItems.has(
      'otalan:expo:rollback-protection:com.example.app:production:device-1',
    )).toBe(false)
    expect(expoState.reloadCalls).toBe(1)

    await updater.ready()
  })
})
