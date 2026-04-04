import * as Assert from 'node:assert/strict'
import { test as Test } from 'node:test'
import { PurgeRequestManager } from '../sources/requests.js'
import { CreateEchoServer } from './helpers/echo-server.js'

Test('PurgeRequestManager batches requests and polls the local status server', async () => {
  const PostedPaths = new Map<string, string[]>()
  const PollCountByID = new Map<string, number>()
  let NextID = 1

  const Server = await CreateEchoServer((Request) => {
    if (Request.Method === 'POST' && Request.URL.pathname === '/') {
      const Payload = JSON.parse(Request.Body.toString()) as Record<string, string[]>
      const ID = 'request-' + NextID
      NextID += 1
      PostedPaths.set(ID, Payload.path ?? [])
      PollCountByID.set(ID, 0)

      return {
        Body: {
          id: ID,
          status: 'pending',
          timestamp: '2026-04-04T00:00:00Z'
        }
      }
    }

    if (Request.Method === 'GET' && Request.URL.pathname.startsWith('/status/')) {
      const ID = Request.URL.pathname.split('/').at(-1) ?? ''
      const Count = (PollCountByID.get(ID) ?? 0) + 1
      const Paths = PostedPaths.get(ID) ?? []

      PollCountByID.set(ID, Count)

      return {
        Body: {
          id: ID,
          status: Count >= 2 ? 'finished' : 'pending',
          paths: Object.fromEntries(Paths.map((Pathname) => [Pathname, {
            throttled: false,
            providers: {
              CF: true,
              FY: true
            }
          }]))
        }
      }
    }

    return {
      StatusCode: 404,
      Body: 'not found'
    }
  })

  try {
    const Files = Array.from({ length: 21 }, (UnusedValue, Index) => 'dist/file-' + String(Index + 1) + '.js')
    const Manager = new PurgeRequestManager('@scope/pkg', {
      BaseURL: Server.BaseURL,
      PollIntervalMs: 10,
      Concurrency: 1
    })

    Manager.AddURLs(Files, 'latest')
    await Manager.Start()

    const PostRequests = Server.Requests.filter((Request) => Request.Method === 'POST')
    const FirstPayload = JSON.parse(PostRequests[0]?.Body.toString() ?? '{}') as Record<string, string[]>
    const SecondPayload = JSON.parse(PostRequests[1]?.Body.toString() ?? '{}') as Record<string, string[]>

    Assert.equal(PostRequests.length, 2)
    Assert.equal((FirstPayload.path ?? []).length, 20)
    Assert.equal((SecondPayload.path ?? []).length, 1)
    Assert.equal(FirstPayload.path?.[0], '/npm/@scope/pkg@latest/dist/file-1.js')
    Assert.equal(SecondPayload.path?.[0], '/npm/@scope/pkg@latest/dist/file-21.js')
  } finally {
    await Server.Close()
  }
})
