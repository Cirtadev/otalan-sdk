import { afterAll, beforeEach } from 'bun:test'

import {
  resetCapacitorTestHarness,
  restoreCapacitorTestHarness,
} from './helpers/capacitor-test-harness'

beforeEach(resetCapacitorTestHarness)
afterAll(restoreCapacitorTestHarness)

await import('./suites/metadata-checks')
await import('./suites/initialize-device')
await import('./suites/initialized-check')
await import('./suites/ready-confirmation')
await import('./suites/sync-transfer-source')
await import('./suites/download-progress')
