import * as Http from 'node:http'
import * as StreamConsumers from 'node:stream/consumers'

export type IRecordedRequest = {
  Method: string
  URL: URL
  Headers: Http.IncomingHttpHeaders
  Body: Buffer
}

export type ITestServerResponse = {
  StatusCode?: number
  Headers?: Record<string, string>
  Body?: Buffer | string | object
}

function NormalizeResponseBody(Body: ITestServerResponse['Body']): Buffer {
  if (typeof Body === 'undefined') {
    return Buffer.alloc(0)
  }

  if (Buffer.isBuffer(Body)) {
    return Body
  }

  if (typeof Body === 'string') {
    return Buffer.from(Body)
  }

  return Buffer.from(JSON.stringify(Body))
}

export async function CreateEchoServer(
  Handler: (Request: IRecordedRequest) => Promise<ITestServerResponse> | ITestServerResponse
): Promise<{
  BaseURL: string
  Requests: IRecordedRequest[]
  Close: () => Promise<void>
}> {
  const Requests: IRecordedRequest[] = []
  const Server = Http.createServer(async (IncomingMessage, ServerResponse) => {
    const BodyArrayBuffer = await StreamConsumers.arrayBuffer(IncomingMessage)
    const Request = {
      Method: IncomingMessage.method ?? 'GET',
      URL: new URL(
        IncomingMessage.url ?? '/',
        'http://' + (IncomingMessage.headers.host ?? '127.0.0.1')
      ),
      Headers: IncomingMessage.headers,
      Body: Buffer.from(BodyArrayBuffer)
    }

    Requests.push(Request)

    const Response = await Handler(Request)
    const Headers = { ...(Response.Headers ?? {}) }

    if (
      typeof Response.Body === 'object' &&
      Response.Body !== null &&
      Buffer.isBuffer(Response.Body) === false &&
      typeof Headers['content-type'] === 'undefined'
    ) {
      Headers['content-type'] = 'application/json'
    }

    ServerResponse.writeHead(Response.StatusCode ?? 200, Headers)
    ServerResponse.end(NormalizeResponseBody(Response.Body))
  })

  await new Promise<void>((Resolve) => {
    Server.listen(0, '127.0.0.1', () => {
      Resolve()
    })
  })

  const Address = Server.address()

  if (Address === null || typeof Address === 'string') {
    throw new Error('Failed to start local echo server')
  }

  return {
    BaseURL: 'http://127.0.0.1:' + Address.port + '/',
    Requests,
    Close: async () => {
      await new Promise<void>((Resolve) => {
        Server.close(() => {
          Resolve()
        })
      })
    }
  }
}
