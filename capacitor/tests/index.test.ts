import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

type FetchCall = {
  url: string
  init?: RequestInit
}

const capacitorState = {
  appId: 'com.example.app',
  isNativePlatform: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  currentBundle: { bundleId: undefined as string | undefined },
  nextBundle: { bundleId: undefined as string | undefined },
  downloadedBundles: [] as string[],
  getDownloadedBundlesError: null as Error | null,
  versionName: '1.0.0',
  readyResult: { currentBundleId: undefined as string | undefined },
  downloadCalls: [] as Array<{ url: string; bundleId: string; checksum?: string }>,
  setNextCalls: [] as Array<{ bundleId: string }>,
  reloadCalls: 0,
}

const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return new Response('not mocked', { status: 500 })
  },
}

const liveUpdateMock = {
  ready: async () => capacitorState.readyResult,
  getVersionName: async () => ({ versionName: capacitorState.versionName }),
  getCurrentBundle: async () => capacitorState.currentBundle,
  getNextBundle: async () => capacitorState.nextBundle,
  getDownloadedBundles: async () => {
    if (capacitorState.getDownloadedBundlesError) {
      throw capacitorState.getDownloadedBundlesError
    }

    return { bundleIds: [...capacitorState.downloadedBundles] }
  },
  getBundles: async () => {
    if (capacitorState.getDownloadedBundlesError) {
      throw capacitorState.getDownloadedBundlesError
    }

    return { bundleIds: [...capacitorState.downloadedBundles] }
  },
  downloadBundle: async (input: { url: string; bundleId: string; checksum?: string }) => {
    capacitorState.downloadCalls.push(input)
  },
  setNextBundle: async (input: { bundleId: string }) => {
    capacitorState.setNextCalls.push(input)
  },
  reload: async () => {
    capacitorState.reloadCalls += 1
  },
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

mock.module('@capacitor/app', () => ({
  App: {
    getInfo: async () => ({ id: capacitorState.appId }),
    addListener: async () => ({ remove: async () => undefined }),
  },
}))

mock.module('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorState.platform,
    isNativePlatform: () => capacitorState.isNativePlatform,
  },
}))

mock.module('@capawesome/capacitor-live-update', () => ({
  LiveUpdate: liveUpdateMock,
}))

const { createUpdater } = await import('../src/index')

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()

  return {
    get length() {
      return items.size
    },
    clear: () => {
      items.clear()
    },
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => {
      items.delete(key)
    },
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

function installMemoryLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  })
}

function restoreLocalStorage() {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor)
    return
  }

  Reflect.deleteProperty(globalThis, 'localStorage')
}

function createLogger() {
  const infoCalls: unknown[][] = []
  const warnCalls: unknown[][] = []

  return {
    infoCalls,
    warnCalls,
    logger: {
      info: (...args: unknown[]) => {
        infoCalls.push(args)
      },
      warn: (...args: unknown[]) => {
        warnCalls.push(args)
      },
    },
  }
}

function readHeader(headers: HeadersInit | undefined, name: string) {
  return new Headers(headers).get(name)
}

function readJsonBody(call: FetchCall) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  installMemoryLocalStorage()

  capacitorState.appId = 'com.example.app'
  capacitorState.isNativePlatform = true
  capacitorState.platform = 'ios'
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.downloadedBundles = []
  capacitorState.getDownloadedBundlesError = null
  capacitorState.versionName = '1.0.0'
  capacitorState.readyResult = { currentBundleId: undefined }
  capacitorState.downloadCalls = []
  capacitorState.setNextCalls = []
  capacitorState.reloadCalls = 0
  liveUpdateMock.getDownloadedBundles = async () => {
    if (capacitorState.getDownloadedBundlesError) {
      throw capacitorState.getDownloadedBundlesError
    }

    return { bundleIds: [...capacitorState.downloadedBundles] }
  }

  fetchState.calls = []
  fetchState.handler = async (url: string, init?: RequestInit) => {
    void url
    void init
    return new Response('not mocked', { status: 500 })
  }

  globalThis.fetch = (async (input, init) => {
    fetchState.calls.push({
      url: String(input),
      init,
    })

    return fetchState.handler(String(input), init)
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
  restoreLocalStorage()
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/capacitor', () => {
  test('check supports Headers instances in custom request headers', async () => {
    fetchState.handler = async (_url, init) => {
      expect(readHeader(init?.headers, 'content-type')).toBe('application/json')
      expect(readHeader(init?.headers, 'x-api-key')).toBe('otalan_ota_xxx')
      expect(readHeader(init?.headers, 'x-custom-header')).toBe('custom-value')

      return Response.json({ updateAvailable: false })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      headers: new Headers([
        ['x-api-key', 'should-not-override-configured-key'],
        ['x-custom-header', 'custom-value'],
      ]),
    })

    const result = await updater.check()

    expect(result).toEqual({ updateAvailable: false })
    expect(fetchState.calls).toHaveLength(1)
  })

  test('ready handles empty successful confirm responses without warning', async () => {
    capacitorState.readyResult = { currentBundleId: 'bundle-1' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const logger = createLogger()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await updater.ready()

    expect(fetchState.calls).toHaveLength(1)
    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      bundleId: 'bundle-1',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
    expect(logger.warnCalls).toHaveLength(0)
  })

  test('ready confirms a bundle only once for the same current bundle id', async () => {
    capacitorState.readyResult = { currentBundleId: 'bundle-1' }

    fetchState.handler = async () => new Response(null, { status: 204 })

    const logger = createLogger()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await updater.ready()
    await updater.ready()

    expect(fetchState.calls).toHaveLength(1)
    expect(logger.warnCalls).toHaveLength(0)
  })

  test('ready retries confirmation when the previous confirm failed', async () => {
    capacitorState.readyResult = { currentBundleId: 'bundle-1' }

    fetchState.handler = async () => {
      if (fetchState.calls.length === 1) {
        return Response.json({ message: 'confirm failed' }, { status: 500 })
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await updater.ready()
    await updater.ready()

    expect(fetchState.calls).toHaveLength(2)
    expect(readJsonBody(fetchState.calls[1]!)).toMatchObject({
      transferSource: 'downloaded',
    })
    expect(logger.warnCalls).toHaveLength(1)
  })

  test('ready treats unreadable transfer source storage as downloaded', async () => {
    capacitorState.readyResult = { currentBundleId: 'bundle-1' }

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage unavailable')
        },
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    })

    fetchState.handler = async () => new Response(null, { status: 204 })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await updater.ready()

    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      transferSource: 'downloaded',
    })
  })

  test('sync returns no update when Otalan points to the current bundle', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-current',
          downloadUrl: 'https://cdn.example.com/bundle-current.zip',
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toEqual({ updateAvailable: false })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('sync records downloaded transfer source for the next confirm', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/bundle-next.zip',
        bundleId: 'bundle-next',
        checksum: undefined,
      },
    ])
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-next' }])
    expect(capacitorState.reloadCalls).toBe(1)

    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    const reloadedUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await reloadedUpdater.ready()

    expect(fetchState.calls).toHaveLength(2)
    expect(readJsonBody(fetchState.calls[1]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      bundleId: 'bundle-next',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
  })

  test('sync stages a cached bundle without downloading it again', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadedBundles = ['bundle-next']

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'cached',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-next' }])
    expect(capacitorState.reloadCalls).toBe(1)

    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    const reloadedUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await reloadedUpdater.ready()

    expect(fetchState.calls).toHaveLength(2)
    expect(readJsonBody(fetchState.calls[1]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      bundleId: 'bundle-next',
      deviceId: 'device-1',
      transferSource: 'cached',
    })
  })

  test('sync supports legacy bundle listing for Capacitor 7 live update plugins', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadedBundles = ['bundle-next']
    liveUpdateMock.getDownloadedBundles = undefined as unknown as typeof liveUpdateMock.getDownloadedBundles

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'cached',
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
  })

  test('sync treats cache probe failures as downloaded', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.getDownloadedBundlesError = new Error('cache unavailable')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/bundle-next.zip',
        bundleId: 'bundle-next',
        checksum: undefined,
      },
    ])
  })

  test('sync reloads immediately when the target bundle is already staged', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.nextBundle = { bundleId: 'bundle-next' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: false,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: false,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(1)
  })

  test('sync reports already staged bundles as cached when the cache check proves it', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.nextBundle = { bundleId: 'bundle-next' }
    capacitorState.downloadedBundles = ['bundle-next']

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: false,
        })
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'cached',
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
  })
})
