import * as Assert from 'node:assert/strict'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { test as Test } from 'node:test'
import * as Tar from 'tar'
import { FileManager } from '../sources/file.js'
import { RequestNpmPackageMetaData } from '../sources/npm-api.js'
import { CreateEchoServer } from './helpers/echo-server.js'

async function CreateTemporaryDirectory(): Promise<string> {
  return Fs.mkdtemp(Path.join(Os.tmpdir(), 'jsdelivr-purge-npm-'))
}

async function CreatePackageTarball(
  ParentDirectory: string,
  Files: Record<string, string>,
  FileName: string
): Promise<Buffer> {
  const SourceDirectory = await CreateTemporaryDirectory()
  const PackageDirectory = Path.join(SourceDirectory, 'package')
  const TarballPath = Path.join(ParentDirectory, FileName)

  await Fs.mkdir(PackageDirectory, { recursive: true })

  for (const [RelativePath, Content] of Object.entries(Files)) {
    const TargetPath = Path.join(PackageDirectory, RelativePath)
    await Fs.mkdir(Path.dirname(TargetPath), { recursive: true })
    await Fs.writeFile(TargetPath, Content)
  }

  await Tar.create({ cwd: SourceDirectory, gzip: true, file: TarballPath }, ['package'])
  const TarballBuffer = await Fs.readFile(TarballPath)
  await Fs.rm(SourceDirectory, { recursive: true, force: true })
  return TarballBuffer
}

Test('RequestNpmPackageMetaData and FileManager use only local registry fixtures', async () => {
  const TempDirectory = await CreateTemporaryDirectory()

  try {
    const CurrentTarball = await CreatePackageTarball(
      TempDirectory,
      {
        'package.json': '{"name":"@scope/pkg"}',
        'dist/index.js': 'export const Current = true\n'
      },
      'pkg-2.0.0.tgz'
    )

    const OlderTarball = await CreatePackageTarball(
      TempDirectory,
      {
        'README.md': 'older readme\n',
        'dist/index.js': 'export const Older = true\n'
      },
      'pkg-1.0.0.tgz'
    )

    const Server = await CreateEchoServer((Request) => {
      const DecodedPathname = decodeURIComponent(Request.URL.pathname)

      if (DecodedPathname === '/registry/@scope/pkg') {
        return {
          Body: {
            name: '@scope/pkg',
            'dist-tags': {
              latest: '2.0.0'
            },
            versions: {
              '1.0.0': {
                name: '@scope/pkg',
                version: '1.0.0',
                dist: {
                  shasum: 'one',
                  tarball: 'http://example.test/pkg-1.0.0.tgz',
                  integrity: 'sha512-one'
                }
              },
              '2.0.0': {
                name: '@scope/pkg',
                version: '2.0.0',
                dist: {
                  shasum: 'two',
                  tarball: 'http://example.test/pkg-2.0.0.tgz',
                  integrity: 'sha512-two'
                }
              }
            },
            time: {
              created: '2026-04-04T00:00:00Z',
              modified: '2026-04-04T00:00:00Z',
              '1.0.0': '2026-04-03T00:00:00Z',
              '2.0.0': '2026-04-04T00:00:00Z'
            }
          }
        }
      }

      if (DecodedPathname === '/registry/@scope/pkg/-/pkg-2.0.0.tgz') {
        return {
          Headers: {
            'content-type': 'application/octet-stream'
          },
          Body: CurrentTarball
        }
      }

      if (DecodedPathname === '/registry/@scope/pkg/-/pkg-1.0.0.tgz') {
        return {
          Headers: {
            'content-type': 'application/octet-stream'
          },
          Body: OlderTarball
        }
      }

      return {
        StatusCode: 404,
        Body: 'not found'
      }
    })

    try {
      const Metadata = await RequestNpmPackageMetaData('@scope/pkg', {
        RegistryBaseURL: Server.BaseURL + 'registry/'
      })

      Assert.equal(Metadata['dist-tags'].latest, '2.0.0')
      Assert.equal(
        decodeURIComponent(Server.Requests[0]?.URL.pathname.replace('/registry/', '') ?? ''),
        '@scope/pkg'
      )

      const Files = await new FileManager(
        '@scope/pkg',
        { A: '2.0.0', B: '1.0.0' },
        Path.join(TempDirectory, 'workspace'),
        {
          RegistryBaseURL: Server.BaseURL + 'registry/'
        }
      ).Union()

      Assert.deepEqual(Files.toSorted(), ['README.md', 'dist/index.js', 'package.json'].toSorted())
    } finally {
      await Server.Close()
    }
  } finally {
    await Fs.rm(TempDirectory, { recursive: true, force: true })
  }
})
