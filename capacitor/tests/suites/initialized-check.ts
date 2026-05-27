import { describe, expect, test } from 'bun:test'

import {
  buildCompatibleCheckResponse,
  capacitorState,
  fetchState,
  initializeUpdater,
  readJsonBody,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor initialized check', () => {
  test('checks for an update without downloading, staging, or reloading', async () => {
    fetchState.handler = async () => Response.json(buildCompatibleCheckResponse({
      updateAvailable: true,
      bundleId: 'bundle-next',
      downloadUrl: 'https://cdn.example.com/bundle-next.zip',
      checksum: '0'.repeat(64),
    }))

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      onResume: false,
    })

    await expect(updater.check()).resolves.toEqual({
      updateAvailable: true,
      bundleId: 'bundle-next',
      downloadUrl: 'https://cdn.example.com/bundle-next.zip',
      checksum: '0'.repeat(64),
      mandatory: false,
      appId: 'com.example.app',
      platform: 'ios',
      runtimeVersion: '1.0.0',
    })

    expect(fetchState.calls).toHaveLength(1)
    expect(fetchState.calls[0]?.url).toBe('https://api.otalan.com/capacitor/check')
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('returns null when no updater is enabled', async () => {
    capacitorState.isNativePlatform = false

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      onResume: false,
    })

    await expect(updater.check()).resolves.toBeNull()
    expect(fetchState.calls).toHaveLength(0)
  })
})
