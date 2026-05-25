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

type ResumeHandler = () => void

const capacitorState = {
  appId: 'com.example.app',
  isNativePlatform: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  currentBundle: { bundleId: undefined as string | undefined },
  nextBundle: { bundleId: undefined as string | undefined },
  readyResult: { currentBundleId: undefined as string | undefined },
  versionName: '1.0.0',
  addListenerCalls: [] as Array<{ eventName: string; handler: ResumeHandler }>,
}

function buildCompatibleCheckResponse() {
  return {
    updateAvailable: false,
    appId: capacitorState.appId,
    platform: capacitorState.platform === 'android' ? 'android' : 'ios',
    runtimeVersion: capacitorState.versionName,
  }
}

const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json(buildCompatibleCheckResponse())
  },
}

const liveUpdateMock = {
  ready: async () => capacitorState.readyResult,
  getVersionName: async () => ({ versionName: capacitorState.versionName }),
  getCurrentBundle: async () => capacitorState.currentBundle,
  getNextBundle: async () => capacitorState.nextBundle,
  getDownloadedBundles: async () => ({ bundleIds: [] as string[] }),
  getBundles: async () => ({ bundleIds: [] as string[] }),
  downloadBundle: async () => undefined,
  setNextBundle: async () => undefined,
  reload: async () => undefined,
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

mock.module('@capacitor/app', () => ({
  App: {
    getInfo: async () => ({ id: capacitorState.appId }),
    addListener: async (eventName: string, handler: ResumeHandler) => {
      capacitorState.addListenerCalls.push({ eventName, handler })
      return { remove: async () => undefined }
    },
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

const { initializeUpdater } = await import('../src/index?initialize-resume')

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

async function responseToNativeHttpResponse(response: Response, url: string) {
  const contentType = response.headers.get('content-type') ?? ''
  const data = response.status === 204 || response.status === 205
    ? undefined
    : contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined)

  return {
    data,
    status: response.status,
    headers: {},
    url,
  }
}

async function waitForFetchCalls(count: number) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (fetchState.calls.length >= count) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected at least ${count} fetch call(s), received ${fetchState.calls.length}.`)
}

beforeEach(() => {
  capacitorState.appId = 'com.example.app'
  capacitorState.isNativePlatform = true
  capacitorState.platform = 'ios'
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.readyResult = { currentBundleId: undefined }
  capacitorState.versionName = '1.0.0'
  capacitorState.addListenerCalls = []

  fetchState.calls = []
  fetchState.handler = async () => Response.json(buildCompatibleCheckResponse())
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/capacitor initializeUpdater resume behavior', () => {
  test('registers one resume listener and waits for resume before syncing', async () => {
    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
    })

    expect(capacitorState.addListenerCalls).toHaveLength(1)
    expect(capacitorState.addListenerCalls[0]?.eventName).toBe('resume')
    expect(fetchState.calls).toHaveLength(0)

    capacitorState.addListenerCalls[0]?.handler()
    await waitForFetchCalls(1)

    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
    ])
  })

  test('skips resume listener registration when onResume is false', async () => {
    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      onResume: false,
    })

    expect(capacitorState.addListenerCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(0)
  })
})
