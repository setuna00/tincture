import http from 'node:http'

export const GOOD_KEY = 'sk-e2e-good'
export const MODELS = ['fake-model', 'fake-model-mini']

export async function startFakeAi() {
  const requests = []
  let next = { text: '{}', finish: 'stop' }
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : null
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? '', body })
    const json = (status, o) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) return json(401, { error: { message: 'Invalid API key', type: 'authentication_error' } })
    if (req.method === 'GET' && req.url === '/v1/models') return json(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) })
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(404, { error: { message: 'Not Found' } })
    const r = next
    if (r.status) return json(r.status, r.body)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    const n = r.chunks ?? 4
    const size = Math.ceil(r.text.length / n) || 1
    for (let i = 0; i < r.text.length; i += size) {
      if (res.destroyed) return
      send({ content: r.text.slice(i, i + size) })
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs))
    }
    if (res.destroyed) return
    send({}, r.finish ?? 'stop')
    res.end('data: [DONE]\n\n')
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${server.address().port}/v1`
  return {
    url,
    requests,
    reply: (r) => (next = r),
    close: () => new Promise((ok) => server.close(() => ok())),
  }
}
