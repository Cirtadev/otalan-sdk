import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

type FetchCall = {
  url: string
  init?: RequestInit
}

const asyncStorageState = {
  getItemCalls: [] as string[],
  setItemCalls: [] as Array<{ key: string; value: string }>,
  storedValue: null as string | null,
}

const expoState = {
  platformOs: 'ios' as 'ios' | 'android' | 'web',
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0',
  updateId: 'update-1' as string | undefined,
}

const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json({ ok: true })
  },
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const originalDateNow = Date.now
const originalFetch = globalThis.fetch
const originalMathRandom = Math.random
let importCounter = 0

function applyModuleMocks() {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (key: string) => {
        asyncStorageState.getItemCalls.push(key)
        return asyncStorageState.storedValue
      },
      setItem: async (key: string, value: string) => {
        asyncStorageState.setItemCalls.push({ key, value })
        asyncStorageState.storedValue = value
      },
    },
  }))

  mock.module('react-native', () => ({
    Platform: {
      OS: expoState.platformOs,
    },
  }))

  mock.module('expo-updates', () => ({
    isEnabled: expoState.isEnabled,
    isEmbeddedLaunch: expoState.isEmbeddedLaunch,
    isEmergencyLaunch: expoState.isEmergencyLaunch,
    runtimeVersion: expoState.runtimeVersion,
    updateId: expoState.updateId,
  }))
}

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?test=${importCounter}`)
}

function readHeader(headers: HeadersInit | undefined, name: string) {
  return new Headers(headers).get(name)
}

function readJsonBody(call: FetchCall) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  asyncStorageState.getItemCalls = []
  asyncStorageState.setItemCalls = []
  asyncStorageState.storedValue = null

  expoState.platformOs = 'ios'
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = false
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'

  fetchState.calls = []
  fetchState.handler = async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json({ ok: true })
  }

  globalThis.fetch = (async (input, init) => {
    fetchState.calls.push({
      url: String(input),
      init,
    })

    return fetchState.handler(String(input), init)
  }) as typeof fetch

  Date.now = originalDateNow
  Math.random = originalMathRandom
})

afterAll(() => {
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
  Math.random = originalMathRandom
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/expo', () => {
  test('confirmCurrentUpdate supports tuple arrays in custom request headers', async () => {
    fetchState.handler = async (_url, init) => {
      expect(readHeader(init?.headers, 'content-type')).toBe('application/json')
      expect(readHeader(init?.headers, 'x-api-key')).toBe('otalan_ota_xxx')
      expect(readHeader(init?.headers, 'x-custom-header')).toBe('custom-value')

      return Response.json({ ok: true })
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      deviceId: 'device-1',
      headers: [
        ['x-api-key', 'should-not-override-configured-key'],
        ['x-custom-header', 'custom-value'],
      ],
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result.confirmed).toBe(true)
    expect(result.transferSource).toBe('downloaded')
    expect(fetchState.calls).toHaveLength(1)
    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      updateId: 'update-1',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
  })

  test('confirmCurrentUpdate skips emergency launches', async () => {
    expoState.isEmergencyLaunch = true

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      deviceId: 'device-1',
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result).toEqual({
      enabled: true,
      confirmed: false,
      isEmbeddedLaunch: false,
      isEmergencyLaunch: true,
      runtimeVersion: '1.0.0',
      updateId: 'update-1',
    })
    expect(fetchState.calls).toHaveLength(0)
  })

  test('confirmCurrentUpdate confirms the same update only once', async () => {
    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      deviceId: 'device-1',
    })

    const first = await updater.confirmCurrentUpdate()
    const second = await updater.confirmCurrentUpdate()

    expect(first.confirmed).toBe(true)
    expect(second.confirmed).toBe(true)
    expect(first.transferSource).toBe('downloaded')
    expect(second.transferSource).toBe('downloaded')
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater creates and persists a device id when one is not provided', async () => {
    Date.now = () => 1_700_000_000_000
    Math.random = () => 0.123456789

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        deviceId?: string
        transferSource?: string
      }

      expect(body.deviceId).toBe(asyncStorageState.storedValue)
      expect(body.transferSource).toBe('downloaded')
      return Response.json({ ok: true })
    }

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
    })

    expect(asyncStorageState.getItemCalls).toEqual(['otalan-device-id'])
    expect(asyncStorageState.setItemCalls).toHaveLength(1)
    expect(asyncStorageState.setItemCalls[0]?.key).toBe('otalan-device-id')
    expect(asyncStorageState.setItemCalls[0]?.value.startsWith('otalan-expo-')).toBe(true)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater no-ops when required credentials are empty', async () => {
    const { initializeUpdater } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: '',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(asyncStorageState.setItemCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(0)
  })
})
