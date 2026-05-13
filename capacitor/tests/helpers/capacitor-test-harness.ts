import { mock } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

export type FetchCall = {
  url: string
  init?: RequestInit
}

type CapacitorHttpPostInput = {
  url: string
  headers?: Record<string, string>
  data?: unknown
  responseType?: string
}

export const capacitorState = {
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
  addListenerCalls: 0,
  addListenerError: null as Error | null,
  downloadCalls: [] as Array<{ url: string; bundleId: string; checksum?: string }>,
  setNextCalls: [] as Array<{ bundleId: string }>,
  reloadCalls: 0,
}

export const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return new Response('not mocked', { status: 500 })
  },
}

export const capacitorHttpState = {
  calls: [] as CapacitorHttpPostInput[],
}

export const liveUpdateMock = {
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
    addListener: async () => {
      capacitorState.addListenerCalls += 1

      if (capacitorState.addListenerError) {
        throw capacitorState.addListenerError
      }

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

export const {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  createUpdater,
  initializeUpdater,
} = await import('../../src/index?capacitor-test-harness')

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalDateNow = Date.now
const originalMathRandom = Math.random

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

export function createLogger() {
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

export function readHeader(headers: HeadersInit | undefined, name: string) {
  return new Headers(headers).get(name)
}

export function readJsonBody(call: FetchCall) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

export function resetCapacitorTestHarness() {
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
  capacitorState.addListenerCalls = 0
  capacitorState.addListenerError = null
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

  Date.now = originalDateNow
  Math.random = originalMathRandom
}

export function restoreCapacitorTestHarness() {
  globalThis.fetch = originalFetch
  restoreLocalStorage()
  Date.now = originalDateNow
  Math.random = originalMathRandom
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
