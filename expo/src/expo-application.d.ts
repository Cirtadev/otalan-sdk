declare module 'expo-application' {
  export function getAndroidId(): string | null
  export function getIosIdForVendorAsync(): Promise<string | null>
}
