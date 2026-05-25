import { beforeEach, describe, expect, mock, test } from 'bun:test'

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
  connectTimeout?: number
  readTimeout?: number
}

const capacitorState = {
  appId: 'app.cryptosan.app',
  isNativePlatform: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  currentBundle: { bundleId: undefined as string | undefined },
  nextBundle: { bundleId: undefined as string | undefined },
  downloadedBundles: [] as string[],
  downloadBundleError: null as Error | null,
  readyResult: { currentBundleId: undefined as string | undefined },
  versionName: '1.0.0',
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
  getDownloadedBundles: async () => ({ bundleIds: [...capacitorState.downloadedBundles] }),
  getBundles: async () => ({ bundleIds: [...capacitorState.downloadedBundles] }),
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

function createUpdaterForCryptosan() {
  return createUpdater({
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    appId: 'app.cryptosan.app',
    channel: 'production',
    deviceId: 'device-1',
  })
}

type CompatibleUpdateInput = {
  bundleId: string
  downloadUrl: string
  checksum?: string
  mandatory?: boolean
}

const DEFAULT_CHECKSUM = '0'.repeat(64)

function buildCompatibleCryptosanUpdate(input: CompatibleUpdateInput) {
  return {
    updateAvailable: true,
    appId: 'app.cryptosan.app',
    platform: 'ios',
    runtimeVersion: capacitorState.versionName,
    checksum: DEFAULT_CHECKSUM,
    ...input,
  }
}

async function waitForWarnCalls(warnCalls: unknown[][], count: number) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (warnCalls.length >= count) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected at least ${count} warning call(s), received ${warnCalls.length}.`)
}

beforeEach(() => {
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.downloadedBundles = []
  capacitorState.downloadBundleError = null
  capacitorState.readyResult = { currentBundleId: undefined }
  capacitorState.versionName = '1.0.0'
  capacitorState.downloadCalls = []
  capacitorState.setNextCalls = []
  capacitorState.reloadCalls = 0

  fetchState.calls = []
  fetchState.handler = async (url: string, init?: RequestInit) => {
    void url
    void init
    return new Response('not mocked', { status: 500 })
  }
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/capacitor sync regressions', () => {
  test('sync applies an OTA bundle when the native app has no current bundle', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCryptosanUpdate({
          bundleId: '1.0.0-2',
          downloadUrl: 'https://cdn.example.com/1.0.0-2.zip',
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const result = await createUpdaterForCryptosan().sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: '1.0.0-2',
      mandatory: true,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/1.0.0-2.zip',
        bundleId: '1.0.0-2',
        checksum: DEFAULT_CHECKSUM,
      },
    ])
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: '1.0.0-2' }])
    expect(capacitorState.reloadCalls).toBe(1)
  })

  test('sync passes SHA-256 hex checksums through to the live update plugin', async () => {
    const checksum = '0'.repeat(64)

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCryptosanUpdate({
          bundleId: '1.0.0-2',
          downloadUrl: 'https://cdn.example.com/1.0.0-2.zip',
          checksum,
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    await createUpdaterForCryptosan().sync()

    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/1.0.0-2.zip',
        bundleId: '1.0.0-2',
        checksum,
      },
    ])
  })

  test('sync checks for newer bundles while current bundle confirmation is pending', async () => {
    capacitorState.readyResult = { currentBundleId: '1.0.0-2' }
    capacitorState.currentBundle = { bundleId: '1.0.0-2' }

    let resolveConfirm: (response: Response) => void = () => undefined
    const confirmResponse = new Promise<Response>((resolve) => {
      resolveConfirm = resolve
    })

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/confirm')) {
        return confirmResponse
      }

      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCryptosanUpdate({
          bundleId: '1.0.0-3',
          downloadUrl: 'https://cdn.example.com/1.0.0-3.zip',
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const result = await createUpdaterForCryptosan().sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: '1.0.0-3',
      transferSource: 'downloaded',
    })
    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/confirm',
      'https://api.otalan.com/capacitor/check',
    ])
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: '1.0.0-3' }])
    expect(capacitorState.reloadCalls).toBe(1)

    resolveConfirm(new Response(null, { status: 204 }))
    await Promise.resolve()
  })

  test('initialized sync logs bundle download context and SDK version when download fails', async () => {
    capacitorState.currentBundle = { bundleId: '1.0.0-2' }
    capacitorState.downloadBundleError = new TypeError('Load failed')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCryptosanUpdate({
          bundleId: '1.0.0-3',
          downloadUrl: 'https://cdn.example.com/1.0.0-3.zip',
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'app.cryptosan.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await updater.sync()
    await waitForWarnCalls(logger.warnCalls, 1)

    expect(logger.warnCalls).toEqual([
      [
        '[ota] manual sync failed',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'LiveUpdate.downloadBundle failed (bundleId=1.0.0-3 url=https://cdn.example.com/1.0.0-3.zip): Load failed',
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
})
