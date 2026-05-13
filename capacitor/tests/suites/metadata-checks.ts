import { describe, expect, test } from 'bun:test'

import {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  capacitorHttpState,
  capacitorState,
  createUpdater,
  fetchState,
  readHeader,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor metadata and checks', () => {
  test('exports the package version used in native logs', async () => {
    const packageJson = await Bun.file(new URL('../../package.json', import.meta.url)).json() as {
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
})
