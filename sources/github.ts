import * as GitHub from '@octokit/rest'
import * as Luxon from 'luxon'
import * as Unzipper from 'unzipper'
import got from 'got'

export type IHistoryManagerDataJSON = Record<string, string>

export class HistoryManager {
  private GitHubInstance: InstanceType<typeof GitHub.Octokit> = null

  constructor(private readonly Config: { Repo: string, GitHubToken: string, WorkflowRef: string }) {
    this.GitHubInstance = new GitHub.Octokit({ auth: this.Config.GitHubToken })
  }

  private async ListHistory() {
    const GHResponseRuns = await this.GitHubInstance.actions.listWorkflowRunsForRepo({
      owner: this.Config.Repo.split('/')[0],
      repo: this.Config.Repo.split('/')[1],
      workflow_id: this.Config.WorkflowRef
    })
    const GHResponseArtifacts = await this.GitHubInstance.actions.listWorkflowRunArtifacts({
      owner: this.Config.Repo.split('/')[0],
      repo: this.Config.Repo.split('/')[1],
      run_id: GHResponseRuns.data.workflow_runs.filter(Run => Run.status === 'completed' && Run.conclusion === 'success')
        .sort((RunA, RunB) => Luxon.DateTime.fromISO(RunA.updated_at).toMillis() - Luxon.DateTime.fromISO(RunB.updated_at).toMillis())[0].id
    })
    return GHResponseArtifacts.data.artifacts.map((Artifact) => Artifact.archive_download_url)
  }

  private async CheckWorkflowRunExist() {
    const GHResponseRuns = await this.GitHubInstance.actions.listWorkflowRunsForRepo({
      owner: this.Config.Repo.split('/')[0],
      repo: this.Config.Repo.split('/')[1],
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
    const HistoryURL = await this.ListHistory()[0]
    if (typeof HistoryURL === 'undefined') {
      return null
    }
    const HistoryCompressedBuffer = await got(HistoryURL, {
      https: {
        minVersion: 'TLSv1.3',
        ciphers: 'TLS_AES_256_GCM_SHA384;TLS_CHACHA20_POLY1305_SHA256'
      },
      http2: true
    }).buffer()
    const HistoryData = (await Unzipper.Open.buffer(HistoryCompressedBuffer)).files.find(FilePara => FilePara.path.includes('dist-tag.json'))
    return (await HistoryData.buffer()).toString() as unknown as IHistoryManagerDataJSON
  }
}