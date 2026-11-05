import axios from 'axios';
import { ApiError } from './ApiError.js';

const DEFAULT_MESSAGES = {
  network: 'We could not reach the server. Please check your connection and try again.',
  timeout: 'The server took too long to answer. Please try again.',
  http: 'Something went wrong. Please try again.',
};

// Builds a preconfigured axios instance. App-agnostic: knows nothing about specific endpoints.
//
//   const http = createHttpClient({ baseURL: '/api' });
//   const data = await http.get('/things');          // resolves to the response body
//   await http.post('/things', body, { signal });    // any axios request config works
//
// Differences from plain axios:
//  - get/post/put/patch/delete resolve to `response.data`, not the full response
//    (use `http.axios` for the raw instance when you need headers or status)
//  - every failure rejects with ApiError (see ApiError.js); cancellations are passed through
//    unchanged so callers can ignore them with `axios.isCancel`
//
// Options: baseURL, timeout (ms), headers, messages (override the default error texts),
// getErrorMessage(data) and getFieldErrors(data) to read your server's error body shape.
export function createHttpClient({
  baseURL,
  timeout = 15_000,
  headers,
  messages,
  getErrorMessage = (data) => data?.message,
  getFieldErrors = (data) => data?.fields,
} = {}) {
  const text = { ...DEFAULT_MESSAGES, ...messages };
  const instance = axios.create({ baseURL, timeout, headers: { Accept: 'application/json', ...headers } });

  instance.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(axios.isCancel(error) ? error : toApiError(error, text, getErrorMessage, getFieldErrors)),
  );

  const unwrap = (promise) => promise.then((res) => res.data);

  return {
    get: (url, config) => unwrap(instance.get(url, config)),
    delete: (url, config) => unwrap(instance.delete(url, config)),
    post: (url, body, config) => unwrap(instance.post(url, body, config)),
    put: (url, body, config) => unwrap(instance.put(url, body, config)),
    patch: (url, body, config) => unwrap(instance.patch(url, body, config)),
    axios: instance,
  };
}

function toApiError(error, text, getErrorMessage, getFieldErrors) {
  const { response } = error;
  if (!response) {
    const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    const code = timedOut ? 'timeout' : 'network';
    return new ApiError(text[code], { code, cause: error });
  }
  const data = response.data && typeof response.data === 'object' ? response.data : undefined;
  return new ApiError(getErrorMessage(data) || text.http, {
    status: response.status,
    fields: getFieldErrors(data),
    code: 'http',
    cause: error,
  });
}
