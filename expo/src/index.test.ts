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
  return import(`./index?test=${importCounter}`)
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
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater creates and persists a device id when one is not provided', async () => {
    Date.now = () => 1_700_000_000_000
    Math.random = () => 0.123456789

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { deviceId?: string }
      expect(body.deviceId).toBe(asyncStorageState.storedValue)
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
})
