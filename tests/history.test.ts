import * as Assert from 'node:assert/strict'
import * as Zlib from 'node:zlib'
import { test as Test } from 'node:test'
import { HistoryManager, type IHistoryManagerGitHubClient } from '../sources/github.js'
import { CreateEchoServer } from './helpers/echo-server.js'

function CreateZipArchive(Entries: Record<string, string>): Buffer {
  const LocalFileParts: Buffer[] = []
  const CentralDirectoryParts: Buffer[] = []
  let CurrentOffset = 0

  for (const [EntryName, Content] of Object.entries(Entries)) {
    const FileNameBuffer = Buffer.from(EntryName)
    const PlainBuffer = Buffer.from(Content)
    const CompressedBuffer = Zlib.deflateRawSync(PlainBuffer)
    const LocalHeader = Buffer.alloc(30)
    const CentralDirectoryHeader = Buffer.alloc(46)

    LocalHeader.writeUInt32LE(0x04034b50, 0)
    LocalHeader.writeUInt16LE(20, 4)
    LocalHeader.writeUInt16LE(0, 6)
    LocalHeader.writeUInt16LE(8, 8)
    LocalHeader.writeUInt16LE(0, 10)
    LocalHeader.writeUInt16LE(0, 12)
    LocalHeader.writeUInt32LE(0, 14)
    LocalHeader.writeUInt32LE(CompressedBuffer.length, 18)
    LocalHeader.writeUInt32LE(PlainBuffer.length, 22)
    LocalHeader.writeUInt16LE(FileNameBuffer.length, 26)
    LocalHeader.writeUInt16LE(0, 28)

    CentralDirectoryHeader.writeUInt32LE(0x02014b50, 0)
    CentralDirectoryHeader.writeUInt16LE(20, 4)
    CentralDirectoryHeader.writeUInt16LE(20, 6)
    CentralDirectoryHeader.writeUInt16LE(0, 8)
    CentralDirectoryHeader.writeUInt16LE(8, 10)
    CentralDirectoryHeader.writeUInt16LE(0, 12)
    CentralDirectoryHeader.writeUInt16LE(0, 14)
    CentralDirectoryHeader.writeUInt32LE(0, 16)
    CentralDirectoryHeader.writeUInt32LE(CompressedBuffer.length, 20)
    CentralDirectoryHeader.writeUInt32LE(PlainBuffer.length, 24)
    CentralDirectoryHeader.writeUInt16LE(FileNameBuffer.length, 28)
    CentralDirectoryHeader.writeUInt16LE(0, 30)
    CentralDirectoryHeader.writeUInt16LE(0, 32)
    CentralDirectoryHeader.writeUInt16LE(0, 34)
    CentralDirectoryHeader.writeUInt16LE(0, 36)
    CentralDirectoryHeader.writeUInt32LE(0, 38)
    CentralDirectoryHeader.writeUInt32LE(CurrentOffset, 42)

    const LocalPart = Buffer.concat([LocalHeader, FileNameBuffer, CompressedBuffer])
    LocalFileParts.push(LocalPart)
    CentralDirectoryParts.push(Buffer.concat([CentralDirectoryHeader, FileNameBuffer]))
    CurrentOffset += LocalPart.length
  }

  const CentralDirectory = Buffer.concat(CentralDirectoryParts)
  const EndOfCentralDirectory = Buffer.alloc(22)
  const EntryCount = Object.keys(Entries).length

  EndOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  EndOfCentralDirectory.writeUInt16LE(0, 4)
  EndOfCentralDirectory.writeUInt16LE(0, 6)
  EndOfCentralDirectory.writeUInt16LE(EntryCount, 8)
  EndOfCentralDirectory.writeUInt16LE(EntryCount, 10)
  EndOfCentralDirectory.writeUInt32LE(CentralDirectory.length, 12)
  EndOfCentralDirectory.writeUInt32LE(CurrentOffset, 16)
  EndOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([...LocalFileParts, CentralDirectory, EndOfCentralDirectory])
}

Test('HistoryManager downloads and parses the latest local dist-tag artifact', async () => {
  const ArchiveBuffer = CreateZipArchive({
    'artifact/dist-tag.json': '{"latest":"2.0.0"}'
  })

  const Server = await CreateEchoServer((Request) => {
    if (Request.URL.pathname === '/artifacts/dist-tag.zip') {
      return {
        Headers: {
          'content-type': 'application/zip'
        },
        Body: ArchiveBuffer
      }
    }

    return {
      StatusCode: 404,
      Body: 'not found'
    }
  })

  const GitHubClient: IHistoryManagerGitHubClient = {
    actions: {
      listWorkflowRunsForRepo: async () => ({
        data: {
          workflow_runs: [
            {
              id: 1,
              status: 'completed',
              conclusion: 'success',
              updated_at: '2026-04-04T10:00:00Z'
            },
            {
              id: 2,
              status: 'completed',
              conclusion: 'success',
              updated_at: '2026-04-04T12:00:00Z'
            },
            {
              id: 3,
              status: 'completed',
              conclusion: 'failure',
              updated_at: '2026-04-04T13:00:00Z'
            }
          ]
        }
      }),
      listWorkflowRunArtifacts: async (Parameters) => ({
        data: {
          artifacts: Parameters.run_id === 2
            ? [{
              name: 'dist-tag',
              archive_download_url: Server.BaseURL + 'artifacts/dist-tag.zip'
            }]
            : []
        }
      })
    }
  }

  try {
    const History = await new HistoryManager(
      {
        Repo: 'owner/repo',
        GitHubToken: 'token',
        WorkflowRef: 'owner/repo/.github/workflows/eslint.yml@refs/heads/main'
      },
      {
        GitHubClient
      }
    ).RequestHistory()

    Assert.deepEqual(History, { latest: '2.0.0' })
    Assert.equal(Server.Requests[0]?.Headers.authorization, 'Bearer token')
  } finally {
    await Server.Close()
  }
})
