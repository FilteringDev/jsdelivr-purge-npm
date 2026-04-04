import * as Actions from '@actions/core'
import * as ESToolkit from 'es-toolkit'
import * as Os from 'node:os'
import * as Zod from 'zod'
import { RequestJSON } from './http.js'

const CDNStatusResponseSchema = Zod.strictObject({
  id: Zod.string(),
  status: Zod.enum(['pending', 'finished', 'failed']),
  paths: Zod.record(Zod.string(), Zod.strictObject({
    throttled: Zod.boolean(),
    providers: Zod.strictObject({
      CF: Zod.boolean(),
      FY: Zod.boolean()
    })
  }))
})

const CDNPostResponseSchema = Zod.strictObject({
  id: Zod.string(),
  status: Zod.enum(['pending', 'finished', 'failed']),
  timestamp: Zod.string()
})

type CDNStatusResponseType = Zod.infer<typeof CDNStatusResponseSchema>
type CDNPostResponseType = Zod.infer<typeof CDNPostResponseSchema>

type RemainingFilenamesArrayType = {
  Filename: string
  Tag: string
}

export type IPurgeRequestManagerOptions = {
  BaseURL?: string
  PollIntervalMs?: number
  Concurrency?: number
}

function EnsureTrailingSlash(Value: string): string {
  return Value.endsWith('/') ? Value : Value + '/'
}

function CreateBaseURL(BaseURL = 'https://purge.jsdelivr.net/'): URL {
  return new URL(EnsureTrailingSlash(BaseURL))
}

export function CreatePurgePaths(Repo: string, Tag: string[], Filenames: string[]): string[] {
  return Filenames.map((Filename, Index) => '/npm/' + Repo + '@' + Tag[Index] + '/' + Filename)
}

async function Sleep(DurationMs: number): Promise<void> {
  await new Promise((Resolve) => {
    setTimeout(Resolve, DurationMs)
  })
}

async function RunWithConcurrency<T>(
  Items: T[],
  Concurrency: number,
  Handler: (Item: T) => Promise<void>
): Promise<void> {
  let CurrentIndex = 0
  const WorkerCount = Math.min(Math.max(1, Concurrency), Items.length)

  await Promise.all(Array.from({ length: WorkerCount }, async () => {
    while (CurrentIndex < Items.length) {
      const Item = Items[CurrentIndex]
      CurrentIndex += 1

      if (typeof Item === 'undefined') {
        continue
      }

      await Handler(Item)
    }
  }))
}

async function GetCDNResponse(ID: string, BaseURL: URL): Promise<CDNStatusResponseType> {
  const ResponseParsed = await RequestJSON(
    new URL('status/' + ID, BaseURL),
    CDNStatusResponseSchema
  )

  for (const [Key, Value] of Object.entries(ResponseParsed.paths)) {
    if (Value.throttled) {
      Actions.warning('Throttled: ' + Key)
    }
  }

  Actions.startGroup('GetCDNResponse called: ' + ID)
  Actions.info(JSON.stringify(ResponseParsed))
  Actions.endGroup()
  return ResponseParsed
}

async function PostPurgeRequest(
  Repo: string,
  Tag: string[],
  Filenames: string[],
  BaseURL: URL
): Promise<CDNPostResponseType> {
  const ResponseParsed = await RequestJSON(
    new URL('/', BaseURL),
    CDNPostResponseSchema,
    {
      HttpMethod: 'POST',
      Payload: JSON.stringify({
        path: CreatePurgePaths(Repo, Tag, Filenames)
      }),
      HttpHeaders: {
        'cache-control': 'no-cache',
        'content-type': 'application/json'
      }
    }
  )

  Actions.startGroup('PostPurgeRequest called: ' + ResponseParsed.id)
  Actions.info(JSON.stringify(ResponseParsed))
  Actions.endGroup()
  return ResponseParsed
}

async function WaitForPurgeCompletion(
  ID: string,
  BaseURL: URL,
  PollIntervalMs: number
): Promise<CDNStatusResponseType> {
  while (true) {
    const Response = await GetCDNResponse(ID, BaseURL)

    if (Response.status !== 'pending') {
      return Response
    }

    await Sleep(PollIntervalMs)
  }
}

export class PurgeRequestManager {
  private readonly BaseURL: URL
  private readonly PollIntervalMs: number
  private readonly Concurrency: number
  private readonly PendingGroups: RemainingFilenamesArrayType[][] = []
  private readonly RemainingFilenames: RemainingFilenamesArrayType[] = []

  constructor(
    private readonly Repo: string,
    Options: IPurgeRequestManagerOptions = {}
  ) {
    this.BaseURL = CreateBaseURL(Options.BaseURL)
    this.PollIntervalMs = Options.PollIntervalMs ?? 2500
    this.Concurrency = Options.Concurrency ?? Os.availableParallelism()
  }

  AddURLs(Filenames: string[], Tag: string): void {
    const SplitFilenames = ESToolkit.chunk(
      Filenames.map((Filename) => ({ Filename, Tag })),
      20
    )

    const LastChunk = SplitFilenames.at(-1)

    if (LastChunk && LastChunk.length < 20) {
      this.RemainingFilenames.push(...LastChunk)
      SplitFilenames.pop()
    }

    this.PendingGroups.push(...SplitFilenames)
  }

  private DrainGroups(): RemainingFilenamesArrayType[][] {
    const Groups = [
      ...this.PendingGroups,
      ...ESToolkit.chunk(this.RemainingFilenames, 20)
    ].filter((Group) => Group.length > 0)

    this.PendingGroups.length = 0
    this.RemainingFilenames.length = 0
    return Groups
  }

  private async ProcessGroup(Group: RemainingFilenamesArrayType[]): Promise<void> {
    const Tags = Group.map((Filename) => Filename.Tag)
    const Filenames = Group.map((Filename) => Filename.Filename)
    const RequestResponse = await PostPurgeRequest(this.Repo, Tags, Filenames, this.BaseURL)
    const StatusResponse = await WaitForPurgeCompletion(
      RequestResponse.id,
      this.BaseURL,
      this.PollIntervalMs
    )

    if (StatusResponse.status !== 'finished') {
      throw new Error('Purge request failed: ' + RequestResponse.id)
    }

    Actions.info(
      'Queue: jsDelivr server returns that the following files are purged:\n' +
      Group.map((Filename) => '- @' + Filename.Tag + '/' + Filename.Filename).join('\n')
    )
  }

  async Start(): Promise<void> {
    const AllGroups = this.DrainGroups()

    if (AllGroups.length === 0) {
      return
    }

    await RunWithConcurrency(AllGroups, this.Concurrency, async (Group) => {
      await this.ProcessGroup(Group)
    })
  }
}
