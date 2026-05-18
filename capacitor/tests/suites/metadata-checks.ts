import { describe, expect, test } from 'bun:test'

import {
  OTALAN_CAPACITOR_SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION,
  buildCompatibleCheckResponse,
  capacitorHttpState,
  capacitorState,
  createUpdater,
  fetchState,
  readHeader,
  readJsonBody,
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

      return Response.json(buildCompatibleCheckResponse())
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

    expect(result).toMatchObject({
      updateAvailable: false,
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })
    expect(fetchState.calls).toHaveLength(1)
    expect(capacitorHttpState.calls).toHaveLength(1)
    expect(capacitorHttpState.calls[0]?.responseType).toBe('json')
  })

  test('check sends the running app compatibility context', async () => {
    capacitorState.platform = 'android'
    capacitorState.versionName = '2.1.0'
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async () => Response.json({
      updateAvailable: false,
      appId: 'com.example.app',
      platform: 'android',
      runtimeVersion: '2.1.0',
    })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'beta',
      deviceId: 'device-1',
    })

    await updater.check()

    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'android',
      channel: 'beta',
      runtimeVersion: '2.1.0',
      currentBundleId: 'bundle-current',
      deviceId: 'device-1',
    })
  })

  test('sync rejects served updates that conflict with the running runtime version', async () => {
    capacitorState.versionName = '1.0.0'

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          appId: 'com.example.app',
          platform: 'ios',
          runtimeVersion: '2.0.0',
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

    await expect(updater.sync()).rejects.toThrow(
      'Otalan check response is incompatible with the running app: runtimeVersion=2.0.0 does not match 1.0.0.',
    )
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('sync rejects check responses missing required compatibility metadata', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
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

    await expect(updater.sync()).rejects.toThrow(
      'Otalan check response field "appId" is required.',
    )
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('check accepts matching compatibility metadata in update responses', async () => {
    fetchState.handler = async () => Response.json({
      updateAvailable: true,
      bundleId: 'bundle-next',
      downloadUrl: 'https://cdn.example.com/bundle-next.zip',
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).resolves.toEqual({
      updateAvailable: true,
      bundleId: 'bundle-next',
      downloadUrl: 'https://cdn.example.com/bundle-next.zip',
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })
  })

  test('check falls back to fetch outside native platforms', async () => {
    capacitorState.isNativePlatform = false

    fetchState.handler = async (_url, init) => {
      expect(readHeader(init?.headers, 'content-type')).toBe('application/json')
      return Response.json(buildCompatibleCheckResponse())
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      runtimeVersion: '1.0.0',
      platform: 'ios',
      deviceId: 'device-1',
    })

    const result = await updater.check()

    expect(result).toMatchObject({
      updateAvailable: false,
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })
    expect(fetchState.calls).toHaveLength(1)
    expect(capacitorHttpState.calls).toHaveLength(0)
  })

  test('check parses native HTTP JSON strings without JSON response headers', async () => {
    fetchState.handler = async () => new Response(JSON.stringify(buildCompatibleCheckResponse()), {
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

    expect(result).toMatchObject({
      updateAvailable: false,
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })
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

  test('check surfaces nested API error messages from native HTTP responses', async () => {
    fetchState.handler = async () => Response.json({
      error: {
        message: 'runtimeVersion is required',
      },
    }, { status: 400 })

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).rejects.toThrow(
      'POST https://api.otalan.com/capacitor/check failed with status 400: runtimeVersion is required',
    )
  })
})
