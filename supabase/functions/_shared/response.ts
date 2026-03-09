import { corsHeaders } from './cors.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

export function success<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: jsonHeaders })
}

export function created<T>(data: T): Response {
  return success(data, 201)
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export function error(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: jsonHeaders })
}

export const errors = {
  badRequest: (msg = 'Bad request') => error('BAD_REQUEST', msg, 400),
  unauthorized: (msg = 'Unauthorized') => error('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Forbidden') => error('FORBIDDEN', msg, 403),
  notFound: (msg = 'Not found') => error('NOT_FOUND', msg, 404),
  internal: (msg = 'Internal error') => error('INTERNAL_ERROR', msg, 500),
}
