export function isTestModeEnabled() {
  return process.env.NODE_ENV === 'test'
}
