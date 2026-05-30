import test from 'node:test'
import assert from 'node:assert/strict'
import * as Fs from 'node:fs'
import * as Http from 'node:http'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Tar from 'tar'
import { FileManager } from '../sources/file.js'
import { BuildNpmRegistryRequestOptions } from '../sources/npm-api.js'
import { PurgeRequestManager } from '../sources/requests.js'

type MockServerType = {
  BaseURL: URL
  Close: () => Promise<void>
}

async function CreateMockServer(Handler: Http.RequestListener): Promise<MockServerType> {
  const Server = Http.createServer(Handler)
  await new Promise<void>(Resolve => {
    Server.listen(0, '127.0.0.1', Resolve)
  })
  const Address = Server.address()

  if (typeof Address === 'string' || Address === null) {
    throw new Error('Unable to bind mock server')
  }

  return {
    BaseURL: new URL(`http://127.0.0.1:${Address.port}/`),
    Close: async () => new Promise<void>((Resolve, Reject) => {
      Server.close(ErrorValue => {
        if (ErrorValue) {
          Reject(ErrorValue)
          return
        }
        Resolve()
      })
    })
  }
}

async function CreateTarball(Entries: Record<string, string>): Promise<Buffer> {
  const TempPath = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jsdelivr-purge-npm-test-'))
  const TarballPath = Path.join(TempPath, 'package.tgz')

  for (const [EntryPath, EntryContent] of Object.entries(Entries)) {
    const TargetPath = Path.join(TempPath, EntryPath)
    Fs.mkdirSync(Path.dirname(TargetPath), { recursive: true })
    Fs.writeFileSync(TargetPath, EntryContent)
  }

  await Tar.create({ gzip: true, cwd: TempPath, file: TarballPath }, Object.keys(Entries).map(EntryPath => EntryPath.split('/')[0]).filter((EntryPath, Index, EntryPaths) => EntryPaths.indexOf(EntryPath) === Index))
  return Fs.readFileSync(TarballPath)
}

test('FileManager downloads npm tarball metadata through the mock registry and lists package files', async () => {
  const Tarball = await CreateTarball({ 'package/index.js': 'export default true\n' })
  const MockServer = await CreateMockServer((Request, Response) => {
    if (Request.url === '/mock-package') {
      Response.setHeader('content-type', 'application/json')
      Response.end(JSON.stringify({
        name: 'mock-package',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'mock-package',
            version: '1.0.0',
            dist: {
              shasum: 'unused',
              tarball: new URL('/mock-package/-/mock-package-1.0.0.tgz', MockServer.BaseURL).href,
              integrity: 'unused'
            }
          }
        },
        time: {}
      }))
      return
    }

    if (Request.url === '/mock-package/-/mock-package-1.0.0.tgz') {
      Response.setHeader('content-type', 'application/octet-stream')
      Response.end(Tarball)
      return
    }

    Response.statusCode = 404
    Response.end()
  })
  const OldRegistryURL = process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL
  process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = MockServer.BaseURL.href

  try {
    const Files = await new FileManager('mock-package', { A: '1.0.0' }).Union()
    assert.deepEqual(Files, ['index.js'])
  } finally {
    process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = OldRegistryURL
    await MockServer.Close()
  }
})

test('FileManager rejects package metadata that points to a different tarball origin', async () => {
  const MockServer = await CreateMockServer((Request, Response) => {
    if (Request.url === '/mock-package') {
      Response.setHeader('content-type', 'application/json')
      Response.end(JSON.stringify({
        name: 'mock-package',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'mock-package',
            version: '1.0.0',
            dist: {
              shasum: 'unused',
              tarball: 'https://example.com/mock-package.tgz',
              integrity: 'unused'
            }
          }
        },
        time: {}
      }))
      return
    }

    Response.statusCode = 404
    Response.end()
  })
  const OldRegistryURL = process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL
  process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = MockServer.BaseURL.href

  try {
    await assert.rejects(new FileManager('mock-package', { A: '1.0.0' }).Union(), /Unexpected npm tarball origin/u)
  } finally {
    process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = OldRegistryURL
    await MockServer.Close()
  }
})

test('FileManager rejects archive entries outside the package directory', async () => {
  const Tarball = await CreateTarball({ 'not-package/index.js': 'bad\n' })
  const MockServer = await CreateMockServer((Request, Response) => {
    if (Request.url === '/mock-package') {
      Response.setHeader('content-type', 'application/json')
      Response.end(JSON.stringify({
        name: 'mock-package',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'mock-package',
            version: '1.0.0',
            dist: {
              shasum: 'unused',
              tarball: new URL('/mock-package/-/mock-package-1.0.0.tgz', MockServer.BaseURL).href,
              integrity: 'unused'
            }
          }
        },
        time: {}
      }))
      return
    }

    if (Request.url === '/mock-package/-/mock-package-1.0.0.tgz') {
      Response.end(Tarball)
      return
    }

    Response.statusCode = 404
    Response.end()
  })
  const OldRegistryURL = process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL
  process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = MockServer.BaseURL.href

  try {
    await assert.rejects(new FileManager('mock-package', { A: '1.0.0' }).Union(), /Archive path is outside package/u)
  } finally {
    process.env.JSDELIVR_PURGE_NPM_REGISTRY_URL = OldRegistryURL
    await MockServer.Close()
  }
})

test('PurgeRequestManager posts purge payloads to the mock jsDelivr API and waits for status', async () => {
  const PostedBodies: string[] = []
  const MockServer = await CreateMockServer((Request, Response) => {
    if (Request.method === 'POST' && Request.url === '/') {
      Request.setEncoding('utf8')
      let Body = ''
      Request.on('data', Chunk => {
        Body += Chunk
      })
      Request.on('end', () => {
        PostedBodies.push(Body)
        Response.setHeader('content-type', 'application/json')
        Response.end(JSON.stringify({ id: 'request-1', status: 'pending', timestamp: new Date(0).toISOString() }))
      })
      return
    }

    if (Request.method === 'GET' && Request.url === '/status/request-1') {
      Response.setHeader('content-type', 'application/json')
      Response.end(JSON.stringify({
        id: 'request-1',
        status: 'finished',
        paths: {
          '/npm/mock-package@latest/index.js': {
            throttled: false,
            providers: { CF: true, FY: true }
          }
        }
      }))
      return
    }

    Response.statusCode = 404
    Response.end()
  })
  const OldPurgeURL = process.env.JSDELIVR_PURGE_NPM_PURGE_URL
  const OldPollInterval = process.env.JSDELIVR_PURGE_NPM_POLL_INTERVAL_MS
  process.env.JSDELIVR_PURGE_NPM_PURGE_URL = MockServer.BaseURL.href
  process.env.JSDELIVR_PURGE_NPM_POLL_INTERVAL_MS = '1'

  try {
    const Manager = new PurgeRequestManager('mock-package')
    Manager.AddURLs(['index.js'], 'latest')
    await Manager.Start()

    assert.equal(PostedBodies.length, 1)
    assert.deepEqual(JSON.parse(PostedBodies[0]), {
      path: ['/npm/mock-package@latest/index.js']
    })
  } finally {
    process.env.JSDELIVR_PURGE_NPM_PURGE_URL = OldPurgeURL
    process.env.JSDELIVR_PURGE_NPM_POLL_INTERVAL_MS = OldPollInterval
    await MockServer.Close()
  }
})

test('BuildNpmRegistryRequestOptions pins registry TLS to TLS 1.2 with X25519 compatible curves and ECDSA ciphers', () => {
  const RequestOptions = BuildNpmRegistryRequestOptions(new URL('https://registry.npmjs.org/typescript'))

  assert.deepEqual(RequestOptions.TLS, {
    IsHTTPSEnforced: true,
    MinTLSVersion: 'TLSv1.2',
    MaxTLSVersion: 'TLSv1.2',
    KeyExchanges: ['X25519', 'P-256'],
    Ciphers: [
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-CHACHA20-POLY1305'
    ]
  })
})
