function ok(body, headers = {}) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=gbk', ...headers },
    body,
  }
}

function badRequest(msg) {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: msg,
  }
}

function upstreamError(msg) {
  return {
    statusCode: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: msg,
  }
}

module.exports = { ok, badRequest, upstreamError }
