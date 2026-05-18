import { describe, expect, test } from 'bun:test'

import {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  buildCompatibleCheckResponse,
  capacitorState,
  createLogger,
  fetchState,
  initializeUpdater,
  readJsonBody,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor initializeUpdater device behavior', () => {
  test('initializeUpdater creates, persists, and exposes a device id when one is not provided', async () => {
    Date.now = () => 1_700_000_000_000
    Math.random = () => 0.123456789

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse())
      }

      return new Response(null, { status: 204 })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      onResume: false,
    })

    const deviceId = await updater.getDeviceId()

    expect(deviceId?.startsWith('otalan-capacitor-')).toBe(true)
    expect(globalThis.localStorage.getItem('otalan-device-id')).toBe(deviceId)
    expect(readJsonBody(fetchState.calls[0]!).deviceId).toBe(deviceId)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater uses an explicit device id override', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse())
      }

      return new Response(null, { status: 204 })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-override',
      onResume: false,
    })

    expect(await updater.getDeviceId()).toBe('device-override')
    expect(globalThis.localStorage.getItem('otalan-device-id')).toBeNull()
    expect(readJsonBody(fetchState.calls[0]!).deviceId).toBe('device-override')
  })

  test('initializeUpdater no-ops when required channel is empty', async () => {
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: '',
      deviceId: 'device-override',
      onResume: false,
    })

    expect(await updater.getDeviceId()).toBe('device-override')
    expect(await updater.getUpdater()).toBeNull()
    expect(await updater.sync()).toBeNull()
    expect(fetchState.calls).toHaveLength(0)
  })

  test('initializeUpdater reads device id from custom storage', async () => {
    const storageCalls = {
      getItem: [] as string[],
      setItem: [] as Array<{ key: string; value: string }>,
    }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse())
      }

      return new Response(null, { status: 204 })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceIdStorage: {
        getItem: async (key) => {
          storageCalls.getItem.push(key)
          return 'custom-device-1'
        },
        setItem: async (key, value) => {
          storageCalls.setItem.push({ key, value })
        },
      },
      deviceIdStorageKey: 'custom-device-key',
      onResume: false,
    })

    expect(await updater.getDeviceId()).toBe('custom-device-1')
    expect(storageCalls.getItem).toEqual(['custom-device-key'])
    expect(storageCalls.setItem).toHaveLength(0)
    expect(globalThis.localStorage.getItem('otalan-device-id')).toBeNull()
    expect(readJsonBody(fetchState.calls[0]!).deviceId).toBe('custom-device-1')
  })

  test('initializeUpdater logs device id storage failures and no-ops', async () => {
    const logger = createLogger()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceIdStorage: {
        getItem: async () => {
          throw new Error('storage unavailable')
        },
        setItem: async () => undefined,
      },
      logger: logger.logger,
      onResume: false,
    })

    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.getUpdater()).toBeNull()
    expect(await updater.sync()).toBeNull()
    expect(fetchState.calls).toHaveLength(0)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan device ID initialization failed.',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'storage unavailable',
        },
      ],
    ])
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

  test('initializeUpdater logs resume listener failures and still runs launch sync', async () => {
    capacitorState.addListenerError = new Error('listener unavailable')

    fetchState.handler = async () => Response.json(buildCompatibleCheckResponse())

    const logger = createLogger()

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    expect(capacitorState.addListenerCalls).toBe(1)
    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
    ])
    expect(logger.warnCalls).toEqual([
      [
        'Otalan resume listener registration failed.',
        {
          sdkName: OTALAN_CAPACITOR_SDK_NAME,
          sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
          name: 'Error',
          message: 'listener unavailable',
        },
      ],
    ])
  })
})
