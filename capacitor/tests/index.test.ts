import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

type FetchCall = {
  url: string
  init?: RequestInit
}

type CapacitorHttpPostInput = {
  url: string
  headers?: Record<string, string>
  data?: unknown
  responseType?: string
}

const capacitorState = {
  appId: 'com.example.app',
  isNativePlatform: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  currentBundle: { bundleId: undefined as string | undefined },
  nextBundle: { bundleId: undefined as string | undefined },
  downloadedBundles: [] as string[],
  downloadBundleError: null as Error | null,
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

const capacitorHttpState = {
  calls: [] as CapacitorHttpPostInput[],
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

    if (capacitorState.downloadBundleError) {
      throw capacitorState.downloadBundleError
    }
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
  CapacitorHttp: {
    post: async (input: CapacitorHttpPostInput) => {
      capacitorHttpState.calls.push(input)
      fetchState.calls.push({
        url: input.url,
        init: {
          method: 'POST',
          headers: input.headers,
          body: JSON.stringify(input.data),
        },
      })

      const response = await fetchState.handler(input.url, {
        method: 'POST',
        headers: input.headers,
        body: JSON.stringify(input.data),
      })

      return responseToNativeHttpResponse(response, input.url)
    },
  },
}))

mock.module('@capawesome/capacitor-live-update', () => ({
  LiveUpdate: liveUpdateMock,
}))

const {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  createUpdater,
  initializeUpdater,
} = await import('../src/index')

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

async function responseToNativeHttpResponse(response: Response, url: string) {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  const contentType = response.headers.get('content-type') ?? ''
  const data = response.status === 204 || response.status === 205
    ? undefined
    : contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined)

  return {
    data,
    status: response.status,
    headers,
    url,
  }
}

beforeEach(() => {
  installMemoryLocalStorage()

  capacitorState.appId = 'com.example.app'
  capacitorState.isNativePlatform = true
  capacitorState.platform = 'ios'
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.downloadedBundles = []
  capacitorState.downloadBundleError = null
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
  capacitorHttpState.calls = []

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
  test('exports the package version used in native logs', async () => {
    const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
      name: string
      version: string
    }

    expect(OTALAN_CAPACITOR_SDK_NAME).toBe(packageJson.name)
    expect(OTALAN_CAPACITOR_SDK_VERSION).toBe(packageJson.version)
  })

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
    expect(capacitorHttpState.calls).toHaveLength(1)
    expect(capacitorHttpState.calls[0]?.responseType).toBe('json')
  })

  test('check falls back to fetch outside native platforms', async () => {
    capacitorState.isNativePlatform = false

    fetchState.handler = async (_url, init) => {
      expect(readHeader(init?.headers, 'content-type')).toBe('application/json')
      return Response.json({ updateAvailable: false })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      nativeVersion: '1.0.0',
      platform: 'ios',
      deviceId: 'device-1',
    })

    const result = await updater.check()

    expect(result).toEqual({ updateAvailable: false })
    expect(fetchState.calls).toHaveLength(1)
    expect(capacitorHttpState.calls).toHaveLength(0)
  })

  test('check parses native HTTP JSON strings without JSON response headers', async () => {
    fetchState.handler = async () => new Response(JSON.stringify({ updateAvailable: false }), {
      headers: {
        'content-type': 'text/plain',
      },
    })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.check()

    expect(result).toEqual({ updateAvailable: false })
  })

  test('check includes request context when the API rejects the request', async () => {
    fetchState.handler = async () => Response.json({ message: 'invalid OTA key' }, { status: 401 })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).rejects.toThrow(
      'POST https://api.otalan.com/capacitor/check failed with status 401: invalid OTA key',
    )
  })

  test('initializeUpdater logs serializable sync errors for native consoles', async () => {
    fetchState.handler = async () => Response.json({ message: 'app is archived' }, { status: 403 })

    const logger = createLogger()

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    expect(logger.warnCalls).toEqual([
      [
        '[ota] launch sync failed',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'POST https://api.otalan.com/capacitor/check failed with status 403: app is archived',
        },
      ],
    ])
  })

  test('initializeUpdater logs the request URL when native HTTP fails before a response', async () => {
    fetchState.handler = async () => {
      throw new TypeError('Load failed')
    }

    const logger = createLogger()

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    expect(logger.warnCalls).toEqual([
      [
        '[ota] launch sync failed',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'POST https://api.otalan.com/capacitor/check failed before response: Load failed',
          cause: {
            sdkName: OTALAN_CAPACITOR_SDK_NAME,
            sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
            name: 'TypeError',
            message: 'Load failed',
          },
        },
      ],
    ])
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

  test('ready logs the confirm URL and SDK version when confirmation fails before a response', async () => {
    capacitorState.readyResult = { currentBundleId: '1.0.0-2' }

    fetchState.handler = async () => {
      throw new TypeError('Load failed')
    }

    const logger = createLogger()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'app.cryptosan.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await updater.ready()

    expect(logger.warnCalls).toEqual([
      [
        'Otalan install confirmation failed.',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'POST https://api.otalan.com/capacitor/confirm failed before response: Load failed',
          cause: {
            sdkName: OTALAN_CAPACITOR_SDK_NAME,
            sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
            name: 'TypeError',
            message: 'Load failed',
          },
        },
      ],
    ])
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

  test('sync works when destructured from the updater object', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({ updateAvailable: false })
      }

      return new Response(null, { status: 204 })
    }

    const { sync } = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(sync()).resolves.toEqual({ updateAvailable: false })
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
