import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { HttpResponse } from '@capacitor/core'

import packageJson from '../package.json' with { type: 'json' }

import type {
  CapacitorTransferSource,
  CapacitorUpdaterConfig,
  OtaPlatform,
} from './types'

export const OTALAN_CAPACITOR_SDK_NAME = packageJson.name
export const OTALAN_CAPACITOR_SDK_VERSION = packageJson.version

export const DEFAULT_TRANSFER_SOURCE: CapacitorTransferSource = 'downloaded'

export const SDK_LOG_CONTEXT = {
  sdkName: OTALAN_CAPACITOR_SDK_NAME,
  sdkVersion: OTALAN_CAPACITOR_SDK_VERSION,
}

export function joinUrl(base: string, pathname: string) {
  return `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
}

export function resolvePlatform(config: CapacitorUpdaterConfig) {
  const platform = config.platform ?? Capacitor.getPlatform()

  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Unsupported Capacitor platform: ${platform}`)
  }

  return platform
}

export function requireDeviceId(config: Pick<CapacitorUpdaterConfig, 'deviceId'>) {
  if (!config.deviceId) {
    throw new Error('Otalan Capacitor updater requires deviceId because POST /capacitor/confirm requires it.')
  }

  return config.deviceId
}

export function isNativeOtaPlatform(platform: string): platform is OtaPlatform {
  return platform === 'ios' || platform === 'android'
}

export function buildHeaders(config: CapacitorUpdaterConfig, extra?: HeadersInit) {
  const headers = mergeHeaders(config.headers, extra)

  headers.set('Content-Type', 'application/json')
  headers.set('x-api-key', config.apiKey)

  return headers
}

export async function postJson<T>(url: string, body: unknown, headers: HeadersInit) {
  if (Capacitor.isNativePlatform()) {
    return postJsonWithCapacitorHttp<T>(url, body, headers)
  }

  return postJsonWithFetch<T>(url, body, headers)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field]
  return typeof fieldValue === 'string' && fieldValue ? fieldValue : undefined
}

export function buildRequestFailureError(url: string, error: unknown) {
  return new Error(`POST ${url} failed before response: ${readErrorMessage(error)}`, {
    cause: error,
  })
}

export function buildLiveUpdateFailureError(
  operation: string,
  error: unknown,
  details?: Record<string, string | undefined>,
) {
  const detailText = Object.entries(details ?? {})
    .filter((entry) => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  const message = detailText
    ? `${operation} failed (${detailText}): ${readErrorMessage(error)}`
    : `${operation} failed: ${readErrorMessage(error)}`

  return new Error(message, { cause: error })
}

export function serializeErrorForLog(error: unknown): unknown {
  if (!isRecord(error)) {
    return {
      ...SDK_LOG_CONTEXT,
      message: String(error),
    }
  }

  const name = error instanceof Error ? error.name : readStringField(error, 'name')
  const message = error instanceof Error ? error.message : readStringField(error, 'message')
  const code = readCodeField(error)
  const cause = 'cause' in error ? serializeErrorForLog(error.cause) : undefined

  if (!name && !message && code === undefined && cause === undefined) {
    return {
      ...SDK_LOG_CONTEXT,
      value: error,
    }
  }

  return {
    ...SDK_LOG_CONTEXT,
    ...(name ? { name } : {}),
    message: message ?? String(error),
    ...(code !== undefined ? { code } : {}),
    ...(cause !== undefined ? { cause } : {}),
  }
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>) {
  const headers = new Headers()

  for (const source of sources) {
    if (!source) {
      continue
    }

    new Headers(source).forEach((value, key) => {
      headers.set(key, value)
    })
  }

  return headers
}

async function postJsonWithFetch<T>(url: string, body: unknown, headers: HeadersInit) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).catch((error) => {
    throw buildRequestFailureError(url, error)
  })

  if (!response.ok) {
    throw new Error(buildHttpErrorMessage(url, response.status, await readErrorResponseMessage(response)))
  }

  return parseJsonResponse<T>(response)
}

async function postJsonWithCapacitorHttp<T>(url: string, body: unknown, headers: HeadersInit) {
  const response = await CapacitorHttp.post({
    url,
    headers: headersToRecord(headers),
    data: body,
    responseType: 'json',
  }).catch((error) => {
    throw buildRequestFailureError(url, error)
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(buildHttpErrorMessage(url, response.status, readNativeErrorResponseMessage(response)))
  }

  return parseNativeJsonResponse<T>(response)
}

function headersToRecord(headers: HeadersInit) {
  const output: Record<string, string> = {}

  new Headers(headers).forEach((value, key) => {
    output[key] = value
  })

  return output
}

async function parseJsonResponse<T>(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

async function readErrorResponseMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({})) as {
      message?: string
    }

    return payload.message
  }

  const body = await response.text().catch(() => '')
  return body.trim() || undefined
}

function buildHttpErrorMessage(url: string, status: number, message?: string) {
  const statusMessage = `POST ${url} failed with status ${status}`
  return message ? `${statusMessage}: ${message}` : statusMessage
}

function parseNativeJsonResponse<T>(response: HttpResponse) {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  if (response.data === undefined || response.data === null || response.data === '') {
    return undefined as T
  }

  if (typeof response.data === 'string') {
    return (parseStringJson(response.data) ?? undefined) as T
  }

  return response.data as T
}

function readNativeErrorResponseMessage(response: HttpResponse) {
  if (isRecord(response.data)) {
    return readStringField(response.data, 'message')
  }

  if (typeof response.data !== 'string') {
    return undefined
  }

  const payload = parseStringJson(response.data)
  if (isRecord(payload)) {
    return readStringField(payload, 'message')
  }

  return response.data.trim() || undefined
}

function parseStringJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function readCodeField(value: Record<string, unknown>) {
  const code = value.code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function readErrorMessage(error: unknown) {
  const serialized = serializeErrorForLog(error)
  return isRecord(serialized) && typeof serialized.message === 'string'
    ? serialized.message
    : String(error)
}
