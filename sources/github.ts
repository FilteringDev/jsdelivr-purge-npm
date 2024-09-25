import * as GitHub from '@octokit/rest'
import * as Luxon from 'luxon'
import got from 'got'

export type IHistoryManagerDataJSON = Record<string, string>

export class HistoryManager {
  private GitHubInstance: InstanceType<typeof GitHub.Octokit> = null

  constructor(private readonly Config: { Repo: string, GitHubToken: string, WorkflowRef: string, DistTags: string }) {
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
      workflow_id: this.Config.WorkflowRef
    })
    return GHResponseRuns.data.total_count > 0
  }

  private async RequestHistory(): Promise<IHistoryManagerDataJSON> {
    if (!await this.CheckWorkflowRunExist()) {
      return null
    }
    const HistoryURL = await this.ListHistory()[0]
    const HistoryData = await got(HistoryURL, {
      https: {
        minVersion: 'TLSv1.3',
        ciphers: 'TLS_AES_256_GCM_SHA384;TLS_CHACHA20_POLY1305_SHA256'
      },
      http2: true
    }).json() as IHistoryManagerDataJSON
    return HistoryData
  }
}