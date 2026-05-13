import { describe, expect, test } from 'bun:test'

import {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  capacitorState,
  createLogger,
  createUpdater,
  fetchState,
  readJsonBody,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor ready confirmation behavior', () => {
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
})
