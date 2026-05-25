import { describe, expect, test } from 'bun:test'

import {
  buildCompatibleCheckResponse,
  capacitorState,
  createLogger,
  createUpdater,
  fetchState,
} from '../helpers/capacitor-test-harness'
import type { DownloadProgressEvent } from '../helpers/capacitor-test-harness'

const DEFAULT_CHECKSUM = '0'.repeat(64)

function buildCompatibleUpdate(input: {
  bundleId: string
  downloadUrl: string
  mandatory?: boolean
}) {
  return buildCompatibleCheckResponse({
    updateAvailable: true,
    checksum: DEFAULT_CHECKSUM,
    ...input,
  })
}

describe('@otalan/capacitor download progress behavior', () => {
  test('sync forwards progress for the selected bundle and removes the listener', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadProgressEvents = [
      {
        bundleId: 'bundle-other',
        downloadedBytes: 25,
        totalBytes: 100,
        progress: 0.25,
      },
      {
        bundleId: 'bundle-next',
        downloadedBytes: 40,
        totalBytes: 100,
        progress: 0.4,
      },
      {
        bundleId: 'bundle-next',
        downloadedBytes: 100,
        totalBytes: 100,
        progress: 1,
      },
    ]

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleUpdate({
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        }))
      }

      return new Response(null, { status: 204 })
    }

    const progressEvents: DownloadProgressEvent[] = []
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      onDownloadProgress: (event) => {
        progressEvents.push(event)
      },
    })

    const result = await updater.sync()

    expect(result).toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'downloaded',
    })
    expect(progressEvents).toEqual([
      {
        bundleId: 'bundle-next',
        downloadedBytes: 40,
        totalBytes: 100,
        progress: 0.4,
      },
      {
        bundleId: 'bundle-next',
        downloadedBytes: 100,
        totalBytes: 100,
        progress: 1,
      },
    ])
    expect(capacitorState.addDownloadProgressListenerCalls).toBe(1)
    expect(capacitorState.downloadProgressListenerRemovals).toBe(1)
    expect(capacitorState.downloadProgressListeners).toHaveLength(0)
  })

  test('sync continues when the progress listener cannot be registered', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.addDownloadProgressListenerError = new Error('listener unavailable')

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleUpdate({
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
          mandatory: true,
        }))
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
      onDownloadProgress: () => undefined,
    })

    await expect(updater.sync()).resolves.toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'downloaded',
    })
    expect(capacitorState.downloadCalls).toHaveLength(1)
    expect(logger.warnCalls).toMatchObject([
      [
        'Otalan download progress listener registration failed.',
        {
          name: 'Error',
          message: 'listener unavailable',
        },
      ],
    ])
  })

  test('sync isolates errors thrown by app progress callbacks', async () => {
    capacitorState.currentBundle = { bundleId: 'bundle-current' }
    capacitorState.downloadProgressEvents = [
      {
        bundleId: 'bundle-next',
        downloadedBytes: 100,
        totalBytes: 100,
        progress: 1,
      },
    ]

    fetchState.handler = async (url) => {
      if (url.endsWith('/capacitor/check')) {
        return Response.json(buildCompatibleUpdate({
          bundleId: 'bundle-next',
          downloadUrl: 'https://cdn.example.com/bundle-next.zip',
        }))
      }

      return new Response(null, { status: 204 })
    }

    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      onDownloadProgress: () => {
        throw new Error('render failed')
      },
    })

    await expect(updater.sync()).resolves.toMatchObject({
      updateAvailable: true,
      bundleId: 'bundle-next',
      transferSource: 'downloaded',
    })
    expect(capacitorState.downloadProgressListenerRemovals).toBe(1)
  })
})
