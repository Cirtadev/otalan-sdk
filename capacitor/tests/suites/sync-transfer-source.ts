import { describe, expect, test } from 'bun:test'

import {
  capacitorState,
  createUpdater,
  fetchState,
  liveUpdateMock,
  readJsonBody,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor sync transfer source behavior', () => {
  test('sync returns no update when Otalan points to the current bundle', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-current',
          downloadUrl: 'https://cdn.example.com/bundle-current.zip',
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

    const result = await updater.sync()

    expect(result).toEqual({ updateAvailable: false })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('sync works when destructured from the updater object', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({ updateAvailable: false })
      }

      return new Response(null, { status: 204 })
    }

    const { sync } = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(sync()).resolves.toEqual({ updateAvailable: false })
  })

  test('sync records downloaded transfer source for the next confirm', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
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

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/bundle-next.zip',
        bundleId: 'bundle-next',
        checksum: undefined,
      },
    ])
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-next' }])
    expect(capacitorState.reloadCalls).toBe(1)

    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    const reloadedUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await reloadedUpdater.ready()

    expect(fetchState.calls).toHaveLength(2)
    expect(readJsonBody(fetchState.calls[1]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      bundleId: 'bundle-next',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
  })

  test('sync stages a cached bundle without downloading it again', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadedBundles = ['bundle-next']

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
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

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'cached',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-next' }])
    expect(capacitorState.reloadCalls).toBe(1)

    capacitorState.readyResult = { currentBundleId: 'bundle-next' }

    const reloadedUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await reloadedUpdater.ready()

    expect(fetchState.calls).toHaveLength(2)
    expect(readJsonBody(fetchState.calls[1]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      bundleId: 'bundle-next',
      deviceId: 'device-1',
      transferSource: 'cached',
    })
  })

  test('sync supports legacy bundle listing for Capacitor 7 live update plugins', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadedBundles = ['bundle-next']
    liveUpdateMock.getDownloadedBundles = undefined as unknown as typeof liveUpdateMock.getDownloadedBundles

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
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

    const result = await updater.sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'cached',
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
  })

  test('sync treats cache probe failures as downloaded', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.getDownloadedBundlesError = new Error('cache unavailable')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
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

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: true,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toEqual([
      {
        url: 'https://cdn.example.com/bundle-next.zip',
        bundleId: 'bundle-next',
        checksum: undefined,
      },
    ])
  })

  test('sync reloads immediately when the target bundle is already staged', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.nextBundle = { bundleId: 'bundle-next' }

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: false,
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

    const result = await updater.sync()

    expect(result).toEqual({
      updateAvailable: true,
      applied: true,
      bundleId: 'bundle-next',
      mandatory: false,
      transferSource: 'downloaded',
      releaseNotes: undefined,
      reloadRequired: false,
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
    expect(capacitorState.reloadCalls).toBe(1)
  })

  test('sync reports already staged bundles as cached when the cache check proves it', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.nextBundle = { bundleId: 'bundle-next' }
    capacitorState.downloadedBundles = ['bundle-next']

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json({
          updateAvailable: true,
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: false,
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

    const result = await updater.sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'cached',
    })
    expect(capacitorState.downloadCalls).toHaveLength(0)
    expect(capacitorState.setNextCalls).toHaveLength(0)
  })
})
