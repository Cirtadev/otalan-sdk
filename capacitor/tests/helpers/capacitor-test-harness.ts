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
  connectTimeout?: number
  readTimeout?: number
}

export type DownloadProgressEvent = {
  bundleId: string
  downloadedBytes: number
  totalBytes: number
  progress: number
}

export const capacitorState = {
  appId: 'com.example.app',
  appInfoError: null as Error | null,
  isNativePlatform: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  currentBundle: { bundleId: undefined as string | undefined },
  nextBundle: { bundleId: undefined as string | undefined },
  downloadedBundles: [] as string[],
  downloadBundleError: null as Error | null,
  getDownloadedBundlesError: null as Error | null,
  addDownloadProgressListenerError: null as Error | null,
  setNextBundleError: null as Error | null,
  reloadError: null as Error | null,
  versionName: '1.0.0',
  readyResult: { currentBundleId: undefined as string | undefined },
  addListenerCalls: 0,
  addListenerError: null as Error | null,
  addDownloadProgressListenerCalls: 0,
  downloadProgressListenerRemovals: 0,
  downloadProgressEvents: [] as DownloadProgressEvent[],
  downloadProgressListeners: [] as Array<(event: DownloadProgressEvent) => void>,
  downloadCalls: [] as Array<{ url: string; bundleId: string; checksum?: string }>,
  setNextCalls: [] as Array<{ bundleId: string }>,
  reloadCalls: 0,
  readyCalls: 0,
  resetCalls: 0,
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
  ready: async () => {
    capacitorState.readyCalls += 1
    return capacitorState.readyResult
  },
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
    emitConfiguredDownloadProgress()

    if (capacitorState.downloadBundleError) {
      throw capacitorState.downloadBundleError
    }
  },
  setNextBundle: async (input: { bundleId: string }) => {
    capacitorState.setNextCalls.push(input)

    if (capacitorState.setNextBundleError) {
      throw capacitorState.setNextBundleError
    }
  },
  reload: async () => {
    capacitorState.reloadCalls += 1

    if (capacitorState.reloadError) {
      throw capacitorState.reloadError
    }
  },
  reset: async () => {
    capacitorState.resetCalls += 1
  },
  addListener: async (
    eventName: 'downloadBundleProgress',
    listener: (event: DownloadProgressEvent) => void,
  ) => {
    if (eventName !== 'downloadBundleProgress') {
      throw new Error(`Unsupported listener: ${eventName}`)
    }

    capacitorState.addDownloadProgressListenerCalls += 1

    if (capacitorState.addDownloadProgressListenerError) {
      throw capacitorState.addDownloadProgressListenerError
    }

    capacitorState.downloadProgressListeners.push(listener)

    return {
      remove: async () => {
        const index = capacitorState.downloadProgressListeners.indexOf(listener)
        if (index >= 0) {
          capacitorState.downloadProgressListeners.splice(index, 1)
        }
        capacitorState.downloadProgressListenerRemovals += 1
      },
    }
  },
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

mock.module('@capacitor/app', () => ({
  App: {
    getInfo: async () => {
      if (capacitorState.appInfoError) {
        throw capacitorState.appInfoError
      }

      return { id: capacitorState.appId }
    },
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

export function buildCompatibleCheckResponse(input: Record<string, unknown> = { updateAvailable: false }) {
  return {
    appId: capacitorState.appId,
    platform: capacitorState.platform === 'android' ? 'android' : 'ios',
    runtimeVersion: capacitorState.versionName,
    ...input,
  }
}

export async function waitForFetchCalls(count: number) {
  await waitForCondition(
    () => fetchState.calls.length >= count,
    `Expected at least ${count} fetch call(s), received ${fetchState.calls.length}.`,
  )
}

export async function waitForWarnCalls(warnCalls: unknown[][], count: number) {
  await waitForCondition(
    () => warnCalls.length >= count,
    `Expected at least ${count} warning call(s), received ${warnCalls.length}.`,
  )
}

export function resetCapacitorTestHarness() {
  installMemoryLocalStorage()

  capacitorState.appId = 'com.example.app'
  capacitorState.appInfoError = null
  capacitorState.isNativePlatform = true
  capacitorState.platform = 'ios'
  capacitorState.currentBundle = { bundleId: undefined }
  capacitorState.nextBundle = { bundleId: undefined }
  capacitorState.downloadedBundles = []
  capacitorState.downloadBundleError = null
  capacitorState.getDownloadedBundlesError = null
  capacitorState.addDownloadProgressListenerError = null
  capacitorState.setNextBundleError = null
  capacitorState.reloadError = null
  capacitorState.versionName = '1.0.0'
  capacitorState.readyResult = { currentBundleId: undefined }
  capacitorState.addListenerCalls = 0
  capacitorState.addListenerError = null
  capacitorState.addDownloadProgressListenerCalls = 0
  capacitorState.downloadProgressListenerRemovals = 0
  capacitorState.downloadProgressEvents = []
  capacitorState.downloadProgressListeners = []
  capacitorState.downloadCalls = []
  capacitorState.setNextCalls = []
  capacitorState.reloadCalls = 0
  capacitorState.readyCalls = 0
  capacitorState.resetCalls = 0
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

async function waitForCondition(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (condition()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(message)
}

function emitConfiguredDownloadProgress() {
  for (const event of capacitorState.downloadProgressEvents) {
    emitDownloadProgress(event)
  }
}

function emitDownloadProgress(event: DownloadProgressEvent) {
  for (const listener of [...capacitorState.downloadProgressListeners]) {
    listener(event)
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
