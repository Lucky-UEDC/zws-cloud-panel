import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES } from '@/lib/auth/session-cookies'
import { resolveSessionResult } from '@/lib/auth/session-store'
import { resolveGeoCurrencyFromHeaders } from '@/lib/geo-currency'
import { redactForLog } from '@/lib/log-redaction'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export function isMiddlewareBypassPath(path: string) {
  return (
    path.startsWith('/api/auth') ||
    path.startsWith('/api') ||
    path.startsWith('/_next') ||
    path.startsWith('/static') ||
    path.startsWith('/images') ||
    path.startsWith('/assets') ||
    path.startsWith('/fonts') ||
    path.startsWith('/public') ||
    path === '/favicon.ico' ||
    /\.(?:avif|bmp|css|eot|gif|ico|jpg|jpeg|js|json|map|mjs|otf|png|svg|ttf|txt|webmanifest|webp|woff|woff2)$/i.test(path)
  )
}

function firstHeaderValue(value: string | null) {
  return String(value || '').split(',')[0]?.trim() || ''
}

function isLocalHost(host: string) {
  return /^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/i.test(String(host || '').trim())
}

function configuredRedirectOrigin() {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  if (!configured) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
    if (isLocalHost(url.host) && process.env.NODE_ENV === 'production') return ''
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

function redirectUrl(request: NextRequest, path: string) {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const requestHost = firstHeaderValue(request.headers.get('host'))
  const host = [forwardedHost, requestHost].find((value) => value && !isLocalHost(value))
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  const proto = forwardedProto === 'http' && process.env.NODE_ENV !== 'production' ? 'http' : 'https'
  const origin = host ? `${proto}://${host}` : configuredRedirectOrigin()
  if (origin) return new URL(path, origin)
  const url = request.nextUrl.clone()
  const [pathname, search = ''] = path.split('?')
  url.pathname = pathname || '/'
  url.search = search ? `?${search}` : ''
  return url
}

function expiredLoginPath(request: NextRequest, scope: 'admin' | 'client' = 'client') {
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search || ''}`
  if (scope === 'admin') {
    const params = new URLSearchParams({ expired: '1' })
    if (returnTo && returnTo !== '/zwsloginsam') params.set('returnTo', returnTo)
    return `/zwsloginsam?${params.toString()}`
  }
  const params = new URLSearchParams({ expired: '1' })
  if (returnTo && returnTo !== '/login') params.set('returnTo', returnTo)
  return `/login?${params.toString()}`
}

function redirectExpired(request: NextRequest, path: string, scope: 'admin' | 'client' = 'client') {
  const targetPath = scope === 'client' && path.startsWith('/client-area') ? '/' : expiredLoginPath(request, scope)
  const response = NextResponse.redirect(redirectUrl(request, targetPath))
  return withRuntimeHeaders(response, path)
}

function isNoindexPath(path: string) {
  return (
    path.startsWith('/admin') ||
    path.startsWith('/support-agent') ||
    path.startsWith('/client-area') ||
    path.startsWith('/checkout') ||
    path.startsWith('/dedicated/checkout') ||
    path.startsWith('/payment') ||
    path.startsWith('/invoice') ||
    path.startsWith('/login') ||
    path.startsWith('/logout') ||
    path.startsWith('/register') ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/verify-email')
  )
}

function withNoindexHeader(response: NextResponse, path: string) {
  if (isNoindexPath(path)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

function withRuntimeHeaders(response: NextResponse, path: string) {
  if (
    path.startsWith('/admin') ||
    path.startsWith('/support-agent') ||
    path.startsWith('/client-area') ||
    path.startsWith('/checkout') ||
    path.startsWith('/dedicated/checkout') ||
    path.startsWith('/payment') ||
    path.startsWith('/invoice') ||
    path.startsWith('/login') ||
    path.startsWith('/register') ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/verify-email') ||
    path.startsWith('/verify-phone') ||
    path.startsWith('/api/')
  ) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
      response.headers.set(key, value)
    }
  }

  return withNoindexHeader(response, path)
}

function currencyContext(request: NextRequest) {
  const headers = new Headers(request.headers)
  if (!headers.get('cookie') && request.cookies.size) {
    headers.set('cookie', request.cookies.toString())
  }
  return resolveGeoCurrencyFromHeaders(headers)
}

function nextWithCurrency(request: NextRequest) {
  const context = currencyContext(request)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-zws-country', context.country)
  requestHeaders.set('x-zws-currency', context.currency)
  requestHeaders.set('x-zws-locale', context.locale)
  requestHeaders.set('x-zws-geo-source', context.source)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-zws-country', context.country)
  response.headers.set('x-zws-currency', context.currency)
  response.headers.set('x-zws-locale', context.locale)
  response.cookies.set('country', context.country, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  response.cookies.set('currency', context.currency, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  response.cookies.set('locale', context.locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  response.cookies.set('zws_currency_context', JSON.stringify(context), {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CURRENCY] resolve', {
      country: context.country,
      currency: context.currency,
      locale: context.locale,
      source: context.source,
      path: request.nextUrl.pathname,
    })
  }
  return response
}

function requestHeaderDebug(request: NextRequest) {
  return {
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    host: request.headers.get('host'),
    xForwardedHost: request.headers.get('x-forwarded-host'),
    xForwardedProto: request.headers.get('x-forwarded-proto'),
    pathname: request.nextUrl.pathname,
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (isMiddlewareBypassPath(path)) {
    return nextWithCurrency(request)
  }

  if (
    path.startsWith('/api/admin') ||
    path.startsWith('/api/support-agent') ||
    path.startsWith('/api/client')
  ) {
    return withRuntimeHeaders(nextWithCurrency(request), path)
  }

  if (path.startsWith('/admin/impersonate/')) {
    return withRuntimeHeaders(nextWithCurrency(request), path)
  }

  const adminToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.admin)?.value
  const clientToken = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.client)?.value
  const isStaff = Boolean(adminToken)
  const isClient = Boolean(clientToken)
  const isAdminOnlyRoute = path.startsWith('/admin')
  const isSupportOnlyRoute = path.startsWith('/support-agent')
  const isClientOnlyRoute = path.startsWith('/client-area')

  if (isAdminOnlyRoute) {
    const session = isStaff ? await resolveSessionResult(adminToken, 'admin') : { status: 'invalid' as const, reason: 'missing_token' as const }
    if (session.status === 'unavailable') {
      console.warn('[AUTH] proxy_auth_unavailable_admin_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return withRuntimeHeaders(nextWithCurrency(request), path)
    }
    if (session.status !== 'valid') {
      console.warn('[AUTH] proxy_rejected_admin_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return redirectExpired(request, path, 'admin')
    }
  }

  if (isSupportOnlyRoute) {
    const session = isStaff ? await resolveSessionResult(adminToken, 'admin') : { status: 'invalid' as const, reason: 'missing_token' as const }
    if (session.status === 'unavailable') {
      console.warn('[AUTH] proxy_auth_unavailable_support_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return withRuntimeHeaders(nextWithCurrency(request), path)
    }
    if (session.status !== 'valid') {
      console.warn('[AUTH] proxy_rejected_support_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return redirectExpired(request, path, 'admin')
    }
  }

  if (isClientOnlyRoute) {
    const session = isClient ? await resolveSessionResult(clientToken, 'client') : { status: 'invalid' as const, reason: 'missing_token' as const }
    if (session.status === 'unavailable') {
      console.warn('[AUTH] proxy_auth_unavailable_client_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return withRuntimeHeaders(nextWithCurrency(request), path)
    }
    if (session.status !== 'valid') {
      console.warn('[AUTH] proxy_rejected_client_page', redactForLog({ ...requestHeaderDebug(request), reason: session.reason }))
      return redirectExpired(request, path, 'client')
    }
  }

  return withRuntimeHeaders(nextWithCurrency(request), path)
}

export const config = {
  matcher: [
    '/((?!api|_next|static|favicon.ico|images|assets|fonts|public).*)',
  ],
}
