import * as GitHub from '@octokit/rest'
import * as Zod from 'zod'
import { Temporal } from 'temporal-kit/polyfilled'
import { RequestBuffer } from './http.js'
import { ReadTextFromZipArchive } from './zip.js'

const WorkflowRunsSchema = Zod.strictObject({
  workflow_runs: Zod.array(Zod.strictObject({
    id: Zod.number(),
    status: Zod.string().nullable(),
    conclusion: Zod.string().nullable(),
    updated_at: Zod.string()
  }))
})

const WorkflowArtifactsSchema = Zod.strictObject({
  artifacts: Zod.array(Zod.strictObject({
    name: Zod.string(),
    archive_download_url: Zod.string()
  }))
})

const HistoryDataSchema = Zod.record(Zod.string(), Zod.string())

type IWorkflowRun = Zod.infer<typeof WorkflowRunsSchema>['workflow_runs'][number]

export type IHistoryManagerDataJSON = Record<string, string>

export interface IHistoryManagerGitHubClient {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  actions: {
    listWorkflowRunsForRepo(Parameters: Record<string, string>): Promise<Record<string, unknown>>
    listWorkflowRunArtifacts(Parameters: Record<string, string | number>): Promise<Record<string, unknown>>
  }
}

export class HistoryManager {
  private readonly GitHubInstance: IHistoryManagerGitHubClient

  constructor(
    private readonly Config: { Repo: string, GitHubToken: string, WorkflowRef: string },
    Dependencies: { GitHubClient?: IHistoryManagerGitHubClient } = {}
  ) {
    this.GitHubInstance = Dependencies.GitHubClient ?? new GitHub.Octokit({
      auth: this.Config.GitHubToken
    }) as unknown as IHistoryManagerGitHubClient
  }

  private GetRepoCoordinate(): { Owner: string, Repo: string } {
    const [Owner, Repo] = this.Config.Repo.split('/')

    if (typeof Owner !== 'string' || typeof Repo !== 'string') {
      throw new Error('Invalid repository coordinate: ' + this.Config.Repo)
    }

    return { Owner, Repo }
  }

  private GetWorkflowID(): string | null {
    if (this.Config.WorkflowRef.length === 0) {
      return null
    }

    const WorkflowPath = this.Config.WorkflowRef.split('@')[0] ?? this.Config.WorkflowRef
    return WorkflowPath.split('/').at(-1) ?? null
  }

  private SortWorkflowRunsByUpdatedAt(Runs: IWorkflowRun[]): IWorkflowRun[] {
    return Runs.toSorted((RunA, RunB) => Temporal.Instant.compare(
      Temporal.Instant.from(RunB.updated_at),
      Temporal.Instant.from(RunA.updated_at)
    ))
  }

  private async GetLatestSuccessfulWorkflowRunID(): Promise<number | null> {
    const WorkflowID = this.GetWorkflowID()

    if (WorkflowID === null) {
      return null
    }

    const { Owner, Repo } = this.GetRepoCoordinate()
    const GHResponseRuns = await this.GitHubInstance.actions.listWorkflowRunsForRepo({
      owner: Owner,
      repo: Repo,
      workflow_id: WorkflowID
    })

    const WorkflowRuns = WorkflowRunsSchema.parse(GHResponseRuns.data).workflow_runs
      .filter((Run) => Run.status === 'completed' && Run.conclusion === 'success')

    return this.SortWorkflowRunsByUpdatedAt(WorkflowRuns)[0]?.id ?? null
  }

  private async GetLatestHistoryArtifactURL(): Promise<string | null> {
    const RunID = await this.GetLatestSuccessfulWorkflowRunID()

    if (RunID === null) {
      return null
    }

    const { Owner, Repo } = this.GetRepoCoordinate()
    const GHResponseArtifacts = await this.GitHubInstance.actions.listWorkflowRunArtifacts({
      owner: Owner,
      repo: Repo,
      run_id: RunID
    })

    const Artifacts = WorkflowArtifactsSchema.parse(GHResponseArtifacts.data).artifacts
    return Artifacts.find((Artifact) => Artifact.name === 'dist-tag')?.archive_download_url ?? null
  }

  async RequestHistory(): Promise<IHistoryManagerDataJSON | null> {
    if (this.Config.GitHubToken.length === 0) {
      return null
    }

    const HistoryURLString = await this.GetLatestHistoryArtifactURL()

    if (HistoryURLString === null) {
      return null
    }

    const HistoryArchiveBuffer = await RequestBuffer(new URL(HistoryURLString), {
      FollowRedirects: true,
      HttpHeaders: {
        authorization: 'Bearer ' + this.Config.GitHubToken
      }
    })

    const HistoryJSON = ReadTextFromZipArchive(
      HistoryArchiveBuffer,
      (EntryName) => EntryName.endsWith('dist-tag.json')
    )

    return HistoryDataSchema.parse(JSON.parse(HistoryJSON))
  }
}
