import * as GitHub from '@octokit/rest'
import * as Luxon from 'luxon'
import * as Unzipper from 'unzipper'
import { RequestArrayBuffer } from './http.js'

export type IHistoryManagerDataJSON = Record<string, string>

export class HistoryManager {
  private GitHubInstance!: InstanceType<typeof GitHub.Octokit>

  constructor(private readonly Config: { Repo: string, GitHubToken: string, WorkflowRef: string }) {
    this.GitHubInstance = new GitHub.Octokit({ auth: this.Config.GitHubToken })
  }

  private async ListHistory() {
    const [Owner, Repo] = this.Config.Repo.split('/')
    const GHResponseRuns = await this.GitHubInstance.actions.listWorkflowRunsForRepo({
      owner: Owner,
      repo: Repo,
      workflow_id: this.Config.WorkflowRef
    })
    const LatestSuccessfulRun = GHResponseRuns.data.workflow_runs.filter(Run => Run.status === 'completed' && Run.conclusion === 'success')
      .sort((RunA, RunB) => Luxon.DateTime.fromISO(RunB.updated_at).toMillis() - Luxon.DateTime.fromISO(RunA.updated_at).toMillis())[0]

    if (typeof LatestSuccessfulRun === 'undefined') {
      return []
    }

    const GHResponseArtifacts = await this.GitHubInstance.actions.listWorkflowRunArtifacts({
      owner: Owner,
      repo: Repo,
      run_id: LatestSuccessfulRun.id
    })
    return GHResponseArtifacts.data.artifacts.map((Artifact) => Artifact.archive_download_url)
  }

  private async CheckWorkflowRunExist() {
    const [Owner, Repo] = this.Config.Repo.split('/')
    const GHResponseRuns = await this.GitHubInstance.actions.listWorkflowRunsForRepo({
      owner: Owner,
      repo: Repo,
      workflow_id: this.Config.WorkflowRef,
      status: 'completed',
      conclusion: 'success'
    })
    return GHResponseRuns.data.total_count > 0
  }

  async RequestHistory() {
    if (!await this.CheckWorkflowRunExist()) {
      return null
    }
    const HistoryURL = (await this.ListHistory())[0]
    if (typeof HistoryURL === 'undefined') {
      return null
    }
    const HistoryCompressedBuffer = Buffer.from(await RequestArrayBuffer(new URL(HistoryURL), {
      Headers: {
        authorization: `Bearer ${this.Config.GitHubToken}`,
        accept: 'application/vnd.github+json'
      }
    }))
    const HistoryData = (await Unzipper.Open.buffer(HistoryCompressedBuffer)).files.find(FilePara => FilePara.path === 'dist-tag.json')

    if (typeof HistoryData === 'undefined') {
      return null
    }

    return JSON.parse((await HistoryData.buffer()).toString()) as IHistoryManagerDataJSON
  }
}
