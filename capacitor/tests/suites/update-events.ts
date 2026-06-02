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
  waitForFetchCalls,
} from '../helpers/capacitor-test-harness'

describe('@otalan/capacitor update event reporting', () => {
  test('initialized sync reports check failures as diagnostics', async () => {
    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/report-update-event')) {
        return new Response(null, { status: 204 })
      }

      return Response.json({ message: 'app is archived' }, { status: 403 })
    }

    const logger = createLogger()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
      onResume: false,
    })

    await expect(updater.sync()).resolves.toBeNull()
    await waitForFetchCalls(2)

    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
      'https://api.otalan.com/capacitor/report-update-event',
    ])
    expect(readJsonBody(fetchState.calls[1]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      phase: 'check',
      category: 'check_failed',
      errorType: 'api-error',
      errorMessage: 'POST https://api.otalan.com/capacitor/check failed with status 403: app is archived',
      sdkName: OTALAN_CAPACITOR_SDK_NAME,
      sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
    })
    expect(readJsonBody(fetchState.calls[1]!).eventId).toEqual(expect.any(String))
  })

  test('initialized sync reports failed downloads as apply failures with target context', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-1' }
    capacitorState.downloadBundleError = new TypeError('Load failed')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-2',
          downloadUrl: 'https://cdn.example.com/bundle-2.zip',
          checksum: '0'.repeat(64),
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
      onResume: false,
    })

    await expect(updater.sync()).resolves.toBeNull()
    await waitForFetchCalls(2)

    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
      'https://api.otalan.com/capacitor/report-update-event',
    ])
    expect(readJsonBody(fetchState.calls[1]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      targetBundleId: 'bundle-2',
      phase: 'download',
      category: 'apply_failed',
      errorType: 'download-failed',
      errorMessage: 'LiveUpdate.downloadBundle failed (bundleId=bundle-2 url=https://cdn.example.com/bundle-2.zip): Load failed',
      sdkName: OTALAN_CAPACITOR_SDK_NAME,
      sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
    })
    expect(logger.warnCalls[0]?.[0]).toBe('[ota] manual sync failed')
  })

  test('initialized sync reports staging failures as apply failures with target context', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-1' }
    capacitorState.setNextBundleError = new Error('stage failed')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-2',
          downloadUrl: 'https://cdn.example.com/bundle-2.zip',
          checksum: '0'.repeat(64),
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
      onResume: false,
    })

    await expect(updater.sync()).resolves.toBeNull()
    await waitForFetchCalls(2)

    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
      'https://api.otalan.com/capacitor/report-update-event',
    ])
    expect(readJsonBody(fetchState.calls[1]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      targetBundleId: 'bundle-2',
      phase: 'stage',
      category: 'apply_failed',
      errorType: 'stage-failed',
      errorMessage: 'LiveUpdate.setNextBundle failed (bundleId=bundle-2): stage failed',
      sdkName: OTALAN_CAPACITOR_SDK_NAME,
      sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
    })
    expect(capacitorState.setNextCalls).toEqual([{ bundleId: 'bundle-2' }])
    expect(capacitorState.reloadCalls).toBe(0)
  })

  test('initialized sync reports reload failures as apply failures with target context', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-1' }
    capacitorState.reloadError = new Error('reload failed')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleCheckResponse({
          updateAvailable: true,
          bundleId: 'bundle-2',
          downloadUrl: 'https://cdn.example.com/bundle-2.zip',
          checksum: '0'.repeat(64),
        }))
      }

      return new Response(null, { status: 204 })
    }

    const logger = createLogger()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
      onResume: false,
    })

    await expect(updater.sync()).resolves.toBeNull()
    await waitForFetchCalls(2)

    expect(fetchState.calls.map((call) => call.url)).toEqual([
      'https://api.otalan.com/capacitor/check',
      'https://api.otalan.com/capacitor/report-update-event',
    ])
    expect(readJsonBody(fetchState.calls[1]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      targetBundleId: 'bundle-2',
      phase: 'reload',
      category: 'apply_failed',
      errorType: 'reload-failed',
      errorMessage: 'LiveUpdate.reload failed (bundleId=bundle-2): reload failed',
      sdkName: OTALAN_CAPACITOR_SDK_NAME,
      sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
    })
    expect(capacitorState.reloadCalls).toBe(1)
  })
})
