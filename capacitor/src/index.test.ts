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
  LiveUpdate: {
    ready: async () => capacitorState.readyResult,
    getVersionName: async () => ({ versionName: capacitorState.versionName }),
    getCurrentBundle: async () => capacitorState.currentBundle,
    getNextBundle: async () => capacitorState.nextBundle,
    getDownloadedBundles: async () => ({ bundleIds: [...capacitorState.downloadedBundles] }),
    downloadBundle: async (input: { url: string; bundleId: string; checksum?: string }) => {
      capacitorState.downloadCalls.push(input)
    },
    setNextBundle: async (input: { bundleId: string }) => {
      capacitorState.setNextCalls.push(input)
    },
    reload: async () => {
      capacitorState.reloadCalls += 1
    },
  },
}))

const { createUpdater } = await import('./index')

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch

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

beforeEach(() => {
  capacitorState.appId = 'com.example.app'
  capacitorState.isNativePlatform = true
  capacitorState.platform = 'ios'
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.downloadedBundles = []
  capacitorState.versionName = '1.0.0'
  capacitorState.readyResult = { currentBundleId: undefined }
  capacitorState.downloadCalls = []
  capacitorState.setNextCalls = []
  capacitorState.reloadCalls = 0

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
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/capacitor', () => {
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

  test('sync stages a downloaded bundle without downloading it again', async () => {
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
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-next' }])
    expect(capacitorState.reloadCalls).toBe(1)
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
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(1)
  })
})
